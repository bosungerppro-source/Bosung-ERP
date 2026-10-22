/* App shell: navigation, routing, boot */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, F = ERP.fmt;

  const NAV = [
    { id: 'dashboard', ko: '종합 현황', vi: 'Tổng quan', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
    { id: 'orders', ko: '수주 관리', vi: 'Đơn hàng (PO)', icon: 'M9 4h6v3H9zM7 5H5v15h14V5h-2M9 12h6M9 16h6' },
    { id: 'production', ko: '생산 관리', vi: 'Sản xuất', icon: 'M3 20V11l6 4v-4l6 4V5h4v15z' },
    { id: 'items', ko: '품목', vi: 'Mặt hàng', icon: 'M4 6h2M9 6h11M4 12h2M9 12h11M4 18h2M9 18h11' },
    { id: 'floor', ko: '현장 재고', vi: 'Tồn hiện trường', icon: 'M12 3l9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4' },
    { id: 'materials', ko: '원부자재 재고', vi: 'Tồn NVL', icon: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8' },
    { id: 'bom', ko: '제품 · BOM · 배합', vi: 'Sản phẩm · BOM', icon: 'M5 4h14v4H5zM5 10h6v10H5zM13 10h6v4h-6zM13 16h6v4h-6z' },
    { sep: true, ko: '데이터', vi: 'Dữ liệu' },
    { id: 'data', ko: '엑셀 · 구글 연동', vi: 'Excel · Google', icon: 'M12 3v12M7 10l5 5 5-5M5 21h14' },
    { id: 'settings', ko: '설정', vi: 'Cài đặt', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2l.4 2.6h4.4l.4-2.6a7 7 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z' },
  ];

  ERP.pageHead = function (title, sub, actions) {
    return h('div', { class: 'page-head' }, h('div', h('h1', title), sub ? h('p', sub) : null), actions ? h('div', { class: 'actions' }, actions) : null);
  };
  ERP.goto = function (id, params) { ERP.state.params = params || {}; location.hash = '#/' + id; };
  ERP.saveState = function (s) {
    const el = $('#savestate'); if (!el) return;
    el.className = s; el.lastChild.textContent = s === 'saving' ? L('저장 중…', 'Đang lưu…') : s === 'error' ? L('저장 오류', 'Lỗi lưu') : L('저장됨', 'Đã lưu');
  };

  // 9차: 다른 PC 의 변경을 불러왔을 때 — 창 · 입력 · 끌기 중이 아니고 3초 넘게 손대지 않았으면 화면을 다시 그린다 (스크롤 유지).
  // 아니면 왼쪽 아래에 '다른 PC 변경 있음' 을 띄우고 3초마다 다시 본다 (데이터는 이미 합쳐져 있어 다른 화면으로 가도 최신)
  let lastInput = 0, pdown = false, staleT = null;
  ['keydown', 'pointerdown', 'wheel', 'input'].forEach(ev => document.addEventListener(ev, () => { lastInput = Date.now(); }, true));
  document.addEventListener('pointerdown', () => { pdown = true; }, true);
  ['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, () => { pdown = false; }, true));
  function quiet() {
    const a = document.activeElement;
    const typing = a && (a.tagName === 'TEXTAREA' || a.isContentEditable || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|file|range|color)$/i.test(a.type || '')));
    return !document.querySelector('.modal-back, .login-gate, .upd-gate') && !typing && !pdown && !document.hidden && Date.now() - lastInput > 3000;
  }
  /** 같은 화면을 다시 그린다 — 창 스크롤과 표 안 스크롤 위치를 유지 */
  ERP.refresh = function () {
    const boxes = () => Array.from(document.querySelectorAll('#main .tbl-wrap, #main .entry-wrap'));
    const y = window.scrollY, sc = boxes().map(e => [e.scrollTop, e.scrollLeft]);
    ERP.render();
    window.scrollTo(0, y); boxes().forEach((e, i) => { if (sc[i]) { e.scrollTop = sc[i][0]; e.scrollLeft = sc[i][1]; } });
  };
  ERP.onRemote = function () {
    clearTimeout(staleT); staleT = null;
    if (!$('#app nav.side')) return;   // 아직 첫 화면 전
    if (quiet()) { ERP.refresh(); return; }
    ERP.state.remoteStale = true; const el = $('#remote'); if (el) el.style.display = '';
    staleT = setTimeout(ERP.onRemote, 3000);
  };

  function current() { const m = location.hash.match(/^#\/([a-z_]+)/); return m && ERP.pages[m[1]] ? m[1] : 'dashboard'; }

  // 15차: 프로그램 자동 업데이트 (설치형). 새 버전을 받아 두었으면 이 PC 화면 위에 알린다 — 다음에 켤 때 설치, [지금 업데이트]
  ERP.upd = null;
  function updBar() {
    const s = ERP.upd; if (!s || !s.local || !s.canInstall || !s.ready) return null;
    const v = s.ready.version;
    return h('div', { class: 'upd-bar', role: 'status' }, h('span', '⬆ ' + L('새 버전 ' + v + ' 을 받아 두었습니다 — 다음에 ERP 를 켤 때 설치됩니다 (지금 ' + s.current + ').', 'Đã tải bản mới ' + v + ' — sẽ cài khi mở ERP lần sau (đang dùng ' + s.current + ').')),
      h('button', { class: 'btn sm primary', onclick: () => ERP.updateNow(v) }, L('지금 업데이트', 'Cập nhật ngay')));
  }
  /** 업데이트 상태를 다시 묻고 화면 위 알림을 맞춘다 */
  ERP.updateStatus = function () {
    return fetch('/api/update', { cache: 'no-store' }).then(r => r.json()).then(s => {
      ERP.upd = s;
      const m = $('#main'); const bar = m && m.querySelector(':scope > .upd-bar'); const nb = updBar();
      if (bar && !nb) bar.remove(); else if (nb && m) { if (bar) bar.replaceWith(nb); else m.prepend(nb); }
      return s;
    });
  };
  ERP.updateNow = async function (ver) {
    if (!(await ERP.confirm(L('ERP 를 닫고 새 버전 ' + ver + ' 을 설치한 뒤 다시 켭니다 (1분쯤). 사내망으로 접속한 다른 PC 도 그동안 끊깁니다. 지금 할까요?', 'ERP sẽ đóng, cài bản ' + ver + ' rồi mở lại (khoảng 1 phút). Máy khác trong mạng nội bộ cũng bị ngắt trong lúc đó. Cập nhật ngay?')))) return;
    try {
      await DB.flush();
      const r = await fetch('/api/update/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      document.body.appendChild(h('div', { class: 'upd-gate' }, h('div', { class: 'card' }, h('h2', L('업데이트 설치 중…', 'Đang cài bản cập nhật…')),
        h('p', { class: 'help' }, L('ERP 가 곧 닫히고, 설치가 끝나면 새 버전 ' + ver + ' 으로 다시 켜집니다 (1분쯤).', 'ERP sẽ đóng và mở lại bản ' + ver + ' sau khi cài (khoảng 1 phút).')))));
    } catch (e) { ERP.toast(L('업데이트를 시작하지 못했습니다: ', 'Không bắt đầu cập nhật được: ') + e.message, 'bad'); }
  };

  function badge(id) {
    let n = 0, tone = '#C77700';
    try {
      if (id === 'materials' || id === 'floor') { const g = id === 'floor' ? 'floor' : 'mat'; n = Array.from(ERP.calc.stock().values()).filter(s => (s.status === 'low' || s.status === 'neg') && ERP.inv.groupOf(s) === g).length; }
      else if (id === 'orders') { n = ERP.calc.poGroups().filter(o => o.st === 'late' && o.dday !== null && o.dday >= -30).length; tone = '#B3261E'; }
    } catch (e) { n = 0; }
    return n ? h('em', { style: { marginLeft: 'auto', fontStyle: 'normal', fontSize: '11px', fontWeight: 700, background: tone, color: '#fff', borderRadius: '10px', padding: '1px 7px' } }, n > 99 ? '99+' : n) : null;
  }
  // global search (Ctrl+K or "/")
  ERP.search = function () {
    const out = h('div', { style: { maxHeight: '55vh', overflow: 'auto', marginTop: '10px' } });
    const inp = h('input', { class: 'inp', style: { width: '100%' }, placeholder: L('PO번호 · 품목코드 · ERP CODE · Mã XNK · 품명 · 거래처 · 색상코드 검색', 'Tìm số PO · mã hàng · ERP CODE · Mã XNK · tên · khách · mã màu'), oninput: () => run() });
    const go = (page, params) => { document.querySelector('.modal-back') && document.querySelector('.modal-back').remove(); ERP.goto(page, params); };
    function run() {
      const q = inp.value.trim().toLowerCase(); out.replaceChildren(); if (q.length < 2) return;
      const has = (...v) => v.some(x => x !== undefined && x !== null && String(x).toLowerCase().includes(q));
      const groups = [];
      const po = DB.rows('po').filter(p => has(p.po_no, p.item_no, p.customer)).slice(0, 8);
      if (po.length) groups.push([L('수주', 'Đơn hàng'), po.map(p => [p.po_no + ' · ' + (p.customer || '') + ' · ' + (p.item_no || ''), F.d(p.due) || '', () => go('orders')])]);
      const mt = ERP.inv.search(q, 10);
      if (mt.length) groups.push([L('품목', 'Mặt hàng'), mt.map(m => { const s = ERP.calc.stock().get(m.code); return [m.code + ' · ' + (m.name || ''), (m.erp_code || '') + (s ? ' · ' + F.n(s.bal, s.prim === 'kg' ? 1 : 0) + ' ' + s.prim : ''), () => { document.querySelector('.modal-back') && document.querySelector('.modal-back').remove(); ERP.itemDetail(m.code); }]; })]);
      const rt = Array.from(new Set(DB.rows('bom').filter(b => has(b.retail_no, b.color_code, b.color_name)).map(b => b.retail_no))).slice(0, 8);
      if (rt.length) groups.push([L('제품 / BOM (MRP로 이동)', 'Sản phẩm / BOM (sang MRP)'), rt.map(r => [r, '', () => go('bom', { tab: 'mrp', retail: r, qty: 0 })])]);
      out.append(...(groups.length ? groups.map(g => h('div', { style: { marginBottom: '10px' } }, h('div', { class: 'sub', style: { fontWeight: 700, margin: '4px 0' } }, g[0]), g[1].map(r => h('div', { class: 'click', style: { display: 'flex', justifyContent: 'space-between', padding: '7px 8px', borderRadius: '8px', cursor: 'pointer' }, onmouseenter: (e) => { e.currentTarget.style.background = '#F4F6F9'; }, onmouseleave: (e) => { e.currentTarget.style.background = ''; }, onclick: r[2] }, h('span', r[0]), h('span', { class: 'muted' }, r[1]))))) : [h('div', { class: 'empty' }, L('검색 결과가 없습니다', 'Không có kết quả'))]));
    }
    ERP.modal({ title: L('통합 검색', 'Tìm kiếm nhanh'), width: '680px', body: h('div', inp, out) });
  };
  document.addEventListener('keydown', (e) => { const t = e.target && e.target.tagName; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ERP.search(); } else if (e.key === '/' && t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT') { e.preventDefault(); ERP.search(); } });

  ERP.render = function () {
    ERP.destroyCharts();
    ERP.state.remoteStale = false; clearTimeout(staleT); staleT = null;
    const id = current(); const page = ERP.pages[id];
    const app = $('#app'); app.replaceChildren();
    // 15차: 휴대폰 (좁은 화면) 은 메뉴를 접어 두고 [☰ 지금 화면] 으로 연다
    const navToggle = h('button', { type: 'button', class: 'nav-toggle', 'aria-expanded': 'false', onclick: (e) => { const o = e.currentTarget.closest('nav.side').classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', o ? 'true' : 'false'); } }, '☰ ' + L(page.ko, page.vi));
    const nav = h('nav', { class: 'side', 'aria-label': L('주 메뉴', 'Menu chính') },
      h('div', { class: 'brand' }, ERP.svg('M4 20l1-4L16 5l3 3L8 19zM14 7l3 3', 30, 1.8), h('div', h('b', L('생산관리 시스템', 'Quản lý sản xuất')), h('small', L('수주 · 생산 · 재고 · 원부자재', 'Đơn hàng · SX · Kho · NVL'))), navToggle),
      h('div', { class: 'nav' }, NAV.map(n => n.sep ? h('div', { class: 'sep' }, L(n.ko, n.vi)) : h('a', { class: id === n.id ? 'on' : '', href: '#/' + n.id }, ERP.svg(n.icon, 20), h('span', L(n.ko, n.vi)), badge(n.id)))),
      h('div', { class: 'side-search', style: { padding: '0 14px 10px' } }, h('button', { class: 'btn', style: { width: '100%', justifyContent: 'space-between', background: '#2F3742', color: '#C9CFD6', borderColor: '#3b4452' }, onclick: () => ERP.search() }, L('통합 검색', 'Tìm nhanh'), h('small', 'Ctrl+K'))),
      h('div', { class: 'side-foot' },
        h('div', { class: 'lang', role: 'group', 'aria-label': 'language' }, h('button', { class: ERP.lang === 'ko' ? 'on' : '', onclick: () => ERP.setLang('ko') }, '한국어'), h('button', { class: ERP.lang === 'vi' ? 'on' : '', onclick: () => ERP.setLang('vi') }, 'Tiếng Việt')),
        h('div', { id: 'savestate', class: 'saved' }, h('i'), h('span', L('저장됨', 'Đã lưu'))),
        h('a', { id: 'remote', href: '#', style: { display: 'none' }, onclick: (e) => { e.preventDefault(); ERP.refresh(); } }, '↻ ' + L('다른 PC 변경 있음 · 새로 고침', 'Có thay đổi từ máy khác · Làm mới')),
        // 18차: 구글 드라이브 공유 상태 (켜져 있을 때만) — 누르면 엑셀 · 구글 연동의 공유 카드
        h('a', { id: 'cloudstate', href: '#/data', style: { display: 'none' }, onclick: () => { ERP.state.dataTab = 'google'; } }),
        h('div', DB.mode === 'server' ? L('서버 저장 모드 (PC 설치형)', 'Lưu trên máy chủ (bản cài đặt)') : L('브라우저 저장 모드 (테스트)', 'Lưu trong trình duyệt (bản thử)'))));
    const main = h('main', { class: 'main', id: 'main' }, updBar());
    app.append(nav, main); DB._state && DB._state(); ERP.cloudBrief && ERP.cloudBrief();
    document.title = L(page.ko, page.vi) + ' · ColorPencil ERP';
    try { page.render(main); } catch (e) { console.error(e); main.appendChild(h('div', { class: 'card' }, h('h2', 'Error'), h('pre', String(e.stack || e)))); }
    window.scrollTo(0, 0);
  };

  async function boot() {
    const app = $('#app');
    app.appendChild(h('div', { style: { margin: 'auto', textAlign: 'center', padding: '80px', color: '#5B6470' } }, L('데이터를 불러오는 중…', 'Đang tải dữ liệu…')));
    try { await DB.init(); ERP.loadProcs(); ERP.aiReady && ERP.aiReady(); } catch (e) { console.error(e); app.replaceChildren(h('div', { class: 'card', style: { margin: '40px' } }, h('h2', 'Startup error'), h('pre', String(e.stack || e)))); return; }
    window.addEventListener('hashchange', ERP.render);
    ERP.render();
    // 18차: 구글 드라이브 공유 상태 (왼쪽 아래) — 그다음은 20초마다 db.js poll 이 받는다
    if (DB.mode === 'server') fetch('/api/versions', { cache: 'no-store' }).then(r => r.json()).then(v => { if (v && v.cloud) ERP.cloudBrief(v.cloud); }).catch(() => { /* 다음 poll */ });
    // 9차: ERP 가 실행 중인 PC 에서 — 자동 백업을 켰는데 이틀 넘게 성공하지 못했으면 알린다 (USB 빠짐 · NAS 꺼짐 등)
    if (DB.mode === 'server' && DB.ping && DB.ping.loopback) fetch('/api/backup').then(r => r.json()).then(b => {
      if (!(b.dir || b.google) || !b.lastTry) return;
      if (!b.lastOk || Date.now() - Date.parse(b.lastOk) > 2 * 86400000) ERP.toast(L('자동 백업이 이틀 넘게 되지 않았습니다 — 설정 → 사내망 접속 · 자동 백업에서 확인하세요', 'Sao lưu tự động đã hơn 2 ngày không thành công — kiểm tra ở Cài đặt → Mạng nội bộ · Sao lưu') + (b.lastError ? ' (' + b.lastError + ')' : ''), 'bad');
    }).catch(() => { /* ignore */ });
    // 15차: 업데이트 상태 (설치형 · 이 PC) — 켤 때와 10분마다. 방금 새 버전으로 바뀌었으면 한 번 알린다
    if (DB.mode === 'server' && DB.ping && DB.ping.loopback) {
      const tick = () => ERP.updateStatus().then(s => {
        const u = s && s.justUpdated; if (!u || !u.to) return;
        let seen = null; try { seen = localStorage.getItem('erp_updated'); } catch (e) { /* 저장소 없음 */ }
        if (seen === u.to) return; try { localStorage.setItem('erp_updated', u.to); } catch (e) { /* 저장소 없음 */ }
        ERP.toast(L('ColorPencil ERP 를 새 버전으로 바꿨습니다: ', 'Đã cập nhật ColorPencil ERP: ') + (u.from ? u.from + ' → ' : '') + u.to, 'ok');
      }).catch(() => { /* 설치형이 아님 */ });
      tick(); const t = setInterval(tick, 10 * 60000); t.unref && t.unref();
      ERP.mobileAuto();   // 휴대폰 보기(구글 웹 앱) 를 켰으면 요약을 15분마다 보낸다
    }
  }
  ERP.boot = boot;
  window.addEventListener('DOMContentLoaded', boot);
})();
