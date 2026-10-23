'use strict';
/* Lightweight local ERP server: static files + JSON table store + Google relay.
   No external dependencies (Node >= 18). Used by Electron and by `npm run server`.
   9차(v1.4.0): 표마다 버전(다른 PC 와 저장 충돌 → 409) · 설정 항목별 저장 · Host/Origin 검사 · 사내망 PIN · 매일 자동 백업
   18차(v1.13.0): 여러 PC 자료 공유 — 구글 드라이브 (cloudsync.js) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const vm = require('vm');
const cloudsync = require('./cloudsync.js');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

function safeName(n) { return /^[a-z0-9_]{1,40}$/i.test(n) ? n : null; }
/** local date (the factory's day, not UTC) */
function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function createStore(dataDir) {
  const tdir = path.join(dataDir, 'tables');
  const bdir = path.join(dataDir, 'backup');
  fs.mkdirSync(tdir, { recursive: true });
  fs.mkdirSync(bdir, { recursive: true });
  const metaFile = path.join(dataDir, 'meta.json');
  const verFile = path.join(dataDir, 'versions.json');
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
  // 표마다 · 설정의 저장 번호. 화면은 마지막으로 받은 번호를 함께 보내고, 그 사이 다른 PC 가 저장했으면 409 로 알려 준다
  let vers = { t: {}, meta: 0 };
  try { vers = Object.assign(vers, JSON.parse(fs.readFileSync(verFile, 'utf8'))); vers.t = vers.t || {}; } catch (e) { /* first run */ }
  const saveVers = () => atomicWrite(verFile, JSON.stringify(vers));
  const readMeta = () => { try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) { return {}; } };
  return {
    dir: dataDir,
    readAll() {
      const tables = {};
      for (const f of fs.readdirSync(tdir)) {
        if (!f.endsWith('.json')) continue;
        try { tables[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(tdir, f), 'utf8')); } catch (e) { console.error('bad table', f, e.message); }
      }
      return { tables, meta: readMeta(), versions: Object.assign({}, vers.t), metaVer: vers.meta || 0 };
    },
    readTable(name) { try { return JSON.parse(fs.readFileSync(path.join(tdir, name + '.json'), 'utf8')); } catch (e) { return []; } },
    readMeta,
    ver: (name) => vers.t[name] || 0,
    versions: () => ({ t: Object.assign({}, vers.t), meta: vers.meta || 0 }),
    writeTable(name, rows) {
      backupOnce(name);
      atomicWrite(path.join(tdir, name + '.json'), JSON.stringify(rows));
      prune();
      vers.t[name] = (vers.t[name] || 0) + 1; saveVers(); return vers.t[name];
    },
    writeMeta(meta) { atomicWrite(metaFile, JSON.stringify(meta)); vers.meta = (vers.meta || 0) + 1; saveVers(); return vers.meta; },
  };
}

/** 사내망 PIN: ERP 가 실행 중인 PC(loopback)는 그대로 쓰고, 다른 PC 브라우저는 PIN 을 한 번 넣어 세션(쿠키)을 받는다 */
function createAuth(dataDir) {
  const file = path.join(dataDir, 'lan.json'); const sessions = new Map(); const fails = new Map();
  const cfg = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; } };
  const hashPin = (pin, salt) => crypto.pbkdf2Sync(String(pin), salt, 120000, 32, 'sha256').toString('hex');
  const DAY = 86400000;
  return {
    hasPin: () => !!cfg().hash,
    setPin(pin) {
      sessions.clear();
      if (!pin) { try { fs.unlinkSync(file); } catch (e) { /* none */ } return; }
      const salt = crypto.randomBytes(16).toString('hex');
      fs.writeFileSync(file, JSON.stringify({ salt, hash: hashPin(pin, salt), at: new Date().toISOString() }), { mode: 0o600 });
    },
    /** returns {token} · {wait: seconds} · {bad: true} · {nopin: true} */
    login(ip, pin) {
      const c = cfg(); if (!c.hash) return { nopin: true };
      const f = fails.get(ip) || { n: 0, until: 0 }; const now = Date.now();
      if (f.until > now) return { wait: Math.ceil((f.until - now) / 1000) };
      const ok = crypto.timingSafeEqual(Buffer.from(hashPin(pin, c.salt), 'hex'), Buffer.from(c.hash, 'hex'));
      if (!ok) { f.n++; if (f.n >= 5) { f.until = now + 60000 * Math.min(10, f.n - 4); } fails.set(ip, f); return { bad: true }; }
      fails.delete(ip); const token = crypto.randomBytes(24).toString('hex'); sessions.set(token, now + 7 * DAY); return { token };
    },
    valid(token) { const e = token && sessions.get(token); if (!e) return false; if (e < Date.now()) { sessions.delete(token); return false; } return true; },
    logout(token) { sessions.delete(token); },
  };
}

