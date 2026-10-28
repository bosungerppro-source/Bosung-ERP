'use strict';
/* 1.13.16 데모 자료 정리 — 한 번만 실행 (다시 실행해도 결과는 같다).
   사용자 2026-10-28 "생산관리에서 핫포일 스탬핑 전부 삭제 생산 품목에 넣지 않는다. 소모품으로만 관리 원부자재 재고만 입출고로 수량관리":
   핫포일 스탬핑 (STP) 은 생산 공정이 아님 → 예시 생산 일보의 스탬핑 줄 · 스탬핑 설비 삭제 (핫포일 품목 · 원부자재 재고는 그대로)
   사용: node tools/fix_seed_v18.js   → app/seed/seed.json, seed/seed.json */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const file = path.join(ROOT, 'app', 'seed', 'seed.json');
const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
const before = { prod: seed.prod_log.length, mach: (seed.machines || []).length };

seed.prod_log = seed.prod_log.filter(r => r.process !== 'STP');
seed.machines = (seed.machines || []).filter(r => r.process !== 'STP');

const json = JSON.stringify(seed);
fs.writeFileSync(file, json); fs.writeFileSync(path.join(ROOT, 'seed', 'seed.json'), json);
console.log('prod_log ' + before.prod + ' → ' + seed.prod_log.length + ' · machines ' + before.mach + ' → ' + seed.machines.length + ' · ' + (json.length / 1e6).toFixed(1) + ' MB');
