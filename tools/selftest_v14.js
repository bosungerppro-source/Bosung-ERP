'use strict';
/* 14차(v1.9.0) 자동 시험: 창고 입출고장(BẢNG KÊ NHẬP XUẤT) → 원부자재 품목 · 거래처 · 기초재고 · 입출고, ECOUNT 재고현황으로 보완
   1 I 칸 나누기 (용도 · Lot · 색깔 · 비고) · 베트남어 품목명 → 한국어 · 2 두 파일 같이 올리기 (미리보기 · 보완 방식) ·
   3 품목 맞추기 (같은 코드 · 제품번호로 적은 카톤 → ECOUNT 카톤 · 새 품목 · 반제품 코드는 뺌 · 두 코드를 한 품목에 합치지 않음) ·
   4 재고 = 창고 기말 재고 (기초재고 = 기말 − 입고 + 출고, 마이너스면 0 + 조정) · ECOUNT 보완 (같은 품목은 창고 수량, 마이너스 0, 공정 중은 뺌) ·
   5 수불 칸 (업체코드 · 용도 · Lot · 색깔) · 6 다시 올려도 늘지 않음 · 7 화면 · 오류 없음
   사용:  npm run test:v14   (Playwright 필요: npm i -D playwright 또는 playwright-core + 설치된 Chrome/Edge) */
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
let pw; try { pw = require('playwright'); } catch (e) { try { pw = require('playwright-core'); } catch (e2) { console.error('Playwright가 필요합니다 / cần Playwright:  npm i -D playwright'); process.exit(2); } }
const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const serverMod = require(path.join(ROOT, 'server.js'));

let pass = 0, fail = 0; const failures = [];
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 700 ? s.slice(0, 700) + '…' : s; };
function ok(name, cond, detail) { if (cond) { pass++; return true; } fail++; const line = name + (detail !== undefined ? '  → ' + short(detail) : ''); failures.push(line); console.log('  ✗ ' + line); return false; }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
async function sec(t, fn) { console.log('\n■ ' + t); try { await fn(); } catch (e) { ok(t + ' — 예외', false, String((e && e.message) || e).split('\n')[0].slice(0, 300)); } }
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const serial = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };

/** 창고 입출고장 흉내 (회사 · 제목 · 머리글 2줄 · 열 번호 줄 · 자료). r = [날짜, 업체코드, 업체, F, G, H, I, J, 입고kg, 입고개, 출고kg, 출고개, 기말kg, 기말개] */
function ledgerBook(rows) {
  const head = [['Đơn vị: Cty TNHH BOSUNG VINA', null, null, 'BẢNG KÊ NHẬP XUẤT NGUYÊN - VẬT LIỆU NĂM '], ['Địa chỉ: Lô B'], [], [], [null, 'BẢNG KÊ NHẬP XUẤT'], [],
    ['Chứng từ', null, null, 'Thông tin đơn vị', null, 'Mã nguyên liệu', null, 'Tên nguyên liệu', 'Nội dung', 'Đơn\r\n vị', null, 'Nhập trong kỳ', null, 'Xuất trong kỳ', null, 'Tồn cuối kỳ'],
    ['Số chứng từ', 'Ngày chứng từ', 'Ngày\r\nnhập/ xuất', 'Mã ĐV', 'Doanh nghiệp', null, null, null, null, 'Kg', 'Ea', 'Kg', 'Ea', 'Kg', 'Ea', 'Kg', 'Ea'],
    ['01', '02', '03', '04', '05', '06', '17', '07', ' ', '09', '10', '11', '12', '13', '14', '15', '16']];
  const data = rows.map((r, i) => ['PNK-' + i, null, serial(r[0]), r[1], r[2], r[3], r[4], r[5], r[6], r[7], 1, r[8], r[9], r[10], r[11], r[12], r[13]]);
  const blanks = []; for (let i = 0; i < 70; i++) blanks.push([null, null, null, null, null, null, null, null, null, null, null, 0, null, 0]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(head.concat(data, blanks)), 'Nhập - xuất'); return wb;
}
function ecountBook(rows) {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['품목코드', 'ERP CODE', 'Mã XNK', '품목명[규격]', '단위', '재고수량', 'Số Set', 'Số PCS']].concat(rows)), '재고현황'); return wb;
}

