/* Table schemas: labels in Korean/Vietnamese, field types, natural keys.
   Field types: t=text n=number d=date tm=time s=select b=bool */
(function () {
  'use strict';
  const ERP = window.ERP;

  ERP.PROC = [
    { id: 'INJ', ko: '사출', vi: 'Ép nhựa', en: 'Injection', color: '#1F5FBF', unit: 'pcs' },
    { id: 'REF', ko: '리필 성형', vi: 'Ép lõi (Refill)', en: 'Refill forming', color: '#0E7A5F', unit: 'pcs' },
    { id: 'STP', ko: '핫포일 스탬핑', vi: 'In chuyển (Hot foil)', en: 'Hot foil stamping', color: '#B45F06', unit: 'pcs', dash: false },
    { id: 'ASM', ko: '조립', vi: 'Lắp ráp', en: 'Assembly', color: '#5B4BB7', unit: 'pcs' },
    { id: 'WRP', ko: '종이 권취', vi: 'Quấn giấy', en: 'Paper wrapping', color: '#A8326B', unit: 'pcs' },
    { id: 'PCK', ko: '포장', vi: 'Đóng gói', en: 'Packing', color: '#2B7A8C', unit: 'set' },
  ];
  ERP.procName = (id) => { const p = ERP.PROC.find(x => x.id === id); return p ? L(p.ko, p.vi) : (id || ''); };
  ERP.procColor = (id) => { const p = ERP.PROC.find(x => x.id === id); return p ? p.color : '#8A93A0'; };
  // 1.13.15 (사용자 2026-10-28 "Regular 는 Dial 로 바꾼다. 명칭이 Dial Mini 이면 Mini / Dial이나 Regular 이면 Dial 이다"): 품목군 이름 — 대소문자 · 띄어쓰기 무시
  ERP.normDiv = (d) => { const s = String(d === null || d === undefined ? '' : d).trim(); const k = s.toLowerCase().replace(/[\s_-]+/g, ' ');
    if (/^(dial mini|mini dial)$/.test(k)) return 'Mini'; if (/^(dial|dail|regular|regullar)$/.test(k)) return 'Dial'; return s; };
  // 1.13.13 (사용자 2026-10-28 "생산 관리에 종이 권취 공정의 품목군은 Glass 이다"): 공정마다 정해진 품목군 — 일보 줄의 품목군이 비었을 때만 채운다
  // (현장 일일 생산일보 · 사출 생산일보 · 누적 이력 · ERP 일보 양식 · 일보 입력 모두 여기로). 1.13.15: 품목군 이름도 여기서 정리 (normDiv)
  const PROC_DIV = { WRP: 'Glass' };
  ERP.fillDiv = (r) => { if (!r) return r; const d = ERP.normDiv(r.division); if (d) r.division = d; else if (PROC_DIV[r.process]) r.division = PROC_DIV[r.process]; return r; };

  const procOpts = () => ERP.PROC.map(p => ({ v: p.id, ko: p.ko, vi: p.vi }));
  const shiftOpts = [{ v: 'D', ko: '주간 (D)', vi: 'Ca ngày (D)' }, { v: 'N', ko: '야간 (N)', vi: 'Ca đêm (N)' }];
  const DIVS = ['Dial', 'Mini', 'Pencil', 'Glass', 'Mixed', 'Lead', 'Peel', 'Bic', 'Freedom'];   // 1.13.15: Regular 는 Dial (ERP.normDiv)

  const T = ERP.TABLES = {
    // multi: PO 시트에는 키가 같은 줄이 여러 개 있을 수 있다 → 합치지 않고 순번으로 맞춘다 (DB.upsert)
    po: { ko: '수주 (PO)', vi: 'Đơn hàng (PO)', nat: ['po_no', 'po_no2', 'item_no', 'date', 'kind', 'kind2', 'color'], multi: true, sort: ['date', -1], cols: [
      { k: 'date', ko: '수주일', vi: 'Ngày đặt', t: 'd', list: 1 },
      { k: 'customer', ko: '거래처', vi: 'Khách hàng', t: 't', list: 1 },
      { k: 'country', ko: '국가', vi: 'Quốc gia', t: 't' },
      { k: 'market', ko: '시장/채널', vi: 'Thị trường', t: 't' },
      { k: 'po_no', ko: 'PO 번호', vi: 'Số PO', t: 't', list: 1, req: 1 },
      { k: 'po_no2', ko: 'PO 번호2', vi: 'Số PO 2', t: 't' },
      { k: 'item_no', ko: '품번 (Item)', vi: 'Mã hàng (Item)', t: 't', list: 1 },
      { k: 'manila_no', ko: 'Manila 번호', vi: 'Số Manila', t: 't' },
      { k: 'kind', ko: '품목군', vi: 'Nhóm hàng', t: 't', list: 1, opts: DIVS },
      { k: 'color', ko: '색상수', vi: 'Số màu', t: 't' },
      { k: 'kind2', ko: '구분2', vi: 'Loại 2', t: 't' },
      { k: 'color2', ko: '색상2', vi: 'Màu 2', t: 't' },
      { k: 'rfid', ko: 'RFID', vi: 'RFID', t: 't' },
      { k: 'condition', ko: '조건', vi: 'Điều kiện', t: 't' },
      { k: 'pcs', ko: '수량(pcs)', vi: 'Số lượng (pcs)', t: 'n', list: 1 },
      { k: 'sets', ko: '세트', vi: 'Bộ (set)', t: 'n', list: 1 },
      { k: 'cs', ko: '카톤(cs)', vi: 'Thùng (cs)', t: 'n' },
      { k: 'due', ko: '납기', vi: 'Ngày giao', t: 'd', list: 1 },
      { k: 'packed', ko: '포장수량(set)', vi: 'Đã đóng (set)', t: 'n', list: 1 },
      { k: 'rate', ko: '달성률', vi: 'Tỷ lệ', t: 'n' },
      { k: 'yn', ko: 'OK/NG', vi: 'OK/NG', t: 't' },
      { k: 'done_at', ko: '완료 처리일', vi: 'Ngày đánh dấu xong', t: 'd' },   // 13차: 강제 완료 (수주 목록의 완료 버튼 · 일괄 완료)
      { k: 'mark', ko: '비고', vi: 'Ghi chú', t: 't' },
    ] },

    prod_log: { ko: '생산 일보', vi: 'Báo cáo sản xuất', nat: [], sort: ['date', -1], cols: [
      { k: 'date', ko: '생산일', vi: 'Ngày SX', t: 'd', list: 1, req: 1 },
      { k: 'process', ko: '공정', vi: 'Công đoạn', t: 's', opts: procOpts, list: 1, req: 1 },
      { k: 'shift', ko: '주/야', vi: 'Ca', t: 's', opts: shiftOpts, list: 1 },
      { k: 'workplace', ko: '작업장', vi: 'Công đoạn / xưởng', t: 't' },
      { k: 'machine', ko: '설비명', vi: 'Tên máy', t: 't' },
      { k: 'machine_no', ko: '설비번호', vi: 'Số máy', t: 't', list: 1 },
      { k: 'division', ko: '품목군', vi: 'Nhóm', t: 't', list: 1, opts: DIVS },
      { k: 'part', ko: '부품(사출)', vi: 'Chi tiết (ép)', t: 't' },
      { k: 'code', ko: '코드', vi: 'Mã hàng', t: 't', list: 1 },
      { k: 'item', ko: '재고 품목코드', vi: 'Mã hàng tồn kho', t: 't' },
      { k: 'name', ko: '품명/색상', vi: 'Tên/Màu', t: 't', list: 1 },
      { k: 'po_no', ko: 'PO 번호', vi: 'Số PO', t: 't' },
      { k: 'po_qty', ko: 'PO 수량', vi: 'SL PO', t: 'n' },
      { k: 'plan_qty', ko: '계획수량', vi: 'SL kế hoạch', t: 'n', list: 1 },
      { k: 'ok_qty', ko: '양품수량', vi: 'SL đạt', t: 'n', list: 1 },
      { k: 'ng_qty', ko: '불량수량', vi: 'SL lỗi (NG)', t: 'n', list: 1 },
      { k: 'ok_ea', ko: '환산 pcs', vi: 'Quy đổi pcs', t: 'n' },
      { k: 'ok_ct', ko: '박스 (CT)', vi: 'Thùng (CT)', t: 'n' },
      { k: 'unit', ko: '단위', vi: 'Đơn vị', t: 't' },
      { k: 'start', ko: '시작', vi: 'Bắt đầu', t: 'tm' },
      { k: 'end', ko: '종료', vi: 'Kết thúc', t: 'tm' },
      { k: 'break_min', ko: '휴게(분)', vi: 'Nghỉ (phút)', t: 'n' },
      { k: 'work_min', ko: '가동(분)', vi: 'Phút làm việc', t: 'n' },
      { k: 'workers', ko: '인원', vi: 'Công nhân', t: 'n' },
      { k: 'stop_min', ko: '정지(분)', vi: 'Dừng máy (phút)', t: 'n', list: 1 },
      { k: 'stop_reason', ko: '정지 사유', vi: 'Lý do dừng', t: 't' },
      { k: 'cavity', ko: '캐비티', vi: 'Cavity', t: 'n' },
      { k: 'cavity2', ko: '캐비티2', vi: 'Số lượng con hàng 2', t: 'n' },   // 1.13.15: 사출 생산일보의 칸 (기록 · 분석용)
      { k: 'shots', ko: '샷수', vi: 'Số shot', t: 'n' },
      { k: 'shot_qty', ko: '수량 (Shot × 캐비티2)', vi: 'Số lượng (shot × cavity 2)', t: 'n' },
      { k: 'ct', ko: 'CT(초)', vi: 'CT (giây)', t: 'n' },
      { k: 'inj_time', ko: '사출시간', vi: 'Thời gian ép', t: 'n' },
      { k: 'weight_kg', ko: '중량(kg)', vi: 'Khối lượng (kg)', t: 'n' },
      { k: 'raw_material', ko: '원료', vi: 'Nguyên liệu', t: 't' },
      { k: 'raw_kg', ko: '원료사용(kg)', vi: 'NL sử dụng (kg)', t: 'n' },
      { k: 'remark', ko: '비고', vi: 'Ghi chú', t: 't' },
      { k: 'source', ko: '출처', vi: 'Nguồn', t: 't' },
    ] },

    materials: { ko: '원부자재 마스터', vi: 'Danh mục NVL', nat: ['code'], sort: ['code', 1], cols: [
      { k: 'code', ko: '창고코드(WH)', vi: 'Mã kho (WH)', t: 't', list: 1, req: 1 },
      { k: 'acc_code', ko: '회계코드', vi: 'Mã kế toán', t: 't' },
      { k: 'name_en', ko: '자재명 (EN)', vi: 'Tên (EN)', t: 't', list: 1, req: 1 },
      { k: 'name_vn', ko: '자재명 (VN)', vi: 'Tên tiếng Việt', t: 't', list: 1 },
      { k: 'name_kr', ko: '자재명 (KR)', vi: 'Tên tiếng Hàn', t: 't' },
      { k: 'category', ko: '분류', vi: 'Phân loại', t: 't', list: 1 },
      { k: 'kind', ko: '구분', vi: 'Nhóm', t: 't', list: 1 },
      { k: 'grp', ko: '그룹', vi: 'Nhóm GR', t: 't' },
      { k: 'unit', ko: '관리단위', vi: 'Đơn vị quản lý', t: 's', opts: ['kg', 'ea'], list: 1 },
      { k: 'kg_per_ea', ko: '규격 (kg/ea)', vi: 'Quy cách (kg/ea)', t: 'n', list: 1 },
      { k: 'safety_stock', ko: '안전재고', vi: 'Tồn an toàn', t: 'n', list: 1 },
      { k: 'usage_kg_month', ko: '월 사용(kg)', vi: 'Dùng/tháng (kg)', t: 'n' },
      { k: 'usage_ea_month', ko: '월 사용(ea)', vi: 'Dùng/tháng (ea)', t: 'n' },
      { k: 'open_kg', ko: '기초재고 kg', vi: 'Tồn đầu kg', t: 'n', list: 1 },
      { k: 'open_ea', ko: '기초재고 ea', vi: 'Tồn đầu ea', t: 'n', list: 1 },
      { k: 'cas_no', ko: 'CAS NO', vi: 'CAS NO', t: 't' },
      { k: 'note', ko: '비고', vi: 'Ghi chú', t: 't' },
    ] },

    inout: { ko: '자재 입출고', vi: 'Nhập xuất NVL', nat: [], sort: ['date', -1], cols: [
      { k: 'date', ko: '일자', vi: 'Ngày', t: 'd', list: 1, req: 1 },
      { k: 'doc_no', ko: '전표번호', vi: 'Số chứng từ', t: 't', list: 1 },
      { k: 'type', ko: '입/출', vi: 'Nhập/Xuất', t: 's', opts: [{ v: 'IN', ko: '입고', vi: 'Nhập' }, { v: 'OUT', ko: '출고', vi: 'Xuất' }], list: 1, req: 1 },
      { k: 'partner_code', ko: '거래처코드', vi: 'Mã ĐV', t: 't' },
      { k: 'partner_name', ko: '거래처', vi: 'Đơn vị', t: 't', list: 1 },
      { k: 'wh_code', ko: '창고코드', vi: 'Mã kho', t: 't', list: 1, req: 1 },
      { k: 'item_code', ko: '품번', vi: 'Mã hàng', t: 't', list: 1 },
      { k: 'name', ko: '자재명', vi: 'Tên NVL', t: 't', list: 1 },
      { k: 'content', ko: '내용', vi: 'Nội dung', t: 't' },
      { k: 'kg_per_ea', ko: 'kg/ea', vi: 'kg/ea', t: 'n' },
      { k: 'in_kg', ko: '입고 kg', vi: 'Nhập kg', t: 'n', list: 1 },
      { k: 'in_ea', ko: '입고 ea', vi: 'Nhập ea', t: 'n', list: 1 },
      { k: 'out_kg', ko: '출고 kg', vi: 'Xuất kg', t: 'n', list: 1 },
      { k: 'out_ea', ko: '출고 ea', vi: 'Xuất ea', t: 'n', list: 1 },
    ] },

    stocktake: { ko: '재고조사', vi: 'Kiểm kê', nat: ['date', 'wh_code'], sort: ['date', -1], cols: [
      { k: 'date', ko: '조사일', vi: 'Ngày kiểm kê', t: 'd', list: 1, req: 1 },
      { k: 'wh_code', ko: '창고코드', vi: 'Mã kho', t: 't', list: 1, req: 1 },
      { k: 'name', ko: '자재명', vi: 'Tên NVL', t: 't', list: 1 },
      { k: 'counted_kg', ko: '실사 kg', vi: 'Thực tế kg', t: 'n', list: 1 },
      { k: 'counted_ea', ko: '실사 ea', vi: 'Thực tế ea', t: 'n', list: 1 },
      { k: 'adjusted', ko: '조정 반영', vi: 'Đã điều chỉnh', t: 'b', list: 1 },
      { k: 'note', ko: '비고', vi: 'Ghi chú', t: 't', list: 1 },
    ] },

    partners: { ko: '거래처', vi: 'Đơn vị / Đối tác', nat: ['code'], sort: ['code', 1], cols: [
      { k: 'code', ko: '거래처코드', vi: 'Mã đơn vị', t: 't', list: 1, req: 1 },
      { k: 'name', ko: '거래처명', vi: 'Tên đơn vị', t: 't', list: 1, req: 1 },
      { k: 'address', ko: '주소/정보', vi: 'Thông tin', t: 't', list: 1 },
      { k: 'phone', ko: '전화', vi: 'Số điện thoại', t: 't', list: 1 },
      { k: 'note', ko: '내용', vi: 'Nội dung', t: 't', list: 1 },
    ] },

    returns: { ko: '반품', vi: 'Hàng trả', nat: [], sort: ['date', -1], cols: [
      { k: 'date', ko: '일자', vi: 'Ngày', t: 'd', list: 1 },
      { k: 'code', ko: '코드', vi: 'Mã', t: 't', list: 1 },
      { k: 'name', ko: '품명', vi: 'Tên', t: 't', list: 1 },
      { k: 'qty_text', ko: '수량', vi: 'Số lượng', t: 't', list: 1 },
    ] },

    products: { ko: '제품 색상', vi: 'Danh mục màu SP', nat: ['code'], sort: ['code', 1], cols: [
      { k: 'code', ko: '제품코드', vi: 'Mã SP', t: 't', list: 1, req: 1 },
      { k: 'color_name', ko: '색상명', vi: 'Tên màu', t: 't', list: 1, req: 1 },
      { k: 'group_code', ko: '그룹코드', vi: 'Mã nhóm', t: 't', list: 1 },
      { k: 'kind', ko: '품목군', vi: 'Loại', t: 't', list: 1 },
      { k: 'version', ko: '버전', vi: 'Phiên bản', t: 't', list: 1 },
      { k: 'nose_code', ko: 'Nose cone 코드', vi: 'Mã nose cone', t: 't', list: 1 },
      { k: 'refill_code', ko: 'Refill 코드', vi: 'Mã refill', t: 't', list: 1 },
      { k: 'barrel_code', ko: 'Barrel 코드', vi: 'Mã barrel', t: 't', list: 1 },
      { k: 'grp', ko: '그룹', vi: 'Nhóm', t: 't' },
      { k: 'sku', ko: 'SKU', vi: 'SKU', t: 't', list: 1 },
      { k: 'remarks', ko: '비고', vi: 'Ghi chú', t: 't' },
    ] },

    bom: { ko: 'BOM (색상별)', vi: 'BOM theo màu', nat: ['retail_no', 'color_code'], sort: ['retail_no', 1], cols: [
      { k: 'retail_no', ko: 'Retail 번호', vi: 'Mã Retail', t: 't', list: 1, req: 1 },
      { k: 'color_code', ko: '색상코드', vi: 'Mã màu', t: 't', list: 1, req: 1 },
      { k: 'color_name', ko: '색상명', vi: 'Tên màu', t: 't', list: 1 },
      { k: 'division', ko: '품목군', vi: 'Nhóm', t: 't', list: 1 },
      { k: 'n_colors', ko: '색상수', vi: 'Số màu', t: 'n', list: 1 },
      { k: 'kind', ko: '구분', vi: 'Loại', t: 't' },
      { k: 'nose_code', ko: 'Nose cone', vi: 'Nose cone', t: 't', list: 1 },
      { k: 'nose_color', ko: 'Nose 색', vi: 'Màu nose', t: 't' },
      { k: 'refill_code', ko: 'Refill', vi: 'Refill', t: 't', list: 1 },
      { k: 'refill_color', ko: 'Refill 색', vi: 'Màu refill', t: 't' },
      { k: 'barrel_code', ko: 'Barrel', vi: 'Barrel', t: 't', list: 1 },
      { k: 'barrel_color', ko: 'Barrel 색', vi: 'Màu barrel', t: 't' },
      { k: 'holder', ko: 'Holder', vi: 'Holder', t: 't', list: 1 },
      { k: 'spoon', ko: 'Spoon', vi: 'Spoon', t: 't', list: 1 },
    ] },

    item_bom: { ko: '품목 구성 (Item BOM)', vi: 'Item BOM', nat: ['item'], sort: ['item', 1], cols: [
      { k: 'item', ko: '품번', vi: 'Mã hàng', t: 't', list: 1, req: 1 },
      { k: 'manila', ko: 'Manila', vi: 'Manila', t: 't', list: 1 },
      { k: 'kind', ko: '품목군', vi: 'Nhóm', t: 't', list: 1 },
      { k: 'colors', ko: '색상수', vi: 'Số màu', t: 'n', list: 1 },
      { k: 'rfid', ko: 'RFID', vi: 'RFID', t: 't' },
      { k: 'kind2', ko: '구분2', vi: 'Loại 2', t: 't', list: 1 },
      { k: 'cs', ko: '카톤입수(cs)', vi: 'SL/thùng', t: 'n', list: 1 },
    ] },

    recipes: { ko: '배합표 (Recipe)', vi: 'Công thức phối liệu', nat: ['code', 'material'], sort: ['code', 1], cols: [
      { k: 'code', ko: '색상코드', vi: 'Mã màu', t: 't', list: 1, req: 1 },
      { k: 'sku', ko: 'SKU', vi: 'SKU', t: 't', list: 1 },
      { k: 'color', ko: '색상', vi: 'Màu', t: 't', list: 1 },
      { k: 'material', ko: '원료', vi: 'Nguyên liệu', t: 't', list: 1, req: 1 },
      { k: 'coef', ko: '배합량 (g/개)', vi: 'Định mức (g/cái)', t: 'n', list: 1 },
      { k: 'note', ko: '비고 (향기오일 등)', vi: 'Ghi chú (tinh dầu…)', t: 't' },
    ] },

    refill_specs: { ko: '리필 규격', vi: 'Quy cách refill', nat: ['erp_code'], sort: ['erp_code', 1], cols: [
      { k: 'customer', ko: '고객', vi: 'Khách hàng', t: 't', list: 1 },
      { k: 'kind', ko: '구분', vi: 'Loại', t: 't', list: 1 },
      { k: 'code', ko: '코드', vi: 'Mã', t: 't', list: 1 },
      { k: 'name', ko: '색상', vi: 'Màu', t: 't', list: 1 },
      { k: 'class', ko: '분류', vi: 'Phân loại', t: 't' },
      { k: 'erp_code', ko: 'ERP 코드', vi: 'Mã ERP', t: 't', list: 1, req: 1 },
      { k: 'plan_weight_g', ko: '계획중량(g)', vi: 'KL kế hoạch (g)', t: 'n', list: 1 },
      { k: 'g_per_pc', ko: '개당 g', vi: 'g/cái', t: 'n', list: 1 },
      { k: 'plan_qty', ko: '계획수량', vi: 'SL kế hoạch', t: 'n', list: 1 },
    ] },

    semi_items: { ko: '반제품 목록', vi: 'Danh mục bán thành phẩm', nat: ['code'], sort: ['code', 1], cols: [
      { k: 'code', ko: '코드', vi: 'Mã', t: 't', list: 1, req: 1 },
      { k: 'name', ko: '품명', vi: 'Tên', t: 't', list: 1 },
      { k: 'category', ko: '분류', vi: 'Danh mục', t: 't', list: 1 },
      { k: 'cl1', ko: 'CL-1', vi: 'CL-1', t: 't', list: 1 },
      { k: 'cl2', ko: 'CL-2', vi: 'CL-2', t: 't', list: 1 },
      { k: 'cl3', ko: 'CL-3', vi: 'CL-3', t: 't', list: 1 },
    ] },

    sub_materials: { ko: '부자재 목록', vi: 'Danh mục vật liệu phụ', nat: ['code'], sort: ['code', 1], cols: [
      { k: 'code', ko: '코드', vi: 'Mã', t: 't', list: 1, req: 1 },
      { k: 'name', ko: '품명', vi: 'Tên', t: 't', list: 1 },
      { k: 'category', ko: '분류', vi: 'Danh mục', t: 't', list: 1 },
      { k: 'customer', ko: '고객', vi: 'Khách hàng', t: 't', list: 1 },
      { k: 'type', ko: '종류', vi: 'Loại', t: 't', list: 1 },
      { k: 'grp', ko: '그룹', vi: 'Nhóm', t: 't' },
    ] },

    // 통합 품목 마스터 (6차): ECOUNT 품목등록 + 사용자 정의 BOM 품목. stage/line/sub/cat 은 ERP CODE 에서 자동 분리
    items: { ko: '품목 마스터', vi: 'Danh mục mặt hàng', nat: ['code'], sort: ['code', 1], cols: [
      { k: 'code', ko: '품목코드', vi: 'Mã mặt hàng', t: 't', list: 1, req: 1 },
      { k: 'name', ko: '품명', vi: 'Tên', t: 't', list: 1 },
      { k: 'erp_code', ko: 'ERP CODE', vi: 'ERP CODE', t: 't', list: 1 },
      { k: 'xnk', ko: '세관신고 코드 (Mã XNK)', vi: 'Mã XNK', t: 't', list: 1 },
      { k: 'name_vn', ko: '품명 (베트남어 원문)', vi: 'Tên (tiếng Việt gốc)', t: 't' },   // 14차: 베트남어 품목명을 한국어로 바꿀 때 원래 이름
      { k: 'kg_per_ea', ko: '개당 kg', vi: 'Kg / cái', t: 'n' },
      { k: 'etype', ko: '품목구분', vi: 'Loại (ECOUNT)', t: 't', list: 1 },
      { k: 'unit', ko: '단위', vi: 'Đơn vị', t: 't', list: 1, opts: ['PCS', 'CT', 'SET', 'kg', 'ROLL', 'CHAI', 'g', 'm', 'ea', 'box'] },
      { k: 'safety', ko: '안전재고', vi: 'Tồn an toàn', t: 'n', list: 1 },
      { k: 'stage', ko: '단계', vi: 'Công đoạn', t: 't' },
      { k: 'line', ko: '제품군', vi: 'Dòng SP', t: 't' },
      { k: 'sub', ko: '세부/고객', vi: 'Chi tiết/KH', t: 't' },
      { k: 'cat', ko: '분류', vi: 'Phân loại', t: 't' },
      { k: 'set_per_ct', ko: 'CT당 set', vi: 'Bộ/thùng', t: 'n' },
      { k: 'pcs_per_set', ko: 'set당 pcs', vi: 'Cái/bộ', t: 'n' },
      { k: 'type', ko: 'BOM 유형', vi: 'Loại BOM', t: 's', opts: () => ERP.ITEM_TYPES.map(x => ({ v: x.v, ko: x.ko, vi: x.vi })) },
      { k: 'proc', ko: '생산 공정', vi: 'Công đoạn SX', t: 't' },
      { k: 'safety_move', ko: '안전재고관리-창고이동', vi: 'QL tồn AT - chuyển kho', t: 't' },
      // 16차: 해외 주문 품목 (자재구매 파일 Oder Korea 표) — 원부자재 재고 → 해외 주문 탭에서 따로 본다
      { k: 'buy', ko: '해외 주문 품목', vi: 'Hàng đặt nước ngoài', t: 'b' },
      { k: 'buy_cat', ko: '구분 (해외 주문)', vi: 'Nhóm (đặt nước ngoài)', t: 't' },
      { k: 'name_kr', ko: '품명 (한글)', vi: 'Tên (tiếng Hàn)', t: 't' },
      { k: 'buy_unit', ko: '단위 (해외 주문)', vi: 'ĐV (đặt nước ngoài)', t: 't' },
      { k: 'buy_safety', ko: '안전재고 (해외 주문 단위)', vi: 'Tồn AT (ĐV đặt hàng)', t: 'n' },   // ERP 단위와 다를 때만 (같으면 safety)
      { k: 'buy_ord', ko: '순서 (해외 주문)', vi: 'Thứ tự (đặt nước ngoài)', t: 'n' },
      { k: 'lead_days', ko: '리드타임 (일)', vi: 'Thời gian giao (ngày)', t: 'n' },
      { k: 'buy_step', ko: '주문 단위 (해외 주문)', vi: 'Bước đặt hàng', t: 'n' },   // 1.11.3: 비우면 안전재고 자릿수 (백 단위 → 100, 천 단위 → 1,000)
      { k: 'buy_inv', ko: '재고 (자재구매 파일)', vi: 'Tồn (file mua NVL)', t: 'n' },   // 파일의 Inventory — ERP 재고와 다르면 해외 주문 표에 같이 보인다
      { k: 'buy_inv_date', ko: '자재구매 파일 날짜', vi: 'Ngày file mua NVL', t: 'd' },
      { k: 'hidden', ko: '숨김', vi: 'Ẩn', t: 'b' },
      { k: 'missing', ko: 'ECOUNT 파일에 없음', vi: 'Không có trong file ECOUNT', t: 'b' },
      { k: 'src', ko: '출처', vi: 'Nguồn', t: 't' },
      { k: 'note', ko: '비고', vi: 'Ghi chú', t: 't' },
    ] },

    // 창고 (ECOUNT 창고리스트). scope: WH = 창고 묶음, FAC = 공장 묶음 (외주처 포함)
    warehouses: { ko: '창고', vi: 'Kho', nat: ['code'], sort: ['code', 1], cols: [
      { k: 'code', ko: '창고코드', vi: 'Mã kho', t: 't', list: 1, req: 1 },
      { k: 'name', ko: '창고명', vi: 'Tên kho', t: 't', list: 1, req: 1 },
      { k: 'kind', ko: '구분', vi: 'Loại', t: 't', list: 1 },
      { k: 'scope', ko: '재고 범위', vi: 'Phạm vi tồn', t: 's', list: 1, opts: () => ERP.SCOPES.map(x => ({ v: x.v, ko: x.ko, vi: x.vi })) },
      { k: 'process', ko: '생산공정명', vi: 'Công đoạn', t: 't', list: 1 },
      { k: 'partner', ko: '외주거래처명', vi: 'Đơn vị gia công', t: 't', list: 1 },
      { k: 'active', ko: '사용', vi: 'Sử dụng', t: 'b', list: 1 },
      { k: 'site', ko: '추가사업장명', vi: 'Chi nhánh', t: 't' },
    ] },

    // ERP CODE 사전 (ERP CODE 설명 + 추정값). level: stage / line / sub / cat
    code_dict: { ko: 'ERP CODE 사전', vi: 'Từ điển ERP CODE', nat: ['level', 'parent', 'code'], sort: ['order', 1], cols: [
      { k: 'level', ko: '구분', vi: 'Cấp', t: 's', list: 1, req: 1, opts: () => [{ v: 'stage', ko: '단계', vi: 'Công đoạn' }, { v: 'line', ko: '제품군', vi: 'Dòng SP' }, { v: 'sub', ko: '세부/고객', vi: 'Chi tiết' }, { v: 'cat', ko: '분류', vi: 'Phân loại' }] },
      { k: 'code', ko: '코드', vi: 'Mã', t: 't', list: 1, req: 1 },
      { k: 'ko', ko: '한국어', vi: 'Tiếng Hàn', t: 't', list: 1 },
      { k: 'vi', ko: '베트남어', vi: 'Tiếng Việt', t: 't', list: 1 },
      { k: 'parent', ko: '상위 단계', vi: 'Thuộc', t: 't', list: 1 },
      { k: 'order', ko: '순서', vi: 'Thứ tự', t: 'n', list: 1 },
      { k: 'guessed', ko: '확인 필요', vi: 'Cần xác nhận', t: 'b', list: 1 },
    ] },

    // 기초재고 (ECOUNT 재고현황을 기준일 재고로 가져온 값)
    stock_open: { ko: '기초재고', vi: 'Tồn đầu kỳ', nat: ['scope', 'code'], sort: ['code', 1], cols: [
      { k: 'date', ko: '기준일', vi: 'Ngày chốt', t: 'd', list: 1, req: 1 },
      { k: 'scope', ko: '범위', vi: 'Phạm vi', t: 's', list: 1, req: 1, opts: () => ERP.SCOPES.map(x => ({ v: x.v, ko: x.ko, vi: x.vi })) },
      { k: 'code', ko: '품목코드', vi: 'Mã hàng', t: 't', list: 1, req: 1 },
      { k: 'name', ko: '품명', vi: 'Tên', t: 't', list: 1 },
      { k: 'unit', ko: '단위', vi: 'Đơn vị', t: 't', list: 1 },
      { k: 'qty', ko: '재고수량', vi: 'Số lượng tồn', t: 'n', list: 1 },
      { k: 'sets', ko: 'Số Set', vi: 'Số Set', t: 'n', list: 1 },
      { k: 'pcs', ko: 'Số PCS', vi: 'Số PCS', t: 'n', list: 1 },
      { k: 'grp', ko: '구분 (floor = 현장 실사)', vi: 'Nhóm (floor = kiểm kê hiện trường)', t: 't', list: 1 },
      { k: 'file', ko: '파일', vi: 'File', t: 't' },
      { k: 'sheet', ko: '시트', vi: 'Sheet', t: 't' },
    ] },

    // 재고 수불 (입고·출고·이동·조정). 생산 실적 반영분은 생산일보에서 자동 계산되어 저장하지 않는다
    stock_tx: { ko: '재고 수불', vi: 'Nhập xuất tồn', nat: [], sort: ['date', -1], cols: [
      { k: 'date', ko: '일자', vi: 'Ngày', t: 'd', list: 1, req: 1 },
      { k: 'doc_no', ko: '전표번호', vi: 'Số chứng từ', t: 't', list: 1 },
      { k: 'kind', ko: '구분', vi: 'Loại', t: 's', list: 1, req: 1, opts: () => ERP.TX_KINDS.filter(x => !x.auto).map(x => ({ v: x.v, ko: x.ko, vi: x.vi })) },
      { k: 'from_scope', ko: '출발', vi: 'Từ', t: 's', list: 1, opts: () => ERP.SCOPES.map(x => ({ v: x.v, ko: x.ko, vi: x.vi })) },
      { k: 'to_scope', ko: '도착', vi: 'Đến', t: 's', list: 1, opts: () => ERP.SCOPES.map(x => ({ v: x.v, ko: x.ko, vi: x.vi })) },
      { k: 'code', ko: '품목코드', vi: 'Mã hàng', t: 't', list: 1, req: 1 },
      { k: 'name', ko: '품명', vi: 'Tên', t: 't', list: 1 },
      { k: 'qty', ko: '수량 (주 단위)', vi: 'Số lượng (ĐV chính)', t: 'n', list: 1, req: 1 },
      { k: 'unit', ko: '단위', vi: 'Đơn vị', t: 't', list: 1 },
      { k: 'partner', ko: '거래처', vi: 'Đối tác', t: 't', list: 1 },
      { k: 'partner_code', ko: '업체코드', vi: 'Mã ĐV', t: 't' },   // 14차: 창고 입출고장 D 칸
      { k: 'purpose', ko: '용도', vi: 'Mục đích', t: 't' },   // 14차: 창고 입출고장 I 칸에서 나눔 (생산 투입 · 외주 가공 · 반품 …)
      { k: 'lot', ko: 'Lot', vi: 'Lot', t: 't' },
      { k: 'color', ko: '색깔', vi: 'Màu', t: 't' },
      { k: 'ref', ko: '참조 (PO 등)', vi: 'Tham chiếu (PO…)', t: 't' },
      { k: 'note', ko: '비고', vi: 'Ghi chú', t: 't', list: 1 },
      { k: 'src', ko: '출처', vi: 'Nguồn', t: 't' },
    ] },

    // 16차: 해외 주문 (자재구매 파일의 주문일 칸 · 입고예정 칸, ERP 에서 넣은 주문). 입고 완료는 입고 대기에서 빼기만 한다 (재고는 창고 입출고장 · 수불로)
    buy_orders: { ko: '해외 주문', vi: 'Đặt hàng nước ngoài', nat: ['date', 'code', 'kind', 'pool'], sort: ['date', -1], cols: [
      { k: 'date', ko: '주문일', vi: 'Ngày đặt', t: 'd', list: 1, req: 1 },
      { k: 'code', ko: '품목코드', vi: 'Mã hàng', t: 't', list: 1, req: 1 },
      { k: 'pool', ko: '따로 관리 (구분)', vi: 'Quản lý riêng (nhóm)', t: 't', list: 1 },   // 1.11.2: 따로 관리하는 재고(buy_pools)의 주문이면 그 구분
      { k: 'kind', ko: '구분 (inc = 입고예정 칸)', vi: 'Loại (inc = sắp nhập)', t: 't', list: 1 },
      { k: 'name', ko: '품명', vi: 'Tên', t: 't', list: 1 },
      { k: 'qty', ko: '수량', vi: 'Số lượng', t: 'n', list: 1, req: 1 },
      { k: 'unit', ko: '단위', vi: 'Đơn vị', t: 't', list: 1 },
      { k: 'status', ko: '상태', vi: 'Trạng thái', t: 's', list: 1, opts: () => [{ v: 'open', ko: '입고 대기', vi: 'Chờ nhập' }, { v: 'recv', ko: '입고 완료', vi: 'Đã nhập' }] },
      { k: 'recv', ko: '입고일', vi: 'Ngày nhập', t: 'd', list: 1 },
      { k: 'eta', ko: '도착 예정 (직접 입력)', vi: 'Dự kiến về (nhập tay)', t: 'd' },
      { k: 'note', ko: '비고', vi: 'Ghi chú', t: 't', list: 1 },
      { k: 'src', ko: '출처', vi: 'Nguồn', t: 't' },
    ] },

    // 1.11.2: 자재구매 파일에 같은 코드가 다른 구분으로 또 있으면 따로 관리하는 재고 (사용자: BIC 업체 요청으로 창고를 나눠 원료를 따로 관리).
    // 첫 줄은 ERP 품목(창고 입출고장 재고), 다음 줄은 여기 — 재고 = 자재구매 파일 값
    buy_pools: { ko: '해외 주문 — 따로 관리하는 재고', vi: 'Đặt nước ngoài — tồn quản lý riêng', nat: ['code', 'cat'], sort: ['ord', 1], cols: [
      { k: 'code', ko: '품목코드', vi: 'Mã hàng', t: 't', list: 1, req: 1 },
      { k: 'cat', ko: '구분 (자재구매 파일)', vi: 'Nhóm (file)', t: 't', list: 1, req: 1 },
      { k: 'name', ko: '품명', vi: 'Tên', t: 't', list: 1 },
      { k: 'name_kr', ko: '품명 (한글)', vi: 'Tên (tiếng Hàn)', t: 't' },
      { k: 'unit', ko: '단위', vi: 'Đơn vị', t: 't', list: 1 },
      { k: 'safety', ko: '안전재고', vi: 'Tồn an toàn', t: 'n', list: 1 },
      { k: 'inv', ko: '재고 (자재구매 파일)', vi: 'Tồn (file)', t: 'n', list: 1 },
      { k: 'inv_date', ko: '자재구매 파일 날짜', vi: 'Ngày file', t: 'd', list: 1 },
      { k: 'ord', ko: '순서', vi: 'Thứ tự', t: 'n' },
      { k: 'lead_days', ko: '리드타임 (일)', vi: 'Thời gian giao (ngày)', t: 'n' },
      { k: 'step', ko: '주문 단위', vi: 'Bước đặt hàng', t: 'n' },
    ] },

    // 업로드 이력
    uploads: { ko: '업로드 이력', vi: 'Lịch sử tải lên', nat: [], sort: ['at', -1], cols: [
      { k: 'at', ko: '시각', vi: 'Thời điểm', t: 't', list: 1 },
      { k: 'kind', ko: '자료', vi: 'Loại dữ liệu', t: 't', list: 1 },
      { k: 'file', ko: '파일', vi: 'File', t: 't', list: 1 },
      { k: 'scope', ko: '범위', vi: 'Phạm vi', t: 't', list: 1 },
      { k: 'date', ko: '기준일', vi: 'Ngày', t: 'd', list: 1 },
      { k: 'mode', ko: '방식', vi: 'Cách', t: 't', list: 1 },
      { k: 'rows', ko: '행 수', vi: 'Số dòng', t: 'n', list: 1 },
      { k: 'added', ko: '추가', vi: 'Thêm', t: 'n', list: 1 },
      { k: 'changed', ko: '변경', vi: 'Sửa', t: 'n', list: 1 },
      { k: 'removed', ko: '삭제/교체', vi: 'Xóa', t: 'n', list: 1 },
      { k: 'note', ko: '비고', vi: 'Ghi chú', t: 't', list: 1 },
    ] },

    bom_lines: { ko: '품목 구성 (BOM 라인)', vi: 'Cấu thành mặt hàng (BOM)', nat: ['parent', 'child'], sort: ['parent', 1], cols: [
      { k: 'parent', ko: '상위 품목 (결과물)', vi: 'Mặt hàng cha (thành phẩm)', t: 't', list: 1, req: 1 },
      { k: 'child', ko: '하위 품목 (구성품)', vi: 'Thành phần (con)', t: 't', list: 1, req: 1 },
      { k: 'qty', ko: '소요량 (상위 1개당)', vi: 'Định mức (cho 1 cha)', t: 'n', list: 1 },
      { k: 'loss', ko: '손실률 %', vi: 'Hao hụt %', t: 'n', list: 1 },
      { k: 'note', ko: '비고', vi: 'Ghi chú', t: 't', list: 1 },
      { k: 'src', ko: '출처 (auto = 자동 구성)', vi: 'Nguồn (auto = tự động)', t: 't', list: 1 },
    ] },

    // 7차: 코드 연결 — 생산일보 코드·원료 이름이 ECOUNT 품목코드와 다를 때 연결한다 (생산 반영에 사용)
    code_map: { ko: '코드 연결', vi: 'Liên kết mã', nat: ['kind', 'proc', 'div', 'src'], sort: ['src', 1], cols: [
      { k: 'kind', ko: '구분', vi: 'Loại', t: 's', list: 1, req: 1, opts: () => [{ v: 'daily', ko: '일보 코드', vi: 'Mã báo cáo SX' }, { v: 'raw', ko: '원료 이름', vi: 'Tên nguyên liệu' }] },
      { k: 'proc', ko: '공정 (비우면 전체)', vi: 'Công đoạn (trống = tất cả)', t: 's', list: 1, opts: procOpts },
      { k: 'div', ko: '품목군 (비우면 전체)', vi: 'Nhóm (trống = tất cả)', t: 't', list: 1 },
      { k: 'src', ko: '일보 코드 / 원료 이름', vi: 'Mã báo cáo / tên NL', t: 't', list: 1, req: 1 },
      { k: 'item', ko: 'ECOUNT 품목코드', vi: 'Mã ECOUNT', t: 't', list: 1, req: 1 },
      { k: 'note', ko: '비고', vi: 'Ghi chú', t: 't', list: 1 },
    ] },

    semi_stock: { ko: '반제품(세미) 재고', vi: 'Tồn bán thành phẩm', nat: ['code'], sort: ['code', 1], cols: [
      { k: 'code', ko: '코드', vi: 'Mã', t: 't', list: 1, req: 1 },
      { k: 'name', ko: '품명', vi: 'Tên', t: 't', list: 1 },
      { k: 'qty', ko: '재고 수량', vi: 'Số lượng tồn', t: 'n', list: 1 },
      { k: 'unit', ko: '단위', vi: 'Đơn vị', t: 't', list: 1 },
      { k: 'date', ko: '기준일', vi: 'Ngày kiểm', t: 'd', list: 1 },
      { k: 'note', ko: '비고', vi: 'Ghi chú', t: 't', list: 1 },
    ] },

    outsource: { ko: '외주 입출고', vi: 'Nhập xuất gia công', nat: [], sort: ['date', -1], cols: [
      { k: 'date', ko: '일자', vi: 'Ngày', t: 'd', list: 1, req: 1 },
      { k: 'doc_no', ko: '전표번호', vi: 'Số CT', t: 't', list: 1 },
      { k: 'type', ko: '구분', vi: 'Loại', t: 's', list: 1, req: 1, opts: () => [{ v: 'OUT', ko: '외주 출고 (보냄)', vi: 'Xuất đi gia công' }, { v: 'IN', ko: '외주 입고 (받음)', vi: 'Nhận về từ gia công' }] },
      { k: 'partner', ko: '외주처', vi: 'Đơn vị gia công', t: 't', list: 1, req: 1 },
      { k: 'item_code', ko: '품목코드', vi: 'Mã hàng', t: 't', list: 1 },
      { k: 'name', ko: '품명', vi: 'Tên hàng', t: 't', list: 1 },
      { k: 'qty_kg', ko: '수량 kg', vi: 'SL kg', t: 'n', list: 1 },
      { k: 'qty_ea', ko: '수량 ea/pcs', vi: 'SL ea/pcs', t: 'n', list: 1 },
      { k: 'work', ko: '외주 작업', vi: 'Công việc gia công', t: 't', list: 1 },
      { k: 'note', ko: '비고', vi: 'Ghi chú', t: 't' },
    ] },

    machines: { ko: '설비 마스터', vi: 'Danh mục máy', nat: ['process', 'machine_no'], sort: ['process', 1], cols: [
      { k: 'process', ko: '공정', vi: 'Công đoạn', t: 's', opts: procOpts, list: 1, req: 1 },
      { k: 'machine_no', ko: '설비번호', vi: 'Số máy', t: 't', list: 1, req: 1 },
      { k: 'name', ko: '설비명', vi: 'Tên máy', t: 't', list: 1 },
      { k: 'division', ko: '품목군', vi: 'Nhóm', t: 't', list: 1 },
      { k: 'active', ko: '사용', vi: 'Đang dùng', t: 'b', list: 1 },
      { k: 'note', ko: '비고', vi: 'Ghi chú', t: 't', list: 1 },
    ] },
  };

  // display label helpers
  ERP.colLabel = (c) => L(c.ko, c.vi);
  ERP.tableLabel = (n) => L(T[n].ko, T[n].vi);
  ERP.colOpts = (c) => {
    let o = typeof c.opts === 'function' ? c.opts() : c.opts; if (!o) return null;
    return o.map(x => typeof x === 'string' ? { v: x, label: x } : { v: x.v, label: L(x.ko, x.vi) });
  };

  // Entry layout of the daily-report quick entry (per process)
  ERP.ENTRY = {
    INJ: ['machine_no', 'division', 'part', 'cavity', 'shots', 'ct', 'ok_qty', 'ng_qty', 'weight_kg', 'raw_material', 'raw_kg', 'work_min', 'remark'],
    REF: ['machine', 'machine_no', 'name', 'code', 'plan_qty', 'ok_qty', 'ng_qty', 'weight_kg', 'start', 'end', 'break_min', 'workers', 'stop_min', 'remark'],
    STP: ['machine', 'machine_no', 'code', 'name', 'ok_qty', 'ng_qty', 'start', 'end', 'break_min', 'workers', 'stop_min', 'remark'],
    ASM: ['machine', 'machine_no', 'code', 'name', 'ok_qty', 'ng_qty', 'start', 'end', 'break_min', 'workers', 'stop_min', 'remark'],
    WRP: ['machine_no', 'name', 'code', 'po_no', 'po_qty', 'plan_qty', 'ok_qty', 'ng_qty', 'work_min', 'workers', 'stop_min', 'remark'],
    PCK: ['name', 'code', 'po_no', 'po_qty', 'machine_no', 'plan_qty', 'ok_qty', 'ok_ea', 'ng_qty', 'start', 'end', 'break_min', 'workers', 'stop_min', 'stop_reason'],
  };

  // ---- inventory scopes (6차: 창고 / 공장 2묶음) and transaction kinds ----
  ERP.SCOPES = [{ v: 'WH', ko: '창고', vi: 'Kho' }, { v: 'FAC', ko: '공장', vi: 'Xưởng' }];
  ERP.scopeName = (v) => { const s = ERP.SCOPES.find(x => x.v === v); return s ? L(s.ko, s.vi) : (v || ''); };
  ERP.TX_KINDS = [
    { v: 'IN', ko: '입고', vi: 'Nhập', sign: 'to' }, { v: 'OUT', ko: '출고', vi: 'Xuất', sign: 'from' }, { v: 'MOVE', ko: '이동', vi: 'Chuyển kho', sign: 'both' },
    { v: 'ADJ', ko: '조정', vi: 'Điều chỉnh', sign: 'adj' },
    { v: 'PROD', ko: '생산입고', vi: 'Nhập SX', sign: 'to', auto: true }, { v: 'USE', ko: '생산소모', vi: 'Tiêu hao SX', sign: 'from', auto: true },
  ];
  ERP.txKindName = (v) => { const k = ERP.TX_KINDS.find(x => x.v === v); return k ? L(k.ko, k.vi) : (v || ''); };

  // ---- item types for the custom BOM ----
  ERP.ITEM_TYPES = [{ v: 'RAW', ko: '원료/자재', vi: 'Nguyên liệu/vật tư' }, { v: 'PART', ko: '부품', vi: 'Chi tiết' }, { v: 'SEMI', ko: '반제품', vi: 'Bán thành phẩm' }, { v: 'FG', ko: '완제품', vi: 'Thành phẩm' }, { v: 'PACK', ko: '포장재', vi: 'Bao bì' }];

  // ---- customizable processes: stored in settings ('procs') ----
  ERP.DEFAULT_ENTRY = ['machine_no', 'code', 'name', 'ok_qty', 'ng_qty', 'start', 'end', 'break_min', 'workers', 'stop_min', 'remark'];
  ERP.entryCols = (id) => { const p = ERP.PROC.find(x => x.id === id); return (p && p.entry && p.entry.length) ? p.entry : (ERP.ENTRY[id] || ERP.DEFAULT_ENTRY); };
  ERP.dashProcs = () => ERP.PROC.filter(p => p.dash !== false);
  ERP.loadProcs = function () {
    const saved = ERP.db.setting('procs', null);
    if (Array.isArray(saved) && saved.length) { ERP.PROC.length = 0; saved.forEach(p => ERP.PROC.push(p)); }
  };
  ERP.saveProcs = function () { ERP.db.setSetting('procs', JSON.parse(JSON.stringify(ERP.PROC))); };
})();
