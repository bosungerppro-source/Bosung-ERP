'use strict';
/* 17차(v1.12.0) 자동 시험: 현장 재고 위 = 피벗 표 (사용자: "두번째사진 형태로 조립부분만 보여줘. 다른공정들은 커스텀마이징 할수있게 해주고 엑셀 기능의 피벗테이블 처럼")
   1 기본 표 = 조립 · 품목군 × 월 (월별 조립 생산량 표 모양) · 월 = 그 달 말일 재고 · 현장 실사 전 달은 · · 단계 카드 없음
   2 연도 ‹ › · 3 설정 (공정 · 품목군 · 행 · 열 · 범위 · 제목 · 재고 0 줄) → 저장 (다시 열어도 그대로) · 4 표 추가 · 순서 · 지우기 · 기본 표로
   5 단위가 다르면 나눔 (포장 SET · CT) · 6 칸 → 아래 표 거르기 · 품목 줄 → 수불부 · 7 엑셀 · 8 베트남어 · 휴대폰 폭 · 오류 없음
   오늘 날짜는 2026-10-22 로 고정한다 (현장 실사 2026-08-31 · ECOUNT 기초 2026-06-30 · 수불 9/10 · 10/5).
   사용:  npm run test:v17   (Playwright 필요: npm i -D playwright 또는 playwright-core + 설치된 Chrome/Edge) */
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

const TODAY = '2026-10-22', FLOOR = '2026-08-31', EC = '2026-06-30';

