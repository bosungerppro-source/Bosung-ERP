/* 16차 (v1.11.0): 해외 주문 품목 — 자재구매 파일(Category · Item Code · Item Name · Item Name Kr · Safety stock · Unit · Inventory · 입고예정 · 주문일 … 표)의
   품목만 원부자재 재고 메뉴의 "해외 주문" 탭에서 따로 보고 따로 주문한다 (사용자: 해외에서 주문해서 리드타임이 있으니 따로 관리).
   · 자료 올리기: 품목에 해외 주문 표시(구분 · 한글 품명 · 파일 순서 · 파일 단위) · 안전재고(파일 값, 단위가 ERP 와 다르면 buy_safety) · ERP 에 없는 품목은 만들기 ·
     주문일 칸 → 해외 주문(buy_orders). 파일에 없는 품목은 목록에서 뺀다.
   · 표 = 파일과 같은 순서의 칸 + 리드타임 · 도착 예정 · 상태 · 권장 주문량. 재고 = ERP 원부자재 재고 (창고 입출고장 · 수불), 단위가 다르면 개당 kg 로 바꿈.
     주문일 칸 = 그날 주문(입고 대기 · 최근 입고 완료), 입고예정 칸 = 주문일 없이 들어올 수량(파일의 입고예정 칸, kind 'inc'), 합계 = 재고 + 입고예정 + 입고 대기 주문 (파일의 Total 과 같음).
     월 사용량 = 창고 출고(외부 출고 + 공장으로 이동) 월별 합.
   · 리드타임(주문 → 입고 일수, 품목별 또는 기본값): 도착 예정 = 주문일 + 리드타임, 주문 필요 = 합계 − 리드타임 동안 쓸 양(월 평균 ÷ 30 × 일) < 안전재고.
   · 파일을 다시 올리면 파일에 있는 주문일 칸 · 입고예정 칸이 그 품목의 입고 대기 값이 된다 (입고 완료는 그대로, 파일에 없는 날짜의 주문도 그대로).
   · 1.11.1: 자재구매 파일의 재고(Inventory 칸)가 맞다 (사용자 2026-10-21) → 올리면 파일 날짜에 조정(ADJ, src 'buy')으로 ERP 재고를 그 값에 맞춘다.
     같은 날짜의 파일을 다시 올리면 그 날의 이 조정만 다시 계산한다 (창고 입출고장을 다시 올려도 이 조정은 그대로).
   · 1.11.2: 같은 코드가 다른 구분으로 또 있으면 **따로 관리하는 재고** (사용자: BIC 업체 요청으로 창고를 나눠 원료를 따로 관리) — 첫 줄은 ERP 품목,
     다음 줄은 buy_pools (재고 = 파일 값, 안전재고 · 리드타임 · 주문도 따로, 주문은 pool = 그 구분). 같은 코드 · 같은 구분이 두 번이면 첫 줄.
   · 1.11.3 (사용자: "파일을 올려주는 게 아니고, 안전재고에 따라 백단위면 백단위 천단위면 천단위씩 해서 주문 넣을 파일을 내가 올렸던 것처럼 만들어 주는 것"):
     권장 주문량은 안전재고 자릿수 단위로 올림 (백 단위 → 100, 천 단위 → 1,000 …, 품목별 주문 단위로 바꿀 수 있음),
     [주문 파일 만들기] = 권장 주문량을 주문일 칸에 넣고 자재구매 파일과 같은 서식의 엑셀(Oder Korea · 제목 · Author · Date · 머리 · Total 수식)을 만든다.
     따로 관리하는 재고는 표에서 직접 고치고, 그 주문을 입고 완료하면 그 재고에 더한다 (창고 입출고장에 없으므로).
   · 입고 완료는 주문을 입고 대기에서 빼기만 한다 — 재고는 창고 입출고장 · 수불 입력으로 들어온다 (두 번 세지 않게). */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, F = ERP.fmt, INV = ERP.inv, XL = ERP.xl, C = ERP.calc;
  const { findRow, hasCell, S, N, T } = XL.helpers;
  const put = ERP.put; const num = C.num;
  const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const up = (v) => str(v).toUpperCase();
  const pick = (o) => { const out = {}; Object.keys(o).forEach(k => { if (o[k] !== null && o[k] !== undefined && o[k] !== '') out[k] = o[k]; }); return out; };
  const isInt = (v) => Math.abs(v - Math.round(v)) < 1e-9;
  const fq = (v, u) => (v === null || v === undefined || v === '' || !isFinite(v) ? '–' : F.n(v, INV.unitN(u) === 'kg' || !isInt(+v) ? 2 : 0));
  const unitSame = (a, b) => { const x = INV.unitN(a), y = INV.unitN(b); return !!x && x === y; };
  const addMonth = (ym, n) => { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) + n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return y + '-' + String(m).padStart(2, '0'); };
  /** 해외 주문 줄의 열쇠: 품목코드 + 따로 관리하는 구분 (ERP 품목 줄은 빈 구분) */
  const pkey = (o) => up(o.code) + '|' + up(o.pool || '');
  const okey = (d, o) => str(d) + '|' + pkey(o);
  const B = ERP.buy = {};

  // ===================================================================== 자료 올리기: 자재구매 파일 인식
  const HDR = (r) => hasCell(r, /^item\s*code$/i) && hasCell(r, /^safety\s*stock$/i) && hasCell(r, /^inventory$/i);
  XL.addDetector('buy_list', (n, M) => findRow(M, HDR, 0, 12) >= 0, (M, ctx) => {
    const hi = findRow(M, HDR, 0, 12); const H = M[hi] || [];
    const at = (re) => H.findIndex(x => typeof x === 'string' && re.test(x.trim()));
    const ci = { cat: at(/^category$/i), code: at(/^item\s*code$/i), name: at(/^item\s*name$/i), kr: at(/^item\s*name\s*kr$/i), safety: at(/^safety\s*stock$/i), unit: at(/^unit$/i),
      inv: at(/^inventory$/i), inc: at(/^입고\s*예정$/), total: at(/^total$/i) };
    // 주문일 칸: 입고예정(없으면 재고) 다음부터 Total 앞까지, 머리 칸이 날짜인 것
    const from = (ci.inc >= 0 ? ci.inc : ci.inv) + 1, to = ci.total > from ? ci.total : H.length;
    const dates = []; for (let c = from; c < to; c++) { const d = F.parseDate(H[c]); if (d) dates.push({ c, date: d }); }
    // 파일 날짜: "Date :" 옆 칸 → 파일 이름 → 오늘
    let fdate = null;
    for (let i = 0; i < hi && !fdate; i++) { const r = M[i] || []; const k = r.findIndex(x => typeof x === 'string' && /^date\s*:?$/i.test(x.trim())); if (k >= 0) for (let c = k + 1; c < r.length && !fdate; c++) fdate = F.parseDate(r[c]); }
    fdate = fdate || XL.fileDate(ctx && ctx.file) || F.today();
    // 1.11.3: 파일 머리 (첫 줄의 제목 · Author 옆 칸) — ERP 가 만드는 주문 파일도 같은 모양으로
    let author = ''; for (let i = 0; i < hi && !author; i++) { const r = M[i] || []; const k = r.findIndex(x => typeof x === 'string' && /^author\s*:?$/i.test(x.trim())); if (k >= 0) for (let c = k + 1; c < r.length && !author; c++) author = T(r[c]) || ''; }
    const title = ((M[0] || []).find(x => typeof x === 'string' && x.trim() && !/^author\s*:?$/i.test(x.trim())) || '').trim();
    const rows = [], dups = [], seen = new Map(), firstCat = new Map(); let ord = 0;
    for (let i = hi + 1; i < M.length; i++) {
      const r = M[i]; if (!r) continue; const code = T(S(r, ci.code));
      if (!code || /^item\s*code$/i.test(code)) continue;   // 엑셀 표 자체의 머리 줄(열1 · 열2 …)은 건너뜀
      const o = { ord: ++ord, cat: T(S(r, ci.cat)) || '', code, name: ci.name >= 0 ? T(S(r, ci.name)) || '' : '', kr: ci.kr >= 0 ? T(S(r, ci.kr)) || '' : '', safety: N(S(r, ci.safety)), unit: ci.unit >= 0 ? T(S(r, ci.unit)) || '' : '',
        inv: N(S(r, ci.inv)), inc: ci.inc >= 0 ? N(S(r, ci.inc)) : null, orders: dates.map(d => ({ date: d.date, qty: N(S(r, d.c)) })).filter(x => x.qty > 0) };
      // 1.11.2: 같은 코드가 다른 구분으로 또 있으면 따로 관리하는 재고 (pool = 그 구분), 같은 구분으로 두 번이면 첫 줄
      const kc = up(code), k = kc + '|' + up(o.cat);
      if (seen.has(k) || (firstCat.has(kc) && !o.cat)) { dups.push({ code, cat: o.cat, safety: o.safety, inv: o.inv, first: seen.get(k) || seen.get(kc + '|' + up(firstCat.get(kc))) }); continue; }
      o.pool = firstCat.has(kc) ? o.cat : ''; if (!firstCat.has(kc)) firstCat.set(kc, o.cat);
      seen.set(k, o); rows.push(o);
    }
    if (!rows.length) return [];
    const Bx = { rows, dups, dates: dates.map(d => d.date), fdate, file: ctx && ctx.file, head: { title, author, sheet: ctx && ctx.sheet } };
    const orderRows = [];
    rows.forEach(o => { const pool = o.pool || undefined; o.orders.forEach(x => orderRows.push({ date: x.date, code: o.code, pool, qty: x.qty, unit: o.unit })); if (o.inc > 0) orderRows.push({ date: fdate, code: o.code, pool, qty: o.inc, unit: o.unit, kind: 'inc' }); });
    const label = L('자재구매 (해외 주문)', 'Mua NVL (đặt nước ngoài)');
    return [
      { table: 'items', rows: rows.map(o => ({ code: o.code, name: o.name })), custom: 'buy', mode: 'buy', prio: 0.6, kind: 'buy_items', B: Bx, date: fdate, extraTables: ['buy_pools'],
        label: label + ' → ' + L('해외 주문 품목 · 안전재고', 'mã đặt nước ngoài · tồn AT'), modes: () => ({ buy: L('해외 주문 품목으로 표시 · 안전재고 · 없는 품목 만들기', 'Đánh dấu · tồn AT · thêm mã thiếu') }), apply: applyItems, preview: previewItems },
      { table: 'buy_orders', rows: orderRows, custom: 'buy', mode: 'buy', prio: 4.5, kind: 'buy_orders', B: Bx,
        label: label + ' → ' + L('주문 (주문일별 수량)', 'đơn đặt (theo ngày)'), modes: () => ({ buy: L('주문일 칸 · 입고예정 칸 그대로 (입고 완료로 둔 주문은 그대로)', 'Theo cột ngày đặt · sắp nhập (giữ đơn đã nhập)') }), apply: applyOrders, preview: previewOrders },
      { table: 'stock_tx', rows: rows.filter(o => !o.pool && o.inv !== null && o.inv !== undefined).map(o => ({ date: fdate, code: o.code, qty: o.inv })), custom: 'buy', mode: 'buy', prio: 4.6, kind: 'buy_stock', B: Bx, date: fdate,
        label: label + ' → ' + L('재고를 파일 재고(Inventory)에 맞춤', 'khớp tồn theo file (Inventory)'), modes: () => ({ buy: L('파일 날짜에 조정으로 맞춤 (다시 올리면 그 날 조정만 다시)', 'Điều chỉnh tại ngày file (tải lại thì tính lại)') }), apply: applyStock, preview: previewStock }];
  });

  /** 파일 품목 → ERP 품목. 없으면 새로 (kg 은 원재료, 그 밖은 부자재 — 이름 · 단위는 파일 그대로) */
  function resolveBuy(Bx) {
    const IT = INV.items(); const created = [], seen = new Set();
    Bx.rows.forEach(o => {
      if (o.pool || IT.get(o.code) || seen.has(up(o.code))) return; seen.add(up(o.code));
      const kg = INV.unitN(o.unit) === 'kg';
      created.push(pick({ _id: F.uid() + Math.random().toString(36).slice(2, 5), code: o.code, name: o.name || o.kr || o.code, name_kr: o.kr || undefined, unit: kg ? 'kg' : (o.unit || 'PCS'),
        stage: kg ? 'RM' : 'SM', etype: kg ? '원재료' : '부재료', src: 'buy' }));
    });
    return { created };
  }
  function previewItems(job) {
    const Bx = job.B; const IT = INV.items(); let have = 0, saf = 0; const miss = [], diff = []; const main = Bx.rows.filter(o => !o.pool), pools = Bx.rows.filter(o => o.pool);
    main.forEach(o => { const it = IT.get(o.code); if (it) { have++; if (o.unit && !unitSame(o.unit, it.unit)) diff.push(o.code + ' (' + o.unit + ' ≠ ' + INV.unitShow(it.unit) + ')'); } else miss.push(o.code); if (o.safety !== null && o.safety !== undefined) saf++; });
    const inFile = new Set(main.map(o => up(o.code))); const off = DB.rows('items').filter(it => it.buy && !inFile.has(up(it.code))).length;
    const parts = [[L('해외 주문 품목', 'Mã đặt nước ngoài'), main.length, 'info'], [L('ERP 품목과 같은 코드', 'Cùng mã ERP'), have, 'info'], [L('안전재고 넣음', 'Đặt tồn AT'), saf, 'info']];
    if (pools.length) parts.push([L('같은 코드 · 다른 구분 → 따로 관리하는 재고', 'Cùng mã · khác nhóm → tồn quản lý riêng'), pools.length, 'info']);
    if (miss.length) parts.push([L('ERP 에 없어 새로 만듦', 'Tạo mã mới'), miss.length, 'warn']);
    if (diff.length) parts.push([L('단위가 ERP 와 다름 (안전재고는 파일 단위로 따로)', 'ĐV khác ERP (tồn AT theo ĐV file)'), diff.length, 'warn']);
    if (Bx.dups.length) parts.push([L('같은 코드 · 같은 구분이 두 번 (첫 줄 사용)', 'Mã lặp cùng nhóm (dùng dòng đầu)'), Bx.dups.length, 'warn']);
    if (off) parts.push([L('목록에서 빠짐 (이 파일에 없음)', 'Bỏ khỏi danh sách (không có trong file)'), off, 'neutral']);
    const list = (a) => a.slice(0, 8).join(', ') + (a.length > 8 ? ' …' : '');
    const pool = (o) => o.code + ' (' + o.pool + L(' — 재고 ', ' — tồn ') + F.n(o.inv) + L(' · 안전재고 ', ' · tồn AT ') + F.n(o.safety) + ')';
    return { parts, detail: [miss.length ? L('새 품목: ', 'Mã mới: ') + list(miss) : '', diff.length ? L('단위 다름: ', 'ĐV khác: ') + list(diff) : '', pools.length ? L('따로 관리: ', 'Quản lý riêng: ') + list(pools.map(pool)) : '',
      Bx.dups.length ? L('두 번 있는 줄 (첫 줄 사용): ', 'Dòng lặp (dùng dòng đầu): ') + list(Bx.dups.map(d => d.code + (d.cat ? ' ' + d.cat : ''))) : ''].filter(Boolean).join(' · ') };
  }
  function applyItems(job) {
    const Bx = job.B; const r = resolveBuy(Bx);
    if (r.created.length) DB.addMany('items', r.created);
    if (Bx.head && (Bx.head.title || Bx.head.author)) DB.setSetting('buyHead', Bx.head);   // 1.11.3: 주문 파일 머리
    const IT = INV.items(); const inFile = new Set(); let updated = 0, off = 0, poolAdd = 0;
    Bx.rows.forEach(o => {
      if (o.pool) return;   // 따로 관리하는 재고는 아래 (buy_pools)
      const it = IT.get(o.code); if (!it) return; inFile.add(it._id);
      const patch = { buy: true, buy_cat: o.cat || undefined, buy_ord: o.ord, buy_unit: o.unit || undefined, buy_inv: o.inv === null || o.inv === undefined ? undefined : o.inv, buy_inv_date: Bx.fdate };
      if (o.kr) patch.name_kr = o.kr;
      // 안전재고: 파일 단위가 ERP 단위와 같으면 품목의 안전재고(원부자재 재고 · 발주에도 쓰임), 다르면 해외 주문 표에서만 쓰는 buy_safety
      if (o.safety !== null && o.safety !== undefined) { if (!o.unit || unitSame(o.unit, it.unit)) { patch.safety = o.safety; patch.buy_safety = undefined; } else patch.buy_safety = o.safety; }
      DB.update('items', it._id, patch); updated++;
    });
    DB.rows('items').forEach(it => { if (it.buy && !inFile.has(it._id)) { DB.update('items', it._id, { buy: false }); off++; } });
    // 1.11.2: 따로 관리하는 재고 (같은 코드 · 다른 구분) — 파일 값으로, 리드타임은 그대로. 파일에 없는 것은 지운다
    const curP = DB.rows('buy_pools').slice(); const idxP = new Map(curP.map(p => [pkey({ code: p.code, pool: p.cat }), p])); const keepP = new Set();
    Bx.rows.filter(o => o.pool).forEach(o => {
      const it = IT.get(o.code); const code = it ? it.code : o.code; const k = pkey({ code, pool: o.pool }); keepP.add(k);
      const p = { code, cat: o.pool, name: o.name || (it ? it.name : undefined), name_kr: o.kr || undefined, unit: o.unit || undefined, safety: o.safety === null ? undefined : o.safety,
        inv: o.inv === null ? undefined : o.inv, inv_date: Bx.fdate, ord: o.ord };
      const e = idxP.get(k); if (e) { DB.update('buy_pools', e._id, p); updated++; } else { DB.add('buy_pools', pick(p)); poolAdd++; }
    });
    const goneP = curP.filter(p => !keepP.has(pkey({ code: p.code, pool: p.cat }))).map(p => p._id); if (goneP.length) DB.remove('buy_pools', goneP);
    return { added: r.created.length + poolAdd, updated, removed: off + goneP.length, skipped: Bx.dups.length };
  }
  /** 파일의 주문일 칸 · 입고예정 칸 → 바꿀 주문. 파일에 있는 주문일 · 품목의 입고 대기 주문은 파일 값이 된다 (입고 완료는 그대로) */
  function planOrders(job) {
    const Bx = job.B; const cur = DB.rows('buy_orders');
    const dated = new Map(cur.filter(o => o.kind !== 'inc').map(o => [okey(o.date, o), o]));
    const want = new Map(), incW = new Map();
    job.rows.forEach(r => { if (r.kind === 'inc') incW.set(pkey(r), r); else want.set(okey(r.date, r), r); });
    const codes = new Set(Bx.rows.map(o => pkey(o))), dates = new Set(Bx.dates);   // 품목코드 + 따로 관리하는 구분
    const add = [], upd = [], del = []; let kept = 0;
    want.forEach((r, k) => { const e = dated.get(k); if (!e) add.push(r); else if (e.status === 'recv') kept++; else if (num(e.qty) !== r.qty || str(e.unit) !== str(r.unit)) upd.push([e, { qty: r.qty, unit: r.unit || undefined }]); });
    cur.forEach(o => { if (o.kind !== 'inc' && o.status !== 'recv' && dates.has(o.date) && codes.has(pkey(o)) && !want.has(okey(o.date, o))) del.push(o); });
    // 입고예정 칸: 품목마다 입고 대기 '입고예정' 한 줄 = 파일 값 (파일에 없으면 지움)
    codes.forEach(c => {
      const os = cur.filter(o => o.kind === 'inc' && o.status !== 'recv' && pkey(o) === c); const w = incW.get(c);
      if (!w) { os.forEach(o => del.push(o)); return; }
      if (!os.length) { add.push(w); return; }
      if (num(os[0].qty) !== w.qty || str(os[0].unit) !== str(w.unit)) upd.push([os[0], { qty: w.qty, unit: w.unit || undefined, date: w.date }]);
      os.slice(1).forEach(o => del.push(o));
    });
    return { add, upd, del, kept };
  }
  function previewOrders(job) {
    const Bx = job.B; const p = planOrders(job); const byDate = {}; job.rows.forEach(r => { if (r.kind !== 'inc') byDate[r.date] = (byDate[r.date] || 0) + 1; });
    const inc = job.rows.filter(r => r.kind === 'inc').length;
    const parts = [[L('주문', 'Đơn'), job.rows.length, 'info'], [L('새 주문', 'Đơn mới'), p.add.length, p.add.length ? 'info' : 'neutral']];
    if (p.upd.length) parts.push([L('수량 바뀜', 'Đổi SL'), p.upd.length, 'info']); if (p.del.length) parts.push([L('파일에서 지운 주문', 'Đơn đã xóa trong file'), p.del.length, 'warn']);
    if (p.kept) parts.push([L('입고 완료로 둔 주문은 그대로', 'Giữ đơn đã nhập'), p.kept, 'neutral']);
    return { parts, detail: L('주문일 칸: ', 'Cột ngày đặt: ') + (Bx.dates.length ? Bx.dates.map(d => d + ' (' + (byDate[d] || 0) + ')').join(' · ') : L('없음', 'không có')) + (inc ? L(' · 입고예정 ', ' · Sắp nhập ') + inc : '') + ' · ' + L('파일 날짜 ', 'Ngày file ') + Bx.fdate };
  }
  function applyOrders(job) {
    const IT = INV.items(); const p = planOrders(job);
    p.add.forEach(r => { const it = IT.get(r.code); DB.add('buy_orders', pick({ date: r.date, code: it ? it.code : r.code, kind: r.kind, pool: r.pool, name: it ? it.name : undefined, qty: r.qty, unit: r.unit, status: 'open', src: 'file' })); });
    p.upd.forEach(([e, patch]) => DB.update('buy_orders', e._id, patch));
    if (p.del.length) DB.remove('buy_orders', p.del.map(o => o._id));
    return { added: p.add.length, updated: p.upd.length, removed: p.del.length, skipped: p.kept };
  }

  /** 1.11.1: 파일의 재고(Inventory) → 파일 날짜의 ERP 재고와의 차이만큼 조정. 같은 날의 예전 조정(src 'buy')은 빼고 계산해 바꾼다 */
  function planStock(job) {
    const Bx = job.B; const d = Bx.fdate; const IT = INV.items(); const st = C.stock(d); const codes = new Set(Bx.rows.filter(o => !o.pool).map(o => up(o.code)));
    const old = DB.rows('stock_tx').filter(t => t.src === 'buy' && t.kind === 'ADJ' && t.date === d && codes.has(up(t.code)));
    const oldBy = new Map(); old.forEach(t => { const k = up(t.code); oldBy.set(k, (oldBy.get(k) || 0) + num(t.qty)); });
    const adj = [], same = [], noInv = [], noConv = [], pools = [];
    Bx.rows.forEach(o => {
      if (o.pool) { pools.push(o.code + ' ' + o.pool); return; }   // 따로 관리하는 재고 = 파일 값 그대로 (ERP 품목 재고와 따로)
      if (o.inv === null || o.inv === undefined) { noInv.push(o.code); return; }
      const it = IT.get(o.code);   // 없으면 품목 작업이 파일 단위로 만든다 (재고 0)
      const want = it ? B.toErp(it, o.inv, o.unit) : o.inv; if (want === null) { noConv.push(o.code + ' (' + o.unit + ' ≠ ' + INV.unitShow(it.unit) + ')'); return; }
      const s = it ? st.get(it.code) : null; const bal = (s ? s.bal : 0) - (oldBy.get(up(o.code)) || 0);
      const q = Math.round((want - bal) * 10000) / 10000;
      if (Math.abs(q) < 1e-6) { same.push(o.code); return; }
      adj.push({ code: it ? it.code : o.code, name: it ? it.name : (o.name || o.kr || o.code), unit: it ? INV.unitShow(it.unit) : (INV.unitN(o.unit) === 'kg' ? 'kg' : o.unit), qty: q, from: bal, to: want });
    });
    return { d, adj, same, noInv, noConv, pools, old };
  }
  function previewStock(job) {
    const p = planStock(job); const fmt = (v) => F.n(v, isInt(v) ? 0 : 2);
    const parts = [[L('재고 맞춤 (' + p.d + ' 조정)', 'Khớp tồn (điều chỉnh ' + p.d + ')'), p.adj.length, p.adj.length ? 'info' : 'neutral'], [L('이미 같음', 'Đã khớp'), p.same.length, 'neutral']];
    if (p.noInv.length) parts.push([L('파일에 재고 없음 (그대로)', 'File không có tồn (giữ nguyên)'), p.noInv.length, 'neutral']);
    if (p.noConv.length) parts.push([L('단위를 못 바꿈 (그대로)', 'Không đổi được ĐV (giữ nguyên)'), p.noConv.length, 'warn']);
    if (p.pools.length) parts.push([L('따로 관리하는 재고 (파일 값 그대로)', 'Tồn quản lý riêng (theo file)'), p.pools.length, 'neutral']);
    if (p.old.length) parts.push([L('같은 날 예전 조정은 바꿈', 'Thay điều chỉnh cũ cùng ngày'), p.old.length, 'neutral']);
    return { parts, detail: p.adj.slice(0, 8).map(a => a.code + ' ' + fmt(a.from) + ' → ' + fmt(a.to) + ' ' + a.unit + ' (' + (a.qty > 0 ? '+' : '') + fmt(a.qty) + ')').join(' · ') + (p.adj.length > 8 ? ' …' : '') + (p.noConv.length ? ' · ' + L('단위를 못 바꿈: ', 'Không đổi ĐV: ') + p.noConv.join(', ') : '') };
  }
  function applyStock(job) {
    const p = planStock(job);
    if (p.old.length) DB.remove('stock_tx', p.old.map(t => t._id));
    if (p.adj.length) DB.addMany('stock_tx', p.adj.map(a => pick({ date: p.d, kind: 'ADJ', to_scope: 'WH', code: a.code, name: a.name, qty: a.qty, unit: a.unit, purpose: '자재구매 파일 재고 맞춤', note: job.B.file || undefined, src: 'buy' })));
    return { added: p.adj.length, removed: p.old.length, skipped: p.noInv.length + p.noConv.length };
  }

  // ===================================================================== 계산
  /** 기본 리드타임 (설정, 비어 있으면 null) · 품목 리드타임 */
  B.lead = () => { const v = num(DB.setting('buyLead', '')); return v > 0 ? v : null; };
  B.leadOf = (it) => (num(it.lead_days) > 0 ? num(it.lead_days) : B.lead());
  /** 해외 주문 품목 (파일 순서) */
  B.items = () => DB.memo('buy.items', ['items'], () => DB.rows('items').filter(it => it.buy).sort((a, b) => (num(a.buy_ord) || 1e9) - (num(b.buy_ord) || 1e9) || String(a.code).localeCompare(String(b.code), undefined, { numeric: true })));
  B.unitOf = (it) => str(it.buy_unit) || INV.unitShow(it.unit);
  /** ERP 단위 수량 → 해외 주문 단위 (같으면 그대로, kg ↔ 개는 개당 kg). 못 바꾸면 null */
  B.toBuy = function (it, q) {
    const bu = INV.unitN(B.unitOf(it)), iu = INV.unitN(it.unit);
    if (!bu || !iu || bu === iu) return q;
    const k = num(it.kg_per_ea); if (!(k > 0)) return null;
    if (bu === 'kg') return q * k;
    if (iu === 'kg') return q / k;
    return null;
  };
  /** 해외 주문 단위 수량 → ERP 단위 (B.toBuy 의 반대). 못 바꾸면 null */
  B.toErp = function (it, q, unit) {
    const bu = INV.unitN(unit || B.unitOf(it)), iu = INV.unitN(it.unit);
    if (!bu || !iu || bu === iu) return q;
    const k = num(it.kg_per_ea); if (!(k > 0)) return null;
    if (bu === 'kg') return q / k;
    if (iu === 'kg') return q * k;
    return null;
  };
  /** 해외 주문 표에서 쓰는 안전재고 (해외 주문 단위) */
  B.safetyOf = function (it) {
    const same = !str(it.buy_unit) || unitSame(it.buy_unit, it.unit);
    const v = same ? it.safety : it.buy_safety;
    return v === null || v === undefined || v === '' || !isFinite(+v) ? null : +v;
  };
  /** 월별 창고 출고 (외부 출고 + 공장으로 이동, ERP 단위): 품목코드 → Map(YYYY-MM → 수량) */
  B.usage = () => DB.memo('buy.usage', ['stock_tx', 'items'], () => {
    const out = new Map(); const IT = INV.items();
    DB.rows('stock_tx').forEach(t => {
      const isOut = t.kind === 'OUT' && (!t.from_scope || t.from_scope === 'WH'), isMove = t.kind === 'MOVE' && t.from_scope === 'WH' && t.to_scope === 'FAC';
      if (!isOut && !isMove) return;
      const it = IT.get(t.code); if (!it || !it.buy) return; const ym = String(t.date || '').slice(0, 7); if (ym.length !== 7) return;
      let m = out.get(it.code); if (!m) out.set(it.code, m = new Map()); m.set(ym, (m.get(ym) || 0) + num(t.qty));
    });
    return out;
  });
  /** 월 사용량을 보는 달: 지난 12달 (창고 기준일 뒤부터) ~ 지난달 */
  B.months = function () {
    const cur = F.today().slice(0, 7); const end = addMonth(cur, -1); let start = addMonth(cur, -12);
    const od = INV.openDates(); const o = od.WH || od.first; if (o) { const s = F.addDays(o, 1).slice(0, 7); if (s > start) start = s; }
    const out = []; for (let m = start; m <= end; m = addMonth(m, 1)) out.push(m); return out;
  };
  /** 안전재고 자릿수 단위: 80 → 10, 300 → 100, 1,400 → 1,000, 18,000 → 10,000, 4,000,000 → 1,000,000 (없으면 1) */
  B.stepOf = (safety) => (safety > 0 ? Math.pow(10, Math.floor(Math.log10(safety) + 1e-9)) : 1);
  const numOr = (v) => (v === null || v === undefined || v === '' || !isFinite(+v) ? null : +v);
  /** 표 한 줄 = ERP 품목 (자재구매 파일의 첫 줄) 또는 따로 관리하는 재고 (1.11.2: 같은 코드 · 다른 구분, buy_pools) */
  B.rows = () => DB.memo('buy.rows:' + F.today() + ':' + (B.lead() || ''), ['items', 'stock_open', 'stock_tx', 'prod_log', 'bom', 'bom_lines', 'recipes', 'products', 'item_bom', 'materials', 'code_dict', 'code_map', 'buy_orders', 'buy_pools'], () => {
    const st = C.stock(); const use = B.usage(); const months = B.months(); const today = F.today();
    const byKey = new Map(); DB.rows('buy_orders').forEach(o => { const it = INV.item(o.code); const k = pkey({ code: it ? it.code : o.code, pool: o.pool }); let a = byKey.get(k); if (!a) byKey.set(k, a = []); a.push(o); });
    const rows = B.items().map(it => {
      const s = st.get(it.code); const balE = s ? s.bal : 0;
      return one({ it, code: it.code, pool: '', cat: str(it.buy_cat), name: str(it.name), kr: str(it.name_kr), unit: B.unitOf(it), unitE: INV.unitShow(it.unit), bal: B.toBuy(it, balE), balE,
        safety: B.safetyOf(it), fileInv: numOr(it.buy_inv), fileDate: str(it.buy_inv_date), ord: num(it.buy_ord) || 1e9, leadDays: num(it.lead_days), step: num(it.buy_step) });
    });
    // 따로 관리하는 재고: 재고 = 자재구매 파일 값 (창고 입출고장 · 수불과 따로), 월 사용량은 파일처럼 같은 코드의 값
    DB.rows('buy_pools').forEach(p => { const it = INV.item(p.code); if (!it || !it.buy) return;   // 첫 줄(ERP 품목)이 목록에 있을 때만
      const v = numOr(p.inv);
      rows.push(one({ it, poolRow: p, code: it ? it.code : str(p.code), pool: str(p.cat), cat: str(p.cat), name: str(p.name) || (it ? str(it.name) : ''), kr: str(p.name_kr), unit: str(p.unit) || (it ? B.unitOf(it) : ''),
        unitE: str(p.unit) || (it ? B.unitOf(it) : ''), bal: v === null ? 0 : v, balE: v === null ? 0 : v, safety: numOr(p.safety), fileInv: null, fileDate: str(p.inv_date), ord: num(p.ord) || 1e9, leadDays: num(p.lead_days), step: num(p.step) })); });
    return rows.sort((a, b) => a.ord - b.ord || String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
    function one(x) {
      const it = x.it, bal = x.bal, balE = x.balE, unit = x.unit, safety = x.safety, fileInv = x.fileInv; const bu = INV.unitN(unit); const kgpe = it ? num(it.kg_per_ea) : 0;
      const invDiff = fileInv !== null && bal !== null && Math.abs(fileInv - bal) >= 0.5;   // 자재구매 파일의 재고와 다름 (같이 보인다)
      const key = pkey({ code: x.code, pool: x.pool });
      const all = (byKey.get(key) || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const ords = all.filter(o => o.kind !== 'inc'), incs = all.filter(o => o.kind === 'inc');   // 주문일 칸 · 입고예정 칸
      const open = all.filter(o => o.status !== 'recv'), incOpen = incs.filter(o => o.status !== 'recv');
      const incQ = incOpen.reduce((a, o) => a + num(o.qty), 0), openQ = open.reduce((a, o) => a + num(o.qty), 0);
      const u = (it && use.get(it.code)) || new Map(); const mv = months.map(m => (it ? B.toBuy(it, u.get(m) || 0) : null)); const conv = mv.every(v => v !== null);
      const vals = conv ? mv : [];
      const max = vals.length ? Math.max(...vals) : null, min = vals.length ? Math.min(...vals) : null, avg = vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
      const last = vals.length ? vals[vals.length - 1] : null;
      // kg/월 · ea/월 (파일처럼: kg 품목은 kg 와 개(포대 · 통) 수 = kg ÷ 개당 kg, 개 품목은 개만)
      const lastKg = last === null || bu !== 'kg' ? null : last;   // 개 품목은 파일처럼 kg/월 을 비운다
      const lastEa = last === null ? null : (bu === 'kg' ? (kgpe > 0 ? last / kgpe : null) : last);
      const lead = x.leadDays > 0 ? x.leadDays : B.lead(); const leadUse = lead && avg !== null ? avg / 30 * lead : 0;
      const total = bal === null ? null : bal + openQ;   // = 재고 + 입고예정 + 입고 대기 주문 (파일의 Total)
      const proj = total === null ? null : total - leadUse;
      const status = safety === null || proj === null ? 'na' : (proj < safety ? 'need' : 'ok');
      // 1.11.3: 주문 단위 = 품목별로 넣은 값, 없으면 안전재고 자릿수 (백 단위 → 100, 천 단위 → 1,000 …) — 권장 주문량은 그 단위로 올림
      const step = x.step > 0 ? x.step : B.stepOf(safety);
      let sug = 0;
      if (status === 'need') { sug = safety + leadUse - total; sug = Math.round(Math.ceil(sug / step - 1e-9) * step * 10000) / 10000; }
      const etaOf = (o) => str(o.eta) || (lead && o.kind !== 'inc' ? F.addDays(o.date, lead) : null);   // 입고예정 칸은 직접 넣은 도착 예정만
      const etas = open.map(etaOf).filter(Boolean).sort(); const eta = etas[0] || null;
      const late = open.filter(o => { const e = etaOf(o); return e && e < today; }).length;
      return { it, key, code: x.code, pool: x.pool, poolRow: x.poolRow || null, ord: x.ord, cat: x.cat, name: x.name, kr: x.kr, unit, bu, unitE: x.unitE, bal, balE, safety, fileInv, fileDate: x.fileDate, invDiff, ords, incs, open, incOpen, incQ, openQ, total,
        months, mv, conv, max, min, avg, last, lastKg, lastEa, lead, leadOwn: x.leadDays > 0, leadDays: x.leadDays, leadUse, status, sug, step, stepOwn: x.step > 0, eta, late, kgpe, etaOf };
    }
  });

  // ===================================================================== 원부자재 재고 → 해외 주문 탭
  const STATUS = () => ({ need: [L('주문 필요', 'Cần đặt'), 'bad'], ok: [L('충분', 'Đủ'), 'ok'], na: [L('안전재고 없음', 'Chưa có tồn AT'), 'neutral'] });
  /** 주문 줄 저장 (빈 칸 · 0 은 지움) */
  function setOrder(r, date, v) {
    const e = DB.rows('buy_orders').find(o => o.kind !== 'inc' && o.date === date && pkey(o) === r.key);
    if (!(v > 0)) { if (e) DB.remove('buy_orders', [e._id]); return; }
    if (e) DB.update('buy_orders', e._id, { qty: v, unit: r.unit });
    else DB.add('buy_orders', pick({ date, code: r.code, pool: r.pool || undefined, name: r.name, qty: v, unit: r.unit, status: 'open', src: 'erp' }));
  }
  /** 입고 완료 / 입고 대기로 되돌리기. 따로 관리하는 재고(pool)는 그 재고에 더하고 뺀다 (창고 입출고장에 없으므로), ERP 품목은 재고를 바꾸지 않는다 */
  function setRecv(o, on) {
    DB.update('buy_orders', o._id, on ? { status: 'recv', recv: F.today() } : { status: 'open', recv: undefined });
    if (!o.pool) return;
    const p = DB.rows('buy_pools').find(x => pkey({ code: x.code, pool: x.cat }) === pkey(o)); if (!p) return;
    DB.update('buy_pools', p._id, { inv: Math.round(((num(p.inv) || 0) + (on ? 1 : -1) * num(o.qty)) * 10000) / 10000, inv_date: F.today() });
  }
  /** 입고예정 칸 저장: 품목마다 입고 대기 '입고예정' 한 줄 (빈 칸 · 0 은 지움) */
  function setInc(r, v) {
    const os = DB.rows('buy_orders').filter(o => o.kind === 'inc' && o.status !== 'recv' && pkey(o) === r.key);
    if (!(v > 0)) { if (os.length) DB.remove('buy_orders', os.map(o => o._id)); return; }
    if (os.length) { DB.update('buy_orders', os[0]._id, { qty: v, unit: r.unit }); if (os.length > 1) DB.remove('buy_orders', os.slice(1).map(o => o._id)); }
    else DB.add('buy_orders', pick({ date: F.today(), code: r.code, kind: 'inc', pool: r.pool || undefined, name: r.name, qty: v, unit: r.unit, status: 'open', src: 'erp' }));
  }
  ERP.buyTab = function (host) {
    const st = ERP.state.buy = ERP.state.buy || { q: '', cat: '', status: '', newDates: [], addDate: F.today() };
    const SS = STATUS(); const today = F.today();
    const all = B.rows();
    if (!all.length) {
      put(host, h('div', { class: 'empty', style: { padding: '28px 12px' } }, h('p', { style: { margin: '0 0 10px' } }, L('해외 주문 품목이 아직 없습니다.', 'Chưa có mã đặt nước ngoài.')),
        h('p', { class: 'help' }, L('엑셀 · 구글 연동 → 자료 올리기에 자재구매 파일(Category · Item Code · Item Name · Item Name Kr · Safety stock · Unit · Inventory 표)을 올리면 그 품목만 여기에 따로 보입니다.', 'Tải file mua NVL (bảng Category · Item Code · Safety stock …) ở Excel · Google → Tải dữ liệu; các mã đó sẽ hiện riêng ở đây.')),
        h('button', { class: 'btn primary', onclick: () => { ERP.state.dataTab = 'import'; ERP.goto('data'); } }, L('자재구매 파일 올리기', 'Tải file mua NVL'))));
      return;
    }
    // ---- 보이는 주문일 칸: 입고 대기 주문이 있는 날 + 새로 연 칸 + 모두 입고된 날은 최근 3개
    const allDates = new Set(); all.forEach(r => r.ords.forEach(o => allDates.add(o.date)));
    st.newDates = st.newDates || [];
    const openDates = new Set(); all.forEach(r => r.ords.forEach(o => { if (o.status !== 'recv') openDates.add(o.date); }));
    const dates = []; let doneN = 0;
    Array.from(new Set(Array.from(allDates).concat(st.newDates))).sort().reverse().forEach(d => { if (openDates.has(d) || st.newDates.includes(d)) dates.push(d); else if (doneN < 3) { dates.push(d); doneN++; } });
    // ---- 위 숫자
    const cats = []; all.forEach(r => { if (r.cat && !cats.includes(r.cat)) cats.push(r.cat); });
    const need = all.filter(r => r.status === 'need'), openN = all.reduce((a, r) => a + r.open.length, 0), lateN = all.reduce((a, r) => a + r.late, 0), noSafety = all.filter(r => r.status === 'na').length;
    const lead = B.lead(); const leadOwn = all.filter(r => r.leadOwn).length; const invDiffN = all.filter(r => r.invDiff).length; const poolN = all.filter(r => r.pool).length;
    let whLast = ''; DB.rows('stock_tx').forEach(t => { if (t.src === 'wh' && t.date > whLast) whLast = t.date; });   // 창고 입출고장 마지막 입출고일
    const months = all[0].months; const lastM = months[months.length - 1] || '';
    const kpis = h('section', { class: 'kpis', style: { margin: '0 0 12px' } },
      ERP.kpi(L('해외 주문 품목', 'Mã đặt nước ngoài'), F.n(all.length - poolN), L('품목', 'mã'), invDiffN ? 'warn' : (poolN ? 'info' : 'neutral'), invDiffN ? L('파일 재고와 다름 ', 'Khác tồn trong file ') + F.n(invDiffN) : (poolN ? L('따로 관리 ', 'Quản lý riêng ') + F.n(poolN) + L('줄', ' dòng') : null), L('구분 ', 'Nhóm ') + F.n(cats.length) + L('개 · 자재구매 파일 순서', ' · theo thứ tự file')),
      ERP.kpi(L('주문 필요', 'Cần đặt'), F.n(need.length), L('품목', 'mã'), need.length ? 'bad' : 'ok', need.length ? L('권장 주문량 참고', 'Xem SL đề xuất') : L('없음', 'Không có'), noSafety ? L('안전재고 없음 ', 'Chưa có tồn AT ') + F.n(noSafety) : L('합계 − 리드타임 동안 쓸 양 < 안전재고', 'Tổng − lượng dùng trong thời gian giao < tồn AT')),
      ERP.kpi(L('입고 대기 주문', 'Đơn chờ nhập'), F.n(openN), L('건', 'dòng'), lateN ? 'warn' : 'neutral', lateN ? L('도착 예정 지남 ', 'Quá ngày dự kiến ') + F.n(lateN) : null, L('입고 완료하면 합계에서 빠짐 (재고는 창고 입출고장으로)', 'Đã nhập thì bỏ khỏi tổng (tồn vào qua sổ kho)')),
      ERP.kpi(L('리드타임 (기본)', 'Thời gian giao (mặc định)'), lead ? F.n(lead) : '–', lead ? L('일', 'ngày') : '', lead ? 'info' : 'warn', lead ? null : L('아직 안 넣음', 'Chưa nhập'), L('품목별로 넣은 것 ', 'Đã nhập riêng ') + F.n(leadOwn) + L('품목', ' mã')));
    // ---- 거르기
    const pickRows = (list) => {   // 칸에 넣은 수량은 화면을 다시 그리지 않고 저장하므로, 버튼은 그때의 계산(B.rows())으로
      let a = list.slice();
      if (st.cat) a = a.filter(r => r.cat === st.cat);
      if (st.status === 'need') a = a.filter(r => r.status === 'need'); else if (st.status === 'open') a = a.filter(r => r.open.length); else if (st.status === 'late') a = a.filter(r => r.late); else if (st.status === 'na') a = a.filter(r => r.status === 'na');
      if (st.q) { const k = INV.normName(st.q); a = a.filter(r => [r.code, r.name, r.kr, r.cat, r.it.xnk].some(v => INV.normName(v).includes(k))); }
      return a;
    };
    const rows = pickRows(all);
    const qid = 'buyq';
    const q = h('input', { type: 'search', id: qid, placeholder: L('품목코드 · 품명 · 한글 품명', 'Mã · tên · tên Hàn'), value: st.q, oninput: (e) => { st.q = e.target.value; clearTimeout(st._t); st._t = setTimeout(() => { ERP.render(); const i = document.getElementById(qid); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 300); } });
    const leadInp = h('input', { class: 'inp', type: 'number', min: 0, step: 1, style: { width: '74px', textAlign: 'right' }, value: lead || '', placeholder: '–', title: L('주문 → 입고 일수 (품목별로 넣지 않은 품목에 씀)', 'Số ngày từ đặt → nhập (cho mã chưa nhập riêng)'),
      onchange: (e) => { const v = Number(e.target.value); DB.setSetting('buyLead', v > 0 ? v : ''); ERP.render(); } });
    const addInp = h('input', { class: 'inp', type: 'date', value: st.addDate || today, onchange: (e) => { st.addDate = e.target.value; } });
    const addCol = () => { const d = st.addDate || today; if (!st.newDates.includes(d)) st.newDates.push(d); ERP.render(); };
    const fillSug = async () => {
      const d = (st.newDates.length ? st.newDates.slice().sort().reverse()[0] : null) || st.addDate || today;
      const list = B.rows().filter(r => r.status === 'need' && r.sug > 0 && !r.ords.some(o => o.date === d));
      if (!list.length) { ERP.toast(L('넣을 권장 주문량이 없습니다 (주문 필요 품목이 없거나 그 날짜에 이미 주문이 있음)', 'Không có SL đề xuất để điền'), 'warn'); return; }
      if (!(await ERP.confirm(L('권장 주문량을 ' + d + ' 주문 칸에 넣을까요? (' + list.length + '품목)\n넣은 뒤 수량을 고칠 수 있습니다.', 'Điền SL đề xuất vào cột ' + d + '? (' + list.length + ' mã)')))) return;
      list.forEach(r => DB.add('buy_orders', pick({ date: d, code: r.code, pool: r.pool || undefined, name: r.name, qty: r.sug, unit: r.unit, status: 'open', src: 'erp' })));
      if (!st.newDates.includes(d)) st.newDates.push(d);
      ERP.toast(L('권장 주문량을 넣었습니다', 'Đã điền SL đề xuất'), 'ok'); ERP.render();
    };
    /** 1.11.3: 주문 파일 — 이번 주문일 칸에 주문이 없는 주문 필요 품목은 권장 주문량을 넣고, 자재구매 파일과 같은 서식으로 */
    const orderFile = async () => {
      const d = (st.newDates.length ? st.newDates.slice().sort().reverse()[0] : null) || st.addDate || today;
      const lack = B.rows().filter(r => r.status === 'need' && r.sug > 0 && !r.ords.some(o => o.date === d));
      if (lack.length) {
        if (!(await ERP.confirm(L('주문 필요 ' + lack.length + '품목의 권장 주문량(안전재고 자릿수 단위로 올림)을 ' + d + ' 주문 칸에 넣고 주문 파일을 만들까요?\n넣은 주문은 입고 대기로 남고, 칸에서 고치거나 지울 수 있습니다.', 'Điền SL đề xuất của ' + lack.length + ' mã vào cột ' + d + ' và tạo file đặt hàng?')))) return;
        lack.forEach(r => DB.add('buy_orders', pick({ date: d, code: r.code, pool: r.pool || undefined, name: r.name, qty: r.sug, unit: r.unit, status: 'open', src: 'erp' })));
        if (!st.newDates.includes(d)) st.newDates.push(d);
      }
      B.orderFile(d); ERP.render();
    };
    const tb = h('div', { class: 'toolbar' },
      h('label', { class: 'search' }, ERP.svg('M21 21l-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z', 17), q),
      h('select', { class: 'inp', onchange: (e) => { st.cat = e.target.value; ERP.render(); } }, h('option', { value: '' }, L('구분: 전체', 'Nhóm: tất cả')), cats.map(c => h('option', { value: c, selected: st.cat === c }, c))),
      h('select', { class: 'inp', onchange: (e) => { st.status = e.target.value; ERP.render(); } }, [['', L('상태: 전체', 'Trạng thái: tất cả')], ['need', L('주문 필요', 'Cần đặt')], ['open', L('입고 대기 주문 있음', 'Có đơn chờ nhập')], ['late', L('도착 예정 지남', 'Quá ngày dự kiến')], ['na', L('안전재고 없음', 'Chưa có tồn AT')]].map(o => h('option', { value: o[0], selected: st.status === o[0] }, o[1]))),
      h('label', { class: 'muted nowrap' }, L('기본 리드타임 ', 'Thời gian giao mặc định '), leadInp, L(' 일', ' ngày')),
      h('span', { class: 'sp' }),
      h('span', { class: 'nowrap', style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, addInp, h('button', { class: 'btn sm', onclick: addCol }, '+ ' + L('주문 칸', 'Cột đặt hàng'))),
      h('button', { class: 'btn sm', onclick: fillSug }, L('권장 주문량 넣기', 'Điền SL đề xuất')),
      h('button', { class: 'btn sm primary', onclick: orderFile, title: L('권장 주문량을 주문 칸에 넣고 자재구매 파일과 같은 서식의 엑셀을 만듭니다', 'Điền SL đề xuất và tạo file Excel cùng mẫu file mua NVL') }, L('주문 파일 만들기', 'Tạo file đặt hàng')),
      h('button', { class: 'btn sm', onclick: () => { ERP.state.dataTab = 'import'; ERP.goto('data'); } }, L('자재구매 파일 올리기', 'Tải file mua NVL')));
    // ---- 표 (자재구매 파일과 같은 칸 순서)
    const refs = new Map();   // 줄 열쇠 (품목코드 + 따로 관리하는 구분) → 다시 계산할 칸
    const refresh = (key) => { const r = B.rows().find(x => x.key === key); const c = refs.get(key); if (!r || !c) return; fillCalc(c, r); };
    const fillCalc = (c, r) => {
      if (c.balV.tagName !== 'INPUT') c.balV.textContent = fq(r.bal, r.unit);
      c.balV.style.color = r.safety !== null && r.bal !== null && r.bal < r.safety ? '#B3261E' : '';
      c.step.placeholder = r.stepOwn ? '' : String(r.step);
      c.total.textContent = fq(r.total, r.unit);
      c.eta.replaceChildren(); if (r.eta) put(c.eta, h('span', { style: r.late ? { color: '#B3261E', fontWeight: 700 } : null, title: r.late ? L('도착 예정일이 지났습니다 (입고되면 입고 완료를 누르세요)', 'Đã quá ngày dự kiến') : '' }, F.d(r.eta)));
      c.status.replaceChildren(ERP.chip(SS[r.status][1], SS[r.status][0]));
      c.sug.textContent = r.sug > 0 ? fq(r.sug, r.unit) : '';
      c.lead.placeholder = B.lead() ? String(B.lead()) : '–';
    };
    const dateHead = (d) => {
      const os = []; all.forEach(r => r.ords.forEach(o => { if (o.date === d) os.push(o); }));
      const openOs = os.filter(o => o.status !== 'recv');
      return h('th', { class: 'num', style: { minWidth: '108px' } }, h('div', d), h('div', { style: { display: 'flex', gap: '4px', justifyContent: 'flex-end', marginTop: '3px' } },
        openOs.length ? h('button', { class: 'btn sm', title: L('이 날 주문을 모두 입고 완료로 (재고는 창고 입출고장 · 수불로 들어옴)', 'Đánh dấu đã nhập cả cột'), onclick: async () => {
          if (!(await ERP.confirm(L(d + ' 주문 ' + openOs.length + '건을 입고 완료로 할까요?\n입고예정에서 빠집니다. 재고는 창고 입출고장 · 수불 입력으로 들어옵니다.', 'Đánh dấu ' + openOs.length + ' đơn ngày ' + d + ' đã nhập?')))) return;
          openOs.forEach(o => setRecv(o, true)); ERP.render(); } }, L('입고 완료', 'Đã nhập')) : null,
        h('button', { class: 'icon-btn', title: L('이 주문 칸 지우기', 'Xóa cột này'), onclick: async () => {
          if (os.length && !(await ERP.confirm(L(d + ' 주문 ' + os.length + '건을 지울까요?', 'Xóa ' + os.length + ' đơn ngày ' + d + '?'), L('삭제', 'Xóa'), true))) return;
          if (os.length) DB.remove('buy_orders', os.map(o => o._id)); st.newDates = st.newDates.filter(x => x !== d); ERP.render(); } }, '×')));
    };
    const incCell = (r) => {
      const inp = h('input', { class: 'inp', type: 'number', min: 0, step: 'any', style: { width: '84px', textAlign: 'right' }, value: r.incQ || '', placeholder: '',
        title: L('주문일 없이 들어올 수량 (파일의 입고예정 칸)', 'Số lượng sắp nhập (không có ngày đặt)') + (r.incOpen.length ? ' · ' + r.incOpen.map(o => o.date + ' ' + F.n(o.qty)).join(', ') : ''),
        onchange: (e) => { setInc(r, Number(e.target.value)); refresh(r.key); } });
      const done = r.incOpen.length ? h('button', { class: 'icon-btn', title: L('입고 완료', 'Đã nhập'), onclick: () => { r.incOpen.forEach(o => setRecv(o, true)); ERP.render(); } }, '✓') : null;
      return h('td', { class: 'num nowrap' }, inp, done);
    };
    const orderCell = (r, d) => {
      const o = r.ords.find(x => x.date === d);
      if (o && o.status === 'recv') return h('td', { class: 'num' }, h('button', { class: 'chipbtn', style: { color: '#0E7A5F' }, title: L('입고 완료 ', 'Đã nhập ') + (o.recv || '') + L(' · 누르면 입고 대기로', ' · bấm để chuyển về chờ nhập'), onclick: () => { setRecv(o, false); ERP.render(); } }, '✓ ' + fq(o.qty, r.unit)));
      const inp = h('input', { class: 'inp', type: 'number', min: 0, step: 'any', style: { width: '84px', textAlign: 'right' }, value: o ? o.qty : '', placeholder: '',
        title: o ? L('도착 예정 ', 'Dự kiến về ') + (r.etaOf(o) || '–') : '', onchange: (e) => { setOrder(r, d, Number(e.target.value)); r.ords = B.rows().find(x => x.key === r.key).ords; refresh(r.key); } });
      const done = o ? h('button', { class: 'icon-btn', title: L('입고 완료', 'Đã nhập'), onclick: () => { setRecv(o, true); ERP.render(); } }, '✓') : null;
      return h('td', { class: 'num nowrap' }, inp, done);
    };
    const th = (ko, vi, en, isNum, title) => h('th', { class: isNum ? 'num' : '', title: [en, title].filter(Boolean).join(' · ') || null }, L(ko, vi));
    const mTitle = months.length ? months[0] + ' ~ ' + lastM + L(' 월별 창고 출고', ' xuất kho theo tháng') : L('창고 출고 자료 없음', 'Chưa có dữ liệu xuất kho');
    const body = rows.map(r => {
      const c = { balV: h('span'), total: h('td', { class: 'num', style: { fontWeight: 700 } }), eta: h('td', { class: 'nowrap' }), status: h('td'), sug: h('td', { class: 'num', style: { fontWeight: 700, color: '#1F5FBF' } }) };
      c.lead = h('input', { class: 'inp', type: 'number', min: 0, step: 1, style: { width: '64px', textAlign: 'right' }, value: r.leadOwn ? r.leadDays : '', placeholder: B.lead() ? String(B.lead()) : '–',
        title: L('이 품목의 리드타임 (비우면 기본값)', 'Thời gian giao của mã (trống = mặc định)'), onchange: (e) => { const v = Number(e.target.value); const p = { lead_days: v > 0 ? v : undefined };
          if (r.poolRow) DB.update('buy_pools', r.poolRow._id, p); else DB.update('items', r.it._id, p); refresh(r.key); } });
      c.step = h('input', { class: 'inp', type: 'number', min: 0, step: 'any', style: { width: '84px', textAlign: 'right' }, value: r.stepOwn ? r.step : '', placeholder: r.stepOwn ? '' : String(r.step),
        title: L('권장 주문량을 이 단위로 올립니다. 비우면 안전재고 자릿수 (백 단위 → 100, 천 단위 → 1,000 …)', 'Làm tròn SL đề xuất theo bước này; trống = theo hàng của tồn AT'),
        onchange: (e) => { const v = Number(e.target.value); const p = { [r.poolRow ? 'step' : 'buy_step']: v > 0 ? v : undefined }; if (r.poolRow) DB.update('buy_pools', r.poolRow._id, p); else DB.update('items', r.it._id, p); refresh(r.key); } });
      const saf = h('input', { class: 'inp', type: 'number', min: 0, step: 'any', style: { width: '96px', textAlign: 'right' }, value: r.safety === null ? '' : r.safety, placeholder: '–',
        onchange: (e) => { const v = e.target.value === '' ? undefined : Number(e.target.value);
          if (r.poolRow) DB.update('buy_pools', r.poolRow._id, { safety: v });
          else { const same = !str(r.it.buy_unit) || unitSame(r.it.buy_unit, r.it.unit); DB.update('items', r.it._id, same ? { safety: v } : { buy_safety: v }); }
          refresh(r.key); } });
      if (r.poolRow) c.balV = h('input', { class: 'inp', type: 'number', min: 0, step: 'any', style: { width: '92px', textAlign: 'right' }, value: r.bal, title: L('따로 관리하는 재고 — 바뀌면 여기서 고칩니다 (입고 완료하면 저절로 더해짐)', 'Tồn quản lý riêng — sửa tại đây'),
        onchange: (e) => { const v = Number(e.target.value); DB.update('buy_pools', r.poolRow._id, { inv: e.target.value === '' || !isFinite(v) ? undefined : v, inv_date: today }); refresh(r.key); } });
      c.bal = h('td', { class: 'num', style: { fontWeight: 700 } }, c.balV, r.invDiff ? h('div', { class: 'help', style: { margin: 0, fontWeight: 400 }, title: L('자재구매 파일(' + r.fileDate + ')의 재고 — ERP 재고는 창고 입출고장 · 수불 기준', 'Tồn trong file mua NVL (' + r.fileDate + ')') }, L('파일 ', 'File ') + fq(r.fileInv, r.unit)) : null);
      refs.set(r.key, c); fillCalc(c, r);
      const balTitle = r.bal === null ? L('ERP 재고 ', 'Tồn ERP ') + fq(r.balE, r.unitE) + ' ' + r.unitE + L(' — 개당 kg 가 없어 ' + r.unit + ' 로 못 바꿈', ' — thiếu kg/cái để đổi sang ' + r.unit) : (r.unitE !== r.unit ? L('ERP 재고 ', 'Tồn ERP ') + fq(r.balE, r.unitE) + ' ' + r.unitE + ' × ' + F.n(r.kgpe, 3) : '');
      if (balTitle) c.bal.title = balTitle;
      if (r.pool) c.bal.title = L('따로 관리하는 재고 (' + r.pool + ') — 자재구매 파일(' + r.fileDate + ')의 값. 창고 입출고장 재고는 첫 줄(ERP 품목)', 'Tồn quản lý riêng (' + r.pool + ') — theo file mua NVL (' + r.fileDate + ')');
      const mv = (v) => h('td', { class: 'num' }, v === null || v === undefined ? '' : fq(v, r.unit));
      return h('tr', h('td', { class: 'nowrap' }, r.cat), h('td', { class: 'nowrap' }, h('a', { href: 'javascript:void 0', onclick: () => ERP.itemDetail(r.code) }, h('b', r.code)),
          r.pool ? h('span', { title: L('같은 자재를 ' + r.pool + ' 용으로 따로 관리 (재고 · 안전재고 · 주문이 따로)', 'Cùng NVL, quản lý riêng cho ' + r.pool) }, ' ', ERP.chip('info', L('따로 관리', 'Riêng'))) : null),
        h('td', { class: 'namecell' }, r.name), h('td', r.kr),
        h('td', { class: 'num' }, saf), h('td', r.unit, r.unitE !== r.unit && !unitSame(r.unit, r.unitE) ? h('div', { class: 'help', style: { margin: 0 } }, 'ERP ' + r.unitE) : null), c.bal, incCell(r),
        dates.map(d => orderCell(r, d)), c.total,
        h('td', { class: 'num' }, r.lastKg === null ? '' : fq(r.lastKg, 'kg')), h('td', { class: 'num' }, r.lastEa === null ? '' : F.n(r.lastEa, isInt(r.lastEa) ? 0 : 1)),
        mv(r.max), mv(r.min), mv(r.avg === null ? null : Math.round(r.avg * 100) / 100), h('td', { class: 'num' }, c.lead), c.eta, c.status, c.sug, h('td', { class: 'num' }, c.step));
    });
    const table = h('div', { class: 'tbl-wrap', style: { maxHeight: '64vh' } }, h('table', { class: 'tbl buy-tbl' },
      h('thead', h('tr', th('구분', 'Nhóm', 'Category'), th('품목코드', 'Mã hàng', 'Item Code'), th('품명', 'Tên', 'Item Name'), th('품명 (한글)', 'Tên (tiếng Hàn)', 'Item Name Kr'),
        th('안전재고', 'Tồn AT', 'Safety stock', 1), th('단위', 'ĐV', 'Unit'), th('재고', 'Tồn', 'Inventory', 1, L('ERP 원부자재 재고 (창고 + 공장)', 'Tồn NVL ERP (Kho + Xưởng)')), th('입고예정', 'Sắp nhập', '입고예정', 1, L('주문일 없이 들어올 수량 (파일의 입고예정 칸)', 'Số lượng sắp nhập (không có ngày đặt)')),
        dates.map(dateHead), th('합계', 'Tổng', 'Total', 1, L('재고 + 입고예정 + 입고 대기 주문', 'Tồn + sắp nhập + đơn chờ nhập')),
        th('kg/월', 'kg/tháng', 'kg/month', 1, L('지난달(', 'Tháng trước (') + lastM + L(') 창고 출고', ') xuất kho')), th('ea/월', 'ea/tháng', 'ea/month', 1, L('지난달 창고 출고 개수 (kg 품목은 개당 kg 로 나눈 포대 · 통 수)', 'Số cái xuất kho tháng trước')),
        th('최대', 'Max', 'Max', 1, mTitle), th('최소', 'Min', 'Min', 1, mTitle), th('평균', 'TB', 'Average', 1, mTitle),
        th('리드타임 (일)', 'Thời gian giao (ngày)', '', 1, L('주문 → 입고 일수. 비우면 기본 리드타임', 'Số ngày đặt → nhập; trống = mặc định')), th('도착 예정', 'Dự kiến về', '', 0, L('입고 대기 주문 중 가장 빠른 도착 예정 (주문일 + 리드타임)', 'Ngày về sớm nhất (ngày đặt + thời gian giao)')),
        th('상태', 'Trạng thái', '', 0, L('합계 − 리드타임 동안 쓸 양(월 평균 ÷ 30 × 리드타임) < 안전재고 → 주문 필요', 'Tổng − lượng dùng trong thời gian giao < tồn AT → cần đặt')),
        th('권장 주문량', 'SL đề xuất', '', 1, L('안전재고 + 리드타임 동안 쓸 양 − 합계, 주문 단위로 올림', 'Tồn AT + lượng dùng trong thời gian giao − tổng, làm tròn theo bước')),
        th('주문 단위', 'Bước đặt', '', 1, L('비우면 안전재고 자릿수 (백 단위 → 100, 천 단위 → 1,000 …)', 'Trống = theo hàng của tồn AT')))),
      h('tbody', body.length ? body : h('tr', h('td', { colspan: 20 + dates.length, class: 'empty' }, L('조건에 맞는 품목이 없습니다.', 'Không có mã phù hợp.'))))));
    put(host, h('p', { class: 'help', style: { marginTop: 0 } }, L('자재구매 파일의 품목만 따로 봅니다 (해외에서 주문해 리드타임이 있음). 칸 순서는 파일과 같고, 주문일 칸에 수량을 넣으면 바로 저장됩니다. [주문 파일 만들기] 를 누르면 권장 주문량(안전재고 자릿수 단위로 올림)을 넣고 자재구매 파일과 같은 서식의 엑셀을 만듭니다.', 'Chỉ các mã trong file mua NVL (đặt nước ngoài, có thời gian giao). Thứ tự cột giống file; nhập số lượng vào cột ngày đặt là lưu ngay. [Tạo file đặt hàng] điền SL đề xuất và tạo Excel cùng mẫu file mua NVL.')),
      kpis, tb, table,
      h('p', { class: 'help' }, L('재고 = ERP 원부자재 재고(창고 입출고장 · 수불, 창고 + 공장' + (whLast ? ' · 창고 입출고장 마지막 ' + whLast : '') + ') — 파일 단위와 다르면 개당 kg 로 바꿉니다. 자재구매 파일의 재고와 다르면 그 아래에 "파일 …" 로 같이 보입니다. 같은 코드가 다른 구분으로 또 있는 줄(따로 관리)은 그 구분의 재고 · 안전재고 · 주문을 따로 보고, 재고는 자재구매 파일의 값입니다. 합계 = 재고 + 입고예정 + 입고 대기 주문 (파일의 Total 과 같음). kg/월 · ea/월 = 지난달 창고 출고, 최대 · 최소 · 평균 = ', 'Tồn = tồn NVL ERP (sổ kho · phiếu' + (whLast ? ' · sổ kho đến ' + whLast : '') + '); khác với file thì hiện "File …" bên dưới. Dòng "Riêng" (cùng mã, khác nhóm) có tồn · tồn AT · đơn riêng, tồn theo file. Tổng = tồn + sắp nhập + đơn chờ nhập. kg/tháng · ea/tháng = xuất kho tháng trước; Max · Min · TB = ') + mTitle + L('. 입고 완료(✓)는 주문을 합계에서 빼기만 합니다 — 재고는 창고 입출고장을 올리거나 수불 입력으로 들어옵니다. 자재구매 파일을 다시 올리면 파일에 있는 주문일 칸 · 입고예정 칸 값이 들어갑니다 (입고 완료는 그대로).', '. Đã nhập (✓) chỉ bỏ đơn khỏi tổng — tồn vào qua sổ kho hoặc nhập phiếu. Tải lại file: lấy giá trị cột ngày đặt · sắp nhập trong file (giữ đơn đã nhập).')));
  };
  /** 1.11.3: 주문 파일 — 자재구매 파일과 같은 서식 (시트 이름 · 제목 · Author · Date · 4행 머리 · B열부터, 주문일 머리는 날짜, Total = 재고부터 주문일 칸까지 합 수식).
      주문일 칸 = 이번 주문일 + 입고 대기 주문이 있는 다른 날 (최근이 앞). 다시 올려도 자재구매 파일로 인식된다. */
  B.orderBook = function (d) {
    const X = window.XLSX; const rows = B.rows(); const head = DB.setting('buyHead', null) || {}; const today = F.today();
    const ds = new Set([d]); rows.forEach(r => r.ords.forEach(o => { if (o.status !== 'recv') ds.add(o.date); }));
    const dates = Array.from(ds).sort().reverse();
    const ser = (iso) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);
    const r2 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 100) / 100);
    const aoa = [[null, head.title || 'Bosung Vina Purchase of materials', null, 'Author : ', head.author || null], [null, null, null, 'Date : ', ser(today)], [],
      [null, 'Category', 'Item Code', 'Item Name', 'Item Name Kr', 'Safety stock', 'Unit', 'Inventory', '입고예정'].concat(dates.map(ser), ['Total', 'kg/month', 'ea/month', 'Max', 'Min', 'Average'])];
    rows.forEach(r => aoa.push([null, r.cat || null, r.code, r.name || null, r.kr || null, r.safety, r.unit || null, r2(r.bal), r.incQ || null].concat(
      dates.map(dd => { const o = r.ords.find(x => x.date === dd && x.status !== 'recv'); return o ? num(o.qty) : null; }),
      [r2(r.total), r2(r.lastKg), r.lastEa === null ? null : Math.round(r.lastEa * 10) / 10, r2(r.max), r2(r.min), r2(r.avg)])));
    const ws = X.utils.aoa_to_sheet(aoa); const cTot = 9 + dates.length; const NUM = '#,##0';
    const fmt = (r, c, z) => { const a = X.utils.encode_cell({ r, c }); if (ws[a]) ws[a].z = z; };
    fmt(1, 4, 'm/d/yy'); dates.forEach((dd, i) => fmt(3, 9 + i, 'mm"월" dd"일"'));
    for (let i = 4; i < aoa.length; i++) {
      [5, 7, 8].concat(dates.map((dd, k) => 9 + k), [1, 2, 3, 4, 5].map(k => cTot + k)).forEach(c => fmt(i, c, NUM));   // 수량 · kg/월 · ea/월 · 최대 · 최소 · 평균
      const a = X.utils.encode_cell({ r: i, c: cTot }); const v = aoa[i][cTot];
      ws[a] = { t: 'n', v: v === null ? 0 : v, f: 'SUM(H' + (i + 1) + ':' + X.utils.encode_col(cTot - 1) + (i + 1) + ')', z: NUM };
    }
    ws['!merges'] = [{ s: { r: 0, c: 1 }, e: { r: 1, c: 2 } }];
    ws['!cols'] = [10, 19, 14, 27, 21, 16, 7, 12, 11].concat(dates.map(() => 12), [12, 10, 10, 9, 9, 10]).map(w => ({ wch: w }));
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, (head.sheet || 'Oder Korea').slice(0, 31));
    return { wb, name: today.slice(2).replace(/-/g, '') + ' 자재구매.xlsx', dates };
  };
  B.orderFile = function (d) { const b = B.orderBook(d); ERP.xl.saveBook(b.wb, b.name); return b; };
})();
