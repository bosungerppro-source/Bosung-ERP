/* Data hub: Excel import/export, Google Sheets/Drive sync, backup, settings */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, F = ERP.fmt, XL = ERP.xl;

  const MODES = () => ({
    upsert: L('덮어쓰기/추가 (키 기준)', 'Cập nhật/thêm (theo khóa)'), range: L('기간 교체 (같은 날짜 범위)', 'Thay theo khoảng ngày'), slip: L('전표 번호 기준 교체', 'Thay theo số phiếu'),
    update: L('기존 항목만 갱신', 'Chỉ cập nhật mã có sẵn'), append: L('끝에 추가', 'Thêm vào cuối'), replace: L('전체 교체', 'Thay toàn bộ') });

  // ---------------- import ----------------
  // 자료 종류별 안내 (마지막 업로드일은 uploads 표에서)
  const GUIDE = () => [
    { kinds: ['ecount_items'], title: L('ECOUNT 품목등록', 'ECOUNT · Danh mục mặt hàng'), when: L('품목이 추가·변경될 때', 'Khi thêm/sửa mã hàng'), text: L('신규는 추가, 바뀐 값은 갱신, 지우지는 않습니다 (파일에 없는 품목은 "숨김 후보").', 'Thêm mới, cập nhật thay đổi, không xóa (mã không có trong file = đề xuất ẩn).') },
    { kinds: ['ecount_stock'], title: L('ECOUNT 재고현황 (창고 · 공장)', 'ECOUNT · Tồn kho (Kho · Xưởng)'), when: L('처음 1회', 'Lần đầu'), text: L('창고 · 공장 재고를 기초재고로 설정합니다. 그 뒤 재고는 이 ERP 의 수불 · 생산 반영으로 계산합니다 (다시 올리면 그 범위의 기초재고를 바꿉니다).', 'Đặt tồn Kho · Xưởng làm tồn đầu kỳ. Sau đó tồn được tính bằng phiếu · cập nhật SX trong ERP này (tải lại sẽ thay tồn đầu của phạm vi đó).') },
    { kinds: ['ecount_wh', 'ecount_codes'], title: L('창고리스트 · ERP CODE 설명', 'Danh sách kho · Giải thích ERP CODE'), when: L('바뀔 때만', 'Khi có thay đổi'), text: L('창고 범위(창고/공장)와 코드 이름(한/베)을 정합니다.', 'Xác định phạm vi kho và tên mã (Hàn/Việt).') },
    { kinds: ['wh_ledger_tx'], title: L('창고 입출고장 (BẢNG KÊ NHẬP XUẤT)', 'Bảng kê nhập xuất NVL'), when: L('창고 장부를 정리할 때', 'Khi chốt sổ kho'), text: L('원부자재 품목(F 코드 · 세관 코드 G)을 맞추거나 만들고, 첫 입출고일 전날 기초재고(기말 재고 − 입고 + 출고)와 입고 · 출고를 넣습니다. ECOUNT 재고현황을 같이 올리면 없는 품목만 보완합니다.', 'Khớp/tạo mã NVL, đặt tồn đầu (cuối kỳ − nhập + xuất) và nhập · xuất. Tải kèm tồn kho ECOUNT để bổ sung mã còn thiếu.') },
    { kinds: ['stock_tx'], title: L('재고 수불 (입고·출고·이동·조정)', 'Nhập · xuất · chuyển · điều chỉnh'), when: L('매일', 'Hằng ngày'), daily: true, text: L('수불 양식 또는 KHO NVL 입출고장을 그대로 올립니다. 급한 건은 원부자재 재고 → 수불 입력.', 'Tải mẫu nhập xuất hoặc sổ KHO NVL. Việc gấp: Tồn NVL → Nhập phiếu.'), btn: [L('수불 양식 받기', 'Tải mẫu'), () => ERP.ecount.txTemplate()] },
    { kinds: ['prod_log'], title: L('생산일보 (공정별)', 'Báo cáo sản xuất'), when: L('매일', 'Hằng ngày'), daily: true, text: L('올리면 생산량 입고 · BOM 현장 부품 차감이 재고에 자동 반영됩니다. 원부자재는 차감하지 않습니다.', 'Tự động nhập SX · trừ linh kiện hiện trường theo BOM. Không trừ NVL.'), btn: [L('일보 양식 받기', 'Tải mẫu báo cáo'), () => XL.dailyTemplate()] },
    { kinds: ['floor_count'], title: L('현장 재고 실사 (TỒN KHO · 공정 중)', 'Kiểm kê tồn hiện trường (TỒN KHO)'), when: L('실사할 때', 'Khi kiểm kê'), text: L('공정 중 부품 · 조립 색연필의 현장 수량. 파일 이름의 날짜가 현장 기초재고 기준일이 되고, 원부자재(ECOUNT)와 따로 관리합니다.', 'Số lượng linh kiện · bút đã lắp tại hiện trường. Ngày trong tên file = ngày tồn đầu hiện trường; quản lý riêng với NVL (ECOUNT).') },
    { kinds: ['recipes_usage'], title: L('BOM 사용량 (배합표 · 원료 g/개)', 'Định mức NVL (g/cái)'), when: L('배합이 바뀔 때', 'Khi công thức thay đổi'), text: L('최신 판을 올리면 통째로 바뀝니다. 재고는 차감하지 않고 소요량(MRP) · 신고서 계산에만 씁니다.', 'Tải bản mới nhất sẽ thay toàn bộ. Không trừ tồn; chỉ dùng tính nhu cầu (MRP) · tờ khai.') },
    { kinds: ['po'], title: L('수주 (PO)', 'Đơn hàng (PO)'), when: L('수주가 바뀔 때', 'Khi PO thay đổi'), text: L('한 PO에 여러 품번 가능. 수주 관리 화면에서 직접 입력해도 됩니다.', 'Một PO có thể nhiều mã. Có thể nhập ở màn hình Đơn hàng.') },
  ];
  ERP.lastUpload = (kinds) => DB.rows('uploads').filter(u => kinds.includes(u.kind)).reduce((a, u) => (String(u.at) > a ? String(u.at) : a), '');
  const BOM_SRC = ['bom', 'products', 'item_bom']; // 생산 반영(BOM 차감)이 참고하는 예시 표 (11차: 배합표는 차감에 쓰지 않음)
  const SAMPLE_TABLES = ['po', 'prod_log', 'bom', 'item_bom', 'recipes', 'refill_specs', 'products', 'semi_items', 'sub_materials', 'materials', 'inout', 'returns', 'stocktake', 'semi_stock', 'machines', 'partners'];
  // 예시 행 = 예전 샘플(첨부 엑셀)에서 온 행 (_ex 표시). 새로 올리거나 손으로 고친 행은 예시가 아니다.
  ERP.sampleCount = (t) => DB.memo('sample:' + t, [t], () => DB.rows(t).reduce((a, r) => a + (r._ex ? 1 : 0), 0));
  ERP.isSample = (t) => ERP.sampleCount(t) > 0;
  ERP.sampleChip = (t) => { const n = ERP.sampleCount(t); if (!n) return null; const all = n === DB.rows(t).length;
    return h('span', { class: 'label-sample', title: L('예전 샘플에서 온 예시 행입니다. 설정 → "예시 데이터 한 번에 삭제"로 예시 행만 지울 수 있습니다.', 'Dòng mẫu từ dữ liệu cũ. Xóa ở Cài đặt → "Xóa toàn bộ dữ liệu mẫu".') }, ERP.chip('warn', all ? L('예시 데이터', 'Dữ liệu mẫu') : L('예시 ' + F.n(n) + '행 포함', 'Gồm ' + F.n(n) + ' dòng mẫu'))); };
  const jobKind = (j) => j.kind || j.table;
  const prevBox = (p) => (p ? h('div', { class: 'imp-prev' }, (p.parts || []).map(x => ERP.chip(x[2] || 'neutral', x[0] + (x[1] !== '' && x[1] !== undefined ? ' ' + (typeof x[1] === 'number' ? F.n(x[1]) : x[1]) : ''))), p.detail ? h('small', { class: 'muted' }, p.detail) : null) : null);

  function importTab(host) {
    const st = ERP.state.imp = ERP.state.imp || { jobs: [], files: [] };
    const out = h('div');
    const fi = h('input', { type: 'file', accept: '.xlsx,.xlsm,.xls,.csv', multiple: true, style: { display: 'none' }, onchange: (e) => load(Array.from(e.target.files)) });
    const today = F.today();
    const guide = h('div', { class: 'guide' }, GUIDE().map(g => { const last = ERP.lastUpload(g.kinds); const d = last ? last.slice(0, 10) : ''; const stale = g.daily && (!d || F.diffDays(today, d) >= 1);
      return h('div', h('b', g.title), h('span', { class: 'muted' }, g.when + ' · ' + L('마지막 ', 'Gần nhất ')), d ? ERP.chip(stale ? 'warn' : 'ok', d) : ERP.chip(g.daily ? 'warn' : 'neutral', L('없음', 'Chưa có')), h('span', g.text), g.btn ? h('div', h('button', { class: 'btn sm', onclick: g.btn[1] }, g.btn[0])) : null); }));
    const drop = h('div', { class: 'drop', tabindex: 0, onclick: () => fi.click(),
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); load(Array.from(e.dataTransfer.files)); } },
      h('b', L('엑셀 파일을 여기에 끌어다 놓거나 클릭하여 선택 (여러 개 한 번에)', 'Kéo thả file Excel vào đây hoặc bấm để chọn (nhiều file cùng lúc)')),
      h('div', { class: 'help' }, L('ECOUNT 품목등록 · 창고리스트 · 재고현황 · ERP CODE 설명 · 수불 양식 · KHO NVL 입출고장 · 공정별 생산일보 · 수주(PO) · BOM/배합표를 내용으로 자동 인식합니다 (파일명은 상관없음).', 'Tự nhận dạng theo nội dung: danh mục / kho / tồn kho ECOUNT · mẫu nhập xuất · sổ KHO NVL · báo cáo SX · PO · BOM (tên file không quan trọng).')), fi);
    async function load(files) {
      if (!files.length) return; out.replaceChildren(h('p', { class: 'help' }, L('분석 중…', 'Đang phân tích…')));
      try { fi.value = ''; } catch (e) { /* ignore */ }
      st.jobs = [];
      for (const f of files) {
        try { const wb = await XL.readFile(f); const jobs = XL.analyze(wb, { file: f.name }); jobs.forEach(j => { j.file = f.name; if (j.S && !j.S.file) j.S.file = f.name; if (j.table && !j.mode) j.mode = 'upsert'; if (typeof j.onFile === 'function') j.onFile(j); }); st.jobs.push(...jobs); }
        catch (e) { console.error(e); ERP.toast(f.name + ': ' + e.message, 'bad'); }
      }
      st.jobs.forEach(j => { if (typeof j.onBatch === 'function') j.onBatch(st.jobs, j); });   // j = 화면이 쓰는 작업 (XL.analyze 가 복사본을 만든다)   // 14차: 같이 올린 파일끼리 (예: 창고 입출고장 + ECOUNT 재고현황 → 보완)
      show();
    }
    function show() {
      out.replaceChildren(); const jobs = st.jobs; if (!jobs.length) return;
      const M = MODES();
      const rows = jobs.map(j => {
        const cb = h('input', { type: 'checkbox', checked: !!j.include, disabled: !j.table || !j.rows.length, onchange: (e) => { j.include = e.target.checked; sum(); } });
        const modes = j.modes ? j.modes() : M;
        const sel = j.table ? h('select', { class: 'inp', onchange: (e) => { j.mode = e.target.value; show(); } }, Object.keys(modes).map(k => h('option', { value: k, selected: j.mode === k }, modes[k]))) : null;
        const extra = [];
        if (j.table === 'prod_log') extra.push(h('input', { class: 'inp', type: 'date', title: L('이 날짜 이후만 반영', 'Chỉ áp dụng từ ngày'), value: j.since || '', onchange: (e) => { j.since = e.target.value; } }));
        if (j.custom === 'stock') extra.push(h('select', { class: 'inp', title: L('재고 범위', 'Phạm vi'), onchange: (e) => { j.scope = e.target.value || null; show(); } }, h('option', { value: '' }, L('범위 선택', 'Chọn phạm vi')), ERP.SCOPES.map(x => h('option', { value: x.v, selected: j.scope === x.v }, L(x.ko, x.vi)))));
        if (j.setOutMode) extra.push(h('select', { class: 'inp', title: L('출고 처리', 'Xử lý xuất'), onchange: (e) => { j.setOutMode(e.target.value); show(); } }, [['move', L('출고 → 창고에서 공장으로 이동', 'Xuất → chuyển Kho sang Xưởng')], ['out', L('출고 → 외부 출고', 'Xuất → xuất ra ngoài')]].map(o => h('option', { value: o[0], selected: j.outMode === o[0] }, o[1]))));
        let pv = null; try { pv = j.preview ? j.preview(j) : (j.table === 'prod_log' && ERP.ecount ? ERP.ecount.prodPreview(j) : null); } catch (e) { console.error(e); }
        if (pv && pv.unknown) extra.push(h('button', { class: 'btn sm', onclick: () => ERP.ecount.resolveDialog(j, show) }, L('코드 확인 ', 'Xác nhận mã ') + pv.unknown));
        const ds = j.rows.map(r => r.date).filter(Boolean).sort();
        let dateCell = j.custom === 'stock' ? F.d(j.date) : (ds.length ? F.d(ds[0]) + (ds[0] !== ds[ds.length - 1] ? ' ~ ' + F.d(ds[ds.length - 1]) : '') : '');
        const fd = XL.fileDate(j.file);
        // 11차: 현장 재고 실사 — 기준일(파일 이름의 날짜)을 고칠 수 있게. 같은 파일의 다른 시트도 같은 날짜로
        if (j.custom === 'floor') {
          const setFloorDate = (d) => { st.jobs.filter(x => x.custom === 'floor' && x.file === j.file).forEach(x => { x.date = d || null; x.needDate = !d; if (d) x.include = x.rows.length > 0; }); show(); };
          dateCell = [h('input', { class: 'inp', type: 'date', value: j.date || '', title: L('현장 실사 기준일', 'Ngày kiểm kê'), onchange: (e) => setFloorDate(e.target.value) }),
            !j.date ? h('div', { class: 'help', style: { color: '#B3261E' } }, L('현장 실사 기준일을 넣으세요', 'Hãy nhập ngày kiểm kê')) : (fd && fd !== j.date ? h('div', { class: 'help', style: { color: '#C77700' } }, L('⚠ 파일명 날짜(' + fd + ')와 다름 ', '⚠ Khác ngày trong tên file (' + fd + ') '), h('button', { class: 'btn sm', onclick: () => setFloorDate(fd) }, L('파일명 날짜 적용', 'Dùng ngày tên file'))) : null)];
        }
        if (j.table === 'prod_log' && (j.needDate || (ds.length && ds[0] === ds[ds.length - 1]))) {
          const setDate = (d) => { j.rows.forEach(r => { r.date = d; }); if (j.needDate) { j.needDate = false; j.include = true; j.note = ''; } show(); };
          const di = h('input', { class: 'inp', type: 'date', value: ds[0] || '', onchange: (e) => { if (e.target.value) setDate(e.target.value); } });
          dateCell = [di, fd && fd !== ds[0] ? h('div', { class: 'help', style: { color: '#C77700' } }, L('⚠ 파일명 날짜(' + fd + ')와 다름 ', '⚠ Khác ngày trong tên file (' + fd + ') '), h('button', { class: 'btn sm', onclick: () => setDate(fd) }, L('파일명 날짜 적용', 'Dùng ngày tên file'))) : null];
        }
        // 같은 날짜 · 공정의 누적 시트(Ho_so) 행이 있으면: 기본은 일보를 건너뛰고, 고르면 일보로 바꾼다
        if (j.table === 'prod_log' && j.rows.length && j.rows.every(r => r.source === 'daily-report' || r.source === 'template')) {
          j.overlap = XL.overlapOf(j.rows);
          if (j.overlap) extra.push(h('select', { class: 'inp', title: L('누적 시트와 같은 날짜', 'Trùng ngày với sổ tổng hợp'), onchange: (e) => { j.overlapMode = e.target.value; } },
            [['skip', L('누적 시트에 있는 날짜는 건너뜀', 'Bỏ qua ngày đã có trong sổ tổng hợp')], ['replace', L('일보로 바꾸기 (그날 누적 시트 행 삭제)', 'Thay bằng báo cáo ngày (xóa dòng sổ tổng hợp)')]].map(o => h('option', { value: o[0], selected: (j.overlapMode || 'skip') === o[0] }, o[1]))));
        }
        return h('tr', h('td', cb), h('td', h('div', { class: 'strong' }, j.sheet), h('small', { class: 'muted' }, j.file || '')),
          h('td', { style: { whiteSpace: 'normal', maxWidth: '460px' } }, j.table ? [ERP.chip('info', j.label || ERP.tableLabel(j.table)), j.proc ? ' ' + ERP.procName(j.proc) : '', j.note ? h('div', { class: 'help' }, j.note) : null,
            j.overlap ? h('div', { class: 'help', style: { color: '#C77700' } }, L('⚠ 누적 시트(수주·생산 관리 파일)에 같은 날짜 · 공정 기록이 있습니다: ' + j.overlap + '행', '⚠ Sổ tổng hợp đã có cùng ngày · công đoạn: ' + j.overlap + ' dòng')) : null, prevBox(pv)] : (j.error ? ERP.chip('bad', j.error) : ERP.chip('neutral', L('인식 불가 (건너뜀)', 'Không nhận dạng (bỏ qua)')))),
          h('td', { class: 'num' }, F.n(j.rows.length)), h('td', dateCell), h('td', sel), h('td', extra));
      });
      const info = h('span', { class: 'muted' });
      const sum = () => { const n = jobs.filter(j => j.include).reduce((a, j) => a + j.rows.length, 0); info.textContent = L(n + '행 반영 예정', n + ' dòng sẽ được áp dụng'); };
      out.append(h('div', { class: 'tbl-wrap', style: { marginTop: '14px', maxHeight: '56vh' } }, h('table', { class: 'tbl' },
        h('thead', h('tr', [L('반영', 'Chọn'), L('시트 / 파일', 'Sheet / file'), L('인식 결과 · 미리보기', 'Nhận dạng · xem trước'), L('행 수', 'Số dòng'), L('기간 / 기준일', 'Ngày'), L('반영 방식', 'Cách áp dụng'), L('옵션', 'Tùy chọn')].map(x => h('th', x)))), h('tbody', rows))),
        h('div', { class: 'toolbar', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: apply }, L('선택 항목 모두 반영', 'Áp dụng tất cả mục đã chọn')), h('button', { class: 'btn', onclick: () => { st.jobs = []; show(); } }, L('취소', 'Hủy')), info),
        h('p', { class: 'help' }, L('여러 파일을 함께 올리면 품목 → 창고 → 코드 사전 → 재고 → 수불 → 나머지 순서로 반영합니다. 반영 직후 "되돌리기"로 직전 상태로 돌릴 수 있습니다 (화면을 닫기 전까지). 권장: 일보·수불은 "기간 교체/전표 번호 기준", 마스터는 "덮어쓰기/추가".', 'Khi tải nhiều file: áp dụng theo thứ tự danh mục → kho → từ điển mã → tồn → phiếu → còn lại. Có thể "Hoàn tác" ngay sau khi áp dụng.')));
      sum();
    }
    async function apply() {
      const sel = st.jobs.filter(j => j.include && j.table && j.rows.length); if (!sel.length) { ERP.toast(L('반영할 항목이 없습니다', 'Chưa chọn mục nào'), 'warn'); return; }
      if (sel.some(j => j.mode === 'replace') && !(await ERP.confirm(L('"전체 교체"가 선택되어 있습니다. 기존 데이터가 삭제됩니다. 계속할까요?', 'Đã chọn "Thay toàn bộ" – dữ liệu cũ sẽ bị xóa. Tiếp tục?')))) return;
      const noScope = sel.filter(j => j.custom === 'stock' && !j.scope); if (noScope.length) { ERP.toast(L('재고현황의 범위(창고/공장)를 고르세요', 'Hãy chọn phạm vi cho file tồn kho'), 'warn'); return; }
      const reopen = sel.filter(j => (j.custom === 'stock' || j.custom === 'whopen') && j.mode === 'open' && DB.rows('stock_open').some(r => r.scope === j.scope && r.grp !== 'floor'));
      if (reopen.length && !(await ERP.confirm(L('기초재고를 다시 설정합니다: ', 'Đặt lại tồn đầu: ') + reopen.map(j => ERP.scopeName(j.scope) + ' ' + j.date).join(', ') + L('\n그 날짜까지의 수불은 기초재고에 포함된 것으로 보고 재고에 더하지 않습니다. 계속할까요?', '\nPhiếu đến ngày này coi như đã nằm trong tồn đầu. Tiếp tục?'), L('재설정', 'Đặt lại'), true))) return;
      // 11차: 현장 재고 실사 — 기준일 필수, 이전 실사를 바꿀 때는 확인
      const floorJobs = sel.filter(j => j.custom === 'floor');
      if (floorJobs.some(j => !j.date)) { ERP.toast(L('현장 재고의 실사 기준일을 넣으세요', 'Hãy nhập ngày kiểm kê tồn hiện trường'), 'warn'); return; }
      const oldFloor = DB.rows('stock_open').filter(r => r.grp === 'floor' && !floorJobs.some(j => r.file === j.file && r.date === j.date));
      if (floorJobs.length && oldFloor.length && !(await ERP.confirm(L('현장 재고(공정 중)를 다시 설정합니다: 기준일 ', 'Đặt lại tồn hiện trường (đang SX): ngày ') + floorJobs[0].date + L('\n이전 현장 실사(' + oldFloor.length + '행)는 지우고, 그 날짜까지의 생산 · 소모는 실사 수량에 들어 있다고 봅니다. 원부자재 재고는 그대로입니다. 계속할까요?', '\nXóa kiểm kê cũ (' + oldFloor.length + ' dòng). SX · tiêu hao đến ngày này coi như đã nằm trong số kiểm kê. Tồn NVL giữ nguyên. Tiếp tục?'), L('재설정', 'Đặt lại'), true))) return;
      sel.sort((a, b) => (a.prio === undefined ? 9 : a.prio) - (b.prio === undefined ? 9 : b.prio));
      // undo snapshot of every touched table
      const touched = new Set(sel.map(j => j.table)); if (sel.some(j => j.custom === 'stock')) touched.add('items');
      if (floorJobs.length) touched.add('items');   // 현장 실사로 새로 만든 품목도 되돌린다
      touched.add('uploads');   // 되돌리면 업로드 이력(마지막 업로드일)도 되돌린다
      st.undo = { at: new Date().toISOString(), tables: {} }; touched.forEach(t => { st.undo.tables[t] = JSON.parse(JSON.stringify(DB.rows(t))); });
      const log = []; const at = F.now();
      sel.forEach(j => {
        try {
          const r = XL.apply(j); log.push([j.sheet, j.label || j.table, r]);
          const ds = j.rows.map(x => x.date).filter(Boolean).sort();
          DB.add('uploads', Object.fromEntries(Object.entries({ at, kind: jobKind(j), file: j.file, scope: j.scope ? ERP.scopeName(j.scope) : undefined, date: j.date || ds[ds.length - 1], mode: j.mode, rows: j.rows.length, added: r.added || 0, changed: r.updated || 0, removed: r.removed || 0, note: [j.label, r.missing ? L('파일에 없음 ', 'thiếu ') + r.missing : '', r.skipped ? L('건너뜀 ', 'bỏ qua ') + r.skipped : '', r.conv ? L('환산 ', 'quy đổi ') + r.conv : ''].filter(Boolean).join(' · ') }).filter(([, v]) => v !== undefined && v !== '')));
        } catch (e) { console.error(e); log.push([j.sheet, j.label || j.table, { error: e.message }]); }
      });
      st.jobs = [];
      // 12차: 올린 자료에 맞는 메뉴로 (현장 실사 · 생산일보 → 현장 재고, 재고 · 수불 → 원부자재 재고, 품목 · 창고 · 코드 → 품목)
      const dest = floorJobs.length || sel.some(j => j.table === 'prod_log') ? ['floor', L('현장 재고 보기', 'Xem tồn hiện trường')] : sel.some(j => j.custom === 'stock' || j.table === 'stock_tx') ? ['materials', L('원부자재 재고 보기', 'Xem tồn NVL')] : sel.some(j => ['items', 'warehouses', 'code_dict'].includes(j.table)) ? ['items', L('품목 보기', 'Xem mặt hàng')] : null;
      const undoBtn = h('button', { class: 'btn', onclick: async () => { if (!st.undo) return; if (!(await ERP.confirm(L('방금 반영한 내용을 되돌릴까요?', 'Hoàn tác lần áp dụng vừa rồi?')))) return; Object.keys(st.undo.tables).forEach(t => DB.replace(t, st.undo.tables[t])); DB.add('uploads', { at: F.now(), kind: 'undo', note: L('되돌리기', 'Hoàn tác'), rows: 0 }); st.undo = null; ERP.toast(L('되돌렸습니다', 'Đã hoàn tác'), 'ok'); ERP.render(); } }, L('되돌리기', 'Hoàn tác'));
      out.replaceChildren(h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 'card-head' }, h('h3', { style: { margin: 0 } }, L('반영 결과', 'Kết quả')), h('div', { class: 'toolbar', style: { margin: 0 } }, undoBtn, dest ? h('button', { class: 'btn', onclick: () => ERP.goto(dest[0]) }, dest[1]) : null)),
        ERP.simpleTable([{ label: L('시트', 'Sheet'), render: x => x[0] }, { label: L('대상', 'Bảng'), render: x => x[1] }, { label: L('추가', 'Thêm'), num: 1, render: x => F.n(x[2].added || 0) }, { label: L('갱신', 'Cập nhật'), num: 1, render: x => F.n(x[2].updated || 0) }, { label: L('삭제(교체)', 'Xóa (thay)'), num: 1, render: x => F.n(x[2].removed || 0) },
          { label: L('비고', 'Ghi chú'), render: x => x[2].error ? ERP.chip('bad', x[2].error) : [x[2].unmapped ? ERP.chip('warn', L('코드 미매핑 ' + x[2].unmapped, 'Chưa khớp mã ' + x[2].unmapped)) : null, x[2].skipped ? ERP.chip('warn', L('건너뜀 ' + x[2].skipped, 'Bỏ qua ' + x[2].skipped)) : null, x[2].missing ? ERP.chip('warn', L('파일에 없음(숨김 후보) ' + x[2].missing, 'Không có trong file ' + x[2].missing)) : null, x[2].conv ? ERP.chip('info', L('환산 비율 ' + x[2].conv, 'Quy đổi ' + x[2].conv)) : null] }], log)));
      ERP.toast(L('엑셀 데이터를 반영했습니다', 'Đã áp dụng dữ liệu Excel'), 'ok');
    }
    host.append(h('h3', { style: { marginTop: 0 } }, L('자료 올리기 안내', 'Hướng dẫn tải dữ liệu')), guide, drop, out);
    if (st.jobs.length) show();
    host.append(h('div', { class: 'toolbar', style: { marginTop: '16px' } },
      h('button', { class: 'btn', onclick: () => ERP.ecount.txTemplate() }, L('수불 양식 받기', 'Tải mẫu nhập xuất')), h('button', { class: 'btn', onclick: () => XL.dailyTemplate() }, L('일보 양식 받기', 'Tải mẫu báo cáo ngày')),
      h('button', { class: 'btn', onclick: () => XL.template() }, L('전체 표 양식(템플릿) 받기', 'Tải mẫu tất cả bảng')),
      h('button', { class: 'btn', onclick: () => XL.exportAll() }, L('전체 데이터 엑셀로 내보내기', 'Xuất toàn bộ ra Excel'))));
  }

  // ---------------- Google ----------------
  const G = () => ({ url: DB.setting('gUrl', ''), token: DB.setting('gToken', '') });
  async function gcall(body) {
    const g = G(); if (!g.url) throw new Error(L('Apps Script URL 을 입력하세요', 'Hãy nhập URL Apps Script'));
    const payload = Object.assign({ token: g.token }, body);
    let r;
    if (DB.mode === 'server') r = await fetch('/api/gproxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: g.url, body: JSON.stringify(payload) }) });
    else r = await fetch(g.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    const j = await r.json(); if (!j.ok) throw new Error(j.error || 'error'); return j;
  }
  ERP.gcall = gcall;   // 15차: 휴대폰 요약 보내기 (mobile.js)
  const CHUNK = 2000;
  async function gpush(names, prog) {
    for (const n of names) {
      const S = ERP.TABLES[n]; const cols = S.cols.map(c => c.k); const rows = DB.rows(n); prog(n, 0, rows.length);
      for (let i = 0; i === 0 || i < rows.length; i += CHUNK) {
        const part = rows.slice(i, i + CHUNK).map(r => cols.map(k => r[k] === undefined ? '' : r[k]));
        await gcall({ action: 'put', table: n, cols, types: S.cols.map(c => c.t), rows: part, first: i === 0 }); prog(n, Math.min(i + CHUNK, rows.length), rows.length);
        if (!rows.length) break;
      }
    }
  }
  async function gpull(names, prog) {
    for (const n of names) {
      const S = ERP.TABLES[n]; const types = {}; S.cols.forEach(c => { types[c.k] = c.t; });
      let off = 0, total = 1, all = []; prog(n, 0, 0);
      while (off < total) {
        const j = await gcall({ action: 'get', table: n, offset: off, limit: 2000 }); total = j.total; if (!j.rows.length) break;
        j.rows.forEach(v => { const o = {}; j.cols.forEach((k, i) => { if (types[k] === undefined) return; let x = v[i]; if (x === null || x === '') return; if (types[k] === 'n') { x = Number(x); if (isNaN(x)) return; } else if (typeof x !== 'string' && types[k] !== 'b') x = String(x); o[k] = x; }); if (Object.keys(o).length) all.push(o); });
        off += j.rows.length; prog(n, off, total);
      }
      if (total > 0 || all.length) DB.replace(n, all);
    }
  }
  function googleTab(host) {
    const g = G(); const url = h('input', { class: 'inp', value: g.url, placeholder: 'https://script.google.com/macros/s/…/exec', style: { width: '100%' } });
    const tok = h('input', { class: 'inp', type: 'password', value: g.token, style: { width: '260px' } });
    const log = h('pre', { class: 'help', style: { background: '#F6F8FA', padding: '10px', borderRadius: '8px', minHeight: '60px', maxHeight: '220px', overflow: 'auto', whiteSpace: 'pre-wrap' } });
    const say = (s) => { log.textContent += s + '\n'; log.scrollTop = log.scrollHeight; };
    const save = () => { DB.setSetting('gUrl', url.value.trim()); DB.setSetting('gToken', tok.value); };
    const names = () => Array.from(host.querySelectorAll('input[data-t]')).filter(x => x.checked).map(x => x.dataset.t);
    const busy = (b, fn) => async () => { save(); b.disabled = true; try { await fn(); } catch (e) { say('✗ ' + e.message); ERP.toast(e.message, 'bad'); } b.disabled = false; };
    const prog = (n, a, b) => say(`${n}: ${a}/${b}`);
    const bTest = h('button', { class: 'btn' }, L('연결 테스트', 'Kiểm tra kết nối'));
    const bPush = h('button', { class: 'btn primary' }, L('↑ 구글 시트로 올리기', '↑ Đẩy lên Google Sheet'));
    const bPull = h('button', { class: 'btn' }, L('↓ 구글 시트에서 가져오기', '↓ Lấy về từ Google Sheet'));
    const bSnap = h('button', { class: 'btn' }, L('드라이브에 백업 복사본', 'Sao lưu sang Drive'));
    // Code.gs 2판부터: 글자 · 날짜 열을 텍스트 형식으로 써서 0 으로 시작하는 코드 · 523034E200 같은 코드가 숫자로 바뀌지 않는다
    const oldScript = () => say(L('⚠ 구글 Apps Script 가 옛 버전입니다. 설치 폴더의 google/Code.gs 를 다시 붙여넣고 "배포 관리 → 새 버전"으로 배포하세요 (코드 · 날짜가 숫자로 바뀌는 문제 수정).', '⚠ Apps Script là bản cũ. Hãy dán lại google/Code.gs và triển khai phiên bản mới (sửa lỗi mã bị đổi thành số).'));
    const noBackup = () => say(L('ⓘ 구글 드라이브 자동 백업을 쓰려면 google/Code.gs 3판을 다시 붙여넣고 새 버전으로 배포하세요.', 'ⓘ Muốn sao lưu tự động lên Google Drive, hãy dán lại google/Code.gs bản 3 và triển khai phiên bản mới.'));
    const noMobile = () => say(L('ⓘ 휴대폰 보기(설정 → 휴대폰으로 보기)를 쓰려면 google/Code.gs 4판을 다시 붙여넣고 새 버전으로 배포하세요.', 'ⓘ Muốn xem trên điện thoại, hãy dán lại google/Code.gs bản 4 và triển khai phiên bản mới.'));
    bTest.onclick = busy(bTest, async () => { const j = await gcall({ action: 'ping' }); say('✓ ' + j.sheet + ' ' + j.url); if (!(j.ver >= 2)) oldScript(); else if (!(j.ver >= 3)) noBackup(); else if (!(j.ver >= 4)) noMobile(); });
    bPush.onclick = busy(bPush, async () => { const n = names(); if (!n.length) return; const pj = await gcall({ action: 'ping' }); if (!(pj.ver >= 2)) oldScript(); say(L('업로드 시작', 'Bắt đầu đẩy')); await gpush(n, prog); say('✓ ' + L('완료', 'Xong')); });
    bPull.onclick = busy(bPull, async () => { const n = names(); if (!n.length) return; if (!(await ERP.confirm(L('선택한 표의 현재 데이터를 구글 시트 내용으로 교체합니다. 계속할까요?', 'Dữ liệu các bảng đã chọn sẽ bị thay bằng nội dung Google Sheet. Tiếp tục?')))) return; await gpull(n, prog); say('✓ ' + L('완료', 'Xong')); ERP.toast(L('구글 시트 데이터를 가져왔습니다', 'Đã lấy dữ liệu từ Google Sheet'), 'ok'); });
    bSnap.onclick = busy(bSnap, async () => { const j = await gcall({ action: 'snapshot' }); say('✓ Drive: ' + j.name + ' ' + j.url); });
    host.append(h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h3', L('구글 시트 · 드라이브 연동', 'Kết nối Google Sheet · Drive')),
        h('p', { class: 'help' }, L('구글 시트가 공유 DB 역할을 하고, 드라이브에는 백업 복사본이 저장됩니다. 설정: ① 새 구글 시트 → 확장 프로그램 → Apps Script → 설치 폴더의 google/Code.gs 붙여넣기 ② TOKEN 변경 ③ 웹 앱으로 배포(실행: 나 / 액세스: 모든 사용자) ④ URL·TOKEN 입력.', 'Google Sheet là CSDL dùng chung, Drive lưu bản sao lưu. Cài đặt: ① tạo Sheet → Apps Script → dán google/Code.gs ② đổi TOKEN ③ triển khai ứng dụng web (Thực thi: tôi / Truy cập: mọi người) ④ nhập URL và TOKEN.')),
        h('label', { class: 'field' }, h('span', 'Apps Script URL'), url), h('label', { class: 'field' }, h('span', 'TOKEN'), tok),
        h('div', { class: 'toolbar' }, bTest, h('button', { class: 'btn', onclick: save }, L('저장', 'Lưu'))),
        DB.mode !== 'server' ? h('p', { class: 'help' }, L('※ 브라우저 테스트 모드에서는 Apps Script 의 CORS 제약으로 실패할 수 있습니다. 설치 프로그램(PC 서버 모드)에서는 서버가 중계하여 정상 동작합니다.', '※ Ở chế độ trình duyệt có thể bị chặn CORS. Bản cài đặt trên PC sẽ chuyển tiếp qua máy chủ nội bộ nên hoạt động bình thường.')) : null),
      h('div', { class: 'card' }, h('h3', L('동기화할 표', 'Bảng cần đồng bộ')),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: '6px' } }, Object.keys(ERP.TABLES).map(n => h('label', { class: 'nowrap' }, h('input', { type: 'checkbox', 'data-t': n, checked: true }), ' ', ERP.tableLabel(n), h('small', { class: 'muted' }, ' (' + F.n(DB.rows(n).length) + ')')))),
        h('div', { class: 'toolbar', style: { marginTop: '12px' } }, bPush, bPull, bSnap), log)));
  }

  // ---------------- backup ----------------
  function backupTab(host) {
    // .json.gz = 구글 드라이브 자동 백업 압축본 (9차)
    const readText = (f) => /\.gz$/i.test(f.name) ? new Response(f.stream().pipeThrough(new DecompressionStream('gzip'))).text() : f.text();
    const fi = h('input', { type: 'file', accept: '.json,.gz', style: { display: 'none' }, onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { const o = JSON.parse(await readText(f)); if (!o.tables) throw new Error('invalid'); if (!(await ERP.confirm(L('현재 데이터를 백업 파일 내용으로 교체합니다. 계속할까요?', 'Dữ liệu hiện tại sẽ bị thay bằng file sao lưu. Tiếp tục?')))) return; await DB.restore(o); ERP.toast(L('복원했습니다', 'Đã khôi phục'), 'ok'); ERP.render(); } catch (err) { ERP.toast(L('올바른 백업 파일이 아닙니다', 'File sao lưu không hợp lệ'), 'bad'); } } });
    host.append(h('div', { class: 'card' }, h('h3', L('JSON 백업 / 복원', 'Sao lưu / khôi phục JSON')),
      h('p', { class: 'help' }, L('모든 표를 하나의 파일로 저장합니다. 설치형은 데이터 폴더에 매일 자동 백업(14일 보관)도 만들어집니다. PC 가 고장 나도 남도록 설정 → "사내망 접속 · 자동 백업" 에서 USB · NAS · 구글 드라이브에 매일 자동 백업을 켜세요. 복원은 .json 과 구글 드라이브의 .json.gz 를 모두 받습니다.', 'Lưu toàn bộ bảng vào một file. Bản cài đặt tự sao lưu hằng ngày (giữ 14 ngày) trong thư mục dữ liệu. Để không mất dữ liệu khi hỏng máy, hãy bật sao lưu tự động hằng ngày ra USB · NAS · Google Drive ở Cài đặt → "Mạng nội bộ · Sao lưu tự động". Khôi phục nhận cả .json và .json.gz từ Google Drive.')),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onclick: () => ERP.download('ERP_backup_' + F.today() + '.json', new Blob([JSON.stringify(DB.snapshot())], { type: 'application/json' })) }, L('백업 파일 내려받기', 'Tải file sao lưu')), h('button', { class: 'btn', onclick: () => fi.click() }, L('백업에서 복원', 'Khôi phục từ file')), fi)));
  }

  ERP.pages.data = { ko: '엑셀 · 구글 연동', vi: 'Excel · Google', render(root) {
    const cur = ERP.state.dataTab = ERP.state.dataTab || 'import';
    root.appendChild(ERP.pageHead(L('엑셀 · 구글 연동', 'Excel · Google'), L('엑셀 업로드로 데이터 반영 · 엑셀 내보내기 · 구글 시트/드라이브 동기화 · 백업', 'Tải Excel để áp dụng dữ liệu · xuất Excel · đồng bộ Google Sheet/Drive · sao lưu')));
    const host = h('div', { class: 'card' });
    root.append(ERP.tabs([{ id: 'import', label: L('엑셀 업로드', 'Tải Excel') }, { id: 'google', label: L('구글 시트 · 드라이브', 'Google Sheet · Drive') }, { id: 'backup', label: L('백업 / 복원', 'Sao lưu / Khôi phục') }], cur, (id) => { ERP.state.dataTab = id; ERP.render(); }), host);
    ({ import: importTab, google: googleTab, backup: backupTab })[cur](host);
  } };

  // ---------------- settings ----------------
  ERP.pages.settings = { ko: '설정', vi: 'Cài đặt', render(root) {
    root.appendChild(ERP.pageHead(L('설정', 'Cài đặt'), L('언어 · 기준값 · 데이터 초기화 · 시스템 정보', 'Ngôn ngữ · ngưỡng · khôi phục dữ liệu · thông tin hệ thống')));
    const num = (k, d, step) => h('input', { class: 'inp', type: 'number', step: step || '0.1', value: DB.setting(k, d), style: { width: '120px' }, onchange: (e) => { DB.setSetting(k, Number(e.target.value)); ERP.toast(L('저장됨', 'Đã lưu'), 'ok'); } });
    const info = h('div', { class: 'help' }, '…');
    const lan = h('div');
    if (DB.mode === 'server') fetch('/api/info').then(r => r.json()).then(i => { info.textContent = L('데이터 폴더: ', 'Thư mục dữ liệu: ') + i.dataDir + '   ·   ' + L('포트 ', 'Cổng ') + i.port; if (i.lan && i.lan.length) lan.append(h('p', { class: 'help' }, L('같은 네트워크의 다른 PC 접속 주소: ', 'Địa chỉ cho máy khác trong mạng LAN: '), i.lan.join('  '))); }).catch(() => { info.textContent = ''; });
    else info.textContent = L('브라우저 저장 모드: 이 브라우저(IndexedDB)에만 저장됩니다. 실제 운영은 설치 프로그램을 사용하세요.', 'Chế độ trình duyệt: chỉ lưu trong trình duyệt này. Dùng bản cài đặt cho vận hành thực tế.');
    function stockCard() {
      const od = ERP.inv.openDates(); const n = ERP.inv.opening().n;
      const sel = h('select', { class: 'inp', onchange: (e) => { DB.setSetting('prodPost', e.target.value); ERP.toast(L('저장됨', 'Đã lưu'), 'ok'); } }, ERP.inv.PROD_MODES().map(o => h('option', { value: o.v, selected: ERP.inv.prodMode() === o.v }, o.label)));
      const samples = SAMPLE_TABLES.filter(t => ERP.isSample(t));
      return h('div', { class: 'card' }, h('h3', L('재고 · 생산 반영', 'Tồn kho · cập nhật sản xuất')),
        h('div', { class: 'field' }, h('span', L('생산일보 → 재고 반영 방식', 'Báo cáo SX → cập nhật tồn')), sel),
        h('p', { class: 'help' }, L('기본은 "생산량 입고 + BOM 현장 부품 차감"입니다. BOM 으로 차감하는 것은 현장 재고(반제품 · 완제품)뿐이고, 원부자재(원재료 · 부자재 · 소모품)는 차감하지 않습니다. BOM이 없는 품목은 입고만 되고 수불 내역에 경고가 나옵니다. 일보에서 매번 다시 계산하므로 같은 일보를 다시 올려도 중복되지 않습니다.', 'Mặc định: nhập sản lượng + trừ linh kiện hiện trường theo BOM. Không trừ NVL. Mã chưa có BOM chỉ được nhập và có cảnh báo. Tính lại từ báo cáo mỗi lần nên không bị trùng.')),
        h('dl', { class: 'kv' }, h('dt', L('기초재고 · 창고', 'Tồn đầu · Kho')), h('dd', od.WH ? od.WH + ' · ' + F.n(n.WH) + L('행', ' dòng') : '–'), h('dt', L('기초재고 · 공장', 'Tồn đầu · Xưởng')), h('dd', od.FAC ? od.FAC + ' · ' + F.n(n.FAC) + L('행', ' dòng') : '–'),
          h('dt', L('현장 실사 (공정 중)', 'Kiểm kê hiện trường')), h('dd', od.FLOOR ? od.FLOOR + ' · ' + F.n(n.FLOOR) + L('행', ' dòng') : '–')),
        h('p', { class: 'help' }, L('기초재고를 다시 잡으려면 시작일에 ECOUNT 재고현황을 내려받아 엑셀 업로드에서 "기초재고로 설정"으로 올리세요.', 'Để đặt lại tồn đầu: tải "Tồn kho" ECOUNT vào ngày bắt đầu và chọn "Đặt làm tồn đầu kỳ".')),
        h('div', { class: 'toolbar' }, h('button', { class: 'btn', disabled: !samples.length, onclick: () => sampleDialog(samples) }, L('예시 데이터 한 번에 삭제', 'Xóa toàn bộ dữ liệu mẫu') + (samples.length ? ' (' + samples.length + ')' : ''))));
    }
    function sampleDialog(list) {
      const cbs = new Map();
      ERP.modal({ title: L('예시 데이터 삭제', 'Xóa dữ liệu mẫu'), width: '560px', body: h('div', h('p', { class: 'help' }, L('예전 샘플(첨부 엑셀)에서 온 예시 행만 지웁니다. 새로 올리거나 직접 입력·수정한 행, ECOUNT에서 가져온 품목·창고·기초재고는 그대로 둡니다.', 'Chỉ xóa các dòng mẫu cũ. Giữ nguyên dòng đã tải lên / nhập / sửa và danh mục, kho, tồn đầu ECOUNT.')),
        list.map(t => { const used = BOM_SRC.includes(t) && ERP.inv.prodMode() === 'in_bom' && !DB.rows('bom_lines').length; const cb = h('input', { type: 'checkbox', checked: !used }); cbs.set(t, cb); const n = ERP.sampleCount(t), all = DB.rows(t).length;
          return h('label', { style: { display: 'block', margin: '4px 0' } }, cb, ' ', ERP.tableLabel(t), h('small', { class: 'muted' }, ' (' + L('예시 ', 'mẫu ') + F.n(n) + (n < all ? L(' / 전체 ', ' / tổng ') + F.n(all) : '') + ')'), used ? h('small', { class: 'warn-text' }, L('  · BOM 차감에 사용 중', '  · đang dùng trừ vật tư BOM')) : null); }),
        list.some(t => BOM_SRC.includes(t)) && ERP.inv.prodMode() === 'in_bom' && !DB.rows('bom_lines').length ? h('p', { class: 'help' }, L('"BOM 차감에 사용 중"인 표는 기본으로 남겨 둡니다. 실제 BOM을 제품 · BOM · 배합 → BOM 구성에 넣은 뒤 지우세요. 지금 지우면 생산일보는 입고만 반영됩니다.', 'Các bảng "đang dùng trừ vật tư BOM" được giữ lại mặc định. Hãy xóa sau khi nhập BOM thật (Sản phẩm · BOM → Cấu thành BOM). Nếu xóa bây giờ, báo cáo SX chỉ được nhập kho.')) : null),
        buttons: [{ label: L('취소', 'Hủy') }, { label: L('삭제', 'Xóa'), kind: 'danger', onClick: async () => {
          const pick = list.filter(t => cbs.get(t).checked); if (!pick.length) return false;
          let gone = 0; pick.forEach(t => { const keep = DB.rows(t).filter(r => !r._ex); gone += DB.rows(t).length - keep.length; DB.replace(t, keep); if (DB.meta.sample) DB.meta.sample[t] = false; }); DB.saveMeta();
          DB.add('uploads', { at: F.now(), kind: 'sample_delete', note: L('예시 데이터 삭제: ', 'Xóa dữ liệu mẫu: ') + pick.join(', '), rows: gone, removed: gone });
          ERP.toast(L('예시 데이터를 지웠습니다', 'Đã xóa dữ liệu mẫu'), 'ok'); ERP.render();
        } }] });
    }
    // 9차: 사내망 PIN · PC 밖 자동 백업 (설치형 서버 모드). 바꾸기는 ERP 가 실행 중인 PC 에서만 (서버도 막음)
    function lanCard() {
      const box = h('div', { class: 'card', id: 'lanCard' }, h('h3', L('사내망 접속 · 자동 백업', 'Mạng nội bộ · Sao lưu tự động')), h('p', { class: 'help' }, '…'));
      Promise.all([fetch('/api/info').then(r => r.json()), fetch('/api/backup').then(r => r.json())]).then(([i, b]) => fill(i, b)).catch(e => { box.lastChild.textContent = String(e.message || e); });
      const pad = (x) => String(x).padStart(2, '0');
      const when = (s) => { if (!s) return '–'; const d = new Date(s); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
      const mb = (n) => n ? (n / 1048576).toFixed(1) + ' MB' : '';
      const put = (url, body) => fetch(url, { method: url.endsWith('/run') ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
      function fill(i, b) {
        const own = !!i.loopback;
        const pin = h('input', { class: 'inp', type: 'password', inputmode: 'numeric', maxlength: '12', autocomplete: 'new-password', placeholder: L('숫자 4~12자리', '4~12 chữ số'), style: { width: '150px' } });
        const setPin = async (v) => { try { await put('/api/lan/pin', { pin: v }); ERP.toast(v ? L('PIN 을 저장했습니다. 다른 PC 는 새 PIN 을 넣어야 합니다.', 'Đã lưu mã PIN. Máy khác phải nhập mã PIN mới.') : L('PIN 을 지웠습니다. 다른 PC 에서는 들어올 수 없습니다.', 'Đã xóa mã PIN. Máy khác không vào được.'), 'ok'); } catch (e) { ERP.toast(e.message, 'bad'); } ERP.refresh(); };
        const pinRow = own
          ? h('div', { class: 'toolbar' }, ERP.chip(i.hasPin ? 'ok' : 'warn', i.hasPin ? L('정해짐', 'Đã đặt') : L('없음', 'Chưa có')), pin,
            h('button', { class: 'btn', onclick: () => { const v = pin.value.trim(); if (!/^\d{4,12}$/.test(v)) { ERP.toast(L('PIN 은 숫자 4~12자리입니다', 'Mã PIN gồm 4~12 chữ số'), 'warn'); return; } setPin(v); } }, i.hasPin ? L('PIN 바꾸기', 'Đổi PIN') : L('PIN 정하기', 'Đặt PIN')),
            i.hasPin ? h('button', { class: 'btn', onclick: async () => { if (await ERP.confirm(L('PIN 을 지우면 다른 PC 에서 들어올 수 없습니다. 지울까요?', 'Xóa mã PIN thì máy khác không vào được. Xóa?'))) setPin(''); } }, L('지우기', 'Xóa')) : null)
          : h('div', { class: 'toolbar' }, ERP.chip('ok', L('PIN 으로 들어옴', 'Đã vào bằng PIN')), h('button', { class: 'btn', onclick: () => DB.logout() }, L('이 브라우저 로그아웃', 'Đăng xuất trình duyệt này')));
        const dir = h('input', { class: 'inp', value: b.dir || '', disabled: !own, placeholder: L('예: E:\\ERP백업 · \\\\NAS\\공유\\ERP · 구글 드라이브 폴더', 'VD: E:\\SaoLuuERP · \\\\NAS\\share\\ERP · thư mục Google Drive'), style: { flex: '1 1 260px', minWidth: '220px' } });
        const keep = h('input', { class: 'inp', type: 'number', min: '3', max: '365', value: b.keep || 30, disabled: !own, style: { width: '80px' } });
        const gchk = h('input', { type: 'checkbox', checked: !!b.google, disabled: !own || (!DB.meta.gUrl && !b.google) });
        const cfgNow = () => ({ dir: dir.value.trim(), keep: Number(keep.value) || 30, google: gchk.checked });
        const same = () => (cfgNow().dir || null) === (b.dir || null) && cfgNow().keep === (b.keep || 30) && cfgNow().google === !!b.google;
        const saveCfg = async () => { try { await put('/api/backup', cfgNow()); ERP.toast(L('백업 설정을 저장했습니다', 'Đã lưu cài đặt sao lưu'), 'ok'); return true; } catch (e) { ERP.toast(L('백업 설정 실패: ', 'Lỗi cài đặt sao lưu: ') + e.message, 'bad'); return false; } };
        const runNow = async (ev) => {
          const btn = ev.currentTarget; if (own && !same() && !(await saveCfg())) return;
          btn.disabled = true; btn.textContent = L('백업 중…', 'Đang sao lưu…');
          try { const j = await put('/api/backup/run', {}); if (j.error) ERP.toast(L('백업 실패: ', 'Sao lưu thất bại: ') + j.error, 'bad'); else ERP.toast(L('백업했습니다', 'Đã sao lưu') + (j.file ? ': ' + j.file : '') + (j.drive ? ' · Google Drive' : ''), 'ok'); } catch (e) { ERP.toast(e.message, 'bad'); }
          ERP.refresh();
        };
        const on = !!(b.dir || b.google); const failed = b.lastError && (!b.lastOk || b.lastTry > b.lastOk);
        box.replaceChildren(h('h3', L('사내망 접속 · 자동 백업', 'Mạng nội bộ · Sao lưu tự động')),
          h('div', { class: 'field' }, h('span', L('사내망 접속', 'Truy cập mạng nội bộ')), h('div', ERP.chip(i.lanOn ? 'ok' : 'neutral', i.lanOn ? L('켜짐', 'Bật') : L('꺼짐', 'Tắt')), ' ',
            h('small', { class: 'muted' }, i.lanOn ? (i.lan || []).join('  ') : L('켜기: 프로그램 메뉴 ERP → 사내망 접속 켜기', 'Bật: menu ERP → Bật truy cập LAN')))),
          h('div', { class: 'field' }, h('span', L('사내망 PIN', 'Mã PIN mạng nội bộ')), pinRow),
          h('p', { class: 'help' }, L('다른 PC 의 브라우저는 처음 한 번 PIN 을 넣으면 7일 동안 기억합니다. ERP 가 실행 중인 PC 는 PIN 없이 씁니다. PIN 을 바꾸면 다른 PC 는 다시 넣어야 합니다.', 'Trình duyệt máy khác nhập PIN một lần và được nhớ 7 ngày. Máy đang chạy ERP không cần PIN. Đổi PIN thì máy khác phải nhập lại.')),
          h('div', { class: 'field' }, h('span', L('매일 자동 백업 폴더', 'Thư mục sao lưu hằng ngày')), h('div', { class: 'toolbar' }, dir, h('label', { class: 'nowrap' }, L('보관 ', 'Giữ '), keep, L(' 일', ' ngày')))),
          h('label', { class: 'nowrap', style: { display: 'block', margin: '6px 0' } }, gchk, ' ', L('구글 드라이브에도 매일 압축본 저장 (구글 연동 설정 · Code.gs 3판 필요)', 'Lưu thêm bản nén lên Google Drive mỗi ngày (cần kết nối Google · Code.gs bản 3)')),
          h('p', { class: 'help' }, on
            ? [L('마지막 성공: ', 'Lần thành công cuối: ') + when(b.lastOk), b.lastFile ? ' · ' + b.lastFile : '', b.lastSize ? ' · ' + mb(b.lastSize) : '', b.lastDrive ? ' · Google Drive' : '',
              failed ? h('div', { class: 'warn-text' }, L('마지막 시도 실패 (', 'Lần thử cuối thất bại (') + when(b.lastTry) + '): ' + b.lastError) : null]
            : L('아직 백업 위치가 없습니다. PC 가 고장 나도 자료가 남도록 USB · NAS · 구글 드라이브 동기화 폴더를 지정하세요. ERP 가 켜져 있는 동안 하루에 한 번 저장합니다.', 'Chưa có nơi sao lưu. Hãy chọn USB · NAS · thư mục đồng bộ Google Drive để dữ liệu không mất khi hỏng máy. ERP sao lưu mỗi ngày một lần khi đang chạy.')),
          own ? h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: async () => { if (await saveCfg()) ERP.refresh(); } }, L('백업 설정 저장', 'Lưu cài đặt sao lưu')), h('button', { class: 'btn primary', disabled: !on && !cfgNow().dir, onclick: runNow }, L('지금 백업', 'Sao lưu ngay')))
            : h('p', { class: 'help' }, L('백업 설정은 ERP 가 실행 중인 PC 에서 바꿉니다.', 'Cài đặt sao lưu được đổi trên máy đang chạy ERP.')));
        dir.addEventListener('input', () => { const bt = box.querySelector('.btn.primary'); if (bt) bt.disabled = !on && !dir.value.trim(); });
      }
      return box;
    }
    // 15차: 프로그램 자동 업데이트 (설치형). 확인 · 설치 · 켜고 끄기는 ERP 가 실행 중인 PC 에서만 (서버도 막음)
    function updateCard() {
      const box = h('div', { class: 'card', id: 'updCard' }, h('h3', L('프로그램 업데이트', 'Cập nhật chương trình')), h('p', { class: 'help' }, '…'));
      const pad = (x) => String(x).padStart(2, '0');
      const when = (s) => { if (!s) return '–'; const d = new Date(s); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
      const call = (url, method, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
      let t = null, shown = false;
      const load = () => ERP.updateStatus().then(fill).catch(e => { box.lastChild.textContent = String(e.message || e); });
      function fill(s) {
        clearTimeout(t); if (shown && !box.isConnected) return; shown = true;   // 다른 화면으로 가면 그만 묻는다
        const title = h('h3', L('프로그램 업데이트', 'Cập nhật chương trình'));
        if (!s.desktop) { box.replaceChildren(title, h('p', { class: 'help' }, L('자동 업데이트는 PC 설치형 ERP 에만 있습니다 (지금은 서버 · 브라우저로 실행 중).', 'Tự động cập nhật chỉ có ở bản cài đặt trên PC (đang chạy bằng máy chủ · trình duyệt).'))); return; }
        const busy = s.state === 'checking' || s.state === 'downloading'; if (busy) t = setTimeout(load, 2000);
        const pct = Math.round((s.progress || 0) * 100), rv = s.ready ? s.ready.version : '';
        const chip = { idle: ['neutral', L('아직 확인 전', 'Chưa kiểm tra')], checking: ['info', L('확인 중…', 'Đang kiểm tra…')],
          downloading: ['info', L('새 버전 ' + (s.latest || '') + ' 받는 중 ' + pct + '%', 'Đang tải bản ' + (s.latest || '') + ' ' + pct + '%')],
          ready: ['info', L('새 버전 ' + rv + ' 준비됨', 'Bản mới ' + rv + ' đã sẵn sàng')], latest: ['ok', L('최신 버전', 'Bản mới nhất')],
          none: ['neutral', L('업데이트 정보 없음', 'Chưa có thông tin cập nhật')], error: ['bad', L('오류', 'Lỗi')], installing: ['info', L('설치 시작…', 'Đang bắt đầu cài…')] }[s.state] || ['neutral', s.state];
        const own = !!s.local;
        const auto = h('input', { type: 'checkbox', checked: !!s.auto, disabled: !own, onchange: async (e) => {
          try { fill(await call('/api/update', 'PUT', { auto: e.target.checked })); ERP.toast(e.target.checked ? L('자동 업데이트를 켰습니다', 'Đã bật tự động cập nhật') : L('자동 업데이트를 껐습니다 — [지금 확인] 으로만 받습니다', 'Đã tắt tự động cập nhật'), 'ok'); } catch (x) { ERP.toast(x.message, 'bad'); load(); } } });
        box.replaceChildren(); ERP.put(box, title,
          h('dl', { class: 'kv' }, h('dt', L('지금 버전', 'Phiên bản hiện tại')), h('dd', s.current),
            h('dt', L('상태', 'Trạng thái')), h('dd', ERP.chip(chip[0], chip[1])),
            h('dt', L('마지막 확인', 'Kiểm tra lần cuối')), h('dd', when(s.checkedAt)),
            h('dt', L('마지막 업데이트', 'Cập nhật lần cuối')), h('dd', s.last ? (s.last.from || '?') + ' → ' + s.last.to + ' · ' + when(s.last.at) : '–')),
          s.state === 'error' && s.error ? h('p', { class: 'warn-text' }, s.error) : null,
          s.state === 'none' ? h('p', { class: 'help' }, L('아직 GitHub 에 새 버전(Release)이 없습니다. 생기면 저절로 받습니다.', 'Chưa có bản phát hành trên GitHub. Khi có sẽ tự tải.')) : null,
          h('label', { class: 'nowrap', style: { display: 'block', margin: '8px 0' } }, auto, ' ', L('자동 업데이트 (새 버전을 받아 두었다가 다음에 켤 때 설치)', 'Tự động cập nhật (tải sẵn, cài khi mở lần sau)')),
          own ? h('div', { class: 'toolbar' },
            h('button', { class: 'btn', disabled: busy, onclick: async (e) => { e.currentTarget.disabled = true; try { fill(await call('/api/update/check', 'POST')); } catch (x) { ERP.toast(x.message, 'bad'); load(); } } }, L('지금 확인', 'Kiểm tra ngay')),
            s.ready && s.canInstall ? h('button', { class: 'btn primary', onclick: () => ERP.updateNow(rv) }, L('지금 업데이트', 'Cập nhật ngay') + ' (' + rv + ')') : null)
            : h('p', { class: 'help' }, L('업데이트는 ERP 가 실행 중인 PC 에서 합니다.', 'Cập nhật trên máy đang chạy ERP.')),
          h('p', { class: 'help' }, L('새 버전이 나오면 GitHub 에서 받아 두었다가 다음에 ERP 를 켤 때 설치합니다 — 진행 막대가 잠깐 보이고 새 버전으로 켜집니다. 일하는 중에는 저절로 다시 시작하지 않습니다. 설치 전에 데이터 폴더를 따로 복사해 둡니다 (데이터 폴더 옆 update_backup, 최근 5번).',
            'Khi có bản mới, ERP tải sẵn từ GitHub và cài khi mở lần sau — thấy thanh tiến trình rồi mở bản mới. Không tự khởi động lại khi đang làm việc. Trước khi cài, thư mục dữ liệu được sao chép (update_backup, 5 lần gần nhất).')));
      }
      load();
      return box;
    }
    root.append(h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h3', L('일반', 'Chung')),
        h('div', { class: 'field' }, h('span', L('언어', 'Ngôn ngữ')), h('div', { class: 'toolbar' }, h('button', { class: 'btn' + (ERP.lang === 'ko' ? ' primary' : ''), onclick: () => ERP.setLang('ko') }, '한국어'), h('button', { class: 'btn' + (ERP.lang === 'vi' ? ' primary' : ''), onclick: () => ERP.setLang('vi') }, 'Tiếng Việt'))),
        // 엑셀에서 붙여넣은 숫자의 형식 (35.000 이 3만 5천인지 35인지) — 자동은 이 PC 의 숫자 형식을 따른다
        h('div', { class: 'field' }, h('span', L('붙여넣기 숫자 형식', 'Định dạng số khi dán')), h('select', { class: 'inp', onchange: (e) => { DB.setSetting('numFmt', e.target.value); ERP.toast(L('저장됨', 'Đã lưu'), 'ok'); } },
          [['auto', L('자동 (이 PC 형식: ', 'Tự động (máy này: ') + (F.decimalSep() === ',' ? '1.234,5' : '1,234.5') + ')'], ['dot', '1,234.5 (' + L('소수점 .', 'thập phân .') + ')'], ['comma', '1.234,5 (' + L('소수점 ,', 'thập phân ,') + ')']].map(o => h('option', { value: o[0], selected: DB.setting('numFmt', 'auto') === o[0] }, o[1]))),
          h('small', { class: 'muted' }, L('엑셀에서 복사한 수량이 1000 배로 작거나 크게 들어가면 여기서 바꾸세요.', 'Nếu số lượng dán từ Excel bị sai 1000 lần, hãy đổi ở đây.')))),
      h('div', { class: 'card' }, h('h3', L('데이터', 'Dữ liệu')), info, lan,
        h('div', { class: 'toolbar' },
          h('button', { class: 'btn', onclick: async () => { if (!(await ERP.confirm(L('현재 데이터를 지우고 샘플(첨부 엑셀) 데이터로 되돌립니다.', 'Xóa dữ liệu hiện tại và nạp lại dữ liệu mẫu (từ Excel đính kèm).')))) return; await DB.loadSeed(); ERP.toast(L('샘플 데이터로 초기화했습니다', 'Đã nạp lại dữ liệu mẫu'), 'ok'); ERP.render(); } }, L('샘플 데이터로 초기화', 'Nạp lại dữ liệu mẫu')),
          h('button', { class: 'btn danger', onclick: async () => { if (!(await ERP.confirm(L('모든 데이터를 삭제합니다 (빈 상태에서 엑셀로 새로 시작). 먼저 백업하세요.', 'Xóa TOÀN BỘ dữ liệu (bắt đầu mới từ Excel). Hãy sao lưu trước.')))) return; await DB.wipe(); ERP.toast(L('모두 삭제했습니다', 'Đã xóa hết'), 'ok'); ERP.render(); } }, L('전체 삭제 (빈 상태)', 'Xóa toàn bộ')))),
      stockCard(),
      DB.mode === 'server' ? lanCard() : null,
      DB.mode === 'server' ? updateCard() : null,
      DB.mode === 'server' ? ERP.phoneCard() : null,
      h('div', { class: 'card' }, h('h3', L('정보', 'Thông tin')), h('p', { class: 'help' }, 'ColorPencil ERP v' + ERP.v + ' · ' + L('색연필 제조 수주 · 생산 · 재고 · 원부자재 관리', 'Quản lý đơn hàng · sản xuất · kho · NVL ngành bút chì màu')),
        h('p', { class: 'help' }, L('마스터 데이터(품목·BOM·배합·거래처·설비·안전재고)는 화면에서 직접 수정하거나 엑셀로 업로드하여 언제든 변경할 수 있습니다.', 'Dữ liệu gốc (mã hàng, BOM, công thức, đối tác, máy, tồn an toàn) có thể sửa trực tiếp trên màn hình hoặc tải Excel bất kỳ lúc nào.')))));
  } };
})();