(async () => {
  const dataDir = tmp('erp-v17-');
  const S = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir, host: '127.0.0.1', port: 7400 + Math.floor(Math.random() * 300), backupDelay: 3600000 });
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 }, acceptDownloads: true });
  await ctx.addInitScript((t) => { window.__fixToday = t; }, TODAY);
  const A = await ctx.newPage(); A.on('pageerror', e => errors.push('pageerror: ' + e.message));
  A.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Failed to fetch/.test(m.text())) errors.push('console: ' + m.text()); });
  const ready = () => A.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 180000 });
  const ev = (fn, arg) => A.evaluate(fn, arg);
  const fixToday = () => ev(() => { ERP.fmt.today = () => window.__fixToday; });
  const settle = () => A.waitForTimeout(350);
  const confirmModal = async () => { for (let i = 0; i < 20; i++) { await A.waitForTimeout(150); const m = await A.$('.modal .modal-foot button:last-child'); if (m) { await m.click(); return true; } } return false; };
  /** 피벗 표들: [{ id, title, head: [...], rows: [[...cells]] }] */
  const cards = () => ev(() => Array.from(document.querySelectorAll('main .fpiv-card')).map(c => ({ id: c.dataset.id, title: c.querySelector('h2').textContent,
    head: Array.from(c.querySelectorAll('thead th')).map(t => t.innerText.replace(/\s+/g, ' ').trim()),
    rows: Array.from(c.querySelectorAll('tbody tr')).map(tr => Array.from(tr.children).map(td => td.innerText.replace(/\s+/g, ' ').trim())), help: (c.querySelector('p.help') || {}).textContent || '', edit: !!c.querySelector('.fpiv-edit') })));
  const floor = async () => { await ev(() => { ERP.state.stk_floor = null; ERP.goStock('floor'); ERP.render(); }); await settle(); };
  await A.goto(S.url + '/#/home'); await ready(); await fixToday();

  await ev(async (o) => { const DB = ERP.db; await DB.wipe();
    const it = (code, name, stage, line, unit) => ({ code, name, stage, line: line || undefined, unit: unit || 'PCS', src: 'test' });
    DB.replace('items', [
      it('A-M1', 'MINI RED', 'WIP', 'MINI'), it('A-M2', 'MINI BLUE', 'WIP', 'MINI'), it('A-D1', 'DIAL RED', 'WIP', 'REG'), it('A-P1', 'PENCIL PART', 'WIP55', 'PEN'), it('A-Z', 'NO LINE', 'WIP'),
      it('I-M1', 'BARREL MINI', 'WIP01', 'MINI'), it('R-M1', 'CORE MINI', 'WIP00', 'MINI'), it('S-M1', 'STAMPED MINI', 'WIP11', 'MINI'),
      it('K-P1', 'PENCIL 12 MANILA', 'SG', 'PEN', 'SET'), it('K-P2', 'PENCIL 12 BOX', 'FG', 'PEN', 'CT'), it('RM-1', 'RESIN', 'RM', '', 'kg')]);
    const fl = (code, qty) => ({ date: o.FLOOR, scope: 'FAC', code, qty, unit: 'PCS', grp: 'floor' });
    const ec = (code, qty, unit, scope) => ({ date: o.EC, scope: scope || 'FAC', code, qty, unit });
    DB.replace('stock_open', [fl('A-M1', 100), fl('A-M2', 20), fl('A-D1', 30), fl('A-P1', 40), fl('A-Z', 5), fl('I-M1', 500), fl('R-M1', 50), fl('S-M1', 70),
      ec('K-P1', 7, 'SET'), ec('K-P2', 3, 'CT'), ec('RM-1', 900, 'kg', 'WH'), ec('A-M1', 999, 'PCS')]);   // ECOUNT 의 A-M1 999 는 현장 실사가 이김
    const adj = (date, code, qty, scope) => ({ date, kind: 'ADJ', to_scope: scope || 'FAC', code, qty, unit: 'PCS', src: 'manual' });
    DB.replace('stock_tx', [adj('2026-09-10', 'A-M1', 50), adj('2026-09-10', 'A-D1', 10), adj('2026-10-05', 'A-M1', -30), adj('2026-09-15', 'K-P1', 2), adj('2026-10-05', 'I-M1', 25, 'WH')]);
    DB.replace('prod_log', []);
    DB.meta.openDate = { WH: o.EC, FAC: o.EC, FLOOR: o.FLOOR }; DB.meta.seeded = DB.meta.seeded || new Date().toISOString(); delete DB.meta.floorPivots; await DB.saveMeta(); await DB.flush(); }, { FLOOR, EC });

  await sec('1. 기본 표 = 조립 · 품목군 × 월 (월별 조립 생산량 표 모양) · 단계 카드 없음', async () => {
    await floor();
    const c = await cards();
    eq('표 하나 · 제목 "조립 재고 · 2026" · 단계 카드 없음', [c.length, c[0] && c[0].title, await ev(() => document.querySelectorAll('main .flow .st').length)], [1, '조립 재고 · 2026', 0]);
    eq('머리: 품목군 \\ 월 · 1월 ~ 10월 (이번 달은 "지금")', c[0].head, ['품목군 \\ 월', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월 지금']);
    // 8월 = 현장 실사(8/31) 수량, 9월 = 9/10 조정 뒤 (Mini 100+50+20, Dial 30+10), 10월 = 지금 (Mini −30)
    eq('줄 = 품목군 (Mini · Dial · Pencil · 기타) · 8월 실사 · 9월 말 · 10월 지금 · 1~7월은 · (실사 전) · 합계 줄', c[0].rows, [
      ['Mini', '·', '·', '·', '·', '·', '·', '·', '120', '170', '140'],
      ['Dial', '·', '·', '·', '·', '·', '·', '·', '30', '40', '40'],
      ['Pencil', '·', '·', '·', '·', '·', '·', '·', '40', '40', '40'],
      ['기타', '·', '·', '·', '·', '·', '·', '·', '5', '5', '5'],
      ['합계', '·', '·', '·', '·', '·', '·', '·', '195', '255', '225']]);
    ok('설명: 단위 PCS · 월 = 그 달 말일 재고 · 현장 실사(2026-08-31) 전 달은 ·', /단위 PCS/.test(c[0].help) && /말일 재고/.test(c[0].help) && /2026-08-31 \(현장 실사\) 전 달/.test(c[0].help), c[0].help);
    // 지금 칸 = 아래 품목 표의 합계와 같음
    const sumTable = await ev(() => { const r = ERP.inv.rows().filter(s => ERP.inv.groupOf(s) === 'floor' && ['WIP', 'WIP55'].includes(s.stage)); return r.reduce((a, s) => a + s.bal, 0); });
    eq('10월(지금) 합계 = 조립 단계(WIP · WIP55) 품목 재고 합 = 225', sumTable, 225);
    eq('9월 칸 = 재고 계산(9/30 까지)과 같음', await ev(() => ERP.inv.rows({ upTo: '2026-09-30' }).filter(s => ['WIP', 'WIP55'].includes(s.stage)).reduce((a, s) => a + s.bal, 0)), 255);
    eq('설정 floorPivots 은 아직 저장 안 됨 (기본 표)', await ev(() => ERP.db.setting('floorPivots', null)), null);
  });

  await sec('2. 연도 ‹ › — 실사 전 해 · 오지 않은 해', async () => {
    await A.click('main .fpiv-card[data-id="asm"] .wnav button[aria-label="prev"]'); await settle();
    let t = await ev(() => document.querySelector('main .fpiv-card[data-id="asm"]').innerText);
    ok('2025 → "2025년은 현장 실사 전이라 재고를 알 수 없습니다."', /조립 재고 · 2025/.test(t) && /2025년은 현장 실사 전이라 재고를 알 수 없습니다/.test(t), t.slice(0, 200));
    await A.click('main .fpiv-card[data-id="asm"] .wnav button[aria-label="next"]'); await A.click('main .fpiv-card[data-id="asm"] .wnav button[aria-label="next"]'); await settle();
    t = await ev(() => document.querySelector('main .fpiv-card[data-id="asm"]').innerText);
    ok('2027 → "2027년은 아직 오지 않았습니다."', /2027년은 아직 오지 않았습니다/.test(t), t.slice(0, 200));
    await A.click('main .fpiv-card[data-id="asm"] .wnav button[aria-label="prev"]'); await settle();
    eq('다시 2026', (await cards())[0].title, '조립 재고 · 2026');
  });

  await sec('3. 설정 (엑셀 피벗처럼: 공정 · 품목군 · 행 · 열 · 범위 · 제목) → 저장', async () => {
    await A.click('main .fpiv-card[data-id="asm"] button[data-act="edit"]'); await settle();
    const ed = await ev(() => { const e = document.querySelector('main .fpiv-card[data-id="asm"] .fpiv-edit'); return e ? { procs: Array.from(e.querySelectorAll('[data-proc]')).map(l => [l.dataset.proc, l.querySelector('input').checked]), divs: Array.from(e.querySelectorAll('[data-div]')).map(l => [l.dataset.div, l.innerText.trim()]),
      rows: Array.from(e.querySelectorAll('select[data-k="rows"] option')).map(o => o.textContent), cols: Array.from(e.querySelectorAll('select[data-k="cols"] option')).map(o => o.textContent) } : null; });
    eq('설정: 공정 = 전체 + 현장에 있는 공정 (종이 권취 · 기타는 품목 없어 빠짐, 조립만 켜짐) · 행 4 · 열 (행과 같은 품목군 빼고)', ed && { procs: ed.procs, rows: ed.rows, cols: ed.cols }, {
      procs: [['', false], ['INJ', false], ['REF', false], ['STP', false], ['ASM', true], ['PCK', false]],
      rows: ['품목군', '공정', '단계', '품목'], cols: ['월 (말일 재고)', '공정', '단계', '없음 (지금 재고만)'] });
  });
  await sec('3-2. 공정 더하기 · 열 = 공정 · 범위 · 제목 · 다시 열어도 그대로', async () => {
    const divs = await ev(() => Array.from(document.querySelectorAll('main .fpiv-card[data-id="asm"] .fpiv-edit [data-div]')).map(l => [l.dataset.div, l.innerText.trim(), l.querySelector('input').checked]));
    eq('품목군 체크: 전체(켜짐) · Mini · Dial · Pencil · 기타', divs, [['', '전체', true], ['MINI', 'Mini', false], ['REG', 'Dial', false], ['PEN', 'Pencil', false], ['', '기타', false]]);
    await A.click('main .fpiv-card[data-id="asm"] .fpiv-edit label[data-proc="INJ"] input'); await settle();
    let c = (await cards())[0];
    eq('사출 더함 → 제목 "조립 · 사출 재고" · Mini 지금 = 140 + 배럴 500 + 창고 25 = 665', [c.title, c.rows.find(r => r[0] === 'Mini').slice(-1)[0]], ['조립 · 사출 재고 · 2026', '665']);
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="asm"] select[data-k="cols"]'); s.value = 'proc'; s.dispatchEvent(new Event('change')); }); await settle();
    c = (await cards())[0];
    eq('열 = 공정 → 품목군 \\ 공정 · 합계 · 사출 · 조립 (월 없음 · 연도 없음)', [c.title, c.head], ['조립 · 사출 재고', ['품목군 \\ 공정', '합계', '사출', '조립']]);
    eq('줄: Mini 665 = 525 + 140 · Dial 40 · Pencil 40 · 기타 5 · 합계 750', c.rows, [['Mini', '665', '525', '140'], ['Dial', '40', '·', '40'], ['Pencil', '40', '·', '40'], ['기타', '5', '·', '5'], ['합계', '750', '525', '225']]);
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="asm"] select[data-k="scope"]'); s.value = 'WH'; s.dispatchEvent(new Event('change')); }); await settle();
    c = (await cards())[0];
    eq('범위 = 창고 → 창고에 있는 것만 (배럴 Mini 25) · 설명에 범위 창고', [c.rows, /범위 창고/.test(c.help)], [[['Mini', '25', '25'], ['합계', '25', '25']], true]);
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="asm"] select[data-k="scope"]'); s.value = 'all'; s.dispatchEvent(new Event('change')); }); await settle();
    await ev(() => { const i = document.querySelector('main .fpiv-card[data-id="asm"] input[data-k="title"]'); i.value = '조립 + 사출'; i.dispatchEvent(new Event('change')); }); await settle();
    const saved = await ev(() => ERP.db.setting('floorPivots', null));
    eq('설정 저장 (floorPivots): 공정 ASM · INJ · 열 공정 · 제목', saved, [{ id: 'asm', title: '조립 + 사출', procs: ['ASM', 'INJ'], divs: [], rows: 'div', cols: 'proc', scope: 'all' }]);
    await A.reload(); await ready(); await fixToday(); await floor();
    c = (await cards())[0];
    eq('다시 열어도 그대로 (제목 · 열 = 공정) · 설정 닫힘', [c.title, c.head[0], c.edit], ['조립 + 사출', '품목군 \\ 공정', false]);
    eq('서버에 저장됨', await ev(async () => (await (await fetch('/api/meta', { cache: 'no-store' })).json()).meta.floorPivots[0].procs), ['ASM', 'INJ']);
  });

  await sec('3-3. 행 바꾸기 (공정 · 단계 · 품목) · 품목군 거르기 · 재고 0 줄', async () => {
    await A.click('main .fpiv-card[data-id="asm"] button[data-act="edit"]'); await settle();
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="asm"] select[data-k="rows"]'); s.value = 'proc'; s.dispatchEvent(new Event('change')); }); await settle();
    let c = (await cards())[0];
    eq('행 = 공정 (열이 공정이던 것은 월로) → 공정 \\ 월', [c.head[0], c.rows.map(r => [r[0], r.slice(-1)[0]])], ['공정 \\ 월', [['사출', '525'], ['조립', '225'], ['합계', '750']]]);
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="asm"] select[data-k="rows"]'); s.value = 'stage'; s.dispatchEvent(new Event('change')); }); await settle();
    c = (await cards())[0];
    eq('행 = 단계 → 배럴 · 부품 WIP55 · 조립 완료', c.rows.map(r => [r[0], r.slice(-1)[0]]), [['배럴 · WIP01', '525'], ['부품 · WIP55', '40'], ['조립 완료 · WIP', '185'], ['합계', '750']]);
    await A.click('main .fpiv-card[data-id="asm"] .fpiv-edit label[data-div="MINI"] input'); await settle();
    c = (await cards())[0];
    eq('품목군 Mini 만 → 배럴 525 · 조립 완료 140 (넣은 제목은 그대로, 열이 월이라 연도)', [c.title, c.rows.map(r => [r[0], r.slice(-1)[0]])], ['조립 + 사출 · 2026', [['배럴 · WIP01', '525'], ['조립 완료 · WIP', '140'], ['합계', '665']]]);
    await ev(() => { const i = document.querySelector('main .fpiv-card[data-id="asm"] input[data-k="title"]'); i.value = ''; i.dispatchEvent(new Event('change')); }); await settle();
    eq('제목을 비우면 자동 제목 "조립 · 사출 재고 (Mini)"', (await cards())[0].title, '조립 · 사출 재고 (Mini) · 2026');
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="asm"] select[data-k="rows"]'); s.value = 'item'; s.dispatchEvent(new Event('change')); }); await settle();
    c = (await cards())[0];
    eq('행 = 품목 → 품목코드 줄 (A-M1 · A-M2 · I-M1)', c.rows.map(r => r[0]), ['A-M1', 'A-M2', 'I-M1', '합계']);
    await A.click('main .fpiv-card[data-id="asm"] tbody tr[data-k="A-M2"] td.pc'); await settle();
    const md = await ev(() => { const m = document.querySelector('.modal'); return m ? m.querySelector('.modal-head, h2, h3').textContent : null; });
    ok('품목 줄 → 그 품목 수불부 (A-M2)', !!md && /A-M2/.test(md), md);
    await A.keyboard.press('Escape'); await settle();
    // 재고 0 줄: 재고를 0 으로 만든 품목
    await ev(async () => { const DB = ERP.db; DB.add('stock_tx', { date: '2026-10-06', kind: 'ADJ', to_scope: 'FAC', code: 'A-M2', qty: -20, unit: 'PCS', src: 'manual' }); await DB.flush(); ERP.render(); }); await settle();
    eq('A-M2 재고 0 → 줄 숨김 (9월 말은 20 이라 월 열에서는 보임)', (await cards())[0].rows.map(r => r[0]), ['A-M1', 'A-M2', 'I-M1', '합계']);
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="asm"] select[data-k="cols"]'); s.value = 'none'; s.dispatchEvent(new Event('change')); }); await settle();
    c = (await cards())[0];
    eq('열 = 없음 → 품목 \\ · 지금 재고 하나 · A-M2(0) 숨김', [c.head, c.rows.map(r => r[0])], [['품목', '지금 재고'], ['A-M1', 'I-M1', '합계']]);
    await A.click('main .fpiv-card[data-id="asm"] .fpiv-edit label.fpiv-chk:has-text("재고 0인 줄도 보기") input'); await settle();
    eq('재고 0인 줄도 보기 → A-M2 0 보임', (await cards())[0].rows.map(r => [r[0], r[1]]), [['A-M1', '120'], ['A-M2', '·'], ['I-M1', '525'], ['합계', '645']]);
    await A.click('main .fpiv-card[data-id="asm"] button[data-act="done"]'); await settle();
    eq('완료 → 설정 닫힘', (await cards())[0].edit, false);
  });

  await sec('4. 표 추가 · 순서 · 지우기 · 기본 표로', async () => {
    await ev(async () => { ERP.db.setSetting('floorPivots', null); await ERP.db.flush(); ERP.render(); }); await settle();
    await A.click('main .fpiv-foot button[data-act="add"]'); await settle();
    let c = await cards();
    eq('+ 표 추가 → 둘째 표 = 다음 공정(사출) · 품목군 × 월 · 설정 열림', [c.length, c[1].title, c[1].head[0], c[1].edit], [2, '사출 재고 · 2026', '품목군 \\ 월', true]);
    eq('사출 표: Mini 지금 525 (배럴 500 + 창고 25)', c[1].rows.map(r => [r[0], r.slice(-1)[0]]), [['Mini', '525'], ['합계', '525']]);
    await A.click('main .fpiv-foot button[data-act="add"]'); await settle();
    c = await cards();
    eq('한 번 더 → 셋째 표 = 리필 성형', [c.length, c[2].title], [3, '리필 성형 재고 · 2026']);
    const ids = c.map(x => x.id);
    await ev((id) => { const b = Array.from(document.querySelectorAll('main .fpiv-card[data-id="' + id + '"] .fpiv-edit button')).find(x => x.textContent === '위로'); b.click(); }, ids[2]); await settle();
    eq('위로 → 리필 성형 표가 둘째로', (await cards()).map(x => x.id), [ids[0], ids[2], ids[1]]);
    await ev((id) => document.querySelector('main .fpiv-card[data-id="' + id + '"] button[data-act="del"]').click(), ids[2]); ok('지우기 확인 창', await confirmModal()); await settle();
    eq('표 지우기 → 2개 (조립 · 사출)', (await cards()).map(x => x.id), [ids[0], ids[1]]);
    for (const id of [ids[0], ids[1]]) {
      const open = await ev((i) => !!document.querySelector('main .fpiv-card[data-id="' + i + '"] .fpiv-edit'), id);
      if (!open) { await A.click('main .fpiv-card[data-id="' + id + '"] button[data-act="edit"]'); await settle(); }
      await ev((i) => document.querySelector('main .fpiv-card[data-id="' + i + '"] button[data-act="del"]').click(), id); await confirmModal(); await settle();
    }
    eq('모두 지우면 표 없음 · [+ 표 추가] · [기본 표로]', [(await cards()).length, await ev(() => Array.from(document.querySelectorAll('main .fpiv-foot button')).map(b => b.dataset.act)), await ev(() => ERP.db.setting('floorPivots', null))], [0, ['add', 'reset'], []]);
    await A.click('main .fpiv-foot button[data-act="reset"]'); await settle();
    eq('기본 표로 → 조립 · 품목군 × 월', (await cards()).map(x => [x.id, x.title]), [['asm', '조립 재고 · 2026']]);
  });

  await sec('5. 단위가 다르면 나눔 (포장 SET · CT) · 모든 공정', async () => {
    await ev(async () => { ERP.db.setSetting('floorPivots', [{ id: 'all', procs: [], rows: 'proc', cols: 'div' }]); await ERP.db.flush(); ERP.render(); }); await settle();
    const c = (await cards())[0];
    eq('모든 공정 재고 · 공정 \\ 품목군 · 합계 · Mini · Dial · Pencil · 기타', [c.title, c.head], ['모든 공정 재고', ['공정 \\ 품목군', '합계', 'Mini', 'Dial', 'Pencil', '기타']]);
    eq('공정 줄 (단위별) · 포장 CT 3 · SET 7 + 9/15 조정 2 = 9 · 단위별 합계', c.rows, [
      ['사출 · PCS', '525', '525', '·', '·', '·'], ['리필 성형 · PCS', '50', '50', '·', '·', '·'], ['핫포일 스탬핑 · PCS', '70', '70', '·', '·', '·'], ['조립 · PCS', '205', '120', '40', '40', '5'],
      ['포장 · CT', '3', '·', '·', '3', '·'], ['포장 · SET', '9', '·', '·', '9', '·'],
      ['합계 · CT', '3', '·', '·', '3', '·'], ['합계 · PCS', '850', '765', '40', '40', '5'], ['합계 · SET', '9', '·', '·', '9', '·']]);
    ok('원부자재(RM-1)는 없음', !(await ev(() => document.querySelector('main .fpiv').innerText)).includes('RM-1'));
    // 월 열 + 포장 (ECOUNT 기초 6/30 · 현장 실사 8/31 이 섞이면 늦은 날 = 8/31 부터)
    await ev(async () => { ERP.db.setSetting('floorPivots', [{ id: 'pk', procs: ['PCK'], rows: 'div', cols: 'month' }]); await ERP.db.flush(); ERP.render(); }); await settle();
    const p = (await cards())[0];
    eq('포장만 · 월: ECOUNT 기초(6/30)부터 알 수 있음 → 6월 7 · 7월 7 · 8월 7 · 9월 9 · 10월 9 (SET), CT 3', p.rows, [['Pencil · CT', '·', '·', '·', '·', '·', '3', '3', '3', '3', '3'], ['Pencil · SET', '·', '·', '·', '·', '·', '7', '7', '7', '9', '9'], ['합계 · CT', '·', '·', '·', '·', '·', '3', '3', '3', '3', '3'], ['합계 · SET', '·', '·', '·', '·', '·', '7', '7', '7', '9', '9']]);
  });

  await sec('6. 칸 → 아래 표 거르기 (공정 · 품목군) · 엑셀', async () => {
    await ev(async () => { ERP.db.setSetting('floorPivots', null); await ERP.db.flush(); }); await floor();
    await A.click('main .fpiv-card tbody tr[data-k="MINI"] td.pc:last-child'); await settle();
    const f = await ev(() => ({ proc: ERP.state.stk_floor.proc, line: ERP.state.stk_floor.line, codes: Array.from(document.querySelectorAll('main table.tbl:not(.fpiv-t) tbody tr')).map(tr => tr.children[0].innerText.trim()).sort(), chip: Array.from(document.querySelectorAll('main .toolbar button')).map(b => b.textContent).filter(t => /×$/.test(t)) }));
    eq('Mini 지금 칸 → 아래 표 = 조립 · Mini 품목 (A-M1 · 재고 0 이지만 수불 있는 A-M2) · "조립 · Mini ×"', f, { proc: 'ASM', line: 'MINI', codes: ['A-M1', 'A-M2'], chip: ['조립 · Mini ×'] });
    await A.click('main .fpiv-card tbody tr[data-k=""] td.pc:first-child'); await settle();
    eq('기타(품목군 없음) 줄 → 조립 품목 전체 (품목군 거르기 없음)', await ev(() => [ERP.state.stk_floor.proc, ERP.state.stk_floor.line]), ['ASM', '']);
    await ev(async () => { ERP.db.setSetting('floorPivots', [{ id: 'all', procs: [], rows: 'div', cols: 'proc' }]); await ERP.db.flush(); ERP.render(); }); await settle();
    await A.click('main .fpiv-card tbody tr[data-k="MINI"] td.pc:nth-child(3)'); await settle();
    eq('품목군 × 공정 표의 Mini · 사출 칸 → 사출 · Mini', await ev(() => [ERP.state.stk_floor.proc, ERP.state.stk_floor.line]), ['INJ', 'MINI']);
    // 엑셀: 보이는 표 그대로
    await ev(() => { window.__xl = null; ERP.xl.exportAoa = (name, hdr, rows) => { window.__xl = { name, hdr, rows }; }; });
    await A.click('main .fpiv-card button[data-act="xl"]'); await settle();
    const x = await ev(() => window.__xl);
    eq('엑셀 = 머리 · 줄 6 + 단위별 합계 3 (보이는 표 그대로)', x && [x.name, x.hdr, x.rows[0], x.rows.length, x.rows.slice(-1)[0]], ['floor_pivot', ['품목군', '합계', '사출', '리필 성형', '핫포일 스탬핑', '조립', '포장'], ['Mini · PCS', 765, 525, 50, 70, 120, 0], 9, ['합계 · SET', 9, 0, 0, 0, 0, 9]]);
    await ev(async () => { ERP.db.setSetting('floorPivots', null); await ERP.db.flush(); ERP.render(); }); await settle();
  });

  await sec('7. 베트남어 · 휴대폰 폭 · 오류 없음', async () => {
    await ev(() => ERP.setLang('vi')); await floor();
    let c = (await cards())[0];
    eq('베트남어: 제목 · 머리 · 합계', [c.title, c.head[0], c.head.slice(-1)[0], c.rows.slice(-1)[0][0]], ['Lắp ráp — tồn · 2026', 'Nhóm \\ Tháng', 'T10 hiện tại', 'Tổng']);
    await A.click('main .fpiv-card button[data-act="edit"]'); await settle();
    const vt = await ev(() => document.querySelector('main .fpiv').innerText);
    ok('베트남어 설정에 한글 없음 (품목군 이름 · 기타 빼고)', !/[가-힣]/.test(vt.replace(/기타/g, '')), vt.match(/.{0,20}[가-힣]+.{0,20}/g));
    await ev(() => ERP.setLang('ko')); await floor();
    await A.setViewportSize({ width: 375, height: 812 }); await floor(); await A.click('main .fpiv-card button[data-act="edit"]'); await settle();
    const w = await ev(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, t: !!document.querySelector('main .fpiv-card table') }));
    ok('휴대폰 폭(375px): 화면은 가로로 넘치지 않음 (표만 옆으로 밀림)', w.t && w.doc <= w.win + 1, w);
    await A.setViewportSize({ width: 1480, height: 920 });
    ok('화면 오류 없음', errors.length === 0, errors.slice(0, 5));
  });

  await browser.close(); S.close();
  console.log('\n' + (fail ? '실패 ' + fail + ' / ' : '') + '통과 ' + pass + ' / 전체 ' + (pass + fail));
  if (failures.length) { console.log('\n실패 목록:'); failures.forEach(f => console.log(' - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
