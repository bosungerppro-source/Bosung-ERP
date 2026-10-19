/* App shell: navigation, routing, boot */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, F = ERP.fmt;

  const NAV = [
    { id: 'dashboard', ko: '종합 현황', vi: 'Tổng quan', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
    { id: 'orders', ko: '수주 관리', vi: 'Đơn hàng (PO)', icon: 'M9 4h6v3H9zM7 5H5v15h14V5h-2M9 12h6M9 16h6' },
    { id: 'production', ko: '생산 관리', vi: 'Sản xuất', icon: 'M3 20V11l6 4v-4l6 4V5h4v15z' },
    { id: 'materials', ko: '품목 · 재고', vi: 'Hàng hóa · Tồn kho', icon: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8' },
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

  function current() { const m = location.hash.match(/^#\/([a-z_]+)/); return m && ERP.pages[m[1]] ? m[1] : 'dashboard'; }

  function badge(id) {
    let n = 0, tone = '#C77700';
    try {
      if (id === 'materials') n = Array.from(ERP.calc.stock().values()).filter(s => s.status === 'low' || s.status === 'neg').length;
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
      if (mt.length) groups.push([L('품목 · 재고', 'Hàng hóa · Tồn kho'), mt.map(m => { const s = ERP.calc.stock().get(m.code); return [m.code + ' · ' + (m.name || ''), (m.erp_code || '') + (s ? ' · ' + F.n(s.bal, s.prim === 'kg' ? 1 : 0) + ' ' + s.prim : ''), () => { document.querySelector('.modal-back') && document.querySelector('.modal-back').remove(); ERP.itemDetail(m.code); }]; })]);
      const rt = Array.from(new Set(DB.rows('bom').filter(b => has(b.retail_no, b.color_code, b.color_name)).map(b => b.retail_no))).slice(0, 8);
      if (rt.length) groups.push([L('제품 / BOM (MRP로 이동)', 'Sản phẩm / BOM (sang MRP)'), rt.map(r => [r, '', () => go('bom', { tab: 'mrp', retail: r, qty: 0 })])]);
      out.append(...(groups.length ? groups.map(g => h('div', { style: { marginBottom: '10px' } }, h('div', { class: 'sub', style: { fontWeight: 700, margin: '4px 0' } }, g[0]), g[1].map(r => h('div', { class: 'click', style: { display: 'flex', justifyContent: 'space-between', padding: '7px 8px', borderRadius: '8px', cursor: 'pointer' }, onmouseenter: (e) => { e.currentTarget.style.background = '#F4F6F9'; }, onmouseleave: (e) => { e.currentTarget.style.background = ''; }, onclick: r[2] }, h('span', r[0]), h('span', { class: 'muted' }, r[1]))))) : [h('div', { class: 'empty' }, L('검색 결과가 없습니다', 'Không có kết quả'))]));
    }
    ERP.modal({ title: L('통합 검색', 'Tìm kiếm nhanh'), width: '680px', body: h('div', inp, out) });
  };
  document.addEventListener('keydown', (e) => { const t = e.target && e.target.tagName; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ERP.search(); } else if (e.key === '/' && t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT') { e.preventDefault(); ERP.search(); } });

  ERP.render = function () {
    ERP.destroyCharts();
    const id = current(); const page = ERP.pages[id];
    const app = $('#app'); app.replaceChildren();
    const nav = h('nav', { class: 'side', 'aria-label': L('주 메뉴', 'Menu chính') },
      h('div', { class: 'brand' }, ERP.svg('M4 20l1-4L16 5l3 3L8 19zM14 7l3 3', 30, 1.8), h('div', h('b', L('생산관리 시스템', 'Quản lý sản xuất')), h('small', L('수주 · 생산 · 재고 · 원부자재', 'Đơn hàng · SX · Kho · NVL')))),
      h('div', { class: 'nav' }, NAV.map(n => n.sep ? h('div', { class: 'sep' }, L(n.ko, n.vi)) : h('a', { class: id === n.id ? 'on' : '', href: '#/' + n.id }, ERP.svg(n.icon, 20), h('span', L(n.ko, n.vi)), badge(n.id)))),
      h('div', { style: { padding: '0 14px 10px' } }, h('button', { class: 'btn', style: { width: '100%', justifyContent: 'space-between', background: '#2F3742', color: '#C9CFD6', borderColor: '#3b4452' }, onclick: () => ERP.search() }, L('통합 검색', 'Tìm nhanh'), h('small', 'Ctrl+K'))),
      h('div', { class: 'side-foot' },
        h('div', { class: 'lang', role: 'group', 'aria-label': 'language' }, h('button', { class: ERP.lang === 'ko' ? 'on' : '', onclick: () => ERP.setLang('ko') }, '한국어'), h('button', { class: ERP.lang === 'vi' ? 'on' : '', onclick: () => ERP.setLang('vi') }, 'Tiếng Việt')),
        h('div', { id: 'savestate', class: 'saved' }, h('i'), h('span', L('저장됨', 'Đã lưu'))),
        h('div', DB.mode === 'server' ? L('서버 저장 모드 (PC 설치형)', 'Lưu trên máy chủ (bản cài đặt)') : L('브라우저 저장 모드 (테스트)', 'Lưu trong trình duyệt (bản thử)'))));
    const main = h('main', { class: 'main', id: 'main' });
    app.append(nav, main);
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
  }
  ERP.boot = boot;
  window.addEventListener('DOMContentLoaded', boot);
})();
