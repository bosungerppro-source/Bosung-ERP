'use strict';
/* 16차(v1.11.0) 자동 시험: 자재구매 파일(해외 주문 품목) → 원부자재 재고 → 해외 주문 탭
   1 파일 인식 (머리 줄 · 엑셀 표 머리 줄 건너뜀 · 주문일 칸 · 파일 날짜 · 두 번 있는 코드 · 다른 시트는 인식 안 함) · 미리보기
   2 반영: 해외 주문 표시 · 구분 · 한글 품명 · 안전재고 (같은 단위 = 품목 안전재고, 다른 단위 = 파일 단위로 따로) · 없는 품목 만들기 · 파일에 없는 품목은 목록에서 뺌 · 주문
   3 원부자재 재고의 "해외 주문 품목만" 버튼 · 표 칸 순서 (파일과 같음) · 파일 순서 · 재고(단위 바꿈) · 입고예정 · 합계 · 월 사용량 · 상태 · 권장 주문량
   4 리드타임 (기본 · 품목별) → 도착 예정 · 리드타임 동안 쓸 양 · 5 주문 넣기 · 권장 주문량 넣기 · 입고 완료 · 6 다시 올려도 늘지 않음 (입고 완료는 그대로)
   7 발주 · 안전재고 목록에서 해외 주문 품목은 뺌 · 8 엑셀 (같은 표, 다시 올리면 인식) · 9 휴대폰 폭 · 베트남어 · 오류 없음
   사용:  npm run test:v16   (Playwright 필요: npm i -D playwright 또는 playwright-core + 설치된 Chrome/Edge) */
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
let pw; try { pw = require('playwright'); } catch (e) { try { pw = require('playwright-core'); } catch (e2) { console.error('Playwright가 필요합니다 / cần Playwright:  npm i -D playwright'); process.exit(2); } }
const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const serverMod = require(path.join(ROOT, 'server.js'));

let pass = 0, fail = 0; const failures = [];
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 700 ? s.slice(0, 700) + '…' : s; };
function ok(name, cond, detail) { if (cond) { pass++; return true; } fail++; const line = name + (detail !== undefined ? '  → ' + short(detail) : ''); failures.push(line); console.log('  ✗ ' + line); return false; }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
async function sec(t, fn) { console.log('\n■ ' + t); try { await fn(); } catch (e) { ok(t + ' — 예외', false, String((e && e.message) || e).split('\n')[0].slice(0, 300)); } }
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const serial = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 0.01;

/** 자재구매 파일 흉내 (Oder Korea: 제목 · Date : · 머리 줄(날짜 칸은 날짜 숫자) · 엑셀 표 머리 줄 · 자료) + 다른 시트 */
function buyBook(rows, fileDate) {
  const head = [[null, 'Bosung Vina Purchase of materials', null, 'Author : ', 'Test'], [null, null, null, 'Date : ', serial(fileDate || '2026-10-21')], [],
    [null, 'Category', 'Item Code', 'Item Name', 'Item Name Kr', 'Safety stock', 'Unit', 'Inventory', '입고예정', serial('2026-10-21'), serial('2026-09-21'), 'Total', 'kg/month', 'ea/month', 'Max', 'Min', 'Average'],
    [null, 'Category', 'Item Code', 'Item Name', 'Item Name Kr', 'Safety stock', 'Unit', 'Inventory', '열3', '열2', '열1', '3일', 'Column132', 'Column133', 'Column134', 'Column135', 'Column136']];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(head.concat(rows)), 'Oder Korea');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['열1', '1월', '2월', '총합계', 'Max', 'Min', 'Average'], ['R-011', 130, 120, 250, 130, 120, 125]]), 'Sheet1');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[null, 'Item Name Kr', '단위', '재고', '추가 필요량'], [null, 'YELLOW F-10G', 'kg', 270, 50]]), 'Sheet3');
  return wb;
}

