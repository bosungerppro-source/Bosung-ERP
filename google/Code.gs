/**
 * ColorPencil ERP  ·  Google Sheets / Drive bridge (Apps Script web app)
 * 설치: 1) 구글 시트를 새로 만든다  2) 확장 프로그램 > Apps Script  3) 이 코드를 붙여넣기
 *       4) TOKEN 값을 원하는 비밀번호로 변경  5) 배포 > 새 배포 > 웹 앱 (실행: 나, 액세스: 모든 사용자)
 *       6) 발급된 URL 과 TOKEN 을 ERP "엑셀·구글 연동" 화면에 입력
 * Cài đặt: tạo Google Sheet mới > Tiện ích mở rộng > Apps Script > dán mã > đổi TOKEN > Triển khai ứng dụng web
 *          (Thực thi: tôi, Truy cập: mọi người) > dán URL + TOKEN vào màn hình "Excel · Google" của ERP.
 */
var TOKEN = 'CHANGE-ME';            // <-- 반드시 변경 / bắt buộc đổi
var SNAPSHOT_FOLDER = 'ColorPencil ERP Backup';  // Drive folder for snapshots

function doGet() { return out_({ ok: true, app: 'colorpencil-erp-bridge', time: new Date().toISOString() }); }

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    if (req.token !== TOKEN) return out_({ ok: false, error: 'bad token' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    switch (req.action) {
      case 'ping': return out_({ ok: true, ver: 3, sheet: ss.getName(), url: ss.getUrl() });
      case 'list': return out_({ ok: true, tables: list_(ss) });
      case 'put': return out_(put_(ss, req));
      case 'get': return out_(get_(ss, req));
      case 'snapshot': return out_(snapshot_(ss, req));
      case 'backup': return out_(backup_(req));
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

// snapshot: copies the whole spreadsheet into a Drive folder
function snapshot_(ss, req) {
  var it = DriveApp.getFoldersByName(SNAPSHOT_FOLDER);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(SNAPSHOT_FOLDER);
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
  var it = DriveApp.getFoldersByName(SNAPSHOT_FOLDER);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(SNAPSHOT_FOLDER);
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
