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
      case 'ping': return out_({ ok: true, sheet: ss.getName(), url: ss.getUrl() });
      case 'list': return out_({ ok: true, tables: list_(ss) });
      case 'put': return out_(put_(ss, req));
      case 'get': return out_(get_(ss, req));
      case 'snapshot': return out_(snapshot_(ss, req));
      default: return out_({ ok: false, error: 'unknown action' });
    }
  } catch (err) { return out_({ ok: false, error: String(err) }); }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function sheet_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

function list_(ss) {
  return ss.getSheets().map(function (s) { return { name: s.getName(), rows: Math.max(0, s.getLastRow() - 1) }; });
}

// put: {table, cols:[keys], rows:[[...]], first:true|false}   first=true clears the sheet before writing
function put_(ss, req) {
  var s = sheet_(ss, req.table);
  if (req.first) { s.clear(); s.getRange(1, 1, 1, req.cols.length).setValues([req.cols]).setFontWeight('bold'); s.setFrozenRows(1); }
  var rows = req.rows || [];
  if (rows.length) {
    var start = s.getLastRow() + 1;
    if (s.getMaxRows() < start + rows.length) s.insertRowsAfter(s.getMaxRows(), start + rows.length - s.getMaxRows());
    if (s.getMaxColumns() < req.cols.length) s.insertColumnsAfter(s.getMaxColumns(), req.cols.length - s.getMaxColumns());
    s.getRange(start, 1, rows.length, req.cols.length).setValues(rows);
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
