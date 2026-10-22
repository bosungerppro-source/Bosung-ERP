/**
 * ColorPencil ERP  ·  Google Sheets / Drive bridge (Apps Script web app)  — 5판 (v1.13.1)
 * 설치 (ERP → 엑셀 · 구글 연동 → 구글 시트 · 드라이브 → "여러 PC 자료 공유" 카드의 순서와 같다):
 *   1) ERP 의 [Apps Script 코드 복사] — 이 코드에 비밀 키(TOKEN)를 넣어서 복사해 준다
 *   2) 새 구글 시트 (sheets.new) > 확장 프로그램 > Apps Script > 원래 코드를 모두 지우고 붙여넣기 > 저장
 *   3) 배포 > 새 배포 > 유형 선택(톱니바퀴) > 웹 앱 (다음 사용자 인증 정보로 실행: 나, 액세스 권한이 있는 사용자: 모든 사용자) > 배포 > 액세스 승인
 *   4) 웹 앱 URL 을 ERP 에 붙여넣고 [연결 확인]
 *   (이 파일을 직접 붙여넣을 때는 아래 TOKEN 을 16자 이상 아무 글자로 바꾸고 ERP 의 TOKEN 칸에도 같은 값을 넣는다. 'CHANGE-ME' 그대로는 받지 않는다)
 *   (이미 배포했으면: 코드를 바꾼 뒤 배포 > 배포 관리 > 수정(연필) > 버전: 새 버전 > 배포 — 주소는 그대로)
 * Cài đặt: ERP > [Sao chép mã Apps Script] (đã có TOKEN) > Google Sheet mới > Tiện ích mở rộng > Apps Script > dán mã > Lưu
 *          > Triển khai (Deploy) > Bản triển khai mới > Ứng dụng web (Thực thi: Tôi, Truy cập: Bất kỳ ai / Anyone) > dán URL vào ERP > [Kiểm tra kết nối].
 * 5판: 여러 PC 자료 공유 — PC 마다 ERP 가 바뀐 표만 주고받는다. 표 하나 = 드라이브 폴더 'ColorPencil ERP Data' 의 파일 하나
 *      (ERP 가 보낸 gzip + base64 글자 그대로), 저장 번호는 스크립트 속성. 합치기(행 단위)는 ERP 가 한다. 시트 없이 만든 스크립트에서도 된다.
 * 4판: 휴대폰 보기 — 같은 웹 앱 주소를 휴대폰 브라우저로 열면 ERP 가 보낸 요약(종합 현황 · 생산 관리)을 비밀번호로 본다.
 *      (ERP 1.12.3 · 1.12.4: '이번 달 포장 누계' 를 pcs 로, 지난달 누계도 — 이미 배포했다면 이 코드를 다시 붙여넣고 새 버전으로 배포하면 pcs 로 보인다. 예전 코드도 그대로 쓸 수 있다: 세트로 보임)
 *      비밀번호는 ERP 설정 → 휴대폰으로 보기에서 정한다 (여기에는 해시로만 저장). Apps Script 기본(V8) 실행 환경이 필요하다.
 */
var TOKEN = 'CHANGE-ME';            // <-- ERP 의 [Apps Script 코드 복사] 가 채운다 / ERP điền sẵn
var SNAPSHOT_FOLDER = 'ColorPencil ERP Backup';  // Drive folder for snapshots
var MOBILE_FILE = 'ERP_mobile.json';             // 4판: 휴대폰 요약 (SNAPSHOT_FOLDER 안)
var DATA_FOLDER = 'ColorPencil ERP Data';        // 5판: 여러 PC 자료 공유 (표마다 파일 하나)

// 4판: 브라우저로 열면 휴대폰 화면 (?ping=1 이면 예전처럼 상태 JSON)
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.ping) return out_({ ok: true, app: 'colorpencil-erp-bridge', ver: 5, time: new Date().toISOString() });
  return HtmlService.createHtmlOutput(MOBILE_HTML_).setTitle('ColorPencil ERP')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    if (TOKEN === 'CHANGE-ME' || req.token !== TOKEN) return out_({ ok: false, error: 'bad token' });
    if (/^cloud_/.test(String(req.action))) return out_(cloud_(req));   // 5판: 시트가 없어도 된다
    var ss = SpreadsheetApp.getActiveSpreadsheet();                   // 시트 없이 만든 스크립트(독립형)는 null
    if (!ss && { list: 1, put: 1, get: 1, snapshot: 1 }[req.action]) return out_({ ok: false, error: 'no spreadsheet — 구글 시트의 확장 프로그램 > Apps Script 에서 만든 스크립트에서만 됩니다' });
    switch (req.action) {
      case 'ping': return out_({ ok: true, ver: 5, sheet: ss ? ss.getName() : '', url: ss ? ss.getUrl() : '' });
      case 'list': return out_({ ok: true, tables: list_(ss) });
      case 'put': return out_(put_(ss, req));
      case 'get': return out_(get_(ss, req));
      case 'snapshot': return out_(snapshot_(ss, req));
      case 'backup': return out_(backup_(req));
      case 'mobile': return out_(mobile_(req));
      case 'mobile_pw': return out_(mobilePw_(req));
      default: return out_({ ok: false, error: 'unknown action' });
    }
  } catch (err) { return out_({ ok: false, error: String(err) }); }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function sheet_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

