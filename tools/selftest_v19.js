'use strict';
/* 19차 (v1.14.0) 자동 시험: 생산 계획 (plan.js · p_plan.js · 기준 자료 표 · 양식 올리기 · AI 비서 production_plan)
   사용자 2026-11-03 "생산 케파나 인원등 수주대비 언제 작업이 끝나고 뭐가 얼마나 필요할지 …" → "채워넣긴했는데 … 생산일보 보면서 너가 생각해줘" → "네, 만들어 줘".
   시험 자료 (손으로 계산한 값과 맞춤): 매일 일함 (일요일 쉼 끔) · 일보 10일 (사출 10,000 · 리필 5,000 · 조립 Mini 2,000 · Dial 1,000 · 권취 500 · 포장 2,400 pcs/일)
     수주 (납기 순) X (−10일, 이미 지남) · G (Glass, BOM 없음, +3) · C (Dial, +5) · B (+10) · N (PO 없음 = PO미정, +40) · A (+60) · H (보류 — 빠짐)
     Mini 카톤 CT-M = 세트 12 · 세트 = 조립 색연필 24 (현장 재고 4,800) · 색연필 = 배럴 (사출 · 원료 0.002 kg) + 심 (리필) · 케이스 · 카톤 = 부자재
   1 일보 → 하루 능력 (똑같은 줄 · 누적 이력과 같은 날 일보 · 앞날 줄 빼기, Regular = Dial) · 2 BOM 풀이 · 공정별 부하 · 현장 재고 · 3 끝나는 날 · 출고 가능일 · 판정 · 병목
   4 확정 PO 만 · 5 자재 (처음 모자라는 수주 · 필요한 날 · 리드타임 · 입고 예정) · 6 기준 자료 (조 수 · 하루 능력 직접 · 쉬는 날 · 기다리는 날 · 불량률) · 7 확인할 것
   8 화면 (탭 · 범위 · 판정 거르기 · 리드타임 칸 · 기준 자료 칸 · 쉬는 날 넣기) · 9 생산계획_기준자료_양식 올리기 · 10 AI 비서 (도구 · 내장 모드) · 11 엑셀 · 12 베트남어 · 오류 없음
   13 Codex 검토 (1.14.2): 하루씩 공정을 같이 돌리기 (앞 공정이 내준 만큼만 · 아직 못 하는 수주는 뒤 수주를 막지 않음) · 불량률이 부품 · 자재로 · 달력 조 수 0 · 오늘 전 필요한 날
      · (고친 코드의 Codex 검토) 조립 품목군이 둘인 수주의 자재는 그 품목군 진행으로 · 800 근무일 안에 다 못 쓴 나머지도 셈
   14 자재 구분 골라 보기 (1.15.2, 사용자 "원자재 부자재 소모품 반제품 이런식으로 선택해서 표시"): 구분 = 품목 마스터 단계 → 품목구분 · 품목에 없는 코드 따로 · 단추 · 알림 · 엑셀 · AI 비서
   사용:  npm run test:v19   (Playwright 필요: npm i -D playwright 또는 playwright-core + 설치된 Chrome/Edge) */
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
let pw; try { pw = require('playwright'); } catch (e) { try { pw = require('playwright-core'); } catch (e2) { console.error('Playwright가 필요합니다 / cần Playwright:  npm i -D playwright'); process.exit(2); } }
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const serverMod = require(path.join(ROOT, 'server.js'));

let pass = 0, fail = 0; const failures = [];
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 700 ? s.slice(0, 700) + '…' : s; };
function ok(name, cond, detail) { if (cond) { pass++; return true; } fail++; const line = name + (detail !== undefined ? '  → ' + short(detail) : ''); failures.push(line); console.log('  ✗ ' + line); return false; }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
async function sec(t, fn) { console.log('\n■ ' + t); try { await fn(); } catch (e) { ok(t + ' — 예외', false, String((e && e.message) || e).split('\n')[0].slice(0, 300)); } }
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

