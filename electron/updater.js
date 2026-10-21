'use strict';
/* 15차(v1.10.0) 자동 업데이트 — GitHub Release 의 latest.json 을 보고 새 설치 파일을 받아 두었다가,
   다음에 ERP 를 켤 때(또는 [지금 업데이트]) 설치한다. 일하는 중에 저절로 다시 시작하지 않는다 (사내망의 다른 PC 가 끊기지 않게).
   · 확인: <base>/latest/download/latest.json   (base = 이 저장소의 releases 주소, 시험은 ERP_UPDATE_BASE)
   · 받기: <base>/download/v<버전>/<파일> → 크기 · SHA-256 확인 → <userData>/update/<파일> + pending.json
   · 설치: 데이터 폴더를 <userData>/update_backup/ 에 복사 → 설치 파일을 "/UPDATE /D=<설치 폴더>" 로 실행 → ERP 를 닫는다
           (설치 프로그램이 진행 막대만 보이고 끝나면 새 버전을 다시 켠다 — build/installer.nsi)
   · 같은 설치가 두 번 실패하면 저절로 다시 하지 않는다 (켤 때마다 설치만 반복하지 않게) — [지금 업데이트] 는 언제든.
   Electron 없이 시험할 수 있게 fetch · spawn · 끝내기는 밖에서 받는다 (tools/selftest_v15.js). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_BASE = 'https://github.com/bosungerppro-source/Bosung-ERP/releases';
const FILE_RE = /^ColorPencil-ERP-Setup-(\d+\.\d+\.\d+)\.exe$/;
const VER_RE = /^\d+\.\d+\.\d+$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const MAX_SIZE = 600 * 1048576, MAX_TRIES = 2, KEEP_BACKUPS = 5, KEEP_HISTORY = 20;
const FIRST_CHECK = 60000, EVERY = 4 * 3600000;

/** 1.10.0 > 1.9.0 (숫자로 비교) */
function cmpVer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const p = x[i] || 0, q = y[i] || 0; if (p !== q) return p > q ? 1 : -1; }
  return 0;
}
const pad = (n, w) => String(n).padStart(w || 2, '0');
const stamp = (t) => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()); };
const msg = (e) => String((e && e.message) || e);

