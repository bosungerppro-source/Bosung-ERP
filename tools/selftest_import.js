// Node harness: loads the app's parsers and runs them against the real sample files.
const path = require('path'), fs = require('fs');
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
global.document = { documentElement: {} };
global.XLSX = require('xlsx');
const app = path.join(__dirname, '..', 'app', 'js');
['core.js', 'schema.js'].forEach(f => require(path.join(app, f)));
require(path.join(app, 'xl.js'));
const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) { console.log('사용법: node tools/selftest_import.js <엑셀 폴더> [시트이름|all]   (예: npm test -- D:\\자료\\엑셀)'); process.exit(dir ? 1 : 0); }
const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx'));
for (const f of files) {
  const t0 = Date.now();
  const wb = XLSX.read(fs.readFileSync(path.join(dir, f)), { type: 'buffer', cellNF: true, cellDates: false, cellStyles: false, sheetRows: 40000 });
  const jobs = ERP.xl.analyze(wb, {});
  console.log('=== ' + f + '  (' + (Date.now() - t0) + 'ms)');
  jobs.forEach(j => {
    const ds = j.rows.map(r => r.date).filter(Boolean).sort();
    console.log('  [' + j.sheet + '] ' + (j.table || '-') + ' ' + j.id + ' rows=' + j.rows.length + ' mode=' + j.mode + (ds.length ? ' ' + ds[0] + '..' + ds[ds.length - 1] : '') + (j.error ? ' ERROR ' + j.error : ''));
    if (process.argv[3] && j.rows[0] && (process.argv[3] === 'all' || j.sheet.includes(process.argv[3]))) console.log('     ', JSON.stringify(j.rows[0]), '\n     ', JSON.stringify(j.rows[j.rows.length - 1]));
  });
}
