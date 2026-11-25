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
    // 1.15.6: 마이너스 숫자는 보이지 않음 — 경고는 '0 으로 보임 N품목' (사용자 2026-11-25 "현장재고 마이너스로 표시안되게")
    eq('사출: 0 으로 보임 1품목 (BP 계산 −20) · 종이 권취: 못 넣은 일보 1줄 · BOM 없는 생산 1품목 · 리필: BOM 없는 생산 1품목', [by.INJ, by.WRP, by.REF, by.ASM, by.PCK],
      [[['neg', '0 으로 보임 1품목']], [['notItem', '못 넣은 일보 1줄'], ['noBom', 'BOM 없는 생산 1품목']], [['noBom', 'BOM 없는 생산 1품목']], [], []]);
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

  await sec('15. (1.15.6) 현장 재고는 마이너스 수량을 0 으로 보임 — 카드 · 품목 표 · 수불부 · 엑셀 · 종합 현황 · 휴대폰 · AI 비서 (계산은 그대로)', async () => {
    // 사용자 2026-11-25 "현장재고 마이너스로 표시안되게해줘 마이너스 수량이되면 그냥 0으로 표시되게 바꿔줘"
    // 조립 A-M1 500 을 더 만들면 MH 100 − 100 − 500 = −500 · B-M1 200 − 100 − 500 = −400 (BP 는 처음부터 −20) → 홀더 · Mini 칸 = MH −500 + Holder 300 = −200
    await ev(async (o) => { ERP.db.add('prod_log', { date: o.D1, process: 'ASM', shift: 'N', division: 'Mini', code: 'A-M1', name: 'A-M1', ok_qty: 500, ok_ea: 500, ng_qty: 0, src: 't15' }); await ERP.db.flush(); }, { D1 });
    await floor();
    const minusNum = /(^|[^\w])[−-]\d/;   // 마이너스 숫자 (날짜 2026-08-31 의 '-' 는 빼고)
    const c = await card('INJ');
    // (그 밖의 부품 Mini 7 = U-1 — 11장에서 생산 공정을 사출로 넣음)
    eq('사출 카드: 홀더 · Mini 칸 (계산 −200) = 0 · 줄 합계 0 · 배럴 Mini = −400 + 600 = 200 (품목군 합은 그대로)', c.rows, [['배럴', '580', '200', '380', '·'], ['노즈콘', '30', '·', '30', '·'], ['홀더', '0', '0', '·', '·'], ['그 밖의 부품', '16', '7', '·', '9']]);
    ok('어느 카드에도 마이너스 숫자 없음', !minusNum.test(await ev(() => document.querySelector('main .fpiv').innerText)), await ev(() => document.querySelector('main .fpiv').innerText.match(/.{0,20}(^|[^\w])[−-]\d.{0,10}/gm)));
    eq('사출 카드 경고 = 0 으로 보임 3품목 (BP · B-M1 · MH)', c.warns, [['neg', '0 으로 보임 3품목']]);
    const tip = await ev(() => { const td = document.querySelector('main .fpiv-card[data-id="INJ"] tbody tr[data-k="HOLDER"] td:nth-child(3)'); return td && td.title; });
    // (Codex 검토) 0 으로 보이는 칸은 식 (… = 값) 대신 '재고 0 (계산이 0 아래)' 한 줄 + 내역 한 줄
    ok('홀더 · Mini 칸 설명: 재고 0 (계산이 0 아래) + 내역 (식 "=" 없음) — 마이너스 숫자 없음', /\n재고 0 \(계산이 0 아래\)\n내역: 실사 /.test(tip || '') && !/ = /.test(tip || '') && !minusNum.test(tip || ''), tip);
    const tips = await ev(() => { const mk = (c) => ({ proc: 'INJ', itemMode: true, cols: [{ k: '_', label: '현재 재고' }], rows: [{ k: 'X', unit: 'PCS', title: 'X', label: 'X', cells: new Map([['_', c]]) }], tots: [], rowTot: false, units: ['PCS'], firstHead: '품목' });
      const t = (c) => { const td = ERP.pivot.tableEl(mk(c), () => {}).querySelector('tbody td:nth-child(2)'); return [td.textContent.trim(), td.title]; };
      return [t({ v: -3, show: 0, zero: true, open: -5, prod: 2, use: 0, oth: 0, flow: true }), t({ v: 15, show: 15, zero: false, open: -5, prod: 20, use: 0, oth: 0, flow: true }), t({ v: 7, show: 7, zero: false, open: 5, prod: 2, use: 0, oth: 0, flow: true })]; });
    eq('칸 설명: 계산 −3 → 재고 0 + 내역 (실사 −5 → 0) · 계산 15 · 실사 −5 → 실사 0 · 0 아래 없는 칸은 예전 식 그대로', tips, [['0', 'X\n재고 0 (계산이 0 아래)\n내역: 실사 0 (계산이 0 아래) + 생산 2 − 사용 0 ± 기타 0'],
      ['15', 'X\n재고 15\n내역: 실사 0 (계산이 0 아래) + 생산 20 − 사용 0 ± 기타 0'], ['7', 'X\n실사 5 + 생산 2 − 사용 0 ± 기타 0 = 7']]);
    eq('계산은 그대로: MH −500 · B-M1 −400 · BP −20 (재고 계산 · 카드 칸 값)', await ev(() => { const st = ERP.calc.stock(); const d = ERP.pivot.buildCard('INJ', ERP.pivot.cleanCfg(null)); const hm = d.rows.find(r => r.k === 'HOLDER').cells.get('MINI');
      return [st.get('MH').bal, st.get('B-M1').bal, st.get('BP').bal, hm.v, hm.show]; }), [-500, -400, -20, -200, 0]);
    // 아래 품목 표 (경고를 누르면 0 으로 보이는 품목만)
    await A.click('main .fpiv-card[data-id="INJ"] .fpiv-w[data-w="neg"]'); await settle();
    const tb = await ev(() => Array.from(document.querySelectorAll('main table.tbl:not(.fpiv-t):not(.fraw-t) tbody tr')).map(tr => { const t = Array.from(tr.children).map(td => td.innerText.replace(/\s+/g, ' ').trim()); return [t[0], t[7], t[8], t[9], t[11]]; }).sort());
    eq('품목 표: BP · B-M1 · MH 의 창고 · 공장 · 합계 = 0 · 상태 = 0 으로 보임', tb, [['B-M1', '0', '0', '0', '0 으로 보임'], ['BP', '0', '0', '0', '0 으로 보임'], ['MH', '0', '0', '0', '0 으로 보임']]);
    const k = await ev(() => Array.from(document.querySelectorAll('main .kpis .kpi')).map(x => [x.querySelector('.kpi-label').textContent, x.querySelector('.kpi-val .v').textContent]));
    ok('숫자 카드: "0 으로 보이는 품목 3" · "마이너스 재고" 없음', k.some(x => x[0] === '0 으로 보이는 품목' && x[1] === '3') && !k.some(x => /마이너스/.test(x[0])), k);
    eq('상태 고르기: 0 으로 보임 (계산 0 아래)', await ev(() => (Array.from(document.querySelectorAll('main select[data-k="status"] option')).find(o => o.value === 'neg') || {}).textContent), '0 으로 보임 (계산 0 아래)');
    // 엑셀 (공정마다 시트 · 현재 보기)
    const xl = await ev(() => { let sh = null, aoa = null; const o1 = ERP.xl.exportSheets, o2 = ERP.xl.exportAoa; ERP.xl.exportSheets = (n, s) => { sh = s; }; ERP.xl.exportAoa = (n, hd, rows) => { aoa = { hd, rows }; };
      try { ERP.pivot.exportAll(); Array.from(document.querySelectorAll('main button')).find(b => b.textContent === '현재 보기 엑셀').click(); } finally { ERP.xl.exportSheets = o1; ERP.xl.exportAoa = o2; }
      const inj = sh.find(s => s.name === '사출'); const items = sh.find(s => s.name === '품목 목록'); const ix = (n) => aoa.hd.indexOf(n);
      return { holder: inj.rows.find(r => r[0] === '홀더'), mh: items.rows.find(r => r[0] === 'MH').slice(11, 14), view: aoa.rows.filter(r => r[0] === 'MH').map(r => [r[ix('창고')], r[ix('공장')], r[ix('합계')]]) }; });
    eq('엑셀: 사출 시트 홀더 줄 0 · 품목 목록 MH 창고 · 공장 · 현재 0 · 현재 보기 MH 0', xl, { holder: ['홀더', 0, 0, 0, 0], mh: [0, 0, 0], view: [[0, 0, 0]] });
    // 수불부 (품목 상세)
    await ev(() => ERP.itemDetail('MH')); await settle();
    const md = await ev(() => { const m = document.querySelector('.modal'); const t = m.querySelector('table'); const hd = Array.from(t.querySelectorAll('thead th')).map(x => x.innerText.trim());
      const cols = ['창고 잔액', '공장 잔액', '합계'].map(n => hd.indexOf(n)); const vals = Array.from(t.querySelectorAll('tbody tr')).map(tr => cols.map(i => tr.children[i].innerText.trim()));
      return { kpis: m.querySelector('.kpis').innerText.replace(/\s+/g, ' '), vals, note: m.innerText.includes('0 아래인 잔액은 0 으로 보입니다') }; });
    ok('수불부: 숫자 카드 · 잔액 칸에 마이너스 없음 (± 칸은 그대로) · 0 으로 보임 · 안내 글', !minusNum.test(md.kpis) && /0 으로 보임/.test(md.kpis) && md.vals.every(r => r.every(v => !minusNum.test(v))) && md.note, md);
    await A.keyboard.press('Escape'); await settle();
    // 종합 현황 위젯 · 휴대폰 요약 · AI 비서
    const w = await ev(() => ({ neg: ERP.widgets.kpi_neg.render({}).textContent, flow: ERP.widgets.flow.render({}).textContent }));
    ok('종합 현황 "마이너스 재고" = 원부자재만 (0) · 현장 재고는 "0 으로 보임 3" · 재고 흐름에 현장 −숫자 없음', /^마이너스 재고0품목/.test(w.neg) && /현장 재고: 0 으로 보임 3/.test(w.neg) && /마이너스 0/.test(w.flow) && /현장 0 으로 보임 3/.test(w.flow) && !/−\d/.test(w.flow), w);
    eq('휴대폰 요약: 마이너스 = 원부자재 0 · 현장 0 (0 으로 보임 3)', await ev(() => ERP.mobileSummary().kpi.neg), { mat: 0, floor: 0, floorZero: 3 });
    const ai = await ev(() => { const T = ERP.ai.tools; const r = T.material_stock({ query: 'MH' }).rows.find(x => x.code === 'MH'); const o = T.overview(); return [r.balance, r.factory, r.shown_as_zero, o.negative_stock_items, o.floor_shown_as_zero]; });
    eq('AI 비서: MH 재고 0 (shown_as_zero) · 마이너스 품목 = 원부자재만 0 · 현장 0 으로 보임 3', ai, [0, 0, true, 0, 3]);
    // ---- 아래는 Codex 검토 (1.15.6) 뒤에 더한 곳
    // 재고 흐름 위젯: 현장 단계의 '재고 있는 품목' = 보이는 재고가 0 보다 큰 품목 (홀더 단계 = Holder 만, MH 는 0 으로 보임)
    eq('재고 흐름: 홀더 단계 1 / 2 (MH 는 재고 없는 품목)', await ev(() => { const el = ERP.widgets.flow.render({}); const i = ERP.inv.STAGES.findIndex(x => x.code === 'WIP03'); return el.querySelectorAll('button.st')[i].querySelector('.n').textContent.replace(/\s+/g, ' '); }), '1 / 2');
    // 카드 경고를 누르면 아래 표도 카드와 같은 범위 · 품목군 — 센 품목 = 표 줄
    const chipRun = async (cfg) => { await ev(async (c) => { ERP.db.setSetting('floorCards', { INJ: c }); await ERP.db.flush(); ERP.state.stk_floor = null; ERP.goStock('floor'); ERP.render(); }, cfg); await settle();
      const w = ((await card('INJ')).warns.find(x => x[0] === 'neg') || [])[1] || '';
      await A.click('main .fpiv-card[data-id="INJ"] .fpiv-w[data-w="neg"]'); await settle();
      return [w, await tableCodes(), await ev(() => [ERP.state.stk_floor.scope, ERP.state.stk_floor.fline])]; };
    eq('공장 범위 카드: 경고 3품목 → 아래 표도 공장 범위 · 3품목', await chipRun({ scope: 'FAC' }), ['0 으로 보임 3품목', ['B-M1', 'BP', 'MH'], ['FAC', '']]);
    eq('품목군 Pencil 만 고른 카드: 경고 = 그 품목군 품목만 → 아래 표도 Pencil', await chipRun({ divs: ['PEN'] }), ['0 으로 보임 1품목', ['BP'], ['all', 'PEN']]);
    await ev(async () => { ERP.db.setSetting('floorCards', null); await ERP.db.flush(); }); await floor();
    // 품목 표 거르기: '재고 0' 에 0 으로 보이는 품목도 · 공장 범위 '재고 0 숨김' 은 0 으로 보이는 품목을 숨김
    const flt = async (o) => { await ev((x) => { ERP.state.stk_floor = Object.assign({ stage: '', line: '', sub: '', cat: '', scope: 'all', status: '', q: '', hideZero: true, sk: 'code', sd: 1, page: 0, ps: 100 }, x); ERP.goStock('floor'); ERP.render(); }, o); await settle(); return tableCodes(); };
    const zr = await flt({ proc: 'INJ', status: 'zero' }), hf = await flt({ proc: 'INJ', scope: 'FAC' });
    ok('상태 "재고 0" = 0 으로 보이는 MH · B-M1 · BP 도 들어감 · 공장 범위 "재고 0 숨김" 은 그 셋을 숨김', ['MH', 'B-M1', 'BP'].every(x => zr.includes(x)) && !['MH', 'B-M1', 'BP'].some(x => hf.includes(x)), { zr, hf });
    await floor();
    // 통합 검색
    const sr = await ev(async () => { ERP.search(); const inp = document.querySelector('.modal input'); inp.value = 'MINI HOLDER'; inp.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 100));
      const t = document.querySelector('.modal').innerText; document.querySelector('.modal-back').remove(); return t; });
    ok('통합 검색: MH 재고 0 (마이너스 숫자 없음)', /MH · MINI HOLDER/.test(sr) && /· 0 PCS/i.test(sr) && !minusNum.test(sr), sr);
    // AI 비서 · 휴대폰: 안전재고가 있는 현장 품목 (MH 안전재고 50, 계산 −500) — 권장 = 50 − 보이는 재고 0
    await ev(async () => { const DB = ERP.db; const r = DB.rows('items').find(x => x.code === 'MH'); DB.update('items', r._id, { safety: 50 }); await DB.flush(); });
    const ai2 = await ev(() => { const r = ERP.ai.tools.material_stock({ query: 'MH' }).rows.find(x => x.code === 'MH'); const lo = ERP.mobileSummary().low.find(x => x.code === 'MH'); return [r.balance, r.status, r.recommended_order, r.pct_of_safety, lo && lo.bal, lo && lo.neg]; });
    eq('AI 비서: MH 재고 0 · 미달 · 권장 50 (보이는 재고 기준) · 0% · 휴대폰 미달 목록도 0 (마이너스 표시 없음)', ai2, [0, 'low', 50, 0, 0, false]);
    // 해외 주문: 현장 재고 품목이 해외 주문 품목이면 보이는 재고 · Total 0 (계산은 그대로)
    await ev(async () => { const DB = ERP.db; const r = DB.rows('items').find(x => x.code === 'MH'); DB.update('items', r._id, { buy: true }); await DB.flush(); });
    const bq = await ev(async () => { const r = ERP.buy.rows().find(x => x.code === 'MH'); ERP.goStock('buy'); ERP.render(); await new Promise(res => setTimeout(res, 300));
      const tr = Array.from(document.querySelectorAll('main table tbody tr')).find(x => x.children[0] && /\bMH\b/.test(x.innerText)); return [r.fl, r.bal < 0, ERP.buy.showBal(r), ERP.buy.showTot(r), tr ? !/(^|[^\w])[−-]\d/.test(tr.innerText) : 'no row']; });
    eq('해외 주문: MH (계산 0 아래) → 재고 0 · Total 0 · 표 줄에 마이너스 숫자 없음', bq, [true, true, 0, 0, true]);
    await ev(async () => { const DB = ERP.db; const r = DB.rows('items').find(x => x.code === 'MH'); DB.update('items', r._id, { buy: false, safety: null }); await DB.flush(); }); await floor();
    // 수주 상세 · 품목 상세의 완제품 재고: K-P1 을 −1,000 set (조정) → 0 set 로 보임
    await ev(async (o) => { const DB = ERP.db; DB.add('stock_tx', { date: o.D1, kind: 'ADJ', to_scope: 'FAC', code: 'K-P1', qty: -1000, src: 't15' }); DB.add('po', { po_no: 'T15-PO', customer: 'T15', item_no: 'K-P1', sets: 10, date: o.D1, due: '2026-12-31', src: 't15' }); await DB.flush(); }, { D1 });
    eq('계산: K-P1 재고 · set 이 0 아래', await ev(() => { const s = ERP.calc.stock().get('K-P1'); return [s.bal < 0, s.sets < 0]; }), [true, true]);
    await ev(() => ERP.openPo('T15-PO')); await settle();
    const pc = await ev(() => { const t = Array.from(document.querySelectorAll('main table')).find(x => Array.from(x.querySelectorAll('thead th')).some(th => th.innerText.trim() === '완제품 재고')); if (!t) return null;
      const i = Array.from(t.querySelectorAll('thead th')).findIndex(th => th.innerText.trim() === '완제품 재고'); const tr = Array.from(t.querySelectorAll('tbody tr')).find(r => r.innerText.includes('K-P1')); const td = tr && tr.children[i];
      return td ? [td.innerText.replace(/\s+/g, ' ').trim(), (td.querySelector('[title]') || td).title] : null; });
    ok('수주 상세: K-P1 완제품 재고 0 · 0 set · 설명 (창고 · 공장) 에도 마이너스 없음', !!pc && /^0 /.test(pc[0]) && /0 set/.test(pc[0]) && !minusNum.test(pc.join(' ')), pc);
    await ev(() => ERP.itemDetail('K-P1')); await settle();
    const kd = await ev(() => document.querySelector('.modal').innerText);
    ok('품목 상세: "완제품 재고 0 set · 남은 수주 10 set"', /완제품 재고 0 set · 남은 수주 10 set/.test(kd), kd.match(/완제품 재고.{0,40}/));
    await A.keyboard.press('Escape'); await settle();
    // 자료 점검: 마이너스 목록에 현장 재고 없음 · '0 으로 보이는 현장 재고' 따로 (숫자 없이) · 이동 누락 의심의 현장 줄은 0 으로 (MH 창고 +100 · 공장 −500)
    await ev(async (o) => { ERP.db.add('stock_tx', { date: o.D1, kind: 'IN', to_scope: 'WH', code: 'MH', qty: 100, src: 't15' }); await ERP.db.flush(); }, { D1 });
    const chk = async (open) => { await ev((x) => { ERP.state.chk = { open: x }; ERP.goStock('check'); ERP.render(); }, open); await settle();
      return ev(() => Array.from(document.querySelectorAll('main .card')).filter(c => c.querySelector('.click')).map(c => { const hd = c.querySelector('.click'); return { t: hd.querySelector('b').textContent, n: (hd.querySelector('.chip') || {}).textContent || '', rows: Array.from(c.querySelectorAll('tbody tr')).map(tr => Array.from(tr.children).map(td => td.innerText.trim())) }; })); };
    const cs = await chk('susp'), cn = await chk('neg'), cz = await chk('fzero');
    const sec1 = (a, t) => a.find(x => x.t === t) || { rows: [], n: '' };
    const FL = ['B-M1', 'BP', 'K-P1', 'MH'];
    ok('자료 점검 이동 누락 의심: MH 창고 100 · 공장 0 · 합계 0 (현장 재고는 0 아래 쪽이 0)', JSON.stringify(sec1(cs, '이동 누락 의심 (창고 +, 공장 − 또는 반대)').rows.find(r => r[0] === 'MH')) === JSON.stringify(['MH', 'MINI HOLDER', '100', '0', '0', 'PCS']), sec1(cs, '이동 누락 의심 (창고 +, 공장 − 또는 반대)'));
    ok('자료 점검 마이너스 재고: 현장 재고 품목 없음', !sec1(cn, '마이너스 재고 (합계 기준)').rows.some(r => FL.includes(r[0])), sec1(cn, '마이너스 재고 (합계 기준)'));
    const fz = sec1(cz, '0 으로 보이는 현장 재고 (계산이 0 아래)');
    ok('자료 점검 "0 으로 보이는 현장 재고" 4품목 (B-M1 · BP · K-P1 · MH) · 숫자 없음', fz.n === '4' && JSON.stringify(fz.rows.map(r => r[0]).sort()) === JSON.stringify(FL) && fz.rows.every(r => !minusNum.test(r.join(' '))), fz);
    const xs = await ev(async () => { let blob = null; const o = ERP.download; ERP.download = (n, b) => { blob = b; }; try { Array.from(document.querySelectorAll('main button')).find(b => b.textContent === '점검 결과 엑셀').click(); } finally { ERP.download = o; }
      const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' }); const sh = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 });
      return { neg: sh('negative').slice(1).map(r => r[0]), fz: sh('floor_shown_zero').slice(1).map(r => [r[0], r[4]]).sort(), mv: sh('move_suspect').slice(1).filter(r => r[0] === 'MH') }; });
    ok('자료 점검 엑셀: negative 에 현장 재고 없음 · floor_shown_zero 4품목 (재고 0) · move_suspect MH 100 · 0 · 0', !xs.neg.some(c => FL.includes(c)) && JSON.stringify(xs.fz) === JSON.stringify(FL.map(c => [c, 0])) && JSON.stringify(xs.mv) === JSON.stringify([['MH', 'MINI HOLDER', 100, 0, 0, 'PCS']]), xs);
    await ev(() => { ERP.setLang('vi'); ERP.state.chk = { open: 'fzero' }; ERP.goStock('check'); ERP.render(); }); await settle();
    const vz = await ev(() => Array.from(document.querySelectorAll('main .card .click b')).map(b => b.textContent).find(t => /hiện 0/i.test(t)) || '');
    ok('자료 점검 (vi): 0 으로 보이는 현장 재고 제목에 한글 없음', !!vz && !/[가-힣]/.test(vz), vz);
    await ev(() => { ERP.setLang('ko'); ERP.render(); }); await floor();
    // 베트남어
    await ev(() => { ERP.setLang('vi'); ERP.render(); }); await settle();
    const vw = await ev(() => Array.from(document.querySelectorAll('main .fpiv-card[data-id="INJ"] .fpiv-w')).map(b => b.innerText.trim()));
    ok('베트남어: 경고에 한글 없음', vw.length && vw.every(t => !/[가-힣]/.test(t)), vw);
    await ev(() => { ERP.setLang('ko'); ERP.render(); }); await settle();
    // 되돌림
    await ev(async () => { const DB = ERP.db; ['prod_log', 'stock_tx', 'po'].forEach(t => DB.rows(t).filter(r => r.src === 't15').forEach(r => DB.remove(t, r._id))); await DB.flush(); }); await floor();
    eq('되돌리면 사출 카드가 앞과 같음 (3장 + U-1)', (await card('INJ')).rows, [['배럴', '1,080', '700', '380', '·'], ['노즈콘', '30', '·', '30', '·'], ['홀더', '300', '300', '·', '·'], ['그 밖의 부품', '16', '7', '·', '9']]);
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
