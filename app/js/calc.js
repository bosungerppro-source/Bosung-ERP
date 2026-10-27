/* Derived data: stock balances, production aggregates, order progress */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, F = ERP.fmt;
  const C = ERP.calc = {};

  const num = (x) => (typeof x === 'number' && isFinite(x)) ? x : (parseFloat(x) || 0);
  C.num = num;
  /** pcs-equivalent output of a prod_log row */
  C.qty = (r) => (r.ok_ea !== undefined && r.ok_ea !== null && r.ok_ea !== '') ? num(r.ok_ea) : num(r.ok_qty);

  // ---------- legacy material stock (예시 원부자재 마스터 + 입출고장). 6차부터 현재고는 inv.js 의 C.stock() ----------
  C.stockLegacy = function (upTo) {
    return DB.memo('stockLegacy:' + (upTo || ''), ['materials', 'inout'], () => {
      const map = new Map();
      DB.rows('materials').forEach(m => {
        const prim = m.unit || 'kg';
        map.set(m.code, { code: m.code, m, name: ERP.lang === 'vi' ? (m.name_vn || m.name_en) : (m.name_kr || m.name_en), prim,
          open_kg: num(m.open_kg), open_ea: num(m.open_ea), in_kg: 0, in_ea: 0, out_kg: 0, out_ea: 0, n: 0 });
      });
      DB.rows('inout').forEach(r => {
        if (upTo && r.date > upTo) return;
        let s = map.get(r.wh_code);
        if (!s) { s = { code: r.wh_code, m: null, name: r.name, prim: 'kg', open_kg: 0, open_ea: 0, in_kg: 0, in_ea: 0, out_kg: 0, out_ea: 0, n: 0 }; map.set(r.wh_code, s); }
        s.in_kg += num(r.in_kg); s.in_ea += num(r.in_ea); s.out_kg += num(r.out_kg); s.out_ea += num(r.out_ea); s.n++;
      });
      map.forEach(s => {
        s.bal_kg = s.open_kg + s.in_kg - s.out_kg; s.bal_ea = s.open_ea + s.in_ea - s.out_ea;
        s.bal = s.prim === 'ea' ? s.bal_ea : s.bal_kg;
        const sf = s.m && s.m.safety_stock !== undefined && s.m.safety_stock !== null ? num(s.m.safety_stock) : null;
        s.safety = sf;
        s.status = sf === null || sf === 0 ? 'na' : (s.bal < 0 ? 'neg' : (s.bal < sf ? 'low' : (s.bal < sf * 1.2 ? 'near' : 'ok')));
        const usage = s.m ? (s.prim === 'ea' ? num(s.m.usage_ea_month) : num(s.m.usage_kg_month)) : 0;
        s.usage = usage; s.cover = usage > 0 ? s.bal / (usage / 30) : null;
      });
      return map;
    });
  };

  // ---------- production ----------
  C.prodIndex = function () {
    return DB.memo('prodIdx', ['prod_log'], () => {
      const byDate = new Map();
      DB.rows('prod_log').forEach(r => { if (!r.date) return; let a = byDate.get(r.date); if (!a) byDate.set(r.date, a = []); a.push(r); });
      const dates = Array.from(byDate.keys()).sort();
      return { byDate, dates };
    });
  };
  C.latestProdDate = function (limit) {
    const ix = C.prodIndex(); const lim = limit || F.today();
    for (let i = ix.dates.length - 1; i >= 0; i--) if (ix.dates[i] <= lim) return ix.dates[i];
    return ix.dates[ix.dates.length - 1] || lim;
  };
  /** 설비 하나를 가리키는 키: 공정 + 설비 종류 + 번호. 번호는 종류마다 1번부터라서 (Mini 1번 ≠ Regular 1번) 종류를 함께 본다.
      종류 = 설비명에서 Assy · M/C 등을 뺀 것, 설비명이 없으면(누적 시트) 품목군 */
  const machType = (r) => {
    let t = String(r.machine || '').toUpperCase().replace(/ASS'?Y|M\/C|\bMC\b|MACHINE/g, ' ').replace(/[^A-Z0-9-]+/g, ' ').trim();
    if (!t || /^V\d$/.test(t)) t = String(r.division || '').toUpperCase().trim();
    return t;
  };
  C.machKey = (r) => (r.process || '') + ':' + machType(r) + '#' + String(r.machine_no === undefined || r.machine_no === null ? '' : r.machine_no).trim();
  /** aggregate rows → {ok, ng, plan, ea, stop, rows, machines:Set, workers} */
  C.agg = function (rows) {
    const a = { ok: 0, ng: 0, plan: 0, ea: 0, ngEa: 0, stop: 0, work: 0, n: rows.length, machines: new Set(), planN: 0, okForPlan: 0 };
    rows.forEach(r => {
      const q = C.qty(r); a.ea += q; a.ok += num(r.ok_qty); a.ng += num(r.ng_qty); a.stop += num(r.stop_min); a.work += num(r.work_min);
      if (r.plan_qty) { a.plan += num(r.plan_qty); a.okForPlan += num(r.ok_qty); a.planN++; }
      if (r.machine_no !== undefined && r.machine_no !== null) a.machines.add(C.machKey(r));
    });
    a.ngRate = (a.ea + a.ng) > 0 ? a.ng / (a.ea + a.ng) : null;
    a.achieve = a.plan > 0 ? a.okForPlan / a.plan : null;
    return a;
  };
  C.rowsBetween = function (from, to, proc) {
    const ix = C.prodIndex(); const out = [];
    for (const d of ix.dates) { if (d < from) continue; if (d > to) break; const a = ix.byDate.get(d); for (const r of a) if (!proc || r.process === proc) out.push(r); }
    return out;
  };
  C.dailySeries = function (from, to, metric) {
    const ix = C.prodIndex(); const days = []; let d = from;
    while (d <= to) { days.push(d); d = F.addDays(d, 1); }
    const series = {}; ERP.PROC.forEach(p => { series[p.id] = days.map(() => 0); });
    days.forEach((day, i) => {
      (ix.byDate.get(day) || []).forEach(r => { if (series[r.process]) series[r.process][i] += (metric === 'ng' ? num(r.ng_qty) : C.qty(r)); });
    });
    return { days, series };
  };

  // ---------- orders ----------
  /** PO 줄의 Condition 칸 → 'cancel' · 'hold' · '' (공장 엑셀: Cancle / cancle / Di hold) */
  C.poCond = function (p) {
    const raw = String((p && p.condition) || '').toLowerCase(); if (!raw.trim()) return '';
    const fold = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').replace(/đ/g, 'd');
    if (/취소/.test(raw) || /cancel|cancle|\bhuy\b/.test(fold)) return 'cancel';
    if (/보류/.test(raw) || /\bhold\b|tam dung|tam ngung/.test(fold)) return 'hold';
    return '';
  };
  /** 진행 중(완료 · 취소 · 보류가 아님) */
  C.isOpen = (o) => o.st !== 'done' && o.st !== 'cancel' && o.st !== 'hold';
  // One PO number may hold several item (품번) lines. Each line = one row of table `po`.
  // Packing progress is matched per (PO no + item code); packing rows whose code matches no line are
  // attributed to the PO only when it has a single line, otherwise reported as `orphan`.
  C.orders = function () {
    return DB.memo('orders', ['po', 'prod_log'], () => {
      const live = new Map(), livePo = new Map();
      DB.rows('prod_log').forEach(r => { if (r.process === 'PCK' && r.po_no) { const po = String(r.po_no), k = po + '|' + (r.code === undefined ? '' : r.code); live.set(k, (live.get(k) || 0) + num(r.ok_qty)); livePo.set(po, (livePo.get(po) || 0) + num(r.ok_qty)); } });
      const byPo = new Map(); DB.rows('po').forEach(p => { if (!p.po_no) return; const k = String(p.po_no); let a = byPo.get(k); if (!a) byPo.set(k, a = []); a.push(p); });
      const today = F.today(); const out = [];
      byPo.forEach((lines, po) => {
        const keyRows = new Map(); lines.forEach(p => { const k = po + '|' + (p.item_no === undefined ? '' : p.item_no); let a = keyRows.get(k); if (!a) keyRows.set(k, a = []); a.push(p); });
        let matched = 0; keyRows.forEach((rows, k) => { matched += live.get(k) || 0; });
        const orphan = Math.max(0, (livePo.get(po) || 0) - matched);
        lines.forEach(p => {
          const sets = num(p.sets) || 0; const k = po + '|' + (p.item_no === undefined ? '' : p.item_no); const rows = keyRows.get(k);
          const totSets = rows.reduce((a, r) => a + (num(r.sets) || 0), 0);
          let lv = (live.get(k) || 0) * (rows.length > 1 && totSets ? sets / totSets : (rows.length > 1 ? 1 / rows.length : 1));
          if (lines.length === 1) lv += orphan;
          const packed = lines.length === 1 ? Math.max(num(p.packed), lv) : lv;
          const prog = sets > 0 ? packed / sets : (num(p.rate) || 0);
          let st = 'wait';
          if (sets > 0 && prog >= 0.999) st = 'done'; else if (p.due && p.due < today) st = 'late'; else if (packed > 0) st = 'prod';
          if (p.done_at) st = 'done';   // 13차: 강제 완료 (done_at = 완료 처리일) — 포장 실적과 상관없이 완료
          const cond = C.poCond(p); if (cond) st = cond;   // 취소 · 보류 표시가 이긴다 (진행 · 지연 · 완료로 세지 않는다)
          const dd = p.due ? F.diffDays(p.due, today) : null;
          out.push({ p, sets, packed, live: lv, prog, st, forced: st === 'done' && !!p.done_at, dday: dd, soon: C.isOpen({ st }) && dd !== null && dd >= 0 && dd <= 7, n: lines.length, orphan: lines.length > 1 ? orphan : 0 });
        });
      });
      return out;
    });
  };
  /** PO-level view: one entry per PO number, shaped like an order line (p = representative row). */
  C.poGroups = function () {
    return DB.memo('poGroups', ['po', 'prod_log'], () => {
      const m = new Map(); C.orders().forEach(o => { const k = String(o.p.po_no); let a = m.get(k); if (!a) m.set(k, a = []); a.push(o); });
      const today = F.today(); const out = [];
      m.forEach((lines, po) => {
        const first = lines[0].p;
        // 취소 · 보류 줄은 PO 진행 · 수량에서 뺀다 (모든 줄이 취소 · 보류면 PO 도 취소 · 보류)
        const act = lines.filter(o => o.st !== 'cancel' && o.st !== 'hold'); const use = act.length ? act : lines;
        const sets = use.reduce((a, o) => a + o.sets, 0); const packed = use.reduce((a, o) => a + Math.min(o.packed, o.sets || o.packed), 0);
        const pcs = use.reduce((a, o) => a + num(o.p.pcs), 0);
        const openL = act.filter(o => o.st !== 'done'); const dues = (openL.length ? openL : use).map(o => o.p.due).filter(Boolean).sort();
        const due = dues[0] || first.due; const done = act.length > 0 && openL.length === 0;
        let st = 'wait'; if (!act.length) st = lines.some(o => o.st === 'hold') ? 'hold' : 'cancel'; else if (done) st = 'done'; else if (openL.some(o => o.st === 'late')) st = 'late'; else if (act.some(o => o.packed > 0)) st = 'prod';
        const dd = due ? F.diffDays(due, today) : null; const items = Array.from(new Set(lines.map(o => o.p.item_no).filter(Boolean)));
        const rep = Object.assign({}, first, { item_no: items.length > 1 ? items[0] + L(' 외 ' + (items.length - 1), ' +' + (items.length - 1)) : items[0], due, pcs });
        out.push({ p: rep, po_no: po, lines, n: lines.length, items, sets, packed, prog: sets > 0 ? packed / sets : 0, st, forced: act.some(o => o.forced), doneAt: lines.map(o => o.p.done_at).filter(Boolean).sort().pop() || '', dday: dd, soon: C.isOpen({ st }) && dd !== null && dd >= 0 && dd <= 7, orphan: lines[0].orphan });
      });
      return out;
    });
  };
  /** 1.13.12 (사용자 2026-10-27 "납기 날짜보는건 항상 날짜 높은 순서로 보여준다"): 납기 늦은 줄부터, 납기 없는 줄은 맨 뒤 — C.orders() · C.poGroups() 의 줄 */
  C.byDueDesc = (a, b) => String(b.p.due || '').localeCompare(String(a.p.due || ''));
  // 13차: 강제 완료 — 포장 실적이 없어도 완료로 표시한다 (줄마다 done_at = 완료 처리일). 수주를 다시 올려도(upsert) 남는다
  /** 진행 중 줄(완료 · 취소 · 보류가 아닌 줄)을 완료로 표시 → 바꾼 줄 수 */
  C.closeLines = function (lines, day) { const t = day || F.today(); let n = 0; (lines || []).forEach(o => { if (!C.isOpen(o)) return; DB.update('po', o.p._id, { done_at: t }); n++; }); return n; };
  /** 강제 완료를 되돌린다 (done_at 지움) → 바꾼 줄 수 */
  C.reopenLines = function (lines) { let n = 0; (lines || []).forEach(o => { if (!o.p.done_at) return; DB.update('po', o.p._id, { done_at: '' }); n++; }); return n; };
  /** 납기(Checking)가 from ~ to (YYYY-MM-DD, 둘 다 포함)인 진행 중 줄을 모두 완료로 표시하고 업로드 이력에 남긴다 → 바꾼 줄 수 */
  C.closeByDue = function (from, to, note) {
    const n = C.closeLines(C.orders().filter(o => C.isOpen(o) && o.p.due && o.p.due >= from && o.p.due <= to));
    if (n) DB.add('uploads', { at: F.now(), kind: 'po_close', date: to, mode: 'due', rows: n, changed: n, note: note || L('수주 일괄 완료 (납기 ' + from + ' ~ ' + to + ')', 'Đánh dấu xong PO hàng loạt (hạn ' + from + ' ~ ' + to + ')') });
    return n;
  };
  const ISO = /^\d{4}-\d\d-\d\d/;
  /** monthly PO quantity (pcs) by 품목군. basis 'due' = Checking(납기) 월 (7차 기본, 엑셀 "PO Sum"과 같음) · 'date' = 수주월 */
  C.monthlyPO = function (basis) {
    basis = basis === 'date' ? 'date' : 'due';
    return DB.memo('poMonthly:' + basis, ['po'], () => {
      const m = {}; DB.rows('po').forEach(p => { const d = String(p[basis] || ''); if (!ISO.test(d)) return; const ym = d.slice(0, 7); const k = C.kindOf(p); (m[ym] = m[ym] || {})[k] = (m[ym][k] || 0) + num(p.pcs); });
      return m;
    });
  };
  C.kindOf = (p) => String((p && p.kind) || '').trim() || L('미지정', 'Chưa phân');
  const KIND_ORDER = ['Dial', 'Mini', 'Pencil', 'Click Pencil', 'Glass', 'Mixed', 'Dial Mixed', 'Bulk'];
  /** 품목군 list in the order of the factory's own Excel dashboard, then the rest */
  C.poKinds = function () {
    return DB.memo('poKinds', ['po'], () => {
      const tot = new Map(); DB.rows('po').forEach(p => { if (!ISO.test(String(p.date || '')) && !ISO.test(String(p.due || ''))) return; const k = C.kindOf(p); tot.set(k, (tot.get(k) || 0) + num(p.pcs)); });
      return Array.from(tot.keys()).sort((a, b) => { const x = KIND_ORDER.indexOf(a), y = KIND_ORDER.indexOf(b); if (x >= 0 || y >= 0) return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); return tot.get(b) - tot.get(a); });
    });
  };
  /** 보고 싶은 품목군 (수주 관리 표 · 종합 현황 위젯이 같이 쓴다). 설정에는 '숨긴 품목군'을 저장 → 새 품목군은 기본으로 보인다 */
  C.poKindsShown = function () { const off = new Set(DB.setting('poKindsOff', []) || []); return C.poKinds().filter(k => !off.has(k)); };
  C.setPoKindsShown = function (shown) { const s = new Set(shown); DB.setSetting('poKindsOff', C.poKinds().filter(k => !s.has(k))); };
  // 1.13.8: 생산일보 품목군 — 대소문자 · 앞뒤 공백만 다르면 한 묶음 (생산 관리 · 종합 현황의 일별 · 월별 표와 같은 규칙). 열쇠 = 소문자, 품목군이 없으면 '–'
  C.divKey = (r) => String((r && r.division) || '').trim().toLowerCase() || '–';
  /** 그 공정 ('' = 모든 공정) 일보에 있는 품목군 [[열쇠, 이름]] + 이미 고른 것 (keep) — 이름은 처음 나온 글자, 순서는 열쇠 순 (표와 같음) */
  C.prodDivs = function (proc, keep) {
    const seen = DB.memo('prodDivs:' + (proc || ''), ['prod_log'], () => { const m = new Map(); DB.rows('prod_log').forEach(r => { if (proc && r.process !== proc) return; const k = C.divKey(r); if (!m.has(k)) m.set(k, String(r.division || '').trim()); }); return m; });
    const m = new Map(seen); (keep || []).forEach(k => { if (!m.has(k)) m.set(k, k); });
    return Array.from(m.keys()).sort().map(k => [k, k === '–' ? L('(품목군 없음)', '(không nhóm)') : m.get(k)]);
  };
  /** 생산 관리 일별 · 월별 탭에서 보는 품목군 (공정마다, 비면 전체) — 현장 재고 표 설정처럼 저장 (모든 PC 같음) */
  C.prodDivsShown = (proc) => { const a = (DB.setting('prodDivs', null) || {})[proc || '*']; return Array.isArray(a) ? a.map(String) : []; };
  C.setProdDivsShown = (proc, keys) => { const m = Object.assign({}, DB.setting('prodDivs', null) || {}); if (keys && keys.length) m[proc || '*'] = keys.slice(); else delete m[proc || '*']; DB.setSetting('prodDivs', m); };
})();
