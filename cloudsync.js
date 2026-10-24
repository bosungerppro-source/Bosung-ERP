'use strict';
/* 18차(v1.13.0) 여러 PC 자료 공유 — 구글 드라이브 (Apps Script 웹 앱 google/Code.gs 5판)
   PC 마다 ERP 서버(이 파일)가 구글 쪽과 표를 주고받는다 — 화면이 아니라 서버가 하므로 화면 · 사내망 브라우저가 몇 개든 하나만 돈다.
   - 구글 쪽: 표마다 드라이브 파일 하나 (gzip + base64) 와 저장 번호. cloud_info(번호만) → 바뀐 표만 cloud_get / cloud_put.
   - 합치기: 행 _id 와 지문(cyrb53, 화면 db.js 와 같음)으로 3-way merge. 기준 = 마지막으로 구글과 맞춘 행 지문 (<data>/cloud/<표>.json).
     한쪽만 바꾼 행은 바꾼 쪽, 둘 다 고친 행은 이 PC 내용 (= 나중에 맞춘 PC 가 남음), 한쪽이 지우고 다른 쪽이 고친 행은 남긴다.
   - 설정(meta)은 항목별로 합친다. 이 PC 에만 두는 항목(LOCAL_META)은 주고받지 않는다.
   - 언제: 30초마다 · 이 PC 에서 저장한 뒤 3초 · ERP 를 끄기 전 (electron/main.js). 그 사이 다른 PC 가 먼저 올렸으면(conflicts) 받아서 다시 합친다.
   - 이 PC 의 표를 읽고 · 합치고 · 쓰는 동안은 await 가 없다 → 화면 저장이 끼어들지 않는다 (화면은 409 로 다시 합침).
   - 처음 연결: upload (구글이 비었을 때) · replace (구글 자료로, 이 PC 자료는 백업) · merge (이 PC 에만 있는 행을 더함) · overwrite (구글을 이 PC 자료로) · resume (꺼 둔 뒤 다시).
   - 다른 PC 에서 많이 지워 이 PC 의 표가 절반 아래로 줄면, 쓰기 전에 그 표를 <data>/cloud_backup 에 복사해 둔다.
   1.13.2 (Code.gs 6판): 그 Apps Script 의 구글 시트 = 공유 자료 보기 (표마다 탭, 화면과 같은 한국어 이름 · 머리글).
   - 보낼 때 표마다 탭 이름 · 열 (o.layout, schema.js) 과 이 PC 이름 (o.pc) 을 같이 보낸다.
   - 시트 갱신(cloud_sheet)은 주고받기와 따로 돈다: 이 PC 가 보낸 뒤 20초 (그 사이 저장은 모아서 한 번), 다른 PC 가 못 한 갱신 (뒤처진 지 1분) 은 대신, [구글 시트 다시 쓰기] 는 바로.
     저장 응답 · 30초 판 · 끄기 전 보내기는 시트 쓰기를 기다리지 않는다. 5판 · 시트 없이 만든 스크립트는 부르지 않는다.
   1.13.3: 덮어쓰기는 구글에만 있는 표도 (이 ERP 가 아는 표면 빈 표로 — 이 PC 로 가져오지 않음, 모르는 표는 그대로).
     [구글 시트 다시 쓰기] 가 실패하면 그 요청을 남겨 두고 기다린 뒤 다시 한다. */
const fs = require('fs'), path = require('path'), zlib = require('zlib'), util = require('util');
const gzip = util.promisify(zlib.gzip), gunzip = util.promisify(zlib.gunzip);

/** 이 PC 에만 두는 설정: 구글 주소 · 키, 휴대폰 보기 켜짐 (요약은 켠 PC 가 보냄), AI 비서 프로필, 종합 현황 배치, 붙여넣기 숫자 형식, MRP 입력 줄 */
const LOCAL_META = /^(gUrl|gToken|mobileOn|cloud.*|ai[A-Z].*|dash|dashAsmMonthly|numFmt|mrpLines)$/;
const META = '__meta';                 // 구글 쪽에서 설정(공유 항목)을 담는 표 이름
const NAME_RE = /^[A-Za-z0-9_]{1,40}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
const BATCH = 20e6;                    // 한 번에 주고받는 글자 수 (Apps Script 요청 · 응답 크기)
const MODES = ['upload', 'replace', 'merge', 'overwrite', 'resume'];

