'use strict';
/* 20차(v1.15.0) 자동 시험: 현장 재고 = 공정마다 따로 (공정 카드) · 공정 · 구분 · 품목군은 ERP CODE 없이 (현장 분류)
   사용자 2026-11-06: "현장재고에 보이는게 이상하다. 공정체크하니까 중복으로 보여지는데 사출현장재고따로 리필성형 현장재고 따로 조립현장재고 따로 포장 현장재고 따로 이렇게 보이게 해야한다."
     · "완전히 잘못만들어놨다 지금" → 설계안 → "네, 이대로" · "이카운터에서 가져온 erp코드는 무시하고 너가 만들어"
   1 예전 설정 (공정 3개를 더한 표) → 공정 카드가 따로 · 공정끼리 더한 숫자 없음 (고치기 전 실패: 표 하나에 리필 + 조립 + 사출을 더함)
   2 현장 분류: 사람 → 단위 (SET · CT) → 생산 일보 → 색상별 BOM · 리필 규격 · 품목 구성 → 반제품 목록 → BOM 구조 → 이름 (ERP CODE 단계 · 제품군 · ECOUNT BOM 비고는 안 씀)
   3 사출 = 구분 × 품목군 (줄마다 합계, 맨 아래 합계 없음) · 묶음 이름 생산은 일보 품목군으로 나뉘어 개별 부품 소모와 같은 칸
   4 리필 · 권취 = 품목군 (맨 아래 합계) · 조립 · 포장 = 품목군 × 구분 (칸마다 합계, 칸끼리 안 더함) · 분류 안 된 품목 (합계 없음)
   5 카드 합 = 아래 품목 표 합 (공정 · 단위마다) · 6 칸 → 아래 표 (공정 탭 · 구분 · 품목군) · 품목 줄 → 수불부
   7 경고 (마이너스 · 못 넣은 일보 · BOM 없는 생산) · 8 카드 설정 (줄 · 품목군 · 범위 · 0 줄 · 숨기기) → floorCards, floorPivots 그대로
   9 엑셀 = 공정마다 시트 + 품목 목록 · 10 종합 현황 위젯 (공정 하나, 예전 '모든 공정' = 카드 묶음) · 11 품목 기준 정보 '생산 공정' · 12 베트남어 · 오류 없음
   사용:  npm run test:v20   (Playwright 필요: npm i -D playwright 또는 playwright-core + 설치된 Chrome/Edge) */
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
let pw; try { pw = require('playwright'); } catch (e) { try { pw = require('playwright-core'); } catch (e2) { console.error('Playwright가 필요합니다 / cần Playwright:  npm i -D playwright'); process.exit(2); } }
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const serverMod = require(path.join(ROOT, 'server.js'));

let pass = 0, fail = 0; const failures = [];
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 900 ? s.slice(0, 900) + '…' : s; };
function ok(name, cond, detail) { if (cond) { pass++; return true; } fail++; const line = name + (detail !== undefined ? '  → ' + short(detail) : ''); failures.push(line); console.log('  ✗ ' + line); return false; }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
async function sec(t, fn) { console.log('\n■ ' + t); try { await fn(); } catch (e) { ok(t + ' — 예외', false, String((e && e.message) || e).split('\n')[0].slice(0, 300)); } }
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

const FLOOR = '2026-08-31', EC = '2026-06-30', D1 = '2026-09-05';
const OLD_PIVOTS = [{ id: 'asm', title: '리필 성형 · 조립 · 사출 재고', procs: ['REF', 'ASM', 'INJ'], divs: [], rows: 'div', cols: 'none', scope: 'all' }];

