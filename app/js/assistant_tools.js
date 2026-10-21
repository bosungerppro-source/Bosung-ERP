/* AI 생산 비서 · 조회 도구 (Trợ lý sản xuất · công cụ tra cứu) — READ-ONLY.
   The same tools feed (a) Claude tool-use and (b) the built-in offline engine (assistant_local.js).
   Numbers use the same definitions as the screens (ERP.calc): "late" = overdue ≤ 60 days (dashboard KPI);
   older overdue POs are reported separately as "stale" because they are usually orders never closed in the system. */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, C = ERP.calc, F = ERP.fmt;
  const A = ERP.ai = ERP.ai || { history: [], transcript: [], busy: false, hasKey: null, keyTail: '', model: 'claude-sonnet-5-5' };

  const STALE_DAYS = 60;
  const num = C.num;
  const r1 = (x) => Math.round((+x || 0) * 10) / 10;
  const clean = (x) => String(x === undefined || x === null ? '' : x).replace(/\s+/g, ' ').trim();   // names in the data may contain line breaks
  const clampLim = (n, d) => Math.min(Math.max(parseInt(n, 10) || d, 1), 60);
  const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(s + 'T00:00:00'));
  const ddOf = (g) => (Number.isFinite(g.dday) ? g.dday : null);
  const isOpen = (g) => ERP.calc.isOpen(g);   // 완료 · 취소 · 보류가 아님
  const isRecentLate = (g) => isOpen(g) && g.st === 'late' && ddOf(g) !== null && ddOf(g) >= -STALE_DAYS;
  const isStale = (g) => isOpen(g) && g.st === 'late' && ddOf(g) !== null && ddOf(g) < -STALE_DAYS;
  const hasValidDue = (g) => !!g.p.due && /^\d{4}-\d{2}-\d{2}/.test(String(g.p.due));
  const procIsSet = (id) => { const p = ERP.PROC.find(x => x.id === id); return id === 'PCK' || (p && p.unit === 'set'); };

  /** urgency order: recent-late (most overdue first) → upcoming (soonest first) → no valid due → stale (least stale first) → done */
  const rank = (g) => (!isOpen(g) ? 5 : ddOf(g) === null ? 3 : ddOf(g) < -STALE_DAYS ? 4 : ddOf(g) < 0 ? 0 : 1);
  function urgencySort(arr) {
    return arr.slice().sort((x, y) => {
      const rx = rank(x), ry = rank(y); if (rx !== ry) return rx - ry;
      const dx = ddOf(x), dy = ddOf(y);
      if (rx === 4) return dy - dx;
      if (dx === null || dy === null || dx === dy) return String(x.po_no).localeCompare(String(y.po_no));
      return dx - dy;
    });
  }

  const poRow = (g) => {
    const row = { po_no: g.po_no, customer: clean(g.p.customer), items: g.items.map(clean), sets: Math.round(g.sets), packed_sets: Math.round(g.packed),
      remaining_sets: g.forced ? 0 : Math.max(0, Math.round(g.sets - g.packed)), progress_pct: Math.round(g.prog * 100), due: g.p.due, days_to_due: ddOf(g), status: g.st };
    if (isStale(g)) row.stale = true;
    if (g.forced) row.marked_done = g.doneAt;   // 13차: 포장 실적과 상관없이 완료로 표시한 PO (완료 처리일)
    return row;
  };
  const sevRank = { neg: 0, low: 1, near: 2, ok: 3, na: 4 };
  const matRow = (s, mult) => {
    const below = s.status === 'low' || s.status === 'neg';
    const row = { code: clean(s.code), name: clean(s.name), unit: s.prim, balance: r1(s.bal), safety_stock: s.safety,
      pct_of_safety: s.safety ? Math.round(s.bal / s.safety * 100) : null, status: s.status, days_cover: s.cover === null || s.cover === undefined ? null : Math.round(s.cover) };
    if (s.by) { row.warehouse = r1(s.by.WH); row.factory = r1(s.by.FAC); }
    if (s.stage && ERP.inv) row.stage = ERP.inv.stageTitle(s.stage);
    if (s.sets !== null && s.sets !== undefined) row.sets = Math.round(s.sets);
    if (s.susp) row.transfer_missing_suspected = true;
    if (below && s.safety > 0) row.recommended_order = r1(Math.max(0, s.safety * (mult || 1) - s.bal));
    return row;
  };
  const findPo = (po) => {
    const k = String(po === undefined || po === null ? '' : po).trim(); if (!k) return null;
    const gs = C.poGroups();
    return gs.find(g => String(g.po_no) === k) || gs.find(g => String(g.po_no).toLowerCase() === k.toLowerCase()) || null;
  };
  const dayRange = (a) => {
    let to = validDate(a.to) ? a.to : C.latestProdDate(); let from = validDate(a.from) ? a.from : to;
    if (from > to) { const t = from; from = to; to = t; } return { from, to };
  };
  // 6차: 현재고 = 기초재고(ECOUNT) + 수불 + 생산 반영 (inv.js). 숨김/테스트 품목은 뺀다
  const stockRows = () => (ERP.inv ? ERP.inv.rows() : Array.from(C.stock().values()));
  const stockBasis = () => { if (!ERP.inv) return undefined; const m = ERP.inv.meta(); return { opening_date_warehouse: m.open.WH || null, opening_date_factory: m.open.FAC || null, last_transaction_date: m.lastTx, transactions: m.txCount, production_posting: m.mode, last_production_posting_date: m.lastProd }; };
  const procOrder = () => ERP.PROC.map(p => p.id);
  const normProc = (p) => (p ? String(p).trim().toUpperCase() : undefined);

  const IMPL = {
    overview() {
      const gs = C.poGroups(), open = gs.filter(isOpen), st = stockRows();
      const d = C.latestProdDate(), perProc = {};
      if (d) { const rows = C.prodIndex().byDate.get(d) || []; ERP.PROC.forEach(p => { const rr = rows.filter(r => r.process === p.id); if (!rr.length) return; const g = C.agg(rr); perProc[p.id] = { good_pcs: Math.round(g.ea), good_sets: procIsSet(p.id) ? Math.round(g.ok) : undefined, ng_rate_pct: g.ngRate === null ? null : r1(g.ngRate * 100) }; }); }
      return { today: F.today(), open_po: open.length, late_po: open.filter(isRecentLate).length, stale_late_po: open.filter(isStale).length,
        due_within_7days: open.filter(g => g.soon).length, multi_item_po: gs.filter(g => g.n > 1).length,
        po_without_valid_due: open.filter(g => !hasValidDue(g)).length,
        materials_below_safety: st.filter(s => s.status === 'low' || s.status === 'neg').length, materials_near_safety: st.filter(s => s.status === 'near').length,
        materials_with_safety_set: st.filter(s => s.safety > 0).length, materials_total: st.filter(s => s.m).length,
        negative_stock_items: st.filter(x => x.negative).length, transfer_missing_suspected: st.filter(x => x.susp).length, stock_basis: stockBasis(),
        latest_production_date: d || null, latest_day_output_by_process: perProc };
    },

    find_orders(a) {
      const all = C.poGroups(), s = a.status || 'open';
      let gs = all.filter(g => s === 'all' ? true : s === 'open' ? isOpen(g) : s === 'late' ? isRecentLate(g) : s === 'stale' ? isStale(g) : s === 'due_soon' ? (isOpen(g) && g.soon) : g.st === s);
      const q = String(a.query || '').trim().toLowerCase();
      if (q) gs = gs.filter(g => (g.po_no + ' ' + (g.p.customer || '') + ' ' + g.items.join(' ') + ' ' + g.lines.map(l => l.p.kind || '').join(' ')).toLowerCase().includes(q));
      gs = urgencySort(gs);
      const open = all.filter(isOpen);
      const sb = (s === 'stale' && gs.length) ? { zero_progress: gs.filter(g => g.packed === 0).length, ge90_progress: gs.filter(g => g.prog >= 0.9).length, in_between: gs.filter(g => g.packed > 0 && g.prog < 0.9).length } : undefined;
      return { total: gs.length, stale_breakdown: sb, context: { open: open.length, late: open.filter(isRecentLate).length, due_within_7days: open.filter(g => g.soon).length, stale_late: open.filter(isStale).length },
        rows: gs.slice(0, clampLim(a.limit, 15)).map(poRow) };
    },

    get_po(a) {
      const g = findPo(a.po_no);
      if (!g) { const q = String(a.po_no || '').trim().toLowerCase(); const near = q ? C.poGroups().filter(x => String(x.po_no).toLowerCase().includes(q)).slice(0, 5).map(x => x.po_no) : []; return { error: 'PO not found: ' + a.po_no, similar_po_numbers: near }; }
      const packAll = DB.rows('prod_log').filter(r => r.process === 'PCK' && String(r.po_no) === String(g.po_no)).sort((x, y) => String(y.date).localeCompare(String(x.date)));
      const pack = packAll.slice(0, 12).map(r => ({ date: r.date, code: r.code, qty_sets: C.num(r.ok_qty) }));
      return { po: poRow(g), customer: clean(g.p.customer), country: clean(g.p.country), order_date: g.p.date, condition: g.p.condition, note: g.p.mark,
        lines: g.lines.map(o => ({ item_no: o.p.item_no, kind: o.p.kind, sets: Math.round(o.sets), packed_sets: Math.round(o.packed), remaining_sets: o.forced ? 0 : Math.max(0, Math.round(o.sets - o.packed)), progress_pct: Math.round(o.prog * 100), due: o.p.due, status: o.st })),
        packing_not_matching_any_line: g.orphan || undefined, recent_packing: pack, recent_packing_total: packAll.length > pack.length ? packAll.length : undefined };
    },

    material_stock(a) {
      const q = String(a.query || '').trim().toLowerCase(); const rows = []; let below = 0, near = 0;
      stockRows().forEach(s => {
        const names = s.m ? [s.m.name, s.m.erp_code, s.m.xnk, s.m.name_en, s.m.name_vn, s.m.name_kr].filter(Boolean).join(' ') : '';
        if (q && !((s.code || '') + ' ' + (s.name || '') + ' ' + names).toLowerCase().includes(q)) return;
        const isBelow = s.status === 'low' || s.status === 'neg', isNear = s.status === 'near';
        if (isBelow) below++; if (isNear) near++;
        if (a.only_low && !(isBelow || (a.include_near && isNear))) return;
        rows.push(matRow(s));
      });
      rows.sort((x, y) => {
        if (q) { const ex = (r) => (String(r.code).toLowerCase() === q ? 0 : 1); if (ex(x) !== ex(y)) return ex(x) - ex(y); }
        return (sevRank[x.status] - sevRank[y.status]) || ((x.pct_of_safety === null ? 1e9 : x.pct_of_safety) - (y.pct_of_safety === null ? 1e9 : y.pct_of_safety)) || String(x.code).localeCompare(String(y.code));
      });
      return { total: rows.length, below_safety_in_result: below, near_safety_in_result: near, stock_basis: stockBasis(), rows: rows.slice(0, clampLim(a.limit, 20)) };
    },

    production_summary(a) {
      if (!validDate(a.from) || !validDate(a.to)) return { error: 'from and to must be YYYY-MM-DD dates' };
      const { from, to } = dayRange(a); const proc = normProc(a.process);
      const rows = C.rowsBetween(from, to, proc); const by = new Map();
      rows.forEach(r => { const k = (a.by_day ? r.date + '|' : '') + r.process; let o = by.get(k); if (!o) by.set(k, o = { date: a.by_day ? r.date : undefined, process: r.process, rows: [] }); o.rows.push(r); });
      const order = procOrder();
      const output = Array.from(by.values()).map(o => { const g = C.agg(o.rows); const e = { process: o.process, name: ERP.procName(o.process), good_pcs: Math.round(g.ea), ng_qty: Math.round(g.ng), ng_rate_pct: g.ngRate === null ? null : r1(g.ngRate * 100), report_rows: g.n, machines: g.machines.size || undefined };
        if (procIsSet(o.process)) e.good_sets = Math.round(g.ok); if (o.date) e.date = o.date; return e; })
        .sort((x, y) => String(x.date || '').localeCompare(String(y.date || '')) || (order.indexOf(x.process) - order.indexOf(y.process)));
      return { from, to, process: proc || 'all', report_rows: rows.length, days_with_reports: new Set(rows.map(r => r.date)).size, latest_report_date_in_data: C.latestProdDate(), output: output.slice(0, 120),
        output_total: output.length > 120 ? output.length : undefined, output_truncated: output.length > 120 || undefined };
    },

    quality_downtime(a) {
      const { from, to } = dayRange(a); const proc = normProc(a.process); const top = Math.min(Math.max(parseInt(a.top, 10) || 5, 1), 15);
      const rows = C.rowsBetween(from, to, proc); const order = procOrder();
      const grp = (keyFn) => { const m = new Map(); rows.forEach(r => { const k = keyFn(r); if (k === null) return; let o = m.get(k); if (!o) m.set(k, o = []); o.push(r); }); return m; };
      const by_process = Array.from(grp(r => r.process)).map(([p, rr]) => { const g = C.agg(rr); return { process: p, name: ERP.procName(p), good_pcs: Math.round(g.ea), ng_qty: Math.round(g.ng), ng_rate_pct: g.ngRate === null ? null : r1(g.ngRate * 100), stop_min: Math.round(g.stop), report_rows: g.n }; })
        .sort((x, y) => order.indexOf(x.process) - order.indexOf(y.process));
      const worst_machines_by_ng = Array.from(grp(r => (r.machine_no === undefined || r.machine_no === null || r.machine_no === '') ? null : r.process + ':' + r.machine_no)).map(([k, rr]) => { const g = C.agg(rr); const [p, m] = k.split(':'); return { process: p, machine_no: m, ng_qty: Math.round(g.ng), ng_rate_pct: g.ngRate === null ? null : r1(g.ngRate * 100), good_pcs: Math.round(g.ea) }; })
        .filter(x => x.ng_qty > 0).sort((x, y) => y.ng_qty - x.ng_qty).slice(0, top);
      const stopRows = rows.filter(r => num(r.stop_min) > 0);
      const reasons = new Map(), machines = new Map();
      stopRows.forEach(r => { const why = clean(r.stop_reason || r.remark) || '(no reason recorded)'; const o = reasons.get(why) || { reason: why, minutes: 0, events: 0 }; o.minutes += num(r.stop_min); o.events++; reasons.set(why, o);
        if (r.machine_no !== undefined && r.machine_no !== null && r.machine_no !== '') { const k = r.process + ':' + r.machine_no; const m = machines.get(k) || { process: r.process, machine_no: String(r.machine_no), minutes: 0 }; m.minutes += num(r.stop_min); machines.set(k, m); } });
      return { from, to, process: proc || 'all', report_rows: rows.length, by_process, worst_machines_by_ng,
        stop_total_min: Math.round(stopRows.reduce((s, r) => s + num(r.stop_min), 0)), stop_events: stopRows.length,
        stop_by_reason: Array.from(reasons.values()).sort((x, y) => y.minutes - x.minutes).slice(0, top).map(x => ({ reason: x.reason, minutes: Math.round(x.minutes), events: x.events })),
        stop_by_machine: Array.from(machines.values()).sort((x, y) => y.minutes - x.minutes).slice(0, top).map(x => ({ process: x.process, machine_no: x.machine_no, minutes: Math.round(x.minutes) })) };
    },

    reorder(a) {
      const mult = Math.max(1, +a.target_multiplier || 1); const all = stockRows();
      const list = all.filter(s => s.safety !== null && s.safety > 0 && (s.status === 'low' || s.status === 'neg')).sort((x, y) => (x.bal / x.safety) - (y.bal / y.safety));
      return { total_below_safety: list.length, target_multiplier: mult, materials_with_safety_set: all.filter(s => s.safety > 0).length,
        materials_without_safety_set: all.filter(s => s.m && !(s.safety > 0)).length, rows: list.slice(0, clampLim(a.limit, 15)).map(s => Object.assign(matRow(s, mult), { target: r1(s.safety * mult) })) };
    },

    mrp(a) {
      let lines = Array.isArray(a.lines) ? a.lines.map(l => ({ code: String(l.code || '').trim(), qty: +l.qty, unit: l.unit || 'set' })).filter(l => l.code && l.qty > 0) : [];
      if (a.po_no) {
        const g = findPo(a.po_no); if (!g) return { error: 'PO not found: ' + a.po_no };
        lines = g.lines.filter(o => ERP.calc.isOpen(o)).map(o => ({ code: String(o.p.item_no || '').trim(), qty: Math.max(0, Math.round(o.sets - o.packed)), unit: 'set' })).filter(l => l.code && l.qty > 0);
      }
      if (!lines.length) return { error: 'no lines to calculate (give lines[] or a po_no that still has unpacked quantity)' };
      const res = ERP.mrp(lines, { netSemi: true }); const onlyShort = a.only_short !== false;
      const shortRows = res.rows.filter(r => (r.short || 0) > 0), unknownStock = res.rows.filter(r => r.stock === null);
      const kinds = {}; shortRows.forEach(r => { kinds[r.kind] = (kinds[r.kind] || 0) + 1; });
      const warnings = [];
      if (res.unknown.length) warnings.push('NO_BOM: no BOM/recipe found for ' + res.unknown.join(', ') + ' — requirement could not be calculated for these.');
      if (!res.rows.length && !res.unknown.length) warnings.push('NO_COMPONENTS: the BOM has no component codes or recipes for these lines, so NO requirement was calculated. This is NOT "no shortage".');
      if (unknownStock.length) warnings.push('STOCK_UNKNOWN: ' + unknownStock.length + ' raw materials are not matched to the stock master, so their shortage is unknown.');
      const show = onlyShort ? shortRows : res.rows;
      return { lines, route_info: res.info.map(i => { const o = { code: i.code, route: i.route, pcs: Math.round(i.pcs), colors: i.colors }; if (i.route === 'retail' && ERP.bomFor) { const b = ERP.bomFor(i.code); if (b && b.key && b.key !== i.code) o.bom_key_used = b.key; } return o; }), unknown_items: res.unknown,
        rows_total: res.rows.length, shortage_count: shortRows.length, shortage_by_kind: kinds, stock_unknown_count: unknownStock.length, warnings,
        rows: show.slice(0, 40).map(r => ({ code: r.code, name: r.name, kind: r.kind, unit: r.unit, need: r1(r.need), stock: r.stock === null ? null : r1(r.stock), short: r.short === null ? null : r1(r.short) })),
        stock_unknown: unknownStock.slice(0, 10).map(r => ({ code: r.code, name: r.name, need: r1(r.need), unit: r.unit })) };
    },

    /** one-call daily briefing bundle (used by the built-in mode and by the AI) */
    briefing() {
      const today = F.today(), ov = IMPL.overview(), ref = C.latestProdDate();
      const dayRows = ref ? (C.prodIndex().byDate.get(ref) || []) : [];
      const prev = C.dailySeries(F.addDays(ref || today, -14), F.addDays(ref || today, -1));
      const procs = ERP.dashProcs(); const missing = [];
      const by_process = [];
      procs.forEach(p => {
        const rr = dayRows.filter(r => r.process === p.id);
        if (!rr.length) { missing.push(p.id); return; }
        const g = C.agg(rr); const v = (prev.series[p.id] || []).filter(x => x > 0); const avg = v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
        by_process.push({ process: p.id, name: ERP.procName(p.id), good_pcs: Math.round(g.ea), good_sets: procIsSet(p.id) ? Math.round(g.ok) : undefined, vs_recent_avg_pct: avg ? Math.round(g.ea / avg * 100) : null, ng_rate_pct: g.ngRate === null ? null : r1(g.ngRate * 100), stop_min: Math.round(g.stop) });
      });
      const all = C.poGroups(), open = all.filter(isOpen);
      const late = urgencySort(open.filter(isRecentLate)), soon = open.filter(g => g.soon).sort((x, y) => String(x.p.due).localeCompare(String(y.p.due)) || String(x.po_no).localeCompare(String(y.po_no)));
      const st = stockRows();
      const below = st.filter(s => s.status === 'low' || s.status === 'neg').sort((x, y) => (x.bal / (x.safety || 1)) - (y.bal / (y.safety || 1)));
      return { today, weekday: new Date(today + 'T00:00:00').getDay(),
        production: { date: ref || null, days_since: ref ? F.diffDays(today, ref) : null, by_process, processes_without_report: missing },
        orders: { open: open.length, late: late.length, stale_late: ov.stale_late_po, due_within_7days: soon.length, po_without_valid_due: ov.po_without_valid_due, late_top: late.slice(0, 5).map(poRow), due_soon_top: soon.slice(0, 5).map(poRow) },
        materials: { below_safety: below.length, near_safety: ov.materials_near_safety, with_safety_set: ov.materials_with_safety_set, total: ov.materials_total, top_low: below.slice(0, 6).map(s => matRow(s)) } };
    },
  };

  A.tools = IMPL;
  A.util = { STALE_DAYS, findPo, urgencySort, poRow, matRow, validDate, isRecentLate, isStale, hasValidDue, procIsSet };

  const S = (props, required) => ({ type: 'object', properties: props || {}, required: required || undefined });
  A.toolDefs = [
    { name: 'briefing', description: 'One-call daily briefing: latest production day per process (vs recent average, NG rate, stops), PO counts (open / late ≤60 days / due ≤7 days / stale >60 days) with the top late and due-soon POs, and materials below safety stock. Use for "briefing", "today\'s status", "what should I look at first".', input_schema: S() },
    { name: 'overview', description: 'KPI snapshot that matches the dashboard: open POs, late POs (overdue ≤60 days = dashboard KPI), stale_late_po (overdue >60 days — outside the dashboard window; some are leftovers never closed in the system, some are real unfinished orders; mention the count in one short line, never lead with them), POs due within 7 days, materials below / near safety stock, latest production date and output per process.', input_schema: S() },
    { name: 'find_orders', description: 'List purchase orders (one row per PO number), most urgent first. status: open (default: recent-late → upcoming → no due date → stale last) | late (overdue ≤60 days) | stale (overdue >60 days) | due_soon (due within 7 days) | wait | prod | done | all. Free-text query matches PO no, customer, item no, product kind. result.context gives overall counts.', input_schema: S({
      query: { type: 'string', description: 'text matched against PO no, customer, item no, kind' },
      status: { type: 'string', enum: ['open', 'late', 'stale', 'due_soon', 'wait', 'prod', 'done', 'all'] },
      limit: { type: 'integer', description: 'max rows (default 15, max 60)' } }) },
    { name: 'get_po', description: 'Details of one PO: header, every item line with sets ordered / packed / remaining / progress / due, and recent packing records. If not found, similar_po_numbers lists close matches.', input_schema: S({ po_no: { type: 'string' } }, ['po_no']) },
    { name: 'material_stock', description: 'Current stock of ANY item (raw RM, sub-material SM/CM, parts, semi-finished WIP, manila-packed SG, finished FG) by item code, ERP CODE, Mã XNK or name. balance = warehouse + factory (two scopes, see warehouse / factory). Stock = opening stock imported from ECOUNT (stock_basis.opening_date_*) + transactions + production postings from daily reports. status: neg = negative balance, low = below safety stock, near = under 120% of safety, ok, na = no safety stock set (status is only judged for items with a safety stock). recommended_order = safety − balance for items below safety. only_low returns items below safety; add include_near to include "near". transfer_missing_suspected = one scope +, the other − (a warehouse→factory transfer was probably not entered).', input_schema: S({
      query: { type: 'string' }, only_low: { type: 'boolean' }, include_near: { type: 'boolean' }, limit: { type: 'integer' } }) },
    { name: 'production_summary', description: 'Production output between two dates grouped by process (and optionally by day): good_pcs (pcs-equivalent), good_sets for packing (PCK, in sets), ng_qty and ng_rate_pct (same formula as the production screen).', input_schema: S({
      from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, process: { type: 'string', description: 'INJ, REF, STP, ASM, WRP, PCK or a custom process code' }, by_day: { type: 'boolean' } }, ['from', 'to']) },
    { name: 'quality_downtime', description: 'Defects and machine stops for a period (default: latest production day): NG rate per process, worst machines by NG quantity, total stop minutes, stop minutes by recorded reason (falls back to the remark) and by machine.', input_schema: S({
      from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, process: { type: 'string' }, top: { type: 'integer', description: 'rows per ranking (default 5)' } }) },
    { name: 'reorder', description: 'Materials to order: only items with a safety stock set that are below it, with recommended order quantity (safety × multiplier − balance), same as the "발주 필요 목록" screen. Also reports how many materials have NO safety stock (not evaluated).', input_schema: S({ target_multiplier: { type: 'number', description: 'default 1' }, limit: { type: 'integer' } }) },
    { name: 'mrp', description: 'Material requirement from the BOM / recipes, netted against stock. Give lines[] (item code, qty, unit) or a po_no (all unfinished lines of that PO). READ warnings: NO_COMPONENTS / NO_BOM mean the requirement could NOT be calculated (never report that as "no shortage"); STOCK_UNKNOWN means some raw materials are not matched to the stock master. kind: raw (kg), semi (pcs), asm.', input_schema: S({
      lines: { type: 'array', items: S({ code: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string', enum: ['set', 'pcs', 'ea'] } }, ['code', 'qty']) },
      po_no: { type: 'string', description: 'alternative to lines' }, only_short: { type: 'boolean', description: 'only rows with a shortage (default true)' } }) },
  ];
})();
