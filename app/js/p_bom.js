/* Products / BOM (customizable structure) / Recipes / MRP with stock comparison */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, C = ERP.calc, F = ERP.fmt;
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const simple = (table, extra) => (host) => host.appendChild(ERP.grid(Object.assign({ table, pageSize: 50, maxH: '66vh' }, extra || {})).el);
  const TYPE = (v) => { const t = ERP.ITEM_TYPES.find(x => x.v === v); return t ? L(t.ko, t.vi) : (v || ''); };

  // ---------- lookups ----------
  // 6차: 원료명 → 품목 마스터(원재료 RM) 우선, 없으면 예전 원부자재 마스터 이름으로 같은 코드의 품목을 찾는다
  function matByName() { return ERP.inv ? ERP.inv.rmByName() : new Map(); }
  function recipeByCode() { return DB.memo('bom.recIdx', ['recipes'], () => { const m = new Map(); DB.rows('recipes').forEach(r => { let a = m.get(r.code); if (!a) m.set(r.code, a = []); a.push(r); }); return m; }); }
  function bomIdx() { return DB.memo('bom.bomIdx', ['bom'], () => { const byRetail = new Map(), byColor = new Map(); DB.rows('bom').forEach(b => { let a = byRetail.get(b.retail_no); if (!a) byRetail.set(b.retail_no, a = []); a.push(b); if (!byColor.has(b.color_code)) byColor.set(b.color_code, b); }); return { byRetail, byColor }; }); }
  function linesByParent() { return DB.memo('bom.lines', ['bom_lines'], () => { const m = new Map(); DB.rows('bom_lines').forEach(l => { let a = m.get(l.parent); if (!a) m.set(l.parent, a = []); a.push(l); }); return m; }); }
  function nameOf(code) {
    const it = DB.rows('items').find(x => x.code === code); if (it && it.name) return it.name;
    const m = DB.rows('materials').find(x => x.code === code); if (m) return m.name_en || m.name_kr || '';
    const sm = DB.rows('semi_items').find(x => x.code === code); if (sm) return sm.name || '';
    return ERP.codeName ? (ERP.codeName(code) || '') : '';
  }
  function codeList() {
    return DB.memo('bom.codes', ['items', 'materials', 'semi_items', 'products', 'bom'], () => {
      const s = new Set(); DB.rows('items').forEach(x => s.add(x.code)); DB.rows('bom').forEach(x => s.add(x.retail_no)); DB.rows('materials').forEach(x => s.add(x.code));
      DB.rows('semi_items').forEach(x => s.add(x.code)); DB.rows('products').forEach(x => s.add(x.code)); return Array.from(s).filter(Boolean).slice(0, 6000);
    });
  }
  const dlCodes = (id) => h('datalist', { id }, codeList().map(v => h('option', { value: v })));

  // ---------- MRP engine ----------
  /** lines: [{code, qty, unit: 'set'|'pcs'|'ea'}] -> {rows:[component rows], info:[per line], kpi} */
  function mrpCalc(lines, opt) {
    opt = opt || {};
    const st = C.stock(); const bi = bomIdx(); const rec = recipeByCode(); const lp = linesByParent(); const mats = matByName();
    const semiRows = new Map(DB.rows('semi_stock').map(r => [r.code, r]));
    const items = new Map(DB.rows('items').map(r => [r.code, r]));
    const avail = new Map();                       // netting pools for semi / parts
    const poolOf = (code) => { if (avail.has(code)) return avail.get(code); let q = 0; if (semiRows.has(code)) q = C.num(semiRows.get(code).qty); else if (st.has(code)) q = Math.max(0, st.get(code).bal); const o = { q, init: q }; avail.set(code, o); return o; };
    const take = (code, need) => { const p = poolOf(code); const t = Math.min(p.q, need); p.q -= t; return t; };
    const agg = new Map();                          // key -> row
    const add = (kind, code, name, unit, need, extra) => { const k = kind + '|' + code; let r = agg.get(k); if (!r) agg.set(k, r = Object.assign({ kind, code, name, unit, need: 0, stock: null }, extra || {})); r.need += need; return r; };
    const info = []; const unknown = [];
    (lines || []).forEach(ln => {
      const code = String(ln.code || '').trim(); const qty = C.num(ln.qty); if (!code || !qty) return;
      const unit = ln.unit || 'pcs'; let route = null, pcs = qty, colors = 0;
      const custom = lp.get(code);
      let rows = bi.byRetail.get(code);
      if (!rows && !custom) { const b = ERP.bomFor(code); if (b.rows.length && !bi.byColor.has(code)) rows = b.rows; }
      if (custom) {
        route = 'custom'; explodeCustom(code, qty, 0);
      } else if (rows && rows.length) {
        route = 'retail'; colors = rows.length;
        const ib = DB.rows('item_bom').find(x => x.item === code); const perSet = (ib && ib.colors) || rows[0].n_colors || rows.length;
        pcs = unit === 'set' ? qty * perSet : qty; const per = pcs / rows.length;
        rows.forEach(b => colorNeed(b, per));
      } else if (bi.byColor.has(code)) {
        route = 'color'; colors = 1; colorNeed(bi.byColor.get(code), qty);
      } else { route = 'unknown'; unknown.push(code); }
      info.push({ code, qty, unit, route, pcs, colors });
    });
    function colorNeed(b, per) {
      let netRefill = per;
      [['Nose cone', b.nose_code], ['Refill', b.refill_code], ['Barrel', b.barrel_code], ['Holder', b.holder], ['Spoon', b.spoon]].forEach(([k, code]) => {
        if (!code) return; const r = add('semi', code, nameOf(code) || (b.color_name + ' ' + k), 'pcs', per, { part: k }); const t = take(code, per); if (k === 'Refill') netRefill = per - t;
      });
      (rec.get(b.color_code) || []).forEach(rr => {
        const q = C.num(rr.coef) * (opt.netSemi === false ? per : netRefill) / 1000; const key = norm(rr.material); const m = mats.get(key);
        add('raw', m ? m.code : 'N:' + key, m ? (st.get(m.code) ? st.get(m.code).name : (m.name || m.name_en)) : rr.material, 'kg', q, { matched: !!m, mcode: m ? m.code : null });
      });
    }
    function explodeCustom(code, qty, depth) {
      if (depth > 8) return; const kids = lp.get(code); const it = items.get(code);
      if (kids && kids.length) {
        add('asm', code, (it && it.name) || nameOf(code), (it && it.unit) || 'pcs', qty, { type: it && it.type }); const t = take(code, qty); const net = qty - t;
        if (net > 0) kids.forEach(k => explodeCustom(k.child, net * C.num(k.qty || 1) * (1 + C.num(k.loss) / 100), depth + 1));
      } else {
        const it0 = ERP.inv ? ERP.inv.item(code) : null; const m = (it0 && ERP.inv.info(it0).stage === 'RM') ? it0 : DB.rows('materials').find(x => x.code === code);
        if (m) { const s = st.get(m.code || code); add('raw', m.code || code, s ? s.name : (m.name || m.name_en), s ? s.prim : 'kg', qty, { matched: true, mcode: m.code || code }); }
        else { add('semi', code, (it && it.name) || nameOf(code), (it && it.unit) || 'pcs', qty, { type: it && it.type }); take(code, qty); }
      }
    }
    // stock + shortage
    const rows = Array.from(agg.values()).map(r => {
      if (r.kind === 'raw') { const m = r.mcode ? st.get(r.mcode) : null; r.stock = m ? m.bal : null; r.unit = m ? m.prim : r.unit; }
      else { const p = avail.get(r.code); r.stock = p ? p.init : 0; }
      r.short = r.stock === null ? null : Math.max(0, r.need - r.stock);
      return r;
    });
    const ord = { raw: 0, semi: 1, asm: 2 };
    rows.sort((a, b) => ((b.short || 0) > 0) - ((a.short || 0) > 0) || (ord[a.kind] - ord[b.kind]) || String(a.code).localeCompare(String(b.code)));
    return { rows, info, unknown };
  }
  ERP.mrp = mrpCalc;

  // ---------- MRP tab ----------
  function mrpTab(host) {
    const lines = DB.setting('mrpLines', null) || [{ code: '', qty: '', unit: 'set' }];
    const st = ERP.state.mrp = ERP.state.mrp || { view: 'all', net: true };
    const p = ERP.state.params;
    if (p && p.lines) { if (lines.length === 1 && !lines[0].code) lines.length = 0; p.lines.forEach(n => { const ex = lines.find(l => l.code === n.code && l.unit === n.unit); if (ex) ex.qty = Math.max(C.num(ex.qty), n.qty); else lines.push(n); }); ERP.state.params = {}; DB.setSetting('mrpLines', lines); }
    if (p && p.retail) { if (!lines.some(l => l.code === p.retail)) { if (lines.length === 1 && !lines[0].code) lines.length = 0; lines.push({ code: p.retail, qty: Math.round(p.qty || 0), unit: 'set' }); } ERP.state.params = {}; }
    const save = () => DB.setSetting('mrpLines', lines);
    const wrap = h('div');
    function importPO() {
      const open = C.orders().filter(o => C.isOpen(o) && o.p.item_no && (o.sets - o.packed) > 0).sort((a, b) => (a.p.due || '9').localeCompare(b.p.due || '9')).slice(0, 150);
      const boxes = open.map(o => h('label', { style: { display: 'flex', gap: '8px', padding: '4px 0' } }, h('input', { type: 'checkbox' }), h('span', h('b', o.p.po_no), ' ' + [o.p.customer, o.p.item_no].join(' · ') + ' · ' + F.n(o.sets - o.packed) + ' set · ' + F.d(o.p.due))));
      ERP.modal({ title: L('진행 중 수주에서 가져오기', 'Lấy từ PO đang mở'), width: '760px', body: h('div', { style: { maxHeight: '55vh', overflow: 'auto' } }, open.length ? boxes : h('div', { class: 'empty' }, L('미포장 수주가 없습니다', 'Không có PO chưa đóng gói'))),
        buttons: [{ label: L('취소', 'Hủy') }, { label: L('선택 추가 (미포장 set)', 'Thêm mục đã chọn (set còn lại)'), kind: 'primary', onClick: () => {
          if (lines.length === 1 && !lines[0].code) lines.length = 0;
          open.forEach((o, i) => { if (boxes[i].querySelector('input').checked) { const ex = lines.find(l => l.code === o.p.item_no && l.unit === 'set'); const q = Math.round(o.sets - o.packed); if (ex) ex.qty = C.num(ex.qty) + q; else lines.push({ code: o.p.item_no, qty: q, unit: 'set', ref: o.p.po_no }); } });
          save(); draw(); } }] });
    }
    function pasteBox() {
      const ta = h('textarea', { class: 'inp', style: { width: '100%', height: '200px', fontFamily: 'monospace' }, placeholder: '52-9724-A\t240\tset\nBM01002\t5000\tpcs' });
      ERP.modal({ title: L('엑셀에서 붙여넣기', 'Dán từ Excel'), width: '640px', body: h('div', h('p', { class: 'help' }, L('열 순서: 품번 · 수량 · 단위(set 또는 pcs; 생략 시 pcs)', 'Thứ tự cột: mã · số lượng · đơn vị (set hoặc pcs; mặc định pcs)')), ta),
        buttons: [{ label: L('취소', 'Hủy') }, { label: L('추가', 'Thêm'), kind: 'primary', onClick: () => {
          const add = ta.value.split(/\r?\n/).map(x => x.split('\t')).filter(c => c[0] && c[0].trim()).map(c => ({ code: c[0].trim(), qty: ERP.fmt.parseNum(c[1]) || 0, unit: /set/i.test(c[2] || '') ? 'set' : /ea/i.test(c[2] || '') ? 'ea' : 'pcs' }));
          if (lines.length === 1 && !lines[0].code) lines.length = 0; lines.push(...add); save(); draw(); } }] });
    }
    function draw() {
      const res = mrpCalc(lines, { netSemi: st.net });
      const shortRows = res.rows.filter(r => r.short > 0); const rawShort = shortRows.filter(r => r.kind === 'raw');
      const unmatched = res.rows.filter(r => r.kind === 'raw' && r.stock === null);
      const lineTbl = h('table', { class: 'tbl entry' }, h('thead', h('tr', ['#', L('품번 / 색상코드', 'Mã hàng / mã màu'), L('수량', 'Số lượng'), L('단위', 'Đơn vị'), L('해석', 'Nhận dạng'), ''].map(x => h('th', x)))),
        h('tbody', lines.map((l, i) => { const inf = res.info.find(x => x.code === String(l.code || '').trim()); const unk = l.code && res.unknown.indexOf(String(l.code).trim()) >= 0;
          return h('tr', h('td', i + 1),
            h('td', h('input', { list: 'dl_mrp', value: l.code || '', 'data-r': i, 'data-c': 'code', style: { minWidth: '200px' }, onchange: (e) => { l.code = e.target.value.trim(); save(); draw(); } })),
            h('td', h('input', { type: 'number', min: 0, value: l.qty === undefined ? '' : l.qty, 'data-r': i, 'data-c': 'qty', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (i === lines.length - 1) { lines.push({ code: '', qty: '', unit: l.unit }); save(); draw(); } const n = wrap.querySelector('input[data-r="' + (i + 1) + '"][data-c="code"]'); if (n) n.focus(); } }, onchange: (e) => { l.qty = e.target.value === '' ? '' : Number(e.target.value); save(); draw(); } })),
            h('td', h('select', { class: 'inp', onchange: (e) => { l.unit = e.target.value; save(); draw(); } }, [['set', L('세트 (set)', 'Bộ (set)')], ['pcs', L('색연필 낱개 (pcs)', 'Cây lẻ (pcs)')], ['ea', 'ea']].map(o => h('option', { value: o[0], selected: (l.unit || 'set') === o[0] }, o[1])))),
            h('td', { class: 'muted' }, !l.code ? '' : unk ? ERP.chip('bad', L('BOM 없음', 'Không có BOM')) : inf ? [ERP.chip('info', { retail: L('Retail BOM', 'BOM Retail'), color: L('색상 BOM', 'BOM màu'), custom: L('사용자 구성', 'Cấu thành tự tạo') }[inf.route] || inf.route), ' ' + (inf.route === 'retail' ? F.n(inf.pcs) + ' pcs · ' + inf.colors + L('색', ' màu') : '')] : ''),
            h('td', h('button', { class: 'icon-btn', 'aria-label': 'remove', onclick: () => { lines.splice(i, 1); if (!lines.length) lines.push({ code: '', qty: '', unit: 'set' }); save(); draw(); } }, '×'))); })));
      const view = st.view; const show = res.rows.filter(r => view === 'all' ? true : view === 'short' ? r.short > 0 : view === 'raw' ? r.kind === 'raw' : r.kind !== 'raw');
      const kindChip = (r) => r.kind === 'raw' ? ERP.chip('info', L('원부자재', 'NVL')) : r.kind === 'asm' ? ERP.chip('neutral', L('조립품', 'Cụm lắp')) : ERP.chip('neutral', r.part || L('세미/부품', 'Bán TP/chi tiết'));
      const cols = [{ label: L('구분', 'Loại'), render: kindChip }, { label: L('코드', 'Mã'), render: r => r.kind === 'raw' && !r.mcode ? h('span', { class: 'muted' }, '–') : r.code }, { label: L('품명', 'Tên'), render: r => r.name || '' },
        { label: L('소요량', 'Cần'), num: 1, render: r => F.n(r.need, r.unit === 'kg' ? 2 : 0) }, { label: L('현재 재고', 'Tồn hiện có'), num: 1, render: r => r.stock === null ? '?' : F.n(r.stock, r.unit === 'kg' ? 1 : 0) },
        { label: L('부족분', 'Thiếu'), num: 1, render: r => r.short === null ? '–' : r.short > 0 ? h('b', { style: { color: '#9F1F18' } }, F.n(r.short, r.unit === 'kg' ? 2 : 0)) : '0' }, { label: L('단위', 'ĐV'), render: r => r.unit },
        { label: L('판정', 'KQ'), render: r => r.short === null ? ERP.chip('neutral', L('재고 매칭 없음', 'Chưa khớp kho')) : r.short > 0 ? ERP.chip('bad', L('부족', 'Thiếu')) : ERP.chip('ok', L('충분', 'Đủ')) }];
      const seg = (id, label) => h('button', { class: 'btn sm' + (view === id ? ' primary' : ''), onclick: () => { st.view = id; draw(); } }, label);
      wrap.replaceChildren(dlCodes('dl_mrp'),
        h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: importPO }, L('진행 중 수주에서 가져오기', 'Lấy từ PO đang mở')), h('button', { class: 'btn', onclick: pasteBox }, L('엑셀에서 붙여넣기', 'Dán từ Excel')),
          h('button', { class: 'btn', onclick: () => { lines.push({ code: '', qty: '', unit: (lines[lines.length - 1] || {}).unit || 'set' }); save(); draw(); const n = wrap.querySelector('input[data-r="' + (lines.length - 1) + '"][data-c="code"]'); if (n) n.focus(); } }, '+ ' + L('행 추가', 'Thêm dòng')),
          h('button', { class: 'btn', onclick: () => { lines.length = 0; lines.push({ code: '', qty: '', unit: 'set' }); save(); draw(); } }, L('모두 지우기', 'Xóa hết')), h('span', { class: 'sp' }),
          h('label', { class: 'muted nowrap', title: L('리필 재고가 있으면 그만큼 원료 소요를 줄입니다', 'Nếu có tồn refill thì giảm nhu cầu nguyên liệu tương ứng') }, h('input', { type: 'checkbox', checked: st.net, onchange: (e) => { st.net = e.target.checked; draw(); } }), ' ', L('세미(리필) 재고 차감 후 원료 계산', 'Trừ tồn bán TP (refill) khi tính NL'))),
        h('div', { class: 'entry-wrap' }, lineTbl),
        h('p', { class: 'help' }, L('수량 단위: "세트"는 BOM 색상수 × 수량으로 pcs 환산, "낱개(pcs)"는 색연필 개수입니다. 여러 품번을 줄줄이 입력하면 합산하여 계산합니다. 입력 내용은 자동 저장됩니다.', '"Bộ" = số màu × số lượng → pcs; "pcs" = số cây. Nhập nhiều mã, hệ thống cộng gộp. Tự động lưu.')),
        res.rows.length ? h('div', [
          h('section', { class: 'kpis', style: { margin: '14px 0' } },
            ERP.kpi(L('소요 품목', 'Số mã cần'), F.n(res.rows.length), L('종', 'mã'), 'neutral', null, L('원부자재 ' + res.rows.filter(r => r.kind === 'raw').length + ' · 세미/부품 ' + res.rows.filter(r => r.kind !== 'raw').length, 'NVL ' + res.rows.filter(r => r.kind === 'raw').length + ' · bán TP ' + res.rows.filter(r => r.kind !== 'raw').length)),
            ERP.kpi(L('부족 품목', 'Mã thiếu'), F.n(shortRows.length), L('종', 'mã'), shortRows.length ? 'bad' : 'ok', shortRows.length ? L('조치 필요', 'Cần xử lý') : L('모두 충분', 'Đủ hết'), L('원료 ' + rawShort.length + '종 · 세미/부품 ' + (shortRows.length - rawShort.length) + '종', 'NL ' + rawShort.length + ' · bán TP ' + (shortRows.length - rawShort.length))),
            ERP.kpi(L('부족 원료 합계', 'Tổng NL thiếu'), F.n(rawShort.filter(r => r.unit === 'kg').reduce((a, r) => a + r.short, 0), 1), 'kg', rawShort.length ? 'warn' : 'ok', null, L('발주 필요량', 'Cần đặt mua')),
            ERP.kpi(L('재고 미매칭 원료', 'NL chưa khớp kho'), F.n(unmatched.length), L('종', 'mã'), unmatched.length ? 'warn' : 'ok', null, L('배합표 원료명 ≠ 재고 마스터', 'Tên NL khác danh mục kho'))),
          h('div', { class: 'toolbar' }, seg('all', L('전체', 'Tất cả') + ' ' + res.rows.length), seg('short', L('부족만', 'Chỉ thiếu') + ' ' + shortRows.length), seg('raw', L('원부자재', 'NVL')), seg('semi', L('세미/부품', 'Bán TP/chi tiết')), h('span', { class: 'sp' }),
            h('button', { class: 'btn primary', onclick: () => ERP.xl.exportAoa('mrp_shortage', cols.map(c => c.label).slice(0, 7), show.map(r => [r.kind, r.code, r.name, +r.need.toFixed(3), r.stock === null ? null : +r.stock.toFixed(2), r.short === null ? null : +r.short.toFixed(3), r.unit])) }, L('엑셀로 내보내기', 'Xuất Excel'))),
          ERP.simpleTable(cols, show, { maxH: '58vh' }),
          unmatched.length ? h('p', { class: 'help' }, L('재고 매칭 없음: ', 'Chưa khớp kho: ') + unmatched.slice(0, 8).map(r => r.name).join(', ') + (unmatched.length > 8 ? ' …' : '') + L(' — 원부자재 마스터의 영문명을 배합표의 원료명과 같게 맞추면 재고와 자동 비교됩니다.', ' — hãy đặt tên tiếng Anh trong danh mục NVL trùng tên trong công thức để tự so sánh tồn.')) : null]) : h('div', { class: 'empty' }, L('위에 품번과 수량을 입력하면 소요량·재고·부족분이 표시됩니다.', 'Nhập mã hàng và số lượng ở trên để xem nhu cầu, tồn kho và phần thiếu.')));
    }
    host.appendChild(wrap); draw();
  }

  // ---------- structure (custom BOM) ----------
  /** BOM 편집 창 (다른 화면에서도 연다: ERP.bomEditor(code)) */
  function editor(parentCode) {
      const lp = linesByParent(); const existing = parentCode ? (lp.get(parentCode) || []) : [];
      const it = parentCode ? DB.rows('items').find(x => x.code === parentCode) : null;
      const m = { code: parentCode || '', name: it ? it.name : '', type: it ? it.type : 'SEMI', unit: it ? (it.unit || 'pcs') : 'pcs', kids: existing.length ? existing.map(k => ({ child: k.child, qty: k.qty === undefined ? 1 : k.qty, loss: k.loss || 0 })) : [{ child: '', qty: 1, loss: 0 }, { child: '', qty: 1, loss: 0 }] };
      const body = h('div');
      // 새 조합인데 이미 구성이 있는 품목을 고르면 그 구성을 불러와 고치게 한다 (저장할 때 기존 줄을 바꾸므로 중복되지 않는다)
      let loadedFrom = '';
      function loadExisting() {
        if (parentCode || !m.code || loadedFrom === m.code) return; const ex = linesByParent().get(m.code) || []; if (!ex.length) return;
        loadedFrom = m.code; m.kids = ex.map(k => ({ child: k.child, qty: k.qty === undefined ? 1 : k.qty, loss: k.loss || 0 }));
        ERP.toast(L('이미 구성이 있는 품목입니다 — 기존 구성(' + ex.length + '줄)을 불러왔습니다. 저장하면 이 구성으로 바뀝니다.', 'Mã đã có cấu thành — đã tải ' + ex.length + ' dòng. Lưu sẽ thay cấu thành này.'), 'warn');
      }
      function drawM() {
        const tree = []; (function walk(code, mult, d) { if (d > 6) return; (linesByParent().get(code) || []).forEach(k => { const q = mult * C.num(k.qty || 1); tree.push({ d, code: k.child, qty: q }); walk(k.child, q, d + 1); }); })(m.code, 1, 0);
        body.replaceChildren(dlCodes('dl_bomc'),
          h('div', { class: 'form-grid' },
            h('div', { class: 'field' }, h('label', L('결과 품목 코드 (3번)', 'Mã thành phẩm (cha)'), h('span', { class: 'req' }, ' *')), h('input', { class: 'inp', list: 'dl_bomc', value: m.code, disabled: !!parentCode, onchange: (e) => { m.code = e.target.value.trim(); loadExisting(); if (!m.name) m.name = nameOf(m.code); drawM(); } })),
            h('div', { class: 'field' }, h('label', L('품명', 'Tên')), h('input', { class: 'inp', value: m.name, onchange: (e) => { m.name = e.target.value; } })),
            h('div', { class: 'field' }, h('label', L('유형', 'Loại')), h('select', { class: 'inp', onchange: (e) => { m.type = e.target.value; } }, ERP.ITEM_TYPES.map(t => h('option', { value: t.v, selected: m.type === t.v }, L(t.ko, t.vi))))),
            h('div', { class: 'field' }, h('label', L('단위', 'Đơn vị')), h('input', { class: 'inp', value: m.unit, onchange: (e) => { m.unit = e.target.value; } }))),
          h('h3', { style: { marginTop: '14px' } }, L('구성품 (이 품목 1개를 만들 때 들어가는 것)', 'Thành phần (cho 1 đơn vị thành phẩm)')),
          h('table', { class: 'tbl entry' }, h('thead', h('tr', ['#', L('구성품 코드 (1번, 2번 …)', 'Mã thành phần'), L('품명', 'Tên'), L('소요량', 'Định mức'), L('손실률 %', 'Hao hụt %'), ''].map(x => h('th', x)))),
            h('tbody', m.kids.map((k, i) => h('tr', h('td', i + 1), h('td', h('input', { list: 'dl_bomc', value: k.child, onchange: (e) => { k.child = e.target.value.trim(); drawM(); } })), h('td', { class: 'muted' }, nameOf(k.child)),
              h('td', h('input', { type: 'number', step: 'any', value: k.qty, onchange: (e) => { k.qty = Number(e.target.value); } })), h('td', h('input', { type: 'number', step: 'any', value: k.loss, onchange: (e) => { k.loss = Number(e.target.value); } })),
              h('td', h('button', { class: 'icon-btn', onclick: () => { m.kids.splice(i, 1); drawM(); } }, '×')))))),
          h('div', { class: 'toolbar', style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: () => { m.kids.push({ child: '', qty: 1, loss: 0 }); drawM(); } }, '+ ' + L('구성품 추가', 'Thêm thành phần'))),
          tree.length ? h('div', h('h3', L('하위 전개 (1개당)', 'Triển khai (1 đơn vị)')), h('div', { class: 'list' }, tree.map(t => h('div', h('span', { style: { paddingLeft: (t.d * 18) + 'px' } }, t.code + ' ', h('small', { class: 'muted' }, nameOf(t.code))), h('b', F.n(t.qty, 3)))))) : null);
      }
      drawM();
      ERP.modal({ title: parentCode ? L('구성 편집 · ', 'Sửa cấu thành · ') + parentCode : L('새 조합(구성) 만들기', 'Tạo cấu thành mới'), width: '860px', body,
        buttons: [{ label: L('취소', 'Hủy') }].concat(parentCode ? [{ label: L('구성 삭제', 'Xóa cấu thành'), kind: 'danger', onClick: async () => { DB.remove('bom_lines', existing.map(x => x._id)); ERP.render(); } }] : []).concat([{ label: L('저장', 'Lưu'), kind: 'primary', onClick: () => {
          const kids = m.kids.filter(k => k.child && k.qty); if (!m.code || !kids.length) { ERP.toast(L('결과 품목과 구성품을 입력하세요', 'Nhập thành phẩm và thành phần'), 'warn'); return false; }
          if (kids.some(k => k.child === m.code)) { ERP.toast(L('자기 자신을 구성품으로 쓸 수 없습니다', 'Không dùng chính nó làm thành phần'), 'warn'); return false; }
          DB.remove('bom_lines', (linesByParent().get(m.code) || []).map(x => x._id));   // 이 품목의 기존 구성(자동 포함)을 바꾼다
          DB.addMany('bom_lines', kids.map(k => ({ parent: m.code, child: k.child, qty: k.qty, loss: k.loss || undefined })));
          const upsertItem = (code, o) => { const e = DB.rows('items').find(x => x.code === code); if (e) { if (e.src === 'ecount') { if (o.type) e.type = o.type; } else Object.assign(e, o); DB.touch('items'); } else DB.add('items', Object.assign({ code, src: 'local' }, o)); };
          upsertItem(m.code, { name: m.name || undefined, type: m.type, unit: m.unit });
          kids.forEach(k => { if (!DB.rows('items').find(x => x.code === k.child)) { const isMat = DB.rows('materials').some(x => x.code === k.child); DB.add('items', { code: k.child, name: nameOf(k.child) || undefined, type: isMat ? 'RAW' : 'PART', unit: isMat ? 'kg' : 'pcs', src: 'local' }); } });
          ERP.toast(L('저장했습니다', 'Đã lưu'), 'ok'); ERP.render(); } }]) });
  }
  ERP.bomEditor = editor;
  function structTab(host) {
    const wrap = h('div');
    function draw() {
      const lp = linesByParent(); const parents = Array.from(lp.keys()).sort(); const items = new Map(DB.rows('items').map(x => [x.code, x]));
      wrap.replaceChildren(
        h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onclick: () => editor(null) }, '+ ' + L('새 조합 만들기 (1번 + 2번 → 3번)', 'Tạo cấu thành mới (1 + 2 → 3)')), h('span', { class: 'sp' })),
        h('p', { class: 'help' }, L('품목을 등록하고, "상위 품목 = 하위 품목들의 조합"을 원하는 만큼 단계적으로 만들 수 있습니다 (예: 1번 부품 + 2번 부품 → 3번 반제품, 3번 + 4번 → 5번 완제품). 여기서 만든 구성은 MRP에서 품번으로 입력하면 자동 전개됩니다.', 'Đăng ký mặt hàng rồi tạo cấu thành nhiều cấp (VD: chi tiết 1 + chi tiết 2 → bán TP 3; 3 + 4 → thành phẩm 5). Nhập mã vào MRP sẽ tự triển khai.')),
        parents.length ? ERP.simpleTable([{ label: L('상위 품목', 'Mặt hàng cha'), render: p => h('b', p) }, { label: L('품명', 'Tên'), render: p => (items.get(p) || {}).name || nameOf(p) }, { label: L('유형', 'Loại'), render: p => TYPE((items.get(p) || {}).type) },
          { label: L('구성', 'Thành phần'), render: p => lp.get(p).map(k => k.child + ' × ' + F.n(k.qty, 3)).join('  +  ') }, { label: '', render: p => h('button', { class: 'btn sm', onclick: () => editor(p) }, L('편집', 'Sửa')) }], parents, { maxH: '40vh' }) : h('div', { class: 'empty' }, L('아직 만든 구성이 없습니다.', 'Chưa có cấu thành nào.')),
        h('h3', { style: { margin: '18px 0 8px' } }, L('품목 마스터', 'Danh mục mặt hàng')), ERP.grid({ table: 'items', pageSize: 25, maxH: '40vh' }).el);
    }
    host.appendChild(wrap); draw();
  }

  // ---------- 7차: 조립 BOM 자동 구성 (ECOUNT 품목코드) ----------
  function asmTab(host) {
    const INV = ERP.inv; const st = ERP.state.asm = ERP.state.asm || { kind: 'asm', line: '', stat: '', q: '', page: 0 };
    st.pick = st.pick || {};
    const plan = INV.asmPlan(); const IT = INV.items();
    const statusOf = (x) => (x.existing ? (x.auto ? 'auto' : 'manual') : (x.conf === 'high' ? 'high' : x.conf === 'part' ? 'part' : x.conf === 'review' ? 'review' : 'none'));
    const STL = { high: [L('바로 적용 가능', 'Áp dụng được ngay'), 'ok'], part: [L('일부 확인 필요', 'Cần xem một phần'), 'warn'], review: [L('확인 필요', 'Cần xem'), 'warn'], none: [L('부품 못 찾음', 'Không tìm thấy'), 'bad'], auto: [L('적용됨 (자동)', 'Đã áp dụng (tự động)'), 'info'], manual: [L('직접 만든 BOM', 'BOM tự tạo'), 'neutral'] };
    const scope = plan.filter(x => (st.kind === 'stp' ? x.stp : !x.stp));
    const cnt = {}; scope.forEach(x => { const k = statusOf(x); cnt[k] = (cnt[k] || 0) + 1; });
    const lines = Array.from(new Set(scope.map(x => x.line).filter(Boolean))).sort();
    const ORDER = { high: 0, part: 1, review: 2, auto: 3, manual: 4, none: 5 }; const LINE_ORDER = { MINI: 0, PEN: 1, REG: 2, CPC: 3, GLA: 4, MARKER: 5 };
    let rows = scope.slice().sort((a, b) => (ORDER[statusOf(a)] - ORDER[statusOf(b)]) || ((LINE_ORDER[a.line] === undefined ? 9 : LINE_ORDER[a.line]) - (LINE_ORDER[b.line] === undefined ? 9 : LINE_ORDER[b.line])) || String(a.parent).localeCompare(String(b.parent), undefined, { numeric: true }));
    if (st.line) rows = rows.filter(x => x.line === st.line);
    if (st.stat) rows = rows.filter(x => statusOf(x) === st.stat);
    if (st.q) { const k = INV.normName(st.q); rows = rows.filter(x => INV.normName(x.parent).includes(k) || INV.normName(x.name).includes(k) || x.parts.some(p => INV.normName(p.code).includes(k))); }
    const roles = st.kind === 'stp' ? INV.STP_ROLES : INV.ASM_ROLES;
    const usedRoles = roles.filter(R => rows.some(x => x.parts.some(p => p.role === R.role)));
    const ps = 80; const pages = Math.max(1, Math.ceil(rows.length / ps)); if (st.page >= pages) st.page = pages - 1; const slice = rows.slice(st.page * ps, st.page * ps + ps);
    const bulk = scope.filter(x => !x.existing && x.conf === 'high');   // 모든 부품이 확실한 품번만 (노랑이 섞인 품번은 행에서 골라 적용)
    const exLines = DB.memo('bom.lines', ['bom_lines'], () => { const m = new Map(); DB.rows('bom_lines').forEach(l => { let a = m.get(l.parent); if (!a) m.set(l.parent, a = []); a.push(l); }); return m; });
    const TONE = { high: '#0E7A5F', review: '#C77700', none: '#B3261E' };
    const cell = (x, p) => {
      if (!p) return h('td', h('span', { class: 'muted' }, '·'));
      const k = x.parent + '|' + p.role; const cur = st.pick[k] !== undefined ? st.pick[k] : p.code;
      const opts = Array.from(new Set([p.code].concat(p.cands || []).filter(Boolean)));
      if (x.existing) return h('td', h('span', { class: 'muted', title: p.code ? L('제안: ', 'Gợi ý: ') + p.code : '' }, p.code ? '(' + p.code + ')' : '·'));
      if (!opts.length) return h('td', h('span', { style: { color: TONE.none, fontWeight: 600 } }, L('없음', 'Không có')));
      const none = !p.code;
      const sel = h('select', { class: 'inp sm partsel', style: { borderColor: TONE[st.pick[k] !== undefined ? 'review' : p.conf] || '#C9CFD6', color: TONE[p.conf] }, title: opts.map(c => c + ' ' + ((IT.get(c) || {}).name || '')).join('\n'), onchange: (e) => { st.pick[k] = e.target.value; } },
        none ? h('option', { value: '', selected: cur === '' }, L('— 선택 —', '— chọn —')) : null,
        opts.map(c => h('option', { value: c, selected: c === cur }, c + ' · ' + String((IT.get(c) || {}).name || '').slice(0, 16))), none ? null : h('option', { value: '', selected: cur === '' }, L('— 빼기 —', '— bỏ —')));
      return h('td', sel, p.conf === 'review' ? h('div', { style: { fontSize: '11px', color: TONE.review } }, L('후보 ', 'ứng viên ') + opts.length) : (none ? h('div', { style: { fontSize: '11px', color: TONE.none } }, L('비슷한 코드 ', 'mã gần giống ') + opts.length) : null));
    };
    host.append(
      h('p', { class: 'help', style: { marginTop: 0 } }, L('ECOUNT 품목코드로 조립품(펜)마다 들어가는 부품을 찾아 BOM을 만듭니다. 같은 제품군 + 같은 색 이름 + 코드 숫자로 찾고, 제품군에 하나뿐인 부품(MINI HOLDER · MINI SPOON 등)은 공용으로 씁니다. 초록 = 확실, 노랑 = 확인 필요(후보 중 선택), 빨강 = 못 찾음. 적용하면 "품목 · 구성 (BOM 설정)"에 저장되고, 조립 일보를 올리면 조립 수량만큼 이 부품들이 생산현장 재고에서 차감됩니다. 직접 만든 BOM은 바꾸지 않습니다.',
        'Tìm linh kiện của từng bút lắp ráp theo mã ECOUNT (cùng dòng SP + cùng tên màu + số trong mã; linh kiện duy nhất của dòng như MINI HOLDER dùng chung). Xanh = chắc chắn, vàng = cần chọn, đỏ = không tìm thấy. Áp dụng → lưu vào "Cấu thành (BOM)"; báo cáo lắp ráp sẽ trừ linh kiện theo số lượng. BOM tự tạo không bị thay đổi.')),
      h('div', { class: 'toolbar' },
        h('div', { class: 'seg' }, [['asm', L('조립 BOM (펜 → 부품)', 'BOM lắp ráp (bút → linh kiện)')], ['stp', L('스탬핑 BOM (스탬핑 배럴 → 배럴)', 'BOM ép nhũ (barrel nhũ → barrel)')]].map(o => h('button', { class: 'btn sm' + (st.kind === o[0] ? ' primary' : ''), onclick: () => { st.kind = o[0]; st.page = 0; st.stat = ''; ERP.render(); } }, o[1]))),
        h('select', { class: 'inp', onchange: (e) => { st.line = e.target.value; st.page = 0; ERP.render(); } }, h('option', { value: '' }, L('제품군: 전체', 'Dòng SP: tất cả')), lines.map(v => h('option', { value: v, selected: st.line === v }, ERP.inv.label('line', v) + ' (' + v + ')'))),
        h('select', { class: 'inp', onchange: (e) => { st.stat = e.target.value; st.page = 0; ERP.render(); } }, h('option', { value: '' }, L('상태: 전체', 'Trạng thái: tất cả')), Object.keys(STL).map(k => h('option', { value: k, selected: st.stat === k }, STL[k][0] + ' (' + F.n(cnt[k] || 0) + ')'))),
        h('label', { class: 'search' }, h('input', { type: 'search', placeholder: L('품목코드 · 이름 · 부품코드', 'Mã · tên · mã linh kiện'), value: st.q, onchange: (e) => { st.q = e.target.value; st.page = 0; ERP.render(); } })),
        h('span', { class: 'sp' }),
        h('button', { class: 'btn primary', disabled: !bulk.length, onclick: async () => {
          if (!(await ERP.confirm(L('모든 부품이 초록(확실)인 조립품 ' + bulk.length + '개의 BOM을 만듭니다. 노랑 부품이 있는 품번은 행에서 골라 "적용"하세요. 계속할까요?', 'Tạo BOM cho ' + bulk.length + ' sản phẩm có toàn bộ linh kiện màu xanh. Tiếp tục?')))) return;
          const r = INV.applyAsm(bulk.map(x => x.parent), { onlyHigh: true }); ERP.toast(L('BOM ' + r.done + '개 적용 · 부품 ' + r.lines + '줄', 'Đã áp dụng ' + r.done + ' BOM · ' + r.lines + ' dòng'), 'ok'); ERP.render(); } }, L('확실한 부품만 모두 적용 (', 'Áp dụng tất cả phần chắc chắn (') + F.n(bulk.length) + ')')),
      h('div', { class: 'toolbar', style: { gap: '6px' } }, Object.keys(STL).filter(k => cnt[k]).map(k => ERP.chip(STL[k][1], STL[k][0] + ' ' + F.n(cnt[k])))),
      rows.length ? h('div', { class: 'tbl-wrap', style: { maxHeight: '60vh' } }, h('table', { class: 'tbl' },
        h('thead', h('tr', h('th', st.kind === 'stp' ? L('스탬핑 배럴', 'Barrel ép nhũ') : L('조립품', 'Sản phẩm lắp ráp')), h('th', L('이름', 'Tên')), h('th', L('제품군', 'Dòng')), usedRoles.map(R => h('th', L(R.ko, R.vi))), h('th', L('상태 · 현재 BOM', 'Trạng thái · BOM hiện tại')), h('th', ''))),
        h('tbody', slice.map(x => { const ex = exLines.get(x.parent) || []; const stt = statusOf(x);
          return h('tr', h('td', h('b', x.parent)), h('td', (x.name || '').slice(0, 26)), h('td', x.line || ''), usedRoles.map(R => cell(x, x.parts.find(p => p.role === R.role))),
            h('td', ERP.chip(STL[stt][1], STL[stt][0]), ex.length ? h('div', { style: { fontSize: '11.5px', marginTop: '3px' } }, ex.map(l => l.child).join(' + ')) : null),
            h('td', { class: 'nowrap' }, !x.existing || x.auto ? h('button', { class: 'btn sm primary', onclick: () => { const pick = {}; Object.keys(st.pick).forEach(k => { if (k.indexOf(x.parent + '|') === 0) pick[k] = st.pick[k]; });
              const open = x.parts.filter(p => p.conf === 'review' && pick[x.parent + '|' + p.role] === undefined); if (open.length) { ERP.toast(L('노랑 부품을 골라 주세요: ', 'Hãy chọn linh kiện màu vàng: ') + open.map(p => INV.roleName(p.role, x.stp)).join(', '), 'warn'); return; }
              const r = INV.applyAsm([x.parent], { pick, force: false, onlyHigh: true }); if (r.done) ERP.toast(L('BOM 적용: ', 'Đã áp dụng: ') + x.parent, 'ok'); else ERP.toast(L('넣을 부품이 없습니다', 'Không có linh kiện'), 'warn'); ERP.render(); } }, x.existing ? L('다시 적용', 'Áp dụng lại') : L('적용', 'Áp dụng')) : null,
              ' ', h('button', { class: 'btn sm', onclick: () => editor(x.parent) }, L('편집', 'Sửa')))); }))))
        : h('div', { class: 'empty' }, L('조건에 맞는 품목이 없습니다.', 'Không có mã phù hợp.')),
      rows.length > ps ? h('div', { class: 'pager' }, h('span', F.n(rows.length) + L('개', ' mã')), h('span', { style: { display: 'inline-flex', gap: '8px', alignItems: 'center' } }, h('button', { class: 'btn', disabled: st.page === 0, onclick: () => { st.page--; ERP.render(); } }, '‹'), (st.page + 1) + ' / ' + pages, h('button', { class: 'btn', disabled: st.page >= pages - 1, onclick: () => { st.page++; ERP.render(); } }, '›'))) : null,
      h('p', { class: 'help' }, L('수량은 펜 1자루당 부품 1개로 넣습니다. 다르면 "편집"에서 고치세요. 조립 일보의 품목코드(예: BM01002)가 이 조립품 코드와 같아야 차감됩니다.', 'Định mức mặc định 1 linh kiện / 1 bút; sửa ở "Sửa" nếu khác. Mã trong báo cáo lắp ráp (vd BM01002) phải trùng mã sản phẩm.')));
  }

  const recipeTab = (host) => {
    const sum = DB.memo('bom.recsum', ['recipes'], () => { const m = new Map(); DB.rows('recipes').forEach(r => m.set(r.code, (m.get(r.code) || 0) + C.num(r.coef))); return m; });
    host.appendChild(ERP.grid({ table: 'recipes', pageSize: 50, maxH: '66vh', extraCols: [{ label: () => L('색상 합계 g', 'Tổng g/màu'), render: r => F.n(sum.get(r.code), 3) }] }).el);
    host.appendChild(h('p', { class: 'help' }, L('배합량은 제품 1개당 원료 g 으로 해석합니다 (원료 소요 kg = 수량 × g ÷ 1000). 기준이 다르면 엑셀의 값을 환산해서 업로드하세요.', 'Định mức hiểu là g nguyên liệu cho 1 sản phẩm (kg cần = SL × g ÷ 1000). Nếu khác, hãy quy đổi trước khi tải lên.')));
  };

  ERP.pages.bom = { ko: '제품 · BOM · 배합', vi: 'Sản phẩm · BOM', render(root) {
    if (ERP.state.params && ERP.state.params.tab) { ERP.state.bomTab = ERP.state.params.tab; }
    const cur = ERP.state.bomTab = ERP.state.bomTab || 'mrp';
    root.appendChild(ERP.pageHead([L('제품 · BOM · 배합', 'Sản phẩm · BOM · Công thức'), ERP.sampleChip ? ERP.sampleChip('bom') : null], L('자재 소요량(MRP) · 품목 구성 · 색상별 BOM · 배합표 · 세미 재고', 'Nhu cầu vật tư (MRP) · cấu thành · BOM theo màu · công thức · tồn bán TP'),
      [h('button', { class: 'btn', onclick: () => ERP.goto('data') }, L('엑셀 업로드', 'Tải Excel'))]));
    const tabs = [['mrp', L('소요량 계산 (MRP)', 'Tính nhu cầu (MRP)')], ['struct', L('품목 · 구성 (BOM 설정)', 'Mặt hàng · Cấu thành')], ['asm', L('조립 BOM 자동 구성', 'Tự tạo BOM lắp ráp')], ['semi_stock', L('세미 재고', 'Tồn bán TP')], ['bom', L('색상별 BOM', 'BOM theo màu')], ['products', L('제품 색상', 'Màu sản phẩm')], ['item_bom', L('품목 구성(Retail)', 'Item BOM')], ['recipes', L('배합표', 'Công thức')], ['semi_items', L('반제품 목록', 'DM bán TP')], ['sub_materials', L('부자재', 'Vật liệu phụ')], ['refill_specs', L('리필 규격', 'Quy cách refill')]];
    const host = h('div', { class: 'card' });
    root.append(ERP.tabs(tabs.map(t => ({ id: t[0], label: t[1] })), cur, (id) => { ERP.state.bomTab = id; ERP.state.params = {}; ERP.render(); }), host);
    if (cur === 'mrp') mrpTab(host); else if (cur === 'struct') structTab(host); else if (cur === 'asm') asmTab(host); else if (cur === 'recipes') recipeTab(host);
    else if (cur === 'semi_stock') { host.append(h('p', { class: 'help' }, L('세미(반제품·리필·노즈·배럴 등) 현재 재고를 입력/엑셀 업로드하면 MRP가 이만큼 차감하여 부족분을 계산합니다. 기준일에 실사한 수량을 넣으세요.', 'Nhập/tải tồn bán thành phẩm (refill, nose, barrel…) — MRP sẽ trừ khi tính phần thiếu. Dùng số kiểm kê theo ngày.'))); simple('semi_stock')(host); }
    else simple(cur)(host);
  } };
})();