/** 사용자가 고른 폴더 만들기 (mkdir -p). Node 의 recursive 는 이상한 경로(예: 쓸 수 없는 특수 폴더)에서 끝없이 돌 수 있어 한 단계씩 만든다 */
function mkdirp(dir) {
  const parts = []; let d = path.resolve(dir);
  for (let i = 0; i < 64 && !fs.existsSync(d); i++) { parts.unshift(d); const up = path.dirname(d); if (up === d) break; d = up; }
  for (const p of parts) { try { fs.mkdirSync(p); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
}

/** 18차(1.13.2): 구글 시트에 쓸 표 이름 · 머리글 = 화면과 같은 한국어 (app/js/schema.js 의 ERP.TABLES 를 읽음). {표: {title, ord, cols: [{k, h, t}]}} */
function loadLayouts(appDir) {
  try {
    const win = { ERP: {} }; const ctx = { window: win, L: (ko) => ko, console };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(appDir, 'js', 'schema.js'), 'utf8'), ctx, { filename: 'schema.js' });
    const T = win.ERP.TABLES || {}; const out = {};
    Object.keys(T).forEach((n, i) => { out[n] = { title: String(T[n].ko || n), ord: i, cols: (T[n].cols || []).map(c => ({ k: c.k, h: String(c.ko || c.k), t: c.t || '' })) }; });
    return out;
  } catch (e) { console.error('layouts', e.message); return {}; }
}

/** Apps Script 웹 앱 주소만 (구글 중계 · 드라이브 백업). 시험은 opts.googleHosts 로 바꾼다 */
const GOOGLE_HOSTS = /(^|\.)script\.google\.com$|(^|\.)googleusercontent\.com$/;
const googleUrlOk = (url, re) => { try { const u = new URL(url); return re ? re.test(u.hostname) : (u.protocol === 'https:' && GOOGLE_HOSTS.test(u.hostname)); } catch (e) { return false; } };

