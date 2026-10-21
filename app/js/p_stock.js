/* 품목 · 현장 재고 · 원부자재 재고 (12차: 메뉴 3개로 나눔, 6차 '품목·재고' 를 대체) — Mặt hàng · Tồn hiện trường · Tồn NVL
   품목: 품목 마스터 · 코드 사전 · 자료 점검 · 예시 자료
   현장 재고: 재고(공정 흐름 카드 · 필터) · 생산 반영 · 수불 입력 · 수불 내역 (현장 품목만)
   원부자재 재고(페이지 id 'materials' — 예전 주소 · AI 비서 버튼과 맞춤): 재고 · 수불 입력 · 수불 내역 · 발주/안전재고 · 외주 (원부자재만)
   예전 코드의 `ERP.state.matTab = '탭'; ERP.goto('materials')` 는 그 탭이 있는 메뉴로 보낸다 (ERP.goStock). ECOUNT 비교는 12차에서 없앰 (ECOUNT 를 그만 씀). */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, C = ERP.calc, F = ERP.fmt, INV = ERP.inv;
  const num = C.num; const EPS = 1e-6;
  const put = ERP.put;   // 빈 값은 빼고 붙인다 (Element.append 는 null 을 "null" 글자로 붙임)
  const STAT = () => ({ low: [L('미달', 'Thiếu'), 'bad'], neg: [L('마이너스', 'Âm'), 'bad'], near: [L('임박', 'Sắp thiếu'), 'warn'], ok: [L('정상', 'Tốt'), 'ok'], na: [L('기준없음', 'Chưa đặt'), 'neutral'] });
  const isInt = (v) => Math.abs(v - Math.round(v)) < 1e-9;
  const fq = (v, u) => (v === null || v === undefined || v === '' ? '–' : F.n(v, u === 'kg' || !isInt(+v) ? 2 : 0));
  const uniq = (a) => Array.from(new Set(a.filter(Boolean))).sort();
  const negStyle = (v) => (v < -EPS ? { color: '#B3261E', fontWeight: 700 } : null);
  // 12차: 배럴 계열(WIP01 · WIP11 · WIP21 …)은 부품 안에서 배럴 옆에 둔다 (사용자 규칙 wip11+wip21+wipx1 = wip01)
  const FLOW = [
    { ko: '자재', vi: 'Vật tư', st: ['RM', 'SM', 'CM'] },
    { ko: '부품', vi: 'Linh kiện', st: ['WIP00', 'WIP01', 'WIP11', 'WIPx1', 'WIP02', 'WIP03', 'WIP04', 'WIPx6', 'WIPx5'] },
    { ko: '조립', vi: 'Lắp ráp', st: ['WIP55', 'WIP'] },
    { ko: '포장', vi: 'Đóng gói', st: ['SG', 'FG'] },
  ];
  const stageCodeShow = INV.stageCodeShow;
  /** 품목이 어느 재고 쪽인가: 'mat' 원부자재 · 'floor' 현장 · 'test' */
  const grpOf = (it) => (it ? INV.groupOf(Object.assign({ m: it }, INV.info(it))) : 'mat');

  /** colored chips for stage / category / line / sub */
  ERP.codeChips = function (s) {
    if (!s) return '';
    const out = [h('span', { class: 's1', title: s.stage + ' · ' + INV.stageName(s.stage) }, INV.labelShort('stage', s.stage))];
    if (s.cat) out.push(h('span', { class: 's2', title: s.cat + ' · ' + INV.label('cat', s.cat, s.stage) }, INV.labelShort('cat', s.cat, s.stage)));
    if (s.line) out.push(h('span', { class: 's2', title: s.line + ' · ' + INV.label('line', s.line) }, INV.labelShort('line', s.line)));
    if (s.sub) out.push(h('span', { class: 's3', title: s.sub + ' · ' + INV.label('sub', s.sub) }, INV.labelShort('sub', s.sub)));
    return h('span', { class: 'codechips' }, out);
  };
  const scopeChip = (v) => (v ? ERP.chip(v === 'WH' ? 'info' : 'neutral', ERP.scopeName(v)) : '');
  const kindChip = (k) => ERP.chip({ IN: 'info', OUT: 'warn', MOVE: 'neutral', ADJ: 'neutral', PROD: 'ok', USE: 'warn' }[k] || 'neutral', ERP.txKindName(k));
  /** 14차: 거래처 (업체코드) · 용도 · Lot · 색깔 · 비고 (창고 입출고장 I 칸에서 나눈 것) */
  const partnerText = (t) => (t.partner ? t.partner + (t.partner_code ? ' (' + t.partner_code + ')' : '') : (t.partner_code || ''));
  const txNote = (t) => [t.purpose, t.lot ? 'Lot ' + t.lot : '', t.color ? L('색깔 ', 'màu ') + t.color : '', t.note].filter(Boolean).join(' · ');
  const srcLabel = (t) => { const s = String(t.src || ''); if (s.indexOf('daily:') === 0) return L('생산 자동', 'Tự động SX'); if (s === 'manual') return L('화면 입력', 'Nhập tay'); if (s === 'wh') return L('창고 입출고장', 'Bảng kê NXT'); if (s === 'ledger') return L('KHO NVL 엑셀', 'Excel KHO NVL'); if (s.indexOf('xl') === 0) return L('엑셀 양식', 'Mẫu Excel'); if (s.indexOf('auto:') === 0) return L('자동 제안', 'Đề xuất'); if (s === 'outsource') return L('외주', 'Gia công'); return s; };

  function basisLine() {
    const m = INV.meta(); const od = m.open;
    const parts = [];
    if (od.WH || od.FAC) parts.push(L('기초재고 ', 'Tồn đầu ') + [od.WH ? L('창고 ', 'Kho ') + od.WH : null, od.FAC ? L('공장 ', 'Xưởng ') + od.FAC : null].filter(Boolean).join(' · '));
    else parts.push(L('기초재고 없음 — ECOUNT 재고현황을 "기초재고로 설정"으로 올리세요', 'Chưa có tồn đầu — tải "Tồn kho" ECOUNT và chọn "Đặt làm tồn đầu kỳ"'));
    if (od.FLOOR) parts.push(L('현장 실사 ', 'Kiểm kê hiện trường ') + od.FLOOR);
    parts.push(L('수불 ', 'Phiếu ') + F.n(m.txCount) + L('건', ' dòng') + (m.lastTx ? L(' (마지막 ', ' (gần nhất ') + m.lastTx + ')' : ''));
    parts.push(L('생산 반영 ', 'Cập nhật SX ') + (m.mode === 'off' ? L('끔', 'tắt') : F.n(m.postCount) + L('건', ' dòng') + (m.lastProd ? ' (' + m.lastProd + ')' : '')));
    return parts.join(' · ');
  }

  // ===================================================================== item detail (수불부)
  ERP.itemDetail = ERP.materialDetail = function (code) {
    const m = INV.item(code); const key = m ? m.code : code; const s = C.stock().get(key); const led = INV.ledger(key);
    const S = STAT(); const u = s ? s.prim : (m ? INV.unitShow(m.unit) : '');
    const kv = (k, v) => [h('dt', k), h('dd', v === undefined || v === null || v === '' ? '–' : v)];
    const info = h('dl', { class: 'kv' }, kv(L('품목코드', 'Mã hàng'), key), kv(L('품명', 'Tên'), m ? m.name : (s ? s.name : '')), kv('ERP CODE', m ? m.erp_code : ''), kv(L('분류', 'Phân loại'), s ? ERP.codeChips(s) : ''),
      kv(L('세관신고 코드 (Mã XNK)', 'Mã XNK'), m ? m.xnk : ''), kv(L('품목구분', 'Loại'), m ? m.etype : ''), kv(L('단위', 'Đơn vị'), u + (m && m.kg_per_ea ? L(' (개당 ', ' (') + F.n(m.kg_per_ea, 4) + ' kg)' : '')),
      m && m.name_vn ? kv(L('품명 (베트남어 원문)', 'Tên tiếng Việt'), m.name_vn) : null,
      m && (m.set_per_ct || m.pcs_per_set) ? kv(L('환산', 'Quy đổi'), [m.set_per_ct ? F.n(m.set_per_ct, 2) + ' set/CT' : null, m.pcs_per_set ? F.n(m.pcs_per_set, 2) + ' pcs/set' : null].filter(Boolean).join(' · ')) : null,
      m && m.missing ? kv(L('주의', 'Lưu ý'), ERP.chip('warn', L('최근 ECOUNT 품목등록 파일에 없음', 'Không có trong file ECOUNT gần nhất'))) : null);
    const kpis = s ? h('div', { class: 'kpis' },
      ERP.kpi(L('창고', 'Kho'), fq(s.by.WH, u), u, s.by.WH < -EPS ? 'bad' : 'neutral', s.by.WH < -EPS ? L('마이너스', 'Âm') : null),
      ERP.kpi(L('공장', 'Xưởng'), fq(s.by.FAC, u), u, s.by.FAC < -EPS ? 'bad' : 'neutral', s.by.FAC < -EPS ? L('마이너스', 'Âm') : null),
      ERP.kpi(L('합계', 'Tổng'), fq(s.bal, u), u, s.status === 'na' ? (s.negative ? 'bad' : 'neutral') : S[s.status][1], s.status !== 'na' ? S[s.status][0] : (s.susp ? L('이동 누락 의심', 'Nghi thiếu phiếu chuyển') : null), s.sets !== null && s.sets !== undefined ? F.n(s.sets) + ' set' + (s.pcs !== null && s.pcs !== undefined ? ' · ' + F.n(s.pcs) + ' pcs' : '') : null),
      ERP.kpi(L('안전재고', 'Tồn an toàn'), s.safety === null ? '–' : F.n(s.safety), u, 'neutral', null)) : null;
    const rows = led.rows.length > 160 ? [led.rows[0]].concat(led.rows.slice(-159)) : led.rows;
    // 기초재고 출처 (14차: 창고 입출고장 · ECOUNT 보완 · 현장 실사)
    const o0 = DB.rows('stock_open').find(r => String(r.code).toUpperCase() === String(key).toUpperCase() && (led.rows[0] && led.rows[0].floor ? r.grp === 'floor' : r.grp !== 'floor'));
    const openSrc = !o0 ? '–' : o0.grp === 'floor' ? L('현장 실사', 'Kiểm kê hiện trường') : o0.grp === 'wh' ? L('창고 입출고장', 'Bảng kê nhập xuất') : o0.grp === 'fill' ? L('ECOUNT 보완', 'Bổ sung ECOUNT') : 'ECOUNT';
    const ledger = ERP.simpleTable([
      { label: L('일자', 'Ngày'), render: r => F.d(r.date) }, { label: L('구분', 'Loại'), render: r => r.open ? ERP.chip('neutral', L('기초재고', 'Tồn đầu')) : kindChip(r.kind) },
      { label: L('전표 / 출처', 'Số CT / nguồn'), render: r => r.open ? openSrc : [r.doc_no, r.proc ? ERP.procName(r.proc) : null, r.manual ? null : null].filter(Boolean).join(' · ') || srcLabel(r) },
      { label: L('창고 ±', 'Kho ±'), num: 1, render: r => (r.open ? fq(r.wh, u) : (r.wh ? (r.wh > 0 ? '+' : '') + fq(r.wh, u) : '')), style: r => negStyle(r.wh) },
      { label: L('공장 ±', 'Xưởng ±'), num: 1, render: r => (r.open ? fq(r.fac, u) : (r.fac ? (r.fac > 0 ? '+' : '') + fq(r.fac, u) : '')), style: r => negStyle(r.fac) },
      { label: L('창고 잔액', 'Tồn kho'), num: 1, render: r => fq(r.balWH, u), style: r => negStyle(r.balWH) }, { label: L('공장 잔액', 'Tồn xưởng'), num: 1, render: r => fq(r.balFAC, u), style: r => negStyle(r.balFAC) },
      { label: L('합계', 'Tổng'), num: 1, render: r => h('b', fq(r.bal, u)), style: r => negStyle(r.bal) },
      { label: L('비고', 'Ghi chú'), render: r => r.before ? ERP.chip('neutral', L('기준일 이전 (반영 안 됨)', 'Trước ngày chốt (không tính)')) : [partnerText(r), txNote(r)].filter(Boolean).join(' · ') }], rows, { maxH: '320px' });
    // where used
    const used = [];
    DB.rows('bom_lines').forEach(l => { if (String(l.child) === key) used.push(L('BOM: ', 'BOM: ') + l.parent + ' (' + F.n(l.qty, 3) + ')'); });
    let bomParts = 0; DB.rows('bom').forEach(b => { if ([b.nose_code, b.refill_code, b.barrel_code, b.holder, b.spoon].some(x => String(x || '') === key)) bomParts++; });
    if (bomParts) used.push(L('예시 BOM(색상별) 부품으로 ', 'Linh kiện trong BOM mẫu: ') + bomParts + L('곳', ' chỗ'));
    const po = C.orders().filter(o => String(o.p.item_no || '') === key && C.isOpen(o));
    const poBox = po.length ? h('div', h('h3', L('진행 중 수주 (이 품번)', 'PO đang mở (mã này)')), ERP.simpleTable([{ label: 'PO', render: o => o.p.po_no }, { label: L('거래처', 'Khách'), render: o => o.p.customer || '' }, { label: L('주문 set', 'Đặt (set)'), num: 1, render: o => F.n(o.sets) }, { label: L('포장 set', 'Đã đóng'), num: 1, render: o => F.n(o.packed) }, { label: L('남은 set', 'Còn lại'), num: 1, render: o => h('b', F.n(Math.max(0, o.sets - o.packed))) }, { label: L('납기', 'Hạn'), render: o => F.d(o.p.due) }], po.slice(0, 20), { maxH: '200px' }),
      s && s.sets !== null && s.sets !== undefined ? h('p', { class: 'help' }, L('완제품 재고 ', 'Tồn thành phẩm ') + F.n(s.sets) + L(' set · 남은 수주 ', ' set · PO còn lại ') + F.n(po.reduce((a, o) => a + Math.max(0, o.sets - o.packed), 0)) + ' set') : null) : null;
    ERP.modal({ title: key + ' · ' + ((m && m.name) || (s && s.name) || ''), width: '1100px', body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, info, kpis,
      h('h3', { style: { margin: '4px 0 0' } }, L('수불부', 'Sổ nhập xuất tồn') + ' (' + F.n(led.rows.length - 1) + L('건', ' dòng') + ')'), ledger,
      used.length ? h('p', { class: 'help' }, L('사용처: ', 'Dùng trong: ') + used.slice(0, 8).join(' · ')) : null, poBox),
    buttons: [{ label: L('닫기', 'Đóng') },
      { label: L('수불 입력', 'Nhập phiếu'), onClick: () => { const fl = grpOf(m) === 'floor'; const k = fl ? 'txe_floor' : 'txe'; const e = ERP.state[k] = ERP.state[k] || { rows: [] }; e.rows = e.rows.filter(r => r.code); e.rows.push(fl ? { date: F.today(), kind: 'ADJ', to: 'FAC', code: key } : { date: F.today(), kind: 'IN', to: 'WH', code: key }); ERP.goStock(fl ? 'fentry' : 'entry'); setTimeout(() => ERP.render(), 0); } },
      m ? { label: L('품목 편집', 'Sửa mã hàng'), kind: 'primary', onClick: () => { setTimeout(() => ERP.form('items', m, { onSaved: () => ERP.render(), beforeSave: itemBeforeSave }), 0); } } : null].filter(Boolean) });
  };
  const itemBeforeSave = (v) => { const p = INV.parse(v.erp_code, v.code); if (v.erp_code) { v.stage = p.stage; v.line = p.line || undefined; v.sub = p.sub || undefined; v.cat = p.cat || undefined; } if (!v.src) v.src = 'local'; };

  // ===================================================================== 원부자재 재고 / 생산현장 재고 (7차: 탭 분리)
  const GROUPS = () => ({
    mat: { title: L('원부자재 재고', 'Tồn nguyên vật liệu'), flow: FLOW.filter(g => g.st.some(x => INV.MAT_STAGES.includes(x))),
      help: L('원재료(RM) · 부자재(SM) · 소모품(CM) 입니다. 창고 입고 · 출고 · 창고 → 공장 이동 같은 수불로만 바뀌고, 생산 반영(생산일보 · BOM · 배합표 · 사출 원료)으로는 차감하지 않습니다.', 'Nguyên liệu (RM) · vật liệu phụ (SM) · vật tư tiêu hao (CM). Chỉ thay đổi theo phiếu nhập · xuất · chuyển Kho → Xưởng; cập nhật SX (báo cáo · BOM · công thức · nhựa ép) không trừ NVL.') },
    floor: { title: L('현장 재고', 'Tồn hiện trường'), flow: FLOW.filter(g => g.st.some(x => INV.FLOOR_STAGES.includes(x))),
      help: L('공정 중 재고(심 · 배럴 · 노즈콘 · 홀더 · 스푼 → 스탬핑 → 조립)와 포장품입니다. 배럴 = WIP01 + WIP11 + WIP21 … (같은 배럴 계열), 조립품 = 심 + 배럴 + 노즈콘 + 그 밖의 부품. 생산일보를 올리면 생산량이 입고되고, 조립 수량만큼 현장 부품이 차감됩니다 (원부자재는 차감 안 함).', 'Tồn đang SX (lõi · barrel · nose · holder · spoon → ép nhũ → lắp ráp) và hàng đóng gói. Barrel = WIP01 + WIP11 + WIP21 … ; bút lắp = lõi + barrel + nose + linh kiện khác. Báo cáo SX: nhập sản lượng, trừ linh kiện hiện trường theo số lượng lắp (không trừ NVL).') },
  });
  /** open the stock screen on the right tab for a stage (used by the dashboard / assistant) */
  ERP.openStock = function (stage, extra) {
    const g = stage && INV.groupOf({ stage }) === 'floor' ? 'floor' : 'mat'; const k = 'stk_' + g;
    ERP.state[k] = Object.assign(ERP.state[k] || {}, { stage: stage || '', line: '', sub: '', cat: '', page: 0 }, extra || {});
    ERP.goStock(g);   // 12차: 현장 재고 / 원부자재 재고 메뉴
  };
  const other = (s, group) => (group === 'floor' ? r4(s.in - s.out + s.adj) : r4(s.prod - s.out + s.adj));
  const r4 = (x) => Math.round((+x || 0) * 10000) / 10000;
  function stockTab(host, group) {
    const G = GROUPS()[group];
    const key = 'stk_' + group;
    const st = ERP.state[key] = ERP.state[key] || { stage: '', line: '', sub: '', cat: '', scope: 'all', status: '', q: '', hideZero: true, sk: 'code', sd: 1, page: 0, ps: 100 };
    const all = INV.rows().filter(s => INV.groupOf(s) === group); const sum = INV.stageSummary(all); const byStage = new Map(sum.map(x => [x.stage, x]));
    if (st.stage && !all.some(s => s.stage === st.stage)) st.stage = '';
    const S = STAT();
    const card = (code) => {
      const o = byStage.get(code) || { items: 0, withStock: 0, negative: 0, low: 0, susp: 0 };
      // 12차: 이름이 정해지지 않은 단계는 코드만 (짐작한 이름 · 물음표 없음). 이름은 품목 → 코드 사전에서 넣는다
      const named = !INV.isGuessed('stage', code);
      return h('button', { type: 'button', class: 'st' + (st.stage === code ? ' on' : ''), title: named ? '' : L('이름 없음 — 품목 → 코드 사전에서 이름을 넣을 수 있습니다', 'Chưa có tên — đặt tên ở Mặt hàng → Từ điển mã'), onclick: () => { st.stage = st.stage === code ? '' : code; st.line = st.sub = st.cat = ''; st.page = 0; ERP.render(); } },
        h('b', { title: INV.stageName(code) }, INV.labelShort('stage', code)), named ? h('code', stageCodeShow(code)) : null,
        h('div', { class: 'n' }, F.n(o.withStock), h('small', ' / ' + F.n(o.items))),
        h('div', { class: 'fl' }, o.negative ? h('span', { style: { background: '#FBE6E4', color: '#9F1F18' } }, '−' + F.n(o.negative)) : null, o.low ? h('span', { style: { background: '#FCEFD9', color: '#7A4600' } }, L('미달 ', 'thiếu ') + o.low) : null, o.susp ? h('span', { style: { background: '#EEF0F3', color: '#3C4551' }, title: L('이동 누락 의심 (창고 +, 공장 − 또는 반대)', 'Nghi thiếu phiếu chuyển (Kho +, Xưởng − hoặc ngược lại)') }, L('이동 누락 ', 'thiếu chuyển ') + o.susp) : null));
    };
    const flow = h('div', { class: 'flow' });
    G.flow.forEach((g, gi) => { if (gi) flow.appendChild(h('span', { class: 'arrow' }, '›')); flow.appendChild(h('div', { class: 'grp' }, h('small', L(g.ko, g.vi)), h('div', g.st.filter(x => group === 'mat' ? INV.MAT_STAGES.includes(x) : INV.FLOOR_STAGES.includes(x)).map(card)))); });
    const etc = byStage.get('ETC'); if (etc && etc.items) flow.append(h('span', { class: 'arrow' }, '·'), h('div', { class: 'grp' }, h('small', L('기타', 'Khác')), h('div', card('ETC'))));
    const hasStock = (s) => Math.abs(s.by.WH) > EPS || Math.abs(s.by.FAC) > EPS;
    const tot = { items: all.length, stock: all.filter(s => Math.abs(s.bal) > EPS || hasStock(s)).length, neg: all.filter(s => s.negative).length, low: all.filter(s => s.status === 'low' || s.status === 'neg').length, susp: all.filter(s => s.susp).length, safety: all.filter(s => s.safety > 0).length,
      prodN: all.filter(s => s.prod > EPS).length, prodQ: all.reduce((a, s) => a + (s.prod || 0), 0), useN: all.filter(s => s.use > EPS).length, useQ: all.reduce((a, s) => a + (s.use || 0), 0) };
    const meta = INV.meta();
    const kpis = group === 'floor' ? [
      ERP.kpi(L('재고 있는 품목', 'Mã có tồn'), F.n(tot.stock), L('품목', 'mã'), 'neutral', null, L('반제품 · 완제품 ', 'BTP · TP ') + F.n(tot.items) + L('품목 중', ' mã')),
      ERP.kpi(L('생산 입고 (기초 이후)', 'Nhập SX (sau tồn đầu)'), F.n(tot.prodN), L('품목', 'mã'), tot.prodN ? 'ok' : 'neutral', meta.mode === 'off' ? L('반영 꺼짐', 'Đang tắt') : (meta.lastProd ? L('마지막 ', 'Gần nhất ') + meta.lastProd : L('아직 없음', 'Chưa có')), L('생산일보에서 자동 계산', 'Tự tính từ báo cáo SX')),
      ERP.kpi(L('조립·공정 부품 차감', 'Trừ linh kiện theo SX'), F.n(tot.useN), L('품목', 'mã'), 'neutral', null, L('BOM이 있는 생산품만 차감', 'Chỉ trừ khi có BOM')),
      ERP.kpi(L('마이너스 재고', 'Tồn âm'), F.n(tot.neg), L('품목', 'mã'), tot.neg ? 'bad' : 'ok', tot.neg ? L('확인 필요', 'Cần kiểm tra') : L('없음', 'Không có'), L('창고+공장 합계 기준', 'Theo tổng Kho + Xưởng'))] : [
      ERP.kpi(L('재고 있는 품목', 'Mã có tồn'), F.n(tot.stock), L('품목', 'mã'), 'neutral', null, L('원부자재 ', 'NVL ') + F.n(tot.items) + L('품목 중', ' mã')),
      ERP.kpi(L('마이너스 재고', 'Tồn âm'), F.n(tot.neg), L('품목', 'mã'), tot.neg ? 'bad' : 'ok', tot.neg ? L('확인 필요', 'Cần kiểm tra') : L('없음', 'Không có'), L('창고+공장 합계 기준', 'Theo tổng Kho + Xưởng')),
      ERP.kpi(L('안전재고 미달', 'Dưới tồn an toàn'), F.n(tot.low), L('품목', 'mã'), tot.low ? 'bad' : 'ok', tot.low ? L('발주 필요', 'Cần đặt') : L('정상', 'Tốt'), L('안전재고 설정 ', 'Đã cài ') + F.n(tot.safety) + L('품목 중', ' mã')),
      ERP.kpi(L('이동 누락 의심', 'Nghi thiếu phiếu chuyển kho'), F.n(tot.susp), L('품목', 'mã'), tot.susp ? 'warn' : 'ok', tot.susp ? L('자료 점검에서 정리', 'Xử lý ở "Kiểm tra dữ liệu"') : L('없음', 'Không có'), L('한쪽 +, 다른 쪽 −', 'Một bên +, bên kia −'))];
    // 11차: 공정 중 재고의 기준(현장 실사)과 원부자재의 기준(ECOUNT)을 따로 보여 준다
    const odAll = INV.openDates();
    const basis = group === 'floor'
      ? (odAll.FLOOR ? h('p', { class: 'help', style: { marginTop: 0 } }, ERP.chip('info', L('현장 실사 기준일 ', 'Ngày kiểm kê ') + odAll.FLOOR), ' ', L('공정 중 품목은 현장 실사 수량에서 시작해 다음 날부터의 생산 · 소모를 더합니다. 원부자재 재고(ECOUNT 기준일 ', 'Mã đang SX bắt đầu từ số kiểm kê, cộng SX · tiêu hao từ ngày hôm sau. Tồn NVL (ngày ECOUNT ') + (odAll.FAC || odAll.WH || '–') + L(')와 따로 관리합니다. 외주에서 받아 창고에 있는 반제품(창고 입출고장에 있는 것)은 창고 칸에 창고 입출고장 수량이 들어가고, 현장으로 분출하면 수불 입력의 이동(창고 → 공장)으로 옮깁니다.', ') quản lý riêng. BTP nhận từ gia công đang ở kho (có trong bảng kê kho) nằm ở cột Kho; khi xuất ra xưởng, nhập phiếu chuyển (Kho → Xưởng).'))
        : h('p', { class: 'help', style: { marginTop: 0 } }, ERP.chip('warn', L('현장 실사 없음', 'Chưa kiểm kê')), ' ', L('엑셀 업로드에 현장 재고 실사 파일(TỒN KHO)을 올리면 공정 중 재고의 기초가 됩니다 (그 전에는 ECOUNT 공장 재고를 씁니다).', 'Tải file kiểm kê hiện trường (TỒN KHO) ở Tải Excel để làm tồn đầu cho hàng đang SX (trước đó dùng tồn Xưởng ECOUNT).')))
      : null;
    put(host, h('p', { class: 'help', style: { marginTop: 0 } }, G.help, ' ', L('칸을 누르면 아래 표가 그 단계로 바뀝니다. 숫자 = 재고 있는 품목 / 전체 품목.', 'Bấm vào ô để lọc bảng. Số = mã có tồn / tổng mã.')), ...[basis].filter(Boolean), flow,
      h('section', { class: 'kpis', style: { margin: '12px 0' } }, kpis));
    // ---- filters
    let rows = all.slice();
    if (st.stage) rows = rows.filter(s => s.stage === st.stage);
    const lines = uniq(rows.map(s => s.line)), subs = uniq(rows.map(s => s.sub)), cats = uniq(rows.map(s => s.cat));
    if (st.line) rows = rows.filter(s => s.line === st.line); if (st.sub) rows = rows.filter(s => s.sub === st.sub); if (st.cat) rows = rows.filter(s => s.cat === st.cat);
    const val = (s) => (st.scope === 'WH' ? s.by.WH : st.scope === 'FAC' ? s.by.FAC : s.bal);
    if (st.hideZero && !st.status && !st.q) rows = rows.filter(s => (st.scope === 'all' ? hasStock(s) || s.n > 0 : Math.abs(val(s)) > EPS));
    if (st.status === 'neg') rows = rows.filter(s => val(s) < -EPS); else if (st.status === 'low') rows = rows.filter(s => s.status === 'low' || s.status === 'neg' || s.status === 'near');
    else if (st.status === 'susp') rows = rows.filter(s => s.susp); else if (st.status === 'zero') rows = rows.filter(s => Math.abs(val(s)) <= EPS); else if (st.status === 'safety') rows = rows.filter(s => s.safety > 0);
    else if (st.status === 'moved') rows = rows.filter(s => s.n > 0); else if (st.status === 'prod') rows = rows.filter(s => s.prod > EPS || s.use > EPS);
    if (st.q) { const k = INV.normName(st.q); rows = rows.filter(s => [s.code, s.m && s.m.erp_code, s.m && s.m.xnk, s.name].some(v => INV.normName(v).includes(k))); }
    const keyF = { code: s => s.code, name: s => s.name, unit: s => s.prim, open: s => s.openTot, in2: s => (group === 'floor' ? s.prod : s.in), use: s => s.use, oth: s => other(s, group), wh: s => s.by.WH, fac: s => s.by.FAC, bal: s => s.bal, sets: s => (s.sets === null ? -Infinity : s.sets), safety: s => (s.safety === null ? -Infinity : s.safety), status: s => s.status, last: s => s.last || '' };
    const kf = keyF[st.sk] || keyF.code; rows.sort((a, b) => { const x = kf(a), y = kf(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * st.sd; });
    const total = rows.length; const pages = Math.max(1, Math.ceil(total / st.ps)); if (st.page >= pages) st.page = pages - 1;
    const slice = rows.slice(st.page * st.ps, st.page * st.ps + st.ps);
    const sel = (k, label, opts) => h('select', { class: 'inp', onchange: (e) => { st[k] = e.target.value; st.page = 0; ERP.render(); } }, h('option', { value: '' }, label + ': ' + L('전체', 'Tất cả')), opts.map(o => h('option', { value: o[0], selected: st[k] === o[0] }, o[1])));
    const qid = 'stkq_' + group;
    const q = h('input', { type: 'search', placeholder: L('품목코드 · ERP CODE · Mã XNK · 품명', 'Mã · ERP CODE · Mã XNK · tên'), value: st.q, oninput: (e) => { st.q = e.target.value; clearTimeout(st._t); st._t = setTimeout(() => { st.page = 0; ERP.render(); const i = document.getElementById(qid); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 300); }, id: qid });
    const in2Label = group === 'floor' ? L('생산 입고 +', 'Nhập SX +') : L('입고 +', 'Nhập +');
    const useLabel = group === 'floor' ? L('부품 소모 −', 'Tiêu hao −') : L('생산 소모 −', 'Dùng cho SX −');
    const othLabel = group === 'floor' ? L('기타 수불 ±', 'Phiếu khác ±') : L('출고·조정 ±', 'Xuất · ĐC ±');
    const statusOpts = [['neg', L('마이너스', 'Âm')], ['low', L('안전재고 미달·임박', 'Dưới / sắp dưới tồn AT')], ['susp', L('이동 누락 의심', 'Nghi thiếu phiếu chuyển')], ['moved', L('기초 이후 수불 있음', 'Có phát sinh sau tồn đầu')], ['prod', L('생산 반영 있음', 'Có cập nhật SX')], ['safety', L('안전재고 설정됨', 'Đã cài tồn AT')], ['zero', L('재고 0', 'Tồn = 0')]];
    const tb = h('div', { class: 'toolbar' },
      h('label', { class: 'search' }, ERP.svg('M21 21l-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z', 17), q),
      st.stage ? h('button', { class: 'btn sm', onclick: () => { st.stage = ''; st.line = st.sub = st.cat = ''; ERP.render(); } }, INV.stageTitle(st.stage) + ' ×') : null,
      lines.length ? sel('line', L('제품군', 'Dòng SP'), lines.map(v => [v, INV.label('line', v) + (INV.label('line', v) !== v ? ' (' + v + ')' : '')])) : null,
      cats.length ? sel('cat', L('분류', 'Phân loại'), cats.map(v => [v, INV.label('cat', v, st.stage) + (INV.label('cat', v, st.stage) !== v ? ' (' + v + ')' : '')])) : null,
      subs.length ? sel('sub', L('세부/고객', 'Chi tiết/KH'), subs.map(v => [v, INV.label('sub', v) + (INV.label('sub', v) !== v ? ' (' + v + ')' : '')])) : null,
      h('select', { class: 'inp', onchange: (e) => { st.scope = e.target.value; st.page = 0; ERP.render(); } }, [['all', L('범위: 창고+공장', 'Phạm vi: Kho+Xưởng')], ['WH', L('범위: 창고', 'Phạm vi: Kho')], ['FAC', L('범위: 공장', 'Phạm vi: Xưởng')]].map(o => h('option', { value: o[0], selected: st.scope === o[0] }, o[1]))),
      sel('status', L('상태', 'Trạng thái'), statusOpts),
      h('label', { class: 'muted nowrap' }, h('input', { type: 'checkbox', checked: st.hideZero, onchange: (e) => { st.hideZero = e.target.checked; st.page = 0; ERP.render(); } }), ' ', L('재고 0 숨김', 'Ẩn tồn 0')),
      // 16차: 자재구매 파일(해외 주문) 품목만 따로 → 해외 주문 탭
      group === 'mat' ? h('button', { class: 'btn sm primary', onclick: () => ERP.goStock('buy'), title: L('자재구매 파일의 품목만 따로 보고 주문 (리드타임 관리)', 'Chỉ các mã trong file mua NVL (đặt nước ngoài)') }, L('해외 주문 품목만 ', 'Chỉ mã đặt nước ngoài ') + F.n(ERP.buy ? ERP.buy.items().length : 0)) : null,
      h('span', { class: 'sp' }),
      h('button', { class: 'btn sm', onclick: () => {
        const hdr = [L('품목코드', 'Mã hàng'), L('품명', 'Tên'), 'ERP CODE', L('단계', 'Công đoạn'), L('제품군', 'Dòng SP'), L('분류', 'Phân loại'), L('세부', 'Chi tiết'), 'Mã XNK', L('단위', 'ĐV'), L('기초', 'Đầu kỳ'), in2Label, useLabel, othLabel, L('창고', 'Kho'), L('공장', 'Xưởng'), L('합계', 'Tổng'), 'set', 'pcs', L('안전재고', 'Tồn AT'), L('상태', 'Trạng thái'), L('최근 수불', 'Phát sinh gần nhất')];
        ERP.xl.exportAoa((group === 'floor' ? 'floor_stock_' : 'material_stock_') + (st.stage || 'all'), hdr, rows.map(s => [s.code, s.name, s.m ? s.m.erp_code || '' : '', INV.stageName(s.stage), s.line ? INV.label('line', s.line) : '', s.cat ? INV.label('cat', s.cat, s.stage) : '', s.sub || '', s.m ? s.m.xnk || '' : '', s.prim, s.openTot, group === 'floor' ? s.prod : s.in, s.use, other(s, group), s.by.WH, s.by.FAC, s.bal, s.sets, s.pcs, s.safety, S[s.status][0], s.last || '']));
      } }, L('현재 보기 엑셀', 'Xuất Excel (đang xem)')));
    const th = (k, label, isNum, title) => h('th', { class: 'sortable' + (isNum ? ' num' : ''), title: title || null, onclick: () => { if (st.sk === k) st.sd = -st.sd; else { st.sk = k; st.sd = isNum ? -1 : 1; } ERP.render(); } }, label, st.sk === k ? (st.sd > 0 ? ' ▲' : ' ▼') : '');
    const sgn = (v, u) => (Math.abs(v) <= EPS ? h('span', { class: 'muted' }, '·') : (v > 0 ? '+' : '') + fq(v, u));
    const table = h('div', { class: 'tbl-wrap', style: { maxHeight: '60vh' } }, h('table', { class: 'tbl' },
      h('thead', h('tr', th('code', L('품목코드', 'Mã hàng')), th('name', L('품명 · 분류', 'Tên · phân loại')), th('unit', L('단위', 'ĐV')),
        th('open', L('기초', 'Đầu kỳ'), 1, group === 'floor' ? L('공정 중 품목 = 현장 실사 수량, 포장품 = ECOUNT 기초재고', 'Đang SX = số kiểm kê hiện trường, đóng gói = tồn đầu ECOUNT') : L('ECOUNT 기초재고 (창고+공장)', 'Tồn đầu ECOUNT (Kho+Xưởng)')), th('in2', in2Label, 1), th('use', useLabel, 1), th('oth', othLabel, 1),
        th('wh', L('창고', 'Kho'), 1), th('fac', L('공장', 'Xưởng'), 1), th('bal', L('합계', 'Tổng'), 1, L('= 기초 + 입고 − 소모 ± 기타', '= đầu kỳ + nhập − tiêu hao ± khác')),
        group === 'floor' ? th('sets', 'set', 1) : th('safety', L('안전재고', 'Tồn AT'), 1), th('status', L('상태', 'TT')), th('last', L('최근 수불', 'Gần nhất')))),
      h('tbody', slice.map(s => h('tr', { class: 'click', onclick: () => ERP.itemDetail(s.code) },
        h('td', h('b', s.code)), h('td', { class: 'namecell', title: (s.m && s.m.erp_code) || '' }, h('div', s.name || ''), ERP.codeChips(s), s.m && s.m.buy ? ERP.chip('info', L('해외 주문', 'Đặt nước ngoài')) : null), h('td', s.prim),
        h('td', { class: 'num', style: negStyle(s.openTot) }, fq(s.openTot, s.prim)),
        h('td', { class: 'num', style: { color: '#0E7A5F' } }, sgn(group === 'floor' ? s.prod : s.in, s.prim)), h('td', { class: 'num', style: { color: '#B45F06' } }, sgn(-s.use, s.prim)), h('td', { class: 'num' }, sgn(other(s, group), s.prim)),
        h('td', { class: 'num', style: negStyle(s.by.WH) }, fq(s.by.WH, s.prim)), h('td', { class: 'num', style: negStyle(s.by.FAC) }, fq(s.by.FAC, s.prim)), h('td', { class: 'num', style: negStyle(s.bal) || { fontWeight: 700 } }, fq(s.bal, s.prim)),
        group === 'floor' ? h('td', { class: 'num' }, s.sets === null || s.sets === undefined ? '' : F.n(s.sets)) : h('td', { class: 'num' }, s.safety === null ? '' : F.n(s.safety)),
        h('td', s.status !== 'na' ? ERP.chip(S[s.status][1], S[s.status][0]) : (s.susp ? ERP.chip('neutral', L('이동 누락', 'Thiếu chuyển')) : (s.negative ? ERP.chip('bad', L('마이너스', 'Âm')) : ''))), h('td', s.last ? F.d(s.last) : ''))))));
    const pager = h('div', { class: 'pager' }, h('span', F.n(total) + L('품목', ' mã') + (total !== all.length ? ' / ' + L('전체 ', 'tổng ') + F.n(all.length) : '')),
      h('span', { style: { display: 'inline-flex', gap: '8px', alignItems: 'center' } }, h('button', { class: 'btn', disabled: st.page === 0, onclick: () => { st.page--; ERP.render(); } }, '‹'), (st.page + 1) + ' / ' + pages, h('button', { class: 'btn', disabled: st.page >= pages - 1, onclick: () => { st.page++; ERP.render(); } }, '›')));
    put(host, tb, total ? table : h('div', { class: 'empty' }, L('조건에 맞는 품목이 없습니다.', 'Không có mã phù hợp.')), total ? pager : null,
      h('p', { class: 'help' }, (group === 'floor' ? L('합계 = 기초(공정 중: 현장 실사 · 포장품: ECOUNT) + ', 'Tổng = đầu kỳ (đang SX: kiểm kê · đóng gói: ECOUNT) + ') : L('합계 = 기초재고(ECOUNT) + ', 'Tổng = tồn đầu (ECOUNT) + ')) + in2Label.replace(/ [+]$/, '') + L(' − 소모 ± 기타 수불 (기준일 다음 날부터). ', ' − tiêu hao ± phiếu khác (từ ngày sau ngày chốt). ') + basisLine(),
        group === 'floor' ? h('span', ' ', h('a', { href: 'javascript:void 0', onclick: () => ERP.goStock('post') }, L('생산 반영 확인 →', 'Kiểm tra cập nhật SX →'))) : null));
  }

  // ===================================================================== 생산 반영 (7차): 생산일보 → 입고 · 부품/원료 차감, 코드 연결, 환산
  function postTab(host) {
    const pp = INV.prodPost(); const d = pp.diag; const meta = INV.meta(); const IT = INV.items();
    const modeSel = h('select', { class: 'inp', onchange: (e) => { DB.setSetting('prodPost', e.target.value); DB.ver.prod_log++; ERP.render(); } }, INV.PROD_MODES().map(o => h('option', { value: o.v, selected: INV.prodMode() === o.v }, o.label)));
    const dlId = 'dl_post_items'; const dl = h('datalist', { id: dlId }, DB.rows('items').filter(r => !r.hidden).slice(0, 6000).map(r => h('option', { value: r.code }, (r.name || '') + ' · ' + INV.unitShow(r.unit))));
    const issues = d.notItem.size + d.noBom.size + d.missingPart.size + d.rawUnmatched.size + d.noConv.size;
    const prodRows = pp.rows.filter(t => t.kind === 'PROD'), useRows = pp.rows.filter(t => t.kind === 'USE');
    put(host, dl,
      h('div', { class: 'card', style: { background: '#FAFBFC', marginBottom: '14px' } },
        h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, L('생산일보 → 재고 자동 반영', 'Báo cáo SX → cập nhật tồn tự động')), h('label', { class: 'muted' }, L('방식 ', 'Cách '), modeSel)),
        h('p', { class: 'help', style: { margin: 0 } }, d.mode === 'off' ? L('반영하지 않습니다. 재고는 수불만으로 계산됩니다.', 'Không cập nhật. Tồn chỉ tính theo phiếu.') : d.noOpen ? L('기초재고가 없어 반영하지 않습니다.', 'Chưa có tồn đầu nên chưa cập nhật.')
          : [L('기초재고 기준일(', 'Sau ngày chốt (') + d.open + L(') 다음 날부터의 생산일보를 반영합니다: 생산량 → 현장 재고 입고, 조립 · 스탬핑 · 포장은 BOM 의 현장 부품(반제품 · 완제품)만큼 차감. 일보를 다시 올려도 중복되지 않습니다 (매번 다시 계산). ', ') được cập nhật: sản lượng → nhập tồn hiện trường; lắp ráp · ép nhũ · đóng gói trừ linh kiện hiện trường theo BOM. Tải lại báo cáo không bị trùng. '),
            d.openFloor ? L('공정 중 품목은 현장 실사일(' + d.openFloor + ') 다음 날부터. ', 'Mã đang SX tính từ sau ngày kiểm kê (' + d.openFloor + '). ') : '',
            h('b', L('원부자재(원재료 · 부자재 · 소모품)는 차감하지 않습니다', 'Không trừ NVL (nguyên liệu · vật liệu phụ · vật tư tiêu hao)')), L(' — 사출 수지 · 배합표 원료 · BOM 에 들어 있는 부자재도 그대로입니다.', ' — kể cả nhựa ép · NL theo công thức · vật liệu phụ trong BOM.')])),
      h('section', { class: 'kpis', style: { margin: '0 0 14px' } },
        ERP.kpi(L('반영 대상 일보', 'Dòng báo cáo xét'), F.n(d.considered), L('행', 'dòng'), 'neutral', d.open ? L('기준일 ', 'Sau ') + d.open : null,
          (d.before || d.beforeFloor) ? [d.before ? L('기준일 이전 ', 'Trước ngày chốt ') + F.n(d.before) + L('행은 기초재고에 포함', ' dòng đã nằm trong tồn đầu') : '', d.beforeFloor ? (d.before ? ' · ' : '') + L('현장 실사일 이전 생산 ', 'SX trước ngày kiểm kê ') + F.n(d.beforeFloor) + L('행은 실사 수량에 포함', ' dòng đã nằm trong số kiểm kê') : ''].join('') : null),
        ERP.kpi(L('생산 입고', 'Nhập SX'), F.n(prodRows.length), L('건', 'dòng'), prodRows.length ? 'ok' : 'neutral', d.mapped ? L('코드 연결 ', 'Liên kết mã ') + F.n(d.mapped) + L('건 포함', ' dòng') : null, meta.lastProd ? L('마지막 ', 'Gần nhất ') + meta.lastProd : null),
        ERP.kpi(L('현장 부품 차감', 'Trừ linh kiện hiện trường'), F.n(useRows.length), L('건', 'dòng'), d.mode === 'in_bom' ? 'info' : 'neutral', d.mode !== 'in_bom' ? L('차감 꺼짐', 'Đang tắt trừ') : (d.matSkip.size ? L('원부자재 차감 안 함 ', 'Không trừ NVL ') + F.n(d.matSkip.size) + L('품목', ' mã') : null), L('BOM 출처: ', 'Nguồn BOM: ') + (Object.entries(d.bomSrc).map(([k, v]) => ({ custom: L('BOM 설정', 'BOM'), color: L('예시 색상 BOM', 'BOM mẫu'), recipe: L('배합표(차감 안 함)', 'Công thức (không trừ)'), retail: L('세트 구성', 'Bộ'), 'retail-similar': L('비슷한 세트', 'Bộ gần giống') }[k] || k) + ' ' + v).join(' · ') || '–')),
        ERP.kpi(L('해결할 항목', 'Cần xử lý'), F.n(issues), L('종류', 'loại'), issues ? 'warn' : 'ok', issues ? L('아래에서 연결·입력', 'Xử lý bên dưới') : L('없음', 'Không có'), null)));
    // --- helpers
    const sugChips = (list, onPick) => h('span', { class: 'sugg' }, list.slice(0, 4).map(x => h('button', { type: 'button', class: 'chipbtn ' + (x.conf === 'high' ? 'hi' : ''), title: x.name || '', onclick: () => onPick(x.code) }, x.code)));
    const section = (title, n, tone, body, extra) => h('details', { class: 'card', style: { marginBottom: '12px', padding: '12px 16px' }, open: n > 0 && n <= 40 },
      h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, ERP.chip(n ? tone : 'ok', F.n(n)), ' ', title, extra ? h('span', { class: 'muted', style: { fontWeight: 400, marginLeft: '8px' } }, extra) : null), n ? body() : h('p', { class: 'help' }, L('없습니다.', 'Không có.')));
    const saveMap = (row) => { const ex = DB.rows('code_map').find(x => x.kind === row.kind && (x.proc || '') === (row.proc || '') && INV.normName(x.div) === INV.normName(row.div) && INV.normName(x.src) === INV.normName(row.src));
      if (ex) DB.update('code_map', ex._id, row); else DB.add('code_map', Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined && v !== ''))); DB.ver.prod_log++; ERP.toast(L('연결했습니다: ', 'Đã liên kết: ') + row.src + ' → ' + row.item, 'ok'); ERP.render(); };
    // 1) daily codes that are not item codes
    const ni = Array.from(d.notItem.entries()).map(([k, v]) => { const [proc, div, src] = k.split('|'); return { proc, div, src, n: v.n, qty: v.qty }; }).sort((a, b) => b.n - a.n);
    const remarkOf = (x) => { const r = DB.rows('prod_log').find(y => y.process === x.proc && (y.code || y.part || y.name) === x.src && y.remark); return r ? r.remark : ''; };
    const nameOf = (x) => { const r = DB.rows('prod_log').find(y => y.process === x.proc && (y.code || y.part || y.name) === x.src); return r ? r.name : ''; };
    put(host, section(L('품목코드가 아닌 일보 코드 → 품목 연결', 'Mã báo cáo không phải mã hàng → liên kết'), ni.length, 'warn', () => {
      const tbl = h('table', { class: 'tbl entry' }, h('thead', h('tr', [L('공정', 'Công đoạn'), L('품목군', 'Nhóm'), L('일보 코드 / 이름', 'Mã / tên báo cáo'), L('행', 'Dòng'), L('수량', 'SL'), L('제안 (누르면 입력)', 'Gợi ý (bấm để điền)'), L('연결할 ECOUNT 품목코드', 'Mã ECOUNT'), ''].map(x => h('th', x)))),
        h('tbody', ni.slice(0, 120).map(x => { const inp = h('input', { list: dlId, style: { minWidth: '150px' } }); const sug = INV.suggestDaily(x.proc, x.div, x.src, nameOf(x), remarkOf(x)); if (sug[0] && sug[0].conf === 'high') inp.value = sug[0].code;
          const generic = x.proc === 'INJ' || x.proc === 'WRP';
          return h('tr', h('td', ERP.procName(x.proc)), h('td', x.div || ''), h('td', h('b', x.src)), h('td', { class: 'num' }, F.n(x.n)), h('td', { class: 'num' }, F.n(x.qty)), h('td', sugChips(sug, (c) => { inp.value = c; })), h('td', inp),
            h('td', h('button', { class: 'btn sm primary', onclick: () => { const v = inp.value.trim(); const it = IT.get(v); if (!it) { ERP.toast(L('ECOUNT 품목코드를 입력하세요', 'Nhập mã ECOUNT'), 'warn'); return; } saveMap({ kind: 'daily', proc: x.proc, div: generic ? x.div : '', src: x.src, item: it.code, note: generic ? L('품목군별', 'theo nhóm') : '' }); } }, L('연결', 'Liên kết')))); })));
      return h('div', h('p', { class: 'help' }, L('사출 일보는 부품 종류(Barrel·Spoon…)만 적혀 있어 품목코드로 바로 연결되지 않습니다. 제품군에 하나뿐인 부품(MINI HOLDER 등)은 제안이 초록색입니다. 색이 여러 개인 부품은 일보에 품목코드를 적는 것이 가장 정확합니다. 사출 원료(kg)는 원재료라 차감하지 않습니다.', 'Báo cáo ép nhựa chỉ ghi loại linh kiện. Linh kiện duy nhất của dòng (MINI HOLDER…) có gợi ý màu xanh. Linh kiện nhiều màu: nên ghi mã hàng vào báo cáo.')), h('div', { class: 'entry-wrap' }, tbl));
    }, L('연결하면 그 코드의 일보가 모두 입고됩니다', 'Liên kết xong, mọi báo cáo của mã đó sẽ được nhập')));
    // 2) produced items without BOM + BOM parts that are not item codes (old example BOM codes)
    const nb = Array.from(d.noBom.entries()).map(([k, v]) => { const it = IT.get(k); return { code: k, name: it ? it.name : '', stage: it ? INV.info(it).stage : '', n: v.n, qty: v.qty }; }).sort((a, b) => b.n - a.n);
    const mp = Array.from(d.missingPart.entries()).map(([k, v]) => ({ code: k, n: v.n, qty: v.qty })).sort((a, b) => b.n - a.n);
    const plan = INV.asmPlan(); const ready = plan.filter(x => !x.existing && (x.conf === 'high' || x.conf === 'part')).length;
    const goAsm = () => { ERP.state.asm = Object.assign(ERP.state.asm || {}, { kind: 'asm', stat: '', page: 0 }); ERP.goto('bom', { tab: 'asm' }); };
    put(host, section(L('BOM 없는 생산품 (입고만 되고 부품은 차감 안 됨)', 'Sản phẩm chưa có BOM (chỉ nhập, chưa trừ linh kiện)'), nb.length, 'warn', () => h('div',
      h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onclick: goAsm }, L('조립 BOM 자동 구성 (ECOUNT 코드) →', 'Tự tạo BOM lắp ráp (mã ECOUNT) →')), h('span', { class: 'muted' }, L('바로 적용 가능한 조립품 ', 'Có thể áp dụng ngay: ') + F.n(ready) + L('개', ' mã'))),
      ERP.simpleTable([{ label: L('품목', 'Mã hàng'), render: x => h('b', x.code) }, { label: L('품명', 'Tên'), render: x => x.name }, { label: L('단계', 'Công đoạn'), render: x => x.stage ? INV.stageTitle(x.stage) : '' }, { label: L('행', 'Dòng'), num: 1, render: x => F.n(x.n) }, { label: L('생산량', 'Sản lượng'), num: 1, render: x => F.n(x.qty) },
        { label: '', render: x => h('button', { class: 'btn sm', onclick: () => ERP.bomEditor && ERP.bomEditor(x.code) }, L('BOM 편집', 'Sửa BOM')) }], nb.slice(0, 200), { maxH: '300px' }))));
    put(host, section(L('예시 BOM의 부품코드가 ECOUNT 품목에 없음 (차감 안 됨)', 'Mã linh kiện của BOM mẫu không có trong ECOUNT'), mp.length, 'warn', () => h('div',
      h('p', { class: 'help' }, L('예전 색상별 BOM은 옛 부품코드(NM01064, H001 …)를 씁니다. "조립 BOM 자동 구성"으로 ECOUNT 코드(RM164, MH …) BOM을 만들면 이 목록이 사라집니다.', 'BOM mẫu dùng mã cũ (NM01064, H001…). Dùng "Tự tạo BOM lắp ráp" để tạo BOM theo mã ECOUNT (RM164, MH…).')),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onclick: goAsm }, L('조립 BOM 자동 구성 →', 'Tự tạo BOM lắp ráp →'))),
      ERP.simpleTable([{ label: L('옛 부품코드', 'Mã cũ'), render: x => h('b', x.code) }, { label: L('행', 'Dòng'), num: 1, render: x => F.n(x.n) }, { label: L('필요 수량', 'SL cần'), num: 1, render: x => F.n(x.qty) }], mp.slice(0, 200), { maxH: '260px' }))));
    // 3) 11차: 원부자재는 차감하지 않는다 — BOM · 배합표 · 사출 일보에 나온 원부자재 (정보만)
    const ms = Array.from(d.matSkip.entries()).map(([k, v]) => { const it = IT.get(k); return { code: k, name: it ? it.name : '', stage: it ? INV.info(it).stage : '', n: v.n, qty: v.qty }; }).sort((a, b) => b.n - a.n);
    if (ms.length) put(host, h('details', { class: 'card', style: { marginBottom: '12px', padding: '12px 16px' } },
      h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, ERP.chip('neutral', F.n(ms.length)), ' ', L('원부자재는 차감하지 않음 (규칙)', 'Không trừ NVL (quy tắc)'), h('span', { class: 'muted', style: { fontWeight: 400, marginLeft: '8px' } }, L('BOM · 배합표 · 사출 일보에 나온 원재료 · 부자재 — 정보만', 'NL · VL phụ trong BOM · công thức · báo cáo ép — chỉ để xem'))),
      h('p', { class: 'help' }, L('원부자재 재고는 창고 입고 · 출고 · 이동 수불로만 바뀝니다. 아래 수량은 생산 반영이 차감했을 양으로, 재고에는 반영하지 않습니다.', 'Tồn NVL chỉ thay đổi theo phiếu nhập · xuất · chuyển. Số dưới đây là lượng lẽ ra bị trừ — không cập nhật vào tồn.')),
      ERP.simpleTable([{ label: L('품목 · 원료', 'Mã · NL'), render: x => h('b', x.code) }, { label: L('품명', 'Tên'), render: x => (x.name || '').slice(0, 36) }, { label: L('단계', 'Công đoạn'), render: x => x.stage ? INV.stageTitle(x.stage) : L('원료 이름', 'Tên NL') }, { label: L('행', 'Dòng'), num: 1, render: x => F.n(x.n) }, { label: L('수량', 'SL'), num: 1, render: x => F.n(x.qty, 2) }], ms.slice(0, 200), { maxH: '260px' })));
    // 3-1) 1.10.2: 원부자재 코드로 적힌 생산량은 입고하지 않는다 (창고 입출고장에 완제품 번호로 적힌 포장 카톤 등)
    const mpd = Array.from(d.matProd.entries()).map(([k, v]) => { const it = IT.get(k); return { code: k, name: it ? it.name : '', stage: it ? INV.info(it).stage : '', n: v.n, qty: v.qty }; }).sort((a, b) => b.qty - a.qty);
    if (mpd.length) put(host, h('details', { class: 'card', style: { marginBottom: '12px', padding: '12px 16px' } },
      h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, ERP.chip('neutral', F.n(mpd.length)), ' ', L('원부자재 코드는 생산 입고하지 않음 (규칙)', 'Không nhập SX vào mã NVL (quy tắc)'), h('span', { class: 'muted', style: { fontWeight: 400, marginLeft: '8px' } }, L('완제품 번호로 적힌 포장 카톤 등 — 정보만', 'VD: thùng carton ghi số thành phẩm — chỉ để xem'))),
      h('p', { class: 'help' }, L('창고 입출고장에 완제품 번호로 적힌 포장 카톤은 원부자재 품목입니다. 같은 번호로 적힌 포장 일보의 생산량은 카톤 재고에 더하지 않습니다 (원부자재 재고는 창고 수불로만 바뀝니다). 수주 진행(포장 실적)과 생산 관리 집계에는 그대로 들어갑니다.', 'Thùng carton ghi số thành phẩm trong sổ kho là mã NVL. Sản lượng đóng gói cùng số không cộng vào tồn carton (tồn NVL chỉ đổi theo phiếu kho). Vẫn tính vào tiến độ PO và thống kê SX.')),
      ERP.simpleTable([{ label: L('품목', 'Mã hàng'), render: x => h('b', x.code) }, { label: L('품명', 'Tên'), render: x => (x.name || '').slice(0, 40) }, { label: L('단계', 'Công đoạn'), render: x => x.stage ? INV.stageTitle(x.stage) : '' }, { label: L('행', 'Dòng'), num: 1, render: x => F.n(x.n) }, { label: L('일보 생산량 (포장은 set)', 'SL báo cáo (đóng gói: set)'), num: 1, render: x => F.n(x.qty) }], mpd.slice(0, 200), { maxH: '260px' })));
    // 3-2) raw-material names (예전: 배합표 · 사출 원료 차감용 — 11차부터 차감하지 않으므로 보통 비어 있다)
    const ru = Array.from(d.rawUnmatched.entries()).map(([k, v]) => ({ src: k, n: v.n, qty: v.qty })).sort((a, b) => b.qty - a.qty);
    if (ru.length) put(host, section(L('원료 이름 → 원재료(RM) 품목 연결', 'Tên nguyên liệu → mã RM'), ru.length, 'warn', () => {
      const tbl = h('table', { class: 'tbl entry' }, h('thead', h('tr', [L('원료 이름 (배합표 · 사출 일보)', 'Tên NL (công thức · báo cáo ép)'), L('행', 'Dòng'), 'kg', L('제안', 'Gợi ý'), L('연결할 품목코드', 'Mã hàng'), ''].map(x => h('th', x)))),
        h('tbody', ru.slice(0, 120).map(x => { const inp = h('input', { list: dlId, style: { minWidth: '150px' } }); const sug = INV.suggestRaw(x.src); if (sug[0] && sug[0].conf === 'high') inp.value = sug[0].code;
          return h('tr', h('td', h('b', x.src)), h('td', { class: 'num' }, F.n(x.n)), h('td', { class: 'num' }, F.n(x.qty, 2)), h('td', sugChips(sug, (c) => { inp.value = c; })), h('td', inp),
            h('td', h('button', { class: 'btn sm primary', onclick: () => { const it = IT.get(inp.value.trim()); if (!it) { ERP.toast(L('품목코드를 입력하세요', 'Nhập mã hàng'), 'warn'); return; } saveMap({ kind: 'raw', src: x.src, item: it.code }); } }, L('연결', 'Liên kết')))); })));
      return h('div', { class: 'entry-wrap' }, tbl);
    }));
    // 4) CT / SET conversion
    const nc = Array.from(d.noConv.entries()).map(([k, v]) => { const it = IT.get(k); return { code: k, it, n: v.n, qty: v.qty }; }).sort((a, b) => b.n - a.n);
    put(host, section(L('CT · SET 환산 정보 없음 (포장 입고 안 됨)', 'Thiếu quy đổi CT · SET (chưa nhập đóng gói)'), nc.length, 'warn', () => {
      const tbl = h('table', { class: 'tbl entry' }, h('thead', h('tr', [L('품목', 'Mã hàng'), L('품명', 'Tên'), L('단위', 'ĐV'), L('행', 'Dòng'), L('일보 수량 (set)', 'SL báo cáo (set)'), L('CT당 set', 'set / CT'), L('set당 pcs', 'pcs / set'), ''].map(x => h('th', x)))),
        h('tbody', nc.slice(0, 120).map(x => { const a = h('input', { type: 'number', step: 'any', style: { width: '90px' }, value: x.it && x.it.set_per_ct ? x.it.set_per_ct : '' }); const b = h('input', { type: 'number', step: 'any', style: { width: '90px' }, value: x.it && x.it.pcs_per_set ? x.it.pcs_per_set : '' });
          return h('tr', h('td', h('b', x.code)), h('td', x.it ? (x.it.name || '').slice(0, 40) : ''), h('td', x.it ? INV.unitShow(x.it.unit) : ''), h('td', { class: 'num' }, F.n(x.n)), h('td', { class: 'num' }, F.n(x.qty)), h('td', a), h('td', b),
            h('td', h('button', { class: 'btn sm primary', onclick: () => { if (!x.it) return; const patch = {}; if (+a.value > 0) patch.set_per_ct = +a.value; if (+b.value > 0) patch.pcs_per_set = +b.value; if (!Object.keys(patch).length) { ERP.toast(L('숫자를 입력하세요', 'Nhập số'), 'warn'); return; } DB.update('items', x.it._id, patch); ERP.toast(L('저장했습니다', 'Đã lưu'), 'ok'); ERP.render(); } }, L('저장', 'Lưu')))); })));
      return h('div', h('p', { class: 'help' }, L('완제품 단위가 CT(박스)이면 포장 일보의 set 수를 CT로 바꾸려면 "CT당 set"이 필요합니다.', 'Thành phẩm đơn vị CT cần "set / CT" để đổi số set trong báo cáo đóng gói.')), h('div', { class: 'entry-wrap' }, tbl));
    }));
    // 4-2) packing BOM taken from a similar item (same series) — the colour list may differ
    const sm = Array.from((d.similar || new Map()).entries()).map(([k, v]) => ({ code: k, alt: v }));
    if (sm.length) put(host, section(L('포장 BOM 을 비슷한 품번으로 대신 사용 (확인 필요)', 'Dùng BOM đóng gói của mã gần giống (cần kiểm tra)'), sm.length, 'warn', () => h('div',
      h('p', { class: 'help' }, L('같은 품번의 색상 구성(BOM)이 없어 앞부분이 같은 품번의 구성으로 색연필을 차감했습니다. 색상 수가 다르면 차감이 틀립니다 — 제품 · BOM 에서 이 품번의 구성을 넣으세요.', 'Không có BOM màu đúng mã nên đã dùng BOM của mã cùng dòng. Nếu số màu khác thì trừ sai — hãy thêm BOM cho mã này.')),
      ERP.simpleTable([{ label: L('포장 품번', 'Mã đóng gói'), render: x => h('b', x.code) }, { label: L('대신 쓴 BOM', 'BOM đã dùng'), render: x => x.alt }], sm.slice(0, 200), { maxH: '260px' }))));
    // 5) mappings already made
    const maps = DB.rows('code_map');
    put(host, h('details', { class: 'card', style: { marginBottom: '12px', padding: '12px 16px' } }, h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, ERP.chip('info', F.n(maps.length)), ' ', L('연결한 코드 목록', 'Danh sách mã đã liên kết')),
      maps.length ? ERP.simpleTable([{ label: L('구분', 'Loại'), render: x => x.kind === 'raw' ? L('원료 이름', 'Tên NL') : L('일보 코드', 'Mã báo cáo') }, { label: L('공정', 'Công đoạn'), render: x => x.proc ? ERP.procName(x.proc) : L('전체', 'Tất cả') }, { label: L('품목군', 'Nhóm'), render: x => x.div || '' },
        { label: L('원래 코드/이름', 'Mã/tên gốc'), render: x => h('b', x.src) }, { label: '→', render: () => '→' }, { label: L('ECOUNT 품목', 'Mã ECOUNT'), render: x => { const it = IT.get(x.item); return x.item + (it ? ' · ' + (it.name || '').slice(0, 30) : L(' (품목 없음)', ' (không có)')); } },
        { label: '', render: x => h('button', { class: 'icon-btn', title: L('삭제', 'Xóa'), onclick: async () => { if (await ERP.confirm(L('이 연결을 지울까요?', 'Xóa liên kết này?'), L('삭제', 'Xóa'), true)) { DB.remove('code_map', [x._id]); DB.ver.prod_log++; ERP.render(); } } }, '×') }], maps, { maxH: '260px' }) : h('p', { class: 'help' }, L('아직 없습니다.', 'Chưa có.'))));
    // 6) recent postings
    const recent = pp.rows.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || (a.kind === 'PROD' ? -1 : 1)).slice(0, 200);
    put(host, h('div', { class: 'card', style: { padding: '12px 16px' } }, h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, L('최근 생산 반영 (입고 · 차감)', 'Cập nhật SX gần đây (nhập · trừ)')), h('a', { href: 'javascript:void 0', onclick: () => { ERP.state.txl_floor = Object.assign(ERP.state.txl_floor || {}, { src: 'auto', page: 0 }); ERP.goStock('fledger'); } }, L('수불 내역에서 보기 →', 'Xem trong Nhập xuất tồn →'))),
      recent.length ? ERP.simpleTable([{ label: L('일자', 'Ngày'), render: t => F.d(t.date) }, { label: L('공정', 'Công đoạn'), render: t => ERP.procName(t.proc) }, { label: L('구분', 'Loại'), render: t => kindChip(t.kind) },
        { label: L('품목', 'Mã hàng'), render: t => h('a', { href: 'javascript:void 0', onclick: () => ERP.itemDetail(t.code) }, t.code) }, { label: L('품명', 'Tên'), render: t => (t.name || '').slice(0, 30) }, { label: L('수량', 'SL'), num: 1, render: t => (t.kind === 'USE' ? '−' : '+') + fq(t.qty) + ' ' + (t.unit || '') }, { label: L('생산품', 'Sản phẩm'), render: t => t.parent || '' }], recent, { maxH: '360px' })
        : h('p', { class: 'help' }, d.open ? L('기준일(', 'Chưa có báo cáo SX sau ngày chốt (') + d.open + L(') 다음 날부터의 생산일보가 아직 없습니다. 생산일보를 올리거나 생산 관리 → 일보 입력에서 넣으면 여기에 나옵니다.', '). Hãy tải hoặc nhập báo cáo SX.') : '')));
  }

  // ===================================================================== 수불 입력 (multi-line entry)
  /** 수불 입력. group 'mat' = 원부자재 재고 메뉴 (기본 입고 · 창고), 'floor' = 현장 재고 메뉴 (기본 조정 · 공장) — 12차: 그 메뉴의 품목만 받는다 */
  function entryTab(host, group) {
    const G = group === 'floor' ? 'floor' : 'mat'; const sk = G === 'floor' ? 'txe_floor' : 'txe';
    const DEF = () => (G === 'floor' ? { date: F.today(), kind: 'ADJ', to: 'FAC' } : { date: F.today(), kind: 'IN', to: 'WH' });
    const st = ERP.state[sk] = ERP.state[sk] || { rows: [] };
    if (!st.rows.length) st.rows.push(DEF());
    const kinds = ERP.TX_KINDS.filter(k => !k.auto);
    const dlId = 'dl_tx_items_' + G; const dl = h('datalist', { id: dlId }, DB.rows('items').filter(r => !r.hidden && grpOf(r) === G).slice(0, 6000).map(r => h('option', { value: r.code }, (r.name || '') + ' · ' + INV.unitShow(r.unit))));
    const stock = C.stock();
    const defaults = (r) => { if (r.kind === 'IN') { r.from = ''; r.to = r.to || 'WH'; } else if (r.kind === 'OUT') { r.to = ''; r.from = r.from || 'WH'; } else if (r.kind === 'MOVE') { r.from = r.from || 'WH'; r.to = r.to && r.to !== r.from ? r.to : (r.from === 'WH' ? 'FAC' : 'WH'); } else { r.from = ''; r.to = r.to || 'WH'; } };
    const wrap = h('div');
    function check(r) {
      if (!r.code && !r.qty) return { empty: true };
      const it = INV.item(r.code); if (!it) return { bad: L('품목코드 없음', 'Không có mã') };
      if (grpOf(it) !== G) return { bad: G === 'floor' ? L('원부자재 품목 — 원부자재 재고 메뉴에서 입력', 'Mã NVL — nhập ở menu Tồn NVL') : L('현장 재고 품목 — 현장 재고 메뉴에서 입력', 'Mã hiện trường — nhập ở menu Tồn hiện trường'), it };
      const q = num(r.qty); if (!q) return { bad: L('수량 입력', 'Nhập SL'), it };
      if (r.kind === 'MOVE' && r.from === r.to) return { bad: L('출발=도착', 'Từ = Đến'), it };
      if (r.kind !== 'ADJ' && q < 0) return { bad: L('수량은 + 로 입력 (조정만 −)', 'SL phải dương (trừ điều chỉnh)'), it };
      // 기초재고 기준일 당일 · 이전 날짜는 기초재고에 들어 있다고 보므로 재고에 더하지 않는다 → 저장은 되지만 경고
      const t = { kind: r.kind, from_scope: r.from || undefined, to_scope: r.to || undefined, qty: q };
      const od = INV.openDateFor(it); const stale = INV.effects(t).filter(([sc]) => od[sc] && (r.date || F.today()) <= od[sc]).map(([sc]) => od[sc]);   // 11차: 공정 중 품목은 현장 실사일
      if (stale.length) return { ok: true, it, warn: L('기초재고 기준일(' + stale[0] + ') 이전 · 당일이라 재고에 반영되지 않음', 'Trước/đúng ngày tồn đầu (' + stale[0] + ') — không cộng vào tồn') };
      return { ok: true, it };
    }
    function projected() {   // stock after the pending rows, to warn about negatives
      const by = new Map(); st.rows.forEach(r => { const c = check(r); if (!c.ok) return; const t = { kind: r.kind, from_scope: r.from || undefined, to_scope: r.to || undefined, qty: num(r.qty) };
        INV.effects(t).forEach(([sc, q]) => { const k = c.it.code + '|' + sc; by.set(k, (by.get(k) || 0) + q); }); });
      const neg = []; by.forEach((q, k) => { const [code, sc] = k.split('|'); const s = stock.get(code); const before = s ? s.by[sc] : 0; if (before + q < -EPS && q < 0) neg.push(code + ' ' + ERP.scopeName(sc) + ' ' + fq(before + q)); });
      return neg;
    }
    function draw() {
      const inputs = [];
      const cell = (r, k, el) => { inputs.push(el); return h('td', el); };
      const body = st.rows.map((r, i) => {
        const c = check(r); const s = c.it ? stock.get(c.it.code) : null;
        const scopeSel = (k, allowEmpty) => h('select', { onchange: (e) => { r[k] = e.target.value; draw(); } }, allowEmpty ? h('option', { value: '' }, '–') : null, ERP.SCOPES.map(x => h('option', { value: x.v, selected: r[k] === x.v }, L(x.ko, x.vi))));
        return h('tr', { style: c.bad ? { background: '#FFF6F5' } : null },
          h('td', { class: 'muted' }, i + 1),
          cell(r, 'date', h('input', { type: 'date', value: r.date || '', onchange: (e) => { r.date = e.target.value; } })),
          cell(r, 'kind', h('select', { onchange: (e) => { r.kind = e.target.value; defaults(r); draw(); } }, kinds.map(k => h('option', { value: k.v, selected: r.kind === k.v }, L(k.ko, k.vi))))),
          cell(r, 'from', r.kind === 'OUT' || r.kind === 'MOVE' ? scopeSel('from') : h('span', { class: 'muted' }, '')),
          cell(r, 'to', r.kind === 'OUT' ? h('span', { class: 'muted' }, L('외부', 'Ngoài')) : scopeSel('to')),
          cell(r, 'code', h('input', { list: dlId, value: r.code || '', style: { minWidth: '140px' }, onchange: (e) => { let v = e.target.value.trim(); if (v && !INV.item(v)) { const hits = INV.search(v, 2); if (hits.length === 1) v = hits[0].code; } r.code = v; draw(); } })),
          h('td', { style: { minWidth: '200px', fontSize: '12px' } }, c.it ? [h('div', { class: 'strong' }, (c.it.name || '').slice(0, 40)), h('div', { class: 'muted' }, INV.unitShow(c.it.unit) + (s ? ' · ' + L('창고 ', 'Kho ') + fq(s.by.WH, s.prim) + ' / ' + L('공장 ', 'Xưởng ') + fq(s.by.FAC, s.prim) : ''))] : (r.code ? h('span', { style: { color: '#B3261E' } }, L('품목코드를 찾을 수 없음', 'Không tìm thấy mã')) : '')),
          cell(r, 'qty', h('input', { type: 'number', step: 'any', value: r.qty === undefined ? '' : r.qty, style: { width: '96px', textAlign: 'right' }, onchange: (e) => { r.qty = e.target.value === '' ? undefined : Number(e.target.value); draw(); } })),
          cell(r, 'partner', h('input', { value: r.partner || '', onchange: (e) => { r.partner = e.target.value; } })),
          cell(r, 'ref', h('input', { value: r.ref || '', style: { width: '100px' }, onchange: (e) => { r.ref = e.target.value; } })),
          cell(r, 'note', h('input', { value: r.note || '', onchange: (e) => { r.note = e.target.value; } })),
          h('td', c.bad ? ERP.chip('bad', c.bad) : c.warn ? ERP.chip('warn', c.warn) : (c.ok ? ERP.chip('ok', '✓') : '')),
          h('td', h('button', { class: 'icon-btn', title: L('줄 삭제', 'Xóa dòng'), onclick: () => { st.rows.splice(i, 1); draw(); } }, '×')));
      });
      // Enter = next input
      inputs.forEach((el, i) => el.addEventListener && el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.dispatchEvent(new Event('change')); setTimeout(() => { const all = wrap.querySelectorAll('tbody input, tbody select'); const idx = Array.prototype.indexOf.call(all, document.activeElement); const nx = all[Math.max(idx, i) + 1]; if (nx) nx.focus(); else { st.rows.push(Object.assign({}, st.rows[st.rows.length - 1], { code: '', qty: undefined, note: '' })); draw(); } }, 30); } }));
      const neg = projected(); const okN = st.rows.filter(r => check(r).ok).length;
      wrap.replaceChildren(...[dl,
        h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: () => { const last = st.rows[st.rows.length - 1] || DEF(); st.rows.push({ date: last.date, kind: last.kind, from: last.from, to: last.to, partner: last.partner }); draw(); } }, '+ ' + L('줄 추가', 'Thêm dòng')),
          h('button', { class: 'btn', onclick: pasteDialog }, L('엑셀에서 붙여넣기', 'Dán từ Excel')),
          h('button', { class: 'btn', onclick: () => ERP.ecount.txTemplate() }, L('수불 엑셀 양식 받기', 'Tải mẫu Excel')),
          h('button', { class: 'btn', onclick: () => ERP.goto('data') }, L('엑셀 파일 올리기', 'Tải file Excel')),
          h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: () => { st.rows = []; draw(); } }, L('모두 지우기', 'Xóa hết')),
          h('button', { class: 'btn primary', onclick: save }, L('저장 ', 'Lưu ') + '(' + okN + ')')),
        neg.length ? h('div', { class: 'warn-box', style: { marginBottom: '10px' } }, L('저장하면 마이너스가 되는 품목: ', 'Sẽ âm sau khi lưu: ') + neg.slice(0, 6).join(' · ') + (neg.length > 6 ? ' …' : '')) : null,
        h('div', { class: 'entry-wrap' }, h('table', { class: 'tbl entry' }, h('thead', h('tr', ['#', L('일자', 'Ngày'), L('구분', 'Loại'), L('출발', 'Từ'), L('도착', 'Đến'), L('품목코드', 'Mã hàng'), L('품명 · 현재고', 'Tên · tồn hiện tại'), L('수량 (주 단위)', 'SL (ĐV chính)'), L('거래처', 'Đối tác'), L('참조', 'Tham chiếu'), L('비고', 'Ghi chú'), '', ''].map(x => h('th', x)))), h('tbody', body))),
        h('p', { class: 'help' }, L('입고 = 외부 → 도착 범위 · 출고 = 출발 범위 → 외부(출하 등) · 이동 = 창고 ↔ 공장 (생산 투입은 창고 → 공장) · 조정 = 실사 차이 (+/−). Enter 로 다음 칸, 마지막 칸에서 Enter 면 새 줄. 생산 실적은 생산일보를 올리면 자동 반영되므로 여기에 넣지 않습니다.',
          'Nhập = ngoài → "Đến" · Xuất = "Từ" → ngoài · Chuyển = Kho ↔ Xưởng (xuất cho SX: Kho → Xưởng) · Điều chỉnh = chênh lệch kiểm kê (+/−). Enter để sang ô kế, Enter ở ô cuối để thêm dòng. Sản lượng được cập nhật tự động từ báo cáo sản xuất.')),
        recentBox()].filter(Boolean));
    }
    function save() {
      const ok = st.rows.map(r => [r, check(r)]).filter(x => x[1].ok);
      if (!ok.length) { ERP.toast(L('저장할 줄이 없습니다 (품목코드·수량 확인)', 'Không có dòng hợp lệ (kiểm tra mã, SL)'), 'warn'); return; }
      const run = () => {
        const docs = new Map(); const rows = [];
        ok.forEach(([r, c]) => { const date = r.date || F.today(); const key = date + '|' + r.kind; if (!docs.has(key)) docs.set(key, INV.nextDoc(INV.DOC_PREFIX[r.kind] || 'TX', date)); const doc = docs.get(key);
          rows.push(Object.fromEntries(Object.entries({ date, doc_no: doc, kind: r.kind, from_scope: (r.kind === 'OUT' || r.kind === 'MOVE') ? (r.from || 'WH') : undefined, to_scope: r.kind === 'OUT' ? undefined : (r.to || 'WH'), code: c.it.code, name: c.it.name, qty: num(r.qty), unit: INV.unitShow(c.it.unit), partner: r.partner || undefined, ref: r.ref || undefined, note: r.note || undefined, src: 'manual' }).filter(([, v]) => v !== undefined && v !== ''))); });
        DB.addMany('stock_tx', rows);
        ERP.toast(L(rows.length + '줄 저장 · 전표 ', 'Đã lưu ' + rows.length + ' dòng · phiếu ') + Array.from(docs.values()).join(', '), 'ok');
        // 저장한 줄만 빼고, 검사에 걸린 줄은 고칠 수 있게 입력표에 남긴다
        const saved = new Set(ok.map(x => x[0])); const left = st.rows.filter(r => !saved.has(r) && !check(r).empty);
        const last = st.rows[st.rows.length - 1] || {}; st.rows = left.concat([last.kind ? { date: last.date || F.today(), kind: last.kind, from: last.from, to: last.to } : DEF()]); ERP.render();
      };
      const neg = projected(); const stale = ok.filter(x => x[1].warn).length;
      const ask = []; if (neg.length) ask.push(L('저장하면 마이너스가 되는 품목이 ' + neg.length + '개 있습니다.\n' + neg.slice(0, 8).join('\n'), neg.length + ' mã sẽ bị âm:\n' + neg.slice(0, 8).join('\n')));
      if (stale) ask.push(L(stale + '줄은 기초재고 기준일 이전 · 당일이라 재고에 반영되지 않습니다.', stale + ' dòng trước/đúng ngày tồn đầu — không cộng vào tồn.'));
      if (ask.length) ERP.confirm(ask.join('\n\n') + L('\n그래도 저장할까요?', '\nVẫn lưu?')).then(y => { if (y) run(); }); else run();
    }
    function pasteDialog() {
      const ta = h('textarea', { class: 'inp', style: { width: '100%', minHeight: '220px', fontFamily: 'monospace', fontSize: '12px' }, placeholder: L('일자 · 구분 · 출발 · 도착 · 품목코드 · 수량 · 거래처 · 비고 (엑셀에서 복사, 탭으로 구분)', 'Ngày · Loại · Từ · Đến · Mã hàng · SL · Đối tác · Ghi chú (copy từ Excel)') });
      ERP.modal({ title: L('엑셀에서 붙여넣기', 'Dán từ Excel'), width: '760px', body: h('div', h('p', { class: 'help' }, L('열 순서: 일자 · 구분(입고/출고/이동/조정) · 출발 · 도착 · 품목코드 · 수량 · 거래처 · 비고. 품목코드·수량 2열만 붙여넣어도 됩니다 (구분은 위 줄 설정).', 'Thứ tự cột: Ngày · Loại · Từ · Đến · Mã hàng · SL · Đối tác · Ghi chú. Chỉ 2 cột Mã hàng · SL cũng được.')), ta),
        buttons: [{ label: L('취소', 'Hủy') }, { label: L('추가', 'Thêm'), kind: 'primary', onClick: () => {
          const lines = ta.value.split(/\r?\n/).map(x => x.split('\t')).filter(c => c.some(x => x.trim())); const base = st.rows[st.rows.length - 1] || DEF(); let n = 0;
          lines.forEach(c => {
            let r;
            if (c.length <= 3) { const qty = F.parseNum(c[1]); if (!c[0] || qty === null) return; r = { date: base.date, kind: base.kind, from: base.from, to: base.to, code: c[0].trim(), qty, note: (c[2] || '').trim() }; }
            else { const qty = F.parseNum(c[5]); if (!c[4] || qty === null) return; const k = INV.kindOf(c[1]) || base.kind; r = { date: F.parseDate((c[0] || '').trim()) || base.date, kind: k, from: INV.scopeOf(c[2]) || '', to: INV.scopeOf(c[3]) || '', code: c[4].trim(), qty, partner: (c[6] || '').trim(), note: (c[7] || '').trim() }; }
            const it = INV.item(r.code); if (!it) { const hits = INV.search(r.code, 2); if (hits.length === 1) r.code = hits[0].code; }
            defaults(r); st.rows.push(r); n++;
          });
          st.rows = st.rows.filter(r => r.code || r.qty); ERP.toast(L(n + '줄 추가', 'Đã thêm ' + n + ' dòng'), n ? 'ok' : 'warn'); draw();
        } }] });
    }
    function recentBox() {
      const rec = DB.rows('stock_tx').filter(t => t.src === 'manual' && grpOf(INV.item(t.code)) === G).slice().sort((a, b) => String(b.doc_no || '').localeCompare(String(a.doc_no || '')) || String(b.date).localeCompare(String(a.date))).slice(0, 15);
      if (!rec.length) return null;
      return h('div', { class: 'card', style: { marginTop: '14px', background: '#FAFBFC' } }, h('h3', L('최근 화면 입력', 'Nhập tay gần đây')),
        ERP.simpleTable([{ label: L('일자', 'Ngày'), render: t => F.d(t.date) }, { label: L('전표', 'Số CT'), render: t => t.doc_no || '' }, { label: L('구분', 'Loại'), render: t => kindChip(t.kind) }, { label: L('범위', 'Phạm vi'), render: t => [t.from_scope ? ERP.scopeName(t.from_scope) : (t.kind === 'IN' ? L('외부', 'Ngoài') : ''), t.to_scope ? ERP.scopeName(t.to_scope) : (t.kind === 'OUT' ? L('외부', 'Ngoài') : '')].filter(Boolean).join(' → ') },
          { label: L('품목', 'Mã hàng'), render: t => t.code + ' ' + (t.name || '') }, { label: L('수량', 'SL'), num: 1, render: t => fq(t.qty) + ' ' + (t.unit || '') },
          { label: '', render: t => h('button', { class: 'icon-btn', title: L('삭제', 'Xóa'), onclick: async (e) => { e.stopPropagation(); if (await ERP.confirm(L('이 수불을 삭제할까요?', 'Xóa phiếu này?'), L('삭제', 'Xóa'), true)) { DB.remove('stock_tx', [t._id]); ERP.render(); } } }, '×') }], rec, { maxH: '260px' }));
    }
    host.appendChild(wrap); draw();
  }

  // ===================================================================== 수불 내역 (all movements incl. production postings)
  /** 수불 내역. group 'mat' = 원부자재 품목만, 'floor' = 현장 품목만 (생산 반영 입고 · 차감 포함) — 12차 */
  function ledgerTab(host, group) {
    const G = group === 'floor' ? 'floor' : 'mat'; const sk = G === 'floor' ? 'txl_floor' : 'txl';
    const meta = INV.meta(); const latest = [meta.lastTx, meta.lastProd, F.today()].filter(Boolean).sort().slice(-1)[0];
    const st = ERP.state[sk] = Object.assign({ from: F.addDays(latest, -30), to: latest, kind: '', src: '', q: '', page: 0 }, ERP.state[sk] || {});
    const pp = INV.prodPost();
    const inG = (t) => grpOf(INV.item(t.code)) === G;
    const manual = DB.rows('stock_tx').map(t => Object.assign({ _manual: true }, t)).filter(inG);
    let rows = manual.concat(G === 'floor' ? pp.rows.filter(inG) : []).filter(t => !t.date || (t.date >= st.from && t.date <= st.to));
    if (st.kind) rows = rows.filter(t => t.kind === st.kind);
    if (st.src === 'auto') rows = rows.filter(t => !t._manual); else if (st.src === 'manual') rows = rows.filter(t => t._manual && t.src === 'manual'); else if (st.src === 'upload') rows = rows.filter(t => t._manual && t.src !== 'manual');
    if (st.q) { const k = INV.normName(st.q); rows = rows.filter(t => [t.code, t.name, t.doc_no, t.partner, t.partner_code, t.ref, t.parent, t.lot, t.color, t.purpose].some(v => INV.normName(v).includes(k))); }
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.doc_no || '').localeCompare(String(a.doc_no || '')));
    const ps = 100; const pages = Math.max(1, Math.ceil(rows.length / ps)); if (st.page >= pages) st.page = pages - 1; const slice = rows.slice(st.page * ps, st.page * ps + ps);
    const d = pp.diag;
    const issues = d.notItem.size + d.noBom.size + d.missingPart.size + d.rawUnmatched.size + d.noConv.size;
    put(host, G === 'floor' ? h('p', { class: 'help', style: { marginTop: 0 } }, L('현장 품목의 수불 · 생산일보 자동 반영: ', 'Phiếu · cập nhật SX của hàng hiện trường: ') + (d.mode === 'off' ? L('꺼짐', 'tắt') : F.n(d.prod) + L('건 입고 · ', ' nhập · ') + F.n(d.use) + L('건 차감', ' trừ')) + (issues ? L(' · 해결할 항목 ', ' · cần xử lý ') + issues : '') + ' ',
        h('a', { href: 'javascript:void 0', onclick: () => ERP.goStock('post') }, L('생산 반영 탭 →', 'Tab cập nhật SX →')))
        : h('p', { class: 'help', style: { marginTop: 0 } }, L('원부자재 품목의 수불(입고 · 출고 · 이동 · 조정)입니다. 생산 반영은 원부자재를 차감하지 않습니다.', 'Phiếu nhập · xuất · chuyển · điều chỉnh của NVL. Cập nhật SX không trừ NVL.')),
      h('div', { class: 'toolbar' },
        h('label', { class: 'search' }, ERP.svg('M21 21l-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z', 17), h('input', { type: 'search', placeholder: L('품목코드 · 품명 · 전표 · 거래처', 'Mã · tên · số CT · đối tác'), value: st.q, onchange: (e) => { st.q = e.target.value; st.page = 0; ERP.render(); } })),
        h('label', { class: 'muted' }, L('기간 ', 'Từ '), h('input', { class: 'inp', type: 'date', value: st.from, onchange: (e) => { st.from = e.target.value; ERP.render(); } }), ' ~ ', h('input', { class: 'inp', type: 'date', value: st.to, onchange: (e) => { st.to = e.target.value; ERP.render(); } })),
        h('select', { class: 'inp', onchange: (e) => { st.kind = e.target.value; st.page = 0; ERP.render(); } }, h('option', { value: '' }, L('구분: 전체', 'Loại: tất cả')), ERP.TX_KINDS.map(k => h('option', { value: k.v, selected: st.kind === k.v }, L(k.ko, k.vi)))),
        h('select', { class: 'inp', onchange: (e) => { st.src = e.target.value; st.page = 0; ERP.render(); } }, [['', L('출처: 전체', 'Nguồn: tất cả')], ['manual', L('화면 입력', 'Nhập tay')], ['upload', L('엑셀 업로드', 'Tải Excel')]].concat(G === 'floor' ? [['auto', L('생산 자동', 'Tự động SX')]] : []).map(o => h('option', { value: o[0], selected: st.src === o[0] }, o[1]))),
        h('span', { class: 'sp' }),
        h('button', { class: 'btn sm', onclick: () => ERP.xl.exportAoa('stock_tx', [L('일자', 'Ngày'), L('전표', 'Số CT'), L('구분', 'Loại'), L('출발', 'Từ'), L('도착', 'Đến'), L('품목코드', 'Mã hàng'), L('품명', 'Tên'), L('수량', 'SL'), L('단위', 'ĐV'), L('거래처', 'Đối tác'), L('업체코드', 'Mã ĐV'), L('용도', 'Mục đích'), 'Lot', L('색깔', 'Màu'), L('참조', 'Tham chiếu'), L('비고', 'Ghi chú'), L('출처', 'Nguồn')], rows.map(t => [t.date, t.doc_no || '', ERP.txKindName(t.kind), t.from_scope ? ERP.scopeName(t.from_scope) : '', t.to_scope ? ERP.scopeName(t.to_scope) : '', t.code, t.name || '', t.qty, t.unit || '', t.partner || '', t.partner_code || '', t.purpose || '', t.lot || '', t.color || '', t.ref || (t.parent || ''), t.note || '', srcLabel(t)])) }, L('엑셀', 'Excel'))),
      rows.length ? h('div', { class: 'tbl-wrap', style: { maxHeight: '56vh' } }, h('table', { class: 'tbl' }, h('thead', h('tr', [L('일자', 'Ngày'), L('전표', 'Số CT'), L('구분', 'Loại'), L('범위', 'Phạm vi'), L('품목코드', 'Mã hàng'), L('품명', 'Tên'), L('수량', 'SL'), L('거래처 · 참조', 'Đối tác · tham chiếu'), L('비고', 'Ghi chú'), L('출처', 'Nguồn'), ''].map((x, i) => h('th', { class: i === 6 ? 'num' : '' }, x)))),
        h('tbody', slice.map(t => h('tr', { class: t._manual ? '' : 'dim' }, h('td', F.d(t.date)), h('td', t.doc_no || ''), h('td', kindChip(t.kind)),
          h('td', [t.from_scope ? ERP.scopeName(t.from_scope) : (t.kind === 'IN' ? L('외부', 'Ngoài') : ''), t.to_scope ? ERP.scopeName(t.to_scope) : (t.kind === 'OUT' ? L('외부', 'Ngoài') : '')].filter(Boolean).join(' → ')),
          h('td', h('a', { href: 'javascript:void 0', onclick: () => ERP.itemDetail(t.code) }, t.code)), h('td', (t.name || '').slice(0, 36)), h('td', { class: 'num' }, fq(t.qty) + ' ' + (t.unit || '')),
          h('td', [partnerText(t), t.ref, t.parent ? L('상위 ', 'cha ') + t.parent : null].filter(Boolean).join(' · ')), h('td', { title: txNote(t) }, txNote(t).slice(0, 60)), h('td', srcLabel(t)),
          h('td', t._manual ? h('button', { class: 'icon-btn', title: L('삭제', 'Xóa'), onclick: async () => { if (await ERP.confirm(L('이 수불을 삭제할까요?', 'Xóa phiếu này?'), L('삭제', 'Xóa'), true)) { DB.remove('stock_tx', [t._id]); ERP.render(); } } }, '×') : ''))))))
        : h('div', { class: 'empty' }, L('이 기간의 수불이 없습니다.', 'Không có phát sinh trong kỳ.')),
      rows.length > ps ? h('div', { class: 'pager' }, h('span', F.n(rows.length) + L('건', ' dòng')), h('span', { style: { display: 'inline-flex', gap: '8px', alignItems: 'center' } }, h('button', { class: 'btn', disabled: st.page === 0, onclick: () => { st.page--; ERP.render(); } }, '‹'), (st.page + 1) + ' / ' + pages, h('button', { class: 'btn', disabled: st.page >= pages - 1, onclick: () => { st.page++; ERP.render(); } }, '›'))) : null);
  }

  // ===================================================================== 발주 권장 · 안전재고
  function reorderTab(host) {
    const st = ERP.state.reo = ERP.state.reo || { view: 'list', q: '', onlyUnset: false, mult: 1 };
    const S = STAT();
    put(host, h('div', { class: 'toolbar' }, h('div', { class: 'seg' }, [['list', L('발주 필요 목록', 'Cần đặt hàng')], ['setup', L('안전재고 설정', 'Cài tồn an toàn')]].map(o => h('button', { class: 'btn' + (st.view === o[0] ? ' primary' : ''), onclick: () => { st.view = o[0]; ERP.render(); } }, o[1])))));
    if (st.view === 'setup') return setupView(host, st);
    // 12차: 발주는 원부자재만. 16차: 해외 주문 품목은 해외 주문 탭에서 따로 (리드타임) — 여기서는 뺀다
    const buyN = DB.rows('items').filter(m => m.buy).length; const buyNeed = buyN && ERP.buy ? ERP.buy.rows().filter(r => r.status === 'need').length : 0;
    const list = INV.rows().filter(s => grpOf(s.m) === 'mat' && !(s.m && s.m.buy) && s.safety !== null && s.safety > 0 && (s.status === 'low' || s.status === 'neg'))
      .map(s => Object.assign({}, s, { target: s.safety * st.mult, need: Math.max(0, s.safety * st.mult - s.bal) })).sort((a, b) => (a.bal / a.safety) - (b.bal / b.safety));
    const cols = [{ label: L('품목코드', 'Mã hàng'), render: s => h('b', s.code) }, { label: L('품명', 'Tên'), render: s => s.name }, { label: L('창고', 'Kho'), num: 1, render: s => fq(s.by.WH, s.prim), style: s => negStyle(s.by.WH) }, { label: L('공장', 'Xưởng'), num: 1, render: s => fq(s.by.FAC, s.prim), style: s => negStyle(s.by.FAC) },
      { label: L('현재고 (합계)', 'Tồn (tổng)'), num: 1, render: s => fq(s.bal, s.prim) + ' ' + s.prim }, { label: L('안전재고', 'Tồn AT'), num: 1, render: s => F.n(s.safety) },
      { label: L('부족분', 'Thiếu'), num: 1, render: s => fq(Math.max(0, s.safety - s.bal), s.prim) }, { label: L('재고율', '% tồn'), num: 1, render: s => F.n(s.bal / s.safety * 100, 0) + '%' },
      { label: L('권장 발주량', 'Đề xuất đặt'), num: 1, render: s => h('b', fq(s.need, s.prim) + ' ' + s.prim) }, { label: L('상태', 'TT'), render: s => ERP.chip(S[s.status][1], S[s.status][0]) }];
    put(host, h('div', { class: 'toolbar' }, h('label', { class: 'muted' }, L('발주 목표 = 안전재고 × ', 'Mục tiêu đặt = tồn an toàn × '), h('input', { class: 'inp', type: 'number', step: '0.1', min: '1', style: { width: '80px' }, value: st.mult, onchange: (e) => { st.mult = Math.max(1, Number(e.target.value) || 1); ERP.render(); } })),
      h('span', { class: 'sp' }), h('button', { class: 'btn primary', onclick: () => ERP.xl.exportAoa('purchase_request', [L('품목코드', 'Mã hàng'), L('품명', 'Tên'), 'Mã XNK', L('현재고', 'Tồn'), L('단위', 'ĐV'), L('안전재고', 'Tồn AT'), L('부족분', 'Thiếu'), L('재고율', '% tồn'), L('권장 발주량', 'Đề xuất đặt')], list.map(s => [s.code, s.name, s.m ? s.m.xnk || '' : '', +s.bal.toFixed(2), s.prim, s.safety, +Math.max(0, s.safety - s.bal).toFixed(2), Math.round(s.bal / s.safety * 100) + '%', Math.ceil(s.need)])) }, L('발주 요청서 엑셀', 'Xuất yêu cầu mua hàng'))),
      buyN ? h('p', { class: 'help', style: { marginTop: 0 } }, L('해외 주문 품목 ' + buyN + '개' + (buyNeed ? ' (그중 주문 필요 ' + buyNeed + '개)' : '') + '는 이 목록에서 빼고 ', buyN + ' mã đặt nước ngoài' + (buyNeed ? ' (cần đặt ' + buyNeed + ')' : '') + ' không nằm ở đây — xem ở '), h('a', { href: 'javascript:void 0', onclick: () => ERP.goStock('buy') }, L('해외 주문 탭', 'tab Đặt hàng nước ngoài')), L('에서 리드타임과 함께 봅니다.', '.')) : null,
      list.length ? ERP.simpleTable(cols, list, { maxH: '62vh', onClick: (s) => ERP.itemDetail(s.code) }) : h('div', { class: 'empty' }, L('안전재고 미달 품목이 없습니다.', 'Không có mã nào dưới tồn an toàn.')),
      h('p', { class: 'help' }, F.n(list.length) + L('개 품목이 안전재고 미달입니다. 안전재고는 ECOUNT 품목등록의 "안전재고수량"을 가져오며, "안전재고 설정"에서 바꿀 수 있습니다 (ECOUNT 값이 빈 품목은 여기서 넣은 값을 유지). 현재고는 창고+공장 합계입니다.', ' mã dưới tồn an toàn. Tồn an toàn lấy từ ECOUNT ("안전재고수량"), có thể sửa ở "Cài tồn an toàn". Tồn = Kho + Xưởng.')));
  }
  function setupView(host, st) {
    const body = h('div'); const stock = C.stock();
    const q = h('input', { class: 'inp', type: 'search', placeholder: L('검색 (코드/ERP CODE/이름)', 'Tìm (mã/ERP CODE/tên)'), value: st.q, oninput: (e) => { st.q = e.target.value; draw(); } });
    function draw() {
      const k = INV.normName(st.q);
      let rows = DB.rows('items').filter(m => !m.hidden && grpOf(m) === 'mat').filter(m => k ? [m.code, m.erp_code, m.name].some(v => INV.normName(v).includes(k)) : (num(m.safety) > 0 || INV.info(m).stage === 'RM'));
      if (st.onlyUnset) rows = rows.filter(m => !(num(m.safety) > 0));
      rows = rows.sort((a, b) => (num(b.safety) > 0) - (num(a.safety) > 0) || String(a.code).localeCompare(String(b.code)));
      const set = DB.rows('items').filter(m => num(m.safety) > 0 && grpOf(m) === 'mat').length;
      body.replaceChildren(...[h('p', { class: 'help' }, L('안전재고가 설정된 품목: ', 'Mã đã cài tồn an toàn: ') + F.n(set) + L('개 · 검색하지 않으면 원재료와 설정된 품목만 보입니다. 비워 두면 미설정 (발주 목록·경고에 나오지 않음). 입력 즉시 저장됩니다.', ' · Khi chưa tìm, chỉ hiện NVL và mã đã cài. Để trống = chưa cài. Lưu ngay khi nhập.')),
        ERP.simpleTable([{ label: L('품목코드', 'Mã hàng'), render: m => m.code }, { label: L('품명', 'Tên'), render: m => m.name || '' }, { label: L('분류', 'Phân loại'), render: m => ERP.codeChips(INV.info(m)) }, { label: L('현재고', 'Tồn'), num: 1, render: m => { const s = stock.get(m.code); return s ? fq(s.bal, s.prim) + ' ' + s.prim : '–'; } },
          { label: L('안전재고 (주 단위)', 'Tồn AT (ĐV chính)'), num: 1, render: m => h('input', { class: 'inp', type: 'number', step: 'any', min: 0, style: { width: '110px', textAlign: 'right' }, value: num(m.safety) > 0 ? m.safety : '', placeholder: '–',
            onchange: (e) => { const v = e.target.value === '' ? undefined : Number(e.target.value); if (v === undefined) delete m.safety; else m.safety = v; DB.touch('items'); } }) }], rows.slice(0, 300), { maxH: '62vh' }),
        rows.length > 300 ? h('p', { class: 'help' }, L('상위 300개만 표시 — 검색으로 좁혀주세요.', 'Chỉ hiện 300 dòng đầu — hãy tìm để lọc.')) : null].filter(Boolean));
    }
    put(host, h('div', { class: 'toolbar' }, q, h('label', { class: 'muted nowrap' }, h('input', { type: 'checkbox', checked: st.onlyUnset, onchange: (e) => { st.onlyUnset = e.target.checked; draw(); } }), ' ', L('미설정만', 'Chỉ mã chưa cài'))), body); draw();
  }

  // ===================================================================== 외주 입출고
  function outsourceTab(host) {
    const st = ERP.state.os = ERP.state.os || { type: 'OUT', date: F.today(), partner: '', item: '', name: '', kg: '', ea: '', work: '', note: '', mirror: true };
    const whPartners = DB.rows('warehouses').filter(w => /외주/.test(w.kind || '') || w.partner).map(w => w.partner || w.name);
    const partners = uniq(whPartners.concat(DB.rows('outsource').map(r => r.partner), DB.rows('partners').map(p => p.name)));
    const nextDoc = () => (st.type === 'OUT' ? 'OSO' : 'OSI') + st.date.replace(/-/g, '').slice(2) + '-' + String(DB.rows('outsource').filter(r => r.date === st.date && r.type === st.type).length + 1).padStart(2, '0');
    const f = (k, o) => h('input', Object.assign({ class: 'inp', value: st[k], onchange: (e) => { st[k] = e.target.value; if (k === 'item') { const m = INV.item(st.item); if (m) { st.item = m.code; st.name = m.name; } draw(); } } }, o || {}));
    const wrap = h('div');
    function draw() {
      const bal = {}; DB.rows('outsource').forEach(r => { const k = r.partner + '|' + (r.item_code || r.name || ''); const o = bal[k] || (bal[k] = { partner: r.partner, item: r.item_code, name: r.name, kg: 0, ea: 0, last: '' }); const sg = r.type === 'OUT' ? 1 : -1; o.kg += sg * num(r.qty_kg); o.ea += sg * num(r.qty_ea); if (r.date > o.last) o.last = r.date; });
      const balRows = Object.values(bal).filter(o => Math.abs(o.kg) > 0.0001 || Math.abs(o.ea) > 0.0001).sort((a, b) => a.partner.localeCompare(b.partner));
      const dlP = h('datalist', { id: 'dl_os_p' }, partners.map(p => h('option', { value: p }))); const dlI = h('datalist', { id: 'dl_os_i' }, DB.rows('items').filter(m => !m.hidden).slice(0, 5000).map(m => h('option', { value: m.code }, m.name || '')));
      const m = INV.item(st.item);
      const form = h('div', { class: 'card', style: { background: '#FAFBFC', marginBottom: '14px' } }, h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', L('구분', 'Loại')), h('select', { class: 'inp', onchange: (e) => { st.type = e.target.value; draw(); } }, [['OUT', L('외주 출고 (자재/반제품 보냄)', 'Xuất đi gia công')], ['IN', L('외주 입고 (가공품 받음)', 'Nhận về từ gia công')]].map(o => h('option', { value: o[0], selected: st.type === o[0] }, o[1])))),
        h('div', { class: 'field' }, h('label', L('일자', 'Ngày')), f('date', { type: 'date' })), h('div', { class: 'field' }, h('label', L('외주처', 'Đơn vị gia công')), f('partner', { list: 'dl_os_p' })),
        h('div', { class: 'field' }, h('label', L('품목코드', 'Mã hàng')), f('item', { list: 'dl_os_i' })), h('div', { class: 'field' }, h('label', L('품명', 'Tên hàng')), f('name')),
        h('div', { class: 'field' }, h('label', 'kg'), f('kg', { type: 'number', step: 'any' })), h('div', { class: 'field' }, h('label', 'ea / pcs'), f('ea', { type: 'number', step: 'any' })),
        h('div', { class: 'field' }, h('label', L('외주 작업 내용', 'Nội dung gia công')), f('work')), h('div', { class: 'field' }, h('label', L('비고 / PO', 'Ghi chú / PO')), f('note'))),
        h('div', { class: 'toolbar', style: { marginTop: '10px' } }, h('label', { class: 'muted nowrap' }, h('input', { type: 'checkbox', checked: st.mirror, onchange: (e) => { st.mirror = e.target.checked; } }), ' ',
          L('재고에도 반영 (출고 = 창고 → 공장 이동, 입고 = 공장 입고 · 품목의 주 단위 수량)', 'Cập nhật tồn (xuất = chuyển Kho → Xưởng, nhận = nhập Xưởng · theo ĐV chính)')), m ? h('span', { class: 'muted' }, L('주 단위: ', 'ĐV chính: ') + INV.unitShow(m.unit)) : null, h('span', { class: 'sp' }),
          h('button', { class: 'btn primary', onclick: save }, L('저장', 'Lưu'))));
      const hist = ERP.grid({ table: 'outsource', canEdit: false, canAdd: false, export: true, pageSize: 25, maxH: '40vh', sortKey: 'date', sortDir: -1,
        filters: [{ id: 'p', label: L('외주처', 'Đơn vị'), key: 'partner', options: () => partners.map(v => ({ v, label: v })) }, { id: 't', label: L('구분', 'Loại'), key: 'type', options: () => [{ v: 'OUT', label: L('출고', 'Xuất') }, { v: 'IN', label: L('입고', 'Nhận') }] }],
        extraCols: [{ label: () => '', render: r => h('button', { class: 'icon-btn', title: 'delete', onclick: async () => { if (await ERP.confirm(L('이 외주 전표를 삭제할까요? (연동된 재고 수불도 삭제)', 'Xóa phiếu này? (xóa cả phiếu tồn liên kết)'))) { DB.remove('stock_tx', DB.rows('stock_tx').filter(x => x.os_id === r._id).map(x => x._id)); DB.remove('inout', DB.rows('inout').filter(x => x.os_id === r._id).map(x => x._id)); DB.remove('outsource', [r._id]); ERP.render(); } } }, '×') }] });
      wrap.replaceChildren(dlP, dlI, form,
        h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h3', L('외주처별 잔량 (보낸 수량 − 받은 수량)', 'Tồn tại đơn vị gia công (đã gửi − đã nhận)')),
          balRows.length ? ERP.simpleTable([{ label: L('외주처', 'Đơn vị'), render: o => o.partner }, { label: L('품목', 'Mã hàng'), render: o => (o.item || '') + ' ' + (o.name || '') }, { label: 'kg', num: 1, render: o => F.n(o.kg, 2) }, { label: 'ea', num: 1, render: o => F.n(o.ea, 1) }, { label: L('최근 거래', 'Gần nhất'), render: o => F.d(o.last) }], balRows, { maxH: '260px' }) : h('div', { class: 'empty' }, L('외주 잔량이 없습니다.', 'Không có tồn tại đơn vị gia công.'))),
        h('div', { class: 'card' }, h('h3', L('외주 입출고 내역', 'Lịch sử nhập xuất gia công')), hist.el));
    }
    function save() {
      if (!st.partner.trim()) { ERP.toast(L('외주처를 입력하세요', 'Nhập đơn vị gia công'), 'warn'); return; }
      const kg = st.kg === '' ? undefined : Number(st.kg), ea = st.ea === '' ? undefined : Number(st.ea);
      if (!(kg || ea)) { ERP.toast(L('수량(kg 또는 ea)을 입력하세요', 'Nhập số lượng (kg hoặc ea)'), 'warn'); return; }
      const doc = nextDoc();
      const row = DB.add('outsource', { date: st.date, doc_no: doc, type: st.type, partner: st.partner.trim(), item_code: st.item || undefined, name: st.name || undefined, qty_kg: kg, qty_ea: ea, work: st.work || undefined, note: st.note || undefined });
      const m = INV.item(st.item);
      if (st.mirror && m) {
        const q = INV.unitN(m.unit) === 'kg' ? (kg || ea) : (ea || kg); const isIn = st.type === 'IN';
        DB.add('stock_tx', Object.fromEntries(Object.entries({ date: st.date, doc_no: doc, kind: isIn ? 'IN' : 'MOVE', from_scope: isIn ? undefined : 'WH', to_scope: 'FAC', code: m.code, name: m.name, qty: q, unit: INV.unitShow(m.unit), partner: st.partner.trim(), note: L('외주 ', 'Gia công ') + (isIn ? L('입고', 'nhận') : L('출고', 'xuất')) + (st.work ? ' - ' + st.work : ''), src: 'outsource', os_id: row._id }).filter(([, v]) => v !== undefined)));
      }
      ERP.toast(L('저장했습니다: ', 'Đã lưu: ') + doc, 'ok'); st.item = ''; st.name = ''; st.kg = ''; st.ea = ''; st.work = ''; st.note = ''; draw();
    }
    host.appendChild(wrap); draw();
  }

  // ===================================================================== 자료 점검
  function checkTab(host) {
    const K = INV.checks(); const stock = C.stock(); const pp = INV.prodPost().diag;
    const susp = INV.rows().filter(s => s.susp); const neg = INV.rows().filter(s => s.negative);
    const itemCols = [{ label: L('품목코드', 'Mã hàng'), render: m => h('b', m.code) }, { label: L('품명', 'Tên'), render: m => m.name || '' }, { label: 'ERP CODE', render: m => h('code', { class: 'k' }, String(m.erp_code || '').replace(/ /g, '␣')) }, { label: L('품목구분', 'Loại'), render: m => m.etype || '' }, { label: L('단위', 'ĐV'), render: m => m.unit || '' }];
    const sections = [
      { id: 'susp', title: L('이동 누락 의심 (창고 +, 공장 − 또는 반대)', 'Nghi thiếu phiếu chuyển kho (Kho +, Xưởng − hoặc ngược lại)'), n: susp.length, tone: 'warn',
        body: () => h('div', h('p', { class: 'help' }, L('합계는 맞지만 한쪽 범위가 마이너스입니다. 생산 투입(창고 → 공장) 같은 이동 입력이 빠진 경우가 많습니다. [이동 전표 만들기]를 누르면 작은 쪽 수량만큼 이동 수불을 만들어 정리합니다 (미리보기 후 저장).', 'Tổng đúng nhưng một phạm vi bị âm — thường do thiếu phiếu chuyển (Kho → Xưởng). Bấm nút để tạo phiếu chuyển (xem trước rồi lưu).')),
          h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onclick: suggestDialog }, L('이동 전표 만들기', 'Tạo phiếu chuyển kho'))),
          ERP.simpleTable([{ label: L('품목코드', 'Mã hàng'), render: s => h('b', s.code) }, { label: L('품명', 'Tên'), render: s => s.name }, { label: L('창고', 'Kho'), num: 1, render: s => fq(s.by.WH, s.prim), style: s => negStyle(s.by.WH) }, { label: L('공장', 'Xưởng'), num: 1, render: s => fq(s.by.FAC, s.prim), style: s => negStyle(s.by.FAC) }, { label: L('합계', 'Tổng'), num: 1, render: s => fq(s.bal, s.prim), style: s => negStyle(s.bal) }, { label: L('단위', 'ĐV'), render: s => s.prim }], susp.slice(0, 300), { maxH: '300px', onClick: s => ERP.itemDetail(s.code) })) },
      { id: 'neg', title: L('마이너스 재고 (합계 기준)', 'Tồn âm (theo tổng)'), n: neg.length, tone: 'bad', body: () => ERP.simpleTable([{ label: L('품목코드', 'Mã hàng'), render: s => h('b', s.code) }, { label: L('품명', 'Tên'), render: s => s.name }, { label: L('분류', 'Phân loại'), render: s => ERP.codeChips(s) }, { label: L('창고', 'Kho'), num: 1, render: s => fq(s.by.WH, s.prim) }, { label: L('공장', 'Xưởng'), num: 1, render: s => fq(s.by.FAC, s.prim) }, { label: L('합계', 'Tổng'), num: 1, render: s => h('b', { style: { color: '#9F1F18' } }, fq(s.bal, s.prim)) }], neg.slice(0, 400), { maxH: '300px', onClick: s => ERP.itemDetail(s.code) }) },
      { id: 'type', title: L('품목구분과 ERP CODE 단계가 다름', 'Loại hàng khác với ô đầu ERP CODE'), n: K.typeMismatch.length, tone: 'warn', body: () => ERP.simpleTable(itemCols.concat([{ label: L('단계 기준 기대값', 'Theo ERP CODE nên là'), render: m => m._exp }]), K.typeMismatch.slice(0, 400), { maxH: '300px' }) },
      { id: 'space', title: L('ERP CODE 에 공백', 'ERP CODE có khoảng trắng'), n: K.space.length, tone: 'warn', body: () => ERP.simpleTable(itemCols, K.space, { maxH: '240px' }) },
      { id: 'empty', title: L('ERP CODE 에 빈 칸 (--)', 'ERP CODE có ô trống (--)'), n: K.emptySeg.length, tone: 'warn', body: () => ERP.simpleTable(itemCols, K.emptySeg, { maxH: '240px' }) },
      { id: 'end', title: L('ERP CODE 가 품목코드로 끝나지 않음', 'ERP CODE không kết thúc bằng mã hàng'), n: K.notEnding.length, tone: 'warn', body: () => ERP.simpleTable(itemCols, K.notEnding, { maxH: '240px' }) },
      { id: 'dup', title: L('같은 ERP CODE 를 쓰는 품목', 'Nhiều mã dùng chung ERP CODE'), n: K.dup.length, tone: 'bad', body: () => ERP.simpleTable([{ label: 'ERP CODE', render: d => h('code', { class: 'k' }, d.erp) }, { label: L('품목코드', 'Mã hàng'), render: d => d.items.map(x => x.code).join(', ') }, { label: L('품명', 'Tên'), render: d => d.items.map(x => x.name).join(' / ') }], K.dup) },
      { id: 'fd', title: L('접두어 FD- (FG 오타로 보임)', 'Tiền tố FD- (có thể gõ nhầm FG)'), n: K.fd.length, tone: 'warn', body: () => ERP.simpleTable(itemCols, K.fd) },
      { id: 'unit', title: L('단위 없음 · 표기 혼재 (pcs/KGS/KG)', 'Thiếu đơn vị · viết không thống nhất'), n: K.noUnit.length + K.unitVariant.length, tone: 'neutral', body: () => ERP.simpleTable(itemCols, K.noUnit.concat(K.unitVariant), { maxH: '240px' }) },
      { id: 'noerp', title: L('ERP CODE 없음', 'Chưa có ERP CODE'), n: K.noErp.length, tone: 'neutral', body: () => ERP.simpleTable(itemCols, K.noErp, { maxH: '240px' }) },
      { id: 'missing', title: L('최근 ECOUNT 품목등록 파일에 없는 품목 (숨김 후보)', 'Không có trong file ECOUNT gần nhất (đề xuất ẩn)'), n: K.missing.length, tone: 'warn', body: () => h('div', h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: async () => { if (await ERP.confirm(L(K.missing.length + '개 품목을 숨길까요? (재고·이력은 남고, 목록에서만 숨김)', 'Ẩn ' + K.missing.length + ' mã?'))) { K.missing.forEach(m => { m.hidden = true; }); DB.touch('items'); ERP.render(); } } }, L('모두 숨김', 'Ẩn tất cả'))), ERP.simpleTable(itemCols, K.missing, { maxH: '240px' })) },
      { id: 'unknown', title: L('기초재고에 있지만 품목 마스터에 없는 코드', 'Có trong tồn đầu nhưng chưa có trong danh mục'), n: K.unknownStock.length, tone: 'warn', body: () => ERP.simpleTable([{ label: L('범위', 'Phạm vi'), render: o => scopeChip(o.scope) }, { label: L('코드', 'Mã'), render: o => o.code }, { label: L('품명', 'Tên'), render: o => o.name || '' }, { label: L('수량', 'SL'), num: 1, render: o => fq(o.qty) }], K.unknownStock, { maxH: '240px' }) },
      { id: 'test', title: L('테스트 품목 (기본 숨김)', 'Mã thử nghiệm (ẩn mặc định)'), n: K.test.length, tone: 'neutral', body: () => ERP.simpleTable(itemCols, K.test) },
      { id: 'prod', title: L('생산 반영에서 빠진 것 (BOM 없음 · 품목코드 아님 · 환산 없음 · 부품/원료 미연결)', 'Bỏ sót khi cập nhật SX (thiếu BOM · không phải mã hàng · thiếu quy đổi · linh kiện/NVL chưa khớp)'), n: pp.noBom.size + pp.notItem.size + pp.noConv.size + pp.missingPart.size + pp.rawUnmatched.size, tone: 'neutral', body: () => h('p', { class: 'help' }, L('자세한 목록은 "수불 내역" 탭 위쪽에 있습니다.', 'Danh sách chi tiết ở đầu tab "Nhập xuất tồn".')) },
    ];
    const st = ERP.state.chk = ERP.state.chk || { open: 'susp' };
    put(host, h('div', { class: 'toolbar' }, h('p', { class: 'help', style: { margin: 0 } }, L('품목등록·기초재고에서 찾은 문제입니다. 엑셀로 내려받아 ECOUNT(또는 원본 엑셀)에서 고친 뒤 다시 올리면 됩니다.', 'Các vấn đề tìm thấy trong danh mục / tồn đầu. Xuất Excel, sửa ở ECOUNT rồi tải lại.')), h('span', { class: 'sp' }),
      h('button', { class: 'btn', onclick: exportChecks }, L('점검 결과 엑셀', 'Xuất kết quả kiểm tra'))));
    sections.forEach(sec => {
      const open = st.open === sec.id;
      put(host, h('div', { class: 'card', style: { marginBottom: '10px', padding: '12px 16px' } },
        h('div', { class: 'click', style: { display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }, onclick: () => { st.open = open ? '' : sec.id; ERP.render(); } }, h('b', { style: { flex: 1 } }, sec.title), ERP.chip(sec.n ? sec.tone : 'ok', F.n(sec.n)), h('span', { class: 'muted' }, open ? '▲' : '▼')),
        open && sec.n ? h('div', { style: { marginTop: '10px' } }, sec.body()) : null));
    });
    function exportChecks() {
      const X = window.XLSX; const wb = X.utils.book_new(); const add = (name, hdr, rows) => { X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([hdr].concat(rows.length ? rows : [['–']])), name.slice(0, 31)); };
      const ih = [L('품목코드', 'Mã hàng'), L('품명', 'Tên'), 'ERP CODE', L('품목구분', 'Loại'), L('단위', 'ĐV')]; const ir = (a) => a.map(m => [m.code, m.name || '', m.erp_code || '', m.etype || '', m.unit || '']);
      add('move_suspect', [L('품목코드', 'Mã hàng'), L('품명', 'Tên'), L('창고', 'Kho'), L('공장', 'Xưởng'), L('합계', 'Tổng'), L('단위', 'ĐV')], susp.map(s => [s.code, s.name, s.by.WH, s.by.FAC, s.bal, s.prim]));
      add('negative', [L('품목코드', 'Mã hàng'), L('품명', 'Tên'), L('창고', 'Kho'), L('공장', 'Xưởng'), L('합계', 'Tổng'), L('단위', 'ĐV')], neg.map(s => [s.code, s.name, s.by.WH, s.by.FAC, s.bal, s.prim]));
      add('type_mismatch', ih.concat([L('기대값', 'Nên là')]), K.typeMismatch.map(m => [m.code, m.name || '', m.erp_code || '', m.etype || '', m.unit || '', m._exp]));
      add('erp_space', ih, ir(K.space)); add('erp_empty_segment', ih, ir(K.emptySeg)); add('erp_not_ending', ih, ir(K.notEnding));
      add('erp_duplicate', ['ERP CODE', L('품목코드', 'Mã hàng')], K.dup.map(d => [d.erp, d.items.map(x => x.code).join(', ')]));
      add('fd_prefix', ih, ir(K.fd)); add('unit', ih, ir(K.noUnit.concat(K.unitVariant))); add('missing_in_file', ih, ir(K.missing)); add('test_items', ih, ir(K.test));
      const out = X.write(wb, { bookType: 'xlsx', type: 'array' }); ERP.download('ERP_data_check_' + F.today() + '.xlsx', new Blob([out], { type: 'application/octet-stream' }));
    }
    function suggestDialog() {
      const date = INV.suggestDate(); const rows = INV.suggestMoves(date);   // 기준일 당일이면 다음 날 (당일 수불은 재고에 더하지 않으므로)
      if (!rows.length) { ERP.toast(L('정리할 품목이 없습니다', 'Không có mã cần xử lý'), 'ok'); return; }
      ERP.modal({ title: L('이동 전표 만들기 (미리보기)', 'Tạo phiếu chuyển kho (xem trước)'), width: '900px', body: h('div', h('p', { class: 'help' }, L(date + ' 날짜로 ' + rows.length + '건의 이동 수불을 만듭니다. 저장 뒤에도 "수불 내역"에서 지울 수 있습니다.', 'Tạo ' + rows.length + ' phiếu chuyển ngày ' + date + '. Có thể xóa ở "Nhập xuất tồn".')),
        ERP.simpleTable([{ label: L('품목코드', 'Mã hàng'), render: r => r.code }, { label: L('품명', 'Tên'), render: r => r.name }, { label: L('이동', 'Chuyển'), render: r => ERP.scopeName(r.from_scope) + ' → ' + ERP.scopeName(r.to_scope) }, { label: L('수량', 'SL'), num: 1, render: r => fq(r.qty, r.unit) + ' ' + (r.unit || '') }], rows, { maxH: '50vh' })),
        buttons: [{ label: L('취소', 'Hủy') }, { label: L('저장', 'Lưu'), kind: 'primary', onClick: () => { const doc = INV.nextDoc('MV', date); DB.addMany('stock_tx', rows.map(r => Object.assign({ doc_no: doc }, r))); ERP.toast(L(rows.length + '건 저장 · 전표 ', 'Đã lưu ' + rows.length + ' · phiếu ') + doc, 'ok'); ERP.render(); } }] });
    }
  }

  // ===================================================================== 코드 사전 + ERP CODE 만들기
  function codesTab(host) {
    const st = ERP.state.cod = ERP.state.cod || { level: 'stage', b: { stage: 'WIP', line: 'MINI', cat: '', sub: '', code: '' } };
    const D = INV.dict().m; const items = DB.rows('items');
    const used = new Map(); items.forEach(m => { const i = INV.info(m); [['stage', i.stage], ['line', i.line], ['sub', i.sub], ['cat', i.cat]].forEach(([lv, c]) => { if (!c) return; const k = lv + '|' + (lv === 'cat' ? i.stage : '') + '|' + c; used.set(k, (used.get(k) || 0) + 1); }); });
    const rows = Array.from(D.values()).filter(r => r.level === st.level).sort((a, b) => (a.parent || '').localeCompare(b.parent || '') || (+a.order || 0) - (+b.order || 0));
    // codes in use but missing from the dictionary
    const known = new Set(rows.map(r => (r.parent || '') + '|' + String(r.code).toUpperCase()));
    used.forEach((n, k) => { const [lv, par, c] = k.split('|'); if (lv !== st.level) return; if (!known.has((lv === 'cat' ? par : '') + '|' + c)) rows.push({ level: lv, code: c, parent: lv === 'cat' ? par : undefined, ko: '', vi: '', _new: true }); });
    // 12차: '이름 미정'(guessed) 코드는 이름 칸을 비워 보이고, 이름을 넣으면 '이름 미정' 이 풀린다 (짐작한 이름은 쓰지 않음)
    const nameOf = (r, k) => (r.guessed ? '' : (r[k] || ''));
    const save = (r, patch) => {
      const ex = DB.rows('code_dict').find(x => x.level === r.level && String(x.code).toUpperCase() === String(r.code).toUpperCase() && (x.parent || '') === (r.parent || ''));
      const v = Object.assign({ level: r.level, code: r.code, parent: r.parent, ko: nameOf(r, 'ko'), vi: nameOf(r, 'vi'), order: r.order, guessed: !!r.guessed }, patch);
      if ((patch.ko !== undefined || patch.vi !== undefined) && String(patch.ko || patch.vi || '').trim()) v.guessed = false;
      if (!String(v.ko || '').trim() && !String(v.vi || '').trim()) v.guessed = true;   // 이름이 없으면 코드만 보인다
      Object.keys(v).forEach(k => { if (v[k] === undefined || v[k] === '') delete v[k]; }); v.ko = v.ko || ''; v.vi = v.vi || '';
      if (ex) DB.update('code_dict', ex._id, v); else DB.add('code_dict', v);
      Object.assign(r, { ko: v.ko, vi: v.vi, guessed: !!v.guessed, _new: false }); if (r._flag) r._flag.replaceChildren(...flag(r));   // 다시 그리지 않는다 (입력 칸 포커스 유지)
    };
    const flag = (r) => (r.guessed || r._new ? [ERP.chip('warn', L('이름 미정', 'Chưa đặt tên'))] : []);
    const codeCell = (r) => (r.level === 'stage' ? INV.stageCodeShow(r.code) : r.code);
    put(host, h('div', { class: 'grid2' },
      h('div', h('div', { class: 'toolbar' }, h('div', { class: 'seg' }, [['stage', L('단계', 'Công đoạn')], ['line', L('제품군', 'Dòng SP')], ['cat', L('분류 (자재)', 'Phân loại (vật tư)')], ['sub', L('세부/고객', 'Chi tiết/KH')]].map(o => h('button', { class: 'btn' + (st.level === o[0] ? ' primary' : ''), onclick: () => { st.level = o[0]; ERP.render(); } }, o[1])))),
        ERP.simpleTable([{ label: L('코드', 'Mã'), render: r => h('div', { style: { whiteSpace: 'nowrap' } }, h('b', { title: r.note || '' }, codeCell(r)), ' ', r._flag = h('span', ...flag(r))) }, st.level === 'cat' ? { label: L('상위', 'Thuộc'), render: r => r.parent || '' } : null,
          { label: L('한국어', 'Tiếng Hàn'), render: r => h('input', { class: 'inp', value: nameOf(r, 'ko'), placeholder: r.guessed || r._new ? L('이름 미정', 'Chưa đặt tên') : '', style: { width: '100%', minWidth: '96px' }, onchange: (e) => save(r, { ko: e.target.value.trim() }) }) },
          { label: L('베트남어', 'Tiếng Việt'), render: r => h('input', { class: 'inp', value: nameOf(r, 'vi'), placeholder: r.guessed || r._new ? L('이름 미정', 'Chưa đặt tên') : '', style: { width: '100%', minWidth: '96px' }, onchange: (e) => save(r, { vi: e.target.value.trim() }) }) },
          { label: L('사용 품목', 'Số mã'), num: 1, render: r => F.n(used.get(r.level + '|' + (r.level === 'cat' ? (r.parent || '') : '') + '|' + String(r.code).toUpperCase()) || 0) }].filter(Boolean), rows, { maxH: '62vh' }),
        h('p', { class: 'help' }, L('"ERP CODE 설명" 파일을 올리거나 여기에 이름을 넣으면 화면 전체(카드 · 칩 · 엑셀)에 바로 반영됩니다. "이름 미정" 코드는 이름 대신 코드만 보입니다 — 이름을 넣으면 풀리고, 이름을 지우면 다시 코드만 보입니다.', 'Tải file "ERP CODE 설명" hoặc nhập tên ở đây — áp dụng ngay cho toàn bộ màn hình. Mã "Chưa đặt tên" chỉ hiện mã; nhập tên để hiện tên, xóa tên để quay lại chỉ hiện mã.'))),
      builder()));
    function builder() {
      const b = st.b; const stInfo = INV.stageInfo(b.stage); const mat = stInfo.g === 'mat';
      const lines = Array.from(D.values()).filter(r => r.level === 'line'); const cats = Array.from(D.values()).filter(r => r.level === 'cat' && (!r.parent || r.parent === b.stage)); const subs = Array.from(D.values()).filter(r => r.level === 'sub');
      const realStage = b.stage === 'WIPx6' ? 'WIP06' : b.stage === 'WIPx5' ? 'WIP15' : b.stage;
      const segs = [realStage, mat ? b.cat : b.line, mat ? (b.line || b.sub) : b.sub, b.code].map(x => String(x || '').trim().toUpperCase()).filter((x, i) => x || i === 3);
      const out = segs.filter(Boolean).join('-');
      const exist = b.code ? INV.item(b.code) : null; const dupErp = out ? DB.rows('items').find(m => String(m.erp_code || '').toUpperCase() === out) : null;
      const nm = (r) => (r.guessed ? '' : (ERP.lang === 'vi' ? (r.vi || r.ko) : (r.ko || r.vi)) || '');
      const sel = (k, list, empty) => h('select', { class: 'inp', onchange: (e) => { b[k] = e.target.value; ERP.render(); } }, empty ? h('option', { value: '' }, '—') : null, list.map(r => h('option', { value: r.code, selected: b[k] === r.code }, (k === 'stage' ? INV.stageCodeShow(r.code) : r.code) + (nm(r) ? ' · ' + nm(r) : ''))));
      return h('div', { class: 'card', style: { background: '#FAFBFC' } }, h('h3', L('ERP CODE 만들기 도우미', 'Tạo ERP CODE')),
        h('div', { class: 'form-grid' },
          h('div', { class: 'field' }, h('label', L('단계', 'Công đoạn')), sel('stage', INV.STAGES.map(s => Object.assign({ code: s.code }, D.get('stage||' + String(s.code).toUpperCase()) || {})))),
          mat ? h('div', { class: 'field' }, h('label', L('분류', 'Phân loại')), sel('cat', cats, true)) : h('div', { class: 'field' }, h('label', L('제품군', 'Dòng SP')), sel('line', lines, true)),
          mat ? h('div', { class: 'field' }, h('label', L('제품군 (선택)', 'Dòng SP (tùy chọn)')), sel('line', lines, true)) : h('div', { class: 'field' }, h('label', L('세부/고객', 'Chi tiết/KH')), h('input', { class: 'inp', list: 'dl_subs', value: b.sub, onchange: (e) => { b.sub = e.target.value.toUpperCase(); ERP.render(); } }), h('datalist', { id: 'dl_subs' }, subs.map(r => h('option', { value: r.code }, nm(r))))),
          h('div', { class: 'field' }, h('label', L('품목코드', 'Mã hàng')), h('input', { class: 'inp', value: b.code, onchange: (e) => { b.code = e.target.value.trim(); ERP.render(); } }))),
        h('div', { style: { margin: '14px 0 8px', fontSize: '18px', fontWeight: 700, fontFamily: 'monospace', wordBreak: 'break-all' } }, out || '—'),
        h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', disabled: !out, onclick: () => { try { navigator.clipboard.writeText(out); ERP.toast(L('복사했습니다', 'Đã sao chép'), 'ok'); } catch (e) { ERP.toast(out, 'ok'); } } }, L('복사', 'Sao chép')),
          exist ? ERP.chip('warn', L('이미 있는 품목코드: ', 'Mã đã có: ') + exist.code + (exist.erp_code ? ' (' + exist.erp_code + ')' : '')) : null, dupErp ? ERP.chip('bad', L('같은 ERP CODE 사용 중: ', 'ERP CODE đã dùng: ') + dupErp.code) : null),
        h('p', { class: 'help' }, L('규칙: 단계-제품군-세부-품목코드 (자재는 단계-분류-제품군-품목코드). 예) WIP-MINI-SUP-…, SM-MNA-MINI-52-0708, RM-PIG-PW-R-011. 만든 코드는 ECOUNT 품목등록에 붙여넣은 뒤 품목등록 파일을 다시 올리세요.', 'Quy tắc: công đoạn-dòng SP-chi tiết-mã (vật tư: công đoạn-phân loại-dòng SP-mã). Dán vào ECOUNT rồi tải lại file danh mục.')));
    }
  }

  // ===================================================================== 마스터 · 예시 자료
  function masterTab(host) {
    const st = ERP.state.mst = ERP.state.mst || { t: 'items' };
    const T = [['items', L('품목', 'Mặt hàng')], ['warehouses', L('창고', 'Kho')], ['partners', L('거래처', 'Đối tác')], ['stock_open', L('기초재고', 'Tồn đầu')], ['uploads', L('업로드 이력', 'Lịch sử tải lên')]];
    put(host, h('div', { class: 'toolbar' }, h('div', { class: 'seg' }, T.map(o => h('button', { class: 'btn' + (st.t === o[0] ? ' primary' : ''), onclick: () => { st.t = o[0]; ERP.render(); } }, o[1])))));
    const IC = (k) => ERP.TABLES.items.cols.find(c => c.k === k);
    const opt = { table: st.t, pageSize: 50, maxH: '62vh' };
    if (st.t === 'items') Object.assign(opt, { cols: ['code', 'name', 'erp_code', 'xnk', 'etype', 'unit', 'safety', 'set_per_ct', 'pcs_per_set'].map(IC), beforeSave: itemBeforeSave, defaults: () => ({ src: 'local' }),
      searchKeys: ['code', 'name', 'erp_code', 'xnk'], extraCols: [{ label: () => L('분류', 'Phân loại'), render: r => ERP.codeChips(INV.info(r)) }, { label: () => '', render: r => (r.hidden ? ERP.chip('neutral', L('숨김', 'Ẩn')) : (r.missing ? ERP.chip('warn', L('파일에 없음', 'Không có trong file')) : '')) }],
      filters: [{ id: 'st', label: L('단계', 'Công đoạn'), test: (r, v) => INV.info(r).stage === v, options: () => INV.STAGES.concat(INV.EXTRA_STAGES).map(s => ({ v: s.code, label: INV.stageTitle(s.code) })) }, { id: 'h', label: L('숨김', 'Ẩn'), test: (r, v) => (v === '1' ? !!r.hidden : !r.hidden), options: () => [{ v: '0', label: L('표시 중', 'Đang hiện') }, { v: '1', label: L('숨김', 'Ẩn') }] }] });
    if (st.t === 'uploads') Object.assign(opt, { canAdd: false, sortKey: 'at', sortDir: -1 });
    host.appendChild(ERP.grid(opt).el);
    if (st.t === 'items') put(host, h('p', { class: 'help' }, L('ECOUNT 품목등록을 다시 올리면 신규는 추가, 바뀐 값은 갱신됩니다. 여기서 직접 추가한 품목(출처 local)은 그대로 남습니다. ERP CODE 를 고치면 단계·분류가 자동으로 다시 나뉩니다.', 'Tải lại danh mục ECOUNT: thêm mã mới, cập nhật thay đổi. Mã tự thêm (nguồn local) được giữ. Sửa ERP CODE sẽ tự phân loại lại.')));
  }
  function legacyTab(host) {
    const st = ERP.state.leg = ERP.state.leg || { t: 'materials' };
    const T = [['materials', L('원부자재 마스터', 'Danh mục NVL')], ['inout', L('입출고장', 'Sổ nhập xuất')], ['stocktake', L('재고조사', 'Kiểm kê')], ['returns', L('반품', 'Hàng trả')], ['semi_stock', L('반제품 재고', 'Tồn BTP')]];
    put(host, h('div', { class: 'warn-box', style: { marginBottom: '12px' } }, L('예시(이전) 자료입니다. 6차부터 재고 계산에는 쓰지 않습니다. 설정 → "예시 데이터 한 번에 삭제"로 지울 수 있습니다.', 'Dữ liệu mẫu (cũ) — từ bản 6 không dùng để tính tồn. Xóa ở Cài đặt → "Xóa toàn bộ dữ liệu mẫu".')),
      h('div', { class: 'toolbar' }, h('div', { class: 'seg' }, T.map(o => h('button', { class: 'btn' + (st.t === o[0] ? ' primary' : ''), onclick: () => { st.t = o[0]; ERP.render(); } }, o[1] + ' ' + F.n(DB.rows(o[0]).length))))));
    host.appendChild(ERP.grid({ table: st.t, pageSize: 50, maxH: '60vh' }).el);
  }

  // ===================================================================== pages (12차: 메뉴 3개 — 품목 / 현장 재고 / 원부자재 재고)
  const MENUS = () => {
    const pp = INV.prodPost().diag; const issues = pp.notItem.size + pp.noBom.size + pp.missingPart.size + pp.rawUnmatched.size + pp.noConv.size;
    return {
      items: { def: 'master', tabs: [['master', L('품목 마스터', 'Danh mục')], ['codes', L('코드 사전', 'Từ điển mã')], ['check', L('자료 점검', 'Kiểm tra dữ liệu')], ['legacy', L('예시 자료', 'Dữ liệu mẫu')]] },
      floor: { def: 'floor', tabs: [['floor', L('현장 재고', 'Tồn hiện trường')], ['post', L('생산 반영', 'Cập nhật SX') + (issues ? ' · ' + issues : '')], ['fentry', L('수불 입력', 'Nhập phiếu')], ['fledger', L('수불 내역', 'Nhập xuất tồn')]] },
      materials: { def: 'mat', tabs: [['mat', L('원부자재 재고', 'Tồn NVL')], ['entry', L('수불 입력', 'Nhập phiếu')], ['ledger', L('수불 내역', 'Nhập xuất tồn')], ['reorder', L('발주 · 안전재고', 'Đặt hàng · Tồn AT')], ['buy', L('해외 주문', 'Đặt hàng nước ngoài')], ['outsource', L('외주 입출고', 'Gia công ngoài')]] },
    };
  };
  const TAB_PAGE = { master: 'items', codes: 'items', check: 'items', legacy: 'items', floor: 'floor', post: 'floor', fentry: 'floor', fledger: 'floor', mat: 'materials', entry: 'materials', ledger: 'materials', reorder: 'materials', buy: 'materials', outsource: 'materials' };
  const PAGE_KEY = { items: 'itemTab', floor: 'floorTab', materials: 'mtab' };
  const TAB_FN = { mat: (x) => stockTab(x, 'mat'), floor: (x) => stockTab(x, 'floor'), post: postTab, entry: (x) => entryTab(x, 'mat'), ledger: (x) => ledgerTab(x, 'mat'), fentry: (x) => entryTab(x, 'floor'), fledger: (x) => ledgerTab(x, 'floor'),
    reorder: reorderTab, buy: (x) => ERP.buyTab(x), outsource: outsourceTab, check: checkTab, codes: codesTab, master: masterTab, legacy: legacyTab };   // 16차: 해외 주문 (buy.js)
  /** 탭 이름(옛 'compare' · 'stock' 포함) → [메뉴, 탭] */
  function where(tab) {
    let t = tab;
    if (t === 'stock') { const legacy = ERP.state.stk; const g = legacy && legacy.stage && INV.groupOf({ stage: legacy.stage }) === 'floor' ? 'floor' : 'mat'; if (legacy && legacy.stage) { ERP.state['stk_' + g] = Object.assign(ERP.state['stk_' + g] || {}, legacy); ERP.state.stk = null; } t = g; }
    if (t === 'compare') t = 'mat';   // 12차: ECOUNT 비교는 없앰
    return TAB_PAGE[t] ? [TAB_PAGE[t], t] : null;
  }
  /** 그 탭이 있는 메뉴로 간다 */
  ERP.goStock = function (tab) {
    const w = where(tab); if (!w) return; ERP.state[PAGE_KEY[w[0]]] = w[1]; ERP.state.matTab = null;
    if (location.hash === '#/' + w[0]) ERP.render(); else ERP.goto(w[0]);
  };
  /** 예전 방식(ERP.state.matTab = '탭' + 'materials' 열기)도 맞는 메뉴로 — 다른 메뉴면 주소를 바꾸고 바로 그 메뉴를 그린다 */
  function takeRequest(cur) {
    const t = ERP.state.matTab; if (!t) return false; ERP.state.matTab = null;
    const w = where(t); if (!w) return false; ERP.state[PAGE_KEY[w[0]]] = w[1];
    if (w[0] !== cur) { location.hash = '#/' + w[0]; ERP.render(); return true; }
    return false;
  }
  const itemsLine = () => { const n = DB.rows('items').length, hid = DB.rows('items').filter(r => r.hidden).length; return L('품목 ', 'Mã hàng ') + F.n(n) + L('개', '') + (hid ? L(' · 숨김 ', ' · ẩn ') + F.n(hid) : '') + L(' · 원부자재와 현장 재고는 각자의 메뉴에서 봅니다', ' · Tồn NVL và tồn hiện trường xem ở menu riêng'); };
  const stockPage = (id, ko, vi) => ({ ko, vi, render(root) {
    if (takeRequest(id)) return;
    const M = MENUS()[id]; const key = PAGE_KEY[id];
    const cur = M.tabs.some(t => t[0] === ERP.state[key]) ? ERP.state[key] : M.def; ERP.state[key] = cur;
    const btns = [];
    if (id !== 'items') btns.push(h('button', { class: 'btn', onclick: () => ERP.goStock(id === 'floor' ? 'fentry' : 'entry') }, '+ ' + L('수불 입력', 'Nhập phiếu')));
    btns.push(h('button', { class: 'btn', onclick: () => ERP.goto('data') }, L('자료 올리기', 'Tải dữ liệu')));
    root.appendChild(ERP.pageHead(L(ko, vi), id === 'items' ? itemsLine() : basisLine(), btns));
    const host = h('div', { class: 'card' });
    root.append(ERP.tabs(M.tabs.map(t => ({ id: t[0], label: t[1] })), cur, (tid) => { ERP.state[key] = tid; ERP.render(); }), host);
    TAB_FN[cur](host);
  } });
  ERP.pages.items = stockPage('items', '품목', 'Mặt hàng');
  ERP.pages.floor = stockPage('floor', '현장 재고', 'Tồn hiện trường');
  ERP.pages.materials = stockPage('materials', '원부자재 재고', 'Tồn NVL');
})();
