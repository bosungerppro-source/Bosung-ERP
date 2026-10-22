'use strict';
/* 7차 자동 시험 (6차 시험 포함): ECOUNT 자료 · 재고 엔진 · 원부자재/생산현장 탭 · 생산 반영(코드 연결 · 조립 BOM 자동 구성 · 사출 원료) ·
   종합 현황 위젯(추가·삭제·이동·크기·저장) · 일별 조립 · 월별 수주(Checking) · 수주 품목군 표 · 수불 · ECOUNT 재고 재설정 · 자료 점검 · 모든 화면(한/베)
   사용:  npm run test:v7 [-- <ECOUNT 엑셀 폴더>]   (기본 폴더 seed/ecount · Playwright 필요: npm i -D playwright)
   폴더에는 ECOUNT 품목등록 · 창고리스트 · 재고현황(창고) · 재고현황(공장) · ERP CODE 설명 엑셀을 넣는다 (파일명 무관). */
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const DIR = process.argv[2] || path.join(ROOT, 'seed', 'ecount');
let pw; try { pw = require('playwright'); } catch (e) { try { pw = require('playwright-core'); } catch (e2) { console.error('Playwright가 필요합니다 / cần Playwright:  npm i -D playwright'); process.exit(2); } }
const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const serverMod = require(path.join(ROOT, 'server.js'));

let pass = 0, fail = 0; const failures = [];
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 500 ? s.slice(0, 500) + '…' : s; };
function ok(name, cond, detail) { if (cond) { pass++; return true; } fail++; const line = name + (detail !== undefined ? '  → ' + short(detail) : ''); failures.push(line); console.log('  ✗ ' + line); return false; }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const near = (name, got, want, tol) => ok(name, typeof got === 'number' && Math.abs(got - want) <= (tol || 0.006), { got, want });
const section = (t) => console.log('\n■ ' + t);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

