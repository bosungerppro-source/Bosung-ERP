'use strict';
/* 11차(v1.6.0) 자동 시험: 공정 중(현장) 재고 · 원부자재 분리 · 배럴 계열 · BOM 사용량(배합표) 교체
   1 단계 규칙 (WIP21·x1 = 배럴 계열) · 2 생산 반영은 현장 재고만 차감 (원료 · 사출 수지 · 부자재는 안 건드림) ·
   3 조립 BOM 자동 구성의 배럴 = WIP11 · WIPx1 · WIP01 · 4 현장 재고(TỒN KHO) 올리기 · 다시 올리기 ·
   5 ECOUNT 재고현황과 분리 (현장 실사 기준일 따로) · 6 BOM 사용량(배합표) 올리기 · 최신 판으로 교체 · 7 예전 자료 업그레이드 · 8 오류 없음
   사용:  npm run test:v11   (Playwright 필요: npm i -D playwright 또는 playwright-core + 설치된 Chrome/Edge) */
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
let pw; try { pw = require('playwright'); } catch (e) { try { pw = require('playwright-core'); } catch (e2) { console.error('Playwright가 필요합니다 / cần Playwright:  npm i -D playwright'); process.exit(2); } }
const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const serverMod = require(path.join(ROOT, 'server.js'));

