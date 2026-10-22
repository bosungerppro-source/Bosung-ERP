'use strict';
/* 17차(v1.12.x) 자동 시험: 현장 재고 위 = 피벗 표
   사용자 1.12.0: "두번째사진 형태로 조립부분만 보여줘. 다른공정들은 커스텀마이징 할수있게 해주고 엑셀 기능의 피벗테이블 처럼"
   사용자 1.12.1: "현재 재고잖아 월별은 필요없어 현재재고만 보여주면된다" — 월 열 없음, 값은 언제나 현재 재고
   1 기본 표 = 조립 · 품목군 | 현재 재고 · 단계 카드 없음 · 2 월 열 없음 (예전 설정의 월 → 현재 재고)
   3 설정 (공정 · 품목군 · 행 · 열 · 범위 · 제목 · 재고 0 줄) → 저장 (다시 열어도 그대로) · 4 표 추가 · 순서 · 지우기 · 기본 표로 · 좁은 표는 나란히
   5 단위가 다르면 나눔 (포장 SET · CT) · 6 칸 → 아래 표 거르기 · 품목 줄 → 수불부 · 엑셀 · 7 베트남어 · 휴대폰 폭 · 오류 없음
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

const FLOOR = '2026-08-31', EC = '2026-06-30';

(async () => {
  const dataDir = tmp('erp-v17-');
  const S = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir, host: '127.0.0.1', port: 7400 + Math.floor(Math.random() * 300), backupDelay: 3600000 });
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 } });
  const A = await ctx.newPage(); A.on('pageerror', e => errors.push('pageerror: ' + e.message));
  A.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Failed to fetch/.test(m.text())) errors.push('console: ' + m.text()); });
  const ready = () => A.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 180000 });
  const ev = (fn, arg) => A.evaluate(fn, arg);
  const settle = () => A.waitForTimeout(350);
  const confirmModal = async () => { for (let i = 0; i < 20; i++) { await A.waitForTimeout(150); const m = await A.$('.modal .modal-foot button:last-child'); if (m) { await m.click(); return true; } } return false; };
  /** 피벗 표들: [{ id, title, head: [...], rows: [[...cells]], help, edit, narrow }] */
  const cards = () => ev(() => Array.from(document.querySelectorAll('main .fpiv-card')).map(c => ({ id: c.dataset.id, title: c.querySelector('h2').textContent,
    head: Array.from(c.querySelectorAll('thead th')).map(t => t.innerText.replace(/\s+/g, ' ').trim()),
    rows: Array.from(c.querySelectorAll('tbody tr')).map(tr => Array.from(tr.children).map(td => td.innerText.replace(/\s+/g, ' ').trim())), help: (c.querySelector('p.help') || {}).textContent || '', edit: !!c.querySelector('.fpiv-edit'), narrow: c.classList.contains('narrow') })));
  const floor = async () => { await ev(() => { ERP.state.stk_floor = null; ERP.goStock('floor'); ERP.render(); }); await settle(); };
  const setPivots = async (v) => { await ev(async (x) => { ERP.db.setSetting('floorPivots', x); await ERP.db.flush(); ERP.render(); }, v); await settle(); };
  await A.goto(S.url + '/#/home'); await ready();

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

  await sec('1. 기본 표 = 조립 · 품목군 | 현재 재고 · 단계 카드 없음', async () => {
    await floor();
    const c = await cards();
    eq('표 하나 · 제목 "조립 재고" (연도 없음) · 단계 카드 없음 · 연도 단추 없음', [c.length, c[0] && c[0].title, await ev(() => document.querySelectorAll('main .flow .st').length), await ev(() => document.querySelectorAll('main .fpiv .wnav').length)], [1, '조립 재고', 0, 0]);
    eq('머리: 품목군 · 현재 재고 (월 없음)', c[0].head, ['품목군', '현재 재고']);
    // 현재 = 현장 실사 + 그 뒤 수불 (A-M1 100 + 50 − 30 = 120, A-M2 20 → Mini 140 · Dial 30 + 10 = 40)
    eq('줄 = 품목군 (Mini · Dial · Pencil · 기타) 현재 재고 · 합계', c[0].rows, [['Mini', '140'], ['Dial', '40'], ['Pencil', '40'], ['기타', '5'], ['합계', '225']]);
    ok('설명: 단위 PCS · 좁은 카드 (현재 재고 한 칸)', /단위 PCS/.test(c[0].help) && c[0].narrow, c[0]);
    eq('합계 = 조립 단계(WIP · WIP55) 품목의 재고 합 (아래 품목 표와 같은 계산)', await ev(() => ERP.inv.rows().filter(s => ERP.inv.groupOf(s) === 'floor' && ['WIP', 'WIP55'].includes(s.stage)).reduce((a, s) => a + s.bal, 0)), 225);
    eq('설정 floorPivots 은 아직 저장 안 됨 (기본 표)', await ev(() => ERP.db.setting('floorPivots', null)), null);
  });

  await sec('2. 월 열 없음 — 예전(1.12.0) 설정의 열 "월" 도 현재 재고 한 칸으로', async () => {
    await setPivots([{ id: 'asm', procs: ['ASM'], rows: 'div', cols: 'month' }]);
    const c = (await cards())[0];
    eq('cols: month → 품목군 · 현재 재고', [c.title, c.head, c.rows.slice(-1)[0]], ['조립 재고', ['품목군', '현재 재고'], ['합계', '225']]);
    ok('표 · 설명에 "월" 없음', !/\d+월|월 =|말일/.test(await ev(() => document.querySelector('main .fpiv').innerText)));
    await setPivots(null);
  });

  await sec('3. 설정 (엑셀 피벗처럼: 공정 · 품목군 · 행 · 열 · 범위 · 제목) → 저장', async () => {
    await A.click('main .fpiv-card[data-id="asm"] button[data-act="edit"]'); await settle();
    const ed = await ev(() => { const e = document.querySelector('main .fpiv-card[data-id="asm"] .fpiv-edit'); return e ? { procs: Array.from(e.querySelectorAll('[data-proc]')).map(l => [l.dataset.proc, l.querySelector('input').checked]), divs: Array.from(e.querySelectorAll('[data-div]')).map(l => [l.dataset.div, l.innerText.trim(), l.querySelector('input').checked]),
      rows: Array.from(e.querySelectorAll('select[data-k="rows"] option')).map(o => o.textContent), cols: Array.from(e.querySelectorAll('select[data-k="cols"] option')).map(o => o.textContent) } : null; });
    eq('설정: 공정 = 전체 + 현장에 있는 공정 (종이 권취 · 기타는 품목 없어 빠짐, 조립만 켜짐) · 품목군 = 전체(켜짐) · Mini · Dial · Pencil · 기타 · 행 4 · 열 (월 없음, 행과 같은 품목군 빼고)', ed, {
      procs: [['', false], ['INJ', false], ['REF', false], ['STP', false], ['ASM', true], ['PCK', false]],
      divs: [['', '전체', true], ['MINI', 'Mini', false], ['REG', 'Dial', false], ['PEN', 'Pencil', false], ['', '기타', false]],
      rows: ['품목군', '공정', '단계', '품목'], cols: ['없음 (현재 재고 한 칸)', '공정', '단계'] });
    eq('설정을 열면 넓은 카드', (await cards())[0].narrow, false);
  });

  await sec('3-2. 공정 더하기 · 열 = 공정 · 범위 · 제목 · 다시 열어도 그대로', async () => {
    await A.click('main .fpiv-card[data-id="asm"] .fpiv-edit label[data-proc="INJ"] input'); await settle();
    let c = (await cards())[0];
    eq('사출 더함 → 제목 "조립 · 사출 재고" · Mini 현재 = 140 + 배럴 500 + 창고 25 = 665', [c.title, c.rows.find(r => r[0] === 'Mini').slice(-1)[0]], ['조립 · 사출 재고', '665']);
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="asm"] select[data-k="cols"]'); s.value = 'proc'; s.dispatchEvent(new Event('change')); }); await settle();
    c = (await cards())[0];
    eq('열 = 공정 → 품목군 \\ 공정 · 합계 · 사출 · 조립', [c.title, c.head], ['조립 · 사출 재고', ['품목군 \\ 공정', '합계', '사출', '조립']]);
    eq('줄: Mini 665 = 525 + 140 · Dial 40 · Pencil 40 · 기타 5 · 합계 750', c.rows, [['Mini', '665', '525', '140'], ['Dial', '40', '·', '40'], ['Pencil', '40', '·', '40'], ['기타', '5', '·', '5'], ['합계', '750', '525', '225']]);
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="asm"] select[data-k="scope"]'); s.value = 'WH'; s.dispatchEvent(new Event('change')); }); await settle();
    c = (await cards())[0];
    eq('범위 = 창고 → 창고에 있는 것만 (배럴 Mini 25, 0 인 열 숨김) · 설명에 범위 창고', [c.rows, /범위 창고/.test(c.help)], [[['Mini', '25', '25'], ['합계', '25', '25']], true]);
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="asm"] select[data-k="scope"]'); s.value = 'all'; s.dispatchEvent(new Event('change')); }); await settle();
    await ev(() => { const i = document.querySelector('main .fpiv-card[data-id="asm"] input[data-k="title"]'); i.value = '조립 + 사출'; i.dispatchEvent(new Event('change')); }); await settle();
    eq('설정 저장 (floorPivots): 공정 ASM · INJ · 열 공정 · 제목', await ev(() => ERP.db.setting('floorPivots', null)), [{ id: 'asm', title: '조립 + 사출', procs: ['ASM', 'INJ'], divs: [], rows: 'div', cols: 'proc', scope: 'all' }]);
    await A.reload(); await ready(); await floor();
    c = (await cards())[0];
    eq('다시 열어도 그대로 (제목 · 열 = 공정) · 설정 닫힘', [c.title, c.head[0], c.edit], ['조립 + 사출', '품목군 \\ 공정', false]);
    eq('서버에 저장됨', await ev(async () => (await (await fetch('/api/meta', { cache: 'no-store' })).json()).meta.floorPivots[0].procs), ['ASM', 'INJ']);
  });

  await sec('3-3. 행 바꾸기 (공정 · 단계 · 품목) · 품목군 거르기 · 재고 0 줄', async () => {
    await A.click('main .fpiv-card[data-id="asm"] button[data-act="edit"]'); await settle();
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="asm"] select[data-k="rows"]'); s.value = 'proc'; s.dispatchEvent(new Event('change')); }); await settle();
    let c = (await cards())[0];
    eq('행 = 공정 (열이 공정이던 것은 현재 재고 한 칸으로) → 공정 · 현재 재고', [c.head, c.rows], [['공정', '현재 재고'], [['사출', '525'], ['조립', '225'], ['합계', '750']]]);
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="asm"] select[data-k="rows"]'); s.value = 'stage'; s.dispatchEvent(new Event('change')); }); await settle();
    eq('행 = 단계 → 배럴 · 부품 WIP55 · 조립 완료', (await cards())[0].rows, [['배럴 · WIP01', '525'], ['부품 · WIP55', '40'], ['조립 완료 · WIP', '185'], ['합계', '750']]);
    await A.click('main .fpiv-card[data-id="asm"] .fpiv-edit label[data-div="MINI"] input'); await settle();
    c = (await cards())[0];
    eq('품목군 Mini 만 → 배럴 525 · 조립 완료 140 (넣은 제목은 그대로)', [c.title, c.rows], ['조립 + 사출', [['배럴 · WIP01', '525'], ['조립 완료 · WIP', '140'], ['합계', '665']]]);
    await ev(() => { const i = document.querySelector('main .fpiv-card[data-id="asm"] input[data-k="title"]'); i.value = ''; i.dispatchEvent(new Event('change')); }); await settle();
    eq('제목을 비우면 자동 제목 "조립 · 사출 재고 (Mini)"', (await cards())[0].title, '조립 · 사출 재고 (Mini)');
    await ev(() => { const s = document.querySelector('main .fpiv-card[data-id="asm"] select[data-k="rows"]'); s.value = 'item'; s.dispatchEvent(new Event('change')); }); await settle();
    eq('행 = 품목 → 품목코드 줄 (A-M1 · A-M2 · I-M1)', (await cards())[0].rows, [['A-M1', '120'], ['A-M2', '20'], ['I-M1', '525'], ['합계', '665']]);
    await A.click('main .fpiv-card[data-id="asm"] tbody tr[data-k="A-M2"] td.pc'); await settle();
    const md = await ev(() => { const m = document.querySelector('.modal'); return m ? m.querySelector('.modal-head').textContent : null; });
    ok('품목 줄 → 그 품목 수불부 (A-M2)', !!md && /A-M2/.test(md), md);
    await A.keyboard.press('Escape'); await settle();
    await ev(async () => { const DB = ERP.db; DB.add('stock_tx', { date: '2026-10-06', kind: 'ADJ', to_scope: 'FAC', code: 'A-M2', qty: -20, unit: 'PCS', src: 'manual' }); await DB.flush(); ERP.render(); }); await settle();
    eq('A-M2 재고 0 → 줄 숨김', (await cards())[0].rows.map(r => r[0]), ['A-M1', 'I-M1', '합계']);
    await A.click('main .fpiv-card[data-id="asm"] .fpiv-edit label.fpiv-chk:has-text("재고 0인 줄도 보기") input'); await settle();
    eq('재고 0인 줄도 보기 → A-M2 · 로 보임', (await cards())[0].rows, [['A-M1', '120'], ['A-M2', '·'], ['I-M1', '525'], ['합계', '645']]);
    await A.click('main .fpiv-card[data-id="asm"] button[data-act="done"]'); await settle();
    eq('완료 → 설정 닫힘', (await cards())[0].edit, false);
  });

  await sec('4. 표 추가 · 순서 · 지우기 · 기본 표로 · 좁은 표는 나란히', async () => {
    await setPivots(null);
    await A.click('main .fpiv-foot button[data-act="add"]'); await settle();
    let c = await cards();
    eq('+ 표 추가 → 둘째 표 = 다음 공정(사출) · 품목군 · 현재 재고 · 설정 열림', [c.length, c[1].title, c[1].head, c[1].edit], [2, '사출 재고', ['품목군', '현재 재고'], true]);
    eq('사출 표: Mini 525 (배럴 500 + 창고 25)', c[1].rows, [['Mini', '525'], ['합계', '525']]);
    await A.click('main .fpiv-foot button[data-act="add"]'); await settle();
    c = await cards();
    eq('한 번 더 → 셋째 표 = 리필 성형', [c.length, c[2].title], [3, '리필 성형 재고']);
    const ids = c.map(x => x.id);
    await ev((id) => { const b = Array.from(document.querySelectorAll('main .fpiv-card[data-id="' + id + '"] .fpiv-edit button')).find(x => x.textContent === '위로'); b.click(); }, ids[2]); await settle();
    eq('위로 → 리필 성형 표가 둘째로', (await cards()).map(x => x.id), [ids[0], ids[2], ids[1]]);
    // 설정을 닫으면 세 표가 한 줄에 나란히 (1480px 폭)
    for (const id of [ids[1], ids[2]]) { await A.click('main .fpiv-card[data-id="' + id + '"] button[data-act="done"]'); await settle(); }
    const pos = await ev(() => Array.from(document.querySelectorAll('main .fpiv-card')).map(x => [x.classList.contains('narrow'), Math.round(x.getBoundingClientRect().top)]));
    ok('좁은 표 셋이 한 줄에 나란히', pos.length === 3 && pos.every(p => p[0]) && pos.every(p => p[1] === pos[0][1]), pos);
    await A.click('main .fpiv-card[data-id="' + ids[2] + '"] button[data-act="edit"]'); await settle();
    await ev((id) => document.querySelector('main .fpiv-card[data-id="' + id + '"] button[data-act="del"]').click(), ids[2]); ok('지우기 확인 창', await confirmModal()); await settle();
    eq('표 지우기 → 2개 (조립 · 사출)', (await cards()).map(x => x.id), [ids[0], ids[1]]);
    for (const id of [ids[0], ids[1]]) {
      await A.click('main .fpiv-card[data-id="' + id + '"] button[data-act="edit"]'); await settle();
      await ev((i) => document.querySelector('main .fpiv-card[data-id="' + i + '"] button[data-act="del"]').click(), id); await confirmModal(); await settle();
    }
    eq('모두 지우면 표 없음 · [+ 표 추가] · [기본 표로]', [(await cards()).length, await ev(() => Array.from(document.querySelectorAll('main .fpiv-foot button')).map(b => [b.dataset.act, b.textContent])), await ev(() => ERP.db.setting('floorPivots', null))], [0, [['add', '+ 표 추가'], ['reset', '기본 표로 (조립 · 품목군)']], []]);
    await A.click('main .fpiv-foot button[data-act="reset"]'); await settle();
    eq('기본 표로 → 조립 · 품목군 | 현재 재고', (await cards()).map(x => [x.id, x.title, x.head.join(' | ')]), [['asm', '조립 재고', '품목군 | 현재 재고']]);
  });

  await sec('5. 단위가 다르면 나눔 (포장 SET · CT) · 모든 공정', async () => {
    await setPivots([{ id: 'all', procs: [], rows: 'proc', cols: 'div' }]);
    const c = (await cards())[0];
    eq('모든 공정 재고 · 공정 \\ 품목군 · 합계 · Mini · Dial · Pencil · 기타 · 넓은 카드', [c.title, c.head, c.narrow], ['모든 공정 재고', ['공정 \\ 품목군', '합계', 'Mini', 'Dial', 'Pencil', '기타'], false]);
    eq('공정 줄 (단위별) · 포장 CT 3 · SET 7 + 9/15 조정 2 = 9 · 단위별 합계', c.rows, [
      ['사출 · PCS', '525', '525', '·', '·', '·'], ['리필 성형 · PCS', '50', '50', '·', '·', '·'], ['핫포일 스탬핑 · PCS', '70', '70', '·', '·', '·'], ['조립 · PCS', '205', '120', '40', '40', '5'],
      ['포장 · CT', '3', '·', '·', '3', '·'], ['포장 · SET', '9', '·', '·', '9', '·'],
      ['합계 · CT', '3', '·', '·', '3', '·'], ['합계 · PCS', '850', '765', '40', '40', '5'], ['합계 · SET', '9', '·', '·', '9', '·']]);
    ok('원부자재(RM-1)는 없음', !(await ev(() => document.querySelector('main .fpiv').innerText)).includes('RM-1'));
    await setPivots([{ id: 'pk', procs: ['PCK'], rows: 'div', cols: 'none' }]);
    eq('포장만 · 현재 재고: Pencil CT 3 · SET 9 (단위별 줄 · 합계)', (await cards())[0].rows, [['Pencil · CT', '3'], ['Pencil · SET', '9'], ['합계 · CT', '3'], ['합계 · SET', '9']]);
  });

  await sec('6. 칸 → 아래 표 거르기 (공정 · 품목군) · 엑셀', async () => {
    await setPivots(null); await floor();
    await A.click('main .fpiv-card tbody tr[data-k="MINI"] td.pc:last-child'); await settle();
    const f = await ev(() => ({ proc: ERP.state.stk_floor.proc, line: ERP.state.stk_floor.line, codes: Array.from(document.querySelectorAll('main table.tbl:not(.fpiv-t) tbody tr')).map(tr => tr.children[0].innerText.trim()).sort(), chip: Array.from(document.querySelectorAll('main .toolbar button')).map(b => b.textContent).filter(t => /×$/.test(t)) }));
    eq('Mini 칸 → 아래 표 = 조립 · Mini 품목 (A-M1 · 재고 0 이지만 수불 있는 A-M2) · "조립 · Mini ×"', f, { proc: 'ASM', line: 'MINI', codes: ['A-M1', 'A-M2'], chip: ['조립 · Mini ×'] });
    await A.click('main .fpiv-card tbody tr[data-k=""] td.pc:first-child'); await settle();
    eq('기타(품목군 없음) 줄 → 조립 품목 전체 (품목군 거르기 없음)', await ev(() => [ERP.state.stk_floor.proc, ERP.state.stk_floor.line]), ['ASM', '']);
    await setPivots([{ id: 'all', procs: [], rows: 'div', cols: 'proc' }]);
    await A.click('main .fpiv-card tbody tr[data-k="MINI"] td.pc:nth-child(3)'); await settle();
    eq('품목군 × 공정 표의 Mini · 사출 칸 → 사출 · Mini', await ev(() => [ERP.state.stk_floor.proc, ERP.state.stk_floor.line]), ['INJ', 'MINI']);
    await ev(() => { window.__xl = null; ERP.xl.exportAoa = (name, hdr, rows) => { window.__xl = { name, hdr, rows }; }; });
    await A.click('main .fpiv-card button[data-act="xl"]'); await settle();
    const x = await ev(() => window.__xl);
    eq('엑셀 = 머리 · 줄 6 + 단위별 합계 3 (보이는 표 그대로)', x && [x.name, x.hdr, x.rows[0], x.rows.length, x.rows.slice(-1)[0]], ['floor_pivot', ['품목군', '합계', '사출', '리필 성형', '핫포일 스탬핑', '조립', '포장'], ['Mini · PCS', 765, 525, 50, 70, 120, 0], 9, ['합계 · SET', 9, 0, 0, 0, 0, 9]]);
    await setPivots(null);
    await A.click('main .fpiv-card button[data-act="xl"]'); await settle();
    const y = await ev(() => window.__xl);
    eq('기본 표 엑셀 = 품목군 · 현재 재고', y && [y.hdr, y.rows], [['품목군', '현재 재고'], [['Mini', 120], ['Dial', 40], ['Pencil', 40], ['기타', 5], ['합계', 205]]]);
  });

  await sec('7. 베트남어 · 휴대폰 폭 · 오류 없음', async () => {
    await ev(() => ERP.setLang('vi')); await floor();
    const c = (await cards())[0];
    eq('베트남어: 제목 · 머리 · 합계', [c.title, c.head, c.rows.slice(-1)[0][0]], ['Lắp ráp — tồn', ['Nhóm', 'Tồn hiện tại'], 'Tổng']);
    await A.click('main .fpiv-card button[data-act="edit"]'); await settle();
    const vt = await ev(() => document.querySelector('main .fpiv').innerText);
    ok('베트남어 설정에 한글 없음', !/[가-힣]/.test(vt), vt.match(/.{0,20}[가-힣]+.{0,20}/g));
    await ev(() => ERP.setLang('ko')); await floor();
    await A.setViewportSize({ width: 375, height: 812 }); await floor(); await A.click('main .fpiv-card button[data-act="edit"]'); await settle();
    const w = await ev(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, t: !!document.querySelector('main .fpiv-card table') }));
    ok('휴대폰 폭(375px): 화면은 가로로 넘치지 않음', w.t && w.doc <= w.win + 1, w);
    await A.setViewportSize({ width: 1480, height: 920 });
    ok('화면 오류 없음', errors.length === 0, errors.slice(0, 5));
  });

  await browser.close(); S.close();
  console.log('\n' + (fail ? '실패 ' + fail + ' / ' : '') + '통과 ' + pass + ' / 전체 ' + (pass + fail));
  if (failures.length) { console.log('\n실패 목록:'); failures.forEach(f => console.log(' - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
