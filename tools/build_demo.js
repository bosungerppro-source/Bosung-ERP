// Builds a single-file demo: dist/ERP_Demo.html (CSS + JS + libs + trimmed seed inlined). Usage: node tools/build_demo.js [sinceDate]
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), app = path.join(root, 'app');
const since = process.argv[2] || '2026-07-01';
const seed = JSON.parse(fs.readFileSync(path.join(app, 'seed/seed.json'), 'utf8'));
if (seed.prod_log) seed.prod_log = seed.prod_log.filter(r => r.date >= since);
if (seed.movements) seed.movements = seed.movements.filter(r => !r.date || r.date >= since);
const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
let out = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, f) => '<style>' + fs.readFileSync(path.join(app, f), 'utf8') + '</style>')
  .replace(/<link rel="icon"[^>]*>/, '');
const seedTag = '<script>window.ERP_SEED=' + safe(JSON.stringify(seed)) + ';</script>';
out = out.replace(/<script src="([^"]+)"><\/script>/g, (m, f) => '<script>' + safe(fs.readFileSync(path.join(app, f), 'utf8')) + '</script>');
out = out.replace('<script>/* Storage', seedTag + '<script>/* Storage'); // seed before db.js
if (!out.includes('window.ERP_SEED')) throw new Error('seed marker not found');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/ERP_Demo.html'), out);
console.log('dist/ERP_Demo.html', (out.length / 1e6).toFixed(1) + ' MB (since ' + since + ')');