/** db.js 와 같은 53-bit 지문 (cyrb53) */
function hash(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const SIG = new WeakMap();   // 행은 읽은 뒤 바꾸지 않는다 → 지문을 한 번만 계산
const sigOf = (r) => { let s = SIG.get(r); if (s === undefined) { s = hash(JSON.stringify(r)); SIG.set(r, s); } return s; };
const jsig = (v) => hash(JSON.stringify(v));
/** _id 가 없는 행: 화면(db.js ensureIds)과 같은 id → 어느 PC 에서나 같은 행. 같은 _id 가 또 나오면 뒤의 것은 _id~순번 (합칠 때 행이 사라지지 않게) */
function ensureIds(rows) {
  const seen = new Set();
  rows.forEach((r, i) => { if (!r._id) r._id = 'x' + hash(JSON.stringify(r)).toString(36) + '_' + i; else if (seen.has(r._id)) r._id = String(r._id) + '~' + i; seen.add(r._id); });
  return rows;
}
const rowsOf = (v) => (Array.isArray(v) ? v.filter(r => r && typeof r === 'object' && !Array.isArray(r)) : []);
const sigMap = (rows) => { const m = new Map(); rows.forEach(r => m.set(String(r._id), sigOf(r))); return m; };   // 기준 파일(JSON)의 키는 글자
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** base = 마지막으로 구글과 맞춘 행 지문(_id → 지문), local = 이 PC, remote = 지금 구글. db.js merge3 와 같은 규칙 */
function merge3(base, local, remote) {
  const lm = new Map(); local.forEach(r => lm.set(r._id, r));
  const rIds = new Set(); const out = []; let conflicts = 0;
  remote.forEach(r => {
    const id = r._id; rIds.add(id); const b = base.get(String(id)); const l = lm.get(id);
    if (!l) {
      if (b === undefined) { out.push(r); return; }              // 다른 PC 가 더함
      if (sigOf(r) === b) return;                                 // 이 PC 가 지움
      conflicts++; out.push(r); return;                           // 이 PC 는 지웠는데 다른 PC 가 고침 → 고친 행을 남김
    }
    const ls = sigOf(l);
    if (b === undefined) { if (ls !== sigOf(r)) conflicts++; out.push(l); return; }   // 양쪽에 같은 _id 가 새로 생김 → 이 PC
    if (ls === b) { out.push(r); return; }                        // 이 PC 는 그대로 → 구글 내용
    const rs = sigOf(r); if (rs !== b && rs !== ls) conflicts++;  // 둘 다 고침 → 이 PC 내용
    out.push(l);
  });
  local.forEach(l => {
    if (rIds.has(l._id)) return;
    const b = base.get(String(l._id));
    if (b === undefined) { out.push(l); return; }                 // 이 PC 가 더함
    if (sigOf(l) !== b) { conflicts++; out.push(l); }             // 다른 PC 는 지웠는데 이 PC 가 고침 → 남김
  });                                                             // 그 밖: 다른 PC 가 지움
  return { rows: out, conflicts };
}
function sameRows(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i]._id !== b[i]._id || sigOf(a[i]) !== sigOf(b[i])) return false; return true; }
const sameAsBase = (rows, base) => rows.length === base.size && rows.every(r => base.get(String(r._id)) === sigOf(r));

// ---- 설정 (meta): 항목 = 행
const sharedMeta = (m) => { const o = {}; Object.keys(m || {}).forEach(k => { if (!LOCAL_META.test(k) && m[k] !== undefined) o[k] = m[k]; }); return o; };
const localMeta = (m) => { const o = {}; Object.keys(m || {}).forEach(k => { if (LOCAL_META.test(k) && m[k] !== undefined) o[k] = m[k]; }); return o; };
const metaBase = (o) => { const m = new Map(); Object.keys(o).forEach(k => m.set(k, jsig(o[k]))); return m; };
const sameObj = (a, b) => { const ka = Object.keys(a); return ka.length === Object.keys(b).length && ka.every(k => own(b, k) && JSON.stringify(a[k]) === JSON.stringify(b[k])); };
const sameObjBase = (o, base) => { const ks = Object.keys(o); return ks.length === base.size && ks.every(k => base.get(k) === jsig(o[k])); };
function mergeMeta(base, local, remote) {
  const out = {}; let conflicts = 0;
  new Set(Object.keys(local).concat(Object.keys(remote), Array.from(base.keys()))).forEach(k => {
    const l = own(local, k) ? local[k] : undefined, r = own(remote, k) ? remote[k] : undefined, b = base.get(k);
    const ls = l === undefined ? undefined : jsig(l), rs = r === undefined ? undefined : jsig(r);
    let v;
    if (ls === rs) v = l;
    else if (ls === b) v = r;                            // 다른 PC 가 바꿈 · 지움
    else if (rs === b) v = l;                            // 이 PC 가 바꿈 · 지움
    else { v = l === undefined ? r : l; conflicts++; }   // 둘 다 바꿈 → 이 PC (이 PC 가 지웠고 다른 PC 가 고쳤으면 고친 값)
    if (v !== undefined) out[k] = v;
  });
  return { meta: out, conflicts };
}

/** 처음 합치기: 구글 행은 그대로, 이 PC 의 행은 이 PC 에서 입력한 것만 더한다 — 예시(_ex) · 같은 _id · 같은 내용 · 같은 기준 키(nat, 반복 없는 표)는 뺀다 */
function mergeFirst(local, cloud, nat) {
  const fp = (r) => JSON.stringify(Object.keys(r).filter(k => k !== '_id' && k !== '_ex').sort().map(k => [k, r[k]]));
  const ids = new Set(cloud.map(r => r._id)), fps = new Set(cloud.map(fp));
  const keys = nat && Array.isArray(nat.k) && nat.k.length && !nat.multi ? nat.k.map(String) : null;
  const kf = (r) => keys.map(k => String(r[k] === undefined || r[k] === null ? '' : r[k]).trim().toLowerCase()).join('\u0001');
  const kset = keys ? new Set(cloud.map(kf)) : null;
  const add = local.filter(r => !r._ex && !ids.has(r._id) && !fps.has(fp(r)) && !(kset && kset.has(kf(r))));
  return { rows: cloud.concat(add), added: add.length };
}

const fail = (code, detail) => Object.assign(new Error(code + (detail ? ': ' + detail : '')), { code, detail: detail || '' });
const pad = (x) => String(x).padStart(2, '0');
const stamp = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()); };

/**
 * o: { dataDir, store (server.js createStore), fetch, urlOk(url), codeFile, every (ms, 30000), poke (ms, 3000), log(msg),
 *      layout(표) → 시트 탭 이름 · 열 {title, ord, cols} (6판), pc (보낸 PC 이름), sheet (보낸 뒤 시트 갱신까지 ms, 20000 · -1 = 끔), sheetLag (다른 PC 대신 갱신하기 전 기다림 ms, 60000),
 *      sheetRetry (시트 갱신이 실패한 뒤 처음 기다림 ms, 60000 — 두 배씩 30분까지), known(표) → 이 ERP 가 아는 표인지 (기본: layout 이 있으면) }
 */
