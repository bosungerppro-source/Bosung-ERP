/* Storage layer: in-memory tables + persistence (server JSON files when served by server.js, IndexedDB otherwise)
   9차(v1.4.0) 서버 모드 — 여러 PC 동시 사용:
   - 표마다 서버 저장 번호(sver)와 마지막으로 서버와 맞춘 행 지문(_base)을 기억한다. 다른 PC 가 먼저 저장했으면 서버가 409 로 거절하고,
     화면이 행(_id) 단위로 내 변경을 최신 자료에 합쳐(merge3) 다시 저장한다. 같은 행을 둘 다 고쳤으면 이 PC 내용으로 저장하고 알린다.
   - 설정(meta)은 바뀐 항목만 보낸다(PATCH) → 다른 PC 가 바꾼 다른 항목은 그대로.
   - 20초마다 · 창으로 돌아올 때 다른 PC 의 변경을 불러온다 (ERP.onRemote → 입력 중이 아니면 화면을 다시 그림).
   - 저장에 실패하면 버리지 않고 다시 시도한다 (2초 → 최대 1분 간격). 창을 닫기 전 flush() 는 보내는 중인 저장까지 기다린다.
   - 사내망의 다른 PC 브라우저는 PIN 을 넣어야 들어온다 (DB.login). */