/** 매일 자동 백업: 지정한 폴더(USB · NAS · 구글 드라이브 동기화 폴더)에 전체 JSON + (선택) 구글 드라이브에 압축본 */
function createBackup(dataDir, store, googleHosts, doFetch) {
  const file = path.join(dataDir, 'backup.json');
  const cfg = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; } };
  const save = (c) => fs.writeFileSync(file, JSON.stringify(c, null, 1));
  const keepOf = (c) => Math.max(3, Math.min(365, Number(c.keep) || 30));
  let running = null;
  async function runNow() {
    const c = cfg(); const day = today(); const at = new Date().toISOString(); const errs = []; const res = { at };
    const all = store.readAll();
    const json = JSON.stringify({ app: 'colorpencil-erp', version: 1, created: at, meta: all.meta, tables: all.tables });
    const name = 'ERP_backup_' + day + '.json'; res.size = Buffer.byteLength(json);
    if (c.dir) {
      try {
        mkdirp(c.dir); const tmp = path.join(c.dir, name + '.tmp');
        fs.writeFileSync(tmp, json); fs.renameSync(tmp, path.join(c.dir, name)); res.file = path.join(c.dir, name);
        const files = fs.readdirSync(c.dir).filter(f => /^ERP_backup_\d{4}-\d\d-\d\d\.json$/.test(f)).sort();
        while (files.length > keepOf(c)) fs.rmSync(path.join(c.dir, files.shift()), { force: true });
      } catch (e) { errs.push('folder: ' + e.message); }
    }
    if (c.google) {
      const g = all.meta || {};
      if (!g.gUrl) errs.push('google: Apps Script URL 없음 / chưa có URL');
      else if (!googleUrlOk(g.gUrl, googleHosts)) errs.push('google: Apps Script 주소가 아닙니다 / không phải URL Apps Script');
      else {
        try {
          const b64 = zlib.gzipSync(json).toString('base64');
          const r = await doFetch(g.gUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: AbortSignal.timeout(180000),
            body: JSON.stringify({ token: g.gToken, action: 'backup', name: name + '.gz', b64, keep: keepOf(c) }) });
          const j = await r.json().catch(() => ({}));
          if (j.ok) res.drive = j.url || j.name;
          else errs.push('google: ' + (j.error === 'unknown action' ? 'Apps Script 가 옛 판입니다 — google/Code.gs 3판을 다시 배포하세요 / Hãy triển khai lại Code.gs bản 3' : (j.error || ('HTTP ' + r.status))));
        } catch (e) { errs.push('google: ' + e.message); }
      }
    }
    const n = cfg(); n.lastTry = at; if (!errs.length) n.lastOk = at; n.lastFile = res.file || n.lastFile || null; if (res.drive) n.lastDrive = res.drive; n.lastError = errs.join(' · ') || null; n.lastSize = res.size; save(n);
    return Object.assign(res, { error: n.lastError });
  }
  return {
    cfg,
    set(o) {
      const c = cfg();
      if (o.dir !== undefined) c.dir = String(o.dir || '').trim() || null;
      if (c.dir && !path.isAbsolute(c.dir)) throw new Error('폴더 전체 경로를 넣으세요 (예: E:\\ERP백업) / Nhập đường dẫn đầy đủ');
      if (o.keep !== undefined) c.keep = keepOf({ keep: o.keep });
      if (o.google !== undefined) c.google = !!o.google;
      if (c.dir) { mkdirp(c.dir); const t = path.join(c.dir, '.erp_write_test'); fs.writeFileSync(t, 'ok'); fs.rmSync(t, { force: true }); }   // 쓸 수 있는 폴더인지 바로 확인
      save(c); return c;
    },
    run() { if (!running) running = runNow().finally(() => { running = null; }); return running; },
    /** 스케줄러: 오늘 성공한 백업이 없고, 마지막 시도가 30분 넘게 지났으면 실행 */
    due() { const c = cfg(); if (!c.dir && !c.google) return false; if (c.lastOk && c.lastOk.slice(0, 10) === today()) return false; return !c.lastTry || Date.now() - Date.parse(c.lastTry) > 30 * 60000; },
  };
}

