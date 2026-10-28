'use strict';
/* 18차(v1.13.0) 자동 시험: 여러 PC 자료 공유 — 구글 드라이브 (cloudsync.js · google/Code.gs 5판 · 화면 app/js/cloud.js)
   사용자: "이거 직원한테줘서 직원이 입력하고 자료입력한게 업데이트 되야하는데 되지가않아 ... 구글시트.드라이브 연동해야돼 만들어줘.
           그리고 앱스크립트 주소만들어주고 핸드폰에서 웹앱으로 볼수있게 해줘"
   가짜 구글: 실제 google/Code.gs (ERP 가 TOKEN 을 넣어 준 코드) 를 Node vm 에서 돌리는 웹 서버 — Apps Script 처럼 POST → 302 → GET 으로 결과.
              드라이브 파일 · 스크립트 속성 · 잠금은 메모리, setContent 는 10MB 까지.
   1 Code.gs 5판 · 2 합치기 규칙 · 3 연결 (코드 · 올리기 · 직원 PC 는 구글 자료로) · 4 주고받기 (더하기 · 고치기 · 지우기 · 같은 행 · 설정 · 새 표)
   5 다른 PC 가 먼저 올림 · 저장 뒤 저절로 · 30초마다 · 끄기 전 보내기 · 끄고 다시 켜기 · 6 오류 (인터넷 · 키 · 옛 코드 · 다른 저장소 · 로그인 화면 · 깨진 파일)
   7 안전 (많이 지우면 백업 · 이 PC 만 연결 · 처음 합치기 · 덮어쓰기) · 8 화면 (사장님 PC → 직원 PC, 입력이 서로 보임, 베트남어, 휴대폰 폭)
   10 (1.13.2, Code.gs 6판) 구글 시트 = 공유 자료 보기: 가짜 구글 시트 (탭 · 칸 · 서식 · 보호 — General 칸의 글자는 숫자 · 날짜로, '=' 는 수식으로 바뀌는 것까지)
      표마다 탭 · 화면과 같은 이름 · 머리글 · 저장은 시트를 기다리지 않음 · 모아서 갱신 · 다른 PC 대신 · 오류 표 · 모두 다시 쓰기 · 시간 예산 · 5판 · 시트 없는 스크립트 · 화면
   11 (1.13.3) 코드 검토에서 찾은 문제: 구글 비밀 키는 사내망의 다른 PC 브라우저에 보내지 않음 · 덮어쓰기는 구글에만 있는 표도 · 휴대폰 보기 잠금이 기억한 휴대폰은 막지 않음
      · 속성 9KB 한도 (바이트) · 긴 탭 이름 · "(ERP 2)" · 끊긴 동안 누른 [구글 시트 다시 쓰기] 를 잃지 않음
   12 (1.13.4) 정리: 행 합치기 코드는 app/js/merge.js 하나 (화면 · 서버 같은 결과, 같은 _id 두 행) · 서버 오류 글에 한국어 · 베트남어 · 저장마다 폴더를 훑지 않음
   사용:  npm run test:v18   (Playwright 필요: npm i -D playwright 또는 playwright-core + 설치된 Chrome/Edge) */
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), crypto = require('crypto'), zlib = require('zlib'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pw; try { pw = require('playwright'); } catch (e) { try { pw = require('playwright-core'); } catch (e2) { console.error('Playwright가 필요합니다 / cần Playwright:  npm i -D playwright'); process.exit(2); } }
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
const serverMod = require(path.join(ROOT, 'server.js'));
const CS = require(path.join(ROOT, 'cloudsync.js'));

let pass = 0, fail = 0; const failures = [];
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 700 ? s.slice(0, 700) + '…' : s; };
function ok(name, cond, detail) { if (cond) { pass++; return true; } fail++; const line = name + (detail !== undefined ? '  → ' + short(detail) : ''); failures.push(line); console.log('  ✗ ' + line); return false; }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
async function sec(t, fn) { console.log('\n■ ' + t); try { await fn(); } catch (e) { ok(t + ' — 예외', false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); } }
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CODE_FILE = path.join(ROOT, 'google', 'Code.gs');
const TK = 'T18_' + crypto.randomBytes(12).toString('hex');           // ERP 가 만드는 비밀 키 모양 (16자 이상)
let port0 = 7800 + Math.floor(Math.random() * 250);
const nextPort = () => (port0 += 7);

function req(port, method, p, body, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const headers = Object.assign({}, o.headers || {});
    if (data !== null) headers['Content-Type'] = 'application/json';
    if (o.cookie) headers.Cookie = o.cookie;
    const r = http.request({ host: o.host || '127.0.0.1', port, method, path: p, headers, localAddress: o.localAddress }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    r.on('error', reject); if (data !== null) r.write(data); r.end();
  });
}

