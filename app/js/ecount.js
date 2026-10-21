/* ECOUNT 자료 인식 · 반영 (Nhận dạng dữ liệu ECOUNT)
   품목등록 · 창고리스트 · 재고현황(창고/공장 묶음) · ERP CODE 설명 · 수불 엑셀 양식 · KHO NVL 입출고장 → 재고 수불
   파일명은 업로드 중 한글이 깨질 수 있으므로 내용(머리글)으로만 인식한다. */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, XL = ERP.xl, INV = ERP.inv, F = ERP.fmt, C = ERP.calc;
  const { findRow, hasCell, S, N, T, pick } = XL.helpers;
  const EC = ERP.ecount = {};
  const str = (v) => (v === undefined || v === null ? '' : String(v)).trim();
  const up = (v) => str(v).toUpperCase();
  const clean = (v) => { const s = str(v).replace(/\s+/g, ' '); return s || null; };
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  const num = C.num;

  // ------------------------------------------------------------------ common ECOUNT format pieces
  const stampRe = /^\d{1,2}\/\d{1,2}\/\d{4}(\s|$)/;
  /** last row of an ECOUNT export = export time "16/10/2026  오후 12:19:50" */
  const isStamp = (r) => { const v = r && r[0]; if (typeof v !== 'string' || !stampRe.test(v.trim())) return false; return r.slice(1).every(x => x === null || x === ''); };
  EC.dmy = function (s) { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (!m) return null; const d = +m[1], mo = +m[2]; if (mo < 1 || mo > 12 || d < 1 || d > 31) return null; return m[3] + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'); };
  /** "회사명 : BOSUNG VINA CO.,LTD / Kho thành phẩm 외 / 16/10/2026  / Số dư Tồn Kho" -> {company, scopeLabel, date, report} */
  EC.a1 = function (M) {
    for (let i = 0; i < Math.min(3, M.length); i++) {
      const t = (M[i] || []).find(x => typeof x === 'string' && /회사명|Company|Tên công ty/i.test(x)); if (!t) continue;
      const parts = t.split(/\s+\/\s+/).map(x => x.trim()).filter(Boolean);
      const o = { company: parts[0] ? parts[0].replace(/^(회사명|Company|Tên công ty)\s*:\s*/i, '') : '' };
      parts.slice(1).forEach(p => { const d = EC.dmy(p); if (d && !o.date) o.date = d; else if (!o.scopeLabel && !d) o.scopeLabel = p; else if (!d) o.report = p; });
      return o;
    }
    return {};
  };
  const stampOf = (M) => { for (let i = M.length - 1; i >= Math.max(0, M.length - 5); i--) if (isStamp(M[i])) return EC.dmy(M[i][0]); return null; };
  const col = (H, re) => H.findIndex(x => typeof x === 'string' && re.test(x.trim()));
  const same = (a, b) => {
    const e = (v) => v === undefined || v === null || v === '';
    if (e(a) && e(b)) return true; if (e(a) || e(b)) return false;
    if (typeof a === 'number' || typeof b === 'number') return Math.abs(Number(a) - Number(b)) < 1e-9;
    return str(a) === str(b);
  };
  /** label like "Kho thành phẩm 외" -> scope WH / FAC (warehouse master first, then keywords) */
  EC.scopeFromLabel = function (label) {
    const base = str(label).replace(/\s*(외|and others|và các kho khác)\s*$/i, '').trim(); if (!base) return null;
    const nb = XL.norm(base); const wh = DB.rows('warehouses').find(w => XL.norm(w.name) === nb || XL.norm(w.code) === nb);
    if (wh && wh.scope) return wh.scope;
    return INV.scopeOf(base);
  };

  // ------------------------------------------------------------------ 품목등록 (item master)
  const ITEM_FIELDS = ['name', 'erp_code', 'xnk', 'etype', 'unit', 'safety', 'safety_move'];
  XL.addDetector('ec_items', (n, M) => findRow(M, r => hasCell(r, /^품목코드$/) && hasCell(r, /^ERP\s*CODE$/i) && hasCell(r, /^품목구분$/), 0, 10) >= 0, (M) => {
    const hi = findRow(M, r => hasCell(r, /^품목코드$/) && hasCell(r, /^ERP\s*CODE$/i), 0, 10); const H = M[hi];
    const ci = { code: col(H, /^품목코드$/), xnk: col(H, /^M[ãa]\s*XNK$/i), name: col(H, /^품목명/), erp: col(H, /^ERP\s*CODE$/i), etype: col(H, /^품목구분$/),
      unit: col(H, /^(Đơn vị chính|Don vi chinh|단위)$/i), safety: col(H, /^안전재고수량$/), smove: col(H, /^안전재고관리/) };
    const rows = []; const seen = new Set();
    for (let i = hi + 1; i < M.length; i++) {
      const r = M[i]; if (!r || isStamp(r)) continue;
      const code = str(T(S(r, ci.code))); if (!code || seen.has(up(code))) continue; seen.add(up(code));
      const erp = T(S(r, ci.erp)); const et = str(T(S(r, ci.etype))).replace(/[[\]]/g, '').trim();
      rows.push(pick({ code, name: clean(T(S(r, ci.name))), erp_code: erp ? String(erp).trim() : null, xnk: clean(T(S(r, ci.xnk))), etype: et || null, unit: clean(T(S(r, ci.unit))),
        safety: ci.safety >= 0 ? N(S(r, ci.safety)) : null, safety_move: clean(T(S(r, ci.smove))) }));
    }
    return [EC.itemsJob(rows)];
  });
  EC.itemsJob = (rows) => ({ table: 'items', rows, custom: 'items', mode: 'merge', prio: 0, kind: 'ecount_items',
    modes: () => ({ merge: L('품목 갱신 (신규 추가 · 변경 갱신 · 삭제 안 함)', 'Cập nhật (thêm mới · sửa · không xóa)') }),
    label: L('ECOUNT 품목등록', 'ECOUNT · Danh mục mặt hàng'), apply: applyItems, preview: previewItems });
  function diffItems(rows) {
    const idx = new Map(DB.rows('items').map(r => [up(r.code), r])); let added = 0, changed = 0; const seen = new Set(); const samples = [];
    let local = 0;
    rows.forEach(r => {
      const k = up(r.code); seen.add(k); const e = idx.get(k); if (!e) { added++; return; }
      if (e.src === 'local') { local++; return; }   // 직접 만든 품목은 ECOUNT 업로드로 바꾸지 않는다
      const d = ITEM_FIELDS.filter(f => !(f === 'safety' && (r.safety === undefined || r.safety === null)) && !same(e[f], r[f]));
      if (d.length || e.missing) { changed++; if (samples.length < 6) samples.push(r.code + (d.length ? ' (' + d.join(', ') + ')' : '')); }
    });
    let missing = 0; DB.rows('items').forEach(r => { if (r.src === 'ecount' && !seen.has(up(r.code)) && !r.missing) missing++; });
    return { added, changed, missing, samples, local };
  }
  function previewItems(job) {
    const d = diffItems(job.rows);
    return { parts: [[L('신규', 'Mới'), d.added, d.added ? 'info' : 'neutral'], [L('변경', 'Thay đổi'), d.changed, d.changed ? 'warn' : 'neutral'], [L('이번 파일에 없음 (숨김 후보)', 'Không có trong file (đề xuất ẩn)'), d.missing, d.missing ? 'warn' : 'neutral']].concat(d.local ? [[L('직접 만든 품목과 같은 코드 (바꾸지 않음)', 'Trùng mã hàng tự tạo (không đổi)'), d.local, 'warn']] : []),
      detail: d.samples.length ? L('변경 예: ', 'VD thay đổi: ') + d.samples.join(' · ') : '' };
  }
  function applyItems(job) {
    const cur = DB.rows('items'); const idx = new Map(cur.map(r => [up(r.code), r])); const seen = new Set();
    let added = 0, changed = 0, missing = 0;
    job.rows.forEach(r => {
      const k = up(r.code); seen.add(k); const e = idx.get(k);
      if (e && e.src === 'local') return;   // 직접 만든 품목(사용자 정의 BOM 등)은 그대로
      if (e) {
        let diff = false;
        ITEM_FIELDS.forEach(f => {
          const v = r[f]; if (f === 'safety' && (v === undefined || v === null)) return;   // ECOUNT 에 안전재고가 비어 있으면 ERP 에서 넣은 값을 유지
          if (!same(e[f], v)) { diff = true; if (v === undefined || v === null || v === '') delete e[f]; else e[f] = v; }
        });
        if (e.missing) { delete e.missing; diff = true; }
        if (e.src !== 'ecount') { e.src = 'ecount'; diff = true; }
        if (diff) { INV.classify(e); changed++; }
      } else {
        const nr = Object.assign({ _id: F.uid() + Math.random().toString(36).slice(2, 5), code: r.code, src: 'ecount' }, pick(Object.assign({}, r)));
        INV.classify(nr); cur.push(nr); idx.set(k, nr); added++;
      }
    });
    cur.forEach(r => { if (r.src === 'ecount' && !seen.has(up(r.code)) && !r.missing) { r.missing = true; missing++; } });
    DB.touch('items');
    return { added, updated: changed, removed: 0, missing };
  }

  // ------------------------------------------------------------------ 창고리스트 (warehouses)
  XL.addDetector('ec_wh', (n, M) => findRow(M, r => hasCell(r, /^창고코드$/) && hasCell(r, /^창고명$/) && hasCell(r, /^구분$/), 0, 10) >= 0, (M) => {
    const hi = findRow(M, r => hasCell(r, /^창고코드$/) && hasCell(r, /^창고명$/), 0, 10); const H = M[hi];
    const ci = { code: col(H, /^창고코드$/), name: col(H, /^창고명$/), kind: col(H, /^구분$/), proc: col(H, /^생산공정명$/), partner: col(H, /^외주거래처명$/), active: col(H, /^사용$/), site: col(H, /^추가사업장명$/) };
    const rows = [];
    for (let i = hi + 1; i < M.length; i++) {
      const r = M[i]; if (!r || isStamp(r)) continue; const code = str(T(S(r, ci.code))); if (!code || !S(r, ci.name)) continue;
      const kind = clean(T(S(r, ci.kind))) || '';
      rows.push(pick({ code, name: clean(T(S(r, ci.name))), kind, scope: /^창고/.test(kind) ? 'WH' : 'FAC', process: clean(T(S(r, ci.proc))), partner: clean(T(S(r, ci.partner))),
        active: ci.active >= 0 ? !/^(no|n|미사용|không)$/i.test(str(T(S(r, ci.active)))) : true, site: clean(T(S(r, ci.site))) }));
    }
    return [{ table: 'warehouses', rows, mode: 'upsert', prio: 1, kind: 'ecount_wh', label: L('ECOUNT 창고리스트', 'ECOUNT · Danh sách kho'),
      note: L('구분이 "창고"이면 창고 범위, 공장·외주는 공장 범위로 묶습니다.', 'Loại "창고" = phạm vi Kho; xưởng/gia công = phạm vi Xưởng.') }];
  });

  // ------------------------------------------------------------------ ERP CODE 설명 (code dictionary)
  XL.addDetector('ec_codes', (n, M) => findRow(M, r => hasCell(r, /^ERP\s*CODE\s*설명/i), 0, 4) >= 0 || findRow(M, r => hasCell(r, /^설명$/) && hasCell(r, /^M[ôo] t[ảa]$/i) && hasCell(r, /^ERP\s*CODE$/i), 0, 8) >= 0, (M) => {
    const hi = findRow(M, r => hasCell(r, /^설명$/) && hasCell(r, /^ERP\s*CODE$/i), 0, 10); if (hi < 0) return [];
    const H = M[hi]; const codeCols = []; H.forEach((x, i) => { if (typeof x === 'string' && /^ERP\s*CODE$/i.test(x.trim())) codeCols.push(i); });
    const groups = codeCols.map((c, gi) => { const start = gi ? codeCols[gi - 1] + 1 : 0; let ko = -1, vi = -1; for (let k = start; k < c; k++) { const v = str(H[k]); if (/^설명$/.test(v) && ko < 0) ko = k; else if (/^M[ôo] t[ảa]$/i.test(v)) vi = k; } return { ko, vi, code: c }; });
    const rows = []; let stage = null; const order = { stage: 0, line: 0, cat: 0, sub: 0 };
    for (let i = hi + 1; i < M.length; i++) {
      const r = M[i]; if (!r) continue; if (typeof r[0] === 'string' && /^예시|^ví dụ|^vi du/i.test(r[0].trim())) break;
      groups.forEach((g, gi) => {
        const code = str(T(S(r, g.code))); if (!code) return;
        const ko = clean(T(S(r, g.ko))), vi = g.vi >= 0 ? clean(T(S(r, g.vi))) : null;
        if (gi === 0) { stage = up(code); rows.push(pick({ level: 'stage', code: up(code), ko, vi, order: ++order.stage, guessed: false })); }
        else if (gi === 1) { const mat = ['RM', 'SM', 'CM'].includes(stage); const lv = mat ? 'cat' : 'line'; rows.push(pick({ level: lv, code: up(code), ko, vi, parent: mat ? stage : null, order: ++order[lv], guessed: false })); }
        else rows.push(pick({ level: 'sub', code: up(code), ko, vi, order: ++order.sub, guessed: false }));
      });
    }
    return [{ table: 'code_dict', rows, mode: 'upsert', prio: 2, kind: 'ecount_codes', label: L('ERP CODE 설명 → 코드 사전', 'Giải thích ERP CODE → từ điển mã') }];
  });

  // ------------------------------------------------------------------ 재고현황 (stock status per scope)
  XL.addDetector('ec_stock', (n, M) => findRow(M, r => hasCell(r, /^품목코드$/) && hasCell(r, /^재고수량$/), 0, 10) >= 0, (M, ctx) => {
    const hi = findRow(M, r => hasCell(r, /^품목코드$/) && hasCell(r, /^재고수량$/), 0, 10); const H = M[hi];
    const ci = { code: col(H, /^품목코드$/), name: col(H, /^품목명/), unit: col(H, /^단위$/), qty: col(H, /^재고수량$/), sets: col(H, /^Số\s*Set$/i), pcs: col(H, /^Số\s*PCS$/i) };
    const meta = EC.a1(M); const rows = []; let totals = null; const seen = new Map();
    for (let i = hi + 1; i < M.length; i++) {
      const r = M[i]; if (!r || isStamp(r)) continue;
      const code = str(T(S(r, ci.code))); if (!code) continue;
      if (/^(합계|tổng cộng|tong cong|total)$/i.test(code)) { totals = { qty: N(S(r, ci.qty)), sets: ci.sets >= 0 ? N(S(r, ci.sets)) : null, pcs: ci.pcs >= 0 ? N(S(r, ci.pcs)) : null }; continue; }
      const o = pick({ code, name: clean(T(S(r, ci.name))), unit: clean(T(S(r, ci.unit))), qty: N(S(r, ci.qty)) || 0, sets: ci.sets >= 0 ? N(S(r, ci.sets)) : null, pcs: ci.pcs >= 0 ? N(S(r, ci.pcs)) : null });
      if (seen.has(up(code))) { const e = seen.get(up(code)); e.qty += o.qty; if (o.sets !== undefined) e.sets = (e.sets || 0) + o.sets; if (o.pcs !== undefined) e.pcs = (e.pcs || 0) + o.pcs; continue; }
      seen.set(up(code), o); rows.push(o);
    }
    const date = meta.date || stampOf(M) || F.today();
    return [EC.stockJob(rows, { scopeLabel: meta.scopeLabel, date, totals })];
  });
  EC.stockJob = function (rows, o) {
    const scope = EC.scopeFromLabel(o.scopeLabel);
    const job = { table: 'stock_open', rows, custom: 'stock', prio: 3, kind: 'ecount_stock', scope, scopeLabel: o.scopeLabel || '', date: o.date, totals: o.totals,
      mode: 'open',   // 12차: '비교만' 은 없앰 (ECOUNT 를 그만 씀)
      modes: () => ({ open: L('기초재고로 설정', 'Đặt làm tồn đầu kỳ') }),
      apply: applyStock, preview: previewStock };
    job.label = L('ECOUNT 재고현황', 'ECOUNT · Tồn kho') + (o.scopeLabel ? ' · ' + o.scopeLabel : '');
    return job;
  };
  EC.sums = (rows) => { const s = { qty: 0, sets: 0, pcs: 0, neg: 0 }; rows.forEach(r => { s.qty += num(r.qty); s.sets += num(r.sets); s.pcs += num(r.pcs); if (num(r.qty) < 0) s.neg++; }); return s; };
  function previewStock(job) {
    const s = EC.sums(job.rows); const parts = [];
    const near = (a, b) => a === null || a === undefined || Math.abs(a - b) < 0.005 + Math.abs(b) * 1e-9;
    let rnote = '';
    if (job.totals) {
      const okQ = near(job.totals.qty, s.qty), okS = near(job.totals.sets, s.sets), okP = near(job.totals.pcs, s.pcs);
      const dq = job.totals.qty === null || job.totals.qty === undefined ? 0 : Math.round((s.qty - job.totals.qty) * 100) / 100;
      parts.push([L('원본 합계와 ', 'Khớp tổng gốc ') + (okQ && okS && okP ? L('일치', '✓') : L('불일치', '✗')), F.n(s.qty, 2), okQ && okS && okP ? 'ok' : 'bad']);
      if (okQ && Math.abs(dq) >= 0.005) rnote = L(' · 원본 합계 행(' + F.n(job.totals.qty, 2) + ')과 ' + F.n(Math.abs(dq), 2) + ' 차이 — ECOUNT 반올림 차이', ' · lệch ' + F.n(Math.abs(dq), 2) + ' so với dòng tổng gốc (làm tròn ECOUNT)');
    } else parts.push([L('재고수량 합계', 'Tổng SL'), F.n(s.qty, 2), 'neutral']);
    parts.push([L('마이너스', 'Âm'), s.neg, s.neg ? 'warn' : 'neutral']);
    const IT = INV.items(); const unk = job.rows.filter(r => !IT.get(r.code)).length;
    if (unk) parts.push([L('품목 마스터에 없는 코드', 'Mã chưa có trong danh mục'), unk, 'warn']);
    let detail = L('기준일 ', 'Ngày chốt ') + (job.date || '–') + rnote;
    const ex = DB.rows('stock_open').filter(r => r.scope === job.scope); const exDate = ex.reduce((a, r) => (r.date > a ? r.date : a), '');
    if (job.mode === 'open' && ex.length) detail += L(' · ⚠ 이 범위의 기존 기초재고(' + ex.length + '행, 기준일 ' + exDate + ')를 바꿉니다 (기초재고 재설정)', ' · ⚠ Thay tồn đầu hiện có (' + ex.length + ' dòng, ngày ' + exDate + ')');
    if (!job.scope) detail += L(' · 재고 범위를 고르세요', ' · Hãy chọn phạm vi');
    // 11차: 현장 실사가 있으면 공정 중 품목은 현장 실사 수량을 쓴다 (이 파일의 그 품목 숫자는 기초에 쓰지 않음)
    if (INV.floorActive()) {
      const wip = job.rows.filter(r => { const it = IT.get(r.code); return it && INV.inProcess(it); }).length;
      if (wip) detail += L(' · 공정 중 품목 ' + wip + '개는 현장 실사(기준일 ' + INV.opening().date.FLOOR + ') 수량을 그대로 씁니다', ' · ' + wip + ' mã đang SX dùng số kiểm kê hiện trường (ngày ' + INV.opening().date.FLOOR + ')');
    }
    return { parts, detail, needScope: true };
  }
  function applyStock(job) {
    if (!job.scope) throw new Error(L('재고 범위(창고/공장)를 고르세요', 'Hãy chọn phạm vi (Kho/Xưởng)'));
    // 11차: 현장 실사(grp 'floor') 행은 ECOUNT 재고현황으로 바꾸지 않는다 — 공정 중 재고는 원부자재와 따로 관리
    const all = DB.rows('stock_open'); const keep = all.filter(r => r.scope !== job.scope || r.grp === 'floor'); const removed = all.length - keep.length;
    DB.t.stock_open = keep; DB.addMany('stock_open', job.rows.map(r => pick(Object.assign({ date: job.date, scope: job.scope, file: job.file }, r))));
    DB.meta.openDate = Object.assign({}, DB.meta.openDate, { [job.scope]: job.date }); DB.saveMeta();   // 기준일은 범위마다 하나 (INV.opening)
    // CT·SET 환산 비율 (ECOUNT 가 계산한 Số Set / Số PCS 에서 역산) — 비어 있는 품목만 채운다
    let conv = 0; const IT = INV.items();
    job.rows.forEach(r => {
      const it = IT.get(r.code); if (!it) return; const u = INV.unitN(it.unit);
      if (u === 'CT' && num(r.qty) && num(r.sets) && !num(it.set_per_ct)) { it.set_per_ct = r6(num(r.sets) / num(r.qty)); conv++; }
      if ((u === 'CT' || u === 'SET') && num(r.sets) && num(r.pcs) && !num(it.pcs_per_set)) { it.pcs_per_set = r6(num(r.pcs) / num(r.sets)); conv++; }
    });
    if (conv) DB.touch('items');
    return { added: job.rows.length, removed, conv };
  }

  // ------------------------------------------------------------------ 11차: 현장 재고 실사 (TỒN KHO · 공정 중 부품 · 조립 색연필)
  // 머리글: Mã mặt hàng · Tên mặt hàng · ERP CODE · Thông số · SẢN XUẤT (시트마다 TOTAL 행). 공정 중(WIP 단계) 품목만 받고, 원부자재 · 포장품은 빼고 알린다.
  const FLOOR_RE = { code: /^(mamathang|mahang|품목코드)$/, name: /^(tenmathang|tenhang|품명)$/, erp: /^erpcode$/, spec: /^(thongso|규격)$/, qty: /^(sanxuat|tonkho|tonhientruong|soluong|현장재고|수량)$/ };
  const floorHdr = (r) => { const n = (r || []).map(x => XL.norm(x)); return n.some(x => FLOOR_RE.code.test(x)) && n.some(x => FLOOR_RE.erp.test(x)) && n.some(x => FLOOR_RE.qty.test(x)); };
  XL.addDetector('floor_count', (n, M) => findRow(M, floorHdr, 0, 6) >= 0, (M, ctx) => {
    const hi = findRow(M, floorHdr, 0, 6); const H = M[hi].map(x => XL.norm(x)); const ci = {};
    Object.keys(FLOOR_RE).forEach(k => { ci[k] = H.findIndex(x => FLOOR_RE[k].test(x)); });
    const rows = [], excluded = [], seen = new Map(); let total = null, skipped = 0;
    for (let i = hi + 1; i < M.length; i++) {
      const r = M[i]; if (!r) continue;
      const code = str(T(S(r, ci.code))); const q = N(S(r, ci.qty));
      if (!code) continue;
      if (/^(total|tong cong|tổng cộng|tổng|합계|cộng)$/i.test(code)) { total = q; continue; }
      if (q === null) { skipped++; continue; }
      const erp = str(T(S(r, ci.erp))); const p = INV.parse(erp, code);
      const o = { code, name: clean(T(S(r, ci.name))), erp_code: erp || undefined, spec: ci.spec >= 0 ? clean(T(S(r, ci.spec))) : undefined, qty: q, stage: p.stage };
      if (!INV.inProcess(p.stage)) { o.why = INV.MAT_STAGES.includes(p.stage) ? 'mat' : p.stage === 'ETC' ? 'etc' : 'pack'; excluded.push(o); continue; }
      const e = seen.get(up(code)); if (e) { e.qty += q; continue; }
      seen.set(up(code), o); rows.push(o);
    }
    return [EC.floorJob(rows, { sheet: ctx.sheet, total, excluded, skipped })];
  });
  EC.floorJob = function (rows, o) {
    const job = { table: 'stock_open', rows, custom: 'floor', prio: 3, kind: 'floor_count', sheet: o.sheet, total: o.total, excluded: o.excluded || [], skipped: o.skipped || 0, mode: 'open', date: o.date || null,
      modes: () => ({ open: L('현장 재고(공정 중) 기초로 설정', 'Đặt tồn hiện trường (đang SX) làm tồn đầu') }),
      /** 기준일 = 파일 이름의 날짜 (TỒN KHO 20.10.2026) — 없으면 화면에서 넣는다 */
      onFile: (j) => { if (!j.date) j.date = XL.fileDate(j.file) || null; j.needDate = !j.date; if (j.needDate) j.include = false; },
      apply: applyFloor, preview: previewFloor };
    job.label = L('현장 재고 실사 (공정 중 부품 · 조립품)', 'Kiểm kê tồn hiện trường (linh kiện · bút đã lắp)');
    return job;
  };
  const WHY = () => ({ mat: L('원부자재', 'NVL'), pack: L('포장품', 'Đóng gói'), etc: L('ERP CODE 없음', 'Không có ERP CODE') });
  function previewFloor(job) {
    const sum = job.rows.reduce((a, r) => a + num(r.qty), 0), exSum = job.excluded.reduce((a, r) => a + num(r.qty), 0); const parts = [];
    const by = {}; job.rows.forEach(r => { by[r.stage] = (by[r.stage] || 0) + 1; });
    Object.keys(by).forEach(st => parts.push([INV.stageTitle(st), by[st], 'info']));
    if (job.total !== null && job.total !== undefined) { const okT = Math.abs(sum + exSum - job.total) < 0.005; parts.push([L('원본 TOTAL 과 ', 'Khớp TOTAL gốc ') + (okT ? L('일치', '✓') : L('불일치', '✗')), F.n(sum + exSum), okT ? 'ok' : 'bad']); }
    else parts.push([L('수량 합계', 'Tổng SL'), F.n(sum), 'neutral']);
    if (job.excluded.length) parts.push([L('제외 (공정 중 품목 아님)', 'Bỏ qua (không phải đang SX)'), job.excluded.length, 'warn']);
    if (job.skipped) parts.push([L('수량 없음 (건너뜀)', 'Không có SL (bỏ qua)'), job.skipped, 'neutral']);
    const IT = INV.items(); const nu = job.rows.filter(r => !IT.get(r.code)).length;
    if (nu) parts.push([L('품목 마스터에 없음 → ERP CODE 로 만듦', 'Chưa có mã → tạo từ ERP CODE'), nu, 'info']);
    const W = WHY(); const old = DB.rows('stock_open').filter(r => r.grp === 'floor' && (r.file !== job.file || r.date !== job.date)); const oldDate = old.reduce((a, r) => (r.date > a ? r.date : a), '');
    let detail = L('현장 실사 기준일 ', 'Ngày kiểm kê ') + (job.date || L('(없음 — 날짜를 넣으세요)', '(chưa có — hãy nhập ngày)')) + L(' · 원부자재(ECOUNT) 재고와 따로 관리합니다', ' · quản lý riêng với tồn NVL (ECOUNT)');
    if (old.length) detail += L(' · 이전 현장 실사(' + oldDate + ', ' + old.length + '행)를 바꿉니다', ' · thay kiểm kê cũ (' + oldDate + ', ' + old.length + ' dòng)');
    if (job.excluded.length) detail += L(' · 제외: ', ' · Bỏ qua: ') + job.excluded.slice(0, 5).map(r => r.code + ' (' + W[r.why] + ')').join(', ');
    return { parts, detail };
  }
  function applyFloor(job) {
    if (!job.date) throw new Error(L('현장 실사 기준일을 넣으세요', 'Hãy nhập ngày kiểm kê'));
    // 같은 파일 · 같은 기준일의 다른 시트 행은 남기고(여러 시트를 차례로 반영), 이전 실사 · 같은 시트의 예전 행은 바꾼다
    const all = DB.rows('stock_open'); const keep = all.filter(r => r.grp !== 'floor' || (r.file === job.file && r.date === job.date && r.sheet !== job.sheet));
    const removed = all.length - keep.length; DB.t.stock_open = keep;
    const IT = INV.items(); const add = [];
    job.rows.forEach(r => { if (!IT.get(r.code) && !add.some(x => up(x.code) === up(r.code))) add.push(INV.classify(pick({ code: r.code, name: r.name, erp_code: r.erp_code, unit: 'PCS', src: 'floor' }))); });
    if (add.length) DB.addMany('items', add);
    const IT2 = INV.items();
    DB.addMany('stock_open', job.rows.map(r => pick({ date: job.date, scope: 'FAC', grp: 'floor', code: (IT2.get(r.code) || {}).code || r.code, name: r.name, unit: 'PCS', qty: r.qty, file: job.file, sheet: job.sheet })));
    DB.meta.openDate = Object.assign({}, DB.meta.openDate, { FLOOR: job.date }); DB.saveMeta();
    return { added: job.rows.length, removed, created: add.length, skipped: job.excluded.length + job.skipped };
  }

  // ------------------------------------------------------------------ stock-transaction template (수불 엑셀 양식)
  const TPL = [['date', '일자', 'Ngày'], ['doc_no', '전표번호', 'Số CT'], ['kind', '구분 (입고/출고/이동/조정)', 'Loại (Nhập/Xuất/Chuyển/Điều chỉnh)'], ['from_scope', '출발 (창고/공장)', 'Từ (Kho/Xưởng)'],
    ['to_scope', '도착 (창고/공장)', 'Đến (Kho/Xưởng)'], ['code', '품목코드', 'Mã hàng'], ['qty', '수량', 'Số lượng'], ['partner', '거래처', 'Đối tác'], ['ref', '참조 (PO 등)', 'Tham chiếu'], ['note', '비고', 'Ghi chú']];
  // NOTE: no ASCII \b right after Korean words (Hangul is not a \w character)
  const HDR = { date: /^(일자|날짜|ngay\b|date\b)/, doc_no: /^(전표번호|전표|so ct\b|so chung tu|doc)/, kind: /^(구분|loai\b|kind\b|type\b)/, from_scope: /^(출발|from\b|tu\b)/, to_scope: /^(도착|to\b|den\b)/,
    code: /^(품목코드|품번|ma hang|code\b|item\b)/, qty: /^(수량|so luong|qty|quantity)/, partner: /^(거래처|doi tac|partner)/, ref: /^(참조|tham chieu|ref\b|po\b)/, note: /^(비고|ghi chu|note)/ };
  const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').replace(/đ/gi, 'd').toLowerCase().trim();
  function tplMap(H) { const m = {}; H.forEach((x, i) => { if (typeof x !== 'string') return; const p = plain(x); Object.keys(HDR).forEach(k => { if (m[k] === undefined && HDR[k].test(p)) m[k] = i; }); }); return m; }
  XL.addDetector('stock_tx_tpl', (n, M) => findRow(M, r => { const m = tplMap(r); return m.code !== undefined && m.qty !== undefined && m.kind !== undefined && (m.from_scope !== undefined || m.to_scope !== undefined); }, 0, 8) >= 0, (M) => {
    const hi = findRow(M, r => { const m = tplMap(r); return m.code !== undefined && m.qty !== undefined && m.kind !== undefined; }, 0, 8); const m = tplMap(M[hi]);
    const rows = []; const IT = INV.items();
    for (let i = hi + 1; i < M.length; i++) {
      const r = M[i]; if (!r) continue; const code = str(T(S(r, m.code))); const qty = N(S(r, m.qty)); if (!code || qty === null || !qty) continue;
      const from = INV.scopeOf(S(r, m.from_scope)), to = INV.scopeOf(S(r, m.to_scope));
      let kind = INV.kindOf(S(r, m.kind)) || (from && to ? 'MOVE' : from ? 'OUT' : 'IN');
      const it = IT.get(code);
      const rawDate = S(r, m.date); const date = rawDate === null || rawDate === '' ? F.today() : F.parseDate(rawDate);   // 17/10/2026 같은 글자 날짜도 ISO 로
      const o = { date: date || T(rawDate), _badDate: date ? undefined : true, doc_no: clean(T(S(r, m.doc_no))), kind, code: it ? it.code : code, name: it ? it.name : null, qty, unit: it ? INV.unitShow(it.unit) : null, partner: clean(T(S(r, m.partner))), ref: clean(T(S(r, m.ref))), note: clean(T(S(r, m.note))), src: 'xl:tpl' };
      if (kind === 'IN') o.to_scope = to || 'WH'; else if (kind === 'OUT') o.from_scope = from || 'WH';
      else if (kind === 'MOVE') { o.from_scope = from || (to ? (to === 'WH' ? 'FAC' : 'WH') : 'WH'); o.to_scope = to || (o.from_scope === 'WH' ? 'FAC' : 'WH'); if (!from || !to) o._guess = true; }   // 출발 · 도착 중 빈 칸은 반대 범위로
      else o.to_scope = to || from || 'WH';
      if (!it) { o._unknown = true; o._cands = INV.search(code, 5).map(x => x.code); }
      rows.push(pick(o));
    }
    const hasDoc = rows.some(r => r.doc_no);
    return [EC.txJob(rows, hasDoc ? 'slip' : 'append', L('재고 수불 (엑셀 양식)', 'Nhập xuất tồn (mẫu Excel)'), 'xl:tpl')];
  });
  EC.txTemplate = function () {
    const X = window.XLSX; const wb = X.utils.book_new();
    const hdr = TPL.map(t => L(t[1], t[2]) + ' / ' + (ERP.lang === 'vi' ? t[1] : t[2]));
    const today = F.today();
    const ex = [[today, '', L('입고', 'Nhập'), '', L('창고', 'Kho'), 'R-001', 100, 'Supplier', '', L('예: 원료 입고', 'VD: nhập NVL')],
      [today, '', L('이동', 'Chuyển'), L('창고', 'Kho'), L('공장', 'Xưởng'), 'R-001', 40, '', '', L('예: 생산 투입', 'VD: xuất cho SX')],
      [today, '', L('출고', 'Xuất'), L('창고', 'Kho'), '', '52-9724-K-000', 10, 'Customer', 'PO-123', L('예: 완제품 출하 (CT)', 'VD: xuất thành phẩm (CT)')],
      [today, '', L('조정', 'Điều chỉnh'), '', L('공장', 'Xưởng'), 'BM09', -120, '', '', L('예: 실사 차이 (− 는 감소)', 'VD: chênh lệch kiểm kê (− là giảm)')]];
    const ws = X.utils.aoa_to_sheet([hdr].concat(ex)); ws['!cols'] = hdr.map(h2 => ({ wch: Math.max(12, Math.min(34, h2.length + 2)) }));
    X.utils.book_append_sheet(wb, ws, 'stock_tx');
    const readme = [[L('재고 수불 업로드 양식', 'Mẫu tải lên nhập xuất tồn')], [],
      [L('구분', 'Loại'), L('입고 · 출고 · 이동 · 조정 (베트남어 Nhập · Xuất · Chuyển · Điều chỉnh 도 됩니다)', 'Nhập · Xuất · Chuyển · Điều chỉnh (tiếng Hàn cũng được)')],
      [L('범위', 'Phạm vi'), L('창고 = ECOUNT "Kho thành phẩm 외" 묶음, 공장 = "SẢN XUẤT 외" 묶음 (외주처 포함)', 'Kho = nhóm "Kho thành phẩm", Xưởng = nhóm "SẢN XUẤT" (gồm gia công ngoài)')],
      [L('입고', 'Nhập'), L('도착만 입력 (비우면 창고)', 'Chỉ nhập "Đến" (trống = Kho)')], [L('출고', 'Xuất'), L('출발만 입력 (비우면 창고)', 'Chỉ nhập "Từ" (trống = Kho)')],
      [L('이동', 'Chuyển'), L('출발과 도착 (예: 창고 → 공장 = 생산 투입)', '"Từ" và "Đến" (VD: Kho → Xưởng = xuất cho sản xuất)')], [L('조정', 'Điều chỉnh'), L('도착 범위에 +/− 수량', 'Số lượng +/− tại phạm vi "Đến"')],
      [L('수량', 'Số lượng'), L('품목의 주 단위 (ECOUNT 단위: kg, PCS, CT, SET …)', 'Theo đơn vị chính của mã (kg, PCS, CT, SET …)')],
      [L('전표번호', 'Số CT'), L('같은 전표번호를 다시 올리면 그 전표만 교체됩니다 (비우면 추가)', 'Tải lại cùng số CT sẽ thay phiếu đó (trống = thêm mới)')],
      [L('생산 실적', 'Sản lượng'), L('생산일보를 올리면 자동으로 반영되므로 여기에는 넣지 않습니다', 'Báo cáo sản xuất được cập nhật tự động — không nhập ở đây')]];
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(readme), 'README');
    const out = X.write(wb, { bookType: 'xlsx', type: 'array' }); ERP.download('ERP_stock_tx_template_' + today + '.xlsx', new Blob([out], { type: 'application/octet-stream' }));
  };

  // ------------------------------------------------------------------ transaction jobs (template + KHO NVL ledger / slips)
  EC.txJob = function (rows, how, label, srcTag) {
    return { table: 'stock_tx', rows, custom: 'tx', mode: how, prio: 4, kind: 'stock_tx', srcTag, label,
      modes: () => ({ append: L('추가', 'Thêm'), slip: L('전표번호 기준 교체', 'Thay theo số phiếu'), range: L('기간 교체 (같은 자료)', 'Thay theo khoảng ngày (cùng nguồn)') }),
      apply: applyTx, preview: previewTx };
  };
  EC.txJobFromLedger = function (rows, how, label) {
    const conv = INV.ledgerToTx(rows, { outMode: 'move', src: 'ledger' });
    const job = EC.txJob(conv.rows, how, label + ' → ' + L('재고 수불', 'nhập xuất tồn'), 'ledger');
    job.base = rows; job.outMode = 'move'; job.resolve = {};
    job.setOutMode = (m) => { job.outMode = m; const c = INV.ledgerToTx(job.base, { outMode: m, src: 'ledger' }); job.rows = c.rows; Object.keys(job.resolve).forEach(i => { const r = job.rows[i]; const it = INV.item(job.resolve[i]); if (r && it) { r.code = it.code; r.name = it.name; r.unit = INV.unitShow(it.unit); delete r._cands; } }); };
    job.note = L('출고는 기본으로 "창고 → 공장 이동"(생산 투입)으로 반영합니다. 외부 출고면 바꾸세요.', 'Mặc định "xuất" = chuyển Kho → Xưởng (xuất cho SX). Đổi nếu là xuất ra ngoài.');
    return job;
  };
  function previewTx(job) {
    const by = {}; let unk = 0, bad = 0, guess = 0; job.rows.forEach(r => { if (r._badDate) bad++; else if (!r.code || r._unknown) unk++; else by[r.kind] = (by[r.kind] || 0) + 1; if (r._guess) guess++; });
    const parts = Object.keys(by).map(k => [ERP.txKindName(k), by[k], 'info']);
    if (unk) parts.push([L('코드 확인 필요 (건너뜀)', 'Cần xác nhận mã (bỏ qua)'), unk, 'warn']);
    if (bad) parts.push([L('날짜를 읽지 못함 (건너뜀): ', 'Không đọc được ngày (bỏ qua): ') + Array.from(new Set(job.rows.filter(r => r._badDate).map(r => r.date))).slice(0, 3).join(', '), bad, 'bad']);
    if (guess) parts.push([L('이동: 출발 · 도착 중 빈 칸을 반대 범위로 채움', 'Chuyển: ô trống Từ/Đến được điền phạm vi ngược lại'), guess, 'neutral']);
    const ds = job.rows.map(r => r.date).filter(Boolean).sort(); const od = INV.openDates();
    const before = job.rows.filter(r => od.first && r.date && r.date <= od.first).length;
    return { parts, detail: (ds.length ? F.d(ds[0]) + (ds[0] !== ds[ds.length - 1] ? ' ~ ' + F.d(ds[ds.length - 1]) : '') : '') + (before ? L(' · 기초재고 기준일(' + od.first + ') 이전 ' + before + '건은 재고에 더하지 않습니다', ' · ' + before + ' dòng trước ngày tồn đầu (' + od.first + ') không cộng vào tồn') : ''), unknown: unk };
  }
  function applyTx(job) {
    const ok = job.rows.filter(r => r.code && !r._unknown && !r._badDate && num(r.qty)); const skipped = job.rows.length - ok.length;
    const all = DB.rows('stock_tx'); let keep = all;
    if (job.mode === 'range') { const ds = ok.map(r => r.date).filter(Boolean).sort(); if (ds.length) { const lo = ds[0], hi = ds[ds.length - 1]; keep = all.filter(t => !(t.src === job.srcTag && t.date >= lo && t.date <= hi)); } }
    else if (job.mode === 'slip') { const docs = new Set(ok.map(r => r.doc_no).filter(Boolean)); keep = all.filter(t => !(t.doc_no && docs.has(t.doc_no))); }
    const removed = all.length - keep.length; DB.t.stock_tx = keep;
    DB.addMany('stock_tx', ok.map(r => { const o = Object.assign({}, r); delete o._orig; delete o._cands; delete o._unknown; delete o._badDate; delete o._guess; if (!o.src) o.src = job.srcTag || 'xl'; return pick(o); }));
    return { added: ok.length, removed, skipped };
  }
  /** modal: choose item codes for rows that could not be matched */
  EC.resolveDialog = function (job, onDone) {
    const list = job.rows.map((r, i) => [r, i]).filter(([r]) => !r.code || r._unknown);
    if (!list.length) return;
    const sels = new Map();
    const dl = h('datalist', { id: 'dl_resolve' }, DB.rows('items').slice(0, 4000).map(x => h('option', { value: x.code }, (x.name || '') + (x.xnk ? ' · ' + x.xnk : ''))));
    const body = h('div', dl, h('p', { class: 'help' }, L('품목 마스터에서 찾지 못한 줄입니다. 품목코드를 고르면 반영되고, 비워 두면 건너뜁니다.', 'Các dòng chưa khớp mã. Chọn mã hàng để áp dụng, để trống sẽ bỏ qua.')),
      ERP.simpleTable([{ label: L('일자', 'Ngày'), render: x => F.d(x[0].date) }, { label: L('원본 코드', 'Mã gốc'), render: x => (x[0]._orig ? [x[0]._orig.item_code, x[0]._orig.wh_code].filter(Boolean).join(' / ') : x[0].code) || '' },
        { label: L('원본 품명', 'Tên gốc'), render: x => (x[0]._orig && x[0]._orig.name) || x[0].name || '' }, { label: L('수량', 'SL'), num: 1, render: x => F.n(x[0].qty, 2) },
        { label: L('품목코드 선택', 'Chọn mã hàng'), render: x => { const c = x[0]._cands || []; const inp = h('input', { class: 'inp', list: 'dl_resolve', style: { width: '170px' }, value: '', placeholder: c.length ? c.slice(0, 3).join(', ') : '–', onchange: (e) => sels.set(x[1], e.target.value.trim()) }); return c.length ? [h('select', { class: 'inp', onchange: (e) => { inp.value = e.target.value; sels.set(x[1], e.target.value); } }, h('option', { value: '' }, L('후보 ', 'Gợi ý ') + c.length), c.map(v => { const it = INV.item(v); return h('option', { value: v }, v + (it && it.name ? ' · ' + it.name : '')); })), ' ', inp] : inp; } }], list.slice(0, 400), { maxH: '55vh' }));
    ERP.modal({ title: L('코드 확인 ', 'Xác nhận mã ') + '(' + list.length + ')', width: '980px', body, buttons: [{ label: L('닫기', 'Đóng') }, { label: L('적용', 'Áp dụng'), kind: 'primary', onClick: () => {
      let n = 0; sels.forEach((code, i) => { const it = INV.item(code); const r = job.rows[i]; if (!it || !r) return; r.code = it.code; r.name = it.name; r.unit = INV.unitShow(it.unit); delete r._unknown; delete r._cands; if (job.resolve) job.resolve[i] = it.code; n++; });
      ERP.toast(L(n + '건의 코드를 지정했습니다', 'Đã gán mã cho ' + n + ' dòng'), 'ok'); onDone && onDone();
    } }] });
  };

  /** production-report job preview: what the daily report will add to / take from stock */
  EC.prodPreview = function (job) {
    const res = INV.postRows(job.rows); const d = res.diag; const parts = [];
    if (d.mode === 'off') return { parts: [[L('재고 반영 끔 (설정)', 'Không cập nhật tồn (cài đặt)'), '', 'neutral']] };
    if (d.noOpen) return { parts: [[L('기초재고가 없어 재고에 반영하지 않음', 'Chưa có tồn đầu nên không cập nhật tồn'), '', 'neutral']] };
    if (!d.considered) return { parts: [[L('기초재고 기준일(' + d.open + ') 이전 일보 — 재고 변동 없음', 'Báo cáo trước ngày tồn đầu (' + d.open + ') — tồn không đổi'), '', 'neutral']] };
    parts.push([L('생산입고', 'Nhập SX'), d.prod, 'info']);
    if (d.mode === 'in_bom') parts.push([L('현장 부품 차감', 'Trừ linh kiện hiện trường'), d.use, 'info']);
    if (d.noBom.size) parts.push([L('BOM 없음', 'Chưa có BOM'), d.noBom.size + L('품목', ' mã'), 'warn']);
    if (d.missingPart.size) parts.push([L('BOM 부품코드가 마스터에 없음', 'Mã linh kiện BOM chưa có'), d.missingPart.size, 'warn']);
    if (d.rawUnmatched.size) parts.push([L('배합 원료명 미연결', 'Tên NVL phối liệu chưa khớp'), d.rawUnmatched.size, 'warn']);
    if (d.notItem.size) parts.push([L('품목코드 아님', 'Không phải mã hàng'), d.notItem.size, 'warn']);
    if (d.noConv.size) parts.push([L('환산 정보 없음', 'Thiếu quy đổi'), d.noConv.size, 'warn']);
    return { parts, detail: d.before ? L('기준일 이전 ' + d.before + '행은 재고에 더하지 않습니다', d.before + ' dòng trước ngày tồn đầu không cộng vào tồn') : '' };
  };
})();
