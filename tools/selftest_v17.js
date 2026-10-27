'use strict';
/* 17차(v1.12.x) 자동 시험: 현장 재고 위 = 피벗 표
   사용자 1.12.0: "두번째사진 형태로 조립부분만 보여줘. 다른공정들은 커스텀마이징 할수있게 해주고 엑셀 기능의 피벗테이블 처럼"
   사용자 1.12.1: "현재 재고잖아 월별은 필요없어 현재재고만 보여주면된다" — 월 열 없음, 값은 언제나 현재 재고
   1 기본 표 = 조립 · 품목군 | 현재 재고 · 단계 카드 없음 · 2 월 열 없음 (예전 설정의 월 → 현재 재고)
   3 설정 (공정 · 품목군 · 행 · 열 · 범위 · 제목 · 재고 0 줄) → 저장 (다시 열어도 그대로) · 4 표 추가 · 순서 · 지우기 · 기본 표로 · 좁은 표는 나란히
   5 단위가 다르면 나눔 (포장 SET · CT) · 6 칸 → 아래 표 거르기 · 품목 줄 → 수불부 · 엑셀
   7 종합 현황 위젯 (1.12.2, 사용자 "종합 현황에 이거 추가할수있게 해줘") · 7-2 위젯 ⚙ 품목군 여러 개 → 고른 것만 (1.13.6)
   7-3 생산 관리 일별 · 월별 · 일보 조회 · 종합 현황 일별 · 월별 위젯도 품목군 여러 개 (1.13.8)
   7-4 현장 재고 → 원재료 환산 표 (조립 재고 옆 · 공정별 · 위젯) · 7-5 MRP 수주 가져오기: 전체 선택 · 진행 상태 · 범위 · 7-6 박스 포장의 SG 는 차감 안 함 (1.13.9)
   7-7 포장한 만큼 조립 재고가 줄어듦 — 박스 → 세트 → 조립품 (1.13.10) · 7-8 수주서 그대로 올리기 (1.13.11) · 8 이번 달 포장 누계 = pcs (1.12.3)
   9 숫자 카드 아래 지난달 값 (1.12.4: 포장 누계 · 신규 수주 · 수주량) · 10 기본 배치 = 사용자 배치 (1.12.5) · 11 베트남어 · 휴대폰 폭 · 오류 없음
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

  await sec('7. 종합 현황 위젯 (1.12.2): 위젯 추가 → 현장 재고 (공정별 현재 재고) · ⚙ 공정 · 여러 개 · 칸 → 현장 재고', async () => {
    await setPivots(null);
    await A.emulateMedia({ reducedMotion: 'reduce' });   // 편집 모드의 흔들림 애니메이션 끄기 (클릭 시험용, v7 과 같음)
    // 1.12.5 부터 기본 배치에 조립 재고 위젯이 있어, 없는 배치에서 위젯 추가를 본다
    await ev(() => { ERP.db.setSetting('dash', [{ k: 'v17-pm', id: 'kpi_pck_month', w: 1 }]); ERP.state.dashEdit = true; ERP.goto('dashboard'); ERP.render(); }); await settle();
    await A.click('main button:has-text("위젯 추가")'); await A.waitForSelector('.modal .wgal');
    const item = await ev(() => { const it = Array.from(document.querySelectorAll('.modal .wgal-item')).find(x => x.querySelector('b').textContent === '현장 재고 (공정별 현재 재고)'); return it ? { cat: it.parentElement.parentElement.querySelector('h4').textContent, text: it.innerText.replace(/\s+/g, ' ') } : null; });
    ok('위젯 목록의 재고 칸에 "현장 재고 (공정별 현재 재고)" · 가로 1칸 · 여러 개 가능', item && item.cat === '재고' && /가로 1칸/.test(item.text) && /여러 개 가능/.test(item.text), item);
    await A.click('.modal .wgal-item:has(b:text-is("현장 재고 (공정별 현재 재고)")) button'); await settle();
    const wOf = () => ev(() => Array.from(document.querySelectorAll('.wgrid .w[data-id=floor_stock]')).map(el => ({ title: el.querySelector('h2').textContent, head: Array.from(el.querySelectorAll('thead th')).map(t => t.innerText.trim()), rows: Array.from(el.querySelectorAll('tbody tr')).map(tr => Array.from(tr.children).map(td => td.innerText.trim())), w: el.dataset.w, help: (el.querySelector('p.help') || {}).textContent })));
    let w = await wOf();
    eq('추가한 위젯 = 조립 재고 · 품목군 | 현재 재고 (현장 재고 위 표와 같은 숫자) · 가로 1칸 · 단위 PCS', w, [{ title: '조립 재고', head: ['품목군', '현재 재고'], rows: [['Mini', '120'], ['Dial', '40'], ['Pencil', '40'], ['기타', '5'], ['합계', '205']], w: '1', help: '단위 PCS · 현재 재고' }]);
    await A.click('.wgrid .w[data-id=floor_stock] .wbar button[title="위젯 설정"]'); await A.waitForSelector('.modal select');
    const opts = await ev(() => Array.from(document.querySelectorAll('.modal select')).map(s => Array.from(s.options).map(o => o.textContent)));
    eq('⚙: 공정 (모든 공정 + 공정 + 기타) · 행 · 열', opts, [['모든 공정', '사출', '리필 성형', '핫포일 스탬핑', '조립', '종이 권취', '포장', '기타'], ['품목군', '공정', '단계', '품목'], ['없음 (현재 재고 한 칸)', '공정', '품목군', '단계']]);
    await ev(() => { const s = document.querySelectorAll('.modal select')[0]; s.value = 'INJ'; s.dispatchEvent(new Event('change')); });
    await A.click('.modal .modal-foot button.primary'); await settle();
    w = await wOf();
    eq('⚙ 공정 = 사출 → 사출 재고 · Mini 525', [w[0].title, w[0].rows], ['사출 재고', [['Mini', '525'], ['합계', '525']]]);
    await A.click('main button:has-text("위젯 추가")'); await A.waitForSelector('.modal .wgal');
    await A.click('.modal .wgal-item:has(b:text-is("현장 재고 (공정별 현재 재고)")) button'); await settle();
    eq('하나 더 (여러 개) → 사출 · 조립 두 개 저장', await ev(() => ERP.dashLayout().filter(x => x.id === 'floor_stock').map(x => x.o)), [{ proc: 'INJ', rows: 'div', cols: 'none' }, { proc: 'ASM', rows: 'div', cols: 'none' }]);
    eq('1.12.5 기본 배치에는 조립 재고 위젯이 하나 (사용자 배치)', await ev(() => ERP.dashDefault().filter(x => x.id === 'floor_stock').map(x => x.o.proc)), ['ASM']);
    await ev(() => { ERP.state.dashEdit = false; ERP.render(); }); await settle();
    await ev(() => { const el = Array.from(document.querySelectorAll('.wgrid .w[data-id=floor_stock]')).pop(); el.querySelector('tbody tr[data-k="MINI"] td.pc:last-child').click(); });
    await A.waitForFunction(() => location.hash === '#/floor', null, { timeout: 15000 }); await settle();
    const f = await ev(() => ({ hash: location.hash, proc: ERP.state.stk_floor.proc, line: ERP.state.stk_floor.line, codes: Array.from(document.querySelectorAll('main table.tbl:not(.fpiv-t) tbody tr')).map(tr => tr.children[0].innerText.trim()).sort() }));
    eq('조립 위젯의 Mini 칸 → 현장 재고 · 조립 · Mini 품목', f, { hash: '#/floor', proc: 'ASM', line: 'MINI', codes: ['A-M1', 'A-M2'] });
    await ev(() => { ERP.db.setSetting('dash', null); ERP.state.stk_floor = null; }); await settle();
  });

  await sec('7-2. 종합 현황 조립 재고 위젯 (1.13.6, 사용자 "조립재고 품목군을 중복선택해서 표시하고 싶은거만 표시하게 해줘"): ⚙ 품목군 여러 개 → 고른 것만', async () => {
    await A.emulateMedia({ reducedMotion: 'reduce' });
    const show = async () => { await ev(() => { ERP.state.dashEdit = true; ERP.state.dashDate = null; ERP.goto('dashboard'); ERP.render(); }); await settle(); };
    await ev(() => ERP.db.setSetting('dash', [{ k: 'v17-fs', id: 'floor_stock', w: 1, o: { proc: 'ASM', rows: 'div', cols: 'none' } }])); await show();
    const wOf = () => ev(() => { const el = document.querySelector('.wgrid .w[data-id=floor_stock]'); return { title: el.querySelector('h2').textContent, head: Array.from(el.querySelectorAll('thead th')).map(t => t.innerText.trim()), rows: Array.from(el.querySelectorAll('tbody tr')).map(tr => Array.from(tr.children).map(td => td.innerText.trim())) }; });
    /** ⚙ 의 품목군 칸: { label, all (전체 켜짐), opts: [[품목군 열쇠, 이름, 켜짐]] } */
    const dlg = () => ev(() => { const f = document.querySelector('.modal [data-k="divs"]'); return f ? { label: f.closest('.field').querySelector(':scope > label').textContent, all: f.querySelector('[data-all] input').checked, opts: Array.from(f.querySelectorAll('[data-v]')).map(l => [l.dataset.v, l.innerText.trim(), l.querySelector('input').checked]) } : null; });
    const tick = async (sel) => { await A.click('.modal [data-k="divs"] ' + sel + ' input'); await A.waitForTimeout(100); };
    const openDlg = async () => { await A.click('.wgrid .w[data-id=floor_stock] .wbar button:has-text("⚙")'); await A.waitForSelector('.modal select'); };
    const procTo = async (p) => { await ev((x) => { const s = document.querySelector('.modal select'); s.value = x; s.dispatchEvent(new Event('change')); }, p); await A.waitForTimeout(100); };
    const ALL = [['Mini', '120'], ['Dial', '40'], ['Pencil', '40'], ['기타', '5'], ['합계', '205']];
    eq('처음: 조립 재고 = Mini · Dial · Pencil · 기타 · 합계 205', (await wOf()).rows, ALL);
    await openDlg();
    eq('⚙ 에 품목군: 전체 (켜짐) + 조립 재고에 있는 품목군 Mini · Dial · Pencil · 기타 (꺼짐)', await dlg(), { label: '품목군', all: true, opts: [['MINI', 'Mini', false], ['REG', 'Dial', false], ['PEN', 'Pencil', false], ['', '기타', false]] });
    eq('공정 · 행 · 열 고르기는 그대로', await ev(() => Array.from(document.querySelectorAll('.modal .field > label')).map(l => l.textContent)), ['공정 (기본 조립)', '품목군', '행', '열']);
    await tick('[data-v="MINI"]'); await tick('[data-v="PEN"]');
    eq('Mini · Pencil 을 고르면 (여러 개) 전체는 꺼짐', await dlg(), { label: '품목군', all: false, opts: [['MINI', 'Mini', true], ['REG', 'Dial', false], ['PEN', 'Pencil', true], ['', '기타', false]] });
    await A.click('.modal .modal-foot button.primary'); await settle();
    eq('저장 → 고른 품목군만: Mini 120 · Pencil 40 · 합계 160 (제목 · 머리 그대로)', await wOf(), { title: '조립 재고', head: ['품목군', '현재 재고'], rows: [['Mini', '120'], ['Pencil', '40'], ['합계', '160']] });
    eq('위젯 설정에 저장 (공정 · 행 · 열 그대로)', await ev(() => ERP.dashLayout().find(x => x.id === 'floor_stock').o), { proc: 'ASM', rows: 'div', cols: 'none', divs: ['MINI', 'PEN'] });
    await ev(() => { ERP.state.dashEdit = false; ERP.render(); }); await settle();
    eq('편집을 끝내도 고른 것만', (await wOf()).rows, [['Mini', '120'], ['Pencil', '40'], ['합계', '160']]);
    await A.reload(); await ready(); await show();
    eq('다시 열어도 그대로 (서버에 저장됨)', (await wOf()).rows, [['Mini', '120'], ['Pencil', '40'], ['합계', '160']]);
    await openDlg();
    eq('⚙ 을 다시 열면 Mini · Pencil 켜짐', [(await dlg()).all, (await dlg()).opts.map(x => x[2])], [false, [true, false, true, false]]);
    await procTo('INJ');
    eq('공정을 사출로 바꾸면 사출에 있는 품목군 (Mini) + 고른 Pencil (끌 수 있게)', (await dlg()).opts, [['MINI', 'Mini', true], ['PEN', 'Pencil', true]]);
    await procTo('ASM');
    await tick('[data-v="MINI"]'); await tick('[data-v="PEN"]');
    eq('고른 것을 다 끄면 전체', [(await dlg()).all, (await dlg()).opts.some(x => x[2])], [true, false]);
    await tick('[data-v="REG"]'); await tick('[data-all]');
    eq('전체를 켜면 고른 것이 모두 꺼짐', [(await dlg()).all, (await dlg()).opts.some(x => x[2])], [true, false]);
    await A.click('.modal .modal-foot button.primary'); await settle();
    eq('전체로 저장 → 예전처럼 모두 (합계 205) · 저장된 품목군은 비움', [(await wOf()).rows, await ev(() => ERP.dashLayout().find(x => x.id === 'floor_stock').o.divs)], [ALL, []]);
    await openDlg(); await tick('[data-v="REG"]'); await A.click('.modal .modal-foot button:not(.primary)'); await settle();
    eq('고르고 취소 → 바뀌지 않음', (await wOf()).rows, ALL);
    await ev(() => ERP.setLang('vi')); await show();
    await openDlg();
    const v = await ev(() => document.querySelector('.modal [data-k="divs"]').closest('.field').innerText.replace(/\s+/g, ' '));
    ok('베트남어: Nhóm · Tất cả · Khác · 한글 없음', /Nhóm/.test(v) && /Tất cả/.test(v) && /Khác/.test(v) && !/[가-힣]/.test(v), v);
    await A.keyboard.press('Escape'); await settle();
    await ev(() => ERP.setLang('ko'));
    await ev(() => { ERP.db.setSetting('dash', null); ERP.state.dashEdit = false; ERP.render(); }); await settle();
  });

  await sec('7-3. 생산 관리 일별 · 월별 조립 생산량 · 일보 조회 · 종합 현황 일별 · 월별 위젯 (1.13.8, 사용자 "품목군을 내가 원하는거만 중복선택할수있게 … 현장재고처럼"): 품목군 여러 개 → 고른 것만', async () => {
    await A.emulateMedia({ reducedMotion: 'reduce' });
    // 같은 품목군이 대소문자만 다른 일보 (Dial · dial, Click pencil · Click Pencil) + 품목군 없는 줄 + 다른 공정 (사출: Mini · Bulk)
    await ev(async () => { const DB = ERP.db; const r = (date, process, division, q) => ({ date, process, shift: 'D', division, ok_qty: q, source: 'test' });
      DB.replace('prod_log', [r('2026-10-05', 'ASM', 'Dial', 100), r('2026-10-05', 'ASM', 'dial', 50), r('2026-10-06', 'ASM', 'Mini', 200), r('2026-10-06', 'ASM', 'Click pencil', 30),
        r('2026-10-07', 'ASM', 'Click Pencil', 20), r('2026-10-07', 'ASM', '', 5), r('2026-09-10', 'ASM', 'Mini', 300), r('2026-10-05', 'INJ', 'Mini', 1000), r('2026-10-05', 'INJ', 'Bulk', 400)]);
      delete DB.meta.prodDivs; await DB.saveMeta(); await DB.flush(); });
    const prod = async (tab) => { await ev((t) => { ERP.state.prodTab = t; ERP.state.pan = null; ERP.state.pmon = null; ERP.goto('production'); ERP.render(); }, tab); await settle(); };
    /** 생산 관리 탭: 품목군 체크 (전체 · [열쇠, 이름, 켜짐]) · 첫 표 [이름, 합계] · 첫 숫자 카드 · 예전 '품목군: 전체' 고르기가 남았는지 */
    const pv = () => ev(() => { const row = document.querySelector('main .pdivs'); const t = document.querySelector('main table.tbl');
      return { all: row ? row.querySelector('[data-all] input').checked : null, opts: row ? Array.from(row.querySelectorAll('[data-v]')).map(l => [l.dataset.v, l.innerText.trim(), l.querySelector('input').checked]) : null,
        rows: t ? Array.from(t.querySelectorAll('tbody tr')).map(tr => [tr.children[0].innerText.trim(), tr.children[1].innerText.trim()]) : null,
        kpi: (document.querySelector('main .kpis .kpi-val .v') || {}).textContent || '', oldSel: Array.from(document.querySelectorAll('main .toolbar select option')).some(o => /^품목군:/.test(o.textContent)) }; });
    const tickP = async (sel) => { await A.click('main .pdivs ' + sel + ' input'); await settle(); };
    const OPTS = [['click pencil', 'Click pencil'], ['dial', 'Dial'], ['mini', 'Mini'], ['–', '(품목군 없음)']];
    const on = (keys) => OPTS.map(o => [o[0], o[1], keys.includes(o[0])]);
    await prod('analysis');
    eq('일별 조립 생산량: 품목군 = 체크 (전체 켜짐 + 조립 일보의 품목군 — 대소문자만 다른 것은 하나) · 예전 하나 고르기 없음', await pv(),
      { all: true, opts: on([]), rows: [['Click pencil', '50'], ['Dial', '150'], ['Mini', '200'], ['(품목군 없음)', '5'], ['일 합계', '405']], kpi: '405', oldSel: false });
    await tickP('[data-v="dial"]'); await tickP('[data-v="mini"]');
    eq('Dial · Mini 를 고르면 그 줄만 · 합계 · 숫자 카드도 고른 것만 (Dial = Dial 100 + dial 50)', await pv(),
      { all: false, opts: on(['dial', 'mini']), rows: [['Dial', '150'], ['Mini', '200'], ['일 합계', '350']], kpi: '350', oldSel: false });
    eq('설정에 저장 (공정마다)', await ev(() => ERP.db.setting('prodDivs')), { ASM: ['dial', 'mini'] });
    await prod('monthly');
    eq('월별 조립 생산량에도 같은 품목군 (Mini = 9월 300 + 10월 200)', await pv(), { all: false, opts: on(['dial', 'mini']), rows: [['Dial', '150'], ['Mini', '500'], ['월 합계', '650']], kpi: '650', oldSel: false });
    await A.reload(); await ready(); await prod('monthly');
    eq('다시 열어도 그대로 (서버에 저장됨)', (await pv()).rows, [['Dial', '150'], ['Mini', '500'], ['월 합계', '650']]);
    await A.selectOption('main .toolbar select:nth-of-type(2)', 'INJ'); await settle();
    eq('공정을 사출로 바꾸면 사출 일보의 품목군 · 사출은 따로 (전체)', await pv(), { all: true, opts: [['bulk', 'Bulk', false], ['mini', 'Mini', false]], rows: [['Bulk', '400'], ['Mini', '1,000'], ['월 합계', '1,400']], kpi: '1,400', oldSel: false });
    await A.selectOption('main .toolbar select:nth-of-type(2)', 'ASM'); await settle();
    eq('조립으로 돌아오면 고른 것 그대로', (await pv()).opts, on(['dial', 'mini']));
    await tickP('[data-all]');
    eq('전체를 켜면 모두 · 저장된 것은 비움', [await pv(), await ev(() => ERP.db.setting('prodDivs'))],
      [{ all: true, opts: on([]), rows: [['Click pencil', '50'], ['Dial', '150'], ['Mini', '500'], ['(품목군 없음)', '5'], ['월 합계', '705']], kpi: '705', oldSel: false }, {}]);
    await tickP('[data-v="–"]'); await tickP('[data-v="–"]');
    eq('하나 골랐다가 끄면 다시 전체', [(await pv()).all, (await pv()).rows.length], [true, 5]);
    // 일보 조회: 품목군 고르기 — 대소문자만 다른 것은 하나, 고르면 둘 다
    await prod('log');
    eq('일보 조회 품목군: 대소문자만 다른 것은 하나 (Dial · dial → Dial) + 품목군 없음', await ev(() => Array.from(document.querySelector('main select[aria-label="품목군"]').options).map(o => [o.value, o.textContent])),
      [['', '품목군: 전체'], ['bulk', 'Bulk'], ['click pencil', 'Click pencil'], ['dial', 'Dial'], ['mini', 'Mini'], ['–', '(품목군 없음)']]);
    await A.selectOption('main select[aria-label="품목군"]', 'dial'); await settle();
    eq('Dial 을 고르면 Dial · dial 일보 둘 다', await ev(() => Array.from(document.querySelectorAll('main table.tbl tbody tr')).map(tr => tr.innerText).filter(t => /dial/i.test(t)).length), 2);
    // 종합 현황 일별 · 월별 조립 생산량 위젯: ⚙ 품목군 여러 개 (조립 재고 위젯 1.13.6 과 같은 모양)
    await ev(() => { ERP.db.setSetting('dash', [{ k: 'v17-ad', id: 'asm_daily', w: 4, o: { proc: 'ASM', view: 'table' } }, { k: 'v17-am', id: 'asm_monthly', w: 4, o: { proc: 'ASM', view: 'table' } }]); ERP.state.dashEdit = true; ERP.state.dashDate = null; ERP.goto('dashboard'); ERP.render(); }); await settle();
    const wv = (id) => ev((i) => { const el = document.querySelector('.wgrid .w[data-id=' + i + ']'); return { title: el.querySelector('h2').textContent, rows: Array.from(el.querySelectorAll('tbody tr')).map(tr => [tr.children[0].innerText.trim(), tr.children[1].innerText.trim()]) }; }, id);
    const dlg = () => ev(() => { const f = document.querySelector('.modal [data-k="divs"]'); return f ? { all: f.querySelector('[data-all] input').checked, opts: Array.from(f.querySelectorAll('[data-v]')).map(l => [l.dataset.v, l.innerText.trim(), l.querySelector('input').checked]) } : null; });
    const gear = async (id) => { await A.click('.wgrid .w[data-id=' + id + '] .wbar button:has-text("⚙")'); await A.waitForSelector('.modal [data-k="divs"]'); };
    const tickD = async (sel) => { await A.click('.modal [data-k="divs"] ' + sel + ' input'); await A.waitForTimeout(100); };
    const d0 = await wv('asm_daily'), m0 = await wv('asm_monthly');
    eq('위젯 처음: 모든 품목군 (많은 순)', [d0.rows, m0.rows], [[['Mini', '200'], ['Dial', '150'], ['Click pencil', '50'], ['(품목군 없음)', '5'], ['일 합계', '405']], [['Mini', '500'], ['Dial', '150'], ['Click pencil', '50'], ['(품목군 없음)', '5'], ['월 합계', '705']]]);
    await gear('asm_daily');
    eq('일별 위젯 ⚙: 공정 · 품목군 (전체 켜짐 + 조립 일보의 품목군)', [await ev(() => Array.from(document.querySelectorAll('.modal .field > label')).map(l => l.textContent)), await dlg()], [['공정 (기본 조립)', '품목군'], { all: true, opts: on([]) }]);
    await tickD('[data-v="dial"]'); await A.click('.modal .modal-foot button.primary'); await settle();
    eq('일별 위젯: Dial 만 · 제목 그대로 · 저장', [await wv('asm_daily'), await ev(() => ERP.dashLayout().find(x => x.id === 'asm_daily').o.divs)], [{ title: d0.title, rows: [['Dial', '150'], ['일 합계', '150']] }, ['dial']]);
    await gear('asm_monthly'); await tickD('[data-v="mini"]'); await tickD('[data-v="dial"]'); await A.click('.modal .modal-foot button.primary'); await settle();
    eq('월별 위젯: Mini · Dial 만 · 제목 그대로', await wv('asm_monthly'), { title: m0.title, rows: [['Mini', '500'], ['Dial', '150'], ['월 합계', '650']] });
    await ev(() => { ERP.state.dashEdit = false; ERP.render(); }); await settle();
    eq('편집을 끝내도 고른 것만', [(await wv('asm_daily')).rows.length, (await wv('asm_monthly')).rows.length], [2, 3]);
    await ev(() => ERP.setLang('vi')); await prod('analysis');
    const vt = await ev(() => document.querySelector('main .pdivs').innerText.replace(/\s+/g, ' '));
    ok('베트남어: Nhóm · Tất cả · (không nhóm) · 한글 없음', /Nhóm/.test(vt) && /Tất cả/.test(vt) && /không nhóm/.test(vt) && !/[가-힣]/.test(vt), vt);
    await ev(async () => { ERP.setLang('ko'); delete ERP.db.meta.prodDivs; await ERP.db.saveMeta(); ERP.db.setSetting('dash', null); ERP.state.dashEdit = false; ERP.render(); }); await settle();
  });

  await sec('7-4. 현장 재고 → 원재료 환산 (1.13.9, 사용자 "현장재고를 원재료로 환산했을때 원재료별로 얼마인지 조립재고 오른쪽에 표시"): 조립 재고 옆 표 · 공정별 · 엑셀 · 종합 현황 위젯', async () => {
    const keep = await ev(() => ({ items: ERP.db.rows('items').map(r => Object.assign({}, r)), bom_lines: ERP.db.rows('bom_lines').map(r => Object.assign({}, r)) }));
    // BOM: 조립 A-M1 = 배럴 I-M1 + 심 R-M1, 배럴 = 원료 RM-1 0.002 kg, 심 = 원료 RM-2 0.001 kg (나머지 현장 품목은 BOM 없음)
    await ev(async () => { const DB = ERP.db; DB.replace('items', DB.rows('items').concat([{ code: 'RM-2', name: 'WAX', stage: 'RM', unit: 'kg', src: 'test' }]));
      const b = (parent, child, qty) => ({ parent, child, qty, src: 'test' });
      DB.replace('bom_lines', [b('A-M1', 'I-M1', 1), b('A-M1', 'R-M1', 1), b('I-M1', 'RM-1', 0.002), b('R-M1', 'RM-2', 0.001)]); await DB.flush(); });
    await floor();
    const rv = (sel) => ev((s) => { const c = document.querySelector(s); if (!c) return null;
      return { title: c.querySelector('h2').textContent, head: Array.from(c.querySelectorAll('thead th')).map(t => t.innerText.replace(/\s+/g, ' ').trim()),
        rows: Array.from(c.querySelectorAll('tbody tr')).map(tr => Array.from(tr.children).map(td => td.innerText.replace(/\s+/g, ' ').trim())), help: (c.querySelector('p.help') || {}).textContent || '' }; }, sel);
    const exp = await ev(() => { const INV = ERP.inv; const par = new Set(ERP.db.rows('bom_lines').map(l => l.parent)); const fl = INV.rows().filter(s => INV.groupOf(s) === 'floor' && s.bal > 1e-6);
      return { miss: fl.filter(s => !par.has(s.code)).length, procs: ERP.PROC.filter(p => ['INJ', 'REF', 'ASM'].includes(p.id)).map(p => p.id), names: Object.fromEntries(ERP.PROC.map(p => [p.id, ERP.procName(p.id)])),
        bal: Object.fromEntries(fl.filter(s => ['A-M1', 'I-M1', 'R-M1'].includes(s.code)).map(s => [s.code, s.bal])) }; });
    eq('현장 재고 (A-M1 120 · 배럴 I-M1 525 · 심 R-M1 50)', exp.bal, { 'A-M1': 120, 'I-M1': 525, 'R-M1': 50 });
    const CELL = { 'RM-1': { INJ: '1.05', REF: '·', ASM: '0.24' }, 'RM-2': { INJ: '·', REF: '0.05', ASM: '0.12' }, '합계': { INJ: '1.05', REF: '0.05', ASM: '0.36' } };
    const r0 = await rv('main .fpiv .fraw-card');
    eq('조립 재고 표 바로 오른쪽 (다음) 에 원재료 환산 표', await ev(() => !!document.querySelector('main .fpiv .fpiv-card[data-id="asm"] + .fraw-card')), true);
    eq('원재료 환산: 원재료 · 합계 · 공정별 (kg, 많은 순) — 조립 = 배럴 · 심을 거쳐 원료까지', r0 && { title: r0.title, head: r0.head, rows: r0.rows },
      { title: '원재료 환산 (현장 재고)', head: ['원재료', '합계'].concat(exp.procs.map(p => exp.names[p])),
        rows: [['RM-1 RESIN', '1.29'].concat(exp.procs.map(p => CELL['RM-1'][p])), ['RM-2 WAX', '0.17'].concat(exp.procs.map(p => CELL['RM-2'][p])), ['합계', '1.46'].concat(exp.procs.map(p => CELL['합계'][p]))] });
    ok('설명: 단위 kg · BOM 으로 원료까지 · 환산 못 한 품목 (BOM 없음) 수', r0 && /kg/.test(r0.help) && r0.help.includes('BOM 없음 ' + exp.miss + '개'), r0 && r0.help);
    const xl = await ev(() => { let g = null; const keep = ERP.xl.exportAoa; ERP.xl.exportAoa = (n, hd, rs) => { g = { n, hd, rs }; }; try { document.querySelector('main .fraw-card button[data-act="xl"]').click(); } finally { ERP.xl.exportAoa = keep; } return g; });
    eq('엑셀: 원재료 · 이름 · 단위 · 합계 · 공정별', xl && [xl.hd, xl.rs[0]], [['원재료', '이름', '단위', '합계'].concat(exp.procs.map(p => exp.names[p])), ['RM-1', 'RESIN', 'kg', 1.29].concat(exp.procs.map(p => ({ INJ: 1.05, REF: 0, ASM: 0.24 })[p]))]);
    await ev(() => { ERP.db.setSetting('dash', [{ k: 'v17-fr', id: 'floor_raw', w: 2 }]); ERP.state.dashEdit = false; ERP.state.dashDate = null; ERP.goto('dashboard'); ERP.render(); }); await settle();
    const w = await rv('.wgrid .w[data-id=floor_raw]');
    eq('종합 현황 위젯 "원재료 환산" (+ 위젯 추가 에서) = 같은 표', w && [w.head, w.rows], r0 && [r0.head, r0.rows]);
    await ev(() => ERP.setLang('vi')); await floor();
    const vt = await ev(() => document.querySelector('main .fraw-card').innerText.replace(/\s+/g, ' '));
    ok('베트남어 · 한글 없음', /Nguyên liệu/.test(vt) && !/[가-힣]/.test(vt), vt);
    await ev(async (k) => { ERP.setLang('ko'); const DB = ERP.db; DB.replace('items', k.items); DB.replace('bom_lines', k.bom_lines); DB.setSetting('dash', null); await DB.flush(); }, keep); await settle();
  });

  await sec('7-5. MRP 진행 중 수주에서 가져오기 (1.13.9, 사용자 "한번에 전체클릭할수있는 버튼 엑셀처럼 … 진행 … 몇프로 … 진행안된거만 … 진행중인것도 포함할건지 선택"): 전체 선택 · 진행 상태 · 범위', async () => {
    const keep = await ev(() => ({ po: ERP.db.rows('po').map(r => Object.assign({}, r)), prod_log: ERP.db.rows('prod_log').map(r => Object.assign({}, r)), lines: ERP.db.setting('mrpLines', null) }));
    // P-1 포장 0 / 100 · P-2 포장 50 / 200 (25%) · P-3 포장 0 / 80 · P-4 다 포장 (목록에 없음)
    await ev(async () => { const DB = ERP.db; const po = (po_no, item_no, sets, due) => ({ po_no, item_no, sets, due, date: '2026-10-01', customer: 'TEST', kind: 'Mini' });
      DB.replace('po', [po('P-1', 'K-P1', 100, '2099-11-01'), po('P-2', 'K-P1', 200, '2099-11-05'), po('P-3', 'A-M1', 80, '2099-11-10'), po('P-4', 'A-M2', 10, '2099-11-12')]);
      const pk = (po_no, code, q) => ({ date: '2026-10-20', process: 'PCK', po_no, code, ok_qty: q, shift: 'D', source: 'test' });
      DB.replace('prod_log', [pk('P-2', 'K-P1', 50), pk('P-4', 'A-M2', 10)]); DB.setSetting('mrpLines', null); delete DB.meta.mrpPoScope; await DB.saveMeta(); await DB.flush(); });
    const open = async () => { await ev(() => { document.querySelectorAll('.modal-back').forEach(m => m.remove()); ERP.state.bomTab = 'mrp'; ERP.state.params = {}; ERP.goto('bom'); ERP.render(); }); await settle(); await A.click('main [data-act="import-po"]'); await A.waitForSelector('.modal [data-po]'); };
    const md = () => ev(() => { const m = document.querySelector('.modal'); const all = m.querySelector('[data-act="all"] input');
      return { all: all.indeterminate ? 'some' : all.checked, scope: Array.from(m.querySelectorAll('[data-scope]')).map(b => [b.dataset.scope, b.textContent.trim(), b.classList.contains('primary')]),
        rows: Array.from(m.querySelectorAll('[data-po]')).map(r => [r.dataset.po, r.querySelector('input').checked, (r.querySelector('.chip') || {}).textContent || '', ((r.querySelector('.poprog') || {}).textContent || '').trim()]),
        sum: (m.querySelector('[data-act="sum"]') || {}).textContent || '' }; });
    const clickIn = async (sel) => { await A.click('.modal ' + sel); await A.waitForTimeout(150); };
    await open();
    eq('처음: 전체 선택 (꺼짐) · 범위 = 진행 중 포함 · 줄마다 진행 상태 · 진행률 (포장 set ÷ 주문 set) · 다 포장한 P-4 없음', await md(),
      { all: false, scope: [['wait', '진행 전만 (2)', false], ['all', '진행 중 포함 (3)', true]], rows: [['P-1', false, '진행 전', '0% · 0/100'], ['P-2', false, '진행 중', '25% · 50/200'], ['P-3', false, '진행 전', '0% · 0/80']], sum: '고른 수주 0건' });
    await clickIn('[data-act="all"] input');
    eq('전체 선택 → 모두 (남은 set 100 + 150 + 80)', await md(), { all: true, scope: [['wait', '진행 전만 (2)', false], ['all', '진행 중 포함 (3)', true]], rows: [['P-1', true, '진행 전', '0% · 0/100'], ['P-2', true, '진행 중', '25% · 50/200'], ['P-3', true, '진행 전', '0% · 0/80']], sum: '고른 수주 3건 · 330 set' });
    await clickIn('[data-scope="wait"]');
    eq('범위를 진행 전만으로 → 진행 중 (P-2) 은 빠짐', [(await md()).all, (await md()).rows.map(r => r[1]), (await md()).sum], [true, [true, false, true], '고른 수주 2건 · 180 set']);
    await clickIn('[data-act="all"] input');
    eq('전체 선택을 끄면 모두 해제', [(await md()).all, (await md()).rows.map(r => r[1])], [false, [false, false, false]]);
    await clickIn('[data-po="P-2"] input');
    eq('하나만 고르면 전체 선택은 반쯤 (진행 중 P-2 도 직접 고를 수 있음)', [(await md()).all, (await md()).rows.map(r => r[1])], ['some', [false, true, false]]);
    await clickIn('[data-act="all"] input');
    eq('전체 선택 (진행 전만) → P-1 · P-3', [(await md()).all, (await md()).rows.map(r => r[1])], [true, [true, false, true]]);
    await A.click('.modal .modal-foot button.primary'); await settle();
    eq('선택 추가 → MRP 줄 (남은 set) · 범위 기억', [await ev(() => ERP.db.setting('mrpLines', []).map(l => [l.code, l.qty, l.unit, l.ref])), await ev(() => ERP.db.setting('mrpPoScope'))], [[['K-P1', 100, 'set', 'P-1'], ['A-M1', 80, 'set', 'P-3']], 'wait']);
    await open();
    eq('다시 열면 범위 = 진행 전만 (전체 선택은 꺼짐)', [(await md()).scope.map(s => s[2]), (await md()).all], [[true, false], false]);
    await ev(() => ERP.setLang('vi')); await open();
    const vt = await ev(() => { const m = document.querySelector('.modal'); return [m.querySelector('[data-act="all"]').innerText, Array.from(m.querySelectorAll('[data-scope]')).map(b => b.textContent).join(' '), m.querySelector('[data-po] .chip').textContent, m.querySelector('[data-act="sum"]').textContent].join(' | '); });
    ok('베트남어 · 한글 없음', !/[가-힣]/.test(vt), vt);
    await ev(async (k) => { document.querySelectorAll('.modal-back').forEach(m => m.remove()); ERP.setLang('ko'); const DB = ERP.db; DB.replace('po', k.po); DB.replace('prod_log', k.prod_log); DB.setSetting('mrpLines', k.lines); delete DB.meta.mrpPoScope; await DB.saveMeta(); await DB.flush(); ERP.render(); }, keep); await settle();
  });

  await sec('7-6. 박스 포장의 SG(마니라 세트)는 차감하지 않음 (1.13.9, ERP CODE 만들기 — 사용자 "SG · FG 로 넣기"): 포장 일보에는 박스 코드만 적힘', async () => {
    const keep = await ev(() => ({ items: ERP.db.rows('items').map(r => Object.assign({}, r)), bom_lines: ERP.db.rows('bom_lines').map(r => Object.assign({}, r)), prod_log: ERP.db.rows('prod_log').map(r => Object.assign({}, r)) }));
    // 박스 K-B1 (FG · CT) = SG K-S1 ×12 + 조립 A-M1 ×1 · 카톤 K-C1 (부자재 — 창고 입출고장에 완제품 번호로 적힌 카톤, 1.10.2) = K-S1 ×12 · 박스 K-P2 = SG K-P1 ×12 (K-P1 은 일보가 직접 만듦)
    await ev(async () => { const DB = ERP.db;
      DB.replace('items', DB.rows('items').concat([{ code: 'K-B1', name: 'PENCIL 12 BOX B', stage: 'FG', line: 'PEN', unit: 'CT', src: 'test' }, { code: 'K-C1', name: 'CARTON - PENCIL 12', stage: 'SM', unit: 'PCS', src: 'test' },
        { code: 'K-S1', name: 'PENCIL 12 MANILA B', stage: 'SG', line: 'PEN', unit: 'SET', src: 'test' }]));
      const b = (parent, child, qty) => ({ parent, child, qty, src: 'test' });
      DB.replace('bom_lines', [b('K-B1', 'K-S1', 12), b('K-B1', 'A-M1', 1), b('K-C1', 'K-S1', 12), b('K-P2', 'K-P1', 12)]);
      const pk = (code, sets, ct, ea) => ({ date: '2026-10-20', process: 'PCK', code, ok_qty: sets, ok_ct: ct, ok_ea: ea, unit: 'set', shift: 'D', source: 'test' });
      DB.replace('prod_log', [pk('K-B1', 120, 10, 1440), pk('K-C1', 240, 0, 2880), pk('K-P1', 30, 0, 360), pk('K-P2', 24, 2, 288)]); await DB.flush(); });
    const r = await ev(() => { const I = ERP.inv; const pp = I.prodPost(); const bal = (c) => { const s = I.rows().find(x => x.code === c); return s ? s.bal : 0; };
      const use = (c) => pp.rows.filter(t => t.kind === 'USE' && t.code === c).map(t => [t.parent, t.qty]);
      return { s1: [bal('K-S1'), use('K-S1')], p1: [bal('K-P1'), use('K-P1')], am1: use('A-M1'), prod: pp.rows.filter(t => t.kind === 'PROD').map(t => [t.code, t.qty]).sort(),
        pass: pp.diag.setPass ? Array.from(pp.diag.setPass.entries()) : 'none' }; });
    eq('일보가 만들지 않은 SG K-S1: 박스 (10 CT × 12) · 카톤 코드 (pcs × 12) 어느 쪽도 차감 안 함 → 0 그대로 (마이너스 아님)', r.s1, [0, []]);
    eq('일보가 직접 만든 SG K-P1 (30 set): 박스 K-P2 2 CT × 12 = 24 set 은 예전처럼 차감 → 7 + 2 + 30 − 24 = 15', r.p1, [15, [['K-P2', 24]]]);
    eq('박스 안의 다른 현장 부품 (조립 A-M1 ×1) 은 그대로 차감 (10 CT)', r.am1, [['K-B1', 10]]);
    eq('입고: 박스 K-B1 10 CT · K-P2 2 CT · SG K-P1 30 set (카톤 K-C1 은 원부자재라 입고 안 함)', r.prod, [['K-B1', 10], ['K-P1', 30], ['K-P2', 2]]);
    eq('진단 setPass: K-S1 일보 2줄 · 포장 120 + 240 = 360 set', r.pass, [['K-S1', { n: 2, qty: 360 }]]);
    await ev(() => ERP.goStock('post'));
    await A.waitForFunction(() => /생산일보 → 재고 자동 반영/.test(document.querySelector('main').innerText), null, { timeout: 15000 }).catch(() => {});
    const t = await ev(() => document.querySelector('main').textContent);   // 접힌 칸(details) 안의 표도 본다
    ok('생산 반영 탭: "박스 포장: 세트(SG) 대신 세트 안의 조립품을 뺌 (규칙)" (1.13.10 제목) · K-S1 · 360 set', /박스 포장: 세트\(SG\) 대신 세트 안의 조립품을 뺌 \(규칙\)/.test(t) && /K-S1/.test(t) && /360/.test(t), t.slice(0, 300));
    await ev(() => ERP.setLang('vi')); await ev(() => ERP.goStock('post')); await settle();
    ok('베트남어: 카드 제목 · 설명 · 표에 한글 없음', await ev(() => { const d = Array.from(document.querySelectorAll('main details')).find(x => /SG/.test(x.querySelector('summary').textContent) && /thùng/.test(x.textContent)); return !!d && !/[가-힣]/.test(d.textContent); }));
    await ev(async (k) => { ERP.setLang('ko'); const DB = ERP.db; DB.replace('items', k.items); DB.replace('bom_lines', k.bom_lines); DB.replace('prod_log', k.prod_log); await DB.flush(); ERP.render(); }, keep); await settle();
  });

  await sec('7-7. 포장한 만큼 조립 재고가 줄어듦 (1.13.10, 사용자 "포장한 만큼 조립 재고가 줄도록 고쳐줘"): 박스 → 세트(SG) → 조립품, 포장 set 만큼', async () => {
    const keep = await ev(() => ({ items: ERP.db.rows('items').map(r => Object.assign({}, r)), bom_lines: ERP.db.rows('bom_lines').map(r => Object.assign({}, r)), prod_log: ERP.db.rows('prod_log').map(r => Object.assign({}, r)) }));
    // 박스 K-B2 (FG · CT, CT당 set 없음) = SG K-S2 ×12 · 카톤 코드 K-C2 (부자재) = K-S2 ×12 · 박스 K-B3 = K-S2 ×6 + K-S3 ×6
    // 세트 K-S2 = 조립 A-M1 ×1 + A-M2 ×1 + 원료 RM-1 0.01 (원부자재 — 빼지 않음) · 세트 K-S3 = 조립 A-D1 ×1
    await ev(async () => { const DB = ERP.db;
      DB.replace('items', DB.rows('items').concat([{ code: 'K-B2', name: 'MINI 2CT BOX', stage: 'FG', line: 'MINI', unit: 'CT', src: 'test' }, { code: 'K-C2', name: 'CARTON - MINI 2CT', stage: 'SM', unit: 'PCS', src: 'test' },
        { code: 'K-B3', name: 'MIX BOX', stage: 'FG', line: 'MINI', unit: 'CT', src: 'test' }, { code: 'K-S2', name: 'MINI 2CT MANILA', stage: 'SG', line: 'MINI', unit: 'SET', src: 'test' }, { code: 'K-S3', name: 'DIAL 1CT MANILA', stage: 'SG', line: 'REG', unit: 'SET', src: 'test' }]));
      const b = (parent, child, qty) => ({ parent, child, qty, src: 'test' });
      DB.replace('bom_lines', [b('K-B2', 'K-S2', 12), b('K-C2', 'K-S2', 12), b('K-B3', 'K-S2', 6), b('K-B3', 'K-S3', 6), b('K-S2', 'A-M1', 1), b('K-S2', 'A-M2', 1), b('K-S2', 'RM-1', 0.01), b('K-S3', 'A-D1', 1)]);
      const pk = (date, code, sets, ct, ea) => ({ date, process: 'PCK', code, ok_qty: sets, ok_ct: ct, ok_ea: ea, unit: 'set', shift: 'D', source: 'test' });
      DB.replace('prod_log', [pk('2026-10-20', 'K-B2', 60, 0, 120), pk('2026-10-21', 'K-C2', 30, 0, 60), pk('2026-10-22', 'K-B3', 24, 0, 36), pk('2026-08-20', 'K-B2', 500, 0, 1000)]); await DB.flush(); });
    const r = await ev(() => { const I = ERP.inv; const pp = I.prodPost(); const bal = (c) => { const s = I.rows().find(x => x.code === c); return s ? s.bal : 0; };
      const use = (c) => pp.rows.filter(t => t.kind === 'USE' && t.code === c).map(t => [t.parent, t.via || '', t.qty]);
      return { m1: use('A-M1'), m2: use('A-M2'), d1: use('A-D1'), sg: [use('K-S2'), use('K-S3')], rm: use('RM-1'), bal: ['A-M1', 'A-M2', 'A-D1', 'K-S2'].map(bal),
        prod: pp.rows.filter(t => t.kind === 'PROD').map(t => t.code), nc: ['K-B2', 'K-B3'].map(c => pp.diag.noConv.has(c)), pass: Array.from(pp.diag.setPass.entries()).sort(),
        ms: pp.diag.matSkip.has('RM-1') }; });
    // 현장 실사 2026-08-31 뒤 줄만 (08-20 의 500 set 은 실사 수량에 이미 있음). K-B3 24 set = K-S2 12 + K-S3 12 (BOM 6 : 6)
    eq('A-M1: 박스 K-B2 60 (CT당 set 없어도) · 카톤 코드 K-C2 30 · 섞인 박스 K-B3 12 — 세트 K-S2 를 거쳐', r.m1, [['K-B2', 'K-S2', 60], ['K-C2', 'K-S2', 30], ['K-B3', 'K-S2', 12]]);
    eq('A-M2 도 같음 · A-D1 = K-B3 의 K-S3 12', [r.m2, r.d1], [[['K-B2', 'K-S2', 60], ['K-C2', 'K-S2', 30], ['K-B3', 'K-S2', 12]], [['K-B3', 'K-S3', 12]]]);
    eq('세트(SG) 자체 · 원료 (원부자재) 는 빼지 않음', [r.sg, r.rm, r.ms], [[[], []], [], true]);
    eq('현장 재고: A-M1 120 − 102 = 18 · A-M2 0 (3장에서 0 으로 맞춤) − 102 = −102 · A-D1 40 − 12 = 28 · K-S2 0', r.bal, [18, -102, 28, 0]);
    eq('박스 수를 모르는 박스 (CT당 set · 일보 CT 없음) 는 입고하지 않고 "CT · SET 환산 정보 없음" 그대로', [r.prod, r.nc], [[], [true, true]]);
    eq('진단 setPass: K-S2 60 + 30 + 12 = 102 set · K-S3 12 set', r.pass, [['K-S2', { n: 3, qty: 102 }], ['K-S3', { n: 1, qty: 12 }]]);
    await ev(() => ERP.goStock('post'));
    await A.waitForFunction(() => /생산일보 → 재고 자동 반영/.test(document.querySelector('main').innerText), null, { timeout: 15000 }).catch(() => {});
    const card = await ev(() => { const d = Array.from(document.querySelectorAll('main details')).find(x => /세트\(SG\)/.test(x.querySelector('summary').textContent)); if (!d) return null;
      return { title: d.querySelector('summary').innerText.replace(/\s+/g, ' ').trim(), head: Array.from(d.querySelectorAll('thead th')).map(t => t.textContent.trim()), rows: Array.from(d.querySelectorAll('tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())) }; });   // 접힌 칸이라 textContent
    eq('생산 반영 탭 카드: 세트 대신 세트 안 조립품을 뺌 · 줄마다 뺀 조립품 pcs (실사일 08-31 까지의 500 set 은 세지 않음)', card, { title: '2 박스 포장: 세트(SG) 대신 세트 안의 조립품을 뺌 (규칙)포장 일보에는 박스 코드만 적힘 — 세트는 거쳐 감', head: ['세트 (SG)', '품명', '일보 줄', '포장 set', '뺀 조립품 (pcs)'],
      rows: [['K-S2', 'MINI 2CT MANILA', '3', '102', '204'], ['K-S3', 'DIAL 1CT MANILA', '1', '12', '12']] });
    await ev(() => ERP.setLang('vi')); await ev(() => ERP.goStock('post')); await settle();
    ok('베트남어: 카드에 한글 없음', await ev(() => { const d = Array.from(document.querySelectorAll('main details')).find(x => /SG/.test(x.querySelector('summary').textContent) && /thùng/.test(x.textContent)); return !!d && !/[가-힣]/.test(d.textContent); }));
    await ev(async (k) => { ERP.setLang('ko'); const DB = ERP.db; DB.replace('items', k.items); DB.replace('bom_lines', k.bom_lines); DB.replace('prod_log', k.prod_log); await DB.flush(); ERP.render(); }, keep); await settle();
  });

  await sec('7-8. 수주서 그대로 올리기 (1.13.11, 사용자 "이런 형태로 수주를 받는다. 이파일 그대로 업로드해도 erp 수주등록에 반영할수있게"): 시트마다 PO · 품목 묶음 · 연도 칸 + 월일 · PO 번호 + 품번으로 갱신', async () => {
    const keep = await ev(() => ({ po: ERP.db.rows('po').map(r => Object.assign({}, r)), uploads: ERP.db.rows('uploads').map(r => Object.assign({}, r)) }));
    // 고객 수주서 (Binney & Smith 양식, 시트 하나 = PO 하나): 멕시코 품목 2 · 월마트 (PO 두 개) · 영국 (O/No. · 벌크 품목 · Vivid PO). 날짜 칸은 '월 일' 서식, 연도는 옆 칸 (G)
    const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));
    const dir = tmp('erp-v17-po-'); const f = path.join(dir, '10-21 (멕시코)(5100364176).xlsx'); const wb = XLSX.utils.book_new();
    const sh = (rows, dates) => { const ws = XLSX.utils.aoa_to_sheet(rows); dates.forEach(a => { ws[a].z = 'mm"월"\\ dd"일"'; }); return ws; };
    const top = (who) => ['수입자', who, null, null, '주문일자', null, 2026, 46316];   // 46316 = 2026-10-21
    XLSX.utils.book_append_sheet(wb, sh([top('Binney & Smith (멕시코'), [], ['P.O. # 5100364176'], [],
      ['BW3-12A', ':', '다이알 12색', null, 10368, 'set'], ['(52 0784)', null, '12 set x 2 번들 = 24 set/CT', null, 432, 'ct'], [null, null, 'Item No. ; 52-0784-M-008'], [],
      ['BW5-24A', ':', '펜슬 24색', null, 10032, 'set'], ['(68 7424)', null, '6 set x 4 번들 = 24 set/CT', null, 418, 'ct'], [null, null, 'Item No. 68-7424-M-010'], [],
      [null, null, 'TOTAL:', null, 20400, 'set'], [null, null, null, null, 850, 'cs'], [], [null, null, null, null, 124416, 'pcs'], [],
      ['수출지', '멕시코', null, null, '상검일', null, 2027, 46094]], ['H1', 'H18']), '364176');   // 상검일 칸의 숨은 연도 = 2026 (46094 = 2026-03-13), 연도 칸 = 2027
    XLSX.utils.book_append_sheet(wb, sh([top('Binney & Smith (미국)'), [], ['Walmart P.O. : 0936233857'], [], ['크레욜라 P.O. # : 4700024202'], [],
      ['BW5-30A', ':', '크레욜라 트위스터블 펜슬 30색', null, 7824, 'set'], [null, null, '24set/CT', null, 326, 'cs'], [], [null, null, 'Item No 68-7409-L-004'], [null, null, 'RFID 스티커 마니라안쪽에 붙여주세요'], [],
      ['수출지', 'Walmart', null, null, '상검일', null, 2026, 46367]], ['H1', 'H13']), '0936233857');   // 46367 = 2026-12-11
    XLSX.utils.book_append_sheet(wb, sh([top('Binney & Smith (영국)'), [], ['O/No. : 5100399999'], [],
      ['BW3-1', ':', '벌크 크레욜라 다이알 8색', null, 30720, 'pcs'], ['(99 9700B)', null, '960 pcs/CT'], [],
      ['BW4K-24A', ':', '크레욜라 미니 다이알/24색', null, 4008, 'set'], ['(52 9724)', null, '12 set/CT', null, 334, 'cs'], [null, null, 'Item No : 52-9724-A-000'], [null, null, 'Vivid PO No. : PUK2300529', null, 334, 'cs'], [],
      ['수출지', '영국 (Vivid Imagination)', null, null, '상검일자', null, 2026, 46367]], ['H1', 'H13']), '312921');
    XLSX.writeFile(wb, f);
    // 이미 있는 수주 줄: 5100364176-2 (생산관리 파일에서 — 카톤 850 은 TOTAL 박스 수가 잘못 들어간 값) · 다른 Binney&Smith 줄 (거래처 이름 맞춤)
    await ev(async () => { const DB = ERP.db;
      DB.replace('po', [{ date: '2026-10-20', customer: 'Binney&Smith', country: 'Mexico', po_no: '5100364176-2', item_no: '68-7424-M-010', kind: 'Pencil', color: '24', kind2: 'Rainbow', rfid: '0', sets: 10032, cs: 850, pcs: 240768, due: '2027-01-01', packed: 100, mark: '메모' },
        { date: '2026-09-01', customer: 'Binney&Smith', country: 'USA', po_no: '4700000001', item_no: '68-7409-L-002', kind: 'Pencil', color: '30', sets: 1000, pcs: 30000, due: '2026-11-01' }]);
      await DB.flush(); ERP.state.imp = { jobs: [] }; ERP.state.dataTab = 'import'; ERP.goto('data'); ERP.render(); });
    await settle();
    await A.setInputFiles('.drop input[type=file]', [f]); await A.waitForFunction(() => ERP.state.imp.jobs.length >= 3, null, { timeout: 60000 }); await settle();
    const jobs = await ev(() => ERP.state.imp.jobs.map(j => ({ sheet: j.sheet, id: j.id, table: j.table, label: j.label, keys: j.keys, include: j.include, note: j.note || '', rows: j.rows })));
    const K = ['po_no', 'po_no2', 'item_no'];
    eq('시트 3장 = 수주서 3건 (인식기 po-sheet · 수주 표 · PO 번호 + 품번 기준)', jobs.map(j => [j.sheet, j.id, j.table, j.label, j.keys, j.include]),
      [['364176', 'po-sheet', 'po', '수주서 PO 5100364176', K, true], ['0936233857', 'po-sheet', 'po', '수주서 PO 4700024202', K, true], ['312921', 'po-sheet', 'po', '수주서 PO 5100399999', K, true]]);
    eq('멕시코: 품목 2 → -1 · -2 · 수주일 2026-10-21 · 납기 = 연도 칸 2027 + 월일 03-13 · pcs = set × 색상수 (TOTAL pcs 수식은 첫 품목만) · 거래처 = 지금 ERP 표기 Binney&Smith', jobs[0].rows, [
      { date: '2026-10-21', customer: 'Binney&Smith', country: 'Mexico', po_no: '5100364176-1', item_no: '52-0784-M-008', kind: 'Dial', color: '12', sets: 10368, cs: 432, pcs: 124416, due: '2027-03-13' },
      { date: '2026-10-21', customer: 'Binney&Smith', country: 'Mexico', po_no: '5100364176-2', item_no: '68-7424-M-010', kind: 'Pencil', color: '24', sets: 10032, cs: 418, pcs: 240768, due: '2027-03-13' }]);
    eq('월마트: 크레욜라 P.O. → PO 번호 · Walmart P.O. → PO 번호2 · 시장 Walmart · 국가 = 수입자의 (미국)', jobs[1].rows, [
      { date: '2026-10-21', customer: 'Binney&Smith', country: 'USA', market: 'Walmart', po_no: '4700024202', po_no2: '0936233857', item_no: '68-7409-L-004', kind: 'Pencil', color: '30', sets: 7824, cs: 326, pcs: 234720, due: '2026-12-11' }]);
    eq('영국: O/No. · Vivid PO → PO 번호2 · 상검일자 · 벌크 (Item No. 없음 · pcs) 는 못 읽음 — 순번은 모든 품목 기준 (-2)', [jobs[2].rows, /못 읽은 품목 1개/.test(jobs[2].note) && /BW3-1 벌크 크레욜라 다이알 8색/.test(jobs[2].note)], [[
      { date: '2026-10-21', customer: 'Binney&Smith', country: 'UK', po_no: '5100399999-2', po_no2: 'PUK2300529', item_no: '52-9724-A-000', kind: 'Mini', color: '24', sets: 4008, cs: 334, pcs: 96192, due: '2026-12-11' }], true]);
    const pv = await ev(() => Array.from(document.querySelectorAll('main .imp-prev')).map(x => x.innerText.replace(/\s+/g, ' ').trim()));
    eq('미리보기: 추가 · 갱신 · 바뀌는 값 (5100364176-2 카톤 850 → 418 · 납기)', pv, ['추가 1 갱신 1 5100364176-2: 카톤(cs) 850 → 418 · 납기 2027-01-01 → 2027-03-13', '추가 1 갱신 0', '추가 1 갱신 0']);
    eq('반영 방식은 하나 (전체 교체 · 끝에 추가 없음)', await ev(() => Array.from(document.querySelector('main tbody tr select').options).map(o => o.value)), ['upsert']);
    await A.click('text=선택 항목 모두 반영'); await A.waitForTimeout(600);
    const res = await ev(() => Array.from(document.querySelectorAll('main .card table tbody tr')).map(tr => Array.from(tr.children).slice(0, 4).map(td => td.innerText.trim())));
    eq('반영 결과: 시트마다 추가 · 갱신', res, [['364176', '수주서 PO 5100364176', '1', '1'], ['0936233857', '수주서 PO 4700024202', '1', '0'], ['312921', '수주서 PO 5100399999', '1', '0']]);
    const po = await ev(() => ERP.db.rows('po').map(r => { const o = Object.assign({}, r); delete o._id; return o; }));
    eq('이미 있던 5100364176-2: 세트 · 카톤 · pcs · 납기만 바뀜 (수주일 · 구분2 · 포장수량 · 비고 · 품목군 그대로)', po.find(r => r.po_no === '5100364176-2'),
      { date: '2026-10-20', customer: 'Binney&Smith', country: 'Mexico', po_no: '5100364176-2', item_no: '68-7424-M-010', kind: 'Pencil', color: '24', kind2: 'Rainbow', rfid: '0', sets: 10032, cs: 418, pcs: 240768, due: '2027-03-13', packed: 100, mark: '메모' });
    eq('새 줄은 구분2 · RFID = 0 (지금 ERP 관례)', po.filter(r => ['5100364176-1', '4700024202', '5100399999-2'].includes(r.po_no)).map(r => [r.po_no, r.kind2, r.rfid]), [['5100364176-1', '0', '0'], ['4700024202', '0', '0'], ['5100399999-2', '0', '0']]);
    eq('업로드 이력: 수주 (마지막 업로드일)', await ev(() => ERP.db.rows('uploads').slice(-3).map(u => [u.kind, u.added, u.changed])), [['po', 1, 1], ['po', 1, 0], ['po', 1, 0]]);
    // 같은 파일을 다시 올려도 줄이 늘지 않음
    await ev(() => { ERP.state.imp = { jobs: [] }; ERP.render(); }); await settle();
    await A.setInputFiles('.drop input[type=file]', [f]); await A.waitForFunction(() => ERP.state.imp.jobs.length >= 3, null, { timeout: 60000 }); await settle();
    await A.click('text=선택 항목 모두 반영'); await A.waitForTimeout(600);
    eq('다시 올림: 추가 0 · 수주 줄 수 그대로 (5)', [await ev(() => Array.from(document.querySelectorAll('main .card table tbody tr')).map(tr => tr.children[2].innerText.trim()).join(',')), await ev(() => ERP.db.rows('po').length)], ['0,0,0', 5]);
    // 생산관리 파일 (Po No · kind goods 표): PO 번호가 있는 줄은 PO 번호 + 품번으로 같은 줄 (수주서로 먼저 넣은 줄과 구분2 가 달라도), PO 번호 없는 줄은 예전처럼
    const f2 = path.join(dir, 'Ho so quan ly san xuat 2026.xlsx'); const wb2 = XLSX.utils.book_new();
    const H = ['Date', 'Condition', 'Customer', 'Country', 'Market', 'Po No', 'Po No 2', 'Item No', 'Manila No', 'kind goods', 'color', 'RFID', 'kind 2', 'color 2', 'Pcs', 'Set', 'Cs', 'Due', 'Rate', 'Packed', 'Diff', 'Y/N', 'Mark'];
    XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([H, ['2026-10-21', '', 'Binney&Smith', 'Mexico', '', '5100364176-1', '', '52-0784-M-008', '0', 'Dial', '12', '0', 'Rainbow', '', 124416, 10368, 432, '2027-03-13', '', 500, 0, '', ''],
      ['2026-11-01', '', '', '', '', '', '', '', '', 'Dial', '', '', '', '', 0, 0, 0, '2026-11-01', '', 0, 0, '', '']]), 'PO');
    XLSX.writeFile(wb2, f2);
    await ev(() => { ERP.state.imp = { jobs: [] }; ERP.render(); }); await settle();
    await A.setInputFiles('.drop input[type=file]', [f2]); await A.waitForFunction(() => ERP.state.imp.jobs.length >= 1, null, { timeout: 60000 }); await settle();
    eq('생산관리 파일: PO 번호 있는 줄 · 없는 줄 따로 (기준 칸이 다름)', await ev(() => ERP.state.imp.jobs.map(j => [j.label, j.rows.length, j.keys || null])), [['수주 (PO) 목록', 1, K], ['수주 (PO) 목록 — PO 번호 없는 줄', 1, null]]);
    await A.click('text=선택 항목 모두 반영'); await A.waitForTimeout(600);
    const p2 = await ev(() => ERP.db.rows('po').filter(r => r.po_no === '5100364176-1').map(r => [r.kind2, r.packed]));
    eq('수주서로 넣은 5100364176-1 이 갱신됨 (두 줄이 되지 않음) · 구분2 · 포장수량 = 생산관리 파일 값 · PO 없는 줄은 새로', [p2, await ev(() => ERP.db.rows('po').length)], [[['Rainbow', 500]], 6]);
    await ev(() => ERP.setLang('vi')); await ev(() => { ERP.state.imp = { jobs: [] }; ERP.render(); }); await settle();
    await A.setInputFiles('.drop input[type=file]', [f]); await A.waitForFunction(() => ERP.state.imp.jobs.length >= 3, null, { timeout: 60000 }); await settle();
    const vt = await ev(() => Array.from(document.querySelectorAll('main tbody tr')).map(tr => tr.children[2].innerText).join(' | '));
    ok('베트남어: 수주서 이름 · 알림 · 미리보기에 한글 없음 (파일 글자 제외)', !/[가-힣]/.test(vt.replace(/BW3-1[^|]*|크레욜라|다이알|벌크/g, '')), vt.slice(0, 400));
    await ev(async (k) => { ERP.setLang('ko'); const DB = ERP.db; DB.replace('po', k.po); DB.replace('uploads', k.uploads); await DB.flush(); ERP.state.imp = { jobs: [] }; ERP.render(); }, keep); await settle();
  });

  await sec('8. 이번 달 포장 누계 = pcs (1.12.3, 사용자 "pcs로 표시해줘 세트가 아니고") · pcs 없는 일보 알림 · 휴대폰 요약도 같음', async () => {
    await ev(async () => { const DB = ERP.db; const pk = (date, set, ea) => ({ date, process: 'PCK', shift: 'D', ok_qty: set, ok_ea: ea, unit: 'set', source: 'test' });
      DB.replace('prod_log', [pk('2026-10-05', 100, 1200), pk('2026-10-10', 50, 600), pk('2026-10-12', 30, 0), pk('2026-09-05', 200, 2400), pk('2026-09-11', 10, 120), pk('2026-09-20', 999, 9999)]);
      await DB.flush(); ERP.db.setSetting('dash', [{ k: 'v17-pm', id: 'kpi_pck_month', w: 1 }, { k: 'v17-pd', id: 'kpi_pck_day', w: 1 }]); ERP.state.dashEdit = false; ERP.state.dashDate = null; ERP.goto('dashboard'); ERP.render(); });
    await settle();
    const k = await ev(() => { const e = document.querySelector('.wgrid .w[data-id=kpi_pck_month]'); return e ? { label: e.querySelector('.kpi-label').textContent, v: e.querySelector('.kpi-val .v').textContent, u: e.querySelector('.kpi-val .u').textContent, chip: e.querySelector('.kpi-note .chip').textContent, note: e.querySelector('.kpi-note span:last-child').textContent } : null; });
    // 기준일 10-12 → 이번 달 10-01 ~ 10-12: pcs 1,200 + 600 (10-12 의 30 세트는 pcs 0 이라 빠짐), 전월 동기 09-01 ~ 09-12: 2,400 + 120 = 2,520 → ▼ 29%
    eq('이번 달 포장 누계 = 1,800 pcs (세트 아님) · ▼ 29% (전월 동기 2,520 pcs) · pcs 없는 일보 1줄 (30세트) 빠짐', k, { label: '이번 달 포장 누계', v: '1,800', u: 'pcs', chip: '▼ 29%', note: '전월 동기 대비 · pcs 없는 일보 1줄 (30세트) 빠짐' });
    eq('휴대폰 요약도 같은 pcs (세트는 예전 칸에 그대로, 1.12.4 지난달 9월 전체 12,519 pcs)', await ev(() => ERP.mobileSummary().kpi.pckMonth), { ok: 180, prev: 210, ea: 1800, prevEa: 2520, noN: 1, noSets: 30, lastEa: 12519, lastM: 9 });
    eq('기준일 포장 실적(세트)은 그대로', await ev(() => { const e = document.querySelector('.wgrid .w[data-id=kpi_pck_day]'); return [e.querySelector('.kpi-val .v').textContent, e.querySelector('.kpi-val .u').textContent]; }), ['30', '세트']);
    await ev(async () => { ERP.db.replace('prod_log', []); await ERP.db.flush(); });
  });

  await sec('9. 숫자 카드의 남는 아래쪽에 지난달 값 (1.12.4) — 포장 누계 · 신규 수주 · 수주량, 같은 카드 안', async () => {
    await ev(async () => { const DB = ERP.db; const pk = (date, set, ea) => ({ date, process: 'PCK', shift: 'D', ok_qty: set, ok_ea: ea, unit: 'set', source: 'test' });
      DB.replace('prod_log', [pk('2026-10-05', 100, 1200), pk('2026-10-10', 50, 600), pk('2026-10-12', 30, 0), pk('2026-09-05', 200, 2400), pk('2026-09-11', 10, 120), pk('2026-09-20', 999, 9999), pk('2026-09-28', 5, 0)]);
      const po = (po_no, date, due, pcs) => ({ po_no, item_no: 'T-P1', customer: 'TEST', kind: 'Pencil', sets: pcs / 12, pcs, date, due });
      DB.replace('po', [po('PO-A', '2026-10-03', '2026-10-20', 1000), po('PO-B', '2026-10-08', '2026-11-05', 500), po('PO-C', '2026-09-02', '2026-09-15', 700), po('PO-C', '2026-09-02', '2026-09-25', 300), po('PO-D', '2026-09-20', '2026-10-25', 200)]);
      await DB.flush();
      ERP.db.setSetting('dash', [{ k: 'a', id: 'kpi_pck_month', w: 1 }, { k: 'b', id: 'kpi_new_po', w: 1 }, { k: 'c', id: 'kpi_orders_month', w: 1 }, { k: 'd', id: 'kpi_low', w: 1 }]);
      ERP.state.dashEdit = false; ERP.state.dashDate = null; ERP.goto('dashboard'); ERP.render(); });
    await settle();
    const k = await ev(() => ['kpi_pck_month', 'kpi_new_po', 'kpi_orders_month'].map(id => { const w = document.querySelector('.wgrid .w[data-id=' + id + ']'); const card = w.querySelector('.card.kpi'); const p = card.querySelector(':scope > .kpi-prev');
      return { id, v: card.querySelector('.kpi-val .v').textContent, chip: (card.querySelector('.kpi-note .chip') || {}).textContent || '', prev: p ? [p.querySelector('.kpi-prev-l').textContent, p.querySelector('b').textContent, (p.querySelector('.u') || {}).textContent || '', (p.querySelector('.x') || {}).textContent || ''] : null,
        bottom: p ? Math.round(card.getBoundingClientRect().bottom - p.getBoundingClientRect().bottom) : null }; }));
    eq('카드 아래 지난달 (9월): 포장 누계 12,519 pcs (9월 전체, pcs 없는 1줄 빠짐) · 신규 수주 1,200 pcs 2건 · 수주량(Checking) 1,000 pcs', k.map(x => [x.id, x.v, x.chip, x.prev]), [
      ['kpi_pck_month', '1,800', '▼ 29%', ['지난달 (9월) 누계', '12,519', 'pcs', '(pcs 없는 1줄 빠짐)']],
      ['kpi_new_po', '1,500', '2건', ['지난달 (9월)', '1,200', 'pcs', '2건']],
      ['kpi_orders_month', '1,200', '▲ 20% 전월 대비', ['지난달 (9월)', '1,000', 'pcs', '']]]);
    ok('따로 칸이 아니라 같은 카드 안 맨 아래 (카드 아래 여백만 남음) · 위젯 수 그대로 4', k.every(x => x.bottom !== null && x.bottom >= 0 && x.bottom < 30) && (await ev(() => document.querySelectorAll('.wgrid > .w').length)) === 4, k.map(x => x.bottom));
    eq('휴대폰 요약: 지난달 포장 누계 12,519 pcs (9월)', await ev(() => { const p = ERP.mobileSummary().kpi.pckMonth; return [p.lastEa, p.lastM]; }), [12519, 9]);
    await ev(() => ERP.setLang('vi')); await ev(() => ERP.render()); await settle();
    eq('베트남어: Tháng trước (T9)', await ev(() => Array.from(document.querySelectorAll('.wgrid .kpi-prev-l')).map(x => x.textContent)), ['Tháng trước (T9) lũy kế', 'Tháng trước (T9)', 'Tháng trước (T9)']);
    await ev(() => ERP.setLang('ko'));
    await ev(async () => { ERP.db.replace('prod_log', []); ERP.db.replace('po', []); ERP.db.setSetting('dash', null); await ERP.db.flush(); });
  });

  await sec('10. 기본 배치 = 사용자 배치 (1.12.5): 포장 누계 · 신규 수주 · 수주량 · 조립 재고 한 줄 → 월별 수주량 · 공정별 실적 · 월별 조립', async () => {
    await ev(() => { ERP.db.setSetting('dash', null); ERP.state.dashEdit = false; ERP.state.dashDate = null; ERP.goto('dashboard'); ERP.render(); }); await settle();
    const d = await ev(() => Array.from(document.querySelectorAll('.wgrid > .w')).map(w => [w.dataset.id + ':' + w.dataset.w, Math.round(w.getBoundingClientRect().top)]));
    eq('기본 배치 순서 · 가로 (사용자가 보낸 화면 순서)', d.map(x => x[0]), ['kpi_pck_month:1', 'kpi_new_po:1', 'kpi_orders_month:1', 'floor_stock:1', 'po_monthly:4', 'procs:4', 'asm_monthly:4']);
    ok('첫 줄에 포장 누계 · 신규 수주 · 수주량 · 조립 재고 (1480px), 그 아래 큰 위젯', d.slice(0, 4).every(x => x[1] === d[0][1]) && d[4][1] > d[0][1], d);
    eq('안전재고 미달 · 기준일 포장 · 납기 · 일별 조립 위젯은 기본 배치에 없음', await ev(() => ERP.dashDefault().filter(x => ['kpi_low', 'kpi_pck_day', 'kpi_due', 'asm_daily'].includes(x.id)).length), 0);
    eq('위젯 설정: 조립 재고 = 조립 · 월별 수주량 · 월별 조립 = 차트 (사용자 설정 그대로)', await ev(() => ERP.dashDefault().filter(x => x.o).map(x => [x.id, x.o])),
      [['floor_stock', { proc: 'ASM', rows: 'div', cols: 'none' }], ['po_monthly', { view: 'chart' }], ['asm_monthly', { proc: 'ASM', view: 'chart' }]]);
    ok('지난달 값 (1.12.4) 은 그대로: 포장 누계 · 신규 수주 · 수주량 카드 아래', await ev(() => ['kpi_pck_month', 'kpi_new_po', 'kpi_orders_month'].every(id => !!document.querySelector('.wgrid .w[data-id=' + id + '] .kpi-prev'))));
  });

  await sec('11. 베트남어 · 휴대폰 폭 · 오류 없음', async () => {
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