function list_(ss) {
  return ss.getSheets().map(function (s) { return { name: s.getName(), rows: Math.max(0, s.getLastRow() - 1) }; });
}

// put: {table, cols:[keys], types:['t'|'n'|'d'|...], rows:[[...]], first:true|false}   first=true clears the sheet before writing
// 2판: 숫자(n) · 참거짓(b) 이 아닌 열은 일반 텍스트(@) 형식으로 먼저 바꾼 뒤 쓴다 → 0414210300 · 523034E200 · 2026-6 같은 코드가 숫자 · 날짜로 바뀌지 않는다
function put_(ss, req) {
  var s = sheet_(ss, req.table);
  if (req.first) { s.clear(); s.getRange(1, 1, 1, req.cols.length).setValues([req.cols]).setFontWeight('bold'); s.setFrozenRows(1); }
  var rows = req.rows || [];
  if (rows.length) {
    var start = s.getLastRow() + 1;
    if (s.getMaxRows() < start + rows.length) s.insertRowsAfter(s.getMaxRows(), start + rows.length - s.getMaxRows());
    if (s.getMaxColumns() < req.cols.length) s.insertColumnsAfter(s.getMaxColumns(), req.cols.length - s.getMaxColumns());
    var types = req.types || [];
    var fmt = req.cols.map(function (c, i) { return types[i] === 'n' || types[i] === 'b' ? 'General' : '@'; });
    var rg = s.getRange(start, 1, rows.length, req.cols.length);
    rg.setNumberFormats(rows.map(function () { return fmt; }));
    rg.setValues(rows);
  }
  return { ok: true, written: rows.length };
}

// get: {table, offset, limit} -> {cols, rows, total}
function get_(ss, req) {
  var s = ss.getSheetByName(req.table);
  if (!s || s.getLastRow() < 1) return { ok: true, cols: [], rows: [], total: 0 };
  var nc = s.getLastColumn(), total = s.getLastRow() - 1;
  var cols = s.getRange(1, 1, 1, nc).getValues()[0];
  var off = req.offset || 0, lim = Math.min(req.limit || 3000, total - off);
  var tz = ss.getSpreadsheetTimeZone();
  var vals = lim > 0 ? s.getRange(2 + off, 1, lim, nc).getValues() : [];
  vals = vals.map(function (r) { return r.map(function (v) {
    if (v instanceof Date) return v.getFullYear() < 1950 ? Utilities.formatDate(v, tz, 'HH:mm') : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    return v === '' ? null : v; }); });
  return { ok: true, cols: cols, rows: vals, total: total };
}