function create(o) {
  const version = o.version, dir = o.dir, backupDir = o.backupDir, dataDir = o.dataDir;
  const installDir = o.installDir || null;                 // null = 설치하지 않음 (개발 실행 · Windows 가 아님)
  const base = String(o.base || REPO_BASE).replace(/\/+$/, '');
  const doFetch = o.fetch || global.fetch, spawn = o.spawn, now = o.now || Date.now;
  const quit = o.quit || (() => {}), beforeInstall = o.beforeInstall || (async () => {});
  let auto = o.auto !== false;
  const pendFile = path.join(dir, 'pending.json'), histFile = path.join(dir, 'history.json'), logFile = path.join(dir, 'update.log');
  const st = { state: 'idle', latest: null, progress: 0, error: '', checkedAt: null };
  let busy = null, timers = [], justUpdated = null;

  function log(line) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const old = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-199) : [];
      old.push(new Date(now()).toISOString() + ' ' + line); fs.writeFileSync(logFile, old.join('\n') + '\n');
    } catch (e) { /* 기록 실패는 무시 */ }
    if (o.log) o.log(line);
  }
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 1)); fs.renameSync(f + '.tmp', f); };
  const rm = (f) => { try { fs.rmSync(f, { force: true }); } catch (e) { /* 없음 */ } };
  /** 받아 둔 설치 파일 정보 (형식이 맞을 때만) */
  function readPending() {
    const p = readJson(pendFile, null);
    return p && VER_RE.test(String(p.version)) && FILE_RE.test(String(p.file)) && SHA_RE.test(String(p.sha256)) ? p : null;
  }
  function clearPending() {
    const p = readJson(pendFile, null); rm(pendFile);
    if (p && FILE_RE.test(String(p.file))) rm(path.join(dir, p.file));
  }
  /** 설치 파일이 그대로인지 (크기 · 필요하면 SHA-256 까지) */
  function fileOk(p, full) {
    const f = path.join(dir, p.file);
    try {
      if (fs.statSync(f).size !== p.size) return false;
      if (!full) return true;
      const h = crypto.createHash('sha256'); const fd = fs.openSync(f, 'r'); const buf = Buffer.alloc(1 << 20);
      try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(n === buf.length ? buf : buf.subarray(0, n)); } finally { fs.closeSync(fd); }
      return h.digest('hex') === p.sha256;
    } catch (e) { return false; }
  }
  const readyOf = () => { const p = readPending(); return p && cmpVer(p.version, version) > 0 && fileOk(p) ? p : null; };

  function status() {
    const p = readyOf(); const hist = readJson(histFile, []);
    let state = st.state;
    if (p && ['idle', 'latest', 'none'].includes(state)) state = 'ready';
    return { current: version, auto, state, latest: st.latest, progress: st.progress, error: st.error, checkedAt: st.checkedAt,
      ready: p ? { version: p.version, size: p.size, tries: p.tries || 0 } : null,
      last: Array.isArray(hist) && hist.length ? hist[hist.length - 1] : null, justUpdated, canInstall: !!installDir };
  }

  async function manifest() {
    const r = await doFetch(base + '/latest/download/latest.json', { redirect: 'follow', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
    if (r.status === 404) return null;                       // 아직 Release(또는 latest.json) 가 없음
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const m = j && FILE_RE.exec(String(j.file));
    if (!m || !VER_RE.test(String(j.version)) || m[1] !== j.version || !SHA_RE.test(String(j.sha256)) || !(j.size > 0 && j.size < MAX_SIZE)) throw new Error('latest.json 형식이 맞지 않습니다 / latest.json sai định dạng');
    return { version: j.version, file: j.file, sha256: j.sha256, size: j.size };
  }

  async function download(m) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (/\.exe(\.part)?$/i.test(f) && f !== m.file) rm(path.join(dir, f));   // 옛 설치 파일
    const part = path.join(dir, m.file + '.part');
    st.state = 'downloading'; st.progress = 0; log('download ' + m.version);
    const r = await doFetch(base + '/download/v' + m.version + '/' + m.file, { redirect: 'follow', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(3600000) });
    if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
    const fh = await fs.promises.open(part, 'w'); const hash = crypto.createHash('sha256'); let got = 0;
    try {
      const rd = r.body.getReader();
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        got += value.length; if (got > m.size) throw new Error('크기가 다릅니다 / sai kích thước');
        hash.update(value); await fh.write(value); st.progress = got / m.size;
      }
    } catch (e) { await fh.close().catch(() => {}); rm(part); throw e; }
    await fh.close();
    if (got !== m.size) { rm(part); throw new Error('크기가 다릅니다 / sai kích thước (' + got + ' / ' + m.size + ')'); }
    if (hash.digest('hex') !== m.sha256) { rm(part); throw new Error('SHA-256 이 다릅니다 (파일이 손상됨) / sai SHA-256'); }
    fs.renameSync(part, path.join(dir, m.file));
    writeJson(pendFile, { version: m.version, file: m.file, sha256: m.sha256, size: m.size, from: version, at: new Date(now()).toISOString(), tries: 0 });
    log('ready ' + m.version);
  }

  /** 새 버전 확인 → 있으면 받기. 같은 확인이 돌고 있으면 그것을 돌려준다 */
  function check() {
    if (busy) return busy;
    busy = (async () => {
      st.state = 'checking'; st.error = ''; st.progress = 0;
      try {
        const m = await manifest(); st.checkedAt = new Date(now()).toISOString();
        if (!m) { st.state = 'none'; st.latest = null; return status(); }
        st.latest = m.version;
        if (cmpVer(m.version, version) <= 0) { st.state = 'latest'; if (readPending()) clearPending(); return status(); }
        const p = readPending();
        if (!(p && p.version === m.version && p.sha256 === m.sha256 && fileOk(p))) await download(m);
        st.state = 'ready';
      } catch (e) { st.state = 'error'; st.error = msg(e); log('error ' + st.error); }
      return status();
    })().finally(() => { busy = null; });
    return busy;
  }

  /** 데이터 폴더(하루 백업 backup/ 은 빼고)를 update_backup/<시각>_v<지금>_to_v<새 버전>/ 에 복사, 최근 5개만 */
  function backupData(p) {
    if (!dataDir || !fs.existsSync(dataDir)) return null;
    const dst = path.join(backupDir, stamp(now()) + '_v' + version + '_to_v' + p.version);
    fs.mkdirSync(dst, { recursive: true });
    fs.cpSync(dataDir, dst, { recursive: true, filter: (src) => path.relative(dataDir, src).split(path.sep)[0] !== 'backup' });
    const dirs = fs.readdirSync(backupDir).filter(n => /^\d{4}-\d\d-\d\d_\d{6}_v/.test(n)).sort();
    while (dirs.length > KEEP_BACKUPS) fs.rmSync(path.join(backupDir, dirs.shift()), { recursive: true, force: true });
    return dst;
  }

  /** 백업 → 설치 파일 실행. ERP 는 이 뒤에 바로 닫아야 한다 (설치 프로그램이 ERP 가 닫히기를 기다림) */
  function launch(p) {
    p.tries = (p.tries || 0) + 1; writeJson(pendFile, p);
    let saved;
    try { saved = backupData(p); } catch (e) { st.state = 'error'; st.error = '설치 전 백업 실패 / Sao lưu trước khi cài thất bại: ' + msg(e); log('error ' + st.error); return false; }
    const exe = path.join(dir, p.file);
    try {
      // /D= 는 따옴표 없이 맨 끝 (NSIS 규칙) → 인자를 그대로 넘긴다
      const child = spawn(exe, ['/UPDATE', '/D=' + installDir], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true, argv0: '"' + exe + '"' });
      if (child && child.unref) child.unref();
    } catch (e) { st.state = 'error'; st.error = '설치 파일을 실행하지 못했습니다 / Không chạy được tệp cài đặt: ' + msg(e); log('error ' + st.error); return false; }
    st.state = 'installing'; log('install ' + version + ' -> ' + p.version + ' (try ' + p.tries + ')' + (saved ? ' backup ' + saved : ''));
    return true;
  }

  /** 받아 둔 것 말고 남은 설치 파일 지우기 (방금 끝난 설치 프로그램이 아직 열려 있어 못 지웠으면 30초 뒤 다시) */
  function sweep() {
    const p = readPending();
    try { for (const f of fs.readdirSync(dir)) if (/\.exe(\.part)?$/i.test(f) && !(p && f === p.file)) rm(path.join(dir, f)); } catch (e) { /* 폴더 없음 */ }
  }
  /** 켤 때: 설치가 끝났으면 기록 · 정리, 받아 둔 새 버전이 있으면 설치 (true = ERP 를 띄우지 말고 바로 끝낼 것) */
  function startup() {
    const t = setTimeout(sweep, 30000); if (t.unref) t.unref();
    const p = readPending(); if (!p) { sweep(); return false; }
    if (cmpVer(p.version, version) <= 0) {
      if (p.version === version) {
        const hist = readJson(histFile, []); const h = Array.isArray(hist) ? hist : [];
        justUpdated = { from: p.from || null, to: version, at: new Date(now()).toISOString() }; h.push(justUpdated);
        writeJson(histFile, h.slice(-KEEP_HISTORY)); log('updated ' + (p.from || '?') + ' -> ' + version);
      }
      clearPending(); return false;
    }
    if (!auto || !installDir) return false;
    if ((p.tries || 0) >= MAX_TRIES) { st.state = 'error'; st.error = '새 버전 ' + p.version + ' 설치가 두 번 되지 않았습니다 — 설정 → 프로그램 업데이트에서 [지금 업데이트] 를 누르거나 설치 파일을 직접 실행하세요 / Cài bản ' + p.version + ' thất bại 2 lần: ' + path.join(dir, p.file); return false; }
    if (!fileOk(p, true)) { log('bad file ' + p.file); clearPending(); return false; }
    return launch(p);
  }

  /** [지금 업데이트]: 화면에서 대기 중인 저장(beforeInstall) → 백업 · 설치 파일 실행 → 끝내기(quit). 응답을 보낼 시간을 두고 시작한다.
      설치 파일을 못 띄우면 ERP 는 그대로 둔다 (서버도 그대로) */
  async function installNow(delay) {
    const p = readyOf();
    if (!p) throw new Error('받아 둔 새 버전이 없습니다 / Chưa có bản mới đã tải');
    if (!installDir) throw new Error('이 실행 방식에서는 설치할 수 없습니다 (설치형 ERP 에서만) / Chỉ cài được ở bản cài đặt');
    if (!fileOk(p, true)) { clearPending(); st.state = 'error'; st.error = '설치 파일이 손상되어 다시 받아야 합니다 / Tệp cài bị hỏng, cần tải lại'; throw new Error(st.error); }
    p.tries = 0; writeJson(pendFile, p);
    setTimeout(async () => {
      try { await beforeInstall(); } catch (e) { log('beforeInstall ' + msg(e)); }
      if (launch(p)) quit();
    }, delay === undefined ? 400 : delay);
    return { ok: true, version: p.version };
  }

  function setAuto(v) { auto = !!v; if (o.saveAuto) o.saveAuto(auto); log('auto ' + auto); return status(); }

  /** 켠 뒤 1분, 그 뒤 4시간마다 확인 (자동 업데이트가 켜져 있을 때만) */
  function schedule() {
    if (timers.length) return;
    const tick = () => { if (auto) check(); };
    const a = setTimeout(tick, o.firstCheck !== undefined ? o.firstCheck : FIRST_CHECK), b = setInterval(tick, o.every || EVERY);
    [a, b].forEach(t => t.unref && t.unref()); timers = [a, b];
  }
  function stop() { timers.forEach(t => { clearTimeout(t); clearInterval(t); }); timers = []; }

  return { status, check, startup, installNow, setAuto, schedule, stop, backupData, paths: { dir, backupDir, log: logFile } };
}

module.exports = { create, cmpVer, REPO_BASE, FILE_RE };