// ---- AI 중계 (9차): 정해진 필드만 넘기고 모델 · 길이는 서버 설정으로 — 다른 PC 브라우저가 비싼 모델이나 서버 도구(웹 검색 등)를 쓰지 못하게 ----
const AI_MAX_TOKENS = 16000, AI_DAILY_DEFAULT = 400, AI_MODEL = 'claude-sonnet-5-5';
// 안전 정책으로 거절되면 Anthropic 이 알맞은 다른 모델로 다시 답하는 fallbacks: "default" (Claude API, 베타 헤더 필요)
const AI_FALLBACK_MODELS = /^claude-(sonnet-5-5|opus-5-5|opus-5|fable-5-1|fable-5)$/, AI_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
function aiBody(b, model) {
  if (!b || !Array.isArray(b.messages) || !b.messages.length) return { error: 'messages required' };
  const out = { model, max_tokens: Math.min(AI_MAX_TOKENS, Math.max(1, Math.floor(Number(b.max_tokens) || AI_MAX_TOKENS))), messages: b.messages };
  if (typeof b.system === 'string') out.system = b.system;
  else if (Array.isArray(b.system)) {
    if (!b.system.every(x => x && x.type === 'text' && typeof x.text === 'string')) return { error: 'system: text blocks only' };
    out.system = b.system.map(x => (x.cache_control ? { type: 'text', text: x.text, cache_control: { type: 'ephemeral' } } : { type: 'text', text: x.text }));
  }
  if (b.tools !== undefined) {
    if (!Array.isArray(b.tools) || b.tools.length > 32) return { error: 'tools: array (max 32)' };
    for (const t of b.tools) if (!t || typeof t.name !== 'string' || !t.input_schema || typeof t.input_schema !== 'object' || (t.type !== undefined && t.type !== 'custom')) return { error: 'only custom tools are allowed: ' + String((t && (t.type || t.name)) || '?') };
    out.tools = b.tools.map(t => { const x = { name: t.name, input_schema: t.input_schema }; if (typeof t.description === 'string') x.description = t.description; if (t.strict === true) x.strict = true; return x; });
  }
  if (b.tool_choice && ['auto', 'none'].includes(b.tool_choice.type)) out.tool_choice = { type: b.tool_choice.type };
  if (b.output_config && ['low', 'medium', 'high'].includes(b.output_config.effort)) out.output_config = { effort: b.output_config.effort };
  if (b.cache_control) out.cache_control = { type: 'ephemeral' };
  if (b.fallbacks === 'default' && AI_FALLBACK_MODELS.test(model)) out.fallbacks = 'default';
  if (b.thinking && b.thinking.type === 'adaptive') out.thinking = { type: 'adaptive' };
  return { body: out };
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
/** 이 PC 를 가리키는 이름들 (Host 검사): 127.0.0.1 · localhost · 이 PC 의 IP · 컴퓨터 이름 */
function hostNames() {
  const set = new Set(['127.0.0.1', 'localhost', '[::1]']);
  const ifs = os.networkInterfaces();
  for (const k of Object.keys(ifs)) for (const i of ifs[k]) set.add(i.family === 'IPv6' ? '[' + i.address.toLowerCase() + ']' : i.address);
  const hn = String(os.hostname() || '').toLowerCase(); if (hn) { set.add(hn); set.add(hn.split('.')[0]); set.add(hn.split('.')[0] + '.local'); }
  return set;
}
const isLoop = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const cookieOf = (req, k) => { const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + k + '=([^;]+)')); return m ? m[1] : null; };