function folder_() {
  var it = DriveApp.getFoldersByName(SNAPSHOT_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(SNAPSHOT_FOLDER);
}

// snapshot: copies the whole spreadsheet into a Drive folder
function snapshot_(ss, req) {
  var folder = folder_();
  var name = 'ERP_' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyyMMdd_HHmm');
  var f = DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  return { ok: true, name: name, url: f.getUrl() };
}

// 3판: backup: {name:'ERP_backup_YYYY-MM-DD.json.gz', b64, keep} — ERP(설치형)가 매일 보내는 전체 자료 압축본을 Drive 폴더에 저장.
// 같은 이름(같은 날)은 바꾸고, 가장 최근 keep 개만 남긴다 (나머지는 휴지통). 복원: 내려받아 ERP → 백업 / 복원 에서 .json.gz 그대로 선택
var BACKUP_RE = /^ERP_backup_\d{4}-\d\d-\d\d\.json\.gz$/;
function backup_(req) {
  var name = String(req.name || '');
  if (!BACKUP_RE.test(name) || !req.b64) return { ok: false, error: 'bad backup request' };
  var folder = folder_();
  var same = folder.getFilesByName(name);
  while (same.hasNext()) same.next().setTrashed(true);
  var blob = Utilities.newBlob(Utilities.base64Decode(req.b64), 'application/gzip', name);
  var f = folder.createFile(blob);
  var keep = Math.max(3, Math.min(365, Number(req.keep) || 30)), files = [], all = folder.getFiles();
  while (all.hasNext()) { var x = all.next(); if (BACKUP_RE.test(x.getName())) files.push(x); }
  files.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
  for (var i = keep; i < files.length; i++) files[i].setTrashed(true);
  return { ok: true, name: name, url: f.getUrl(), size: blob.getBytes().length };
}

// ---------------------------------------------------------------- 5판: 여러 PC 자료 공유
// 표마다 스크립트 속성 T_<표> = {v: 저장 번호, f: 드라이브 파일 id, s: 글자 수, n: 행 수, at: 저장 시각}, 파일 = DATA_FOLDER/<표>.json.gz.b64.
// cloud_info {} → {cid, tables: {표: {v, s, n, at}}}   (cid = 이 저장소의 이름표 — 주소가 바뀌어도 같은 저장소인지 ERP 가 안다)
// cloud_get {names: [표]} → {tables: {표: {v, b64}}}
// cloud_put {tables: {표: {base, b64, n}}} → {vers: {표: 새 번호}, conflicts: {표: 지금 번호}}
//   ERP 가 마지막으로 본 번호(base)가 지금 번호와 같을 때만 쓴다. 다르면 다른 PC 가 먼저 쓴 것 → ERP 가 받아서 합친 뒤 다시 보낸다.
//   쓰기는 잠금(LockService) 안에서 파일을 먼저 쓰고 번호를 올린다 → 읽기는 잠금 없이 해도 번호보다 옛 내용을 받지 않는다.
// 번호 목록(cloud_info 의 답)은 스크립트 캐시에 10분 둔다 (1.13.1) — PC 여러 대가 30초마다 물어도 스크립트 속성의 하루 한도(읽기 · 쓰기 5만 번)를 쓰지 않게.
//   캐시를 채우고 바꾸는 것은 언제나 잠금 안에서 속성을 읽은 뒤 (쓰기 사이에 옛 목록이 끼지 않게). 캐시에 못 쓰면 지워서 다음 물음은 속성에서 읽는다.
var NAME_RE_ = /^[A-Za-z0-9_]{1,40}$/;
var IDX_KEY_ = 'CLOUD_IDX', IDX_TTL_ = 600;
function cloud_(req) {
  if (req.action === 'cloud_info') {
    var hit = null; try { hit = JSON.parse(CacheService.getScriptCache().get(IDX_KEY_) || 'null'); } catch (e) { hit = null; }
    if (hit && hit.cid) return { ok: true, ver: 5, cid: hit.cid, tables: hit.tables || {}, at: new Date().toISOString() };
  }
  var props = PropertiesService.getScriptProperties(), p;
  if (req.action === 'cloud_get') { p = props.getProperties(); return { ok: true, cid: p.CLOUD_ID || '', tables: cloudGet_(p, req.names || []) }; }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    p = props.getProperties();
    if (!p.CLOUD_ID) { p.CLOUD_ID = Utilities.getUuid(); props.setProperty('CLOUD_ID', p.CLOUD_ID); }
    if (req.action === 'cloud_put') {
      try { return cloudPut_(props, p, req.tables || {}); } finally { cacheIdx_(p); }   // 몇 표만 쓰고 멈춰도 캐시 = 속성
    }
    cacheIdx_(p);
    if (req.action === 'cloud_info') return { ok: true, ver: 5, cid: p.CLOUD_ID, tables: cloudTables_(p), at: new Date().toISOString() };
    return { ok: false, error: 'unknown action' };
  } finally { lock.releaseLock(); }
}
function cacheIdx_(p) {
  var c = CacheService.getScriptCache();
  try { c.put(IDX_KEY_, JSON.stringify({ cid: p.CLOUD_ID, tables: cloudTables_(p) }), IDX_TTL_); } catch (e) { try { c.remove(IDX_KEY_); } catch (e2) { /* 없음 */ } }
}
function cloudMeta_(p, n) { try { return JSON.parse(p['T_' + n] || 'null'); } catch (e) { return null; } }
function cloudTables_(p) {
  var t = {};
  Object.keys(p).forEach(function (k) {
    if (k.indexOf('T_') !== 0) return;
    var x = cloudMeta_(p, k.slice(2)); if (x) t[k.slice(2)] = { v: x.v, s: x.s, n: x.n, at: x.at };
  });
  return t;
}
function cloudGet_(p, names) {
  var out = {};
  names.forEach(function (n) {
    n = String(n); if (!NAME_RE_.test(n)) return;
    var x = cloudMeta_(p, n);
    out[n] = x && x.f ? { v: x.v, b64: DriveApp.getFileById(x.f).getBlob().getDataAsString() } : { v: 0, b64: '' };
  });
  return out;
}
function cloudPut_(props, p, tables) {
  var vers = {}, conflicts = {}, folder = null, now = new Date().toISOString();
  Object.keys(tables).forEach(function (n) {
    if (!NAME_RE_.test(n)) return;
    var x = cloudMeta_(p, n), cur = x ? Number(x.v) || 0 : 0, t = tables[n] || {};
    if (Number(t.base) !== cur) { conflicts[n] = cur; return; }
    var b64 = String(t.b64 || ''), f = null;
    if (x && x.f) { try { f = DriveApp.getFileById(x.f); if (f.isTrashed()) f = null; } catch (e) { f = null; } }
    if (f && b64.length <= 9000000) f.setContent(b64);                 // 같은 파일을 고쳐 쓴다 (setContent 는 10MB 까지)
    else {
      folder = folder || dataFolder_();
      var nf = folder.createFile(Utilities.newBlob(b64, 'text/plain', n + '.json.gz.b64'));
      if (f) f.setTrashed(true);
      f = nf;
    }
    var nx = { v: cur + 1, f: f.getId(), s: b64.length, n: Number(t.n) || 0, at: now };
    props.setProperty('T_' + n, JSON.stringify(nx)); p['T_' + n] = JSON.stringify(nx);
    vers[n] = nx.v;
  });
  return { ok: true, vers: vers, conflicts: conflicts };
}
function dataFolder_() {
  var it = DriveApp.getFoldersByName(DATA_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DATA_FOLDER);
}

