/* 19차 (v1.14.0) 생산 계획 화면 (Kế hoạch sản xuất) — 계산은 plan.js (ERP.plan)
   사용자 2026-11-03 "생산 케파나 인원등 수주대비 언제 작업이 끝나고 뭐가 얼마나 필요할지 …" → (양식 · 첫 계산 엑셀) → "네, 만들어 줘".
   위: PO미정 포함 / 확정 PO 만 · 숫자 카드. 탭: 수주별 완료 예상 · 공정별 부하 · 자재 · 기준 자료 (표 plan_proc · plan_cal · plan_wait) · 확인할 것.
   기준 자료는 모든 PC 같음 (구글 공유). 생산계획_기준자료_양식 엑셀을 엑셀 업로드에 올리면 한 번에 채워진다 (xl.js). */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, C = ERP.calc, F = ERP.fmt;
  const P = ERP.plan;
  const num = C.num;
  const isDate = (s) => /^\d{4}-\d\d-\d\d$/.test(String(s || ''));
  const dT = (d) => P.dateText(d);
  const jChip = (j) => ERP.chip(P.judgeTone(j), P.judgeName(j));
  const mChip = (j) => ERP.chip(P.mjudgeTone(j), P.mjudgeName(j));
  const scopeName = (s) => (s === 'firm' ? L('확정 PO 만', 'Chỉ PO đã chốt') : L('PO미정 포함', 'Gồm PO chưa có số'));
  const redraw = () => (ERP.refresh ? ERP.refresh() : ERP.render());
  const SH = { INJ: 'sh_inj', REF: 'sh_ref', ASM: 'sh_asm', WRP: 'sh_wrp', PCK: 'sh_pck' };
  /** 숫자 칸 (비우면 null) */
  const nIn = (val, onSet, o) => h('input', Object.assign({ class: 'inp', type: 'number', step: 'any', min: 0, style: { width: '76px' }, value: val === undefined || val === null || val === '' ? '' : val,
    onchange: (e) => { const v = F.parseNum(e.target.value); onSet(v === null ? null : v); } }, o || {}));
  const setOrDrop = (v) => (v === null || v === undefined || v === '' ? undefined : v);

  // ---------- 기준 자료 표 ----------
  const procRow = (p, f) => DB.rows('plan_proc').find(r => String(r.process || '').toUpperCase() === p && String(r.division || '').trim() === (f || ''));
  function setProc(p, f, k, v) {
    const r = procRow(p, f); const patch = { [k]: setOrDrop(v) };
    if (r) DB.update('plan_proc', r._id, patch); else DB.add('plan_proc', Object.assign({ process: p }, f ? { division: f } : {}, patch));
    redraw();
  }
  const waitRow = (k) => { const [a, b] = k.split('>'); return DB.rows('plan_wait').find(r => String(r.from || '').toUpperCase() === a && String(r.to || '').toUpperCase() === b); };
  function setWait(k, v) { const [a, b] = k.split('>'); const r = waitRow(k); if (r) DB.update('plan_wait', r._id, { days: setOrDrop(v) }); else DB.add('plan_wait', { from: a, to: b, days: setOrDrop(v) }); redraw(); }

  function exportBook(A, B) {
    const X = window.XLSX; const wb = X.utils.book_new();
    P.sheets(A, B).forEach(s => { const ws = X.utils.aoa_to_sheet(s.aoa); ws['!cols'] = s.cols.map(w => ({ wch: w })); X.utils.book_append_sheet(wb, ws, s.name.slice(0, 31)); });
    ERP.xl.saveBook(wb, 'production_plan_' + A.today + '.xlsx');
  }

  // ---------- 탭: 수주별 완료 예상 ----------
  function ordersTab(host, R, st) {
    const J = ['late', 'tight', 'past', 'ok', 'nodue', 'na'];
    const seg = h('div', { class: 'seg' }, [['', L('전체', 'Tất cả') + ' ' + R.orders.length]].concat(J.filter(j => R.counts[j]).map(j => [j, P.judgeName(j) + ' ' + R.counts[j]]))
      .map(o => h('button', { type: 'button', class: 'btn sm' + ((st.judge || '') === o[0] ? ' primary' : ''), 'data-plan-judge': o[0] || 'all', onclick: () => { st.judge = o[0]; ERP.render(); } }, o[1])));
    const q = h('input', { class: 'inp', placeholder: L('PO · 품번 · 거래처 찾기', 'Tìm PO · mã · khách hàng'), value: st.q || '', oninput: (e) => { st.q = e.target.value; draw(); } });
    const tblHost = h('div');
    const fin = (d) => (d ? (isDate(d) ? F.md(d) : dT(d)) : '–');
    function draw() {
      const k = String(st.q || '').trim().toLowerCase();
      const rows = R.orders.map((o, i) => Object.assign({ n: i + 1 }, o)).filter(o => (!st.judge || o.judge === st.judge) && (!k || (o.po + ' ' + o.item + ' ' + o.customer + ' ' + o.kind).toLowerCase().includes(k)));
      tblHost.replaceChildren(ERP.simpleTable([
        { label: L('순서', 'TT'), num: 1, render: o => o.n },
        { label: 'PO', render: o => h('a', { href: '#', onclick: (e) => { e.preventDefault(); ERP.openPo(o.po); } }, o.po) },
        { label: L('품번 · 품목군', 'Mã · nhóm'), render: o => h('div', h('b', o.item), h('div', { class: 'sub' }, o.kind || '')) },
        { label: L('거래처', 'Khách hàng'), render: o => o.customer || '' },
        { label: L('남은 set', 'Còn (bộ)'), num: 1, render: o => F.n(o.rem) },
        { label: L('납기', 'Hạn giao'), render: o => o.due || '–' },
        { label: L('출고 가능일', 'Ngày xuất được'), render: o => h('b', dT(o.ship) || '–') },
        { label: L('여유 (일)', 'Dư (ngày)'), num: 1, render: o => (o.slack === undefined ? '–' : h('span', { style: o.slack < 0 ? { color: '#B3261E', fontWeight: '700' } : null }, F.n(o.slack))) },
        { label: L('판정', 'Đánh giá'), render: o => jChip(o.judge) },
        { label: L('끝을 정한 공정', 'Công đoạn quyết định'), render: o => (o.limit ? ERP.procName(o.limit) : '') },
        { label: L('끝나는 날: 사출 · 리필 · 조립 · 권취 · 포장', 'Xong: ép · lõi · lắp · quấn · đóng gói'), render: o => h('small', { class: 'muted nowrap' }, [o.F.INJ, o.F.REF, o.asmEff, o.wrpEff, o.pckEff].map(fin).join(' · ')) },
        { label: L('계산 근거', 'Cơ sở tính'), render: o => h('small', { class: 'muted' }, o.acc.how) },
      ], rows, { maxH: '62vh' }));
    }
    host.append(h('div', { class: 'toolbar' }, seg, q), tblHost,
      h('p', { class: 'help' }, L('납기 순으로 공정마다 쌓아 끝나는 근무일을 구하고, 앞 공정 + 기다리는 날 → 포장 → 출고 사이 기다리는 날을 더한 날이 출고 가능일입니다. 여유 = 납기 − 출고 가능일 (7일 넘게 = 여유, 0 ~ 6일 = 빠듯함, 0 보다 작으면 지연 예상). PO 를 누르면 수주 관리로 갑니다.',
        'Xếp theo hạn giao, cộng dồn từng công đoạn để ra ngày xong, cộng thời gian chờ → đóng gói → xuất = ngày xuất được. Dư = hạn − ngày xuất (> 7 = còn dư, 0 ~ 6 = sát hạn, < 0 = dự kiến trễ). Bấm PO để mở quản lý đơn hàng.')));
    draw();
  }

  // ---------- 탭: 공정별 부하 ----------
  function loadsTab(host, R) {
    const cap = R.cap; const maxDays = Math.max(1, ...R.loads.map(r => r.days || 0));
    host.append(ERP.simpleTable([
      { label: L('공정 · 품목군', 'Công đoạn · nhóm'), render: r => h('div', h('b', P.loadName(r.id)), r === R.bottle ? ERP.chip('bad', L('가장 막힘', 'Nghẽn nhất')) : null) },
      { label: L('남은 일 (pcs, 현장 재고 뺀 뒤)', 'Việc còn (pcs, sau tồn)'), num: 1, render: r => F.n(r.load) },
      { label: L('하루 능력', 'Năng lực / ngày'), num: 1, render: r => (r.perDay > 0 ? F.n(r.perDay) : h('span', { style: { color: '#B3261E' } }, L('모름', 'chưa biết'))) },
      { label: L('출처', 'Nguồn'), render: r => ERP.chip(r.src === 'manual' ? 'info' : r.src === 'log' ? 'neutral' : 'warn', r.src === 'manual' ? L('직접 넣음', 'nhập tay') : r.src === 'log' ? L('일보 실적', 'báo cáo') : L('없음', 'không có')) },
      { label: L('걸리는 근무일', 'Số ngày làm'), render: r => (r.days === null ? '–' : h('div', { style: { minWidth: '150px' } }, ERP.bar(r.days / maxDays * 100, r === R.bottle ? 'bad' : 'info'), h('small', F.n(r.days, 1) + L('일', ' ngày')))) },
      { label: L('끝나는 날', 'Ngày xong'), render: r => h('b', dT(r.end) || '–') },
      { label: L('설비 기준 최대 (하루)', 'Tối đa theo máy / ngày'), num: 1, render: r => (r.proc === 'PCK' ? (cap.mach.PCK ? F.n(cap.mach.PCK) + ' set' : '–') : (r.mach ? F.n(r.mach) : '–')) },
      { label: L('설비 기준 근무일', 'Số ngày (theo máy)'), num: 1, render: r => (r.daysMach ? F.n(r.daysMach, 1) : '–') },
    ], R.loads, { maxH: '62vh' }),
      h('p', { class: 'help' }, L('하루 능력 = 생산 일보 ' + (cap.from || '–') + ' ~ ' + (cap.to || '–') + ' 실적 ÷ 공장이 일한 날 (공정마다 그 공정의 마지막 일보까지, 조립은 품목군별) × 계획 조 수 ÷ 그동안 하루 조 수 — 지금 인원 · 설비로 실제 해 온 양입니다. 기준 자료에 직접 넣으면 그 값을 씁니다. 설비 기준 최대 = 설비 마스터의 사용 설비 조당 표준 × 조 수 (참고). 포장 하루 실적 ' + F.n(cap.pckSetsDay) + ' set (계산은 pcs).',
        'Năng lực/ngày = báo cáo ' + (cap.from || '–') + ' ~ ' + (cap.to || '–') + ' ÷ số ngày nhà máy làm × số ca KH ÷ số ca thực tế. Nếu nhập ở dữ liệu chuẩn thì dùng giá trị đó. Tối đa theo máy = SL chuẩn/ca × số ca (tham khảo). Đóng gói ' + F.n(cap.pckSetsDay) + ' bộ/ngày (tính bằng pcs).')));
  }

  // ---------- 탭: 자재 ----------
  function matsTab(host, R, st) {
    const list = st.matAll ? R.mats : R.short;
    const seg = h('div', { class: 'seg' }, [[false, L('모자라는 것만', 'Chỉ vật tư thiếu') + ' ' + R.short.length], [true, L('전체', 'Tất cả') + ' ' + R.mats.length]]
      .map(o => h('button', { type: 'button', class: 'btn sm' + (!!st.matAll === o[0] ? ' primary' : ''), onclick: () => { st.matAll = o[0]; ERP.render(); } }, o[1])));
    const leadIn = (m) => (m.item ? h('input', { class: 'inp', type: 'number', min: 0, step: 1, style: { width: '70px' }, value: num(m.item.lead_days) > 0 ? m.item.lead_days : '', placeholder: m.lead ? String(m.lead) : '',
      title: L('품목 리드타임 (일). 비우면 해외 주문 품목은 기본 리드타임', 'Thời gian giao (ngày). Trống = mặc định của hàng đặt nước ngoài'),
      onchange: (e) => { const v = F.parseNum(e.target.value); DB.update('items', m.item._id, { lead_days: v > 0 ? Math.round(v) : undefined }); redraw(); } }) : '–');
    host.append(h('div', { class: 'toolbar' }, seg), ERP.simpleTable([
      { label: L('품목', 'Mã · tên'), render: m => h('div', h('b', m.code), h('div', { class: 'sub' }, m.name || '')) },
      { label: L('단계', 'Loại'), render: m => m.stage || '' },
      { label: L('쓰는 공정', 'Công đoạn dùng'), render: m => ERP.procName(m.via) },
      { label: L('필요량', 'Cần'), num: 1, render: m => F.n(m.need, 2) + ' ' + (m.unit || '') },
      { label: L('지금 재고', 'Tồn'), num: 1, render: m => F.n(m.stock, 2) },
      { label: L('입고 예정', 'Sắp nhập'), num: 1, render: m => (m.inc ? F.n(m.inc, 2) + (m.incNoEta ? ' *' : '') : '–') },
      { label: L('모자람', 'Thiếu'), num: 1, render: m => (m.short > 0 ? h('b', { style: { color: '#B3261E' } }, F.n(m.short, 2)) : '0') },
      { label: L('처음 모자라는 수주', 'PO thiếu đầu tiên'), render: m => (m.first ? h('div', m.first.po + ' · ' + m.first.item, h('div', { class: 'sub' }, L('납기 ', 'hạn ') + (m.first.due || '–'))) : '') },
      { label: L('필요한 날', 'Ngày cần'), render: m => (m.first ? h('b', m.first.date) : '') },
      { label: L('리드타임 (일)', 'Thời gian giao'), render: leadIn },
      { label: L('발주 마감', 'Hạn đặt'), render: m => m.orderBy || '' },
      { label: L('판정', 'Đánh giá'), render: m => h('div', mChip(m.judge), m.arrive ? h('div', { class: 'sub' }, L('지금 발주하면 도착 ', 'Đặt ngay sẽ đến ') + m.arrive) : null) },
    ], list, { maxH: '62vh' }),
      h('p', { class: 'help' }, L('필요량 = 진행 중 수주의 남은 양을 BOM 으로 푼 원부자재 (현장 재고는 앞 공정에서 먼저 씀). 납기 순으로 쌓은 필요량이 재고 + 입고 예정 (해외 주문의 도착 예정일까지 온 것) 을 넘는 첫 수주가 처음 모자라는 수주, 그 공정이 그 수주를 시작하는 날 (원료 입고 뒤 기다리는 날만큼 앞) 이 필요한 날, 필요한 날 − 리드타임 = 발주 마감입니다. 리드타임 칸은 품목 마스터의 리드타임을 바꿉니다. * = 도착 예정일 없는 주문.',
        'Cần = vật tư tách từ BOM của phần còn lại. PO thiếu đầu tiên = PO mà cộng dồn vượt tồn + sắp nhập, ngày cần = ngày công đoạn bắt đầu PO đó, hạn đặt = ngày cần − thời gian giao. Ô thời gian giao sửa danh mục mặt hàng. * = đơn chưa có ngày đến.')));
  }

  // ---------- 탭: 기준 자료 ----------
  function baseTab(host, R) {
    const cap = R.cap, base = R.base;
    const procTbl = ERP.simpleTable([
      { label: L('공정', 'Công đoạn'), render: p => h('b', ERP.procName(p)) },
      { label: L('조 수', 'Số ca'), render: p => { const r = procRow(p, '') || {}; const n = num(r.shifts) || 1; return h('select', { class: 'inp', 'data-plan-shift': p, onchange: (e) => setProc(p, '', 'shifts', +e.target.value) }, [1, 2, 3].map(x => h('option', { value: x, selected: n === x }, x))); } },
      { label: L('주간 시간', 'Giờ ca ngày'), render: p => nIn((procRow(p, '') || {}).day_h, v => setProc(p, '', 'day_h', v), { style: { width: '60px' } }) },
      { label: L('야간 시간', 'Giờ ca đêm'), render: p => nIn((procRow(p, '') || {}).night_h, v => setProc(p, '', 'night_h', v), { style: { width: '60px' } }) },
      { label: L('휴식 분', 'Nghỉ (phút)'), render: p => nIn((procRow(p, '') || {}).break_min, v => setProc(p, '', 'break_min', v), { style: { width: '60px' } }) },
      { label: L('불량률 %', 'Lỗi %'), render: p => nIn((procRow(p, '') || {}).defect_pct, v => setProc(p, '', 'defect_pct', v), { style: { width: '60px' } }) },
      { label: L('일보 실적 하루', 'Báo cáo / ngày'), num: 1, render: p => F.n(cap.logDay[p]) },
      { label: L('그동안 하루 조 수', 'Số ca TB'), num: 1, render: p => F.n(cap.histN[p], 2) },
      { label: L('하루 능력 직접 (비우면 일보 실적)', 'Năng lực nhập (trống = báo cáo)'), render: p => (p === 'ASM' ? h('small', { class: 'muted' }, L('품목군별 (아래)', 'theo nhóm (dưới)')) : nIn((procRow(p, '') || {}).cap_day, v => setProc(p, '', 'cap_day', v), { style: { width: '110px' }, 'data-plan-cap': p })) },
      { label: L('계산에 쓰는 하루', 'Dùng để tính / ngày'), num: 1, render: p => h('b', F.n(cap.perDay[p])) },
      { label: L('가용 인원 주간 · 야간', 'Số người ngày · đêm'), render: p => { const r = procRow(p, '') || {}; return h('span', { class: 'nowrap' }, nIn(r.people_day, v => setProc(p, '', 'people_day', v), { style: { width: '56px' } }), ' · ', nIn(r.people_night, v => setProc(p, '', 'people_night', v), { style: { width: '56px' } })); } },
      { label: L('라인당 필요 인원', 'Người / chuyền'), render: p => nIn((procRow(p, '') || {}).people_per, v => setProc(p, '', 'people_per', v), { style: { width: '56px' } }) },
    ], P.PROCS);
    const ASM_FAM = ['Mini', 'Dial', 'Pencil', 'Click pencil'];
    const fams = Array.from(new Set(Object.keys(cap.famDay).concat(R.loads.filter(r => r.proc === 'ASM').map(r => r.fam || '')).concat(ASM_FAM)))
      .sort((a, b) => (ASM_FAM.indexOf(a) < 0 ? 99 : ASM_FAM.indexOf(a)) - (ASM_FAM.indexOf(b) < 0 ? 99 : ASM_FAM.indexOf(b)) || a.localeCompare(b));
    const famRow = (f) => (f ? procRow('ASM', f) : procRow('ASM', ''));   // 품목군 없는 조립 = 조립 공정 줄의 하루 능력
    const famTbl = ERP.simpleTable([
      { label: L('조립 품목군', 'Nhóm lắp ráp'), render: f => h('b', P.famName(f)) },
      { label: L('일보 실적 하루', 'Báo cáo / ngày'), num: 1, render: f => F.n(cap.famLog[f] || 0) },
      { label: L('하루 능력 직접 (비우면 일보 실적)', 'Năng lực nhập (trống = báo cáo)'), render: f => nIn((famRow(f) || {}).cap_day, v => setProc('ASM', f, 'cap_day', v), { style: { width: '110px' }, 'data-plan-fam': f || '-' }) },
      { label: L('계산에 쓰는 하루', 'Dùng để tính / ngày'), num: 1, render: f => h('b', F.n(cap.famDay[f] || 0)) },
      { label: L('설비 기준 최대', 'Tối đa theo máy'), num: 1, render: f => (cap.machFam[f] ? F.n(cap.machFam[f]) : '–') },
      { label: L('남은 일 (pcs)', 'Việc còn (pcs)'), num: 1, render: f => { const r = R.loads.find(x => x.id === 'ASM|' + f); return r ? F.n(r.load) : '–'; } },
    ], fams);
    const waitTbl = ERP.simpleTable([
      { label: L('앞 → 다음', 'Trước → sau'), render: k => P.waitName(k) },
      { label: L('기다리는 날 (근무일)', 'Số ngày chờ (ngày làm)'), render: k => nIn((waitRow(k) || {}).days, v => setWait(k, v), { style: { width: '70px' }, placeholder: String(k.indexOf('RAW>') === 0 ? 0 : 1), 'data-plan-wait': k }) },
      { label: L('계산에 쓰는 날', 'Dùng để tính'), num: 1, render: k => F.n(base.wait[k]) + (base.waitSet[k] ? '' : L(' (기본)', ' (mặc định)')) },
    ], P.WAITS);
    // 근무 달력: 기본 = 일요일 쉼, 그와 다른 날만 줄로
    const sun = h('label', { class: 'nowrap' }, h('input', { type: 'checkbox', checked: base.sunOff, onchange: (e) => { DB.setSetting('planSunOff', e.target.checked); redraw(); } }), ' ', L('일요일은 쉼 (기본)', 'Nghỉ Chủ nhật (mặc định)'));
    const calRows = DB.rows('plan_cal').filter(r => isDate(r.date)).sort((a, b) => a.date.localeCompare(b.date));
    const wv = (r) => (r.work === true ? '1' : r.work === false ? '0' : '');
    const calTbl = ERP.simpleTable([
      { label: L('날짜', 'Ngày'), render: r => h('b', { class: r.date < R.today ? 'muted' : '' }, r.date + ' ' + F.dow(r.date)) },
      { label: L('근무', 'Làm việc'), render: r => h('select', { class: 'inp', onchange: (e) => { DB.update('plan_cal', r._id, { work: e.target.value === '' ? undefined : e.target.value === '1' }); redraw(); } },
        [['', L('기본', 'Mặc định')], ['0', L('쉼 (X)', 'Nghỉ (X)')], ['1', L('일함 (O)', 'Làm (O)')]].map(o => h('option', { value: o[0], selected: wv(r) === o[0] }, o[1]))) },
      { label: L('휴일 · 메모', 'Ngày nghỉ · ghi chú'), render: r => h('input', { class: 'inp', value: r.memo || '', onchange: (e) => DB.update('plan_cal', r._id, { memo: e.target.value.trim() || undefined }) }) },
      { label: L('잔업 시간', 'Tăng ca (giờ)'), render: r => nIn(r.ot_h, v => { DB.update('plan_cal', r._id, { ot_h: setOrDrop(v) }); redraw(); }, { style: { width: '60px' } }) },
      { label: L('조 수가 다른 공정', 'Công đoạn khác số ca'), render: r => h('small', { class: 'muted' }, P.PROCS.filter(p => num(r[SH[p]]) > 0).map(p => ERP.procName(p) + ' ' + r[SH[p]]).join(' · ')) },
      { label: '', render: r => h('button', { class: 'icon-btn', title: L('지우기', 'Xóa'), onclick: () => { DB.remove('plan_cal', r._id); redraw(); } }, '×') },
    ], calRows, { maxH: '42vh' });
    const d1 = h('input', { class: 'inp', type: 'date' }), d2 = h('input', { class: 'inp', type: 'date', title: L('까지 (비우면 하루)', 'Đến (trống = 1 ngày)') });
    const wSel = h('select', { class: 'inp' }, [['0', L('쉼', 'Nghỉ')], ['1', L('일함', 'Làm')]].map(o => h('option', { value: o[0] }, o[1])));
    const memo = h('input', { class: 'inp', placeholder: L('메모 (예: 설 Tết)', 'Ghi chú (VD: Tết)') });
    const addDays = h('button', { class: 'btn', 'data-plan-add-day': '1', onclick: () => {
      const a = d1.value, b = d2.value || d1.value; if (!isDate(a) || !isDate(b) || b < a) { ERP.toast(L('날짜를 넣으세요 (까지 ≥ 부터)', 'Hãy nhập ngày (đến ≥ từ)'), 'warn'); return; }
      if (F.diffDays(b, a) > 120) { ERP.toast(L('한 번에 120일까지 넣을 수 있습니다', 'Tối đa 120 ngày một lần'), 'warn'); return; }
      const patch = { work: wSel.value === '1', memo: memo.value.trim() || undefined }; const add = [];
      for (let d = a; d <= b; d = F.addDays(d, 1)) { const e = DB.rows('plan_cal').find(r => r.date === d); if (e) DB.update('plan_cal', e._id, patch); else add.push(Object.assign({ date: d }, patch)); }
      if (add.length) DB.addMany('plan_cal', add); redraw(); } }, '+ ' + L('날짜 넣기', 'Thêm ngày'));
    const ms = DB.rows('machines'); const act = ms.filter(m => m.active !== false); const std = act.filter(m => num(m.per_shift) > 0);
    const sec = (title, help, el) => h('section', { style: { marginBottom: '22px' } }, h('h3', { style: { margin: '0 0 6px' } }, title), help ? h('p', { class: 'help', style: { margin: '0 0 8px' } }, help) : null, el);
    host.append(
      h('p', { class: 'help', style: { marginTop: 0 } }, L('여기 값은 모든 PC 가 같이 씁니다. 생산계획_기준자료_양식 엑셀을 [엑셀 · 구글 연동 → 엑셀 업로드] 에 올리면 한 번에 채워집니다. 바꾸면 계획이 바로 다시 계산됩니다.',
        'Các giá trị này dùng chung cho mọi máy. Tải file mẫu dữ liệu chuẩn ở [Excel · Google → Tải Excel] để điền một lần. Kế hoạch tính lại ngay khi sửa.')),
      sec(L('공정별 조 · 근무 시간 · 불량률 · 하루 능력 · 인원', 'Ca · giờ làm · tỷ lệ lỗi · năng lực · nhân lực theo công đoạn'),
        L('조 수를 바꾸면 하루 능력이 그 비율로 바뀝니다 (일보 실적 × 계획 조 수 ÷ 그동안 하루 조 수). 불량률만큼 더 만들고, 인원은 아직 계산에 쓰지 않습니다 (참고).', 'Đổi số ca thì năng lực đổi theo tỷ lệ. Làm thêm theo tỷ lệ lỗi. Nhân lực chưa dùng để tính (tham khảo).'), procTbl),
      sec(L('조립 품목군별 하루 능력', 'Năng lực lắp ráp theo nhóm'), L('조립은 품목군마다 설비가 달라 따로 셉니다. 일보에 없는 품목군 · 맞지 않는 실적은 직접 넣어 주세요.', 'Lắp ráp tính riêng theo nhóm. Nhóm chưa có báo cáo thì nhập trực tiếp.'), famTbl),
      sec(L('공정 사이 기다리는 날', 'Thời gian chờ giữa công đoạn'), L('앞 공정이 끝나고 다음 공정을 시작하기까지의 근무일. 원료 · 부자재 입고 → 사출 · 리필 은 자재가 그만큼 먼저 와야 하는 날입니다.', 'Số ngày làm từ khi xong công đoạn trước đến công đoạn sau. Nhập NL → ép · lõi = vật tư phải đến trước bấy nhiêu ngày.'), waitTbl),
      sec(L('근무 달력 (쉬는 날 · 일하는 날 · 잔업)', 'Lịch làm việc (nghỉ · làm · tăng ca)'), null, h('div', h('div', { class: 'toolbar' }, sun), calRows.length ? calTbl : h('div', { class: 'empty' }, L('일요일 말고 다른 날이 없습니다.', 'Chưa có ngày nào khác Chủ nhật.')),
        h('div', { class: 'toolbar', style: { marginTop: '8px' } }, d1, h('span', '~'), d2, wSel, memo, addDays))),
      sec(L('설비 (설비 기준 최대)', 'Máy (tối đa theo máy)'), null, h('p', { class: 'help', style: { margin: 0 } }, L('설비 마스터: 사용 ' + act.length + '대 · 조당 표준 생산량이 있는 설비 ' + std.length + '대. ', 'Danh mục máy: đang dùng ' + act.length + ' · có SL chuẩn ' + std.length + '. '),
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); ERP.state.prodTab = 'machines'; ERP.goto('production'); } }, L('생산 관리 → 설비에서 고치기', 'Sửa ở Sản xuất → Máy móc')))));
  }

  // ---------- 탭: 확인할 것 ----------
  function notesTab(host, R) {
    host.append(R.notes.length ? h('div', R.notes.map(x => h('div', { class: 'plan-note', style: { padding: '10px 0', borderBottom: '1px solid #EEF0F3' } },
      h('div', ERP.chip(ERP.TONE[x.tone] ? x.tone : 'neutral', x.title)), h('div', { style: { margin: '6px 0 2px', whiteSpace: 'normal' } }, x.text), h('div', { class: 'help', style: { margin: 0 } }, x.why))))
      : h('div', { class: 'empty' }, L('확인할 것이 없습니다.', 'Không có gì cần kiểm tra.')));
  }

  ERP.pages.plan = { ko: '생산 계획', vi: 'Kế hoạch sản xuất', render(root) {
    const st = ERP.state.plan = ERP.state.plan || {};
    if (!st.tab) st.tab = 'orders'; if (st.scope !== 'firm') st.scope = 'all';
    const R = P.run(st.scope), O = P.run(st.scope === 'all' ? 'firm' : 'all');
    root.appendChild(ERP.pageHead(L('생산 계획', 'Kế hoạch sản xuất'), L('진행 중 수주를 납기 순으로 — 공정별 남은 일 · 끝나는 날 · 출고 가능일 · 모자랄 자재. 하루 능력은 최근 3개월 생산 일보 실적입니다 (대강의 계획).', 'PO đang mở theo hạn giao — việc còn theo công đoạn · ngày xong · ngày xuất · vật tư sẽ thiếu. Năng lực/ngày theo báo cáo 3 tháng gần nhất (kế hoạch sơ bộ).'),
      [h('button', { class: 'btn', 'data-plan-xlsx': '1', onclick: () => exportBook(R, O) }, L('엑셀로 받기', 'Tải Excel')), h('button', { class: 'btn', onclick: () => { ERP.state.dataTab = 'import'; ERP.goto('data'); } }, L('기준 자료 양식 올리기', 'Tải file dữ liệu chuẩn'))]));
    const nOf = (s) => (s === st.scope ? R : O).orders.length;
    root.appendChild(h('div', { class: 'toolbar' }, h('div', { class: 'seg' }, [['all', L('PO미정 포함', 'Gồm PO chưa có số')], ['firm', L('확정 PO 만', 'Chỉ PO đã chốt')]].map(o =>
      h('button', { type: 'button', class: 'btn sm' + (st.scope === o[0] ? ' primary' : ''), 'data-plan-scope': o[0], onclick: () => { st.scope = o[0]; ERP.render(); } }, o[1] + ' ' + nOf(o[0])))),
      h('span', { class: 'muted', style: { fontSize: '12.5px' } }, scopeName(O.scope) + L(' 이면: 지연 예상 ', ': dự kiến trễ ') + O.counts.late + L('줄 · 전부 출고 ', ' dòng · xuất hết ') + (O.lastShip || '–'))));
    const b = R.bottle;
    root.appendChild(h('section', { class: 'kpis' },
      ERP.kpi(L('진행 중 수주', 'PO đang mở'), F.n(R.orders.length), L('줄', 'dòng'), 'info', F.n(R.remSets) + ' set', scopeName(R.scope)),
      ERP.kpi(L('전부 출고 가능 (계산)', 'Xuất hết (dự kiến)'), R.lastShip || '–', '', R.counts.late ? 'warn' : 'ok', R.lastShip ? F.n(F.diffDays(R.lastShip, R.today)) + L('일 뒤', ' ngày nữa') : L('계산 못 함', 'không tính được'), L('가장 늦은 수주 기준', 'theo PO muộn nhất')),
      ERP.kpi(L('가장 막히는 공정', 'Công đoạn nghẽn nhất'), b ? P.loadName(b.id) : '–', '', 'warn', b ? F.n(b.days, 1) + L(' 근무일', ' ngày làm') : '–', b ? L('끝 ', 'xong ') + dT(b.end) : ''),
      ERP.kpi(L('납기 지연 예상', 'Dự kiến trễ hạn'), F.n(R.counts.late), L('줄', 'dòng'), R.counts.late ? 'bad' : 'ok', R.counts.late ? L('확인', 'Kiểm tra') : L('없음', 'Không có'), L('빠듯함 ', 'Sát hạn ') + R.counts.tight + L(' · 납기 지남 ', ' · quá hạn ') + R.counts.past),
      ERP.kpi(L('모자랄 자재', 'Vật tư sẽ thiếu'), F.n(R.short.length), L('종', 'mã'), R.urgent.length ? 'bad' : R.short.length ? 'warn' : 'ok', L('급함 ', 'Gấp ') + R.urgent.length, L('리드타임 없음 ', 'Chưa có thời gian giao ') + R.short.filter(m => !m.lead).length)));
    const warnN = R.notes.filter(x => x.tone === 'bad' || x.tone === 'warn').length;
    const tabs = [{ id: 'orders', label: L('수주별 완료 예상', 'Dự kiến theo PO') + ' ' + R.orders.length }, { id: 'loads', label: L('공정별 부하', 'Tải công đoạn') },
      { id: 'mats', label: L('자재', 'Vật tư') + ' ' + R.short.length }, { id: 'base', label: L('기준 자료', 'Dữ liệu chuẩn') }, { id: 'notes', label: L('확인할 것', 'Cần kiểm tra') + (warnN ? ' ' + warnN : '') }];
    if (!tabs.some(t => t.id === st.tab)) st.tab = 'orders';
    const host = h('div', { class: 'card' });
    root.append(ERP.tabs(tabs, st.tab, (id) => { st.tab = id; ERP.render(); }), host);
    ({ orders: ordersTab, loads: loadsTab, mats: matsTab, base: baseTab, notes: notesTab })[st.tab](host, R, st);
  } };
})();
