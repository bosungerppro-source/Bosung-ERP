/* Storage layer: in-memory tables + persistence (server JSON files when served by server.js, IndexedDB otherwise) */
(function () {
  'use strict';
  const ERP = window.ERP;
  const IDB_NAME = 'colorpencil-erp', STORE = 'kv';

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

  const DB = ERP.db = {
    mode: 'local', t: {}, meta: {}, ver: {}, _idb: null, _timers: {}, _listeners: [], pending: 0, ready: false, serverInfo: null,

    async init() {
      // detect server
      try {
        if (location.protocol === 'file:') throw new Error('file');
        const r = await fetch('/api/ping', { cache: 'no-store' });
        if (r.ok && (await r.json()).ok) DB.mode = 'server';
      } catch (e) { DB.mode = 'local'; }
      let tables = {}, meta = {};
      if (DB.mode === 'server') {
        const r = await fetch('/api/db', { cache: 'no-store' }); const j = await r.json(); tables = j.tables || {}; meta = j.meta || {};
        try { DB.serverInfo = await (await fetch('/api/info')).json(); } catch (e) { /* ignore */ }
      } else {
        try {
          DB._idb = await idbOpen(); const all = await idbGetAll(DB._idb);
          meta = all.meta || {};
          Object.keys(all).forEach(k => { if (k.startsWith('t:')) tables[k.slice(2)] = all[k]; });
        } catch (e) { console.warn('IndexedDB unavailable', e); DB._idb = null; }
      }
      DB.meta = meta;
      Object.keys(ERP.TABLES).forEach(n => { DB.t[n] = tables[n] || []; DB.ver[n] = 1; });
      if (!DB.meta.seeded) await DB.loadSeed(true);
      else if (!DB.meta.v6) await DB.upgradeV6();
      DB.ready = true;
      // 창을 닫거나 새로 고칠 때 0.7초 대기 중인 저장을 바로 보낸다 (설치형은 창 닫기 전에 electron 이 flush 를 기다림)
      window.addEventListener('beforeunload', (e) => {
        if (!DB.hasPending()) return; DB.flush();
        if (/Electron/.test(navigator.userAgent)) return;
        e.preventDefault(); e.returnValue = ''; // 브라우저 접속: '나가시겠습니까?' 확인 → 그 사이 저장 완료
      });
    },
    hasPending() { return Object.keys(DB._timers).some(n => DB._timers[n]); },
    /** 대기 중인 저장을 지금 보낸다 (창 닫기 · 프로그램 재시작 전에 호출) */
    async flush() {
      const ns = Object.keys(DB._timers).filter(n => DB._timers[n]);
      for (const n of ns) { clearTimeout(DB._timers[n]); DB._timers[n] = null; await DB.saveTable(n); }
      return ns.length;
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
        DB.t[n] = rows.map(r => Object.assign({ _id: ERP.fmt.uid() + Math.random().toString(36).slice(2, 5) }, r, ex[n] ? { _ex: 1 } : null));
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
        const uid = () => ERP.fmt.uid() + Math.random().toString(36).slice(2, 5);
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
    rows(n) { return DB.t[n] || (DB.t[n] = []); },
    onChange(fn) { DB._listeners.push(fn); },
    emit(name) { DB._listeners.forEach(f => { try { f(name); } catch (e) { console.error(e); } }); },
    touch(n) { DB.ver[n] = (DB.ver[n] || 0) + 1; DB.queueSave(n); DB.emit(n); },

    add(n, row) { row = Object.assign({ _id: ERP.fmt.uid() }, row); DB.rows(n).push(row); DB.touch(n); return row; },
    addMany(n, rows) { const a = DB.rows(n); rows.forEach(r => a.push(Object.assign({ _id: ERP.fmt.uid() + Math.random().toString(36).slice(2, 5) }, r))); DB.touch(n); },
    // 손으로 고친 행은 더 이상 '예시'가 아니다 (_ex 제거)
    update(n, id, patch) { const r = DB.rows(n).find(x => x._id === id); if (r) { Object.assign(r, patch); delete r._ex; DB.touch(n); } return r; },
    remove(n, ids) { const s = new Set(Array.isArray(ids) ? ids : [ids]); DB.t[n] = DB.rows(n).filter(r => !s.has(r._id)); DB.touch(n); },
    replace(n, rows) { DB.t[n] = rows.map(r => r._id ? r : Object.assign({ _id: ERP.fmt.uid() + Math.random().toString(36).slice(2, 5) }, r)); DB.touch(n); },
    /** upsert by natural key columns; returns {added, updated} */
    upsert(n, rows, keys) {
      keys = keys && keys.length ? keys : (ERP.TABLES[n].nat || []);
      const cur = DB.rows(n); let added = 0, updated = 0;
      if (!keys.length) { DB.addMany(n, rows); return { added: rows.length, updated: 0 }; }
      const kf = (r) => keys.map(k => String(r[k] === undefined || r[k] === null ? '' : r[k]).trim().toLowerCase()).join('\u0001');
      const idx = new Map(); cur.forEach(r => idx.set(kf(r), r));
      rows.forEach(r => {
        const e = idx.get(kf(r));
        if (e) { Object.assign(e, r); delete e._ex; updated++; }
        else { const nr = Object.assign({ _id: ERP.fmt.uid() + Math.random().toString(36).slice(2, 5) }, r); cur.push(nr); idx.set(kf(nr), nr); added++; }
      });
      DB.touch(n); return { added, updated };
    },

    // ---------- persistence ----------
    queueSave(n) {
      // 같은 표를 0.7초 안에 여러 번 고치면 저장은 한 번 — 대기 수도 한 번만 센다 ('저장 중…' 표시가 남지 않게)
      if (!DB._timers[n]) DB.pending++;
      ERP.saveState && ERP.saveState('saving');
      clearTimeout(DB._timers[n]);
      DB._timers[n] = setTimeout(() => { DB._timers[n] = null; DB.saveTable(n); }, 700);
    },
    async saveTable(n) {
      try {
        if (DB.mode === 'server') {
          const r = await fetch('/api/t/' + n, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(DB.rows(n)) });
          if (!r.ok) throw new Error('HTTP ' + r.status);
        } else if (DB._idb) await idbPut(DB._idb, 't:' + n, DB.rows(n));
        DB.pending = Math.max(0, DB.pending - 1); ERP.saveState && ERP.saveState(DB.pending ? 'saving' : 'saved');
      } catch (e) { console.error(e); DB.pending = 0; ERP.saveState && ERP.saveState('error'); ERP.toast(L('저장 실패: ', 'Lưu thất bại: ') + e.message, 'bad'); }
    },
    async saveMeta() {
      try {
        if (DB.mode === 'server') await fetch('/api/meta', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(DB.meta) });
        else if (DB._idb) await idbPut(DB._idb, 'meta', DB.meta);
      } catch (e) { console.error(e); }
    },
    async persistAll() {
      for (const n of Object.keys(ERP.TABLES)) { clearTimeout(DB._timers[n]); DB._timers[n] = null; await DB.saveTable(n); }
      await DB.saveMeta();
    },
    async wipe() {
      Object.keys(ERP.TABLES).forEach(n => { DB.t[n] = []; DB.ver[n]++; });
      // keep the "seeded" mark (otherwise the sample data is loaded again on the next start) and the assistant profile (ai* settings)
      const keep = { seeded: DB.meta.seeded || new Date().toISOString(), v6: DB.meta.v6 || new Date().toISOString() }; Object.keys(DB.meta).forEach(k => { if (/^ai[A-Z]/.test(k)) keep[k] = DB.meta[k]; });
      DB.meta = keep; if (DB._idb) await idbClear(DB._idb);
      await DB.persistAll(); DB.emit();
    },

    // ---------- whole-db backup ----------
    snapshot() { const o = { app: 'colorpencil-erp', version: 1, created: new Date().toISOString(), meta: DB.meta, tables: {} }; Object.keys(ERP.TABLES).forEach(n => { o.tables[n] = DB.rows(n); }); return o; },
    async restore(o) {
      if (!o || !o.tables) throw new Error('invalid backup');
      Object.keys(ERP.TABLES).forEach(n => { DB.t[n] = (o.tables[n] || []).map(r => r._id ? r : Object.assign({ _id: ERP.fmt.uid() + Math.random().toString(36).slice(2, 5) }, r)); DB.ver[n]++; });
      DB.meta = Object.assign({}, o.meta || {}, { seeded: DB.meta.seeded || new Date().toISOString() });
      await DB.persistAll();
      if (!DB.meta.v6) await DB.upgradeV6(); // 5차 백업을 복원한 경우 ECOUNT 기준 자료를 더한다
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
})();