// ---------------------------------------------------------------- 4판: 휴대폰 보기
// mobile: {summary: '<JSON 문자열>'} — ERP 가 15분마다 보내는 요약. 드라이브 폴더의 ERP_mobile.json 하나에 덮어쓴다
function mobile_(req) {
  var s = String(req.summary || '');
  if (!s || s.length > 2000000) return { ok: false, error: 'bad summary' };
  JSON.parse(s);
  var folder = folder_(), it = folder.getFilesByName(MOBILE_FILE);
  if (it.hasNext()) it.next().setContent(s); else folder.createFile(MOBILE_FILE, s, 'application/json');
  return { ok: true, at: new Date().toISOString(), size: s.length };
}
// mobile_pw: {pw} — 휴대폰 보기 비밀번호 (빈 값 = 끄기). 소금 + SHA-256 해시로만 둔다
function mobilePw_(req) {
  var props = PropertiesService.getScriptProperties(), pw = String(req.pw || '');
  if (!pw) { props.deleteProperty('MOBILE_HASH'); props.deleteProperty('MOBILE_SALT'); return { ok: true, on: false }; }
  if (pw.length < 6 || pw.length > 32) return { ok: false, error: 'password: 6~32' };
  var salt = Utilities.getUuid();
  props.setProperties({ MOBILE_SALT: salt, MOBILE_HASH: hash_(salt, pw) });
  CacheService.getScriptCache().remove('mfail');
  return { ok: true, on: true };
}
function hash_(salt, pw) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pw, Utilities.Charset.UTF_8)
    .map(function (b) { var x = (b + 256) % 256; return (x < 16 ? '0' : '') + x.toString(16); }).join('');
}
// 휴대폰 화면이 부른다 (google.script.run). 10번 틀리면 10분 잠금
function mobileData(pw) {
  var props = PropertiesService.getScriptProperties(), hash = props.getProperty('MOBILE_HASH'), salt = props.getProperty('MOBILE_SALT');
  if (!hash || !salt) return { ok: false, error: 'NO_PW' };
  var cache = CacheService.getScriptCache(), fails = Number(cache.get('mfail') || 0);
  if (fails >= 10) return { ok: false, error: 'WAIT' };
  if (hash_(salt, String(pw || '')) !== hash) { cache.put('mfail', String(fails + 1), 600); return { ok: false, error: 'BAD_PW' }; }
  var it = folder_().getFilesByName(MOBILE_FILE);
  if (!it.hasNext()) return { ok: false, error: 'NO_DATA' };
  return { ok: true, data: it.next().getBlob().getDataAsString('UTF-8') };
}