(async () => {
  const dataDir = tmp('erp-v20-');
  const S = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir, host: '127.0.0.1', port: 7700 + Math.floor(Math.random() * 250), backupDelay: 3600000 });
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 } });
  const A = await ctx.newPage(); A.on('pageerror', e => errors.push('pageerror: ' + e.message));
  A.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Failed to fetch/.test(m.text())) errors.push('console: ' + m.text()); });
  const ready = () => A.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 180000 });
  const ev = (fn, arg) => A.evaluate(fn, arg);
  const settle = () => A.waitForTimeout(350);
  /** 공정 카드들: [{ id, title, head, rows: [[...]], help, warns, edit, narrow }] */
  const cards = () => ev(() => Array.from(document.querySelectorAll('main .fpiv-card')).map(c => ({ id: c.dataset.id, title: c.querySelector('h2').textContent,
    head: Array.from(c.querySelectorAll('thead th')).map(t => t.innerText.replace(/\s+/g, ' ').trim()),
    rows: Array.from(c.querySelectorAll('tbody tr')).map(tr => Array.from(tr.children).map(td => td.innerText.replace(/\s+/g, ' ').trim())),
    warns: Array.from(c.querySelectorAll('.fpiv-warns .fpiv-w')).map(b => [b.dataset.w, b.innerText.trim()]), help: Array.from(c.querySelectorAll('p.help')).map(p => p.textContent).join(' | '), edit: !!c.querySelector('.fpiv-edit'), narrow: c.classList.contains('narrow') })));
  const card = async (id) => (await cards()).find(c => c.id === id) || null;
  const floor = async () => { await ev(() => { ERP.state.stk_floor = null; ERP.state.fpiv = {}; ERP.goStock('floor'); ERP.render(); }); await settle(); };
  const tableCodes = () => ev(() => Array.from(document.querySelectorAll('main table.tbl:not(.fpiv-t):not(.fraw-t) tbody tr')).map(tr => tr.children[0].innerText.trim()).sort());
  await A.goto(S.url + '/#/home'); await ready();

  await ev(async (o) => { const DB = ERP.db; await DB.wipe();
    const it = (code, name, stage, line, unit, extra) => Object.assign({ code, name, stage, line: line || undefined, unit: unit || 'PCS', src: 'test' }, extra || {});
    DB.replace('items', [
      it('Barrel', 'Barrel', 'WIP01'), it('Holder', 'Holder', 'WIP03'),   // 사출 일보의 묶음 이름 (품목군 없음)
      it('MH', 'MINI HOLDER', 'WIP03', 'MINI'), it('BP', 'BARREL PENCIL', 'WIP01', 'PEN'), it('B-M1', 'RED', 'WIP01', 'MINI'),
      it('X-NOSE', 'RED [Nose cone]', 'WIP', 'REG'),   // ERP CODE 는 조립 완료 · Dial — 반제품 목록은 노즈콘 · Pencil
      it('R-M1', 'RED', 'WIP00', 'MINI'), it('R-P1', 'BLUE', 'WIP', 'MINI'),   // R-P1: ERP CODE 는 조립 · Mini — 색상별 BOM 은 심 · Pencil
      it('A-M1', 'RED', 'WIP', 'MINI'), it('A-P1', 'PENCIL RED', 'WIP55', 'PEN'), it('W-G1', 'WHITE', 'WIP', 'GLA'),
      it('K-P1', 'PENCIL 12 MANILA', 'SG', 'PEN', 'SET'), it('K-P2', 'PENCIL 12 BOX', 'FG', 'PEN', 'CT'),
      it('M-1', 'SOMETHING', 'WIP00', 'MINI', 'PCS', { proc: 'ASM', fkind: 'SUB', fline: 'CPC' }),   // 사람이 정함
      it('U-1', 'MYSTERY', 'WIP01', 'MINI'),   // 자료 없음 — ERP CODE 가 배럴이어도 분류 안 됨
      it('N-1', 'GREEN TUBE', 'WIP'),          // 이름 낱말 TUBE → 사출 · 그 밖의 부품 (ERP CODE 는 조립 · ECOUNT BOM 비고 '조립' 도 안 씀)
      it('RM-1', 'RESIN', 'RM', '', 'kg')]);
    const fl = (code, qty) => ({ date: o.FLOOR, scope: 'FAC', code, qty, unit: 'PCS', grp: 'floor' });
    DB.replace('stock_open', [fl('MH', 100), fl('BP', 50), fl('B-M1', 200), fl('X-NOSE', 30), fl('R-M1', 500), fl('R-P1', 80), fl('A-M1', 1000), fl('A-P1', 300), fl('W-G1', 40), fl('M-1', 15), fl('U-1', 7), fl('N-1', 9),
      { date: o.EC, scope: 'FAC', code: 'K-P1', qty: 7, unit: 'SET' }, { date: o.EC, scope: 'WH', code: 'K-P2', qty: 3, unit: 'CT' }, { date: o.EC, scope: 'WH', code: 'RM-1', qty: 900, unit: 'kg' }]);
    DB.replace('stock_tx', []);
    const pl = (process, division, code, qty, part) => ({ date: o.D1, process, shift: 'D', division, code, name: part || code, part: part || undefined, ok_qty: qty, ok_ea: qty, ng_qty: 0 });
    DB.replace('prod_log', [pl('INJ', 'Mini', 'Barrel', 600, 'Barrel'), pl('INJ', 'Pencil', 'Barrel', 400, 'Barrel'), pl('INJ', 'Mini', 'Holder', 300, 'holder'),
      pl('ASM', 'Mini', 'A-M1', 100), pl('ASM', 'Pencil', 'A-P1', 70), pl('WRP', 'Glass', 'W-G1', 60), pl('WRP', 'Glass', 'Blue - Light', 25), pl('REF', 'Mini', 'R-M1', 200)]);
    DB.replace('bom', [{ retail_no: 'RT-1', color_code: 'A-M1', color_name: 'Red', division: 'Mini', refill_code: 'R-M1', barrel_code: 'B-M1', holder: 'MH' },
      { retail_no: 'RT-2', color_code: 'A-P1', color_name: 'Red', division: 'Pencil', refill_code: 'R-P1', barrel_code: 'BP' }]);
    // ECOUNT BOM 줄 비고 (사출 · 리필 성형 · 포장 · 조립) 는 현장 분류에 쓰지 않는다 — 일부러 틀린 비고 '조립' 을 N-1 · MH 줄에 둔다
    DB.replace('bom_lines', [{ parent: 'A-M1', child: 'MH', qty: 1, note: '조립', src: 'ecount' }, { parent: 'A-M1', child: 'B-M1', qty: 1, note: '사출', src: 'ecount' }, { parent: 'A-M1', child: 'R-M1', qty: 1, note: '리필 성형', src: 'ecount' },
      { parent: 'A-P1', child: 'BP', qty: 1, note: '사출', src: 'ecount' }, { parent: 'A-P1', child: 'R-P1', qty: 1, note: '리필 성형', src: 'ecount' },
      { parent: 'ZZ-PEN', child: 'N-1', qty: 1, note: '조립', src: 'ecount' }, { parent: 'K-P2', child: 'K-P1', qty: 12, note: '포장', src: 'ecount' }]);
    DB.replace('item_bom', [{ item: 'K-P2', kind: 'Pencil', colors: 12, cs: 12 }]);
    DB.replace('semi_items', [{ code: 'X-NOSE', name: 'Red', cl1: 'Nose cone', cl2: 'Nose cone', cl3: 'Pencil' }]);
    DB.replace('refill_specs', [{ customer: 'T', kind: 'Mini', code: 'RS-1', name: 'Red', erp_code: 'R-M1' }]);
    DB.meta.openDate = { WH: o.EC, FAC: o.EC, FLOOR: o.FLOOR }; DB.meta.seeded = DB.meta.seeded || new Date().toISOString(); delete DB.meta.floorPivots; delete DB.meta.floorCards;
    await DB.saveMeta(); await DB.flush(); }, { FLOOR, EC, D1 });

  await sec('1. 예전 설정 (리필 성형 · 조립 · 사출을 더한 표) → 공정 카드가 따로 · 공정끼리 더한 숫자 없음', async () => {
    await ev(async (v) => { ERP.db.setSetting('floorPivots', v); await ERP.db.flush(); }, OLD_PIVOTS); await floor();
    const c = await cards();
    eq('카드 = 사출 · 리필 성형 · 조립 · 종이 권취 · 포장 · 분류 안 된 품목 (예전 표 하나 아님)', c.map(x => [x.id, x.title]), [['INJ', '사출 재고'], ['REF', '리필 성형 재고'], ['ASM', '조립 재고'], ['WRP', '종이 권취 재고'], ['PCK', '포장 재고'], ['NONE', '분류 안 된 품목']]);
    const mini = await ev(() => ERP.inv.rows().filter(s => ERP.inv.groupOf(s) === 'floor' && ['INJ', 'REF', 'ASM'].includes(ERP.pivot.procOf(s))).reduce((a, s) => a + s.bal, 0));
    ok('어느 칸에도 세 공정을 더한 숫자 (' + mini + ') 가 없음', !(await ev(() => document.querySelector('main .fpiv').innerText)).includes(Number(mini).toLocaleString('en-US')), mini);
    eq('예전 설정 floorPivots 는 지우지 않음 · floorCards 는 아직 없음', await ev(() => [ERP.db.setting('floorPivots', null), ERP.db.setting('floorCards', null)]), [OLD_PIVOTS, null]);
  });

  await sec('2. 현장 분류 — ERP CODE (단계 · 제품군) · ECOUNT BOM 비고 안 씀: 사람 · 단위 · 생산 일보 · 공장 자료 · 반제품 목록 · BOM 구조 · 이름', async () => {
    const got = await ev(() => Object.fromEntries(['Barrel', 'Holder', 'MH', 'BP', 'B-M1', 'X-NOSE', 'R-M1', 'R-P1', 'A-M1', 'A-P1', 'W-G1', 'K-P1', 'K-P2', 'M-1', 'U-1', 'N-1'].map(c => { const x = ERP.inv.floorClassOf(c); return [c, [x.proc, x.kind, x.multi ? '*' : x.line, x.src]]; })));
    eq('공정 · 구분 · 품목군 · 정한 자료', got, {
      Barrel: ['INJ', 'BARREL', '*', 'log'], Holder: ['INJ', 'HOLDER', 'MINI', 'log'], MH: ['INJ', 'HOLDER', 'MINI', 'master'], BP: ['INJ', 'BARREL', 'PEN', 'master'], 'B-M1': ['INJ', 'BARREL', 'MINI', 'master'],
      'X-NOSE': ['INJ', 'NOSE', 'PEN', 'semi'], 'R-M1': ['REF', 'CORE', 'MINI', 'log'], 'R-P1': ['REF', 'CORE', 'PEN', 'master'], 'A-M1': ['ASM', 'ASSY', 'MINI', 'log'], 'A-P1': ['ASM', 'ASSY', 'PEN', 'log'],
      'W-G1': ['WRP', 'WRAP', 'GLA', 'log'], 'K-P1': ['PCK', 'SET', 'PEN', 'unit'], 'K-P2': ['PCK', 'BOX', 'PEN', 'unit'], 'M-1': ['ASM', 'SUB', 'CPC', 'manual'], 'U-1': ['', '', '', ''], 'N-1': ['INJ', 'PART', '', 'name'] });
    eq('품목군 글: Peel (종이 권취 · 리필 규격) = Glass · Dial Mini = Mini · Regular = Dial · CLICK PENCIL = Click pencil', await ev(() => ['Peel', 'Dial Mini', 'Regular', 'CLICK PENCIL - YEL', 'Mini/Dial', 'PENCIL SILLY'].map(ERP.inv.floorLine)), ['GLA', 'MINI', 'REG', 'CPC', 'MINI', 'PEN']);
    eq('묶음 이름 Barrel 의 생산 입고 = 일보 품목군 (Mini 600 · Pencil 400)', await ev(() => Array.from(ERP.inv.floorSplit().get('Barrel') || []).sort()), [['MINI', 600], ['PEN', 400]]);
  });

  await sec('3. 사출 카드 = 구분 × 품목군 · 줄마다 합계 · 맨 아래 합계 없음 · 묶음 생산이 개별 부품과 같은 칸', async () => {
    const c = await card('INJ');
    eq('머리', c.head, ['구분 \\ 품목군', '합계', 'Mini', 'Pencil', '품목군 미지정']);
    // 배럴 Mini = B-M1 (200 − 조립 100) + Barrel Mini 600 = 700 · Pencil = BP (50 − 70) + Barrel Pencil 400 = 380 · 홀더 Mini = MH (100 − 100) + Holder 300
    eq('줄 (부품 종류끼리는 더하지 않음)', c.rows, [['배럴', '1,080', '700', '380', '·'], ['노즈콘', '30', '·', '30', '·'], ['홀더', '300', '300', '·', '·'], ['그 밖의 부품', '9', '·', '·', '9']]);
    ok('넓은 카드 · 단위 PCS · 실사 · 마지막 일보', !c.narrow && /단위 PCS/.test(c.help) && /실사 2026-08-31/.test(c.help) && /마지막 일보 2026-09-05/.test(c.help), c);
    const tip = await ev(() => { const td = document.querySelector('main .fpiv-card[data-id="INJ"] tbody tr[data-k="BARREL"] td:nth-child(3)'); return td && td.title; });
    ok('칸 설명 = 실사 + 생산 − 사용 ± 기타 = 현재 (배럴 Mini: B-M1 실사 200 + Barrel Mini 생산 600 − 조립 사용 100 = 700)', /실사 200 \+ 생산 600 − 사용 100 ± 기타 0 = 700/.test(tip || ''), tip);
  });

  await sec('4. 리필 · 조립 · 종이 권취 · 포장 · 분류 안 된 품목', async () => {
    const c = await cards(); const by = Object.fromEntries(c.map(x => [x.id, x]));
    eq('리필 성형 = 품목군 · 맨 아래 심 합계 (R-P1: ERP CODE 조립이어도 심)', [by.REF.head, by.REF.rows, by.REF.narrow], [['품목군', '현재 재고'], [['Mini', '600'], ['Pencil', '10'], ['합계', '610']], true]);
    eq('조립 = 품목군 × 구분 · 칸마다 합계 (조립품 + 중간품은 안 더함) · Glass 없음', [by.ASM.head, by.ASM.rows], [['품목군 \\ 구분', '조립품', '조립 중간품'], [['Mini', '1,100', '·'], ['Pencil', '370', '·'], ['Click pencil', '·', '15'], ['합계', '1,470', '15']]]);
    eq('종이 권취 = Glass (조립이 아님)', [by.WRP.head, by.WRP.rows], [['품목군', '현재 재고'], [['Glass', '100'], ['합계', '100']]]);
    eq('포장 = 세트 (SET) · 박스 (CT) — 단위끼리 안 더함', [by.PCK.head, by.PCK.rows], [['품목군 \\ 구분', '세트 (SET)', '박스 (CT)'], [['Pencil', '7', '3'], ['합계', '7', '3']]]);
    eq('분류 안 된 품목 = 품목 줄 · 합계 없음 · 고칠 곳 안내', [by.NONE.head, by.NONE.rows, /생산 공정/.test(by.NONE.help)], [['품목', '현재 재고'], [['U-1', '7']], true]);
    ok('원재료 환산 카드는 그대로 (카드 뒤)', await ev(() => !!document.querySelector('main .fpiv .fraw-card')));
  });

  await sec('5. 카드 합 = 아래 품목 표 합 (공정 · 단위마다)', async () => {
    const r = await ev(() => { const P = ERP.pivot; const out = {};
      P.procs().forEach(p => { const d = P.buildCard(p, P.cleanCfg(null)); const cardSum = {}; d.rows.forEach(r => r.cells.forEach((x, k) => { const u = r.unit || (d.cols.find(c => c.k === k) || {}).unit; cardSum[u] = Math.round((cardSum[u] || 0) + x.v); }));
        const items = {}; ERP.inv.rows().filter(s => ERP.inv.groupOf(s) === 'floor' && P.procOf(s) === p).forEach(s => { items[s.prim] = Math.round((items[s.prim] || 0) + s.bal); });
        Object.keys(items).forEach(u => { if (!items[u]) delete items[u]; }); Object.keys(cardSum).forEach(u => { if (!cardSum[u]) delete cardSum[u]; }); out[p] = [cardSum, items]; });
      return out; });
    Object.keys(r).forEach(p => eq(p + ': 카드 합 = 품목 표 합', r[p][0], r[p][1]));
  });

  await sec('6. 칸 → 아래 품목 표 (공정 탭 · 구분 · 품목군) · 품목 줄 → 수불부', async () => {
    await A.click('main .fpiv-card[data-id="INJ"] tbody tr[data-k="BARREL"] td:nth-child(3)'); await settle();
    eq('사출 · 배럴 · Mini 칸 → B-M1 · Barrel (묶음 생산의 Mini 몫) · 사출 탭', [await ev(() => [ERP.state.stk_floor.proc, ERP.state.stk_floor.kind, ERP.state.stk_floor.fline]), await tableCodes(),
      await ev(() => Array.from(document.querySelectorAll('main .fstk-tabs button.primary')).map(b => b.textContent))], [['INJ', 'BARREL', 'MINI'], ['B-M1', 'Barrel'], ['사출']]);
    const brow = await ev(() => { const tr = Array.from(document.querySelectorAll('main table.tbl:not(.fpiv-t):not(.fraw-t) tbody tr')).find(x => x.children[0].innerText.trim() === 'Barrel'); return tr ? tr.children[1].textContent.replace(/\s+/g, ' ') : null; });
    ok('묶음 품목 줄에 공정 · 구분 · 일보 품목군별 생산 (Mini 600 · Pencil 400)', /사출/.test(brow || '') && /배럴/.test(brow || '') && /일보 품목군: Mini 600 · Pencil 400/.test(brow || ''), brow);
    await A.click('main .fpiv-card[data-id="REF"] tbody tr[data-k="PEN"] td.pc:first-child'); await settle();
    eq('리필 · Pencil 줄 → R-P1', [await ev(() => [ERP.state.stk_floor.proc, ERP.state.stk_floor.kind, ERP.state.stk_floor.fline]), await tableCodes()], [['REF', '', 'PEN'], ['R-P1']]);
    await A.click('main .fstk-tabs button[data-tab="ASM"]'); await settle();
    eq('공정 탭 조립 → 조립 품목 (A-M1 · A-P1 · M-1, 종이 권취 W-G1 없음)', await tableCodes(), ['A-M1', 'A-P1', 'M-1']);
    await A.click('main .fstk-tabs button[data-tab="all"]'); await settle();
    ok('모든 공정 탭 → 현장 품목 모두 (원부자재 RM-1 없음)', (await tableCodes()).length === 16 && !(await tableCodes()).includes('RM-1'), await tableCodes());
    await A.click('main .fpiv-card[data-id="NONE"] tbody tr[data-k="U-1"] td.pc'); await settle();
    ok('분류 안 된 품목 줄 → 그 품목 수불부 (U-1)', /U-1/.test(await ev(() => (document.querySelector('.modal .modal-head') || {}).textContent || '')));
    await A.keyboard.press('Escape'); await settle();
  });

  await sec('7. 경고: 마이너스 · 못 넣은 일보 · BOM 없는 생산 (생산 반영 진단과 같음)', async () => {
    await floor(); const c = await cards(); const by = Object.fromEntries(c.map(x => [x.id, x.warns]));
    eq('사출: 마이너스 1품목 (BP −20) · 종이 권취: 못 넣은 일보 1줄 · BOM 없는 생산 1품목 · 리필: BOM 없는 생산 1품목', [by.INJ, by.WRP, by.REF, by.ASM, by.PCK],
      [[['neg', '마이너스 1품목']], [['notItem', '못 넣은 일보 1줄'], ['noBom', 'BOM 없는 생산 1품목']], [['noBom', 'BOM 없는 생산 1품목']], [], []]);
    await A.click('main .fpiv-card[data-id="INJ"] .fpiv-w[data-w="neg"]'); await settle();
    eq('마이너스 → 아래 표 = 사출 · 마이너스 품목 (BP)', [await ev(() => [ERP.state.stk_floor.proc, ERP.state.stk_floor.status]), await tableCodes()], [['INJ', 'neg'], ['BP']]);
  });

  await sec('8. 카드 설정 (줄 · 품목군 · 범위 · 0 줄 · 숨기기) → floorCards, floorPivots 그대로', async () => {
    await floor();
    await A.click('main .fpiv-card[data-id="INJ"] button[data-act="edit"]'); await settle();
    const ed = await ev(() => { const e = document.querySelector('main .fpiv-card[data-id="INJ"] .fpiv-edit'); return { rows: Array.from(e.querySelectorAll('select[data-k="rows"] option')).map(o => o.textContent), divs: Array.from(e.querySelectorAll('[data-div]')).map(l => [l.dataset.div, l.innerText.trim(), l.querySelector('input').checked]), scope: Array.from(e.querySelectorAll('select[data-k="scope"] option')).map(o => o.textContent), proc: e.querySelectorAll('[data-proc]').length }; });
    eq('설정: 줄 2가지 · 품목군 (전체 켜짐 + 있는 품목군) · 범위 · 공정 고르기 없음', ed, { rows: ['구분 × 품목군', '품목 (색) 까지'], divs: [['*', '전체', true], ['MINI', 'Mini', false], ['PEN', 'Pencil', false], ['', '품목군 미지정', false]], scope: ['창고+공장', '창고', '공장'], proc: 0 });
    await A.click('main .fpiv-card[data-id="INJ"] .fpiv-edit label[data-div="MINI"] input'); await settle();
    eq('품목군 Mini 만 → 사출 카드 = Mini 칸 하나 (배럴 700 · 홀더 300)', [(await card('INJ')).head, (await card('INJ')).rows], [['구분', 'Mini'], [['배럴', '700'], ['홀더', '300']]]);
    eq('저장 = floorCards (INJ 품목군 Mini), floorPivots 그대로', await ev(() => [ERP.db.setting('floorCards', null).INJ, ERP.db.setting('floorPivots', null)]), [{ divs: ['MINI'] }, [{ id: 'asm', title: '리필 성형 · 조립 · 사출 재고', procs: ['REF', 'ASM', 'INJ'], divs: [], rows: 'div', cols: 'none', scope: 'all' }]]);
    await A.reload(); await ready(); await floor();
    eq('다시 열어도 그대로', (await card('INJ')).head, ['구분', 'Mini']);
    await A.click('main .fpiv-card[data-id="INJ"] button[data-act="edit"]'); await settle();
    await A.click('main .fpiv-card[data-id="INJ"] .fpiv-edit label[data-div="*"] input'); await settle();
    await A.click('main .fpiv-card[data-id="INJ"] button[data-act="done"]'); await settle();
    await A.click('main .fpiv-card[data-id="REF"] button[data-act="edit"]'); await settle();
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="REF"] select[data-k="rows"]'); s.value = 'item'; s.dispatchEvent(new Event('change')); }); await settle();
    eq('리필 줄 = 품목까지 → R-M1 · R-P1 · 합계 (구분이 하나)', (await card('REF')).rows, [['R-M1', '600'], ['R-P1', '10'], ['합계', '610']]);
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="REF"] select[data-k="scope"]'); s.value = 'WH'; s.dispatchEvent(new Event('change')); }); await settle();
    eq('범위 창고 → 리필 창고 재고 없음', (await card('REF')).rows, []);
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="REF"] select[data-k="scope"]'); s.value = 'all'; s.dispatchEvent(new Event('change')); }); await settle();
    await A.click('main .fpiv-card[data-id="WRP"] button[data-act="edit"]'); await settle();
    await A.click('main .fpiv-card[data-id="WRP"] button[data-act="hide"]'); await settle();
    eq('카드 숨기기 → 종이 권취 카드 없음 · 아래 줄에 보이기', [(await cards()).map(x => x.id), await ev(() => Array.from(document.querySelectorAll('main .fpiv-foot [data-show]')).map(b => [b.dataset.show, b.textContent]))], [['INJ', 'REF', 'ASM', 'PCK', 'NONE'], [['WRP', '종이 권취 보이기']]]);
    await A.click('main .fpiv-foot [data-show="WRP"]'); await settle();
    eq('보이기 → 다시 있음', (await cards()).map(x => x.id), ['INJ', 'REF', 'ASM', 'WRP', 'PCK', 'NONE']);
    await ev(async () => { ERP.db.setSetting('floorCards', null); await ERP.db.flush(); ERP.render(); }); await settle();
  });

  await sec('9. 엑셀 = 공정마다 시트 + 품목 목록', async () => {
    await floor();
    await ev(() => { window.__xl = null; ERP.xl.exportSheets = (name, sheets) => { window.__xl = { name, sheets }; }; });
    await A.click('main .fpiv-foot button[data-act="xl"]'); await settle();
    const x = await ev(() => window.__xl && { name: window.__xl.name, names: window.__xl.sheets.map(s => s.name), inj: window.__xl.sheets[0], items: window.__xl.sheets.slice(-1)[0].rows.length, head: window.__xl.sheets.slice(-1)[0].header.slice(0, 6) });
    eq('시트 = 사출 · 리필 성형 · 조립 · 종이 권취 · 포장 · 분류 안 됨 · 품목 목록', x && [x.name, x.names], ['floor_stock_by_process', ['사출', '리필 성형', '조립', '종이 권취', '포장', '분류 안 됨', '품목 목록']]);
    eq('사출 시트 = 머리 · 줄 (화면과 같음)', x && [x.inj.header, x.inj.rows[0]], [['구분 \\ 품목군', '합계', 'Mini', 'Pencil', '품목군 미지정'], ['배럴', 1080, 700, 380, 0]]);
    eq('품목 목록 = 현장 품목 16 · 공정 · 구분 · 품목군 · 정한 자료', x && [x.items, x.head], [16, ['품목코드', '품명', '공정', '구분', '품목군', '정한 자료']]);
  });

  await sec('10. 종합 현황 위젯: 공정 하나 · 예전 "모든 공정" 위젯 = 카드 묶음', async () => {
    await A.emulateMedia({ reducedMotion: 'reduce' });
    const wOf = () => ev(() => Array.from(document.querySelectorAll('.wgrid .w[data-id=floor_stock]')).map(el => ({ title: el.querySelector('h2').textContent, subs: Array.from(el.querySelectorAll('h3.fpiv-wh')).map(x => x.textContent), tables: el.querySelectorAll('table').length, help: (el.querySelector('p.help') || {}).textContent })));
    await ev(() => { ERP.db.setSetting('dash', [{ k: 'v20-a', id: 'floor_stock', w: 2, o: { proc: '', rows: 'div', cols: 'none' } }]); ERP.state.dashEdit = true; ERP.goto('dashboard'); ERP.render(); }); await settle();
    eq('예전 "모든 공정" 위젯 → 현장 재고 (공정마다) · 공정마다 표', await wOf(), [{ title: '현장 재고 (공정마다)', subs: ['사출', '리필 성형', '조립', '종이 권취', '포장'], tables: 5, help: '현재 재고 · ⚙ 에서 공정 하나를 고르세요' }]);
    await A.click('.wgrid .w[data-id=floor_stock] .wbar button:has-text("⚙")'); await A.waitForSelector('.modal select');
    const opts = await ev(() => Array.from(document.querySelectorAll('.modal select')).map(s => Array.from(s.options).map(o => o.textContent)));
    eq('⚙: 공정 (모든 공정 없음) · 줄', opts, [['사출', '리필 성형', '조립', '종이 권취', '포장'], ['품목군까지', '품목 (색) 까지']]);
    await ev(() => { const s = document.querySelectorAll('.modal select')[0]; s.value = 'INJ'; s.dispatchEvent(new Event('change')); });
    await A.click('.modal .modal-foot button.primary'); await settle();
    const w = await wOf();
    eq('⚙ 공정 = 사출 → 사출 재고 표 하나', [w[0].title, w[0].tables, w[0].subs], ['사출 재고', 1, []]);
    eq('기본 배치의 현장 재고 위젯 = 조립', await ev(() => ERP.dashDefault().filter(x => x.id === 'floor_stock').map(x => ERP.pivot.widget(x.o).title)), ['조립 재고']);
    await ev(() => { ERP.state.dashEdit = false; ERP.render(); }); await settle();
    await ev(() => { const el = document.querySelector('.wgrid .w[data-id=floor_stock]'); el.querySelector('tbody tr[data-k="HOLDER"] td.pc:nth-child(3)').click(); });
    await A.waitForFunction(() => location.hash === '#/floor', null, { timeout: 15000 }); await settle();
    eq('위젯 칸 (사출 · 홀더 · Mini) → 현장 재고 · 아래 표 = Holder · MH', [await ev(() => [ERP.state.stk_floor.proc, ERP.state.stk_floor.kind, ERP.state.stk_floor.fline]), await tableCodes()], [['INJ', 'HOLDER', 'MINI'], ['Holder', 'MH']]);
    await ev(() => { ERP.db.setSetting('dash', null); ERP.state.stk_floor = null; }); await settle();
  });

  await sec('11. 품목 기준 정보 "생산 공정" 을 넣으면 그 공정 카드로 (분류 안 된 품목이 없어짐)', async () => {
    const f = await ev(() => { const S = ERP.TABLES.items; const c = (k) => S.cols.find(x => x.k === k); return ['proc', 'fkind', 'fline'].map(k => [c(k) && c(k).ko, c(k) && c(k).t, (ERP.colOpts(c(k)) || []).length]); });
    eq('품목 칸: 생산 공정 (공정 5) · 현장 구분 (11) · 현장 품목군 (6) — 고르기', f, [['생산 공정', 's', 5], ['현장 구분', 's', 11], ['현장 품목군', 's', 6]]);
    await ev(async () => { const DB = ERP.db; const r = DB.rows('items').find(x => x.code === 'U-1'); DB.update('items', r._id, { proc: 'INJ', fline: 'MINI' }); await DB.flush(); }); await floor();
    eq('U-1 → 사출 · 그 밖의 부품 · Mini · 분류 안 된 품목 카드 없음', [await ev(() => { const x = ERP.inv.floorClassOf('U-1'); return [x.proc, x.kind, x.line, x.src]; }), (await cards()).map(x => x.id), (await card('INJ')).rows.find(r => r[0] === '그 밖의 부품')], [['INJ', 'PART', 'MINI', 'manual'], ['INJ', 'REF', 'ASM', 'WRP', 'PCK'], ['그 밖의 부품', '16', '7', '·', '9']]);
  });

  await sec('13. Codex 검토 (1.15.0): 사람이 정한 품목군 GLA · 구분 · BOM 으로 품목군 채우기 · 구분을 바꾸면 품목군 거르기 풀림', async () => {
    await ev(async () => { const DB = ERP.db; DB.addMany('items', [
      { code: 'G-1', name: 'RED', stage: 'WIP', unit: 'PCS', proc: 'WRP', fline: 'GLA', src: 'test' },   // 사람이 Glass (GLA) 로 정함
      { code: 'F-1', name: 'Barrel Mini', stage: 'WIP01', unit: 'PCS', fkind: 'SPOON', src: 'test' },     // 사람이 스푼으로 정함 (공정은 자동)
      { code: 'S-RED', name: 'RED', stage: 'SG', unit: 'SET', src: 'test' }]);                             // 세트 (단위) — 품목군은 자식 조립품 (Mini) 에서
      DB.add('bom_lines', { parent: 'S-RED', child: 'A-M1', qty: 24, src: 'test' }); await DB.flush(); });
    eq('품목군 코드 그대로 (MINI · REG · PEN · CPC · GLA · MARKER)', await ev(() => ERP.inv.LINE_ORDER.map(ERP.inv.floorLine)), ['MINI', 'REG', 'PEN', 'CPC', 'GLA', 'MARKER']);
    eq('G-1 = 종이 권취 · Glass (사람) · F-1 = 사출 · 스푼 (사람) · S-RED = 포장 · 세트 · Mini (자식 A-M1)', await ev(() => ['G-1', 'F-1', 'S-RED'].map(c => { const x = ERP.inv.floorClassOf(c); return [x.proc, x.kind, x.line]; })),
      [['WRP', 'WRAP', 'GLA'], ['INJ', 'SPOON', 'MINI'], ['PCK', 'SET', 'MINI']]);
    await ev(() => { ERP.state.stk_floor = { stage: '', line: '', sub: '', cat: '', scope: 'all', status: '', q: '', hideZero: true, sk: 'code', sd: 1, page: 0, ps: 100, proc: 'INJ', kind: 'PART', fline: '~' }; ERP.goStock('floor'); ERP.render(); }); await settle();
    eq('사출 · 그 밖의 부품 · 품목군 미지정 → N-1', await tableCodes(), ['N-1']);
    await ev(() => { const s = document.querySelector('main .toolbar select[data-k="kind"]'); s.value = 'BARREL'; s.dispatchEvent(new Event('change')); }); await settle();
    eq('구분을 배럴로 바꾸면 품목군 거르기 풀림 → 배럴 품목 모두', [await ev(() => [ERP.state.stk_floor.kind, ERP.state.stk_floor.fline]), await tableCodes()], [['BARREL', ''], ['B-M1', 'BP', 'Barrel']]);
    await ev(() => { ERP.state.stk_floor.fline = 'GLA'; ERP.render(); }); await settle();
    eq('지금 구분에 없는 품목군 (GLA) 이 남아 있으면 거르지 않음', [await ev(() => ERP.state.stk_floor.fline), await tableCodes()], ['', ['B-M1', 'BP', 'Barrel']]);
    await ev(async () => { const DB = ERP.db; ['G-1', 'F-1', 'S-RED'].forEach(c => { const r = DB.rows('items').find(x => x.code === c); if (r) DB.remove('items', r._id); }); const l = DB.rows('bom_lines').find(x => x.parent === 'S-RED'); if (l) DB.remove('bom_lines', l._id); await DB.flush(); ERP.state.stk_floor = null; });
  });

  await sec('14. (1.15.1) 재고 0 인 분류 안 된 품목만 있으면 "분류 안 된 품목" 카드를 보이지 않음 (사용자 "네, 고쳐 줘")', async () => {
    await ev(async () => { const DB = ERP.db; DB.add('items', { code: 'Z-0', name: 'NOTHING', stage: 'WIP', unit: 'PCS', src: 'test' }); await DB.flush(); }); await floor();
    eq('Z-0 은 분류 안 됨 · 재고 없음', await ev(() => { const s = ERP.inv.rows().find(x => x.code === 'Z-0'); return [ERP.inv.floorClassOf('Z-0').proc, s ? s.bal : null]; }), ['', 0]);
    eq('카드 = 공정 5개 (빈 "분류 안 된 품목" 카드 없음)', (await cards()).map(x => x.id), ['INJ', 'REF', 'ASM', 'WRP', 'PCK']);
    await ev(async () => { ERP.db.setSetting('floorCards', { NONE: { zero: true } }); await ERP.db.flush(); ERP.render(); }); await settle();
    eq('"분류 안 된 품목" 설정에서 재고 0 줄도 보기를 켜면 카드가 보임 (Z-0 ·)', [(await cards()).map(x => x.id).slice(-1)[0], (await card('NONE')).rows], ['NONE', [['Z-0', '·']]]);
    // Codex 검토 (1.15.1): 범위를 창고로 바꿔 줄이 없어져도 카드 (설정) 와 숨긴 카드 [보이기] 는 남아야 되돌릴 수 있다
    await ev(async (o) => { const DB = ERP.db; DB.add('items', { code: 'U-2', name: 'MYSTERY 2', stage: 'WIP', unit: 'PCS', src: 'test' }); DB.add('stock_open', { date: o.FLOOR, scope: 'FAC', code: 'U-2', qty: 4, unit: 'PCS', grp: 'floor' }); DB.setSetting('floorCards', null); await DB.flush(); ERP.render(); }, { FLOOR }); await settle();
    eq('U-2 (공장 재고 4) → 분류 안 된 품목 카드', ((await card('NONE')) || {}).rows, [['U-2', '4']]);
    await ev(async () => { ERP.db.setSetting('floorCards', { NONE: { scope: 'WH' } }); await ERP.db.flush(); ERP.render(); }); await settle();
    const c2 = await card('NONE');
    eq('범위 창고 → 줄은 없어도 카드 · [설정] 은 남음', [!!c2, c2 && c2.rows, await ev(() => !!document.querySelector('main .fpiv-card[data-id="NONE"] button[data-act="edit"]'))], [true, [], true]);
    await ev(async () => { ERP.db.setSetting('floorCards', { NONE: { scope: 'WH', hidden: true } }); await ERP.db.flush(); ERP.render(); }); await settle();
    eq('그 카드를 숨기면 아래 줄에 [보이기]', await ev(() => Array.from(document.querySelectorAll('main .fpiv-foot [data-show]')).map(b => b.dataset.show)), ['NONE']);
    await ev(async () => { const DB = ERP.db; DB.setSetting('floorCards', null); ['Z-0', 'U-2'].forEach(c => { const r = DB.rows('items').find(x => x.code === c); if (r) DB.remove('items', r._id); }); const so = DB.rows('stock_open').find(x => x.code === 'U-2'); if (so) DB.remove('stock_open', so._id); await DB.flush(); ERP.render(); }); await settle();
  });

  await sec('12. 베트남어 · 오류 없음', async () => {
    await ev(() => ERP.setLang('vi')); await floor();
    eq('카드 제목 (vi)', (await cards()).map(x => x.title), ['Ép nhựa — tồn', 'Ép lõi (Refill) — tồn', 'Lắp ráp — tồn', 'Quấn giấy — tồn', 'Đóng gói — tồn']);
    eq('사출 머리 (vi)', (await card('INJ')).head, ['Loại \\ Nhóm', 'Tổng', 'Mini', 'Pencil', 'Chưa có nhóm']);
    ok('현장 재고 위 영역에 한국어 없음 (vi)', !/[가-힣]/.test(await ev(() => document.querySelector('main .fpiv').innerText)), (await ev(() => document.querySelector('main .fpiv').innerText)).match(/.{0,20}[가-힣]+.{0,20}/g));
    await ev(() => ERP.setLang('ko')); await settle();
    eq('화면 오류 없음', errors, []);
  });

  await browser.close(); await S.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* 지우기 실패는 무시 */ }
  console.log('\n' + (fail ? '실패 ' + fail + '개 / ' : '') + '통과 ' + pass + '개');
  if (fail) { console.log(failures.map(x => ' - ' + x).join('\n')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
