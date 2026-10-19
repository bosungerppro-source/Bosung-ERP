/* Orders (수주 관리) */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, C = ERP.calc, F = ERP.fmt;

  function bomFor(item) {
    if (!item) return { rows: [], key: null };
    const bom = DB.rows('bom');
    let rows = bom.filter(b => b.retail_no === item);
    if (rows.length) return { rows, key: item };
    const base = String(item).split('-').slice(0, 2).join('-');
    const keys = Array.from(new Set(bom.filter(b => String(b.retail_no).startsWith(base)).map(b => b.retail_no)));
    if (keys.length) return { rows: bom.filter(b => b.retail_no === keys[0]), key: keys[0], alt: keys.length };
    return { rows: [], key: null };
  }
  ERP.bomFor = bomFor;

  // ---- multi-line PO editor: one PO number, several item (품번) lines ----
  const POC = (k) => ERP.TABLES.po.cols.find(c => c.k === k);
  function poEditor(poNo) {
    const exist = poNo ? DB.rows('po').filter(p => String(p.po_no) === String(poNo)) : [];
    const head0 = exist[0] || {};
    const H = { po_no: poNo || '', customer: head0.customer || '', country: head0.country || '', market: head0.market || '', date: head0.date || F.today(), due: head0.due || '', condition: head0.condition || '', mark: head0.mark || '' };
    const lines = exist.length ? exist.map(p => ({ _id: p._id, item_no: p.item_no || '', kind: p.kind || '', color: p.color || '', sets: p.sets, pcs: p.pcs, cs: p.cs })) : [{ item_no: '', kind: '', sets: '', pcs: '' }];
    // item -> {kind, colors}: most frequent combination in past POs first, then item_bom (the master has duplicate rows)
    const ibom = (() => {
      const cnt = new Map();
      const bump = (item, kind, colors) => { if (!item || !colors) return; const k = item + '\u0001' + (kind || '') + '\u0001' + colors; cnt.set(k, (cnt.get(k) || 0) + 1); };
      DB.rows('po').forEach(r => bump(r.item_no, r.kind, +r.color));
      const m = new Map(), best = new Map();
      cnt.forEach((n, k) => { const [item, kind, colors] = k.split('\u0001'); if (!best.has(item) || n > best.get(item)) { best.set(item, n); m.set(item, { item, kind, colors: +colors }); } });
      DB.rows('item_bom').forEach(x => { if (!m.has(x.item)) m.set(x.item, x); });
      return m;
    })();
    const kinds = ERP.colOpts(POC('kind')) || [];
    const body = h('div');
    const dl = h('datalist', { id: 'dl_poitem' }, Array.from(new Set(DB.rows('item_bom').map(x => x.item).concat(Array.from(new Set(DB.rows('bom').map(b => b.retail_no)))))).filter(Boolean).slice(0, 3000).map(v => h('option', { value: v })));
    const dlc = h('datalist', { id: 'dl_pocust' }, Array.from(new Set(DB.rows('po').map(p => p.customer).filter(Boolean))).map(v => h('option', { value: v })));
    const fld = (k, label, o) => h('div', { class: 'field' }, h('label', label, o && o.req ? h('span', { class: 'req' }, ' *') : null), h('input', Object.assign({ class: 'inp', value: H[k], onchange: (e) => { H[k] = e.target.value; } }, o || {})));
    function draw() {
      const totSets = lines.reduce((a, l) => a + (+l.sets || 0), 0), totPcs = lines.reduce((a, l) => a + (+l.pcs || 0), 0);
      body.replaceChildren(dl, dlc,
        h('div', { class: 'form-grid' }, fld('po_no', L('PO 번호', 'Số PO'), { req: 1, disabled: !!poNo }), fld('customer', L('거래처', 'Khách hàng'), { list: 'dl_pocust' }), fld('country', L('국가', 'Quốc gia')), fld('market', L('시장/채널', 'Thị trường')),
          fld('date', L('수주일', 'Ngày đặt'), { type: 'date' }), fld('due', L('납기', 'Ngày giao'), { type: 'date' }), fld('condition', L('조건', 'Điều kiện')), fld('mark', L('비고', 'Ghi chú'))),
        h('h3', { style: { margin: '14px 0 6px' } }, L('품번 라인 (한 PO에 여러 품번)', 'Dòng mặt hàng (nhiều mã trong 1 PO)')),
        h('table', { class: 'tbl entry' }, h('thead', h('tr', ['#', L('품번 (Item)', 'Mã hàng'), L('품목군', 'Nhóm'), L('수량 set', 'SL set'), L('수량 pcs', 'SL pcs'), L('카톤 cs', 'Thùng'), ''].map(x => h('th', x)))),
          h('tbody', lines.map((l, i) => h('tr', h('td', i + 1),
            h('td', h('input', { list: 'dl_poitem', value: l.item_no, style: { minWidth: '190px' }, onchange: (e) => { l.item_no = e.target.value.trim(); const ib = ibom.get(l.item_no); if (ib) { if (ib.kind) l.kind = ib.kind; l.perSet = ib.colors || 0; if (l.sets && !l.pcs && ib.colors) l.pcs = l.sets * ib.colors; } draw(); } })),
            h('td', h('select', { class: 'inp', onchange: (e) => { l.kind = e.target.value; } }, h('option', { value: '' }, '—'), kinds.map(k => h('option', { value: k.v, selected: l.kind === k.v }, k.label)))),
            h('td', h('input', { type: 'number', step: 'any', value: l.sets === undefined ? '' : l.sets, onchange: (e) => { l.sets = e.target.value === '' ? '' : Number(e.target.value); const ib = ibom.get(l.item_no); if (l.sets && ib && ib.colors && !l.pcsTouched) l.pcs = l.sets * ib.colors; draw(); } })),
            h('td', h('input', { type: 'number', step: 'any', value: l.pcs === undefined ? '' : l.pcs, onchange: (e) => { l.pcs = e.target.value === '' ? '' : Number(e.target.value); l.pcsTouched = true; draw(); } })),
            h('td', h('input', { type: 'number', step: 'any', value: l.cs === undefined ? '' : l.cs, onchange: (e) => { l.cs = e.target.value === '' ? '' : Number(e.target.value); } })),
            h('td', h('button', { class: 'icon-btn', onclick: () => { lines.splice(i, 1); if (!lines.length) lines.push({ item_no: '' }); draw(); } }, '×')))),
            h('tr', { style: { background: '#F4F6F9', fontWeight: 700 } }, h('td', ''), h('td', L('합계 ', 'Tổng ') + lines.filter(l => l.item_no).length + L('품번', ' mã')), h('td', ''), h('td', { class: 'num' }, F.n(totSets)), h('td', { class: 'num' }, F.n(totPcs)), h('td'), h('td')))),
        h('div', { class: 'toolbar', style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: () => { lines.push({ item_no: '', kind: (lines[lines.length - 1] || {}).kind }); draw(); } }, '+ ' + L('품번 추가', 'Thêm mã hàng'))));
    }
    draw();
    ERP.modal({ title: poNo ? L('수주 편집 · ', 'Sửa PO · ') + poNo : L('신규 수주 등록', 'Thêm PO mới'), width: '960px', body,
      buttons: [{ label: L('취소', 'Hủy') }].concat(poNo ? [{ label: L('PO 전체 삭제', 'Xóa cả PO'), kind: 'danger', onClick: async () => { if (!(await ERP.confirm(L('PO ' + poNo + '의 ' + exist.length + '개 품번 라인을 모두 삭제할까요?', 'Xóa toàn bộ ' + exist.length + ' dòng của PO ' + poNo + '?'), L('삭제', 'Xóa'), true))) return false; DB.remove('po', exist.map(x => x._id)); ERP.state.ord.sel = null; ERP.render(); } }] : []).concat([{ label: L('저장', 'Lưu'), kind: 'primary', onClick: () => {
        H.po_no = String(H.po_no || '').trim(); const ls = lines.filter(l => l.item_no);
        if (!H.po_no) { ERP.toast(L('PO 번호를 입력하세요', 'Nhập số PO'), 'warn'); return false; }
        if (!ls.length) { ERP.toast(L('품번을 1개 이상 입력하세요', 'Nhập ít nhất 1 mã hàng'), 'warn'); return false; }
        if (!poNo && DB.rows('po').some(p => String(p.po_no) === H.po_no)) { ERP.toast(L('이미 있는 PO 번호입니다. 목록에서 선택해 "수주 편집"으로 품번을 추가하세요.', 'PO đã tồn tại. Hãy chọn trong danh sách rồi Sửa PO để thêm mã.'), 'warn'); return false; }
        const dup = ls.map(l => l.item_no).filter((v, i, a) => a.indexOf(v) !== i); if (dup.length) ERP.toast(L('같은 품번이 중복 입력되었습니다: ', 'Trùng mã hàng: ') + dup[0], 'warn');
        const keep = new Set(ls.filter(l => l._id).map(l => l._id)); DB.remove('po', exist.filter(x => !keep.has(x._id)).map(x => x._id));
        const clean = (l) => { const o = Object.assign({}, H, { item_no: l.item_no, kind: l.kind || undefined, color: l.color || undefined, sets: l.sets === '' ? undefined : l.sets, pcs: l.pcs === '' ? undefined : l.pcs, cs: l.cs === '' ? undefined : l.cs }); Object.keys(o).forEach(k => { if (o[k] === '' || o[k] === undefined) delete o[k]; }); return o; };
        ls.filter(l => l._id).forEach(l => { const r = DB.rows('po').find(x => x._id === l._id); if (r) { const o = clean(l); ['customer', 'country', 'market', 'due', 'condition', 'mark', 'kind', 'sets', 'pcs', 'cs'].forEach(k => { if (o[k] === undefined) delete r[k]; }); Object.assign(r, o); } });
        DB.touch('po'); DB.addMany('po', ls.filter(l => !l._id).map(clean));
        if (ERP.state.ord) ERP.state.ord.sel = H.po_no; ERP.toast(L('저장했습니다 (' + ls.length + '개 품번)', 'Đã lưu (' + ls.length + ' mã)'), 'ok'); ERP.render(); } }]) });
  }

  ERP.pages.orders = { ko: '수주 관리', vi: 'Quản lý đơn hàng', render(root) {
    const st = ERP.state.ord = ERP.state.ord || { tab: 'open', sel: null, view: 'po' };
    if (!st.view) st.view = 'po';
    const lineAll = C.orders(); const byId = new Map(lineAll.map(o => [o.p._id, o]));
    const all = C.poGroups(); const byPo = new Map(all.map(g => [g.po_no, g]));
    const today = F.today();
    const open = all.filter(o => o.st !== 'done');
    const late = open.filter(o => o.st === 'late' && o.dday >= -90);
    const soon = open.filter(o => o.soon);
    const mStart = today.slice(0, 8) + '01';
    const newThisMonth = DB.rows('po').filter(p => p.date >= mStart && p.date <= today);
    const counts = { open: open.length, wait: all.filter(o => o.st === 'wait').length, prod: all.filter(o => o.st === 'prod').length, late: all.filter(o => o.st === 'late').length, done: all.filter(o => o.st === 'done').length, all: all.length };
    const multi = all.filter(g => g.n > 1).length;

    root.appendChild(ERP.pageHead([L('수주 관리', 'Quản lý đơn hàng (PO)'), ERP.sampleChip ? ERP.sampleChip('po') : null], L('PO 번호 단위로 관리 · 한 PO에 여러 품번 가능 · 포장일보의 PO 번호+품번으로 품번별 진행률 자동 집계', 'Quản lý theo số PO · 1 PO nhiều mã hàng · tiến độ từng mã tự tính từ báo cáo đóng gói (số PO + mã)'),
      [h('button', { class: 'btn primary', onclick: () => poEditor(null) }, '+ ' + L('신규 수주 등록', 'Thêm PO mới'))]));

    root.appendChild(h('section', { class: 'kpis' },
      ERP.kpi(L('진행 중 PO', 'PO đang mở'), F.n(open.length), L('건', 'đơn'), 'neutral', L('생산 ' + counts.prod + ' · 대기 ' + counts.wait, 'SX ' + counts.prod + ' · chờ ' + counts.wait), L('완료 ' + counts.done + '건 · 다품번 PO ' + multi + '건', 'Xong ' + counts.done + ' · PO nhiều mã ' + multi)),
      ERP.kpi(L('7일 내 납기', 'Giao trong 7 ngày'), F.n(soon.length), L('건', 'đơn'), soon.length ? 'warn' : 'ok', soon.length ? L('주의', 'Chú ý') : L('정상', 'Tốt'), F.n(soon.reduce((a, o) => a + Math.max(0, o.sets - o.packed), 0)) + ' set ' + L('미포장', 'chưa đóng')),
      ERP.kpi(L('납기 경과 (미완료)', 'Quá hạn chưa xong'), F.n(late.length), L('건', 'đơn'), late.length ? 'bad' : 'ok', late.length ? L('경고', 'Cảnh báo') : L('정상', 'Tốt'), L('최근 90일 이내 납기 기준', 'Hạn trong 90 ngày gần nhất')),
      ERP.kpi(L('이번 달 신규 수주', 'PO mới trong tháng'), F.n(newThisMonth.reduce((a, p) => a + C.num(p.pcs), 0)), 'pcs', 'info', new Set(newThisMonth.map(p => p.po_no)).size + L('건', ' đơn'), L('수주일 기준', 'theo ngày đặt'))));

    const addMonths = (ym, k) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + k, 1)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
    // 7차: 월별 · 품목군별 수주 수량 (pcs) — 기본 Checking(납기) 월 기준, 보고 싶은 품목군만 (여러 개 선택), 품목군을 누르면 품번별로 펼침
    const mq = ERP.state.ordMq = ERP.state.ordMq || { basis: 'due', from: addMonths(today.slice(0, 7), -2), n: 6, open: {} };
    if (!mq.open) mq.open = {};
    const mHost = h('section', { class: 'card' });
    function drawMonthly() {
      const months = []; for (let i = 0; i < mq.n; i++) months.push(addMonths(mq.from, i));
      const shown = C.poKindsShown(); const shownSet = new Set(shown);
      const groups = new Map(); const tot = {};
      DB.rows('po').forEach(p => { const d = String((mq.basis === 'due' ? p.due : p.date) || ''); if (!/^\d{4}-\d\d-\d\d/.test(d)) return; const ym = d.slice(0, 7); if (months.indexOf(ym) < 0) return;
        const k = C.kindOf(p); if (!shownSet.has(k)) return; const q = C.num(p.pcs);
        let g = groups.get(k); if (!g) groups.set(k, g = { k, m: {}, t: 0, items: new Map() }); g.m[ym] = (g.m[ym] || 0) + q; g.t += q; tot[ym] = (tot[ym] || 0) + q;
        const ik = String(p.item_no || '–'); let it = g.items.get(ik); if (!it) g.items.set(ik, it = { k: ik, m: {}, t: 0 }); it.m[ym] = (it.m[ym] || 0) + q; it.t += q; });
      const rows = shown.map(k => groups.get(k)).filter(Boolean);
      const grand = rows.reduce((a, r) => a + r.t, 0);
      const sel = (opts, cur, fn) => h('select', { class: 'inp', onchange: (e) => { fn(e.target.value); drawMonthly(); } }, opts.map(o => h('option', { value: o[0], selected: String(o[0]) === String(cur) }, o[1])));
      const cellv = (v) => (v ? F.n(v) : h('span', { class: 'muted' }, '–'));
      const trs = [];
      rows.forEach(g => {
        const open = !!mq.open[g.k];
        trs.push(h('tr', { class: 'click kindrow', onclick: () => { mq.open[g.k] = !open; drawMonthly(); } }, h('td', h('span', { class: 'caret' }, open ? '▾ ' : '▸ '), h('b', g.k), h('small', { class: 'muted' }, ' · ' + g.items.size + L('품번', ' mã'))), months.map(m => h('td', { class: 'num' }, cellv(g.m[m]))), h('td', { class: 'num' }, h('b', F.n(g.t)))));
        if (open) Array.from(g.items.values()).sort((a, b) => b.t - a.t).forEach(it => trs.push(h('tr', { class: 'subrow' }, h('td', { style: { paddingLeft: '28px' } }, it.k), months.map(m => h('td', { class: 'num' }, cellv(it.m[m]))), h('td', { class: 'num' }, F.n(it.t)))));
      });
      const totalRow = h('tr', { style: { background: '#F4F6F9', fontWeight: '700' } }, h('td', L('합계 (보이는 품목군, pcs)', 'Tổng (nhóm đang xem, pcs)')), months.map(m => h('td', { class: 'num' }, F.n(tot[m] || 0))), h('td', { class: 'num' }, F.n(grand)));
      const table = h('div', { class: 'tbl-wrap', style: { maxHeight: '46vh' } }, h('table', { class: 'tbl' }, h('thead', h('tr', h('th', L('품목군 (누르면 품번별)', 'Nhóm hàng (bấm để xem mã)')), months.map(m => h('th', { class: 'num' }, m)), h('th', { class: 'num' }, L('합계', 'Tổng')))), h('tbody', trs, totalRow)));
      mHost.replaceChildren(h('div', { class: 'card-head' }, h('h2', L('월별 · 품목군별 수주 수량 (pcs)', 'Số lượng đơn hàng theo tháng · nhóm hàng (pcs)')),
        h('div', { class: 'toolbar', style: { margin: 0 } },
          sel([['due', L('Checking(납기) 월 기준', 'Theo tháng Checking (hạn giao)')], ['date', L('수주월 기준', 'Theo tháng đặt')]], mq.basis, v => { mq.basis = v; }),
          h('input', { class: 'inp', type: 'month', value: mq.from, onchange: (e) => { if (e.target.value) { mq.from = e.target.value; drawMonthly(); } } }),
          sel([[3, L('3개월', '3 tháng')], [6, L('6개월', '6 tháng')], [12, L('12개월', '12 tháng')]], mq.n, v => { mq.n = +v; }),
          h('button', { class: 'btn sm', onclick: () => { const aoa = []; rows.forEach(g => { aoa.push([g.k, ''].concat(months.map(m => g.m[m] || 0), [g.t])); if (mq.open[g.k]) Array.from(g.items.values()).sort((a, b) => b.t - a.t).forEach(it => aoa.push([g.k, it.k].concat(months.map(m => it.m[m] || 0), [it.t]))); }); aoa.push([L('합계', 'Tổng'), ''].concat(months.map(m => tot[m] || 0), [grand]));
            ERP.xl.exportAoa('po_monthly_kind', [L('품목군', 'Nhóm'), L('품번', 'Mã hàng')].concat(months, [L('합계', 'Tổng')]), aoa); } }, L('엑셀', 'Excel')))),
        h('div', { class: 'toolbar', style: { margin: '0 0 8px' } }, h('span', { class: 'muted', style: { fontSize: '12.5px' } }, L('보고 싶은 품목군:', 'Nhóm muốn xem:')), ERP.kindChips ? ERP.kindChips(() => drawMonthly()) : null),
        rows.length ? table : h('div', { class: 'empty' }, shown.length ? L('이 기간에 수주가 없습니다.', 'Không có đơn hàng trong kỳ.') : L('품목군을 하나 이상 고르세요.', 'Hãy chọn ít nhất một nhóm hàng.')));
    }
    drawMonthly(); root.appendChild(mHost);

    // list + detail
    const tabs = [['open', L('진행 중', 'Đang mở')], ['wait', L('대기', 'Chờ')], ['prod', L('생산 중', 'Đang SX')], ['late', L('납기 경과', 'Quá hạn')], ['done', L('완료', 'Xong')], ['all', L('전체', 'Tất cả')]];
    const aside = h('aside', { class: 'card detail' });
    const gridHost = h('div');
    const match = (o) => st.tab === 'all' ? true : st.tab === 'open' ? o.st !== 'done' : o.st === st.tab;
    const progCell = (o) => h('div', { style: { minWidth: '110px' } }, ERP.bar(o.prog * 100, o.st === 'late' ? 'bad' : o.st === 'done' ? 'ok' : 'info'), h('small', { class: 'muted' }, F.n(o.prog * 100, 0) + '% · ' + F.n(Math.min(o.packed, o.sets || o.packed)) + '/' + F.n(o.sets)));
    function drawGrid() {
      let g;
      if (st.view === 'po') {
        const mk = (k, ko, vi, t) => ({ k, ko, vi, t: t || 't' });
        g = ERP.grid({ table: 'po', rows: () => all.filter(match).map(o => ({ _id: o.po_no, po_no: o.po_no, customer: o.p.customer, items: o.n, item_no: o.items.length > 1 ? o.items[0] + ' …' : (o.items[0] || ''), sets: o.sets, due: o.p.due })), pageSize: 25, sortKey: 'due', sortDir: 1, canAdd: false, canEdit: false, export: false, maxH: '60vh',
          searchKeys: ['po_no', 'customer', 'item_no'],
          cols: [mk('po_no', 'PO 번호', 'Số PO'), mk('customer', '거래처', 'Khách hàng'), mk('item_no', '품번', 'Mã hàng'), mk('items', '품번 수', 'Số mã', 'n'), mk('sets', '세트', 'Bộ', 'n'), mk('due', '납기', 'Hạn giao', 'd')],
          extraCols: [{ label: () => L('진행', 'Tiến độ'), render: r => progCell(byPo.get(r._id)) }, { label: () => L('납기', 'Hạn'), render: r => { const o = byPo.get(r._id); return ERP.ddayChip(o.dday, o.st); } }, { label: () => L('상태', 'Trạng thái'), render: r => ERP.statusChip(byPo.get(r._id).st) }],
          onRowClick: (r) => { st.sel = r._id; drawAside(); } });
      } else {
        g = ERP.grid({ table: 'po', rows: () => lineAll.filter(match).map(o => o.p), pageSize: 25, sortKey: 'due', sortDir: 1, canAdd: false, maxH: '60vh',
          cols: ['po_no', 'customer', 'item_no', 'kind', 'sets', 'due'].map(POC),
          extraCols: [{ label: () => L('진행', 'Tiến độ'), render: p => progCell(byId.get(p._id)) }, { label: () => L('납기', 'Hạn'), render: p => { const o = byId.get(p._id); return ERP.ddayChip(o.dday, o.st); } }, { label: () => L('상태', 'Trạng thái'), render: p => ERP.statusChip(byId.get(p._id).st) }],
          onRowClick: (p) => { st.sel = String(p.po_no); drawAside(); } });
      }
      gridHost.replaceChildren(g.el);
    }
    function drawAside() {
      const o = byPo.get(String(st.sel));
      if (!o) { aside.replaceChildren(h('div', { class: 'empty' }, L('수주를 선택하면 상세가 표시됩니다.', 'Chọn một PO để xem chi tiết.'))); return; }
      const p = o.p; const lineIds = o.lines;
      const packs = DB.rows('prod_log').filter(r => r.process === 'PCK' && String(r.po_no) === String(o.po_no)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const codes = new Set(o.items.map(String));
      aside.replaceChildren(
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, h('div', h('div', { class: 'sub' }, L('선택한 수주', 'PO đã chọn')), h('h2', { style: { margin: '2px 0 0' } }, o.po_no), h('div', { class: 'muted' }, [p.customer, p.country, o.n > 1 ? o.n + L('개 품번', ' mã hàng') : p.kind].filter(Boolean).join(' · '))), ERP.statusChip(o.st)),
        h('div', { class: 'form-grid', style: { gridTemplateColumns: '1fr 1fr' } },
          h('div', h('div', { class: 'sub' }, L('수량 (전체)', 'Số lượng (tổng)')), h('b', F.n(o.sets) + ' set'), h('div', { class: 'sub' }, F.n(p.pcs) + ' pcs')),
          h('div', h('div', { class: 'sub' }, L('가장 빠른 납기', 'Hạn giao sớm nhất')), h('b', F.d(p.due) || '–'), h('div', ERP.ddayChip(o.dday, o.st))),
          h('div', h('div', { class: 'sub' }, L('수주일', 'Ngày đặt')), h('b', F.d(p.date))), h('div', h('div', { class: 'sub' }, L('전체 포장 진행률', 'Tiến độ đóng gói chung')), h('b', F.n(o.prog * 100, 0) + '%'))),
        ERP.bar(o.prog * 100, o.st === 'late' ? 'bad' : o.st === 'done' ? 'ok' : 'info'),
        h('div', h('h3', L('품번별 진행 (' + o.n + ')', 'Tiến độ từng mã (' + o.n + ')')),
          ERP.simpleTable([{ label: L('품번', 'Mã hàng'), render: l => h('div', h('b', l.p.item_no || '–'), h('div', { class: 'sub' }, l.p.kind || '')) }, { label: 'set', num: 1, render: l => F.n(l.packed) + ' / ' + F.n(l.sets) }, { label: L('진행', 'Tiến độ'), render: l => h('div', { style: { minWidth: '70px' } }, ERP.bar(l.prog * 100, l.st === 'late' ? 'bad' : l.st === 'done' ? 'ok' : 'info'), h('small', { class: 'muted' }, F.n(l.prog * 100, 0) + '%')) },
            { label: L('완제품 재고', 'Tồn TP'), num: 1, render: l => { const st0 = ERP.calc.stock().get(String(l.p.item_no || '')); if (!st0 || (!st0.bal && !st0.n)) return h('span', { class: 'muted' }, '–'); const rem = Math.max(0, l.sets - l.packed); const sets = st0.sets; return h('div', { title: L('창고 ', 'Kho ') + F.n(st0.by.WH) + ' / ' + L('공장 ', 'Xưởng ') + F.n(st0.by.FAC) + ' ' + st0.prim }, h('b', { style: st0.bal < 0 ? { color: '#B3261E' } : null }, F.n(st0.bal, st0.prim === 'kg' ? 1 : 0) + ' ' + st0.prim), sets !== null && sets !== undefined ? h('div', { class: 'sub', style: rem && sets >= rem ? { color: '#0E7A5F' } : null }, F.n(sets) + ' set') : null); } },
            { label: L('납기', 'Hạn'), render: l => h('div', F.md(l.p.due), ERP.ddayChip(l.dday, l.st)) }, { label: '', render: l => h('button', { class: 'btn sm', title: 'BOM/MRP', onclick: () => ERP.goto('bom', { tab: 'mrp', lines: [{ code: bomFor(l.p.item_no).key || l.p.item_no, qty: Math.max(0, Math.round(l.sets - l.packed)) || Math.round(l.sets), unit: 'set' }] }) }, 'MRP') }], lineIds, { maxH: '260px' }),
          o.orphan > 0 ? h('div', { class: 'help', style: { color: '#C77700' } }, L('⚠ 품번이 일치하지 않는 포장 실적 ' + F.n(o.orphan) + ' set 이 있습니다. 포장일보의 코드를 PO 품번과 같게 입력하세요.', '⚠ Có ' + F.n(o.orphan) + ' set đóng gói không khớp mã hàng nào của PO. Hãy nhập mã trùng với mã hàng của PO.')) : null),
        h('div', h('h3', L('포장 실적 (생산일보)', 'Kết quả đóng gói (báo cáo ngày)')), packs.length ? ERP.simpleTable([{ label: L('일자', 'Ngày'), render: r => F.md(r.date) }, { label: L('품번', 'Mã hàng'), render: r => h('span', { style: codes.has(String(r.code)) ? null : { color: '#C77700' } }, r.code || '') }, { label: L('설비', 'Máy'), render: r => r.machine_no || '' }, { label: 'set', num: 1, render: r => F.n(r.ok_qty) }], packs.slice(0, 10), { maxH: '220px' }) : h('div', { class: 'sub' }, L('이 PO 번호의 포장일보가 아직 없습니다. (포장일보에 PO 번호 + 품번 입력)', 'Chưa có báo cáo đóng gói cho PO này. (nhập số PO + mã hàng)'))),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', onclick: () => ERP.goto('bom', { tab: 'mrp', lines: lineIds.filter(l => l.p.item_no).map(l => ({ code: bomFor(l.p.item_no).key || l.p.item_no, qty: Math.max(0, Math.round(l.sets - l.packed)) || Math.round(l.sets), unit: 'set' })) }) }, L('자재 소요량 계산 (전체 품번)', 'Tính nhu cầu NVL (tất cả mã)')),
          h('button', { class: 'btn', onclick: () => poEditor(o.po_no) }, L('수주 편집 · 품번 추가', 'Sửa PO · thêm mã'))));
    }
    const viewSw = h('div', { class: 'seg' }, [['po', L('PO별 보기', 'Theo PO')], ['line', L('품번 라인별 보기', 'Theo dòng mã hàng')]].map(o => h('button', { class: 'btn sm' + (st.view === o[0] ? ' primary' : ''), onclick: () => { st.view = o[0]; ERP.render(); } }, o[1])));
    root.appendChild(h('div', { class: 'row' },
      h('section', { class: 'card grow', style: { flex: '3 1 640px' } }, h('div', { class: 'card-head' }, h('h2', L('수주 목록', 'Danh sách PO')), viewSw,
        ERP.tabs(tabs.map(t => ({ id: t[0], label: t[1] + ' ' + counts[t[0]] })), st.tab, (id) => { st.tab = id; ERP.render(); })), gridHost), aside));
    drawGrid(); drawAside();
  } };
})();