function create(o) {
  const dir = o.dataDir, store = o.store, doFetch = o.fetch || global.fetch, urlOk = o.urlOk || (() => true);
  const tdir = path.join(dir, 'tables'), bdir = path.join(dir, 'cloud'), stFile = path.join(dir, 'cloud.json');
  const EVERY = o.every || 30000, POKE = o.poke === undefined ? 3000 : o.poke;
  const layout = o.layout || (() => null), PC = String(o.pc || '').slice(0, 60), known = o.known || ((n) => !!layout(n));
  const SHEET = o.sheet === undefined ? 20000 : o.sheet, SHEET_LAG = o.sheetLag === undefined ? 60000 : o.sheetLag, SHEET_RETRY = o.sheetRetry === undefined ? 60000 : o.sheetRetry;
  const atomic = (file, data) => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); };
  // st (cloud.json): on · cid (구글 저장소 이름표) · mode · since · lastOk/Got/Sent · t[표] = {cv 구글 번호, lv 이 PC 번호} · m = 설정의 {cv, lv}
  //   sheet = 그 Apps Script 의 구글 시트 {url, name} (false = 시트 없이 만든 스크립트, null = 아직 모름) · sheetAt = 이 PC 가 마지막으로 시트를 갱신한 시각
  const blank = () => ({ on: false, cid: null, mode: null, since: null, lastOk: null, lastGot: null, lastSent: null, t: {}, m: null, sheet: null, sheetAt: null });
  let st = blank();
  try { st = Object.assign(blank(), JSON.parse(fs.readFileSync(stFile, 'utf8'))); st.t = st.t || {}; } catch (e) { /* 처음 */ }
  const saveState = () => atomic(stFile, JSON.stringify(st));
  const run = { busy: false, at: null, ok: null, code: null, error: null, conflicts: 0, shrink: [], log: [] };
  // 구글 시트 갱신 (6판): ver = 구글 Apps Script 판 (cloud_info), lag = 시트가 뒤처진 표, errs = 시트에 쓰지 못한 표 {표: 오류}
  const sh = { ver: null, busy: false, timer: null, due: 0, all: false, again: false, next: 0, fails: 0, code: null, error: null, lag: [], errs: {}, wrote: [] };
  let timer = null, pokeT = null, failN = 0, nextAt = 0, queued = null, chain = Promise.resolve(), stopped = false;
  /** 기록 (화면이 글자로 바꿈): k = on · off · got · sent · conf · err · shrink · lost · sheeterr */
  const note = (k, x) => { run.log.push({ at: new Date().toISOString(), k, x: x === undefined ? null : x }); if (run.log.length > 40) run.log.splice(0, run.log.length - 40); if (o.log) o.log(k + ' ' + JSON.stringify(x)); };
  const exclusive = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

  const localNames = () => { try { return fs.readdirSync(tdir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(n => NAME_RE.test(n) && n !== META); } catch (e) { return []; } };
  /** 이 PC 의 표 (없으면 []). 읽을 수 없는 파일은 빈 표로 보지 않는다 — 예외로 이번 판을 멈춤 (구글 자료를 지우지 않게) */
  const readLocal = (n) => {
    const f = path.join(tdir, n + '.json'); if (!fs.existsSync(f)) return [];
    let v; try { v = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw fail('LOCAL', n + ': ' + e.message); }
    return ensureIds(rowsOf(v));
  };
  const readBase = (n) => { try { return new Map(Object.entries(JSON.parse(fs.readFileSync(path.join(bdir, n + '.json'), 'utf8')))); } catch (e) { return new Map(); } };
  const writeBase = (n, m) => { fs.mkdirSync(bdir, { recursive: true }); atomic(path.join(bdir, n + '.json'), JSON.stringify(Object.fromEntries(m))); };
  const clearBases = () => { try { fs.rmSync(bdir, { recursive: true, force: true }); } catch (e) { /* 없음 */ } };

  /** 이 PC 자료 복사 (<data>/cloud_backup/<시각>_<이유>/) — 최근 20개 */
  function backupFiles(reason, names) {
    const root = path.join(dir, 'cloud_backup'), d = path.join(root, stamp() + '_' + reason);
    fs.mkdirSync(path.join(d, 'tables'), { recursive: true });
    for (const n of names || localNames()) { const f = path.join(tdir, n + '.json'); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(d, 'tables', n + '.json')); }
    for (const f of ['meta.json', 'versions.json']) { const p = path.join(dir, f); if (fs.existsSync(p)) fs.copyFileSync(p, path.join(d, f)); }
    try { const all = fs.readdirSync(root).sort(); while (all.length > 20) fs.rmSync(path.join(root, all.shift()), { recursive: true, force: true }); } catch (e) { /* 지우기 실패는 넘어감 */ }
    return d;
  }
  /** 이 PC 의 표를 쓴다. 절반 아래로 줄면 (100행 이상) 먼저 복사해 둔다 */
  function writeLocal(n, before, rows) {
    if (before.length >= 100 && rows.length < before.length / 2) {
      const d = backupFiles('shrink_' + n, [n]);
      run.shrink.push({ at: new Date().toISOString(), table: n, from: before.length, to: rows.length, dir: d }); if (run.shrink.length > 10) run.shrink.shift();
      note('shrink', { n, from: before.length, to: rows.length, dir: d });
    }
    return store.writeTable(n, rows);
  }

  // ---- 구글 웹 앱 부르기
  async function call(cfg, body, ms) {
    let r;
    try {
      r = await doFetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: AbortSignal.timeout(ms || 120000),
        body: JSON.stringify(Object.assign({ token: cfg.token }, body)) });
    } catch (e) { throw fail('NET', e && e.name === 'TimeoutError' ? 'timeout' : String((e && e.message) || e)); }
    let text = ''; try { text = await r.text(); } catch (e) { throw fail('NET', String((e && e.message) || e)); }
    let j = null; try { j = JSON.parse(text); } catch (e) { /* 구글 로그인 화면 등 */ }
    if (!j || typeof j !== 'object') throw fail(r.status === 404 ? 'NOT_FOUND' : 'NOT_JSON', 'HTTP ' + r.status);
    if (!j.ok) throw fail(j.error === 'bad token' ? 'BAD_TOKEN' : j.error === 'unknown action' ? 'OLD_SCRIPT' : 'GAS', String(j.error || 'error'));
    return j;
  }
  const cfgOf = (url, token) => {
    url = String(url || '').trim(); token = String(token || '').trim();
    if (!url || !urlOk(url)) throw fail('BAD_URL'); if (!TOKEN_RE.test(token)) throw fail('NO_TOKEN');
    return { url, token };
  };
  const cfgNow = () => { const m = store.readMeta(); const c = { url: String(m.gUrl || ''), token: String(m.gToken || '') }; if (!c.url || !urlOk(c.url)) throw fail('BAD_URL'); if (!c.token) throw fail('NO_TOKEN'); return c; };
  const saveUrl = (cfg) => { const m = store.readMeta(); if (m.gUrl === cfg.url && m.gToken === cfg.token) return; m.gUrl = cfg.url; m.gToken = cfg.token; store.writeMeta(m); };

  /** 구글에서 표 받기 (크기별로 나눠서). 반환: {표: {v, rows}} · 설정은 {v, obj} */
  async function fetchTables(cfg, names, ct) {
    const out = {}; let group = [], size = 0;
    const flush = async () => {
      if (!group.length) return;
      const j = await call(cfg, { action: 'cloud_get', names: group }, 300000);
      for (const n of group) {
        const x = (j.tables || {})[n]; if (!x || !x.v) continue;   // 그 사이 없어짐
        const val = JSON.parse((await gunzip(Buffer.from(String(x.b64 || ''), 'base64'))).toString('utf8'));
        out[n] = n === META ? { v: x.v, obj: sharedMeta(val && typeof val === 'object' && !Array.isArray(val) ? val : {}) } : { v: x.v, rows: ensureIds(rowsOf(val)) };
      }
      group = []; size = 0;
    };
    for (const n of names) { const s = (ct[n] && Number(ct[n].s)) || 0; if (group.length && size + s > BATCH) await flush(); group.push(n); size += s; }
    await flush();
    return out;
  }
  /** 구글에 보내기. items: {n, base, rows | obj, lv, newBase}. 받아들인 표는 기준 · 번호를 바꾼다. 반환: {sent, retry} (retry = 다른 PC 가 먼저 씀) */
  async function pushAll(cfg, items) {
    const res = { sent: [], retry: false };
    let batch = { tables: {}, items: [], size: 0 };
    const send = async () => {
      if (!batch.items.length) return;
      const j = await call(cfg, { action: 'cloud_put', tables: batch.tables, pc: PC }, 300000);
      for (const x of batch.items) {
        const nv = j.vers && j.vers[x.n];
        if (nv === undefined) { res.retry = true; continue; }
        if (x.n === META) st.m = { cv: nv, lv: x.lv }; else st.t[x.n] = { cv: nv, lv: x.lv };
        writeBase(x.n, x.newBase); res.sent.push(x.n);
      }
      saveState();
      batch = { tables: {}, items: [], size: 0 };
    };
    for (const x of items) {
      const b64 = (await gzip(Buffer.from(JSON.stringify(x.n === META ? x.obj : x.rows), 'utf8'))).toString('base64');
      if (batch.items.length && batch.size + b64.length > BATCH) await send();
      const lay = x.n === META ? null : layout(x.n);   // 6판: 구글 시트 탭 이름 · 열 (화면과 같은 한국어)
      batch.tables[x.n] = { base: x.base, b64, n: x.n === META ? Object.keys(x.obj).length : x.rows.length, sheet: lay || undefined };
      batch.items.push(x); batch.size += b64.length;
    }
    await send();
    return res;
  }

  /** 한 판: 바뀐 표 받기 → 합치기 · 이 PC 에 쓰기 → 보내기 */
  async function round1(cfg, info, out) {
    const ct = info.tables || {}; const v = store.versions();
    const names = Array.from(new Set(localNames().concat(Object.keys(ct).filter(n => n !== META && NAME_RE.test(n)))));
    const want = [], check = [];
    const lost = (n) => !!st.t[n] && !fs.existsSync(path.join(tdir, n + '.json')) && readBase(n).size > 0;   // 맞춘 적 있는 표의 파일이 없어짐
    for (const n of names) {
      const s = st.t[n], R = ct[n] ? Number(ct[n].v) || 0 : 0, L = v.t[n] || 0;
      if (R && (!s || R !== s.cv || lost(n))) want.push(n);   // 구글이 바뀜 (또는 처음 보는 표 · 이 PC 파일이 없어짐)
      else if (!s || L !== s.lv) check.push(n);            // 이 PC 만 바뀜
    }
    const mR = ct[META] ? Number(ct[META].v) || 0 : 0;
    const mWant = !!mR && (!st.m || mR !== st.m.cv), mCheck = !st.m || (v.meta || 0) !== st.m.lv;
    if (!want.length && !check.length && !mWant && !mCheck) return { retry: false };
    const remote = await fetchTables(cfg, want.concat(mWant ? [META] : []), ct);
    // ---- 여기서부터 보내기 전까지 await 없음: 이 PC 의 표를 읽고 · 합치고 · 쓴다
    const push = [];
    for (const n of want.concat(check)) {
      const rem = remote[n], s = st.t[n], base = s ? readBase(n) : new Map();
      if (s && base.size && !fs.existsSync(path.join(tdir, n + '.json'))) {   // 파일이 없어짐 → "다 지움" 으로 보지 않고 구글 자료로 되살린다
        if (!rem) continue;
        const lv = store.writeTable(n, rem.rows); st.t[n] = { cv: rem.v, lv }; writeBase(n, sigMap(rem.rows)); out.got.add(n); note('lost', { n, rows: rem.rows.length }); continue;
      }
      const local = readLocal(n);
      let rows = local;
      if (rem) { const m = merge3(base, local, rem.rows); rows = m.rows; out.conflicts += m.conflicts; }
      let lv = store.ver(n);
      if (!sameRows(rows, local)) { lv = writeLocal(n, local, rows); out.got.add(n); }
      const R = rem ? rem.v : (ct[n] ? Number(ct[n].v) || 0 : 0);
      const need = rem ? !sameRows(rows, rem.rows) : (s ? !sameAsBase(rows, base) : rows.length > 0);
      if (need) push.push({ n, base: R, rows, lv, newBase: sigMap(rows) });
      else { st.t[n] = { cv: R, lv }; writeBase(n, sigMap(rows)); }
    }
    if (mWant || mCheck) {
      const rem = remote[META], base = st.m ? readBase(META) : new Map();
      const lm = store.readMeta(), ls = sharedMeta(lm);
      let merged = ls;
      if (rem) { const m = mergeMeta(base, ls, rem.obj); merged = m.meta; out.conflicts += m.conflicts; }
      let lv = store.versions().meta || 0;
      if (!sameObj(merged, ls)) { lv = store.writeMeta(Object.assign(localMeta(lm), merged)); out.got.add(META); }
      const R = rem ? rem.v : mR;
      const need = rem ? !sameObj(merged, rem.obj) : (st.m ? !sameObjBase(merged, base) : Object.keys(merged).length > 0);
      if (need) push.push({ n: META, base: R, obj: merged, lv, newBase: metaBase(merged) });
      else { st.m = { cv: R, lv }; writeBase(META, metaBase(merged)); }
    }
    saveState();
    const r = await pushAll(cfg, push);
    r.sent.forEach(n => out.sent.add(n));
    return { retry: r.retry };
  }
  async function cycle() {
    const cfg = cfgNow(); const out = { got: new Set(), sent: new Set(), conflicts: 0, info: null };
    let info = await call(cfg, { action: 'cloud_info' }, 60000);
    for (let round = 0; ; round++) {
      if (info.cid !== st.cid) throw fail('CID');
      out.info = info;
      const r = await round1(cfg, info, out);
      if (!r.retry) break;
      if (round >= 3) throw fail('BUSY', 'conflicts');
      info = await call(cfg, { action: 'cloud_info' }, 60000);
    }
    return out;
  }
  async function runCycle() {
    if (!st.on || stopped) return;
    run.busy = true; run.at = new Date().toISOString(); clearTimeout(timer);
    try {
      const r = await cycle(); const at = new Date().toISOString();
      run.ok = true; run.code = null; run.error = null; failN = 0; st.lastOk = at;
      if (r.got.size) { st.lastGot = at; note('got', Array.from(r.got)); }
      if (r.sent.size) { st.lastSent = at; note('sent', Array.from(r.sent)); }
      if (r.conflicts) { run.conflicts += r.conflicts; note('conf', r.conflicts); }
      saveState();
      try { sheetAfter(r.info, Array.from(r.sent)); } catch (e) { /* 시트 갱신은 자료 공유와 따로 — 공유 오류로 보이지 않게 */ }
    } catch (e) {
      const code = e.code || 'ERR', last = run.log[run.log.length - 1];
      run.ok = false; run.code = code; run.error = e.detail || String((e && e.message) || e); failN++;
      if (!last || last.k !== 'err' || last.x.code !== code) note('err', { code, detail: run.error });
    } finally {
      run.busy = false;
      if (st.on && !stopped) schedule(failN ? Math.min(300000, EVERY * Math.pow(2, Math.min(failN, 8))) : EVERY);
    }
  }
  function schedule(ms) {
    clearTimeout(timer); if (stopped) return;
    nextAt = Date.now() + ms; timer = setTimeout(() => { syncNow().catch(() => {}); }, ms); if (timer.unref) timer.unref();
  }
  /** 지금 맞춘다 (이미 도는 중이면 끝난 뒤 한 번 더). 반환: 상태 */
  function syncNow() {
    if (!st.on || stopped) return Promise.resolve(status());
    if (!queued) queued = exclusive(async () => { queued = null; await runCycle(); });
    return queued.then(() => status());
  }
  /** 이 PC 에서 저장했다 → 3초 뒤 맞춘다 (그 사이 또 저장하면 다시 3초) */
  function poke() {
    if (!st.on || stopped || POKE < 0) return;
    clearTimeout(pokeT); pokeT = setTimeout(() => { pokeT = null; syncNow().catch(() => {}); }, POKE); if (pokeT.unref) pokeT.unref();
  }
  // ---- 6판: 구글 시트 갱신 (cloud_sheet) — 주고받기와 따로 (exclusive 밖)
  const sheetOk = () => st.on && !stopped && SHEET >= 0 && st.sheet !== false && Number(sh.ver) >= 6;
  /** 판이 끝난 뒤: 구글의 판 · 시트가 뒤처진 표 (cloud_info) 를 보고, 이 PC 가 보낸 표가 있으면 모아서 갱신 · 오래 뒤처진 표가 있으면 (다른 PC 가 못 함) 대신 갱신 */
  function sheetAfter(info, sent) {
    sh.ver = Number(info && info.ver) || 0;
    const t = (info && info.tables) || {}, now = Date.now(); let old = false;
    if (info && info.sheet && st.sheet !== false && (!st.sheet || st.sheet.url !== info.sheet)) {   // 시트 주소 (1.13.1 까지 연결한 PC 는 이름 없이)
      st.sheet = { url: String(info.sheet), name: (st.sheet && st.sheet.name) || '' }; saveState();
    }
    if (sh.ver < 6) { sh.lag = []; sh.errs = {}; }
    else if (!sh.busy) {                                    // 갱신 중이면 그 결과가 더 새롭다
      const lag = [], errs = {};
      Object.keys(t).forEach(n => {
        const x = t[n] || {}; if (n === META || x.sv === undefined) return;
        const v = Number(x.v) || 0; if (Number(x.sv) >= v) return;
        if (Number(x.se) === v) errs[n] = String(x.sm || ''); else { lag.push(n); if (now - (Date.parse(x.at) || 0) >= SHEET_LAG) old = true; }
      });
      sh.lag = lag; sh.errs = errs;
    }
    const mine = sent.filter(n => n !== META);
    if (mine.length && sh.ver >= 6) sh.lag = Array.from(new Set(sh.lag.concat(mine)));
    if (!sheetOk()) return;
    if (mine.length) sheetLater(SHEET); else if (old) sheetLater(0);
  }
  /** ms 뒤 갱신 (이미 그보다 먼저 예약돼 있으면 그때 한꺼번에 — 잇따라 저장해도 ms 마다 한 번). 실패한 뒤에는 기다림 (모두 다시 쓰기는 바로) */
  function sheetLater(ms, all) {
    if (all) sh.all = true;
    if (sh.busy) { sh.again = true; return; }
    let wait = Math.max(0, ms); if (!all && sh.next > Date.now()) wait = Math.max(wait, sh.next - Date.now());
    const due = Date.now() + wait;
    if (sh.timer && sh.due <= due) return;
    clearTimeout(sh.timer); sh.due = due;
    sh.timer = setTimeout(() => { sh.timer = null; sheetRun().catch(() => {}); }, wait); if (sh.timer.unref) sh.timer.unref();
  }
  async function sheetRun() {
    if (sh.busy) return;
    if (!sheetOk()) { sh.all = false; return; }
    sh.busy = true; let later = 0, all = false, failed = false;
    try {
      for (let i = 0; i < 8; i++) {                        // more = Apps Script 한 번 실행 시간 (6분) 안에 다 못 씀 → 이어서
        all = sh.all; sh.all = false;
        const j = await call(cfgNow(), { action: 'cloud_sheet', all }, 330000);
        if (j.sheet === false) { st.sheet = false; sh.lag = []; sh.errs = {}; saveState(); break; }
        st.sheet = { url: String(j.url || ''), name: String(j.name || '') };
        if (j.busy) { later = 20000; if (all) sh.all = true; saveState(); break; }   // 다른 PC 의 갱신이 도는 중 → 조금 뒤
        st.sheetAt = new Date().toISOString(); saveState();
        sh.lag = Array.isArray(j.lag) ? j.lag.map(String) : []; sh.errs = j.errs && typeof j.errs === 'object' ? j.errs : {}; sh.wrote = (j.written || []).map(String);
        if (!j.more) break;
      }
      sh.code = null; sh.error = null; sh.fails = 0; sh.next = 0;
    } catch (e) {
      failed = true; if (all) sh.all = true;               // 1.13.3: [구글 시트 다시 쓰기] 가 닿지 못함 → 요청을 남겨 두고, 기다린 뒤 다시
      sh.code = e.code || 'ERR'; sh.error = e.detail || String((e && e.message) || e); sh.fails++;
      sh.next = Date.now() + Math.min(1800000, SHEET_RETRY * Math.pow(2, Math.min(sh.fails - 1, 5)));   // 1분 · 2분 … 30분 뒤 (그동안 자료 공유는 그대로)
      if (sh.code === 'OLD_SCRIPT') { sh.ver = 5; sh.lag = []; sh.errs = {}; sh.all = false; }
      const last = run.log[run.log.length - 1];
      if (!last || last.k !== 'sheeterr' || last.x.code !== sh.code) note('sheeterr', { code: sh.code, detail: sh.error });
    } finally {
      sh.busy = false;
      if (later) sheetLater(later);
      else if (sh.again) { sh.again = false; sheetLater(sh.all ? 0 : SHEET, sh.all); }
      else if (failed && sh.all) sheetLater(0);            // 기다림 (sh.next) 뒤 모두 다시 쓰기
    }
  }
  /** [구글 시트 다시 쓰기] — 시작만 하고 바로 돌아온다 (화면은 상태를 다시 물어 진행을 본다) */
  async function sheetNow(all) {
    if (!st.on) throw fail('OFF');
    if (st.sheet === false) throw fail('NO_SHEET');
    if (sh.ver === null) { const info = await call(cfgNow(), { action: 'cloud_info' }, 60000); sh.ver = Number(info.ver) || 0; }   // 아직 한 판도 돌지 않음
    if (Number(sh.ver) < 6) throw fail('OLD_SCRIPT', 'ver ' + sh.ver);
    sh.next = 0; sheetLater(0, all !== false);
    return status();
  }
  function sheetStatus() {
    const g = st.sheet;
    return { has: g === false ? false : g ? true : null, url: g ? g.url : '', name: g ? g.name : '', ver: sh.ver, on: sheetOk(), busy: sh.busy, queued: !!sh.timer,
      at: st.sheetAt, code: sh.code, error: sh.error, lag: sh.lag.slice(), errs: Object.assign({}, sh.errs), wrote: sh.wrote.slice() };
  }

  /** 아직 구글에 보내지 않은 이 PC 의 변경이 있는가 */
  function pending() {
    if (!st.on) return false;
    const v = store.versions();
    if (!st.m || (v.meta || 0) !== st.m.lv) return true;
    return localNames().some(n => !st.t[n] || st.t[n].lv !== (v.t[n] || 0));
  }

  // ---- 처음 연결
  async function doUpload(cfg, ct, res, mode) {
    const v = store.versions(); const items = []; const have = localNames();
    for (const n of have) {
      const rows = readLocal(n);
      if (!rows.length && !ct[n]) { st.t[n] = { cv: 0, lv: v.t[n] || 0 }; writeBase(n, new Map()); continue; }   // 빈 표는 올리지 않음
      items.push({ n, base: ct[n] ? Number(ct[n].v) || 0 : 0, rows, lv: v.t[n] || 0, newBase: sigMap(rows) }); res.tables++; res.rows += rows.length;
    }
    // 1.13.3 덮어쓰기: 구글에만 있는 표 = 이 PC 에서는 빈 표 → 구글도 비운다 (그대로 두면 다음 판에 이 PC 로 내려옴). 이 ERP 가 모르는 표 (새 판 ERP 의 표) 는 그대로
    if (mode === 'overwrite') {
      for (const n of Object.keys(ct)) {
        if (n === META || have.includes(n) || !NAME_RE.test(n) || !known(n)) continue;
        items.push({ n, base: Number(ct[n].v) || 0, rows: [], lv: v.t[n] || 0, newBase: new Map() }); res.tables++;
      }
    }
    const ms = sharedMeta(store.readMeta());
    items.push({ n: META, base: ct[META] ? Number(ct[META].v) || 0 : 0, obj: ms, lv: v.meta || 0, newBase: metaBase(ms) });
    if ((await pushAll(cfg, items)).retry) throw fail('BUSY');
  }
  async function doReplace(cfg, ct, res) {
    res.backup = backupFiles('replace');
    const remote = await fetchTables(cfg, Object.keys(ct), ct);
    // 여기서부터 await 없음: 구글에 있는 표는 구글 자료로, 구글에 없는 이 PC 의 표는 그대로 (고치면 올라감)
    for (const n of Object.keys(remote)) {
      if (n === META) continue;
      const rows = remote[n].rows, local = readLocal(n);
      const lv = sameRows(rows, local) ? store.ver(n) : store.writeTable(n, rows);
      st.t[n] = { cv: remote[n].v, lv }; writeBase(n, sigMap(rows)); res.tables++; res.rows += rows.length;
    }
    for (const n of localNames()) if (!st.t[n]) { st.t[n] = { cv: 0, lv: store.ver(n) }; writeBase(n, sigMap(readLocal(n))); }
    const lm = store.readMeta(), rm = remote[META] ? remote[META].obj : {};
    const lv = sameObj(sharedMeta(lm), rm) ? (store.versions().meta || 0) : store.writeMeta(Object.assign(localMeta(lm), rm));
    st.m = { cv: remote[META] ? remote[META].v : 0, lv }; writeBase(META, metaBase(rm));
  }
  async function doMerge(cfg, ct, nat, res) {
    res.backup = backupFiles('merge');
    const remote = await fetchTables(cfg, Object.keys(ct), ct);
    const items = [];
    for (const n of Array.from(new Set(localNames().concat(Object.keys(remote).filter(x => x !== META))))) {
      const local = readLocal(n), rem = remote[n];
      const m = mergeFirst(local, rem ? rem.rows : [], nat[n]);
      const lv = sameRows(m.rows, local) ? store.ver(n) : store.writeTable(n, m.rows);
      const R = rem ? rem.v : 0;
      if (m.added) { items.push({ n, base: R, rows: m.rows, lv, newBase: sigMap(m.rows) }); res.added += m.added; }
      else { st.t[n] = { cv: R, lv }; writeBase(n, sigMap(m.rows)); }
      res.tables++; res.rows += m.rows.length;
    }
    const lm = store.readMeta(), rm = remote[META] ? remote[META].obj : {};
    const merged = Object.assign(sharedMeta(lm), rm);   // 구글 값이 이기고, 이 PC 에만 있는 항목은 더한다
    const lv = sameObj(merged, sharedMeta(lm)) ? (store.versions().meta || 0) : store.writeMeta(Object.assign(localMeta(lm), merged));
    const R = remote[META] ? remote[META].v : 0;
    if (!sameObj(merged, rm)) items.push({ n: META, base: R, obj: merged, lv, newBase: metaBase(merged) });
    else { st.m = { cv: R, lv }; writeBase(META, metaBase(merged)); }
    if ((await pushAll(cfg, items)).retry) throw fail('BUSY');
  }
  function localSummary() {
    let tables = 0, rows = 0;
    for (const n of localNames()) { try { const r = readLocal(n); if (r.length) { tables++; rows += r.length; } } catch (e) { /* 깨진 파일은 세지 않음 */ } }
    return { tables, rows };
  }

  /** 연결 확인: 5판인지 · 구글에 자료가 있는지 · 다시 켤 수 있는지 */
  async function check(url, token) {
    const cfg = cfgOf(url, token);
    const p = await call(cfg, { action: 'ping' }, 60000);
    if (!(Number(p.ver) >= 5)) throw fail('OLD_SCRIPT', 'ver ' + p.ver);
    const info = await call(cfg, { action: 'cloud_info' }, 60000); const ct = info.tables || {};
    const names = Object.keys(ct).filter(n => n !== META);
    return { ok: true, ver: Number(p.ver), sheet: p.sheet || '', cid: info.cid, empty: !Object.keys(ct).length, tables: names.length,
      rows: names.reduce((a, n) => a + (Number(ct[n].n) || 0), 0), at: Object.keys(ct).map(n => ct[n].at || '').sort().pop() || null,
      resume: !!(st.cid && st.cid === info.cid && Object.keys(st.t).length), on: st.on, local: localSummary() };
  }
  /** 합치기 미리 보기: 표마다 더할 행 수 */
  async function preview(url, token, nat) {
    const cfg = cfgOf(url, token);
    const info = await call(cfg, { action: 'cloud_info' }, 60000); const ct = info.tables || {};
    const remote = await fetchTables(cfg, Object.keys(ct).filter(n => n !== META), ct);
    const add = {}; let total = 0;
    for (const n of new Set(localNames().concat(Object.keys(remote)))) {
      const m = mergeFirst(readLocal(n), remote[n] ? remote[n].rows : [], (nat || {})[n]);
      if (m.added) { add[n] = m.added; total += m.added; }
    }
    return { ok: true, add, total };
  }
  /** 연결 (o: {url, token, mode, nat}) — 끝나면 바로 한 판 맞추고 30초마다 */
  function connect(o2) {
    return exclusive(async () => {
      const cfg = cfgOf(o2.url, o2.token), mode = String(o2.mode || '');
      if (!MODES.includes(mode)) throw fail('BAD_MODE', mode);
      const p = await call(cfg, { action: 'ping' }, 60000); if (!(Number(p.ver) >= 5)) throw fail('OLD_SCRIPT', 'ver ' + p.ver);
      const info = await call(cfg, { action: 'cloud_info' }, 60000); const ct = info.tables || {}; const empty = !Object.keys(ct).length;
      if (mode === 'resume' && !(st.cid && st.cid === info.cid && Object.keys(st.t).length)) throw fail('NO_RESUME');
      if (mode === 'upload' && !empty) throw fail('NOT_EMPTY');
      if ((mode === 'replace' || mode === 'merge') && empty) throw fail('EMPTY');
      clearTimeout(timer); clearTimeout(pokeT);
      saveUrl(cfg);
      const res = { mode, tables: 0, rows: 0, added: 0, backup: null };
      if (mode !== 'resume') { st = Object.assign(blank(), { cid: info.cid }); clearBases(); }
      st.sheet = p.sheet ? { url: String(p.url || ''), name: String(p.sheet) } : false;   // 6판: 그 Apps Script 의 구글 시트 (없으면 시트 없이 만든 스크립트)
      sh.ver = Number(p.ver) || 0; sh.lag = []; sh.errs = {}; sh.code = null; sh.error = null; sh.fails = 0; sh.next = 0;
      saveState();
      if (mode === 'upload' || mode === 'overwrite') await doUpload(cfg, ct, res, mode);
      else if (mode === 'replace') await doReplace(cfg, ct, res);
      else if (mode === 'merge') await doMerge(cfg, ct, o2.nat || {}, res);
      const now = new Date().toISOString();
      st.on = true; if (mode !== 'resume' || !st.mode) st.mode = mode; if (mode !== 'resume' || !st.since) st.since = now;
      saveState(); run.code = null; run.error = null; failN = 0; stopped = false;
      note('on', { mode, tables: res.tables, rows: res.rows, added: res.added });
      await runCycle();
      if (sheetOk() && (mode === 'upload' || mode === 'overwrite')) sheetLater(Math.min(SHEET, 2000));   // 처음 올린 뒤에는 시트도 곧바로
      return Object.assign(res, { status: status() });
    });
  }
  function off() {
    return exclusive(async () => {
      st.on = false; saveState(); clearTimeout(timer); clearTimeout(pokeT); clearTimeout(sh.timer); sh.timer = null; nextAt = 0; note('off');
      return status();
    });
  }
  /** Apps Script 코드 (TOKEN 을 넣어서) */
  function code(token) {
    token = String(token || '').trim(); if (!TOKEN_RE.test(token)) throw fail('NO_TOKEN');
    const src = fs.readFileSync(o.codeFile, 'utf8'), line = "var TOKEN = 'CHANGE-ME';";
    if (src.indexOf(line) < 0) throw fail('GAS', 'Code.gs TOKEN line');
    return src.replace(line, "var TOKEN = '" + token + "';");
  }
  function status() {
    const m = store.readMeta();
    return { on: st.on, cid: st.cid, mode: st.mode, since: st.since, url: st.cid ? (m.gUrl || null) : null, busy: run.busy, at: run.at, ok: run.ok, code: run.code, error: run.error,
      lastOk: st.lastOk, lastGot: st.lastGot, lastSent: st.lastSent, conflicts: run.conflicts, shrink: run.shrink.slice(), log: run.log.slice(-30),
      every: EVERY, nextAt: st.on && nextAt ? new Date(nextAt).toISOString() : null, pending: pending(), tables: Object.keys(st.t).length, sheet: sheetStatus() };
  }
  return {
    status, check, preview, connect, off, code, syncNow, poke, pending, sheetNow,
    /** /api/versions 에 붙이는 짧은 상태 (화면 왼쪽 아래) */
    brief: () => ({ on: st.on, ok: run.ok, code: run.code, at: st.lastOk, mode: st.mode, busy: run.busy }),
    /** 서버가 켜질 때: 켜져 있으면 5초 뒤 첫 판 */
    start(first) { stopped = false; if (st.on) schedule(first === undefined ? 5000 : first); },
    stop() { stopped = true; clearTimeout(timer); clearTimeout(pokeT); clearTimeout(sh.timer); sh.timer = null; },
    /** ERP 를 끄기 전: 보낼 것이 있으면 맞춘다 (최대 ms) */
    async flush(ms) {
      if (!st.on || stopped || !pending()) return false;
      clearTimeout(pokeT);
      let t; await Promise.race([syncNow(), new Promise(r => { t = setTimeout(r, ms || 15000); })]); clearTimeout(t);
      return true;
    },
  };
}

module.exports = { create, merge3, mergeMeta, mergeFirst, LOCAL_META, META, hash };
