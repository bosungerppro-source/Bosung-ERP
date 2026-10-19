'use strict';
/* 8차(v1.3.0) 데모 자료 정리 — 한 번만 실행 (다시 실행해도 결과는 같다).
   1) 누적 시트(Ho_so)와 같은 날짜 · 공정의 일보 행 삭제 (2026-10-08 조립 · 포장 · 리필이 두 번 들어가 있었음)
   2) 8월 10일로 잘못 들어간 종이권취 일보(파일명 8-10-2026 = 10월 8일, 엑셀 날짜 칸이 월/일로 저장됨) → 10월 8일로 고친 뒤 1) 규칙 적용
   3) 수주 표에 데이터로 들어간 머리글 행(Po No / Item No / Checking) 삭제
   4) 기초재고 기준일(meta.openDate) 저장
   사용: node tools/fix_seed_v8.js   → app/seed/seed.json, seed/seed.json */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const file = path.join(ROOT, 'app', 'seed', 'seed.json');
const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
const before = { prod: seed.prod_log.length, po: seed.po.length };

seed.prod_log.forEach(r => { if (r.process === 'WRP' && r.source === 'daily-report' && r.date === '2026-08-10') r.date = '2026-10-08'; });
const hist = new Set(seed.prod_log.filter(r => r.source === 'history').map(r => r.date + '|' + r.process));
seed.prod_log = seed.prod_log.filter(r => !(r.source === 'daily-report' && hist.has(r.date + '|' + r.process)));
seed.po = seed.po.filter(p => !/^po no$/i.test(String(p.po_no || '').trim()));
const od = { WH: null, FAC: null }; (seed.stock_open || []).forEach(r => { const sc = r.scope === 'FAC' ? 'FAC' : 'WH'; if (r.date && (!od[sc] || r.date > od[sc])) od[sc] = r.date; });
seed._meta = Object.assign({}, seed._meta, { openDate: od });

const json = JSON.stringify(seed);
fs.writeFileSync(file, json); fs.writeFileSync(path.join(ROOT, 'seed', 'seed.json'), json);
console.log('prod_log ' + before.prod + ' → ' + seed.prod_log.length + ' · po ' + before.po + ' → ' + seed.po.length + ' · openDate ' + JSON.stringify(od) + ' · ' + (json.length / 1e6).toFixed(1) + ' MB');