(function () {
  'use strict';
  const ERP = window.ERP;
  const IDB_NAME = 'colorpencil-erp', STORE = 'kv';
  const POLL_MS = 20000;

  function idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  function idbGetAll(db) {
    return new Promise((res, rej) => {
      const out = {}; const tx = db.transaction(STORE, 'readonly'); const st = tx.objectStore(STORE);
      const c = st.openCursor();
      c.onsuccess = () => { const cur = c.result; if (cur) { out[cur.key] = cur.value; cur.continue(); } else res(out); };
      c.onerror = () => rej(c.error);
    });
  }
  function idbPut(db, key, val) {
    return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }
  function idbClear(db) { return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }

  // ---------- 행 지문 · 3-way merge (서버 모드) ----------
  /** 53-bit string hash (cyrb53) — a row's fingerprint is the hash of its JSON */
  function hash(s) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  const sigOf = (r) => hash(JSON.stringify(r));
  const sigMap = (rows) => { const m = new Map(); rows.forEach(r => m.set(r._id, sigOf(r))); return m; };
  const uid = () => ERP.fmt.uid() + Math.random().toString(36).slice(2, 5);
  /** _id 가 없는 행(손으로 고친 파일): 같은 내용이면 어느 PC 에서나 같은 id → 합칠 때 맞춰진다 */
  function ensureIds(rows) { let n = 0; rows.forEach((r, i) => { if (r && typeof r === 'object' && !r._id) { r._id = 'x' + hash(JSON.stringify(r)).toString(36) + '_' + i; n++; } }); return n; }
  /** l 을 r 과 같게 만든다 — 객체는 그대로 두고(열린 편집 창이 행 객체를 들고 있음) 키 순서까지 r 과 같게(지문이 같도록) */
  function syncInto(l, r) { Object.keys(l).forEach(k => { delete l[k]; }); return Object.assign(l, r); }
  /** base = 마지막으로 서버와 맞춘 행 지문(_id → 지문), local = 이 PC, remote = 지금 서버.
      한쪽만 바꾼 행은 바꾼 쪽, 둘 다 고친 행은 이 PC 내용(conflicts), 한쪽이 지우고 다른 쪽이 고친 행은 고친 행을 남긴다. */
  function merge3(base, local, remote) {
    const lm = new Map(); local.forEach(r => lm.set(r._id, r));
    const rIds = new Set(); const out = []; let conflicts = 0, changed = 0;
    remote.forEach(r => {
      const id = r._id; rIds.add(id); const b = base.get(id); const l = lm.get(id);
      if (!l) {
        if (b === undefined) { out.push(r); changed++; return; }       // 다른 PC 가 더함
        if (sigOf(r) === b) return;                                    // 이 PC 가 지움
        conflicts++; changed++; out.push(r); return;                   // 이 PC 는 지웠는데 다른 PC 가 고침 → 고친 행을 남김
      }
      if (b === undefined) { out.push(l); return; }
      const ls = sigOf(l);
      if (ls === b) { if (sigOf(r) !== b) { syncInto(l, r); changed++; } out.push(l); return; }   // 이 PC 는 그대로 → 서버 내용
      const rs = sigOf(r); if (rs !== b && rs !== ls) conflicts++;      // 둘 다 고침 → 이 PC 내용
      out.push(l);
    });
    local.forEach(l => {
      if (rIds.has(l._id)) return;
      const b = base.get(l._id);
      if (b === undefined) { out.push(l); return; }                    // 이 PC 가 더함
      if (sigOf(l) !== b) { conflicts++; out.push(l); return; }        // 다른 PC 는 지웠는데 이 PC 가 고침 → 남김
      changed++;                                                       // 다른 PC 가 지움
    });
    return { rows: out, conflicts, changed };
  }
  const jsonMap = (o) => { const m = {}; Object.keys(o || {}).forEach(k => { if (o[k] !== undefined) m[k] = JSON.stringify(o[k]); }); return m; };

  const DB = ERP.db = {
    mode: 'local', t: {}, meta: {}, ver: {}, _idb: null, _timers: {}, _listeners: [], pending: 0, ready: false, serverInfo: null, ping: null,
    // 서버 동기화 상태: sver 표별 서버 저장 번호 · smver 설정 저장 번호 · _base 행 지문 · _metaBase 설정 항목 JSON · _gen 표별 동기화 횟수
    sver: {}, smver: 0, _base: {}, _metaBase: {}, _gen: {},
    // 저장 상태: _dirty 아직 안 보낸 변경 · _saving 보내는 중 · _again 보내는 중에 또 바뀜 · _retryN 실패 횟수 · _failing 실패 중인 표('meta' 포함)
    _dirty: {}, _saving: {}, _again: {}, _retryN: {}, _failing: new Set(), _metaSaving: null, _metaAgain: false, _metaTimer: null,
    conflicts: 0,

    async init() {
      // detect server
      let ping = null;
      try {
        if (location.protocol === 'file:') throw new Error('file');
        const r = await fetch('/api/ping', { cache: 'no-store' });
        if (r.ok) { ping = await r.json(); if (ping.ok) DB.mode = 'server'; }
      } catch (e) { DB.mode = 'local'; }
      DB.ping = ping;
      let tables = {}, meta = {};
      if (DB.mode === 'server') {
        if (ping.auth === false) await DB.login(ping);   // 사내망의 다른 PC: 맞는 PIN 을 넣을 때까지 기다린다
        const r = await fetch('/api/db', { cache: 'no-store' }); if (!r.ok) throw new Error('/api/db HTTP ' + r.status);
        const j = await r.json(); tables = j.tables || {}; meta = j.meta || {};
        DB.sver = Object.assign({}, j.versions || {}); DB.smver = j.metaVer || 0; DB._metaBase = jsonMap(meta);
        try { DB.serverInfo = await (await fetch('/api/info')).json(); } catch (e) { /* ignore */ }
      } else {
        try {
          DB._idb = await idbOpen(); const all = await idbGetAll(DB._idb);
          meta = all.meta || {};
          Object.keys(all).forEach(k => { if (k.startsWith('t:')) tables[k.slice(2)] = all[k]; });
        } catch (e) { console.warn('IndexedDB unavailable', e); DB._idb = null; }
      }
      DB.meta = meta;
      Object.keys(ERP.TABLES).forEach(n => {
        const rows = DB.t[n] = Array.isArray(tables[n]) ? tables[n].filter(r => r && typeof r === 'object') : []; DB.ver[n] = 1;
        ensureIds(rows); if (DB.mode === 'server') DB._base[n] = sigMap(rows);
      });
      if (!DB.meta.seeded) await DB.loadSeed(true);
      else if (!DB.meta.v6) await DB.upgradeV6();
      await DB.upgradeV8();
      await DB.upgradeV11();
      DB.ready = true;
      // 창을 닫거나 새로 고칠 때 대기 중인 저장을 바로 보낸다 (설치형은 창 닫기 전에 electron 이 flush 를 기다림)
      window.addEventListener('beforeunload', (e) => {
        if (!DB.hasPending()) return; DB.flush();
        if (/Electron/.test(navigator.userAgent)) return;
        e.preventDefault(); e.returnValue = ''; // 브라우저 접속: '나가시겠습니까?' 확인 → 그 사이 저장 완료
      });
      if (DB.mode === 'server') DB._startPoll();
    },
    /** 아직 서버(또는 브라우저 저장소)에 안 들어간 변경이 있는가 */
    hasPending() {
      const ns = Object.keys(ERP.TABLES);
      return ns.some(n => DB._timers[n] || DB._saving[n] || DB._dirty[n]) || !!DB._metaSaving || !!DB._metaTimer || (DB.mode === 'server' && !!DB._metaDiff());
    },
    /** 대기 중인 저장을 지금 보내고, 보내는 중인 저장 · 설정 저장까지 끝날 때까지 기다린다 (창 닫기 · 프로그램 재시작 전에 호출). 반환: 보낸 표 수 */
    async flush() {
      let sent = 0;
      for (let round = 0; round < 3; round++) {
        const ns = Object.keys(ERP.TABLES).filter(n => DB._timers[n] || DB._dirty[n]);
        if (!round) sent = ns.length;
        const work = ns.map(n => DB.saveTable(n));
        Object.keys(DB._saving).forEach(n => { if (DB._saving[n]) work.push(DB._saving[n]); });
        if (DB._metaSaving || DB._metaTimer || (DB.mode === 'server' && DB._metaDiff())) work.push(DB.saveMeta());
        await Promise.all(work);
        if (!DB.hasPending() || DB._failing.size) break;   // 서버가 안 되면 여기서 멈춤 (다시 시도는 타이머가 계속)
      }
      DB._state();
      return sent;
    },

    async loadSeed(initial) {
      let seed = window.ERP_SEED || null;
      if (!seed) {
        try { const r = await fetch('seed/seed.json'); if (r.ok) seed = await r.json(); } catch (e) { /* ignore */ }
      }
      if (!seed) { if (initial) ERP.toast(L('초기 데이터를 찾을 수 없습니다. 엑셀로 업로드하세요.', 'Không tìm thấy dữ liệu mẫu. Hãy tải lên từ Excel.'), 'warn'); return false; }
      // 예전 샘플 표의 행에는 _ex(예시) 표시를 붙인다 → 나중에 예시 행만 골라 지울 수 있다
      const ex = (seed._meta && seed._meta.sample) || {};
      Object.keys(ERP.TABLES).forEach(n => {
        const rows = seed[n] || [];
        DB.t[n] = rows.map(r => Object.assign({ _id: uid() }, r, ex[n] ? { _ex: 1 } : null));
        DB.ver[n]++;
      });
      if (seed._meta && typeof seed._meta === 'object') Object.keys(seed._meta).forEach(k => { if (!/^ai[A-Z]/.test(k)) DB.meta[k] = JSON.parse(JSON.stringify(seed._meta[k])); });
      DB.meta.seeded = new Date().toISOString(); DB.meta.v6 = DB.meta.v6 || DB.meta.seeded;
      await DB.persistAll();
      DB.emit();
      return true;
    },

    /** 6차 업데이트: 이미 쓰던 데이터에 ECOUNT 기준 자료(품목·창고·코드 사전·기초재고)만 더한다. 기존 행은 건드리지 않는다. */
    async upgradeV6() {
      let seed = window.ERP_SEED || null;
      if (!seed) { try { const r = await fetch('seed/seed.json'); if (r.ok) seed = await r.json(); } catch (e) { /* ignore */ } }
      DB.meta.v6 = new Date().toISOString();
      if (seed) {
        const have = new Set(DB.rows('items').map(r => String(r.code).toUpperCase())); let added = 0;
        (seed.items || []).forEach(r => { if (!have.has(String(r.code).toUpperCase())) { DB.t.items.push(Object.assign({ _id: uid() }, r)); added++; } });
        if (added) { DB.ver.items++; await DB.saveTable('items'); }
        for (const n of ['warehouses', 'code_dict', 'stock_open', 'uploads']) {
          if (DB.rows(n).length || !(seed[n] || []).length) continue;
          DB.t[n] = seed[n].map(r => Object.assign({ _id: uid() }, r)); DB.ver[n]++; await DB.saveTable(n);
        }
        // 5차에서 쓰던 행 중 예전 샘플과 똑같은 행만 '예시'로 표시 (직접 입력·업로드한 행은 그대로)
        const ex = (seed._meta && seed._meta.sample) || {};
        const fp = (r) => JSON.stringify(Object.keys(r).filter(k => k[0] !== '_').sort().map(k => [k, r[k]]));
        for (const n of Object.keys(ex)) {
          if (!ex[n] || !DB.rows(n).length || !(seed[n] || []).length) continue;
          const known = new Set(seed[n].map(fp)); let k = 0;
          DB.rows(n).forEach(r => { if (!r._ex && known.has(fp(r))) { r._ex = 1; k++; } });
          if (k) { DB.ver[n]++; await DB.saveTable(n); }
        }
        if (DB.meta.prodPost === undefined && seed._meta && seed._meta.prodPost) DB.meta.prodPost = seed._meta.prodPost;
      }
      await DB.saveMeta();
    },
    /** 8차(v1.3.0): 기초재고 기준일을 범위마다 설정에 고정한다 (예전 자료는 범위별 기초재고 행 날짜의 최댓값으로 한 번 채움) */
    async upgradeV8() {
      if (DB.meta.openDate || !DB.rows('stock_open').length) return;
      const od = {}; DB.rows('stock_open').forEach(r => { const sc = r.scope === 'FAC' ? 'FAC' : 'WH'; if (r.date && (!od[sc] || r.date > od[sc])) od[sc] = r.date; });
      DB.meta.openDate = od; await DB.saveMeta();
    },
    /** 11차(v1.6.0): WIP21 · 31 … 품목은 가공 배럴(WIPx1, 배럴 계열) — 예전 판이 '기타(ETC)'로 저장한 단계를 다시 매긴다 */
    async upgradeV11() {
      if (DB.meta.v11) return;
      const INV = ERP.inv; let n = 0;
      if (INV) DB.rows('items').forEach(r => { if (/^\s*WIP[2-9]1-/i.test(String(r.erp_code || '')) && r.stage !== 'WIPx1') { INV.classify(r); n++; } });
      if (n) DB.touch('items');
      DB.meta.v11 = new Date().toISOString(); await DB.saveMeta();
    },
    rows(n) { return DB.t[n] || (DB.t[n] = []); },
    onChange(fn) { DB._listeners.push(fn); },
    emit(name) { DB._listeners.forEach(f => { try { f(name); } catch (e) { console.error(e); } }); },
    touch(n) { DB.ver[n] = (DB.ver[n] || 0) + 1; DB.queueSave(n); DB.emit(n); },

    add(n, row) { row = Object.assign({ _id: ERP.fmt.uid() }, row); DB.rows(n).push(row); DB.touch(n); return row; },
    addMany(n, rows) { const a = DB.rows(n); rows.forEach(r => a.push(Object.assign({ _id: uid() }, r))); DB.touch(n); },
    // 손으로 고친 행은 더 이상 '예시'가 아니다 (_ex 제거)
    update(n, id, patch) { const r = DB.rows(n).find(x => x._id === id); if (r) { Object.assign(r, patch); delete r._ex; DB.touch(n); } return r; },
    remove(n, ids) { const s = new Set(Array.isArray(ids) ? ids : [ids]); DB.t[n] = DB.rows(n).filter(r => !s.has(r._id)); DB.touch(n); },
    replace(n, rows) { DB.t[n] = rows.map(r => r._id ? r : Object.assign({ _id: uid() }, r)); DB.touch(n); },
    /** upsert by natural key columns; returns {added, updated} */
    upsert(n, rows, keys) {
      keys = keys && keys.length ? keys : (ERP.TABLES[n].nat || []);
      const cur = DB.rows(n); let added = 0, updated = 0;
      if (!keys.length) { DB.addMany(n, rows); return { added: rows.length, updated: 0 }; }
      const kf = (r) => keys.map(k => String(r[k] === undefined || r[k] === null ? '' : r[k]).trim().toLowerCase()).join('\u0001');
      if (ERP.TABLES[n] && ERP.TABLES[n].multi) {
        // 같은 키가 반복될 수 있는 표(PO 줄): 파일 안의 n번째 같은 키 줄 ↔ 기존의 n번째 같은 키 줄. 합치지 않고, 다시 올려도 늘지 않는다
        const lists = new Map(); cur.forEach(r => { const k = kf(r); let a = lists.get(k); if (!a) lists.set(k, a = []); a.push(r); });
        const seen = new Map();
        rows.forEach(r => {
          const k = kf(r); const i = seen.get(k) || 0; seen.set(k, i + 1); const e = (lists.get(k) || [])[i];
          if (e) { Object.assign(e, r); delete e._ex; updated++; } else { cur.push(Object.assign({ _id: uid() }, r)); added++; }
        });
        DB.touch(n); return { added, updated };
      }
      const idx = new Map(); cur.forEach(r => idx.set(kf(r), r));
      rows.forEach(r => {
        const e = idx.get(kf(r));
        if (e) { Object.assign(e, r); delete e._ex; updated++; }
        else { const nr = Object.assign({ _id: uid() }, r); cur.push(nr); idx.set(kf(nr), nr); added++; }
      });
      DB.touch(n); return { added, updated };
    },

    // ---------- persistence ----------
    queueSave(n) {
      // 같은 표를 0.7초 안에 여러 번 고치면 저장은 한 번 — 대기 수도 한 번만 센다 ('저장 중…' 표시가 남지 않게)
      DB._dirty[n] = true;
      clearTimeout(DB._timers[n]);
      DB._timers[n] = setTimeout(() => { DB._timers[n] = null; DB.saveTable(n); }, 700);
      DB._state();
    },
    /** 표 하나를 저장한다. 같은 표의 저장은 한 번에 하나씩 (보내는 중에 또 바뀌면 끝난 뒤 한 번 더). 실패해도 reject 하지 않는다 (다시 시도 예약) */
    saveTable(n) {
      clearTimeout(DB._timers[n]); DB._timers[n] = null;
      if (DB._saving[n]) { DB._again[n] = true; return DB._saving[n]; }
      const run = async () => {
        try { await DB._save1(n); DB._saved(n); } catch (e) { DB._failed(n, e); return; }
        if (DB._again[n]) { DB._again[n] = false; if (DB._dirty[n]) return run(); }
      };
      const p = DB._saving[n] = run().finally(() => { if (DB._saving[n] === p) DB._saving[n] = null; DB._state(); });
      DB._state();
      return p;
    },
    async _save1(n) {
      DB._dirty[n] = false;
      try {
        if (DB.mode !== 'server') { if (DB._idb) await idbPut(DB._idb, 't:' + n, DB.rows(n)); return; }
        for (let k = 0; k < 6; k++) {
          // 보낸 내용의 행 지문 = 저장에 성공하면 새 기준(_base)
          const rows = DB.rows(n); const sigs = new Map(); const parts = new Array(rows.length);
          for (let i = 0; i < rows.length; i++) { const s = JSON.stringify(rows[i]); parts[i] = s; sigs.set(rows[i]._id, hash(s)); }
          const r = await fetch('/api/t/' + n, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Base-Ver': String(DB.sver[n] || 0) }, body: '[' + parts.join(',') + ']' });
          if (r.status === 409) { const j = await r.json(); DB._absorb(n, Array.isArray(j.rows) ? j.rows : [], j.ver || 0); continue; }   // 다른 PC 가 먼저 저장 → 합쳐서 다시
          if (r.status === 401) { DB._needLogin(); throw new Error('LOGIN'); }
          if (!r.ok) { let m = 'HTTP ' + r.status; try { const j = await r.json(); if (j && j.error) m += ' ' + j.error; } catch (e) { /* not json */ } throw new Error(m); }
          const j = await r.json(); DB.sver[n] = j.ver; DB._base[n] = sigs; DB._gen[n] = (DB._gen[n] || 0) + 1; return;
        }
        throw new Error(L('다른 PC 와 저장이 계속 겹칩니다', 'Liên tục trùng lần lưu với máy khác'));
      } catch (e) { DB._dirty[n] = true; throw e; }
    },
    _saved(n) {
      DB._retryN[n] = 0;
      if (DB._failing.delete(n) && !DB._failing.size) ERP.toast(L('다시 저장했습니다', 'Đã lưu lại được'), 'ok');
    },
    _failed(n, e) {
      DB._dirty[n] = true; DB._again[n] = false; console.error(e);
      if (e && e.message === 'LOGIN') return;   // 다시 들어온 뒤 flush (DB._needLogin)
      const k = DB._retryN[n] = (DB._retryN[n] || 0) + 1; const wait = Math.min(60000, 2000 * Math.pow(2, k - 1));
      if (!DB._timers[n]) DB._timers[n] = setTimeout(() => { DB._timers[n] = null; DB.saveTable(n); }, wait);
      if (!DB._failing.size) ERP.toast(L('저장 실패 — 입력한 내용은 그대로 두고 다시 시도합니다: ', 'Lưu thất bại — vẫn giữ dữ liệu và sẽ thử lại: ') + e.message, 'bad');
      DB._failing.add(n);
    },
    /** '저장 중… / 저장됨 / 저장 오류' 표시와 대기 수(pending = 아직 저장 안 된 표 수) */
    _state() {
      DB.pending = Object.keys(ERP.TABLES).filter(n => DB._timers[n] || DB._saving[n] || DB._dirty[n]).length;
      ERP.saveState && ERP.saveState(DB._failing.size ? 'error' : (DB.pending || DB._metaSaving) ? 'saving' : 'saved');
    },
    /** 서버의 최신 행(remote)을 이 PC 의 행과 합친다 (409 응답 · 다른 PC 변경 불러오기) */
    _absorb(n, remote, ver) {
      ensureIds(remote);
      const m = merge3(DB._base[n] || new Map(), DB.rows(n), remote);
      DB.t[n] = m.rows; DB._base[n] = sigMap(remote); DB.sver[n] = ver; DB._gen[n] = (DB._gen[n] || 0) + 1;
      if (m.changed) { DB.ver[n] = (DB.ver[n] || 0) + 1; DB._remote(n); }
      if (m.conflicts) {
        DB.conflicts += m.conflicts;
        ERP.toast(L('다른 PC 와 같은 행을 동시에 고쳤습니다 — ' + ERP.tableLabel(n) + ' ' + m.conflicts + '행은 이 PC 의 내용으로 저장합니다',
          'Máy khác cũng sửa cùng dòng — ' + ERP.tableLabel(n) + ': ' + m.conflicts + ' dòng được lưu theo máy này'), 'warn');
      }
      return m;
    },
    /** 다른 PC 의 변경을 반영했다 → 화면에 알림 (여러 표를 한 번에) */
    _remote(n) {
      (DB._remoteSet = DB._remoteSet || new Set()).add(n);
      clearTimeout(DB._remoteT);
      DB._remoteT = setTimeout(() => { const s = Array.from(DB._remoteSet); DB._remoteSet.clear(); DB.emit('remote'); ERP.onRemote && ERP.onRemote(s); }, 30);
    },

    // ---------- 설정 (meta) ----------
    /** 마지막으로 서버와 맞춘 뒤 바뀐 설정 항목 */
    _metaDiff() {
      const set = {}, json = {}, del = []; let k = 0;
      Object.keys(DB.meta).forEach(key => { if (DB.meta[key] === undefined) return; const s = JSON.stringify(DB.meta[key]); if (s !== DB._metaBase[key]) { set[key] = DB.meta[key]; json[key] = s; k++; } });
      Object.keys(DB._metaBase).forEach(key => { if (DB.meta[key] === undefined) { del.push(key); k++; } });
      return k ? { set, json, del } : null;
    },
    /** 서버의 설정(remote)을 반영: 이 PC 에서 바꾸고 아직 못 보낸 항목은 그대로 둔다 */
    _absorbMeta(remote, ver) {
      const base = DB._metaBase; let changed = 0;
      new Set(Object.keys(remote).concat(Object.keys(DB.meta), Object.keys(base))).forEach(k => {
        const mine = DB.meta[k] === undefined ? undefined : JSON.stringify(DB.meta[k]);
        if (mine !== base[k]) return;
        const theirs = remote[k] === undefined ? undefined : JSON.stringify(remote[k]);
        if (theirs === mine) return;
        if (remote[k] === undefined) delete DB.meta[k]; else DB.meta[k] = remote[k];
        changed++;
      });
      DB._metaBase = jsonMap(remote); DB.smver = ver || 0;
      if (changed) DB._remote('meta');
      return changed;
    },
    /** 설정 저장: 서버 모드는 바뀐 항목만 보낸다 (PATCH). 실패하면 다시 시도. reject 하지 않는다 */
    saveMeta() {
      clearTimeout(DB._metaTimer); DB._metaTimer = null;
      if (DB._metaSaving) { DB._metaAgain = true; return DB._metaSaving; }
      const run = async () => {
        try {
          if (DB.mode === 'server') {
            const d = DB._metaDiff();
            if (d) {
              const r = await fetch('/api/meta', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set: d.set, del: d.del }) });
              if (r.status === 401) { DB._needLogin(); throw new Error('LOGIN'); }
              if (!r.ok) throw new Error('HTTP ' + r.status);
              const j = await r.json();
              Object.keys(d.json).forEach(k => { DB._metaBase[k] = d.json[k]; }); d.del.forEach(k => { delete DB._metaBase[k]; });
              if (j.meta) DB._absorbMeta(j.meta, j.ver); else DB.smver = j.ver || DB.smver;
            }
          } else if (DB._idb) await idbPut(DB._idb, 'meta', DB.meta);
          DB._retryN.meta = 0; if (DB._failing.delete('meta') && !DB._failing.size) ERP.toast(L('다시 저장했습니다', 'Đã lưu lại được'), 'ok');
        } catch (e) {
          console.error(e); DB._metaAgain = false;
          if (e.message !== 'LOGIN') {
            const k = DB._retryN.meta = (DB._retryN.meta || 0) + 1;
            DB._metaTimer = setTimeout(() => { DB._metaTimer = null; DB.saveMeta(); }, Math.min(60000, 2000 * Math.pow(2, k - 1)));
            if (!DB._failing.size) ERP.toast(L('설정 저장 실패 — 다시 시도합니다: ', 'Lưu cài đặt thất bại — sẽ thử lại: ') + e.message, 'bad');
            DB._failing.add('meta');
          }
          return;
        }
        if (DB._metaAgain) { DB._metaAgain = false; return run(); }
      };
      const p = DB._metaSaving = run().finally(() => { if (DB._metaSaving === p) DB._metaSaving = null; DB._state(); });
      return p;
    },
    async persistAll() {
      for (const n of Object.keys(ERP.TABLES)) { clearTimeout(DB._timers[n]); DB._timers[n] = null; DB._dirty[n] = true; await DB.saveTable(n); }
      await DB.saveMeta();
    },
    async wipe() {
      Object.keys(ERP.TABLES).forEach(n => { DB.t[n] = []; DB.ver[n]++; });
      // keep the "seeded" mark (otherwise the sample data is loaded again on the next start) and the assistant profile (ai* settings)
      const keep = { seeded: DB.meta.seeded || new Date().toISOString(), v6: DB.meta.v6 || new Date().toISOString() }; Object.keys(DB.meta).forEach(k => { if (/^ai[A-Z]/.test(k)) keep[k] = DB.meta[k]; });
      DB.meta = keep; if (DB._idb) await idbClear(DB._idb);
      await DB.persistAll(); DB.emit();
    },

    // ---------- 다른 PC 의 변경 불러오기 (서버 모드) ----------
    _startPoll() {
      if (DB._pollT) return;
      const tick = () => { DB.poll(); };
      DB._pollT = setInterval(tick, POLL_MS);
      window.addEventListener('focus', tick);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    },
    /** 서버의 저장 번호를 보고, 다른 PC 가 저장한 표 · 설정만 받아 합친다. 반환: 반영한 표 · 설정 수 */
    async poll() {
      if (DB.mode !== 'server' || DB._polling || DB._loginOpen || document.hidden) return 0;
      DB._polling = true; let got = 0;
      try {
        const r = await fetch('/api/versions', { cache: 'no-store' });
        if (r.status === 401) { DB._needLogin(); return 0; }
        if (!r.ok) return 0;
        const v = await r.json(); const tv = v.t || {};
        for (const n of Object.keys(ERP.TABLES)) {
          if ((tv[n] || 0) === (DB.sver[n] || 0) || DB._saving[n]) continue;
          const g = DB._gen[n];
          const tr = await fetch('/api/t/' + n, { cache: 'no-store' }); if (!tr.ok) continue;
          const t = await tr.json();
          if (DB._saving[n] || DB._gen[n] !== g || !Array.isArray(t.rows)) continue;   // 그 사이 이 PC 가 저장함 → 다음 번에
          DB._absorb(n, t.rows, t.ver || 0); got++;
        }
        if ((v.meta || 0) !== (DB.smver || 0) && !DB._metaSaving) {
          const mr = await fetch('/api/meta', { cache: 'no-store' });
          if (mr.ok) { const j = await mr.json(); if (!DB._metaSaving && j && j.meta) { DB._absorbMeta(j.meta, j.ver); got++; } }
        }
      } catch (e) { /* 서버가 잠시 안 됨: 다음 번에 */ } finally { DB._polling = false; }
      return got;
    },

    // ---------- 사내망 PIN ----------
    /** PIN 화면: 맞는 PIN 을 넣을 때까지 기다린다 (서버가 쿠키를 줌, 7일) */
    login(ping) {
      DB._loginOpen = true;
      return new Promise((resolve) => {
        const noPin = !!ping && ping.hasPin === false;
        const msg = h('p', { class: 'help', role: 'alert', style: { minHeight: '20px', color: '#B3261E', margin: 0 } });
        const inp = h('input', { class: 'inp', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', maxlength: '12', 'aria-label': 'PIN',
          style: { width: '100%', fontSize: '22px', letterSpacing: '6px', textAlign: 'center' }, onkeydown: (e) => { if (e.key === 'Enter') go(); } });
        const btn = h('button', { class: 'btn primary', type: 'button', style: { width: '100%', justifyContent: 'center' }, onclick: () => go() }, L('들어가기', 'Vào'));
        const card = h('div', { class: 'card', style: { maxWidth: '400px', margin: '12vh auto', padding: '28px', display: 'flex', flexDirection: 'column', gap: '14px' } },
          h('h2', { style: { margin: 0 } }, L('사내망 접속 PIN', 'Mã PIN truy cập mạng nội bộ')),
          h('p', { class: 'muted', style: { margin: 0 } }, noPin
            ? L('ERP 가 실행 중인 PC 에서 먼저 PIN 을 정해야 다른 PC 에서 들어올 수 있습니다 (설정 → 사내망 접속 PIN).', 'Cần đặt mã PIN trên máy đang chạy ERP trước thì máy khác mới vào được (Cài đặt → Mã PIN mạng nội bộ).')
            : L('ERP 가 실행 중인 PC 에서 정한 PIN 을 넣으세요. 이 브라우저는 7일 동안 기억합니다.', 'Nhập mã PIN đã đặt trên máy đang chạy ERP. Trình duyệt này sẽ nhớ trong 7 ngày.')),
          noPin ? h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, L('다시 확인', 'Kiểm tra lại')) : [inp, btn], msg);
        const host = h('div', { class: 'login-gate', style: { position: 'fixed', inset: '0', background: '#F2F3F5', zIndex: 9999, overflow: 'auto' } }, card);
        document.body.appendChild(host); if (!noPin) inp.focus();
        async function go() {
          const pin = inp.value.trim(); if (!pin || btn.disabled) return; btn.disabled = true; msg.textContent = '';
          try {
            const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
            const j = await r.json().catch(() => ({}));
            if (r.ok) { host.remove(); DB._loginOpen = false; resolve(true); return; }
            msg.textContent = j.error === 'WAIT' ? L('너무 많이 틀렸습니다. ' + j.wait + '초 뒤에 다시 넣으세요.', 'Sai quá nhiều lần. Thử lại sau ' + j.wait + ' giây.')
              : j.error === 'NO_PIN' ? L('아직 PIN 이 없습니다. ERP 가 실행 중인 PC 에서 먼저 정하세요.', 'Chưa có mã PIN. Hãy đặt trên máy đang chạy ERP trước.')
              : L('PIN 이 맞지 않습니다', 'Mã PIN không đúng');
            inp.value = ''; inp.focus();
          } catch (e) { msg.textContent = L('서버에 연결할 수 없습니다: ', 'Không kết nối được máy chủ: ') + e.message; } finally { btn.disabled = false; }
        }
      });
    },
    /** 쓰는 중에 로그인이 풀림(PIN 이 바뀜 · 서버 재시작 7일 경과): PIN 화면 → 다시 들어오면 못 보낸 저장을 보낸다 */
    _needLogin() {
      if (DB._loginOpen) return; DB._loginOpen = true;
      fetch('/api/ping', { cache: 'no-store' }).then(r => r.json()).then(p => (p.auth ? (DB._loginOpen = false, true) : DB.login(p)))
        .then(() => { DB.flush(); DB.poll(); }).catch(() => { DB._loginOpen = false; });
    },
    async logout() { try { await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) { /* ignore */ } location.reload(); },

    // ---------- whole-db backup ----------
    snapshot() { const o = { app: 'colorpencil-erp', version: 1, created: new Date().toISOString(), meta: DB.meta, tables: {} }; Object.keys(ERP.TABLES).forEach(n => { o.tables[n] = DB.rows(n); }); return o; },
    async restore(o) {
      if (!o || !o.tables) throw new Error('invalid backup');
      Object.keys(ERP.TABLES).forEach(n => { DB.t[n] = (o.tables[n] || []).map(r => r._id ? r : Object.assign({ _id: uid() }, r)); DB.ver[n]++; });
      DB.meta = Object.assign({}, o.meta || {}, { seeded: DB.meta.seeded || new Date().toISOString() });
      await DB.persistAll();
      if (!DB.meta.v6) await DB.upgradeV6(); // 5차 백업을 복원한 경우 ECOUNT 기준 자료를 더한다
      await DB.upgradeV8();
      await DB.upgradeV11();
      DB.emit();
    },

    // ---------- memoised derived data ----------
    _memo: {},
    memo(key, tables, fn) {
      const sig = tables.map(t => DB.ver[t]).join('.') + '|' + (ERP.lang);
      const m = DB._memo[key];
      if (m && m.sig === sig) return m.val;
      const val = fn(); DB._memo[key] = { sig, val }; return val;
    },
    setting(k, d) { return DB.meta[k] === undefined ? d : DB.meta[k]; },
    setSetting(k, v) { DB.meta[k] = v; DB.saveMeta(); },
  };
  DB._merge3 = merge3; DB._sigOf = sigOf;   // 시험용
})();