(async () => {
  const dataDir = tmp('erp-v14-'); const xdir = tmp('erp-v14-x-');
  const S = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir, host: '127.0.0.1', port: 6900 + Math.floor(Math.random() * 300), backupDelay: 3600000 });
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 } });
  const A = await ctx.newPage(); A.on('pageerror', e => errors.push('pageerror: ' + e.message));
  A.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Failed to fetch/.test(m.text())) errors.push('console: ' + m.text()); });
  const ready = () => A.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 180000 });
  const ev = (fn, arg) => A.evaluate(fn, arg);
  await A.goto(S.url + '/#/data'); await ready();
  // 빈 상태 + 현장 실사 1줄 (현장 실사가 있으면 공정 중 품목은 ECOUNT 보완에서 뺀다)
  await ev(async () => { const DB = ERP.db; await DB.wipe();
    DB.replace('items', [ERP.inv.classify({ code: 'RM102', erp_code: 'WIP00-MINI-CRA-RM102', name: 'RED', unit: 'PCS', src: 'floor' })]);
    DB.replace('stock_open', [{ date: '2026-10-20', scope: 'FAC', code: 'RM102', qty: 5, grp: 'floor' }]); DB.meta.openDate = { FLOOR: '2026-10-20' }; await DB.saveMeta(); await DB.flush(); });

  const WH = [
    ['2026-01-05', 'DVT001', 'CTY ĐÔNG VIỆT TIẾN', 'R-100', 'R-100', 'Polypropylene', 'Nhập NVL dùng cho sx', 25, 100, 4, 0, 0, 140, 5.6],
    ['2026-02-01', 'NBIN', 'Bộ phận Ép nhựa', 'R-100', 'R-100', 'Polypropylene', 'Xuất NL dùng cho sx Lot E250713', 25, 0, 0, 40, 1.6, 140, 5.6],
    ['2026-02-03', 'GC01', 'CTY GIA CÔNG', 'R-100', 'R-100', 'Polypropylene', 'Xuất NL đi gia công 601442', 25, 0, 0, 20, 0.8, 140, 5.6],
    ['2026-01-06', 'DNV', 'CTY BAO BÌ ĐÔNG NAM VIỆT', '04-5225-0-005', 'R-430VN', 'CARTON GIFTABLES STORAGE SET', 'Nhập NVL dùng cho sx', 0.5, 150, 300, 0, 0, 135, 270],
    ['2026-03-01', 'DG', 'Bộ phận Đóng gói', '04-5225-0-005', 'R-430VN', 'CARTON GIFTABLES STORAGE SET', 'Xuất vật tư dùng cho sx', 0.5, 0, 0, 15, 30, 135, 270],
    ['2026-01-07', 'IN7', 'CTY CP IN SỐ 7', 'BK48', 'R-411VN', 'BĂNG KEO TRONG 48 MM', 'Nhập vật tư dùng cho sx', 0.05, 5, 100, 0, 0, 3, 60],
    ['2026-04-01', 'DG', 'Bộ phận Đóng gói', 'BK48', 'R-411VN', 'BĂNG KEO TRONG 48 MM', 'Xuất vật tư dùng cho sx 250728', 0.05, 0, 0, 2, 40, 3, 60],
    ['2026-01-08', 'GLO001', 'GLORY WORLD', 'R-302', 'R-301VN', 'Wrapping Paper 167x360', 'WHITE + 2 PALLET', 0.006, 6, 1000, 0, 0, 3.6, 600],
    ['2026-05-01', 'NBW', 'Bộ phận Quấn giấy', 'R-302', 'R-301VN', 'Wrapping Paper 167x360', 'RED', 0.006, 0, 0, 2.4, 400, 3.6, 600],
    ['2026-01-09', 'DNV', 'CTY BAO BÌ ĐÔNG NAM VIỆT', 'CT-NEG', 'R-430VN', 'CARTON - NEG', 'Nhập NVL dùng cho sx', 0.1, 5, 50, 0, 0, 0, 0],
    ['2026-06-01', 'DG', 'Bộ phận Đóng gói', 'CT-NEG', 'R-430VN', 'CARTON - NEG', 'Xuất vật tư dùng cho sx', 0.1, 0, 0, 1, 10, 0, 0],
    ['2026-01-10', 'YID001', 'CTY NHỰA YIDING', 'MH', 'R-200VN', 'MINI HOLDER', 'Nhập vật tư dùng cho sx', 0.001, 0, 500, 0, 0, 0, 500],
    ['2026-07-01', 'DG', 'Bộ phận Đóng gói', '68-7408-0-013', 'R-430VN', 'CARTON - US PENCIL 12', 'Xuất vật tư dùng cho sx', 0.2, 0, 0, 2, 10, 4, 20],
    ['2026-01-11', 'DNV', 'CTY BAO BÌ ĐÔNG NAM VIỆT', '68-7408-0-013', 'R-430VN', 'CARTON - US PENCIL 12', 'Nhập NVL dùng cho sx', 0.2, 6, 30, 0, 0, 4, 20],
    ['2026-01-12', 'DNV', 'CTY BAO BÌ ĐÔNG NAM VIỆT', '68-7408-0-813', 'R-430VN', '12CT PENCILS CARTON 013', 'Nhập NVL dùng cho sx', 0.2, 10, 50, 0, 0, 10, 50]];
  const EC = [
    ['R-100', 'RM-EP-PP-R-100', 'R-100', 'POLYPROPYLENE', 'kg', 999],
    ['04-5225-0-806', 'SM-CT-PEN-04-5225-0-806', 'R-430VN', 'CARTON 04-5225-0-005', 'PCS', 500],
    ['04-5225-0-005', 'FG-PEN-CRA-04-5225-0-005', '', '04-5225-0-005 GIFTABLE STORAGE SET', 'CT', -217, -2604, -65100],
    ['68-7408-0-813', 'SM-CT-PEN-68-7408-0-813', 'R-430VN', '12CT PENCILS CARTON 013', 'PCS', 77],
    ['MH', 'WIP03-MINI-HD-MH', 'R-200VN', 'MINI HOLDER', 'PCS', 1000],
    ['R-999', 'RM-WAX-WX-R-999', 'R-999', 'TEST WAX', 'kg', 50],
    ['SM-ONLY', 'SM-LB-MINI-SM-ONLY', 'R-411VN', 'NHÃN DÁN TEST', 'PCS', 7]];
  const fw = path.join(xdir, 'kho_nhap_xuat.xlsx'), fe = path.join(xdir, 'ecount_ton_kho.xlsx');
  XLSX.writeFile(ledgerBook(WH), fw); XLSX.writeFile(ecountBook(EC), fe);

  // ------------------------------------------------------------------------------------------
  await sec('1. I 칸 나누기 · 베트남어 품목명 → 한국어', async () => {
    const r = await ev(() => { const E = ERP.ecount; const sp = (t, i) => E.splitContent(t, i);
      return { a: sp('Xuất NL dùng cho sx Lot E250713', false), b: sp('Nhập NVL dùng cho sx', true), c: sp('Xuất vật tư dùng cho sx 250728', false), d: sp('WHITE + 2 PALLET', true),
        e: sp('LOGO-D/BLUE', false), f: sp('Xuất NL đi gia công 601442', false), g: sp('XUẤT GỬI HÀN QUỐC', false), h: sp('24 MINI', false), i: sp('Nhập vật tư gia công', true), j: sp('NHẬP LẠI', true),
        k: sp('Xuất vật tư dùng cho ', false), l: sp('GIẤY ĐÃ CẮT MÀU WHITE', false),
        vi: ['BĂNG KEO TRONG 48 MM', 'MÀNG CO POF 356', 'GLUE ( KEO DÁN HỘP 9800 )', '10CT PENCIL UK 26 - CDU TRAY (đáy)', 'Lò xo - Spring', 'Wrapping Paper 167x360', 'GIẤY LỤA 32.5*105CM'].map(n => E.viToKo(n)) }; });
    eq('원료 생산 투입 + Lot', r.a, { purpose: '생산 투입', lot: 'E250713' });
    eq('원부자재 생산용 입고 (비고 없음)', r.b, { purpose: '생산용 입고' });
    eq('자재 생산 투입 + 번호 = Lot', r.c, { purpose: '생산 투입', lot: '250728' });
    eq('색깔 + 팔레트', r.d, { color: 'WHITE', note: '팔레트 2' });
    eq('LOGO-D/BLUE 도 색깔', r.e.color, 'LOGO-D/BLUE');
    eq('외주 가공 출고 + 번호', r.f, { purpose: '외주 가공 출고', lot: '601442' });
    eq('한국 발송', r.g.purpose, '한국 발송');
    eq('정해진 문구가 아니면 비고에 원문', r.h, { note: '24 MINI' });
    eq('외주 가공 입고 · 재입고', [r.i.purpose, r.j.purpose], ['외주 가공 입고', '재입고']);
    eq('잘린 문구(dùng cho)도 생산 투입 · 비고 없음', r.k, { purpose: '생산 투입' });
    eq('"MÀU WHITE" → 색깔 WHITE + 원문 비고', [r.l.color, !!r.l.note], ['WHITE', true]);
    eq('베트남어 이름 → 한국어 (영어 이름은 그대로 = null)', r.vi, ['투명 테이프 48 MM', 'POF 수축 필름 356', 'GLUE ( 상자용 접착제 9800 )', '10CT PENCIL UK 26 - CDU TRAY (바닥)', '스프링 - Spring', null, '습자지 32.5*105CM']);
  });

  // ------------------------------------------------------------------------------------------
  await sec('2. 두 파일 같이 올리기 — 미리보기', async () => {
    await ev(() => { ERP.state.dataTab = 'import'; ERP.state.imp = { jobs: [] }; ERP.goto('data'); ERP.render(); }); await A.waitForTimeout(300);
    await A.setInputFiles('.drop input[type=file]', [fw, fe]); await A.waitForFunction(() => ERP.state.imp.jobs.length >= 6, null, { timeout: 60000 }); await A.waitForTimeout(300);
    const j = await ev(() => ERP.state.imp.jobs.map(x => ({ kind: x.kind, mode: x.mode, scope: x.scope || null, n: x.rows.length, p: x.preview ? x.preview(x).parts.map(q => q[0] + '=' + q[1]) : null })));
    const by = Object.fromEntries(j.map(x => [x.kind, x]));
    eq('작업 6개', Object.keys(by).sort(), ['ecount_items_stock', 'ecount_stock', 'wh_ledger_items', 'wh_ledger_open', 'wh_ledger_partners', 'wh_ledger_tx']);
    eq('ECOUNT 재고현황 = 보완 · 창고 범위 (같이 올렸으므로)', [by.ecount_stock.mode, by.ecount_stock.scope], ['fill', 'WH']);
    ok('창고 품목 미리보기: 같은 코드 2 (R-100 · 68-7408-0-813) · 제품번호 카톤 1 · 새 품목 4 · 뺀 코드 1 · 따로 둔 코드 1', by.wh_ledger_items.p.includes('같은 코드로 맞춤=2') && by.wh_ledger_items.p.includes('세관 코드 + 제품번호로 맞춤 (카톤 · 케이스)=1') && by.wh_ledger_items.p.some(x => /^새 품목/.test(x) && /=4$/.test(x)) && by.wh_ledger_items.p.includes('완제품 · 반제품 코드라 원부자재에서 뺌=1') && by.wh_ledger_items.p.includes('같은 물건일 수 있어 따로 둔 코드 (확인 필요)=1'), by.wh_ledger_items.p);
    ok('기초재고 미리보기: 마이너스 → 0 한 품목', by.wh_ledger_open.p.some(x => /마이너스 → 0/.test(x) && /=1$/.test(x)), by.wh_ledger_open.p);
  });

  // ------------------------------------------------------------------------------------------
  await sec('3. 반영 → 품목 맞추기', async () => {
    await A.click('text=선택 항목 모두 반영');
    for (let i = 0; i < 3; i++) { await A.waitForTimeout(500); const m = await A.$('.modal .modal-foot button:last-child'); if (m) await m.click(); }   // 확인 창 (재설정 등)
    await A.waitForFunction(() => !!Array.from(document.querySelectorAll('main h3')).find(x => /반영 결과/.test(x.textContent)), null, { timeout: 60000 });
    await ev(async () => { const D = ERP.db; if (D.flush) await D.flush(); });
    const r = await ev(() => { const I = ERP.inv; const it = (c) => { const m = I.item(c); return m ? { stage: I.info(m).stage, unit: I.unitN(m.unit), name: m.name, name_vn: m.name_vn || null, xnk: m.xnk || null, src: m.src } : null; };
      return { r100: it('R-100'), carton: it('04-5225-0-806'), fg: it('04-5225-0-005'), bk48: it('BK48'), r302: it('R-302'), neg: it('CT-NEG'), mh: it('MH'), p013: it('68-7408-0-013'), p813: it('68-7408-0-813'),
        partners: ERP.db.rows('partners').map(p => p.code).sort() }; });
    eq('R-100: ECOUNT 원재료 (kg) 와 같은 코드', [r.r100.stage, r.r100.unit, r.r100.src], ['RM', 'kg', 'ecount']);
    eq('제품번호로 적은 카톤 04-5225-0-005 → ECOUNT 카톤 04-5225-0-806 (완제품 04-5225-0-005 는 그대로 FG)', [r.carton.stage, r.fg.stage], ['SM', 'FG']);
    eq('BK48: 새 부자재 · 한국어 이름 · 원래 이름 · 세관 코드', r.bk48, { stage: 'SM', unit: 'PCS', name: '투명 테이프 48 MM', name_vn: 'BĂNG KEO TRONG 48 MM', xnk: 'R-411VN', src: 'wh' });
    eq('R-302 (색깔만 적힌 종이): 새 부자재 (개)', [r.r302.stage, r.r302.unit], ['SM', 'PCS']);
    eq('반제품 코드 MH 는 원부자재로 만들지 않음 (ECOUNT WIP03 그대로)', r.mh.stage, 'WIP03');
    eq('제품번호 카톤 68-7408-0-013 은 이미 있는 68-7408-0-813 에 합치지 않고 따로', [r.p013 && r.p013.src, r.p813 && r.p813.src], ['wh', 'ecount']);
    ok('거래처 (업체코드)', ['DG', 'DNV', 'DVT001', 'GC01', 'GLO001', 'IN7', 'NBIN', 'NBW', 'YID001'].every(c => r.partners.includes(c)), r.partners);
  });

  // ------------------------------------------------------------------------------------------
  await sec('4. 재고 = 창고 기말 재고 · ECOUNT 보완', async () => {
    const r = await ev(() => { const st = ERP.calc.stock(); const b = (c) => { const s = st.get(c); return s ? Math.round(s.bal * 1000) / 1000 : null; };
      const op = (c) => { const o = ERP.db.rows('stock_open').find(x => x.code === c && x.scope === 'WH'); return o ? [o.qty, o.grp, o.date] : null; };
      return { bal: { r100: b('R-100'), carton: b('04-5225-0-806'), bk48: b('BK48'), r302: b('R-302'), neg: b('CT-NEG'), p013: b('68-7408-0-013'), p813: b('68-7408-0-813'), r999: b('R-999'), smonly: b('SM-ONLY'), fg: b('04-5225-0-005'), mh: b('MH') },
        open: { r100: op('R-100'), neg: op('CT-NEG'), fg: op('04-5225-0-005'), mh: op('MH'), r999: op('R-999') }, od: ERP.db.meta.openDate,
        adj: ERP.db.rows('stock_tx').filter(t => t.kind === 'ADJ').map(t => [t.code, t.qty, t.date, t.purpose]) }; });
    eq('원부자재 재고 = 창고 기말 재고 (R-100 140 kg · 카톤 270 · BK48 60 · R-302 600 · 68-7408-0-013 20 · 68-7408-0-813 50)', [r.bal.r100, r.bal.carton, r.bal.bk48, r.bal.r302, r.bal.p013, r.bal.p813], [140, 270, 60, 600, 20, 50]);
    eq('기초재고 2026-01-04 (첫 입출고일 전날) = 기말 − 입고 + 출고 (R-100: 140 − 100 + 60 = 100)', r.open.r100, [100, 'wh', '2026-01-04']);
    eq('계산이 마이너스(0 − 50 + 10 = −40) → 기초재고 0 + 마지막 날 조정 −40 → 재고 0', [r.open.neg && r.open.neg[0], r.bal.neg, r.adj], [0, 0, [['CT-NEG', -40, '2026-07-01', '기말 재고 맞춤']]]);
    eq('창고 범위 기준일 = 2026-01-04 (현장 실사 기준일은 그대로)', r.od, { FLOOR: '2026-10-20', WH: '2026-01-04' });
    eq('ECOUNT 에만 있는 품목은 보완 (R-999 50 kg · SM-ONLY 7)', [r.bal.r999, r.bal.smonly, r.open.r999 && r.open.r999[1]], [50, 7, 'fill']);
    eq('ECOUNT 마이너스(완제품 −217) → 0', [r.open.fg && r.open.fg[0], r.bal.fg], [0, 0]);
    eq('공정 중(반제품 MH)은 현장 실사 기준이라 ECOUNT 수량을 넣지 않음', r.open.mh, null);
  });

  // ------------------------------------------------------------------------------------------
  await sec('5. 수불 칸 (업체코드 · 용도 · Lot · 색깔)', async () => {
    const r = await ev(() => { const T = ERP.db.rows('stock_tx').filter(t => t.src === 'wh'); const f = (c, d) => { const t = T.find(x => x.code === c && x.date === d); return t ? { kind: t.kind, qty: t.qty, unit: t.unit, partner: t.partner, pc: t.partner_code, purpose: t.purpose || null, lot: t.lot || null, color: t.color || null, note: t.note || null, from: t.from_scope || null, to: t.to_scope || null } : null; };
      return { out: f('R-100', '2026-02-01'), gc: f('R-100', '2026-02-03'), in: f('R-100', '2026-01-05'), paper: f('R-302', '2026-01-08'), red: f('R-302', '2026-05-01'), mh: T.filter(t => t.code === 'MH').length, n: T.length }; });
    eq('원료 출고 = 원부자재 재고에서 빠짐 (창고 → 외부) · 업체코드 · 생산 투입 · Lot', r.out, { kind: 'OUT', qty: 40, unit: 'kg', partner: 'Bộ phận Ép nhựa', pc: 'NBIN', purpose: '생산 투입', lot: 'E250713', color: null, note: null, from: 'WH', to: null });
    eq('외주 가공 출고 + Lot', [r.gc.purpose, r.gc.lot], ['외주 가공 출고', '601442']);
    eq('입고 = 외부 → 창고', [r.in.kind, r.in.to, r.in.purpose, r.in.pc], ['IN', 'WH', '생산용 입고', 'DVT001']);
    eq('색깔 칸 · 팔레트는 비고', [r.paper.color, r.paper.note, r.red.color], ['WHITE', '팔레트 2', 'RED']);
    eq('뺀 반제품(MH)의 줄은 넣지 않음', r.mh, 0);
    eq('수불 줄 수 (입고 7 · 출고 7 · 조정 1)', r.n, 15);
  });

  // ------------------------------------------------------------------------------------------
  await sec('6. 같은 파일을 다시 올려도 늘지 않음', async () => {
    const before = await ev(() => ({ tx: ERP.db.rows('stock_tx').length, open: ERP.db.rows('stock_open').length, items: ERP.db.rows('items').length, bal: ERP.calc.stock().get('R-100').bal }));
    await ev(() => { ERP.state.imp = { jobs: [] }; ERP.render(); }); await A.waitForTimeout(200);
    await A.setInputFiles('.drop input[type=file]', [fw]); await A.waitForFunction(() => ERP.state.imp.jobs.length >= 4, null, { timeout: 60000 }); await A.waitForTimeout(300);
    await A.click('text=선택 항목 모두 반영');
    for (let i = 0; i < 3; i++) { await A.waitForTimeout(500); const m = await A.$('.modal .modal-foot button:last-child'); if (m) await m.click(); }   // 확인 창 (재설정 등)
    await A.waitForFunction(() => !!Array.from(document.querySelectorAll('main h3')).find(x => /반영 결과/.test(x.textContent)), null, { timeout: 60000 });
    const after = await ev(() => ({ tx: ERP.db.rows('stock_tx').length, open: ERP.db.rows('stock_open').length, items: ERP.db.rows('items').length, bal: ERP.calc.stock().get('R-100').bal }));
    eq('수불 · 기초재고 · 품목 수 · 재고 그대로', after, before);
    eq('ECOUNT 보완 행은 남음 (R-999)', await ev(() => ERP.calc.stock().get('R-999').bal), 50);
  });

  // ------------------------------------------------------------------------------------------
  await sec('7. 화면 · 오류 없음', async () => {
    await ev(() => { ERP.state.txl = { from: '2026-01-01', to: '2026-12-31', kind: '', src: '', q: '', page: 0 }; ERP.goStock('ledger'); ERP.render(); }); await A.waitForTimeout(300);
    const t = await ev(() => document.querySelector('main').innerText);
    ok('수불 내역: 거래처 (업체코드) · 용도 · Lot · 색깔 · 출처', /\(NBIN\)/.test(t) && /생산 투입/.test(t) && /Lot E250713/.test(t) && /색깔 WHITE/.test(t) && /창고 입출고장/.test(t), t.slice(0, 600));
    await ev(() => ERP.itemDetail('BK48')); await A.waitForTimeout(300);
    const d = await ev(() => document.querySelector('.modal').innerText);
    ok('품목 상세: 세관신고 코드 · 베트남어 원문 · 개당 kg · 기초재고 출처', /세관신고 코드/.test(d) && /BĂNG KEO TRONG 48 MM/.test(d) && /개당/.test(d) && /창고 입출고장/.test(d), d.slice(0, 500));
    await ev(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
    for (const lang of ['ko', 'vi']) { await ev((l) => ERP.setLang(l), lang); for (const tab of ['mat', 'ledger', 'master']) { await ev((x) => { ERP.goStock(x); ERP.render(); }, tab); await A.waitForTimeout(150); } }
    await ev(() => ERP.setLang('ko'));
    const txt = await ev(() => document.querySelector('main').innerText);
    ok('null · undefined 글자 없음', !/\bnull\b|\bundefined\b/.test(txt));
    eq('페이지 오류 없음', errors, []);
  });

  await browser.close(); S.close();
  console.log('\n' + (fail ? '✗ 실패 ' + fail + '개' : '✓ 모두 통과') + '  (통과 ' + pass + ' / 전체 ' + (pass + fail) + ')');
  if (failures.length) { console.log('\n실패 목록:'); failures.forEach(x => console.log(' - ' + x)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
