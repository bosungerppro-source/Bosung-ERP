'use strict';
/* 6차 시드 만들기: 예전 샘플(예시) + ECOUNT 자료(품목등록·창고리스트·재고현황 2개·ERP CODE 설명)를 실제 업로드 화면으로 반영해 seed.json 을 다시 만든다.
   사용: npm run seed:v6 [-- <ECOUNT 엑셀 폴더>]   (기본 폴더 seed/ecount, Playwright 필요: npm i -D playwright)
   (개발용 — Playwright 필요)  결과: app/seed/seed.json, seed/seed.json */
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const dir = process.argv[2] || path.join(ROOT, 'seed', 'ecount'); if (!fs.existsSync(dir)) { console.error('usage: node tools/build_seed_v6.js <folder with ECOUNT xlsx>  (default: seed/ecount)'); process.exit(1); }
let pw; try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium', '/usr/bin/chromium'].find(p => fs.existsSync(p));
const serverMod = require(path.join(ROOT, 'server.js'));
const SAMPLE = ['po', 'prod_log', 'bom', 'item_bom', 'recipes', 'refill_specs', 'products', 'semi_items', 'sub_materials', 'materials', 'inout', 'returns', 'stocktake', 'semi_stock', 'machines', 'partners'];

(async () => {
  const files = fs.readdirSync(dir).filter(f => /\.xlsx?$/i.test(f)).map(f => path.join(dir, f));
  console.log('files', files.map(f => path.basename(f)));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-seed6-'));
  const S = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir: data, host: '127.0.0.1', port: 4700 + Math.floor(Math.random() * 200) });
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 1480, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(S.url + '/#/data');
  await page.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready, null, { timeout: 120000 });
  // the old seed tables only (ECOUNT tables start empty)
  await page.evaluate(() => { ['items', 'warehouses', 'code_dict', 'stock_open', 'stock_tx', 'ecount_snap', 'uploads'].forEach(t => ERP.db.replace(t, [])); ERP.state.dataTab = 'import'; ERP.render(); });
  await page.setInputFiles('.drop input[type=file]', files);
  await page.waitForFunction(() => ERP.state.imp && ERP.state.imp.jobs && ERP.state.imp.jobs.length >= 5, null, { timeout: 120000 });
  const jobs = await page.evaluate(() => ERP.state.imp.jobs.map(j => ({ file: j.file, label: j.label, table: j.table, rows: j.rows.length, mode: j.mode, scope: j.scope, date: j.date, include: j.include })));
  console.table(jobs);
  await page.click('text=선택 항목 모두 반영');
  await page.waitForFunction(() => ERP.db.rows('stock_open').length > 0 && !ERP.state.imp.jobs.length, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const out = await page.evaluate((SAMPLE) => {
    const DB = ERP.db; const o = {};
    Object.keys(ERP.TABLES).forEach(n => { o[n] = DB.rows(n).map(r => { const c = Object.assign({}, r); delete c._id; return c; }); });
    const sample = {}; SAMPLE.forEach(t => { if (o[t] && o[t].length) sample[t] = true; });
    o._meta = { sample, prodPost: 'in_bom' };
    return o;
  }, SAMPLE);
  const counts = {}; Object.keys(out).forEach(k => { if (Array.isArray(out[k])) counts[k] = out[k].length; });
  console.log('counts', counts);
  const json = JSON.stringify(out);
  fs.writeFileSync(path.join(ROOT, 'app/seed/seed.json'), json); fs.writeFileSync(path.join(ROOT, 'seed/seed.json'), json);
  console.log('seed written', (json.length / 1e6).toFixed(1) + ' MB', errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no errors');
  await browser.close(); S.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
