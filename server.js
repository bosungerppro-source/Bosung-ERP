'use strict';
/* Lightweight local ERP server: static files + JSON table store + Google relay.
   No external dependencies (Node >= 18). Used by Electron and by `npm run server`. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

function safeName(n) { return /^[a-z0-9_]{1,40}$/i.test(n) ? n : null; }
function today() { return new Date().toISOString().slice(0, 10); }

function createStore(dataDir) {
  const tdir = path.join(dataDir, 'tables');
  const bdir = path.join(dataDir, 'backup');
  fs.mkdirSync(tdir, { recursive: true });
  fs.mkdirSync(bdir, { recursive: true });
  const metaFile = path.join(dataDir, 'meta.json');
  function atomicWrite(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  }
  function backupOnce(name) {
    // keep one copy of each table per day (first write of the day), 14 days retained
    const d = path.join(bdir, today());
    const src = path.join(tdir, name + '.json');
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(d, { recursive: true });
    const dst = path.join(d, name + '.json');
    if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
  }
  function prune() {
    try {
      const days = fs.readdirSync(bdir).filter(x => /^\d{4}-\d\d-\d\d$/.test(x)).sort();
      while (days.length > 14) fs.rmSync(path.join(bdir, days.shift()), { recursive: true, force: true });
    } catch (e) { /* ignore */ }
  }
  return {
    dir: dataDir,
    readAll() {
      const tables = {};
      for (const f of fs.readdirSync(tdir)) {
        if (!f.endsWith('.json')) continue;
        try { tables[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(tdir, f), 'utf8')); } catch (e) { console.error('bad table', f, e.message); }
      }
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) { /* none */ }
      return { tables, meta };
    },
    writeTable(name, rows) {
      backupOnce(name);
      atomicWrite(path.join(tdir, name + '.json'), JSON.stringify(rows));
      prune();
    },
    writeMeta(meta) { atomicWrite(metaFile, JSON.stringify(meta)); },
  };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function lanAddresses(port) {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const k of Object.keys(ifs)) for (const i of ifs[k]) if (i.family === 'IPv4' && !i.internal) out.push('http://' + i.address + ':' + port);
  return out;
}

function start(opts) {
  opts = opts || {};
  const appDir = opts.appDir || path.join(__dirname, 'app');
  const dataDir = opts.dataDir || process.env.ERP_DATA || path.join(__dirname, 'data');
  const host = opts.host || process.env.ERP_HOST || '127.0.0.1';
  let port = Number(opts.port || process.env.ERP_PORT || 3210);
  const store = createStore(dataDir);

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      const p = decodeURIComponent(u.pathname);
      if (p.startsWith('/api/')) return await api(req, res, p, u);
      let file = path.normalize(path.join(appDir, p === '/' ? 'index.html' : p));
      if (!file.startsWith(appDir)) { res.writeHead(403); return res.end('forbidden'); }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
  });

  async function api(req, res, p, u) {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
    if (p === '/api/ping') return send(200, { ok: true, mode: 'server', version: 1 });
    if (p === '/api/info') return send(200, { dataDir: store.dir, port, host, lan: lanAddresses(port), platform: process.platform });
    if (p === '/api/db' && req.method === 'GET') return send(200, store.readAll());
    if (p === '/api/meta' && req.method === 'PUT') { store.writeMeta(JSON.parse(await readBody(req, 5e6))); return send(200, { ok: true }); }
    let m = p.match(/^\/api\/t\/([A-Za-z0-9_]+)$/);
    if (m && req.method === 'PUT') {
      const name = safeName(m[1]); if (!name) return send(400, { error: 'bad name' });
      const rows = JSON.parse(await readBody(req, 300e6));
      if (!Array.isArray(rows)) return send(400, { error: 'rows must be array' });
      store.writeTable(name, rows);
      return send(200, { ok: true, count: rows.length });
    }
    // ---- AI assistant: API key is kept in <data>/ai.json and never sent to the browser ----
    const aiFile = path.join(dataDir, 'ai.json');
    const aiCfg = () => { try { return JSON.parse(fs.readFileSync(aiFile, 'utf8')); } catch (e) { return {}; } };
    // the key is shown only as its last 4 characters; it can be changed only from the PC that runs the ERP (not from LAN browsers)
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const keyTail = (c) => (c.key ? c.key.slice(-4) : (process.env.ANTHROPIC_API_KEY ? 'env' : ''));
    if (p === '/api/ai/config' && req.method === 'GET') { const c = aiCfg(); return send(200, { hasKey: !!(c.key || process.env.ANTHROPIC_API_KEY), model: c.model || 'claude-sonnet-5-5', keyTail: keyTail(c) }); }
    if (p === '/api/ai/config' && req.method === 'PUT') {
      if (!loopback) return send(403, { error: 'The API key can only be changed on the PC that runs the ERP. / Chỉ đổi API key trên máy đang chạy ERP.' });
      const b = JSON.parse(await readBody(req, 1e5)); const c = aiCfg();
      if (typeof b.key === 'string') { if (b.key.trim()) c.key = b.key.trim(); else delete c.key; }
      if (b.model) c.model = String(b.model).trim();
      fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(aiFile, JSON.stringify(c), { mode: 0o600 });
      return send(200, { ok: true, hasKey: !!(c.key || process.env.ANTHROPIC_API_KEY), model: c.model || 'claude-sonnet-5-5', keyTail: keyTail(c) });
    }
    if (p === '/api/ai/messages' && req.method === 'POST') {
      const c = aiCfg(); const key = c.key || process.env.ANTHROPIC_API_KEY;
      if (!key) return send(400, { error: { message: 'NO_KEY' } });
      const b = JSON.parse(await readBody(req, 20e6)); b.model = b.model || c.model || 'claude-sonnet-5-5';
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(b), signal: AbortSignal.timeout(120000) });
        const text = await r.text(); res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(text);
      } catch (e) { return send(e.name === 'TimeoutError' ? 504 : 502, { error: { message: (e.name === 'TimeoutError' ? 'Timeout: ' : 'Network: ') + e.message } }); }
    }
    if (p === '/api/gproxy' && req.method === 'POST') {
      const { url, body } = JSON.parse(await readBody(req, 100e6));
      const host2 = new URL(url).hostname;
      if (!/(^|\.)script\.google\.com$|(^|\.)googleusercontent\.com$/.test(host2)) return send(400, { error: 'only Google Apps Script URLs are allowed' });
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: typeof body === 'string' ? body : JSON.stringify(body), redirect: 'follow' });
      const text = await r.text();
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(text);
    }
    return send(404, { error: 'unknown api' });
  }

  return new Promise((resolve, reject) => {
    let tries = 0;
    const listen = () => server.listen(port, host);
    server.on('error', e => {
      if (e.code === 'EADDRINUSE' && tries++ < 20) { port++; listen(); } else reject(e);
    });
    server.on('listening', () => resolve({ server, port, host, url: 'http://127.0.0.1:' + port, dataDir, close: () => server.close() }));
    listen();
  });
}

module.exports = { start };
if (require.main === module) {
  start({}).then(i => console.log('ERP server running at ' + i.url + '  (data: ' + i.dataDir + ')'));
}
