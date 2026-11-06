/* 1.15.0 (20차): 현장 재고 위 = 공정 카드 — 공정마다 따로, 공정끼리 · 구분끼리 · 단위끼리는 더하지 않는다
   사용자 (2026-11-06): "현장재고에 보이는게 이상하다. 공정체크하니까 중복으로 보여지는데 사출현장재고따로 리필성형 현장재고 따로 조립현장재고 따로 포장 현장재고 따로 이렇게 보이게 해야한다."
     · "완전히 잘못만들어놨다 지금" · "erp전문가가 보기에 어떻게 만들어야겠어? 프롬포트 먼저 만들어바" → "네, 이대로" · "이카운터에서 가져온 erp코드는 무시하고 너가 만들어"
   17차 (1.12.0) 피벗 표는 공정을 여러 개 고르면 품목군 한 칸에 더했다 (조립품 + 심 + 사출 부품) — 그 설계를 버렸다.
   카드 = 공정 하나 (사출 · 리필 성형 · 조립 · 종이 권취 · 포장 + 분류 안 됨). 공정 · 구분 · 품목군 = INV.floorClass (ERP CODE 를 쓰지 않음).
     사출      = 구분 줄 (배럴 · 노즈콘 · 홀더 · 스푼 · 그 밖의 부품) × 품목군 칸, 줄마다 합계 (맨 아래 합계 없음)
     리필 · 권취 = 품목군 줄, 맨 아래 합계 (구분이 하나)
     조립 · 포장 = 품목군 줄 × 구분 칸 (조립품 · 조립 중간품 / 세트 · 박스 — 단위마다 칸), 칸마다 맨 아래 합계 (칸끼리는 안 더함)
     분류 안 됨 = 품목 줄 (합계 없음) — 품목 기준 정보의 '생산 공정' 으로 정하면 그 공정 카드로 간다
   사출 일보의 묶음 이름 (Barrel · Holder …) 품목은 생산 입고를 일보 줄의 품목군 칸으로 나눈다 (INV.floorSplit).
   카드 설정 (모든 PC 같음) `floorCards` = { 공정: { rows: 'std' | 'item', divs: [품목군], scope: 'all' | 'WH' | 'FAC', zero, hidden } }.
   예전 설정 `floorPivots` 는 지우지 않는다 (아직 업데이트 안 한 PC 가 읽음) — floorCards 가 없을 때 품목군 · 범위 · 0 줄만 그 공정 카드에 쓴다. */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, F = ERP.fmt, INV = ERP.inv;
  const EPS = 1e-6; const r4 = (x) => Math.round((+x || 0) * 10000) / 10000;
  const KEY = 'floorCards', OLD = 'floorPivots';
  const P = ERP.pivot = {};
  P.KEY = KEY; P.OLD_KEY = OLD; P.NONE = 'NONE';
  const PROCS = () => ERP.PROC.map(p => p.id);
  P.procs = () => PROCS().concat([P.NONE]);
  P.procLabel = (k) => (!k || k === P.NONE ? L('분류 안 됨', 'Chưa phân loại') : ERP.procName(k));
  const procOrder = (k) => { const i = P.procs().indexOf(k); return i < 0 ? 99 : i; };
  const lineOrder = (k) => { const i = INV.LINE_ORDER.indexOf(k); return i < 0 ? (k ? 50 : 99) : i; };
  const kindOrder = (k) => { const i = INV.FLOOR_KINDS.findIndex(x => x.k === k); return i < 0 ? 99 : i; };
  P.lineName = (k) => (k ? INV.lineDivName(k) : L('품목군 미지정', 'Chưa có nhóm'));
  const cls = (s) => INV.floorClassOf(s.code);
  P.procOf = (s) => cls(s).proc || P.NONE;
  const LAYOUT = { INJ: { rows: 'kind', cols: 'line' }, REF: { rows: 'line', cols: 'none' }, WRP: { rows: 'line', cols: 'none' }, ASM: { rows: 'line', cols: 'kind' }, PCK: { rows: 'line', cols: 'kind' } };
  const layOf = (p) => LAYOUT[p] || { rows: 'item', cols: 'none' };
  const SCOPES = () => [['all', L('창고+공장', 'Kho+Xưởng')], ['WH', L('창고', 'Kho')], ['FAC', L('공장', 'Xưởng')]];
  const scopeName = (k) => (SCOPES().find(x => x[0] === k) || [k, k])[1];

  // ---------------------------------------------------------------- 설정
  const cleanCfg = (c) => ({ rows: c && c.rows === 'item' ? 'item' : 'std', divs: Array.isArray(c && c.divs) ? c.divs.map(String) : [],
    scope: ['all', 'WH', 'FAC'].includes(c && c.scope) ? c.scope : 'all', zero: !!(c && c.zero), hidden: !!(c && c.hidden) });
  P.cleanCfg = cleanCfg;
  /** 공정 → 카드 설정. floorCards 가 없으면 예전 floorPivots 표의 품목군 · 범위 · 0 줄 (처음 나오는 표가 이김, 공정 '전체' 표는 모든 공정) */
  P.cards = function () {
    const v = DB.setting(KEY, null); const out = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) { P.procs().forEach(p => { out[p] = cleanCfg(v[p]); }); return out; }
    P.procs().forEach(p => { out[p] = cleanCfg(null); });
    const old = DB.setting(OLD, null); const seen = new Set();
    if (Array.isArray(old)) old.forEach(t => { if (!t || typeof t !== 'object') return; const ps = Array.isArray(t.procs) && t.procs.length ? t.procs.map(String) : PROCS();
      ps.forEach(p => { if (!out[p] || seen.has(p)) return; seen.add(p); out[p] = cleanCfg({ divs: t.divs, scope: t.scope, zero: t.zero }); }); });
    return out;
  };
  const saveCards = (all) => { const o = {};
    P.procs().forEach(p => { const c = cleanCfg(all[p]); const x = {}; if (c.rows !== 'std') x.rows = c.rows; if (c.divs.length) x.divs = c.divs; if (c.scope !== 'all') x.scope = c.scope; if (c.zero) x.zero = true; if (c.hidden) x.hidden = true; o[p] = x; });
    DB.setSetting(KEY, o); ERP.render(); };
  const patch = (p, x) => { const all = P.cards(); all[p] = Object.assign(all[p], x); saveCards(all); };
  const VS = () => (ERP.state.fpiv = ERP.state.fpiv || {});   // 카드마다 설정 열림 (저장 안 함)
  const vs = (id) => (VS()[id] = VS()[id] || { edit: false });

  // ---------------------------------------------------------------- 계산 (현재 재고 = 아래 품목 표와 같은 INV.rows)
  const val = (s, scope) => (scope === 'WH' ? s.by.WH : scope === 'FAC' ? s.by.FAC : s.bal);
  const floorRows = () => INV.rows().filter(s => INV.groupOf(s) === 'floor');
  /** 품목 하나의 품목군별 몫 [[품목군, 값, 흐름 {open, prod, use, oth} (범위 창고+공장일 때)]] — 묶음 이름 품목은 생산 입고를 일보 품목군으로, 나머지는 '미지정' */
  function parts(s, scope) {
    const c = cls(s); const v = val(s, scope); const oth = r4((s.in || 0) - (s.out || 0) + (s.adj || 0));
    const flow = scope === 'all' ? { open: s.openTot || 0, prod: s.prod || 0, use: s.use || 0, oth } : null;
    if (!c.multi || scope === 'WH') return [[c.multi ? '' : (c.line || ''), v, flow]];
    const m = INV.floorSplit().get(s.code) || new Map(); const out = []; let used = 0;
    m.forEach((q, ln) => { if (Math.abs(q) <= EPS) return; out.push([ln, q, flow ? { open: 0, prod: q, use: 0, oth: 0 } : null]); used = r4(used + q); });
    const rest = r4(v - used); if (Math.abs(rest) > EPS || !out.length) out.push(['', rest, flow ? { open: flow.open, prod: r4(flow.prod - used), use: flow.use, oth } : null]);
    return out;
  }
  P.parts = parts;
  /** 이 품목이 그 품목군 몫을 가졌나 (아래 품목 표 거르기) */
  P.hasLine = (s, ln) => parts(s, 'all').some(x => x[0] === ln);
  const lastLog = () => DB.memo('pivot.lastLog', ['prod_log'], () => { const m = {}; DB.rows('prod_log').forEach(r => { if (r && r.process && r.date && (!m[r.process] || r.date > m[r.process])) m[r.process] = r.date; }); return m; });
  /** 카드 계산: { proc, lay, itemMode, cols, rows, rowTot, tots, units, items, neg, kinds } */
  P.buildCard = function (proc, cfg) {
    cfg = cleanCfg(cfg); const lay = layOf(proc); const itemMode = cfg.rows === 'item' || lay.rows === 'item';
    const list = floorRows().filter(s => P.procOf(s) === proc);
    const rowMap = new Map(), colMap = new Map(); let items = 0, neg = 0; const kinds = new Set();
    const addCell = (r, ck, v, fl) => { let x = r.cells.get(ck); if (!x) r.cells.set(ck, x = { v: 0, open: 0, prod: 0, use: 0, oth: 0, flow: true });
      x.v = r4(x.v + v); if (fl) { x.open = r4(x.open + fl.open); x.prod = r4(x.prod + fl.prod); x.use = r4(x.use + fl.use); x.oth = r4(x.oth + fl.oth); } else x.flow = false; };
    list.forEach(s => {
      const c = cls(s); const unit = s.prim || 'PCS'; let any = false;
      if (val(s, cfg.scope) < -EPS) neg++;
      parts(s, cfg.scope).forEach(([ln, v, fl]) => {
        if (cfg.divs.length && !cfg.divs.includes(ln)) return;
        any = true; kinds.add(c.kind);
        let rk, ck, rowUnit, col;
        if (itemMode) { rk = s.code; ck = '_'; rowUnit = unit; col = { k: '_' }; }
        else {
          rk = lay.rows === 'kind' ? c.kind : ln;
          if (lay.cols === 'line') { ck = ln; col = { k: ck, lineKey: ln }; rowUnit = unit; }
          else if (lay.cols === 'kind') { ck = c.kind + '\u0001' + unit; col = { k: ck, kind: c.kind, unit }; rowUnit = ''; }
          else { ck = '_'; col = { k: '_' }; rowUnit = unit; }
        }
        const key = rk + '\u0001' + rowUnit; let r = rowMap.get(key);
        if (!r) rowMap.set(key, r = { k: rk, unit: rowUnit, cells: new Map(), item: itemMode, name: itemMode ? (s.name || '') : '',
          kind: itemMode ? c.kind : (lay.rows === 'kind' ? c.kind : undefined), lineKey: !itemMode && lay.rows === 'line' ? ln : undefined, multi: itemMode && c.multi, line: itemMode ? c.line : undefined });
        if (!colMap.has(ck)) colMap.set(ck, col);
        addCell(r, ck, v, fl);
      });
      if (any) items++;
    });
    let cols = Array.from(colMap.values());
    if (!itemMode && lay.cols === 'line') cols.sort((a, b) => lineOrder(a.lineKey) - lineOrder(b.lineKey) || String(a.lineKey).localeCompare(String(b.lineKey)));
    else if (!itemMode && lay.cols === 'kind') cols.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || String(a.unit).localeCompare(String(b.unit)));
    let rows = Array.from(rowMap.values());
    if (!cfg.zero) {   // 재고 0 인 줄 · (칸이 여럿이면) 모두 0 인 칸은 숨김
      rows = rows.filter(r => Array.from(r.cells.values()).some(x => Math.abs(x.v) > EPS));
      if (cols.length > 1) cols = cols.filter(x => rows.some(r => Math.abs((r.cells.get(x.k) || { v: 0 }).v) > EPS));
    }
    const units = Array.from(new Set(rows.map(r => r.unit).concat(cols.map(x => x.unit)).filter(Boolean))).sort();
    const multiUnit = units.length > 1;
    const colUnits = new Set(cols.map(x => x.unit).filter(Boolean));
    cols.forEach(x => { x.label = x.k === '_' ? L('현재 재고', 'Tồn hiện tại') : x.lineKey !== undefined ? P.lineName(x.lineKey) : INV.floorKindName(x.kind) + (colUnits.size > 1 || (x.kind === 'BOX' || x.kind === 'SET') ? ' (' + x.unit + ')' : ''); });
    rows.forEach(r => {
      const base = itemMode ? r.k : r.kind !== undefined ? INV.floorKindName(r.kind) : P.lineName(r.lineKey);
      r.label = base + (multiUnit && r.unit ? ' · ' + r.unit : '');
      r.title = itemMode ? r.k + (r.name ? ' · ' + r.name : '') + (r.kind ? ' · ' + INV.floorKindName(r.kind) : '') + ' · ' + (r.multi ? L('일보 품목군별', 'theo nhóm báo cáo') : P.lineName(r.line)) : r.label;
      r.tot = r4(Array.from(r.cells.values()).reduce((a, x) => a + x.v, 0));
    });
    const rOrd = (r) => (itemMode ? 0 : r.kind !== undefined ? kindOrder(r.kind) : lineOrder(r.lineKey));
    rows.sort((a, b) => rOrd(a) - rOrd(b) || String(a.k).localeCompare(String(b.k), undefined, { numeric: true }) || String(a.unit).localeCompare(String(b.unit)));
    // 합계: 같은 구분 · 같은 단위 안에서만
    const rowTot = !itemMode && lay.rows === 'kind' && cols.length > 1;
    const sameKind = kinds.size === 1 && proc !== P.NONE;
    const bottom = !itemMode ? (lay.cols === 'kind' || (lay.cols === 'none' && sameKind)) : sameKind;
    let tots = [];
    if (bottom && rows.length) {
      if (lay.cols === 'kind' && !itemMode) { const cells = new Map(); rows.forEach(r => r.cells.forEach((x, k) => cells.set(k, r4((cells.get(k) || 0) + x.v)))); tots = [{ unit: '', label: L('합계', 'Tổng'), cells }]; }
      else { const us = Array.from(new Set(rows.map(r => r.unit))).sort(); tots = us.map(u => { const cells = new Map(); rows.filter(r => r.unit === u).forEach(r => r.cells.forEach((x, k) => cells.set(k, r4((cells.get(k) || 0) + x.v)))); return { unit: u, label: L('합계', 'Tổng') + (us.length > 1 ? ' · ' + u : ''), cells }; }); }
    }
    const firstHead = itemMode ? L('품목', 'Mã hàng') : lay.rows === 'kind' ? L('구분', 'Loại') + (cols.length > 1 ? ' \\ ' + L('품목군', 'Nhóm') : '') : L('품목군', 'Nhóm') + (lay.cols === 'kind' && cols.length > 1 ? ' \\ ' + L('구분', 'Loại') : '');
    return { proc, lay, itemMode, cols, rows, rowTot, tots, units, items, neg, kinds: Array.from(kinds), firstHead, scope: cfg.scope, lastLog: proc === P.NONE ? '' : (lastLog()[proc] || ''), count: INV.openDates().FLOOR || '' };
  };

  // ---------------------------------------------------------------- 경고 (생산 반영 진단)
  const diagByProc = () => { const d = INV.prodPost().diag; const out = {}; const o = (p) => (out[p] = out[p] || { notItemRows: 0, notItemQty: 0, noBom: 0, noConv: 0 });
    (d.notItem || new Map()).forEach((x, k) => { const p = String(k).split('|')[0] || P.NONE; o(p).notItemRows += x.n; o(p).notItemQty = r4(o(p).notItemQty + x.qty); });
    (d.noBom || new Map()).forEach((x, code) => { o(INV.floorClassOf(code).proc || P.NONE).noBom++; });
    (d.noConv || new Map()).forEach((x, code) => { o(INV.floorClassOf(code).proc || P.NONE).noConv++; });
    return { by: out, missingPart: d.missingPart ? d.missingPart.size : 0 }; };
  P.diag = diagByProc;
  function warnEl(p, d, dg) {
    const goNeg = () => { const st = stState(); Object.assign(st, { proc: p, kind: '', fline: '', stage: '', line: '', sub: '', cat: '', status: 'neg', page: 0 }); ERP.goStock('floor'); scrollTable(); };
    const goPost = () => ERP.goStock('post');
    const chip = (tone, label, fn, act) => h('button', { type: 'button', class: 'fpiv-w', 'data-w': act, onclick: fn }, ERP.chip(tone, label));
    const list = [d.neg ? chip('bad', L('마이너스 ', 'Âm ') + F.n(d.neg) + L('품목', ' mã'), goNeg, 'neg') : null,
      dg && dg.notItemRows ? chip('warn', L('못 넣은 일보 ', 'Báo cáo chưa nhập ') + F.n(dg.notItemRows) + L('줄', ' dòng'), goPost, 'notItem') : null,
      dg && dg.noBom ? chip('warn', L('BOM 없는 생산 ', 'SX không có BOM ') + F.n(dg.noBom) + L('품목', ' mã'), goPost, 'noBom') : null,
      dg && dg.noConv ? chip('warn', L('단위를 못 바꿈 ', 'Không đổi được đơn vị ') + F.n(dg.noConv) + L('품목', ' mã'), goPost, 'noConv') : null].filter(Boolean);
    return list.length ? h('div', { class: 'fpiv-warns' }, list) : null;
  }

  // ---------------------------------------------------------------- 화면
  const isInt = (v) => Math.abs(v - Math.round(v)) < 1e-9;
  const fv = (v, u) => F.n(v, u === 'kg' || !isInt(+v) ? 2 : 0);
  const neg = (v) => (v < -EPS ? { color: '#B3261E', fontWeight: 700 } : null);
  const stState = () => (ERP.state.stk_floor = ERP.state.stk_floor || { stage: '', line: '', sub: '', cat: '', scope: 'all', status: '', q: '', hideZero: true, sk: 'code', sd: 1, page: 0, ps: 100 });
  const scrollTable = () => setTimeout(() => { const t = document.querySelector('main [data-anchor="floor-table"]'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 150);
  /** 칸을 누르면 아래 품목 표를 그 공정 · 구분 · 품목군으로 (품목 줄은 수불부). 종합 현황 위젯에서 누르면 현장 재고로 간다 */
  function pick(proc, r, x) {
    if (r && r.item) { ERP.itemDetail(r.k); return; }
    const st = stState(); Object.assign(st, { proc, kind: '', fline: '', stage: '', line: '', sub: '', cat: '', status: '', page: 0 });
    [r, x].forEach(o => { if (!o) return; if (o.kind) st.kind = o.kind; if (o.lineKey !== undefined) st.fline = o.lineKey === '' ? '~' : o.lineKey; });
    ERP.goStock('floor'); scrollTable();
  }
  P.pick = pick;
  const cellTip = (r, x, c) => { const head = [r.title, x.k === '_' ? '' : x.label].filter(Boolean).join(' · '); if (!c || !c.flow) return head; const u = r.unit || x.unit;
    return head + '\n' + L('실사 ', 'Kiểm kê ') + fv(c.open, u) + ' + ' + L('생산 ', 'SX ') + fv(c.prod, u) + ' − ' + L('사용 ', 'Dùng ') + fv(c.use, u) + ' ± ' + L('기타 ', 'Khác ') + fv(c.oth, u) + ' = ' + fv(c.v, u); };
  /** 카드 표 (현장 재고 위 · 종합 현황 위젯이 같이 씀). onPick(proc, 줄, 칸) — 기본은 pick */
  P.tableEl = function (d, onPick) {
    const go = onPick || pick; const wide = d.cols.length > 1 || d.rowTot;
    const head = h('tr', h('th', { title: d.units.length === 1 ? L('단위 ', 'Đơn vị ') + d.units[0] : null }, d.firstHead), d.rowTot ? h('th', { class: 'num' }, L('합계', 'Tổng')) : null, d.cols.map(x => h('th', { class: 'num' }, x.label)));
    const cell = (r, x) => { const c = r.cells.get(x.k); const v = c ? c.v : 0;
      if (!c || Math.abs(v) <= EPS) return h('td', { class: 'num pc', onclick: () => go(d.proc, r, x) }, h('span', { class: 'muted' }, '·'));
      return h('td', { class: 'num pc', style: neg(v), title: cellTip(r, x, c), onclick: () => go(d.proc, r, x) }, fv(v, r.unit || x.unit)); };
    const body = d.rows.map(r => h('tr', { 'data-k': r.k, 'data-unit': r.unit },
      h('td', { class: 'pc', title: r.title, onclick: () => go(d.proc, r, null) }, h('b', r.label)),
      d.rowTot ? h('td', { class: 'num', style: neg(r.tot) || { fontWeight: 700 } }, fv(r.tot, r.unit)) : null,
      d.cols.map(x => cell(r, x))));
    const foot = d.tots.map(t => h('tr', { class: 'tot', 'data-unit': t.unit }, h('td', t.label), d.rowTot ? h('td', { class: 'num' }, '') : null,
      d.cols.map(x => { const v = t.cells.get(x.k); return h('td', { class: 'num', style: neg(v || 0) }, v !== undefined && Math.abs(v) > EPS ? fv(v, t.unit || x.unit) : '·'); })));
    return h('div', { class: 'tbl-wrap' + (wide ? '' : ' one'), style: { maxHeight: d.itemMode ? '420px' : null } },
      h('table', { class: 'tbl dt fpiv-t' + (wide ? '' : ' nostick2 one') + (d.itemMode || d.units.length > 1 ? ' wide1' : ''), 'data-proc': d.proc, 'data-rows': d.itemMode ? 'item' : d.lay.rows, 'data-cols': d.itemMode ? 'none' : d.lay.cols }, h('thead', head), h('tbody', body, foot)));
  };
  P.title = (p) => (p === P.NONE ? L('분류 안 된 품목', 'Mã chưa phân loại') : P.procLabel(p) + L(' 재고', ' — tồn'));
  const stdName = (p) => { const l = layOf(p); return l.rows === 'kind' ? L('구분 × 품목군', 'Loại × nhóm') : l.cols === 'kind' ? L('품목군 × 구분', 'Nhóm × loại') : L('품목군', 'Nhóm'); };
  /** 이 공정 현장 재고에 있는 품목군 (+ 이미 고른 것) — 카드 설정 · 위젯 ⚙ */
  P.linesOf = (proc, keep) => { const set = new Set(keep || []); floorRows().filter(s => !proc || P.procOf(s) === proc).forEach(s => { if (Math.abs(s.bal) > EPS || s.n > 0) parts(s, 'all').forEach(x => set.add(x[0])); });
    return Array.from(set).sort((a, b) => lineOrder(a) - lineOrder(b) || String(a).localeCompare(String(b))); };
  function editor(p, cfg) {
    const chk = (on, label, fn, attrs) => h('label', Object.assign({ class: 'fpiv-chk' + (on ? ' on' : '') }, attrs || {}), h('input', { type: 'checkbox', checked: on, onchange: (e) => fn(e.target.checked) }), ' ', label);
    const toggle = (arr, k, on) => { const a = arr.filter(x => x !== k); if (on) a.push(k); return a; };
    const sel = (k, opts, cur) => h('select', { class: 'inp', 'data-k': k, onchange: (e) => patch(p, { [k]: e.target.value }) }, opts.map(o => h('option', { value: o[0], selected: cur === o[0] }, o[1])));
    const lines = P.linesOf(p, cfg.divs);
    return h('div', { class: 'fpiv-edit' },
      p === P.NONE ? null : h('div', { class: 'fpiv-row' }, h('label', h('b', L('줄', 'Hàng')), ' ', sel('rows', [['std', stdName(p)], ['item', L('품목 (색) 까지', 'Đến từng mã (màu)')]], cfg.rows))),
      h('div', { class: 'fpiv-row' }, h('b', L('품목군', 'Nhóm')), chk(!cfg.divs.length, L('전체', 'Tất cả'), (on) => patch(p, { divs: on ? [] : lines.slice(0, 1) }), { 'data-div': '*' }),
        lines.map(k => chk(cfg.divs.includes(k), P.lineName(k), (on) => patch(p, { divs: toggle(cfg.divs, k, on) }), { 'data-div': k }))),
      h('div', { class: 'fpiv-row' }, h('label', h('b', L('범위', 'Phạm vi')), ' ', sel('scope', SCOPES(), cfg.scope)),
        chk(cfg.zero, L('재고 0인 줄도 보기', 'Hiện cả dòng tồn 0'), (on) => patch(p, { zero: on })), h('span', { class: 'sp' }),
        h('button', { type: 'button', class: 'btn sm', 'data-act': 'hide', onclick: () => { vs(p).edit = false; patch(p, { hidden: true }); } }, L('카드 숨기기', 'Ẩn thẻ')),
        h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'done', onclick: () => { vs(p).edit = false; ERP.render(); } }, L('완료', 'Xong'))));
  }
  function cardEl(p, d, cfg, dg) {
    const V = vs(p); const wide = d.cols.length > 1 || d.rowTot;
    const right = h('div', { class: 'whead-r' }, h('button', { type: 'button', class: 'btn sm' + (V.edit ? ' primary' : ''), 'data-act': 'edit', onclick: () => { V.edit = !V.edit; ERP.render(); } }, L('설정', 'Cài đặt')));
    const info = [d.units.length ? L('단위 ', 'Đơn vị ') + d.units.join(' · ') : null, cfg.scope !== 'all' ? L('범위 ', 'Phạm vi ') + scopeName(cfg.scope) : null,
      cfg.divs.length ? L('품목군 ', 'Nhóm ') + cfg.divs.map(P.lineName).join(' · ') : null, p !== P.NONE && d.count ? L('실사 ', 'Kiểm kê ') + d.count : null, d.lastLog ? L('마지막 일보 ', 'Báo cáo gần nhất ') + d.lastLog : null].filter(Boolean).join(' · ');
    const body = d.rows.length ? P.tableEl(d) : h('div', { class: 'empty' }, L('재고 없음', 'Không có tồn'));
    return h('section', { class: 'card wcard fpiv-card' + (!wide && !V.edit ? ' narrow' : ''), 'data-id': p },
      h('div', { class: 'card-head' }, h('h2', P.title(p)), right),
      V.edit ? editor(p, cfg) : null, body, warnEl(p, d, dg),
      p === P.NONE ? h('p', { class: 'help', style: { margin: '8px 0 0' } }, L('생산 일보 · BOM · 반제품 목록으로 공정을 정하지 못한 품목입니다. 품목 기준 정보의 \'생산 공정\'을 넣으면 그 공정 카드로 갑니다.', 'Chưa xác định được công đoạn từ báo cáo SX · BOM · danh mục BTP. Nhập "Công đoạn SX" ở danh mục mặt hàng.')) : null,
      info ? h('p', { class: 'help', style: { margin: '8px 0 0' } }, info) : null);
  }

  // ---------------------------------------------------------------- 엑셀 (공정마다 시트 + 품목 목록)
  P.exportAll = function () {
    const all = P.cards(); const sheets = [];
    P.procs().forEach(p => { const cfg = all[p]; if (cfg.hidden) return; const d = P.buildCard(p, cfg); if (!d.rows.length) return;
      const hdr = [d.firstHead].concat(d.rowTot ? [L('합계', 'Tổng')] : [], d.cols.map(x => x.label));
      const line = (label, get, tot) => [label].concat(d.rowTot ? [tot] : [], d.cols.map(x => get(x.k)));
      sheets.push({ name: P.procLabel(p), header: hdr, rows: d.rows.map(r => line(d.itemMode ? r.title : r.label, (k) => (r.cells.get(k) || { v: 0 }).v, r.tot)).concat(d.tots.map(t => line(t.label, (k) => t.cells.get(k) || 0, ''))) }); });
    const oth = (s) => r4((s.in || 0) - (s.out || 0) + (s.adj || 0));
    const items = floorRows().filter(s => Math.abs(s.bal) > EPS || s.n > 0).sort((a, b) => procOrder(P.procOf(a)) - procOrder(P.procOf(b)) || String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
    sheets.push({ name: L('품목 목록', 'Danh sách mã'), header: [L('품목코드', 'Mã hàng'), L('품명', 'Tên'), L('공정', 'Công đoạn'), L('구분', 'Loại'), L('품목군', 'Nhóm'), L('정한 자료', 'Nguồn phân loại'), L('단위', 'ĐV'), L('기초', 'Đầu kỳ'), L('생산 입고 +', 'Nhập SX +'), L('부품 소모 −', 'Tiêu hao −'), L('기타 수불 ±', 'Phiếu khác ±'), L('창고', 'Kho'), L('공장', 'Xưởng'), L('현재 재고', 'Tồn hiện tại')],
      rows: items.map(s => { const c = cls(s); return [s.code, s.name || '', P.procLabel(c.proc || P.NONE), c.kind ? INV.floorKindName(c.kind) : '', c.multi ? L('일보 품목군별', 'theo nhóm báo cáo') : P.lineName(c.line), P.srcName(c.src), s.prim, s.openTot, s.prod, s.use, oth(s), s.by.WH, s.by.FAC, s.bal]; }) });
    ERP.xl.exportSheets('floor_stock_by_process', sheets);
    ERP.toast(L('현장 재고 (공정마다 시트) — 엑셀로 저장', 'Tồn hiện trường (mỗi công đoạn một sheet) — đã xuất Excel'), 'ok');
  };
  P.srcName = (s) => ({ manual: L('품목 기준 정보', 'Danh mục mặt hàng'), unit: L('단위 (SET · CT)', 'Đơn vị (SET · CT)'), log: L('생산 일보', 'Báo cáo SX'), master: L('색상별 BOM · 리필 규격 · 품목 구성', 'BOM màu · quy cách refill · item BOM'), semi: L('반제품 목록', 'Danh mục BTP'), bom_parent: L('BOM 부모', 'BOM (cha)'), bom_child: L('BOM 자식', 'BOM (con)'), name: L('품명', 'Tên') }[s] || '');

  // ---------------------------------------------------------------- 1.13.9 원재료 환산 (20차: 공정 = 현장 분류)
  // 사용자 (2026-10-26, 현장 재고 '조립 재고' 표 사진과 함께): "현장재고를 원재료로 환산했을때 원재료별로 얼마인지 조립재고 오른쪽에 표시해서 볼수있게 해줘"
  // — 현장 재고 (창고+공장 현재 재고) 를 BOM 으로 원료 (RM) 까지 푼 양. MRP 소요량과 같은 계산 (ERP.mrp — 재고를 빼지 않는 총량 gross), 공정마다 따로 풀어 칸으로.
  //   같은 원료 · 같은 단위라서 공정 칸을 더한 합계는 맞다
  /** { cols: [{k, label}] (원료가 나온 공정), rows: [{k 원료 코드, name, unit, cells: Map 공정 → 양, tot}] (많은 순), tots (단위별 합계), units, items, miss (BOM 없는 품목 수) } */
  P.rawBuild = function () {
    const items = floorRows().filter(s => s.bal > EPS);
    const byProc = new Map(); items.forEach(s => { const p = P.procOf(s); let a = byProc.get(p); if (!a) byProc.set(p, a = []); a.push(s); });
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

  // ---------------------------------------------------------------- 종합 현황 위젯 (1.12.2 · 1.13.6): 공정 하나. 예전 '모든 공정' · '기타' 위젯은 공정 카드 묶음
  P.ROW_OPTS = () => [['std', L('품목군까지', 'Đến nhóm')], ['item', L('품목 (색) 까지', 'Đến từng mã (màu)')]];
  P.PROC_OPTS = () => ERP.PROC.map(p => [p.id, L(p.ko, p.vi)]);
  /** 위젯 설정 { proc, divs, rows } → { title, els: [표 …], help } */
  P.widget = function (o) {
    o = o || {}; const one = PROCS().includes(o.proc); const ps = one ? [o.proc] : PROCS();
    const cfgOf = () => cleanCfg({ rows: o.rows === 'item' ? 'item' : 'std', divs: one ? o.divs : [], scope: 'all' });
    const ds = ps.map(p => P.buildCard(p, cfgOf())).filter(d => one || d.rows.length);
    const els = ds.map(d => (one ? null : h('h3', { class: 'fpiv-wh' }, P.procLabel(d.proc)))).map((x, i) => [x, ds[i].rows.length ? P.tableEl(ds[i]) : h('div', { class: 'empty' }, L('재고가 없습니다.', 'Không có tồn.'))]);
    const units = Array.from(new Set([].concat(...ds.map(d => d.units))));
    return { title: one ? P.title(o.proc) : L('현장 재고 (공정마다)', 'Tồn hiện trường (từng công đoạn)'), els: [].concat(...els).filter(Boolean),
      help: [one && units.length === 1 ? L('단위 ', 'Đơn vị ') + units[0] : null, L('현재 재고', 'Tồn hiện tại'), one ? null : L('⚙ 에서 공정 하나를 고르세요', 'Chọn một công đoạn ở ⚙')].filter(Boolean).join(' · ') };
  };

  /** 현장 재고 위 영역: 공정 카드 + 원재료 환산 + 아래 줄 (p_stock.js stockTab 이 부름) */
  ERP.floorPivot = function () {
    const all = P.cards(); const dg = diagByProc(); const wrap = h('div', { class: 'fpiv' }); const hidden = [];
    // 1.15.1 (사용자 "네, 고쳐 줘"): 분류 안 된 품목 카드는 그 품목이 재고 (창고 · 공장 어느 쪽이든) 를 가졌을 때만 — 재고 0 인 품목만 있으면 빈 카드였음.
    //   카드 설정을 바꿨으면 (범위 · 품목군 · 줄 · 0 줄) 줄이 없어도 카드 · 숨긴 카드 [보이기] 는 남긴다 (Codex 검토: 범위를 창고로 바꾸면 되돌릴 수 없었음)
    const noneStock = floorRows().some(s => P.procOf(s) === P.NONE && [s.bal, s.by.WH, s.by.FAC].some(v => Math.abs(v || 0) > EPS));
    P.procs().forEach(p => { const cfg = all[p]; const d = P.buildCard(p, cfg);
      if (p === P.NONE && !noneStock && !(d.items && (cfg.zero || cfg.scope !== 'all' || cfg.divs.length || cfg.rows !== 'std'))) return;
      if (cfg.hidden) { hidden.push(p); return; }
      wrap.appendChild(cardEl(p, d, cfg, dg.by[p])); });
    wrap.appendChild(rawCard());
    wrap.appendChild(h('div', { class: 'fpiv-foot' },
      h('button', { type: 'button', class: 'btn sm', 'data-act': 'xl', onclick: () => P.exportAll() }, L('엑셀 (공정마다 시트)', 'Excel (mỗi công đoạn một sheet)')),
      hidden.length ? h('span', { class: 'muted', 'data-hidden': hidden.join(',') }, L('숨긴 카드: ', 'Thẻ đã ẩn: '), hidden.map(p => h('button', { type: 'button', class: 'btn sm', 'data-show': p, onclick: () => patch(p, { hidden: false }) }, P.procLabel(p) + L(' 보이기', ' — hiện')))) : null,
      dg.missingPart ? h('button', { type: 'button', class: 'fpiv-w', 'data-w': 'missingPart', onclick: () => ERP.goStock('post') }, ERP.chip('warn', L('BOM 의 부품이 품목에 없음 ', 'Linh kiện trong BOM chưa có mã ') + F.n(dg.missingPart) + L('종', ' mã'))) : null,
      h('span', { class: 'muted', style: { fontSize: '12px' } }, L('공정마다 따로 셉니다 — 공정끼리, 다른 구분끼리 (배럴 + 스푼), 다른 단위끼리 (SET + CT) 는 더하지 않습니다. 공정 · 구분 · 품목군은 생산 일보 · BOM · 반제품 목록으로 정합니다 (ERP CODE 안 씀). 칸을 누르면 아래 표가 그 품목으로 바뀝니다.',
        'Tính riêng từng công đoạn — không cộng giữa các công đoạn, các loại (barrel + spoon) hay đơn vị (SET + CT). Công đoạn · loại · nhóm lấy từ báo cáo SX · BOM · danh mục BTP (không dùng ERP CODE). Bấm ô để lọc bảng dưới.'))));
    return wrap;
  };
})();