// ---------------------------------------------------------------- 가짜 구글 (Apps Script 웹 앱)
const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
/** 6판: 가짜 구글 시트 (스프레드시트 · 탭 · 칸 · 서식 · 보호). 서식 'General' 칸에 글자를 쓰면 구글처럼 숫자 · 날짜로 바뀌고, '=' 로 시작하면 수식, "'" 로 시작하면 글자 */
function fakeBook(opt) {
  let sid = 100;
  const book = { name: opt.sheetName || 'ERP 공유', url: 'https://sheet.example', sheets: [], active: null, writes: 0, failTab: null, onWrite: null };
  const conv = (v, f) => {
    if (typeof v !== 'string') return v;
    if (v.charAt(0) === "'") return v.slice(1);
    if (v.charAt(0) === '=') return { formula: v };
    if (f === '@') return v;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { date: v };
    return v;
  };
  function mkSheet(name) {
    const s = { id: ++sid, name, rows: 1000, cols: 26, vals: new Map(), fmt: new Map(), frozen: 0, prot: [], head: null };
    const K = (r, c) => r + ',' + c;
    const range = (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const R = {
        setNumberFormat(f) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.fmt.set(K(r + i, c + j), f); return R; },
        setValues(v) {
          if (!Array.isArray(v) || v.length !== nr || v.some(x => !Array.isArray(x) || x.length !== nc)) throw new Error('Exception: The number of rows or columns in the data does not match the range');
          if (r + nr - 1 > s.rows || c + nc - 1 > s.cols) throw new Error('Exception: Range out of bounds');
          if (book.failTab === s.name) throw new Error('Exception: This action would increase the number of cells in the workbook above the limit of 10000000 cells');
          for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { const x = conv(v[i][j], s.fmt.get(K(r + i, c + j))); if (x === '' || x === null || x === undefined) s.vals.delete(K(r + i, c + j)); else s.vals.set(K(r + i, c + j), x); }
          book.writes++; if (book.onWrite) book.onWrite(s);
          return R;
        },
        setFontWeight() { return R; }, setBackground() { return R; }, setFontSize() { return R; },
      };
      return R;
    };
    const last = (ax) => { let m = 0; s.vals.forEach((v, k) => { m = Math.max(m, Number(k.split(',')[ax])); }); return m; };
    Object.assign(s, {
      getName: () => s.name, setName(n) { s.name = n; return s; }, getSheetId: () => s.id, getIndex: () => book.sheets.indexOf(s) + 1,
      clear() { s.vals.clear(); s.fmt.clear(); return s; }, getMaxRows: () => s.rows, getMaxColumns: () => s.cols,
      insertRowsAfter(a, n) { s.rows += n; return s; }, insertColumnsAfter(a, n) { s.cols += n; return s; },
      deleteRows(st, n) { if (s.rows - n < s.frozen + 1) throw new Error("Exception: You can't delete all the rows on the sheet."); s.rows -= n; return s; },
      deleteColumns(st, n) { if (s.cols - n < 1) throw new Error("Exception: You can't delete all the columns on the sheet."); s.cols -= n; return s; },
      getRange: (r, c, nr, nc) => range(r, c, nr, nc), setFrozenRows(n) { s.frozen = n; return s; },
      getProtections: () => s.prot.slice(),
      protect() { const p = { desc: '', warn: false, setDescription(d) { p.desc = d; return p; }, setWarningOnly(w) { p.warn = !!w; return p; } }; s.prot.push(p); return p; },
      getLastRow: () => last(0), getLastColumn: () => last(1),
    });
    /** 시험용: 탭의 값 (1행부터, 빈칸 '') */
    s.table = () => { const out = []; for (let i = 1; i <= s.getLastRow(); i++) { const row = []; for (let j = 1; j <= s.getLastColumn(); j++) { const v = s.vals.get(K(i, j)); row.push(v === undefined ? '' : v); } out.push(row); } return out; };
    s.fmtOf = (r, c) => s.fmt.get(K(r, c));
    return s;
  }
  const ss = {
    getName: () => book.name, rename(n) { book.name = n; }, getUrl: () => book.url, getSpreadsheetTimeZone: () => 'Asia/Ho_Chi_Minh',
    getSheets: () => book.sheets.slice(), getSheetByName: (n) => book.sheets.find(x => x.name === n) || null, getNumSheets: () => book.sheets.length,
    insertSheet(name, idx) { if (book.sheets.some(x => x.name === name)) throw new Error('Exception: A sheet with the name "' + name + '" already exists.'); const s = mkSheet(name); book.sheets.splice(idx === undefined ? book.sheets.length : idx, 0, s); return s; },
    deleteSheet(s) { const i = book.sheets.indexOf(s); if (book.sheets.length < 2) throw new Error("Exception: You can't remove all the sheets in a document."); if (i >= 0) book.sheets.splice(i, 1); },
    setActiveSheet(s) { book.active = s; return s; },
    moveActiveSheet(pos) { const s = book.active; book.sheets.splice(book.sheets.indexOf(s), 1); book.sheets.splice(pos - 1, 0, s); },
  };
  book.sheets.push(mkSheet(opt.firstTab || '시트1'));
  book.tab = (name) => book.sheets.find(x => x.name === name) || null;
  book.names = () => book.sheets.map(x => x.name);
  return { ss, book };
}
/** Code.gs 를 vm 에서 — 드라이브 · 속성 · 잠금 · 캐시 · 유틸 · 시트는 메모리 */
function gasCtx(code, opt) {
  opt = opt || {};
  const props = new Map(), cache = new Map(), files = new Map(), folders = new Map(); let seq = 0;
  const stats = { setContent: 0, created: 0, locks: 0, propReads: 0, cacheFail: false, failName: null, docBusy: false, docLocks: 0 };
  const sheet = fakeBook(opt); const clock = { off: 0 };
  const propVal = (v) => { v = String(v); if (Buffer.byteLength(v, 'utf8') > 9216) throw new Error('Exception: Argument too large: value'); return v; };   // 속성 값 하나는 9KB 까지 (Apps Script 한도, 1.13.3)
  class GDate extends Date { static now() { return Date.now() + clock.off; } }   // 시험: 시트 쓰기 시간 예산 (Date.now 만 앞당김)
  const mkFile = (name, content, folder) => {
    if (stats.failName && String(name).indexOf(stats.failName + '.') === 0) throw new Error('Exception: Drive 오류 (시험)');
    const id = 'f' + (++seq) + crypto.randomBytes(3).toString('hex');
    const f = { id, name, content: String(content), trashed: false, folder, getId: () => id, getName: () => f.name, isTrashed: () => f.trashed, setTrashed(t) { f.trashed = !!t; return f; },
      setContent(c) { c = String(c); if (c.length > 10 * 1024 * 1024) throw new Error('Exception: setContent 10MB'); f.content = c; stats.setContent++; return f; },
      getBlob: () => ({ getDataAsString: () => f.content }), getUrl: () => 'https://drive.example/' + id };
    files.set(id, f); stats.created++; return f;
  };
  const mkFolder = (name) => {
    const fo = { name, getFilesByName: (n) => iter(Array.from(files.values()).filter(f => f.folder === fo && !f.trashed && f.name === n)), getFiles: () => iter(Array.from(files.values()).filter(f => f.folder === fo && !f.trashed)),
      createFile(a, b) { return typeof a === 'string' ? mkFile(a, b, fo) : mkFile(a.name, a.text !== undefined ? a.text : Buffer.from(a.bytes).toString('latin1'), fo); } };
    folders.set(name, fo); return fo;
  };
  const c = {
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput(s) { const o = { setMimeType: () => o, getContent: () => s }; return o; } },
    HtmlService: { XFrameOptionsMode: { DEFAULT: 'DEFAULT' }, createHtmlOutput(html) { const o = { meta: {}, setTitle(t) { o.title = t; return o; }, addMetaTag(k, v) { o.meta[k] = v; return o; }, setXFrameOptionsMode() { return o; }, getContent: () => html }; return o; } },
    SpreadsheetApp: { getActiveSpreadsheet: () => (opt.noSheet ? null : sheet.ss), ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' } },
    DriveApp: { getFoldersByName: (n) => iter(folders.has(n) ? [folders.get(n)] : []), createFolder: (n) => mkFolder(n),
      getFileById: (id) => { const f = files.get(id); if (!f) throw new Error('Exception: No item with the given ID could be found'); return f; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), getProperties: () => { stats.propReads++; return Object.fromEntries(props); },
      setProperty: (k, v) => { props.set(k, propVal(v)); }, setProperties: (o) => Object.keys(o).forEach(k => props.set(k, propVal(o[k]))), deleteProperty: (k) => props.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { stats.locks++; }, releaseLock: () => {} }),
      getDocumentLock: () => (opt.noSheet ? null : { tryLock: () => { stats.docLocks++; return !stats.docBusy; }, releaseLock: () => {} }),
      getUserLock: () => ({ tryLock: () => !stats.docBusy, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => { if (stats.cacheFail) throw new Error('Exception: cache (시험)'); cache.set(k, String(v)); }, remove: (k) => cache.delete(k) }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' }, getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      newBlob: (data, mime, name) => (typeof data === 'string' ? { name, text: data, getBytes: () => Array.from(Buffer.from(data, 'utf8')) } : { name, bytes: data, getBytes: () => data }),
      base64Decode: (b) => Array.from(Buffer.from(b, 'base64')), formatDate: () => '20261022_0000',
      ungzip: (blob) => { const buf = zlib.gunzipSync(Buffer.from(blob.getBytes())); return { getBytes: () => Array.from(buf), getDataAsString: () => buf.toString('utf8') }; } },
    Date: GDate,
  };
  vm.createContext(c); vm.runInContext(code, c);
  const post = (o) => JSON.parse(c.doPost({ postData: { contents: JSON.stringify(o) } }).getContent());
  return { c, props, cache, files, folders, stats, post, book: sheet.book, clock };
}
/** 웹 서버: POST /macros/s/<id>/exec → doPost → 302 → GET 결과 (Apps Script 와 같음). down · login · old · beforePut 으로 상황을 만든다 */
async function fakeGoogle(code, opt) {
  const G = { gas: gasCtx(code, opt), hits: [], down: false, login: false, old: false, beforePut: null };
  const outs = new Map(); let n = 0; const id = 'AKfy' + crypto.randomBytes(6).toString('hex');
  const readAll = (q) => new Promise(r => { const ch = []; q.on('data', d => ch.push(d)); q.on('end', () => r(Buffer.concat(ch).toString('utf8'))); });
  const srv = http.createServer(async (q, res) => {
    const body = await readAll(q);
    if (G.down) { q.socket.destroy(); return; }
    if (q.method === 'POST' && q.url === '/macros/s/' + id + '/exec') {
      if (G.login) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><title>Google 계정</title><p>로그인'); }
      let j = {}; try { j = JSON.parse(body); } catch (e) { /* 그대로 */ }
      G.hits.push(j.action);
      let out;
      if (G.old && /^cloud_/.test(j.action)) out = JSON.stringify({ ok: false, error: 'unknown action' });
      else if (G.old && j.action === 'ping') out = JSON.stringify({ ok: true, ver: 4, sheet: 'S', url: 'u' });
      else if (G.v5 && j.action === 'cloud_sheet') out = JSON.stringify({ ok: false, error: 'unknown action' });   // 5판으로 배포한 채
      else {
        if (j.action === 'cloud_put' && G.beforePut) { const f = G.beforePut; G.beforePut = null; f(j); }
        out = G.gas.c.doPost({ postData: { contents: body } }).getContent();
        if (G.v5 && (j.action === 'ping' || j.action === 'cloud_info')) {   // 5판의 답 모양 (번호 · 크기 · 행 수 · 시각만)
          const o = JSON.parse(out); o.ver = 5;
          if (j.action === 'cloud_info') { delete o.sheet; Object.keys(o.tables || {}).forEach(n => { const x = o.tables[n]; o.tables[n] = { v: x.v, s: x.s, n: x.n, at: x.at }; }); }
          out = JSON.stringify(o);
        }
      }
      const k = 'k' + (++n); outs.set(k, out);
      res.writeHead(302, { Location: '/macros/echo?user_content_key=' + k }); return res.end();
    }
    if (q.method === 'GET' && q.url.startsWith('/macros/echo?user_content_key=')) {
      const k = q.url.split('=')[1]; const t = outs.get(k); outs.delete(k);
      if (t === undefined) { res.writeHead(404); return res.end('gone'); }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(t);
    }
    res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<p>찾을 수 없음');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  G.url = 'http://127.0.0.1:' + srv.address().port + '/macros/s/' + id + '/exec';
  G.close = () => srv.close();
  /** 구글 쪽 표 (내용 풀기) */
  G.rows = (name) => { const p = G.gas.props.get('T_' + name); if (!p) return null; const x = JSON.parse(p); const f = G.gas.files.get(x.f); return JSON.parse(zlib.gunzipSync(Buffer.from(f.content, 'base64')).toString('utf8')); };
  G.ver = (name) => { const p = G.gas.props.get('T_' + name); return p ? JSON.parse(p).v : 0; };
  /** 다른 PC 처럼 구글에 바로 쓰기 */
  G.putRaw = (name, val) => G.gas.post({ token: TK, action: 'cloud_put', tables: { [name]: { base: G.ver(name), b64: zlib.gzipSync(JSON.stringify(val)).toString('base64'), n: Array.isArray(val) ? val.length : 0 } } });
  return G;
}

// ---------------------------------------------------------------- ERP 서버 (PC)
// cloudSheet: 저장 뒤 구글 시트 갱신까지 (ms, -1 = 끔 — 1 ~ 9장은 1.13.0 의 주고받기만 보므로 끔), cloudSheetLag: 다른 PC 대신 갱신하기 전 기다림
const startPc = (dataDir, o) => serverMod.start(Object.assign({ appDir: path.join(ROOT, 'app'), dataDir, host: '127.0.0.1', port: nextPort(), backupDelay: 3600000,
  googleHosts: /^127\.0\.0\.1$/, cloudEvery: 3600000, cloudPoke: -1, cloudFirst: 3600000, cloudSheet: -1 }, o || {}));
const putT = (S, n, rows) => req(S.port, 'PUT', '/api/t/' + n, rows);
const getT = async (S, n) => (await req(S.port, 'GET', '/api/t/' + n)).json.rows;
const metaOf = async (S) => (await req(S.port, 'GET', '/api/meta')).json.meta;
const patchMeta = (S, set, del) => req(S.port, 'PATCH', '/api/meta', { set: set || {}, del: del || [] });
const sync = async (S) => (await req(S.port, 'POST', '/api/cloud/sync', {})).json;
const capi = (S, p, body, o) => req(S.port, 'POST', '/api/cloud/' + p, body || {}, o);
const stat = async (S) => (await req(S.port, 'GET', '/api/cloud')).json;
const ids = (rows) => (rows || []).map(r => r._id).sort();
const byId = (rows, id) => (rows || []).find(r => r._id === id);
const strip = (rows) => JSON.stringify((rows || []).slice().sort((a, b) => String(a._id).localeCompare(String(b._id))));
const nat = () => { const o = {}; const T = { items: ['code'], po: ['po_no', 'item_no'], prod_log: [], warehouses: ['code'] }; Object.keys(T).forEach(n => { o[n] = { k: T[n], multi: n === 'po' }; }); return o; };

/** 사장님 PC 자료: 수주 · 생산 일보 · 품목 + 설정 (공유 · 이 PC 만) */
async function ownerData(S) {
  await putT(S, 'po', [{ _id: 'po1', po_no: 'P-1', item_no: 'IT-1', sets: 100, date: '2026-10-01' }, { _id: 'po2', po_no: 'P-2', item_no: 'IT-2', sets: 50, date: '2026-10-02' }, { _id: 'po3', po_no: 'P-3', item_no: 'IT-3', sets: 70, date: '2026-10-03' }]);
  const pl = []; for (let i = 1; i <= 120; i++) pl.push({ _id: 'pl' + i, date: '2026-10-' + String(1 + (i % 20)).padStart(2, '0'), process: 'ASM', ok_ea: i * 10 });
  await putT(S, 'prod_log', pl);
  await putT(S, 'items', [{ _id: 'it1', code: 'A-1', name: '빨강' }, { _id: 'it2', code: 'A-2', name: '파랑' }]);
  await putT(S, 'returns', []);
  await patchMeta(S, { seeded: '2026-10-01T00:00:00Z', v6: '2026-10-01T00:00:00Z', buyLead: 30, openDate: { WH: '2026-01-01' }, poKindsOff: ['X'], dash: [{ k: 'a', id: 'kpi_due', w: 1 }], aiName: '보성 비서', numFmt: 'dot' });
}

(async () => {
  const errors = [];
  const servers = [], googles = [];
  const keep = (x, list) => { list.push(x); return x; };

  // ------------------------------------------------------------------------------------------
  await sec('1. Code.gs 6판 (구글 쪽) — 5판 공유: 표마다 파일 · 저장 번호 · 충돌 · 이름표', async () => {
    const src = fs.readFileSync(CODE_FILE, 'utf8');
    ok('7판 머리글 (1.13.3) · 데이터 폴더 · TOKEN 한 줄 (ERP 가 채움)', /7판 \(v1\.13\.\d\)/.test(src) && /var DATA_FOLDER = 'ColorPencil ERP Data';/.test(src) && src.split("var TOKEN = 'CHANGE-ME';").length === 2);
    const raw = gasCtx(src);
    eq("'CHANGE-ME' 그대로 배포하면 아무 요청도 받지 않음", raw.post({ token: 'CHANGE-ME', action: 'ping' }).error, 'bad token');
    const G = gasCtx(src.replace("var TOKEN = 'CHANGE-ME';", "var TOKEN = '" + TK + "';"));
    eq('?ping=1 · ping → 7판', [JSON.parse(G.c.doGet({ parameter: { ping: '1' } }).getContent()).ver, G.post({ token: TK, action: 'ping' }).ver], [7, 7]);
    eq('틀린 키 → bad token', G.post({ token: TK + 'x', action: 'cloud_info' }).error, 'bad token');
    const i0 = G.post({ token: TK, action: 'cloud_info' }), i1 = G.post({ token: TK, action: 'cloud_info' });
    ok('빈 저장소: 표 없음 · 이름표(cid) 한 번 만들고 그대로', i0.ok && Object.keys(i0.tables).length === 0 && /^[0-9a-f-]{36}$/.test(i0.cid) && i1.cid === i0.cid && i0.ver === 7, { i0, i1 });
    const p1 = G.post({ token: TK, action: 'cloud_put', tables: { po: { base: 0, b64: 'AAA', n: 2 } } });
    const x1 = JSON.parse(G.props.get('T_po')); const f1 = G.files.get(x1.f);
    ok('올리기 → 번호 1 · 드라이브 "ColorPencil ERP Data/po.json.gz.b64" · 크기 · 행 수 · 시각', p1.ok && p1.vers.po === 1 && x1.v === 1 && x1.s === 3 && x1.n === 2 && x1.at && f1 && f1.name === 'po.json.gz.b64' && f1.content === 'AAA' && f1.folder === G.folders.get('ColorPencil ERP Data'), { p1, x1 });
    const p2 = G.post({ token: TK, action: 'cloud_put', tables: { po: { base: 0, b64: 'ZZZ' } } });
    ok('옛 번호(base)로 올리면 쓰지 않음 → conflicts (지금 번호)', p2.ok && p2.conflicts.po === 1 && !('po' in p2.vers) && G.files.get(x1.f).content === 'AAA', p2);
    const p3 = G.post({ token: TK, action: 'cloud_put', tables: { po: { base: 1, b64: 'BBB', n: 3 }, 'a/b': { base: 0, b64: 'x' } } });
    const x3 = JSON.parse(G.props.get('T_po'));
    ok('맞는 번호 → 같은 파일을 고쳐 씀 (번호 2) · 이상한 표 이름은 무시', p3.vers.po === 2 && x3.f === x1.f && G.files.get(x1.f).content === 'BBB' && !G.props.has('T_a/b') && G.stats.locks >= 2, { p3, x3, locks: G.stats.locks });
    const g = G.post({ token: TK, action: 'cloud_get', names: ['po', 'nope', '../x'] });
    eq('받기: 있는 표 · 없는 표 (번호 0) · 이상한 이름은 뺌', g.tables, { po: { v: 2, b64: 'BBB' }, nope: { v: 0, b64: '' } });
    const inf = G.post({ token: TK, action: 'cloud_info' });
    ok('cloud_info: 표마다 번호 · 크기 · 행 수 · 시각 (내용 없음)', inf.tables.po.v === 2 && inf.tables.po.s === 3 && inf.tables.po.n === 3 && inf.tables.po.at && !('f' in inf.tables.po) && !('b64' in inf.tables.po), inf.tables);
    const big = 'Q'.repeat(9500000);
    const p4 = G.post({ token: TK, action: 'cloud_put', tables: { po: { base: 2, b64: big } } }); const x4 = JSON.parse(G.props.get('T_po'));
    ok('10MB 가까운 표 → 새 파일로 쓰고 옛 파일은 휴지통 (setContent 는 10MB 까지)', p4.vers.po === 3 && x4.f !== x1.f && G.files.get(x1.f).trashed && G.files.get(x4.f).content.length === 9500000, { p4, f: x4.f });
    eq('큰 표 받기', G.post({ token: TK, action: 'cloud_get', names: ['po'] }).tables.po.b64.length, 9500000);
    G.files.get(x4.f).trashed = true;
    const p5 = G.post({ token: TK, action: 'cloud_put', tables: { po: { base: 3, b64: 'CCC' } } }); const x5 = JSON.parse(G.props.get('T_po'));
    ok('파일을 누가 휴지통에 버렸어도 새 파일로 씀', p5.vers.po === 4 && x5.f !== x4.f && G.files.get(x5.f).content === 'CCC', { p5 });
    // 시트 없이 만든 스크립트 (script.google.com 에서 바로)
    const SA = gasCtx(src.replace("var TOKEN = 'CHANGE-ME';", "var TOKEN = '" + TK + "';"), { noSheet: true });
    const sp = SA.post({ token: TK, action: 'ping' }), sl = SA.post({ token: TK, action: 'list' }), sc = SA.post({ token: TK, action: 'cloud_put', tables: { po: { base: 0, b64: 'A' } } });
    ok('시트 없는(독립형) 스크립트: ping · 공유는 됨, 시트 기능만 안내', sp.ok && sp.ver === 7 && sp.sheet === '' && sl.ok === false && /no spreadsheet/.test(sl.error) && sc.vers.po === 1, { sp, sl, sc });
    // 4판까지의 기능 그대로
    ok('휴대폰 보기 · 드라이브 백업 그대로 (4판 기능)', G.post({ token: TK, action: 'mobile_pw', pw: 'secret12' }).on === true && G.post({ token: TK, action: 'mobile', summary: JSON.stringify({ v: 1, kpi: {} }) }).ok
      && G.c.mobileData('secret12').ok && G.post({ token: TK, action: 'backup', name: 'ERP_backup_2026-10-22.json.gz', b64: Buffer.from('x').toString('base64') }).ok);
    const doc = G.c.doGet({ parameter: {} });
    ok('브라우저로 열면 휴대폰 화면 (5판에서도 그대로)', doc.title === 'ColorPencil ERP' && /google\.script\.run/.test(doc.getContent()));
    // 1.13.1: 번호 목록(cloud_info)은 캐시 — 직원 PC 여러 대가 30초마다 물어도 스크립트 속성 하루 한도(5만 번)를 쓰지 않음
    const K = gasCtx(src.replace("var TOKEN = 'CHANGE-ME';", "var TOKEN = '" + TK + "';"));
    K.post({ token: TK, action: 'cloud_put', tables: { po: { base: 0, b64: 'A1' } } });
    const r0 = K.stats.propReads; const infos = []; for (let i = 0; i < 20; i++) infos.push(K.post({ token: TK, action: 'cloud_info' }));
    ok('cloud_info 20번 → 스크립트 속성은 한 번도 읽지 않음 (쓸 때 맞춘 캐시) · 같은 이름표', K.stats.propReads === r0 && infos.every(x => x.ok && x.tables.po.v === 1 && x.cid === infos[0].cid), { reads: K.stats.propReads - r0 });
    K.post({ token: TK, action: 'cloud_put', tables: { po: { base: 1, b64: 'A2' } } });
    eq('쓰면 캐시도 바로 새 번호 (다른 PC 가 30초 안에 앎)', K.post({ token: TK, action: 'cloud_info' }).tables.po.v, 2);
    K.cache.clear(); const r1 = K.stats.propReads; const i2 = K.post({ token: TK, action: 'cloud_info' }); const i3 = K.post({ token: TK, action: 'cloud_info' });
    ok('캐시가 비면 (10분 지남) 잠금 안에서 속성을 한 번 읽고 다시 채움', i2.tables.po.v === 2 && i3.tables.po.v === 2 && K.stats.propReads === r1 + 1 && K.cache.has('CLOUD_IDX'), { reads: K.stats.propReads - r1 });
    K.stats.cacheFail = true; const q3 = K.post({ token: TK, action: 'cloud_put', tables: { po: { base: 2, b64: 'A3' } } }); K.stats.cacheFail = false;
    ok('캐시에 못 쓰면 지움 → 다음 물음은 속성에서 (새 번호)', q3.vers.po === 3 && !K.cache.has('CLOUD_IDX') && K.post({ token: TK, action: 'cloud_info' }).tables.po.v === 3);
    K.stats.failName = 'zz'; const q4 = K.post({ token: TK, action: 'cloud_put', tables: { aa: { base: 0, b64: 'X' }, zz: { base: 0, b64: 'Y' } } }); K.stats.failName = null;
    const i4 = K.post({ token: TK, action: 'cloud_info' });
    ok('여러 표를 쓰다 드라이브 오류로 멈춰도 캐시 = 속성 (쓴 표는 보이고, 못 쓴 표는 없음)', q4.ok === false && i4.tables.aa && i4.tables.aa.v === 1 && !i4.tables.zz && K.props.has('T_aa') && !K.props.has('T_zz'), { q4, t: i4.tables });
    eq('cloud_get 은 언제나 속성 (파일 id)', K.post({ token: TK, action: 'cloud_get', names: ['po'] }).tables.po, { v: 3, b64: 'A3' });
  });

  // ------------------------------------------------------------------------------------------
  await sec('2. 합치기 규칙 (cloudsync.js — 화면 db.js 와 같은 규칙)', async () => {
    const sig = (r) => CS.hash(JSON.stringify(r));
    const B = [{ _id: 'a', v: 1 }, { _id: 'b', v: 1 }, { _id: 'c', v: 1 }, { _id: 'd', v: 1 }, { _id: 'e', v: 1 }];
    const base = new Map(B.map(r => [r._id, sig(r)]));
    const local = [{ _id: 'a', v: 2 }, { _id: 'b', v: 1 }, { _id: 'd', v: 5 }, { _id: 'e', v: 7 }, { _id: 'n1', v: 1 }];           // a 고침 · c 지움 · d 고침 · e 고침 · n1 더함
    const remote = [{ _id: 'a', v: 1 }, { _id: 'b', v: 3 }, { _id: 'c', v: 1 }, { _id: 'e', v: 8 }, { _id: 'n2', v: 1 }];          // b 고침 · d 지움 · e 고침 · n2 더함
    const m = CS.merge3(base, local, remote);
    const got = {}; m.rows.forEach(r => { got[r._id] = r.v; });
    eq('한쪽만 고친 행 · 지운 행 · 더한 행 · 지움 대 고침(고친 행 남김) · 둘 다 고침(이 PC)', [got, m.conflicts], [{ a: 2, b: 3, e: 7, n2: 1, d: 5, n1: 1 }, 2]);
    eq('순서: 구글 순서 + 이 PC 에만 있는 행', m.rows.map(r => r._id), ['a', 'b', 'e', 'n2', 'd', 'n1']);
    const mm = CS.mergeMeta(new Map([['x', CS.hash('1')], ['y', CS.hash('1')], ['z', CS.hash('1')], ['w', CS.hash('1')]]), { x: 2, y: 1, w: 9, n: 1 }, { x: 1, y: 3, z: 1, w: 8, r: 1 });
    eq('설정: 항목별 (한쪽만 · 지움 · 둘 다 → 이 PC)', [mm.meta, mm.conflicts], [{ x: 2, y: 3, w: 9, n: 1, r: 1 }, 1]);
    const loc = ['gUrl', 'gToken', 'mobileOn', 'aiName', 'aiPrompt', 'dash', 'dashAsmMonthly', 'numFmt', 'mrpLines', 'cloudX'], sh = ['buyLead', 'procs', 'floorPivots', 'openDate', 'seeded', 'v6', 'poKindsOff', 'prodPost', 'buyHead', 'recipeSrc', 'sample'];
    ok('이 PC 에만 두는 설정 (구글 주소 · 키 · 휴대폰 켜짐 · AI 비서 · 배치 · 숫자 형식 · MRP 줄) / 나머지는 공유', loc.every(k => CS.LOCAL_META.test(k)) && sh.every(k => !CS.LOCAL_META.test(k)), loc.filter(k => !CS.LOCAL_META.test(k)).concat(sh.filter(k => CS.LOCAL_META.test(k))));
    const f = CS.mergeFirst(
      [{ _id: 'L1', code: 'A-1', name: '빨강' }, { _id: 'L2', code: 'A-9', name: '새 품목' }, { _id: 'L3', code: 'S', _ex: 1 }, { _id: 'c1', code: 'A-1', name: '같은 id' }],
      [{ _id: 'c1', code: 'A-1', name: '빨강 (구글)' }, { _id: 'c2', code: 'A-2', name: '파랑' }], { k: ['code'], multi: false });
    eq('처음 합치기: 구글 그대로 + 이 PC 에서만 입력한 행 (같은 코드 · 같은 id · 예시 행 뺌)', f.rows.map(r => r._id), ['c1', 'c2', 'L2']);
    const f2 = CS.mergeFirst([{ _id: 'L1', po_no: 'P', item_no: 'I', sets: 1 }, { _id: 'L2', po_no: 'P', item_no: 'I', sets: 2 }], [{ _id: 'c1', po_no: 'P', item_no: 'I', sets: 1 }], { k: ['po_no', 'item_no'], multi: true });
    eq('반복되는 표(PO 줄)는 내용이 같을 때만 같은 행', f2.rows.map(r => r._id), ['c1', 'L2']);
  });

  // ------------------------------------------------------------------------------------------
  let A = null, B = null, G = null, dA = null, dB = null;
  await sec('3. 연결 — 코드 복사(키) → 사장님 PC 자료 올리기 → 직원 PC 는 구글 자료로', async () => {
    dA = tmp('erp-v18-a-'); dB = tmp('erp-v18-b-');
    A = keep(await startPc(dA), servers); B = keep(await startPc(dB), servers);
    await ownerData(A);
    const c0 = await capi(A, 'code', { token: 'short' });
    eq('키가 짧으면 코드를 주지 않음', [c0.status, c0.json.code], [400, 'NO_TOKEN']);
    const c1 = await capi(A, 'code', { token: TK });
    const src = fs.readFileSync(CODE_FILE, 'utf8');
    ok('코드 = google/Code.gs 에 키만 넣은 것', c1.status === 200 && c1.json.code === src.replace("var TOKEN = 'CHANGE-ME';", "var TOKEN = '" + TK + "';") && !c1.json.code.includes("'CHANGE-ME';"), c1.status);
    G = keep(await fakeGoogle(c1.json.code), googles);          // 사용자가 이 코드를 Apps Script 에 붙여넣고 배포했다
    const bad = await capi(A, 'check', { url: 'https://example.com/macros/s/x/exec', token: TK });
    eq('Apps Script 주소가 아니면 거절', bad.json.code, 'BAD_URL');
    const wrong = await capi(A, 'check', { url: G.url, token: TK.replace('T18', 'X18') });
    eq('키가 다르면 BAD_TOKEN', wrong.json.code, 'BAD_TOKEN');
    const ck = await capi(A, 'check', { url: G.url, token: TK });
    ok('연결 확인: 7판 · 비어 있음 · 이 PC 자료 (표 · 행) · 다시 켤 것 없음', ck.status === 200 && ck.json.ver === 7 && ck.json.empty === true && ck.json.resume === false && ck.json.local.tables === 3 && ck.json.local.rows === 125 && ck.json.sheet === 'ERP 공유', ck.json);
    const nb = await capi(A, 'connect', { url: G.url, token: TK, mode: 'replace' });
    eq('빈 저장소에 "구글 자료로" 는 안 됨 (EMPTY)', nb.json.code, 'EMPTY');
    const up = await capi(A, 'connect', { url: G.url, token: TK, mode: 'upload' });
    ok('올리기 → 표 3개 · 125행 · 켜짐', up.status === 200 && up.json.tables === 3 && up.json.rows === 125 && up.json.status.on === true && up.json.status.mode === 'upload' && up.json.status.ok === true, up.json);
    eq('구글 쪽 = 이 PC 자료 (수주 · 생산 일보 · 품목, 빈 표는 올리지 않음)', [strip(G.rows('po')), strip(G.rows('prod_log')), strip(G.rows('items')), G.rows('returns')], [strip(await getT(A, 'po')), strip(await getT(A, 'prod_log')), strip(await getT(A, 'items')), null]);
    const gm = G.rows('__meta');
    ok('구글 쪽 설정 = 공유 항목만 (구글 주소 · 키 · 배치 · AI 비서 · 숫자 형식 없음)', gm && gm.buyLead === 30 && gm.seeded && JSON.stringify(gm.openDate) === '{"WH":"2026-01-01"}' && !('gUrl' in gm) && !('gToken' in gm) && !('dash' in gm) && !('aiName' in gm) && !('numFmt' in gm), gm);
    const ma = await metaOf(A);
    ok('이 PC 설정에 웹 앱 주소 · 키 저장', ma.gUrl === G.url && ma.gToken === TK);
    const again = await capi(A, 'connect', { url: G.url, token: TK, mode: 'upload' });
    eq('자료가 있는 저장소에 다시 "올리기" 는 안 됨 (NOT_EMPTY)', again.json.code, 'NOT_EMPTY');
    // 직원 PC: 자기 예시 자료 + 이 PC 만의 설정
    await putT(B, 'po', [{ _id: 'bx1', po_no: 'SAMPLE', item_no: 'S', _ex: 1 }]);
    await putT(B, 'items', [{ _id: 'bi1', code: 'A-1', name: '빨강' }]);
    await putT(B, 'semi_stock', [{ _id: 'ss1', code: 'X', qty: 1 }]);
    await patchMeta(B, { seeded: '2026-10-20T00:00:00Z', sample: { po: true }, buyLead: 10, dash: [{ k: 'b', id: 'flow', w: 2 }], aiName: '직원 비서', numFmt: 'comma' });
    const ckb = await capi(B, 'check', { url: G.url, token: TK });
    ok('직원 PC 연결 확인: 자료 있음 (표 3 · 125행)', ckb.json.empty === false && ckb.json.tables === 3 && ckb.json.rows === 125 && ckb.json.resume === false, ckb.json);
    const rp = await capi(B, 'connect', { url: G.url, token: TK, mode: 'replace' });
    ok('구글 자료로 시작 → 켜짐 · 백업 폴더', rp.status === 200 && rp.json.status.on === true && rp.json.mode === 'replace' && rp.json.backup && fs.existsSync(path.join(rp.json.backup, 'tables', 'po.json')), rp.json);
    eq('직원 PC 표 = 사장님 PC 표 (같은 _id)', [strip(await getT(B, 'po')), strip(await getT(B, 'prod_log')), strip(await getT(B, 'items'))], [strip(await getT(A, 'po')), strip(await getT(A, 'prod_log')), strip(await getT(A, 'items'))]);
    ok('바꾸기 전 직원 PC 자료는 백업에 (예시 수주)', JSON.parse(fs.readFileSync(path.join(rp.json.backup, 'tables', 'po.json'), 'utf8'))[0]._id === 'bx1');
    eq('구글에 없는 직원 PC 의 표는 그대로', (await getT(B, 'semi_stock')).length, 1);
    const mb = await metaOf(B);
    ok('설정: 공유 항목은 사장님 것 (buyLead 30 · sample 없음), 이 PC 항목은 그대로 (배치 · AI 비서 · 숫자 형식 · 주소 · 키)', mb.buyLead === 30 && mb.seeded === '2026-10-01T00:00:00Z' && !('sample' in mb) && mb.dash[0].id === 'flow' && mb.aiName === '직원 비서' && mb.numFmt === 'comma' && mb.gUrl === G.url && mb.gToken === TK, mb);
    const s1 = await sync(A), s2 = await sync(B);
    ok('바로 다시 맞춰도 주고받을 것 없음', s1.ok && s2.ok && !G.hits.slice(-2).some(h => h !== 'cloud_info'), G.hits.slice(-4));
  });

  // ------------------------------------------------------------------------------------------
  await sec('4. 주고받기 — 직원 PC 입력이 사장님 PC 로 (더하기 · 고치기 · 지우기 · 같은 행 · 설정 · 새 표)', async () => {
    const pa = await getT(A, 'prod_log'); pa.push({ _id: 'plA', date: '2026-10-21', process: 'ASM', ok_ea: 777, by: 'A' }); await putT(A, 'prod_log', pa);
    const sa = await sync(A);
    ok('사장님 PC 저장 → 보냄', sa.ok && sa.lastSent && G.rows('prod_log').some(r => r._id === 'plA'), sa);
    const sb = await sync(B);
    ok('직원 PC → 받음', sb.ok && !!byId(await getT(B, 'prod_log'), 'plA'), sb.log && sb.log.slice(-2));
    // 직원 PC: 고치기 · 지우기 · 더하기
    let pb = await getT(B, 'prod_log'); pb = pb.filter(r => r._id !== 'pl5'); byId(pb, 'pl6').ok_ea = 6000; pb.push({ _id: 'plB', date: '2026-10-22', process: 'PCK', ok_ea: 12, by: 'B' }); await putT(B, 'prod_log', pb);
    await sync(B); await sync(A);
    const pa2 = await getT(A, 'prod_log');
    ok('직원 PC 의 더하기 · 고치기 · 지우기 → 사장님 PC', !byId(pa2, 'pl5') && byId(pa2, 'pl6').ok_ea === 6000 && byId(pa2, 'plB') && byId(pa2, 'plB').by === 'B' && pa2.length === 121, { n: pa2.length });
    // 같은 표 다른 행을 두 PC 가 동시에
    let a3 = await getT(A, 'po'), b3 = await getT(B, 'po');
    byId(a3, 'po1').sets = 111; b3.find(r => r._id === 'po2').sets = 222; b3.push({ _id: 'poB', po_no: 'P-B', item_no: 'IT-B', sets: 5 });
    await putT(A, 'po', a3); await putT(B, 'po', b3);
    await sync(A); await sync(B); await sync(A);
    const fa = await getT(A, 'po'), fb = await getT(B, 'po');
    ok('같은 표의 다른 행 → 둘 다 남음 (양쪽 같음)', byId(fa, 'po1').sets === 111 && byId(fa, 'po2').sets === 222 && byId(fa, 'poB') && strip(fa) === strip(fb) && strip(fa) === strip(G.rows('po')), { fa, fb });
    // 같은 행을 둘 다
    a3 = await getT(A, 'po'); b3 = await getT(B, 'po'); byId(a3, 'po3').sets = 301; byId(b3, 'po3').sets = 302;
    await putT(A, 'po', a3); await putT(B, 'po', b3);
    const c0 = (await stat(B)).conflicts;
    await sync(A); await sync(B); await sync(A);
    const sbc = await stat(B);
    ok('같은 행을 둘 다 고침 → 나중에 맞춘 PC(직원) 내용 · 충돌 1건 기록', byId(await getT(A, 'po'), 'po3').sets === 302 && byId(await getT(B, 'po'), 'po3').sets === 302 && sbc.conflicts === c0 + 1 && sbc.log.some(e => e.k === 'conf'), sbc.conflicts);
    // 한쪽은 지우고 다른 쪽은 고침
    a3 = (await getT(A, 'po')).filter(r => r._id !== 'po2'); b3 = await getT(B, 'po'); byId(b3, 'po2').sets = 999;
    await putT(A, 'po', a3); await putT(B, 'po', b3);
    await sync(A); await sync(B); await sync(A);
    ok('사장님은 지우고 직원은 고침 → 고친 행이 남음 (양쪽)', byId(await getT(A, 'po'), 'po2') && byId(await getT(A, 'po'), 'po2').sets === 999 && strip(await getT(A, 'po')) === strip(await getT(B, 'po')));
    // 설정
    await patchMeta(A, { buyLead: 45, dash: [{ k: 'z', id: 'procs', w: 4 }] }, ['poKindsOff']);
    await patchMeta(B, { floorPivots: [{ id: 'asm', procs: ['ASM'] }], numFmt: 'auto' });
    await sync(A); await sync(B); await sync(A);
    const ma = await metaOf(A), mb = await metaOf(B);
    ok('설정: 공유 항목은 양쪽 (buyLead · floorPivots · poKindsOff 지움)', ma.buyLead === 45 && mb.buyLead === 45 && ma.floorPivots && mb.floorPivots && !('poKindsOff' in ma) && !('poKindsOff' in mb), { ma, mb });
    ok('설정: 이 PC 항목은 그대로 (배치 · 숫자 형식 · AI 비서)', ma.dash[0].id === 'procs' && mb.dash[0].id === 'flow' && ma.numFmt === 'dot' && mb.numFmt === 'auto' && ma.aiName === '보성 비서' && mb.aiName === '직원 비서');
    // 새 표
    await putT(A, 'stocktake', [{ _id: 'st1', date: '2026-10-22', wh_code: 'W1', code: 'A-1', qty: 3 }]);
    await sync(A); await sync(B);
    eq('한 PC 에서 처음 쓴 표도 다른 PC 로', ids(await getT(B, 'stocktake')), ['st1']);
    // 주고받을 것이 없으면 번호만 묻는다
    const h0 = G.hits.length; await sync(A); await sync(B);
    eq('바뀐 것이 없으면 cloud_info 만', G.hits.slice(h0), ['cloud_info', 'cloud_info']);
    const sA = await stat(A);
    ok('상태: 켜짐 · 마지막으로 맞춤 · 받음 · 보냄 · 기록', sA.on && sA.ok && sA.lastOk && sA.lastGot && sA.lastSent && sA.log.some(e => e.k === 'sent') && sA.log.some(e => e.k === 'got') && sA.pending === false, sA);
    const v = (await req(A.port, 'GET', '/api/versions')).json;
    ok('/api/versions 에 짧은 상태 (화면 왼쪽 아래 ☁)', v.cloud && v.cloud.on === true && v.cloud.ok === true && v.cloud.at && v.t && v.meta !== undefined, v.cloud);
  });

  // ------------------------------------------------------------------------------------------
  await sec('5. 다른 PC 가 먼저 올림 · 저장 뒤 저절로 · 정해진 간격 · 끄기 전 보내기 · 끄고 다시 켜기', async () => {
    // A 가 올리는 바로 그때 다른 PC(C) 가 먼저 같은 표를 올림 → A 는 거절(conflicts) → 받아서 합친 뒤 다시
    const pa = await getT(A, 'prod_log'); pa.push({ _id: 'plA2', date: '2026-10-22', process: 'INJ', ok_ea: 5 }); await putT(A, 'prod_log', pa);
    G.beforePut = () => { const rows = G.rows('prod_log'); rows.push({ _id: 'plC', date: '2026-10-22', process: 'ASM', ok_ea: 1, by: 'C' }); G.putRaw('prod_log', rows); };
    const h0 = G.hits.length; const s = await sync(A);
    const cr = G.rows('prod_log'), la = await getT(A, 'prod_log');
    ok('먼저 올라간 것을 받아 합쳐 다시 올림 (둘 다 남음)', s.ok && byId(cr, 'plA2') && byId(cr, 'plC') && byId(la, 'plC') && G.hits.slice(h0).filter(x => x === 'cloud_put').length === 2, { hits: G.hits.slice(h0), ok: s.ok, err: s.error });
    await sync(B);
    ok('직원 PC 도 둘 다', byId(await getT(B, 'prod_log'), 'plA2') && byId(await getT(B, 'prod_log'), 'plC'));
    // 저장하면 저절로 (poke) · 정해진 간격으로 받기
    const dC = tmp('erp-v18-c-'); const C = keep(await startPc(dC, { cloudPoke: 150, cloudEvery: 400, cloudFirst: 50 }), servers);
    const cc = await capi(C, 'connect', { url: G.url, token: TK, mode: 'replace' });
    ok('세 번째 PC 연결 (구글 자료로)', cc.status === 200 && cc.json.status.on, cc.json);
    const pc = await getT(C, 'prod_log'); pc.push({ _id: 'plPoke', date: '2026-10-22', process: 'ASM', ok_ea: 3 }); await putT(C, 'prod_log', pc);
    let seen = false; for (let i = 0; i < 40 && !seen; i++) { await sleep(100); seen = !!byId(G.rows('prod_log'), 'plPoke'); }
    ok('저장하고 몇 초 안에 저절로 구글로 (누르지 않아도)', seen);
    const pb = await getT(B, 'prod_log'); pb.push({ _id: 'plB2', date: '2026-10-22', process: 'PCK', ok_ea: 4 }); await putT(B, 'prod_log', pb); await sync(B);
    let got = false; for (let i = 0; i < 40 && !got; i++) { await sleep(100); got = !!byId(await getT(C, 'prod_log'), 'plB2'); }
    ok('다른 PC 가 올린 것을 정해진 간격으로 저절로 받음', got);
    await capi(C, 'off');
    // 끄기 전 보내기 (Electron 이 창을 닫기 전에 부름)
    const pa3 = await getT(A, 'prod_log'); pa3.push({ _id: 'plQuit', date: '2026-10-22', process: 'ASM', ok_ea: 9 }); await putT(A, 'prod_log', pa3);
    ok('보낼 것 있음 (pending)', A.cloud.pending() === true && (await stat(A)).pending === true);
    const fl = await A.cloud.flush(5000);
    ok('끄기 전 flush → 구글에 있음 · 보낼 것 없음', fl === true && byId(G.rows('prod_log'), 'plQuit') && A.cloud.pending() === false);
    eq('보낼 것이 없으면 flush 는 구글을 부르지 않음', await A.cloud.flush(5000), false);
    // 끄고 다시 켜기 (꺼 둔 동안 양쪽 변경을 합침)
    const off = await capi(B, 'off');
    ok('공유 끄기 → 꺼짐 (자료 그대로)', off.status === 200 && off.json.on === false && (await getT(B, 'prod_log')).length > 100);
    const s0 = await sync(B); ok('꺼져 있으면 지금 맞추기도 아무것도 안 함', s0.on === false);
    const pa4 = await getT(A, 'prod_log'); pa4.push({ _id: 'plOffA', date: '2026-10-22', process: 'ASM', ok_ea: 1 }); await putT(A, 'prod_log', pa4); await sync(A);
    const pb4 = await getT(B, 'prod_log'); pb4.push({ _id: 'plOffB', date: '2026-10-22', process: 'ASM', ok_ea: 2 }); await putT(B, 'prod_log', pb4);
    const ck = await capi(B, 'check', { url: G.url, token: TK });
    ok('다시 연결 확인 → 다시 켤 수 있음 (resume)', ck.json.resume === true && ck.json.on === false, ck.json);
    const rs = await capi(B, 'connect', { url: G.url, token: TK, mode: 'resume' });
    await sync(A);
    ok('다시 켜기 → 꺼 둔 동안 양쪽 입력이 합쳐짐', rs.status === 200 && rs.json.status.on && byId(await getT(B, 'prod_log'), 'plOffA') && byId(await getT(A, 'prod_log'), 'plOffB') && byId(G.rows('prod_log'), 'plOffB'), rs.json);
  });

  // ------------------------------------------------------------------------------------------
  await sec('6. 오류 — 인터넷 끊김 · 틀린 키 · 옛 Code.gs · 다른 저장소 · 로그인 화면 · 깨진 표 파일', async () => {
    const before = strip(await getT(A, 'prod_log'));
    G.down = true; const s1 = await sync(A); G.down = false;
    ok('인터넷 끊김 → NET 오류 · 자료 그대로', s1.ok === false && s1.code === 'NET' && strip(await getT(A, 'prod_log')) === before, s1);
    const s2 = await sync(A); ok('다시 되면 그대로 이어서', s2.ok === true && s2.code === null);
    await patchMeta(A, { gToken: TK + 'zz' }); const s3 = await sync(A); await patchMeta(A, { gToken: TK });
    eq('키가 바뀌면 BAD_TOKEN', s3.code, 'BAD_TOKEN');
    G.old = true; const s4 = await sync(A); const c4 = await capi(A, 'check', { url: G.url, token: TK }); G.old = false;
    eq('옛 Code.gs (4판) → OLD_SCRIPT (맞추기 · 연결 확인)', [s4.code, c4.json.code], ['OLD_SCRIPT', 'OLD_SCRIPT']);
    G.login = true; const s5 = await sync(A); G.login = false;
    eq('액세스 권한이 "모든 사용자" 가 아님 (구글 로그인 화면) → NOT_JSON', s5.code, 'NOT_JSON');
    const G2 = keep(await fakeGoogle(fs.readFileSync(CODE_FILE, 'utf8').replace("var TOKEN = 'CHANGE-ME';", "var TOKEN = '" + TK + "';")), googles);
    await patchMeta(A, { gUrl: G2.url }); const s6 = await sync(A);
    ok('다른 Apps Script(다른 저장소)로 바뀜 → CID · 그 저장소에 쓰지 않음', s6.code === 'CID' && !G2.hits.includes('cloud_put') && !G2.gas.props.has('T_prod_log'), { code: s6.code, hits: G2.hits });
    await patchMeta(A, { gUrl: G.url }); ok('주소를 되돌리면 다시 됨', (await sync(A)).ok === true);
    // 깨진 표 파일: 빈 표로 보고 구글을 지우면 안 된다
    const f = path.join(dB, 'tables', 'po.json'); const good = fs.readFileSync(f, 'utf8'); const cloudPo = strip(G.rows('po'));
    fs.writeFileSync(f, '{깨짐');
    const a5 = await getT(A, 'po'); byId(a5, 'po1').sets = 1234; await putT(A, 'po', a5); await sync(A);
    const s7 = await sync(B);
    ok('직원 PC 의 표 파일이 깨짐 → LOCAL 오류로 멈춤 · 구글 자료는 지우지 않음', s7.code === 'LOCAL' && /po/.test(s7.error) && G.rows('po').length === JSON.parse(cloudPo).length && byId(G.rows('po'), 'po1').sets === 1234, { code: s7.code, err: s7.error });
    fs.writeFileSync(f, good); const s8 = await sync(B);
    ok('파일을 되돌리면 이어서 받음', s8.ok && byId(await getT(B, 'po'), 'po1').sets === 1234, s8.code);
    // 표 파일이 없어짐 → "다 지움" 으로 올리지 않고 구글 자료로 되살림
    const nItems = G.rows('items').length; fs.rmSync(path.join(dB, 'tables', 'items.json'));
    const s9 = await sync(B); const bi = await getT(B, 'items');
    ok('직원 PC 의 표 파일이 없어짐 → 구글 자료로 되살림 · 구글은 그대로 · 기록', s9.ok && bi.length === nItems && G.rows('items').length === nItems && s9.log.some(e => e.k === 'lost'), { n: bi.length, nItems, code: s9.code });
    // 같은 _id 가 두 번 (손으로 고친 파일 등) → 둘 다 남는다
    await putT(A, 'returns', [{ _id: 'r1', code: 'A-1', qty: 1 }, { _id: 'r1', code: 'A-2', qty: 2 }]);
    await sync(A); await sync(B); const br = await getT(B, 'returns'); const s10 = await sync(A);
    ok('같은 _id 두 행 → 다른 PC 에도 두 행 (뒤의 것은 _id~순번) · 다음 판에 또 보내지 않음', br.length === 2 && br.some(r => r.qty === 1) && br.some(r => r.qty === 2) && ids(br).join() === 'r1,r1~1' && s10.ok && G.hits.slice(-1)[0] === 'cloud_info', { br, hits: G.hits.slice(-3) });
    const lg = (await stat(A)).log.filter(e => e.k === 'err').map(e => e.x.code);
    ok('오류는 기록에 (같은 오류는 한 번)', ['NET', 'BAD_TOKEN', 'OLD_SCRIPT', 'NOT_JSON', 'CID'].every(c => lg.includes(c)), lg);
  });

  // ------------------------------------------------------------------------------------------
  await sec('7. 안전 — 많이 지우면 백업 · 이 PC 에서만 연결 · 처음 합치기 · 덮어쓰기', async () => {
    // 직원 PC 에서 생산 일보를 거의 다 지움 → 사장님 PC 는 지우기 전 표를 복사해 두고 따라감
    const pb = await getT(B, 'prod_log'); const n0 = (await getT(A, 'prod_log')).length;
    await putT(B, 'prod_log', pb.slice(0, 10)); await sync(B); await sync(A);
    const sa = await stat(A); const sh = sa.shrink[sa.shrink.length - 1];
    const bk = sh && path.join(sh.dir, 'tables', 'prod_log.json');
    ok('절반 아래로 줄면 쓰기 전에 cloud_backup 에 복사 · 상태 · 기록', (await getT(A, 'prod_log')).length === 10 && sh && sh.table === 'prod_log' && sh.from === n0 && sh.to === 10 && fs.existsSync(bk) && JSON.parse(fs.readFileSync(bk, 'utf8')).length === n0 && sa.log.some(e => e.k === 'shrink') && sh.dir.startsWith(path.join(dA, 'cloud_backup')), sh);
    // 다른 PC 브라우저 (사내망): 상태 · 맞추기만, 연결 · 끄기 · 코드는 403
    const lan = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
    if (!lan) ok('사내망 주소 없음 — 다른 PC 시험은 건너뜀', true);
    else {
      const L = keep(await startPc(tmp('erp-v18-l-'), { host: '0.0.0.0' }), servers);
      await req(L.port, 'PUT', '/api/lan/pin', { pin: '2468' });
      const lg = await req(L.port, 'POST', '/api/login', { pin: '2468' }, { host: lan.address, localAddress: lan.address, headers: { Host: lan.address + ':' + L.port } });
      const cookie = String((lg.headers['set-cookie'] || [''])[0]).split(';')[0];
      const o = { host: lan.address, localAddress: lan.address, cookie, headers: { Host: lan.address + ':' + L.port } };
      const g1 = await req(L.port, 'GET', '/api/cloud', undefined, o), g2 = await req(L.port, 'POST', '/api/cloud/sync', {}, o);
      const g3 = await req(L.port, 'POST', '/api/cloud/connect', { url: G.url, token: TK, mode: 'replace' }, o), g4 = await req(L.port, 'POST', '/api/cloud/code', { token: TK }, o), g5 = await req(L.port, 'POST', '/api/cloud/off', {}, o);
      ok('다른 PC 브라우저: 상태 보기 · 지금 맞추기는 되고 (local false), 연결 · 코드 · 끄기는 403', lg.status === 200 && g1.status === 200 && g1.json.local === false && g2.status === 200 && g3.status === 403 && g4.status === 403 && g5.status === 403, [lg.status, g1.status, g2.status, g3.status, g4.status, g5.status]);
    }
    // 처음 합치기 (merge): 자기 자료로 쓰던 PC — 예시 행 · 이미 있는 행은 빼고 이 PC 에서만 입력한 행을 더함
    const dM = tmp('erp-v18-m-'); const M = keep(await startPc(dM), servers);
    const cloudItems = G.rows('items');
    await putT(M, 'items', [{ _id: 'm-it1', code: 'A-1', name: '빨강 (예전 사본)' }, { _id: 'm-it9', code: 'A-9', name: '새 품목' }]);
    await putT(M, 'prod_log', [{ _id: 'm-ex', date: '2026-01-01', process: 'ASM', ok_ea: 1, _ex: 1 }, { _id: 'm-p1', date: '2026-10-20', process: 'ASM', ok_ea: 41 }, { _id: 'm-p2', date: '2026-10-21', process: 'ASM', ok_ea: 42 }]);
    await putT(M, 'warehouses', [{ _id: 'm-w1', code: 'W-NEW', name: '새 창고' }]);
    await patchMeta(M, { buyLead: 7, prodPost: 'in_only', dash: [{ k: 'm', id: 'flow', w: 1 }] });
    const pv = await capi(M, 'preview', { url: G.url, token: TK, nat: nat() });
    eq('미리 보기: 표마다 더할 행 (품목 1 · 생산 일보 2 · 창고 1)', [pv.json.add, pv.json.total], [{ items: 1, prod_log: 2, warehouses: 1 }, 4]);
    const mg = await capi(M, 'connect', { url: G.url, token: TK, mode: 'merge', nat: nat() });
    ok('합치기 → 켜짐 · 더한 행 4 · 백업', mg.status === 200 && mg.json.added === 4 && mg.json.status.on && fs.existsSync(path.join(mg.json.backup, 'tables', 'items.json')), mg.json);
    const ci = G.rows('items'), cp = G.rows('prod_log');
    ok('구글: 원래 행 + 이 PC 에서만 입력한 행 (같은 코드 A-1 · 예시 행은 뺌)', ci.length === cloudItems.length + 1 && byId(ci, 'm-it9') && !byId(ci, 'm-it1') && byId(cp, 'm-p1') && byId(cp, 'm-p2') && !byId(cp, 'm-ex') && byId(G.rows('warehouses'), 'm-w1'), { ci: ids(ci) });
    const mm = await metaOf(M);
    ok('합치기 설정: 구글 값이 이기고 (buyLead 45), 구글에 없던 항목은 더함 (prodPost), 이 PC 항목 그대로', mm.buyLead === 45 && mm.prodPost === 'in_only' && G.rows('__meta').prodPost === 'in_only' && mm.dash[0].k === 'm', mm);
    await sync(A);
    ok('사장님 PC 도 합친 행을 받음', byId(await getT(A, 'items'), 'm-it9') && byId(await getT(A, 'prod_log'), 'm-p1'));
    // 덮어쓰기: 구글 = 이 PC 자료 → 다른 PC 들도 따라감
    const o1 = await getT(M, 'po'); o1.push({ _id: 'poM', po_no: 'P-M', item_no: 'IT-M', sets: 9 });
    await putT(M, 'po', o1.filter(r => r._id !== 'po1')); await capi(M, 'off');
    const ow = await capi(M, 'connect', { url: G.url, token: TK, mode: 'overwrite' });
    await sync(A);
    const pa = await getT(A, 'po');
    ok('덮어쓰기 → 구글 = 이 PC 자료 → 사장님 PC 도 (po1 없음 · poM 있음)', ow.status === 200 && ow.json.status.on && byId(G.rows('po'), 'poM') && !byId(G.rows('po'), 'po1') && byId(pa, 'poM') && !byId(pa, 'po1'), ow.json);
    await capi(M, 'off');
  });

  // ------------------------------------------------------------------------------------------
  await sec('8. 화면 — 사장님 PC 처음 설정 → 직원 PC 연결 코드 → 서로 입력이 보임 · 베트남어 · 휴대폰 폭', async () => {
    const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
    try {
      const U = keep(await startPc(tmp('erp-v18-u-'), { cloudPoke: 200, cloudEvery: 700 }), servers);
      const V = keep(await startPc(tmp('erp-v18-v-'), { cloudPoke: 200, cloudEvery: 700 }), servers);
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const page = async (S) => {
        const p = await ctx.newPage(); p.on('pageerror', e => errors.push('pageerror: ' + e.message));
        p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Failed to fetch|ERR_/.test(m.text())) errors.push('console: ' + m.text()); });
        await p.addInitScript(() => { window.__copied = []; try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied.push(String(t)); return Promise.resolve(); } } }); } catch (e) { /* 없음 */ } });
        await p.goto(S.url + '/#/data'); await p.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 180000 });
        await p.evaluate(() => { ERP.state.dataTab = 'google'; ERP.render(); }); await p.waitForSelector('#cloudCard .cloud-setup', { timeout: 15000 });
        return p;
      };
      const P = await page(U);
      const t0 = await P.evaluate(() => document.querySelector('#cloudCard').innerText);
      ok('카드: 제목 · 꺼짐 · ① 사장님 PC 순서 (코드 복사 · 새 구글 시트 · 확장 프로그램 → Apps Script · 배포 → 새 배포 · 웹 앱 · 나 · 모든 사용자 · 액세스 승인 · 웹 앱 URL) · ② 직원 PC',
        /여러 PC 자료 공유 \(구글 드라이브\)/.test(t0) && /꺼짐/.test(t0) && /Apps Script 코드 복사/.test(t0) && /새 구글 시트 열기/.test(t0) && /확장 프로그램 → Apps Script/.test(t0) && /배포 → 새 배포/.test(t0) && /웹 앱/.test(t0) && /모든 사용자/.test(t0) && /액세스 승인/.test(t0) && /웹 앱 URL/.test(t0) && /② 직원 PC/.test(t0), t0);
      ok('새 구글 시트 열기 = sheets.new (바깥 브라우저)', await P.evaluate(() => { const a = document.querySelector('#cloudCard a[href="https://sheets.new"]'); return !!a && a.target === '_blank'; }));
      await P.click('#cloudCard button:has-text("Apps Script 코드 복사")');
      await P.waitForFunction(() => window.__copied.length > 0, null, { timeout: 10000 }).catch(() => {});
      const cp = await P.evaluate(() => ({ c: window.__copied[0] || '', tk: ERP.db.setting('gToken'), toast: (document.querySelector('#toasts') || {}).innerText || '' }));
      ok('코드 복사 → 새 비밀 키를 만들어 이 PC 설정에 두고, 키를 넣은 Code.gs 를 복사 · 알림', /^[A-Za-z0-9_-]{32}$/.test(cp.tk) && cp.c.includes("var TOKEN = '" + cp.tk + "';") && /6판/.test(cp.c) && /복사했습니다/.test(cp.toast), { tk: cp.tk, toast: cp.toast });
      const GU = keep(await fakeGoogle(cp.c), googles);                 // 사용자가 붙여넣고 웹 앱으로 배포
      await P.fill('#cloudCard input[name=cloudUrl]', GU.url);
      await P.click('#cloudCard .cloud-setup .toolbar button:has-text("연결 확인") >> nth=0');
      await P.waitForSelector('#cloudCard .cloud-res button:has-text("이 PC 자료를 올리고 공유 시작")', { timeout: 15000 });
      const r0 = await P.evaluate(() => document.querySelector('#cloudCard .cloud-res').innerText);
      ok('연결 확인 → 연결됨 · 7판 · 아직 자료 없음 · 이 PC 자료 수', /연결됨/.test(r0) && /Apps Script 7판/.test(r0) && /아직 자료가 없습니다/.test(r0) && /표 \d+개/.test(r0), r0);
      await P.click('#cloudCard .cloud-res button:has-text("이 PC 자료를 올리고 공유 시작")');
      await P.waitForSelector('.modal .cloud-done', { timeout: 30000 });
      const done = await P.evaluate(() => document.querySelector('.modal').innerText);
      ok('결과 창: 올려 시작 · 표 · 행 · 직원 PC 안내 · 휴대폰 안내', /이 PC 자료를 올려 시작/.test(done) && /직원 PC/.test(done) && /휴대폰으로 보기/.test(done), done);
      await Promise.all([P.waitForNavigation({ timeout: 30000 }).catch(() => {}), P.click('.modal .modal-foot button.primary')]);
      await P.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready, null, { timeout: 60000 });
      await P.evaluate(() => { ERP.state.dataTab = 'google'; ERP.goto('data'); ERP.render(); });
      await P.waitForFunction(() => /켜짐/.test((document.querySelector('#cloudCard') || {}).innerText || ''), null, { timeout: 15000 }).catch(() => {});
      const on = await P.evaluate(() => ({ t: document.querySelector('#cloudCard').innerText, side: (document.querySelector('#cloudstate') || {}).innerText || '', vis: document.querySelector('#cloudstate') && document.querySelector('#cloudstate').style.display !== 'none' }));
      ok('새로 고친 뒤: 켜짐 · 마지막으로 맞춤 · 받음/보냄 · 지금 맞추기 · 직원 PC 연결 코드 · 공유 끄기 · 왼쪽 아래 ☁ 구글 공유',
        /켜짐/.test(on.t) && /마지막으로 맞춤/.test(on.t) && /지금 맞추기/.test(on.t) && /직원 PC 연결 코드/.test(on.t) && /공유 끄기/.test(on.t) && on.vis && /☁ 구글 공유/.test(on.side), on);
      ok('구글 쪽에 사장님 PC 자료 (예시 자료의 수주)', (GU.rows('po') || []).length > 0 && (GU.rows('po') || []).length === await P.evaluate(() => ERP.db.rows('po').length));
      await P.click('#cloudCard button:has-text("직원 PC 연결 코드")'); await P.waitForSelector('.modal textarea');
      const inv = await P.evaluate(() => { const v = document.querySelector('.modal textarea').value; return { v, p: ERP.cloudParse(v), url: ERP.db.setting('gUrl'), tk: ERP.db.setting('gToken'), t: document.querySelector('.modal').innerText }; });
      ok('직원 PC 연결 코드: ERPC1. · 주소 · 키 · 직원에게만 안내', /^ERPC1\.[A-Za-z0-9_-]+$/.test(inv.v) && inv.p && inv.p.url === inv.url && inv.p.token === inv.tk && /직원에게만/.test(inv.t), inv);
      await P.click('.modal .modal-foot button.primary'); await P.waitForTimeout(200);
      ok('[복사] → 연결 코드 복사', await P.evaluate((v) => window.__copied.includes(v), inv.v));
      await P.keyboard.press('Escape');
      // 직원 PC (예시 자료로 처음 켠 ERP)
      const Q = await page(V);
      await Q.fill('#cloudCard input[name=cloudCode]', 'ERPC1.이상한코드');
      await Q.click('#cloudCard .cloud-setup .toolbar button:has-text("연결 확인") >> nth=1'); await Q.waitForTimeout(300);
      ok('틀린 연결 코드 → 알림', /연결 코드가 맞지 않습니다/.test(await Q.evaluate(() => document.querySelector('#toasts').innerText)));
      await Q.fill('#cloudCard input[name=cloudCode]', inv.v);
      await Q.click('#cloudCard .cloud-setup .toolbar button:has-text("연결 확인") >> nth=1');
      await Q.waitForSelector('#cloudCard .cloud-res button:has-text("구글 자료로 시작")', { timeout: 15000 });
      const r1 = await Q.evaluate(() => document.querySelector('#cloudCard .cloud-res').innerText);
      ok('직원 PC 연결 확인 → 자료 있음 · 구글 자료로 시작 · 더하기 · 덮어쓰기', /자료가 있습니다/.test(r1) && /구글 자료로 시작/.test(r1) && /이 PC 에만 있는 자료도 더하기/.test(r1) && /덮어쓰기/.test(r1), r1);
      await Q.click('#cloudCard .cloud-res button:has-text("구글 자료로 시작")');
      await Q.waitForSelector('.modal .modal-foot button.primary'); await Q.click('.modal .modal-foot button.primary');   // 확인 창
      await Q.waitForSelector('.modal .cloud-done', { timeout: 30000 });
      await Promise.all([Q.waitForNavigation({ timeout: 30000 }).catch(() => {}), Q.click('.modal .modal-foot button.primary')]);
      await Q.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready, null, { timeout: 60000 });
      const nU = await P.evaluate(() => ERP.db.rows('po').length), nV = await Q.evaluate(() => ERP.db.rows('po').length);
      eq('직원 PC 화면 = 사장님 PC 자료 (수주 수)', nV, nU);
      // 직원 PC 에서 입력 → 사장님 PC 화면에
      await Q.evaluate(async () => { ERP.db.add('prod_log', { date: '2026-10-22', process: 'ASM', ok_ea: 4321, note: '직원 입력' }); await ERP.db.flush(); });
      let seenU = false; for (let i = 0; i < 60 && !seenU; i++) { await P.waitForTimeout(250); seenU = await P.evaluate(async () => { await ERP.db.poll(); return ERP.db.rows('prod_log').some(r => r.note === '직원 입력'); }); }
      ok('직원 PC 입력 → 몇 초 안에 사장님 PC 화면 (누르지 않아도)', seenU);
      await P.evaluate(async () => { ERP.db.add('po', { po_no: 'P-UI', item_no: 'UI-1', sets: 10, date: '2026-10-22' }); await ERP.db.flush(); });
      let seenV = false; for (let i = 0; i < 60 && !seenV; i++) { await Q.waitForTimeout(250); seenV = await Q.evaluate(async () => { await ERP.db.poll(); return ERP.db.rows('po').some(r => r.po_no === 'P-UI'); }); }
      ok('사장님 PC 입력 → 직원 PC 화면', seenV);
      // 설정 화면 · 휴대폰 보기 안내
      await Q.evaluate(() => ERP.goto('settings')); await Q.waitForSelector('#cloudMini .chip', { timeout: 10000 }); await Q.waitForSelector('#phoneCard h4', { timeout: 10000 });
      const st = await Q.evaluate(() => ({ m: document.querySelector('#cloudMini').innerText, ph: document.querySelector('#phoneCard').innerText }));
      ok('설정: 공유 카드 (켜짐) · 휴대폰 보기는 같은 웹 앱 · 직원 PC 비밀번호 안내 · null/undefined 글자 없음', /켜짐/.test(st.m) && /공유 상태 보기/.test(st.m) && /공유에 참여한 PC/.test(st.ph) && /비밀번호 정하고 켜기/.test(st.ph) && !/\bnull\b|undefined/.test(st.m + st.ph), st);
      await Q.evaluate(() => ERP.goto('settings'));
      const warn = await Q.evaluate(async () => { const b = Array.from(document.querySelectorAll('button')).find(x => /전체 삭제/.test(x.textContent)); b.click(); await new Promise(r => setTimeout(r, 300)); const t = (document.querySelector('.modal') || {}).innerText || ''; const c = document.querySelector('.modal .modal-foot button'); if (c) c.click(); return t; });
      ok('공유 중 "전체 삭제" 확인 글: 다른 PC 자료도 바뀜', /구글 드라이브 공유가 켜져 있습니다/.test(warn), warn);
      // 베트남어 · 휴대폰 폭
      await Q.evaluate(() => { ERP.state.dataTab = 'google'; ERP.goto('data'); ERP.setLang('vi'); }); await Q.waitForFunction(() => /Đang bật/.test((document.querySelector('#cloudCard') || {}).innerText || ''), null, { timeout: 15000 }).catch(() => {});
      const vi = await Q.evaluate(() => ({ t: document.querySelector('#cloudCard').innerText, side: document.querySelector('#cloudstate').innerText }));
      ok('베트남어: 카드 · 왼쪽 아래 · null/undefined 없음', /Dùng chung dữ liệu nhiều máy/.test(vi.t) && /Đồng bộ ngay/.test(vi.t) && /Dùng chung Google/.test(vi.side) && !/\bnull\b|undefined|NaN/.test(vi.t), vi);
      await Q.evaluate(() => ERP.setLang('ko'));
      await Q.setViewportSize({ width: 390, height: 844 }); await Q.evaluate(() => ERP.render()); await Q.waitForSelector('#cloudCard .chip', { timeout: 10000 }); await Q.waitForTimeout(300);
      const fit = await Q.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
      ok('휴대폰 폭(390)에 맞음', fit.sw <= fit.iw + 1, fit);
      await Q.setViewportSize({ width: 1400, height: 900 });
      // 끄기
      await Q.evaluate(() => ERP.render()); await Q.waitForSelector('#cloudCard button:has-text("공유 끄기")', { timeout: 10000 });
      await Q.click('#cloudCard button:has-text("공유 끄기")'); await Q.waitForSelector('.modal .modal-foot button.primary'); await Q.click('.modal .modal-foot button.primary');
      await Q.waitForFunction(() => /꺼짐/.test((document.querySelector('#cloudCard') || {}).innerText || '') && document.querySelector('#cloudstate').style.display === 'none', null, { timeout: 15000 }).catch(() => {});
      const offT = await Q.evaluate(() => ({ t: document.querySelector('#cloudCard').innerText, side: document.querySelector('#cloudstate').style.display }));
      ok('공유 끄기 → 꺼짐 · 왼쪽 아래 ☁ 사라짐 · 다시 연결 순서 보임', /꺼짐/.test(offT.t) && offT.side === 'none' && /연결 확인/.test(offT.t), offT);
      await ctx.close();
    } finally { await browser.close(); }
  });

  // ------------------------------------------------------------------------------------------
  await sec('9. 설치형 · 끄기 전 보내기 · 버전', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    ok('설치형(app.asar)에 cloudsync.js · google/Code.gs ([Apps Script 코드 복사] 가 읽음)', pkg.build.files.includes('cloudsync.js') && pkg.build.files.includes('google/**') && pkg.build.files.includes('server.js'), pkg.build.files);
    const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
    ok('ERP 창을 닫기 · 업데이트 설치 · 사내망 재시작 전에 구글로 보냄 (flushAll → cloud.flush)', /async function flushAll\(\)/.test(main) && /info\.cloud\.flush\(15000\)/.test(main) && /beforeInstall: \(\) => flushAll\(\)/.test(main) && /flushAll\(\)\.then\(/.test(main) && /await flushAll\(\); app\.relaunch\(\)/.test(main));
    ok('Windows 자동 업데이트 시험이 cloudsync.js 바뀜에도 돎', /- 'cloudsync\.js'/.test(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'update-test.yml'), 'utf8')));
    const core = fs.readFileSync(path.join(ROOT, 'app', 'js', 'core.js'), 'utf8'), nsi = fs.readFileSync(path.join(ROOT, 'build', 'installer.nsi'), 'utf8');
    eq('버전 1.13.15 (package · 화면 · 설치 프로그램)', [pkg.version, (core.match(/v: '([\d.]+)'/) || [])[1], (nsi.match(/!define VERSION "([\d.]+)"/) || [])[1], /-DVERSION=1\.13\.15 /.test(pkg.scripts.dist)], ['1.13.15', '1.13.15', '1.13.15', true]);
    ok('index.html 에 cloud.js', /<script src="js\/cloud\.js"><\/script>/.test(fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8')));
  });

  // ------------------------------------------------------------------------------------------
  await sec('10. 구글 시트 = 공유 자료 보기 (6판 · 1.13.2) — 표마다 탭 · 화면과 같은 이름 · 저장 뒤 저절로 · 오류 표 · 다시 쓰기', async () => {
    const src = fs.readFileSync(CODE_FILE, 'utf8').replace("var TOKEN = 'CHANGE-ME';", "var TOKEN = '" + TK + "';");
    const gz = (v) => zlib.gzipSync(JSON.stringify(v)).toString('base64');
    const LAY = { po: { title: '수주 (PO)', ord: 0, cols: [{ k: 'date', h: '수주일', t: 'd' }, { k: 'po_no', h: 'PO 번호', t: 't' }, { k: 'item_no', h: '품번 (Item)', t: 't' }, { k: 'sets', h: '세트', t: 'n' }] },
      items: { title: '품목 마스터', ord: 14, cols: [{ k: 'code', h: '품목코드', t: 't' }, { k: 'name', h: '품명', t: 't' }] },
      returns: { title: '반품', ord: 6, cols: [{ k: 'code', h: '품목코드', t: 't' }, { k: 'qty', h: '수량', t: 'n' }] } };
    // ---- (가) 구글 쪽 (Code.gs 6판)
    const S = gasCtx(src, { sheetName: '제목 없는 스프레드시트' }); const ssx = S.c.SpreadsheetApp.getActiveSpreadsheet();
    const put = (name, rows, base, lay, pc) => S.post({ token: TK, action: 'cloud_put', pc, tables: { [name]: { base, b64: gz(rows), n: rows.length, sheet: lay } } });
    const sheetGo = (all) => S.post({ token: TK, action: 'cloud_sheet', all: !!all });
    const info = () => S.post({ token: TK, action: 'cloud_info' });
    const poRows = [{ _id: 'p1', date: '2026-10-01', po_no: 'P-1', item_no: '0414210300', sets: 100, note: '=IMPORTDATA("http://x")', _ex: 1 }, { _id: 'p2', date: '2026-10-02', po_no: 'P-2', item_no: '523034E200', sets: 50 }];
    const w1 = put('po', poRows, 0, LAY.po, 'PC-A');
    ok('저장(cloud_put)은 시트를 기다리지 않음 — 저장 번호만 주고, 시트는 아직 그대로', w1.ok && w1.vers.po === 1 && !('sheet' in w1) && S.book.names().join() === '시트1' && S.book.writes === 0, { w1, tabs: S.book.names() });
    const i1 = info();
    ok('cloud_info: 7판 · 보낸 PC · 시트에 쓴 번호 (sv 0 = 아직)', i1.ver === 7 && i1.tables.po.pc === 'PC-A' && i1.tables.po.sv === 0 && i1.tables.po.v === 1, i1.tables.po);
    const s1 = sheetGo(); const tab = S.book.tab('수주 (PO)');
    ok('cloud_sheet → 표마다 탭 (ERP 화면과 같은 한국어 이름) · 쓴 표 · 시트 주소 · 이름', s1.ok && s1.sheet === true && JSON.stringify(s1.written) === '["po"]' && !s1.more && !!tab && s1.url === 'https://sheet.example' && s1.name === 'ColorPencil ERP 공유 자료', s1);
    const t1 = tab ? tab.table() : [];
    eq('머리글 = 한국어 · ERP 열 순서 → 화면에 없는 칸 (note) → 맨 끝 ID (ERP), "_" 로 시작하는 칸 (_ex) 은 뺌', t1[0], ['수주일', 'PO 번호', '품번 (Item)', '세트', 'note', 'ID (ERP)']);
    eq('값: 코드 · 날짜는 글자 그대로 (0414210300 · 2026-10-01), 숫자는 숫자, "=" 로 시작하는 글자는 수식이 되지 않음', t1.slice(1), [['2026-10-01', 'P-1', '0414210300', 100, '=IMPORTDATA("http://x")', 'p1'], ['2026-10-02', 'P-2', '523034E200', 50, '', 'p2']]);
    ok('서식: 글자 열 @ · 숫자 열 General · 첫 줄 고정 · 경고만 보호 · 빈 1000행 · 26열 없음', tab && tab.fmtOf(2, 1) === '@' && tab.fmtOf(2, 3) === '@' && tab.fmtOf(2, 4) === 'General' && tab.frozen === 1 && tab.prot.length === 1 && tab.prot[0].warn === true && tab.rows <= 4 && tab.cols === 6,
      tab && { f: [tab.fmtOf(2, 1), tab.fmtOf(2, 3), tab.fmtOf(2, 4)], frozen: tab.frozen, rows: tab.rows, cols: tab.cols });
    const ovRow = (n) => (S.book.sheets[0].table().find(r => r[5] === n) || []);
    ok('맨 앞 "ERP 자료 안내" 탭: 표 · 행 수 · 보낸 PC · 최신 / "제목 없는 스프레드시트" → 이름 · 빈 시트1 지움',
      S.book.sheets[0].name === 'ERP 자료 안내' && /ColorPencil ERP/.test(String(S.book.sheets[0].table()[0][0])) && ovRow('po')[0] === '수주 (PO)' && ovRow('po')[1] === 2 && ovRow('po')[3] === 'PC-A' && ovRow('po')[4] === '최신'
      && !S.book.tab('시트1') && S.book.name === 'ColorPencil ERP 공유 자료', { names: S.book.names(), ov: S.book.sheets[0].table() });
    eq('cloud_info: 시트에 쓴 번호 = 저장 번호 · 시트 주소', [info().tables.po.sv, info().sheet], [1, 'https://sheet.example']);
    put('items', [{ _id: 'i1', code: 'A-1', name: '빨강' }], 0, LAY.items, 'PC-B');
    eq('바뀐 표만 다시 씀 (수주는 그대로)', sheetGo().written, ['items']);
    eq('탭 순서: 안내 → ERP 표 순서', S.book.names(), ['ERP 자료 안내', '수주 (PO)', '품목 마스터']);
    const poRows2 = poRows.concat([{ _id: 'p3', date: '2026-10-03', po_no: 'P-3', item_no: 'X', sets: 7 }]);
    put('po', poRows2, 1, LAY.po, 'PC-B'); sheetGo();
    ok('표를 고쳐 저장 → 그 탭 다시 (3행) · 안내 탭의 보낸 PC', S.book.tab('수주 (PO)').table().length === 4 && ovRow('po')[1] === 3 && ovRow('po')[3] === 'PC-B', ovRow('po'));
    ssx.insertSheet('반품').getRange(1, 1, 1, 1).setValues([['내 메모']]);
    put('returns', [{ _id: 'r1', code: 'A-1', qty: 2 }], 0, LAY.returns, 'PC-A');
    put('ecount_snap', [{ _id: 'e1', a: 1 }], 0, undefined, 'PC-A');            // 레이아웃 없음 (5판 ERP · 화면에 없는 표)
    sheetGo();
    ok('같은 이름의 탭이 이미 있으면 그 탭은 그대로 두고 "(ERP)" 를 붙인 새 탭', S.book.tab('반품').table()[0][0] === '내 메모' && !!S.book.tab('반품 (ERP)') && S.book.tab('반품 (ERP)').table()[0][0] === '품목코드', S.book.names());
    ok('레이아웃이 없는 표 → 표 이름 그대로의 탭 · 칸 이름 머리글', !!S.book.tab('ecount_snap') && S.book.tab('ecount_snap').table()[0].join() === 'a,ID (ERP)', S.book.names());
    ssx.deleteSheet(S.book.tab('품목 마스터'));
    const s3 = sheetGo();
    ok('ERP 탭을 지우면 다음 갱신 때 되살림', s3.written.includes('items') && !!S.book.tab('품목 마스터') && S.book.tab('품목 마스터').table().length === 2, s3);
    const nW = S.book.writes; const s4 = sheetGo();
    ok('바뀐 것이 없으면 표는 쓰지 않음 (안내 탭만)', s4.written.length === 0 && S.book.writes - nW <= 2, { s4, w: S.book.writes - nW });
    // 한 표에서 오류 → 그 표만, 같은 번호로는 다시 시도하지 않음
    S.book.failTab = '수주 (PO)';
    put('po', poRows2.concat([{ _id: 'p4', po_no: 'P-4', sets: 1 }]), 2, LAY.po, 'PC-A'); put('items', [{ _id: 'i1', code: 'A-1', name: '빨강' }, { _id: 'i2', code: 'A-2', name: '파랑' }], 1, LAY.items, 'PC-A');
    const s5 = sheetGo();
    ok('한 표에서 오류 (칸 한도 등) → 그 표만 errs · 다른 표는 씀', s5.ok && s5.written.includes('items') && !s5.written.includes('po') && /10000000 cells/.test((s5.errs || {}).po || ''), s5);
    const i5 = info().tables.po;
    ok('cloud_info: 오류 표 (se = 그 번호 · 메시지)', i5.se === i5.v && i5.sv < i5.v && /cells/.test(i5.sm || ''), i5);
    const w5 = S.book.writes; const s6 = sheetGo();
    ok('같은 번호의 오류 표는 다시 시도하지 않음 · 안내 탭에 "오류"', s6.written.length === 0 && S.book.writes - w5 <= 2 && /오류/.test(ovRow('po')[4]), { s6, row: ovRow('po') });
    S.book.failTab = null;
    put('po', poRows2, 3, LAY.po, 'PC-A'); const s7 = sheetGo();
    ok('새로 저장되면 다시 시도 → 되면 오류 지움', s7.written.includes('po') && !info().tables.po.se && ovRow('po')[4] === '최신', { s7, po: info().tables.po });
    // 모두 다시 쓰기 · 시간 예산 (6분 한도 전에 멈추고, 남은 표는 다음 부름에)
    S.book.tab('수주 (PO)').getRange(2, 2, 1, 1).setValues([['손으로 고침']]);
    S.book.onWrite = () => { S.clock.off += 130000; };                          // 쓰는 데 오래 걸리는 척
    const a1 = sheetGo(true); S.book.onWrite = null; S.clock.off = 0;
    ok('모두 다시 쓰기 → 시간이 모자라면 more (남은 표는 다음에)', a1.ok && a1.more === true && a1.written.length >= 1 && a1.written.length < 4, a1);
    const a2 = sheetGo();
    ok('이어서 부르면 남은 표를 마저 씀 (모두 다시 쓰기가 도중에 끊겨도) · 손으로 고친 칸은 ERP 값으로', !a2.more && a1.written.length + a2.written.length === 4 && S.book.tab('수주 (PO)').table()[1][1] === 'P-1', { a1: a1.written, a2: a2.written });
    S.stats.docBusy = true; const b1 = sheetGo(); S.stats.docBusy = false;
    ok('다른 실행이 시트를 쓰는 중 → busy (오래 기다리지 않음)', b1.ok && b1.busy === true && b1.sheet === true, b1);
    const NS = gasCtx(src, { noSheet: true }); NS.post({ token: TK, action: 'cloud_put', tables: { po: { base: 0, b64: gz(poRows), n: 2, sheet: LAY.po } } });
    eq('시트 없이 만든 스크립트 → sheet false (공유는 그대로)', NS.post({ token: TK, action: 'cloud_sheet' }), { ok: true, sheet: false });

    // ---- (나) ERP 와 함께: 저장하면 시트도 · 여러 번 저장은 모아서 · 다른 PC 가 못 한 갱신은 대신 · 모두 다시 쓰기 · 5판 · 시트 없는 스크립트
    const waitFor = async (fn, ms) => { for (let i = 0; i < (ms || 10000) / 100; i++) { if (await fn()) return true; await sleep(100); } return false; };
    const GS = keep(await fakeGoogle(src, { sheetName: '제목 없는 스프레드시트' }), googles); const bk = GS.gas.book;
    const P1 = keep(await startPc(tmp('erp-v18-s-'), { pcName: 'PC-사장', cloudSheet: 1000, cloudSheetLag: 0 }), servers);
    await ownerData(P1);
    const up = await capi(P1, 'connect', { url: GS.url, token: TK, mode: 'upload' });
    const idle = () => waitFor(async () => { const s = (await stat(P1)).sheet || {}; return !s.busy && !s.queued; });
    const okTabs = await waitFor(() => !!(bk.tab('수주 (PO)') && bk.tab('생산 일보') && bk.tab('품목 마스터'))); await idle();
    ok('올리면 몇 초 안에 구글 시트에 표마다 탭 (화면과 같은 이름: 수주 (PO) · 생산 일보 · 품목 마스터)', up.status === 200 && okTabs, bk.names());
    const plTab = bk.tab('생산 일보');
    ok('생산 일보 탭: 머리글 = 화면 (생산일 …) · 맨 끝 ID (ERP) · 120행', !!plTab && plTab.table()[0][0] === '생산일' && plTab.table()[0].slice(-1)[0] === 'ID (ERP)' && plTab.table().length === 121, plTab && plTab.table()[0]);
    const st1 = await stat(P1);
    ok('상태: 구글 시트 있음 · 주소 · 이름 · 7판 · 최신 (갱신 대기 · 오류 없음)', !!st1.sheet && st1.sheet.has === true && st1.sheet.url === 'https://sheet.example' && st1.sheet.name === 'ColorPencil ERP 공유 자료' && st1.sheet.ver === 7 && !st1.sheet.code && st1.sheet.lag.length === 0 && !Object.keys(st1.sheet.errs).length && !!st1.sheet.at, st1.sheet);
    const pl = await getT(P1, 'prod_log'); byId(pl, 'pl7').ok_ea = 7777; await putT(P1, 'prod_log', pl); await sync(P1);
    const rowOf = (tn, id) => ((bk.tab(tn) && bk.tab(tn).table().find(r => r[r.length - 1] === id)) || []);
    ok('ERP 에서 고쳐 저장 → 구글 시트 탭도 (몇 초 안에) · 안내 탭에 보낸 PC', await waitFor(() => rowOf('생산 일보', 'pl7').includes(7777)) && (bk.sheets[0].table().find(r => r[5] === 'prod_log') || [])[3] === 'PC-사장', bk.sheets[0].table());
    await idle(); const h0 = GS.hits.length;
    for (let i = 0; i < 4; i++) { const r = await getT(P1, 'po'); byId(r, 'po1').sets = 1000 + i; await putT(P1, 'po', r); await sync(P1); }
    await waitFor(() => rowOf('수주 (PO)', 'po1').includes(1003)); await idle();
    const nSheet = GS.hits.slice(h0).filter(x => x === 'cloud_sheet').length, nPut = GS.hits.slice(h0).filter(x => x === 'cloud_put').length;
    ok('잇따라 4번 저장 → 시트는 모아서 갱신 (시트 갱신 < 저장) · 마지막 값', nPut === 4 && nSheet >= 1 && nSheet < 4 && rowOf('수주 (PO)', 'po1').includes(1003), { nPut, nSheet });
    GS.putRaw('items', (GS.rows('items') || []).concat([{ _id: 'itX', code: 'Z-9', name: '다른 PC' }]));   // 다른 PC: 저장만 하고 바로 꺼짐 (시트 갱신 못 함)
    await sync(P1);
    ok('다른 PC 가 올렸는데 시트가 뒤처져 있으면 이 PC 가 대신 갱신', await waitFor(() => rowOf('품목 마스터', 'itX').length > 0)); await idle();
    bk.tab('수주 (PO)').getRange(2, 1, 1, 1).setValues([['손으로 고침']]);
    const rw = await req(P1.port, 'POST', '/api/cloud/sheet', {});
    ok('[구글 시트 다시 쓰기] → 모든 탭을 ERP 자료로 다시 (손으로 고친 칸도)', rw.status === 200 && rw.json.on === true && await waitFor(() => bk.tab('수주 (PO)').table()[1][0] !== '손으로 고침'), rw.json && rw.json.sheet);
    await idle();
    // 5판으로 배포한 채 (아직 6판 코드를 붙여넣지 않음) → 시트 갱신은 부르지 않고 안내
    GS.v5 = true; const h5 = GS.hits.length;
    const r5 = await getT(P1, 'po'); byId(r5, 'po2').sets = 55; await putT(P1, 'po', r5); await sync(P1); await sleep(1600);
    const s5b = await stat(P1); const rw5 = await req(P1.port, 'POST', '/api/cloud/sheet', {});
    ok('5판이면 cloud_sheet 를 부르지 않음 · 상태 ver 5 · 다시 쓰기는 OLD_SCRIPT (공유는 그대로)', !GS.hits.slice(h5).includes('cloud_sheet') && s5b.sheet.ver === 5 && s5b.ok === true && rw5.status === 400 && rw5.json.code === 'OLD_SCRIPT', { hits: GS.hits.slice(h5), sheet: s5b.sheet, rw5: rw5.json });
    GS.v5 = false; await sync(P1);
    ok('6판으로 바꾸면 밀린 표를 갱신', await waitFor(() => rowOf('수주 (PO)', 'po2').includes(55))); await idle();
    // 시트 없이 만든 스크립트 (script.google.com 에서 바로)
    const GN = keep(await fakeGoogle(src, { noSheet: true }), googles);
    const P2 = keep(await startPc(tmp('erp-v18-n-'), { cloudSheet: 100, cloudSheetLag: 0 }), servers); await ownerData(P2);
    const upn = await capi(P2, 'connect', { url: GN.url, token: TK, mode: 'upload' }); await sleep(600);
    const sn = await stat(P2); const rwn = await req(P2.port, 'POST', '/api/cloud/sheet', {});
    ok('시트 없는 스크립트: 공유는 되고 · 상태 시트 없음 · cloud_sheet 를 부르지 않음 · 다시 쓰기는 NO_SHEET', upn.status === 200 && sn.on && sn.sheet.has === false && !GN.hits.includes('cloud_sheet') && rwn.status === 400 && rwn.json.code === 'NO_SHEET', { sheet: sn.sheet, hits: GN.hits, rwn: rwn.json });
    await capi(P2, 'off');

    // ---- (다) 화면: 공유 카드의 구글 시트 줄 · 다시 쓰기 · 오류 표 · 5판 안내 · 베트남어
    const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
    try {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const p = await ctx.newPage(); p.on('pageerror', e => errors.push('pageerror: ' + e.message));
      p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Failed to fetch|ERR_/.test(m.text())) errors.push('console: ' + m.text()); });
      await p.goto(P1.url + '/#/data'); await p.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 180000 });
      const card = async (re) => { await p.evaluate(() => { ERP.state.dataTab = 'google'; ERP.goto('data'); ERP.render(); });
        await p.waitForFunction((s) => new RegExp(s).test((document.querySelector('#cloudCard') || {}).innerText || ''), re.source, { timeout: 15000 }).catch(() => {});
        return p.evaluate(() => { const a = document.querySelector('#cloudCard .cloud-sheet a[href^="http"]'); return { t: document.querySelector('#cloudCard').innerText, a: a ? a.href : '', tg: a ? a.target : '' }; }); };
      const c1 = await card(/구글 시트/);
      ok('공유 카드: 구글 시트 (표 보기) · 시트 이름 링크 (바깥 브라우저) · 최신 · [구글 시트 다시 쓰기] · 고치는 것은 ERP 에서',
        /구글 시트/.test(c1.t) && /ColorPencil ERP 공유 자료/.test(c1.t) && c1.a === 'https://sheet.example/' && c1.tg === '_blank' && /최신/.test(c1.t) && /구글 시트 다시 쓰기/.test(c1.t) && /고치는 것은 ERP 에서/.test(c1.t), c1);
      await p.click('#cloudCard button:has-text("구글 시트 다시 쓰기")'); await p.waitForTimeout(300);
      ok('[구글 시트 다시 쓰기] → 알림', /구글 시트/.test(await p.evaluate(() => document.querySelector('#toasts').innerText)));
      await idle();
      bk.failTab = '생산 일보';
      const pl2 = await getT(P1, 'prod_log'); byId(pl2, 'pl8').ok_ea = 8888; await putT(P1, 'prod_log', pl2); await sync(P1);
      await waitFor(async () => !!((await stat(P1)).sheet.errs || {}).prod_log); await idle();
      const c2 = await card(/쓰지 못한 표/);
      ok('오류 표: 카드에 "시트에 쓰지 못한 표: 생산 일보" · 오류 글', /쓰지 못한 표/.test(c2.t) && /생산 일보/.test(c2.t) && /cells/.test(c2.t), c2.t);
      bk.failTab = null; const pl3 = await getT(P1, 'prod_log'); byId(pl3, 'pl8').ok_ea = 8889; await putT(P1, 'prod_log', pl3); await sync(P1);
      ok('다시 저장하면 오류가 풀림', await waitFor(() => rowOf('생산 일보', 'pl8').includes(8889))); await idle();
      GS.v5 = true; await sync(P1);
      const c3 = await card(/6판/);
      ok('5판으로 배포한 채면: 카드에 "6판" 안내 (Apps Script 코드 복사 → 새 버전으로 배포)', /6판/.test(c3.t) && /새 버전/.test(c3.t), c3.t);
      GS.v5 = false; await sync(P1); await idle();
      await p.evaluate(() => ERP.setLang('vi'));
      const c4 = await card(/Google Sheet/);
      ok('베트남어: 구글 시트 줄 · null/undefined/NaN 없음', /Google Sheet/.test(c4.t) && /Ghi lại Google Sheet/.test(c4.t) && !/\bnull\b|undefined|NaN/.test(c4.t), c4.t);
      await p.evaluate(() => ERP.setLang('ko'));
      await ctx.close();
    } finally { await browser.close(); }

    // ---- (라) 1.13.1 까지 연결한 PC (cloud.json 에 시트 정보 없음) → 1.13.2 로 업데이트하면 한 판 뒤 시트 주소 (링크)
    await idle(); P1.close();
    const cj = path.join(P1.dataDir, 'cloud.json'), cjo = JSON.parse(fs.readFileSync(cj, 'utf8')); delete cjo.sheet; delete cjo.sheetAt; fs.writeFileSync(cj, JSON.stringify(cjo));
    const P1b = keep(await startPc(P1.dataDir, { pcName: 'PC-사장', cloudSheet: 1000, cloudSheetLag: 0 }), servers);
    const sb0 = (await stat(P1b)).sheet; await sync(P1b); const sb1 = (await stat(P1b)).sheet;
    ok('1.13.1 까지 연결한 PC: 처음엔 시트를 모름 (확인 중) → 한 판 뒤 7판 · 시트 주소', sb0.has === null && sb0.ver === null && sb1.has === true && sb1.url === 'https://sheet.example' && sb1.ver === 7 && !sb1.lag.length, { sb0, sb1 });
  });

  // ------------------------------------------------------------------------------------------
  await sec('11. 코드 검토에서 찾은 문제 (1.13.3) — 비밀 키 · 덮어쓰기 · 휴대폰 잠금 · 속성 크기 · 탭 이름 · 다시 쓰기 요청', async () => {
    const src = fs.readFileSync(CODE_FILE, 'utf8').replace("var TOKEN = 'CHANGE-ME';", "var TOKEN = '" + TK + "';");
    const gz = (v) => zlib.gzipSync(JSON.stringify(v)).toString('base64');
    const waitFor = async (fn, ms) => { for (let i = 0; i < (ms || 10000) / 100; i++) { if (await fn()) return true; await sleep(100); } return false; };

    // ① 구글 비밀 키(gToken)는 ERP 가 실행 중인 PC 밖으로 보내지 않고, 사내망의 다른 PC 브라우저는 주소 · 키를 바꾸지 못한다
    {
      const GK = keep(await fakeGoogle(src), googles), GX = keep(await fakeGoogle(src), googles);   // GX = 남의 Apps Script (같은 키를 받으면 받아들임)
      const K = keep(await startPc(tmp('erp-v18-k-')), servers); await ownerData(K);
      await capi(K, 'connect', { url: GK.url, token: TK, mode: 'upload' });
      await req(K.port, 'PUT', '/api/lan/pin', { pin: '1357' });
      const L2 = { localAddress: '127.0.0.2' };
      const lg = await req(K.port, 'POST', '/api/login', { pin: '1357' }, L2);
      const o = Object.assign({ cookie: String((lg.headers['set-cookie'] || [''])[0]).split(';')[0] }, L2);
      const db = await req(K.port, 'GET', '/api/db', undefined, o), mt = await req(K.port, 'GET', '/api/meta', undefined, o);
      ok('다른 PC 브라우저: /api/db · /api/meta 에 비밀 키 없음 (웹 앱 주소 · 다른 설정은 보임)', lg.status === 200 && db.status === 200 && !db.text.includes(TK) && !mt.text.includes(TK) && db.json.meta.gUrl === GK.url && mt.json.meta.buyLead === 30,
        { db: db.json && db.json.meta, mt: mt.json && mt.json.meta });
      const pt = await req(K.port, 'PATCH', '/api/meta', { set: { gUrl: GX.url, gToken: 'evil-token-1234567890', buyLead: 12 }, del: [] }, o);
      const pd = await req(K.port, 'PATCH', '/api/meta', { set: {}, del: ['gToken', 'gUrl'] }, o);
      const pu = await req(K.port, 'PUT', '/api/meta', { buyLead: 13 }, o);   // 옛 화면 (1.3.0 이전): 설정 전체를 보냄
      const m1 = await metaOf(K);
      ok('다른 PC 브라우저가 주소 · 키를 바꾸거나 지우려 해도 그대로 · 다른 설정은 저장 · 답에도 키 없음',
        pt.status === 200 && pd.status === 200 && pu.status === 200 && m1.gUrl === GK.url && m1.gToken === TK && m1.buyLead === 13 && !pt.text.includes(TK) && !pd.text.includes(TK), { m1, pt: pt.json });
      const hk = GK.hits.length;
      const gp = await req(K.port, 'POST', '/api/gproxy', { url: GK.url, body: JSON.stringify({ token: '', action: 'ping' }) }, o);
      ok('다른 PC 브라우저의 구글 요청 (gproxy): 서버가 키를 넣어 연결된 웹 앱으로 보냄 (시트 올리기 · 휴대폰 요약이 그대로 됨)', gp.status === 200 && gp.json && gp.json.ok === true && GK.hits.length === hk + 1, gp.json);
      const gx = await req(K.port, 'POST', '/api/gproxy', { url: GX.url, body: JSON.stringify({ action: 'ping' }) }, o);
      ok('다른 웹 앱 주소로는 키를 넣지 않음 (키가 새지 않음)', !!gx.json && gx.json.ok === false && gx.json.error === 'bad token', gx.json);
      ok('ERP 가 실행 중인 PC 는 키를 그대로 앎 (직원 PC 연결 코드 · 코드 복사)', (await req(K.port, 'GET', '/api/db')).json.meta.gToken === TK);
      await capi(K, 'off');
    }

    // ② 덮어쓰기: 구글에만 있는 표 (이 PC 에 그 표 파일이 없음) 도 이 PC 자료 (= 빈 표) 로 — 이 PC 로 가져오지 않는다. ERP 가 모르는 표 (새 판 ERP 의 표) 는 그대로
    {
      const GO = keep(await fakeGoogle(src), googles);
      const A1 = keep(await startPc(tmp('erp-v18-oa-')), servers); await ownerData(A1);
      await putT(A1, 'warehouses', [{ _id: 'w1', code: 'W-1', name: '본 창고' }, { _id: 'w2', code: 'W-2', name: '둘째 창고' }]);
      await capi(A1, 'connect', { url: GO.url, token: TK, mode: 'upload' });
      GO.putRaw('future_tbl', [{ _id: 'f1', x: 1 }]);
      const dB = tmp('erp-v18-ob-'); const B1 = keep(await startPc(dB), servers);
      await putT(B1, 'po', [{ _id: 'poB', po_no: 'P-B', item_no: 'IT-B', sets: 3 }]);
      const ow = await capi(B1, 'connect', { url: GO.url, token: TK, mode: 'overwrite' }); await sync(B1);
      const whB = await getT(B1, 'warehouses');
      ok('덮어쓰기: 이 PC 에 없는 표 (창고) 는 구글에서도 비우고 이 PC 로 가져오지 않음 · 수주 = 이 PC',
        ow.status === 200 && (GO.rows('warehouses') || []).length === 0 && whB.length === 0 && ids(GO.rows('po')).join() === 'poB', { wh: GO.rows('warehouses'), whB, po: ids(GO.rows('po')) });
      ok('ERP 가 모르는 표 (새 판의 표) 는 덮어쓰지 않음', (GO.rows('future_tbl') || []).length === 1, GO.rows('future_tbl'));
      await sync(A1);
      ok('다른 PC 도 따라감 (창고 비움 · 수주 = 덮어쓴 PC)', (await getT(A1, 'warehouses')).length === 0 && ids(await getT(A1, 'po')).join() === 'poB');
      await capi(A1, 'off'); await capi(B1, 'off');
    }

    // ③ 휴대폰 보기: 누가 비밀번호를 10번 넘게 틀려도, 이 휴대폰을 기억해 둔 사람은 그대로 본다 (잠금이 모두를 막지 않음)
    {
      const MB = gasCtx(src);
      MB.post({ token: TK, action: 'mobile_pw', pw: 'secret12' }); MB.post({ token: TK, action: 'mobile', summary: JSON.stringify({ v: 1, kpi: {} }) });
      const first = MB.c.mobileData({ pw: 'secret12', keep: true }) || {};
      ok('맞는 비밀번호 + 기억 → 요약과 이 휴대폰의 열쇠 (비밀번호 대신 기억)', first.ok === true && /^[0-9a-f]{64}$/.test(String(first.dev || '')), first);
      for (let i = 0; i < 12; i++) MB.c.mobileData({ pw: 'wrong' + i });
      eq('누가 10번 넘게 틀리면 비밀번호로는 잠김 (WAIT)', (MB.c.mobileData({ pw: 'secret12' }) || {}).error, 'WAIT');
      ok('기억해 둔 휴대폰은 잠긴 동안에도 바로 보임', (MB.c.mobileData({ dev: first.dev }) || {}).ok === true);
      eq('없는 열쇠 → BAD_DEV', (MB.c.mobileData({ dev: 'f'.repeat(64) }) || {}).error, 'BAD_DEV');
      ok('열쇠는 해시로만 저장 (원문 없음)', !!first.dev && !Array.from(MB.props.values()).some(v => String(v).includes(first.dev)));
      MB.post({ token: TK, action: 'mobile_pw', pw: 'newpass99' });
      eq('비밀번호를 바꾸면 기억해 둔 휴대폰도 다시 넣어야 함', (MB.c.mobileData({ dev: first.dev }) || {}).error, 'BAD_DEV');
      ok('옛 휴대폰 화면 (비밀번호 글자만 보냄) 도 그대로', (MB.c.mobileData('newpass99') || {}).ok === true);
    }

    // ④ 구글 속성 한도 (값 하나 9KB, 바이트): 한국어 머리글이 아주 많은 표도 저장이 실패하지 않고, 같은 묶음의 다른 표도 저장된다
    {
      const PB = gasCtx(src);
      const wide = { title: '넓은 표', ord: 0, cols: Array.from({ length: 150 }, (_, i) => ({ k: 'c' + i, h: '한국어머리글이름가나다라마바사' + i, t: 't' })) };
      const ls = JSON.stringify(wide);
      ok('시험 준비: 머리글 글자 수는 8,500 미만 · UTF-8 은 9KB 넘음', ls.length < 8500 && Buffer.byteLength(ls, 'utf8') > 9216, [ls.length, Buffer.byteLength(ls, 'utf8')]);
      const r = PB.post({ token: TK, action: 'cloud_put', tables: { po: { base: 0, b64: gz([{ _id: 'a', c1: 'x' }]), n: 1, sheet: wide }, items: { base: 0, b64: gz([{ _id: 'b', code: 'A' }]), n: 1 } } });
      ok('저장은 됨 (두 표 모두 번호 1) · 속성은 9KB 안', r.ok === true && !!r.vers && r.vers.po === 1 && r.vers.items === 1 && Buffer.byteLength(PB.props.get('L_po') || '', 'utf8') <= 9216, r);
      const s = PB.post({ token: TK, action: 'cloud_sheet' });
      ok('그 표의 탭도 시트에 씀 (탭 이름 그대로)', s.ok === true && (s.written || []).includes('po') && !!PB.book.tab('넓은 표'), { s, names: PB.book.names() });
    }

    // ⑤ 구글 시트 탭 이름: 같은 이름의 탭이 이미 있으면 "(ERP)" → "(ERP 2)" … · 아주 긴 이름이어도 멈추지 않음 (100자 안)
    {
      const TB = gasCtx(src); const ssT = TB.c.SpreadsheetApp.getActiveSpreadsheet();
      ssT.insertSheet('창고'); ssT.insertSheet('창고 (ERP)'); ssT.insertSheet('가'.repeat(90));
      TB.post({ token: TK, action: 'cloud_put', tables: { po: { base: 0, b64: gz([{ _id: 'p', po_no: 'P' }]), n: 1, sheet: { title: '가'.repeat(95), ord: 0, cols: [] } },
        warehouses: { base: 0, b64: gz([{ _id: 'w', code: 'W' }]), n: 1, sheet: { title: '창고', ord: 1, cols: [] } } } });
      let res = null, err = null;
      try { res = JSON.parse(vm.runInContext("JSON.stringify(cloud_({ action: 'cloud_sheet', all: false }))", TB.c, { timeout: 8000 })); } catch (e) { err = String((e && e.message) || e); }
      const names = TB.book.names();
      ok('아주 긴 이름의 탭이 이미 있어도 멈추지 않고 새 탭 ("… (ERP)", 100자 안)', !err && !!res && (res.written || []).includes('po') && names.some(n => /\(ERP\)$/.test(n) && n.length <= 100 && n.indexOf('가'.repeat(20)) === 0), { err, names });
      ok('"창고" · "창고 (ERP)" 가 이미 있으면 "창고 (ERP 2)"', names.includes('창고 (ERP 2)'), names);
    }

    // ⑥ [구글 시트 다시 쓰기] 를 누른 순간 인터넷이 끊겨도, 다시 되면 저절로 모든 탭을 다시 쓴다 (요청이 사라지지 않음)
    {
      const GR = keep(await fakeGoogle(src), googles); const bkR = GR.gas.book;
      const R = keep(await startPc(tmp('erp-v18-r-'), { cloudSheet: 100, cloudSheetLag: 0, cloudSheetRetry: 300 }), servers);
      await ownerData(R); await capi(R, 'connect', { url: GR.url, token: TK, mode: 'upload' });
      const idleR = () => waitFor(async () => { const s = (await stat(R)).sheet || {}; return !s.busy && !s.queued; });
      ok('시험 준비: 올린 뒤 수주 탭', await waitFor(() => !!bkR.tab('수주 (PO)')) && await idleR(), bkR.names());
      bkR.tab('수주 (PO)').getRange(2, 1, 1, 1).setValues([['손으로 고침']]);
      GR.down = true;
      const rw = await req(R.port, 'POST', '/api/cloud/sheet', {});
      const failed = await waitFor(async () => ((await stat(R)).sheet || {}).code === 'NET', 5000);
      GR.down = false;
      const fixed = await waitFor(() => bkR.tab('수주 (PO)').table()[1][0] !== '손으로 고침', 6000);
      ok('끊긴 동안 누른 [구글 시트 다시 쓰기] → 실패 표시 → 다시 되면 저절로 모든 탭을 다시 씀 (손으로 고친 칸도)', rw.status === 200 && failed && fixed,
        { failed, fixed, st: (await stat(R)).sheet, cell: bkR.tab('수주 (PO)').table()[1] });
      await capi(R, 'off');
    }
  });

  // ------------------------------------------------------------------------------------------
  await sec('12. 정리 (1.13.4) — 합치기 코드 하나 · 서버 오류 글 한국어 · 저장마다 폴더를 훑지 않음', async () => {
    const src = fs.readFileSync(CODE_FILE, 'utf8').replace("var TOKEN = 'CHANGE-ME';", "var TOKEN = '" + TK + "';");
    const hasKo = (s) => /[가-힣]/.test(String(s || '')), hasVi = (s) => /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(String(s || ''));
    const clone = (v) => JSON.parse(JSON.stringify(v));

    // ⑦ 행 합치기 · 지문 · _id 맞추기는 app/js/merge.js 하나 — 화면 (db.js) 과 서버 (cloudsync.js) 가 같은 입력에 같은 결과
    {
      const csSrc = fs.readFileSync(path.join(ROOT, 'cloudsync.js'), 'utf8'), dbSrc = fs.readFileSync(path.join(ROOT, 'app', 'js', 'db.js'), 'utf8');
      ok('app/js/merge.js 하나: cloudsync.js 가 그것을 쓰고, db.js · cloudsync.js 에 따로 만든 merge3 · ensureIds · hash 없음 · index.html 이 db.js 바로 앞에서 부름',
        fs.existsSync(path.join(ROOT, 'app', 'js', 'merge.js')) && /require\('\.\/app\/js\/merge\.js'\)/.test(csSrc) && !/function (merge3|ensureIds|hash)\(/.test(csSrc) && !/function (merge3|ensureIds|hash)\(/.test(dbSrc)
        && /<script src="js\/merge\.js"><\/script>\s*<script src="js\/db\.js"><\/script>/.test(fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8')));
      // 이 PC 만 고침 (a) · 다른 쪽만 고침 (b) · 이 PC 가 지우고 다른 쪽이 고침 (c) · 양쪽에 새로 생긴 같은 _id (n — 저장 답을 못 받은 경우, 겹침이 아님)
      const CASE = { base: [{ _id: 'a', v: 1 }, { _id: 'b', v: 1 }, { _id: 'c', v: 1 }], local: [{ _id: 'a', v: 2 }, { _id: 'b', v: 1 }, { _id: 'n', v: 'L' }],
        remote: [{ _id: 'a', v: 1 }, { _id: 'b', v: 5 }, { _id: 'c', v: 9 }, { _id: 'n', v: 'R' }] };
      const ssig = (r) => CS.hash(JSON.stringify(r));
      const sm = CS.merge3(new Map(CASE.base.map(r => [r._id, ssig(r)])), clone(CASE.local), clone(CASE.remote));
      const srv = { rows: sm.rows.map(r => r._id + ':' + r.v), conflicts: sm.conflicts };
      const P = keep(await startPc(tmp('erp-v18-d-')), servers); await ownerData(P);
      await putT(P, 'returns', [{ _id: 'r1', code: 'A-1', qty: 1 }, { _id: 'r1', code: 'A-2', qty: 2 }]);
      const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
      try {
        const pg = await (await browser.newContext()).newPage(); pg.on('pageerror', e => errors.push('pageerror: ' + e.message));
        await pg.goto(P.url + '/#/settings'); await pg.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready, null, { timeout: 120000 });
        const scr = await pg.evaluate((C) => { const sig = ERP.db._sigOf; const m = ERP.db._merge3(new Map(C.base.map(r => [r._id, sig(r)])), JSON.parse(JSON.stringify(C.local)), JSON.parse(JSON.stringify(C.remote)));
          return { rows: m.rows.map(r => r._id + ':' + r.v), conflicts: m.conflicts }; }, CASE);
        eq('같은 입력 → 화면 · 서버의 합치기 결과가 같음 (행 · 겹침 수 — 양쪽에 새로 생긴 같은 _id 는 겹침이 아님)', [scr, srv], [{ rows: ['a:2', 'b:5', 'c:9', 'n:L'], conflicts: 1 }, { rows: ['a:2', 'b:5', 'c:9', 'n:L'], conflicts: 1 }]);
        const di = await pg.evaluate(async () => { const before = ERP.db.rows('returns').map(r => r._id); ERP.db.update('returns', 'r1~1', { qty: 5 }); await ERP.db.flush(); return before; });
        const f = await getT(P, 'returns');
        ok('같은 _id 두 행: 화면도 서버처럼 r1 · r1~1 로 나누고, 둘째 행만 고쳐 저장할 수 있음', di.join() === 'r1,r1~1' && f.length === 2 && (byId(f, 'r1') || {}).qty === 1 && (byId(f, 'r1~1') || {}).qty === 5, { di, f });
      } finally { await browser.close(); }
    }

    // ⑧ 서버가 화면에 보내는 오류 글 = 한국어 · 베트남어 (화면 글자 규칙과 같음)
    {
      const E = keep(await startPc(tmp('erp-v18-e-')), servers);
      await req(E.port, 'PUT', '/api/lan/pin', { pin: '2468' });
      const L2 = { localAddress: '127.0.0.2' };
      const lg = await req(E.port, 'POST', '/api/login', { pin: '2468' }, L2);
      const o = Object.assign({ cookie: String((lg.headers['set-cookie'] || [''])[0]).split(';')[0] }, L2);
      const rs = [await req(E.port, 'PUT', '/api/lan/pin', { pin: '1234' }, o), await req(E.port, 'PUT', '/api/backup', { dir: 'C:\\x' }, o),
        await req(E.port, 'POST', '/api/cloud/connect', { url: 'x', token: 'y', mode: 'upload' }, o), await req(E.port, 'PUT', '/api/ai/config', { key: 'k' }, o),
        await req(E.port, 'PUT', '/api/lan/pin', { pin: '12' }), await req(E.port, 'POST', '/api/gproxy', { url: 'https://example.com/x', body: '{}' })];
      const got = rs.map(r => [r.status, r.json && r.json.error]);
      ok('오류 글: ERP 가 실행 중인 PC 에서만 (PIN · 자동 백업 · 공유 연결 · AI 키) · PIN 형식 · Apps Script 주소만 — 한국어 · 베트남어 둘 다',
        JSON.stringify(got.map(g => g[0])) === '[403,403,403,403,400,400]' && got.every(g => hasKo(g[1]) && hasVi(g[1])), got);
    }

    // ⑨ 저장할 때마다 하루 백업 폴더를 정리 (readdir) 하지 않고, 공유 상태를 물을 때마다 표 폴더를 읽지 않는다
    {
      const GE = keep(await fakeGoogle(src), googles);
      const dE = tmp('erp-v18-f-'); const F = keep(await startPc(dE), servers); await ownerData(F);
      await capi(F, 'connect', { url: GE.url, token: TK, mode: 'upload' });
      const rd = fs.readdirSync, bdir = path.join(dE, 'backup'), tdir = path.join(dE, 'tables'); let nB = 0, nT = 0;
      fs.readdirSync = function (p) { const s = path.resolve(String(p)); if (s === bdir) nB++; if (s === tdir) nT++; return rd.apply(fs, arguments); };
      let st = null;
      try {
        for (let i = 0; i < 20; i++) await putT(F, 'returns', [{ _id: 'rt', code: 'A', qty: i }]);
        for (let i = 0; i < 20; i++) st = await stat(F);
      } finally { fs.readdirSync = rd; }
      ok('표를 20번 저장해도 하루 백업 폴더 정리는 한 번 (예전: 저장마다)', nB <= 1, nB);
      ok('공유 상태를 20번 물어도 표 폴더를 읽지 않음 · 보낼 것 있음은 그대로 (예전: 물을 때마다 폴더)', nT === 0 && st && st.pending === true, { nT, pending: st && st.pending });
      const days = fs.readdirSync(bdir).filter(x => /^\d{4}-\d\d-\d\d$/.test(x));
      ok('하루 백업은 그대로 (그날 처음 저장하기 전 내용)', days.length === 1 && JSON.stringify(JSON.parse(fs.readFileSync(path.join(bdir, days[0], 'returns.json'), 'utf8'))) === '[]', days);
      await capi(F, 'off');
    }
  });

  ok('화면 오류 없음', !errors.length, errors.slice(0, 6));
  servers.forEach(s => { try { s.close(); } catch (e) { /* 이미 닫힘 */ } }); googles.forEach(g => { try { g.close(); } catch (e) { /* 이미 닫힘 */ } });
  console.log('\n' + (fail ? '✗ 실패 ' + fail + '건' : '✓ 모두 통과') + '  (통과 ' + pass + ' / 전체 ' + (pass + fail) + ')');
  if (fail) { console.log('실패 목록:'); failures.forEach(f => console.log(' - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
