/* 종합 현황 (Tổng quan) — 7차: 스마트폰 위젯처럼 꾸미는 화면.
   · 위젯을 추가·삭제하고, 끌어서(또는 ◀ ▶) 순서를 바꾸고, 가로 크기(1~4칸)를 고른다. 배치는 설정(meta.dash)에 저장되어 백업에 포함된다.
   · 위젯 정의: ERP.widgets[id] = { ko, vi, dko, dvi, cat, w, sizes, multi, opts, defaults, render(ctx, inst), go(ctx, inst) }
   · ctx 는 한 번 그릴 때 필요한 숫자만 그때 계산한다 (lazy). */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, C = ERP.calc, F = ERP.fmt;

  ERP.ddayChip = function (dd, st) {
    if (st === 'done') return ERP.chip('ok', L('완료', 'Xong'));
    if (dd === null || dd === undefined) return ERP.chip('neutral', '–');
    if (dd < 0) return ERP.chip('bad', L('지연 ' + (-dd) + '일', 'Trễ ' + (-dd) + ' ngày'));
    if (dd === 0) return ERP.chip('bad', 'D-Day');
    if (dd <= 3) return ERP.chip('warn', 'D-' + dd);
    return ERP.chip('neutral', 'D-' + dd);
  };
  ERP.statusChip = function (st) {
    return { done: ERP.chip('ok', L('완료', 'Hoàn thành')), late: ERP.chip('bad', L('납기 경과', 'Quá hạn')), prod: ERP.chip('info', L('생산 중', 'Đang SX')), wait: ERP.chip('neutral', L('대기', 'Chờ')) }[st];
  };

  // ---------------------------------------------------------------- helpers
  const addM = (ym, k) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + k, 1)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
  const short = (v) => (v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : v);
  const WS = ERP.state.dashW = ERP.state.dashW || {};               // per-widget view state (month / year), not saved
  const wstate = (k, def) => (WS[k] = WS[k] || Object.assign({}, def));
  const box = (title, right, ...kids) => h('section', { class: 'card wcard' }, h('div', { class: 'card-head' }, h('h2', title), right ? h('div', { class: 'whead-r' }, right) : null), kids);
  const seg = (opts, cur, fn) => h('div', { class: 'seg' }, opts.map(o => h('button', { type: 'button', class: 'btn sm' + (cur === o[0] ? ' primary' : ''), onclick: (e) => { e.stopPropagation(); fn(o[0]); } }, o[1])));
  const nav = (label, prev, next) => h('span', { class: 'wnav' }, h('button', { type: 'button', class: 'btn sm', onclick: prev, 'aria-label': 'prev' }, '‹'), h('b', label), h('button', { type: 'button', class: 'btn sm', onclick: next, 'aria-label': 'next' }, '›'));
  const procOpts = () => ERP.PROC.map(p => [p.id, L(p.ko, p.vi)]);

  // ---------------------------------------------------------------- shared numbers (computed only when a widget asks)
  function makeCtx(ref) {
    const ctx = { ref, today: F.today() };
    const lazy = (k, fn) => Object.defineProperty(ctx, k, { configurable: true, enumerable: true, get() { const v = fn(); Object.defineProperty(ctx, k, { value: v, enumerable: true }); return v; } });
    lazy('ix', () => C.prodIndex());
    lazy('dayRows', () => ctx.ix.byDate.get(ref) || []);
    lazy('byProc', () => { const o = {}; ERP.PROC.forEach(p => { o[p.id] = C.agg(ctx.dayRows.filter(r => r.process === p.id)); }); return o; });
    lazy('avg', () => { const prev = C.dailySeries(F.addDays(ref, -14), F.addDays(ref, -1)); const o = {}; ERP.PROC.forEach(p => { const v = prev.series[p.id].filter(x => x > 0); o[p.id] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; }); return o; });
    lazy('mStart', () => ref.slice(0, 8) + '01');
    lazy('orders', () => C.poGroups());
    lazy('open', () => ctx.orders.filter(o => o.st !== 'done'));
    lazy('late', () => ctx.open.filter(o => o.st === 'late' && o.dday !== null && o.dday >= -60));
    lazy('soon', () => ctx.open.filter(o => o.soon));
    lazy('stock', () => C.stock());
    lazy('low', () => Array.from(ctx.stock.values()).filter(s => s.status === 'low' || s.status === 'neg'));
    lazy('seen30', () => { const o = {}; C.rowsBetween(F.addDays(ref, -29), ref).forEach(r => { if (r.machine_no !== undefined && r.machine_no !== null) (o[r.process] = o[r.process] || new Set()).add(String(r.machine_no)); }); return o; });
    ctx.machTotal = (pid) => { const reg = DB.rows('machines').filter(m => m.process === pid && m.active !== false).length; return reg || (ctx.seen30[pid] ? ctx.seen30[pid].size : 0); };
    ctx.machRun = (pid) => Array.from((ctx.byProc[pid] || C.agg([])).machines).filter(k => k.indexOf(pid + ':') === 0).length;
    ctx.monthAgg = (pid, from, to) => C.agg(C.rowsBetween(from, to, pid));
    return ctx;
  }
  const valOf = (p, a) => ((p.id === 'PCK' || p.unit === 'set') ? a.ok : a.ea);
  const unitOf = (p) => ((p.id === 'PCK' || p.unit === 'set') ? L('세트', 'bộ') : 'pcs');
  const procById = (id) => ERP.PROC.find(p => p.id === id) || ERP.PROC.find(p => p.id === 'ASM') || ERP.PROC[0];
  /** same window of the previous month (1st … same day) */
  const prevMonthWindow = (ref) => { const mStart = ref.slice(0, 8) + '01'; const pmLast = F.addDays(mStart, -1); const pm = pmLast.slice(0, 8) + '01'; const pmEnd = pmLast.slice(0, 8) + ref.slice(8, 10); return [pm, pmEnd < pmLast ? pmEnd : pmLast]; };

  // ---------------------------------------------------------------- widget registry
  const W = ERP.widgets = {};
  const reg = (id, def) => { W[id] = Object.assign({ id, sizes: [1, 2, 3, 4], w: 2, cat: 'etc' }, def); };
  ERP.WIDGET_CATS = () => [['kpi', L('숫자 위젯 (작게)', 'Ô số (nhỏ)')], ['prod', L('생산', 'Sản xuất')], ['order', L('수주', 'Đơn hàng')], ['stock', L('재고', 'Tồn kho')], ['etc', L('기타', 'Khác')]];

  // ===== KPI widgets (1칸)
  reg('kpi_pck_day', { ko: '기준일 포장 실적', vi: 'Đóng gói trong ngày', dko: '기준일 포장 세트 수와 최근 평균 대비', dvi: 'Số bộ đóng gói và so với TB', cat: 'kpi', w: 1, sizes: [1, 2],
    go: () => () => ERP.goto('production'),
    render(ctx) { const a = ctx.byProc.PCK || C.agg([]); const av = ctx.avg.PCK;
      return ERP.kpi(L('기준일 포장 실적', 'Đóng gói trong ngày'), F.n(a.ok), L('세트', 'bộ'), a.n ? (av && a.ea >= av * 0.9 ? 'ok' : 'warn') : 'neutral', a.n ? (av ? F.n(a.ea / av * 100, 0) + L('% (최근 평균 대비)', '% so với TB') : L('기록', 'Có dữ liệu')) : L('기록 없음', 'Chưa có'), F.n(a.ea) + ' pcs', av ? Math.min(100, a.ea / av * 100) : 0, 'info'); } });
  reg('kpi_pck_month', { ko: '이번 달 포장 누계', vi: 'Đóng gói lũy kế tháng', dko: '이번 달 포장 세트 누계 · 전월 같은 기간 대비', dvi: 'Lũy kế tháng · so với cùng kỳ', cat: 'kpi', w: 1, sizes: [1, 2],
    go: () => () => ERP.goto('production'),
    render(ctx) { const m = ctx.monthAgg('PCK', ctx.mStart, ctx.ref); const pw = prevMonthWindow(ctx.ref); const p = ctx.monthAgg('PCK', pw[0], pw[1]);
      return ERP.kpi(L('이번 달 포장 누계', 'Đóng gói lũy kế tháng'), F.n(m.ok), L('세트', 'bộ'), 'neutral', p.ok ? (m.ok >= p.ok ? '▲ ' : '▼ ') + F.n(Math.abs(m.ok / p.ok - 1) * 100, 0) + '%' : '–', L('전월 동기 대비', 'so với cùng kỳ tháng trước')); } });
  reg('kpi_due', { ko: '납기 임박 / 경과 PO', vi: 'PO sắp / quá hạn', dko: '7일 내 납기 + 납기 경과(60일 이내) PO 수', dvi: 'PO đến hạn ≤7 ngày + quá hạn ≤60 ngày', cat: 'kpi', w: 1, sizes: [1, 2],
    go: () => () => { ERP.state.ord = Object.assign(ERP.state.ord || { view: 'po' }, { tab: 'late' }); ERP.goto('orders'); },
    render(ctx) { const late = ctx.late, soon = ctx.soon, open = ctx.open;
      return ERP.kpi(L('납기 임박 / 경과 PO', 'PO sắp / quá hạn'), F.n(soon.length + late.length), L('건', 'đơn'), late.length ? 'bad' : (soon.length ? 'warn' : 'ok'), late.length ? L('경과 ' + late.length, 'Quá hạn ' + late.length) : L('정상', 'Bình thường'), L('7일 내 납기 ' + soon.length + '건 · 진행 중 ' + open.length + '건', '≤7 ngày: ' + soon.length + ' · đang mở: ' + open.length)); } });
  reg('kpi_low', { ko: '안전재고 미달 자재', vi: 'NVL dưới tồn an toàn', dko: '안전재고보다 적거나 마이너스인 품목', dvi: 'Mã dưới tồn an toàn hoặc âm', cat: 'kpi', w: 1, sizes: [1, 2],
    go: () => () => { ERP.state.matTab = 'reorder'; ERP.goto('materials'); },
    render(ctx) { const n = ctx.low.length; return ERP.kpi(L('안전재고 미달 자재', 'NVL dưới tồn an toàn'), F.n(n), L('품목', 'mã'), n ? 'bad' : 'ok', n ? L('경고', 'Cảnh báo') : L('정상', 'Tốt'), L('품목·재고 → 발주 · 안전재고', 'Hàng hóa · Tồn kho → Đặt hàng')); } });
  reg('kpi_proc', { ko: '공정 실적 (기준일)', vi: 'Sản lượng công đoạn (ngày)', dko: '고른 공정의 기준일 생산량 · 가동 설비 (설정에서 공정 선택)', dvi: 'Sản lượng ngày của công đoạn đã chọn', cat: 'kpi', w: 1, sizes: [1, 2], multi: true, defaults: { proc: 'ASM' },
    opts: [{ k: 'proc', ko: '공정', vi: 'Công đoạn', options: procOpts }],
    go: () => () => ERP.goto('production'),
    render(ctx, inst) { const p = procById((inst.o || {}).proc || 'ASM'); const a = ctx.byProc[p.id] || C.agg([]); const av = ctx.avg[p.id]; const run = ctx.machRun(p.id), tot = Math.max(ctx.machTotal(p.id), run);
      return ERP.kpi(L('기준일 ' + p.ko + ' 실적', 'Sản lượng ' + p.vi + ' (ngày)'), F.n(valOf(p, a)), unitOf(p), a.n ? (av && a.ea >= av * 0.9 ? 'ok' : 'warn') : 'neutral', a.n ? (av ? F.n(a.ea / av * 100, 0) + L('% (최근 평균 대비)', '% so với TB') : L('기록', 'Có dữ liệu')) : L('기록 없음', 'Chưa có'), L('설비 가동 ', 'Máy chạy ') + F.n(run) + ' / ' + F.n(tot), av ? Math.min(100, a.ea / av * 100) : 0, 'info'); } });
  reg('kpi_proc_month', { ko: '공정 이번 달 누계', vi: 'Lũy kế tháng của công đoạn', dko: '고른 공정의 이번 달 누계 · 전월 같은 기간 대비', dvi: 'Lũy kế tháng · so với cùng kỳ', cat: 'kpi', w: 1, sizes: [1, 2], multi: true, defaults: { proc: 'ASM' },
    opts: [{ k: 'proc', ko: '공정', vi: 'Công đoạn', options: procOpts }],
    go: () => () => ERP.goto('production'),
    render(ctx, inst) { const p = procById((inst.o || {}).proc || 'ASM'); const m = ctx.monthAgg(p.id, ctx.mStart, ctx.ref); const pw = prevMonthWindow(ctx.ref); const q = ctx.monthAgg(p.id, pw[0], pw[1]); const v = valOf(p, m), pv = valOf(p, q);
      return ERP.kpi(L('이번 달 ' + p.ko + ' 누계', p.vi + ' lũy kế tháng'), F.n(v), unitOf(p), 'neutral', pv ? (v >= pv ? '▲ ' : '▼ ') + F.n(Math.abs(v / pv - 1) * 100, 0) + '%' : '–', L('전월 동기 대비', 'so với cùng kỳ tháng trước')); } });
  reg('kpi_open', { ko: '진행 중 PO', vi: 'PO đang mở', dko: '완료되지 않은 PO 수 · 남은 세트', dvi: 'Số PO chưa xong · bộ còn lại', cat: 'kpi', w: 1, sizes: [1, 2],
    go: () => () => { ERP.state.ord = Object.assign(ERP.state.ord || { view: 'po' }, { tab: 'open' }); ERP.goto('orders'); },
    render(ctx) { const o = ctx.open; const prod = o.filter(x => x.st === 'prod').length; const rem = o.reduce((a, x) => a + Math.max(0, x.sets - x.packed), 0);
      return ERP.kpi(L('진행 중 PO', 'PO đang mở'), F.n(o.length), L('건', 'đơn'), 'neutral', L('생산 중 ' + prod, 'Đang SX ' + prod), L('남은 ', 'Còn ') + F.n(rem) + ' set'); } });
  reg('kpi_orders_month', { ko: '이번 달 수주량 (Checking)', vi: 'Đơn hàng tháng này (Checking)', dko: 'Checking(납기) 일이 이번 달인 수주 pcs · 전월 대비', dvi: 'Tổng pcs có ngày Checking trong tháng', cat: 'kpi', w: 1, sizes: [1, 2],
    go: () => () => ERP.goto('orders'),
    render(ctx) { const m = C.monthlyPO('due'); const ym = ctx.ref.slice(0, 7), pm = addM(ym, -1); const shown = new Set(C.poKindsShown()); const sum = (k) => Object.entries(m[k] || {}).reduce((a, [kd, v]) => a + (shown.has(kd) ? v : 0), 0); const v = sum(ym), pv = sum(pm);
      return ERP.kpi(L('이번 달 수주량 (Checking)', 'Đơn hàng tháng (Checking)'), F.n(v), 'pcs', 'info', pv ? (v >= pv ? '▲ ' : '▼ ') + F.n(Math.abs(v / pv - 1) * 100, 0) + L('% 전월 대비', '% so với tháng trước') : '–', ym); } });
  reg('kpi_new_po', { ko: '이번 달 신규 수주', vi: 'PO mới trong tháng', dko: '수주일이 이번 달인 수주 pcs', dvi: 'Tổng pcs có ngày đặt trong tháng', cat: 'kpi', w: 1, sizes: [1, 2],
    go: () => () => ERP.goto('orders'),
    render(ctx) { const rows = DB.rows('po').filter(p => String(p.date || '') >= ctx.mStart && String(p.date || '') <= ctx.ref); return ERP.kpi(L('이번 달 신규 수주', 'PO mới trong tháng'), F.n(rows.reduce((a, p) => a + C.num(p.pcs), 0)), 'pcs', 'info', new Set(rows.map(p => p.po_no)).size + L('건', ' đơn'), L('수주일 기준', 'theo ngày đặt')); } });
  reg('kpi_ng', { ko: '불량률 (기준일)', vi: 'Tỷ lệ lỗi (ngày)', dko: '기준일 전체 공정 불량률', dvi: 'Tỷ lệ lỗi các công đoạn trong ngày', cat: 'kpi', w: 1, sizes: [1, 2],
    go: () => () => ERP.goto('production'),
    render(ctx) { const a = C.agg(ctx.dayRows); const r = a.ngRate; return ERP.kpi(L('불량률 (기준일)', 'Tỷ lệ lỗi (ngày)'), r === null ? '–' : F.n(r * 100, 2), '%', r === null ? 'neutral' : r >= 0.03 ? 'bad' : r >= 0.01 ? 'warn' : 'ok', r === null ? L('기록 없음', 'Chưa có') : (r >= 0.03 ? L('높음', 'Cao') : L('양호', 'Tốt')), L('불량 ', 'Lỗi ') + F.n(a.ng) + ' / ' + F.n(a.ea + a.ng)); } });
  reg('kpi_mach', { ko: '가동 설비 (가동 / 전체)', vi: 'Máy chạy (chạy / tổng)', dko: '기준일 일보가 있는 설비 수 / 등록 설비 수', dvi: 'Số máy có báo cáo / tổng số máy', cat: 'kpi', w: 1, sizes: [1, 2],
    go: () => () => { ERP.state.prodTab = 'machines'; ERP.goto('production'); },
    render(ctx) { let run = 0, tot = 0; ERP.dashProcs().forEach(p => { const r = ctx.machRun(p.id); run += r; tot += Math.max(ctx.machTotal(p.id), r); });
      return ERP.kpi(L('가동 설비 (가동 / 전체)', 'Máy chạy (chạy / tổng)'), F.n(run) + ' / ' + F.n(tot), L('대', 'máy'), run ? 'ok' : 'neutral', tot ? F.n(run / tot * 100, 0) + '%' : '–', ctx.ref, tot ? run / tot * 100 : 0, 'ok'); } });
  reg('kpi_neg', { ko: '마이너스 재고', vi: 'Tồn âm', dko: '합계가 마이너스인 품목 (원부자재 · 생산현장)', dvi: 'Mã có tồn âm (NVL · hiện trường)', cat: 'kpi', w: 1, sizes: [1, 2],
    go: () => () => { ERP.state.matTab = 'mat'; ERP.state.stk_mat = Object.assign(ERP.state.stk_mat || {}, { status: 'neg', page: 0 }); ERP.goto('materials'); },
    render() { const rows = ERP.inv.rows(); const a = rows.filter(s => s.negative && ERP.inv.groupOf(s) === 'mat').length, b = rows.filter(s => s.negative && ERP.inv.groupOf(s) === 'floor').length;
      return ERP.kpi(L('마이너스 재고', 'Tồn âm'), F.n(a + b), L('품목', 'mã'), a + b ? 'bad' : 'ok', L('원부자재 ', 'NVL ') + a, L('생산현장 ', 'Hiện trường ') + b); } });
  reg('kpi_susp', { ko: '이동 누락 의심', vi: 'Nghi thiếu phiếu chuyển', dko: '창고 +, 공장 − (또는 반대)인 품목', dvi: 'Kho + / Xưởng − (hoặc ngược lại)', cat: 'kpi', w: 1, sizes: [1, 2],
    go: () => () => { ERP.state.matTab = 'check'; ERP.goto('materials'); },
    render() { const n = ERP.inv.rows().filter(s => s.susp).length; return ERP.kpi(L('이동 누락 의심', 'Nghi thiếu phiếu chuyển'), F.n(n), L('품목', 'mã'), n ? 'warn' : 'ok', n ? L('자료 점검에서 정리', 'Xử lý ở Kiểm tra') : L('없음', 'Không có'), L('한쪽 +, 다른 쪽 −', 'Một bên +, bên kia −')); } });
  reg('kpi_post', { ko: '생산 반영 (재고)', vi: 'Cập nhật SX vào tồn', dko: '생산일보 → 재고 입고 · 부품 차감 건수와 해결할 항목', dvi: 'Số dòng nhập · trừ linh kiện từ báo cáo SX', cat: 'kpi', w: 1, sizes: [1, 2],
    go: () => () => { ERP.state.matTab = 'post'; ERP.goto('materials'); },
    render() { const pp = ERP.inv.prodPost(); const d = pp.diag; const issues = d.notItem.size + d.noBom.size + d.missingPart.size + d.rawUnmatched.size + d.noConv.size;
      return ERP.kpi(L('생산 반영 (재고)', 'Cập nhật SX vào tồn'), F.n(d.prod), L('건 입고', 'dòng nhập'), issues ? 'warn' : 'ok', issues ? L('해결할 항목 ' + issues, 'Cần xử lý ' + issues) : L('정상', 'Tốt'), L('부품·원료 차감 ', 'Trừ linh kiện ') + F.n(d.use) + L('건', ' dòng')); } });

  // ===== production
  reg('procs', { ko: '공정별 실적', vi: 'Kết quả theo công đoạn', dko: '공정마다 기준일 생산량 · 최근 평균 대비 · 설비 (가동 / 전체)', dvi: 'Sản lượng từng công đoạn · máy chạy / tổng', cat: 'prod', w: 4, sizes: [2, 3, 4],
    render(ctx) {
      return box(L('공정별 실적 · ', 'Kết quả theo công đoạn · ') + ctx.ref + ' (' + F.dow(ctx.ref) + ')', null, h('div', { class: 'cards6' }, ERP.dashProcs().map(p => {
        const a = ctx.byProc[p.id] || C.agg([]); const av = ctx.avg[p.id]; const run = ctx.machRun(p.id); const tot = Math.max(ctx.machTotal(p.id), run);
        return h('div', { class: 'card stage', style: { borderTop: '3px solid ' + p.color } },
          h('div', { class: 't' }, h('b', L(p.ko, p.vi)), ERP.chip(a.n ? 'ok' : 'neutral', a.n ? L('기록 있음', 'Có dữ liệu') : L('기록 없음', 'Chưa có'))),
          h('div', { class: 'kpi-val' }, h('span', { class: 'v' }, F.n(valOf(p, a))), h('span', { class: 'u' }, unitOf(p))),
          ERP.bar(av ? Math.min(100, a.ea / av * 100) : 0, a.n ? 'ok' : 'neutral'),
          h('dl', h('dt', L('최근 평균 대비', 'So với TB')), h('dd', av ? F.n(a.ea / av * 100, 0) + '%' : '–'),
            h('dt', L('설비 (가동 / 전체)', 'Máy (chạy / tổng)')), h('dd', h('b', { style: { color: run ? '#0E7A5F' : '' } }, F.n(run)), L(' 대 / ', ' máy / '), h('b', F.n(tot)), L(' 대', ' máy'))));
      })));
    } });
  reg('asm_daily', { ko: '일별 조립 생산량 (월)', vi: 'Sản lượng lắp ráp theo ngày (tháng)', dko: '한 달 동안 날짜별 · 품목군별 조립 양품 수량(pcs). ‹ › 로 달 이동, 표/차트 전환', dvi: 'Sản lượng lắp ráp theo ngày · nhóm hàng trong tháng', cat: 'prod', w: 4, sizes: [2, 3, 4], multi: true, defaults: { proc: 'ASM', view: 'table' },
    opts: [{ k: 'proc', ko: '공정 (기본 조립)', vi: 'Công đoạn (mặc định lắp ráp)', options: procOpts }],
    render(ctx, inst) {
      const o = inst.o || {}; const p = procById(o.proc || 'ASM'); const view = o.view || 'table';
      const S = wstate(inst.k, { month: ctx.ref.slice(0, 7) }); const mm = S.month;
      const from = mm + '-01', to = F.addDays(addM(mm, 1) + '-01', -1); const rows = C.rowsBetween(from, to, p.id);
      const canon = new Map(); const keyOf = (d) => { const raw = String(d || '').trim(); const k = raw.toLowerCase() || '–'; if (!canon.has(k)) canon.set(k, raw || L('(품목군 없음)', '(không nhóm)')); return k; };
      const cell = {}, tot = {}, dayTot = {}; let grand = 0;
      rows.forEach(r => { const k = keyOf(r.division); const q = (p.id === 'PCK' || p.unit === 'set') ? C.num(r.ok_qty) : C.qty(r); const d = +String(r.date).slice(8, 10); (cell[k] = cell[k] || {})[d] = (cell[k][d] || 0) + q; tot[k] = (tot[k] || 0) + q; dayTot[d] = (dayTot[d] || 0) + q; grand += q; });
      const lastDay = +to.slice(8, 10); const dataDays = Object.keys(dayTot).map(Number); const endDay = mm === ctx.ref.slice(0, 7) ? Math.max(+ctx.ref.slice(8, 10), dataDays.length ? Math.max.apply(null, dataDays) : 0) : lastDay;
      const days = []; for (let d = 1; d <= Math.min(endDay, lastDay); d++) days.push(d);
      const divs = Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
      const u = unitOf(p); const active = dataDays.length;
      const dow = (d) => new Date(mm + '-' + String(d).padStart(2, '0') + 'T00:00:00').getDay();
      const right = [nav(mm, () => { S.month = addM(S.month, -1); ERP.render(); }, () => { S.month = addM(S.month, 1); ERP.render(); }),
        seg([['table', L('표', 'Bảng')], ['chart', L('차트', 'Biểu đồ')]], view, (v) => { setOpt(inst.k, { view: v }); })];
      let body;
      if (!rows.length) body = h('div', { class: 'empty' }, L(mm + ' 에 입력된 ' + p.ko + ' 일보가 없습니다.', 'Không có báo cáo ' + p.vi + ' trong ' + mm + '.'));
      else if (view === 'chart') body = ERP.chart({ type: 'bar', data: { labels: days.map(String), datasets: divs.map((k, i) => ({ label: canon.get(k), data: days.map(d => (cell[k] && cell[k][d]) || 0), backgroundColor: ERP.palette[i % ERP.palette.length], stack: 's' })) }, options: { scales: { x: { stacked: true, ticks: { maxRotation: 0 } }, y: { stacked: true, ticks: { callback: short } } } } }, true);
      else body = h('div', { class: 'tbl-wrap dtw' }, h('table', { class: 'tbl dt' },
        h('thead', h('tr', h('th', L('품목군', 'Nhóm')), h('th', { class: 'num' }, L('월 합계', 'Tổng tháng')), days.map(d => h('th', { class: 'num' + (dow(d) === 0 ? ' sun' : '') }, String(d), h('small', F.dow(mm + '-' + String(d).padStart(2, '0'))))))),
        h('tbody', divs.map(k => h('tr', h('td', h('b', canon.get(k))), h('td', { class: 'num' }, h('b', F.n(tot[k]))), days.map(d => h('td', { class: 'num' + (dow(d) === 0 ? ' sun' : '') }, cell[k] && cell[k][d] ? F.n(cell[k][d]) : h('span', { class: 'muted' }, '·'))))),
          h('tr', { class: 'tot' }, h('td', L('일 합계', 'Tổng ngày')), h('td', { class: 'num' }, F.n(grand)), days.map(d => h('td', { class: 'num' + (dow(d) === 0 ? ' sun' : '') }, dayTot[d] ? F.n(dayTot[d]) : '·'))))));
      return box(L('일별 ' + p.ko + ' 생산량 · ', 'Sản lượng ' + p.vi + ' theo ngày · ') + mm, right, body,
        h('p', { class: 'help', style: { margin: '8px 0 0' } }, L('월 합계 ', 'Tổng tháng ') + F.n(grand) + ' ' + u + ' · ' + L('입력된 날 ', 'Số ngày có dữ liệu ') + active + L('일 · 일 평균 ', ' · TB/ngày ') + F.n(active ? grand / active : 0) + ' ' + u + ' · ' + L('생산일보 양품 기준', 'theo SL đạt của báo cáo')));
    } });
  reg('trend30', { ko: '공정별 생산 추이 (30일)', vi: 'Xu hướng sản lượng (30 ngày)', dko: '최근 30일 공정별 일 생산량 (pcs 환산) 선 그래프', dvi: 'Biểu đồ 30 ngày theo công đoạn', cat: 'prod', w: 2, sizes: [2, 3, 4],
    render(ctx) { const ds = C.dailySeries(F.addDays(ctx.ref, -29), ctx.ref);
      return box(L('공정별 생산 추이 (최근 30일, pcs 환산)', 'Sản lượng 30 ngày (quy đổi pcs)'), null, ERP.chart({ type: 'line', data: { labels: ds.days.map(d => F.md(d)), datasets: ERP.PROC.map(p => ({ label: L(p.ko, p.vi), data: ds.series[p.id], borderColor: p.color, backgroundColor: p.color, borderWidth: 1.8, pointRadius: 0, tension: .25 })) }, options: { scales: { y: { ticks: { callback: short } }, x: { ticks: { maxTicksLimit: 10 } } } } }, true)); } });
  reg('input7', { ko: '일보 입력 현황 (7일)', vi: 'Tình hình nhập báo cáo (7 ngày)', dko: '최근 7일 공정별로 일보가 들어왔는지', dvi: 'Báo cáo đã nhập 7 ngày gần nhất', cat: 'prod', w: 2, sizes: [2, 3, 4],
    render(ctx) { const days7 = []; for (let i = 6; i >= 0; i--) days7.push(F.addDays(ctx.ref, -i));
      return box(L('일보 입력 현황 (최근 7일)', 'Tình hình nhập báo cáo (7 ngày)'), h('a', { href: '#/production' }, L('일보 입력 →', 'Nhập báo cáo →')),
        ERP.simpleTable([{ label: L('공정', 'Công đoạn'), render: p => h('b', { style: { color: p.color } }, L(p.ko, p.vi)) }].concat(days7.map(d => ({ label: F.md(d) + ' ' + F.dow(d), num: 1, render: p => { const n = (ctx.ix.byDate.get(d) || []).filter(r => r.process === p.id).length; return n ? ERP.chip('ok', n + L('건', '')) : h('span', { class: 'muted' }, '–'); } }))), ERP.PROC, {}),
        h('p', { class: 'help' }, L('숫자 = 그날 입력된 일보 행 수. "–" 는 아직 입력·업로드되지 않은 날입니다.', 'Số = số dòng báo cáo trong ngày. "–" là chưa nhập/tải.'))); } });

  // ===== orders
  /** 품목군 chips (multi-select, shared with the orders screen) */
  ERP.kindChips = function (onChange) {
    const kinds = C.poKinds(); const shown = new Set(C.poKindsShown()); const all = kinds.every(k => shown.has(k));
    return h('div', { class: 'kchips', role: 'group', 'aria-label': L('보고 싶은 품목군', 'Nhóm hàng muốn xem') },
      h('button', { type: 'button', class: 'kc all' + (all ? ' on' : ''), onclick: (e) => { e.stopPropagation(); C.setPoKindsShown(all ? [] : kinds); onChange(); } }, all ? L('✓ 전체', '✓ Tất cả') : L('전체 선택', 'Chọn tất cả')),
      kinds.map(k => h('button', { type: 'button', class: 'kc' + (shown.has(k) ? ' on' : ''), 'aria-pressed': shown.has(k) ? 'true' : 'false', onclick: (e) => { e.stopPropagation(); const s = new Set(shown); if (s.has(k)) s.delete(k); else s.add(k); C.setPoKindsShown(Array.from(s)); onChange(); } }, k)));
  };
  reg('po_monthly', { ko: '월별 수주량 (Checking 기준, pcs)', vi: 'Đơn hàng theo tháng (Checking, pcs)', dko: 'Checking(납기) 일 기준 월별 · 품목군별 수주 pcs. 연도 이동, 차트/표, 품목군 골라 보기', dvi: 'PCS theo tháng (ngày Checking) · nhóm hàng', cat: 'order', w: 2, sizes: [2, 3, 4], defaults: { view: 'chart' },
    render(ctx, inst) {
      const o = inst.o || {}; const view = o.view || 'chart'; const S = wstate(inst.k, { year: +ctx.ref.slice(0, 4) });
      const m = C.monthlyPO('due'); const kinds = C.poKindsShown(); const months = []; for (let i = 1; i <= 12; i++) months.push(S.year + '-' + String(i).padStart(2, '0'));
      const rows = kinds.map(k => { const r = { k, m: months.map(ym => (m[ym] && m[ym][k]) || 0) }; r.t = r.m.reduce((a, b) => a + b, 0); return r; }).filter(r => r.t > 0);
      const colTot = months.map((ym, i) => rows.reduce((a, r) => a + r.m[i], 0)); const grand = colTot.reduce((a, b) => a + b, 0);
      const right = [nav(String(S.year), () => { S.year--; ERP.render(); }, () => { S.year++; ERP.render(); }), seg([['chart', L('차트', 'Biểu đồ')], ['table', L('표', 'Bảng')]], view, (v) => setOpt(inst.k, { view: v }))];
      let body;
      if (!rows.length) body = h('div', { class: 'empty' }, L(S.year + '년 수주가 없습니다 (고른 품목군 기준).', 'Không có đơn hàng năm ' + S.year + '.'));
      else if (view === 'table') body = h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl dt' },
        h('thead', h('tr', h('th', L('품목군 \\ 월', 'Nhóm \\ tháng')), months.map((x, i) => h('th', { class: 'num' }, L((i + 1) + '월', 'T' + (i + 1)))), h('th', { class: 'num' }, S.year + L(' 합계', ' tổng')))),
        h('tbody', rows.map(r => h('tr', h('td', h('b', r.k)), r.m.map(v => h('td', { class: 'num' }, v ? F.n(v) : h('span', { class: 'muted' }, '0'))), h('td', { class: 'num' }, h('b', F.n(r.t))))),
          h('tr', { class: 'tot' }, h('td', L('합계', 'Tổng')), colTot.map(v => h('td', { class: 'num' }, F.n(v))), h('td', { class: 'num' }, F.n(grand))))));
      else body = ERP.chart({ type: 'bar', data: { labels: months.map((x, i) => L((i + 1) + '월', 'T' + (i + 1))), datasets: rows.map((r, i) => ({ label: r.k, data: r.m, backgroundColor: ERP.palette[i % ERP.palette.length] })) }, options: { scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: short } } } } }, true);
      return box(L('월별 수주량 · Checking 기준 · ', 'Đơn hàng theo tháng · Checking · ') + S.year, right, ERP.kindChips(() => ERP.render()), body,
        h('p', { class: 'help', style: { margin: '8px 0 0' } }, L('Checking(납기) 일이 속한 달의 수주 pcs 합계 · ' + S.year + '년 ', 'Tổng pcs theo tháng của ngày Checking · năm ' + S.year + ': ') + F.n(grand) + ' pcs'));
    } });
  reg('due_list', { ko: '납기 임박 수주', vi: 'PO sắp đến hạn', dko: '납기가 가까운(또는 30일 이내 지난) 진행 중 PO 8건', dvi: '8 PO gần hạn nhất', cat: 'order', w: 2, sizes: [2, 3, 4],
    render(ctx) { const list = ctx.open.filter(o => o.p.due).sort((a, b) => a.p.due.localeCompare(b.p.due)).filter(o => o.dday >= -30).slice(0, 8);
      return box(L('납기 임박 수주', 'PO sắp đến hạn'), h('a', { href: '#/orders' }, L('전체 보기 →', 'Xem tất cả →')),
        h('div', { class: 'list' }, list.length ? list.map(o => h('div', h('div', h('b', o.p.po_no), h('div', { class: 'sub' }, [o.p.customer, o.p.item_no, o.p.kind].filter(Boolean).join(' · '))),
          h('div', { class: 'right' }, h('div', F.n(o.packed) + ' / ' + F.n(o.sets) + ' set'), h('div', { class: 'sub' }, F.d(o.p.due)), ERP.ddayChip(o.dday, o.st)))) : h('div', { class: 'empty' }, L('납기 임박 수주가 없습니다', 'Không có PO sắp đến hạn')))); } });

  // ===== stock
  reg('low_list', { ko: '안전재고 미달 자재', vi: 'NVL dưới tồn an toàn', dko: '안전재고 대비 가장 부족한 8품목', dvi: '8 mã thiếu nhiều nhất', cat: 'stock', w: 2, sizes: [2, 3, 4],
    render(ctx) { const list = ctx.low.slice().sort((a, b) => (a.bal / (a.safety || 1)) - (b.bal / (b.safety || 1))).slice(0, 8);
      return box(L('안전재고 미달 자재', 'NVL dưới mức tồn an toàn'), h('a', { href: '#/materials', onclick: () => { ERP.state.matTab = 'reorder'; } }, L('발주 보기 →', 'Xem đặt hàng →')),
        h('div', { class: 'list' }, list.length ? list.map(s => h('div', h('div', h('b', s.code), h('div', { class: 'sub' }, s.name)),
          h('div', { class: 'right' }, h('div', F.n(s.bal, 1) + ' ' + s.prim + ' / ' + F.n(s.safety)), ERP.chip(s.status === 'neg' ? 'bad' : 'warn', s.status === 'neg' ? L('마이너스', 'Âm') : L('미달', 'Thiếu'))))) : h('div', { class: 'empty' }, L('모든 자재가 안전재고 이상입니다', 'Tất cả NVL đạt mức an toàn')))); } });
  reg('flow', { ko: '재고 · 공정 흐름', vi: 'Tồn kho · dòng chảy sản xuất', dko: '원재료 → 부품 → 스탬핑 → 조립 → 포장 단계별 재고 품목 수 (누르면 해당 재고 탭)', dvi: 'Số mã có tồn theo từng công đoạn', cat: 'stock', w: 2, sizes: [2, 3, 4],
    render() {
      const INV = ERP.inv; const rowsS = INV.rows(); const by = new Map(INV.stageSummary(rowsS).map(x => [x.stage, x]));
      const neg = rowsS.filter(x => x.negative).length, susp = rowsS.filter(x => x.susp).length;
      const flow = h('div', { class: 'flow' }, INV.STAGES.map((sg, i) => { const o = by.get(sg.code) || { items: 0, withStock: 0, negative: 0 }; return [i && ['WIP00', 'WIP11', 'WIP55', 'SG'].includes(sg.code) ? h('span', { class: 'arrow' }, '›') : null,
        h('button', { type: 'button', class: 'st', style: { flexBasis: '104px', minHeight: '84px' }, onclick: () => ERP.openStock(sg.code) },
          h('b', { style: { fontSize: '12px' }, title: INV.stageName(sg.code) }, INV.labelShort('stage', sg.code)), h('div', { class: 'n', style: { fontSize: '16px' } }, F.n(o.withStock), h('small', ' / ' + F.n(o.items))), h('div', { class: 'fl' }, o.negative ? h('span', { style: { background: '#FBE6E4', color: '#9F1F18' } }, '−' + o.negative) : null))]; }));
      return box(L('재고 · 공정 흐름', 'Tồn kho · dòng chảy sản xuất'), h('a', { href: '#/materials' }, L('품목·재고 →', 'Hàng hóa · Tồn kho →')), flow,
        h('div', { class: 'toolbar', style: { margin: '8px 0 0' } }, ERP.chip(neg ? 'bad' : 'ok', L('마이너스 ', 'Âm ') + F.n(neg)), ERP.chip(susp ? 'warn' : 'ok', L('이동 누락 의심 ', 'Nghi thiếu phiếu chuyển ') + F.n(susp)), h('span', { class: 'muted' }, L('숫자 = 재고 있는 품목 / 전체', 'Số = mã có tồn / tổng'))));
    } });
  reg('floor_post', { ko: '생산현장 재고 반영 (7일)', vi: 'Cập nhật tồn hiện trường (7 ngày)', dko: '최근 7일 공정별 생산 입고 수량 · 부품 차감 건수 · 해결할 항목', dvi: 'Nhập SX · trừ linh kiện 7 ngày', cat: 'stock', w: 2, sizes: [2, 3, 4],
    render(ctx) {
      const pp = ERP.inv.prodPost(); const d = pp.diag; const days7 = []; for (let i = 6; i >= 0; i--) days7.push(F.addDays(ctx.ref, -i));
      const cell = {}; pp.rows.forEach(t => { if (days7.indexOf(t.date) < 0) return; const k = t.proc + '|' + t.date; const o = cell[k] = cell[k] || { in: 0, use: 0 }; if (t.kind === 'PROD') o.in++; else o.use++; });
      const issues = d.notItem.size + d.noBom.size + d.missingPart.size + d.rawUnmatched.size + d.noConv.size;
      return box(L('생산현장 재고 반영 (최근 7일)', 'Cập nhật tồn hiện trường (7 ngày)'), h('a', { href: '#/materials', onclick: () => { ERP.state.matTab = 'post'; } }, L('생산 반영 →', 'Cập nhật SX →')),
        ERP.simpleTable([{ label: L('공정', 'Công đoạn'), render: p => h('b', { style: { color: p.color } }, L(p.ko, p.vi)) }].concat(days7.map(dd => ({ label: F.md(dd), num: 1, render: p => { const o = cell[p.id + '|' + dd]; return o ? h('span', { title: L('입고 ', 'Nhập ') + o.in + L(' · 차감 ', ' · trừ ') + o.use }, ERP.chip('ok', '+' + o.in), o.use ? ' ' : '', o.use ? ERP.chip('warn', '−' + o.use) : '') : h('span', { class: 'muted' }, '–'); } }))), ERP.PROC, {}),
        h('p', { class: 'help' }, L('+ = 생산 입고 건수, − = 부품·원료 차감 건수 · 기준일 ', '+ = số dòng nhập, − = số dòng trừ · ngày chốt ') + (d.open || '–') + (issues ? L(' · 해결할 항목 ' + issues + '종', ' · cần xử lý ' + issues) : ''))); } });
  reg('fresh', { ko: '자료 최신 여부', vi: 'Độ mới của dữ liệu', dko: '수불 · 생산일보 · ECOUNT · 수주 자료의 마지막 날짜', dvi: 'Ngày gần nhất của từng loại dữ liệu', cat: 'etc', w: 2, sizes: [2, 3, 4],
    render(ctx) { const meta = ERP.inv.meta();
      const fresh = [[L('수불 (입고·출고·이동)', 'Nhập xuất tồn'), meta.lastTx, 1], [L('생산일보', 'Báo cáo SX'), C.latestProdDate(), 1], [L('ECOUNT 품목등록', 'Danh mục ECOUNT'), (ERP.lastUpload ? ERP.lastUpload(['ecount_items']) : '').slice(0, 10), 0], [L('기초재고 (ECOUNT)', 'Tồn đầu (ECOUNT)'), meta.open.any, 0], [L('수주 (PO)', 'Đơn hàng'), DB.rows('po').reduce((a, p) => (/^\d{4}-\d\d-\d\d/.test(String(p.date || '')) && p.date > a ? p.date : a), ''), 0]];
      return box(L('자료 최신 여부', 'Độ mới của dữ liệu'), h('a', { href: '#/data' }, L('자료 올리기 →', 'Tải dữ liệu →')),
        ERP.simpleTable([{ label: L('자료', 'Dữ liệu'), render: x => x[0] }, { label: L('마지막 날짜', 'Ngày gần nhất'), render: x => x[1] ? F.d(x[1]) : '–' }, { label: L('상태', 'Trạng thái'), render: x => !x[1] ? ERP.chip('warn', L('없음', 'Chưa có')) : (x[2] && F.diffDays(ctx.today, String(x[1]).slice(0, 10)) >= 2 ? ERP.chip('warn', F.diffDays(ctx.today, String(x[1]).slice(0, 10)) + L('일 전', ' ngày trước')) : ERP.chip('ok', L('최신', 'Mới'))) }], fresh),
        h('p', { class: 'help' }, L('수불·생산일보는 매일 올려야 재고가 맞습니다. 2일 이상 비면 노란색으로 표시합니다.', 'Phiếu và báo cáo SX cần cập nhật hằng ngày. Trống từ 2 ngày sẽ hiện màu vàng.'))); } });

  // ===== etc
  reg('shortcuts', { ko: '바로가기', vi: 'Lối tắt', dko: '자주 하는 일 (일보 입력 · 수불 입력 · 자료 올리기 · 수주 등록 · AI 비서)', dvi: 'Việc hay làm', cat: 'etc', w: 1, sizes: [1, 2],
    render() { const b = (icon, ko, vi, fn) => h('button', { type: 'button', class: 'scut', onclick: (e) => { e.stopPropagation(); fn(); } }, h('span', icon), L(ko, vi));
      return box(L('바로가기', 'Lối tắt'), null, h('div', { class: 'scuts' },
        b('📝', '일보 입력', 'Nhập báo cáo', () => { ERP.state.prodTab = 'entry'; ERP.goto('production'); }), b('📦', '수불 입력', 'Nhập phiếu', () => { ERP.state.matTab = 'entry'; ERP.goto('materials'); }),
        b('⬆', '자료 올리기', 'Tải dữ liệu', () => { ERP.state.dataTab = 'import'; ERP.goto('data'); }), b('🧾', '수주 관리', 'Đơn hàng', () => ERP.goto('orders')),
        b('🔩', '조립 BOM', 'BOM lắp ráp', () => ERP.goto('bom', { tab: 'asm' })), b('✦', 'AI 비서', 'Trợ lý AI', () => ERP.ai && ERP.ai.open && ERP.ai.open()))); } });
  reg('memo', { ko: '메모', vi: 'Ghi chú', dko: '포스트잇처럼 적어 두는 메모 (여러 개 가능)', dvi: 'Ghi chú dán (nhiều cái)', cat: 'etc', w: 1, sizes: [1, 2, 3, 4], multi: true, defaults: { text: '' },
    render(ctx, inst) { const ta = h('textarea', { class: 'memo-ta', placeholder: L('예) 오늘 확인할 것, 전달 사항…', 'VD: việc cần kiểm tra hôm nay…'), oninput: (e) => { clearTimeout(ta._t); const v = e.target.value; ta._t = setTimeout(() => setOpt(inst.k, { text: v }, true), 500); }, onclick: (e) => e.stopPropagation() }); ta.value = (inst.o && inst.o.text) || '';
      return h('section', { class: 'card wcard memo' }, h('div', { class: 'card-head' }, h('h2', '🗒 ' + L('메모', 'Ghi chú'))), ta); } });

  // ---------------------------------------------------------------- layout (saved in settings)
  const DEFAULT = () => [['kpi_pck_day', 1], ['kpi_pck_month', 1], ['kpi_due', 1], ['kpi_low', 1], ['procs', 4], ['asm_daily', 4], ['po_monthly', 2], ['due_list', 2], ['low_list', 2], ['flow', 2], ['fresh', 2], ['input7', 2]]
    .map(([id, w], i) => ({ k: id + '-' + i, id, w, o: W[id].defaults ? JSON.parse(JSON.stringify(W[id].defaults)) : undefined }));
  ERP.dashDefault = DEFAULT;
  const clampW = (w, def) => { const s = def.sizes; if (s.includes(w)) return w; return s.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a), s[0]); };
  function layout() { const l = DB.setting('dash', null); const arr = Array.isArray(l) && l.length ? l.filter(x => x && W[x.id]) : DEFAULT(); return arr.map(x => Object.assign({}, x, { o: x.o ? Object.assign({}, x.o) : (W[x.id].defaults ? JSON.parse(JSON.stringify(W[x.id].defaults)) : undefined) })); }
  function save(l) { DB.setSetting('dash', l.map(x => { const o = { k: x.k, id: x.id, w: x.w }; if (x.o && Object.keys(x.o).length) o.o = x.o; return o; })); }
  ERP.dashLayout = layout; ERP.dashSave = save;
  function setOpt(k, patch, quiet) { const l = layout(); const x = l.find(y => y.k === k); if (!x) return; x.o = Object.assign({}, x.o || {}, patch); save(l); if (!quiet) ERP.render(); }
  function move(i, d) { const l = layout(); const j = i + d; if (j < 0 || j >= l.length) return; const t = l[i]; l[i] = l[j]; l[j] = t; save(l); ERP.render(); }
  function resize(i, w) { const l = layout(); l[i].w = w; save(l); ERP.render(); }
  function removeAt(i) { const l = layout(); l.splice(i, 1); save(l); ERP.render(); }
  function addWidget(id) { const def = W[id]; const l = layout(); l.push({ k: id + '-' + Date.now().toString(36), id, w: def.w, o: def.defaults ? JSON.parse(JSON.stringify(def.defaults)) : undefined }); save(l); ERP.render(); setTimeout(() => { const el = document.querySelector('.wgrid .w:last-of-type'); el && el.scrollIntoView && el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 50); }
  ERP.dashAdd = addWidget;

  function gallery() {
    const l = layout(); const have = new Set(l.map(x => x.id));
    const body = h('div', { class: 'wgal' }, ERP.WIDGET_CATS().map(([cat, label]) => {
      const defs = Object.values(W).filter(d => d.cat === cat); if (!defs.length) return null;
      return h('div', h('h4', label), h('div', { class: 'wgal-grid' }, defs.map(d => {
        const added = have.has(d.id) && !d.multi;
        return h('div', { class: 'wgal-item' + (added ? ' added' : '') }, h('b', L(d.ko, d.vi)), h('p', L(d.dko || '', d.dvi || '')), h('small', { class: 'muted' }, L('가로 ', 'Rộng ') + d.w + L('칸', ' ô') + (d.multi ? L(' · 여러 개 가능', ' · nhiều cái') : '')),
          h('button', { type: 'button', class: 'btn sm' + (added ? '' : ' primary'), disabled: added, onclick: () => { addWidget(d.id); modal.close(); } }, added ? L('추가됨', 'Đã có') : '+ ' + L('추가', 'Thêm')));
      })));
    }));
    const modal = ERP.modal({ title: L('위젯 추가', 'Thêm ô'), width: '880px', body, buttons: [{ label: L('닫기', 'Đóng') }] });
  }
  function optDialog(inst, def) {
    const vals = Object.assign({}, inst.o || {});
    const body = h('div', { class: 'form-grid', style: { gridTemplateColumns: '1fr' } }, (def.opts || []).map(op => h('div', { class: 'field' }, h('label', L(op.ko, op.vi)),
      h('select', { class: 'inp', onchange: (e) => { vals[op.k] = e.target.value; } }, op.options().map(o => h('option', { value: o[0], selected: String(vals[op.k] || '') === String(o[0]) }, o[1]))))));
    ERP.modal({ title: L('위젯 설정 · ', 'Cài đặt ô · ') + L(def.ko, def.vi), width: '420px', body, buttons: [{ label: L('취소', 'Hủy') }, { label: L('저장', 'Lưu'), kind: 'primary', onClick: () => { setOpt(inst.k, vals); } }] });
  }

  // ---------------------------------------------------------------- drag & drop (edit mode)
  let dragK = null;
  function dnd(el, inst) {
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', (e) => { dragK = inst.k; el.classList.add('dragging'); try { e.dataTransfer.setData('text/plain', inst.k); e.dataTransfer.effectAllowed = 'move'; } catch (x) { /* ignore */ } });
    el.addEventListener('dragend', () => { dragK = null; el.classList.remove('dragging'); document.querySelectorAll('.w.drop-before,.w.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); });
    el.addEventListener('dragover', (e) => { if (!dragK || dragK === inst.k) return; e.preventDefault(); const r = el.getBoundingClientRect(); const after = (e.clientX - r.left) > r.width / 2; el.classList.toggle('drop-after', after); el.classList.toggle('drop-before', !after); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
    el.addEventListener('drop', (e) => { e.preventDefault(); const after = el.classList.contains('drop-after'); el.classList.remove('drop-before', 'drop-after'); if (!dragK || dragK === inst.k) return; ERP.dashMove(dragK, inst.k, after); });
  }
  /** move widget `k` before/after widget `target` */
  ERP.dashMove = function (k, target, after) { const l = layout(); const i = l.findIndex(x => x.k === k); if (i < 0) return; const it = l.splice(i, 1)[0]; let j = l.findIndex(x => x.k === target); if (j < 0) j = l.length; else if (after) j++; l.splice(j, 0, it); save(l); ERP.render(); };

  function renderWidget(inst, i, n, ctx, ed) {
    const def = W[inst.id]; const w = clampW(inst.w || def.w, def);
    const el = h('div', { class: 'w' + (!ed && def.go ? ' tap' : ''), 'data-w': w, 'data-k': inst.k, 'data-id': inst.id });
    let body; try { body = def.render(ctx, inst); } catch (e) { console.error(e); body = box(L(def.ko, def.vi), null, h('div', { class: 'empty' }, 'Error: ' + (e && e.message))); }
    el.appendChild(body);
    if (!ed && def.go) { const go = def.go(ctx, inst); el.addEventListener('click', (e) => { if (e.target.closest('button,a,input,select,textarea')) return; go(); }); el.setAttribute('role', 'link'); el.setAttribute('tabindex', '0'); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }); }
    if (ed) {
      dnd(el, inst);
      el.appendChild(h('div', { class: 'wbar', onclick: (e) => e.stopPropagation() },
        h('span', { class: 'grab', title: L('끌어서 옮기기', 'Kéo để di chuyển') }, '⠿'),
        h('button', { type: 'button', title: L('앞으로', 'Lên trước'), disabled: i === 0, onclick: () => move(i, -1) }, '◀'),
        h('button', { type: 'button', title: L('뒤로', 'Ra sau'), disabled: i === n - 1, onclick: () => move(i, 1) }, '▶'),
        h('span', { class: 'sz' }, def.sizes.map(s => h('button', { type: 'button', class: s === w ? 'on' : '', title: L('가로 ' + s + '칸 (전체 4칸)', 'Rộng ' + s + ' ô (tổng 4)'), onclick: () => resize(i, s) }, String(s)))),
        def.opts ? h('button', { type: 'button', title: L('위젯 설정', 'Cài đặt ô'), onclick: () => optDialog(inst, def) }, '⚙') : null,
        h('button', { type: 'button', class: 'x', title: L('위젯 빼기', 'Bỏ ô'), onclick: () => removeAt(i) }, '✕')));
    }
    return el;
  }

  ERP.pages.dashboard = { ko: '종합 현황', vi: 'Tổng quan', render(root) {
    const ref = ERP.state.dashDate || C.latestProdDate();
    const ed = !!ERP.state.dashEdit;
    const actions = [h('label', { class: 'muted' }, L('기준일 ', 'Ngày xem '), h('input', { class: 'inp', type: 'date', value: ref, onchange: (e) => { ERP.state.dashDate = e.target.value || null; ERP.render(); } })),
      h('button', { class: 'btn', onclick: () => { ERP.state.dashDate = null; ERP.render(); } }, L('최신일', 'Ngày mới nhất'))];
    if (ed) actions.push(h('button', { class: 'btn', onclick: gallery }, '+ ' + L('위젯 추가', 'Thêm ô')),
      h('button', { class: 'btn', onclick: async () => { if (await ERP.confirm(L('위젯 배치를 처음(기본) 상태로 되돌릴까요?', 'Đưa bố cục về mặc định?'))) { DB.setSetting('dash', null); ERP.render(); } } }, L('기본 배치로', 'Bố cục mặc định')),
      h('button', { class: 'btn primary', onclick: () => { ERP.state.dashEdit = false; ERP.render(); } }, L('편집 완료', 'Xong')));
    else actions.push(h('button', { class: 'btn', onclick: () => { ERP.state.dashEdit = true; ERP.render(); } }, '✎ ' + L('화면 편집', 'Chỉnh màn hình')));
    root.appendChild(ERP.pageHead(L('종합 현황', 'Tổng quan sản xuất'), ed ? L('편집 중: 위젯을 끌거나 ◀ ▶ 로 옮기고, 1~4 로 가로 크기를 고르고, ✕ 로 뺍니다. "+ 위젯 추가"에서 새 위젯을 넣으세요.', 'Đang chỉnh: kéo hoặc ◀ ▶ để di chuyển, 1~4 để đổi độ rộng, ✕ để bỏ. "+ Thêm ô" để thêm.')
      : L('수주 · 생산 · 재고 한눈에 보기 · 기준일의 생산일보로 집계 · "화면 편집"으로 위젯을 고르고 옮길 수 있습니다', 'Đơn hàng · Sản xuất · Tồn kho — theo báo cáo của ngày chọn · "Chỉnh màn hình" để chọn và sắp xếp ô'), actions));
    const ctx = makeCtx(ref); const lay = layout();
    const grid = h('div', { class: 'wgrid' + (ed ? ' editing' : ''), 'aria-label': L('위젯', 'Ô') });
    lay.forEach((inst, i) => grid.appendChild(renderWidget(inst, i, lay.length, ctx, ed)));
    if (ed) grid.appendChild(h('button', { type: 'button', class: 'w wadd', 'data-w': 1, onclick: gallery }, h('span', { style: { fontSize: '28px', lineHeight: 1 } }, '+'), h('span', L('위젯 추가', 'Thêm ô'))));
    if (!lay.length && !ed) grid.appendChild(h('div', { class: 'w', 'data-w': 4 }, h('div', { class: 'card empty' }, L('위젯이 없습니다. "화면 편집" → "+ 위젯 추가"', 'Chưa có ô nào. "Chỉnh màn hình" → "+ Thêm ô"'))));
    root.appendChild(grid);
  } };
})();
