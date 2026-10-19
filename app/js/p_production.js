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
        { id: 'd', label: L('품목군', 'Nhóm'), key: 'division', options: () => Array.from(new Set(DB.rows('prod_log').map(r => r.division).filter(Boolean))).sort().map(v => ({ v, label: v })) },
        { id: 's', label: L('주/야', 'Ca'), key: 'shift', options: () => [{ v: 'D', label: L('주간', 'Ca ngày') }, { v: 'N', label: L('야간', 'Ca đêm') }] }],
      toolbar: (s, render) => [h('label', { class: 'muted' }, L('기간 ', 'Từ '), h('input', { class: 'inp', type: 'date', value: st.from, onchange: (e) => { st.from = e.target.value || st.from; render(); } }), ' ~ ', h('input', { class: 'inp', type: 'date', value: st.to, onchange: (e) => { st.to = e.target.value || st.to; render(); } }))],
      cols: ['date', 'process', 'shift', 'machine_no', 'division', 'code', 'name', 'plan_qty', 'ok_qty', 'ng_qty', 'stop_min'].map(COL) });
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
          const rows = ta.value.split(/\r?\n/).filter(x => x.trim()).map(line => { const cells = line.split('\t'); const o = {}; cs.forEach((c, j) => { let v = (cells[j] || '').trim(); if (v === '') return; if (c.t === 'n') { v = Number(v.replace(/,/g, '')); if (isNaN(v)) return; } o[c.k] = v; }); calcMin(o); return o; });
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

  // ------------ tab: analysis (daily quantity table per month) ------------
  function analysisTab(host) {
    const ref = C.latestProdDate();
    const st = ERP.state.pan = ERP.state.pan || {};
    // 7차: 기본은 "조립만 · 품목군별" (공장 엑셀 Assembly Sum 과 같은 보기). 다른 공정은 위에서 고른다.
    if (!st.month) st.month = ref.slice(0, 7); if (!st.by) st.by = 'division'; if (st.proc === undefined) st.proc = 'ASM'; if (st.div === undefined) st.div = '';
    const addM = (ym, k) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + k, 1)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
    const divs = Array.from(new Set(DB.rows('prod_log').map(r => r.division).filter(Boolean))).sort();
    const bar = h('div', { class: 'toolbar' }); 
    function drawBar() {
      bar.replaceChildren(
        h('button', { class: 'btn', onclick: () => { st.month = addM(st.month, -1); draw(); } }, '‹'),
        h('input', { class: 'inp', type: 'month', value: st.month, onchange: (e) => { if (e.target.value) { st.month = e.target.value; draw(); } } }),
        h('button', { class: 'btn', onclick: () => { st.month = addM(st.month, 1); draw(); } }, '›'),
        h('select', { class: 'inp', onchange: (e) => { st.by = e.target.value; draw(); } }, [['process', L('열: 공정별', 'Cột: theo công đoạn')], ['division', L('열: 품목군별', 'Cột: theo nhóm hàng')]].map(o => h('option', { value: o[0], selected: st.by === o[0] }, o[1]))),
        h('select', { class: 'inp', onchange: (e) => { st.proc = e.target.value; draw(); } }, h('option', { value: '' }, L('공정: 전체', 'Công đoạn: tất cả')), ERP.PROC.map(p => h('option', { value: p.id, selected: st.proc === p.id }, L(p.ko, p.vi)))),
        h('select', { class: 'inp', onchange: (e) => { st.div = e.target.value; draw(); } }, h('option', { value: '' }, L('품목군: 전체', 'Nhóm: tất cả')), divs.map(d => h('option', { value: d, selected: st.div === d }, d))));
    }
    let _drawing = false;
    function draw() { if (_drawing) return; _drawing = true; try { drawInner(); } finally { _drawing = false; } }
    function drawInner() {
      drawBar();
      const from = st.month + '-01'; const nextM = addM(st.month, 1) + '-01'; const to = F.addDays(nextM, -1);
      const rows = C.rowsBetween(from, to, st.proc).filter(r => !st.div || r.division === st.div);
      const lastIn = rows.reduce((a, r) => (r.date > a ? r.date : a), '');
      // 품목군: 대소문자·공백 차이는 한 묶음 (종합 현황 '일별 조립 생산량'과 같은 규칙)
      const canon = new Map(); const dk = (r) => { const raw = String(r.division || '').trim(); const k = raw.toLowerCase() || '–'; if (!canon.has(k)) canon.set(k, raw || L('(품목군 없음)', '(không nhóm)')); return k; };
      const colKeys = st.by === 'process' ? (st.proc ? ERP.PROC.filter(p => p.id === st.proc) : ERP.PROC).map(p => ({ k: p.id, label: L(p.ko, p.vi) })) : Array.from(new Set(rows.map(dk))).sort().map(d => ({ k: d, label: canon.get(d) }));
      const keyOf = (r) => st.by === 'process' ? r.process : dk(r);
      const cell = {}; const dayTot = {}; const colTot = {}; let grand = 0;
      rows.forEach(r => { const q = C.qty(r); const k = keyOf(r); (cell[r.date] = cell[r.date] || {})[k] = (cell[r.date][k] || 0) + q; dayTot[r.date] = (dayTot[r.date] || 0) + q; colTot[k] = (colTot[k] || 0) + q; grand += q; });
      const days = []; if (lastIn) { let d = from; while (d <= lastIn) { days.push(d); d = F.addDays(d, 1); } }
      const active = Object.keys(dayTot).length; const a = C.agg(rows);
      const trs = days.map(d => { const has = dayTot[d] !== undefined; const wk = F.dow(d); const off = /일|토|CN|T7|Sun|Sat/.test(wk);
        return h('tr', { style: has ? null : { color: '#9AA3AF', background: off ? '#FAFAFB' : null } }, h('td', { style: { whiteSpace: 'nowrap' } }, F.md(d) + ' ', h('small', { class: 'muted' }, wk)),
          colKeys.map(c => h('td', { class: 'num' }, cell[d] && cell[d][c.k] ? F.n(cell[d][c.k]) : '–')), h('td', { class: 'num' }, has ? h('b', F.n(dayTot[d])) : '–')); });
      const totRow = h('tr', { style: { background: '#F4F6F9', fontWeight: '700', position: 'sticky', bottom: 0 } }, h('td', L('월 합계', 'Tổng tháng')), colKeys.map(c => h('td', { class: 'num' }, F.n(colTot[c.k] || 0))), h('td', { class: 'num' }, F.n(grand)));
      const tbl = h('div', { class: 'tbl-wrap', style: { maxHeight: '62vh' } }, h('table', { class: 'tbl' }, h('thead', h('tr', h('th', L('일자', 'Ngày')), colKeys.map(c => h('th', { class: 'num' }, c.label)), h('th', { class: 'num' }, L('일 합계', 'Tổng ngày')))), h('tbody', trs, totRow)));
      // machine ranking
      const mm = {}; rows.forEach(r => { const k = r.process + ':' + (r.machine_no === undefined ? '-' : r.machine_no); const o = mm[k] || (mm[k] = { proc: r.process, no: r.machine_no, ea: 0, days: new Set() }); o.ea += C.qty(r); o.days.add(r.date); });
      const mlist = Object.values(mm).sort((x, y) => y.ea - x.ea);
      const dp = {}; rows.forEach(r => { const d = dk(r); (dp[d] = dp[d] || {})[r.process] = (dp[d][r.process] || 0) + C.qty(r); }); const dpRows = Object.keys(dp).sort();
      const raw = {}; rows.forEach(r => { if (r.raw_material && r.raw_kg) raw[r.raw_material] = (raw[r.raw_material] || 0) + C.num(r.raw_kg); });
      body.replaceChildren(
        h('section', { class: 'kpis' },
          ERP.kpi(st.proc ? L('월 ' + ERP.procName(st.proc) + ' 생산량', 'Sản lượng tháng · ' + ERP.procName(st.proc)) : L('월 총 생산량 (pcs 환산)', 'Tổng sản lượng tháng (pcs)'), F.n(grand), 'pcs', 'neutral', st.month, st.proc ? L('양품 기준', 'theo SL đạt') : L('포장은 pcs 환산 기준', 'Đóng gói tính theo pcs quy đổi')),
          ERP.kpi(L('입력된 일수', 'Số ngày có dữ liệu'), F.n(active), L('일', 'ngày'), 'info', lastIn ? F.d(from) + ' ~ ' + F.d(lastIn) : '–', null),
          ERP.kpi(L('일 평균', 'Trung bình/ngày'), F.n(active ? grand / active : 0), 'pcs', 'neutral', null, L('입력된 일 기준', 'theo ngày có dữ liệu')),
          ERP.kpi(L('가동 설비 수', 'Số máy có chạy'), F.n(a.machines.size), L('대', 'máy'), 'neutral', null, null)),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', (st.proc ? L('일별 ' + ERP.procName(st.proc) + ' 생산수량 · ', 'Sản lượng ' + ERP.procName(st.proc) + ' theo ngày · ') : L('일별 생산수량 · ', 'Sản lượng theo ngày · ')) + st.month), h('button', { class: 'btn sm', onclick: () => ERP.xl.exportAoa('daily_' + st.month, [L('일자', 'Ngày')].concat(colKeys.map(c => c.label), [L('일 합계', 'Tổng')]), days.filter(d => dayTot[d] !== undefined).map(d => [d].concat(colKeys.map(c => (cell[d] && cell[d][c.k]) || 0), [dayTot[d]]))) }, L('엑셀', 'Excel'))), days.length ? tbl : h('div', { class: 'empty' }, L('이 달에 입력된 일보가 없습니다.', 'Tháng này chưa có báo cáo.'))),
        h('div', { class: 'grid2' },
          h('section', { class: 'card' }, h('h2', L('설비별 실적', 'Hiệu suất theo máy')),
            ERP.simpleTable([{ label: L('공정', 'Công đoạn'), render: m => ERP.chip('neutral', ERP.procName(m.proc)) }, { label: L('설비', 'Máy'), render: m => m.no === undefined ? '–' : m.no }, { label: L('가동일', 'Số ngày'), num: 1, render: m => m.days.size }, { label: 'pcs', num: 1, render: m => F.n(m.ea) }], mlist.slice(0, 40), { maxH: '360px' })),
          h('section', { class: 'card' }, h('h2', L('품목군 × 공정 생산량 (pcs)', 'Nhóm × công đoạn (pcs)')),
            ERP.simpleTable([{ label: L('품목군', 'Nhóm'), render: d => canon.get(d) || d }].concat(ERP.PROC.map(p => ({ label: L(p.ko, p.vi), num: 1, render: d => F.n(dp[d][p.id]) }))), dpRows, { maxH: '300px' }),
            Object.keys(raw).length ? h('div', h('h3', { style: { marginTop: '14px' } }, L('원료 사용량 (kg)', 'NL sử dụng (kg)')), h('div', { class: 'list' }, Object.entries(raw).sort((x, y) => y[1] - x[1]).map(([k, v]) => h('div', h('span', k), h('b', F.n(v, 1)))))) : null)));
    }
    host.append(bar, body); draw();
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
    const stat = {}; C.rowsBetween(from, ref).forEach(r => { const k = r.process + ':' + r.machine_no; const o = stat[k] || (stat[k] = { d: new Set(), ea: 0, ng: 0 }); o.d.add(r.date); o.ea += C.qty(r); o.ng += C.num(r.ng_qty); });
    const g = ERP.grid({ table: 'machines', pageSize: 50, maxH: '66vh', filters: [{ id: 'p', label: L('공정', 'Công đoạn'), key: 'process', options: () => ERP.PROC.map(p => ({ v: p.id, label: L(p.ko, p.vi) })) }],
      extraCols: [{ label: () => L('30일 가동일', 'Ngày chạy/30'), num: 1, render: m => { const s = stat[m.process + ':' + m.machine_no]; return s ? s.d.size : 0; } }, { label: () => L('30일 생산량', 'SL 30 ngày'), num: 1, render: m => { const s = stat[m.process + ':' + m.machine_no]; return s ? F.n(s.ea) : '–'; } }] });
    host.append(h('p', { class: 'help' }, L('설비 마스터는 일보 입력 시 설비번호 자동완성에 사용됩니다. 기록이 없는 설비는 "사용"을 해제하세요.', 'Danh mục máy dùng để gợi ý số máy khi nhập báo cáo. Bỏ chọn "Đang dùng" với máy không còn chạy.')), g.el);
  }

  ERP.pages.production = { ko: '생산 관리', vi: 'Quản lý sản xuất', render(root) {
    const st = ERP.state.prodTab = ERP.state.prodTab || 'log';
    root.appendChild(ERP.pageHead([L('생산 관리', 'Quản lý sản xuất'), ERP.sampleChip ? ERP.sampleChip('prod_log') : null], L('공정별 생산일보 조회 · 입력 · 일별 생산수량 · 공정 설정', 'Báo cáo ngày theo công đoạn: xem · nhập · sản lượng theo ngày · cài đặt công đoạn'),
      [h('button', { class: 'btn', onclick: () => ERP.goto('data') }, L('엑셀 일보 업로드', 'Tải báo cáo Excel'))]));
    const tabs = [{ id: 'log', label: L('일보 조회/관리', 'Danh sách báo cáo') }, { id: 'entry', label: L('일보 입력', 'Nhập báo cáo') }, { id: 'analysis', label: L('일별 생산수량', 'Sản lượng theo ngày') }, { id: 'machines', label: L('설비', 'Máy móc') }, { id: 'procs', label: L('공정 설정', 'Cài đặt công đoạn') }];
    const host = h('div', { class: 'card' });
    root.append(ERP.tabs(tabs, st, (id) => { ERP.state.prodTab = id; ERP.render(); }), host);
    ({ log: logTab, entry: entryTab, analysis: analysisTab, machines: machinesTab, procs: procTab })[st](host);
  } };

})();
