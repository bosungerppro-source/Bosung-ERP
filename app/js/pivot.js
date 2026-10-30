/* 1.12.0 (17차): 현장 재고 위 = 피벗 표 — 1.11.4 의 공정별 · 대분류 칸을 대신한다.
   사용자 (2026-10-22, 현장 재고 칸 · 월별 조립 생산량 표 캡처와 함께): "두번째사진 형태로 조립부분만 보여줘. 다른공정들은 커스텀마이징 할수있게 해주고 엑셀 기능의 피벗테이블 처럼"
   1.12.1 (사용자, 같은 날): "현재 재고잖아 월별은 필요없어 현재재고만 보여주면된다" — 월 열을 없앴다. 값은 언제나 현재 재고.
   표 하나 = { id, title, procs(공정 — 비면 모든 공정), divs(품목군 — 비면 모두), rows(행), cols(열), scope(창고+공장 · 창고 · 공장), zero(재고 0 줄도) }
   행: 품목군 · 공정 · 단계 · 품목 / 열: 없음(현재 재고 한 칸) · 공정 · 품목군 · 단계.
   기본 = 조립 · 품목군 | 현재 재고. 표 목록은 설정 `floorPivots` (모든 PC 같은 설정), 설정 열림은 화면 상태. */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, F = ERP.fmt, INV = ERP.inv;
  const EPS = 1e-6; const r4 = (x) => Math.round((+x || 0) * 10000) / 10000;
  const KEY = 'floorPivots';
  const P = ERP.pivot = {};
  P.KEY = KEY;
  P.DEFAULT = () => [{ id: 'asm', procs: ['ASM'], divs: [], rows: 'div', cols: 'none', scope: 'all' }];

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
  const COLS = ['none', 'proc', 'div', 'stage'];
  const colName = (c) => (c === 'none' ? L('없음 (현재 재고 한 칸)', 'Không (một cột tồn hiện tại)') : L(DIMS[c].ko, DIMS[c].vi));
  const dimName = (d) => (d === 'none' ? '' : L(DIMS[d].ko, DIMS[d].vi));
  const SCOPES = () => [['all', L('창고+공장', 'Kho+Xưởng')], ['WH', L('창고', 'Kho')], ['FAC', L('공장', 'Xưởng')]];
  /** 1.12.2 종합 현황 위젯 설정 (⚙) 고르기 */
  P.ROW_OPTS = () => ROWS.map(k => [k, L(DIMS[k].ko, DIMS[k].vi)]);
  P.COL_OPTS = () => COLS.map(k => [k, colName(k)]);

  // ---------------------------------------------------------------- 설정 (표 목록)
  // 1.12.0 에 저장한 열 '월' (cols: 'month') 은 현재 재고 한 칸으로 읽는다
  const clean = (c) => ({ id: String(c.id || ('p' + Date.now().toString(36))), title: c.title ? String(c.title) : undefined,
    procs: Array.isArray(c.procs) ? c.procs.map(String) : [], divs: Array.isArray(c.divs) ? c.divs.map(String) : [],
    rows: ROWS.includes(c.rows) ? c.rows : 'div', cols: COLS.includes(c.cols) && c.cols !== c.rows ? c.cols : 'none',
    scope: ['all', 'WH', 'FAC'].includes(c.scope) ? c.scope : 'all', zero: !!c.zero });
  /** 저장된 표 목록 (없으면 기본: 조립 · 품목군 | 현재 재고). 모두 지우면 빈 목록 */
  P.list = () => { const v = DB.setting(KEY, null); return Array.isArray(v) ? v.map(clean) : P.DEFAULT(); };
  /** 1.12.2: 종합 현황 위젯 설정 { proc ('' = 모든 공정), divs (품목군 — 비면 모두, 1.13.6), rows, cols } → 표 하나 */
  P.fromWidget = (o) => clean({ id: 'w', procs: o.proc ? [String(o.proc)] : [], divs: o.divs, rows: o.rows || 'div', cols: o.cols || 'none', scope: 'all' });
  /** 1.13.6: 위젯 ⚙ 품목군 고르기 — 그 공정('' = 모든 공정) 현장 재고에 있는 품목군 + 이미 고른 것 (표 설정의 품목군과 같은 순서) */
  P.linesOf = (proc, keep) => Array.from(new Set(INV.rows().filter(s => INV.groupOf(s) === 'floor' && (!proc || procOf(s) === proc)).map(s => s.line || '').concat(keep || [])))
    .sort((a, b) => lineOrder(a) - lineOrder(b) || a.localeCompare(b));
  const save = (list) => { DB.setSetting(KEY, list.map(c => { const o = clean(c); if (!o.title) delete o.title; if (!o.zero) delete o.zero; return o; })); ERP.render(); };
  const patch = (id, p) => { const l = P.list(); const c = l.find(x => x.id === id); if (!c) return; Object.assign(c, p); if (c.cols === c.rows) c.cols = 'none'; save(l); };
  P.autoTitle = (c) => (c.procs.length ? c.procs.map(P.procLabel).join(' · ') : L('모든 공정', 'Mọi công đoạn')) + L(' 재고', ' — tồn') + (c.divs.length ? ' (' + c.divs.map(k => INV.lineDivName(k)).join(' · ') + ')' : '');
  const VS = () => (ERP.state.fpiv = ERP.state.fpiv || {});   // 표마다 설정 열림 (저장 안 함)
  const vs = (id) => (VS()[id] = VS()[id] || { edit: false });

  // ---------------------------------------------------------------- 계산 (현재 재고 = 아래 품목 표와 같은 INV.rows)
  const val = (s, scope) => (scope === 'WH' ? s.by.WH : scope === 'FAC' ? s.by.FAC : s.bal);
  const pass = (c) => (s) => (!c.procs.length || c.procs.includes(procOf(s))) && (!c.divs.length || c.divs.includes(s.line || ''));
  /** 피벗 계산: { cols: [{k, label}], rows: [{k, unit, label, title, cells: Map, tot}], tots: [{unit, cells, tot}], units, multi, hasTot } */
  P.build = function (c) {
    const R = DIMS[c.rows]; const D = c.cols === 'none' ? null : DIMS[c.cols];
    const list = INV.rows().filter(s => INV.groupOf(s) === 'floor').filter(pass(c));
    const rowMap = new Map(); const colKeys = new Set();
    list.forEach(s => {
      const v = val(s, c.scope); const unit = s.prim || 'PCS';
      const rk = R.key(s); const ck = D ? D.key(s) : '_'; colKeys.add(ck);
      const key = rk + '\u0001' + unit; let r = rowMap.get(key);
      if (!r) rowMap.set(key, r = { k: rk, unit, cells: new Map(), name: c.rows === 'item' ? (s.name || '') : '' });
      r.cells.set(ck, r4((r.cells.get(ck) || 0) + v));
    });
    let cols = D ? Array.from(colKeys).sort((a, b) => D.order(a) - D.order(b) || String(a).localeCompare(String(b), undefined, { numeric: true })).map(k => ({ k, label: D.label(k) }))
      : [{ k: '_', label: L('현재 재고', 'Tồn hiện tại') }];
    const hasTot = !!D;
    let rows = Array.from(rowMap.values());
    if (!c.zero) {   // 재고 0 인 줄 · (공정 · 품목군 · 단계 열이면) 모두 0 인 열은 숨김
      rows = rows.filter(r => Array.from(r.cells.values()).some(v => Math.abs(v) > EPS));
      if (hasTot) cols = cols.filter(x => rows.some(r => Math.abs(r.cells.get(x.k) || 0) > EPS));
    }
    const units = Array.from(new Set(rows.map(r => r.unit))).sort(); const multi = units.length > 1;   // 단위가 섞이면 줄 · 합계를 단위별로
    rows.forEach(r => { r.label = R.label(r.k) + (multi ? ' · ' + r.unit : ''); r.title = c.rows === 'item' ? r.k + (r.name ? ' · ' + r.name : '') : r.label; r.tot = r4(Array.from(r.cells.values()).reduce((a, v) => a + v, 0)); });
    rows.sort((a, b) => R.order(a.k) - R.order(b.k) || String(a.k).localeCompare(String(b.k), undefined, { numeric: true }) || String(a.unit).localeCompare(String(b.unit)));
    const tots = units.map(u => { const cells = new Map(); rows.filter(r => r.unit === u).forEach(r => r.cells.forEach((v, k) => cells.set(k, r4((cells.get(k) || 0) + v)))); return { unit: u, cells, tot: r4(Array.from(cells.values()).reduce((a, v) => a + v, 0)) }; });
    return { cols, rows, tots, units, multi, hasTot, items: list.length };
  };

  // ---------------------------------------------------------------- 화면
  const isInt = (v) => Math.abs(v - Math.round(v)) < 1e-9;
  const fv = (v, u) => F.n(v, u === 'kg' || !isInt(+v) ? 2 : 0);
  const neg = (v) => (v < -EPS ? { color: '#B3261E', fontWeight: 700 } : null);
  /** 칸을 누르면 현장 재고의 품목 표를 그 공정 · 품목군 · 단계로 (품목 줄은 수불부). 종합 현황 위젯에서 누르면 현장 재고로 간다 */
  function pick(c, rk, ck) {
    if (c.rows === 'item') { ERP.itemDetail(rk); return; }
    const st = ERP.state.stk_floor = ERP.state.stk_floor || { stage: '', line: '', sub: '', cat: '', scope: 'all', status: '', q: '', hideZero: true, sk: 'code', sd: 1, page: 0, ps: 100 };
    st.proc = c.procs.length === 1 ? c.procs[0] : ''; st.line = c.divs.length === 1 ? c.divs[0] : ''; st.stage = ''; st.sub = st.cat = ''; st.page = 0;
    const set = (dim, k) => { if (dim === 'proc') st.proc = k; else if (dim === 'div') st.line = k; else if (dim === 'stage') st.stage = k; };
    set(c.rows, rk); if (ck !== null && ck !== undefined && c.cols !== 'none') set(c.cols, ck);
    ERP.goStock('floor');   // 현장 재고 화면이면 다시 그리기만
    setTimeout(() => { const t = document.querySelector('main [data-anchor="floor-table"]'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 150);
  }
  P.pick = pick;
  /** 표 그리기 (현장 재고 위 · 종합 현황 위젯이 같이 씀). onPick(c, 줄 열쇠, 열 열쇠) — 기본은 pick */
  P.tableEl = (c, d, onPick) => table(c, d, onPick);
  function table(c, d, onPick) {
    const go = onPick || pick;
    const unitHead = d.multi ? null : (d.units[0] || '');
    const head = h('tr', h('th', { title: unitHead ? L('단위 ', 'Đơn vị ') + unitHead : null }, dimName(c.rows) + (c.cols === 'none' ? '' : ' \\ ' + dimName(c.cols))),
      d.hasTot ? h('th', { class: 'num' }, L('합계', 'Tổng')) : null,
      d.cols.map(x => h('th', { class: 'num' }, x.label)));
    const cell = (r, x) => {
      const v = r.cells.get(x.k); if (v === undefined || Math.abs(v) <= EPS) return h('td', { class: 'num pc', onclick: () => go(c, r.k, x.k) }, h('span', { class: 'muted' }, '·'));
      return h('td', { class: 'num pc', style: neg(v), onclick: () => go(c, r.k, x.k), title: r.title + ' · ' + x.label }, fv(v, r.unit));
    };
    const body = d.rows.map(r => h('tr', { 'data-k': r.k, 'data-unit': r.unit },
      h('td', { class: 'pc', title: r.title, onclick: () => go(c, r.k, null) }, h('b', r.label)),
      d.hasTot ? h('td', { class: 'num', style: neg(r.tot) || { fontWeight: 700 } }, fv(r.tot, r.unit)) : null,
      d.cols.map(x => cell(r, x))));
    const foot = d.tots.map(t => h('tr', { class: 'tot', 'data-unit': t.unit }, h('td', L('합계', 'Tổng') + (d.multi ? ' · ' + t.unit : '')),
      d.hasTot ? h('td', { class: 'num' }, fv(t.tot, t.unit)) : null,
      d.cols.map(x => h('td', { class: 'num' }, Math.abs(t.cells.get(x.k) || 0) > EPS ? fv(t.cells.get(x.k), t.unit) : '·'))));
    // 현재 재고 한 칸이면 표를 좁게 (숫자가 이름 옆에 붙어 보이게)
    return h('div', { class: 'tbl-wrap' + (d.hasTot ? '' : ' one'), style: { maxHeight: c.rows === 'item' ? '420px' : null } },
      h('table', { class: 'tbl dt fpiv-t' + (d.hasTot ? '' : ' nostick2 one') + (d.multi || c.rows === 'item' || c.rows === 'stage' ? ' wide1' : ''), 'data-rows': c.rows, 'data-cols': c.cols }, h('thead', head), h('tbody', body, foot)));
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
    const hdr = [dimName(c.rows)].concat(d.hasTot ? [L('합계', 'Tổng')] : [], d.cols.map(x => x.label));
    const line = (label, cells, tot) => [label].concat(d.hasTot ? [tot] : [], d.cols.map(x => (cells.get(x.k) === undefined ? 0 : cells.get(x.k))));
    ERP.xl.exportAoa('floor_pivot', hdr, d.rows.map(r => line(c.rows === 'item' ? r.title : r.label, r.cells, r.tot)).concat(d.tots.map(t => line(L('합계', 'Tổng') + (d.multi ? ' · ' + t.unit : ''), t.cells, t.tot))));
    ERP.toast(title + L(' — 엑셀로 저장', ' — đã xuất Excel'), 'ok');
  }
  // ---------------------------------------------------------------- 1.13.9 원재료 환산
  // 사용자 (2026-10-26, 현장 재고 '조립 재고' 표 사진과 함께): "현장재고를 원재료로 환산했을때 원재료별로 얼마인지 조립재고 오른쪽에 표시해서 볼수있게 해줘"
  // — 현장 재고 (창고+공장 현재 재고, 모든 공정) 를 BOM 으로 원료 (RM) 까지 푼 양. MRP 소요량과 같은 계산 (ERP.mrp — 재고를 빼지 않는 총량 gross), 공정마다 따로 풀어 칸으로
  /** { cols: [{k, label}] (원료가 나온 공정), rows: [{k 원료 코드, name, unit, cells: Map 공정 → 양, tot}] (많은 순), tots (단위별 합계), units, items, miss (BOM 없는 품목 수) } */
  P.rawBuild = function () {
    const items = INV.rows().filter(s => INV.groupOf(s) === 'floor' && s.bal > EPS);
    const byProc = new Map(); items.forEach(s => { const p = procOf(s); let a = byProc.get(p); if (!a) byProc.set(p, a = []); a.push(s); });
    const map = new Map(); const procs = []; let miss = 0;
    Array.from(byProc.keys()).sort((a, b) => procOrder(a) - procOrder(b)).forEach(p => {
      // 1.13.18: 재고 수량은 품목 단위 그대로 (ea) — MRP 의 set · pcs 는 카톤 BOM 의 세트 · 색연필 수로 바꾸므로 (세트 재고 10 set 을 색연필 10 개로 보면 안 됨)
      const res = ERP.mrp ? ERP.mrp(byProc.get(p).map(s => ({ code: s.code, qty: s.bal, unit: 'ea' })), { gross: true }) : { rows: [], info: [] };
      let any = false;
      res.rows.forEach(r => { if (r.kind !== 'raw' || !(r.need > EPS)) return; any = true; let x = map.get(r.code); if (!x) map.set(r.code, x = { k: r.code, name: r.name || '', unit: r.unit || 'kg', cells: new Map(), tot: 0 }); x.cells.set(p, r4((x.cells.get(p) || 0) + r.need)); x.tot = r4(x.tot + r.need); });
      if (any) procs.push(p);
      miss += res.info.filter(i => i.route === 'unknown').length;
    });
    const rows = Array.from(map.values()).sort((a, b) => b.tot - a.tot || String(a.k).localeCompare(String(b.k)));
    const units = Array.from(new Set(rows.map(r => r.unit))).sort();
    const tots = units.map(u => { const cells = new Map(); rows.filter(r => r.unit === u).forEach(r => r.cells.forEach((v, k) => cells.set(k, r4((cells.get(k) || 0) + v)))); return { unit: u, cells, tot: r4(Array.from(cells.values()).reduce((a, v) => a + v, 0)) }; });
    return { cols: procs.map(k => ({ k, label: P.procLabel(k) })), rows, tots, units, items: items.length, miss };
  };
  /** 원재료 환산 표 (현장 재고 위 · 종합 현황 위젯이 같이 씀) */
  P.rawTableEl = function (d) {
    const multi = d.units.length > 1; const cell = (v, u) => (v === undefined || Math.abs(v) <= EPS ? h('span', { class: 'muted' }, '·') : fv(v, u));
    const head = h('tr', h('th', L('원재료', 'Nguyên liệu')), h('th', { class: 'num' }, L('합계', 'Tổng')), d.cols.map(x => h('th', { class: 'num' }, x.label)));
    const body = d.rows.map(r => h('tr', { 'data-k': r.k }, h('td', { title: r.k + (r.name ? ' · ' + r.name : '') + ' (' + r.unit + ')' }, h('b', r.k), r.name ? ' ' + r.name : ''),
      h('td', { class: 'num', style: { fontWeight: 700 } }, fv(r.tot, r.unit)), d.cols.map(x => h('td', { class: 'num' }, cell(r.cells.get(x.k), r.unit)))));
    const foot = d.tots.map(t => h('tr', { class: 'tot' }, h('td', L('합계', 'Tổng') + (multi ? ' · ' + t.unit : '')), h('td', { class: 'num' }, fv(t.tot, t.unit)), d.cols.map(x => h('td', { class: 'num' }, cell(t.cells.get(x.k), t.unit)))));
    return h('div', { class: 'tbl-wrap', style: { maxHeight: '420px' } }, h('table', { class: 'tbl dt wide1 fraw-t' }, h('thead', head), h('tbody', body, foot)));
  };
  P.rawNote = (d) => [L('현재 재고 (창고+공장) 를 BOM 으로 원료까지 푼 양 — MRP 소요량과 같은 계산', 'Tồn hiện tại (kho+xưởng) quy về nguyên liệu theo BOM — như nhu cầu MRP'), d.units.length === 1 ? L('단위 ', 'Đơn vị ') + d.units[0] : null,
    d.miss ? L('환산 못 한 품목: BOM 없음 ' + d.miss + '개', 'Chưa quy đổi: không có BOM ' + d.miss + ' mã') : null].filter(Boolean).join(' · ');
  P.rawExport = function (d) {
    ERP.xl.exportAoa('floor_raw', [L('원재료', 'Nguyên liệu'), L('이름', 'Tên'), L('단위', 'Đơn vị'), L('합계', 'Tổng')].concat(d.cols.map(x => x.label)),
      d.rows.map(r => [r.k, r.name, r.unit, r.tot].concat(d.cols.map(x => r.cells.get(x.k) || 0))).concat(d.tots.map(t => [L('합계', 'Tổng'), '', t.unit, t.tot].concat(d.cols.map(x => t.cells.get(x.k) || 0)))));
    ERP.toast(L('원재료 환산 — 엑셀로 저장', 'Quy đổi nguyên liệu — đã xuất Excel'), 'ok');
  };
  function rawCard() {
    const d = P.rawBuild();
    return h('section', { class: 'card wcard fraw-card', 'data-id': 'raw' },
      h('div', { class: 'card-head' }, h('h2', L('원재료 환산 (현장 재고)', 'Quy đổi nguyên liệu (tồn hiện trường)')),
        h('div', { class: 'whead-r' }, h('button', { type: 'button', class: 'btn sm', 'data-act': 'xl', disabled: !d.rows.length, onclick: () => P.rawExport(d) }, L('엑셀', 'Excel')))),
      d.rows.length ? P.rawTableEl(d) : h('div', { class: 'empty' }, L('BOM 으로 원료까지 풀 수 있는 현장 재고가 없습니다.', 'Không có tồn hiện trường quy đổi được theo BOM.')),
      h('p', { class: 'help', style: { margin: '8px 0 0' } }, P.rawNote(d)));
  }

  /** 현장 재고 위 영역: 표 목록 + [+ 표 추가] (p_stock.js stockTab 이 부름) */
  ERP.floorPivot = function (all) {
    const list = P.list(); const procsHere = new Set(all.map(procOf)); const linesHere = new Set(all.map(s => s.line || ''));
    const wrap = h('div', { class: 'fpiv' });
    list.forEach((c, i) => {
      const V = vs(c.id); const d = P.build(c); const title = c.title || P.autoTitle(c);
      const right = h('div', { class: 'whead-r' },
        h('button', { type: 'button', class: 'btn sm' + (V.edit ? ' primary' : ''), 'data-act': 'edit', onclick: () => { V.edit = !V.edit; ERP.render(); } }, L('설정', 'Cài đặt')),
        h('button', { type: 'button', class: 'btn sm', 'data-act': 'xl', disabled: !d.rows.length, onclick: () => exportXl(c, d, title) }, L('엑셀', 'Excel')));
      const note = [d.units.length === 1 ? L('단위 ', 'Đơn vị ') + d.units[0] : null, c.scope !== 'all' ? L('범위 ', 'Phạm vi ') + SCOPES().find(x => x[0] === c.scope)[1] : null].filter(Boolean).join(' · ');
      const body = d.rows.length ? table(c, d) : h('div', { class: 'empty' }, L('조건에 맞는 재고가 없습니다. 설정에서 공정 · 품목군을 바꿔 보세요.', 'Không có tồn phù hợp. Đổi công đoạn · nhóm trong Cài đặt.'));
      // 현재 재고 한 칸 표는 좁은 카드 (여러 공정 표가 옆으로 나란히), 설정을 열면 넓게
      wrap.appendChild(h('section', { class: 'card wcard fpiv-card' + (!d.hasTot && !V.edit ? ' narrow' : ''), 'data-id': c.id },
        h('div', { class: 'card-head' }, h('h2', title), right),
        V.edit ? editor(c, i, list.length, procsHere, linesHere) : null, body,
        note ? h('p', { class: 'help', style: { margin: '8px 0 0' } }, note) : null));
    });
    wrap.appendChild(rawCard());   // 1.13.9: 표들 오른쪽 (기본 = 조립 재고 표 하나 → 바로 오른쪽) 에 원재료 환산 — 좁은 표들이 나란히 선 줄은 그대로
    const add = () => { const l = P.list(); const used = new Set(l.filter(c => c.procs.length === 1).map(c => c.procs[0])); const next = ERP.PROC.map(p => p.id).concat(['ETC']).find(p => procsHere.has(p) && !used.has(p));
      const c = { id: 'p' + Date.now().toString(36), procs: next ? [next] : [], divs: [], rows: 'div', cols: 'none', scope: 'all' }; vs(c.id).edit = true; l.push(c); save(l); };
    wrap.appendChild(h('div', { class: 'fpiv-foot' },
      h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'add', onclick: add }, L('+ 표 추가', '+ Thêm bảng')),
      !list.length ? h('button', { type: 'button', class: 'btn sm', 'data-act': 'reset', onclick: () => save(P.DEFAULT()) }, L('기본 표로 (조립 · 품목군)', 'Bảng mặc định (lắp ráp · nhóm)')) : null,
      h('span', { class: 'muted', style: { fontSize: '12px' } }, L('모두 현재 재고입니다. 표마다 [설정]에서 공정 · 품목군 · 행 · 열 · 범위를 고릅니다 (엑셀 피벗 표처럼). 칸을 누르면 아래 표가 그 품목으로 바뀝니다.', 'Tất cả là tồn hiện tại. Mỗi bảng: [Cài đặt] chọn công đoạn · nhóm · hàng · cột · phạm vi (như PivotTable Excel). Bấm ô để lọc bảng dưới.'))));
    return wrap;
  };
})();
