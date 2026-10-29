/* 18차(v1.13.0) 여러 PC 자료 공유 (구글 드라이브) — 화면
   - 엑셀 · 구글 연동 → 구글 시트 · 드라이브 맨 위 카드 (ERP.cloudCard): 처음 설정 순서 (코드 복사 → 구글 시트 → Apps Script → 웹 앱 배포 → 주소),
     직원 PC 연결 코드, 상태 · 지금 맞추기 · 끄기 · 기록
   - 설정 화면의 짧은 카드 (ERP.cloudMini) · 왼쪽 아래 상태 (ERP.cloudBrief ← /api/versions 의 cloud)
   주고받기 · 합치기는 ERP 서버(cloudsync.js)가 한다. 이 화면은 설정과 상태만. */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, F = ERP.fmt;
  const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
  const pad = (x) => String(x).padStart(2, '0');
  const when = (s) => { if (!s) return '–'; const d = new Date(s); return isNaN(d) ? '–' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const hm = (s) => { if (!s) return '–'; const d = new Date(s); return isNaN(d) ? '–' : pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const agoMs = (ms) => {
    const sec = Math.max(0, Math.round(ms / 1000));
    if (sec < 60) return L(sec + '초 전', sec + ' giây trước');
    if (sec < 3600) return L(Math.round(sec / 60) + '분 전', Math.round(sec / 60) + ' phút trước');
    if (sec < 86400) return L(Math.round(sec / 3600) + '시간 전', Math.round(sec / 3600) + ' giờ trước');
    return L(Math.round(sec / 86400) + '일 전', Math.round(sec / 86400) + ' ngày trước');
  };
  const ago = (s) => { const t = Date.parse(s); return t ? agoMs(Date.now() - t) : ''; };
  const label = (n) => (n === '__meta' ? L('설정', 'Cài đặt') : ERP.TABLES[n] ? ERP.tableLabel(n) : n);

  /** 서버(cloudsync.js)가 돌려준 오류 코드 → 알아듣게 */
  ERP.cloudMsg = function (code, detail) {
    const m = {
      NET: L('구글에 연결하지 못했습니다 — 인터넷 연결을 확인하세요', 'Không kết nối được Google — kiểm tra Internet'),
      NOT_JSON: L('웹 앱의 응답이 아닙니다 — 주소가 웹 앱 URL(…/exec)인지, 배포할 때 액세스 권한을 "모든 사용자"로 했는지 확인하세요', 'Không phải phản hồi của ứng dụng web — kiểm tra URL (…/exec) và quyền truy cập "Bất kỳ ai" (Anyone)'),
      NOT_FOUND: L('주소를 찾을 수 없습니다 — 웹 앱 URL 을 다시 복사해 넣으세요', 'Không tìm thấy địa chỉ — hãy sao chép lại URL ứng dụng web'),
      BAD_TOKEN: L('비밀 키(TOKEN)가 맞지 않습니다 — 사장님 PC 에서 [Apps Script 코드 복사] 로 다시 붙여넣고 새 버전으로 배포하세요 (직원 PC 는 연결 코드를 다시 받으세요)', 'TOKEN không khớp — trên máy chủ hãy dán lại mã và triển khai phiên bản mới (máy nhân viên lấy lại mã kết nối)'),
      OLD_SCRIPT: L('구글 Apps Script 가 옛 판입니다 — [Apps Script 코드 복사] 로 새 코드(8판)를 붙여넣고 배포 → 배포 관리 → 수정(연필) → 버전: 새 버전 → 배포 하세요', 'Apps Script là bản cũ — dán mã mới (bản 8) rồi Triển khai → Quản lý → Sửa → Phiên bản mới'),
      NO_SHEET: L('이 Apps Script 는 구글 시트 없이 만들어져서 시트에 쓸 수 없습니다 (자료 공유는 됩니다)', 'Apps Script này không gắn với Google Sheet nên không ghi lên Sheet được (dùng chung vẫn chạy)'),
      OFF: L('공유가 꺼져 있습니다', 'Đang tắt dùng chung'),
      CID: L('다른 구글 저장소로 바뀌었습니다 (다른 Apps Script 주소) — 아래에서 다시 연결하세요', 'Đã đổi sang kho Google khác — hãy kết nối lại bên dưới'),
      BAD_URL: L('Apps Script 웹 앱 주소가 아닙니다 (https://script.google.com/macros/s/…/exec)', 'Không phải URL ứng dụng web Apps Script (https://script.google.com/macros/s/…/exec)'),
      NO_TOKEN: L('비밀 키(TOKEN)가 없습니다 — 먼저 [Apps Script 코드 복사] 를 누르세요', 'Chưa có khóa (TOKEN) — bấm [Sao chép mã Apps Script] trước'),
      NOT_EMPTY: L('구글 드라이브에 이미 자료가 있습니다 — [연결 확인] 을 다시 누르고 고르세요', 'Google Drive đã có dữ liệu — bấm [Kiểm tra kết nối] lại rồi chọn'),
      EMPTY: L('구글 드라이브에 아직 자료가 없습니다 — 먼저 사장님 PC 에서 올리세요', 'Google Drive chưa có dữ liệu — hãy tải lên từ máy chủ trước'),
      NO_RESUME: L('다시 켤 수 있는 공유가 없습니다 — [연결 확인] 을 다시 누르세요', 'Không có kết nối cũ để bật lại — bấm [Kiểm tra kết nối] lại'),
      BUSY: L('다른 PC 가 같은 표를 동시에 올리는 중입니다 — 잠시 뒤 다시 합니다', 'Máy khác đang tải lên cùng lúc — sẽ thử lại sau'),
      LOCAL: L('이 PC 의 표 파일을 읽지 못해 공유를 멈췄습니다 (' + (detail || '') + ') — 데이터 폴더의 backup 에 있는 복사본으로 되돌리세요', 'Không đọc được tệp bảng trên máy này (' + (detail || '') + ') — hãy khôi phục từ bản sao trong thư mục backup'),
      GAS: L('구글 Apps Script 오류: ', 'Lỗi Apps Script: ') + (detail || ''),
    }[code];
    return m || (detail ? String(detail) : String(code || L('오류', 'Lỗi')));
  };
  async function api(url, body) {
    const r = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.code ? ERP.cloudMsg(j.code, j.error) : (j.error || ('HTTP ' + r.status))), { code: j.code });
    return j;
  }
  /** 글자 복사 — 막히면 글자를 보여 줘서 직접 복사 (Ctrl+C) */
  async function copyText(t, msg) {
    let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(t); ok = true; } } catch (e) { ok = false; }
    if (!ok) { const ta = h('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } }); ta.value = t; document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ta.remove(); }
    if (ok) { ERP.toast(msg || L('복사했습니다', 'Đã sao chép'), 'ok'); return true; }
    const ta = h('textarea', { class: 'inp', readOnly: true, rows: 8, style: { width: '100%', fontFamily: 'monospace', fontSize: '12px' } }); ta.value = t;
    ERP.modal({ title: L('직접 복사하세요', 'Hãy tự sao chép'), width: '620px', body: h('div', h('p', { class: 'help' }, L('아래 글자를 모두 골라 (Ctrl+A) 복사 (Ctrl+C) 하세요.', 'Chọn hết (Ctrl+A) rồi sao chép (Ctrl+C).')), ta), buttons: [{ label: L('닫기', 'Đóng') }] });
    setTimeout(() => { ta.focus(); ta.select(); }, 50);
    return false;
  }
  const randomToken = () => { const a = new Uint8Array(24); crypto.getRandomValues(a); return btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))));
  /** 직원 PC 연결 코드: ERPC1.<base64url {u: 웹 앱 주소, t: 비밀 키}> */
  ERP.cloudInvite = () => { const u = DB.setting('gUrl', ''), t = DB.setting('gToken', ''); return u && t ? 'ERPC1.' + b64url(JSON.stringify({ u, t })) : ''; };
  ERP.cloudParse = (s) => {
    const m = String(s || '').replace(/\s+/g, '').match(/^ERPC1\.([A-Za-z0-9_-]+)$/); if (!m) return null;
    try { const o = JSON.parse(unb64url(m[1])); return o && typeof o.u === 'string' && typeof o.t === 'string' ? { url: o.u, token: o.t } : null; } catch (e) { return null; }
  };
  /** 처음 합칠 때 같은 행을 알아보는 기준 키 (schema.js nat · multi) */
  const natMap = () => { const o = {}; Object.keys(ERP.TABLES).forEach(n => { const T = ERP.TABLES[n]; o[n] = { k: T.nat || [], multi: !!T.multi }; }); return o; };
  const modeLabel = (m) => ({ upload: L('이 PC 자료를 올려 시작', 'Tải dữ liệu máy này lên'), replace: L('구글 자료로 시작', 'Bắt đầu bằng dữ liệu Google'), merge: L('이 PC 자료를 더해 시작', 'Gộp dữ liệu máy này'),
    overwrite: L('이 PC 자료로 덮어써 시작', 'Ghi đè bằng dữ liệu máy này'), resume: L('다시 켬', 'Bật lại') })[m] || m || '–';
  function logText(e) {
    const x = e.x || {}; const names = (a) => (a || []).map(label).join(', ');
    switch (e.k) {
      case 'on': return L('공유 시작 — ', 'Bắt đầu — ') + modeLabel(x.mode) + (x.rows ? ' · ' + L('표 ', '') + x.tables + L('개 · ', ' bảng · ') + F.n(x.rows) + L('행', ' dòng') : '') + (x.added ? ' · ' + L('더한 행 ', 'thêm ') + F.n(x.added) : '');
      case 'off': return L('공유 끔', 'Đã tắt dùng chung');
      case 'got': return L('받음: ', 'Nhận: ') + names(e.x);
      case 'sent': return L('보냄: ', 'Gửi: ') + names(e.x);
      case 'conf': return L('두 PC 에서 같은 행을 고침 ', 'Hai máy cùng sửa một dòng: ') + e.x + L('건 — 이 PC 내용으로', ' — giữ theo máy này');
      case 'shrink': return L('크게 줄어든 표를 백업: ', 'Đã sao lưu bảng bị giảm nhiều: ') + label(x.n) + ' ' + F.n(x.from) + ' → ' + F.n(x.to);
      case 'lost': return L('이 PC 에서 없어진 표 파일을 구글 자료로 되살림: ', 'Đã khôi phục tệp bảng bị mất từ Google: ') + label(x.n);
      case 'err': return L('오류: ', 'Lỗi: ') + ERP.cloudMsg(x.code, x.detail);
      case 'sheeterr': return L('구글 시트 갱신 오류: ', 'Lỗi cập nhật Google Sheet: ') + ERP.cloudMsg(x.code, x.detail);
      default: return String(e.k);
    }
  }

  /** 자료를 통째로 바꾸는 버튼(샘플 · 전체 삭제 · 복원 · 시트에서 가져오기)의 확인 글에 덧붙임 */
  ERP.cloudWarn = () => (DB.cloud && DB.cloud.on ? '\n\n' + L('⚠ 구글 드라이브 공유가 켜져 있습니다 — 다른 PC 의 자료도 똑같이 바뀝니다.', '⚠ Đang dùng chung qua Google Drive — dữ liệu các máy khác cũng sẽ đổi theo.') : '');

  /** 왼쪽 아래 상태 (☁) — /api/versions 를 받을 때마다 (db.js poll) · 화면을 그릴 때 */
  ERP.cloudBrief = function (b) {
    if (b !== undefined) DB.cloud = b || null;
    const el = document.getElementById('cloudstate'), c = DB.cloud; if (!el) return;
    if (!c || !c.on) { el.style.display = 'none'; return; }
    el.style.display = ''; el.className = c.code ? 'bad' : 'ok';
    el.textContent = '☁ ' + (c.code ? L('구글 공유 오류', 'Lỗi dùng chung Google') : L('구글 공유 · ', 'Dùng chung Google · ') + hm(c.at));
    el.title = c.code ? ERP.cloudMsg(c.code) : L('마지막으로 구글과 맞춘 시각 ', 'Đồng bộ với Google lần cuối ') + when(c.at);
  };

  const title = () => h('h3', L('여러 PC 자료 공유 (구글 드라이브)', 'Dùng chung dữ liệu nhiều máy (Google Drive)'));
  const run = async (b, fn) => { if (b) b.disabled = true; try { await fn(); } catch (e) { if (!e.shown) ERP.toast(e.message || String(e), 'bad'); } finally { if (b && b.isConnected) b.disabled = false; } };
  const btn = (kind, text, fn) => h('button', { type: 'button', class: 'btn' + (kind ? ' ' + kind : ''), onclick: (e) => run(e.currentTarget, fn) }, text);

  /** [Apps Script 코드 복사]: 비밀 키가 없거나 짧으면 새로 만들어 이 PC 설정(gToken)에 두고, 키를 넣은 Code.gs 를 복사 */
  async function copyCode() {
    let tk = String(DB.setting('gToken', '') || '');
    if (!TOKEN_RE.test(tk)) { tk = randomToken(); DB.setSetting('gToken', tk); await DB.flush(); }
    const j = await api('/api/cloud/code', { token: tk });
    await copyText(j.code, L('Apps Script 코드를 복사했습니다 — 구글 Apps Script 편집기에 붙여넣으세요', 'Đã sao chép mã — hãy dán vào trình soạn thảo Apps Script'));
  }
  ERP.cloudCopyCode = copyCode;
  function inviteModal() {
    const code = ERP.cloudInvite();
    if (!code) { ERP.toast(L('아직 웹 앱 주소 · 비밀 키가 없습니다', 'Chưa có URL · khóa'), 'warn'); return; }
    const ta = h('textarea', { class: 'inp', readOnly: true, rows: 4, style: { width: '100%', fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' } }); ta.value = code;
    ERP.modal({ title: L('직원 PC 연결 코드', 'Mã kết nối máy nhân viên'), width: '580px', body: h('div',
        h('p', { class: 'help' }, L('직원 PC 에 ColorPencil ERP (1.13.0 이상) 를 설치하고 → 엑셀 · 구글 연동 → 구글 시트 · 드라이브 → "② 직원 PC" 칸에 이 코드를 붙여넣고 [연결 확인] → [구글 자료로 시작] 을 누르면 됩니다.',
          'Cài ColorPencil ERP (1.13.0 trở lên) trên máy nhân viên → Excel · Google → Google Sheet · Drive → dán mã này vào ô "② Máy nhân viên" → [Kiểm tra kết nối] → [Bắt đầu bằng dữ liệu Google].')),
        ta,
        h('p', { class: 'warn-text' }, L('이 코드는 구글 드라이브의 ERP 자료를 읽고 쓰는 열쇠입니다. 직원에게만 보내세요.', 'Mã này là chìa khóa đọc/ghi dữ liệu ERP trên Google Drive. Chỉ gửi cho nhân viên.'))),
      buttons: [{ label: L('닫기', 'Đóng') }, { label: L('복사', 'Sao chép'), kind: 'primary', keep: true, onClick: () => copyText(code, L('연결 코드를 복사했습니다', 'Đã sao chép mã kết nối')) }] });
    setTimeout(() => { ta.focus(); ta.select(); }, 50);
  }

  /** 연결 (upload · replace · merge · overwrite · resume) → 끝나면 결과 창 → 화면 새로 고침 */
  async function connect(cfg, mode) {
    const wait = ERP.modal({ title: L('구글 드라이브 공유', 'Dùng chung Google Drive'), width: '440px', body: h('p', { class: 'cloud-wait' }, L('구글과 자료를 맞추는 중입니다… (자료가 많으면 1분쯤)', 'Đang đồng bộ với Google… (có thể khoảng 1 phút)')) });
    let r;
    try { await DB.flush(); r = await api('/api/cloud/connect', { url: cfg.url, token: cfg.token, mode, nat: natMap() }); }
    finally { wait.close(); }
    const s = r.status || {};
    ERP.modal({ title: L('공유를 시작했습니다', 'Đã bắt đầu dùng chung'), width: '520px', body: h('div', { class: 'cloud-done' },
        h('p', h('b', modeLabel(mode)), r.rows ? ' · ' + L('표 ', '') + r.tables + L('개 · ', ' bảng · ') + F.n(r.rows) + L('행', ' dòng') : '', r.added ? ' · ' + L('더한 행 ', 'thêm ') + F.n(r.added) : ''),
        r.backup ? h('p', { class: 'help' }, L('바꾸기 전 이 PC 자료 복사본: ', 'Bản sao dữ liệu máy này trước khi đổi: '), h('code', r.backup)) : null,
        s.code ? h('p', { class: 'warn-text' }, ERP.cloudMsg(s.code, s.error)) : null,
        mode === 'upload' || mode === 'overwrite' ? h('p', { class: 'help' }, L('이제 직원 PC 에서: ERP 를 설치하고, 이 카드의 [직원 PC 연결 코드] 를 직원 PC 의 "② 직원 PC" 칸에 붙여넣으면 됩니다.', 'Tiếp theo trên máy nhân viên: cài ERP, dán [Mã kết nối máy nhân viên] vào ô "② Máy nhân viên".')) : null,
        s.sheet && s.sheet.has !== false && Number(s.sheet.ver) >= 6 ? h('p', { class: 'help' }, L('그 구글 시트에 표마다 탭이 생깁니다 (자료가 많으면 1~2분) — 시트에서는 보기만 하고, 고치는 것은 ERP 에서 합니다.', 'Google Sheet đó sẽ có mỗi bảng một tab (1–2 phút nếu nhiều dữ liệu) — chỉ xem trên Sheet, sửa trong ERP.')) : null,
        h('p', { class: 'help' }, L('휴대폰으로 보려면: 설정 → 휴대폰으로 보기에서 비밀번호를 정하세요.', 'Xem trên điện thoại: đặt mật khẩu ở Cài đặt → Xem trên điện thoại.'))),
      buttons: [{ label: L('확인 (화면 새로 고침)', 'OK (tải lại)'), kind: 'primary', onClick: () => { location.reload(); } }], onClose: () => location.reload() });
  }
  async function mergeDialog(cfg) {
    const p = await api('/api/cloud/preview', { url: cfg.url, token: cfg.token, nat: natMap() });
    const names = Object.keys(p.add || {});
    ERP.modal({ title: L('이 PC 에만 있는 자료 더하기', 'Gộp dữ liệu chỉ có ở máy này'), width: '540px', body: h('div', { class: 'cloud-merge' },
        h('p', { class: 'help' }, L('구글 드라이브의 자료는 그대로 두고, 이 PC 에서만 입력한 행을 더합니다. 예시(샘플) 행과 구글에 이미 있는 행 (같은 내용 · 같은 코드) 은 더하지 않고, 설정은 구글 것을 씁니다. 더하기 전 이 PC 자료는 데이터 폴더의 cloud_backup 에 복사해 둡니다.',
          'Giữ nguyên dữ liệu trên Google Drive, chỉ thêm các dòng nhập riêng ở máy này. Không thêm dòng mẫu và dòng đã có (cùng nội dung · cùng mã); cài đặt theo Google. Dữ liệu máy này được sao chép vào cloud_backup trước.')),
        p.total ? h('ul', names.map(n => h('li', label(n) + ': ' + F.n(p.add[n]) + L('행', ' dòng')))) : h('p', L('더할 행이 없습니다 — "구글 자료로 시작" 과 같습니다.', 'Không có dòng nào để thêm — giống "Bắt đầu bằng dữ liệu Google".'))),
      buttons: [{ label: L('취소', 'Hủy') }, { label: L('더하고 시작', 'Gộp và bắt đầu') + (p.total ? ' (' + F.n(p.total) + L('행', ' dòng') + ')' : ''), kind: 'primary', onClick: () => run(null, () => connect(cfg, 'merge')) }] });
  }
  /** [연결 확인] → 구글 쪽 상태에 맞는 시작 버튼들 */
  async function checkAndChoose(res, cfg) {
    res.replaceChildren(h('p', { class: 'help' }, L('확인하는 중…', 'Đang kiểm tra…')));
    let c;
    try { c = await api('/api/cloud/check', cfg); } catch (e) { res.replaceChildren(h('p', { class: 'warn-text' }, e.message)); e.shown = true; throw e; }
    const lc = c.local || { tables: 0, rows: 0 };
    const items = [h('div', { class: 'toolbar' }, ERP.chip('ok', L('연결됨', 'Đã kết nối')), h('span', { class: 'muted' }, 'Apps Script ' + c.ver + L('판', '') + (c.sheet ? ' · ' + c.sheet : '')))];
    if (Number(c.ver) < 6) items.push(h('p', { class: 'help' }, L('이 Apps Script 는 ' + c.ver + '판입니다 — 자료 공유는 되고, 구글 시트에서 표로 보려면 새 코드(8판)로 바꾸세요 ([Apps Script 코드 복사] → 붙여넣기 → 배포 관리 → 수정 → 새 버전).',
      'Apps Script này là bản ' + c.ver + ' — dùng chung vẫn chạy; muốn xem bảng trên Google Sheet hãy đổi sang mã mới (bản 8) ([Sao chép mã Apps Script] → dán → Quản lý → Sửa → Phiên bản mới).')));
    else if (Number(c.ver) < 8) items.push(h('p', { class: 'help' }, L('이 Apps Script 는 ' + c.ver + '판입니다 — 그대로 써도 되고, 8판 (접속 중인 PC 보기) 으로 바꾸려면 [Apps Script 코드 복사] → 붙여넣기 → 배포 관리 → 수정 → 새 버전.',
      'Apps Script này là bản ' + c.ver + ' — vẫn dùng được; muốn đổi sang bản 8 (xem máy đang kết nối): [Sao chép mã Apps Script] → dán → Quản lý → Sửa → Phiên bản mới.')));
    if (c.resume) items.push(h('p', { class: 'help' }, L('이 PC 는 전에 이 구글 저장소와 공유했습니다. 다시 켜면 꺼 둔 동안 양쪽에서 바뀐 것을 합칩니다.', 'Máy này đã từng dùng chung với kho này. Bật lại sẽ gộp các thay đổi của cả hai bên.')),
      h('div', { class: 'toolbar' }, btn('primary', L('다시 켜기', 'Bật lại'), () => connect(cfg, 'resume'))));
    if (c.empty) {
      items.push(h('p', { class: 'help' }, L('구글 드라이브에 아직 자료가 없습니다. 이 PC 의 자료 (표 ' + lc.tables + '개 · ' + F.n(lc.rows) + '행) 를 올리고 공유를 시작합니다 — 사장님 PC 에서 처음 한 번 합니다.',
        'Google Drive chưa có dữ liệu. Dữ liệu máy này (' + lc.tables + ' bảng · ' + F.n(lc.rows) + ' dòng) sẽ được tải lên — làm một lần trên máy chủ.')),
        h('div', { class: 'toolbar' }, btn(c.resume ? '' : 'primary', L('이 PC 자료를 올리고 공유 시작', 'Tải dữ liệu máy này lên và bắt đầu'), () => connect(cfg, 'upload'))));
    } else {
      items.push(h('p', { class: 'help' }, L('구글 드라이브에 자료가 있습니다: 표 ' + c.tables + '개 · ' + F.n(c.rows) + '행 · 마지막 저장 ' + when(c.at) + '. 이 PC: 표 ' + lc.tables + '개 · ' + F.n(lc.rows) + '행.',
        'Google Drive đã có dữ liệu: ' + c.tables + ' bảng · ' + F.n(c.rows) + ' dòng · lưu lần cuối ' + when(c.at) + '. Máy này: ' + lc.tables + ' bảng · ' + F.n(lc.rows) + ' dòng.')),
        h('div', { class: 'toolbar' },
          btn(c.resume ? '' : 'primary', L('구글 자료로 시작 (직원 PC · 새 PC)', 'Bắt đầu bằng dữ liệu Google (máy nhân viên · máy mới)'), async () => {
            if (!(await ERP.confirm(L('이 PC 의 자료를 구글 드라이브의 자료로 바꿉니다.\n바꾸기 전 이 PC 자료는 데이터 폴더의 cloud_backup 에 복사해 둡니다. 계속할까요?', 'Dữ liệu máy này sẽ được thay bằng dữ liệu trên Google Drive.\nDữ liệu cũ được sao chép vào cloud_backup trước. Tiếp tục?')))) return;
            await connect(cfg, 'replace'); }),
          btn('', L('이 PC 에만 있는 자료도 더하기…', 'Gộp thêm dữ liệu chỉ có ở máy này…'), () => mergeDialog(cfg))),
        h('div', { class: 'toolbar' }, btn('sm danger', L('이 PC 자료로 구글 자료 덮어쓰기…', 'Ghi đè dữ liệu Google bằng máy này…'), async () => {
          if (!(await ERP.confirm(L('구글 드라이브의 자료를 이 PC 의 자료로 바꿉니다.\n다른 PC 들도 다음에 맞출 때 이 PC 의 자료로 바뀝니다 (그 PC 에서 아직 보내지 않은 입력만 그 PC 에 남습니다).\n정말 덮어쓸까요?',
            'Dữ liệu trên Google Drive sẽ được thay bằng dữ liệu máy này.\nCác máy khác cũng sẽ đổi theo ở lần đồng bộ tới.\nGhi đè thật chứ?'), L('덮어쓰기', 'Ghi đè'), true))) return;
          await connect(cfg, 'overwrite'); })));
    }
    res.replaceChildren(...items);
  }
  /** 처음 설정 순서 (① 사장님 PC · ② 직원 PC) */
  function setupParts() {
    const res = h('div', { class: 'cloud-res' });
    const urlIn = h('input', { class: 'inp', name: 'cloudUrl', value: DB.setting('gUrl', ''), placeholder: 'https://script.google.com/macros/s/…/exec', style: { flex: '1 1 340px', minWidth: '240px' } });
    const codeIn = h('input', { class: 'inp', name: 'cloudCode', placeholder: 'ERPC1.…', autocomplete: 'off', style: { flex: '1 1 340px', minWidth: '240px' } });
    const testOwner = () => { const url = urlIn.value.trim(), token = String(DB.setting('gToken', '') || '');
      if (!url) throw new Error(L('웹 앱 URL 을 붙여넣으세요', 'Hãy dán URL ứng dụng web')); if (!TOKEN_RE.test(token)) throw new Error(ERP.cloudMsg('NO_TOKEN'));
      return checkAndChoose(res, { url, token }); };
    const testStaff = () => { const cfg = ERP.cloudParse(codeIn.value);
      if (!cfg) throw new Error(L('연결 코드가 맞지 않습니다 — ERPC1. 로 시작하는 글자 전체를 붙여넣으세요', 'Mã kết nối không đúng — hãy dán toàn bộ chuỗi bắt đầu bằng ERPC1.'));
      return checkAndChoose(res, cfg); };
    const b = (t) => h('b', t);
    return h('div', { class: 'cloud-setup' },
      h('h4', L('① 처음 한 번 — 사장님 PC (구글 계정 주인)', '① Lần đầu — máy chủ (chủ tài khoản Google)')),
      h('ol', { class: 'steps' },
        h('li', btn('sm primary', L('Apps Script 코드 복사', 'Sao chép mã Apps Script'), () => copyCode()), ' ', L('— 비밀 키(TOKEN)가 들어 있는 코드입니다. 다른 사람에게 보내지 마세요.', '— mã đã có khóa bí mật (TOKEN). Không gửi cho người khác.')),
        h('li', h('a', { href: 'https://sheets.new', target: '_blank', rel: 'noopener' }, L('새 구글 시트 열기', 'Mở Google Sheet mới')), L(' (구글 계정으로 로그인) → 메뉴 ', ' (đăng nhập Google) → menu '), b(L('확장 프로그램 → Apps Script', 'Tiện ích mở rộng (Extensions) → Apps Script')),
          L(' → 원래 있던 코드를 모두 지우고 붙여넣기 (Ctrl+V) → 저장 (Ctrl+S)', ' → xóa hết mã cũ, dán (Ctrl+V) → Lưu (Ctrl+S)')),
        h('li', L('오른쪽 위 ', 'Góc trên bên phải: '), b(L('배포 → 새 배포', 'Triển khai (Deploy) → Bản triển khai mới (New deployment)')), L(' → 유형 선택 옆 톱니바퀴 → ', ' → bánh răng cạnh "Chọn loại" → '), b(L('웹 앱', 'Ứng dụng web (Web app)')),
          L(' → 다음 사용자 인증 정보로 실행: ', ' → Thực thi với tư cách (Execute as): '), b(L('나', 'Tôi (Me)')), L(' · 액세스 권한이 있는 사용자: ', ' · Người có quyền truy cập (Who has access): '), b(L('모든 사용자', 'Bất kỳ ai (Anyone)')),
          L(' ("Google 계정이 있는 모든 사용자" 가 아님) → 배포', ' (không phải "Anyone with Google account") → Triển khai (Deploy)')),
        h('li', b(L('액세스 승인', 'Cấp quyền truy cập (Authorize access)')), L(' → 구글 계정 선택 → "Google에서 확인하지 않은 앱" 화면이 나오면 ', ' → chọn tài khoản → nếu thấy "Google chưa xác minh ứng dụng này" thì bấm '),
          b(L('고급 → …(으)로 이동(안전하지 않음)', 'Nâng cao (Advanced) → Đi tới … (Go to …)')), L(' → 허용. 내 구글 드라이브 · 시트에 ERP 자료를 두는 권한이고, 내가 만든 코드라서 나오는 경고입니다.', ' → Cho phép (Allow). Cảnh báo này xuất hiện vì đây là mã do bạn tự tạo.')),
        h('li', L('나온 ', 'Sao chép '), b(L('웹 앱 URL', 'URL ứng dụng web (Web app URL)')), L(' (https://script.google.com/macros/s/…/exec) 을 복사해 아래에 붙여넣고 [연결 확인]', ' (https://script.google.com/macros/s/…/exec), dán vào dưới đây rồi bấm [Kiểm tra kết nối]'))),
      h('div', { class: 'toolbar' }, urlIn, btn('primary', L('연결 확인', 'Kiểm tra kết nối'), testOwner)),
      h('h4', L('② 직원 PC', '② Máy nhân viên')),
      h('p', { class: 'help' }, L('사장님 PC 의 이 카드에서 [직원 PC 연결 코드] 를 받아 (카카오톡 · 메일 등) 아래에 붙여넣으세요. 직원 PC 에도 ColorPencil ERP 1.13.0 이상이 있어야 합니다. 구글 계정은 필요 없습니다.',
        'Lấy [Mã kết nối máy nhân viên] từ máy chủ (Zalo · email…) và dán vào dưới đây. Máy nhân viên cần ColorPencil ERP 1.13.0 trở lên; không cần tài khoản Google.')),
      h('div', { class: 'toolbar' }, codeIn, btn('primary', L('연결 확인', 'Kiểm tra kết nối'), testStaff)),
      res);
  }
  const logBox = (s) => (s.log && s.log.length ? h('details', { class: 'cloud-log' }, h('summary', L('기록', 'Nhật ký') + ' (' + s.log.length + ')'),
    h('div', s.log.slice().reverse().map(e => h('div', { class: 'help' }, when(e.at) + '  ' + logText(e))))) : null);

  /** 1.13.17 접속 중인 PC (상태의 pcs — cloudsync.js): 3분 안에 구글과 맞춘 PC = 접속 중 (ERP 를 켜 둔 PC 는 30초마다 맞춤), 그 밖은 마지막으로 맞춘 때 (하루 안).
      구글 Apps Script 가 8판이 아니면 (list null) 표마다 마지막으로 자료를 보낸 PC 와 8판 안내 */
  const LIVE_MS = 180000;
  const live = (x) => x.ago !== null && x.ago <= LIVE_MS;
  const pcName = (x) => x.name + (x.me ? L(' (이 PC)', ' (máy này)') : '');
  function pcsPart(s, own) {
    const p = s.pcs; if (!p) return null;
    const head = h('h4', L('접속 중인 PC', 'Máy đang kết nối'));
    if (p.list) {
      const n = p.list.filter(live).length;
      return h('div', { class: 'cloud-pcs' }, head,
        h('div', { class: 'toolbar' }, p.list.length ? p.list.map(x => ERP.chip(live(x) ? 'ok' : 'neutral', pcName(x) + ' · ' + (live(x) ? L('접속 중', 'đang kết nối') : agoMs(x.ago)))) : h('span', { class: 'muted' }, '–')),
        h('p', { class: 'help' }, L('지금 접속 중 ' + n + '대 — 3분 안에 구글과 맞춘 PC 입니다 (ERP 를 켜 둔 PC 는 30초마다 맞춥니다). 그 밖은 마지막으로 맞춘 때 (하루 안). 이름 = 그 PC 의 Windows 컴퓨터 이름.',
          'Đang kết nối ' + n + ' máy — đã đồng bộ với Google trong 3 phút (máy mở ERP đồng bộ 30 giây một lần). Máy khác: lần đồng bộ cuối (trong 1 ngày). Tên = tên máy tính Windows.')));
    }
    const sd = p.senders || [];
    return h('div', { class: 'cloud-pcs' }, head,
      sd.length ? h('div', { class: 'toolbar' }, h('span', { class: 'muted' }, L('자료를 보낸 PC:', 'Máy đã gửi dữ liệu:')), sd.map(x => ERP.chip('neutral', pcName(x) + ' · ' + when(x.at)))) : null,
      h('p', { class: 'help' }, own ? L('접속 중인 PC 는 구글 Apps Script 8판부터 보입니다 — [Apps Script 코드 복사] → Apps Script 편집기에 붙여넣기 → 저장 → 배포 → 배포 관리 → 수정(연필) → 버전: 새 버전 → 배포 (주소는 그대로). 지금도 공유 · 시트 보기는 됩니다.',
        'Máy đang kết nối hiển thị từ Apps Script bản 8 — [Sao chép mã Apps Script] → dán vào trình soạn thảo → Lưu → Triển khai → Quản lý → Sửa → Phiên bản mới (URL giữ nguyên). Dùng chung · xem Sheet vẫn đang chạy.')
        : L('접속 중인 PC 는 사장님 PC 에서 구글 Apps Script 를 8판으로 바꾸면 보입니다.', 'Máy đang kết nối sẽ hiển thị khi máy chủ đổi Apps Script sang bản 8.')));
  }
  /** 설정 화면 짧은 카드의 한 줄 */
  function pcsMini(s) {
    const p = s.pcs; if (!p) return null;
    if (p.list) {
      const on = p.list.filter(live), off = p.list.filter(x => !live(x));
      return h('p', { class: 'cloud-pcs-mini' }, h('b', L('접속 중인 PC: ', 'Máy đang kết nối: ')), on.length ? on.map(pcName).join(' · ') : L('없음', 'không có'),
        off.length ? h('span', { class: 'muted' }, '  ·  ' + L('최근: ', 'Gần đây: ') + off.map(x => pcName(x) + ' (' + agoMs(x.ago) + ')').join(' · ')) : null);
    }
    const sd = p.senders || [];
    return h('p', { class: 'cloud-pcs-mini' }, h('b', L('자료를 보낸 PC: ', 'Máy đã gửi dữ liệu: ')), sd.length ? sd.map(pcName).join(' · ') : '–',
      h('span', { class: 'muted' }, '  ·  ' + L('접속 중인 PC 는 Apps Script 8판부터 보입니다', 'máy đang kết nối: từ Apps Script bản 8')));
  }

  ERP.cloudCard = function () {
    const box = h('div', { class: 'card', id: 'cloudCard' }, title(), h('p', { class: 'help' }, '…'));
    if (DB.mode !== 'server') { box.replaceChildren(title(), h('p', { class: 'help' }, L('여러 PC 자료 공유는 PC 설치형 ERP 에서만 됩니다 (지금은 브라우저 테스트 모드).', 'Chỉ có ở bản cài đặt trên PC (đang ở chế độ trình duyệt).'))); return box; }
    let t = null, shown = false;
    const load = () => api('/api/cloud').then(fill).catch(e => { box.replaceChildren(title(), h('p', { class: 'warn-text' }, e.message)); });
    /** 6판: 구글 시트 (표 보기) — 그 Apps Script 의 시트에 표마다 탭. 링크 · 상태 · 쓰지 못한 표 · 다시 쓰기 */
    function sheetPart(s) {
      const g = s.sheet || {}, head = h('h4', L('구글 시트 (표 보기)', 'Google Sheet (xem bảng)'));
      if (g.has === false) return h('div', { class: 'cloud-sheet' }, head, h('p', { class: 'help' }, L('이 Apps Script 는 구글 시트 없이 만들어져서 표 보기는 없습니다 (자료 공유는 그대로 됩니다). 표로 보려면 새 구글 시트 → 확장 프로그램 → Apps Script 에서 다시 만드세요.',
        'Apps Script này không gắn với Google Sheet nên không có xem bảng (dùng chung vẫn chạy). Muốn xem bảng, hãy tạo lại từ Google Sheet mới → Tiện ích mở rộng → Apps Script.')));
      if (g.ver !== null && g.ver !== undefined && Number(g.ver) < 6) return h('div', { class: 'cloud-sheet' }, head, h('p', { class: 'warn-text' }, L('구글 시트에서 표로 보려면 Apps Script 6판 이상이 필요합니다 — [Apps Script 코드 복사] → Apps Script 편집기에 붙여넣기 → 저장 → 배포 → 배포 관리 → 수정(연필) → 버전: 새 버전 → 배포 (주소는 그대로). 자료 공유는 지금도 됩니다.',
        'Muốn xem bảng trên Google Sheet cần Apps Script bản 6 trở lên — [Sao chép mã Apps Script] → dán vào trình soạn thảo → Lưu → Triển khai → Quản lý → Sửa → Phiên bản mới (URL giữ nguyên). Dùng chung vẫn đang chạy.')));
      const errN = Object.keys(g.errs || {}), lagN = (g.lag || []).length, unknown = g.ver === null || g.ver === undefined;   // 서버를 켜고 아직 한 판도 돌지 않음
      const tone = g.code || errN.length ? 'bad' : g.busy ? 'info' : lagN ? 'warn' : unknown ? 'neutral' : 'ok';
      const chip = g.code ? L('오류', 'Lỗi') : g.busy ? L('갱신 중…', 'Đang cập nhật…') : errN.length ? L('일부 표 오류', 'Lỗi một số bảng')
        : lagN ? L('갱신 대기 ' + lagN + '표', 'Chờ cập nhật ' + lagN + ' bảng') : unknown ? L('확인 중…', 'Đang kiểm tra…') : L('최신', 'Mới nhất');
      return h('div', { class: 'cloud-sheet' }, head,
        h('div', { class: 'toolbar' }, ERP.chip(tone, chip),
          g.url ? h('a', { href: g.url, target: '_blank', rel: 'noopener' }, (g.name || L('구글 시트', 'Google Sheet')) + ' ↗') : null,
          g.at ? h('span', { class: 'muted' }, L('이 PC 가 마지막으로 갱신 ', 'Máy này cập nhật lần cuối ') + when(g.at)) : null),
        g.code ? h('p', { class: 'warn-text' }, ERP.cloudMsg(g.code, g.error)) : null,
        errN.length ? h('p', { class: 'warn-text' }, L('시트에 쓰지 못한 표: ', 'Bảng chưa ghi được lên Sheet: ') + errN.map(n => label(n) + ' (' + g.errs[n] + ')').join(', ')
          + L(' — 자료는 ERP · 구글 드라이브에 그대로 있습니다. 그 표를 다시 저장하면 다시 씁니다.', ' — dữ liệu vẫn còn trong ERP · Google Drive. Lưu lại bảng đó sẽ ghi lại.')) : null,
        h('p', { class: 'help' }, L('구글 시트에서는 보기만 하세요 — 표마다 탭 (ERP 화면과 같은 이름 · 머리글) 이 저장하고 30초 안팎에 저절로 바뀝니다 (큰 표는 1분쯤). 고치는 것은 ERP 에서 (시트에서 고친 것은 ERP 에 들어가지 않고 다음 갱신 때 바뀝니다).',
          'Trên Google Sheet chỉ xem — mỗi bảng một tab (cùng tên · tiêu đề như ERP), tự cập nhật khoảng 30 giây sau khi lưu (bảng lớn khoảng 1 phút). Sửa trong ERP (sửa trên Sheet không vào ERP và sẽ bị ghi đè).')),
        h('div', { class: 'toolbar' }, btn('sm', L('구글 시트 다시 쓰기', 'Ghi lại Google Sheet'), async () => {
          const r = await api('/api/cloud/sheet', {}); ERP.toast(L('구글 시트를 ERP 자료로 다시 쓰는 중입니다 (표가 많으면 몇 분)', 'Đang ghi lại Google Sheet bằng dữ liệu ERP (có thể vài phút)'), 'ok'); fill(r); })));
    }
    function onView(s) {
      const own = !!s.local;
      const tone = s.code ? 'bad' : s.busy ? 'info' : 'ok';
      const chip = s.code ? L('오류', 'Lỗi') : s.busy ? L('주고받는 중…', 'Đang đồng bộ…') : L('켜짐', 'Đang bật');
      ERP.put(box,
        h('div', { class: 'toolbar' }, ERP.chip(tone, chip), h('span', { class: 'muted' }, L('마지막으로 맞춤 ', 'Đồng bộ lần cuối ') + when(s.lastOk) + (s.lastOk ? ' (' + ago(s.lastOk) + ')' : ''))),
        s.code ? h('p', { class: 'warn-text' }, L('마지막 시도 실패 (', 'Lần thử cuối bị lỗi (') + hm(s.at) + '): ' + ERP.cloudMsg(s.code, s.error)) : null,
        h('dl', { class: 'kv' },
          h('dt', L('다른 PC 에서 받음', 'Nhận từ máy khác')), h('dd', when(s.lastGot)),
          h('dt', L('구글로 보냄', 'Gửi lên Google')), h('dd', when(s.lastSent)),
          h('dt', L('시작', 'Bắt đầu')), h('dd', when(s.since) + ' · ' + modeLabel(s.mode)),
          h('dt', L('웹 앱 주소', 'URL ứng dụng web')), h('dd', h('code', s.url || '–'))),
        // 1.13.17: 접속 중인 PC — 8판이 아니면 (6판 · 7판 그대로) 그 안에 8판 안내 (1.13.3 의 6판 → 7판 안내를 대신함)
        pcsPart(s, own),
        sheetPart(s),
        s.conflicts ? h('p', { class: 'help' }, L('두 PC 에서 같은 행을 거의 동시에 고친 것 ' + s.conflicts + '건은 나중에 맞춘 PC 의 내용으로 맞췄습니다.', 'Hai máy cùng sửa một dòng gần như cùng lúc: ' + s.conflicts + ' — giữ theo máy đồng bộ sau.')) : null,
        s.shrink && s.shrink.length ? h('p', { class: 'warn-text' }, L('다른 PC 에서 많이 지운 표가 있습니다: ', 'Có bảng bị xóa nhiều ở máy khác: ') + s.shrink.map(x => label(x.table) + ' ' + F.n(x.from) + ' → ' + F.n(x.to)).join(', ')
          + L(' — 지우기 전 자료는 데이터 폴더의 cloud_backup 에 복사해 두었습니다.', ' — dữ liệu trước khi xóa đã được sao chép vào cloud_backup.')) : null,
        h('div', { class: 'toolbar' },
          btn('primary', L('지금 맞추기', 'Đồng bộ ngay'), async () => { const r = await api('/api/cloud/sync', {}); ERP.toast(r.code ? ERP.cloudMsg(r.code, r.error) : L('구글과 맞췄습니다', 'Đã đồng bộ với Google'), r.code ? 'bad' : 'ok'); await DB.poll(); fill(r); }),
          own ? btn('', L('직원 PC 연결 코드', 'Mã kết nối máy nhân viên'), () => inviteModal()) : null,
          own ? btn('', L('Apps Script 코드 복사', 'Sao chép mã Apps Script'), () => copyCode()) : null,
          own ? btn('', L('공유 끄기', 'Tắt dùng chung'), async () => {
            if (!(await ERP.confirm(L('구글 드라이브 공유를 끕니다. 이 PC 의 자료는 그대로이고 더 주고받지 않습니다.\n나중에 다시 켜면 꺼 둔 동안 바뀐 것을 합칩니다. 끌까요?', 'Tắt dùng chung qua Google Drive? Dữ liệu máy này giữ nguyên.\nKhi bật lại sẽ gộp các thay đổi.')))) return;
            await api('/api/cloud/off', {}); ERP.toast(L('공유를 껐습니다', 'Đã tắt dùng chung'), 'ok'); load(); }) : null),
        h('p', { class: 'help' }, L('이 PC 에서 저장한 자료는 몇 초 안에 구글 드라이브로 가고, 30초마다 다른 PC 의 변경을 받아 옵니다 (보통 1분 안에 다른 PC 화면에 보임). 다른 PC 의 ERP 가 꺼져 있어도 구글 드라이브에 있는 자료를 받습니다. ERP 를 끌 때 아직 보내지 못한 것이 있으면 보내고 닫습니다. 자료는 이 구글 계정 드라이브의 "ColorPencil ERP Data" 폴더에 있습니다.',
          'Dữ liệu lưu ở máy này được gửi lên Google Drive sau vài giây; cứ 30 giây nhận thay đổi từ máy khác (thường dưới 1 phút). Máy khác tắt ERP vẫn nhận được từ Google Drive. Khi tắt ERP, phần chưa gửi sẽ được gửi trước. Dữ liệu nằm trong thư mục "ColorPencil ERP Data" trên Drive.')),
        own ? null : h('p', { class: 'help' }, L('연결 · 끄기는 ERP 가 실행 중인 PC 에서 합니다.', 'Kết nối · tắt trên máy đang chạy ERP.')),
        h('p', { class: 'help' }, L('휴대폰으로 보기: 설정 → 휴대폰으로 보기에서 비밀번호를 정하면, 같은 웹 앱 주소를 휴대폰에서 엽니다. ', 'Xem trên điện thoại: đặt mật khẩu ở Cài đặt → Xem trên điện thoại rồi mở cùng URL trên điện thoại. '),
          h('a', { href: '#/settings' }, L('설정으로', 'Sang Cài đặt'))),
        logBox(s));
      if (s.code === 'CID' && own) ERP.put(box, h('div', { class: 'cloud-again' }, h('h4', L('다시 연결', 'Kết nối lại')), setupParts()));
    }
    function setupView(s) {
      const own = !!s.local;
      ERP.put(box, h('div', { class: 'toolbar' }, ERP.chip('neutral', L('꺼짐', 'Đang tắt')), s.lastOk ? h('span', { class: 'muted' }, L('마지막으로 맞춤 ', 'Đồng bộ lần cuối ') + when(s.lastOk)) : null),
        h('p', { class: 'help' }, L('사장님 PC 와 직원 PC 의 ERP 가 같은 자료를 씁니다. 한 PC 에서 입력하면 구글 드라이브를 거쳐 보통 1분 안에 다른 PC 에 들어옵니다. 같은 사무실 · 같은 네트워크가 아니어도 되고, 사장님 PC 가 꺼져 있어도 됩니다. 구글 계정은 사장님 것 하나면 됩니다.',
          'Máy chủ và máy nhân viên dùng chung một dữ liệu. Nhập ở một máy thì qua Google Drive, thường dưới 1 phút máy kia sẽ có. Không cần cùng văn phòng hay cùng mạng; máy chủ tắt vẫn được. Chỉ cần một tài khoản Google (của chủ).')));
      if (!own) { ERP.put(box, h('p', { class: 'help' }, L('설정은 ERP 가 실행 중인 PC 에서 합니다.', 'Cài đặt trên máy đang chạy ERP.'))); return; }
      ERP.put(box, setupParts(), logBox(s));
    }
    function fill(s) {
      clearTimeout(t); if (shown && !box.isConnected) return; shown = true;
      ERP.cloudBrief({ on: s.on, ok: s.ok, code: s.code, at: s.lastOk, mode: s.mode, busy: s.busy });
      const logOpen = !!(box.querySelector('details.cloud-log') || {}).open;   // 다시 그려도 펼친 기록은 펼친 채로
      box.replaceChildren(title());
      if (s.on) onView(s); else setupView(s);
      if (logOpen && box.querySelector('details.cloud-log')) box.querySelector('details.cloud-log').open = true;
      // 켜져 있으면 상태를 다시 묻는다 (주고받는 중 · 시트 갱신 중이면 자주) — 다른 화면으로 가면 그만
      const quick = s.busy || (s.sheet && (s.sheet.busy || s.sheet.queued));
      if (s.on) t = setTimeout(() => { if (box.isConnected && !box.querySelector('.cloud-again input:focus')) load(); }, quick ? 1500 : 10000);
    }
    load();
    return box;
  };

  /** 설정 화면: 공유 상태 한 줄 + 설정하러 가기 */
  ERP.cloudMini = function () {
    const box = h('div', { class: 'card', id: 'cloudMini' }, title(), h('p', { class: 'help' }, '…'));
    const go = () => { ERP.state.dataTab = 'google'; ERP.goto('data'); };
    api('/api/cloud').then(s => {
      box.replaceChildren(title()); ERP.put(box,   // ERP.put: 빈 값(null)은 "null" 글자로 붙이지 않음
        h('div', { class: 'toolbar' }, ERP.chip(s.on ? (s.code ? 'bad' : 'ok') : 'neutral', s.on ? (s.code ? L('오류', 'Lỗi') : L('켜짐', 'Đang bật')) : L('꺼짐', 'Đang tắt')),
          s.on ? h('span', { class: 'muted' }, L('마지막으로 맞춤 ', 'Đồng bộ lần cuối ') + when(s.lastOk)) : null),
        s.on && s.code ? h('p', { class: 'warn-text' }, ERP.cloudMsg(s.code, s.error)) : null,
        s.on ? pcsMini(s) : null,
        h('p', { class: 'help' }, L('사장님 PC 와 직원 PC 의 ERP 가 구글 드라이브를 거쳐 같은 자료를 씁니다.', 'Máy chủ và máy nhân viên dùng chung dữ liệu qua Google Drive.')),
        h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'btn', onclick: go }, s.on ? L('공유 상태 보기', 'Xem trạng thái') : L('설정하러 가기 (엑셀 · 구글 연동)', 'Đi tới cài đặt (Excel · Google)'))));
    }).catch(e => { box.lastChild.textContent = String(e.message || e); });
    return box;
  };
})();
