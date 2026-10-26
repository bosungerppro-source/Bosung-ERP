/* Production (생산 관리): daily log, quick entry, analysis, machines, process settings */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, C = ERP.calc, F = ERP.fmt;
  const COL = (k) => ERP.TABLES.prod_log.cols.find(c => c.k === k);

  function codeMap() {
    return DB.memo('codeMap', ['products', 'semi_items', 'refill_specs', 'item_bom', 'bom'], () => {
      const m = new Map();
      DB.rows('products').forEach(p => m.set(p.code, p.color_name));
      DB.rows('semi_items').forEach(p => m.set(p.code, p.name));
      DB.rows('refill_specs').forEach(p => { m.set(p.erp_code, p.name); if (p.code) m.set(p.code, p.name); });
      DB.rows('item_bom').forEach(p => { if (!m.has(p.item)) m.set(p.item, [p.kind, p.colors ? p.colors + 'CL' : ''].join(' ').trim()); });
      return m;
    });
  }
  ERP.codeName = (c) => codeMap().get(c);

  // ------------ tab: log ------------
  function logTab(host) {
    const ref = C.latestProdDate();
    const st = ERP.state.plog = ERP.state.plog || { from: F.addDays(ref, -13), to: ref };
    const grid = ERP.grid({ table: 'prod_log', pageSize: 50, sortKey: 'date', sortDir: -1, maxH: '66vh',
      rows: () => DB.rows('prod_log').filter(r => r.date >= st.from && r.date <= st.to),
      defaults: () => ({ date: st.to, shift: 'D' }),
      filters: [
        { id: 'p', label: L('공정', 'Công đoạn'), key: 'process', options: () => ERP.PROC.map(p => ({ v: p.id, label: L(p.ko, p.vi) })) },
        // 1.13.8: 대소문자만 다른 품목군 (Dial · dial) 은 하나 — 고르면 둘 다
        { id: 'd', label: L('품목군', 'Nhóm'), key: 'division', options: () => C.prodDivs('').map(([v, label]) => ({ v, label })), test: (r, v) => C.divKey(r) === v },
        { id: 's', label: L('주/야', 'Ca'), key: 'shift', options: () => [{ v: 'D', label: L('주간', 'Ca ngày') }, { v: 'N', label: L('야간', 'Ca đêm') }] }],
      toolbar: (s, render) => [h('label', { class: 'muted' }, L('기간 ', 'Từ '), h('input', { class: 'inp', type: 'date', value: st.from, onchange: (e) => { st.from = e.target.value || st.from; render(); } }), ' ~ ', h('input', { class: 'inp', type: 'date', value: st.to, onchange: (e) => { st.to = e.target.value || st.to; render(); } }))],
      // 1.11.4: 포장 일보의 PO 번호 (수주 관리와 이어짐) — 누르면 수주 관리에서 그 PO
      cols: ['date', 'process', 'shift', 'machine_no', 'division', 'po_no', 'code', 'name', 'plan_qty', 'ok_qty', 'ng_qty', 'stop_min'].map(COL),
      extraCols: [{ label: () => L('수주', 'Đơn hàng'), render: r => (r.po_no ? h('a', { href: 'javascript:void 0', title: L('수주 관리에서 이 PO 보기', 'Xem PO này ở Quản lý đơn hàng'), onclick: (e) => { e.stopPropagation(); ERP.openPo(r.po_no); } }, L('수주 보기 →', 'Xem PO →')) : '') }] });
    host.appendChild(grid.el);
  }

  // ------------ tab: quick entry ------------
  function entryTab(host) {
    const es = ERP.state.entry = ERP.state.entry || { proc: (ERP.PROC[ERP.PROC.length - 1] || {}).id || 'PCK', date: F.today(), shift: 'D', rows: [{}] };
    if (!ERP.PROC.find(p => p.id === es.proc)) es.proc = (ERP.PROC[0] || {}).id;
    const cols = () => ERP.entryCols(es.proc).map(COL).filter(Boolean);
    const cm = codeMap();
    const mach = () => DB.rows('machines').filter(m => m.process === es.proc && m.active !== false).map(m => m.machine_no);
    const wrap = h('div');
    function calcMin(r) {
      if (r.start && r.end) { const [a, b] = [r.start, r.end].map(x => { const p = String(x).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }); let m = b - a; if (m < 0) m += 1440; r.work_min = Math.max(0, m - (+r.break_min || 0)); }
    }
    let _drawing = false;
    function draw() { if (_drawing) return; _drawing = true; try { drawInner(); } finally { _drawing = false; } }
    function drawInner() {
      const cs = cols();
      const dl = h('datalist', { id: 'dl_mach' }, Array.from(new Set(mach())).map(v => h('option', { value: v })));
      const dlc = h('datalist', { id: 'dl_code' }, Array.from(cm.entries()).slice(0, 4000).map(([k, v]) => h('option', { value: k }, v)));
      const head = h('div', { class: 'toolbar' },
        h('select', { class: 'inp', 'aria-label': 'process', onchange: (e) => { es.proc = e.target.value; es.rows = [{}]; draw(); } }, ERP.PROC.map(p => h('option', { value: p.id, selected: p.id === es.proc }, L(p.ko, p.vi)))),
        h('input', { class: 'inp', type: 'date', value: es.date, onchange: (e) => { es.date = e.target.value; } }),
        h('select', { class: 'inp', onchange: (e) => { es.shift = e.target.value; } }, [['D', L('주간 (D)', 'Ca ngày')], ['N', L('야간 (N)', 'Ca đêm')]].map(o => h('option', { value: o[0], selected: o[0] === es.shift }, o[1]))),
        h('span', { class: 'sp' }),
        h('button', { class: 'btn', title: L('같은 공정의 가장 최근 일보 행을 수량 없이 불러옵니다', 'Lấy các dòng của báo cáo gần nhất (không có số lượng)'), onclick: copyLast }, L('최근 일보 불러오기', 'Lấy báo cáo gần nhất')),
        h('button', { class: 'btn', onclick: pasteBox }, L('엑셀에서 붙여넣기', 'Dán từ Excel')),
        h('button', { class: 'btn', onclick: () => ERP.xl.dailyTemplate() }, L('엑셀 양식', 'Mẫu Excel')),
        h('button', { class: 'btn', onclick: () => { es.rows.push(Object.assign({}, es.rows[es.rows.length - 1] || {}, { ok_qty: undefined, ng_qty: undefined, ok_ea: undefined })); draw(); } }, '+ ' + L('행 추가(이전 행 복사)', 'Thêm dòng (sao chép)')),
        h('button', { class: 'btn primary', onclick: save }, L('저장', 'Lưu')));
      const tbl = h('table', { class: 'tbl entry' }, h('thead', h('tr', h('th', '#'), cs.map(c => h('th', { class: c.t === 'n' ? 'num' : '' }, ERP.colLabel(c))), h('th', L('근무(분)', 'Phút LV')), h('th', ''))),
        h('tbody', es.rows.map((r, i) => h('tr', h('td', i + 1), cs.map(c => {
          const attrs = { 'data-r': i, 'data-c': c.k, onkeydown: (e) => { if (e.key !== 'Enter') return; e.preventDefault(); const nx = wrap.querySelector('input[data-r="' + (i + 1) + '"][data-c="' + c.k + '"]'); if (nx) nx.focus(); else { es.rows.push({}); draw(); const n2 = wrap.querySelector('input[data-r="' + (i + 1) + '"][data-c="' + c.k + '"]'); if (n2) n2.focus(); } }, value: r[c.k] === undefined || r[c.k] === null ? '' : r[c.k], type: c.t === 'n' ? 'number' : c.t === 'tm' ? 'time' : 'text', step: c.t === 'n' ? 'any' : null,
            list: c.k === 'machine_no' ? 'dl_mach' : c.k === 'code' ? 'dl_code' : null,
            onchange: (e) => {
              let v = e.target.value; if (c.t === 'n') v = v === '' ? undefined : Number(v); r[c.k] = v === '' ? undefined : v;
              if (c.k === 'code' && !r.name && cm.get(v)) { r.name = cm.get(v); }
              if (['start', 'end', 'break_min', 'code'].includes(c.k)) { calcMin(r); draw(); }
            } };
          return h('td', h('input', attrs));
        }), h('td', { class: 'num' }, r.work_min !== undefined ? F.n(r.work_min) : ''), h('td', h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'remove', onclick: () => { es.rows.splice(i, 1); if (!es.rows.length) es.rows.push({}); draw(); } }, '×'))))));
      wrap.replaceChildren(dl, dlc, head, h('div', { class: 'entry-wrap' }, tbl),
        h('p', { class: 'help' }, L('시작·종료 시각과 휴게시간을 입력하면 근무(분)이 자동 계산됩니다. 코드를 입력하면 품명이 자동으로 채워집니다. 포장 공정은 "양품수량"에 세트 수, "환산 pcs"에 낱개 수를 넣으세요.', 'Nhập giờ bắt đầu/kết thúc và giờ nghỉ để tự tính phút làm việc. Nhập mã để tự điền tên. Đóng gói: nhập số bộ vào "SL đạt", số cái vào "Quy đổi pcs".')));
    }
    function copyLast() {
      const last = DB.rows('prod_log').filter(r => r.process === es.proc && r.date < es.date).reduce((a, r) => (r.date > a ? r.date : a), '');
      if (!last) { ERP.toast(L('이전 일보가 없습니다', 'Chưa có báo cáo trước'), 'warn'); return; }
      const keys = ERP.entryCols(es.proc).filter(k => !['ok_qty', 'ng_qty', 'ok_ea', 'plan_qty', 'stop_min', 'stop_reason', 'remark', 'weight_kg', 'raw_kg', 'shots', 'work_min'].includes(k));
      const rows = DB.rows('prod_log').filter(r => r.process === es.proc && r.date === last).map(r => { const o = {}; keys.forEach(k => { if (r[k] !== undefined) o[k] = r[k]; }); return o; });
      es.rows = rows.length ? rows : [{}]; draw(); ERP.toast(F.d(last) + L(' 일보에서 ' + rows.length + '행을 불러왔습니다. 수량만 입력하세요.', ': đã lấy ' + rows.length + ' dòng. Chỉ cần nhập số lượng.'), 'ok');
    }
    function pasteBox() {
      const ta = h('textarea', { class: 'inp', style: { width: '100%', height: '220px', fontFamily: 'monospace' }, placeholder: L('엑셀에서 복사한 셀을 붙여넣으세요 (열 순서 = 아래 입력 항목 순서)', 'Dán các ô từ Excel (thứ tự cột = thứ tự các cột nhập bên dưới)') });
      const cs = cols();
      ERP.modal({ title: L('엑셀에서 붙여넣기', 'Dán từ Excel'), width: '760px', body: h('div', h('p', { class: 'help' }, L('열 순서: ', 'Thứ tự cột: ') + cs.map(c => ERP.colLabel(c)).join(' → ')), ta),
        buttons: [{ label: L('취소', 'Hủy') }, { label: L('입력표에 넣기', 'Đưa vào bảng'), kind: 'primary', onClick: () => {
          const rows = ta.value.split(/\r?\n/).filter(x => x.trim()).map(line => { const cells = line.split('\t'); const o = {}; cs.forEach((c, j) => { let v = (cells[j] || '').trim(); if (v === '') return; if (c.t === 'n') { v = F.parseNum(v); if (v === null) return; } o[c.k] = v; }); calcMin(o); return o; });
          if (rows.length) { es.rows = (es.rows.length === 1 && !Object.keys(es.rows[0]).length) ? rows : es.rows.concat(rows); draw(); }
        } }] });
    }
    function warnings() {
      const w = []; es.rows.forEach((r, i) => { const ok = +r.ok_qty || 0, ng = +r.ng_qty || 0; if (ng && ok && ng > ok) w.push((i + 1) + L('행: 불량이 양품보다 많습니다', ': NG lớn hơn SL đạt')); if ((ok || ng) && !r.code && !r.name) w.push((i + 1) + L('행: 코드/품명이 없습니다', ': thiếu mã/tên')); if (r.start && r.end && r.work_min === 0) w.push((i + 1) + L('행: 근무시간이 0분입니다', ': thời gian làm việc 0 phút')); });
      return w;
    }
    function save() {
      const wn = warnings(); if (wn.length) ERP.toast(wn.slice(0, 3).join(' · '), 'warn');
      const out = [];
      es.rows.forEach(r => {
        if (!(r.ok_qty || r.ng_qty || r.code || r.name)) return;
        const o = Object.assign({}, r, { date: es.date, process: es.proc, shift: es.shift, source: 'manual' });
        o.ok_qty = o.ok_qty || 0; o.ng_qty = o.ng_qty || 0; if (o.ok_ea === undefined) o.ok_ea = o.ok_qty;
        calcMin(o); if (es.proc === 'PCK') o.unit = 'set';
        const m = DB.rows('machines').find(x => x.process === es.proc && String(x.machine_no) === String(o.machine_no)); if (m && !o.division && m.division) o.division = m.division;
        Object.keys(o).forEach(k => { if (o[k] === undefined || o[k] === '') delete o[k]; });
        out.push(o);
      });
      if (!out.length) { ERP.toast(L('입력된 행이 없습니다', 'Chưa có dòng nào'), 'warn'); return; }
      DB.addMany('prod_log', out); ERP.toast(L(out.length + '건 저장했습니다', 'Đã lưu ' + out.length + ' dòng'), 'ok'); es.rows = [{}]; draw();
    }
    host.appendChild(wrap); draw();
  }

  /** 1.13.8: 품목군 여러 개 고르기 (전체 + 그 공정 일보에 있는 품목군, 비면 전체) — 현장 재고 표 설정 · 종합 현황 위젯 ⚙ 과 같은 체크 */
  function divChecks(proc, cur, set) {
    const list = C.prodDivs(proc, cur);
    const chk = (on, label, fn, attrs) => h('label', Object.assign({ class: 'fpiv-chk' + (on ? ' on' : '') }, attrs), h('input', { type: 'checkbox', checked: on, onchange: (e) => fn(e.target.checked) }), ' ', label);
    return h('div', { class: 'fpiv-row pdivs', style: { margin: '0 0 12px' } }, h('b', L('품목군', 'Nhóm')), chk(!cur.length, L('전체', 'Tất cả'), (on) => set(on ? [] : list.slice(0, 1).map(o => o[0])), { 'data-all': '1' }),
      list.map(o => chk(cur.includes(o[0]), o[1], (on) => set(on ? cur.concat([o[0]]) : cur.filter(x => x !== o[0])), { 'data-v': o[0] })));
  }

  // ------------ tab: analysis (daily quantity table per month) ------------
  function analysisTab(host) {
    const ref = C.latestProdDate();
    const st = ERP.state.pan = ERP.state.pan || {};
    // 7차: 기본은 "조립만 · 품목군별" (공장 엑셀 Assembly Sum 과 같은 보기). 다른 공정은 위에서 고른다.
    if (!st.month) st.month = ref.slice(0, 7); if (!st.by) st.by = 'division'; if (st.proc === undefined) st.proc = 'ASM';    const addM = (ym, k) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + k, 1)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
    const divBox = h('div');
    const bar = h('div', { class: 'toolbar' }); 
    function drawBar() {
      bar.replaceChildren(
        h('button', { class: 'btn', onclick: () => { st.month = addM(st.month, -1); draw(); } }, '‹'),
        h('input', { class: 'inp', type: 'month', value: st.month, onchange: (e) => { if (e.target.value) { st.month = e.target.value; draw(); } } }),
        h('button', { class: 'btn', onclick: () => { st.month = addM(st.month, 1); draw(); } }, '›'),
        h('select', { class: 'inp', onchange: (e) => { st.by = e.target.value; draw(); } }, [['process', L('행: 공정별', 'Hàng: theo công đoạn')], ['division', L('행: 품목군별', 'Hàng: theo nhóm hàng')]].map(o => h('option', { value: o[0], selected: st.by === o[0] }, o[1]))),
        h('select', { class: 'inp', onchange: (e) => { st.proc = e.target.value; draw(); } }, h('option', { value: '' }, L('공정: 전체', 'Công đoạn: tất cả')), ERP.PROC.map(p => h('option', { value: p.id, selected: st.proc === p.id }, L(p.ko, p.vi)))));
      divBox.replaceChildren(divChecks(st.proc, C.prodDivsShown(st.proc), (a) => { C.setProdDivsShown(st.proc, a); draw(); }));
    }
    let _drawing = false;
    function draw() { if (_drawing) return; _drawing = true; try { drawInner(); } finally { _drawing = false; } }
    function drawInner() {
      drawBar();
      const from = st.month + '-01'; const nextM = addM(st.month, 1) + '-01'; const to = F.addDays(nextM, -1);
      const sel = C.prodDivsShown(st.proc); const rows = C.rowsBetween(from, to, st.proc).filter(r => !sel.length || sel.includes(C.divKey(r)));
      const lastIn = rows.reduce((a, r) => (r.date > a ? r.date : a), '');
      // 품목군: 대소문자·공백 차이는 한 묶음 (종합 현황 '일별 조립 생산량'과 같은 규칙)
      const canon = new Map(); const dk = (r) => { const raw = String(r.division || '').trim(); const k = raw.toLowerCase() || '–'; if (!canon.has(k)) canon.set(k, raw || L('(품목군 없음)', '(không nhóm)')); return k; };
      // 1.13.7: 가로 = 날짜, 세로 = 품목군 (또는 공정) — 종합 현황 '일별 조립 생산량' 위젯과 같은 표 (사용자: "가로에 날짜 세로에 품목군")
      const keys = st.by === 'process' ? (st.proc ? ERP.PROC.filter(p => p.id === st.proc) : ERP.PROC).map(p => ({ k: p.id, label: L(p.ko, p.vi) })) : Array.from(new Set(rows.map(dk))).sort().map(d => ({ k: d, label: canon.get(d) }));
      const keyOf = (r) => st.by === 'process' ? r.process : dk(r);
      const cell = {}; const dayTot = {}; const keyTot = {}; let grand = 0;
      rows.forEach(r => { const q = C.qty(r); const k = keyOf(r); (cell[r.date] = cell[r.date] || {})[k] = (cell[r.date][k] || 0) + q; dayTot[r.date] = (dayTot[r.date] || 0) + q; keyTot[k] = (keyTot[k] || 0) + q; grand += q; });
      const days = []; if (lastIn) { let d = from; while (d <= lastIn) { days.push(d); d = F.addDays(d, 1); } }
      const active = Object.keys(dayTot).length; const a = C.agg(rows);
      const keyHead = st.by === 'process' ? L('공정', 'Công đoạn') : L('품목군', 'Nhóm');
      // 일보가 없는 날: 회색 (주말은 옅은 바탕) — 1.13.6 까지 날짜 줄의 모양 그대로
      const off = (d) => (dayTot[d] === undefined ? { color: '#9AA3AF', background: /일|토|CN|T7|Sun|Sat/.test(F.dow(d)) ? '#FAFAFB' : null } : null);
      const tbl = h('div', { class: 'tbl-wrap', style: { maxHeight: '62vh' } }, h('table', { class: 'tbl dt' },
        h('thead', h('tr', h('th', keyHead), h('th', { class: 'num' }, L('월 합계', 'Tổng tháng')), days.map(d => h('th', { class: 'num', style: off(d) }, String(+d.slice(8, 10)), h('small', F.dow(d)))))),
        h('tbody', keys.map(c => h('tr', h('td', h('b', c.label)), h('td', { class: 'num' }, h('b', F.n(keyTot[c.k] || 0))), days.map(d => h('td', { class: 'num', style: off(d) }, cell[d] && cell[d][c.k] ? F.n(cell[d][c.k]) : '–')))),
          h('tr', { class: 'tot' }, h('td', L('일 합계', 'Tổng ngày')), h('td', { class: 'num' }, F.n(grand)), days.map(d => h('td', { class: 'num' }, dayTot[d] !== undefined ? F.n(dayTot[d]) : '–'))))));
      // machine ranking
      // 설비 = 공정 + 종류 + 번호 (Mini 1번과 Regular 1번은 다른 설비)
      const mm = {}; rows.forEach(r => { const k = C.machKey(r); const o = mm[k] || (mm[k] = { proc: r.process, no: k.slice(k.indexOf(':') + 1).replace('#', ' ').trim() || '-', ea: 0, days: new Set() }); o.ea += C.qty(r); o.days.add(r.date); });
      const mlist = Object.values(mm).sort((x, y) => y.ea - x.ea);
      const dp = {}; rows.forEach(r => { const d = dk(r); (dp[d] = dp[d] || {})[r.process] = (dp[d][r.process] || 0) + C.qty(r); }); const dpRows = Object.keys(dp).sort();
      const raw = {}; rows.forEach(r => { if (r.raw_material && r.raw_kg) raw[r.raw_material] = (raw[r.raw_material] || 0) + C.num(r.raw_kg); });
      body.replaceChildren(
        h('section', { class: 'kpis' },
          ERP.kpi(st.proc ? L('월 ' + ERP.procName(st.proc) + ' 생산량', 'Sản lượng tháng · ' + ERP.procName(st.proc)) : L('월 총 생산량 (pcs 환산)', 'Tổng sản lượng tháng (pcs)'), F.n(grand), 'pcs', 'neutral', st.month, st.proc ? L('양품 기준', 'theo SL đạt') : L('포장은 pcs 환산 기준', 'Đóng gói tính theo pcs quy đổi')),
          ERP.kpi(L('입력된 일수', 'Số ngày có dữ liệu'), F.n(active), L('일', 'ngày'), 'info', lastIn ? F.d(from) + ' ~ ' + F.d(lastIn) : '–', null),
          ERP.kpi(L('일 평균', 'Trung bình/ngày'), F.n(active ? grand / active : 0), 'pcs', 'neutral', null, L('입력된 일 기준', 'theo ngày có dữ liệu')),
          ERP.kpi(L('가동 설비 수', 'Số máy có chạy'), F.n(a.machines.size), L('대', 'máy'), 'neutral', null, null)),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', (st.proc ? L('일별 ' + ERP.procName(st.proc) + ' 생산수량 · ', 'Sản lượng ' + ERP.procName(st.proc) + ' theo ngày · ') : L('일별 생산수량 · ', 'Sản lượng theo ngày · ')) + st.month), h('button', { class: 'btn sm', onclick: () => { const ds = days.filter(d => dayTot[d] !== undefined); ERP.xl.exportAoa('daily_' + st.month, [keyHead, L('월 합계', 'Tổng tháng')].concat(ds), keys.map(c => [c.label, keyTot[c.k] || 0].concat(ds.map(d => (cell[d] && cell[d][c.k]) || 0))).concat([[L('일 합계', 'Tổng ngày'), grand].concat(ds.map(d => dayTot[d]))])); } }, L('엑셀', 'Excel'))), days.length ? tbl : h('div', { class: 'empty' }, L('이 달에 입력된 일보가 없습니다.', 'Tháng này chưa có báo cáo.'))),
        h('div', { class: 'grid2' },
          h('section', { class: 'card' }, h('h2', L('설비별 실적', 'Hiệu suất theo máy')),
            ERP.simpleTable([{ label: L('공정', 'Công đoạn'), render: m => ERP.chip('neutral', ERP.procName(m.proc)) }, { label: L('설비', 'Máy'), render: m => m.no === undefined ? '–' : m.no }, { label: L('가동일', 'Số ngày'), num: 1, render: m => m.days.size }, { label: 'pcs', num: 1, render: m => F.n(m.ea) }], mlist.slice(0, 40), { maxH: '360px' })),
          h('section', { class: 'card' }, h('h2', L('품목군 × 공정 생산량 (pcs)', 'Nhóm × công đoạn (pcs)')),
            ERP.simpleTable([{ label: L('품목군', 'Nhóm'), render: d => canon.get(d) || d }].concat(ERP.PROC.map(p => ({ label: L(p.ko, p.vi), num: 1, render: d => F.n(dp[d][p.id]) }))), dpRows, { maxH: '300px' }),
            Object.keys(raw).length ? h('div', h('h3', { style: { marginTop: '14px' } }, L('원료 사용량 (kg)', 'NL sử dụng (kg)')), h('div', { class: 'list' }, Object.entries(raw).sort((x, y) => y[1] - x[1]).map(([k, v]) => h('div', h('span', k), h('b', F.n(v, 1)))))) : null)));
    }
    host.append(bar, divBox, body); draw();
  }

  // ------------ tab: monthly (1.10.1 — 월별 조립 생산량: 일별 탭과 같은 고르기 · 1.13.7 부터 열 = 1~12월, 행 = 품목군) ------------
  function monthlyTab(host) {
    const ref = C.latestProdDate();
    const st = ERP.state.pmon = ERP.state.pmon || {};
    if (!st.year) st.year = +ref.slice(0, 4); if (!st.by) st.by = 'division'; if (st.proc === undefined) st.proc = 'ASM';    const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
    const divBox = h('div');
    const bar = h('div', { class: 'toolbar' });
    const mLabel = (i) => L((i + 1) + '월', 'T' + (i + 1));
    function drawBar() {
      bar.replaceChildren(
        h('button', { class: 'btn', onclick: () => { st.year--; draw(); } }, '‹'),
        h('input', { class: 'inp', type: 'number', min: '2000', max: '2100', value: st.year, style: { width: '96px' }, onchange: (e) => { const y = Math.floor(Number(e.target.value)); if (y >= 2000 && y <= 2100) { st.year = y; draw(); } } }),
        h('button', { class: 'btn', onclick: () => { st.year++; draw(); } }, '›'),
        h('select', { class: 'inp', onchange: (e) => { st.by = e.target.value; draw(); } }, [['process', L('행: 공정별', 'Hàng: theo công đoạn')], ['division', L('행: 품목군별', 'Hàng: theo nhóm hàng')]].map(o => h('option', { value: o[0], selected: st.by === o[0] }, o[1]))),
        h('select', { class: 'inp', onchange: (e) => { st.proc = e.target.value; ERP.render(); } }, h('option', { value: '' }, L('공정: 전체', 'Công đoạn: tất cả')), ERP.PROC.map(p => h('option', { value: p.id, selected: st.proc === p.id }, L(p.ko, p.vi)))));
      divBox.replaceChildren(divChecks(st.proc, C.prodDivsShown(st.proc), (a) => { C.setProdDivsShown(st.proc, a); draw(); }));
    }
    let _drawing = false;
    function draw() { if (_drawing) return; _drawing = true; try { drawInner(); } finally { _drawing = false; } }
    function drawInner() {
      drawBar(); ERP.destroyCharts && ERP.destroyCharts();
      const sel = C.prodDivsShown(st.proc); const rows = C.rowsBetween(st.year + '-01-01', st.year + '-12-31', st.proc).filter(r => !sel.length || sel.includes(C.divKey(r)));
      // 품목군: 대소문자 · 공백 차이는 한 묶음 (일별 탭 · 종합 현황과 같은 규칙), 수량 = 양품 pcs (일별 탭과 같음)
      const canon = new Map(); const dk = (r) => { const raw = String(r.division || '').trim(); const k = raw.toLowerCase() || '–'; if (!canon.has(k)) canon.set(k, raw || L('(품목군 없음)', '(không nhóm)')); return k; };
      const keys = st.by === 'process' ? (st.proc ? ERP.PROC.filter(p => p.id === st.proc) : ERP.PROC).map(p => ({ k: p.id, label: L(p.ko, p.vi) })) : Array.from(new Set(rows.map(dk))).sort().map(d => ({ k: d, label: canon.get(d) }));
      const keyOf = (r) => (st.by === 'process' ? r.process : dk(r));
      const cell = new Array(12).fill(0).map(() => ({})), mTot = new Array(12).fill(0), keyTot = {}, days = new Array(12).fill(0).map(() => new Set()); let grand = 0;
      rows.forEach(r => { const mi = +String(r.date).slice(5, 7) - 1; if (!(mi >= 0 && mi < 12)) return; const q = C.qty(r); const k = keyOf(r); cell[mi][k] = (cell[mi][k] || 0) + q; mTot[mi] += q; keyTot[k] = (keyTot[k] || 0) + q; grand += q; days[mi].add(r.date); });
      const act = mTot.filter(v => v > 0).length; let best = -1; mTot.forEach((v, i) => { if (v > 0 && (best < 0 || v > mTot[best])) best = i; });
      const pn = st.proc ? ERP.procName(st.proc) : '';
      // 1.13.7: 가로 = 1~12월, 세로 = 품목군 (또는 공정) — 종합 현황 '월별 조립 생산량' 위젯과 같은 표. 일보가 없는 달은 회색 (1.13.6 까지의 줄 모양 그대로)
      const keyHead = st.by === 'process' ? L('공정', 'Công đoạn') : L('품목군', 'Nhóm');   // '\' 는 한글 글꼴에서 ₩ 로 보여 쓰지 않음
      const off = (i) => (mTot[i] ? null : { color: '#9AA3AF' });
      const tbl = h('div', { class: 'tbl-wrap', style: { maxHeight: '62vh' } }, h('table', { class: 'tbl dt' },
        h('thead', h('tr', h('th', keyHead), h('th', { class: 'num' }, st.year + L(' 합계', ' tổng')), mTot.map((v, i) => h('th', { class: 'num', style: off(i) }, mLabel(i), days[i].size ? h('small', days[i].size + L('일', ' ngày')) : null)))),
        h('tbody', keys.map(c => h('tr', h('td', h('b', c.label)), h('td', { class: 'num' }, h('b', F.n(keyTot[c.k] || 0))), cell.map((o, i) => h('td', { class: 'num', style: off(i) }, o[c.k] ? F.n(o[c.k]) : '–')))),
          h('tr', { class: 'tot' }, h('td', L('월 합계', 'Tổng tháng')), h('td', { class: 'num' }, F.n(grand)), mTot.map(v => h('td', { class: 'num' }, v ? F.n(v) : '–'))))));
      const chart = grand ? ERP.chart({ type: 'bar', data: { labels: mTot.map((x, i) => mLabel(i)), datasets: keys.map((c, i) => ({ label: c.label, data: cell.map(o => o[c.k] || 0), backgroundColor: ERP.palette[i % ERP.palette.length], stack: 's' })) }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } }, true) : null;
      body.replaceChildren();
      ERP.put(body,
        h('section', { class: 'kpis' },
          ERP.kpi(pn ? L(st.year + '년 ' + pn + ' 생산량', 'Sản lượng ' + pn + ' năm ' + st.year) : L(st.year + '년 총 생산량 (pcs 환산)', 'Tổng sản lượng năm ' + st.year + ' (pcs)'), F.n(grand), 'pcs', 'neutral', null, L('양품 기준', 'theo SL đạt')),
          ERP.kpi(L('입력된 달', 'Số tháng có dữ liệu'), F.n(act), L('개월', 'tháng'), 'info', null, null),
          ERP.kpi(L('월 평균', 'Trung bình/tháng'), F.n(act ? grand / act : 0), 'pcs', 'neutral', null, L('입력된 달 기준', 'theo tháng có dữ liệu')),
          ERP.kpi(L('가장 많은 달', 'Tháng cao nhất'), best >= 0 ? mLabel(best) : '–', '', 'neutral', best >= 0 ? F.n(mTot[best]) + ' pcs' : null, null)),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', (pn ? L('월별 ' + pn + ' 생산량 · ', 'Sản lượng ' + pn + ' theo tháng · ') : L('월별 생산량 · ', 'Sản lượng theo tháng · ')) + st.year),
          h('button', { class: 'btn sm', onclick: () => ERP.xl.exportAoa('monthly_' + (st.proc || 'all') + '_' + st.year, [keyHead, st.year + L(' 합계', ' tổng')].concat(mTot.map((v, i) => mLabel(i))), keys.map(c => [c.label, keyTot[c.k] || 0].concat(cell.map(o => o[c.k] || 0))).concat([[L('월 합계', 'Tổng tháng'), grand].concat(mTot)])) }, L('엑셀', 'Excel'))), tbl,
          h('p', { class: 'help', style: { margin: '8px 0 0' } }, L('생산일보 양품 기준 (pcs). 그 달의 날짜별 수량은 일별 생산량 탭에서 봅니다.', 'Theo SL đạt của báo cáo (pcs). Xem từng ngày ở tab sản lượng theo ngày.'))),
        chart ? h('section', { class: 'card' }, h('h2', L('달별 막대', 'Biểu đồ theo tháng')), chart) : null);
    }
    host.append(bar, divBox, body); draw();
  }

  // ------------ tab: process settings (customizable processes) ------------
  function procTab(host) {
    const COLS = ERP.TABLES.prod_log.cols.filter(c => !['date', 'process', 'shift', 'source', 'po_qty'].includes(c.k) || c.k === 'po_qty');
    const mach = (id) => DB.rows('machines').filter(m => m.process === id && m.active !== false).length;
    const wrap = h('div');
    function entryDialog(p) {
      const cur = new Set(ERP.entryCols(p.id));
      const boxes = COLS.map(c => h('label', { class: 'nowrap', style: { display: 'block', padding: '3px 0' } }, h('input', { type: 'checkbox', 'data-k': c.k, checked: cur.has(c.k) }), ' ', ERP.colLabel(c)));
      ERP.modal({ title: L('일보 입력 항목 · ', 'Cột nhập báo cáo · ') + L(p.ko, p.vi), width: '640px', body: h('div', h('p', { class: 'help' }, L('이 공정의 "일보 입력" 화면에 나타날 열을 선택하세요. (순서는 아래 목록 순서)', 'Chọn các cột hiển thị ở màn hình nhập báo cáo của công đoạn này.')), h('div', { style: { columns: 2, columnGap: '20px' } }, boxes)),
        buttons: [{ label: L('취소', 'Hủy') }, { label: L('기본값으로', 'Mặc định'), onClick: () => { delete p.entry; ERP.saveProcs(); draw(); } }, { label: L('저장', 'Lưu'), kind: 'primary', onClick: () => { p.entry = COLS.filter((c, i) => boxes[i].querySelector('input').checked).map(c => c.k); ERP.saveProcs(); draw(); } }] });
    }
    function draw() {
      const inp = (p, k, o) => h('input', Object.assign({ class: 'inp', value: p[k] === undefined ? '' : p[k], onchange: (e) => { p[k] = e.target.value; ERP.saveProcs(); } }, o || {}));
      const rows = ERP.PROC.map((p, i) => h('tr',
        h('td', h('b', p.id)), h('td', inp(p, 'ko', { style: { width: '150px' } })), h('td', inp(p, 'vi', { style: { width: '170px' } })),
        h('td', h('input', { type: 'color', value: p.color || '#8A93A0', onchange: (e) => { p.color = e.target.value; ERP.saveProcs(); } })),
        h('td', h('select', { class: 'inp', onchange: (e) => { p.unit = e.target.value; ERP.saveProcs(); } }, ['pcs', 'set'].map(u => h('option', { value: u, selected: (p.unit || 'pcs') === u }, u)))),
        h('td', h('input', { type: 'checkbox', checked: p.dash !== false, onchange: (e) => { p.dash = e.target.checked; ERP.saveProcs(); } })),
        h('td', h('button', { class: 'btn sm', onclick: () => entryDialog(p) }, F.n(ERP.entryCols(p.id).length) + L('개 항목 선택', ' cột'))),
        h('td', { class: 'num' }, mach(p.id)),
        h('td', { style: { whiteSpace: 'nowrap' } },
          h('button', { class: 'icon-btn', disabled: i === 0, title: 'up', onclick: () => { ERP.PROC.splice(i - 1, 0, ERP.PROC.splice(i, 1)[0]); ERP.saveProcs(); draw(); } }, '↑'),
          h('button', { class: 'icon-btn', disabled: i === ERP.PROC.length - 1, title: 'down', onclick: () => { ERP.PROC.splice(i + 1, 0, ERP.PROC.splice(i, 1)[0]); ERP.saveProcs(); draw(); } }, '↓'),
          h('button', { class: 'icon-btn', title: 'delete', onclick: async () => { const n = DB.rows('prod_log').filter(r => r.process === p.id).length; if (await ERP.confirm(L('"' + p.ko + '" 공정을 목록에서 삭제할까요? 기존 일보 ' + n + '건은 유지됩니다(공정명만 코드로 표시).', 'Xóa công đoạn "' + p.vi + '"? ' + n + ' dòng báo cáo cũ vẫn giữ.'))) { ERP.PROC.splice(i, 1); ERP.saveProcs(); draw(); } } }, '×'))));
      const nid = h('input', { class: 'inp', placeholder: L('코드 (영문 3자, 예: CUT)', 'Mã (3 chữ, VD CUT)'), style: { width: '170px' }, maxlength: 8 });
      const nko = h('input', { class: 'inp', placeholder: L('공정명 (한국어)', 'Tên (Hàn)') }); const nvi = h('input', { class: 'inp', placeholder: L('공정명 (베트남어)', 'Tên (Việt)') });
      wrap.replaceChildren(
        h('p', { class: 'help' }, L('공정을 추가·이름변경·순서변경·삭제할 수 있습니다. "대시보드 표시"를 끄면 종합 현황의 공정별 실적 카드에서 빠집니다. 입력 항목은 공정마다 다르게 정할 수 있습니다.', 'Có thể thêm / đổi tên / sắp xếp / xóa công đoạn. Bỏ "Hiện ở tổng quan" để ẩn khỏi thẻ công đoạn. Mỗi công đoạn có thể chọn cột nhập riêng.')),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', h('tr', [L('코드', 'Mã'), L('한국어', 'Tiếng Hàn'), L('베트남어', 'Tiếng Việt'), L('색', 'Màu'), L('수량 단위', 'Đơn vị'), L('대시보드 표시', 'Hiện ở tổng quan'), L('일보 입력 항목', 'Cột nhập'), L('설비(대)', 'Máy'), ''].map(x => h('th', x)))), h('tbody', rows))),
        h('div', { class: 'toolbar', style: { marginTop: '14px' } }, nid, nko, nvi, h('button', { class: 'btn primary', onclick: () => {
          const id = nid.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''); if (!id || !nko.value.trim()) { ERP.toast(L('코드와 한국어 공정명은 필수입니다', 'Cần nhập mã và tên'), 'warn'); return; }
          if (ERP.PROC.find(p => p.id === id)) { ERP.toast(L('이미 있는 코드입니다', 'Mã đã tồn tại'), 'warn'); return; }
          ERP.PROC.push({ id, ko: nko.value.trim(), vi: nvi.value.trim() || nko.value.trim(), en: id, color: ERP.palette[ERP.PROC.length % ERP.palette.length], unit: 'pcs', dash: true }); ERP.saveProcs(); draw(); ERP.toast(L('공정을 추가했습니다', 'Đã thêm công đoạn'), 'ok');
        } }, '+ ' + L('공정 추가', 'Thêm công đoạn')),
          h('button', { class: 'btn', onclick: async () => { if (await ERP.confirm(L('공정 설정을 기본값(6개 공정)으로 되돌릴까요?', 'Khôi phục công đoạn mặc định?'))) { DB.setSetting('procs', null); location.reload(); } } }, L('기본값으로 되돌리기', 'Khôi phục mặc định'))));
    }
    host.appendChild(wrap); draw();
  }

  // ------------ tab: machines ------------
  function machinesTab(host) {
    const ref = C.latestProdDate(); const from = F.addDays(ref, -29);
    // 설비 마스터에 설비명 · 품목군이 있으면 종류까지 맞춰 세고(Mini 1번 ≠ Regular 1번), 없으면 번호로만 센다
    const stat = {}, statN = {}; const add = (m, k, r) => { const o = m[k] || (m[k] = { d: new Set(), ea: 0, ng: 0 }); o.d.add(r.date); o.ea += C.qty(r); o.ng += C.num(r.ng_qty); };
    C.rowsBetween(from, ref).forEach(r => { add(stat, C.machKey(r), r); add(statN, r.process + ':' + r.machine_no, r); });
    const statOf = (m) => (m.name || m.division) ? stat[C.machKey({ process: m.process, machine: m.name, division: m.division, machine_no: m.machine_no })] : statN[m.process + ':' + m.machine_no];
    const g = ERP.grid({ table: 'machines', pageSize: 50, maxH: '66vh', filters: [{ id: 'p', label: L('공정', 'Công đoạn'), key: 'process', options: () => ERP.PROC.map(p => ({ v: p.id, label: L(p.ko, p.vi) })) }],
      extraCols: [{ label: () => L('30일 가동일', 'Ngày chạy/30'), num: 1, render: m => { const s = statOf(m); return s ? s.d.size : 0; } }, { label: () => L('30일 생산량', 'SL 30 ngày'), num: 1, render: m => { const s = statOf(m); return s ? F.n(s.ea) : '–'; } }] });
    host.append(h('p', { class: 'help' }, L('설비 마스터는 일보 입력 시 설비번호 자동완성에 사용됩니다. 기록이 없는 설비는 "사용"을 해제하세요.', 'Danh mục máy dùng để gợi ý số máy khi nhập báo cáo. Bỏ chọn "Đang dùng" với máy không còn chạy.')), g.el);
  }

  ERP.pages.production = { ko: '생산 관리', vi: 'Quản lý sản xuất', render(root) {
    const st = ERP.state.prodTab = ERP.state.prodTab || 'log';
    root.appendChild(ERP.pageHead([L('생산 관리', 'Quản lý sản xuất'), ERP.sampleChip ? ERP.sampleChip('prod_log') : null], L('공정별 생산일보 조회 · 입력 · 일별 · 월별 생산량 · 공정 설정', 'Báo cáo ngày theo công đoạn: xem · nhập · sản lượng theo ngày · cài đặt công đoạn'),
      [h('button', { class: 'btn', onclick: () => ERP.goto('data') }, L('엑셀 일보 업로드', 'Tải báo cáo Excel'))]));
    // 1.10.1: 일별 · 월별 생산량 탭 (기본 = 조립) — 탭 이름에 고른 공정 이름
    const pnOf = (s) => { const id = s && s.proc !== undefined ? s.proc : 'ASM'; return id ? ERP.procName(id) + ' ' : ''; };
    const tabs = [{ id: 'log', label: L('일보 조회/관리', 'Danh sách báo cáo') }, { id: 'entry', label: L('일보 입력', 'Nhập báo cáo') },
      { id: 'analysis', label: L('일별 ' + pnOf(ERP.state.pan) + '생산량', 'Sản lượng ' + pnOf(ERP.state.pan) + 'theo ngày') }, { id: 'monthly', label: L('월별 ' + pnOf(ERP.state.pmon) + '생산량', 'Sản lượng ' + pnOf(ERP.state.pmon) + 'theo tháng') },
      { id: 'machines', label: L('설비', 'Máy móc') }, { id: 'procs', label: L('공정 설정', 'Cài đặt công đoạn') }];
    const host = h('div', { class: 'card' });
    root.append(ERP.tabs(tabs, st, (id) => { ERP.state.prodTab = id; ERP.render(); }), host);
    ({ log: logTab, entry: entryTab, analysis: analysisTab, monthly: monthlyTab, machines: machinesTab, procs: procTab })[st](host);
  } };

})();
