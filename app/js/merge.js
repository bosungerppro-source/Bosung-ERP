/* 행 합치기 (3-way merge) · 행 지문 · _id 맞추기 — 화면 (db.js, 9차: 다른 PC 와 저장이 겹칠 때) 과 서버 (cloudsync.js, 18차: 구글 드라이브 공유) 가 같이 쓴다.
   1.13.4: 예전에는 두 곳에 따로 있어 조금씩 달라졌다 (같은 _id 두 행 · 양쪽에 새로 생긴 같은 _id 의 겹침 수). 규칙을 바꿀 때는 여기만.
   브라우저: ERP.merge (core.js 다음, db.js 앞에서 부름) · Node: require('./app/js/merge.js') */
(function (root, factory) {
  const M = factory();
  if (typeof module === 'object' && module.exports) module.exports = M;
  else (root.ERP = root.ERP || {}).merge = M;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  /** 53-bit string hash (cyrb53) — 행 지문 = 행 JSON 의 해시 */
  function hash(s) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  const sig = (r) => hash(JSON.stringify(r));
  /** _id 가 없는 행 (손으로 고친 파일): 같은 내용이면 어느 PC 에서나 같은 id → 합칠 때 맞춰진다.
      같은 _id 가 또 나오면 뒤의 것은 _id~순번 (합칠 때 행이 사라지지 않고, 화면에서도 따로 고칠 수 있게). 행 객체를 고치고 rows 를 돌려준다 */
  function ensureIds(rows) {
    const seen = new Set();
    rows.forEach((r, i) => {
      if (!r || typeof r !== 'object') return;
      if (!r._id) r._id = 'x' + hash(JSON.stringify(r)).toString(36) + '_' + i;
      else if (seen.has(String(r._id))) r._id = String(r._id) + '~' + i;
      seen.add(String(r._id));
    });
    return rows;
  }
  /** _id (글자) → 지문. 기준 (base) 을 만든다 — 파일 (JSON) 에 둬도 키가 같게 늘 글자 */
  const sigMap = (rows, sigOf) => { const s = sigOf || sig; const m = new Map(); rows.forEach(r => m.set(String(r._id), s(r))); return m; };
  /** base = 마지막으로 맞춘 행 지문 (_id → 지문), local = 이 PC, remote = 다른 쪽 (서버 · 구글).
      한쪽만 바꾼 행은 바꾼 쪽, 둘 다 고친 행은 이 PC 내용 (conflicts), 한쪽이 지우고 다른 쪽이 고친 행은 고친 행을 남긴다.
      양쪽에 새로 생긴 같은 _id 는 이 PC 내용 (저장 답을 못 받은 경우 등 — 동시에 고친 증거가 없어 겹침으로 세지 않음).
      o.sig: 지문 함수 (서버는 행마다 한 번만 계산), o.adopt(l, r): 이 PC 는 그대로이고 다른 쪽이 고친 행 → 넣을 행 (기본 r. 화면은 l 을 r 로 고쳐 같은 객체를 씀 — 열린 편집 창)
      반환 {rows, conflicts, changed (다른 쪽 변경을 받은 행 수)} */
  function merge3(base, local, remote, o) {
    o = o || {}; const s = o.sig || sig, adopt = o.adopt || ((l, r) => r);
    const lm = new Map(); local.forEach(r => lm.set(String(r._id), r));
    const rIds = new Set(); const out = []; let conflicts = 0, changed = 0;
    remote.forEach(r => {
      const id = String(r._id); rIds.add(id); const b = base.get(id); const l = lm.get(id);
      if (!l) {
        if (b === undefined) { out.push(r); changed++; return; }        // 다른 쪽이 더함
        if (s(r) === b) return;                                          // 이 PC 가 지움
        conflicts++; changed++; out.push(r); return;                     // 이 PC 는 지웠는데 다른 쪽이 고침 → 고친 행을 남김
      }
      if (b === undefined) { out.push(l); return; }                      // 양쪽에 같은 _id 가 새로 생김 → 이 PC
      const ls = s(l);
      if (ls === b) { if (s(r) !== b) { out.push(adopt(l, r)); changed++; } else out.push(l); return; }   // 이 PC 는 그대로 → 다른 쪽 내용
      const rs = s(r); if (rs !== b && rs !== ls) conflicts++;           // 둘 다 고침 → 이 PC 내용
      out.push(l);
    });
    local.forEach(l => {
      const id = String(l._id); if (rIds.has(id)) return;
      const b = base.get(id);
      if (b === undefined) { out.push(l); return; }                      // 이 PC 가 더함
      if (s(l) !== b) { conflicts++; out.push(l); return; }              // 다른 쪽은 지웠는데 이 PC 가 고침 → 남김
      changed++;                                                         // 다른 쪽이 지움
    });
    return { rows: out, conflicts, changed };
  }
  return { hash, sig, ensureIds, sigMap, merge3 };
});