(async () => {
  const dataDir = tmp('erp-v16-'); const xdir = tmp('erp-v16-x-');
  const S = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir, host: '127.0.0.1', port: 7100 + Math.floor(Math.random() * 300), backupDelay: 3600000 });
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 } });
  const A = await ctx.newPage(); A.on('pageerror', e => errors.push('pageerror: ' + e.message));
  A.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Failed to fetch/.test(m.text())) errors.push('console: ' + m.text()); });
  const ready = () => A.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 180000 });
  const ev = (fn, arg) => A.evaluate(fn, arg);
  const confirmModal = async () => { for (let i = 0; i < 20; i++) { await A.waitForTimeout(150); const m = await A.$('.modal .modal-foot button:last-child'); if (m) { await m.click(); return true; } } return false; };
  const buyText = () => ev(() => document.querySelector('main').innerText);
  const rowOf = (code, cat) => ev((a) => { const tr = Array.from(document.querySelectorAll('main table.buy-tbl tbody tr')).find(x => x.children[1] && (a.cat ? x.children[0].innerText.trim() === a.cat && x.children[1].querySelector('b').textContent.trim() === a.code : x.children[1].innerText.trim() === a.code)); if (!tr) return null;
    return Array.from(tr.children).map(td => { const i = td.querySelector('input'); return i ? i.value : td.innerText.trim(); }); }, { code, cat: cat || '' });
  await A.goto(S.url + '/#/data'); await ready();

  // 오늘 기준: 창고 기준일 = 4달 전 마지막 날 → 월 사용량을 보는 달 = 3달 전 ~ 지난달
  const now = new Date(); const mAgo = (n) => { const d = new Date(now.getFullYear(), now.getMonth() - n, 1); return ymd(d).slice(0, 7); };
  const openDate = ymd(new Date(now.getFullYear(), now.getMonth() - 3, 0));
  const today = ymd(now);
  await ev(async (o) => { const DB = ERP.db; await DB.wipe();
    DB.replace('items', [
      { code: 'R-011', name: 'YELLOW 10G', unit: 'kg', stage: 'RM', kg_per_ea: 10, src: 'ecount' },
      { code: 'R-021', name: 'YELLOW 2GS', unit: 'kg', stage: 'RM', kg_per_ea: 25, src: 'ecount' },
      { code: 'R-200', name: 'HOT FOIL - REGULAR', unit: 'PCS', stage: 'CM', src: 'ecount' },
      { code: 'R-380', name: 'PET 600X400X20', unit: 'ROLL', stage: 'CM', kg_per_ea: 62.5, safety: 5, src: 'ecount' },
      { code: 'R-015', name: 'ORANGE 64', unit: 'kg', stage: 'RM', src: 'ecount' },
      { code: 'R-027P', name: 'RED CL RS', unit: 'kg', stage: 'RM', src: 'ecount' },
      { code: 'R-001', name: 'BEE WAX', unit: 'kg', stage: 'RM', kg_per_ea: 25, src: 'ecount' },
      { code: 'OLD-1', name: 'OLD BUY ITEM', unit: 'kg', stage: 'RM', buy: true, buy_cat: 'X', src: 'ecount' },
      { code: 'R-100', name: 'POLYPROPYLENE', unit: 'KG', stage: 'RM', safety: 10, src: 'ecount' }]);
    const op = (code, qty, unit) => ({ date: o.openDate, scope: 'WH', code, qty, unit, grp: 'wh' });
    DB.replace('stock_open', [op('R-011', 600, 'kg'), op('R-021', 400, 'kg'), op('R-200', 4662000, 'PCS'), op('R-380', 16.8, 'ROLL'), op('R-015', 160, 'kg'), op('R-027P', 30, 'kg'), op('R-001', 1380, 'kg'), op('R-100', 5, 'kg')]);
    const out = (ym, qty) => ({ date: ym + '-10', kind: 'OUT', from_scope: 'WH', code: 'R-011', qty, unit: 'kg', src: 'wh' });
    DB.replace('stock_tx', [out(o.m3, 100), out(o.m2, 160), out(o.m1, 140)]);
    DB.meta.openDate = { WH: o.openDate }; DB.meta.seeded = DB.meta.seeded || new Date().toISOString(); await DB.saveMeta(); await DB.flush(); }, { openDate, m3: mAgo(3), m2: mAgo(2), m1: mAgo(1) });

  const ROWS = [
    [null, 'Hot Foil', 'R-200', 'HOT FOIL - Regular', 'REGULAR', 4000000, 'ea', 4662000, null, null, null, 4662000, null, 630000],
    [null, 'Pigment', 'R-011', 'Yellow F10G', 'YELLOW F-10G', 350, 'kg', 250, null, 100, null, 350, 140, 14],
    [null, 'Pigment', 'R-021', 'Yellow 2GS', 'YELLOW 2GS', 450, 'kg', 400, 150, null, null, 550, 120, 12],
    [null, 'Pigment', 'R-015', 'Orange 64', 'Orange 64', 100, 'kg', 160, null, null, null, 160],
    [null, 'Refill', 'R-031A', 'KAOLIN USA', '카오링(고령토)(usa)', 700, 'kg', 0, null, null, null, 0, 0, 0, 50, 0, 27.27],
    [null, 'Refill', 'R-001', 'BEES WAX(MPW-80)', '밀납(MPW-80)', 1400, 'kg', 1380, null, null, 500, 1880, 125, 5],
    [null, 'Pet', 'R-380', 'PET 600x400x20', 'A-PET SHEET', 2000, 'kg', 1050, null, null, null, 1050],
    [null, 'For glass', 'R-300C', 'Glass Paper', 'Glass Paper', 500, 'Yn', null, null, null, null, 0],
    [null, 'BIC Pigment', 'R-015', 'Orange 64', 'Orange 64', 200, 'kg', 160, null, null, null, 160],
    [null, 'ZEYA', 'R-027P', 'RED CL RS', 'RED CL RS', 100, 'kg', 30, null, null, null, 30],
    [null, 'ZEYA', 'R-027P', 'RED CL RS', 'RED CL RS', 100, 'kg', 30, null, null, null, 30]];
  const fb = path.join(xdir, '261021 purchase.xlsx'); XLSX.writeFile(buyBook(ROWS), fb);

  // ------------------------------------------------------------------------------------------
  await sec('1. 파일 인식 · 미리보기', async () => {
    await ev(() => { ERP.state.dataTab = 'import'; ERP.state.imp = { jobs: [] }; ERP.goto('data'); ERP.render(); }); await A.waitForTimeout(300);
    await A.setInputFiles('.drop input[type=file]', [fb]); await A.waitForFunction(() => ERP.state.imp.jobs.length >= 2, null, { timeout: 60000 }); await A.waitForTimeout(300);
    const j = await ev(() => ERP.state.imp.jobs.map(x => ({ sheet: x.sheet, kind: x.kind || null, n: x.rows.length, include: !!x.include, B: x.B ? { dates: x.B.dates, fdate: x.B.fdate, dups: x.B.dups.map(d => d.code), codes: x.B.rows.map(r => r.code), pools: x.B.rows.filter(r => r.pool).map(r => [r.code, r.pool]) } : null,
      p: x.preview ? x.preview(x).parts.map(q => q[0] + '=' + q[1]) : null, rows: x.kind === 'buy_orders' ? x.rows : null })));
    const by = Object.fromEntries(j.filter(x => x.kind).map(x => [x.kind, x]));
    eq('작업: 해외 주문 품목 · 주문 (다른 시트는 인식 안 함)', [Object.keys(by).sort(), j.filter(x => !x.kind).map(x => x.sheet).sort()], [['buy_items', 'buy_orders', 'buy_stock'], ['Sheet1', 'Sheet3']]);
    eq('파일 순서 · 엑셀 표 머리 줄 건너뜀 · 같은 코드 · 다른 구분은 따로 관리 (R-015 BIC Pigment) · 같은 구분 두 번은 첫 줄 (R-027P)', [by.buy_items.B.codes, by.buy_items.B.pools, by.buy_items.B.dups], [['R-200', 'R-011', 'R-021', 'R-015', 'R-031A', 'R-001', 'R-380', 'R-300C', 'R-015', 'R-027P'], [['R-015', 'BIC Pigment']], ['R-027P']]);
    eq('주문일 칸 (머리 칸의 날짜) · 파일 날짜 (Date : 옆 칸)', [by.buy_items.B.dates, by.buy_items.B.fdate], [['2026-10-21', '2026-09-21'], '2026-10-21']);
    const p = by.buy_items.p;
    ok('품목 미리보기: 9 · 같은 코드 7 · 안전재고 9 · 새로 만듦 2 · 단위 다름 1 · 따로 관리 1 · 두 번 1 · 목록에서 빠짐 1', ['해외 주문 품목=9', 'ERP 품목과 같은 코드=7', '안전재고 넣음=9', 'ERP 에 없어 새로 만듦=2', '단위가 ERP 와 다름 (안전재고는 파일 단위로 따로)=1', '같은 코드 · 다른 구분 → 따로 관리하는 재고=1', '같은 코드 · 같은 구분이 두 번 (첫 줄 사용)=1', '목록에서 빠짐 (이 파일에 없음)=1'].every(x => p.includes(x)), p);
    eq('주문: 10-21 R-011 100 · 09-21 R-001 500 · 입고예정 칸 R-021 150 (파일 날짜, 주문일 칸과 따로)', by.buy_orders.rows.map(r => [r.date, r.code, r.qty, r.kind || '']).sort(), [['2026-09-21', 'R-001', 500, ''], ['2026-10-21', 'R-011', 100, ''], ['2026-10-21', 'R-021', 150, 'inc']]);
    ok('주문 미리보기: 3 · 새 주문 3', by.buy_orders.p.includes('주문=3') && by.buy_orders.p.includes('새 주문=3'), by.buy_orders.p);
  });

  // ------------------------------------------------------------------------------------------
  await sec('2. 반영 → 품목 · 안전재고 · 주문', async () => {
    await ev(() => { ERP.state.imp.jobs.filter(x => x.kind === 'buy_stock').forEach(x => { x.include = false; }); });   // 재고 맞춤은 8-2 에서
    await A.click('text=선택 항목 모두 반영');
    await A.waitForFunction(() => !!Array.from(document.querySelectorAll('main h3')).find(x => /반영 결과/.test(x.textContent)), null, { timeout: 60000 });
    await ev(async () => { if (ERP.db.flush) await ERP.db.flush(); });
    const r = await ev(() => { const I = ERP.inv; const it = (c) => { const m = I.item(c); return m ? { buy: !!m.buy, cat: m.buy_cat || null, kr: m.name_kr || null, unit: m.unit, bu: m.buy_unit || null, safety: m.safety === undefined ? null : m.safety, bs: m.buy_safety === undefined ? null : m.buy_safety, ord: m.buy_ord || null, stage: I.info(m).stage, name: m.name, src: m.src } : null; };
      return { r200: it('R-200'), r011: it('R-011'), r380: it('R-380'), r015: it('R-015'), r031a: it('R-031A'), r300c: it('R-300C'), old: it('OLD-1'), r100: it('R-100'),
        orders: ERP.db.rows('buy_orders').map(o => [o.date, o.code, o.qty, o.unit, o.status, o.src, o.kind || '']).sort(), btn: !!Array.from(document.querySelectorAll('main button')).find(b => /해외 주문 보기/.test(b.textContent)) }; });
    eq('R-200: 해외 주문 · 구분 · 한글 품명 · 파일 단위 ea (= PCS) → 품목 안전재고 4,000,000', [r.r200.buy, r.r200.cat, r.r200.kr, r.r200.bu, r.r200.safety, r.r200.bs, r.r200.ord], [true, 'Hot Foil', 'REGULAR', 'ea', 4000000, null, 1]);
    eq('R-380: 파일 kg ≠ ERP ROLL → 안전재고는 파일 단위로 따로 (품목 안전재고 5 그대로)', [r.r380.safety, r.r380.bs, r.r380.bu], [5, 2000, 'kg']);
    eq('R-015: 첫 줄 = ERP 품목 (Pigment · 안전재고 100)', [r.r015.cat, r.r015.safety], ['Pigment', 100]);
    eq('R-015 BIC Pigment 줄 = 따로 관리하는 재고 (안전재고 200 · 재고 160 · 파일 날짜)', await ev(() => ERP.db.rows('buy_pools').map(p => [p.code, p.cat, p.safety, p.inv, p.unit, p.inv_date, p.ord])), [['R-015', 'BIC Pigment', 200, 160, 'kg', '2026-10-21', 9]]);
    eq('파일의 재고(Inventory) · 날짜도 남김 (R-011 250)', await ev(() => { const m = ERP.inv.item('R-011'); return [m.buy_inv, m.buy_inv_date]; }), [250, '2026-10-21']);
    eq('없는 품목 만들기: R-031A 원재료 kg · 이름 · 한글 품명 그대로 / R-300C 부자재 · 단위 Yn', [r.r031a && [r.r031a.stage, r.r031a.unit, r.r031a.name, r.r031a.kr, r.r031a.src, r.r031a.safety], r.r300c && [r.r300c.stage, r.r300c.unit, r.r300c.safety]], [['RM', 'kg', 'KAOLIN USA', '카오링(고령토)(usa)', 'buy', 700], ['SM', 'Yn', 500]]);
    eq('파일에 없는 해외 주문 품목은 목록에서 뺌 · 다른 품목은 그대로', [r.old.buy, r.r100.buy, r.r100.safety], [false, false, 10]);
    eq('주문 3줄 (입고 대기 · 파일, 입고예정 칸은 inc)', r.orders, [['2026-09-21', 'R-001', 500, 'kg', 'open', 'file', ''], ['2026-10-21', 'R-011', 100, 'kg', 'open', 'file', ''], ['2026-10-21', 'R-021', 150, 'kg', 'open', 'file', 'inc']]);
    ok('반영 결과: 해외 주문 보기 버튼', r.btn);
  });

  // ------------------------------------------------------------------------------------------
  await sec('3. 원부자재 재고 → 해외 주문 품목만 · 표', async () => {
    await ev(() => ERP.goStock('mat')); await A.waitForTimeout(300);
    const b = await ev(() => { const x = Array.from(document.querySelectorAll('main button')).find(y => /해외 주문 품목만/.test(y.textContent)); return x ? x.textContent.trim() : null; });
    eq('원부자재 재고에 "해외 주문 품목만 9" 버튼', b, '해외 주문 품목만 9');
    const chip = await ev(() => { const tr = Array.from(document.querySelectorAll('main table.tbl tbody tr')).find(x => x.children[0] && x.children[0].innerText.trim() === 'R-011'); return tr ? /해외 주문/.test(tr.innerText) : null; });
    ok('원부자재 재고 표: 해외 주문 품목 표시', chip === true, chip);
    await A.click('main button:has-text("해외 주문 품목만")');
    await A.waitForFunction(() => !!document.querySelector('main table.buy-tbl'), null, { timeout: 15000 });
    const head = await ev(() => Array.from(document.querySelectorAll('main table.buy-tbl thead th')).map(th => th.firstChild && th.firstChild.nodeType === 3 ? th.firstChild.textContent.trim() : (th.querySelector('div') ? th.querySelector('div').textContent.trim() : th.textContent.trim())));
    eq('칸 순서 = 파일 (구분 … 평균) + 리드타임 · 도착 예정 · 상태 · 권장 주문량', head, ['구분', '품목코드', '품명', '품명 (한글)', '안전재고', '단위', '재고', '입고예정', '2026-10-21', '2026-09-21', '합계', 'kg/월', 'ea/월', '최대', '최소', '평균', '리드타임 (일)', '도착 예정', '상태', '권장 주문량', '주문 단위']);
    const order = await ev(() => Array.from(document.querySelectorAll('main table.buy-tbl tbody tr')).map(tr => tr.children[1].querySelector('b').textContent.trim() + (/따로 관리/.test(tr.children[1].innerText) ? '*' : '')));
    eq('줄 순서 = 파일 순서 (따로 관리 줄 *)', order, ['R-200', 'R-011', 'R-021', 'R-015', 'R-031A', 'R-001', 'R-380', 'R-300C', 'R-015*', 'R-027P']);
    const p015 = await rowOf('R-015', 'BIC Pigment'), m015 = await rowOf('R-015');
    eq('R-015 BIC Pigment (따로 관리): 안전재고 200 · 재고 160 (파일 값, 표에서 고칠 수 있음) · 주문 필요 · 권장 100 (부족 40 → 백 단위) / 첫 줄 Pigment: 안전재고 100 · 충분', [p015 && [p015[0], p015[4], p015[6], p015[18], p015[19]], m015 && [m015[0], m015[4], m015[6], m015[18]]], [['BIC Pigment', '200', '160', '주문 필요', '100'], ['Pigment', '100', '160', '충분']]);
    eq('R-011: 재고 200 · 입고예정 없음 · 10-21 주문 100 · 합계 300 · kg/월 140 · ea/월 14 · 최대 160 · 최소 100 · 평균 133.33 · 주문 필요 · 권장 100 (부족 50 → 안전재고 350 은 백 단위)', (await rowOf('R-011')).filter((v, i) => [0, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 18, 19].includes(i)),
      ['Pigment', 'YELLOW F-10G', '350', 'kg', '200\n파일 250', '', '100', '300', '140', '14', '160', '100', '133.33', '주문 필요', '100']);
    eq('주문 단위 칸: 비어 있고 안전재고 자릿수가 보임 (R-011 100 · R-200 1000000 · R-001 1000)', [(await rowOf('R-011'))[20], await ev(() => ['R-011', 'R-200', 'R-001'].map(c => { const tr = Array.from(document.querySelectorAll('main table.buy-tbl tbody tr')).find(x => x.children[1].innerText.trim() === c); return tr.children[20].querySelector('input').placeholder; }))], ['', ['100', '1000000', '1000']]);
    const r021 = await rowOf('R-021');
    eq('R-021: 입고예정 칸 150 (주문일 칸은 비어 있음) · 합계 550 = 재고 400 + 150 · 충분', [r021[7], r021[8], r021[9], r021[10], r021[18]], ['150', '', '', '550', '충분']);
    const r380 = await rowOf('R-380');
    eq('R-380: 단위 kg (ERP ROLL) · 재고 16.8 ROLL × 62.5 = 1,050 kg · 안전재고 2,000 · 권장 1,000 (62.5 kg 단위로 올림)', [r380[4], r380[5].replace(/\s+/g, ' '), r380[6], r380[18], r380[19]], ['2000', 'kg ERP ROLL', '1,050', '주문 필요', '1,000']);
    const r001 = await rowOf('R-001');
    eq('R-001: 09-21 주문 500 → 합계 1,880 = 재고 1,380 + 500 · 충분 (입고예정 칸은 비어 있음)', [r001[7], r001[9], r001[10], r001[18]], ['', '500', '1,880', '충분']);
    const t = await buyText();
    ok('위 숫자: 품목 9 (파일 재고와 다름 1) · 주문 필요 6 (따로 관리 줄 포함) · 입고 대기 3 · 리드타임 아직 안 넣음', /해외 주문 품목\s*9/.test(t) && /파일 재고와 다름 1/.test(t) && /주문 필요\s*6/.test(t) && /입고 대기 주문\s*3/.test(t) && /아직 안 넣음/.test(t), t.slice(0, 600));
    ok('재고 설명: 창고 입출고장 마지막 입출고일', new RegExp('창고 입출고장 마지막 ' + mAgo(1) + '-10').test(t), (t.match(/재고 = .{0,120}/) || [])[0]);
  });

  // ------------------------------------------------------------------------------------------
  await sec('4. 리드타임 (기본 · 품목별)', async () => {
    await A.fill('main .toolbar input[type=number]', '30'); await A.press('main .toolbar input[type=number]', 'Tab');
    await A.waitForFunction(() => ERP.db.setting('buyLead', '') === 30, null, { timeout: 10000 }); await A.waitForTimeout(300);
    let r = await rowOf('R-011');
    eq('기본 30일: 도착 예정 11-20 · 리드타임 동안 133.33 → 부족 183.33 → 권장 200 (백 단위로 올림)', [r[16], r[17], r[18], r[19]], ['', '2026-11-20', '주문 필요', '200']);
    const late = '2026-10-21' < today;
    r = await rowOf('R-001'); eq('R-001: 09-21 + 30 = 10-21 (오늘이 지났으면 늦음 표시)', [r[17], await ev(() => { const tr = Array.from(document.querySelectorAll('main table.buy-tbl tbody tr')).find(x => x.children[1].innerText.trim() === 'R-001'); const s = tr.children[17].querySelector('span'); return !!(s && s.style.color); })], ['2026-10-21', late]);
    // 품목별 60일
    await ev(() => { const tr = Array.from(document.querySelectorAll('main table.buy-tbl tbody tr')).find(x => x.children[1].innerText.trim() === 'R-011'); const i = tr.children[16].querySelector('input'); i.value = '60'; i.dispatchEvent(new Event('change', { bubbles: true })); });
    await A.waitForTimeout(300);
    r = await rowOf('R-011');
    eq('R-011 품목별 60일: 도착 예정 12-20 · 부족 316.67 → 권장 400 (바로 다시 계산)', [r[16], r[17], r[19]], ['60', '2026-12-20', '400']);
    eq('품목에 저장', await ev(() => ERP.inv.item('R-011').lead_days), 60);
    // 품목별 주문 단위 50 → 350, 비우면 다시 400
    const setStep = (v) => ev((v) => { const tr = Array.from(document.querySelectorAll('main table.buy-tbl tbody tr')).find(x => x.children[1].innerText.trim() === 'R-011'); const i = tr.children[20].querySelector('input'); i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    await setStep('50'); await A.waitForTimeout(300); const s50 = (await rowOf('R-011'))[19]; const st50 = await ev(() => ERP.inv.item('R-011').buy_step);
    await setStep(''); await A.waitForTimeout(300); const s0 = (await rowOf('R-011'))[19];
    eq('품목별 주문 단위 50 → 권장 350 (저장) · 비우면 안전재고 자릿수로 400', [s50, st50, s0], ['350', 50, '400']);
  });

  // ------------------------------------------------------------------------------------------
  await sec('5. 주문 넣기 · 권장 주문량 넣기 · 입고 완료', async () => {
    await A.fill('main .toolbar input[type=date]', '2026-10-25'); await A.click('main button:has-text("주문 칸")'); await A.waitForTimeout(300);
    const head = await ev(() => Array.from(document.querySelectorAll('main table.buy-tbl thead th')).slice(8, 11).map(th => th.querySelector('div').textContent.trim()));
    eq('새 주문 칸 2026-10-25 (최근 날짜가 앞)', head, ['2026-10-25', '2026-10-21', '2026-09-21']);
    await ev(() => { const tr = Array.from(document.querySelectorAll('main table.buy-tbl tbody tr')).find(x => x.children[1].innerText.trim() === 'R-027P'); const i = tr.children[8].querySelector('input'); i.value = '40'; i.dispatchEvent(new Event('change', { bubbles: true })); });
    await A.waitForTimeout(300);
    let r = await rowOf('R-027P');
    eq('R-027P 10-25 에 40 → 합계 70 · 부족 30 → 권장 100 (바로 다시 계산)', [r[7], r[11], r[20]], ['', '70', '100']);
    eq('주문 저장 (ERP 에서 넣은 주문)', await ev(() => ERP.db.rows('buy_orders').filter(o => o.code === 'R-027P').map(o => [o.date, o.qty, o.unit, o.status, o.src])), [['2026-10-25', 40, 'kg', 'open', 'erp']]);
    await ev(() => ERP.render()); await A.waitForTimeout(200);
    await A.click('main button:has-text("권장 주문량 넣기")'); ok('확인 창', await confirmModal()); await A.waitForTimeout(400);
    const add = await ev(() => ERP.db.rows('buy_orders').filter(o => o.date === '2026-10-25').map(o => [o.code, o.qty]).sort());
    eq('권장 주문량 → 10-25 칸 (안전재고 자릿수 단위, 그 날 주문이 이미 있는 R-027P 는 그대로, 따로 관리 줄 R-015 BIC Pigment 도)', add, [['R-011', 400], ['R-015', 100], ['R-027P', 40], ['R-031A', 700], ['R-300C', 500], ['R-380', 1000]]);
    eq('따로 관리 줄의 주문은 그 구분으로 (첫 줄 R-015 는 주문 없음)', await ev(() => ERP.db.rows('buy_orders').filter(o => o.code === 'R-015').map(o => [o.date, o.pool || '', o.qty])), [['2026-10-25', 'BIC Pigment', 100]]);
    let p2 = await rowOf('R-015', 'BIC Pigment');
    eq('따로 관리 줄: 10-25 주문 100 → 합계 260 · 충분', [p2[8], p2[11], p2[19]], ['100', '260', '충분']);
    // 따로 관리 재고: 표에서 고치기 · 그 주문을 입고 완료하면 그 재고에 더함 (되돌리면 뺌)
    const poolInv = () => ev(() => ERP.db.rows('buy_pools').map(p => p.inv)[0]);
    const poolTr = (fn) => ev((src) => { const tr = Array.from(document.querySelectorAll('main table.buy-tbl tbody tr')).find(x => x.children[0].innerText.trim() === 'BIC Pigment' && x.children[1].querySelector('b').textContent.trim() === 'R-015'); return (new Function('tr', src))(tr); }, fn);
    await poolTr("const i = tr.children[6].querySelector('input'); i.value = '170'; i.dispatchEvent(new Event('change', { bubbles: true }));"); await A.waitForTimeout(300);
    const e170 = [await poolInv(), await ev(() => ERP.db.rows('buy_pools')[0].inv_date), (await rowOf('R-015', 'BIC Pigment'))[11]];
    await poolTr("const i = tr.children[6].querySelector('input'); i.value = '160'; i.dispatchEvent(new Event('change', { bubbles: true }));"); await A.waitForTimeout(300);
    eq('따로 관리 재고를 표에서 170 으로 → 저장 · 날짜 오늘 · 합계 270 (다시 160 으로)', [e170, await poolInv()], [[170, today, '270'], 160]);
    await poolTr("Array.from(tr.children[8].querySelectorAll('button')).find(b => b.textContent === '✓').click();"); await A.waitForTimeout(400);
    const recvInv = await poolInv(); p2 = await rowOf('R-015', 'BIC Pigment');
    await poolTr("tr.children[8].querySelector('button').click();"); await A.waitForTimeout(400);
    eq('따로 관리 줄의 주문 100 입고 완료 → 그 재고 160 + 100 = 260 · 칸은 ✓ 100 / 되돌리면 160', [recvInv, p2[8], await poolInv(), await ev(() => ERP.db.rows('buy_orders').filter(o => o.pool).map(o => o.status))], [260, '✓ 100', 160, ['open']]);
    // 09-21 칸 입고 완료
    await ev(() => { const th = Array.from(document.querySelectorAll('main table.buy-tbl thead th')).find(x => x.querySelector('div') && x.querySelector('div').textContent.trim() === '2026-09-21'); Array.from(th.querySelectorAll('button')).find(b => /입고 완료/.test(b.textContent)).click(); });
    ok('확인 창 (입고 완료)', await confirmModal()); await A.waitForTimeout(400);
    eq('입고 완료 → 상태 · 입고일', await ev(() => ERP.db.rows('buy_orders').filter(o => o.code === 'R-001').map(o => [o.date, o.status, !!o.recv])), [['2026-09-21', 'recv', true]]);
    r = await rowOf('R-001');
    eq('R-001: 합계 1,380 → 주문 필요 · 부족 20 → 권장 1,000 (안전재고 1,400 은 천 단위) · 칸은 ✓ 500', [r[7], r[11], r[19], r[20], r[10]], ['', '1,380', '주문 필요', '1,000', '✓ 500']);
    eq('재고는 바뀌지 않음 (입고는 창고 입출고장 · 수불로)', await ev(() => ERP.calc.stock().get('R-001').bal), 1380);
    // 입고예정 칸에 직접 넣기 (R-015 60)
    await ev(() => { const tr = Array.from(document.querySelectorAll('main table.buy-tbl tbody tr')).find(x => x.children[1].innerText.trim() === 'R-015'); const i = tr.children[7].querySelector('input'); i.value = '60'; i.dispatchEvent(new Event('change', { bubbles: true })); });
    await A.waitForTimeout(300);
    r = await rowOf('R-015');
    eq('R-015 입고예정 칸 60 → 합계 220 (바로 다시 계산) · 입고예정 한 줄 저장', [r[7], r[11], await ev(() => ERP.db.rows('buy_orders').filter(o => o.code === 'R-015' && !o.pool).map(o => [o.kind, o.qty, o.status, o.src]))], ['60', '220', [['inc', 60, 'open', 'erp']]]);
  });

  // ------------------------------------------------------------------------------------------
  await sec('6. 같은 파일을 다시 올려도 늘지 않음 (입고 완료 · ERP 주문은 그대로)', async () => {
    const before = await ev(() => ({ items: ERP.db.rows('items').length, orders: ERP.db.rows('buy_orders').length, recv: ERP.db.rows('buy_orders').filter(o => o.status === 'recv').length, buy: ERP.db.rows('items').filter(m => m.buy).length }));
    await ev(() => { ERP.state.dataTab = 'import'; ERP.state.imp = { jobs: [] }; ERP.goto('data'); ERP.render(); }); await A.waitForTimeout(300);
    await A.setInputFiles('.drop input[type=file]', [fb]); await A.waitForFunction(() => ERP.state.imp.jobs.length >= 2, null, { timeout: 60000 }); await A.waitForTimeout(300);
    const p = await ev(() => ERP.state.imp.jobs.filter(x => x.kind === 'buy_orders').map(x => x.preview(x).parts.map(q => q[0] + '=' + q[1]))[0]);
    ok('미리보기: 새 주문 0 · 입고 완료로 둔 주문 1 그대로 · 파일의 입고예정 칸에 없는 R-015 입고예정 1 지움', p.includes('새 주문=0') && p.includes('입고 완료로 둔 주문은 그대로=1') && p.includes('파일에서 지운 주문=1'), p);
    await ev(() => { ERP.state.imp.jobs.filter(x => x.kind === 'buy_stock').forEach(x => { x.include = false; }); });   // 재고 맞춤은 8-2 에서
    await A.click('text=선택 항목 모두 반영');
    await A.waitForFunction(() => !!Array.from(document.querySelectorAll('main h3')).find(x => /반영 결과/.test(x.textContent)), null, { timeout: 60000 });
    const after = await ev(() => ({ items: ERP.db.rows('items').length, orders: ERP.db.rows('buy_orders').length, recv: ERP.db.rows('buy_orders').filter(o => o.status === 'recv').length, buy: ERP.db.rows('items').filter(m => m.buy).length }));
    eq('품목 · 입고 완료 · 해외 주문 품목 그대로, 주문은 R-015 입고예정만 빠짐 (ERP 에서 넣은 10-25 주문은 그대로)', after, Object.assign({}, before, { orders: before.orders - 1 }));
    eq('10-25 주문 그대로 (파일에 없는 날짜, 따로 관리 줄 주문 포함)', await ev(() => ERP.db.rows('buy_orders').filter(o => o.date === '2026-10-25').length), 6);
    eq('따로 관리하는 재고 그대로 (1줄)', await ev(() => ERP.db.rows('buy_pools').length), 1);
    eq('R-011 품목별 리드타임 그대로', await ev(() => ERP.inv.item('R-011').lead_days), 60);
  });

  // ------------------------------------------------------------------------------------------
  await sec('7. 발주 · 안전재고 목록에서는 해외 주문 품목을 뺌', async () => {
    await ev(() => ERP.goStock('reorder')); await A.waitForFunction(() => /발주 필요 목록/.test(document.querySelector('main').innerText), null, { timeout: 10000 });
    const t = await buyText();
    ok('R-100 (국내) 은 목록에 · R-011 (해외) 은 없음 · 안내', /R-100/.test(t) && !/R-011/.test(t) && /해외 주문 품목 9개 \(그중 주문 필요 \d+개\)는 이 목록에서 빼고/.test(t), t.slice(0, 500));
    const need = await ev(() => { const tr = Array.from(document.querySelectorAll('main table.tbl tbody tr')).find(x => /R-100/.test(x.innerText)); return tr ? tr.children[8].innerText.trim() : null; });
    eq('권장 발주량 숫자 (안전재고 10 − 재고 5 = 5 kg)', need, '5 kg');
  });

  // ------------------------------------------------------------------------------------------
  await sec('8. 주문 파일 만들기 (자재구매 파일과 같은 서식) · 다시 올리면 인식', async () => {
    await ev(() => ERP.goStock('buy')); await A.waitForFunction(() => !!document.querySelector('main table.buy-tbl'), null, { timeout: 15000 });
    await ev(() => { window.__book = null; ERP.__save = ERP.xl.saveBook; ERP.xl.saveBook = (wb, name) => { window.__book = { wb, name }; }; });
    await A.click('main button:has-text("주문 파일 만들기")');
    ok('확인 창 (10-25 칸에 주문이 없는 주문 필요 품목 R-001 → 권장 주문량을 넣고 만듦)', await confirmModal()); await A.waitForTimeout(500);
    const x = await ev(() => { const b = window.__book; ERP.xl.saveBook = ERP.__save; if (!b) return null; const X = window.XLSX; const sn = b.wb.SheetNames[0]; const ws = b.wb.Sheets[sn];
      const M = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }); const row = (c) => M.findIndex(r => r && r[2] === c);
      const r011 = row('R-011'); const tot = ws['L' + (r011 + 1)];
      return { name: b.name, sn, r1: M[0].slice(0, 5), r2: [M[1][3], M[1][4], ws.E2 && ws.E2.z], head: M[3], dz: ws.J4 && ws.J4.z, n: M.length - 4, merges: ws['!merges'],
        r011: M[r011], tot: tot && [tot.f, tot.v], r001: M[row('R-001')], r021: M[row('R-021')], pool: M.find(r => r && r[1] === 'BIC Pigment' && r[2] === 'R-015') }; });
    const ser = (iso) => serial(iso);
    eq('파일 이름 · 시트 이름 = 올린 파일과 같은 모양 (yymmdd 자재구매.xlsx · Oder Korea)', x && [x.name, x.sn], [today.slice(2).replace(/-/g, '') + ' 자재구매.xlsx', 'Oder Korea']);
    eq('1~2행: 제목 · Author · Date (올린 파일에서 가져온 제목 · 작성자, 오늘 날짜)', x && [x.r1, x.r2], [[null, 'Bosung Vina Purchase of materials', null, 'Author : ', 'Test'], ['Date : ', ser(today), 'm/d/yy']]);
    eq('4행 머리 = 올린 파일과 같음 (주문일 칸은 날짜, 이번 주문일이 앞)', x && [x.head, x.dz], [[null, 'Category', 'Item Code', 'Item Name', 'Item Name Kr', 'Safety stock', 'Unit', 'Inventory', '입고예정', ser('2026-10-25'), ser('2026-10-21'), 'Total', 'kg/month', 'ea/month', 'Max', 'Min', 'Average'], 'mm"월" dd"일"']);
    eq('R-011 줄: 구분 · 코드 · 품명 · 한글 품명 · 안전재고 · 단위 · 재고 · 입고예정 · 10-25 400 · 10-21 100 · Total 700 (수식) · kg/월 · ea/월 · 최대 · 최소 · 평균', x && [x.r011, x.tot], [[null, 'Pigment', 'R-011', 'YELLOW 10G', 'YELLOW F-10G', 350, 'kg', 200, null, 400, 100, 700, 140, 14, 160, 100, 133.33], ['SUM(H6:K6)', 700]]);
    eq('R-001 줄: 권장 주문량 1,000 (안전재고 1,400 → 천 단위) 을 10-25 칸에 · Total 2,380', x && x.r001 && [x.r001[5], x.r001[7], x.r001[9], x.r001[10], x.r001[11]], [1400, 1380, 1000, null, 2380]);
    eq('R-021 줄: 입고예정 150 · Total 550 / 따로 관리 줄 R-015 BIC Pigment: 재고 160 · 10-25 100 · Total 260', x && [[x.r021[8], x.r021[11]], x.pool && [x.pool[5], x.pool[7], x.pool[9], x.pool[11]]], [[150, 550], [200, 160, 100, 260]]);
    eq('줄 10 (품목 9 + 따로 관리 1) · 제목 칸 합침 (B1:C2)', x && [x.n, x.merges], [10, [{ s: { r: 0, c: 1 }, e: { r: 1, c: 2 } }]]);
    eq('주문 파일을 만들며 넣은 주문 (ERP 에 입고 대기로)', await ev(() => ERP.db.rows('buy_orders').filter(o => o.code === 'R-001' && o.date === '2026-10-25').map(o => [o.qty, o.status, o.src])), [[1000, 'open', 'erp']]);
    const re = await ev(() => { const b = ERP.buy.orderBook('2026-10-25'); const jobs = ERP.xl.analyze(b.wb, { file: b.name });
      const j = jobs.find(q => q.kind === 'buy_items'), o = jobs.find(q => q.kind === 'buy_orders'); return { n: j ? j.rows.length : null, pools: j ? j.B.rows.filter(r => r.pool).map(r => r.code + ' ' + r.pool) : null, dates: j ? j.B.dates : null, fdate: j ? j.B.fdate : null, head: j ? j.B.head : null, orders: o ? o.rows.length : null }; });
    eq('만든 주문 파일을 다시 올리면 자재구매 파일로 인식 (줄 10 · 따로 관리 1 · 주문일 칸 2 · 파일 날짜 오늘 · 주문 8 + 입고예정 1)', re, { n: 10, pools: ['R-015 BIC Pigment'], dates: ['2026-10-25', '2026-10-21'], fdate: today, head: { title: 'Bosung Vina Purchase of materials', author: 'Test', sheet: 'Oder Korea' }, orders: 9 });
  });

  // ------------------------------------------------------------------------------------------
  await sec('8-2. 재고를 파일 재고(Inventory 칸)에 맞춤 (1.11.1 — 파일 날짜에 조정)', async () => {
    // 오늘 날짜 파일: R-011 250 (ERP 200 → +50) · R-021 380 (400 → −20) · R-380 1,100 kg (16.8 ROLL → 17.6 ROLL) · R-300C 재고 칸 빈칸 · 나머지는 ERP 와 같음
    const inv = { 'R-011': 250, 'R-021': 380, 'R-380': 1100 };
    const mk = (over) => ROWS.map(r => { const x = r.slice(); if (x[2] in over) x[7] = over[x[2]]; return x; });
    const f2 = path.join(xdir, 'buy_today.xlsx'), f3 = path.join(xdir, 'buy_today_b.xlsx');
    XLSX.writeFile(buyBook(mk(inv), today), f2); XLSX.writeFile(buyBook(mk(Object.assign({}, inv, { 'R-011': 260 })), today), f3);
    const up = async (f) => {
      await ev(() => { ERP.state.dataTab = 'import'; ERP.state.imp = { jobs: [] }; ERP.goto('data'); ERP.render(); }); await A.waitForTimeout(300);
      await A.setInputFiles('.drop input[type=file]', [f]); await A.waitForFunction(() => ERP.state.imp.jobs.length >= 3, null, { timeout: 60000 }); await A.waitForTimeout(300);
      const p = await ev(() => { const j = ERP.state.imp.jobs.find(x => x.kind === 'buy_stock'); const v = j.preview(j); return { parts: v.parts.map(q => q[0] + '=' + q[1]), detail: v.detail, include: !!j.include }; });
      await A.click('text=선택 항목 모두 반영');
      await A.waitForFunction(() => !!Array.from(document.querySelectorAll('main h3')).find(x => /반영 결과/.test(x.textContent)), null, { timeout: 60000 });
      await ev(async () => { if (ERP.db.flush) await ERP.db.flush(); });
      return p;
    };
    const adjOf = () => ev(() => ERP.db.rows('stock_tx').filter(t => t.src === 'buy').map(t => [t.date, t.code, t.kind, t.qty, t.unit, t.to_scope, t.purpose]).sort((a, b) => a[1].localeCompare(b[1])));
    const balOf = () => ev(() => ['R-011', 'R-021', 'R-380', 'R-200', 'R-001'].map(c => Math.round(ERP.calc.stock().get(c).bal * 10000) / 10000));
    let p = await up(f2);
    ok('미리보기: 재고 맞춤 3 (오늘 조정) · 이미 같음 5 · 파일에 재고 없음 1 · 따로 관리 1 (파일 값 그대로) · 기본으로 반영', p.include && p.parts.includes('재고 맞춤 (' + today + ' 조정)=3') && p.parts.includes('이미 같음=5') && p.parts.includes('파일에 재고 없음 (그대로)=1') && p.parts.includes('따로 관리하는 재고 (파일 값 그대로)=1'), p);
    ok('미리보기 내용: R-011 200 → 250 kg (+50) · R-021 400 → 380 (-20) · R-380 16.8 → 17.6 ROLL (+0.8)', /R-011 200 → 250 kg \(\+50\)/.test(p.detail) && /R-021 400 → 380 kg \(-20\)/.test(p.detail) && /R-380 16\.8 → 17\.6 ROLL \(\+0\.8\)/.test(p.detail), p.detail);
    eq('조정 3줄 (파일 날짜 · 창고 · 재고 맞춤)', await adjOf(), [[today, 'R-011', 'ADJ', 50, 'kg', 'WH', '자재구매 파일 재고 맞춤'], [today, 'R-021', 'ADJ', -20, 'kg', 'WH', '자재구매 파일 재고 맞춤'], [today, 'R-380', 'ADJ', 0.8, 'ROLL', 'WH', '자재구매 파일 재고 맞춤']]);
    eq('ERP 재고 = 파일 재고 (R-011 250 · R-021 380 · R-380 17.6 ROLL = 1,100 kg) · 같던 품목은 그대로', await balOf(), [250, 380, 17.6, 4662000, 1380]);
    p = await up(f2);
    ok('같은 파일을 다시 올리면: 같은 날 예전 조정 3을 바꿈 (늘지 않음)', p.parts.includes('같은 날 예전 조정은 바꿈=3') && p.parts.includes('재고 맞춤 (' + today + ' 조정)=3'), p);
    eq('다시 올려도 조정 3줄 · 재고 그대로', [(await adjOf()).length, await balOf()], [3, [250, 380, 17.6, 4662000, 1380]]);
    await up(f3);
    eq('같은 날 파일의 R-011 이 260 이면 그 날 조정만 다시 (+60) → 260', [(await adjOf()).map(a => [a[1], a[3]]), (await balOf())[0]], [[['R-011', 60], ['R-021', -20], ['R-380', 0.8]], 260]);
    await ev(() => ERP.goStock('buy')); await A.waitForFunction(() => !!document.querySelector('main table.buy-tbl'), null, { timeout: 15000 });
    const r = await rowOf('R-011'); const t = await buyText();
    ok('해외 주문 표: R-011 재고 260 (파일과 같아 "파일 …" 없음) · 위 숫자에 "파일 재고와 다름" 없음', r[6] === '260' && !/파일 재고와 다름/.test(t), { r6: r[6] });
    await ev(() => { ERP.state.txl = { from: '2000-01-01', to: '2099-12-31', kind: '', src: '', q: 'R-011', page: 0 }; ERP.goStock('ledger'); ERP.render(); }); await A.waitForTimeout(400);
    const lt = await buyText();
    ok('수불 내역: 출처 자재구매 파일 · 용도 자재구매 파일 재고 맞춤', /자재구매 파일 재고 맞춤/.test(lt) && /자재구매 파일/.test(lt), lt.slice(0, 400));
  });

  await sec('8-3. 현장 재고 = 공정별 · 대분류 현재 재고 (1.11.4) · 일보 조회에 PO 번호 → 수주 관리', async () => {
    await ev(async (o) => { const DB = ERP.db;
      DB.addMany('items', [
        { code: 'T-M1', name: 'MINI RED', unit: 'PCS', stage: 'WIP', line: 'MINI', src: 'test' }, { code: 'T-M2', name: 'MINI BLUE', unit: 'PCS', stage: 'WIP', line: 'MINI', src: 'test' },
        { code: 'T-D1', name: 'DIAL RED', unit: 'PCS', stage: 'WIP', line: 'REG', src: 'test' }, { code: 'T-C1', name: 'CORE MINI RED', unit: 'PCS', stage: 'WIP00', line: 'MINI', src: 'test' },
        { code: 'T-P1', name: 'PENCIL 12 MANILA', unit: 'SET', stage: 'SG', line: 'PEN', src: 'test' }, { code: 'T-P2', name: 'PENCIL 12 BOX', unit: 'CT', stage: 'FG', line: 'PEN', src: 'test' }]);
      const op = (code, qty, unit) => ({ date: o.openDate, scope: 'FAC', code, qty, unit });
      DB.addMany('stock_open', [op('T-M1', 100, 'PCS'), op('T-M2', 20, 'PCS'), op('T-D1', 30, 'PCS'), op('T-C1', 50, 'PCS'), op('T-P1', 7, 'SET'), op('T-P2', 3, 'CT')]);
      DB.add('po', { po_no: 'PO-T9', item_no: 'T-P1', customer: 'TEST', kind: 'Pencil', sets: 10, pcs: 120, date: o.today, due: o.today });
      DB.add('prod_log', { date: o.today, process: 'PCK', shift: 'D', code: 'T-P1', name: 'PENCIL 12 MANILA', po_no: 'PO-T9', ok_qty: 5, ok_ea: 60, unit: 'set', source: 'manual' });
      await DB.flush(); }, { openDate, today });
    await ev(() => { ERP.state.stk_floor = null; ERP.goStock('floor'); ERP.render(); }); await A.waitForTimeout(400);
    const fl = await ev(() => ({ stage: document.querySelectorAll('main .flow .st:not(.pl)').length,
      groups: Array.from(document.querySelectorAll('main .flow .grp')).map(g => [g.querySelector('small').textContent, Array.from(g.querySelectorAll('.st.pl')).map(b => b.innerText.replace(/\s+/g, ' ').trim())]) }));
    eq('현장 재고 위 = 공정별 (리필 성형 · 조립 · 포장) · 대분류만 (Mini · Dial · Pencil) · 현재 재고 (단계 카드 없음, 포장은 SET · CT 나눔 — 마니라 7 + 오늘 포장 일보 5 = 12 SET)', fl, { stage: 0, groups: [['리필 성형', ['Mini 50 PCS']], ['조립', ['Mini 120 PCS', 'Dial 30 PCS']], ['포장', ['Pencil 12 SET 3 CT']]] });
    await A.click('main .flow .st.pl[data-proc="ASM"][data-line="MINI"]'); await A.waitForTimeout(300);
    const f = await ev(() => ({ proc: ERP.state.stk_floor.proc, line: ERP.state.stk_floor.line, codes: Array.from(document.querySelectorAll('main table.tbl tbody tr')).map(tr => tr.children[0].innerText.trim()).sort(), chip: Array.from(document.querySelectorAll('main .toolbar button')).map(b => b.textContent).filter(t => /×$/.test(t)) }));
    eq('조립 · Mini 칸 → 표 = 조립 단계의 Mini 품목 (T-M1 · T-M2) · "조립 · Mini ×"', f, { proc: 'ASM', line: 'MINI', codes: ['T-M1', 'T-M2'], chip: ['조립 · Mini ×'] });
    await A.click('main .toolbar button:has-text("조립 · Mini ×")'); await A.waitForTimeout(300);
    eq('× → 거르기 풀림', await ev(() => [ERP.state.stk_floor.proc, ERP.state.stk_floor.line]), ['', '']);
    // 생산 관리 → 일보 조회: PO 번호 칸 · 수주 보기 → 수주 관리에서 그 PO
    await ev((d) => { ERP.state.prodTab = 'log'; ERP.state.plog = { from: d, to: d }; ERP.goto('production'); }, today); await A.waitForTimeout(600);
    const lg = await ev(() => { const head = Array.from(document.querySelectorAll('main table.tbl thead th')).map(t => t.textContent.trim()); const i = head.indexOf('PO 번호');
      const tr = Array.from(document.querySelectorAll('main table.tbl tbody tr')).find(x => /T-P1/.test(x.innerText)); return { i, po: tr && i >= 0 ? tr.children[i].innerText.trim() : null, link: tr ? !!Array.from(tr.querySelectorAll('a')).find(a => /수주 보기/.test(a.textContent)) : false }; });
    ok('일보 조회에 PO 번호 칸 · 포장 일보의 PO-T9 · 수주 보기 링크', lg.i > 0 && lg.po === 'PO-T9' && lg.link, lg);
    await ev(() => { const tr = Array.from(document.querySelectorAll('main table.tbl tbody tr')).find(x => /T-P1/.test(x.innerText)); Array.from(tr.querySelectorAll('a')).find(a => /수주 보기/.test(a.textContent)).click(); });
    await A.waitForFunction(() => location.hash === '#/orders' && /PO-T9/.test((document.querySelector('main aside') || {}).innerText || ''), null, { timeout: 15000 }).catch(() => {});
    eq('수주 보기 → 수주 관리 · 그 PO 상세', await ev(() => [location.hash, ERP.state.ord.sel, /PO-T9/.test((document.querySelector('main aside') || {}).innerText || '')]), ['#/orders', 'PO-T9', true]);
    await ev(() => ERP.goStock('buy')); await A.waitForTimeout(300);
  });

  await sec('9. 휴대폰 폭 · 베트남어 · 오류 없음', async () => {
    await A.setViewportSize({ width: 375, height: 812 }); await ev(() => { ERP.goStock('buy'); ERP.render(); }); await A.waitForTimeout(500);
    const w = await ev(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, tbl: !!document.querySelector('main table.buy-tbl') }));
    ok('휴대폰 폭(375px): 화면은 가로로 넘치지 않음 (표만 옆으로 밀림)', w.tbl && w.doc <= w.win + 1, w);
    await A.setViewportSize({ width: 1480, height: 920 });
    await ev(() => ERP.setLang('vi')); for (const tab of ['buy', 'mat', 'reorder']) { await ev((x) => { ERP.goStock(x); ERP.render(); }, tab); await A.waitForTimeout(200); }
    await ev(() => { ERP.goStock('buy'); ERP.render(); }); await A.waitForTimeout(300);
    const vi = await buyText();
    ok('베트남어: 탭 이름 · 표', /Đặt hàng nước ngoài/.test(vi) && /Cần đặt/.test(vi), vi.slice(0, 300));
    await ev(() => ERP.setLang('ko')); await ev(() => ERP.render()); await A.waitForTimeout(200);
    const txt = await buyText();
    ok('null · undefined · NaN 글자 없음', !/\bnull\b|\bundefined\b|\bNaN\b/.test(txt + vi), (txt.match(/.{0,40}(null|undefined|NaN).{0,40}/) || [])[0]);
    // 빈 상태 (해외 주문 품목 없음)
    await ev(() => { ERP.db.rows('items').forEach(m => { if (m.buy) m.buy = false; }); ERP.db.touch('items'); ERP.goStock('buy'); ERP.render(); }); await A.waitForTimeout(300);
    ok('품목이 없으면 안내 · 자재구매 파일 올리기 버튼', /해외 주문 품목이 아직 없습니다/.test(await buyText()) && !!(await A.$('main button:has-text("자재구매 파일 올리기")')));
    eq('페이지 오류 없음', errors, []);
  });

  await browser.close(); S.close();
  console.log('\n' + (fail ? '✗ 실패 ' + fail + '개' : '✓ 모두 통과') + '  (통과 ' + pass + ' / 전체 ' + (pass + fail) + ')');
  if (failures.length) { console.log('\n실패 목록:'); failures.forEach(x => console.log(' - ' + x)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