let pass = 0, fail = 0; const failures = [];
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 600 ? s.slice(0, 600) + '…' : s; };
function ok(name, cond, detail) { if (cond) { pass++; return true; } fail++; const line = name + (detail !== undefined ? '  → ' + short(detail) : ''); failures.push(line); console.log('  ✗ ' + line); return false; }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
async function sec(t, fn) { console.log('\n■ ' + t); try { await fn(); } catch (e) { ok(t + ' — 예외', false, String((e && e.message) || e).split('\n')[0].slice(0, 300)); } }
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** 현장 재고 엑셀 (TỒN KHO) 흉내: 시트마다 회사명 · 머리글 · 품목 · TOTAL. Injection 시트에는 부자재(SM) 한 줄 */
function floorBook(sets) {
  const wb = XLSX.utils.book_new();
  Object.keys(sets).forEach(name => {
    const rows = sets[name]; const tot = rows.reduce((a, r) => a + (typeof r[4] === 'number' ? r[4] : 0), 0);
    const aoa = [['Tên công ty : BOSUNG VINA CO'], ['Mã mặt hàng', 'Tên mặt hàng', 'ERP CODE', 'Thông số', 'SẢN XUẤT']].concat(rows, [['TOTAL', null, null, null, tot]]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  });
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}
/** BOM 사용량 (components): code · item code · color · 향기오일(글자) · 원료 g/개 … · 빈 열 이름(열5) */
function usageBook(rows) {
  const hdr = ['code', 'item code', 'color', '향기오일', 'Paraffin Wax', 'Stearic Acid', '열5', 'Scent oil (4%)', 'Carmine 6B', null];
  const ws = XLSX.utils.aoa_to_sheet([hdr].concat(rows)); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'components');
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

(async () => {
  const dataDir = tmp('erp-v11-');
  const S = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir, host: '127.0.0.1', port: 5600 + Math.floor(Math.random() * 300), backupDelay: 3600000 });
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 } });
  const A = await ctx.newPage(); A.on('pageerror', e => errors.push('pageerror: ' + e.message));
  A.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Failed to fetch/.test(m.text())) errors.push('console: ' + m.text()); });
  const ready = () => A.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 180000 });
  await A.goto(S.url + '/#/materials'); await ready();

  // 빈 상태에서 시험용 품목만 넣는다 (예시 자료 없이 숫자를 정확히 본다)
  await A.evaluate(async () => {
    const DB = ERP.db; await DB.wipe();
    const it = (code, erp, name, unit) => ({ code, erp_code: erp, name, unit: unit || 'PCS', src: 'ecount' });
    DB.replace('items', [
      it('WAX1', 'RM-WAX-WAX1', 'PARAFFIN WAX', 'kg'), it('PP1', 'RM-EP-PP1', 'POLYPROPYLENE', 'kg'), it('CASE1', 'SM-PCASE-MINI-CASE1', 'PLASTIC CASE'),
      it('RM102', 'WIP00-MINI-CRA-RM102', 'RED'), it('BM02', 'WIP01-MINI-BRR-BM02', 'RED'), it('AB102', 'WIP11-MINI-HF-AB102', 'RED'),
      it('MH', 'WIP03-MINI-HD-MH', 'MINI HOLDER'), it('MS', 'WIP04-MINI-SP-MS', 'MINI SPOON'), it('BM01002', 'WIP-MINI-CRA-BM01002', 'RED'),
      it('AC105', 'WIP21-MINI-HF-AC105', 'RED ORANGE'), it('BM05', 'WIP01-MINI-BRR-BM05', 'RED ORANGE'), it('RM105', 'WIP00-MINI-CRA-RM105', 'RED ORANGE'), it('BM01005', 'WIP-MINI-CRA-BM01005', 'RED ORANGE')]
      .map(r => ERP.inv.classify(r)));
    await DB.flush();
  });

  // ------------------------------------------------------------------------------------------
  await sec('1. 단계 규칙: WIP11 · WIP21 · WIPx1 = 배럴 (WIP01) 계열', async () => {
    const r = await A.evaluate(() => { const I = ERP.inv; const st = (e) => I.parse(e).stage;
      return { w21: st('WIP21-MINI-HF-AC105'), w31: st('WIP31-REG-HF-X1'), w11: st('WIP11-MINI-HF-AB102'), w01: st('WIP01-MINI-BRR-BM02'), w55: st('WIP55-CPC-ASSY-CPCL004A'), w15: st('WIP15-CPC-TRAY-X'), w06: st('WIP06-CPC-SYS-CPLEAD'),
        barrel: ['WIP01', 'WIP11', 'WIPx1', 'WIP02'].map(s => I.isBarrel(s)), floor: I.groupOf({ stage: 'WIPx1' }), inproc: ['WIPx1', 'WIP', 'WIP55', 'SG', 'FG', 'RM'].map(s => I.inProcess(s)),
        floorStages: I.FLOOR_STAGES.includes('WIPx1'), item: I.info(I.item('AC105')).stage };
    });
    eq('WIP21 · WIP31 → 배럴 계열 (WIPx1), WIP11 · WIP01 · WIP55 · WIPx5 · WIPx6 는 그대로', [r.w21, r.w31, r.w11, r.w01, r.w55, r.w15, r.w06], ['WIPx1', 'WIPx1', 'WIP11', 'WIP01', 'WIP55', 'WIPx5', 'WIPx6']);
    eq('배럴 계열 = WIP01 · WIP11 · WIPx1 (노즈콘 아님)', r.barrel, [true, true, true, false]);
    ok('WIPx1 은 현장 재고 · 공정 중 단계', r.floor === 'floor' && r.floorStages && r.item === 'WIPx1', r);
    eq('공정 중(현장 실사 대상) = WIP 단계만 (마니라 · 박스 · 원재료 아님)', r.inproc, [true, true, true, false, false, false]);
  });

  // ------------------------------------------------------------------------------------------
  await sec('2. 생산 반영: BOM 에서는 현장 재고만 차감 — 원부자재는 절대 안 건드림', async () => {
    const r = await A.evaluate(async () => {
      const DB = ERP.db, I = ERP.inv, C = ERP.calc; const D0 = '2026-10-20', D1 = '2026-10-21';
      DB.meta.openDate = { WH: D0, FAC: D0 }; await DB.saveMeta();
      DB.replace('stock_open', ['WAX1', 'PP1', 'CASE1', 'RM102', 'BM02', 'AB102', 'MH', 'MS'].map(code => ({ date: D0, scope: 'FAC', code, qty: 5000 })));
      // 직접 만든 BOM: 조립품 = 심 + 스탬핑 배럴 + 홀더 + 스푼 + (잘못 넣은) 부자재 케이스 · 스탬핑 배럴 = 배럴 · 심 = 원료(왁스, 원재료)
      DB.replace('bom_lines', [['BM01002', 'RM102'], ['BM01002', 'AB102'], ['BM01002', 'MH'], ['BM01002', 'MS'], ['BM01002', 'CASE1'], ['AB102', 'BM02'], ['RM102', 'WAX1']].map(([parent, child]) => ({ parent, child, qty: 1 })));
      // 예전 방식의 배합표 차감 경로(색상 BOM → 배합표)도 원료를 건드리면 안 된다
      DB.replace('bom', [{ color_code: 'BM01005', refill_code: 'RM105' }]); DB.replace('recipes', [{ code: 'BM01005', material: 'PARAFFIN WAX', coef: 1.2 }]);
      DB.replace('code_map', [{ kind: 'raw', src: 'POLYPROPYLENE', item: 'PP1' }, { kind: 'raw', src: 'PARAFFIN WAX', item: 'WAX1' }]);
      DB.replace('prod_log', [
        { date: D1, process: 'ASM', code: 'BM01002', ok_qty: 1000, ok_ea: 1000, source: 'daily-report' },
        { date: D1, process: 'STP', code: 'AB102', ok_qty: 200, ok_ea: 200, source: 'daily-report' },
        { date: D1, process: 'INJ', code: 'BM05', ok_qty: 500, ok_ea: 500, raw_material: 'POLYPROPYLENE', raw_kg: 12, source: 'daily-report' },
        { date: D1, process: 'INJ', code: 'BM02', ok_qty: 0, ok_ea: 0, ng_qty: 30, raw_material: 'POLYPROPYLENE', raw_kg: 3, source: 'daily-report' },
        { date: D1, process: 'REF', code: 'RM102', ok_qty: 800, ok_ea: 800, source: 'daily-report' },
        { date: D1, process: 'REF', code: 'RM105', ok_qty: 300, ok_ea: 300, source: 'daily-report' }]);
      await DB.flush();
      const pp = I.prodPost(); const use = pp.rows.filter(t => t.kind === 'USE'); const prod = pp.rows.filter(t => t.kind === 'PROD');
      const S = C.stock(); const bal = (c) => S.get(c).bal;
      return { prod: prod.map(t => t.code + ':' + t.qty).sort(), use: use.map(t => t.code + ':' + t.qty).sort(),
        matUse: use.filter(t => I.groupOf(Object.assign({ m: I.item(t.code) }, I.info(I.item(t.code)))) === 'mat').length,
        bal: ['WAX1', 'PP1', 'CASE1', 'RM102', 'BM02', 'AB102', 'MH', 'MS', 'BM01002', 'BM05', 'RM105'].map(c => c + ':' + bal(c)),
        skip: Array.from(pp.diag.matSkip.entries()).map(([k, v]) => k + ':' + v.n).sort(), resin: pp.diag.resin, raw: pp.diag.rawUnmatched.size, mode: I.PROD_MODES().find(x => x.v === 'in_bom').label };
    });
    // 1.13.16 (사용자 "생산관리에서 핫포일 스탬핑 전부 삭제 생산 품목에 넣지 않는다"): 핫포일 스탬핑 일보 (AB102 200) 는 입고 · 차감하지 않는다
    eq('생산 입고: 조립 · 사출 · 리필은 현장 재고에 들어감, 핫포일 스탬핑 일보는 안 들어감 (1.13.16) (불량만 있는 사출 행은 입고 0)', r.prod, ['BM01002:1000', 'BM05:500', 'RM102:800', 'RM105:300']);
    eq('차감: 조립 → 심 · 스탬핑 배럴 (BOM 그대로) · 홀더 · 스푼, 핫포일 스탬핑 일보는 차감 없음 (현장 재고만)', r.use, ['AB102:1000', 'MH:1000', 'MS:1000', 'RM102:1000']);
    eq('원부자재 차감 행 0', r.matUse, 0);
    eq('원재료 · 사출 수지 · 부자재 재고는 기초 그대로 (5,000)', r.bal.slice(0, 3), ['WAX1:5000', 'PP1:5000', 'CASE1:5000']);
    eq('현장 재고: 기초 5,000 + 입고 − 차감 (배럴 BM02 · 스탬핑 배럴 AB102 는 스탬핑 일보로 바뀌지 않음)', r.bal.slice(3), ['RM102:4800', 'BM02:5000', 'AB102:4000', 'MH:4000', 'MS:4000', 'BM01002:1000', 'BM05:500', 'RM105:300']);
    eq('건너뛴 원부자재 차감이 진단에 남음 (부자재 케이스 · 원료 왁스 · 사출 수지 2행 · 배합표 왁스)', r.skip, ['CASE1:1', 'PP1:2', 'WAX1:2']);
    ok('사출 수지 차감 0 · 원료 이름 연결 목록 비어 있음', r.resin === 0 && r.raw === 0, r);
    ok('반영 방식 이름: 현장 부품만 차감', /현장/.test(r.mode) && !/자재 차감/.test(r.mode), r.mode);
  });

  // ------------------------------------------------------------------------------------------
  await sec('3. 조립 BOM 자동 구성: 배럴 = 배럴 (WIP01) 만 (1.13.16 — 핫포일 스탬핑은 생산 공정이 아님, 11차의 WIP11 · WIPx1 먼저는 없앰)', async () => {
    const r = await A.evaluate(async () => {
      ERP.db.replace('bom', []); await ERP.db.flush();   // 2 단락의 예시 색상 BOM(배럴 없음) 이 제안을 막지 않게
      const plan = ERP.inv.asmPlan(); const p = (c) => plan.find(x => x.parent === c);
      const bar = (c) => { const x = p(c); const b = x && x.parts.find(q => q.role === 'barrel'); return b ? b.code + ':' + b.conf : null; };
      return { red: bar('BM01002'), redOrange: bar('BM01005'), roles: ERP.inv.ASM_ROLES.find(x => x.role === 'barrel').st };
    });
    eq('배럴 후보: 배럴 (WIP01) 만', r.roles, ['WIP01']);
    eq('같은 색 스탬핑 배럴 (WIP11 AB102) 이 있어도 배럴 (RED → BM02)', r.red, 'BM02:high');
    eq('같은 색 배럴 계열 (WIP21 AC105) 이 있어도 배럴 (RED ORANGE → BM05)', r.redOrange, 'BM05:high');
  });

  // ------------------------------------------------------------------------------------------
  const assy = [['BM01002', 'RED', 'WIP-MINI-CRA-BM01002', '', 22300], ['BM01005', 'RED ORANGE', 'WIP-MINI-CRA-BM01005', '', 1000], ['NEW01', 'NEW PEN', 'WIP-REG-CRA-NEW01', '', 7000]];
  const refill = [['RM102', 'RED', 'WIP00-MINI-CRA-RM102', '', 169193], ['RM105', 'RED ORANGE', 'WIP00-MINI-CRA-RM105', '', 104989]];
  const inj = [['04-1421-0-900', 'PURPLE PLASTIC CASE', 'SM-PCASE-CPC-04-1421-0-900', '', 500], ['BM02', 'RED', 'WIP01-MINI-BRR-BM02', '', 31280], ['MH', 'MINI HOLDER', 'WIP03-MINI-HD-MH', '', 2109518], ['SP002', 'RASPBERRY', 'WIP04-PEN-SP-SP002', 'Spoon Pencil', 62769]];
  await sec('4. 현장 재고(TỒN KHO) 올리기 — 공정 중 부품 · 조립 색연필', async () => {
    const b64 = floorBook({ Assy: assy, Refill: refill, Injection: inj });
    const r = await A.evaluate(async (b64) => {
      const XL = ERP.xl, DB = ERP.db; const wb = XLSX.read(b64, { type: 'base64' });
      const jobs = XL.analyze(wb, {}); jobs.forEach(j => { j.file = 'TỒN KHO 20.10.2026.xlsx'; if (j.onFile) j.onFile(j); });
      const info = jobs.map(j => ({ sheet: j.sheet, id: j.id, custom: j.custom, date: j.date, rows: j.rows.length, include: j.include, mode: j.mode, pv: j.preview ? j.preview(j) : null }));
      const res = jobs.map(j => XL.apply(j)); await DB.flush();
      const fl = DB.rows('stock_open').filter(r => r.grp === 'floor'); const S = ERP.calc.stock();
      return { info, res, floorRows: fl.length, scopes: Array.from(new Set(fl.map(r => r.scope))), date: DB.meta.openDate.FLOOR, created: DB.rows('items').filter(x => x.src === 'floor').map(x => x.code + ':' + ERP.inv.info(x).stage),
        open: ['BM01002', 'NEW01', 'RM102', 'BM02', 'MH', 'SP002', 'WAX1'].map(c => c + ':' + (S.get(c) ? S.get(c).openTot : 'none')), smStock: DB.rows('stock_open').filter(r => r.code === '04-1421-0-900').length,
        od: ERP.inv.openDateFor(ERP.inv.item('BM02')), odRaw: ERP.inv.openDateFor(ERP.inv.item('WAX1')) };
    }, b64);
    eq('시트 3개 모두 현장 재고로 인식 (기준일 = 파일 이름 20.10.2026)', r.info.map(j => [j.sheet, j.id, j.custom, j.date, j.rows, j.include]),
      [['Assy', 'floor_count', 'floor', '2026-10-20', 3, true], ['Refill', 'floor_count', 'floor', '2026-10-20', 2, true], ['Injection', 'floor_count', 'floor', '2026-10-20', 3, true]]);
    const pvI = r.info[2].pv;
    ok('미리보기: 원본 TOTAL 과 비교 · 부자재(SM) 1행은 제외로 표시', pvI && pvI.parts.some(p => /제외/.test(p[0]) && p[1] === 1) && pvI.parts.some(p => /TOTAL|합계/.test(p[0])), pvI);
    eq('현장 재고 행 8 (TOTAL · 부자재 제외) · 공장 범위', [r.floorRows, r.scopes], [8, ['FAC']]);
    eq('현장 실사 기준일 저장', r.date, '2026-10-20');
    eq('없던 품목은 ERP CODE 로 만들어짐', r.created, ['NEW01:WIP', 'SP002:WIP04']);
    eq('기초 = 현장 실사 수량 (원재료는 그대로)', r.open, ['BM01002:22300', 'NEW01:7000', 'RM102:169193', 'BM02:31280', 'MH:2109518', 'SP002:62769', 'WAX1:5000']);
    eq('부자재 케이스는 재고에 넣지 않음', r.smStock, 0);
    eq('공정 중 품목의 기준일 = 현장 실사일, 원재료 = 공장 기준일', [r.od, r.odRaw], [{ WH: '2026-10-20', FAC: '2026-10-20' }, { WH: '2026-10-20', FAC: '2026-10-20' }]);
  });

  await sec('4-2. 다시 올리기: 새 실사 파일이 이전 현장 재고를 바꿈', async () => {
    const b64 = floorBook({ Assy: [['BM01002', 'RED', 'WIP-MINI-CRA-BM01002', '', 12000]], Refill: refill.slice(0, 1) });
    const r = await A.evaluate(async (b64) => {
      const XL = ERP.xl, DB = ERP.db; const jobs = XL.analyze(XLSX.read(b64, { type: 'base64' }), {}); jobs.forEach(j => { j.file = 'TON KHO 25-10-2026.xlsx'; if (j.onFile) j.onFile(j); });
      jobs.forEach(j => XL.apply(j)); await DB.flush(); const S = ERP.calc.stock();
      return { rows: DB.rows('stock_open').filter(r => r.grp === 'floor').map(r => r.code + ':' + r.qty).sort(), date: DB.meta.openDate.FLOOR, mh: S.get('MH').openTot, bm: S.get('BM01002').openTot };
    }, b64);
    eq('이전 파일의 행은 모두 빠지고 새 파일 2행만', r.rows, ['BM01002:12000', 'RM102:169193']);
    eq('기준일 갱신 · 새 파일에 없는 공정 품목은 0', [r.date, r.mh, r.bm], ['2026-10-25', 0, 12000]);
  });

  // ------------------------------------------------------------------------------------------
  await sec('5. 원부자재 재고(ECOUNT)와 분리: 현장 실사 기준일 · 기초는 따로', async () => {
    const r = await A.evaluate(async () => {
      const DB = ERP.db, EC = ERP.ecount, I = ERP.inv; const XL = ERP.xl;
      // ECOUNT 공장 재고현황 (10-16): 원재료 + 공정 품목이 섞여 있음
      const job = EC.stockJob([{ code: 'WAX1', qty: 900 }, { code: 'PP1', qty: 400 }, { code: 'BM02', qty: 99999 }, { code: 'BM01002', qty: 88888 }], { scopeLabel: '공장', date: '2026-10-16' });
      job.scope = 'FAC'; job.mode = 'open'; const pv = job.preview(job); XL.apply(job);
      DB.replace('stock_tx', [{ date: '2026-10-18', kind: 'MOVE', from_scope: 'WH', to_scope: 'FAC', code: 'WAX1', qty: 50, src: 'test' }, { date: '2026-10-18', kind: 'ADJ', to_scope: 'FAC', code: 'BM02', qty: 7, src: 'test' }, { date: '2026-10-26', kind: 'ADJ', to_scope: 'FAC', code: 'BM02', qty: 3, src: 'test' }]);
      DB.replace('prod_log', [{ date: '2026-10-18', process: 'ASM', code: 'BM01002', ok_qty: 100, ok_ea: 100, source: 'daily-report' }, { date: '2026-10-26', process: 'ASM', code: 'BM01002', ok_qty: 10, ok_ea: 10, source: 'daily-report' }]);
      await DB.flush(); const S = ERP.calc.stock();
      return { floorKept: DB.rows('stock_open').filter(r => r.grp === 'floor').length, dates: I.opening().date, wax: [S.get('WAX1').openTot, S.get('WAX1').bal], pp: S.get('PP1').bal,
        bm02: [S.get('BM02').openTot, S.get('BM02').bal], bm: [S.get('BM01002').openTot, S.get('BM01002').bal], post: I.prodPost().rows.filter(t => t.kind === 'PROD').map(t => t.date + ':' + t.code + ':' + t.qty),
        pvNote: pv.detail, led: I.ledger('BM01002').rows.map(x => x.kind + ':' + (x.bal)) };
    });
    eq('ECOUNT 공장 재고를 기초로 설정해도 현장 재고 행은 그대로', r.floorKept, 2);
    eq('기준일: 공장 10-16 (원부자재) · 현장 10-25 (공정 중)', [r.dates.FAC, r.dates.FLOOR], ['2026-10-16', '2026-10-25']);
    eq('원재료: ECOUNT 기초 900 + 10-18 이동 50', r.wax, [900, 950]);
    eq('사출 수지: ECOUNT 기초 400 그대로', r.pp, 400);
    eq('배럴(공정 중): ECOUNT 숫자는 무시, 현장 실사 0 + 10-26 조정 3 (10-18 조정은 실사 이전)', r.bm02, [0, 3]);
    eq('조립품: 현장 실사 12,000 + 10-26 조립 10 (10-18 조립은 실사 이전)', r.bm, [12000, 12010]);
    eq('생산 반영 행도 품목의 기준일 이후만', r.post, ['2026-10-26:BM01002:10']);
    ok('ECOUNT 미리보기: 공정 중 품목은 현장 실사 기준이라고 알림', /현장/.test(r.pvNote || ''), r.pvNote);
    ok('수불부: 기초(현장 실사) → 조립 입고', r.led[0] === 'OPEN:12000' && r.led[r.led.length - 1] === 'PROD:12010', r.led);
  });

  // ------------------------------------------------------------------------------------------
  await sec('6. BOM 사용량(배합표) 올리기 · 최신 판으로 교체', async () => {
    const v1 = usageBook([
      ['BM01002', '52-9724-7-938', 'Red', null, 0.997, 0.2381, 0, 0, 0.0744],
      ['BM01005', '52-9724-7-937', 'Red Orange', null, 0.9911, 0.2367, 0, 0, 0],
      ['BM02E001', '52-9630-7-052', 'Gray', null, 0.843, 0.2013, 0, 0.0881, 0],
      ['BM02E001', '52-9630-7-052', 'Gray', 'Blueberry 2523-CRAY, OS', 0.9375, 0.2239, 0, null, 0],
      ['RB002', null, 'Red Orange', null, 1.1, 0, 0, 0, 0.5]]);
    const r = await A.evaluate(async (b64) => {
      const XL = ERP.xl, DB = ERP.db; DB.replace('recipes', [{ code: 'OLD1', material: 'Old wax', coef: 9 }]);
      const jobs = XL.analyze(XLSX.read(b64, { type: 'base64' }), {}); jobs.forEach(j => { j.file = 'bom 사용량.xlsx'; if (j.onFile) j.onFile(j); });
      const j = jobs[0]; const pv = j.preview ? j.preview(j) : null; const res = XL.apply(j); await DB.flush();
      const rec = DB.rows('recipes'); const of = (c) => rec.filter(r => r.code === c).map(r => r.material + '=' + r.coef).sort();
      return { id: j.id, mode: j.mode, modes: Object.keys(j.modes()), pv, res, n: rec.length, old: of('OLD1'), red: of('BM01002'), dup: of('BM02E001'), note: (rec.find(r => r.code === 'BM02E001') || {}).note || null,
        sku: (rec.find(r => r.code === 'RB002') || {}).sku, src: DB.meta.recipeSrc, use: ERP.inv.prodPost().rows.filter(t => t.kind === 'USE' && ['WAX1', 'PP1'].includes(t.code)).length };
    }, v1);
    eq('인식: 배합표 (BOM 사용량) · 기본 = 전체 교체', [r.id, r.mode, r.modes], ['recipes_usage', 'replace', ['replace', 'upsert']]);
    eq('예전 배합표는 지워짐 (전체 교체)', r.old, []);
    eq('원료 열마다 1행 (0 · 빈 칸 · 빈 열 이름 · 열5 제외)', r.red, ['Carmine 6B=0.0744', 'Paraffin Wax=0.997', 'Stearic Acid=0.2381']);
    eq('같은 코드가 두 번: 첫 행 사용', r.dup, ['Paraffin Wax=0.843', 'Scent oil (4%)=0.0881', 'Stearic Acid=0.2013']);
    eq('향기오일 이름은 비고로', r.note, 'Blueberry 2523-CRAY, OS');
    eq('행 수: 3 + 2 + 3 + 2', r.n, 10);
    ok('item code 가 비어 있으면 SKU 없음', r.sku === undefined || r.sku === null || r.sku === '', r.sku);
    ok('출처 기록: 파일 · 품목 수 · 중복 코드', r.src && r.src.file === 'bom 사용량.xlsx' && r.src.products === 4 && JSON.stringify(r.src.dups) === '["BM02E001"]' && r.src.at, r.src);
    ok('미리보기: 품목 수 · 중복 코드 안내', r.pv && r.pv.parts.some(p => /중복/.test(p[0]) && p[1] === 1), r.pv);
    eq('배합표가 있어도 원재료 차감 0', r.use, 0);
    // 최신 판: 값이 바뀌고 품목이 빠짐 → 통째로 바뀜
    const v2 = usageBook([['BM01002', '52-9724-7-938', 'Red', null, 1.01, 0.24, 0, 0, 0.07]]);
    const r2 = await A.evaluate(async (b64) => {
      const XL = ERP.xl, DB = ERP.db; const jobs = XL.analyze(XLSX.read(b64, { type: 'base64' }), {}); jobs.forEach(j => { j.file = 'bom 사용량 2026-11.xlsx'; });
      XL.apply(jobs[0]); await DB.flush(); return { codes: Array.from(new Set(DB.rows('recipes').map(r => r.code))), wax: DB.rows('recipes').find(r => r.material === 'Paraffin Wax').coef, src: DB.meta.recipeSrc.file };
    }, v2);
    eq('최신 판으로 통째 교체', [r2.codes, r2.wax, r2.src], [['BM01002'], 1.01, 'bom 사용량 2026-11.xlsx']);
  });

  // ------------------------------------------------------------------------------------------
  await sec('7. 예전 자료 업그레이드: 저장된 단계가 ETC 인 WIP21 품목', async () => {
    await A.evaluate(async () => { const DB = ERP.db; DB.add('items', { code: 'AC201', erp_code: 'WIP21-MINI-HF-AC201', name: 'BRICK RED', stage: 'ETC', src: 'ecount' }); delete DB.meta.v11; await DB.saveMeta(); await DB.flush(); });
    await A.reload(); await ready();
    const r = await A.evaluate(() => ({ st: ERP.inv.info(ERP.inv.item('AC201')).stage, v11: !!ERP.db.meta.v11 }));
    eq('다시 열면 WIP21 품목이 배럴 계열(WIPx1)로 바뀜', [r.st, r.v11], ['WIPx1', true]);
  });

  // ------------------------------------------------------------------------------------------
  await sec('8. 화면 · 오류 없음', async () => {
    for (const tab of ['floor', 'mat', 'post']) { await A.evaluate((t) => { ERP.state.matTab = t; ERP.render(); }, tab); await A.waitForTimeout(400); }
    const t = await A.evaluate(() => document.querySelector('#main').innerText);
    ok('생산 반영 탭: 원부자재는 차감하지 않는다는 안내', /원부자재/.test(t) && /차감하지 않/.test(t), t.slice(0, 300));
    await A.evaluate(() => { ERP.state.matTab = 'floor'; ERP.render(); }); await A.waitForTimeout(300);
    const f = await A.evaluate(() => document.querySelector('#main').innerText);
    ok('현장 재고 메뉴: 현장 실사 기준일 표시', /2026-10-25|25\/10|10-25/.test(f) && /실사/.test(f), f.slice(0, 400));
    await A.evaluate(() => ERP.goto('bom', { tab: 'recipes' })); await A.waitForTimeout(500);
    const b = await A.evaluate(() => document.querySelector('#main').innerText);
    ok('배합표 탭: 지금 쓰는 파일 이름', /bom 사용량 2026-11\.xlsx/.test(b), b.slice(0, 300));
    eq('페이지 오류 없음', errors, []);
  });

  await browser.close(); S.close();
  console.log('\n' + (fail ? '✗ 실패 ' + fail + '개' : '✓ 모두 통과') + '  (통과 ' + pass + ' / 전체 ' + (pass + fail) + ')');
  if (failures.length) { console.log('\n실패 목록:'); failures.forEach(x => console.log(' - ' + x)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
