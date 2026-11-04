/* 19차 (v1.14.0) 생산 계획 계산 — 진행 중 수주 → 공정별 남은 일 · 끝나는 날 · 출고 가능일 · 모자랄 자재 (Kế hoạch sản xuất)
   사용자 2026-11-03: "생산 케파나 인원등 수주대비 언제 작업이 끝나고 뭐가 얼마나 필요할지 ai비서가 생산관리를 하게 하려면 어떤 자료들이 더 필요해?"
     → "양식 만들어줘" → "채워넣긴했는데 어떻게 해야될지 모르겠다. 생산일보 보면서 너가 생각해줘" → (첫 계산 엑셀) → "네, 만들어 줘".
   대강의 능력 계획 (rough-cut) — 첫 계산 (D:\ERP\09_production_plan\scripts\plan_calc.js) 과 같은 규칙:
   1) 진행 중 수주 (C.orders · C.isOpen · 남은 set > 0) 를 납기 순 (납기 없는 줄은 맨 뒤). 범위 'all' = PO미정 포함 (수주 진행과 같음) · 'firm' = 확정 PO 만.
   2) 사용자 구성 BOM (bom_lines) 으로 풀기 — 줄 비고 = 그 품목을 만드는 공정 (사출 · 리필 · 조립 · 권취 · 포장 · 원료). 현장 재고 (반제품 · 조립품 · 세트) 는
      납기 이른 수주부터 쓰고 (MRP 와 같은 재고: 반제품(세미) 재고 → 현재고), 불량률만큼 더 만든다 (그만큼 부품 · 자재도 — 1.14.2). 수주 품번의 세트 · 색연필 수는 ERP.mrpUnits (1.13.18).
   3) 공정별 하루 능력 = 최근 3개월 생산 일보 실적 ÷ 공장이 일한 날 (조립은 품목군별) × 계획 조 수 ÷ 그동안 하루 조 수, 또는 기준 자료에 직접 넣은 하루 능력.
   4) 하루씩 공정을 같이 돌린다 (1.14.2, Codex 검토 2026-11-04): 공정마다 그날 능력을 납기 순으로 나누되, 앞 공정 (사출 · 리필 → 조립 · 권취 → 포장) 이
      기다리는 날 전까지 내준 만큼만 한다 — 앞 공정과 겹쳐 진행하고, 아직 못 하는 수주는 건너뛰어 뒤 수주를 막지 않는다. 포장 → 출고 사이 기다리는 날 → 출고 가능일 · 납기 판정.
   5) 자재: 그 자재를 쓰는 공정이 그 수주를 한 만큼 날마다 쓴다고 보고, 납기 순으로 쌓은 양이 재고 + 그날까지 올 입고 예정을 넘는 첫날 = 필요한 날
      (원료 입고 → 사출 · 리필 은 기다리는 날만큼 앞, 오늘 전일 수 있음) · 그날 쓰던 수주 = 처음 모자라는 수주. 발주 마감 = 필요한 날 − 리드타임 (품목 리드타임, 해외 주문 품목은 기본 리드타임).
   공정 안에서 품목마다 속도가 다른 것 · 금형 교체 · 설비 배정 · 인원은 아직 계산에 넣지 않는다 (평균 속도). 화면 (p_plan.js) · AI 비서 (production_plan) · 엑셀이 이 계산 하나를 쓴다. */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, C = ERP.calc, F = ERP.fmt;
  const P = ERP.plan = {};
  const num = C.num;
  const str = (x) => String(x === undefined || x === null ? '' : x).trim();
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isDate = (s) => /^\d{4}-\d\d-\d\d$/.test(String(s || ''));

  P.PROCS = ['INJ', 'REF', 'ASM', 'WRP', 'PCK'];
  P.HIST_DAYS = 91;          // 하루 능력을 재는 기간: 마지막 일보 날부터 91일 (약 3개월)
  P.HORIZON = 800;           // 앞으로 볼 근무일 수
  // 공정 사이 (앞 > 다음). 원료 입고 → 사출 · 리필 은 자재가 그만큼 먼저 와야 하는 날, 나머지는 앞 공정이 끝난 뒤 다음 공정까지
  P.WAITS = ['RAW>INJ', 'RAW>REF', 'INJ>ASM', 'REF>ASM', 'REF>WRP', 'ASM>PCK', 'WRP>PCK', 'PCK>OUT'];
  const WAIT_DEF = (k) => (k.indexOf('RAW>') === 0 ? 0 : 1);
  P.TABLES = ['po', 'prod_log', 'bom_lines', 'items', 'semi_stock', 'machines', 'buy_orders', 'plan_proc', 'plan_cal', 'plan_wait'];

  // 판정 (수주 · 자재): [한국어, 베트남어, 색]
  P.JUDGE = { late: ['지연 예상', 'Dự kiến trễ', 'bad'], tight: ['빠듯함', 'Sát hạn', 'warn'], ok: ['여유', 'Còn dư', 'ok'], past: ['이미 납기 지남', 'Đã quá hạn', 'bad'],
    nodue: ['납기 없음', 'Không có hạn', 'neutral'], na: ['계산 못 함', 'Không tính được', 'neutral'] };
  P.MJUDGE = { enough: ['충분', 'Đủ', 'ok'], nolead: ['리드타임 없음', 'Chưa có thời gian giao', 'warn'], late: ['늦음 — 지금 발주', 'Trễ — đặt ngay', 'bad'],
    week: ['이번 주 발주', 'Đặt trong tuần', 'warn'], ok: ['여유', 'Còn thời gian', 'ok'] };
  P.judgeName = (j) => { const x = P.JUDGE[j]; return x ? L(x[0], x[1]) : str(j); };
  P.judgeTone = (j) => (P.JUDGE[j] ? P.JUDGE[j][2] : 'neutral');
  P.mjudgeName = (j) => { const x = P.MJUDGE[j]; return x ? L(x[0], x[1]) : str(j); };
  P.mjudgeTone = (j) => (P.MJUDGE[j] ? P.MJUDGE[j][2] : 'neutral');
  P.waitName = (k) => { const [a, b] = k.split('>'); const n = (x) => (x === 'RAW' ? L('원료 · 부자재 입고', 'Nhập NL · vật tư') : x === 'OUT' ? L('출고 · 검사', 'Xuất · kiểm') : ERP.procName(x)); return n(a) + ' → ' + n(b); };

  /** 조립 품목군 이름: 일보 품목군 · 품목 라인 (INV.LINE_DIV) 을 같게 — ERP.normDiv (Regular → Dial) + 대소문자 */
  P.fam = function (d) {
    const t = str(ERP.normDiv ? ERP.normDiv(d) : d); if (!t || t === '-' || t === '–') return '';
    const canon = Object.values((ERP.inv && ERP.inv.LINE_DIV) || {}).find(v => v.toLowerCase() === t.toLowerCase());
    if (canon) return canon; if (t.toLowerCase() === 'click') return 'Click pencil';
    return /[a-z]/.test(t) && t === t.toLowerCase() ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  };
  P.famName = (f) => f || L('(품목군 없음)', '(chưa có nhóm)');
  P.loadName = (id) => { const [p, f] = String(id).split('|'); return ERP.procName(p) + (p === 'ASM' ? ' · ' + P.famName(f || '') : ''); };

  // ---------------------------------------------------------------- 기준 자료
  /** 기준 자료 (표 plan_proc · plan_cal · plan_wait + 설정 planSunOff) 에 기본값을 채운 것 */
  P.base = function () {
    const shift = {}, defect = {}, cap = {}, capFam = {}, people = {}, rowOf = {};
    P.PROCS.forEach(p => { shift[p] = { n: 1, dayH: null, nightH: null, breakM: null }; defect[p] = 0; });
    DB.rows('plan_proc').forEach(r => {
      const p = str(r.process).toUpperCase(); if (P.PROCS.indexOf(p) < 0) return; const f = str(r.division);
      if (f) { if (num(r.cap_day) > 0) capFam[P.fam(f)] = num(r.cap_day); return; }
      rowOf[p] = r;
      shift[p] = { n: num(r.shifts) > 0 ? num(r.shifts) : 1, dayH: num(r.day_h) > 0 ? num(r.day_h) : null, nightH: num(r.night_h) > 0 ? num(r.night_h) : null, breakM: num(r.break_min) > 0 ? num(r.break_min) : null };
      defect[p] = num(r.defect_pct) > 0 ? Math.min(50, num(r.defect_pct)) : 0;
      if (num(r.cap_day) > 0) { if (p === 'ASM') capFam[''] = num(r.cap_day); else cap[p] = num(r.cap_day); }   // 조립 공정 줄의 하루 능력 = 품목군 없는 조립
      people[p] ={ day: r.people_day, night: r.people_night, per: r.people_per, common: r.people_common };
    });
    const wait = {}, waitSet = {}; P.WAITS.forEach(k => { wait[k] = WAIT_DEF(k); });
    DB.rows('plan_wait').forEach(r => { const k = str(r.from).toUpperCase() + '>' + str(r.to).toUpperCase(); if (P.WAITS.indexOf(k) < 0 || r.days === undefined || r.days === null || r.days === '') return; wait[k] = Math.max(0, Math.round(num(r.days))); waitSet[k] = true; });
    const cal = new Map(); DB.rows('plan_cal').forEach(r => { if (isDate(r.date)) cal.set(r.date, r); });
    return { shift, defect, cap, capFam, people, rowOf, wait, waitSet, cal, sunOff: DB.setting('planSunOff', true) !== false,
      any: DB.rows('plan_proc').length + DB.rows('plan_cal').length + DB.rows('plan_wait').length > 0 };
  };
  const baseSig = () => ['plan_proc', 'plan_cal', 'plan_wait'].map(t => DB.ver[t] || 0).join('.') + '.' + (DB.setting('planSunOff', true) !== false ? 1 : 0);
  /** 근무일인가: 근무 달력 줄 (근무 O/X) → 없으면 일요일만 쉼 (planSunOff 를 끄면 매일 일함) */
  P.isWork = function (base, d) {
    const r = base.cal.get(d); if (r && r.work !== undefined && r.work !== null && r.work !== '') return r.work === true || r.work === 'true' || r.work === 1 || /^(o|y|yes|1|true)$/i.test(String(r.work));
    return !(base.sunOff && new Date(d + 'T00:00:00').getDay() === 0);
  };
  /** 그날 그 공정의 능력 배수: 달력의 조 수 ÷ 기본 조 수 × (1 + 잔업 ÷ (조당 일하는 시간 × 조 수)). 달력의 조 수 0 = 그날 그 공정은 쉼 (1.14.2) */
  const SH_KEY = { INJ: 'sh_inj', REF: 'sh_ref', ASM: 'sh_asm', WRP: 'sh_wrp', PCK: 'sh_pck' };
  P.SH_KEY = SH_KEY;
  P.shiftSet = (r, p) => { const v = r ? r[SH_KEY[p]] : undefined; return typeof v === 'number' ? v >= 0 : num(v) > 0; };   // 달력 줄에 그 공정 조 수가 있나 (0 포함)
  function dayFactor(base, p, d) {
    const r = base.cal.get(d); if (!r) return 1; const s = base.shift[p]; const n = s.n || 1;
    const sh = P.shiftSet(r, p) ? num(r[SH_KEY[p]]) : n; const hrs = s.dayH ? Math.max(1, s.dayH - (s.breakM || 0) / 60) : 10;
    return (sh / n) * (1 + Math.max(0, num(r.ot_h)) / (hrs * n));
  }

  // ---------------------------------------------------------------- 생산 일보 → 하루 능력
  const LOG_KEY = (r) => [r.date, r.process, r.shift || 'D', str(r.machine_no), str(r.machine), str(r.code), str(r.division), r.ok_qty, r.ok_ea, r.ng_qty, str(r.po_no), str(r.source)].join('|');
  /** 생산 일보 1줄의 pcs (포장은 pcs 칸만 — 세트를 pcs 로 세지 않음, 1.12.3) */
  P.qPcs = (r) => num(r.ok_ea) || (r.process === 'PCK' ? 0 : num(r.ok_qty));
  /** 하루 능력을 잴 일보 줄: 오늘까지 · 5 공정. 똑같은 줄은 한 번만, 같은 날 · 공정에 누적 이력 (history) 이 있으면 그날 일보 · ERP 양식 줄은 뺀다 (엑셀 업로드 규칙과 같음) */
  P.logRows = function () {
    const today = F.today();
    return cached('log', today + '|' + verSig(['prod_log']), () => {
      const all = DB.rows('prod_log'); const hist = new Set(); all.forEach(r => { if (r.source === 'history') hist.add(r.date + '|' + r.process); });
      const seen = new Set(), rows = [], fut = new Map(); let dup = 0, daily = 0, future = 0;
      all.forEach(r => {
        if (!isDate(r.date) || P.PROCS.indexOf(r.process) < 0) return;
        if (r.date > today) { future++; const k = r.process + '|' + r.date; fut.set(k, (fut.get(k) || 0) + 1); return; }
        const k = LOG_KEY(r); if (seen.has(k)) { dup++; return; } seen.add(k);
        if ((r.source === 'daily-report' || r.source === 'template') && hist.has(r.date + '|' + r.process)) { daily++; return; }
        rows.push(r);
      });
      return { rows, dup, daily, future, futureList: Array.from(fut.entries()).map(([k, n]) => { const [p, d] = k.split('|'); return { proc: p, date: d, rows: n }; }).sort((a, b) => a.date.localeCompare(b.date)) };
    });
  };
  // 계산 기억: 입력 (표 저장 번호 · 오늘 · 언어 · 앞 계산) 이 같으면 다시 계산하지 않는다. 열쇠를 늘리지 않게 이름마다 하나만 둔다
  const cache = {};
  const cached = (name, sig, fn) => { const c = cache[name]; if (c && c.sig === sig) return c.val; const val = fn(); cache[name] = { sig, val }; return val; };
  const verSig = (tables) => tables.map(t => DB.ver[t] || 0).join('.') + '|' + ERP.lang;
  /** 공정별 (조립은 품목군별) 하루 능력 */
  P.capacity = function (base) {
    base = base || P.base(); const lg = P.logRows();
    return cached('cap', F.today() + '|' + baseSig() + '|' + verSig(['prod_log', 'machines']), () => {
      const to = lg.rows.reduce((m, r) => (r.date > m ? r.date : m), ''); const from = to ? F.addDays(to, -P.HIST_DAYS) : '';
      const rec = to ? lg.rows.filter(r => r.date >= from && r.date <= to) : [];
      const last = {}; rec.forEach(r => { if (!last[r.process] || r.date > last[r.process]) last[r.process] = r.date; });
      const allDays = Array.from(new Set(rec.map(r => r.date))).sort();
      const days = {}, real = {}, fam = {}, shD = {}, runD = {}; let pckSets = 0;
      P.PROCS.forEach(p => { days[p] = last[p] ? allDays.filter(d => d <= last[p]).length : 0; real[p] = 0; shD[p] = new Set(); runD[p] = new Set(); });
      rec.forEach(r => { const q = P.qPcs(r); real[r.process] += q; if (r.process === 'PCK') pckSets += num(r.ok_qty);
        if (r.process === 'ASM') { const f = P.fam(r.division); fam[f] = (fam[f] || 0) + q; }
        if (q > 0) { shD[r.process].add(r.date + '|' + (r.shift === 'N' ? 'N' : 'D')); runD[r.process].add(r.date); } });
      // 그동안 하루 조 수 (일한 날 평균) — 계획 조 수가 다르면 그 비율로 능력을 바꾼다
      const histN = {}; P.PROCS.forEach(p => { histN[p] = runD[p].size ? Math.max(1, shD[p].size / runD[p].size) : 1; });
      const mult = (p) => (base.shift[p].n || 1) / histN[p];
      const logDay = {}, perDay = {}, src = {};
      P.PROCS.forEach(p => { if (p === 'ASM') return; logDay[p] = days[p] ? real[p] / days[p] : 0;
        if (base.cap[p] > 0) { perDay[p] = base.cap[p]; src[p] = 'manual'; } else { perDay[p] = logDay[p] * mult(p); src[p] = perDay[p] > 0 ? 'log' : 'none'; } });
      const famLog = {}, famDay = {}, famSrc = {}; const fams = new Set(Object.keys(fam).concat(Object.keys(base.capFam)));
      fams.forEach(f => { famLog[f] = days.ASM ? (fam[f] || 0) / days.ASM : 0;
        if (base.capFam[f] > 0) { famDay[f] = base.capFam[f]; famSrc[f] = 'manual'; } else { famDay[f] = famLog[f] * mult('ASM'); famSrc[f] = famDay[f] > 0 ? 'log' : 'none'; } });
      logDay.ASM = days.ASM ? real.ASM / days.ASM : 0; perDay.ASM = Object.values(famDay).reduce((a, v) => a + v, 0); src.ASM = Object.values(famSrc).some(s => s === 'manual') ? 'manual' : (perDay.ASM > 0 ? 'log' : 'none');
      // 설비 기준 최대 (설비 마스터: 사용 중 · 조당 표준 생산량 × 계획 조 수). 포장은 set
      const mach = {}, machFam = {}, machN = {};
      DB.rows('machines').forEach(m => { const p = str(m.process).toUpperCase(); if (P.PROCS.indexOf(p) < 0 || m.active === false || !(num(m.per_shift) > 0)) return;
        const v = num(m.per_shift) * (base.shift[p].n || 1); mach[p] = (mach[p] || 0) + v; machN[p] = (machN[p] || 0) + 1; if (p === 'ASM') { const f = P.fam(m.division); machFam[f] = (machFam[f] || 0) + v; } });
      return { from, to, days, last, real, fam, histN, logDay, perDay, src, famLog, famDay, famSrc, mach, machFam, machN, pckSetsDay: days.PCK ? pckSets / days.PCK : 0,
        dup: lg.dup, daily: lg.daily, future: lg.future, futureList: lg.futureList };
    });
  };

  // ---------------------------------------------------------------- 계획
  const procOfNote = (n) => { const t = String(n || '').toLowerCase();
    return /사출|ép nhựa|ep nhua/.test(t) ? 'INJ' : /리필|refill|ép lõi|ep loi/.test(t) ? 'REF' : /조립|lắp ráp|lap rap/.test(t) ? 'ASM' : /권취|quấn giấy|quan giay/.test(t) ? 'WRP' : /포장|đóng gói|dong goi/.test(t) ? 'PCK' : /원료|nguyên liệu|nguyen lieu/.test(t) ? 'RAW' : ''; };
  P.procOfNote = procOfNote;
  const leadOf = (it) => (num(it && it.lead_days) > 0 ? num(it.lead_days) : (it && it.buy && ERP.buy ? ERP.buy.lead() : null));
  P.leadOf = leadOf;
  const ids = new WeakMap(); let idN = 0; const idOf = (o) => { if (!o || typeof o !== 'object') return 0; let v = ids.get(o); if (!v) { v = ++idN; ids.set(o, v); } return v; };
  /** scope: 'all' (PO미정 포함, 기본) · 'firm' (확정 PO 만) */
  P.run = function (scope) {
    scope = scope === 'firm' ? 'firm' : 'all';
    const ords = C.orders(), st = C.stock();
    return cached('run:' + scope, [F.today(), idOf(ords), idOf(st), baseSig(), ERP.buy ? ERP.buy.lead() || '' : '', verSig(P.TABLES)].join('|'), () => compute(scope, P.base(), ords, st));
  };

  function compute(scope, base, ords, st) {
    const today = F.today(); const cap = P.capacity(base); const INV = ERP.inv; const IT = INV.items();
    const itemC = new Map();
    const item = (c) => { if (itemC.has(c)) return itemC.get(c); const it = IT.get(c); let x = null;
      if (it) { const inf = INV.info(it); x = { it, code: str(it.code), name: str(it.name), stage: inf.stage || '', line: inf.line || '', unit: str(it.unit), grp: INV.groupOf(Object.assign({ m: it }, inf)) }; }
      itemC.set(c, x); return x; };
    // 사용자 구성 BOM: 부모 → 자식, 자식을 만드는 공정 = 그 줄의 비고
    const kids = new Map(), madeBy = new Map();
    DB.rows('bom_lines').forEach(l => { const p = str(l.parent), c = str(l.child); if (!p || !c) return; let a = kids.get(p); if (!a) kids.set(p, a = []); a.push({ c, q: num(l.qty || 1), loss: num(l.loss) });
      const pr = procOfNote(l.note); if (pr && !madeBy.has(c)) madeBy.set(c, pr); });
    // 현장 재고 (MRP 와 같은 순서: 반제품(세미) 재고 → 현재고). 원부자재는 아래 자재에서 따로
    const semi = new Map(DB.rows('semi_stock').map(r => [str(r.code), num(r.qty)]));
    const pool = new Map(), fromStock = {};
    const poolOf = (c) => { if (!pool.has(c)) { const x = item(c); let q = 0; if (semi.has(c)) q = Math.max(0, semi.get(c)); else if (x && x.grp !== 'mat' && x.grp !== 'test' && st.has(x.code)) q = Math.max(0, num(st.get(x.code).bal)); pool.set(c, q); } return pool.get(c); };
    const dAllow = (p) => 1 / (1 - Math.min(50, base.defect[p] || 0) / 100);
    const famOfItem = (c) => { const x = item(c); return x && x.line ? P.fam(INV.LINE_DIV[x.line] || x.line) : ''; };
    // via = 그 자재를 쓰는 공정 (부모를 만드는 공정), fam = 그 공정이 조립이면 부모의 조립 품목군. 자재마다 by['공정' 또는 'ASM|품목군'] = 양 (1.14.2 — 자재가 필요한 날)
    function explode(code, qty, depth, acc, via, fam) {
      if (depth > 10 || !(qty > 0)) return;
      const x = item(code); const ch = kids.get(code) || []; const mk = depth === 0 ? 'PCK' : (madeBy.get(code) || '');
      if (depth > 0 && ((x && x.grp === 'mat') || mk === 'RAW' || (!x && !ch.length))) {   // 원부자재 (또는 품목에 없는 코드)
        const m = acc.mat[code] || (acc.mat[code] = { qty: 0, via, by: {} }); m.qty += qty; const k = via === 'ASM' ? 'ASM|' + (fam || '') : via; m.by[k] = (m.by[k] || 0) + qty; return; }
      let net = qty;
      if (depth > 0) { const have = poolOf(code); const t = Math.min(have, qty); pool.set(code, have - t); net = qty - t; if (t) fromStock[code] = (fromStock[code] || 0) + t; }
      if (depth > 0 && net > 0) {
        if (mk === 'ASM') { const f = famOfItem(code); acc.asm[f] = (acc.asm[f] || 0) + net * dAllow('ASM'); }
        else if (mk === 'INJ' || mk === 'REF' || mk === 'WRP') acc[mk] += net * dAllow(mk);
        else if (mk === '') acc.unknown[code] = (acc.unknown[code] || 0) + net;
      }
      // 불량률만큼 더 만든 양이 아래 (부품 · 자재) 로도 내려간다 (1.14.2). 포장 불량률은 맨 위 품목에서 한 번만 (중간에 포장 공정 품목이 있어도)
      const make = net * (depth === 0 ? dAllow('PCK') : (mk === 'ASM' || mk === 'INJ' || mk === 'REF' || mk === 'WRP') ? dAllow(mk) : 1);
      ch.forEach(k => explode(k.c, make * k.q * (1 + k.loss / 100), depth + 1, acc, depth === 0 ? 'PCK' : (mk || via), depth === 0 ? '' : mk === 'ASM' ? famOfItem(code) : mk ? '' : fam));
    }
    const capFams = new Set(Object.keys(cap.famDay).filter(f => cap.famDay[f] > 0));
    const ASM_FAM = ['Mini', 'Dial', 'Pencil', 'Click pencil'];
    // 진행 중 수주 줄 (납기 순)
    const ord = ords.filter(o => C.isOpen(o) && str(o.p.item_no) && (o.sets - o.packed) > 0).map(o => {
      const due = str(o.p.due).slice(0, 10);
      return { id: o.p._id, po: str(o.p.po_no), none: C.isPoNone(o.p.po_no), item: str(o.p.item_no), kind: str(o.p.kind), customer: str(o.p.customer), due: isDate(due) ? due : '', st: o.st,
        sets: o.sets, packed: Math.round(o.packed), rem: Math.round(o.sets - o.packed), pcs: num(o.p.pcs), color: num(o.p.color), units: ERP.mrpUnits ? ERP.mrpUnits(str(o.p.item_no)) : null };
    }).filter(o => scope === 'all' || !o.none)
      .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.po.localeCompare(b.po) || a.item.localeCompare(b.item));
    ord.forEach(o => {
      const acc = { INJ: 0, REF: 0, WRP: 0, asm: {}, mat: {}, unknown: {}, pck: 0, how: '', bom: true };
      const u = o.units; const pps = o.sets > 0 && o.pcs > 0 ? o.pcs / o.sets : o.color;
      if (u && u.sets > 0) { acc.pck = o.rem * (u.pens > 0 ? u.pens / u.sets : pps); explode(o.item, o.rem / u.sets, 0, acc, 'PCK'); acc.how = L('BOM (결과 품목 1개 = ' + u.sets + ' set)', 'BOM (1 SP = ' + u.sets + ' bộ)'); }
      else if (u && u.pens > 0) { const pcs = o.rem * (pps || 1); acc.pck = pcs; explode(o.item, pcs / u.pens, 0, acc, 'PCK'); acc.how = L('BOM (낱개 카톤 ' + u.pens + '개)', 'BOM (thùng lẻ ' + u.pens + ' cây)'); }
      else {   // BOM 없음: 수주의 품목군 · pcs 로 조립 (Glass 는 종이 권취) · 포장만
        acc.bom = false; const pcs = o.rem * (pps || 0); acc.pck = pcs; const f = P.fam(o.kind);
        if (f === 'Glass') acc.WRP += pcs * dAllow('PCK') * dAllow('WRP'); else if (ASM_FAM.indexOf(f) >= 0 || capFams.has(f)) acc.asm[f] = (acc.asm[f] || 0) + pcs * dAllow('PCK') * dAllow('ASM');
        acc.how = L('BOM 없음 — 수주 품목군 ' + (o.kind || '없음') + ' · pcs 로 ', 'Không có BOM — theo nhóm ' + (o.kind || '-') + ' · pcs: ') + (f === 'Glass' ? L('종이 권취 · 포장', 'quấn giấy · đóng gói') : acc.asm[f] ? L('조립 · 포장', 'lắp ráp · đóng gói') : L('포장', 'đóng gói')) + (pps ? '' : L(' (pcs 없음)', ' (không có pcs)'));
      }
      acc.pck *= dAllow('PCK'); o.acc = acc;
    });

    // 근무일 · 공정마다 쌓은 능력
    const WD = []; for (let d = today, i = 0; WD.length < P.HORIZON && i < P.HORIZON * 3; i++, d = F.addDays(d, 1)) if (P.isWork(base, d)) WD.push(d);
    const cumCap = (p, perDay) => { const a = []; let s = 0; WD.forEach(d => { s += perDay * dayFactor(base, p, d); a.push(s); }); return a; };
    const finishOf = (cum, load) => { if (!(load > 0)) return null; if (!cum || !(cum[cum.length - 1] > 0)) return 'nocap'; let lo = 0, hi = cum.length - 1; if (cum[hi] < load - 1e-9) return 'over'; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] >= load - 1e-9) hi = m; else lo = m + 1; } return WD[lo]; };
    // n 근무일 뒤 (앞). 오늘 전으로도 간다 — 원료가 필요한 날 (1.14.2)
    const addWork = (d, n) => { if (!isDate(d)) return d; let i = WD.findIndex(x => x >= d); if (i < 0) i = WD.length - 1; const j = i + n;
      if (j >= 0) return WD[Math.min(WD.length - 1, j)];
      let x = WD[0], k = -j; for (let s = 0; k > 0 && s < 3660; s++) { x = F.addDays(x, -1); if (P.isWork(base, x)) k--; } return x; };
    const maxD = (...a) => a.find(x => x && !isDate(x)) || a.filter(isDate).sort().pop() || null;   // 능력 모름 · 800일 넘음이 하나라도 있으면 그것 (날짜를 지어내지 않음)
    const CUM = { INJ: cumCap('INJ', cap.perDay.INJ || 0), REF: cumCap('REF', cap.perDay.REF || 0), WRP: cumCap('WRP', cap.perDay.WRP || 0), PCK: cumCap('PCK', cap.perDay.PCK || 0) };
    const CUMF = {}; Object.keys(cap.famDay).forEach(f => { if (cap.famDay[f] > 0) CUMF[f] = cumCap('ASM', cap.famDay[f]); });
    const W = (a, b) => base.wait[a + '>' + b] || 0;

    // 하루씩 공정을 같이 돌리기 (1.14.2, Codex 검토 2026-11-04) — 예전에는 공정마다 오늘부터 따로 쌓고 끝나는 날만 max 로 맞춰서,
    // 아직 못 하는 수주 (예: 권취를 기다리는 Glass) 의 포장을 먼저 세어 뒤 수주를 늦추고, 앞 공정이 시작하기 전에도 다음 공정이 그 수주를 한다고 봤다.
    // 이제 공정마다 그날 능력을 납기 순으로 나누되 앞 공정이 기다리는 날 전까지 내준 만큼만 한다 (겹쳐 진행 · 아직 못 하는 수주는 건너뜀).
    const TS = new Map(); let simDays = 0;
    (function simulate() {
      const res = new Map();
      const resOf = (id, proc, perDay) => { let r = res.get(id); if (!r) { const none = !(perDay > 0); res.set(id, r = { proc, none, day: none ? null : WD.map(d => perDay * dayFactor(base, proc, d)), tasks: [] }); } return r; };
      const task = (r, load, ups) => { const t = { r, load, ups, done: 0, hist: r.none ? null : [], start: null, fin: r.none ? 'nocap' : null }; r.tasks.push(t); return t; };
      ord.forEach(o => { const a = o.acc; const x = { asm: {} };
        if (a.INJ > 0) x.INJ = task(resOf('INJ', 'INJ', cap.perDay.INJ || 0), a.INJ, []);
        if (a.REF > 0) x.REF = task(resOf('REF', 'REF', cap.perDay.REF || 0), a.REF, []);
        const upA = [[x.INJ, W('INJ', 'ASM')], [x.REF, W('REF', 'ASM')]].filter(u => u[0]);
        Object.keys(a.asm).forEach(f => { if (a.asm[f] > 0) x.asm[f] = task(resOf('ASM|' + f, 'ASM', cap.famDay[f] || 0), a.asm[f], upA); });
        if (a.WRP > 0) x.WRP = task(resOf('WRP', 'WRP', cap.perDay.WRP || 0), a.WRP, x.REF ? [[x.REF, W('REF', 'WRP')]] : []);
        if (a.pck > 0) x.PCK = task(resOf('PCK', 'PCK', cap.perDay.PCK || 0), a.pck, Object.values(x.asm).map(t => [t, W('ASM', 'PCK')]).concat(x.WRP ? [[x.WRP, W('WRP', 'PCK')]] : []));
        TS.set(o, x); });
      // 앞 공정부터 (사출 · 리필 → 조립 품목군마다 → 권취 → 포장). 하루 능력을 모르는 공정은 돌리지 않고 (끝 = 능력 모름) 다음 공정을 막지도 않는다
      const seq = ['INJ', 'REF'].concat(Array.from(res.keys()).filter(k => k.indexOf('ASM|') === 0).sort(), ['WRP', 'PCK']).map(k => res.get(k)).filter(r => r && !r.none);
      const frac = (u, i) => { const t = u[0]; if (!t.hist) return 1; const j = i - u[1]; return j < 0 ? 0 : t.hist[Math.min(j, t.hist.length - 1)] / t.load; };
      let left = seq.reduce((s, r) => s + r.tasks.length, 0);
      for (let i = 0; i < WD.length && left > 0; i++) {
        seq.forEach(r => { let c = r.day[i];
          for (const t of r.tasks) { if (t.fin) continue; if (!(c > 1e-9)) break;
            const can = t.load * Math.min(1, t.ups.length ? Math.min.apply(null, t.ups.map(u => frac(u, i))) : 1) - t.done; if (!(can > 1e-9)) continue;
            const take = Math.min(can, c); t.done += take; c -= take; if (!t.start) t.start = WD[i]; if (t.done >= t.load - 1e-6) { t.done = t.load; t.fin = WD[i]; left--; } }
          r.tasks.forEach(t => { t.hist[i] = t.done; }); });
        simDays = i + 1;
      }
      seq.forEach(r => r.tasks.forEach(t => { if (!t.fin) t.fin = 'over'; }));
    })();

    // 끝나는 날 · 출고 가능일 · 판정
    const tot = { INJ: 0, REF: 0, WRP: 0, PCK: 0, asm: {} };   // 공정별 부하 (표)
    ord.forEach(o => { const a = o.acc; const x = TS.get(o); const fin = (t) => (t ? t.fin : null), sta = (t) => (t ? t.start : null);
      tot.INJ += a.INJ; tot.REF += a.REF; tot.WRP += a.WRP; tot.PCK += a.pck; Object.keys(a.asm).forEach(f => { tot.asm[f] = (tot.asm[f] || 0) + a.asm[f]; });
      const Fd = { INJ: fin(x.INJ), REF: fin(x.REF), WRP: fin(x.WRP), PCK: fin(x.PCK), asm: {} }; Object.keys(x.asm).forEach(f => { Fd.asm[f] = x.asm[f].fin; });
      const fa = Object.values(Fd.asm); Fd.ASM = fa.length ? (fa.find(v => !isDate(v)) || fa.sort().pop()) : null;
      const asmEff = Fd.ASM ? maxD(Fd.ASM, Fd.INJ ? addWork(Fd.INJ, W('INJ', 'ASM')) : null, Fd.REF ? addWork(Fd.REF, W('REF', 'ASM')) : null) : null;
      const wrpEff = Fd.WRP ? maxD(Fd.WRP, Fd.REF ? addWork(Fd.REF, W('REF', 'WRP')) : null) : null;
      const pckEff = maxD(Fd.PCK, asmEff ? addWork(asmEff, W('ASM', 'PCK')) : null, wrpEff ? addWork(wrpEff, W('WRP', 'PCK')) : null);
      o.F = Fd; o.asmEff = asmEff; o.wrpEff = wrpEff; o.pckEff = pckEff; o.ship = isDate(pckEff) ? addWork(pckEff, W('PCK', 'OUT')) : (pckEff || null);
      o.start = { INJ: sta(x.INJ), REF: sta(x.REF), WRP: sta(x.WRP), PCK: sta(x.PCK), asm: {} }; Object.keys(x.asm).forEach(f => { o.start.asm[f] = x.asm[f].start; });
      // 끝을 정한 공정: 포장부터 거슬러 올라가며, 앞 공정이 마지막으로 내준 다음 날 바로 끝났으면 그 앞 공정 탓
      const cand = [['PCK', Fd.PCK], ['ASM', Fd.ASM], ['WRP', Fd.WRP], ['INJ', Fd.INJ], ['REF', Fd.REF]].filter(v => isDate(v[1])).sort((p, q) => q[1].localeCompare(p[1]));
      o.limit = !isDate(o.ship) && o.ship ? (Fd.ASM && !isDate(Fd.ASM) ? 'ASM' : '') : (cand.length ? cand[0][0] : '');
      if (isDate(o.ship)) { let t = x.PCK || Object.values(x.asm)[0] || x.WRP || x.INJ || x.REF;
        for (let g = 0; t && g < 6; g++) { const b = t.ups.filter(u => isDate(u[0].fin)).map(u => [u[0], addWork(u[0].fin, u[1])]).sort((p, q) => q[1].localeCompare(p[1]))[0]; if (b && isDate(t.fin) && b[1] >= t.fin) t = b[0]; else break; }
        if (t) o.limit = t.r.proc; }
      if (!o.due) o.judge = 'nodue'; else if (!isDate(o.ship)) o.judge = 'na';
      else { o.slack = F.diffDays(o.due, o.ship); o.judge = o.due < today ? 'past' : o.slack >= 7 ? 'ok' : o.slack >= 0 ? 'tight' : 'late'; }
    });

    // 공정별 부하 · 병목
    const loads = [];
    const pushLoad = (id, load, perDay, cum, mach, srcK, logDay) => { const days = perDay > 0 ? load / perDay : null;
      loads.push({ id, proc: id.split('|')[0], fam: id.indexOf('|') > 0 ? id.split('|')[1] : null, load, perDay, logDay, days, end: load > 0 ? finishOf(cum, load) : null, src: srcK, mach: mach || null, daysMach: mach > 0 && load > 0 ? load / mach : null }); };
    pushLoad('INJ', tot.INJ, cap.perDay.INJ, CUM.INJ, cap.mach.INJ, cap.src.INJ, cap.logDay.INJ);
    pushLoad('REF', tot.REF, cap.perDay.REF, CUM.REF, cap.mach.REF, cap.src.REF, cap.logDay.REF);
    Array.from(new Set(Object.keys(cap.famDay).concat(Object.keys(tot.asm)))).sort((a, b) => (ASM_FAM.indexOf(a) < 0 ? 99 : ASM_FAM.indexOf(a)) - (ASM_FAM.indexOf(b) < 0 ? 99 : ASM_FAM.indexOf(b)) || a.localeCompare(b)).forEach(f => {
      if (!(tot.asm[f] > 0) && !(cap.famDay[f] > 0)) return; pushLoad('ASM|' + f, tot.asm[f] || 0, cap.famDay[f] || 0, CUMF[f], cap.machFam[f], cap.famSrc[f] || 'none', cap.famLog[f] || 0); });
    pushLoad('WRP', tot.WRP, cap.perDay.WRP, CUM.WRP, cap.mach.WRP, cap.src.WRP, cap.logDay.WRP);
    pushLoad('PCK', tot.PCK, cap.perDay.PCK, CUM.PCK, null, cap.src.PCK, cap.logDay.PCK);
    const bottle = loads.filter(r => r.load > 0 && r.days !== null).sort((a, b) => b.days - a.days)[0] || null;

    // 자재: 날마다 쓰는 양 (그 공정이 그 수주를 한 만큼) 을 쌓아 재고 + 그날까지 올 입고 예정을 넘는 첫날 (1.14.2 — 예전: 그 수주를 시작하는 날)
    const inc = new Map();
    DB.rows('buy_orders').forEach(o => { if (o.status === 'recv' || o.pool) return; const x = item(str(o.code)); if (!x) return; let q = num(o.qty);
      if (o.unit && ERP.buy) { const v = ERP.buy.toErp(x.it, q, o.unit); if (v === null) return; q = v; }
      const lead = leadOf(x.it); const eta = isDate(str(o.eta)) ? str(o.eta) : (o.kind !== 'inc' && lead && isDate(o.date) ? F.addDays(o.date, lead) : '');
      let a = inc.get(x.code); if (!a) inc.set(x.code, a = []); a.push({ qty: q, eta }); });
    const matAll = new Map(); ord.forEach(o => Object.keys(o.acc.mat).forEach(c => { let m = matAll.get(c); if (!m) matAll.set(c, m = { need: 0, via: o.acc.mat[c].via }); m.need += o.acc.mat[c].qty; }));
    // 수주 o 가 자재 q 를 key (공정 · 조립은 'ASM|품목군') 에서 쓰는 [필요한 날, 양] — 그 공정 · 품목군이 그 수주를 한 만큼 날마다. 원료 입고 → 사출 · 리필 은 기다리는 날만큼 앞.
    // 그 공정 일이 없거나 능력을 모르면 오늘 한꺼번에. 800 근무일 안에 다 못 한 나머지는 마지막 근무일 (그 뒤에 씀 — 빠뜨리면 모자람이 "충분" 으로 보임)
    const useOf = (o, key, q) => { const x = TS.get(o); const via = key.split('|')[0]; const t = via === 'ASM' ? x.asm[key.slice(4)] : x[via]; const w = via === 'INJ' || via === 'REF' ? W('RAW', via) : 0;
      if (!t || !t.hist || !(t.load > 0)) return [[addWork(WD[0] || today, -w), q]];
      const out = []; let prev = 0;
      for (let i = 0; i < simDays; i++) { const f = t.hist[Math.min(i, t.hist.length - 1)] / t.load; if (f > prev + 1e-12) { out.push([addWork(WD[i], -w), q * (f - prev)]); prev = f; } if (f >= 1 - 1e-12) break; }
      if (prev < 1 - 1e-9) out.push([addWork(WD[WD.length - 1], -w), q * (1 - prev)]);
      return out; };
    const mats = Array.from(matAll.entries()).map(([c, m]) => {
      const x = item(c); const code = x ? x.code : c; const s = st.get(code); const stock = Math.max(0, s ? num(s.bal) : 0);
      const incs = inc.get(code) || []; const incQty = incs.reduce((a, v) => a + v.qty, 0); const incNoEta = incs.filter(v => !v.eta).reduce((a, v) => a + v.qty, 0);
      const lead = x ? leadOf(x.it) : null;
      const ev = []; ord.forEach((o, k) => { const u = o.acc.mat[c]; if (u && u.qty > 0) Object.keys(u.by).forEach(key => useOf(o, key, u.by[key]).forEach(e => ev.push({ d: e[0], q: e[1], k, o }))); });
      ev.sort((a, b) => a.d.localeCompare(b.d) || a.k - b.k);
      const incD = incs.filter(v => v.eta).sort((a, b) => a.eta.localeCompare(b.eta));
      let cum = 0, got = stock, ii = 0, first = null;
      for (const e of ev) { cum += e.q; while (ii < incD.length && incD[ii].eta <= e.d) got += incD[ii++].qty;
        if (cum > got + 1e-9) { first = { po: e.o.po, item: e.o.item, due: e.o.due, date: e.d, line: e.o.id }; break; } }
      const short = Math.max(0, m.need - stock - incQty);
      const orderBy = first && lead ? F.addDays(first.date, -lead) : null;
      const judge = !first ? 'enough' : !lead ? 'nolead' : orderBy < today ? 'late' : F.diffDays(orderBy, today) <= 7 ? 'week' : 'ok';
      return { code, name: x ? x.name : (s ? str(s.name) : ''), stage: x ? x.stage : '', unit: x ? (INV.unitShow(x.unit) || x.unit) : (s ? s.prim : ''), via: m.via, need: m.need, stock, inc: incQty, incNoEta, short, first, lead, orderBy,
        arrive: first && lead && judge === 'late' ? F.addDays(today, lead) : null, judge, item: x ? x.it : null };
    }).sort((a, b) => (b.first ? 1 : 0) - (a.first ? 1 : 0) || String((a.first || {}).date || '').localeCompare(String((b.first || {}).date || '')) || b.short - a.short || a.code.localeCompare(b.code));

    const count = (j) => ord.filter(o => o.judge === j).length;
    const unknown = {}; ord.forEach(o => Object.keys(o.acc.unknown).forEach(c => { unknown[c] = (unknown[c] || 0) + o.acc.unknown[c]; }));
    const R = { scope, today, base, cap, orders: ord, loads, bottle, mats, unknown, fromStock: Object.values(fromStock).reduce((a, v) => a + v, 0), fromStockN: Object.keys(fromStock).length,
      counts: { late: count('late'), tight: count('tight'), ok: count('ok'), past: count('past'), nodue: count('nodue'), na: count('na') },
      remSets: ord.reduce((a, o) => a + o.rem, 0), lastShip: ord.map(o => o.ship).filter(isDate).sort().pop() || null, workDays: WD.slice(0, 200) };
    R.short = mats.filter(m => m.first); R.urgent = mats.filter(m => m.judge === 'late' || m.judge === 'week');
    R.notes = notesOf(R);
    return R;
  }

  // ---------------------------------------------------------------- 확인할 것
  function notesOf(R) {
    const out = []; const cap = R.cap; const n = (x) => F.n(x); const add = (k, tone, title, text, why) => out.push({ k, tone, title, text, why });
    if (!cap.to) add('nolog', 'bad', L('생산 일보 없음', 'Chưa có báo cáo SX'), L('최근 생산 일보가 없어 하루 능력을 모릅니다.', 'Không có báo cáo sản xuất nên chưa biết năng lực/ngày.'), L('생산 관리 · 엑셀 업로드에서 일보를 올리거나, 기준 자료에 하루 능력을 직접 넣어 주세요.', 'Hãy tải báo cáo hoặc nhập năng lực/ngày ở dữ liệu chuẩn.'));
    if (cap.dup || cap.daily) add('dup', 'warn', L('겹친 일보 줄', 'Dòng báo cáo trùng'), L('똑같은 일보 줄 ' + n(cap.dup) + '줄' + (cap.daily ? ' · 누적 이력과 같은 날의 일보 줄 ' + n(cap.daily) + '줄' : '') + ' 은 하루 능력에 한 번만 셌습니다.', 'Dòng trùng hệt ' + n(cap.dup) + (cap.daily ? ' · dòng báo cáo ngày trùng sổ tổng hợp ' + n(cap.daily) : '') + ' chỉ tính một lần.'),
      L('같은 파일을 두 번 올렸거나 누적 이력을 더하기로 올린 것일 수 있습니다. 생산 관리 화면의 숫자는 겹친 줄까지 셉니다.', 'Có thể đã tải cùng file hai lần. Màn hình sản xuất vẫn tính cả dòng trùng.'));
    if (cap.future) add('future', 'warn', L('앞날 날짜의 일보', 'Báo cáo ngày tương lai'), cap.futureList.map(x => ERP.procName(x.proc) + ' ' + x.date + ' (' + x.rows + L('줄', ' dòng') + ')').join(' · '), L('날짜를 잘못 적은 것 같습니다 (예: 10-27 ↔ 11-27). 계산에서는 뺐습니다.', 'Có thể nhập sai ngày. Đã bỏ khỏi tính toán.'));
    // 일보 실적이 설비 기준 최대와 크게 다른 공정 (일보가 잘못 들어갔을 수 있음)
    P.PROCS.filter(p => p !== 'PCK').forEach(p => { const a = cap.logDay[p], m = cap.mach[p]; if (!(m > 0) || cap.src[p] === 'manual' || !cap.days[p]) return; const r = a / m;
      if (r < 0.1 || r > 3) add('odd:' + p, r < 0.1 ? 'bad' : 'warn', L('일보 실적 확인 — ', 'Kiểm tra báo cáo — ') + ERP.procName(p), L('최근 3개월 일보 실적 하루 ' + n(a) + ' pcs 가 설비 기준 최대 (하루 ' + n(m) + ') 의 ' + F.n(r * 100, 1) + '% 입니다.', 'Báo cáo 3 tháng: ' + n(a) + ' pcs/ngày = ' + F.n(r * 100, 1) + '% so với tối đa theo máy (' + n(m) + ').'),
        L('일보가 잘못 들어갔거나 (칸을 잘못 읽음 · 두 번 올림) 설비 마스터의 조당 표준이 틀렸을 수 있습니다. 맞는 값을 알면 기준 자료에 하루 능력을 직접 넣어 주세요.', 'Có thể báo cáo bị đọc sai / tải hai lần hoặc SL chuẩn của máy sai. Có thể nhập trực tiếp năng lực/ngày.')); });
    if (cap.to) add('last', 'neutral', L('마지막 일보', 'Báo cáo gần nhất'), P.PROCS.map(p => ERP.procName(p) + ' ' + (cap.last[p] || '–')).join(' · '), L('그 뒤 (~ ' + R.today + ') 에 만든 양은 빠져 있어 남은 일이 실제보다 조금 많게 계산됩니다. 일보를 올리면 바로 다시 계산합니다.', 'Phần làm sau ngày đó chưa có nên việc còn lại có thể nhiều hơn thực tế.'));
    const past = R.orders.filter(o => o.due && o.due < R.today);
    if (past.length) add('past', 'warn', L('납기가 이미 지난 진행 중 수주 ', 'PO quá hạn còn mở ') + past.length, past.slice(0, 30).map(o => o.po + ' ' + o.item + ' (' + (o.customer || '–') + ', ' + o.due + ', ' + n(o.rem) + ' set)').join(' · ') + (past.length > 30 ? ' …' : ''),
      L('납기 순이라 계산에서 맨 앞에 쌓여 다른 수주를 늦춥니다. 이미 만들었거나 출고했으면 수주 관리에서 완료, 취소 · 보류면 그렇게 표시해 주세요.', 'Được xếp đầu tiên nên làm chậm PO khác. Nếu đã làm xong / xuất hàng thì đánh dấu hoàn thành, hủy · tạm dừng thì ghi rõ.'));
    const none = R.orders.filter(o => o.none);
    if (none.length) { const dn = {}; none.forEach(o => { const d = o.due || L('납기 없음', 'không có hạn'); dn[d] = (dn[d] || 0) + 1; });
      add('none', 'info', L('PO미정 수주 ', 'PO chưa có số ') + none.length, L('남은 ' + n(none.reduce((a, o) => a + o.rem, 0)) + ' set · 납기 ', 'Còn ' + n(none.reduce((a, o) => a + o.rem, 0)) + ' bộ · hạn ') + Object.keys(dn).sort().map(d => d + ' ' + dn[d] + L('줄', ' dòng')).join(' · '),
        L('확정 전 계획이면 납기가 실제와 다를 수 있습니다. 위의 [확정 PO 만] 으로 빼고 볼 수 있습니다.', 'Nếu là kế hoạch chưa chốt thì hạn có thể khác. Xem [Chỉ PO đã chốt] để bỏ ra.')); }
    const noBom = R.orders.filter(o => !o.acc.bom);
    if (noBom.length) add('nobom', 'warn', L('BOM 없는 품번 ', 'Mã chưa có BOM ') + new Set(noBom.map(o => o.item)).size, Array.from(new Set(noBom.map(o => o.item))).join(', '),
      L('수주의 품목군 · pcs 로 조립 (Glass 는 종이 권취) · 포장만 셌습니다. 사출 · 리필 · 자재는 계산되지 않습니다.', 'Chỉ tính lắp ráp (Glass: quấn giấy) · đóng gói theo nhóm · pcs của PO. Không tính ép · lõi · vật tư.')
      + (noBom.some(o => !(o.acc.pck > 0)) ? L(' pcs 가 0 이라 계산 못 한 줄: ', ' Dòng không có pcs: ') + noBom.filter(o => !(o.acc.pck > 0)).map(o => o.po + ' ' + o.item).join(' · ') : ''));
    const unk = Object.keys(R.unknown); if (unk.length) add('unknown', 'warn', L('공정 모르는 BOM 품목 ', 'Mã BOM chưa rõ công đoạn ') + unk.length, unk.slice(0, 12).join(', ') + (unk.length > 12 ? ' …' : ''), L('BOM 줄 비고에 만드는 공정이 없어 어느 공정 일인지 모릅니다 (부하에 넣지 않음). 제품 · BOM 에서 비고를 넣어 주세요.', 'Ghi chú dòng BOM chưa có công đoạn nên chưa tính tải.'));
    const nocap = R.loads.filter(r => r.load > 0 && !(r.perDay > 0)); if (nocap.length) add('nocap', 'bad', L('하루 능력을 모르는 공정', 'Chưa biết năng lực'), nocap.map(r => P.loadName(r.id) + ' ' + n(r.load) + ' pcs').join(' · '), L('최근 일보에 그 공정 · 품목군 실적이 없습니다. 기준 자료에 하루 능력을 직접 넣어 주세요.', 'Báo cáo gần đây không có công đoạn · nhóm này. Hãy nhập năng lực/ngày.'));
    const oddFam = Object.keys(cap.famLog).filter(f => cap.famLog[f] > 0 && ['Mini', 'Dial', 'Pencil', 'Click pencil', 'Glass', 'Marker'].indexOf(f) < 0);
    if (oddFam.length) add('fam', 'neutral', L('조립 품목군 이름', 'Tên nhóm lắp ráp'), L('일보의 조립 품목군에 ', 'Báo cáo lắp ráp có nhóm ') + oddFam.map(P.famName).join(' · ') + L(' 이 있습니다 (따로 셉니다).', ' (tính riêng).'), L('다른 품목군과 같은 설비라면 그 품목군의 하루 능력에 더해 기준 자료에 직접 넣어 주세요.', 'Nếu cùng máy với nhóm khác, hãy cộng vào và nhập năng lực trực tiếp.'));
    const noLead = R.mats.filter(m => m.first && !m.lead); if (noLead.length) add('nolead', 'warn', L('리드타임 없는 모자랄 자재 ', 'Vật tư sẽ thiếu chưa có thời gian giao ') + noLead.length, noLead.slice(0, 12).map(m => m.code).join(', ') + (noLead.length > 12 ? ' …' : ''), L('자재 탭에서 리드타임 (발주 → 입고 일수) 을 넣으면 발주 마감일이 나옵니다.', 'Nhập thời gian giao ở tab vật tư để có hạn đặt hàng.'));
    if (!R.base.any) add('base', 'info', L('기준 자료 없음', 'Chưa có dữ liệu chuẩn'), L('조 수 1 · 공정 사이 1일 · 불량률 0% · 일요일 쉼 (기본값) 으로 계산했습니다.', 'Đang tính với mặc định: 1 ca · chờ 1 ngày · lỗi 0% · nghỉ Chủ nhật.'), L('기준 자료 탭에서 고치거나 생산계획_기준자료_양식 엑셀을 올려 주세요.', 'Hãy sửa ở tab dữ liệu chuẩn hoặc tải file mẫu dữ liệu chuẩn.'));
    const offs = Array.from(R.base.cal.values()).filter(r => r.date >= R.today && r.date <= F.addDays(R.today, 180) && !P.isWork(R.base, r.date) && new Date(r.date + 'T00:00:00').getDay() !== 0);
    if (!offs.length) add('holiday', 'info', L('쉬는 날', 'Ngày nghỉ'), L('앞으로 6개월에 일요일 말고 쉬는 날이 없습니다.', '6 tháng tới không có ngày nghỉ ngoài Chủ nhật.'), L('설 (Tết) 등 회사 휴무를 기준 자료 → 쉬는 날에 넣어 주세요. 그만큼 완료일이 늦어집니다.', 'Hãy thêm ngày nghỉ (Tết …) ở dữ liệu chuẩn.'));
    const noPeople = P.PROCS.every(p => { const x = R.base.people[p]; return !x || !(num(x.day) > 0 || num(x.night) > 0); });
    if (noPeople) add('people', 'neutral', L('인원', 'Nhân lực'), L('공정 · 조별 인원이 없습니다 (계산에는 아직 쓰지 않음).', 'Chưa có số người theo công đoạn · ca (chưa dùng để tính).'), L('지금 계산은 일보 실적 (지금 인원으로 해 온 양) 기준입니다. 인원을 넣어 두면 설비를 더 돌릴 수 있는지 볼 때 씁니다.', 'Tính theo kết quả báo cáo (với số người hiện tại).'));
    return out;
  }

  // ---------------------------------------------------------------- 찾기 (AI 비서)
  /** PO 번호 · 품번으로 진행 중 수주 줄 찾기 (정확히 같은 것 → 들어 있는 것) */
  P.find = function (R, q) {
    const k = str(q).toLowerCase(); if (!k) return [];
    const eq = R.orders.filter(o => o.po.toLowerCase() === k || o.item.toLowerCase() === k); if (eq.length) return eq;
    return R.orders.filter(o => o.po.toLowerCase().includes(k) || o.item.toLowerCase().includes(k) || o.customer.toLowerCase().includes(k));
  };

  // ---------------------------------------------------------------- 엑셀 (시트 → aoa)
  const r2 = (v) => (v === null || v === undefined || isNaN(v) ? null : Math.round(v * 100) / 100);
  const r0 = (v) => (v === null || v === undefined || isNaN(v) ? null : Math.round(v));
  const dOr = (d) => (isDate(d) ? d : d === 'nocap' ? L('능력 모름', 'chưa biết NL') : d === 'over' ? L('800일 넘음', '> 800 ngày') : (d || ''));
  P.dateText = dOr;
  /** 계획 결과 → 시트 목록 [{ name, aoa, cols }] (A = 보이는 범위, B = 다른 범위 — 요약에 같이) */
  P.sheets = function (A, B) {
    const sm = (R) => R ? [R.orders.length + L('줄 · 남은 ', ' dòng · còn ') + F.n(R.remSets) + ' set', R.lastShip || '–', R.bottle ? P.loadName(R.bottle.id) + ' — ' + F.n(R.bottle.load) + ' pcs ÷ ' + F.n(R.bottle.perDay) + L('/일 = ', '/ngày = ') + F.n(R.bottle.days, 1) + L('근무일 (끝 ', ' ngày (xong ') + dOr(R.bottle.end) + ')' : '–',
      R.counts.late, R.counts.tight, R.counts.ok, R.counts.past, R.counts.na, R.short.length, R.urgent.length] : [];
    const scopeName = (R) => (R.scope === 'firm' ? L('확정 PO 만', 'Chỉ PO đã chốt') : L('PO미정 포함', 'Gồm PO chưa có số'));
    const a = sm(A), b = sm(B);
    const lab = [L('진행 중 수주', 'PO đang mở'), L('전부 출고 가능 (계산)', 'Xuất hết (dự kiến)'), L('가장 막히는 공정', 'Công đoạn nghẽn nhất'), L('지연 예상 (줄)', 'Dự kiến trễ (dòng)'), L('빠듯함 (줄)', 'Sát hạn (dòng)'), L('여유 (줄)', 'Còn dư (dòng)'),
      L('이미 납기 지남 (줄)', 'Đã quá hạn (dòng)'), L('계산 못 함 (줄)', 'Không tính được (dòng)'), L('모자랄 자재 (종)', 'Vật tư sẽ thiếu (mã)'), L('급한 자재 (종)', 'Vật tư gấp (mã)')];
    const cap = A.cap;
    const summary = [[L('생산 계획 — ', 'Kế hoạch sản xuất — ') + A.today + ' · ERP ' + ERP.v], [], ['', scopeName(A), B ? scopeName(B) : '']].concat(lab.map((l, i) => [l, a[i], B ? b[i] : '']))
      .concat([[], [L('하루 능력', 'Năng lực / ngày'), L('생산 일보 ', 'Báo cáo ') + (cap.from || '–') + ' ~ ' + (cap.to || '–') + L(' 실적 ÷ 공장이 일한 날 (조립은 품목군별) × 계획 조 수 ÷ 그동안 하루 조 수, 또는 기준 자료에 직접 넣은 값', ' ÷ số ngày làm × số ca KH ÷ số ca thực tế, hoặc giá trị nhập')],
        [L('계산 방법', 'Cách tính'), L('진행 중 수주를 납기 순으로 BOM 을 풀어 공정별로 쌓음 (현장 재고는 납기 이른 수주부터) → 공정 사이 기다리는 날 → 포장 → 출고. 공정 안의 품목별 속도 · 금형 교체 · 설비 배정 · 인원은 아직 보지 않는 대강의 계획입니다.', 'Xếp PO theo hạn, tách BOM theo công đoạn → chờ giữa công đoạn → đóng gói → xuất. Kế hoạch sơ bộ (tốc độ trung bình).')]]);
    const ordAoa = [[L('순서', 'Thứ tự'), 'PO', L('품번', 'Mã hàng'), L('품목군', 'Nhóm'), L('거래처', 'Khách hàng'), L('남은 set', 'Còn (bộ)'), L('포장 pcs (남은)', 'Đóng gói pcs (còn)'), L('납기', 'Hạn giao'),
      L('사출 끝', 'Xong ép'), L('리필 끝', 'Xong lõi'), L('조립 끝', 'Xong lắp ráp'), L('권취 끝', 'Xong quấn'), L('포장 끝', 'Xong đóng gói'), L('출고 가능일', 'Ngày xuất được'), L('납기 여유 (일)', 'Dư (ngày)'), L('판정', 'Đánh giá'), L('끝을 정한 공정', 'Công đoạn quyết định'), L('계산 근거', 'Cơ sở tính')]]
      .concat(A.orders.map((o, i) => [i + 1, o.po, o.item, o.kind, o.customer, o.rem, r0(o.acc.pck), o.due, dOr(o.F.INJ), dOr(o.F.REF), dOr(o.asmEff), dOr(o.wrpEff), dOr(o.pckEff), dOr(o.ship), o.slack === undefined ? null : o.slack, P.judgeName(o.judge), o.limit ? ERP.procName(o.limit) : '', o.acc.how]));
    const loadAoa = [[L('공정 · 품목군', 'Công đoạn · nhóm'), L('남은 일 (현장 재고 뺀 뒤, pcs)', 'Việc còn (pcs)'), L('하루 능력 (계산에 씀)', 'Năng lực / ngày'), L('능력 출처', 'Nguồn'), L('일보 실적 하루', 'Báo cáo / ngày'), L('걸리는 근무일', 'Số ngày làm'), L('끝나는 날', 'Ngày xong'), L('설비 기준 최대 하루', 'Tối đa theo máy / ngày'), L('걸리는 근무일 (설비 기준)', 'Số ngày (theo máy)')]]
      .concat(A.loads.map(r => [P.loadName(r.id), r0(r.load), r0(r.perDay), r.src === 'manual' ? L('직접 넣음', 'nhập tay') : r.src === 'log' ? L('일보 실적', 'báo cáo') : L('없음', 'không có'), r0(r.logDay), r2(r.days), dOr(r.end), r.proc === 'PCK' ? (cap.mach.PCK ? r0(cap.mach.PCK) + ' set' : '') : r0(r.mach), r2(r.daysMach)]))
      .concat([[], [L('포장 하루 실적 (참고)', 'Đóng gói / ngày (tham khảo)'), r0(cap.pckSetsDay) + ' set'], [L('현장 재고에서 쓴 양 (참고)', 'Dùng từ tồn hiện trường'), r0(A.fromStock), A.fromStockN + L('품목', ' mã')]]);
    const matAoa = [[L('품목코드', 'Mã'), L('품명', 'Tên'), L('단계', 'Loại'), L('단위', 'ĐV'), L('쓰는 공정', 'Công đoạn dùng'), L('필요량', 'Cần'), L('지금 재고', 'Tồn'), L('입고 예정', 'Sắp nhập'), L('모자람', 'Thiếu'), L('처음 모자라는 수주', 'PO thiếu đầu tiên'), L('그 수주 납기', 'Hạn PO đó'), L('필요한 날', 'Ngày cần'), L('리드타임 (일)', 'Thời gian giao'), L('발주 마감일', 'Hạn đặt'), L('판정', 'Đánh giá')]]
      .concat(A.mats.map(m => [m.code, m.name, m.stage, m.unit, ERP.procName(m.via), r2(m.need), r2(m.stock), r2(m.inc) || null, r2(m.short), m.first ? m.first.po + ' ' + m.first.item : '', m.first ? m.first.due : '', m.first ? m.first.date : '', m.lead, m.orderBy, P.mjudgeName(m.judge) + (m.arrive ? ' (' + L('도착 ', 'đến ') + m.arrive + ')' : '')]));
    const capAoa = [[L('공정 · 품목군', 'Công đoạn · nhóm'), L('일보 실적 합', 'Tổng báo cáo') + ' (' + (cap.from || '') + ' ~ ' + (cap.to || '') + ')', L('일한 날', 'Số ngày'), L('일보 실적 하루', 'Báo cáo / ngày'), L('그동안 하루 조 수', 'Số ca TB'), L('계획 조 수', 'Số ca KH'), L('계산에 쓰는 하루', 'Dùng để tính / ngày'), L('설비 (사용 · 조당 표준 있음)', 'Máy (đang dùng · có SL chuẩn)'), L('설비 기준 최대 하루', 'Tối đa theo máy')]]
      .concat(P.PROCS.map(p => [ERP.procName(p), r0(cap.real[p]), cap.days[p], r0(cap.logDay[p]), r2(cap.histN[p]), A.base.shift[p].n, r0(cap.perDay[p]), cap.machN[p] || 0, p === 'PCK' ? (cap.mach.PCK ? r0(cap.mach.PCK) + ' set' : '') : r0(cap.mach[p])]))
      .concat(Object.keys(cap.famDay).sort().map(f => [ERP.procName('ASM') + ' · ' + P.famName(f), r0(cap.fam[f] || 0), cap.days.ASM, r0(cap.famLog[f]), '', '', r0(cap.famDay[f]), '', r0(cap.machFam[f])]));
    const noteAoa = [[L('무엇', 'Mục'), L('내용', 'Nội dung'), L('왜 · 할 일', 'Vì sao · cần làm')]].concat(A.notes.map(x => [x.title, x.text, x.why]));
    return [{ name: L('요약', 'Tóm tắt'), aoa: summary, cols: [30, 70, 70] }, { name: L('수주별 완료 예상', 'Dự kiến theo PO'), aoa: ordAoa, cols: [6, 14, 16, 10, 14, 10, 12, 11, 11, 11, 11, 11, 11, 12, 9, 12, 12, 34] },
      { name: L('공정별 부하', 'Tải công đoạn'), aoa: loadAoa, cols: [24, 18, 16, 12, 14, 12, 12, 18, 16] }, { name: L('자재', 'Vật tư'), aoa: matAoa, cols: [16, 30, 7, 6, 12, 14, 12, 12, 12, 26, 11, 11, 10, 12, 26] },
      { name: L('능력 근거', 'Cơ sở năng lực'), aoa: capAoa, cols: [26, 22, 8, 14, 12, 10, 16, 18, 16] }, { name: L('확인할 것', 'Cần kiểm tra'), aoa: noteAoa, cols: [26, 90, 80] }];
  };
})();