(async () => {
  const dataDir = tmp('erp-v19-');
  const S = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir, host: '127.0.0.1', port: 7700 + Math.floor(Math.random() * 250), backupDelay: 3600000 });
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 } });
  const A = await ctx.newPage(); A.on('pageerror', e => errors.push('pageerror: ' + e.message));
  A.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Failed to fetch/.test(m.text())) errors.push('console: ' + m.text()); });
  const ready = () => A.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 180000 });
  const ev = (fn, arg) => A.evaluate(fn, arg);
  const settle = () => A.waitForTimeout(350);
  await A.goto(S.url + '/#/home'); await ready();
  const T0 = await ev(() => ERP.fmt.today());
  const D = (n) => { const d = new Date(T0 + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  // ---------------- 시험 자료 ----------------
  await ev(async (o) => { const DB = ERP.db; await DB.wipe(); ERP.setLang('ko');
    const it = (code, name, stage, line, unit, x) => Object.assign({ code, name, stage, line: line || undefined, unit: unit || 'PCS', src: 'test' }, x || {});
    DB.replace('items', [it('CT-M', 'MINI 24 CARTON', 'FG', 'MINI', 'CT'), it('SET-M', 'MINI 24 SET', 'SG', 'MINI', 'SET'), it('PEN-M', 'MINI PEN', 'WIP', 'MINI'), it('BRL-M', 'MINI BARREL', 'WIP01', 'MINI'), it('LEAD-M', 'MINI CORE', 'WIP00', 'MINI'),
      it('RES-1', 'RESIN', 'RM', '', 'kg'), it('CASE-M', 'MINI CASE', 'SM'), it('CTN-M', 'CARTON MINI', 'SM'),
      it('CT-D', 'DIAL 24 CARTON', 'FG', 'REG', 'CT'), it('SET-D', 'DIAL 24 SET', 'SG', 'REG', 'SET'), it('PEN-D', 'DIAL PEN', 'WIP', 'REG'), it('X-UNK', 'DIAL PART', 'WIP02', 'REG')]);
    const bl = (parent, child, qty, note) => ({ parent, child, qty, note });
    DB.replace('bom_lines', [bl('CT-M', 'SET-M', 12, '포장'), bl('CT-M', 'CTN-M', 1, '포장'), bl('SET-M', 'PEN-M', 24, '조립'), bl('SET-M', 'CASE-M', 1, '포장'),
      bl('PEN-M', 'BRL-M', 1, '사출'), bl('PEN-M', 'LEAD-M', 1, '리필 성형'), bl('BRL-M', 'RES-1', 0.002, '원료 kg (MRP 소요량)'),
      bl('CT-D', 'SET-D', 12, '포장'), bl('SET-D', 'PEN-D', 24, '조립'), bl('PEN-D', 'X-UNK', 1, '')]);
    DB.replace('stock_open', [{ date: o.FLOOR, scope: 'FAC', code: 'PEN-M', qty: 4800, unit: 'PCS', grp: 'floor' }, { date: o.EC, scope: 'WH', code: 'CASE-M', qty: 1000, unit: 'PCS' }, { date: o.EC, scope: 'WH', code: 'RES-1', qty: 5, unit: 'kg' }]);
    DB.replace('stock_tx', []);
    const po = (po_no, item_no, kind, sets, due, x) => Object.assign({ date: o.EC, customer: 'TEST', po_no, item_no, kind, color: 24, sets, pcs: sets * 24, cs: 0, due, packed: 0 }, x || {});
    DB.replace('po', [po('PO-X', 'CT-M', 'Mini', 120, o.x), po('PO-G', 'GLS-1', 'Glass', 100, o.g, { pcs: 10000, color: 0 }), po('PO-C', 'CT-D', 'Dial', 600, o.c), po('PO-B', 'CT-M', 'Mini', 2400, o.b),
      po(undefined, 'CT-M', 'Mini', 240, o.n, { condition: 'PO 미정' }), po('PO-A', 'CT-M', 'Mini', 1200, o.a), po('PO-H', 'CT-M', 'Mini', 500, o.h, { condition: 'Di hold' })]);
    // 일보 10일 (어제까지): 누적 이력 (history) + 조립 같은 날 일보 줄 1개 (빠져야 함) + 똑같은 줄 1개 (한 번만) + 앞날 줄 1개 (빠져야 함)
    const pl = []; o.days.forEach(d => {
      pl.push({ date: d, process: 'INJ', shift: 'D', machine_no: '1', ok_qty: 10000, ok_ea: 10000, source: 'history' }, { date: d, process: 'REF', shift: 'D', machine_no: '1', ok_qty: 5000, ok_ea: 5000, source: 'history' },
        { date: d, process: 'ASM', shift: 'D', machine_no: '1', division: 'Mini', ok_qty: 2000, ok_ea: 2000, source: 'history' }, { date: d, process: 'ASM', shift: 'D', machine_no: '1', division: 'Regular', ok_qty: 1000, ok_ea: 1000, source: 'history' },
        { date: d, process: 'WRP', shift: 'D', machine_no: '1', division: 'Glass', ok_qty: 500, ok_ea: 500, source: 'history' }, { date: d, process: 'PCK', shift: 'D', machine_no: '1', ok_qty: 100, ok_ea: 2400, source: 'history' }); });
    pl.push(Object.assign({}, pl[2]));   // 똑같은 줄 (조립 Mini)
    pl.push({ date: o.days[0], process: 'ASM', shift: 'D', machine_no: '2', division: 'Mini', ok_qty: 999, ok_ea: 999, source: 'daily-report' });   // 누적 이력과 같은 날의 일보 줄
    pl.push({ date: o.fut, process: 'WRP', shift: 'D', machine_no: '1', division: 'Glass', ok_qty: 777, ok_ea: 777, source: 'daily-report' });   // 앞날 날짜
    DB.replace('prod_log', pl);
    ['plan_proc', 'plan_cal', 'plan_wait', 'machines', 'buy_orders'].forEach(t => DB.replace(t, []));
    DB.meta.openDate = { WH: o.EC, FAC: o.EC, FLOOR: o.FLOOR }; DB.meta.prodPost = 'off'; DB.meta.planSunOff = false; DB.meta.buyLead = ''; DB.meta.seeded = DB.meta.seeded || new Date().toISOString();
    await DB.saveMeta(); await DB.flush(); },
  { FLOOR: D(-40), EC: D(-60), x: D(-10), g: D(3), c: D(5), b: D(10), n: D(40), a: D(60), h: D(15), days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(k => D(-k)), fut: D(30) });
  // 일요일이 아닌 k번째 날 · 일요일 (양식의 근무 달력 시험)
  const nonSun = (k) => { let n = 0; for (let i = 1; i < 60; i++) if (new Date(D(i) + 'T00:00:00').getDay() !== 0 && ++n === k) return D(i); };
  const sunAfter = (from) => { for (let i = from; i < from + 8; i++) if (new Date(D(i) + 'T00:00:00').getDay() === 0) return D(i); };

  const run = (scope) => ev((s) => { const R = ERP.plan.run(s); const r1 = (x) => (x === null || x === undefined ? x : Math.round(x * 100) / 100);
    return { orders: R.orders.map(o => ({ po: o.po, item: o.item, rem: o.rem, none: o.none, judge: o.judge, ship: o.ship, slack: o.slack, limit: o.limit, F: { INJ: o.F.INJ, REF: o.F.REF, ASM: o.F.ASM, WRP: o.F.WRP, PCK: o.F.PCK }, asmEff: o.asmEff, pckEff: o.pckEff,
      load: { INJ: r1(o.acc.INJ), REF: r1(o.acc.REF), WRP: r1(o.acc.WRP), PCK: r1(o.acc.pck), asm: o.acc.asm }, bom: o.acc.bom })),
      loads: R.loads.map(l => [l.id, r1(l.load), r1(l.perDay), r1(l.days), l.end, l.src]), bottle: R.bottle && R.bottle.id, counts: R.counts, last: R.lastShip, rem: R.remSets,
      mats: R.mats.map(m => ({ code: m.code, via: m.via, need: r1(m.need), stock: r1(m.stock), inc: r1(m.inc), short: r1(m.short), first: m.first && [m.first.po, m.first.date], lead: m.lead, orderBy: m.orderBy, judge: m.judge, arrive: m.arrive })),
      unknown: R.unknown, fromStock: R.fromStock, notes: R.notes.map(n => n.k), noteText: R.notes.map(n => n.k + ': ' + n.text) }; }, scope);
  const cap = () => ev(() => { const c = ERP.plan.capacity(); return { from: c.from, to: c.to, days: c.days, perDay: c.perDay, famDay: c.famDay, src: c.src, famSrc: c.famSrc, histN: c.histN, dup: c.dup, daily: c.daily, future: c.future, futureList: c.futureList, pckSetsDay: c.pckSetsDay }; });

  // ------------------------------------------------------------------------------------------
  await sec('1. 생산 일보 → 하루 능력 (똑같은 줄 · 누적 이력과 같은 날 일보 · 앞날 줄 빼기)', async () => {
    const c = await cap();
    eq('기간 = 마지막 일보 (어제) − 91일 ~ 어제', [c.to, c.from], [D(-1), D(-92)]);
    eq('일한 날 = 10 (공정마다)', c.days, { INJ: 10, REF: 10, ASM: 10, WRP: 10, PCK: 10 });
    eq('하루 능력 = 일보 실적 ÷ 일한 날 (조립 = Mini + Dial)', c.perDay, { INJ: 10000, REF: 5000, WRP: 500, PCK: 2400, ASM: 3000 });
    eq('조립 품목군 (Regular = Dial)', c.famDay, { Mini: 2000, Dial: 1000 });
    eq('빠진 줄: 똑같은 줄 1 · 누적 이력과 같은 날 일보 1 · 앞날 1 (권취)', [c.dup, c.daily, c.future, c.futureList], [1, 1, 1, [{ proc: 'WRP', date: D(30), rows: 1 }]]);
    eq('그동안 하루 조 수 = 1 · 출처 = 일보 실적', [c.histN.ASM, c.src.INJ, c.famSrc.Mini], [1, 'log', 'log']);
    eq('포장 하루 실적 (set)', c.pckSetsDay, 100);
  });

  let R1;
  await sec('2. BOM 풀이 → 공정별 남은 일 (현장 재고는 납기 이른 수주부터, 보류 줄 빠짐)', async () => {
    R1 = await run('all');
    eq('수주 줄 = 납기 순 X · G · C · B · (PO미정) · A — 보류 H 빠짐', R1.orders.map(o => o.po), ['PO-X', 'PO-G', 'PO-C', 'PO-B', 'PO미정', 'PO-A']);
    eq('PO미정 줄 표시', R1.orders.map(o => o.none), [false, false, false, false, true, false]);
    const X = R1.orders[0], B = R1.orders[3];
    eq('X: 조립 색연필 2,880 = 현장 재고 4,800 에서 → 포장만 2,880 pcs', [X.load.INJ, X.load.REF, X.load.asm, X.load.PCK], [0, 0, {}, 2880]);
    eq('B: 57,600 중 남은 현장 재고 1,920 을 쓰고 55,680 = 조립 Mini · 사출 · 리필', [B.load.asm, B.load.INJ, B.load.REF, B.load.PCK], [{ Mini: 55680 }, 55680, 55680, 57600]);
    eq('G (Glass, BOM 없음) = pcs 로 권취 · 포장', [R1.orders[1].load.WRP, R1.orders[1].load.PCK, R1.orders[1].bom], [10000, 10000, false]);
    eq('C (Dial) = 조립 Dial 14,400 · 공정 모르는 X-UNK', [R1.orders[2].load.asm, R1.unknown], [{ Dial: 14400 }, { 'X-UNK': 14400 }]);
    eq('현장 재고에서 쓴 양', R1.fromStock, 4800);
    eq('공정별 남은 일 · 하루 · 근무일 · 끝나는 날', R1.loads, [['INJ', 90240, 10000, 9.02, D(9), 'log'], ['REF', 90240, 5000, 18.05, D(18), 'log'], ['ASM|Mini', 90240, 2000, 45.12, D(45), 'log'], ['ASM|Dial', 14400, 1000, 14.4, D(14), 'log'],
      ['WRP', 10000, 500, 20, D(19), 'log'], ['PCK', 119440, 2400, 49.77, D(49), 'log']]);
    eq('가장 막히는 공정 = 포장', R1.bottle, 'PCK');
  });

  await sec('3. 끝나는 날 · 출고 가능일 · 판정 (공정 사이 1일 · 포장 → 출고 1일)', async () => {
    const by = Object.fromEntries(R1.orders.map(o => [o.po, o]));
    eq('X: 포장 내일 → 출고 모레 · 이미 납기 지남', [by['PO-X'].pckEff, by['PO-X'].ship, by['PO-X'].judge, by['PO-X'].slack], [D(1), D(2), 'past', -12]);
    eq('G: 권취 +19 → 포장 +20 → 출고 +21 · 지연 예상 · 끝 = 권취', [by['PO-G'].F.WRP, by['PO-G'].pckEff, by['PO-G'].ship, by['PO-G'].judge, by['PO-G'].limit], [D(19), D(20), D(21), 'late', 'WRP']);
    eq('C: 조립 Dial +14 → 포장 +15 → 출고 +16 · 끝 = 조립', [by['PO-C'].F.ASM, by['PO-C'].pckEff, by['PO-C'].ship, by['PO-C'].judge, by['PO-C'].limit], [D(14), D(15), D(16), 'late', 'ASM']);
    eq('B: 사출 +5 · 리필 +11 · 조립 +28 (사출 · 리필이 낸 것은 다음 날부터 — 첫날 쉼) · 포장 +35 → 출고 +36 · 지연 예상 · 끝 = 포장', [by['PO-B'].F.INJ, by['PO-B'].F.REF, by['PO-B'].F.ASM, by['PO-B'].pckEff, by['PO-B'].ship, by['PO-B'].judge, by['PO-B'].limit], [D(5), D(11), D(28), D(35), D(36), 'late', 'PCK']);
    eq('PO미정: 출고 +38 · 납기 +40 → 빠듯함 (2일)', [by['PO미정'].ship, by['PO미정'].judge, by['PO미정'].slack], [D(38), 'tight', 2]);
    eq('A: 출고 +50 · 납기 +60 → 여유 (10일)', [by['PO-A'].ship, by['PO-A'].judge, by['PO-A'].slack], [D(50), 'ok', 10]);
    eq('판정 수 · 전부 출고 · 남은 set', [R1.counts, R1.last, R1.rem], [{ late: 3, tight: 1, ok: 1, past: 1, nodue: 0, na: 0 }, D(50), 4660]);
  });

  await sec('4. 확정 PO 만 (PO미정 뺌)', async () => {
    const R = await run('firm');
    eq('줄 · 판정 · A 출고 +48 (PO미정 이 빠져 앞당겨짐)', [R.orders.length, R.counts, R.orders.find(o => o.po === 'PO-A').ship, R.orders.find(o => o.po === 'PO-A').slack], [5, { late: 3, tight: 0, ok: 1, past: 1, nodue: 0, na: 0 }, D(48), 12]);
    eq('포장 남은 일 113,680', R.loads.find(l => l[0] === 'PCK')[1], 113680);
  });

  await sec('5. 자재: 처음 모자라는 수주 · 필요한 날 · 리드타임 · 입고 예정', async () => {
    const m = Object.fromEntries(R1.mats.map(x => [x.code, x]));
    eq('케이스: 필요 3,960 · 재고 1,000 · 처음 모자람 = B 포장이 쓴 케이스가 재고를 넘는 날 (+20, 하루씩 쓴 양) · 리드타임 없음', [m['CASE-M'].need, m['CASE-M'].stock, m['CASE-M'].short, m['CASE-M'].first, m['CASE-M'].judge], [3960, 1000, 2960, ['PO-B', D(20)], 'nolead']);
    eq('카톤: 재고 0 → X 의 포장 시작 (오늘)', [m['CTN-M'].need, m['CTN-M'].first], [330, ['PO-X', T0]]);
    eq('원료: 사출 원료 180.48 kg (B · PO미정 · A) · 재고 5', [m['RES-1'].via, m['RES-1'].need, m['RES-1'].stock, m['RES-1'].first], ['INJ', 180.48, 5, ['PO-B', T0]]);
    // 리드타임 → 판정
    const judge = async (lead) => { await ev(async (v) => { const DB = ERP.db; const it = DB.rows('items').find(i => i.code === 'CASE-M'); DB.update('items', it._id, { lead_days: v }); await DB.flush(); }, lead); return (await run('all')).mats.find(x => x.code === 'CASE-M'); };
    let x = await judge(3); eq('리드타임 3 → 발주 마감 +17 · 여유', [x.lead, x.orderBy, x.judge], [3, D(17), 'ok']);
    x = await judge(15); eq('리드타임 15 → 발주 마감 +5 · 이번 주 발주', [x.orderBy, x.judge], [D(5), 'week']);
    x = await judge(25); eq('리드타임 25 → 늦음 · 지금 발주하면 +25 도착', [x.orderBy, x.judge, x.arrive], [D(-5), 'late', D(25)]);
    // 입고 예정 (해외 주문: 도착 예정일까지 온 것만)
    await ev(async (o) => { const DB = ERP.db; DB.replace('buy_orders', [{ date: o.today, code: 'CASE-M', kind: 'inc', qty: 2000, unit: 'PCS', status: 'open', eta: o.eta, src: 'erp' }, { date: o.today, code: 'CASE-M', kind: 'inc', qty: 9999, unit: 'PCS', status: 'recv', eta: o.eta, src: 'erp' }]); await DB.flush(); }, { today: T0, eta: D(5) });
    x = (await run('all')).mats.find(y => y.code === 'CASE-M');
    eq('입고 예정 2,000 (+5 도착, 받은 주문은 빼고) → 처음 모자람 = A 포장이 쓴 케이스가 3,000 을 넘는 날 (+40) · 모자람 960', [x.inc, x.first, x.short], [2000, ['PO-A', D(40)], 960]);
    await ev(async () => { ERP.db.replace('buy_orders', []); await ERP.db.flush(); });
  });

  await sec('6. 기준 자료: 조 수 · 하루 능력 직접 · 쉬는 날 · 기다리는 날 · 불량률', async () => {
    const at = (R, po) => R.orders.find(o => o.po === po);
    await ev(async () => { const DB = ERP.db; DB.add('plan_proc', { process: 'ASM', shifts: 2 }); await DB.flush(); });
    let c = await cap(); eq('조립 2조 → Mini 4,000 · Dial 2,000 (일보 × 2 ÷ 1)', c.famDay, { Mini: 4000, Dial: 2000 });
    let R = await run('all'); eq('C: 조립 Dial +7 → 포장은 조립이 내주는 대로 +8 → 출고 +9', [at(R, 'PO-C').F.ASM, at(R, 'PO-C').ship], [D(7), D(9)]);
    await ev(async () => { const DB = ERP.db; DB.add('plan_proc', { process: 'ASM', division: 'Dial', cap_day: 3600 }); DB.add('plan_proc', { process: 'WRP', cap_day: 1000 }); await DB.flush(); });
    c = await cap(); eq('직접 넣은 하루 능력 (Dial 3,600 · 권취 1,000) 이 이김', [c.famDay.Dial, c.famSrc.Dial, c.perDay.WRP, c.src.WRP], [3600, 'manual', 1000, 'manual']);
    R = await run('all'); eq('G: 권취 +9 → 출고 +11', [at(R, 'PO-G').F.WRP, at(R, 'PO-G').ship], [D(9), D(11)]);
    // 쉬는 날 (내일 · 모레) → X 의 포장 (근무일 2개째) = +3 → 출고 +4
    await ev(async (o) => { const DB = ERP.db; DB.addMany('plan_cal', [{ date: o.a, work: false, memo: '휴무' }, { date: o.b, work: false }]); await DB.flush(); }, { a: D(1), b: D(2) });
    R = await run('all'); eq('쉬는 날 2일 → X 포장 +3 · 출고 +4', [at(R, 'PO-X').pckEff, at(R, 'PO-X').ship], [D(3), D(4)]);
    // 일요일 쉼 (기본) 을 켜면 근무일에서 일요일이 빠진다
    const sun = await ev(async () => { ERP.db.setSetting('planSunOff', true); const R = ERP.plan.run('all'); const ws = R.workDays.slice(0, 30); const r = { sunday: ws.some(d => new Date(d + 'T00:00:00').getDay() === 0) }; ERP.db.setSetting('planSunOff', false); return r; });
    eq('일요일 쉼 → 근무일에 일요일 없음', sun, { sunday: false });
    // 기다리는 날: 포장 → 출고 3일
    await ev(async () => { const DB = ERP.db; DB.add('plan_wait', { from: 'PCK', to: 'OUT', days: 3 }); await DB.flush(); });
    R = await run('all'); eq('포장 → 출고 3일 → X 출고 = 포장 +3 뒤 근무일 3개 (+6)', at(R, 'PO-X').ship, D(6));
    // 불량률 10% → 포장 일 1/0.9
    await ev(async () => { const DB = ERP.db; DB.add('plan_proc', { process: 'PCK', defect_pct: 10 }); await DB.flush(); });
    R = await run('all'); eq('포장 불량률 10% → X 포장 3,200 pcs', at(R, 'PO-X').load.PCK, 3200);
    // 되돌림
    await ev(async () => { const DB = ERP.db; ['plan_proc', 'plan_cal', 'plan_wait'].forEach(t => DB.replace(t, [])); const it = DB.rows('items').find(i => i.code === 'CASE-M'); DB.update('items', it._id, { lead_days: undefined }); await DB.flush(); });
    eq('되돌리면 처음 계산과 같음', (await run('all')).counts, R1.counts);
  });

  await sec('7. 확인할 것', async () => {
    const R = await run('all');
    ['dup', 'future', 'last', 'past', 'none', 'nobom', 'unknown', 'nolead', 'base', 'holiday', 'people'].forEach(k => ok('확인할 것에 ' + k, R.notes.includes(k), R.notes));
    ok('겹친 줄 · 앞날 글', /똑같은 일보 줄 1줄 · 누적 이력과 같은 날의 일보 줄 1줄/.test(R.noteText.find(t => /^dup/.test(t))) && R.noteText.find(t => /^future/.test(t)).includes(D(30)), R.noteText);
    // 설비 기준 최대와 일보 실적이 크게 다르면 (일보가 잘못 들어갔을 수 있음)
    await ev(async () => { const DB = ERP.db; DB.replace('machines', [{ process: 'INJ', machine_no: '1', active: true, per_shift: 200000 }, { process: 'ASM', machine_no: '1', division: 'Mini', active: true, per_shift: 2500 }, { process: 'ASM', machine_no: '2', division: 'Mini', active: false, per_shift: 9999 }]); await DB.flush(); });
    const R2 = await ev(() => { const R = ERP.plan.run('all'); return { odd: R.notes.filter(n => /^odd/.test(n.k)).map(n => [n.k, n.tone]), mach: R.cap.mach, machFam: R.cap.machFam, load: R.loads.find(l => l.id === 'ASM|Mini').mach }; });
    eq('사출 실적 10,000 = 설비 기준 200,000 의 5% → 확인 (빨강) · 사용 안 하는 설비는 빼고 Mini 2,500', [R2.odd, R2.mach.INJ, R2.machFam.Mini, R2.load], [[['odd:INJ', 'bad']], 200000, 2500, 2500]);
    await ev(async () => { ERP.db.replace('machines', []); await ERP.db.flush(); });
  });

  await sec('8. 화면 (메뉴 · 숫자 카드 · 탭 · 범위 · 판정 거르기 · 리드타임 칸 · 기준 자료 칸 · 쉬는 날 넣기)', async () => {
    await ev(() => { ERP.state.plan = null; location.hash = '#/plan'; }); await settle(); await ev(() => ERP.render()); await settle();
    const head = await ev(() => ({ nav: Array.from(document.querySelectorAll('.side .nav a')).map(a => (a.querySelector('span') || a).textContent.trim()), h1: document.querySelector('.page-head h1').textContent, kpi: Array.from(document.querySelectorAll('.kpis .kpi')).map(k => k.innerText.replace(/\s+/g, ' ').trim()) }));
    ok('메뉴: 수주 관리 → 생산 계획 → 생산 관리 (생산 관리 다음은 그대로 품목)', head.nav.indexOf('생산 계획') === head.nav.indexOf('수주 관리') + 1 && head.nav.indexOf('생산 관리') === head.nav.indexOf('생산 계획') + 1 && head.nav[head.nav.indexOf('생산 관리') + 1] === '품목', head.nav);
    eq('제목', head.h1, '생산 계획');
    ok('숫자 카드: 6줄 · 전부 출고 · 포장 · 지연 3', /진행 중 수주 6 줄/.test(head.kpi[0]) && head.kpi[1].includes(D(50)) && /포장/.test(head.kpi[2]) && /납기 지연 예상 3 줄/.test(head.kpi[3]), head.kpi);
    const rows = () => ev(() => Array.from(document.querySelectorAll('#main .card table tbody tr')).map(tr => Array.from(tr.children).map(td => td.innerText.replace(/\s+/g, ' ').trim())));
    let r = await rows(); eq('수주별 표: 6줄 · 첫 줄 PO-X 이미 납기 지남', [r.length, r[0][1], r[0][8]], [6, 'PO-X', '이미 납기 지남']);
    await A.click('button[data-plan-judge="late"]'); await settle(); r = await rows(); eq('지연 예상만 3줄', r.map(x => x[1]), ['PO-G', 'PO-C', 'PO-B']);
    await A.click('button[data-plan-judge="all"]'); await settle();
    await A.fill('#main .card .toolbar input.inp', 'PO-A'); await settle(); r = await rows(); eq('찾기 PO-A', r.map(x => x[1]), ['PO-A']); await A.fill('#main .card .toolbar input.inp', ''); await settle();
    await A.click('button[data-plan-scope="firm"]'); await settle(); r = await rows();
    eq('확정 PO 만 → 5줄 (PO미정 빠짐)', [r.length, r.some(x => x[1] === 'PO미정')], [5, false]);
    await A.click('button[data-plan-scope="all"]'); await settle();
    // 자재 탭: 리드타임 칸 → 품목 마스터 · 판정
    await A.click('.tabs .tab:nth-child(3)'); await settle();
    r = await rows(); ok('자재 탭: 모자라는 것 3종 (케이스 · 카톤 · 원료)', r.length === 3 && r.some(x => x[0].startsWith('CASE-M')), r);
    const idx = r.findIndex(x => x[0].startsWith('CASE-M'));
    await A.fill(`#main .card table tbody tr:nth-child(${idx + 1}) input`, '3'); await A.press(`#main .card table tbody tr:nth-child(${idx + 1}) input`, 'Tab'); await settle();
    eq('리드타임 칸 → 품목 lead_days 3 · 판정 여유', await ev(() => [ERP.db.rows('items').find(i => i.code === 'CASE-M').lead_days, ERP.plan.run('all').mats.find(m => m.code === 'CASE-M').judge]), [3, 'ok']);
    await ev(async () => { const DB = ERP.db; const it = DB.rows('items').find(i => i.code === 'CASE-M'); DB.update('items', it._id, { lead_days: undefined }); await DB.flush(); });
    // 기준 자료 탭: 조립 조 수 2 · 권취 하루 능력 직접 · 쉬는 날 넣기 · 기다리는 날
    await A.click('.tabs .tab:nth-child(4)'); await settle();
    await A.selectOption('select[data-plan-shift="ASM"]', '2'); await settle();
    eq('조 수 2 → 표 plan_proc · 조립 Mini 4,000', await ev(() => [ERP.db.rows('plan_proc').find(r => r.process === 'ASM' && !r.division).shifts, ERP.plan.capacity().famDay.Mini]), [2, 4000]);
    await A.fill('input[data-plan-cap="WRP"]', '1000'); await A.press('input[data-plan-cap="WRP"]', 'Tab'); await settle();
    eq('권취 하루 능력 직접 1,000', await ev(() => [ERP.plan.capacity().perDay.WRP, ERP.plan.capacity().src.WRP]), [1000, 'manual']);
    await A.fill('input[data-plan-wait="PCK>OUT"]', '2'); await A.press('input[data-plan-wait="PCK>OUT"]', 'Tab'); await settle();
    eq('포장 → 출고 2일', await ev(() => ERP.plan.base().wait['PCK>OUT']), 2);
    const dates = await A.$$('#main .card section:nth-of-type(4) .toolbar input[type="date"]');
    await dates[0].fill(D(1)); await dates[1].fill(D(3)); await A.fill('#main .card section:nth-of-type(4) .toolbar input[placeholder]', '설 Tết'); await A.click('button[data-plan-add-day]'); await settle();
    eq('쉬는 날 3일 넣기 (부터 ~ 까지)', await ev(() => ERP.db.rows('plan_cal').map(r => [r.date, r.work, r.memo]).sort()), [[D(1), false, '설 Tết'], [D(2), false, '설 Tết'], [D(3), false, '설 Tết']]);
    ok('달력 표에 3줄', (await ev(() => document.querySelectorAll('#main .card section:nth-of-type(4) table tbody tr').length)) === 3);
    await ev(async () => { const DB = ERP.db; ['plan_proc', 'plan_cal', 'plan_wait'].forEach(t => DB.replace(t, [])); await DB.flush(); ERP.render(); }); await settle();
    // 확인할 것 탭 · 공정별 부하 탭
    await A.click('.tabs .tab:nth-child(5)'); await settle(); ok('확인할 것 탭에 글', (await ev(() => document.querySelectorAll('#main .plan-note').length)) >= 8);
    await A.click('.tabs .tab:nth-child(2)'); await settle(); r = await rows(); ok('공정별 부하: 6줄 · 포장 = 가장 막힘', r.length === 6 && /가장 막힘/.test(r.find(x => x[0].startsWith('포장'))[0]), r);
    // PO 를 누르면 수주 관리
    await A.click('.tabs .tab:nth-child(1)'); await settle(); await A.click('#main .card table tbody tr:nth-child(4) td:nth-child(2) a'); await settle();
    eq('PO-B 를 누르면 수주 관리 · 선택', await ev(() => [location.hash, ERP.state.ord.sel]), ['#/orders', 'PO-B']);
  });

  await sec('9. 생산계획_기준자료_양식 올리기 (엑셀 업로드와 같은 길)', async () => {
    const days = { d1: nonSun(1), d2: nonSun(2), d3: nonSun(3), sun: sunAfter(1), sun2: sunAfter(9) };
    const res = await ev((o) => {
      const X = XLSX.utils; const wb = X.book_new(); const add = (name, aoa) => X.book_append_sheet(wb, X.aoa_to_sheet(aoa), name); window.__planWb = wb;
      add('안내 Hướng dẫn', [['생산 계획 기준 자료 — 입력 양식 (시험) / Dữ liệu chuẩn']]);
      add('1 설비 Máy', [['공정 / Công đoạn', '조립 품목군 / Nhóm (lắp ráp)', '설비 번호 / Số máy', '설비 이름 (일보) / Tên máy', '만들 수 있는 품목군 (처음 값 = 일보 · 입력) / Nhóm hàng làm được', '단위 / ĐV', '조당 표준 생산량 (처음 값 = 일보 중앙값 · 입력) / SL chuẩn / ca', '설비당 필요 인원 (입력) / Số người / máy', '가동 상태 (처음 값 = 10월 일보 있음 · 입력: 가동·수리·정지) / Tình trạng', '사출: 금형 교체 시간 분 (입력) / Thay khuôn (phút)', '비고 / Ghi chú'],
        ['사출 / Ép nhựa', '', 1, 'S350', 'Pencil', 'pcs', 23625, 2, '가동', 30, ''], ['조립 / Lắp ráp', 'Mini', 1, 'Mini Assy M/C', 'Mini', 'pcs', 40000, 3, '가동', '', ''], ['조립 / Lắp ráp', 'Dial', 1, 'Regular Assy M/C', 'Dial', 'pcs', 30000, '', '수리', '', 'motor'], ['포장 / Đóng gói', '', 5, '', 'Mini', 'set', 2000, '', '', '', ''],
        [], ['(빈 줄에 일보에 없는 설비 · 새 설비를 더 넣어 주세요 / Thêm máy)']]);
      add('2 조 설정 Ca', [['공정 / Công đoạn', '단위 / ĐV', '기본 조 수 (처음 값 · 입력: 1 또는 2) / Số ca', '주간 조 근무 시간 (입력) / Giờ ca ngày', '야간 조 근무 시간 (입력) / Giờ ca đêm', '휴식 분 (입력) / Nghỉ (phút)', '비고 / Ghi chú'],
        ['사출 / Ép nhựa', 'pcs', 1, 11, 11, 60, ''], ['조립 / Lắp ráp', 'pcs', 2, 11, 11, 60, '야간 조']]);
      add('3 근무 달력 Lịch', [['날짜 / Ngày', '요일 / Thứ', '근무 O/X (처음 값 = 요일별 일보 · 입력) / Làm việc', '휴일 · 메모 (입력) / Ngày nghỉ · ghi chú', '사출 조 수 (기본과 다를 때만) / Số ca Ép nhựa', '리필 성형 조 수 (기본과 다를 때만) / Số ca Ép lõi (Refill)', '조립 조 수 (기본과 다를 때만) / Số ca Lắp ráp', '종이 권취 조 수 (기본과 다를 때만) / Số ca Quấn giấy', '포장 조 수 (기본과 다를 때만) / Số ca Đóng gói', '잔업 시간 (입력) / Tăng ca (giờ)'],
        [o.d1, '', 'O', '', '', '', '', '', '', ''], [o.d2, '', 'X', '설 Tết', '', '', '', '', '', ''], [o.d3, '', 'O', '', '', '', 3, '', '', 2], [o.sun, '', 'X', '', '', '', '', '', '', ''], [o.sun2, '', 'O', '일요 근무', '', '', '', '', '', '']]);
      add('4 인원 Nhân lực', [['공정 / Công đoạn', '조 / Ca', '가용 인원 (입력) / Số người có', '설비 · 라인당 필요 인원 (입력) / Số người cần / máy · chuyền', '공통 인원 (반장 · 검사 등, 입력) / Người chung (tổ trưởng · QC)', '비고 / Ghi chú'],
        ['조립 / Lắp ráp', '주간 / Ngày', 20, 3, 2, ''], ['조립 / Lắp ráp', '야간 / Đêm', 15, '', 1, ''], ['포장 / Đóng gói', '주간 / Ngày', '', '', '', '']]);
      add('5 공정 사이 Thời gian chờ', [['앞 공정 / Công đoạn trước', '다음 공정 / Công đoạn sau', '기다리는 날 (입력) / Số ngày chờ', '최소 생산 단위 (입력) / Lô tối thiểu', '단위 / ĐV', '비고 (예: 심 굳히는 시간 · 검사) / Ghi chú'],
        ['원료 · 부자재 입고', '사출 / Ép nhựa', 2, 1, 'pcs', ''], ['조립 / Lắp ráp', '포장 / Đóng gói', 1, '', 'set', ''], ['포장 / Đóng gói', '출고 · 검사 / Xuất · kiểm', 3, '', '', '검사']]);
      add('6 자재 Vật tư', [['품목코드 / Mã', '품명 / Tên', '구분 / Loại', '단위 / ĐV', '필요량 (진행 중 수주) / Cần', '지금 재고 / Tồn', '모자람 / Thiếu', '해외 주문 품목 / Đặt nước ngoài', '리드타임 일 (입력 · 해외 주문은 ERP 값) / Thời gian giao', '최소 발주량 (입력) / Đặt tối thiểu', '거래처 (입력) / NCC', '발주 · 입고 예정 날짜 (입력) / Ngày nhập dự kiến', '입고 예정 수량 (입력) / SL nhập dự kiến', '비고 / Ghi chú'],
        ['CASE-M', 'MINI CASE', 'SM', 'PCS', 3960, 1000, 2960, '', 14, 500, 'ABC', '', '', ''], ['CTN-M', 'CARTON MINI', 'SM', 'PCS', 330, 0, 330, '', '', '', '', '', '', ''], ['NOPE-1', '?', 'SM', 'PCS', 1, 0, 1, '', 7, '', '', '', '', ''], [], ['필요량 = 진행 중 수주 …']]);
      add('7 불량 · 외주 Lỗi · Gia công', [['공정 / Công đoạn', '불량률 기준 % (입력) / Tỷ lệ lỗi chuẩn %', '일보 참고: 불량률 / Tỷ lệ lỗi từ báo cáo', '비고 / Ghi chú'], ['조립 / Lắp ráp', 0.5, '', ''], ['종이 권취 / Quấn giấy', 4.6, '', ''], [], ['외주 공정 · 품목 (입력) / Công đoạn · mã gia công ngoài', '외주처 / Đơn vị gia công', '걸리는 날 / Số ngày', '하루 가능 수량 / SL / ngày', '비고 / Ghi chú'], ['도장', 'XYZ', 3, 1000, '']]);
      const jobs = ERP.xl.analyze(wb, { file: '생산계획_기준자료_양식_시험.xlsx' });
      const out = jobs.map(j => [j.sheet, j.id, j.table, j.rows.length, !!j.include]);
      const res = jobs.filter(j => j.include && j.table && j.rows.length).map(j => { j.file = '시험.xlsx'; return [j.id, ERP.xl.apply(j)]; });
      const DB = ERP.db;
      return { out, res, notes: jobs.map(j => j.note || j.skip || ''), proc: DB.rows('plan_proc').map(r => [r.process, r.division || '', r.shifts, r.day_h, r.defect_pct, r.people_day, r.people_night, r.people_per, r.people_common, r.note || '']).sort(),
        wait: DB.rows('plan_wait').map(r => [r.from, r.to, r.days, r.min_lot, r.note || '']).sort(), cal: DB.rows('plan_cal').map(r => [r.date, r.work, r.memo || '', r.sh_asm, r.ot_h]).sort(),
        mach: DB.rows('machines').map(m => [m.process, m.division || '', m.machine_no, m.name || '', m.per_shift, m.people, m.active, m.note || '']).sort(), lead: DB.rows('items').filter(i => i.lead_days).map(i => [i.code, i.lead_days]) };
    }, days);
    eq('시트 인식: 안내 (읽지 않음) · 설비 · 조 설정 · 근무 달력 · 인원 · 공정 사이 · 자재 · 불량', res.out.map(x => [x[1], x[2], x[3], x[4]]), [['plan_info', null, 0, false], ['plan_mach', 'machines', 4, true], ['plan_shift', 'plan_proc', 2, true], ['plan_cal', 'plan_cal', 3, true], ['plan_people', 'plan_proc', 1, true], ['plan_wait', 'plan_wait', 3, true], ['plan_mat', 'items', 1, true], ['plan_defect', 'plan_proc', 2, true]]);
    eq('설비: 조당 표준 · 인원 · 가동 = 사용 · 수리 = 사용 안 함 (비고) · 상태 없는 새 설비 = 사용 안 함 · 조립은 품목군', res.mach, [['ASM', 'Dial', '1', 'Regular Assy M/C', 30000, undefined, false, 'motor · 수리'], ['ASM', 'Mini', '1', 'Mini Assy M/C', 40000, 3, true, ''], ['INJ', 'Pencil', '1', 'S350', 23625, 2, true, '금형 교체 30분'], ['PCK', 'Mini', '5', '', 2000, undefined, false, '']]);
    eq('공정 기준 (조 설정 · 인원 · 불량률 이 한 줄에)', res.proc, [['ASM', '', 2, 11, 0.5, 20, 15, 3, 3, '야간 조'], ['INJ', '', 1, 11, undefined, undefined, undefined, undefined, undefined, ''], ['WRP', '', undefined, undefined, 4.6, undefined, undefined, undefined, undefined, '']]);
    eq('근무 달력: 기본 (일요일만 쉼) 과 다른 날 · 메모 · 조 수 · 잔업이 있는 날만 (평일 O · 일요일 X 는 기본이라 안 넣음)', res.cal.map(r => r.map(x => (x === undefined ? null : x))), [[days.d2, false, '설 Tết', null, null], [days.d3, null, '', 3, 2], [days.sun2, true, '일요 근무', null, null]].sort());
    eq('공정 사이: 원료 → 사출 2 · 조립 → 포장 1 · 포장 → 출고 3', res.wait, [['ASM', 'PCK', 1, undefined, ''], ['PCK', 'OUT', 3, undefined, '검사'], ['RAW', 'INJ', 2, 1, '']]);
    eq('자재: 지금 값과 다른 리드타임만 (품목에 없는 코드 · 빈칸은 빼고)', res.lead, [['CASE-M', 14]]);
    ok('알림: 외주 1줄 · 최소 발주량 등 읽지 않음 · 품목에 없는 코드', res.notes.some(n => /외주 1줄/.test(n)) && res.notes.some(n => /품목에 없는 코드 1개/.test(n)) && res.notes.some(n => /최소 발주량 · 거래처 · 입고 예정 1줄/.test(n)), res.notes);
    // 다시 올려도 늘지 않음 (설비 = 공정 · 품목군 · 번호, 공정 기준 · 공정 사이 = 키, 근무 달력 = 양식 날짜 범위 교체)
    const again = await ev(() => { ERP.xl.analyze(window.__planWb, { file: 'again.xlsx' }).filter(j => j.include && j.table && j.rows.length).forEach(j => ERP.xl.apply(j));
      return { cal: ERP.db.rows('plan_cal').length, mach: ERP.db.rows('machines').length, proc: ERP.db.rows('plan_proc').length, wait: ERP.db.rows('plan_wait').length }; });
    eq('다시 올린 뒤 줄 수: 근무 달력 3 · 설비 4 · 공정 기준 3 · 공정 사이 3', [again.cal, again.mach, again.proc, again.wait], [3, 4, 3, 3]);
    // 계획에 반영: 조립 2조 → Mini 4,000 · 포장 → 출고 3일
    eq('계획: 조립 2조 · 포장 → 출고 3 · 조립 불량률 0.5', await ev(() => { const b = ERP.plan.base(); return [b.shift.ASM.n, b.wait['PCK>OUT'], b.defect.ASM, ERP.plan.capacity().famDay.Mini]; }), [2, 3, 0.5, 4000]);
    await ev(async () => { const DB = ERP.db; ['plan_proc', 'plan_cal', 'plan_wait', 'machines'].forEach(t => DB.replace(t, [])); const it = DB.rows('items').find(i => i.code === 'CASE-M'); DB.update('items', it._id, { lead_days: undefined }); await DB.flush(); });
  });

  await sec('10. AI 비서: production_plan 도구 · 내장 모드', async () => {
    const r = await ev(() => { const T = ERP.ai.tools; return { s: T.production_plan({}), q: T.production_plan({ query: 'PO-B' }), none: T.production_plan({ query: 'ZZZ' }), firm: T.production_plan({ scope: 'firm', view: 'orders' }), mat: T.production_plan({ view: 'materials' }),
      def: ERP.ai.toolDefs.find(d => d.name === 'production_plan') }; });
    eq('요약: 줄 · 병목 · 판정 · 지연 줄', [r.s.open_lines, r.s.bottleneck.process, r.s.counts.late, r.s.late.map(x => x.po_no), r.s.all_shipped_by], [6, 'PCK', 3, ['PO-G', 'PO-C', 'PO-B'], D(50)]);
    eq('PO-B 한 줄: 출고 · 여유 · 판정 · 막는 공정 · 공정별 끝', [r.q.matches.length, r.q.matches[0].ship_date, r.q.matches[0].slack_days, r.q.matches[0].judge, r.q.matches[0].limiting_process, r.q.matches[0].finish.assembly], [1, D(36), -26, 'late', 'PCK', D(28)]);
    ok('없는 PO → 오류 글 (지어내지 않음)', r.none.matches.length === 0 && /no open order line/.test(r.none.error), r.none);
    eq('확정 PO 만: 5줄 · PO미정 표시 없음', [r.firm.lines.length, r.firm.lines.some(x => x.po_not_fixed)], [5, false]);
    eq('자재: 모자라는 3종 · 케이스 처음 모자람 PO-B', [r.mat.materials.length, r.mat.materials.find(m => m.code === 'CASE-M').first_short_po], [3, 'PO-B CT-M']);
    ok('도구 정의 (scope · view · query)', r.def && r.def.input_schema.properties.scope.enum.join() === 'all,firm' && /PO미정/.test(r.def.description), r.def);
    const loc = await ev(() => ['PO-B 언제 끝나?', '늦어질 수주', '병목 공정', '모자랄 자재', '모자란 자재', '뭐가 모자라?', 'PO-B khi nào xong?', 'vật tư sẽ thiếu', 'PO-B 자재 소요량'].map(q => { const a = ERP.ai.localAnswer(q); return [q, a.intent, a.text.split('\n').slice(0, 3).join(' / ')]; }));
    eq('내장 모드 질문 유형', loc.map(x => x[1]), ['plan', 'plan', 'plan', 'plan_mat', 'low_stock', 'low_stock', 'plan', 'plan_mat', 'mrp']);
    ok('PO-B 언제 끝나 → 출고 가능일 · 지연 예상', loc[0][2].includes(D(36)) && /지연 예상/.test(loc[0][2]), loc[0]);
    ok('뭐가 모자라 → 안전재고 + 수주 대비 모자랄 자재 3종 한 줄', await ev(() => /수주 대비 앞으로 모자랄 자재: 3종/.test(ERP.ai.localAnswer('뭐가 모자라?').text)));
    ok('베트남어: khi nào xong → Dự kiến trễ', /Dự kiến trễ/.test(loc[6][2]), loc[6]);
  });

  await sec('11. 엑셀 (시트 6개)', async () => {
    const r = await ev(() => { const s = ERP.plan.sheets(ERP.plan.run('all'), ERP.plan.run('firm')); return s.map(x => [x.name, x.aoa.length, x.aoa[0].length]); });
    eq('시트 이름', r.map(x => x[0]), ['요약', '수주별 완료 예상', '공정별 부하', '자재', '능력 근거', '확인할 것']);
    eq('수주별 = 머리 + 6줄 · 공정별 부하 = 머리 + 6 + 빈 줄 + 참고 2', [r[1][1], r[2][1]], [7, 10]);
    const sum = await ev(() => ERP.plan.sheets(ERP.plan.run('all'), ERP.plan.run('firm'))[0].aoa.slice(2, 6));
    eq('요약: PO미정 포함 · 확정 PO 만 두 칸 · 가장 막히는 공정', [sum[0][1], sum[0][2], sum[3][1].slice(0, 2)], ['PO미정 포함', '확정 PO 만', '포장']);
  });

  await sec('11-2. 해외 주문: 권장 주문량 = 수주 MRP + 안전재고 − 합계 · 주문 파일 칸 (1.14.1)', async () => {
    // 사용자 "발주 주문량은 수주관리에 들어있는 오더를 만들량을 mrp로 계산해서 부족한거 전부 주문할수있게 해줘" · "자재구매 파일 만들때 F줄 safety stock/ L줄 kg/month~ P줄 Average 는 삭제해줘"
    await ev(async () => { const DB = ERP.db; const set = (code, p) => { const it = DB.rows('items').find(i => i.code === code); DB.update('items', it._id, p); };
      set('RES-1', { buy: true, buy_cat: 'Resin', buy_unit: 'kg', safety: 50 }); set('CASE-M', { buy: true, buy_cat: 'Case' }); set('CTN-M', { buy: true, buy_cat: 'Carton', safety: 100, buy_step: 50 });
      DB.add('items', { code: 'WAX-9', name: 'WAX', stage: 'RM', unit: 'kg', buy: true, buy_cat: 'Wax', safety: 100, src: 'test' }); DB.replace('buy_orders', []); DB.setSetting('buyMrpScope', 'all'); await DB.flush(); });
    const rowsOf = () => ev(() => Object.fromEntries(ERP.buy.rows().map(r => [r.code, [r.byMrp, r.mrpNeed === null ? null : Math.round(r.mrpNeed * 100) / 100, r.total, r.status, r.sug]])));
    eq('수주에 쓰는 품목: 원료 (180.48 + 50 − 5 → 10 단위 230) · 케이스 (3,960 − 1,000 = 2,960) · 카톤 (330 + 100 → 50 단위 450) / 수주에 안 쓰는 WAX-9 = 예전 (안전재고 100)', await rowsOf(),
      { 'CASE-M': [true, 3960, 1000, 'need', 2960], 'CTN-M': [true, 330, 0, 'need', 450], 'RES-1': [true, 180.48, 5, 'need', 230], 'WAX-9': [false, null, 0, 'need', 100] });
    await ev(async () => { ERP.db.setSetting('buyMrpScope', 'firm'); await ERP.db.flush(); });
    eq('확정 PO 만: 원료 168.96 → 220 · 케이스 3,720 → 2,720', await rowsOf(), { 'CASE-M': [true, 3720, 1000, 'need', 2720], 'CTN-M': [true, 310, 0, 'need', 450], 'RES-1': [true, 168.96, 5, 'need', 220], 'WAX-9': [false, null, 0, 'need', 100] });
    await ev(async () => { ERP.db.setSetting('buyMrpScope', 'all'); ERP.db.add('buy_orders', { date: '2026-01-02', code: 'RES-1', qty: 200, unit: 'kg', status: 'open', src: 'erp' }); await ERP.db.flush(); });
    eq('입고 대기 주문 200 kg 이 합계에 들어감 → 원료 180.48 + 50 − 205 = 25.48 → 30', (await rowsOf())['RES-1'], [true, 180.48, 205, 'need', 30]);
    await ev(async () => { ERP.db.replace('buy_orders', []); await ERP.db.flush(); });
    // 화면: 해외 주문 탭 — 수주 필요 (MRP) 칸 · 수주 범위 고르기
    await ev(() => { ERP.setLang('ko'); ERP.goStock('buy'); }); await A.waitForFunction(() => !!document.querySelector('main table.buy-tbl'), null, { timeout: 15000 }); await settle();
    const cell = () => ev(() => { const hd = Array.from(document.querySelectorAll('main table.buy-tbl thead th')).map(t => t.innerText.replace(/\s+/g, ' ').trim()); const tr = Array.from(document.querySelectorAll('main table.buy-tbl tbody tr')).find(x => x.children[1].innerText.trim() === 'RES-1');
      const at = (name) => tr.children[hd.indexOf(name)].innerText.trim(); return { mrp: at('수주 필요 (MRP)'), st: at('상태'), sug: at('권장 주문량'), before: hd[hd.indexOf('상태') - 1] }; });
    eq('RES-1 줄: 수주 필요 180.48 · 주문 필요 · 권장 230 (상태 바로 앞 칸)', await cell(), { mrp: '180.48', st: '주문 필요', sug: '230', before: '수주 필요 (MRP)' });
    await A.selectOption('main select[data-buy-scope]', 'firm'); await settle();
    eq('수주 범위 → 확정 PO 만 (설정 저장 · 권장 220)', [await ev(() => ERP.db.setting('buyMrpScope')), (await cell()).sug], ['firm', '220']);
    await A.selectOption('main select[data-buy-scope]', 'all'); await settle();
    // 주문 파일: 부족한 것 전부 (수주 3 + 안전재고 1) 를 오늘 칸에 넣고 Safety stock · 월 사용량 칸 없이
    await ev(() => { window.__book = null; ERP.__save = ERP.xl.saveBook; ERP.xl.saveBook = (wb, name) => { window.__book = { wb, name }; }; });
    await A.click('main button:has-text("주문 파일 만들기")');
    for (let i = 0; i < 20; i++) { await A.waitForTimeout(150); const m = await A.$('.modal .modal-foot button:last-child'); if (m) { await m.click(); break; } }
    await A.waitForTimeout(500);
    const f = await ev(() => { const b = window.__book; ERP.xl.saveBook = ERP.__save; if (!b) return null; const X = window.XLSX; const ws = b.wb.Sheets[b.wb.SheetNames[0]]; const M = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      const i = M.findIndex(r => r && r[2] === 'RES-1'); const tot = ws['J' + (i + 1)];
      const re = ERP.xl.analyze(b.wb, { file: b.name }); const j = re.find(q => q.kind === 'buy_items'), o = re.find(q => q.kind === 'buy_orders');
      return { head: M[3], res: M[i], tot: tot && tot.f, orders: ERP.db.rows('buy_orders').map(x => [x.code, x.qty]).sort(), re: j ? [j.rows.length, o ? o.rows.length : null] : null }; });
    eq('주문 파일 머리: Safety stock · kg/month ~ Average 없음 (B ~ H · 주문일 · Total)', f && f.head.map(x => (typeof x === 'number' ? 'date' : x)), [null, 'Category', 'Item Code', 'Item Name', 'Item Name Kr', 'Unit', 'Inventory', '입고예정', 'date', 'Total']);
    eq('RES-1 줄 (7행): 단위 · 재고 5 · 오늘 칸 230 · Total 235 (수식 = 재고 G 부터 주문일 I 까지)', f && [f.res.slice(1, 10), f.tot], [['Resin', 'RES-1', 'RESIN', null, 'kg', 5, null, 230, 235], 'SUM(G7:I7)']);
    eq('부족한 것 전부 주문 (수주 3품목 + 안전재고 1품목)', f && f.orders, [['CASE-M', 2960], ['CTN-M', 450], ['RES-1', 230], ['WAX-9', 100]]);
    eq('만든 파일을 다시 올려도 자재구매 파일로 인식 (품목 4 · 주문 4)', f && f.re, [4, 4]);
    await ev(async () => { const DB = ERP.db; DB.replace('buy_orders', []); DB.replace('items', DB.rows('items').filter(i => i.code !== 'WAX-9').map(i => (i.buy ? Object.assign({}, i, { buy: undefined, buy_cat: undefined, buy_unit: undefined, safety: undefined, buy_step: undefined }) : i))); DB.setSetting('buyMrpScope', 'all'); await DB.flush(); });
  });

  await sec('13. Codex 검토 (1.14.2): 하루씩 같이 돌리기 · 불량률이 부품 · 자재로 · 달력 조 수 0 · 오늘 전 필요한 날', async () => {
    // Codex 2026-11-04 지적 4개 (plan.js). 1번은 Codex 말대로 (앞 공정이 끝난 뒤 · 납기 순서 그대로) 고치면 지나쳐서, 하루씩 공정을 같이 돌리는 계산으로 고침
    const at = (R, po) => R.orders.find(o => o.po === po);
    // 13-1 권취가 느린 G (하루 100) 를 기다리는 동안 포장은 B 를 한다 — 예전 계산은 G 의 포장 10,000 을 먼저 세어 B 포장 +35 · 출고 +36
    await ev(async () => { const DB = ERP.db; DB.add('plan_proc', { process: 'WRP', cap_day: 100 }); await DB.flush(); });
    let R = await run('all');
    eq('G: 권취 +99 → 포장 +100 → 출고 +101 · 끝 = 권취', [at(R, 'PO-G').F.WRP, at(R, 'PO-G').pckEff, at(R, 'PO-G').ship, at(R, 'PO-G').limit], [D(99), D(100), D(101), 'WRP']);
    eq('B: 포장 +32 → 출고 +33 (권취를 기다리는 G 가 포장을 막지 않음)', [at(R, 'PO-B').pckEff, at(R, 'PO-B').ship], [D(32), D(33)]);
    // 13-2 불량률만큼 더 만든 양이 부품 · 자재로도 내려감
    await ev(async () => { const DB = ERP.db; DB.replace('plan_proc', [{ process: 'ASM', defect_pct: 10 }]); await DB.flush(); });
    R = await run('all'); let m = Object.fromEntries(R.mats.map(x => [x.code, x]));
    eq('조립 불량률 10% → B 의 사출 · 리필도 55,680 ÷ 0.9 = 61,866.67 · 원료 180.48 ÷ 0.9 = 200.53 kg', [at(R, 'PO-B').load.INJ, at(R, 'PO-B').load.REF, m['RES-1'].need], [61866.67, 61866.67, 200.53]);
    await ev(async () => { const DB = ERP.db; DB.replace('plan_proc', [{ process: 'PCK', defect_pct: 10 }]); await DB.flush(); });
    R = await run('all'); m = Object.fromEntries(R.mats.map(x => [x.code, x]));
    eq('포장 불량률 10% → 케이스 3,960 ÷ 0.9 = 4,400 · 카톤 330 ÷ 0.9 = 366.67 · BOM 없는 G 의 권취도 11,111.11', [m['CASE-M'].need, m['CTN-M'].need, at(R, 'PO-G').load.WRP], [4400, 366.67, 11111.11]);
    await ev(async () => { ERP.db.replace('plan_proc', []); await ERP.db.flush(); });
    // 13-3 근무 달력의 공정 조 수 0 = 그날 그 공정은 쉼 (예전: 기본 조 수로 계산)
    await ev(async (d) => { const DB = ERP.db; DB.add('plan_cal', { date: d, sh_pck: 0 }); await DB.flush(); }, D(1));
    R = await run('all');
    eq('내일 포장 조 수 0 → X 포장 +2 → 출고 +3', [at(R, 'PO-X').pckEff, at(R, 'PO-X').ship], [D(2), D(3)]);
    await ev(() => { ERP.state.plan = { tab: 'base' }; location.hash = '#/plan'; ERP.render(); }); await settle();
    ok('기준 자료 탭 근무 달력: 조 수가 다른 공정 = 포장 0', await ev((d) => Array.from(document.querySelectorAll('#main table tbody tr')).some(tr => tr.innerText.includes(d) && /포장 0/.test(tr.innerText)), D(1)));
    await ev(async () => { ERP.db.replace('plan_cal', []); await ERP.db.flush(); ERP.state.plan = null; });
    // 13-4 원료 입고 → 사출 기다리는 날이 있으면 필요한 날이 오늘보다 앞일 수 있음 (예전: 오늘에서 멈춤)
    await ev(async () => { const DB = ERP.db; DB.add('plan_wait', { from: 'RAW', to: 'INJ', days: 3 }); await DB.flush(); });
    R = await run('all');
    eq('원료 → 사출 3일 → 원료가 필요한 날 = B 사출 시작 (오늘) 의 3 근무일 전', R.mats.find(x => x.code === 'RES-1').first, ['PO-B', D(-3)]);
    await ev(async () => { ERP.db.replace('plan_wait', []); await ERP.db.flush(); });
    // 13-5 · 13-6 (1.14.2 고친 코드의 Codex 검토): 조립 품목군이 둘인 수주 PO-MIX (세트 = Mini 색연필 200 + Dial 색연필 1, Dial 쪽에만 부품 DMAT · 재고 60)
    await ev(async (o) => { const DB = ERP.db;
      DB.addMany('items', [{ code: 'SET-X', name: 'MIX SET', stage: 'SG', line: 'MINI', unit: 'SET', src: 'test' }, { code: 'PEN-M2', name: 'MINI PEN 2', stage: 'WIP', line: 'MINI', unit: 'PCS', src: 'test' },
        { code: 'PEN-D2', name: 'DIAL PEN 2', stage: 'WIP', line: 'REG', unit: 'PCS', src: 'test' }, { code: 'DMAT', name: 'DIAL PART', stage: 'SM', unit: 'PCS', src: 'test' }]);
      DB.addMany('bom_lines', [{ parent: 'SET-X', child: 'PEN-M2', qty: 200, note: '조립' }, { parent: 'SET-X', child: 'PEN-D2', qty: 1, note: '조립' }, { parent: 'PEN-D2', child: 'DMAT', qty: 1, note: '조립' }]);
      DB.add('stock_open', { date: o.EC, scope: 'WH', code: 'DMAT', qty: 60, unit: 'PCS' });
      DB.add('po', { date: o.EC, customer: 'TEST', po_no: 'PO-MIX', item_no: 'SET-X', kind: 'Mini', color: 24, sets: 100, pcs: 2400, cs: 0, due: o.due, packed: 0 }); await DB.flush(); }, { EC: D(-60), due: D(-9) });
    R = await run('all'); let mix = at(R, 'PO-MIX'); m = R.mats.find(x => x.code === 'DMAT');
    eq('PO-MIX: 조립 Mini 20,000 (10일) · Dial 100 (오늘 끝)', [mix && mix.load.asm, mix && mix.F.ASM], [{ Mini: 20000, Dial: 100 }, D(9)]);
    eq('DMAT 은 Dial 진행으로 씀 → 오늘 100 > 재고 60 → 필요한 날 오늘 (두 품목군을 합치면 +5 로 늦게 나옴)', [m.need, m.first], [100, ['PO-MIX', T0]]);
    // 800 근무일 안에 다 못 쓴 나머지: Dial 하루 0.1 → 800일에 80 (재고 90 안) · 나머지 20 은 그 뒤 → 모자람 10 (예전: 충분)
    await ev(async () => { const DB = ERP.db; const s = DB.rows('stock_open').find(r => r.code === 'DMAT'); DB.update('stock_open', s._id, { qty: 90 }); DB.add('plan_proc', { process: 'ASM', division: 'Dial', cap_day: 0.1 }); await DB.flush(); });
    R = await run('all'); m = R.mats.find(x => x.code === 'DMAT');
    eq('PO-MIX 조립 Dial = 800일 넘음 · DMAT 모자람 10 · 필요한 날 = 마지막 근무일 (+799) · 리드타임 없음', [at(R, 'PO-MIX').F.ASM, m.short, m.first, m.judge], ['over', 10, ['PO-MIX', D(799)], 'nolead']);
    await ev(async () => { const DB = ERP.db; const del = (t, f) => DB.rows(t).filter(f).forEach(r => DB.remove(t, r._id));
      del('po', r => r.po_no === 'PO-MIX'); del('items', r => ['SET-X', 'PEN-M2', 'PEN-D2', 'DMAT'].includes(r.code)); del('bom_lines', r => r.parent === 'SET-X' || r.parent === 'PEN-D2'); del('stock_open', r => r.code === 'DMAT');
      DB.replace('plan_proc', []); await DB.flush(); });
    eq('되돌리면 처음 계산과 같음', (await run('all')).counts, R1.counts);
  });

  await sec('14. 자재 구분 골라 보기 (1.15.2): 원재료 · 부자재 · 소모품 · 반제품 · 품목에 없음', async () => {
    // 사용자 2026-11-10 "생산계획에서 자재 모자라는 것만 표시하는건 원자재 부자재 소모품 반제품 이런식으로 선택해서 표시할수있게 해줘"
    // 구분 = 품목 마스터의 단계 (원부자재 재고 화면과 같음) → 단계 없으면 품목구분 (ECOUNT) · 품목 마스터에 없는 코드는 따로 (짐작하지 않음)
    await ev(async () => { const DB = ERP.db;
      DB.addMany('items', [{ code: 'TAPE-1', name: 'TAPE', stage: 'CM', unit: 'ROLL', src: 'test' }, { code: 'LBL-9', name: 'LABEL', etype: '부재료', unit: 'PCS', src: 'test' },
        { code: 'CORE-B', name: 'BOUGHT CORE', stage: 'WIP00', line: 'MINI', unit: 'PCS', src: 'test' }]);
      DB.addMany('bom_lines', [{ parent: 'CT-M', child: 'TAPE-1', qty: 1, note: '포장' }, { parent: 'CT-M', child: 'LBL-9', qty: 1, note: '포장' }, { parent: 'CT-M', child: 'CORE-B', qty: 1, note: '원료 kg (MRP 소요량)' },
        { parent: 'CT-M', child: 'NOPE-9', qty: 1, note: '포장' }]); await DB.flush(); });
    const k = await ev(() => { const P = ERP.plan; const R = P.run('all'); return { kinds: R.mats.map(m => [m.code, m.mkind]).sort(), short: R.short.length, need: R.mats.filter(m => ['TAPE-1', 'LBL-9', 'CORE-B', 'NOPE-9'].includes(m.code)).map(m => m.need),
      names: ['RM', 'SM', 'CM', 'SEMI', 'FG', 'ETC', 'NONE'].map(x => P.matKindName(x)) }; });
    eq('구분: 원료 RM · 케이스 · 카톤 SM · 테이프 CM · 단계 없고 품목구분 부재료 → SM · BOM 에 원료로 적힌 반제품 → SEMI · 품목에 없는 코드 → NONE', k.kinds,
      [['CASE-M', 'SM'], ['CORE-B', 'SEMI'], ['CTN-M', 'SM'], ['LBL-9', 'SM'], ['NOPE-9', 'NONE'], ['RES-1', 'RM'], ['TAPE-1', 'CM']]);
    eq('모자라는 것 7종 · 새 자재는 카톤마다 1 (330)', [k.short, k.need], [7, [330, 330, 330, 330]]);
    eq('구분 이름 (원부자재 재고 화면과 같은 단계 이름)', k.names, ['원재료', '부자재', '소모품', '반제품', '완제품', '기타', '품목에 없음']);
    eq('AI 비서 production_plan 자재에도 구분', await ev(() => ERP.ai.tools.production_plan({ view: 'materials' }).materials.map(m => [m.code, m.category]).sort()),
      [['CASE-M', '부자재'], ['CORE-B', '반제품'], ['CTN-M', '부자재'], ['LBL-9', '부자재'], ['NOPE-9', '품목에 없음'], ['RES-1', '원재료'], ['TAPE-1', '소모품']]);
    // 화면
    await ev(() => { ERP.setLang('ko'); ERP.state.plan = { tab: 'mats' }; location.hash = '#/plan'; ERP.render(); }); await settle();
    const view = () => ev(() => ({ btn: Array.from(document.querySelectorAll('#main button[data-plan-mkind]')).map(b => [b.dataset.planMkind, b.textContent.trim(), b.classList.contains('primary')]),
      seg: Array.from(document.querySelectorAll('#main button[data-plan-mat]')).map(b => b.textContent.trim()),
      rows: Array.from(document.querySelectorAll('#main .card table tbody tr')).map(tr => Array.from(tr.children).map(td => td.innerText.replace(/\s+/g, ' ').trim())) }));
    const codes = (v) => v.rows.map(r => r[0].split(' ')[0]).sort();
    let v = await view();
    eq('구분 단추: 모든 구분 · 원재료 1 · 부자재 3 · 소모품 1 · 반제품 1 · 품목에 없음 1 (완제품 · 기타는 없어서 안 보임)', v.btn,
      [['all', '모든 구분', true], ['RM', '원재료 1', false], ['SM', '부자재 3', false], ['CM', '소모품 1', false], ['SEMI', '반제품 1', false], ['NONE', '품목에 없음 1', false]]);
    eq('표 7줄 · 구분 칸 = 구분 이름 + 단계 코드', [v.rows.length, v.rows.find(r => r[0].startsWith('RES-1'))[1], v.rows.find(r => r[0].startsWith('NOPE-9'))[1]], [7, '원재료 RM', '품목에 없음']);
    await A.click('#main button[data-plan-mkind="RM"]'); await settle(); v = await view();
    eq('원재료만: RES-1 한 줄 · 모자라는 것만 1 · 전체 1', [codes(v), v.seg], [['RES-1'], ['모자라는 것만 1', '전체 1']]);
    await A.click('#main button[data-plan-mkind="SM"]'); await settle(); v = await view();
    eq('부자재를 더 누르면 같이: 4줄 · 켜진 단추 원재료 · 부자재', [codes(v), v.btn.filter(b => b[2]).map(b => b[0])], [['CASE-M', 'CTN-M', 'LBL-9', 'RES-1'], ['RM', 'SM']]);
    await A.click('#main button[data-plan-mkind="RM"]'); await settle(); v = await view();
    eq('원재료를 다시 누르면 뺌: 부자재 3줄', codes(v), ['CASE-M', 'CTN-M', 'LBL-9']);
    await A.click('.tabs .tab:nth-child(1)'); await settle(); await A.click('.tabs .tab:nth-child(3)'); await settle(); v = await view();
    eq('다른 탭에 갔다 와도 고른 구분 그대로', [v.btn.filter(b => b[2]).map(b => b[0]), v.rows.length], [['SM'], 3]);
    await A.click('#main button[data-plan-mkind="all"]'); await settle(); v = await view();
    eq('모든 구분 → 7줄', [v.rows.length, v.btn.filter(b => b[2]).map(b => b[0])], [7, ['all']]);
    // 재고가 넉넉한 소모품: 모자라는 것만 → 알림 · 전체 → 보임
    await ev(async (o) => { ERP.db.add('stock_open', { date: o.EC, scope: 'WH', code: 'TAPE-1', qty: 1000, unit: 'ROLL' }); await ERP.db.flush(); ERP.render(); }, { EC: D(-60) }); await settle();
    await A.click('#main button[data-plan-mkind="CM"]'); await settle(); v = await view();
    ok('소모품: 모자라는 것 없음 → 알림 한 줄', v.rows.length === 1 && /고른 구분에 모자라는 자재가 없습니다/.test(v.rows[0][0]) && v.btn.some(b => b[0] === 'CM' && b[1] === '소모품 0'), v);
    await A.click('#main button[data-plan-mat="all"]'); await settle(); v = await view();
    eq('전체 + 소모품 → TAPE-1 (충분) 한 줄 · 모자라는 것만 0 · 전체 1', [codes(v), v.seg], [['TAPE-1'], ['모자라는 것만 0', '전체 1']]);
    await A.click('#main button[data-plan-mat="short"]'); await settle();
    // 반제품이 자재에 하나도 없을 때 (실제 자료와 같음): 단추는 늘 보이고 (0), 누르면 공장에서 만들어 공정별 부하에서 센다는 알림
    await ev(async () => { const DB = ERP.db; DB.rows('bom_lines').filter(l => l.child === 'CORE-B').forEach(l => DB.remove('bom_lines', l._id)); await DB.flush(); ERP.render(); }); await settle();
    await A.click('#main button[data-plan-mkind="all"]'); await settle(); v = await view();
    ok('반제품 단추는 늘 보임 (0)', v.btn.some(b => b[0] === 'SEMI' && b[1] === '반제품 0'), v.btn);
    await A.click('#main button[data-plan-mkind="SEMI"]'); await settle(); v = await view();
    ok('반제품만: 없음 → 공정별 부하에서 센다는 알림', v.rows.length === 1 && /공정별 부하/.test(v.rows[0][0]), v.rows);
    // 고른 구분이 없어지면 (품목에 없는 코드를 품목에 넣음) 거르기도 풀림 — 안 보이는 단추로 걸러지지 않게
    await A.click('#main button[data-plan-mkind="all"]'); await settle(); await A.click('#main button[data-plan-mkind="NONE"]'); await settle();
    await ev(async () => { ERP.db.add('items', { code: 'NOPE-9', name: 'NEW CARTON', stage: 'SM', unit: 'PCS', src: 'test' }); await ERP.db.flush(); ERP.render(); }); await settle(); v = await view();
    eq('품목에 없음이 사라지면 → 모든 구분 · 모자라는 5줄 (NOPE-9 는 부자재)', [v.btn.map(b => b[0]), v.btn.filter(b => b[2]).map(b => b[0]), v.rows.length, v.btn.find(b => b[0] === 'SM')[1]],
      [['all', 'RM', 'SM', 'CM', 'SEMI'], ['all'], 5, '부자재 4']);
    // 품목 마스터에서 단계를 고치면 구분도
    await ev(async () => { const DB = ERP.db; const it = DB.rows('items').find(i => i.code === 'TAPE-1'); DB.update('items', it._id, { stage: 'SM' }); await DB.flush(); });
    eq('품목 마스터에서 단계를 고치면 구분도 (TAPE-1 소모품 → 부자재)', await ev(() => ERP.plan.run('all').mats.find(m => m.code === 'TAPE-1').mkind), 'SM');
    // 엑셀 자재 시트: 구분 칸 (단계 칸 앞)
    const xs = await ev(() => { const s = ERP.plan.sheets(ERP.plan.run('all'), ERP.plan.run('firm')).find(x => x.name === '자재'); return { hd: s.aoa[0].slice(0, 5), res: s.aoa.find(r => r[0] === 'RES-1').slice(0, 5) }; });
    eq('엑셀 자재 시트: 품목코드 · 품명 · 구분 · 단계 · 단위 (RES-1 = 원재료 · RM)', xs, { hd: ['품목코드', '품명', '구분', '단계', '단위'], res: ['RES-1', 'RESIN', '원재료', 'RM', 'kg'] });
    // 휴대폰 폭: 구분 단추가 줄을 바꿔 화면이 옆으로 넘치지 않음 (표는 안에서 밀기)
    await A.setViewportSize({ width: 390, height: 840 }); await ev(() => ERP.render()); await settle();
    const w = await ev(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    ok('휴대폰 폭: 자재 탭이 옆으로 넘치지 않음', w.sw <= w.cw + 2, w);
    await A.setViewportSize({ width: 1480, height: 920 }); await settle();
    // 베트남어: 구분 단추 · 알림에 한글 없음
    await ev(() => { ERP.setLang('vi'); ERP.render(); }); await settle();
    const vt = await ev(() => Array.from(document.querySelectorAll('#main .card .toolbar')).map(e => e.innerText).join(' | '));
    ok('베트남어: 자재 탭 단추에 한글 없음', !/[가-힣]/.test(vt) && /Nguyên vật liệu/.test(vt) && /Bán thành phẩm/.test(vt), vt);
    // 되돌림
    await ev(async () => { const DB = ERP.db; ERP.setLang('ko'); ERP.state.plan = null; const del = (t, f) => DB.rows(t).filter(f).forEach(r => DB.remove(t, r._id));
      del('items', r => ['TAPE-1', 'LBL-9', 'CORE-B', 'NOPE-9'].includes(r.code)); del('bom_lines', r => ['TAPE-1', 'LBL-9', 'CORE-B', 'NOPE-9'].includes(r.child)); del('stock_open', r => r.code === 'TAPE-1'); await DB.flush(); });
    eq('되돌리면 처음 계산과 같음 (자재 3종)', await ev(() => { const R = ERP.plan.run('all'); return [R.mats.map(m => m.code).sort(), R.counts]; }), [['CASE-M', 'CTN-M', 'RES-1'], R1.counts]);
  });

  await sec('15. 대체 자재 (1.15.4): 같은 자재 · 다른 수입지 코드 — 소요량 계산 · 생산 계획 자재가 두 재고를 같이 셈 (계산만)', async () => {
    // 사용자 2026-11-12 "대신 BOM에 양쪽다 사용가능해서 MRP에서 빠질수있게 할수있어?" (KAOLIN R-031 한국산 ↔ R-031A 미국산) · "MRP는 실제 빠지는게 아니고 필요량 계산만하는거야"
    const MRP_LINE = [{ code: 'CT-M', qty: 100, unit: 'ea' }];
    const look = () => ev((ln) => { const r1 = (x) => (x === null || x === undefined ? x : Math.round(x * 100) / 100);
      const mr = ERP.mrp(ln, { netSemi: true }).rows.find(r => r.code === 'RES-1') || {}; const R = ERP.plan.run('all'); const pm = R.mats.find(m => m.code === 'RES-1') || {};
      const st = ERP.calc.stock(); const bal = (c) => { const s = st.get(c); return s ? r1(s.bal) : null; };
      return { mrp: { need: r1(mr.need), stock: r1(mr.stock), short: r1(mr.short), alt: (mr.alt || []).map(a => [a.code, r1(a.qty)]) },
        plan: { need: r1(pm.need), stock: r1(pm.stock), short: r1(pm.short), first: pm.first ? pm.first.po : null, judge: pm.judge, alt: (pm.alt || []).map(a => [a.code, r1(a.qty)]) },
        planCodes: R.mats.map(m => m.code).sort(), bal: [bal('RES-1'), bal('RES-1US')], table: !!ERP.TABLES.mat_alt }; }, MRP_LINE);
    const b0 = await look();
    ok('처음: RES-1 이 MRP · 생산 계획 모두 30 kg 넘게 모자람 (시험 전제)', b0.mrp.short > 30 && b0.plan.need - b0.plan.stock > 30, b0);
    // 미국산 RES-1US (재고 30 kg) 를 RES-1 과 같은 자재로
    await ev(async (o) => { const DB = ERP.db; DB.add('items', { code: 'RES-1US', name: 'RESIN USA', stage: 'RM', unit: 'kg', src: 'test' }); DB.add('stock_open', { date: o.EC, scope: 'WH', code: 'RES-1US', qty: 30, unit: 'kg' });
      try { DB.add('mat_alt', { code: 'RES-1', alt: 'RES-1US', note: '수입지 미국' }); } catch (e) { /* 1.15.3 까지는 표가 없음 */ } await DB.flush(); }, { EC: D(-60) });
    const b1 = await look();
    ok('대체 자재 표 (mat_alt) 가 있음', b1.table, b1);
    eq('소요량 계산 (MRP): RES-1 필요량 · 재고는 그대로, 모자람이 미국산 30 kg 만큼 줄고 대체 자재 = RES-1US 30', [b1.mrp.need, b1.mrp.stock, b1.mrp.short, b1.mrp.alt],
      [b0.mrp.need, b0.mrp.stock, Math.round((b0.mrp.short - 30) * 100) / 100, [['RES-1US', 30]]]);
    eq('생산 계획 자재: 필요량 · 자기 재고 그대로 (해외 주문 권장 주문량은 코드마다), 모자람만 30 kg 줄고 대체 자재 = RES-1US 30', [b1.plan.need, b1.plan.stock, b1.plan.short, b1.plan.alt],
      [b0.plan.need, b0.plan.stock, Math.max(0, Math.round((b0.plan.short - 30) * 100) / 100), [['RES-1US', 30]]]);
    eq('미국산은 따로 필요한 곳이 없어 자재 줄이 생기지 않음 · 실제 재고는 그대로 (계산만)', [b1.planCodes, b1.bal], [b0.planCodes, [b0.bal[0], 30]]);
    // 화면: 제품 · BOM · 배합 → 대체 자재 탭 · 소요량 계산 표 · 생산 계획 자재 탭 · AI 비서
    await ev(() => { ERP.setLang('ko'); ERP.state.bomTab = 'mat_alt'; ERP.state.params = {}; location.hash = '#/bom'; ERP.render(); }); await settle();
    const tab = await ev(() => ({ tabs: Array.from(document.querySelectorAll('#main .tabs .tab')).map(t => t.textContent.trim()), txt: (document.querySelector('#main .card') || {}).innerText || '' }));
    ok('제품 · BOM · 배합 → "대체 자재" 탭: RES-1 · RES-1US · 메모 · 설명 (실제 재고는 그대로)', tab.tabs.includes('대체 자재') && /RES-1US/.test(tab.txt) && /수입지 미국/.test(tab.txt) && /실제 재고/.test(tab.txt), tab);
    await ev((ln) => { ERP.db.setSetting('mrpLines', ln); ERP.state.bomTab = 'mrp'; ERP.render(); }, MRP_LINE); await settle();
    const mt = await ev(() => { const t = Array.from(document.querySelectorAll('#main table')).pop(); const hd = Array.from(t.querySelectorAll('thead th')).map(x => x.innerText.trim());
      const tr = Array.from(t.querySelectorAll('tbody tr')).find(x => Array.from(x.children).some(td => td.innerText.trim() === 'RES-1')); return { hd, row: tr ? Array.from(tr.children).map(td => td.innerText.replace(/\s+/g, ' ').trim()) : null }; });
    ok('소요량 계산 표: "대체 자재" 칸에 RES-1US 30', mt.hd.includes('대체 자재') && mt.row && mt.row[mt.hd.indexOf('대체 자재')] === 'RES-1US 30', mt);
    await ev(() => { ERP.state.plan = { tab: 'mats', matAll: true }; location.hash = '#/plan'; ERP.render(); }); await settle();
    const pt = await ev(() => { const t = document.querySelector('#main .card table'); const hd = Array.from(t.querySelectorAll('thead th')).map(x => x.innerText.trim());
      const tr = Array.from(t.querySelectorAll('tbody tr')).find(x => /^RES-1\b/.test(x.children[0].innerText.trim())); return { hd, row: tr ? Array.from(tr.children).map(td => td.innerText.replace(/\s+/g, ' ').trim()) : null }; });
    ok('생산 계획 자재 탭: "대체 자재" 칸에 RES-1US 30', pt.hd.includes('대체 자재') && pt.row && pt.row[pt.hd.indexOf('대체 자재')] === 'RES-1US 30', pt);
    const ai = await ev((ln) => { const T = ERP.ai.tools; const m = T.mrp({ lines: ln, only_short: false }).rows.find(r => r.code === 'RES-1'); const p = T.production_plan({ view: 'materials' }).materials.find(r => r.code === 'RES-1');
      return [m && m.alternates_used, p && p.alternates_used]; }, MRP_LINE);
    eq('AI 비서 mrp · production_plan 에도 대체 자재 (alternates_used)', ai, [[{ code: 'RES-1US', qty: 30 }], [{ code: 'RES-1US', qty: 30 }]]);
    // 미국산이 넉넉하면 (1,000 kg): 모자람 0 · 첫 모자람 없음 · 충분 — 미국산 재고가 MRP 필요량만큼 쓰임
    await ev(async () => { const DB = ERP.db; const s = DB.rows('stock_open').find(r => r.code === 'RES-1US'); DB.update('stock_open', s._id, { qty: 1000 }); await DB.flush(); });
    const b2 = await look();
    eq('미국산 1,000 kg: MRP 모자람 0 (대체 = 모자랐던 만큼) · 생산 계획 모자람 0 · 첫 모자람 없음 · 충분', [b2.mrp.short, b2.mrp.alt, b2.plan.short, b2.plan.first, b2.plan.judge],
      [0, [['RES-1US', b0.mrp.short]], 0, null, 'enough']);
    // 반대쪽도: 같은 묶음이면 어느 코드가 BOM 에 있어도 (BOM 이 미국산을 쓰고 한국산 재고가 남을 때)
    const rev = await ev(async () => { const DB = ERP.db; const l = DB.rows('bom_lines').find(x => x.child === 'RES-1'); DB.update('bom_lines', l._id, { child: 'RES-1US' });
      const s = DB.rows('stock_open').find(r => r.code === 'RES-1US'); DB.update('stock_open', s._id, { qty: 0 }); const r = DB.rows('stock_open').find(x => x.code === 'RES-1'); DB.update('stock_open', r._id, { qty: 1000 }); await DB.flush();
      const m = ERP.mrp([{ code: 'CT-M', qty: 100, unit: 'ea' }], { netSemi: true }).rows.find(x => x.code === 'RES-1US') || {};
      DB.update('bom_lines', l._id, { child: 'RES-1' }); DB.update('stock_open', r._id, { qty: 5 }); await DB.flush(); return [Math.round((m.short || 0) * 100) / 100, (m.alt || []).map(a => a.code)]; });
    eq('반대쪽: BOM 이 미국산 (재고 0) 이면 한국산 남는 재고로 메움 → 모자람 0 · 대체 = RES-1', rev, [0, ['RES-1']]);
    // 단위가 다른 코드 (PCS 1,000) · 품목에 없는 코드는 이어 두어도 재고를 합치지 않음 — 대체 자재 탭에 알림 (지금 미국산 재고 0 · 한국산 5)
    await ev(async (o) => { const DB = ERP.db; DB.add('items', { code: 'RES-1PC', name: 'RESIN BAG', stage: 'RM', unit: 'PCS', src: 'test' }); DB.add('stock_open', { date: o.EC, scope: 'WH', code: 'RES-1PC', qty: 1000, unit: 'PCS' });
      DB.add('mat_alt', { code: 'RES-1', alt: 'RES-1PC' }); DB.add('mat_alt', { code: 'NOPE-77', alt: 'RES-1' }); await DB.flush(); }, { EC: D(-60) });
    const b3 = await look();
    eq('단위가 다른 코드 (PCS) · 품목에 없는 코드: 합치지 않음 → MRP · 생산 계획 모자람이 처음과 같음 · 대체 없음', [b3.mrp.short, b3.mrp.alt, b3.plan.short, b3.plan.alt], [b0.mrp.short, [], b0.plan.short, []]);
    await ev(() => { ERP.setLang('ko'); ERP.state.bomTab = 'mat_alt'; ERP.state.params = {}; location.hash = '#/bom'; ERP.render(); }); await settle();
    const wb = await ev(() => { const w = document.querySelector('#main .card .warn-box'); return w ? w.innerText : ''; });
    ok('대체 자재 탭 알림: RES-1 ↔ RES-1PC 단위 kg / PCS · NOPE-77 품목에 없는 코드 (RES-1 ↔ RES-1US 는 알림 없음)', /RES-1 ↔ RES-1PC — 단위 kg \/ PCS/.test(wb) && /NOPE-77 ↔ RES-1 — 품목에 없는 코드 NOPE-77/.test(wb) && !/RES-1US/.test(wb), wb);
    // Codex 검토 (2026-11-12) 1: 같은 코드가 목록에 두 줄 (BOM 에 b · B) 이면 필요량을 합쳐 남는 재고를 셈 — 첫 줄만 보면 없는 재고를 빌려줌
    const dupCov = await ev(() => Array.from(ERP.inv.altCover([{ code: 'RES-1', need: 5, have: 10 }, { code: 'RES-1', need: 5, have: 10 }, { code: 'RES-1US', need: 8, have: 0 }], () => 0).entries()).map(([k, v]) => [k, v.got]));
    eq('대체 계산: RES-1 이 두 줄 (5 + 5 kg, 재고 10) 이면 남는 재고 0 → RES-1US 에 빌려주지 않음', dupCov, []);
    //   생산 계획: BOM 에 대소문자만 다른 자식 (res-1) 이 더 있으면 품목 코드 하나로 모아 한 줄 (필요량 합 — 예전에는 두 줄이 재고를 따로 다 셈)
    const dup = await ev(async () => { const DB = ERP.db; const n0 = ERP.plan.run('all').mats.find(m => m.code === 'RES-1').need; const l = DB.rows('bom_lines').find(x => x.child === 'RES-1');
      const nl = DB.add('bom_lines', { parent: l.parent, child: 'res-1', qty: l.qty, loss: l.loss, note: l.note }); await DB.flush();
      const rows = ERP.plan.run('all').mats.filter(m => String(m.code).toUpperCase() === 'RES-1'); const out = { n: rows.length, codes: rows.map(m => m.code), twice: rows.length === 1 && Math.abs(rows[0].need - 2 * n0) < 1e-6 };
      DB.remove('bom_lines', nl._id); await DB.flush(); return out; });
    eq('생산 계획: BOM 자식 RES-1 · res-1 → 자재 줄 RES-1 하나 · 필요량 = 두 줄 합', dup, { n: 1, codes: ['RES-1'], twice: true });
    // Codex 검토 2: 소요량 계산 (MRP) 은 마이너스 재고만큼 더 모자람 (예전 그대로) → 대체 자재도 그만큼 같이 셈 (생산 계획은 마이너스 재고 = 0)
    await ev(async () => { const DB = ERP.db; const r = DB.rows('stock_open').find(x => x.code === 'RES-1'); DB.update('stock_open', r._id, { qty: -5 }); const s = DB.rows('stock_open').find(x => x.code === 'RES-1US'); DB.update('stock_open', s._id, { qty: 1000 }); await DB.flush(); });
    const b4 = await look();
    eq('한국산 재고 −5 · 미국산 1,000 kg: MRP 모자람 0 · 대체 = 필요량 + 5 / 생산 계획 재고 0 · 모자람 0 · 대체 = 필요량', [b4.mrp.stock, b4.mrp.short, b4.mrp.alt, b4.plan.stock, b4.plan.short, b4.plan.alt],
      [-5, 0, [['RES-1US', Math.round((b0.mrp.need + 5) * 100) / 100]], 0, 0, [['RES-1US', b0.plan.need]]]);
    await ev(async () => { const DB = ERP.db; const r = DB.rows('stock_open').find(x => x.code === 'RES-1'); DB.update('stock_open', r._id, { qty: 5 }); const s = DB.rows('stock_open').find(x => x.code === 'RES-1US'); DB.update('stock_open', s._id, { qty: 0 }); await DB.flush(); });
    // 베트남어 탭 이름 · 알림
    await ev(() => { ERP.setLang('vi'); ERP.state.bomTab = 'mat_alt'; location.hash = '#/bom'; ERP.render(); }); await settle();
    const vt = await ev(() => ({ tabs: Array.from(document.querySelectorAll('#main .tabs .tab')).map(t => t.textContent.trim()), warn: (document.querySelector('#main .card .warn-box') || {}).innerText || '' }));
    ok('베트남어: 탭 = Vật tư thay thế · 알림에 한글 없음', vt.tabs.includes('Vật tư thay thế') && /đơn vị kg \/ PCS/.test(vt.warn) && !/[가-힣]/.test(vt.warn), vt);
    // 되돌림
    await ev(async () => { const DB = ERP.db; ERP.setLang('ko'); ERP.state.plan = null; ERP.state.bomTab = null; const del = (t, f) => { if (!ERP.TABLES[t]) return; DB.rows(t).filter(f).forEach(r => DB.remove(t, r._id)); };
      del('items', r => ['RES-1US', 'RES-1PC'].includes(r.code)); del('stock_open', r => ['RES-1US', 'RES-1PC'].includes(r.code)); del('mat_alt', () => true); DB.setSetting('mrpLines', null); await DB.flush(); });
    eq('되돌리면 처음 계산과 같음', await look().then(x => [x.mrp, x.plan]), [b0.mrp, b0.plan]);
  });

  await sec('12. 베트남어 · 휴대폰 폭 · 오류 없음', async () => {
    await ev(() => { ERP.setLang('vi'); ERP.state.plan = { tab: 'orders' }; location.hash = '#/plan'; ERP.render(); }); await settle();
    for (const t of [1, 2, 3, 4, 5]) { await A.click('.tabs .tab:nth-child(' + t + ')'); await settle(); }
    const vi = await ev(() => ({ h1: document.querySelector('.page-head h1').textContent, ko: /[가-힣]/.test(Array.from(document.querySelectorAll('.page-head, .kpis, .tabs')).map(e => e.innerText).join(' ')), po: ERP.plan.run('all').orders.find(o => o.none).po }));
    eq('베트남어: 제목 · 머리 · 카드 · 탭에 한글 없음 · PO미정 = Chưa có PO', [vi.h1, vi.ko, vi.po], ['Kế hoạch sản xuất', false, 'Chưa có PO']);
    await A.setViewportSize({ width: 390, height: 840 }); await ev(() => ERP.render()); await settle();
    const w = await ev(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    ok('휴대폰 폭에서 화면이 옆으로 넘치지 않음 (표는 안에서 밀기)', w.sw <= w.cw + 2, w);
    await A.setViewportSize({ width: 1480, height: 920 }); await ev(() => ERP.setLang('ko')); await settle();
    eq('화면 오류 없음', errors, []);
  });

  console.log('\n' + (fail ? '✗' : '✓') + ' 19차 시험: ' + pass + ' 통과 / ' + fail + ' 실패');
  if (fail) { console.log('실패:'); failures.forEach(f => console.log('  - ' + f)); }
  await browser.close(); S.close(); fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
