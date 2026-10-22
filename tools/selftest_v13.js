'use strict';
/* 13차(v1.8.0) 자동 시험: 수주 강제 완료 (완료 버튼 · 완료 취소 · 납기 기준 일괄 완료)
   1 완료 전 상태 · 2 납기(Checking) 2025-01 ~ 2026-09 일괄 완료 (취소 · 보류 · 이미 완료 · PO 번호 없는 줄은 그대로, 다품번 PO 는 줄마다) ·
   3 수주를 다시 올려도(upsert) 완료 표시가 남음 · 4 수주 목록의 완료 버튼 → 확인 → 완료 / 완료 취소 · 5 상세 칸 · AI 비서 · 6 한 / 베 오류 없음
   사용:  npm run test:v13   (Playwright 필요: npm i -D playwright 또는 playwright-core + 설치된 Chrome/Edge) */
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
let pw; try { pw = require('playwright'); } catch (e) { try { pw = require('playwright-core'); } catch (e2) { console.error('Playwright가 필요합니다 / cần Playwright:  npm i -D playwright'); process.exit(2); } }
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const serverMod = require(path.join(ROOT, 'server.js'));

let pass = 0, fail = 0; const failures = [];
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 600 ? s.slice(0, 600) + '…' : s; };
function ok(name, cond, detail) { if (cond) { pass++; return true; } fail++; const line = name + (detail !== undefined ? '  → ' + short(detail) : ''); failures.push(line); console.log('  ✗ ' + line); return false; }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
async function sec(t, fn) { console.log('\n■ ' + t); try { await fn(); } catch (e) { ok(t + ' — 예외', false, String((e && e.message) || e).split('\n')[0].slice(0, 300)); } }
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

