/* 1.12.0 (17차): 현장 재고 위 = 피벗 표 — 1.11.4 의 공정별 · 대분류 칸을 대신한다.
   사용자 (2026-10-22, 현장 재고 칸 · 월별 조립 생산량 표 캡처와 함께): "두번째사진 형태로 조립부분만 보여줘. 다른공정들은 커스텀마이징 할수있게 해주고 엑셀 기능의 피벗테이블 처럼"
   표 하나 = { id, title, procs(공정 — 비면 모든 공정), divs(품목군 — 비면 모두), rows(행), cols(열), scope(창고+공장 · 창고 · 공장), zero(재고 0 줄도) }
   행: 품목군 · 공정 · 단계 · 품목 / 열: 월 · 공정 · 품목군 · 단계 · 없음. 값 = 현장 재고 수량 (월 = 그 달 말일 재고, 이번 달은 지금).
   기본 = 조립 · 품목군 × 월 (월별 조립 생산량 표와 같은 모양). 표 목록은 설정 `floorPivots` (모든 PC 같은 설정), 연도는 화면 상태. */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, F = ERP.fmt, INV = ERP.inv;
  const EPS = 1e-6; const r4 = (x) => Math.round((+x || 0) * 10000) / 10000;
  const KEY = 'floorPivots';
  const P = ERP.pivot = {};
  P.KEY = KEY;
  P.DEFAULT = () => [{ id: 'asm', procs: ['ASM'], divs: [], rows: 'div', cols: 'month', scope: 'all' }];

  // ---------------------------------------------------------------- 차원 (행 · 열로 고를 수 있는 것)
  const procOrder = (k) => { const i = ERP.PROC.findIndex(p => p.id === k); return i < 0 ? 99 : i; };
  const stageOrder = (k) => { const i = INV.stageList().indexOf(k); return i < 0 ? 99 : i; };
  const lineOrder = (k) => { const i = INV.LINE_ORDER.indexOf(k); return i < 0 ? (k ? 50 : 99) : i; };
  const procOf = (s) => INV.procOfStage(s.stage) || 'ETC';
  P.procLabel = (k) => (k === 'ETC' ? L('기타', 'Khác') : ERP.procName(k));
  const DIMS = {
    div: { ko: '품목군', vi: 'Nhóm', key: (s) => s.line || '', label: (k) => INV.lineDivName(k), order: lineOrder },
    proc: { ko: '공정', vi: 'Công đoạn', key: procOf, label: P.procLabel, order: procOrder },
    stage: { ko: '단계', vi: 'Giai đoạn', key: (s) => s.stage || 'ETC', label: (k) => INV.stageTitle(k), order: stageOrder },
    item: { ko: '품목', vi: 'Mã hàng', key: (s) => s.code, label: (k) => k, order: () => 0 },
  };
  P.DIMS = DIMS;
  const ROWS = ['div', 'proc', 'stage', 'item'];
  const COLS = ['month', 'proc', 'div', 'stage', 'none'];
  const colName = (c) => (c === 'month' ? L('월 (말일 재고)', 'Tháng (tồn cuối tháng)') : c === 'none' ? L('없음 (지금 재고만)', 'Không (chỉ tồn hiện tại)') : L(DIMS[c].ko, DIMS[c].vi));
  const dimName = (d) => (d === 'month' ? L('월', 'Tháng') : d === 'none' ? '' : L(DIMS[d].ko, DIMS[d].vi));
  const SCOPES = () => [['all', L('창고+공장', 'Kho+Xưởng')], ['WH', L('창고', 'Kho')], ['FAC', L('공장', 'Xưởng')]];

  // ---------------------------------------------------------------- 설정 (표 목록)
  const clean = (c) => ({ id: String(c.id || ('p' + Date.now().toString(36))), title: c.title ? String(c.title) : undefined,
    procs: Array.isArray(c.procs) ? c.procs.map(String) : [], divs: Array.isArray(c.divs) ? c.divs.map(String) : [],
    rows: ROWS.includes(c.rows) ? c.rows : 'div', cols: COLS.includes(c.cols) && c.cols !== c.rows ? c.cols : 'month',
    scope: ['all', 'WH', 'FAC'].includes(c.scope) ? c.scope : 'all', zero: !!c.zero });
  /** 저장된 표 목록 (없으면 기본: 조립 · 품목군 × 월). 모두 지우면 빈 목록 */
  P.list = () => { const v = DB.setting(KEY, null); return Array.isArray(v) ? v.map(clean) : P.DEFAULT(); };
  const save = (list) => { DB.setSetting(KEY, list.map(c => { const o = clean(c); if (!o.title) delete o.title; if (!o.zero) delete o.zero; return o; })); ERP.render(); };
  const patch = (id, p) => { const l = P.list(); const c = l.find(x => x.id === id); if (!c) return; Object.assign(c, p); if (c.cols === c.rows) c.cols = 'month'; save(l); };
  P.autoTitle = (c) => (c.procs.length ? c.procs.map(P.procLabel).join(' · ') : L('모든 공정', 'Mọi công đoạn')) + L(' 재고', ' — tồn') + (c.divs.length ? ' (' + c.divs.map(k => INV.lineDivName(k)).join(' · ') + ')' : '');
  const VS = () => (ERP.state.fpiv = ERP.state.fpiv || {});   // 표마다 연도 · 설정 열림 (저장 안 함)
  const vs = (id) => (VS()[id] = VS()[id] || { year: +F.today().slice(0, 4), edit: false });

  // ---------------------------------------------------------------- 계산
  const val = (s, scope) => (scope === 'WH' ? s.by.WH : scope === 'FAC' ? s.by.FAC : s.bal);
  const floorRows = (upTo) => INV.rows(upTo ? { upTo } : undefined).filter(s => INV.groupOf(s) === 'floor');
  const pass = (c) => (s) => (!c.procs.length || c.procs.includes(procOf(s))) && (!c.divs.length || c.divs.includes(s.line || ''));
  /** 이 품목의 재고를 알 수 있는 첫날: 공정 중 품목 = 현장 실사일 (실사가 있을 때), 그 밖 = ECOUNT · 창고 입출고장 기준일 중 늦은 날 */
  const knownFrom = (s) => { const d = INV.opening().date; if (INV.floorActive() && INV.inProcess(s.stage)) return d.FLOOR || ''; return [d.WH, d.FAC].filter(Boolean).sort().pop() || ''; };
  const monthEnd = (y, m) => F.addDays((m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0')) + '-01', -1);
  /** 피벗 계산: { cols: [{k, label, sub, unknown, cur}], rows: [{k, unit, label, title, cells: Map, tot}], tots: [{unit, cells, tot}], units, cut, hasTot } */
  P.build = function (c, year) {
    const today = F.today(); const R = DIMS[c.rows]; const f = pass(c);
    const now = floorRows().filter(f);
    const cut = now.reduce((a, s) => { const k = knownFrom(s); return k > a ? k : a; }, '');
    let cols = [];
    const sets = [];   // [colKey, rows] — 열 하나마다 그 때의 재고 행
    if (c.cols === 'month') {
      const y = year || +today.slice(0, 4); const lastM = y < +today.slice(0, 4) ? 12 : y > +today.slice(0, 4) ? 0 : +today.slice(5, 7);
      for (let m = 1; m <= lastM; m++) {
        const cur = y === +today.slice(0, 4) && m === lastM; const end = cur ? today : monthEnd(y, m);
        const unknown = !!cut && end < cut;
        cols.push({ k: String(m), label: L(m + '월', 'T' + m), sub: cur ? L('지금', 'hiện tại') : null, unknown, cur });
        if (!unknown) sets.push([String(m), cur ? now : floorRows(end).filter(f)]);
      }
    } else sets.push(['_', now]);
    const rowMap = new Map(); const colKeys = new Map();
    sets.forEach(([ck, list]) => list.forEach(s => {
      const v = val(s, c.scope); const unit = s.prim || 'PCS';
      const rk = R.key(s); const cdk = c.cols === 'month' ? ck : c.cols === 'none' ? '_' : DIMS[c.cols].key(s);
      if (c.cols !== 'month' && c.cols !== 'none' && !colKeys.has(cdk)) colKeys.set(cdk, true);
      const key = rk + '\u0001' + unit; let r = rowMap.get(key);
      if (!r) rowMap.set(key, r = { k: rk, unit, cells: new Map(), name: c.rows === 'item' ? (s.name || '') : '' });
      r.cells.set(cdk, r4((r.cells.get(cdk) || 0) + v));
    }));
    if (c.cols !== 'month') {
      const D = c.cols === 'none' ? null : DIMS[c.cols];
      cols = c.cols === 'none' ? [{ k: '_', label: L('지금 재고', 'Tồn hiện tại') }] : Array.from(colKeys.keys()).sort((a, b) => D.order(a) - D.order(b) || String(a).localeCompare(String(b), undefined, { numeric: true })).map(k => ({ k, label: D.label(k) }));
    }
    const hasTot = c.cols !== 'month' && c.cols !== 'none';
    let rows = Array.from(rowMap.values());
    if (!c.zero) {   // 재고 0 인 줄 · (공정 · 품목군 · 단계 열이면) 모두 0 인 열은 숨김
      rows = rows.filter(r => Array.from(r.cells.values()).some(v => Math.abs(v) > EPS));
      if (hasTot) cols = cols.filter(x => rows.some(r => Math.abs(r.cells.get(x.k) || 0) > EPS));
    }
    const units = Array.from(new Set(rows.map(r => r.unit))).sort(); const multi = units.length > 1;   // 단위가 섞이면 줄 · 합계를 단위별로
    rows.forEach(r => { r.label = R.label(r.k) + (multi ? ' · ' + r.unit : ''); r.title = c.rows === 'item' ? r.k + (r.name ? ' · ' + r.name : '') : r.label; r.tot = r4(Array.from(r.cells.values()).reduce((a, v) => a + v, 0)); });
    rows.sort((a, b) => R.order(a.k) - R.order(b.k) || String(a.k).localeCompare(String(b.k), undefined, { numeric: true }) || String(a.unit).localeCompare(String(b.unit)));
    const tots = units.map(u => { const cells = new Map(); rows.filter(r => r.unit === u).forEach(r => r.cells.forEach((v, k) => cells.set(k, r4((cells.get(k) || 0) + v)))); return { unit: u, cells, tot: r4(Array.from(cells.values()).reduce((a, v) => a + v, 0)) }; });
    return { cols, rows, tots, units, multi, cut, hasTot, items: now.length };
  };

  // ---------------------------------------------------------------- 화면
  const isInt = (v) => Math.abs(v - Math.round(v)) < 1e-9;
  const fv = (v, u) => F.n(v, u === 'kg' || !isInt(+v) ? 2 : 0);
  const neg = (v) => (v < -EPS ? { color: '#B3261E', fontWeight: 700 } : null);
  /** 칸을 누르면 아래 품목 표를 그 공정 · 품목군 · 단계로 (품목 줄은 수불부) */
  function pick(c, rk, ck) {
    if (c.rows === 'item') { ERP.itemDetail(rk); return; }
    const st = ERP.state.stk_floor; if (!st) return;
    st.proc = c.procs.length === 1 ? c.procs[0] : ''; st.line = c.divs.length === 1 ? c.divs[0] : ''; st.stage = ''; st.sub = st.cat = ''; st.page = 0;
    const set = (dim, k) => { if (dim === 'proc') st.proc = k; else if (dim === 'div') st.line = k; else if (dim === 'stage') st.stage = k; };
    set(c.rows, rk); if (ck !== null && ck !== undefined && c.cols !== 'month' && c.cols !== 'none') set(c.cols, ck);
    ERP.render();
    setTimeout(() => { const t = document.querySelector('main [data-anchor="floor-table"]'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 0);
  }
  function table(c, d) {
    const R = DIMS[c.rows]; const unitHead = d.multi ? null : (d.units[0] || '');
    const head = h('tr', h('th', { title: unitHead ? L('단위 ', 'Đơn vị ') + unitHead : null }, dimName(c.rows) + (c.cols === 'none' ? '' : ' \\ ' + dimName(c.cols))),
      d.hasTot ? h('th', { class: 'num' }, L('합계', 'Tổng')) : null,
      d.cols.map(x => h('th', { class: 'num' + (x.unknown ? ' muted' : ''), title: x.unknown ? L('현장 실사 전 — 재고를 알 수 없음', 'Trước kiểm kê — chưa biết tồn') : null }, x.label, x.sub ? h('small', x.sub) : null)));
    const cell = (r, x) => {
      if (x.unknown) return h('td', { class: 'num muted' }, '·');
      const v = r.cells.get(x.k); if (v === undefined || Math.abs(v) <= EPS) return h('td', { class: 'num pc', onclick: () => pick(c, r.k, x.k) }, h('span', { class: 'muted' }, '·'));
      return h('td', { class: 'num pc', style: neg(v), onclick: () => pick(c, r.k, x.k), title: r.title + ' · ' + x.label }, fv(v, r.unit));
    };
    const body = d.rows.map(r => h('tr', { 'data-k': r.k, 'data-unit': r.unit },
      h('td', { class: 'pc', title: r.title, onclick: () => pick(c, r.k, null) }, h('b', r.label)),
      d.hasTot ? h('td', { class: 'num', style: neg(r.tot) || { fontWeight: 700 } }, fv(r.tot, r.unit)) : null,
      d.cols.map(x => cell(r, x))));
    const foot = d.tots.map(t => h('tr', { class: 'tot', 'data-unit': t.unit }, h('td', L('합계', 'Tổng') + (d.multi ? ' · ' + t.unit : '')),
      d.hasTot ? h('td', { class: 'num' }, fv(t.tot, t.unit)) : null,
      d.cols.map(x => h('td', { class: 'num' }, x.unknown ? '·' : (Math.abs(t.cells.get(x.k) || 0) > EPS ? fv(t.cells.get(x.k), t.unit) : '·')))));
    const wrap = h('div', { class: 'tbl-wrap', style: { maxHeight: c.rows === 'item' ? '420px' : null } },
      h('table', { class: 'tbl dt fpiv-t' + (d.hasTot ? '' : ' nostick2') + (d.multi || c.rows === 'item' || c.rows === 'stage' ? ' wide1' : ''), 'data-rows': c.rows, 'data-cols': c.cols }, h('thead', head), h('tbody', body, foot)));
    if (c.cols === 'month') setTimeout(() => { wrap.scrollLeft = wrap.scrollWidth; }, 0);   // 좁은 화면: 최근 달(이번 달)이 먼저 보이게
    return wrap;
  }
  /** 표 설정 (엑셀 피벗처럼: 거르기 · 행 · 열 · 범위) */
  function editor(c, i, n, procsHere, linesHere) {
    const chk = (on, label, fn, attrs) => h('label', Object.assign({ class: 'fpiv-chk' + (on ? ' on' : '') }, attrs || {}), h('input', { type: 'checkbox', checked: on, onchange: (e) => fn(e.target.checked) }), ' ', label);
    const toggle = (arr, k, on) => { const a = arr.filter(x => x !== k); if (on) a.push(k); return a; };
    const sel = (k, opts, cur) => h('select', { class: 'inp', 'data-k': k, onchange: (e) => patch(c.id, { [k]: e.target.value }) }, opts.map(o => h('option', { value: o[0], selected: cur === o[0] }, o[1])));
    const procIds = ERP.PROC.map(p => p.id).concat(['ETC']).filter(p => procsHere.has(p) || c.procs.includes(p));
    const lines = Array.from(new Set(Array.from(linesHere).concat(c.divs))).sort((a, b) => lineOrder(a) - lineOrder(b) || a.localeCompare(b));
    return h('div', { class: 'fpiv-edit' },
      h('div', { class: 'fpiv-row' }, h('b', L('공정', 'Công đoạn')), chk(!c.procs.length, L('전체', 'Tất cả'), (on) => patch(c.id, { procs: on ? [] : procIds.slice(0, 1) }), { 'data-proc': '' }),
        procIds.map(p => chk(c.procs.includes(p), P.procLabel(p), (on) => patch(c.id, { procs: toggle(c.procs, p, on) }), { 'data-proc': p }))),
      h('div', { class: 'fpiv-row' }, h('b', L('품목군', 'Nhóm')), chk(!c.divs.length, L('전체', 'Tất cả'), (on) => patch(c.id, { divs: on ? [] : lines.slice(0, 1) }), { 'data-div': '' }),
        lines.map(k => chk(c.divs.includes(k), INV.lineDivName(k), (on) => patch(c.id, { divs: toggle(c.divs, k, on) }), { 'data-div': k }))),
      h('div', { class: 'fpiv-row' },
        h('label', h('b', L('행', 'Hàng')), ' ', sel('rows', ROWS.map(k => [k, L(DIMS[k].ko, DIMS[k].vi)]), c.rows)),
        h('label', h('b', L('열', 'Cột')), ' ', sel('cols', COLS.filter(k => k !== c.rows).map(k => [k, colName(k)]), c.cols)),
        h('label', h('b', L('범위', 'Phạm vi')), ' ', sel('scope', SCOPES(), c.scope)),
        h('label', h('b', L('제목', 'Tiêu đề')), ' ', h('input', { class: 'inp', 'data-k': 'title', value: c.title || '', placeholder: P.autoTitle(c), style: { width: '200px' }, onchange: (e) => patch(c.id, { title: e.target.value.trim() || undefined }) })),
        chk(!!c.zero, L('재고 0인 줄도 보기', 'Hiện cả dòng tồn 0'), (on) => patch(c.id, { zero: on }))),
      h('div', { class: 'fpiv-row' },
        h('button', { type: 'button', class: 'btn sm', disabled: i === 0, onclick: () => { const l = P.list(); const t = l[i - 1]; l[i - 1] = l[i]; l[i] = t; save(l); } }, L('위로', 'Lên')),
        h('button', { type: 'button', class: 'btn sm', disabled: i >= n - 1, onclick: () => { const l = P.list(); const t = l[i + 1]; l[i + 1] = l[i]; l[i] = t; save(l); } }, L('아래로', 'Xuống')),
        h('button', { type: 'button', class: 'btn sm danger', 'data-act': 'del', onclick: async () => { if (!(await ERP.confirm(L('이 표를 지울까요? (재고 자료는 그대로)', 'Xóa bảng này? (dữ liệu tồn không đổi)'), L('표 지우기', 'Xóa bảng'), true))) return; delete VS()[c.id]; save(P.list().filter(x => x.id !== c.id)); } }, L('표 지우기', 'Xóa bảng')),
        h('span', { class: 'sp' }),
        h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'done', onclick: () => { vs(c.id).edit = false; ERP.render(); } }, L('완료', 'Xong'))));
  }
  function exportXl(c, d, title) {
    const hdr = [dimName(c.rows)].concat(d.hasTot ? [L('합계', 'Tổng')] : [], d.cols.map(x => x.label + (x.sub ? ' (' + x.sub + ')' : '')));
    const line = (label, cells, tot) => [label].concat(d.hasTot ? [tot] : [], d.cols.map(x => (x.unknown ? null : (cells.get(x.k) === undefined ? 0 : cells.get(x.k)))));
    ERP.xl.exportAoa('floor_pivot', hdr, d.rows.map(r => line(c.rows === 'item' ? r.title : r.label, r.cells, r.tot)).concat(d.tots.map(t => line(L('합계', 'Tổng') + (d.multi ? ' · ' + t.unit : ''), t.cells, t.tot))));
    ERP.toast(title + L(' — 엑셀로 저장', ' — đã xuất Excel'), 'ok');
  }
  /** 현장 재고 위 영역: 표 목록 + [+ 표 추가] (p_stock.js stockTab 이 부름) */
  ERP.floorPivot = function (all) {
    const list = P.list(); const procsHere = new Set(all.map(procOf)); const linesHere = new Set(all.map(s => s.line || ''));
    const wrap = h('div', { class: 'fpiv' });
    list.forEach((c, i) => {
      const V = vs(c.id); const d = P.build(c, V.year); const title = c.title || P.autoTitle(c);
      const right = h('div', { class: 'whead-r' },
        c.cols === 'month' ? h('span', { class: 'wnav' }, h('button', { type: 'button', class: 'btn sm', 'aria-label': 'prev', onclick: () => { V.year--; ERP.render(); } }, '‹'), h('b', String(V.year)), h('button', { type: 'button', class: 'btn sm', 'aria-label': 'next', onclick: () => { V.year++; ERP.render(); } }, '›')) : null,
        h('button', { type: 'button', class: 'btn sm' + (V.edit ? ' primary' : ''), 'data-act': 'edit', onclick: () => { V.edit = !V.edit; ERP.render(); } }, L('설정', 'Cài đặt')),
        h('button', { type: 'button', class: 'btn sm', 'data-act': 'xl', disabled: !d.rows.length, onclick: () => exportXl(c, d, title) }, L('엑셀', 'Excel')));
      const unitNote = d.units.length === 1 ? L('단위 ', 'Đơn vị ') + d.units[0] : null;
      const empty = c.cols === 'month' && !d.cols.length ? L(V.year + '년은 아직 오지 않았습니다.', 'Năm ' + V.year + ' chưa đến.')
        : c.cols === 'month' && d.cols.every(x => x.unknown) ? L(V.year + '년은 현장 실사 전이라 재고를 알 수 없습니다.', 'Năm ' + V.year + ' trước kiểm kê — chưa biết tồn.')
          : L('조건에 맞는 재고가 없습니다. 설정에서 공정 · 품목군을 바꿔 보세요.', 'Không có tồn phù hợp. Đổi công đoạn · nhóm trong Cài đặt.');
      const body = d.rows.length ? table(c, d) : h('div', { class: 'empty' }, empty);
      wrap.appendChild(h('section', { class: 'card wcard fpiv-card', 'data-id': c.id },
        h('div', { class: 'card-head' }, h('h2', title + (c.cols === 'month' ? ' · ' + V.year : '')), right),
        V.edit ? editor(c, i, list.length, procsHere, linesHere) : null, body,
        h('p', { class: 'help', style: { margin: '8px 0 0' } }, [unitNote, c.scope !== 'all' ? L('범위 ', 'Phạm vi ') + SCOPES().find(x => x[0] === c.scope)[1] : null,
          c.cols === 'month' ? L('월 = 그 달 말일 재고 (이번 달은 지금)', 'Tháng = tồn cuối tháng (tháng này = hiện tại)') + (d.cut && d.cols.some(x => x.unknown) ? L(' · ' + d.cut + ' (현장 실사) 전 달은 재고를 알 수 없어 · 로 둡니다', ' · tháng trước ' + d.cut + ' (kiểm kê) để ·') : '') : null].filter(Boolean).join(' · '))));
    });
    const add = () => { const l = P.list(); const used = new Set(l.filter(c => c.procs.length === 1).map(c => c.procs[0])); const next = ERP.PROC.map(p => p.id).concat(['ETC']).find(p => procsHere.has(p) && !used.has(p));
      const c = { id: 'p' + Date.now().toString(36), procs: next ? [next] : [], divs: [], rows: 'div', cols: 'month', scope: 'all' }; vs(c.id).edit = true; l.push(c); save(l); };
    wrap.appendChild(h('div', { class: 'fpiv-foot' },
      h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'add', onclick: add }, L('+ 표 추가', '+ Thêm bảng')),
      !list.length ? h('button', { type: 'button', class: 'btn sm', 'data-act': 'reset', onclick: () => save(P.DEFAULT()) }, L('기본 표로 (조립 · 품목군 × 월)', 'Bảng mặc định (lắp ráp · nhóm × tháng)')) : null,
      h('span', { class: 'muted', style: { fontSize: '12px' } }, L('표마다 [설정]에서 공정 · 품목군 · 행 · 열 · 범위를 고릅니다 (엑셀 피벗 표처럼). 칸을 누르면 아래 표가 그 품목으로 바뀝니다.', 'Mỗi bảng: [Cài đặt] chọn công đoạn · nhóm · hàng · cột · phạm vi (như PivotTable Excel). Bấm ô để lọc bảng dưới.'))));
    return wrap;
  };
})();