(async () => {
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => /\.xlsx?$/i.test(f)).map(f => path.join(DIR, f)) : [];
  if (files.length < 5) { console.error('ECOUNT 엑셀 5개가 있는 폴더를 지정하세요: ' + DIR); process.exit(2); }
  const dataDir = tmp('erp-v6-'); const S = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir, host: '127.0.0.1', port: 4300 + Math.floor(Math.random() * 300) });
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const page = await (await browser.newContext({ viewport: { width: 1480, height: 920 }, acceptDownloads: true })).newPage();
  const errors = []; page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const ev = (fn, a) => page.evaluate(fn, a);
  await page.goto(S.url + '/#/dashboard');
  await page.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 120000 });

  // ------------------------------------------------------------------------------------------
  section('1. 시드 = ECOUNT 자료 (품목·창고·코드 사전·기초재고)');
  {
    const r = await ev(() => { const D = ERP.db; const so = D.rows('stock_open'); const sum = (sc, k) => so.filter(x => x.scope === sc).reduce((a, x) => a + (+x[k] || 0), 0);
      return { items: D.rows('items').length, wh: D.rows('warehouses').length, codes: D.rows('code_dict').length, nWH: so.filter(x => x.scope === 'WH').length, nFAC: so.filter(x => x.scope === 'FAC').length,
        qWH: sum('WH', 'qty'), qFAC: sum('FAC', 'qty'), sWH: sum('WH', 'sets'), sFAC: sum('FAC', 'sets'), pWH: sum('WH', 'pcs'), pFAC: sum('FAC', 'pcs'), dates: Array.from(new Set(so.map(x => x.date))), sample: ERP.isSample('po') }; });
    eq('품목 2,265', r.items, 2265); eq('창고 11', r.wh, 11); eq('코드 사전 34', r.codes, 34); eq('기초재고 창고 314행', r.nWH, 314); eq('기초재고 공장 962행', r.nFAC, 962);
    near('창고 재고수량 합계', r.qWH, 26643539.46); near('공장 재고수량 합계 (행 합계 · 원본 합계 행은 반올림 0.04 차이)', r.qFAC, 51246378.17);
    eq('Số Set 합계', [r.sWH, r.sFAC], [-12360, 100212]); eq('Số PCS 합계', [r.pWH, r.pFAC], [-469440, 2243328]); eq('기준일', r.dates, ['2026-10-16']); ok('수주 샘플은 예시 표시', r.sample);
  }

  section('2. 재고 엔진 (현재고 = 기초재고 + 수불 + 생산 반영)');
  {
    const r = await ev(() => { const C = ERP.calc, INV = ERP.inv; const st = C.stock(); const rows = INV.rows(); const g = (c) => { const s = st.get(c); return s ? { wh: s.by.WH, fac: s.by.FAC, bal: s.bal, status: s.status, susp: s.susp, sets: s.sets, pcs: s.pcs, stage: s.stage, prim: s.prim } : null; };
      return { r001: g('R-001'), fg: g('52-9724-K-000'), bm09: g('BM09'), test: g('T11'), susp: rows.filter(s => s.susp).length, suspAll: Array.from(st.values()).filter(s => s.susp).length, low: rows.filter(s => s.status === 'low' || s.status === 'neg').length,
        safety: rows.filter(s => s.safety > 0).length, neg: rows.filter(s => s.negative).length, hiddenInRows: rows.some(s => s.hidden), mode: INV.prodMode(), meta: INV.meta(), stages: INV.stageSummary(rows).filter(x => x.items).map(x => x.stage + ':' + x.items) }; });
    eq('R-001 BEE WAX 창고/공장/합계', [r.r001.wh, r.r001.fac, r.r001.bal], [1695, -790.53, 904.47]); ok('R-001 이동 누락 의심', r.r001.susp); eq('R-001 상태 = 미달 (안전 1,400)', r.r001.status, 'low');
    eq('52-9724-K-000 FG: 창고 −630 / 공장 +630 = 0', [r.fg.wh, r.fg.fac, r.fg.bal], [-630, 630, 0]); eq('FG 단위 CT', r.fg.prim, 'CT');
    eq('BM09 배럴 단계 = WIP01', r.bm09.stage, 'WIP01'); ok('테스트 품목은 목록에서 숨김', !r.hiddenInRows && r.test && r.test.stage === 'TEST');
    eq('이동 누락 의심 71품목 (테스트 품목 4개 제외, 전체 75)', [r.susp, r.suspAll], [71, 75]); eq('안전재고 설정 52품목', r.safety, 52); eq('안전재고 미달 28품목', r.low, 28);
    ok('마이너스 품목 > 0', r.neg > 0, r.neg); eq('생산 반영 기본 = in_bom', r.mode, 'in_bom'); eq('기초재고 기준일', [r.meta.open.WH, r.meta.open.FAC], ['2026-10-16', '2026-10-16']);
    ok('공정 흐름 단계 분류', r.stages.includes('FG:223') && r.stages.includes('RM:116') && r.stages.includes('WIP11:220'), r.stages);
  }

  section('3. 대시보드 · 비서 숫자 일치');
  {
    await ev(() => ERP.goto('dashboard')); await page.waitForTimeout(400);
    const r = await ev(() => ({ txt: document.querySelector('.wgrid').innerText, ov: ERP.ai.tools.overview(), low: ERP.ai.tools.material_stock({ only_low: true, limit: 500 }).total, r001: ERP.ai.tools.material_stock({ query: 'R-001', limit: 3 }).rows[0], ans: ERP.ai.localAnswer('R-001 재고').text, flow: !!document.querySelector('.flow') }));
    const m = r.txt.match(/안전재고 미달 자재\s*([\d,]+)\s*품목/); eq('대시보드 안전재고 미달 = overview', m ? +m[1].replace(/,/g, '') : null, r.ov.materials_below_safety);
    eq('material_stock(only_low) = overview', r.low, r.ov.materials_below_safety); eq('R-001 비서 도구 창고/공장', [r.r001.warehouse, r.r001.factory, r.r001.balance], [1695, -790.5, 904.5]);
    ok('내장 비서 답변에 창고/공장·기준일', /창고 1,695/.test(r.ans) && /공장 -790|공장 −790/.test(r.ans) && /2026-10-16/.test(r.ans), r.ans); ok('대시보드 공정 흐름 카드', r.flow);
    ok('overview 에 stock_basis', r.ov.stock_basis && r.ov.stock_basis.opening_date_warehouse === '2026-10-16', r.ov.stock_basis);
  }

  section('4. 모든 화면 · 탭 (한국어 / Tiếng Việt)');
  for (const lang of ['ko', 'vi']) {
    await ev((l) => ERP.setLang(l), lang);
    const pages = await ev(() => Object.keys(ERP.pages));
    for (const p of pages) { await ev((x) => ERP.goto(x), p); await page.waitForTimeout(250); }
    // 12차: 메뉴 3개 (품목 / 현장 재고 / 원부자재 재고) — ERP.goStock(탭) 으로 그 탭이 있는 메뉴를 연다. 'stock' · 'compare' 는 예전 이름 (compare 는 원부자재 재고로)
    for (const t of ['mat', 'entry', 'ledger', 'reorder', 'buy', 'outsource', 'floor', 'post', 'fentry', 'fledger', 'master', 'codes', 'check', 'legacy']) { await ev((x) => { ERP.goStock(x); ERP.render(); }, t); await page.waitForTimeout(250); }
    for (const t of ['stock', 'compare', 'post', 'codes', 'mat']) { await ev((x) => { ERP.state.matTab = x; ERP.goto('materials'); ERP.render(); }, t); await page.waitForTimeout(250); }
    for (const t of ['mrp', 'struct', 'asm', 'semi_stock', 'bom', 'recipes']) { await ev((x) => { ERP.state.bomTab = x; ERP.state.params = {}; ERP.goto('bom'); ERP.render(); }, t); await page.waitForTimeout(250); }
    await ev(() => { ERP.state.asm = Object.assign(ERP.state.asm || {}, { kind: 'stp' }); ERP.render(); ERP.state.asm.kind = 'asm'; });
    for (const t of ['log', 'entry', 'analysis', 'monthly', 'machines', 'procs']) { await ev((x) => { ERP.state.prodTab = x; ERP.goto('production'); ERP.render(); }, t); await page.waitForTimeout(200); }
    await ev(() => { ERP.state.dashEdit = true; ERP.goto('dashboard'); ERP.render(); ERP.state.dashEdit = false; ERP.render(); });
    for (const t of ['items', 'warehouses', 'partners', 'stock_open', 'uploads']) await ev((x) => { ERP.state.mst = { t: x }; ERP.goStock('master'); ERP.render(); }, t);
    for (const lv of ['stage', 'line', 'cat', 'sub']) await ev((x) => { ERP.state.cod = Object.assign(ERP.state.cod || {}, { level: x }); ERP.goStock('codes'); ERP.render(); }, lv);
    const chk = await ev(() => { ERP.goStock('check'); ERP.render(); const ids = ['susp', 'neg', 'type', 'space', 'empty', 'end', 'dup', 'fd', 'unit', 'noerp', 'missing', 'unknown', 'test', 'prod']; ids.forEach(i => { ERP.state.chk = { open: i }; ERP.render(); }); return true; });
    ok('[' + lang + '] 모든 화면·탭 열림, 오류 0', chk && errors.length === 0, errors.slice(0, 5));
  }
  await ev(() => ERP.setLang('ko'));

  section('5. 원부자재 재고 / 현장 재고 메뉴: 공정 흐름 · 필터 · 상세');
  {
    // 단계 카드의 코드: 이름이 있으면 <code> 줄, 이름 미정이면 제목 자리에 코드만 (12차)
    const cardCodes = () => page.$$eval('.flow .st', a => a.map(x => (x.querySelector('code') || x.querySelector('b')).textContent));
    await ev(() => { ERP.state.stk_mat = null; ERP.state.stk_floor = null; ERP.goStock('mat'); ERP.render(); }); await page.waitForTimeout(300);
    const cm = await cardCodes();
    await ev(() => { ERP.goStock('floor'); ERP.render(); }); await page.waitForTimeout(300);
    // 1.12.0: 현장 재고 위 = 피벗 표 (기본 조립 · 품목군 × 월) — 단계 카드 · 공정별 칸 없음, 품목군 이름은 일보 품목군 (이름 없는 제품군은 코드만)
    const pv = await ev(() => { const c = document.querySelector('main .fpiv-card'); return { cards: document.querySelectorAll('main .fpiv-card').length, st: document.querySelectorAll('main .flow .st').length, title: c ? c.querySelector('h2').textContent : '',
      head: c ? Array.from(c.querySelectorAll('thead th')).map(t => t.innerText.replace(/\s+/g, ' ').trim()) : [], rows: c ? Array.from(c.querySelectorAll('tbody tr:not(.tot) td:first-child')).map(td => td.innerText.trim()) : [] }; });
    eq('원부자재 재고 흐름 카드 = RM · SM · CM', cm, ['RM', 'SM', 'CM']);
    ok('현장 재고 위 = 피벗 표 하나 (조립 재고 · 품목군 \\ 월) · 단계 카드 없음 · 줄 = 품목군 (이름 없는 제품군은 코드만)', pv.cards === 1 && pv.st === 0 && /^조립 재고 · \d{4}$/.test(pv.title) && pv.head[0] === '품목군 \\ 월' && pv.rows.length > 0 && pv.rows.every(t => ['Mini', 'Dial', 'Pencil', 'Click pencil', 'Glass', 'Marker', '기타'].includes(t) || /^[A-Z0-9]+$/.test(t)), pv);
    await page.click('main .fpiv-card tbody tr:not(.tot) td.pc'); await page.waitForTimeout(300);
    const r = await ev(() => ({ proc: ERP.state.stk_floor.proc, line: ERP.state.stk_floor.line, rows: document.querySelectorAll('main table.tbl:not(.fpiv-t) tbody tr').length }));
    ok('피벗 표 줄 → 아래 표가 그 공정(조립) · 품목군 품목', r.proc === 'ASM' && r.rows > 0, r);
    const sus = await ev(async () => { const out = {}; for (const g of ['mat', 'floor']) { ERP.goStock(g); ERP.state['stk_' + g] = { stage: '', line: '', sub: '', cat: '', scope: 'all', status: 'susp', q: '', hideZero: true, sk: 'code', sd: 1, page: 0, ps: 100 }; ERP.render(); out[g] = parseInt(document.querySelector('main .pager span').textContent.replace(/,/g, ''), 10); } return out; });
    eq('이동 누락 의심 = 원부자재 + 현장 재고 = 71', sus.mat + sus.floor, 71);
    await ev(() => { ERP.state.stk_mat.status = ''; ERP.state.stk_mat.q = 'rm wax bees'; ERP.goStock('mat'); ERP.render(); }); await page.waitForTimeout(300);
    const q = await ev(() => Array.from(document.querySelectorAll('main table.tbl tbody tr td:first-child')).map(x => x.textContent)); ok('검색: 띄어쓰기·대소문자 무시 (ERP CODE)', q.includes('R-001'), q.slice(0, 5));
    await ev(() => ERP.itemDetail('R-001')); await page.waitForTimeout(300);
    const md = await ev(() => document.querySelector('.modal').innerText); ok('품목 상세: 수불부·기초재고', /수불부/.test(md) && /기초재고/.test(md) && /BEE WAX/.test(md), md.slice(0, 200));
    await ev(() => document.querySelector('.modal-back').remove());
  }

  section('6. 수불 입력 (화면) → 재고 · 수불부');
  {
    const r = await ev(() => {
      const before = ERP.calc.stock().get('R-001'); const b = { wh: before.by.WH, fac: before.by.FAC, bal: before.bal };
      ERP.state.txe = { rows: [{ date: '2026-10-17', kind: 'IN', to: 'WH', code: 'R-001', qty: 100, partner: 'Supplier A' }, { date: '2026-10-17', kind: 'MOVE', from: 'WH', to: 'FAC', code: 'r-001', qty: 800 }, { date: '2026-10-17', kind: 'OUT', from: 'WH', code: 'NO-SUCH', qty: 5 }] };
      ERP.goStock('entry'); ERP.render(); return b; });
    await page.waitForTimeout(300);
    const okN = await page.textContent('main button.btn.primary'); ok('잘못된 코드 줄은 제외 (저장 2)', /\(2\)/.test(okN), okN);
    await page.click('main button.btn.primary'); await page.waitForTimeout(400);
    const a = await ev(() => { const s = ERP.calc.stock().get('R-001'); const tx = ERP.db.rows('stock_tx'); return { wh: s.by.WH, fac: s.by.FAC, bal: s.bal, n: tx.length, docs: tx.map(t => t.doc_no), susp: s.susp, led: ERP.inv.ledger('R-001').rows.length, codes: tx.map(t => t.code) }; });
    eq('입고 100 + 이동 800: 창고 / 공장 / 합계', [a.wh, a.fac, a.bal], [995, 9.47, 1004.47]); eq('수불 2건 저장 (소문자 코드도 정규화)', [a.n, a.codes], [2, ['R-001', 'R-001']]); ok('전표번호 자동 (IN/MV)', a.docs.some(d => /^IN261017-/.test(d)) && a.docs.some(d => /^MV261017-/.test(d)), a.docs);
    ok('이동으로 이동 누락 의심 해소', !a.susp); eq('수불부 = 기초 1 + 2', a.led, 3);
  }

  section('7. 수불 엑셀 양식 업로드 · KHO NVL 장부 변환');
  {
    const tdir = tmp('erp-v6-x-'); const f1 = path.join(tdir, 'tx_upload.xlsx');
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['일자 / Ngày', '전표번호 / Số CT', '구분 (입고/출고/이동/조정) / Loại', '출발 (창고/공장) / Từ', '도착 (창고/공장) / Đến', '품목코드 / Mã hàng', '수량 / Số lượng', '거래처 / Đối tác', '참조 (PO 등) / Tham chiếu', '비고 / Ghi chú'],
      ['2026-10-18', 'T-001', 'Nhập', '', 'Kho', 'R-002', 50, 'S', '', ''], ['2026-10-18', 'T-001', '이동', '창고', '공장', 'R-002', 20, '', '', ''], ['2026-10-18', 'T-002', 'xuat', 'kho', '', '52-9724-K-000', 5, 'Customer', 'PO1', ''], ['2026-10-18', 'T-003', '조정', '', '공장', 'BM09', -120, '', '', 'kiểm kê'], ['2026-10-18', 'T-003', '입고', '', '', 'XX-NONE', 3, '', '', '']]), 'stock_tx');
    XLSX.writeFile(wb, f1);
    await ev(() => { ERP.state.dataTab = 'import'; ERP.state.imp = { jobs: [] }; ERP.goto('data'); ERP.render(); }); await page.waitForTimeout(300);
    await page.setInputFiles('.drop input[type=file]', [f1]); await page.waitForFunction(() => ERP.state.imp.jobs.length > 0, null, { timeout: 30000 });
    const j = await ev(() => ERP.state.imp.jobs.map(x => ({ t: x.table, mode: x.mode, rows: x.rows.length, unk: x.rows.filter(r => r._unknown).length, kinds: x.rows.map(r => r.kind + ':' + (r.from_scope || '') + '>' + (r.to_scope || '')) })));
    eq('양식 인식: 재고 수불 5행 · 전표 기준 · 미확인 1', [j[0].t, j[0].mode, j[0].rows, j[0].unk], ['stock_tx', 'slip', 5, 1]);
    eq('구분·범위 해석 (한/베 혼용)', j[0].kinds, ['IN:>WH', 'MOVE:WH>FAC', 'OUT:WH>', 'ADJ:>FAC', 'IN:>WH']);
    await page.click('text=선택 항목 모두 반영'); await page.waitForTimeout(500);
    const a = await ev(() => { const st = ERP.calc.stock(); return { r002: [st.get('R-002').by.WH - (ERP.db.rows('stock_open').filter(x => x.code === 'R-002' && x.scope === 'WH').reduce((s, x) => s + x.qty, 0)), st.get('R-002').by.FAC - (ERP.db.rows('stock_open').filter(x => x.code === 'R-002' && x.scope === 'FAC').reduce((s, x) => s + x.qty, 0))], fg: st.get('52-9724-K-000').by.WH, n: ERP.db.rows('stock_tx').length, up: ERP.db.rows('uploads').slice(-1)[0] }; });
    eq('R-002 창고 +30 / 공장 +20', a.r002.map(x => Math.round(x * 100) / 100), [30, 20]); eq('FG 출고 5 CT → 창고 −635', a.fg, -635); eq('수불 2 + 4 = 6건 (미확인 줄은 건너뜀)', a.n, 6); ok('업로드 이력 기록', a.up && a.up.kind === 'stock_tx' && a.up.added === 4, a.up);
    // same file again -> slip replace, no duplicates
    await page.setInputFiles('.drop input[type=file]', [f1]); await page.waitForFunction(() => ERP.state.imp.jobs.length > 0, null, { timeout: 30000 }); await page.click('text=선택 항목 모두 반영'); await page.waitForTimeout(500);
    eq('같은 파일 다시 올림 → 전표번호 기준 교체 (중복 없음)', await ev(() => ERP.db.rows('stock_tx').length), 6);
    // undo
    page.once('dialog', d => d.accept()); await ev(() => { window.confirm = () => true; });
    await page.click('text=되돌리기'); await page.waitForTimeout(300); await page.click('.modal-foot .btn.primary'); await page.waitForTimeout(400);
    eq('되돌리기 → 직전 상태 (6건 유지: 첫 업로드 결과)', await ev(() => ERP.db.rows('stock_tx').length), 6);
    // legacy ledger rows -> tx conversion
    const conv = await ev(() => { const r = ERP.inv.ledgerToTx([{ date: '2026-10-19', type: 'IN', item_code: 'R-0031', wh_code: 'R-003', name: 'Paraffin wax - KR', in_kg: 10 }, { date: '2026-10-19', type: 'OUT', item_code: 'CASE-X', wh_code: 'R-401VN', name: '12CT MINI - MEX 25', out_ea: 7 }, { date: '2026-10-19', type: 'OUT', item_code: 'R-103VN', wh_code: 'R-103VN', name: 'LDPE', out_kg: 3 }], { outMode: 'move' }); return r.rows.map(x => [x.kind, x.code || null, x.from_scope || '', x.to_scope || '', x.qty]); });
    eq('KHO NVL 장부 → 수불 (코드·Mã XNK·VN 접미어 매칭, 출고=이동)', conv, [['IN', 'R-003', '', 'WH', 10], ['MOVE', '52-0712', 'WH', 'FAC', 7], ['MOVE', 'R-103', 'WH', 'FAC', 3]]);
  }

  section('8. 생산일보 → 재고 자동 반영 (입고 + BOM 차감, 중복 없음)');
  {
    const r = await ev(() => {
      const DB = ERP.db; const base = DB.rows('prod_log').length;
      DB.addMany('prod_log', [{ date: '2026-10-17', process: 'PCK', code: '52-9724-K-000', ok_qty: 120, ok_ea: 2880, unit: 'set' }, { date: '2026-10-17', process: 'ASM', code: 'BIC2301', ok_qty: 1000, ok_ea: 1000 }, { date: '2026-10-17', process: 'INJ', code: 'Barrel', ok_qty: 500, ok_ea: 500 }, { date: '2026-10-15', process: 'PCK', code: '52-9724-K-000', ok_qty: 999, ok_ea: 999 }]);
      const p = ERP.inv.prodPost(); const fg = ERP.calc.stock().get('52-9724-K-000'); const bic = ERP.calc.stock().get('BIC2301');
      const d = p.diag; return { base, prodFG: p.rows.filter(x => x.kind === 'PROD' && x.code === '52-9724-K-000').map(x => x.qty), use: p.rows.filter(x => x.kind === 'USE').length, fgFac: fg.by.FAC, bic: bic ? bic.prod : null,
        notItem: Array.from(d.notItem.keys()), before: d.before, mode: d.mode };
    });
    eq('포장 120 set → FG 10 CT 입고 (12 set/CT)', r.prodFG, [10]); eq('FG 공장 630 + 10 = 640', r.fgFac, 640); eq('조립 BIC2301 1,000 pcs 입고', r.bic, 1000);
    ok('BOM 차감 행 생성', r.use > 0, r.use); eq('사출 일보 "Barrel" = 품목코드 아님 (공정|품목군|코드)', r.notItem, ['INJ||Barrel']); eq('기준일 이전 일보는 반영 안 함', r.before >= 1, true);
    const again = await ev(() => { const DB = ERP.db; DB.t.prod_log = DB.rows('prod_log').filter(x => !(x.date === '2026-10-17')); DB.addMany('prod_log', [{ date: '2026-10-17', process: 'PCK', code: '52-9724-K-000', ok_qty: 120, ok_ea: 2880, unit: 'set' }]); return ERP.calc.stock().get('52-9724-K-000').by.FAC; });
    eq('같은 일보를 다시 올려도 중복 없음', again, 640);
    const off = await ev(() => { ERP.db.setSetting('prodPost', 'off'); const v = ERP.calc.stock().get('52-9724-K-000').by.FAC; ERP.db.setSetting('prodPost', 'in'); const v2 = ERP.inv.prodPost().rows.filter(x => x.kind === 'USE').length; ERP.db.setSetting('prodPost', 'in_bom'); return [v, v2]; });
    eq('설정 끔 → 반영 없음 / 입고만 → 차감 0', off, [630, 0]);
  }

  section('9. ECOUNT 다시 올리기 (변경 0) · 재고현황은 기초재고 재설정만 (12차: 비교 없음)');
  {
    await ev(() => { ERP.state.imp = { jobs: [] }; ERP.goto('data'); ERP.render(); }); await page.waitForTimeout(300);
    await page.setInputFiles('.drop input[type=file]', files); await page.waitForFunction(() => ERP.state.imp.jobs.length >= 5, null, { timeout: 60000 });
    const j = await ev(() => ERP.state.imp.jobs.map(x => ({ kind: x.kind, mode: x.mode, scope: x.scope, prev: x.preview ? x.preview(x) : null })));
    const it = j.find(x => x.kind === 'ecount_items'); eq('품목등록 다시: 신규 0 · 변경 0 · 없음 0', it.prev.parts.map(p => p[1]), [0, 0, 0]);
    const stk = j.filter(x => x.kind === 'ecount_stock'); eq('재고현황 다시: 방식 = 기초재고로 설정, 범위 자동', stk.map(x => x.mode + ':' + x.scope).sort(), ['open:FAC', 'open:WH']);
    eq('재고현황 반영 방식 = 기초재고로 설정 · 보완 (14차) — 비교만은 없음', await ev(() => ERP.state.imp.jobs.filter(x => x.kind === 'ecount_stock').map(x => Object.keys(x.modes()))), [['open', 'fill'], ['open', 'fill']]);
    ok('합계 일치 표시', stk.every(x => /일치/.test(x.prev.parts[0][0])), stk.map(x => x.prev.parts[0]));
    ok('다시 올리면 기초재고 재설정 경고', stk.every(x => /기초재고 재설정/.test(x.prev.detail)), stk.map(x => x.prev.detail));
    const pg = await ev(() => ({ t: document.querySelector('main').innerText, tables: Object.keys(ERP.TABLES) }));
    ok('자료 화면에 "비교만" 안내 없음 · ecount_snap 표 없음', !/비교만|ECOUNT 비교/.test(pg.t) && !pg.tables.includes('ecount_snap'), pg.t.match(/.{0,30}비교.{0,30}/));
    await page.click('main button:has-text("취소")'); await page.waitForTimeout(300);
    eq('반영하지 않으면 기초재고 그대로', await ev(() => ERP.db.rows('stock_open').length), 1276);
  }

  section('10. 자료 점검');
  {
    const k = await ev(() => { const K = ERP.inv.checks(); return [K.typeMismatch.length, K.space.length, K.emptySeg.length, K.notEnding.length, K.dup.length, K.fd.length, K.test.length, K.noUnit.length, K.unitVariant.length]; });
    eq('품목구분 불일치 124 · 공백 2 · 빈 칸 18 · 끝 불일치 13 · 중복 2 · FD 1 · 테스트 11 · 단위 없음 1 · 표기 혼재 13', k, [124, 2, 18, 13, 2, 1, 11, 1, 13]);
    const mv = await ev(() => ERP.inv.suggestMoves('2026-10-20').length); ok('이동 전표 제안 (이동 누락 의심 정리)', mv >= 70, mv);
    const b = await ev(() => { ERP.state.cod = { level: 'stage', b: { stage: 'SG', line: 'PEN', cat: '', sub: 'SIL', code: 'X123' } }; ERP.goStock('codes'); ERP.render(); return document.querySelector('main').innerText.includes('SG-PEN-SIL-X123'); });
    ok('ERP CODE 만들기 도우미 (SG-PEN-SIL-X123)', b);
  }

  section('11. 원부자재 / 생산현장 구분 · 합계 = 기초 + 입고 − 소모 ± 기타');
  {
    const r = await ev(() => { const INV = ERP.inv; const rows = INV.rows(); const g = { mat: 0, floor: 0 }; const bad = [], stBad = [];
      rows.forEach(s => { const k = INV.groupOf(s); g[k] = (g[k] || 0) + 1; if ((['RM', 'SM', 'CM'].includes(s.stage) && k !== 'mat') || (INV.FLOOR_STAGES.includes(s.stage) && k !== 'floor')) stBad.push(s.code);
        const lhs = s.openTot + s.in + s.prod - s.out - s.use + s.adj; if (Math.abs(lhs - s.bal) > 1e-4) bad.push([s.code, lhs, s.bal]); });
      const fg = ERP.calc.stock().get('52-9724-K-000');
      return { g, total: rows.length, stBad, bad: bad.slice(0, 5), fg: [fg.openTot, fg.prod, fg.bal] }; });
    eq('모든 품목이 원부자재 또는 현장 재고 (숨김 제외)', r.g.mat + r.g.floor, r.total); ok('단계별 구분 (RM·SM·CM = 원부자재, WIP·SG·FG = 현장 재고)', !r.stBad.length, r.stBad.slice(0, 5));
    ok('모든 품목: 합계 = 기초 + 입고 + 생산 − 출고 − 소모 ± 조정', !r.bad.length, r.bad);
    eq('FG 52-9724-K-000: 기초 0 + 생산 10 − 출고 5 = 5', r.fg, [0, 10, 5]);
    await ev(() => { ERP.state.stk_floor = { stage: '', line: '', sub: '', cat: '', scope: 'all', status: '', q: '52-9724-K-000', hideZero: true, sk: 'code', sd: 1, page: 0, ps: 100 }; ERP.goStock('floor'); ERP.render(); }); await page.waitForTimeout(300);
    const row = await ev(() => Array.from(document.querySelectorAll('main table.tbl tbody tr')).map(tr => Array.from(tr.children).map(td => td.innerText.trim())).find(c => c[0] === '52-9724-K-000'));
    ok('현장 재고 표: 기초 0 · 생산 입고 +10 · 기타 −5 · 합계 5', row && row[3] === '0' && row[4] === '+10' && row[6] === '-5' && row[9] === '5', row);
  }

  section('12. 생산 반영: 코드 연결 · 사출 원료 차감 · 조립 BOM 자동 구성 → 부품 차감');
  {
    const base = await ev(() => { const DB = ERP.db;
      DB.addMany('prod_log', [{ date: '2026-10-18', process: 'INJ', division: 'Mini', part: 'holder', code: 'holder', name: 'holder', ok_qty: 5000, ok_ea: 5000, raw_material: 'PP', raw_kg: 50, _t7: 1 },
        { date: '2026-10-18', process: 'INJ', division: 'Mini', part: 'Spoon', code: 'Spoon', name: 'Spoon', ok_qty: 3000, ok_ea: 3000, raw_material: 'TEST RESIN K', raw_kg: 30, _t7: 1 },
        { date: '2026-10-18', process: 'REF', division: 'Mini', code: 'RM01012', name: 'Apricot', remark: 'BM:BM01012', ok_qty: 2000, ok_ea: 2000, _t7: 1 },
        { date: '2026-10-18', process: 'ASM', division: 'Mini', code: 'BM01002', name: 'Red', ok_qty: 1000, ok_ea: 1000, _t7: 1 }]);
      const d = ERP.inv.prodPost().diag; const S = (c) => { const s = ERP.calc.stock().get(c); return s ? { prod: s.prod, use: s.use } : null; };
      const si = ERP.inv.suggestDaily('INJ', 'Mini', 'holder', 'holder')[0], sr = ERP.inv.suggestDaily('REF', 'Mini', 'RM01012', 'Apricot', 'BM:BM01012')[0];
      const ppItem = ERP.inv.rmByName().get('PP');
      return { notItem: Array.from(d.notItem.keys()), raw: Array.from(d.rawUnmatched.keys()), skip: Object.fromEntries(Array.from(d.matSkip.entries()).map(([k, v]) => [k, v.qty])), bm: S('BM01002'), sug: [si.code, si.conf, sr.code, sr.conf], pp: ERP.inv.suggestRaw('PP').map(x => x.code), ppItem: ppItem ? ppItem.code : null, ppUse: ppItem ? S(ppItem.code).use : null, resin: d.resin }; });
    ok('품목코드가 아닌 일보 코드 목록 (INJ Mini holder · REF RM01012)', base.notItem.includes('INJ|Mini|holder') && base.notItem.includes('REF|Mini|RM01012'), base.notItem);
    // 11차: 원부자재는 생산 반영으로 차감하지 않는다 — 사출 원료는 이름만 알아보고 진단(matSkip)에 남긴다
    ok('사출 원료 PP 는 예전 마스터 이름으로 알아보지만 차감하지 않음 → ' + base.ppItem + ' 50 kg 은 진단에만', base.ppItem && !base.ppUse && base.skip[base.ppItem] >= 50 && base.resin === 0, base);
    ok('모르는 원료(TEST RESIN K)도 차감하지 않고 진단에만 (원료 연결 목록 없음)', base.skip['TEST RESIN K'] >= 30 && !base.raw.length, base);
    eq('제안: Mini holder → MH (확실) · RM01012 → RM112 (확실)', base.sug, ['MH', 'high', 'RM112', 'high']);
    ok('제안: PP → R-100 POLYPROPYLENE', base.pp.includes('R-100'), base.pp);
    eq('조립 BM01002 입고 1,000 (BOM 만들기 전)', base.bm.prod, 1000);
    await ev(() => { ERP.goStock('post'); ERP.render(); document.querySelectorAll('main details').forEach(d => { d.open = true; }); }); await page.waitForTimeout(300);
    const clickLink = async (src) => { await page.click(`xpath=//main//tr[td/b[normalize-space()="${src}"]]//button[normalize-space()="연결"]`); await page.waitForTimeout(300); await ev(() => document.querySelectorAll('main details').forEach(d => { d.open = true; })); };
    await clickLink('holder'); await clickLink('RM01012');
    // 11차: 원료 연결 화면은 차감하지 않으므로 나오지 않는다 — 연결(code_map raw)은 진단에 품목코드를 붙일 때만 쓴다
    await ev(() => { ERP.db.add('code_map', { kind: 'raw', src: 'TEST RESIN K', item: 'R-102' }); }); await page.waitForTimeout(100);
    const m = await ev(() => { const S = (c) => { const s = ERP.calc.stock().get(c); return s ? { prod: s.prod, use: s.use } : null; }; const d = ERP.inv.prodPost().diag; return { maps: ERP.db.rows('code_map').map(x => [x.kind, x.proc || '', x.div || '', x.src, x.item].join('/')).sort(), mh: S('MH'), rm112: S('RM112'), r102: S('R-102'), notItem: Array.from(d.notItem.keys()), raw: Array.from(d.rawUnmatched.keys()), skip: Object.fromEntries(Array.from(d.matSkip.entries()).map(([k, v]) => [k, v.qty])), rawUi: Array.from(document.querySelectorAll('main summary')).some(s => /원료 이름 → 원재료/.test(s.textContent)) }; });
    eq('코드 연결 3건 저장', m.maps, ['daily/INJ/Mini/holder/MH', 'daily/REF//RM01012/RM112', 'raw///TEST RESIN K/R-102']);
    eq('연결 후 입고: MH 5,000 · RM112 2,000', [m.mh.prod, m.rm112.prod], [5000, 2000]);
    ok('연결한 원료 R-102 도 차감하지 않음 (진단에 30 kg) · 원료 연결 목록 없음', (!m.r102 || !m.r102.use) && m.skip['R-102'] >= 30 && !m.raw.length && !m.rawUi, [m.r102, m.skip, m.raw, m.rawUi]);
    ok('연결한 코드는 목록에서 사라짐', !m.notItem.includes('INJ|Mini|holder') && !m.notItem.includes('REF|Mini|RM01012'), m.notItem);
    const plan = await ev(() => { const x = ERP.inv.asmPlan().find(p => p.parent === 'BM01002'); return [x.conf, x.parts.map(p => p.role + '=' + p.code + ':' + p.conf)]; });
    eq('BM01002 조립 BOM 제안 = RM102 · AB102 · MH · MS (모두 확실)', plan, ['high', ['refill=RM102:high', 'barrel=AB102:high', 'holder=MH:high', 'spoon=MS:high']]);
    await ev(() => ERP.db.addMany('bom_lines', [{ parent: 'BM01005', child: 'RM105', qty: 2 }]));
    await ev(() => { ERP.state.bomTab = 'asm'; ERP.state.asm = { kind: 'asm', line: '', stat: '', q: '', page: 0 }; ERP.state.params = {}; ERP.goto('bom'); ERP.render(); }); await page.waitForTimeout(400);
    await page.click('main button:has-text("확실한 부품만 모두 적용")'); await page.waitForSelector('.modal'); await page.click('.modal .modal-foot button.primary'); await page.waitForTimeout(800);
    const a = await ev(() => { const L2 = ERP.db.rows('bom_lines'); const S = (c) => { const s = ERP.calc.stock().get(c); return s ? s.use : null; };
      return { auto: L2.filter(l => l.src === 'auto').length, bm: L2.filter(l => l.parent === 'BM01002').map(l => l.child + ':' + l.qty + ':' + l.src).sort(), man: L2.filter(l => l.parent === 'BM01005').map(l => l.child + ':' + l.qty + ':' + (l.src || '')), use: ['RM102', 'AB102', 'MS', 'MH'].map(S), mhIn: ERP.calc.stock().get('MH').prod }; });
    ok('확실한 부품으로 조립 BOM 일괄 적용 (출처 auto)', a.auto > 300, a.auto);
    eq('BM01002 BOM = AB102 · MH · MS · RM102 (1개씩)', a.bm, ['AB102:1:auto', 'MH:1:auto', 'MS:1:auto', 'RM102:1:auto']);
    eq('직접 만든 BOM(BM01005)은 그대로', a.man, ['RM105:2:']);
    eq('조립 1,000 → 부품 차감 RM102 · AB102 · MS · MH 각 1,000 (MH 입고 5,000)', a.use.concat([a.mhIn]), [1000, 1000, 1000, 1000, 5000]);
    await ev(() => { const DB = ERP.db; DB.replace('prod_log', DB.rows('prod_log').filter(r => !r._t7)); DB.replace('code_map', []); DB.replace('bom_lines', []); });
  }

  section('13. 종합 현황 위젯 (추가 · 이동 · 끌어 놓기 · 크기 · 설정 · 빼기 · 저장 · 기본 배치)');
  {
    await ev(() => { ERP.db.setSetting('dash', null); ERP.state.dashEdit = false; ERP.state.dashDate = null; ERP.goto('dashboard'); ERP.render(); }); await page.waitForTimeout(500);
    const d0 = await ev(() => ({ ids: Array.from(document.querySelectorAll('.wgrid > .w')).map(w => w.dataset.id + ':' + w.dataset.w), txt: document.querySelector('.wgrid').innerText }));
    eq('기본 배치 13개 (1.10.1: 월별 조립 생산량)', d0.ids, ['kpi_pck_day:1', 'kpi_pck_month:1', 'kpi_due:1', 'kpi_low:1', 'procs:4', 'asm_daily:4', 'asm_monthly:4', 'po_monthly:2', 'due_list:2', 'low_list:2', 'flow:2', 'fresh:2', 'input7:2']);
    ok('공정별 실적: "설비 (가동 / 전체)"', /설비 \(가동 \/ 전체\)/.test(d0.txt) && !/전체 \/ 가동/.test(d0.txt));
    const asmCard = await ev(() => { const c = Array.from(document.querySelectorAll('.w[data-id=procs] .stage')).find(x => /조립/.test(x.querySelector('.t b').textContent)); return c.querySelectorAll('dd')[1].innerText.replace(/\s+/g, ' ').trim(); });
    const exp = await ev(() => { const ref = ERP.calc.latestProdDate(); const a = ERP.calc.agg(ERP.calc.rowsBetween(ref, ref, 'ASM')); const run = Array.from(a.machines).filter(k => k.indexOf('ASM:') === 0).length; const reg = ERP.db.rows('machines').filter(x => x.process === 'ASM' && x.active !== false).length; return run + ' 대 / ' + Math.max(reg, run) + ' 대'; });
    eq('조립 카드 = 가동 대 / 전체 대', asmCard, exp);
    await page.emulateMedia({ reducedMotion: 'reduce' });   // 편집 모드의 흔들림 애니메이션 끄기 (클릭·끌기 시험용)
    await page.click('main button:has-text("화면 편집")'); await page.waitForTimeout(300);
    eq('편집 모드: 위젯마다 조작 막대', await ev(() => document.querySelectorAll('.wgrid .w .wbar').length), 13);
    await page.click('main button:has-text("위젯 추가")'); await page.waitForSelector('.modal .wgal');
    const gal = await ev(() => ({ items: document.querySelectorAll('.modal .wgal-item').length, added: document.querySelectorAll('.modal .wgal-item.added').length }));
    ok('위젯 목록 (이미 있는 것은 "추가됨", 여러 개 가능한 위젯은 제외)', gal.items >= 20 && gal.added === 11, gal);
    await page.click('.modal .wgal-item:has(b:text-is("공정 실적 (기준일)")) button'); await page.waitForTimeout(400);
    let l = await ev(() => ERP.dashLayout().map(x => x.id)); ok('공정 실적 위젯 추가 (14개)', l.length === 14 && l[13] === 'kpi_proc', l);
    ok('추가한 위젯 = 기준일 조립 실적 (기본 공정 조립)', await ev(() => /기준일 조립 실적/.test(document.querySelector('.wgrid .w[data-id=kpi_proc]').innerText)));
    await page.click('.w[data-id=procs] .wbar .sz button:text-is("2")'); await page.waitForTimeout(300);
    eq('공정별 실적 가로 4 → 2', await ev(() => document.querySelector('.w[data-id=procs]').dataset.w), '2');
    await page.click('.w[data-id=kpi_proc] .wbar button[title="앞으로"]'); await page.waitForTimeout(300);
    l = await ev(() => ERP.dashLayout().map(x => x.id)); eq('◀ 로 한 칸 앞으로', l.slice(11, 14), ['fresh', 'kpi_proc', 'input7']);
    // HTML5 끌어 놓기 (dragstart → dragover(왼쪽 절반) → drop)
    await ev(() => { const src = document.querySelector('.w[data-id=kpi_proc]'), dst = document.querySelector('.w[data-id=kpi_pck_day]'); const dt = new DataTransfer(); const r = dst.getBoundingClientRect(); const at = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 8, clientY: r.top + 20 };
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); dst.dispatchEvent(new DragEvent('dragover', at)); dst.dispatchEvent(new DragEvent('drop', at)); src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); }); await page.waitForTimeout(400);
    l = await ev(() => ERP.dashLayout().map(x => x.id)); eq('끌어서 맨 앞으로 옮기기', l[0], 'kpi_proc');
    await page.click('.w[data-id=kpi_proc] .wbar button[title="위젯 설정"]'); await page.waitForSelector('.modal select');
    await page.selectOption('.modal select', 'PCK'); await page.click('.modal .modal-foot button.primary'); await page.waitForTimeout(300);
    ok('위젯 설정: 공정 → 포장', await ev(() => /기준일 포장 실적/.test(document.querySelector('.wgrid .w[data-id=kpi_proc]').innerText) && ERP.dashLayout()[0].o.proc === 'PCK'));
    await page.click('.w[data-id=due_list] .wbar button.x'); await page.waitForTimeout(300);
    ok('위젯 빼기', await ev(() => !ERP.dashLayout().some(x => x.id === 'due_list')));
    await page.click('main button:has-text("편집 완료")'); await page.waitForTimeout(300);
    await page.reload(); await page.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.wgrid'), null, { timeout: 60000 }); await page.waitForTimeout(500);
    const saved = await ev(() => ({ ids: Array.from(document.querySelectorAll('.wgrid > .w')).map(w => w.dataset.id + ':' + w.dataset.w), n: (ERP.db.setting('dash') || []).length }));
    ok('다시 켜도 배치 그대로 (설정에 저장)', saved.ids[0] === 'kpi_proc:1' && saved.ids.includes('procs:2') && !saved.ids.some(x => /^due_list/.test(x)) && saved.n === 13, saved);
    await page.click('.w[data-id=kpi_low]'); await page.waitForTimeout(300);
    eq('숫자 위젯을 누르면 해당 화면 (안전재고 → 원부자재 재고 · 발주 · 안전재고)', await ev(() => [location.hash, ERP.state.mtab]), ['#/materials', 'reorder']);
    await ev(() => { ERP.goto('dashboard'); ERP.state.dashEdit = true; ERP.render(); }); await page.waitForTimeout(300);
    await page.click('main button:has-text("기본 배치로")'); await page.waitForSelector('.modal'); await page.click('.modal .modal-foot button.primary'); await page.waitForTimeout(400);
    eq('기본 배치로 되돌리기 → 13개', await ev(() => document.querySelectorAll('.wgrid > .w:not(.wadd)').length), 13);
    const all = await ev(() => { const ids = Object.keys(ERP.widgets); const res = []; for (const lang of ['ko', 'vi']) { ERP.lang = lang; ERP.state.dashEdit = false; ERP.dashSave(ids.map((id, i) => ({ k: id + '-t' + i, id, w: ERP.widgets[id].w, o: ERP.widgets[id].defaults }))); ERP.render(); res.push(document.querySelectorAll('.wgrid > .w').length); res.push(Array.from(document.querySelectorAll('.wgrid > .w')).filter(w => /^Error:/.test(w.innerText.split('\n').pop() || '') || /Error: /.test(w.innerText)).length); } ERP.lang = 'ko'; ERP.db.setSetting('dash', null); ERP.render(); return { n: ids.length, res }; });
    ok('위젯 ' + all.n + '종 모두 한/베로 그림 (오류 0)', all.res[0] === all.n && all.res[2] === all.n && all.res[1] === 0 && all.res[3] === 0, all);
  }

  section('14. 일별 조립 생산량 · 월별 수주량(Checking 기준) · 수주 품목군 표 · 생산 관리 기본 보기');
  {
    await ev(() => { ERP.db.setSetting('dash', null); ERP.db.setSetting('poKindsOff', []); ERP.state.dashW = {}; ERP.goto('dashboard'); ERP.render(); }); await page.waitForTimeout(500);
    const t = await ev(() => { const w = document.querySelector('.w[data-id=asm_daily]'); const C = ERP.calc; const ref = C.latestProdDate(); const mm = ref.slice(0, 7);
      const sum = C.rowsBetween(mm + '-01', ref, 'ASM').reduce((a, r) => a + C.qty(r), 0); const all = C.rowsBetween(mm + '-01', ref).reduce((a, r) => a + C.qty(r), 0);
      return { sum, all, tot: +w.querySelector('tr.tot td:nth-child(2)').textContent.replace(/[^\d]/g, ''), title: w.querySelector('h2').textContent, mm, divs: Array.from(w.querySelectorAll('tbody tr:not(.tot) td:first-child')).map(x => x.textContent) }; });
    eq('일별 조립 생산량 합계 = 그 달 조립 일보 합계', t.tot, t.sum); ok('조립만 (전체 공정 합계보다 작음)', t.sum < t.all, [t.sum, t.all]); ok('제목에 조립 · 기준 달', t.title.includes('조립') && t.title.includes(t.mm), t.title);
    ok('품목군 행 (Mini · Dial · Pencil)', ['Mini', 'Dial', 'Pencil'].every(x => t.divs.includes(x)), t.divs);
    await page.click('.w[data-id=asm_daily] .wnav button[aria-label=prev]'); await page.waitForTimeout(300);
    ok('‹ 로 전월 (2026-09)', await ev(() => /2026-09/.test(document.querySelector('.w[data-id=asm_daily] h2').textContent)));
    await page.click('.w[data-id=po_monthly] .seg button:has-text("표")'); await page.waitForTimeout(300);
    const pm = await ev(() => { const w = document.querySelector('.w[data-id=po_monthly]'); const tot = Array.from(w.querySelectorAll('tr.tot td')).map(x => +x.textContent.replace(/[^\d]/g, '')); const dial = Array.from(w.querySelectorAll('tbody tr')).find(tr => tr.querySelector('td b') && tr.querySelector('td b').textContent === 'Dial'); return { tot, dialJan: dial ? +dial.children[1].textContent.replace(/[^\d]/g, '') : null, year: w.querySelector('.wnav b').textContent }; });
    eq('월별 수주량 2026 (Checking 월 · pcs) = 공장 엑셀 PO Sum', [pm.year, pm.tot[1], pm.tot[2], pm.tot[6], pm.tot[10], pm.tot[12], pm.tot[13]], ['2026', 14322024, 11747304, 18233020, 5696664, 1649160, 133848306]);
    eq('Dial 1월 1,781,664', pm.dialJan, 1781664);
    await page.click('.w[data-id=po_monthly] .kchips button:text-is("Dial")'); await page.waitForTimeout(300);
    const pm2 = await ev(() => ({ jan: +document.querySelector('.w[data-id=po_monthly]').querySelectorAll('tr.tot td')[1].textContent.replace(/[^\d]/g, ''), off: ERP.db.setting('poKindsOff') }));
    eq('품목군 Dial 숨김 → 1월 = 14,322,024 − 1,781,664', [pm2.jan, pm2.off], [14322024 - 1781664, ['Dial']]);
    await ev(() => { ERP.state.ordMq = { basis: 'due', from: '2026-01', n: 6, open: {} }; ERP.goto('orders'); ERP.render(); }); await page.waitForTimeout(400);
    const card = () => ev(() => { const c = Array.from(document.querySelectorAll('main section.card')).find(x => /품목군별 수주 수량/.test(x.textContent)); const tr = c.querySelectorAll('tbody tr'); return { kinds: Array.from(c.querySelectorAll('tr.kindrow td:first-child b')).map(b => b.textContent), jan: +tr[tr.length - 1].children[1].textContent.replace(/[^\d]/g, ''), sub: c.querySelectorAll('tr.subrow').length, off: ERP.db.setting('poKindsOff') }; });
    const o1 = await card();
    ok('수주 관리 표 = 품목군 행 · Dial 숨김 상태를 같이 씀', !o1.kinds.includes('Dial') && o1.kinds.includes('Mini') && o1.kinds.includes('Pencil'), o1.kinds); eq('수주 표 1월 합계 = 위젯과 같음', o1.jan, 14322024 - 1781664);
    await page.click('main .kchips button:text-is("Dial")'); await page.waitForTimeout(300);
    await page.click('main tr.kindrow:has-text("Mini")'); await page.waitForTimeout(300);
    const o2 = await card();
    ok('Mini 를 누르면 품번별로 펼침 · Dial 다시 보임', o2.sub > 0 && o2.kinds.includes('Dial') && o2.off.length === 0, o2);
    await ev(() => { ERP.state.prodTab = 'analysis'; ERP.state.pan = null; ERP.goto('production'); ERP.render(); }); await page.waitForTimeout(400);
    const pa = await ev(() => ({ h: Array.from(document.querySelectorAll('main h2')).map(x => x.textContent).join(' | '), st: ERP.state.pan }));
    ok('생산 관리 → 일별 생산수량: 기본 = 조립 · 품목군별', /일별 조립 생산수량/.test(pa.h) && pa.st.proc === 'ASM' && pa.st.by === 'division', pa);
  }

  section('15. 예시 데이터 = 행 단위 표시 · 예시 행만 한 번에 삭제');
  {
    const a = await ev(() => { const DB = ERP.db; ERP.goto('production'); ERP.render();
      const chip = (document.querySelector('main .label-sample') || {}).textContent || '';
      const po = DB.rows('po').find(r => r._ex && r.po_no); DB.update('po', po._id, { remarks: 'checked' });   // PO 번호가 있는 줄 (8차: 예전에는 첫 줄이 데이터로 들어간 머리글 행이었다)
      return { ex: ERP.sampleCount('prod_log'), all: DB.rows('prod_log').length, chip, po: ERP.sampleCount('po'), poAll: DB.rows('po').length }; });
    eq('생산일보: 예시 21,631행 + 새로 넣은 2행 (8차: 중복 일보 46행 정리)', [a.ex, a.all], [21631, 21633]); ok('화면 표시 "예시 21,631행 포함"', /21,631/.test(a.chip), a.chip);
    eq('손으로 고친 PO 1행은 예시에서 빠짐 (8차: 머리글 행 정리 → 521줄)', [a.po, a.poAll], [520, 521]);
    await ev(() => { ERP.goto('settings'); ERP.render(); }); await page.waitForTimeout(200);
    await page.click('main button:has-text("예시 데이터 한 번에 삭제")'); await page.waitForSelector('.modal');
    const unchecked = await ev(() => Array.from(document.querySelectorAll('.modal label')).filter(l => !l.querySelector('input').checked).map(l => l.textContent.split(' (')[0].trim()));
    eq('BOM 차감에 쓰는 예시 표 3개는 기본 해제 (11차: 배합표는 차감에 안 씀)', unchecked.length, 3);
    await page.click('.modal .modal-foot button.danger'); await page.waitForTimeout(400);
    const b = await ev(() => { const DB = ERP.db; return { prod: DB.rows('prod_log').length, po: DB.rows('po').length, inout: DB.rows('inout').length, items: DB.rows('items').length, open: DB.rows('stock_open').length, tx: DB.rows('stock_tx').length, fg: ERP.calc.stock().get('52-9724-K-000').by.FAC, left: ['po', 'prod_log', 'bom', 'recipes', 'materials', 'inout'].filter(t => ERP.isSample(t)), up: DB.rows('uploads').slice(-1)[0] }; });
    eq('삭제 후: 일보 2 · PO 1 (고친 행) · 입출고장 0', [b.prod, b.po, b.inout], [2, 1, 0]); eq('ECOUNT 품목·기초재고 · 수불은 그대로', [b.items, b.open, b.tx], [2265, 1276, 6]);
    eq('새 일보의 생산 반영은 그대로 (FG 공장 640)', b.fg, 640); eq('남은 예시 = 색상별 BOM (BOM 차감용으로 남김 · 11차: 배합표는 지움)', b.left, ['bom']); ok('업로드 이력에 삭제 행 수', b.up && b.up.kind === 'sample_delete' && b.up.removed > 30000, b.up);
  }

  section('16. 5차에서 쓰던 데이터 폴더 → 6차 첫 실행 (자동 보강)');
  {
    // a 5th-version data folder: the old sample tables + one row the user typed in, no ECOUNT tables, meta.seeded only
    const v5 = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/seed/seed.json'), 'utf8')); const d5 = tmp('erp-v5-'); fs.mkdirSync(path.join(d5, 'tables'));
    Object.keys(v5._meta.sample).forEach((t, i) => { const rows = (v5[t] || []).map((r, k) => Object.assign({ _id: 'v5' + i + '_' + k }, r)); if (t === 'po') rows.push({ _id: 'mine1', po_no: 'MY-PO-1', customer: 'Real Co', date: '2026-10-15', due: '2026-11-20', item_no: 'X1', cs: 3 }); fs.writeFileSync(path.join(d5, 'tables', t + '.json'), JSON.stringify(rows)); });
    fs.writeFileSync(path.join(d5, 'meta.json'), JSON.stringify({ seeded: '2026-10-15T01:00:00.000Z', lowCover: 7 }));
    const S5 = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir: d5, host: '127.0.0.1', port: 4650 + Math.floor(Math.random() * 100) });
    const p5 = await browser.newPage(); const e5 = []; p5.on('pageerror', e => e5.push(e.message));
    const open5 = async () => { await p5.goto(S5.url + '/#/materials'); await p5.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 120000 }); await p5.waitForTimeout(600); };
    await open5();
    const r = await p5.evaluate(() => { const D = ERP.db; const s = ERP.calc.stock().get('R-001'); return { items: D.rows('items').length, wh: D.rows('warehouses').length, codes: D.rows('code_dict').length, open: D.rows('stock_open').length, po: D.rows('po').length, poEx: ERP.sampleCount('po'), mine: D.rows('po').some(x => x.po_no === 'MY-PO-1' && !x._ex), v6: !!D.meta.v6, keep: D.meta.lowCover, mode: ERP.inv.prodMode(), r001: s ? [s.by.WH, s.by.FAC] : null }; });
    eq('품목 · 창고 · 코드 · 기초재고 보강', [r.items, r.wh, r.codes, r.open], [2265, 11, 34, 1276]); eq('PO 522 = 예시 521 + 직접 넣은 1 (예시 아님)', [r.po, r.poEx, r.mine], [522, 521, true]);
    ok('업그레이드 표시 · 기존 설정 유지 · 생산 반영 기본값', r.v6 && r.keep === 7 && r.mode === 'in_bom', r); eq('R-001 창고/공장', r.r001, [1695, -790.53]);
    await open5(); eq('다시 켜도 한 번만 (품목 2,265 · 기초재고 1,276)', await p5.evaluate(() => [ERP.db.rows('items').length, ERP.db.rows('stock_open').length]), [2265, 1276]);
    ok('업그레이드 전 원본 자동 백업 (backup/날짜/po.json)', fs.readdirSync(path.join(d5, 'backup')).some(d => fs.existsSync(path.join(d5, 'backup', d, 'po.json'))));
    ok('업그레이드 화면 오류 0', e5.length === 0, e5); await p5.close(); S5.close();
  }

  section('16-2. 이전 버전(6차 1.1.0) 데이터 폴더 → 이 버전 첫 실행 (ERP_PREV = 이전 프로그램 폴더)');
  if (!process.env.ERP_PREV || !fs.existsSync(path.join(process.env.ERP_PREV, 'server.js'))) console.log('  (건너뜀: 환경 변수 ERP_PREV 에 이전 버전 소스 폴더를 주면 실제 업그레이드를 시험합니다)');
  else {
    const PREV = process.env.ERP_PREV; const dP = tmp('erp-prev-'); const prevMod = require(path.join(PREV, 'server.js'));
    const SP = await prevMod.start({ appDir: path.join(PREV, 'app'), dataDir: dP, host: '127.0.0.1', port: 4760 + Math.floor(Math.random() * 100) });
    const q = await browser.newPage(); const eP = []; q.on('pageerror', e => eP.push(e.message));
    await q.goto(SP.url + '/#/materials'); await q.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 120000 }); await q.waitForTimeout(600);
    const before = await q.evaluate(async () => { const D = ERP.db;
      D.add('bom_lines', { parent: 'BM01002', child: 'RM102', qty: 1, note: 'prev-manual' });
      D.add('stock_tx', { date: '2026-10-17', kind: 'IN', to_scope: 'WH', code: 'R-001', qty: 5, note: 'prev-tx' });
      D.setSetting('lowCover', 9);
      await new Promise(r => setTimeout(r, 1200)); while (D.pending) await new Promise(r => setTimeout(r, 100));
      return { v: ERP.v, items: D.rows('items').length, open: D.rows('stock_open').length, po: D.rows('po').length }; });
    await q.close(); SP.close();
    const SN = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir: dP, host: '127.0.0.1', port: 4860 + Math.floor(Math.random() * 100) });
    const q2 = await browser.newPage(); const eN = []; q2.on('pageerror', e => eN.push(e.message));
    await q2.goto(SN.url + '/#/dashboard'); await q2.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.wgrid'), null, { timeout: 120000 }); await q2.waitForTimeout(800);
    const after = await q2.evaluate(() => { const D = ERP.db; const INV = ERP.inv; const plan = INV.asmPlan();
      ERP.goStock('post'); ERP.render(); const postOk = !!document.querySelector('main .kpis');
      ERP.state.bomTab = 'asm'; ERP.goto('bom'); ERP.render(); const asmOk = document.querySelectorAll('main table.tbl tbody tr').length > 0;
      return { v: ERP.v, items: D.rows('items').length, open: D.rows('stock_open').length, po: D.rows('po').length, widgets: ERP.dashLayout().length,
        manual: D.rows('bom_lines').filter(r => r.note === 'prev-manual' && !r.src).length, tx: D.rows('stock_tx').filter(r => r.note === 'prev-tx').length, keep: D.meta.lowCover,
        maps: D.rows('code_map').length, plan: plan.length, mode: INV.prodMode(), postOk, asmOk }; });
    console.log('  이전 ' + before.v + ' → 이번 ' + after.v);
    eq('이전 버전 자료 그대로 (품목 · 기초재고 · PO)', [after.items, after.open, after.po], [before.items, before.open, before.po]);
    eq('직접 만든 BOM 줄 · 수불 · 설정 유지', [after.manual, after.tx, after.keep], [1, 1, 9]);
    ok('새 기능 바로 사용: 위젯 기본 배치 13 · 코드 연결 0 · 조립 BOM 제안 · 생산 반영/조립 BOM 화면', after.widgets === 13 && after.maps === 0 && after.plan > 100 && after.postOk && after.asmOk && after.mode === 'in_bom', after);
    ok('업그레이드 화면 오류 0 (이전 · 이번)', eP.length === 0 && eN.length === 0, eP.concat(eN).slice(0, 5)); await q2.close(); SN.close();
  }

  section('17. 데모 (file://) — 서버 없이');
  {
    const out = require('child_process').execSync('node ' + path.join(ROOT, 'tools/build_demo.js'), { cwd: ROOT }).toString(); console.log('  ' + out.trim());
    const p2 = await browser.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(e.message));
    await p2.goto('file://' + path.join(ROOT, 'dist/ERP_Demo.html') + '#/materials'); await p2.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready, null, { timeout: 120000 }); await p2.waitForTimeout(800);
    const r = await p2.evaluate(() => { const a = document.querySelectorAll('.flow .st').length; ERP.goStock('floor'); ERP.render(); const b = document.querySelectorAll('main .fpiv-card table.fpiv-t tbody tr').length, bs = document.querySelectorAll('.flow .st').length; ERP.goto('dashboard'); ERP.render(); return { mode: ERP.db.mode, items: ERP.db.rows('items').length, open: ERP.db.rows('stock_open').length, flow: [a, b > 0 && bs === 0], widgets: document.querySelectorAll('.wgrid .w').length }; });
    eq('데모: 브라우저 모드 · 품목 · 기초재고 · 흐름 카드(원부자재 3 · 현장 재고는 피벗 표) · 위젯 13', [r.mode, r.items, r.open, r.flow, r.widgets], ['local', 2265, 1276, [3, true], 13]); ok('데모 오류 0', e2.length === 0, e2);
  }

  section('18. 저장 표시 · 닫기 전 저장 · 베트남어 빈 글자');
  {
    await ev(() => { ERP.goto('orders'); ERP.render(); }); await page.waitForTimeout(300);
    // 같은 표를 빠르게 3번 고침 → 저장 1번, '저장 중…' 이 남지 않아야 한다
    const r = await ev(async () => { const D = ERP.db; for (let i = 0; i < 50 && D.pending; i++) await new Promise(res => setTimeout(res, 100)); const po = D.rows('po').find(x => x.po_no); D.update('po', po._id, { remarks: 'q1' }); D.update('po', po._id, { remarks: 'q2' }); D.update('po', po._id, { remarks: 'q3' });
      const during = D.pending; await new Promise(res => setTimeout(res, 1600)); return { id: po._id, during, after: D.pending, label: document.querySelector('.side').innerText }; });
    ok('빠른 수정 3번 → 대기 1 → 저장 후 0 · "저장됨"', r.during === 1 && r.after === 0 && /저장됨/.test(r.label) && !/저장 중/.test(r.label), r);
    const fileRow = () => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'tables', 'po.json'), 'utf8')).find(x => x._id === r.id); } catch (e) { return null; } };
    eq('서버 파일에 마지막 값', (fileRow() || {}).remarks, 'q3');
    // 닫기 직전 수정: flush() 가 0.7초를 기다리지 않고 바로 저장
    const f = await ev(async (id) => { const D = ERP.db; D.update('po', id, { remarks: 'before-close' }); const had = D.hasPending(); const n = await D.flush(); return { had, n, left: D.hasPending(), pending: D.pending }; }, r.id);
    ok('flush: 대기 중인 표를 바로 저장', f.had && f.n === 1 && !f.left && f.pending === 0, f); eq('flush 직후 서버 파일', (fileRow() || {}).remarks, 'before-close');
    const l = await ev(() => { ERP.setLang('vi'); const out = [L('건', ''), L('개', ' mã'), L('품목'), L('a', undefined), L('a', null)]; ERP.setLang('ko'); return out.concat([L('건', '')]); });
    eq("L(ko, '') = 베트남어에서 빈 글자 · 번역 없으면 한국어", l, ['', ' mã', '품목', 'a', 'a', '건']);
  }

  ok('전체 페이지 오류 0', errors.length === 0, errors.slice(0, 8));
  await browser.close(); S.close();
  console.log('\n' + (fail ? '✗ 실패 ' + fail + '건' : '✓ 모두 통과') + '  (통과 ' + pass + ' / 전체 ' + (pass + fail) + ')');
  if (fail) { console.log(failures.map(f => ' - ' + f).join('\n')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