(async () => {
  const dataDir = tmp('erp-v13-');
  const S = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir, host: '127.0.0.1', port: 6700 + Math.floor(Math.random() * 200) /* 6665~6669 · 6679 · 6697 은 브라우저가 막는 포트라 피함 */, backupDelay: 3600000 });
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 } });
  const A = await ctx.newPage(); A.on('pageerror', e => errors.push('pageerror: ' + e.message));
  A.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Failed to fetch/.test(m.text())) errors.push('console: ' + m.text()); });
  const ready = () => A.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 180000 });
  const ev = (fn, arg) => A.evaluate(fn, arg);
  const settle = () => A.waitForTimeout(250);
  await A.goto(S.url + '/#/dashboard'); await ready();

  // 빈 상태에서 시험용 수주만 (납기는 오늘과 상관없게 과거 2025 · 2026-09 와 먼 미래 2099)
  await ev(async () => {
    const DB = ERP.db; await DB.wipe();
    const po = (o) => Object.assign({ date: '2025-01-05', customer: 'TEST', kind: 'Mini', pcs: 1000, sets: 100, cs: 10, packed: 0 }, o);
    DB.replace('po', [
      po({ po_no: 'PO-A', item_no: 'IA', due: '2025-03-10' }),                         // 납기 경과 → 일괄 완료
      po({ po_no: 'PO-B', item_no: 'IB1', due: '2026-09-30' }),                        // 다품번: 9월 납기 줄은 완료
      po({ po_no: 'PO-B', item_no: 'IB2', due: '2099-10-05' }),                        //         10월 이후 줄은 진행 중
      po({ po_no: 'PO-C', item_no: 'IC', due: '2026-09-20', condition: 'Cancle' }),   // 취소 → 그대로
      po({ po_no: 'PO-D', item_no: 'ID', due: '2099-01-10' }),                         // 진행 중 → 완료 버튼 · 완료 취소
      po({ po_no: 'PO-E', item_no: 'IE', due: '2025-05-01', packed: 100 }),            // 포장 실적으로 이미 완료 → 그대로
      po({ po_no: 'PO-F', item_no: 'IF', due: '2026-10-01' }),                         // 10월 납기 → 진행 중 (일괄 완료 대상 아님)
      { date: '2025-01-01', kind: 'Dial', pcs: 600192, sets: 0, due: '2025-01-01', packed: 0, rate: 1 }]);   // PO 번호 없는 월 합계 줄
    await DB.flush();
  });
  const stOf = () => ev(() => Object.fromEntries(ERP.calc.poGroups().map(g => [g.po_no, g.st + (g.forced ? '*' : '')])));
  const openOf = () => ev(() => ERP.calc.poGroups().filter(g => ERP.calc.isOpen(g)).map(g => g.po_no).sort());

  // ------------------------------------------------------------------------------------------
  await sec('1. 완료 전', async () => {
    eq('진행 중 PO = A · B · D · F', await openOf(), ['PO-A', 'PO-B', 'PO-D', 'PO-F']);
    const s = await stOf(); eq('E = 포장 실적으로 완료 · C = 취소', [s['PO-E'], s['PO-C']], ['done', 'cancel']);
  });

  // ------------------------------------------------------------------------------------------
  await sec('2. 납기(Checking) 2025-01 ~ 2026-09 일괄 완료', async () => {
    const n = await ev(() => ERP.calc.closeByDue('2025-01-01', '2026-09-30'));
    eq('바꾼 줄 = A · B 의 9월 줄 (2줄)', n, 2);
    eq('진행 중으로 남는 PO = B(10월 이후 줄) · D · F', await openOf(), ['PO-B', 'PO-D', 'PO-F']);
    const s = await stOf(); eq('A = 강제 완료(*) · E = 포장 완료(표시 없음) · C = 취소 그대로', [s['PO-A'], s['PO-E'], s['PO-C']], ['done*', 'done', 'cancel']);
    const r = await ev(() => { const P = ERP.db.rows('po'); const by = (po, it) => P.find(p => p.po_no === po && p.item_no === it) || {}; const t = ERP.fmt.today();
      return { a: by('PO-A', 'IA').done_at === t, b1: by('PO-B', 'IB1').done_at === t, b2: !!by('PO-B', 'IB2').done_at, c: !!by('PO-C', 'IC').done_at, e: !!by('PO-E', 'IE').done_at, nopo: !!P.find(p => !p.po_no).done_at,
        log: ERP.db.rows('uploads').filter(u => u.kind === 'po_close').map(u => [u.rows, u.date, u.mode]) }; });
    eq('완료 처리일 = 오늘 (A · B1), B2 · 취소 · 포장 완료 · PO 번호 없는 줄은 그대로', [r.a, r.b1, r.b2, r.c, r.e, r.nopo], [true, true, false, false, false, false]);
    eq('업로드 이력에 남김 (수주 일괄 완료 2줄)', r.log, [[2, '2026-09-30', 'due']]);
    eq('다시 실행해도 더 바뀌지 않음', await ev(() => ERP.calc.closeByDue('2025-01-01', '2026-09-30')), 0);
  });

  // ------------------------------------------------------------------------------------------
  await sec('3. 수주를 다시 올려도 (upsert) 완료 표시가 남음', async () => {
    const r = await ev(() => ERP.db.upsert('po', [{ date: '2025-01-05', customer: 'TEST', po_no: 'PO-A', item_no: 'IA', kind: 'Mini', pcs: 1000, sets: 100, cs: 10, due: '2025-03-10', packed: 0 }]));
    eq('같은 줄로 갱신 (추가 0)', [r.added, r.updated], [0, 1]);
    eq('A 는 여전히 강제 완료', (await stOf())['PO-A'], 'done*');
  });

  // ------------------------------------------------------------------------------------------
  await sec('4. 수주 목록의 완료 버튼 → 완료 / 완료 취소', async () => {
    await ev(() => { ERP.state.ord = { tab: 'open', sel: null, view: 'po' }; ERP.goto('orders'); ERP.render(); }); await settle();
    const rowBtns = () => ev(() => Array.from(document.querySelectorAll('main table.tbl tbody tr')).map(tr => [tr.children[0].innerText.trim(), Array.from(tr.querySelectorAll('button')).map(b => b.textContent.trim()).join('|')]).filter(x => /^PO-/.test(x[0])));
    const openRows = (await rowBtns()).map(x => x[0]).sort();
    eq('진행 중 탭의 PO', openRows, ['PO-B', 'PO-D', 'PO-F']);
    ok('진행 중 탭: 모두 "완료" 버튼', (await rowBtns()).every(x => x[1] === '완료'), await rowBtns());
    const vis = await ev(() => { const w = document.querySelector('main section.grow .tbl-wrap'); const b = w.querySelector('tbody button'); const wr = w.getBoundingClientRect(), br = b.getBoundingClientRect(); return { b: Math.round(br.right), w: Math.round(wr.right) }; });
    ok('완료 버튼이 옆으로 밀지 않아도 보임 (상태 칸 옆)', vis.b <= vis.w, vis);
    await A.locator('main table.tbl tbody tr', { hasText: 'PO-D' }).locator('button', { hasText: /^완료$/ }).click(); await A.waitForSelector('.modal');
    const msg = await ev(() => document.querySelector('.modal').innerText);
    ok('확인 창: PO 번호 · 포장 실적과 상관없이 · 완료 취소 안내', /PO-D/.test(msg) && /포장 실적과 상관없이/.test(msg) && /완료 취소/.test(msg), msg);
    await A.click('.modal .modal-foot button.primary'); await A.waitForTimeout(400);
    const s1 = await stOf(); eq('D = 강제 완료 · 선택은 그대로(버튼만 눌림)', [s1['PO-D'], await ev(() => ERP.state.ord.sel)], ['done*', null]);
    eq('진행 중 PO = B · F', await openOf(), ['PO-B', 'PO-F']);
    const kpi = await ev(() => document.querySelector('main .kpis').innerText); ok('진행 중 PO 숫자 = 2', /진행 중 PO\s*2/.test(kpi), kpi.slice(0, 120));
    await ev(() => { ERP.state.ord.tab = 'done'; ERP.render(); }); await settle();
    const done = (await rowBtns()).sort(); eq('완료 탭: A · D 는 "완료 취소", E(포장 완료)는 버튼 없음', done, [['PO-A', '완료 취소'], ['PO-D', '완료 취소'], ['PO-E', '']]);
    await A.locator('main table.tbl tbody tr', { hasText: 'PO-D' }).locator('button', { hasText: '완료 취소' }).click(); await A.waitForSelector('.modal');
    await A.click('.modal .modal-foot button.primary'); await A.waitForTimeout(400);
    eq('완료 취소 → D 다시 진행 중', await openOf(), ['PO-B', 'PO-D', 'PO-F']);
    eq('D 의 완료 처리일 지워짐', await ev(() => ERP.db.rows('po').find(p => p.po_no === 'PO-D').done_at), '');
    // 확인 창에서 취소하면 그대로
    await ev(() => { ERP.state.ord.tab = 'open'; ERP.render(); }); await settle();
    await A.locator('main table.tbl tbody tr', { hasText: 'PO-F' }).locator('button', { hasText: /^완료$/ }).click(); await A.waitForSelector('.modal');
    await A.click('.modal .modal-foot button:not(.primary)'); await A.waitForTimeout(300);
    eq('확인 창에서 취소 → F 그대로 진행 중', await openOf(), ['PO-B', 'PO-D', 'PO-F']);
  });

  // ------------------------------------------------------------------------------------------
  await sec('5. 상세 칸 · AI 비서', async () => {
    await ev(() => { ERP.state.ord = { tab: 'done', sel: 'PO-A', view: 'po' }; ERP.render(); }); await settle();
    const a = await ev(() => ({ t: document.querySelector('main aside').innerText, b: Array.from(document.querySelectorAll('main aside button')).map(b => b.textContent.trim()) }));
    ok('A 상세: "완료 처리 (날짜)" 표시 · "완료 취소" 버튼', /완료 처리/.test(a.t) && /포장 실적과 상관없이 완료로 표시한 PO/.test(a.t) && a.b.includes('완료 취소'), a);
    await ev(() => { ERP.state.ord = { tab: 'open', sel: 'PO-B', view: 'po' }; ERP.render(); }); await settle();
    const b = await ev(() => Array.from(document.querySelectorAll('main aside button')).map(x => x.textContent.trim()));
    ok('B(진행 중) 상세: "완료 처리" 버튼', b.includes('완료 처리'), b);
    const ai = await ev(() => { const r = ERP.ai.tools.find_orders({ status: 'done', limit: 20 }); return r.rows.map(x => x.po_no).sort(); });
    eq('AI 비서 도구: 완료 = A · E', ai, ['PO-A', 'PO-E']);
    await ev(() => { ERP.state.ord = { tab: 'all', sel: null, view: 'line' }; ERP.render(); }); await settle();
    ok('품번 라인별 보기도 열림', await ev(() => document.querySelectorAll('main table.tbl tbody tr').length >= 7));
  });

  // ------------------------------------------------------------------------------------------
  await sec('6. 한 / 베 화면 · 오류 없음', async () => {
    const bad = [];
    for (const lang of ['ko', 'vi']) {
      await ev((l) => ERP.setLang(l), lang);
      for (const tab of ['open', 'late', 'done', 'cancel', 'all']) {
        await ev((t) => { ERP.state.ord = { tab: t, sel: 'PO-A', view: 'po' }; ERP.goto('orders'); ERP.render(); }, tab); await A.waitForTimeout(150);
        const t = await ev(() => document.querySelector('main').innerText); if (/\bnull\b|\bundefined\b/.test(t)) bad.push(lang + '/' + tab);
      }
    }
    const vi = await ev(() => Array.from(document.querySelectorAll('main section.grow table.tbl tbody button')).map(b => b.textContent.trim()));   // 수주 목록의 버튼만 (상세 칸의 MRP 제외)
    ok('베트남어 버튼 (Xong / Bỏ xong)', vi.every(x => x === 'Xong' || x === 'Bỏ xong') && vi.length > 0, vi);
    await ev(() => ERP.setLang('ko'));
    ok('null · undefined 글자 없음', !bad.length, bad);
    eq('페이지 오류 없음', errors, []);
  });

  await browser.close(); S.close();
  console.log('\n' + (fail ? '✗ 실패 ' + fail + '개' : '✓ 모두 통과') + '  (통과 ' + pass + ' / 전체 ' + (pass + fail) + ')');
  if (failures.length) { console.log('\n실패 목록:'); failures.forEach(x => console.log(' - ' + x)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
