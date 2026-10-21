'use strict';
/* 12차(v1.7.0 · 1.7.1) 자동 시험: 메뉴 3개 (품목 / 현장 재고 / 원부자재 재고) · ECOUNT 비교 없앰 · 이름 미정 코드는 코드만 · 사용자가 정한 단계 이름
   1 왼쪽 메뉴 · 탭 · 배지 · 2 예전 방식(ERP.state.matTab) · ERP.goStock · ERP.openStock · 3 수불 입력 / 수불 내역은 메뉴마다 자기 품목만 ·
   4 이름 미정(짐작한 이름 없음) → 코드만 · 5 코드 사전에서 이름 넣기 / 지우기 · 6 ECOUNT 비교 없음 · 7 종합 현황 · AI 비서 · 자료 올리기 결과 버튼 →
   맞는 메뉴 · 8 모든 탭 (한국어 / Tiếng Việt) 오류 없음
   사용:  npm run test:v12   (Playwright 필요: npm i -D playwright 또는 playwright-core + 설치된 Chrome/Edge) */
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

(async () => {
  const dataDir = tmp('erp-v12-');
  const S = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir, host: '127.0.0.1', port: 5900 + Math.floor(Math.random() * 300), backupDelay: 3600000 });
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 } });
  const A = await ctx.newPage(); A.on('pageerror', e => errors.push('pageerror: ' + e.message));
  A.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Failed to fetch/.test(m.text())) errors.push('console: ' + m.text()); });
  const ready = () => A.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 180000 });
  const ev = (fn, arg) => A.evaluate(fn, arg);
  const settle = () => A.waitForTimeout(250);
  await A.goto(S.url + '/#/dashboard'); await ready();

  // 빈 상태에서 시험용 품목만: 원부자재 3 (RM · SM · CM) + 현장 7 (심 · 배럴 · WIP11 · WIP21 · 조립 · WIP55 · 마니라)
  await ev(async () => {
    const DB = ERP.db; await DB.wipe(); const t = ERP.fmt.today();
    const it = (code, erp, name, unit, safety) => Object.assign({ code, erp_code: erp, name, unit: unit || 'PCS', src: 'ecount' }, safety ? { safety } : {});
    DB.replace('items', [
      it('WAX1', 'RM-WAX-WAX1', 'PARAFFIN WAX', 'kg', 100), it('CASE1', 'SM-PCASE-MINI-CASE1', 'PLASTIC CASE'), it('LB1', 'CM-LB-LB1', 'LABEL'),
      it('RM102', 'WIP00-MINI-CRA-RM102', 'RED'), it('BM02', 'WIP01-MINI-BRR-BM02', 'RED', 'PCS', 10), it('AB102', 'WIP11-MINI-HF-AB102', 'RED'), it('AC105', 'WIP21-MINI-HF-AC105', 'RED ORANGE'),
      it('BM01002', 'WIP-MINI-CRA-BM01002', 'RED'), it('CP1', 'WIP55-CPC-ASSY-CP1', 'CLICK'), it('SG1', 'SG-MINI-SUP-SG1', 'MINI SET')].map(r => ERP.inv.classify(r)));
    // WAX1 50 kg (안전재고 100 → 미달), BM02 −5 (안전재고 10 → 마이너스)
    DB.replace('stock_tx', [{ date: t, kind: 'IN', to_scope: 'WH', code: 'WAX1', qty: 50, src: 'manual', doc_no: 'IN-T1' }, { date: t, kind: 'ADJ', to_scope: 'FAC', code: 'BM02', qty: -5, src: 'manual', doc_no: 'AD-T1' }]);
    await DB.flush();
  });
  await A.reload(); await ready();

  // ------------------------------------------------------------------------------------------
  await sec('1. 왼쪽 메뉴 3개 · 탭 · 배지', async () => {
    const nav = await ev(() => Array.from(document.querySelectorAll('nav.side .nav a')).map(a => [a.getAttribute('href'), a.querySelector('span').textContent, (a.querySelector('em') || {}).textContent || '']));
    const names = nav.map(x => x[1]);
    const i = names.indexOf('품목');
    eq('메뉴 순서: 생산 관리 다음에 품목 → 현장 재고 → 원부자재 재고', names.slice(i - 1, i + 3), ['생산 관리', '품목', '현장 재고', '원부자재 재고']);
    eq('메뉴 주소', nav.slice(i, i + 3).map(x => x[0]), ['#/items', '#/floor', '#/materials']);
    ok('예전 메뉴 이름(품목 · 재고) 없음', !names.some(x => /품목\s*·\s*재고/.test(x)), names);
    eq('배지: 품목 없음 · 현장 재고 1 (BM02 마이너스) · 원부자재 재고 1 (WAX1 미달)', nav.slice(i, i + 3).map(x => x[2]), ['', '1', '1']);
    const want = { items: ['품목 마스터', '코드 사전', '자료 점검', '예시 자료'], floor: ['현장 재고', '생산 반영', '수불 입력', '수불 내역'], materials: ['원부자재 재고', '수불 입력', '수불 내역', '발주 · 안전재고', '외주 입출고'] };
    const title = { items: '품목', floor: '현장 재고', materials: '원부자재 재고' };
    for (const id of Object.keys(want)) {
      await A.click('nav.side a[href="#/' + id + '"]'); await settle();
      const r = await ev(() => ({ h1: document.querySelector('main h1').textContent, tabs: Array.from(document.querySelectorAll('main .tabs .tab')).map(b => b.textContent.replace(/ · \d+$/, '')), on: (document.querySelector('nav.side a.on span') || {}).textContent }));
      eq('[' + title[id] + '] 제목 · 탭', [r.h1, r.tabs, r.on], [title[id], want[id], title[id]]);
      ok('[' + title[id] + '] ECOUNT 비교 탭 없음', !r.tabs.some(t => /비교/.test(t)), r.tabs);
    }
    const txt = await ev(() => document.querySelector('main').innerText);
    ok('원부자재 재고 안내: 생산 반영으로 차감하지 않음 · 소모품(CM) (1.7.1 사용자 확인)', /차감하지 않습니다/.test(txt) && /소모품\(CM\)/.test(txt), txt.slice(0, 300));
  });

  // ------------------------------------------------------------------------------------------
  await sec('2. 예전 방식(matTab) · ERP.goStock · ERP.openStock → 맞는 메뉴', async () => {
    const at = () => ev(() => ({ hash: location.hash, item: ERP.state.itemTab, floor: ERP.state.floorTab, mat: ERP.state.mtab, req: ERP.state.matTab || null, h1: document.querySelector('main h1').textContent }));
    const legacy = async (tab, extra) => { await ev((a) => { if (a[1]) Object.assign(ERP.state, a[1]); ERP.state.matTab = a[0]; ERP.goto('materials'); ERP.render(); }, [tab, extra || null]); await settle(); return at(); };
    let r = await legacy('compare'); eq("matTab 'compare' (없앤 탭) → 원부자재 재고", [r.hash, r.mat, r.req, r.h1], ['#/materials', 'mat', null, '원부자재 재고']);
    r = await legacy('post'); eq("matTab 'post' → 현장 재고 · 생산 반영", [r.hash, r.floor, r.h1], ['#/floor', 'post', '현장 재고']);
    r = await legacy('codes'); eq("matTab 'codes' → 품목 · 코드 사전", [r.hash, r.item, r.h1], ['#/items', 'codes', '품목']);
    r = await legacy('stock', { stk: { stage: 'WIP01' } }); const f = await ev(() => ERP.state.stk_floor.stage);
    eq("matTab 'stock' + 배럴 단계 → 현장 재고 (WIP01 필터)", [r.hash, r.floor, f], ['#/floor', 'floor', 'WIP01']);
    await ev(() => { ERP.goto('dashboard'); ERP.render(); }); await settle();
    await ev(() => ERP.goStock('fledger')); await settle(); r = await at(); eq("goStock('fledger') → 현장 재고 · 수불 내역", [r.hash, r.floor], ['#/floor', 'fledger']);
    await ev(() => ERP.goStock('reorder')); await settle(); r = await at(); eq("goStock('reorder') → 원부자재 재고 · 발주", [r.hash, r.mat], ['#/materials', 'reorder']);
    await ev(() => ERP.goStock('master')); await settle(); r = await at(); eq("goStock('master') → 품목 · 품목 마스터", [r.hash, r.item], ['#/items', 'master']);
    await ev(() => ERP.openStock('RM')); await settle(); r = await at(); eq("openStock('RM') → 원부자재 재고 (RM 필터)", [r.hash, r.mat, await ev(() => ERP.state.stk_mat.stage)], ['#/materials', 'mat', 'RM']);
    await ev(() => ERP.openStock('WIP11')); await settle(); r = await at(); eq("openStock('WIP11') → 현장 재고 (WIP11 필터)", [r.hash, r.floor, await ev(() => ERP.state.stk_floor.stage)], ['#/floor', 'floor', 'WIP11']);
    await ev(() => { ERP.state.floorTab = 'post'; }); await A.click('nav.side a[href="#/items"]'); await settle(); await A.click('nav.side a[href="#/floor"]'); await settle();
    r = await at(); eq('메뉴마다 고른 탭 기억 (현장 재고 → 생산 반영)', [r.hash, r.floor], ['#/floor', 'post']);
  });

  // ------------------------------------------------------------------------------------------
  await sec('3. 수불 입력 · 수불 내역은 메뉴마다 자기 품목만', async () => {
    const today = await ev(() => ERP.fmt.today());
    await ev((t) => { ERP.state.txe_floor = { rows: [{ date: t, kind: 'ADJ', to: 'FAC', code: 'WAX1', qty: 1 }, { date: t, kind: 'ADJ', to: 'FAC', code: 'BM02', qty: 2 }] }; ERP.goStock('fentry'); ERP.render(); }, today); await settle();
    let r = await ev(() => ({ body: document.querySelector('main table.entry tbody').innerText, btn: document.querySelector('main button.btn.primary').textContent, dl: Array.from(document.querySelectorAll('#dl_tx_items_floor option')).map(o => o.value) }));
    ok('현장 재고 수불 입력: 원부자재 품목(WAX1)은 막음 — "원부자재 재고 메뉴에서 입력"', /원부자재 재고 메뉴에서 입력/.test(r.body), r.body.slice(0, 300));
    ok('저장 버튼 = 맞는 줄만 (1)', /\(1\)/.test(r.btn), r.btn);
    ok('품목 목록(datalist) = 현장 품목만', r.dl.includes('BM02') && r.dl.includes('SG1') && !r.dl.includes('WAX1') && !r.dl.includes('CASE1'), r.dl);
    await A.click('main button.btn.primary'); await A.waitForTimeout(400);
    r = await ev(() => ({ saved: ERP.db.rows('stock_tx').filter(t => t.code === 'BM02' && t.qty === 2).length, wax: ERP.db.rows('stock_tx').filter(t => t.code === 'WAX1' && t.qty === 1).length, left: ERP.state.txe_floor.rows.filter(x => x.code).map(x => x.code) }));
    eq('현장 품목 줄만 저장, 원부자재 줄은 입력표에 남음', [r.saved, r.wax, r.left], [1, 0, ['WAX1']]);
    await ev((t) => { ERP.state.txe = { rows: [{ date: t, kind: 'IN', to: 'WH', code: 'BM02', qty: 1 }, { date: t, kind: 'IN', to: 'WH', code: 'CASE1', qty: 4 }] }; ERP.goStock('entry'); ERP.render(); }, today); await settle();
    r = await ev(() => ({ body: document.querySelector('main table.entry tbody').innerText, btn: document.querySelector('main button.btn.primary').textContent, dl: Array.from(document.querySelectorAll('#dl_tx_items_mat option')).map(o => o.value) }));
    ok('원부자재 수불 입력: 현장 품목(BM02)은 막음 — "현장 재고 메뉴에서 입력"', /현장 재고 메뉴에서 입력/.test(r.body) && /\(1\)/.test(r.btn), [r.body.slice(0, 300), r.btn]);
    ok('품목 목록(datalist) = 원부자재만', r.dl.includes('WAX1') && r.dl.includes('LB1') && !r.dl.includes('BM02'), r.dl);
    await ev(() => { ERP.state.txl = null; ERP.goStock('ledger'); ERP.render(); }); await settle();
    const lm = await ev(() => document.querySelector('main').innerText);
    await ev(() => { ERP.state.txl_floor = null; ERP.goStock('fledger'); ERP.render(); }); await settle();
    const lf = await ev(() => document.querySelector('main').innerText);
    ok('원부자재 수불 내역 = WAX1 만', /WAX1/.test(lm) && !/BM02/.test(lm), lm.slice(0, 400));
    ok('현장 재고 수불 내역 = BM02 만', /BM02/.test(lf) && !/WAX1/.test(lf), lf.slice(0, 400));
  });

  // ------------------------------------------------------------------------------------------
  await sec('4. 단계 이름: 사용자가 정한 이름 (1.7.1) · 이름 미정 코드는 코드만 (짐작한 이름 · 물음표 없음)', async () => {
    const r = await ev(() => { const I = ERP.inv; const lab = () => ({ wip11: I.label('stage', 'WIP11'), x6: I.label('stage', 'WIPx6'), x5: I.label('stage', 'WIPx5'), x1: I.label('stage', 'WIPx1'), w55: I.label('stage', 'WIP55'), cm: I.label('stage', 'CM'), w01: I.label('stage', 'WIP01'), rm: I.label('stage', 'RM'), lb: I.label('cat', 'LB', 'CM'), gra: I.label('line', 'GRA'), neon: I.label('sub', 'NEON'), sup: I.label('sub', 'SUP') });
      const ko = lab(); ERP.lang = 'vi'; const vi = lab(); ERP.lang = 'ko';
      return { ko, vi, title: ['WIP11', 'WIPx1', 'WIPx6', 'CM', 'WIP01'].map(c => I.stageTitle(c)), blank: I.BUILTIN_DICT.filter(x => x.guessed && (x.ko || x.vi)).map(x => x.level + ':' + x.code), nGuessed: I.BUILTIN_DICT.filter(x => x.guessed).length, gStage: I.BUILTIN_DICT.filter(x => x.guessed && x.level === 'stage').map(x => x.code) }; });
    // 2026-10-21 사용자 확인: CM = 소모품, WIP06·x6 · WIP15·25·35 · WIP11 · WIP21·31… · WIP55 = 부품 (베트남어 Vật tư tiêu hao · Linh kiện)
    eq('사용자가 정한 단계 이름 (WIP11 · WIP06·x6 · WIP15·25·35 · WIP21·31… · WIP55 = 부품, CM = 소모품)', [r.ko.wip11, r.ko.x6, r.ko.x5, r.ko.x1, r.ko.w55, r.ko.cm], ['부품', '부품', '부품', '부품', '부품', '소모품']);
    eq('베트남어 이름 (Linh kiện · Vật tư tiêu hao)', [r.vi.wip11, r.vi.x1, r.vi.cm], ['Linh kiện', 'Linh kiện', 'Vật tư tiêu hao']);
    eq('목록 · 필터용 이름 · 코드 (같은 이름 "부품" 을 코드로 구분)', r.title, ['부품 · WIP11', '부품 · WIP21·31…', '부품 · WIP06·x6', '소모품 · CM', '배럴 · WIP01']);
    eq('확인된 이름은 그대로 (WIP01 배럴 · RM 원재료 · SUP 스매쉬업)', [r.ko.w01, r.ko.rm, r.ko.sup], ['배럴', '원재료', '스매쉬업']);
    eq('이름 미정 분류 · 제품군 · 세부는 코드만 (CM-LB · GRA · NEON)', [r.ko.lb, r.ko.gra, r.ko.neon], ['LB', 'GRA', 'NEON']);
    ok('내장 사전에 짐작한 이름 없음 (이름 미정 ' + r.nGuessed + '개 모두 빈칸 · 이름 미정 단계 없음)', r.nGuessed === 34 && !r.blank.length && !r.gStage.length, r);
    await ev(() => { ERP.state.stk_floor = null; ERP.goStock('floor'); ERP.render(); }); await settle();
    const cardsOf = () => ev(() => Array.from(document.querySelectorAll('main .flow .st')).map(b => ({ t: b.innerText.replace(/\s+/g, ' '), code: !!b.querySelector('code'), tip: b.getAttribute('title') || '' })));
    let cards = await cardsOf();
    ok('현장 재고 흐름 카드에 물음표 없음', cards.length === 13 && !cards.some(c => /\?/.test(c.t)), cards.map(c => c.t));
    ok('모든 카드 = 이름 + 코드 줄 (부품 / WIP11, 부품 / WIP21·31…, 배럴 / WIP01)', cards.every(c => c.code) && cards.some(c => /^부품 WIP11/.test(c.t)) && cards.some(c => /^부품 WIP21·31…/.test(c.t)) && cards.some(c => /^배럴 WIP01/.test(c.t)), cards.map(c => c.t));
    // 이름을 지운 단계 (코드 사전에서 이름을 모두 지우면 이름 미정) → 코드만 · 코드 줄 없음 · 안내 말풍선
    await ev(() => { ERP.db.add('code_dict', { level: 'stage', code: 'WIP55', ko: '', vi: '', guessed: true }); ERP.render(); }); await settle();
    cards = await cardsOf();
    eq('이름 미정 단계 카드 = 코드만 (코드 줄 없음 · 안내 말풍선)', cards.filter(c => /이름 없음/.test(c.tip)).map(c => [c.t.split(' ')[0], c.code]), [['WIP55', false]]);
    await ev(() => { const DB = ERP.db; DB.remove('code_dict', DB.rows('code_dict').filter(x => x.level === 'stage' && x.code === 'WIP55').map(x => x._id)); ERP.render(); }); await settle();
    eq('되돌리면 다시 이름 (부품)', await ev(() => ERP.inv.label('stage', 'WIP55')), '부품');
    const page = await ev(() => document.querySelector('main').innerText);
    ok('화면에 짐작했던 이름 없음 (스탬핑 완료 배럴 · 클릭펜 · 리필 컨테이너 · 가공 배럴)', !/스탬핑 완료 배럴|클릭펜 시스템|클릭펜슬 조립품|리필 컨테이너|가공 배럴/.test(page), page.match(/.{0,20}(스탬핑 완료|클릭펜|리필 컨테이너|가공 배럴).{0,20}/));
  });

  // ------------------------------------------------------------------------------------------
  await sec('5. 코드 사전: 이름 넣으면 이름, 지우면 다시 코드만', async () => {
    await ev(() => { ERP.state.cod = { level: 'stage', b: { stage: 'WIPx6', line: 'MINI', cat: '', sub: '', code: '' } }; ERP.goStock('codes'); ERP.render(); }); await settle();
    const row = (code) => ev((c) => { const tr = Array.from(document.querySelectorAll('main table tbody tr')).find(x => x.querySelector('td b') && x.querySelector('td b').textContent === c); if (!tr) return null; const ins = tr.querySelectorAll('input'); return { ko: ins[0].value, vi: ins[1].value, ph: ins[0].placeholder, flag: tr.querySelector('td').innerText.includes('이름 미정') }; }, code);
    let r = await row('WIP11'); eq('WIP11 줄: 사용자가 정한 이름 (부품 · Linh kiện)', [r.ko, r.vi, r.flag], ['부품', 'Linh kiện', false]);
    r = await row('WIP01'); eq('WIP01 줄: 확인된 이름 그대로', [r.ko, r.flag], ['배럴', false]);
    const opt = await ev(() => Array.from(document.querySelectorAll('main select option')).map(o => o.textContent));
    ok('ERP CODE 도우미 목록: 단계는 코드 · 이름 (WIP06·x6 · 부품, WIP11 · 부품, WIP01 · 배럴), 이름 미정 제품군은 코드만 (GRA)', opt.includes('WIP06·x6 · 부품') && opt.includes('WIP11 · 부품') && opt.includes('WIP01 · 배럴') && opt.includes('GRA') && !opt.some(o => / · $/.test(o)), opt.slice(0, 24));
    const fit = await ev(() => { const t = document.querySelector('main .grid2 table'); const w = t.closest('.tbl-wrap') || t.parentElement; return { table: t.scrollWidth, box: w.clientWidth }; });
    ok('코드 사전 표가 칸 안에 들어감 (가로로 잘리지 않음)', fit.table <= fit.box + 2, fit);
    // 이름 미정 코드(세부 NEON)에 이름 넣기 / 지우기
    await ev(() => { ERP.state.cod.level = 'sub'; ERP.render(); }); await settle();
    r = await row('NEON'); eq('NEON 줄: 이름 칸 비어 있음 · 코드 옆 "이름 미정" 표시', r, { ko: '', vi: '', ph: '이름 미정', flag: true });
    const fill = (code, i, v) => ev((a) => { const tr = Array.from(document.querySelectorAll('main table tbody tr')).find(x => x.querySelector('td b') && x.querySelector('td b').textContent === a[0]); const inp = tr.querySelectorAll('input')[a[1]]; inp.focus(); inp.value = a[2]; inp.dispatchEvent(new Event('change', { bubbles: true })); return document.activeElement === inp; }, [code, i, v]);
    const focusKept = await fill('NEON', 0, '시험 이름'); await settle();
    r = await ev(() => { const I = ERP.inv; const d = ERP.db.rows('code_dict').find(x => x.level === 'sub' && x.code === 'NEON'); const ko = I.label('sub', 'NEON'); ERP.lang = 'vi'; const vi = I.label('sub', 'NEON'); ERP.lang = 'ko'; return { ko, vi, g: I.isGuessed('sub', 'NEON'), d: d && { ko: d.ko, vi: d.vi, guessed: d.guessed } }; });
    eq('한국어 이름을 넣으면 이름 미정이 풀림 (베트남어는 한국어로 대신)', r, { ko: '시험 이름', vi: '시험 이름', g: false, d: { ko: '시험 이름', vi: '', guessed: false } });
    r = await row('NEON'); eq('표시: 이름 칸 · "이름 미정" 사라짐 (다시 그리지 않아 입력 포커스 유지)', [r.ko, r.flag, focusKept], ['시험 이름', false, true]);
    await fill('NEON', 1, 'Tên thử'); await settle();
    eq('베트남어 이름도 넣기', await ev(() => { ERP.lang = 'vi'; const v = ERP.inv.label('sub', 'NEON'); ERP.lang = 'ko'; return [ERP.inv.label('sub', 'NEON'), v]; }), ['시험 이름', 'Tên thử']);
    await fill('NEON', 0, ''); await fill('NEON', 1, ''); await settle();
    r = await ev(() => ({ l: ERP.inv.label('sub', 'NEON'), g: ERP.inv.isGuessed('sub', 'NEON') }));
    eq('이름을 모두 지우면 다시 코드만 (이름 미정)', r, { l: 'NEON', g: true });
    await ev(() => { ERP.render(); }); r = await row('NEON'); eq('다시 그려도 빈칸 · "이름 미정"', [r.ko, r.vi, r.flag], ['', '', true]);
  });

  // ------------------------------------------------------------------------------------------
  await sec('6. ECOUNT 비교 없음', async () => {
    const r = await ev(() => { const j = ERP.ecount.stockJob([{ code: 'WAX1', qty: 1 }], { scopeLabel: '', date: '2026-10-16' }); return { tables: Object.keys(ERP.TABLES), mode: j.mode, modes: Object.keys(j.modes()) }; });
    ok('ecount_snap(비교용) 표 없음', !r.tables.includes('ecount_snap'), r.tables);
    eq('ECOUNT 재고현황 반영 방식 = 기초재고로 설정 (14차부터 보완도) — 비교만은 없음', [r.mode, r.modes], ['open', ['open', 'fill']]);
    await ev(() => { ERP.state.dataTab = 'import'; ERP.goto('data'); ERP.render(); }); await settle();
    const d = await ev(() => document.querySelector('main').innerText);
    ok('자료 올리기 안내에 비교 없음 · 새 메뉴 이름 (원부자재 재고 → 수불 입력)', !/비교만|ECOUNT 비교|품목·재고/.test(d) && /원부자재 재고 → 수불 입력/.test(d), d.match(/.{0,40}(비교|품목·재고).{0,40}/));
    let all = '';
    for (const t of ['master', 'codes', 'check', 'legacy', 'floor', 'post', 'fentry', 'fledger', 'mat', 'entry', 'ledger', 'reorder', 'outsource']) { await ev((x) => { ERP.goStock(x); ERP.render(); }, t); await A.waitForTimeout(150); all += await ev(() => document.querySelector('main').innerText); }
    ok('세 메뉴 어디에도 "ECOUNT 비교" · "품목·재고" 없음', !/ECOUNT 비교|품목\s*·\s*재고|비교만/.test(all), all.match(/.{0,40}(ECOUNT 비교|품목\s*·\s*재고|비교만).{0,40}/));
  });

  // ------------------------------------------------------------------------------------------
  await sec('7. 종합 현황 · AI 비서 · 자료 올리기 결과 → 맞는 메뉴', async () => {
    const at = () => ev(() => ({ hash: location.hash, item: ERP.state.itemTab, floor: ERP.state.floorTab, mat: ERP.state.mtab }));
    await ev(() => { const ids = ['kpi_low', 'kpi_neg', 'kpi_susp', 'kpi_post', 'flow', 'floor_post', 'low_list', 'shortcuts']; ERP.state.dashEdit = false; ERP.dashSave(ids.map((id, i) => ({ k: id + '-t' + i, id, w: ERP.widgets[id].w, o: ERP.widgets[id].defaults }))); ERP.goto('dashboard'); ERP.render(); }); await settle();
    const click = async (sel) => { await ev(() => { ERP.goto('dashboard'); ERP.render(); }); await settle(); await A.click(sel); await A.waitForTimeout(300); return at(); };
    let r = await click('.w[data-id=kpi_low]'); eq('안전재고 미달 → 원부자재 재고 · 발주', [r.hash, r.mat], ['#/materials', 'reorder']);
    r = await click('.w[data-id=kpi_neg]'); eq('마이너스 재고 (현장만 있음) → 현장 재고 · 마이너스', [r.hash, r.floor, await ev(() => ERP.state.stk_floor.status)], ['#/floor', 'floor', 'neg']);
    r = await click('.w[data-id=kpi_susp]'); eq('이동 누락 의심 → 품목 · 자료 점검', [r.hash, r.item], ['#/items', 'check']);
    r = await click('.w[data-id=kpi_post]'); eq('생산 반영 → 현장 재고 · 생산 반영', [r.hash, r.floor], ['#/floor', 'post']);
    r = await click('.w[data-id=flow] .card-head a, .w[data-id=flow] h2 + a, .w[data-id=flow] a'); eq('재고 · 공정 흐름 → 현장 재고', r.hash, '#/floor');
    r = await click('.w[data-id=floor_post] a'); eq('현장 재고 반영 위젯 → 현장 재고 · 생산 반영', [r.hash, r.floor], ['#/floor', 'post']);
    r = await click('.w[data-id=low_list] a'); eq('안전재고 미달 목록 → 원부자재 재고 · 발주', [r.hash, r.mat], ['#/materials', 'reorder']);
    r = await click('.w[data-id=shortcuts] button:has-text("수불 입력")'); eq('바로가기 수불 입력 → 원부자재 재고 · 수불 입력', [r.hash, r.mat], ['#/materials', 'entry']);
    const wtxt = await ev(() => { ERP.goto('dashboard'); ERP.render(); return document.querySelector('main').innerText; });
    ok('위젯 글자에 옛 이름(품목·재고 · 생산현장) 없음', !/품목·재고|생산현장/.test(wtxt), wtxt.match(/.{0,30}(품목·재고|생산현장).{0,30}/));
    // AI 비서: 품목이 속한 메뉴의 버튼
    const ai = await ev(() => { const a = ERP.ai.localAnswer('BM02 재고'), b = ERP.ai.localAnswer('WAX1 재고'); return [a.actions.map(x => x.label), b.actions.map(x => x.label)]; });
    ok('AI 비서: 현장 품목 → "현장 재고 열기", 원부자재 → "원부자재 재고 열기"', ai[0].includes('현장 재고 열기') && ai[1].includes('원부자재 재고 열기'), ai);
    await ev(() => { const a = ERP.ai.localAnswer('BM02 재고'); a.actions.find(x => x.label === '현장 재고 열기').run(); }); await settle();
    eq('AI 비서 버튼 → 현장 재고', (await at()).hash, '#/floor');
    // 자료 올리기: 수불 양식 → 결과의 "원부자재 재고 보기"
    const dir = tmp('erp-v12-x-'); const f1 = path.join(dir, 'tx_upload.xlsx'); const today = await ev(() => ERP.fmt.today());
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['일자 / Ngày', '전표번호 / Số CT', '구분 (입고/출고/이동/조정) / Loại', '출발 (창고/공장) / Từ', '도착 (창고/공장) / Đến', '품목코드 / Mã hàng', '수량 / Số lượng', '거래처 / Đối tác', '참조 (PO 등) / Tham chiếu', '비고 / Ghi chú'],
      [today, 'IN-V12-1', '입고', '', '창고', 'CASE1', 10, 'Supplier', '', '']]), 'stock_tx'); XLSX.writeFile(wb, f1);
    await ev(() => { ERP.state.imp = { jobs: [] }; ERP.state.dataTab = 'import'; ERP.goto('data'); ERP.render(); }); await settle();
    await A.setInputFiles('.drop input[type=file]', [f1]); await A.waitForFunction(() => ERP.state.imp.jobs.length >= 1, null, { timeout: 60000 }); await settle();
    await A.click('text=선택 항목 모두 반영'); await A.waitForTimeout(600);
    const btn = await ev(() => Array.from(document.querySelectorAll('main button')).map(b => b.textContent).filter(t => /보기$/.test(t)));
    ok('반영 결과 버튼 = "원부자재 재고 보기"', btn.includes('원부자재 재고 보기'), btn);
    await A.click('main button:has-text("원부자재 재고 보기")'); await settle();
    eq('누르면 원부자재 재고', (await at()).hash, '#/materials');
  });

  // ------------------------------------------------------------------------------------------
  await sec('8. 모든 탭 (한국어 / Tiếng Việt) 오류 없음', async () => {
    for (const lang of ['ko', 'vi']) {
      await ev((l) => ERP.setLang(l), lang);
      for (const t of ['master', 'codes', 'check', 'legacy', 'floor', 'post', 'fentry', 'fledger', 'mat', 'entry', 'ledger', 'reorder', 'outsource']) {
        await ev((x) => { ERP.goStock(x); ERP.render(); }, t); await A.waitForTimeout(120);
        const txt = await ev(() => document.querySelector('main').innerText);
        ok('[' + lang + ' · ' + t + '] 화면에 null · undefined 글자 없음', !/\bnull\b|\bundefined\b/.test(txt), txt.match(/.{0,40}\b(null|undefined)\b.{0,40}/));
        ok('[' + lang + ' · ' + t + '] 물음표 표시(이동? · 단계 ?) 없음', !/이동\?|chuyển\?| \?\s*$/m.test(txt), txt.match(/.{0,30}(이동\?|chuyển\?).{0,30}/i));
      }
      for (const lv of ['stage', 'line', 'cat', 'sub']) await ev((x) => { ERP.state.cod = Object.assign(ERP.state.cod || {}, { level: x }); ERP.goStock('codes'); ERP.render(); }, lv);
    }
    const vi = await ev(() => Array.from(document.querySelectorAll('nav.side .nav a span')).map(s => s.textContent));
    ok('베트남어 메뉴 이름 (Mặt hàng · Tồn hiện trường · Tồn NVL)', ['Mặt hàng', 'Tồn hiện trường', 'Tồn NVL'].every(x => vi.includes(x)), vi);
    await ev(() => ERP.setLang('ko'));
    eq('페이지 오류 없음', errors, []);
  });

  // ------------------------------------------------------------------------------------------
  await sec('9. 모든 화면에 null · undefined 글자 없음 (자료가 적어 빈 표가 많은 상태)', async () => {
    const bad = [];
    const look = async (name) => { await A.waitForTimeout(150); const t = await ev(() => document.querySelector('main').innerText); const m = t.match(/.{0,30}\b(null|undefined)\b.{0,30}/); if (m) bad.push(name + ': ' + m[0]); };
    for (const p of await ev(() => Object.keys(ERP.pages))) { await ev((x) => { ERP.goto(x); ERP.render(); }, p); await look(p); }
    for (const t of ['log', 'entry', 'analysis', 'monthly', 'machines', 'procs']) { await ev((x) => { ERP.state.prodTab = x; ERP.goto('production'); ERP.render(); }, t); await look('production/' + t); }
    for (const t of ['mrp', 'struct', 'asm', 'semi_stock', 'bom', 'recipes']) { await ev((x) => { ERP.state.bomTab = x; ERP.state.params = {}; ERP.goto('bom'); ERP.render(); }, t); await look('bom/' + t); }
    for (const t of ['import', 'google', 'backup']) { await ev((x) => { ERP.state.dataTab = x; ERP.goto('data'); ERP.render(); }, t); await look('data/' + t); }
    for (const t of ['items', 'warehouses', 'partners', 'stock_open', 'uploads']) { await ev((x) => { ERP.state.mst = { t: x }; ERP.goStock('master'); ERP.render(); }, t); await look('master/' + t); }
    for (const t of ['materials', 'inout', 'stocktake', 'returns', 'semi_stock']) { await ev((x) => { ERP.state.leg = { t: x }; ERP.goStock('legacy'); ERP.render(); }, t); await look('legacy/' + t); }
    ok('null · undefined 글자 없음', !bad.length, bad);
    eq('페이지 오류 없음', errors, []);
  });

  await browser.close(); S.close();
  console.log('\n' + (fail ? '✗ 실패 ' + fail + '개' : '✓ 모두 통과') + '  (통과 ' + pass + ' / 전체 ' + (pass + fail) + ')');
  if (failures.length) { console.log('\n실패 목록:'); failures.forEach(x => console.log(' - ' + x)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