function start(opts) {
  opts = opts || {};
  const appDir = path.resolve(opts.appDir || path.join(__dirname, 'app'));
  const dataDir = opts.dataDir || process.env.ERP_DATA || path.join(__dirname, 'data');
  const host = opts.host || process.env.ERP_HOST || '127.0.0.1';
  let port = Number(opts.port || process.env.ERP_PORT || 3210);
  // 바깥 요청(Anthropic · 구글): 설치형은 Electron 의 net.fetch (회사 프록시 · 인증서를 따름), 그 밖에는 Node fetch
  const doFetch = (u, init) => (opts.fetch || global.fetch)(u, init);
  // 이 PC 이름 · IP 말고 다른 이름으로 들어와야 하면 (회사 DNS 이름 등): ERP_ALLOW_HOSTS=erp.bosung.local,erp2
  const extraHosts = String(opts.allowHosts || process.env.ERP_ALLOW_HOSTS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const store = createStore(dataDir);
  const auth = createAuth(dataDir);
  const backup = createBackup(dataDir, store, opts.googleHosts, doFetch);
  const up = opts.update || null;   // 15차: electron/updater.js (설치형에서만)
  // 18차: 여러 PC 자료 공유 (구글 드라이브). 켜져 있으면 30초마다 · 이 PC 에서 저장한 뒤 3초에 구글과 맞춘다
  const layouts = loadLayouts(appDir);   // 구글 시트 탭 이름 · 머리글 (1.13.2)
  const cloud = cloudsync.create({ dataDir, store, fetch: doFetch, urlOk: (u) => googleUrlOk(u, opts.googleHosts), codeFile: path.join(__dirname, 'google', 'Code.gs'),
    every: opts.cloudEvery, poke: opts.cloudPoke, log: opts.cloudLog, layout: (n) => layouts[n] || null, pc: opts.pcName || os.hostname(),
    sheet: opts.cloudSheet, sheetLag: opts.cloudSheetLag });

  /** 다른 웹사이트(DNS rebinding · 다른 출처의 요청)는 막는다: Host 는 이 PC 이름, Origin 이 있으면 같은 곳, 쓰기 요청은 JSON 만 */
  function guard(req, isApi) {
    const names = hostNames(); extraHosts.forEach(x => names.add(x));
    const hm = String(req.headers.host || '').toLowerCase().match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
    if (!hm || !names.has(hm[1]) || (hm[2] && Number(hm[2]) !== port)) return 'bad host';
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let o; try { o = new URL(origin); } catch (e) { return 'bad origin'; }
      if (o.protocol !== 'http:' || !names.has(o.hostname.toLowerCase().replace(/^([^[].*:.*)$/, '[$1]')) || Number(o.port || 80) !== port) return 'bad origin';
    }
    if (isApi && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return 'json only';
    return null;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      const p = decodeURIComponent(u.pathname);
      const bad = guard(req, p.startsWith('/api/'));
      if (bad) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: bad })); }
      if (p.startsWith('/api/')) return await api(req, res, p, u);
      const file = path.normalize(path.join(appDir, p === '/' ? 'index.html' : p));
      if (file !== appDir && !file.startsWith(appDir + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
  });

  async function api(req, res, p, u) {
    const send = (code, obj, hdr) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, hdr || {})); res.end(JSON.stringify(obj)); };
    const loop = isLoop(req); const token = cookieOf(req, 'erp_s'); const authed = loop || auth.valid(token);
    // ---- 로그인 (사내망 PIN) ----
    if (p === '/api/ping') return send(200, { ok: true, mode: 'server', version: 2, auth: authed, hasPin: auth.hasPin(), loopback: loop });
    if (p === '/api/login' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req, 1e4) || '{}'); const r = auth.login(req.socket.remoteAddress, String(b.pin || ''));
      if (r.token) return send(200, { ok: true }, { 'Set-Cookie': 'erp_s=' + r.token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800' });
      return send(r.wait ? 429 : 401, { error: r.nopin ? 'NO_PIN' : r.wait ? 'WAIT' : 'BAD_PIN', wait: r.wait || 0 });
    }
    if (p === '/api/logout' && req.method === 'POST') { auth.logout(token); return send(200, { ok: true }, { 'Set-Cookie': 'erp_s=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
    if (!authed) return send(401, { error: 'LOGIN', hasPin: auth.hasPin() });

    if (p === '/api/info') return send(200, { dataDir: store.dir, port, host, lan: lanAddresses(port), lanOn: host !== '127.0.0.1' && host !== 'localhost', platform: process.platform, hasPin: auth.hasPin(), loopback: loop });
    if (p === '/api/db' && req.method === 'GET') return send(200, store.readAll());
    if (p === '/api/versions' && req.method === 'GET') return send(200, Object.assign(store.versions(), { cloud: cloud.brief() }));
    if (p === '/api/meta' && req.method === 'GET') return send(200, { meta: store.readMeta(), ver: store.versions().meta });
    // 설정: 바뀐 항목만 합친다 (다른 PC 가 바꾼 다른 항목은 그대로)
    if (p === '/api/meta' && req.method === 'PATCH') {
      const b = JSON.parse(await readBody(req, 5e6)); const m = store.readMeta();
      Object.keys(b.set || {}).forEach(k => { m[k] = b.set[k]; }); (b.del || []).forEach(k => { delete m[k]; });
      const ver = store.writeMeta(m); cloud.poke(); return send(200, { ok: true, ver, meta: m });
    }
    if (p === '/api/meta' && req.method === 'PUT') { const ver = store.writeMeta(JSON.parse(await readBody(req, 5e6))); cloud.poke(); return send(200, { ok: true, ver }); }   // 옛 화면(1.3.0 이전)용
    let m = p.match(/^\/api\/t\/([A-Za-z0-9_]+)$/);
    if (m && req.method === 'GET') { const name = safeName(m[1]); if (!name) return send(400, { error: 'bad name' }); return send(200, { rows: store.readTable(name), ver: store.ver(name) }); }
    if (m && req.method === 'PUT') {
      const name = safeName(m[1]); if (!name) return send(400, { error: 'bad name' });
      const rows = JSON.parse(await readBody(req, 300e6));
      if (!Array.isArray(rows)) return send(400, { error: 'rows must be array' });
      // 화면이 받은 뒤 다른 PC 가 먼저 저장했으면 덮어쓰지 않고 지금 서버 자료를 돌려준다 → 화면이 행 단위로 합쳐 다시 저장
      const base = req.headers['x-base-ver'];
      if (base !== undefined && Number(base) !== store.ver(name)) return send(409, { error: 'CONFLICT', ver: store.ver(name), rows: store.readTable(name) });
      const ver = store.writeTable(name, rows); cloud.poke();
      return send(200, { ok: true, count: rows.length, ver });
    }
    // ---- 사내망 PIN · 자동 백업 설정 (ERP 가 실행 중인 PC 에서만) ----
    if (p === '/api/lan/pin' && req.method === 'PUT') {
      if (!loop) return send(403, { error: 'Only on the PC that runs the ERP. / Chỉ trên máy đang chạy ERP.' });
      const b = JSON.parse(await readBody(req, 1e4)); const pin = String(b.pin || '').trim();
      if (pin && !/^\d{4,12}$/.test(pin)) return send(400, { error: 'PIN = 4~12 digits / 4~12 chữ số' });
      auth.setPin(pin); return send(200, { ok: true, hasPin: auth.hasPin() });
    }
    if (p === '/api/backup' && req.method === 'GET') return send(200, backup.cfg());
    if (p === '/api/backup' && req.method === 'PUT') {
      if (!loop) return send(403, { error: 'Only on the PC that runs the ERP. / Chỉ trên máy đang chạy ERP.' });
      try { return send(200, backup.set(JSON.parse(await readBody(req, 1e5)))); } catch (e) { return send(400, { error: e.message }); }
    }
    if (p === '/api/backup/run' && req.method === 'POST') return send(200, await backup.run());
    // ---- 18차: 여러 PC 자료 공유 (구글 드라이브). 상태 · 지금 맞추기는 누구나, 연결 확인 · 연결 · 끄기 · 코드는 ERP 가 실행 중인 PC 에서만 ----
    if (p === '/api/cloud' && req.method === 'GET') return send(200, Object.assign(cloud.status(), { local: loop }));
    if (p === '/api/cloud/sync' && req.method === 'POST') return send(200, Object.assign(await cloud.syncNow(), { local: loop }));
    if (p === '/api/cloud/sheet' && req.method === 'POST') {   // 1.13.2: 구글 시트 다시 쓰기 (모든 표)
      try { await cloud.sheetNow(true); return send(200, Object.assign(cloud.status(), { local: loop })); } catch (e) { return send(e.code ? 400 : 500, { code: e.code || 'ERR', error: e.detail || e.message }); }
    }
    if (p.startsWith('/api/cloud/')) {
      if (!loop) return send(403, { error: 'Only on the PC that runs the ERP. / Chỉ trên máy đang chạy ERP.' });
      if (req.method !== 'POST') return send(404, { error: 'unknown api' });
      let b; try { b = JSON.parse(await readBody(req, 1e6) || '{}'); } catch (e) { return send(400, { code: 'BAD_JSON', error: e.message }); }
      try {
        if (p === '/api/cloud/check') return send(200, await cloud.check(b.url, b.token));
        if (p === '/api/cloud/preview') return send(200, await cloud.preview(b.url, b.token, b.nat));
        if (p === '/api/cloud/connect') return send(200, await cloud.connect(b));
        if (p === '/api/cloud/off') return send(200, await cloud.off());
        if (p === '/api/cloud/code') return send(200, { ok: true, code: cloud.code(b.token) });
      } catch (e) { return send(e.code ? 400 : 500, { code: e.code || 'ERR', error: e.detail || e.message }); }
      return send(404, { error: 'unknown api' });
    }
    // ---- 15차: 프로그램 자동 업데이트 (설치형 Electron 만 opts.update 가 있음). 보기는 누구나, 확인 · 설치 · 켜고 끄기는 ERP 가 실행 중인 PC 에서만 ----
    if (p === '/api/update' && req.method === 'GET') return send(200, up ? Object.assign(up.status(), { desktop: true, local: loop }) : { desktop: false, local: loop });
    if (p === '/api/update' || p.startsWith('/api/update/')) {
      if (!up) return send(404, { error: 'not desktop' });
      if (!loop) return send(403, { error: 'Only on the PC that runs the ERP. / Chỉ trên máy đang chạy ERP.' });
      const out = (s) => send(200, Object.assign(s, { desktop: true, local: true }));
      if (p === '/api/update' && req.method === 'PUT') { const b = JSON.parse(await readBody(req, 1e4) || '{}'); return out(b.auto === undefined ? up.status() : up.setAuto(!!b.auto)); }
      // 확인은 길어도 몇 초만 기다린다 — 받기(설치 파일)는 뒤에서 이어지고 화면은 상태를 다시 묻는다
      if (p === '/api/update/check' && req.method === 'POST') return out(await Promise.race([up.check(), new Promise(r => setTimeout(() => r(up.status()), opts.updateWait || 8000))]));
      if (p === '/api/update/install' && req.method === 'POST') { try { return send(200, await up.installNow()); } catch (e) { return send(400, { error: e.message }); } }
      return send(404, { error: 'unknown api' });
    }
    // ---- AI assistant: API key is kept in <data>/ai.json and never sent to the browser ----
    const aiFile = path.join(dataDir, 'ai.json'), usageFile = path.join(dataDir, 'ai_usage.json');
    const aiCfg = () => { try { return JSON.parse(fs.readFileSync(aiFile, 'utf8')); } catch (e) { return {}; } };
    const usage = () => { try { return JSON.parse(fs.readFileSync(usageFile, 'utf8')); } catch (e) { return {}; } };
    const limitOf = (c) => (c.dailyLimit === undefined || c.dailyLimit === null ? AI_DAILY_DEFAULT : Math.max(0, Math.floor(Number(c.dailyLimit) || 0)));
    // the key is shown only as its last 4 characters; it can be changed only from the PC that runs the ERP (not from LAN browsers)
    const keyTail = (c) => (c.key ? c.key.slice(-4) : (process.env.ANTHROPIC_API_KEY ? 'env' : ''));
    const cfgOut = (c) => ({ hasKey: !!(c.key || process.env.ANTHROPIC_API_KEY), model: c.model || AI_MODEL, keyTail: keyTail(c), dailyLimit: limitOf(c), today: usage()[today()] || { requests: 0 }, canEdit: loop });
    /** 하루 사용량 (호출 수 · 토큰). 120일 보관 */
    const addUsage = (j) => {
      const u = usage(), d = today(), x = u[d] || (u[d] = { requests: 0, input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0, refusals: 0 });
      const us = (j && j.usage) || {}; x.requests++; x.input_tokens += us.input_tokens || 0; x.output_tokens += us.output_tokens || 0;
      x.cache_read += us.cache_read_input_tokens || 0; x.cache_write += us.cache_creation_input_tokens || 0; if (j && j.stop_reason === 'refusal') x.refusals++;
      Object.keys(u).sort().slice(0, -120).forEach(k => { delete u[k]; });
      fs.writeFileSync(usageFile, JSON.stringify(u));
    };
    if (p === '/api/ai/config' && req.method === 'GET') return send(200, cfgOut(aiCfg()));
    if (p === '/api/ai/config' && req.method === 'PUT') {
      if (!loop) return send(403, { error: 'The API key can only be changed on the PC that runs the ERP. / Chỉ đổi API key trên máy đang chạy ERP.' });
      const b = JSON.parse(await readBody(req, 1e5)); const c = aiCfg();
      if (typeof b.key === 'string') { if (b.key.trim()) c.key = b.key.trim(); else delete c.key; }
      if (b.model) c.model = String(b.model).trim();
      if (b.dailyLimit !== undefined && b.dailyLimit !== null && b.dailyLimit !== '') c.dailyLimit = Math.max(0, Math.floor(Number(b.dailyLimit) || 0));
      fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(aiFile, JSON.stringify(c), { mode: 0o600 });
      return send(200, Object.assign({ ok: true }, cfgOut(c)));
    }
    if (p === '/api/ai/messages' && req.method === 'POST') {
      const c = aiCfg(); const key = c.key || process.env.ANTHROPIC_API_KEY;
      if (!key) return send(400, { error: { message: 'NO_KEY' } });
      const lim = limitOf(c); if (lim > 0 && ((usage()[today()] || {}).requests || 0) >= lim) return send(429, { error: { type: 'daily_limit', message: 'DAILY_LIMIT ' + lim } });
      let b; try { b = JSON.parse(await readBody(req, 20e6)); } catch (e) { return send(400, { error: { message: 'bad request body' } }); }
      const a = aiBody(b, c.model || AI_MODEL); if (a.error) return send(400, { error: { message: a.error } });
      const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
      if (a.body.fallbacks) headers['anthropic-beta'] = AI_FALLBACK_BETA;
      try {
        const r = await doFetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(a.body), signal: AbortSignal.timeout(235000) });
        const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* not json */ }
        try { addUsage(j); } catch (e) { console.error('ai usage', e.message); }
        const h = { 'Content-Type': 'application/json; charset=utf-8' }; const ra = r.headers && r.headers.get ? r.headers.get('retry-after') : null; if (ra) h['Retry-After'] = ra;
        res.writeHead(r.status, h); return res.end(text);
      } catch (e) { return send(e.name === 'TimeoutError' ? 504 : 502, { error: { message: (e.name === 'TimeoutError' ? 'Timeout: ' : 'Network: ') + e.message } }); }
    }
    if (p === '/api/gproxy' && req.method === 'POST') {
      const { url, body } = JSON.parse(await readBody(req, 100e6));
      if (!googleUrlOk(url, opts.googleHosts)) return send(400, { error: 'only Google Apps Script URLs are allowed' });
      const r = await doFetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: typeof body === 'string' ? body : JSON.stringify(body), redirect: 'follow' });
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
    server.on('listening', () => {
      // 매일 자동 백업 (켜져 있을 때): 15분마다 확인, 시작 1분 뒤 첫 확인
      const tick = () => { if (backup.due()) backup.run().catch(e => console.error('backup', e.message)); };
      const timer = setInterval(tick, 15 * 60000); timer.unref && timer.unref();
      const first = setTimeout(tick, opts.backupDelay !== undefined ? opts.backupDelay : 60000); first.unref && first.unref();
      cloud.start(opts.cloudFirst);   // 18차: 공유가 켜져 있으면 5초 뒤 첫 판
      resolve({ server, port, host, url: 'http://127.0.0.1:' + port, dataDir, hasPin: () => auth.hasPin(), backup, cloud, close: () => { clearInterval(timer); clearTimeout(first); cloud.stop(); server.close(); } });
    });
    listen();
  });
}

module.exports = { start, aiBody };
if (require.main === module) {
  start({}).then(i => console.log('ERP server running at ' + i.url + '  (data: ' + i.dataDir + ')'));
}