// 휴대폰 화면 (글자는 모두 textContent 로 넣는다)
var MOBILE_HTML_ = `<!doctype html><html><head><base target="_top"><meta charset="utf-8">
<style>
*{box-sizing:border-box}body{margin:0;background:#F2F3F5;color:#1B1F24;font:400 15px/1.45 'Malgun Gothic','Segoe UI','Noto Sans KR',system-ui,sans-serif;font-variant-numeric:tabular-nums}
header{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1E2329;color:#E6E9ED}
header b{font-size:15px}header .sp{flex:1}button{font:inherit;cursor:pointer}
.lg button{min-height:32px;padding:0 9px;border-radius:7px;border:1px solid #3A434E;background:transparent;color:#C9CFD6;font-weight:600;font-size:13px}.lg button.on{background:#F2C531;color:#1B1F24;border-color:#F2C531}
main{padding:12px 10px 30px;display:flex;flex-direction:column;gap:12px;max-width:760px;margin:0 auto}
.card{background:#fff;border:1px solid #DDE0E5;border-radius:12px;padding:12px 14px;min-width:0}.card h2{margin:0 0 10px;font-size:16px}.card h3{margin:12px 0 6px;font-size:14px;color:#5B6470}
.kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.k{border:1px solid #EEF0F3;border-radius:10px;padding:8px 10px;min-width:0}
.k .t{font-size:12px;color:#5B6470}.k .v{font-size:22px;font-weight:700;line-height:1.2}.k .u{font-size:12px;color:#5B6470;margin-left:3px}.k .n{font-size:12px;color:#5B6470}
.bad{color:#B3261E}.warn{color:#C77700}.ok{color:#0E7A5F}.muted{color:#5B6470;font-size:13px}
.row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #EEF0F3}.row:first-child{border-top:0}.row .r{text-align:right;white-space:nowrap}
.chip{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#EEF0F3}.chip.bad{background:#FBE6E4}.chip.warn{background:#FCEFD9}.chip.ok{background:#E2F4EE}
.tw{overflow-x:auto;border:1px solid #EEF0F3;border-radius:8px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:6px 8px;border-bottom:1px solid #EEF0F3;white-space:nowrap;text-align:right}th{background:#F7F8FA;color:#5B6470;font-weight:600;font-size:12px}td:first-child,th:first-child{text-align:left;position:sticky;left:0;background:#fff}th:first-child{background:#F7F8FA}
input{font:inherit;min-height:42px;padding:0 12px;border:1px solid #C9CFD6;border-radius:9px;width:100%}.btn{min-height:42px;padding:0 16px;border:1px solid #C9CFD6;border-radius:9px;background:#fff;font-weight:600}.btn.p{background:#1F5FBF;border-color:#1F5FBF;color:#fff}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
</style></head><body>
<header><b>ColorPencil ERP</b><span class="sp"></span><span class="lg"><button type="button" data-l="ko">한국어</button><button type="button" data-l="vi">Tiếng Việt</button></span></header>
<main id="m"></main>
<script>
(function () {
  var LS = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* 없음 */ } } };
  var lang = LS.get('erpm_lang') === 'vi' ? 'vi' : 'ko', pw = LS.get('erpm_pw') || '', data = null, msg = '';
  var m = document.getElementById('m');
  function L(ko, vi) { return lang === 'vi' ? vi : ko; }
  function el(tag, cls, kids) { var e = document.createElement(tag); if (cls) e.className = cls; (kids || []).forEach(function (c) { if (c === null || c === undefined || c === false) return; e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c))); }); return e; }
  function n(v, d) { if (v === null || v === undefined || isNaN(Number(v))) return '–'; return Number(v).toLocaleString(lang === 'vi' ? 'vi-VN' : 'ko-KR', { maximumFractionDigits: d || 0 }); }
  function pn(p) { return lang === 'vi' ? (p.vi || p.ko || p.id) : (p.ko || p.id); }
  function un(p) { return p.unit === 'set' ? L('세트', 'bộ') : 'pcs'; }
  function md(d) { return String(d || '').slice(5).replace('-', '/'); }
  function hm(s) { var t = new Date(s); if (isNaN(t)) return '–'; var p = function (x) { return (x < 10 ? '0' : '') + x; }; return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) + ' ' + p(t.getHours()) + ':' + p(t.getMinutes()); }
  function ago(s) { var t = Date.parse(s); if (!t) return ''; var mi = Math.round((Date.now() - t) / 60000); return mi < 1 ? L('방금', 'vừa xong') : mi < 60 ? mi + L('분 전', ' phút trước') : Math.round(mi / 60) + L('시간 전', ' giờ trước'); }
  function pct(a, b) { if (!b) return '–'; var x = (a / b - 1) * 100; return (x >= 0 ? '▲ ' : '▼ ') + n(Math.abs(x)) + '%'; }
  function kpi(t, v, u, note, tone) { return el('div', 'k', [el('div', 't', [t]), el('div', '', [el('span', 'v' + (tone ? ' ' + tone : ''), [v]), el('span', 'u', [u])]), el('div', 'n', [note])]); }
  function chipD(dd, st) { if (st === 'late' || dd < 0) return el('span', 'chip bad', [L('지연 ' + (-dd) + '일', 'Trễ ' + (-dd) + ' ngày')]); if (dd === 0) return el('span', 'chip bad', ['D-Day']); return el('span', 'chip' + (dd <= 3 ? ' warn' : ''), ['D-' + dd]); }
  function call(p, ok, bad) { google.script.run.withSuccessHandler(ok).withFailureHandler(bad).mobileData(p); }
  function login(note) {
    var inp = el('input'); inp.type = 'password'; inp.autocomplete = 'current-password'; inp.placeholder = L('휴대폰 보기 비밀번호', 'Mật khẩu xem trên điện thoại');
    var keep = el('input'); keep.type = 'checkbox'; keep.checked = true; keep.style.width = 'auto'; keep.style.minHeight = '0';
    var go = el('button', 'btn p', [L('보기', 'Xem')]); go.type = 'button';
    var f = function () { if (!inp.value) return; go.disabled = true; load(inp.value, keep.checked); };
    go.onclick = f; inp.onkeydown = function (e) { if (e.key === 'Enter') f(); };
    m.replaceChildren(el('div', 'card', [el('h2', '', [L('휴대폰 보기', 'Xem trên điện thoại')]), el('p', 'muted', [L('ERP 설정 → 휴대폰으로 보기에서 정한 비밀번호를 넣으세요.', 'Nhập mật khẩu đã đặt ở ERP → Cài đặt → Xem trên điện thoại.')]),
      note ? el('p', 'bad', [note]) : null, inp, el('label', 'muted', [keep, ' ', L('이 휴대폰에서 기억', 'Ghi nhớ trên điện thoại này')]), el('div', 'bar', [go])]));
    inp.focus();
  }
  function errText(c) { return { BAD_PW: L('비밀번호가 맞지 않습니다', 'Sai mật khẩu'), WAIT: L('여러 번 틀려 10분 동안 잠겼습니다', 'Sai nhiều lần — khóa 10 phút'), NO_PW: L('아직 휴대폰 보기가 켜지지 않았습니다 (ERP 설정 → 휴대폰으로 보기)', 'Chưa bật xem trên điện thoại (ERP → Cài đặt)'), NO_DATA: L('아직 ERP 가 요약을 보내지 않았습니다', 'ERP chưa gửi tóm tắt') }[c] || String(c); }
  function load(p, keep) {
    m.replaceChildren(el('div', 'card', [el('p', 'muted', [L('불러오는 중…', 'Đang tải…')])]));
    call(p, function (r) {
      if (r && r.ok) { try { data = JSON.parse(r.data); } catch (e) { data = null; } pw = p; if (keep) LS.set('erpm_pw', p); show(); return; }
      if (r && r.error === 'BAD_PW') LS.set('erpm_pw', null);
      login(errText(r && r.error));
    }, function (e) { login(L('불러오지 못했습니다: ', 'Không tải được: ') + (e && e.message || e)); });
  }
  function show() {
    var d = data; if (!d || !d.kpi) { login(errText('NO_DATA')); return; }
    var k = d.kpi;
    var head = el('div', 'card', [el('div', 'bar', [el('b', '', [L('기준일 (생산일보) ', 'Ngày (báo cáo SX) ') + d.ref]), el('span', 'muted', [L('보낸 시각 ', 'Gửi lúc ') + hm(d.at) + ' · ' + ago(d.at)])]),
      el('div', 'bar', [btn(L('새로 고침', 'Làm mới'), function () { load(pw, !!LS.get('erpm_pw')); }), btn(L('잠그기', 'Khóa'), function () { LS.set('erpm_pw', null); pw = ''; data = null; login(''); })])]);
    var dash = el('div', 'card', [el('h2', '', [L('종합 현황', 'Tổng quan')]), el('div', 'kpis', [
      kpi(L('기준일 포장 실적', 'Đóng gói trong ngày'), n(k.pckDay.ok), L('세트', 'bộ'), k.pckDay.avgPct === null ? '' : k.pckDay.avgPct + L('% (최근 평균 대비)', '% so với TB'), k.pckDay.n ? (k.pckDay.avgPct >= 90 ? 'ok' : 'warn') : ''),
      // 1.12.3: 이번 달 포장 누계 = pcs (ERP 1.12.3 이상이 보낸 요약에 ea 가 있으면, 옛 요약은 세트)
      k.pckMonth.ea === undefined ? kpi(L('이번 달 포장 누계', 'Đóng gói lũy kế tháng'), n(k.pckMonth.ok), L('세트', 'bộ'), L('전월 동기 ', 'so cùng kỳ ') + pct(k.pckMonth.ok, k.pckMonth.prev))
        : kpi(L('이번 달 포장 누계', 'Đóng gói lũy kế tháng'), n(k.pckMonth.ea), 'pcs', L('전월 동기 ', 'so cùng kỳ ') + pct(k.pckMonth.ea, k.pckMonth.prevEa) + (k.pckMonth.noN ? L(' · pcs 없는 일보 ', ' · không có pcs ') + k.pckMonth.noN + L('줄', ' dòng') : '') + (k.pckMonth.lastEa === undefined ? '' : L(' · 지난달(', ' · tháng trước (T') + k.pckMonth.lastM + L('월) ', ') ') + n(k.pckMonth.lastEa) + ' pcs')),
      kpi(L('납기 임박 / 경과 PO', 'PO sắp / quá hạn'), n(k.due.soon + k.due.late), L('건', 'đơn'), L('경과 ', 'Quá hạn ') + k.due.late + L(' · 7일 내 ', ' · ≤7 ngày ') + k.due.soon, k.due.late ? 'bad' : (k.due.soon ? 'warn' : 'ok')),
      kpi(L('진행 중 PO', 'PO đang mở'), n(k.open.n), L('건', 'đơn'), L('생산 중 ', 'Đang SX ') + k.open.prod + L(' · 남은 ', ' · còn ') + n(k.open.rem) + ' set'),
      kpi(L('안전재고 미달 자재', 'NVL dưới tồn an toàn'), n(k.low), L('품목', 'mã'), '', k.low ? 'bad' : 'ok'),
      kpi(L('불량률 (기준일)', 'Tỷ lệ lỗi (ngày)'), k.ng.rate === null ? '–' : n(k.ng.rate * 100, 2), '%', L('불량 ', 'Lỗi ') + n(k.ng.ng) + ' / ' + n(k.ng.total), k.ng.rate === null ? '' : k.ng.rate >= 0.03 ? 'bad' : k.ng.rate >= 0.01 ? 'warn' : 'ok'),
      kpi(L('가동 설비', 'Máy chạy'), n(k.mach.run) + ' / ' + n(k.mach.tot), L('대', 'máy'), ''),
      kpi(L('마이너스 재고', 'Tồn âm'), n(k.neg.mat + k.neg.floor), L('품목', 'mã'), L('원부자재 ', 'NVL ') + k.neg.mat + L(' · 현장 ', ' · hiện trường ') + k.neg.floor, k.neg.mat + k.neg.floor ? 'bad' : 'ok')]),
      el('h3', '', [L('공정별 실적 · ', 'Theo công đoạn · ') + d.ref]),
      el('div', '', d.procs.map(function (p) { return el('div', 'row', [el('div', '', [el('b', '', [pn(p)]), el('div', 'muted', [L('설비 ', 'Máy ') + p.run + ' / ' + p.tot + (p.avgPct === null ? '' : L(' · 평균 대비 ', ' · so TB ') + p.avgPct + '%')])]), el('div', 'r', [el('b', '', [n(p.val)]), ' ' + un(p)])]); })),
      el('h3', '', [L('납기 임박 수주', 'PO sắp đến hạn')]),
      d.due.length ? el('div', '', d.due.map(function (o) { return el('div', 'row', [el('div', '', [el('b', '', [o.po]), el('div', 'muted', [[o.customer, o.item, o.kind].filter(Boolean).join(' · ')])]), el('div', 'r', [n(o.packed) + ' / ' + n(o.sets) + ' set', el('div', 'muted', [o.due]), chipD(o.dday, o.st)])]); })) : el('p', 'muted', [L('납기 임박 수주가 없습니다', 'Không có PO sắp đến hạn')]),
      el('h3', '', [L('안전재고 미달 자재', 'NVL dưới tồn an toàn')]),
      d.low.length ? el('div', '', d.low.map(function (s) { return el('div', 'row', [el('div', '', [el('b', '', [s.code]), el('div', 'muted', [s.name])]), el('div', 'r', [n(s.bal, 1) + ' ' + s.prim + ' / ' + n(s.safety), el('div', '', [el('span', 'chip ' + (s.neg ? 'bad' : 'warn'), [s.neg ? L('마이너스', 'Âm') : L('미달', 'Thiếu')])])])]); })) : el('p', 'muted', [L('모든 자재가 안전재고 이상입니다', 'Tất cả NVL đạt mức an toàn')])]);
    var ps = d.daily.procs, ad = d.asmDaily, am = d.asmMonthly;
    var mL = function (i) { return L((i + 1) + '월', 'T' + (i + 1)); };
    var th = function (t) { return el('th', '', [t]); };
    // 일별 · 월별 조립 생산량 (종합 현황 위젯과 같은 숫자, 품목군별) — 옛 ERP 가 보낸 요약에는 없음
    var asmD = ad && ad.days && ad.days.length ? [el('h3', '', [L('일별 ' + pn(ad) + ' 생산량 · ', 'Sản lượng ' + pn(ad) + ' theo ngày · ') + ad.month]),
      el('div', 'tw', [el('table', '', [el('thead', '', [el('tr', '', [th(L('날짜', 'Ngày')), th(L('합계', 'Tổng'))].concat(ad.divs.map(function (x) { return th(x.label); })))]),
        el('tbody', '', ad.days.map(function (x, i) { return i; }).reverse().map(function (i) { return el('tr', '', [el('td', '', [md(ad.days[i])]), el('td', '', [el('b', '', [n(ad.total[i])])])].concat(ad.divs.map(function (x) { return el('td', '', [x.vals[i] ? n(x.vals[i]) : '·']); }))); }))])])] : [];
    var asmM = am && am.grand ? [el('h3', '', [L('월별 ' + pn(am) + ' 생산량 · ', 'Sản lượng ' + pn(am) + ' theo tháng · ') + am.year]),
      el('div', 'tw', [el('table', '', [el('thead', '', [el('tr', '', [th(L('월', 'Tháng')), th(L('합계', 'Tổng'))].concat(am.divs.map(function (x) { return th(x.label); })))]),
        el('tbody', '', am.total.map(function (v, i) { return el('tr', '', [el('td', '', [mL(i)]), el('td', '', [v ? el('b', '', [n(v)]) : '·'])].concat(am.divs.map(function (x) { return el('td', '', [x.m[i] ? n(x.m[i]) : '·']); }))); })
          .concat([el('tr', '', [el('td', '', [el('b', '', [am.year + L(' 합계', ' tổng')])]), el('td', '', [el('b', '', [n(am.grand)])])].concat(am.divs.map(function (x) { return el('td', '', [n(x.t)]); })))]))])])] : [];
    var prod = el('div', 'card', [el('h2', '', [L('생산 관리', 'Sản xuất')]), el('h3', '', [L('이번 달 누계 (전월 같은 기간 대비)', 'Lũy kế tháng (so cùng kỳ)')]),
      el('div', '', d.month.map(function (p) { return el('div', 'row', [el('b', '', [pn(p)]), el('div', 'r', [el('b', '', [n(p.val)]), ' ' + un(p) + '  ', el('span', 'muted', [pct(p.val, p.prev)])])]); }))].concat(asmD, asmM, [
      el('h3', '', [L('최근 14일 생산량', 'Sản lượng 14 ngày')]),
      el('div', 'tw', [el('table', '', [el('thead', '', [el('tr', '', [el('th', '', [L('날짜', 'Ngày')])].concat(ps.map(function (p) { return el('th', '', [pn(p)]); })))]),
        el('tbody', '', d.daily.days.map(function (day, i) { return el('tr', '', [el('td', '', [md(day)])].concat(ps.map(function (p) { return el('td', '', [p.vals[i] ? n(p.vals[i]) : '·']); }))); }))])]),
      el('p', 'muted', [L('생산일보 양품 기준 · 포장은 세트, 나머지는 pcs · ERP 가 켜져 있는 동안 15분마다 새로 보냅니다.', 'Theo SL đạt của báo cáo · đóng gói tính bộ, còn lại pcs · ERP gửi lại mỗi 15 phút khi đang chạy.')])]));
    m.replaceChildren(head, dash, prod);
  }
  function btn(t, fn) { var b = el('button', 'btn', [t]); b.type = 'button'; b.onclick = fn; return b; }
  function paintLang() { Array.prototype.forEach.call(document.querySelectorAll('.lg button'), function (b) { b.className = b.getAttribute('data-l') === lang ? 'on' : ''; b.onclick = function () { lang = b.getAttribute('data-l'); LS.set('erpm_lang', lang); paintLang(); if (data) show(); else login(msg); }; }); document.documentElement.lang = lang; }
  paintLang();
  if (pw) load(pw, true); else login('');
})();
</script></body></html>`;
