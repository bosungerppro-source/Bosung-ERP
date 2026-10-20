/* Excel import / export: generic table I/O + parsers for the factory's own report formats */
(function () {
  'use strict';
  const ERP = window.ERP;
  const XL = ERP.xl = {};
  const XLSX = () => window.XLSX;
  const rnd = (v) => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v);

  // ---------------- low-level reading ----------------
  function serialToStr(v) {
    if (v < 1) { const m = Math.round(v * 1440); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
    const ms = Math.round((v - 25569) * 86400) * 1000; const d = new Date(ms);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function cellVal(cell) {
    if (!cell) return null;
    switch (cell.t) {
      case 'n': if (cell.z && typeof cell.z === 'string' && XLSX().SSF.is_date(cell.z) && cell.v >= 0 && cell.v < 80000) return serialToStr(cell.v); return rnd(cell.v);
      case 's': { const s = String(cell.v).trim(); if (s === '') return null; if (/^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|NUM!)/.test(s)) return null; return s; }
      case 'b': return cell.v;
      case 'e': return null;
      case 'd': { const d = cell.v; return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
      default: return cell.v === undefined ? null : cell.v;
    }
  }
  /** worksheet → array of rows (index = excel row-1). maxRows limits rows, maxCols limits columns */
  function matrix(ws, maxRows, maxCols) {
    if (!ws || !ws['!ref']) return [];
    const X = XLSX(); const rg = X.utils.decode_range(ws['!ref']);
    const cmax = Math.min(rg.e.c, (maxCols || 60) - 1); const rmax = Math.min(rg.e.r, maxRows ? maxRows - 1 : rg.e.r);
    const M = [];
    for (let r = 0; r <= rmax; r++) {
      const row = new Array(cmax + 1).fill(null);
      if (r >= rg.s.r) for (let c = rg.s.c; c <= cmax; c++) { const cell = ws[X.utils.encode_cell({ r, c })]; if (cell) row[c] = cellVal(cell); }
      M.push(row);
    }
    return M;
  }
  XL.matrix = matrix;
  XL.readFile = async function (file) {
    const buf = await file.arrayBuffer();
    return XLSX().read(new Uint8Array(buf), { type: 'array', cellNF: true, cellDates: false, cellStyles: false, cellFormula: false, sheetRows: 40000, bookVBA: false });
  };
  const norm = (s) => String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
  XL.norm = norm;
  /** 파일 이름 속 날짜: 2026-10-08 · 08-10-2026 · 08.10.26 (일-월-년) → ISO, 없으면 null */
  XL.fileDate = function (name) {
    const s = String(name || '');
    let m = s.match(/(?:^|\D)(\d{4})[-.](\d{1,2})[-.](\d{1,2})(?!\d)/); if (m) return ERP.fmt.ymd(+m[1], +m[2], +m[3]);
    m = s.match(/(?:^|\D)(\d{1,2})[-.](\d{1,2})[-.](\d{4}|\d{2})(?!\d)/); if (m) return ERP.fmt.ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
    return null;
  };
  const S = (r, i) => (r && r[i] !== undefined ? r[i] : null);
  const N = (v) => { if (typeof v === 'number') return v; if (typeof v === 'string') { const x = parseFloat(v.replace(/,/g, '')); return isNaN(x) ? null : x; } return null; };
  const T = (v) => (v === null || v === undefined ? null : String(v));
  const rowText = (r) => r.filter(x => x !== null).join(' ');
  const findRow = (M, pred, from, to) => { for (let i = from || 0; i < Math.min(M.length, to || M.length); i++) if (pred(M[i], i)) return i; return -1; };
  const hasCell = (r, re) => r.some(x => typeof x === 'string' && re.test(x));
  const isoRe = /^\d{4}-\d\d-\d\d$/;
  const pick = (o) => { const out = {}; Object.keys(o).forEach(k => { if (o[k] !== null && o[k] !== undefined && o[k] !== '') out[k] = o[k]; }); return out; };
  const fixDiv = (d) => ({ Dail: 'Dial', regullar: 'Regular', Regullar: 'Regular' }[d] || d);

  // ---------------- generic table export ----------------
  XL.exportRows = function (table, rows, cols) {
    const Sx = ERP.TABLES[table]; cols = cols || Sx.cols;
    const aoa = [cols.map(c => ERP.colLabel(c))].concat(rows.map(r => cols.map(c => r[c.k] === undefined ? null : r[c.k])));
    const ws = XLSX().utils.aoa_to_sheet(aoa); ws['!cols'] = cols.map(c => ({ wch: Math.max(10, Math.min(30, ERP.colLabel(c).length + 4)) }));
    const wb = XLSX().utils.book_new(); XLSX().utils.book_append_sheet(wb, ws, table);
    save(wb, table + '_' + ERP.fmt.today() + '.xlsx');
  };
  function save(wb, name) {
    const out = XLSX().write(wb, { bookType: 'xlsx', type: 'array' });
    ERP.download(name, new Blob([out], { type: 'application/octet-stream' }));
  }
  XL.exportAoa = function (name, header, rows) {
    const ws = XLSX().utils.aoa_to_sheet([header].concat(rows)); ws['!cols'] = header.map(h2 => ({ wch: Math.max(10, String(h2).length + 4) }));
    const wb = XLSX().utils.book_new(); XLSX().utils.book_append_sheet(wb, ws, name.slice(0, 31)); save(wb, name + '_' + ERP.fmt.today() + '.xlsx');
  };
  /** all tables → one workbook (sheet name = table key, header = localized labels) */
  XL.exportAll = function (tables) {
    const wb = XLSX().utils.book_new();
    (tables || Object.keys(ERP.TABLES)).forEach(n => {
      const Sx = ERP.TABLES[n]; const rows = ERP.db.rows(n);
      const aoa = [Sx.cols.map(c => ERP.colLabel(c))].concat(rows.map(r => Sx.cols.map(c => r[c.k] === undefined ? null : r[c.k])));
      XLSX().utils.book_append_sheet(wb, XLSX().utils.aoa_to_sheet(aoa), n);
    });
    save(wb, 'ERP_all_' + ERP.fmt.today() + '.xlsx');
  };
  XL.template = function () {
    const wb = XLSX().utils.book_new();
    const readme = [[L('ColorPencil ERP 업로드 양식', 'Mẫu tải lên ColorPencil ERP')],
      [L('시트 이름 = 테이블 이름입니다. 첫 줄(헤더)은 한국어/베트남어/영문 키 모두 인식합니다.', 'Tên sheet = tên bảng. Dòng đầu (tiêu đề) nhận cả tiếng Hàn/Việt/khóa tiếng Anh.')],
      [L('기존 데이터와 같은 키(예: 창고코드, PO번호)는 갱신되고 새 키는 추가됩니다.', 'Dòng trùng khóa (VD: mã kho, số PO) sẽ được cập nhật, khóa mới sẽ được thêm.')],
      [L('날짜는 YYYY-MM-DD 형식, 시간은 HH:MM 형식으로 입력하세요.', 'Ngày nhập theo YYYY-MM-DD, giờ theo HH:MM.')], [],
      [L('테이블', 'Bảng'), L('설명', 'Mô tả'), L('키 컬럼', 'Cột khóa')]];
    Object.keys(ERP.TABLES).forEach(n => { const Sx = ERP.TABLES[n]; readme.push([n, ERP.tableLabel(n), (Sx.nat || []).join(', ')]); });
    XLSX().utils.book_append_sheet(wb, XLSX().utils.aoa_to_sheet(readme), 'README');
    Object.keys(ERP.TABLES).forEach(n => {
      const Sx = ERP.TABLES[n]; const ex = ERP.db.rows(n)[0] || {};
      XLSX().utils.book_append_sheet(wb, XLSX().utils.aoa_to_sheet([Sx.cols.map(c => ERP.colLabel(c)), Sx.cols.map(c => ex[c.k] === undefined ? null : ex[c.k])]), n);
    });
    save(wb, 'ERP_upload_template.xlsx');
  };
  /** 일보 양식: 공정마다 시트 prod_<공정> (생산일 · 주/야 · 그 공정의 입력 칸). 채워서 올리면 'erp-daily' 인식기가 그 공정의 일보로 읽는다 */
  XL.dailyTemplateBook = function () {
    const wb = XLSX().utils.book_new();
    ERP.PROC.forEach(p => {
      const cols = ERP.entryCols(p.id).map(k => ERP.TABLES.prod_log.cols.find(c => c.k === k)).filter(Boolean);
      const hdr = [L('생산일', 'Ngày SX'), L('주/야', 'Ca')].concat(cols.map(c => ERP.colLabel(c)));
      XLSX().utils.book_append_sheet(wb, XLSX().utils.aoa_to_sheet([hdr, [ERP.fmt.today(), 'D']]), ('prod_' + p.id).slice(0, 31));
    });
    return wb;
  };
  XL.dailyTemplate = function () { save(XL.dailyTemplateBook(), 'ERP_daily_report_template.xlsx'); };

  // ---------------- generic table import (by header matching) ----------------
  function matchTable(sheetName, M) {
    const sn = norm(sheetName); let best = null;
    Object.keys(ERP.TABLES).forEach(n => {
      const Sx = ERP.TABLES[n];
      const byName = sn === norm(n) || sn === norm(Sx.ko) || sn === norm(Sx.vi);
      for (let hi = 0; hi < Math.min(M.length, 6); hi++) {
        const hdr = M[hi]; if (!hdr) continue;
        const map = {}; let hit = 0;
        hdr.forEach((h2, ci) => {
          if (h2 === null) return; const nh = norm(h2);
          const c = Sx.cols.find(cc => nh === norm(cc.k) || nh === norm(cc.ko) || nh === norm(cc.vi));
          if (c && !(c.k in map)) { map[c.k] = ci; hit++; }
        });
        const need = byName ? 2 : Math.max(3, Math.ceil(Sx.cols.length * 0.5));
        if (hit >= Math.min(need, Sx.cols.length) && (!best || hit > best.hit)) best = { table: n, hdrRow: hi, map, hit, byName };
      }
    });
    return best;
  }
  function genericParse(M, m) {
    const Sx = ERP.TABLES[m.table]; const rows = [];
    for (let i = m.hdrRow + 1; i < M.length; i++) {
      const r = M[i]; const o = {}; let any = false;
      Sx.cols.forEach(c => {
        if (!(c.k in m.map)) return; let v = r[m.map[c.k]]; if (v === null || v === undefined) return;
        if (c.t === 'n') { v = N(v); if (v === null) return; } else if (c.t === 'b') v = (v === true || /^(1|y|yes|true|✓|o|사용)$/i.test(String(v)));
        else if (c.t === 'd' || c.t === 'tm') v = String(v); else v = String(v);
        o[c.k] = v; any = true;
      });
      if (any) rows.push(o);
    }
    return rows;
  }

  // ---------------- specific format parsers ----------------
  // Each detector: (sheetName, Mhead, wb) -> truthy ; parser: (M, ctx) -> [{table, rows, label, mode, note}]
  const detectors = [];
  const D = (id, test, parse) => detectors.push({ id, test, parse });
  /** other modules (ecount.js) register detectors that must win over the older ones */
  XL.addDetector = (id, test, parse) => detectors.unshift({ id, test, parse });
  XL.helpers = { findRow, hasCell, S, N, T, pick, rowText, norm, matrix };
  /** KHO NVL ledger / warehouse slips: 6차부터 재고는 stock_tx 로 반영하고, 예전 입출고장(inout)에는 선택 시에만 저장 */
  const withTx = (jobs, how) => {
    if (!ERP.ecount || !ERP.inv) return jobs;
    const src = jobs[0]; const tx = ERP.ecount.txJobFromLedger(src.rows, how, src.label);
    jobs.forEach(j => { j.include = false; j.label = j.label + L(' · 예시 입출고장에 저장', ' · lưu vào sổ NXT mẫu'); });
    return [tx].concat(jobs);
  };

  // raw-material master
  D('materials', (n, M) => findRow(M, r => hasCell(r, /^WH code$/i) && hasCell(r, /MATERIAL NAME/i), 0, 8) >= 0, (M) => {
    const hi = findRow(M, r => hasCell(r, /^WH code$/i), 0, 8); const rows = [];
    for (let i = hi + 2; i < M.length; i++) {
      const r = M[i]; const code = T(S(r, 0)); if (!code || !S(r, 2)) continue;
      rows.push(pick({ code, acc_code: T(S(r, 1)), name_en: T(S(r, 2)), name_vn: T(S(r, 3)), kg_per_ea: N(S(r, 4)) || 0, kind: T(S(r, 17)), grp: T(S(r, 15)), cas_no: T(S(r, 14)), note: T(S(r, 13)) }));
    }
    return [{ table: 'materials', rows, mode: 'upsert', label: L('원부자재 마스터', 'Danh mục NVL') }];
  });
  // warehouse summary (opening stock)
  D('wh-summary', (n, M) => findRow(M, r => hasCell(r, /RAW MATERIAL WAREHOUSE REPORT/i), 0, 6) >= 0, (M) => {
    const rows = [];
    for (let i = 8; i < M.length; i++) { const r = M[i]; const code = T(S(r, 2)); if (!code || !/^[A-Za-z]/.test(code) || (S(r, 7) === null && S(r, 8) === null)) continue; rows.push({ code, open_kg: rnd(N(S(r, 7)) || 0), open_ea: rnd(N(S(r, 8)) || 0) }); }
    return [{ table: 'materials', rows, mode: 'upsert', label: L('원부자재 기초재고 (Tổng hợp)', 'Tồn đầu kỳ (Tổng hợp)'), note: L('기초재고(kg/ea)만 갱신합니다.', 'Chỉ cập nhật tồn đầu (kg/ea).') }];
  });
  D('partners', (n, M) => findRow(M, r => hasCell(r, /^Mã đơn vị$/) && hasCell(r, /^Tên đơn vị$/), 0, 8) >= 0, (M) => {
    const rows = []; const hi = findRow(M, r => hasCell(r, /^Mã đơn vị$/), 0, 8);
    for (let i = 0; i < M.length; i++) {
      const r = M[i];
      if (i === 1 && S(r, 2) && S(r, 3) && i < hi) rows.push(pick({ code: T(S(r, 2)), name: T(S(r, 3)) }));
      if (i > hi + 1 && S(r, 1) && S(r, 2)) rows.push(pick({ code: T(S(r, 1)), name: T(S(r, 2)), address: T(S(r, 3)), phone: T(S(r, 4)), note: T(S(r, 5)) }));
    }
    return [{ table: 'partners', rows, mode: 'upsert', label: L('거래처', 'Đơn vị / Đối tác') }];
  });
  // ledger
  D('ledger', (n, M) => findRow(M, r => hasCell(r, /^Số chứng từ$/), 0, 14) >= 0 && findRow(M, r => hasCell(r, /Nhập trong kỳ/), 0, 14) >= 0, (M) => {
    const hi = findRow(M, r => hasCell(r, /^Số chứng từ$/), 0, 14); const rows = []; let blank = 0;
    for (let i = hi + 2; i < M.length; i++) {
      const r = M[i]; if (!S(r, 0) || !S(r, 5)) { if (++blank > 30) break; continue; } blank = 0;
      const doc = String(S(r, 0)); const inq = (N(S(r, 11)) || 0) || (N(S(r, 12)) || 0); const outq = (N(S(r, 13)) || 0) || (N(S(r, 14)) || 0);
      rows.push(pick({ doc_no: doc, date: ERP.fmt.parseDate(S(r, 2)) || ERP.fmt.parseDate(S(r, 1)) || T(S(r, 2) || S(r, 1)), type: (inq || !outq) && !/^PXK/.test(doc) ? 'IN' : (outq ? 'OUT' : 'IN'), partner_code: T(S(r, 3)), partner_name: T(S(r, 4)), item_code: T(S(r, 5)), wh_code: T(S(r, 6)), name: T(S(r, 7)), content: T(S(r, 8)),
        kg_per_ea: N(S(r, 9)), in_kg: N(S(r, 11)) || 0, in_ea: N(S(r, 12)) || 0, out_kg: N(S(r, 13)) || 0, out_ea: N(S(r, 14)) || 0 }));
    }
    return withTx([{ table: 'inout', rows, mode: 'range', label: L('자재 입출고 장부 (Nhập - xuất)', 'Sổ nhập xuất NVL') }], 'range');
  });
  // slips (PNK / PXK)
  D('wh-slip', (n, M) => findRow(M, r => r.some(x => typeof x === 'string' && /PHI[ẾE]U\s+(NH[ẬA]P\s+KHO|XU[ẤA]T)/i.test(x.trim())), 0, 8) >= 0, (M) => {
    const ti = findRow(M, r => r.some(x => typeof x === 'string' && /PHI[ẾE]U\s+(NH[ẬA]P\s+KHO|XU[ẤA]T)/i.test(x)), 0, 8);
    const isIn = /NH[ẬA]P\s+KHO/i.test(rowText(M[ti]));
    let doc = null, date = null, partner = null;
    for (let i = 0; i < 16 && i < M.length; i++) {
      const r = M[i];
      r.forEach((x, ci) => {
        if (typeof x !== 'string') return;
        if (/^S[ốo]\s*:?$/i.test(x.trim()) && S(r, ci + 1)) doc = doc || T(S(r, ci + 1));
        const dm = x.match(/Ng[àa]y\s+(\d+)\s+th[áa]ng\s+(\d+)\s+n[ăa]m\s+(\d{4})/i); if (dm && !date) date = dm[3] + '-' + dm[2].padStart(2, '0') + '-' + dm[1].padStart(2, '0');
        const pm = x.match(/(?:Đơn vị cung cấp|Xuất cho)\s*:\s*(.+)$/i); if (pm) partner = pm[1].trim();
      });
      if (!date) { const d2 = r.find(x => typeof x === 'string' && isoRe.test(x)); if (d2 && /Input date|Ngày chứng/i.test(rowText(r))) date = d2; }
    }
    if (!doc) { for (let i = 0; i < 12 && i < M.length; i++) { const x = M[i].find(v => typeof v === 'string' && /^P[NX]K\d{6}-\d+/i.test(v.trim())); if (x) { doc = x.trim(); break; } } }
    const hi = findRow(M, r => hasCell(r, /^No\.?$/i) && (hasCell(r, /^Code/i)), ti, ti + 20);
    const rows = []; let blank = 0;
    for (let i = hi + 3; i < M.length; i++) {
      const r = M[i]; const idx = S(r, 0); const code = T(S(r, 1));
      if (!code || N(idx) === null) { if (++blank > 3) break; continue; } blank = 0;
      const kgpe = N(S(r, 4)) || 0; const kg = N(S(r, 5)) || 0; const ea = N(S(r, 6)) || 0;
      if (!kg && !ea) continue;
      rows.push(pick({ doc_no: doc, date, type: isIn ? 'IN' : 'OUT', partner_name: partner, item_code: code, wh_code: code, name: T(S(r, 2)), content: T(S(r, 3)), kg_per_ea: kgpe,
        in_kg: isIn ? kg : 0, in_ea: isIn ? ea : 0, out_kg: isIn ? 0 : kg, out_ea: isIn ? 0 : ea }));
    }
    return withTx([{ table: 'inout', rows, mode: 'slip', label: (isIn ? L('입고 전표 ', 'Phiếu nhập kho ') : L('출고 전표 ', 'Phiếu xuất kho ')) + (doc || ''), note: doc ? '' : L('전표번호를 찾지 못했습니다', 'Không tìm thấy số phiếu') }], 'slip');
  });
  D('order-korea', (n, M) => findRow(M, r => hasCell(r, /^Item Code$/i) && hasCell(r, /Safety stock/i), 0, 10) >= 0, (M) => {
    const hi = findRow(M, r => hasCell(r, /^Item Code$/i) && hasCell(r, /Safety stock/i), 0, 10); const rows = []; const seen = new Set();
    for (let i = hi + 2; i < M.length; i++) {
      const r = M[i]; const code = T(S(r, 2)); if (!code || !S(r, 3) || seen.has(code)) continue; seen.add(code);
      rows.push(pick({ code, category: T(S(r, 1)), name_kr: T(S(r, 4)), safety_stock: N(S(r, 5)), unit: T(S(r, 6)), usage_kg_month: N(S(r, 10)), usage_ea_month: N(S(r, 11)) }));
    }
    return [{ table: 'materials', rows, mode: 'update', label: L('안전재고/월사용량 (Oder Korea)', 'Tồn an toàn / mức dùng (Oder Korea)'), note: L('기존 자재 코드만 갱신합니다.', 'Chỉ cập nhật mã đã có.') }];
  });
  D('hangtra', (n, M) => findRow(M, r => hasCell(r, /^HÀNG TRẢ$/), 0, 6) >= 0, (M) => {
    const di = findRow(M, r => hasCell(r, /^NGÀY$/), 0, 6); const date = di >= 0 ? (M[di].find(x => typeof x === 'string' && isoRe.test(x)) || ERP.fmt.today()) : ERP.fmt.today();
    const rows = []; for (let i = 3; i < M.length; i++) { const r = M[i]; if (S(r, 1) && S(r, 2)) rows.push(pick({ date, code: T(S(r, 1)), name: T(S(r, 2)), qty_text: T(S(r, 3)) })); }
    return [{ table: 'returns', rows, mode: 'append', label: L('반품 전표', 'Phiếu hàng trả') }];
  });

  // PO
  D('po', (n, M) => findRow(M, r => hasCell(r, /^Po No$/i) && hasCell(r, /^kind goods$/i), 0, 6) >= 0, (M) => {
    const hi = findRow(M, r => hasCell(r, /^Po No$/i), 0, 6); const rows = [];
    for (let i = hi + 1; i < M.length; i++) {
      const r = M[i]; if (!S(r, 0) || !isoRe.test(String(S(r, 0)))) continue;
      rows.push(pick({ date: S(r, 0), condition: T(S(r, 1)), customer: T(S(r, 2)), country: T(S(r, 3)), market: T(S(r, 4)), po_no: T(S(r, 5)), po_no2: T(S(r, 6)), item_no: T(S(r, 7)), manila_no: T(S(r, 8)), kind: T(S(r, 9)), color: T(S(r, 10)),
        rfid: T(S(r, 11)), kind2: T(S(r, 12)), color2: T(S(r, 13)), pcs: N(S(r, 14)) || 0, sets: N(S(r, 15)) || 0, cs: N(S(r, 16)) || 0, due: T(S(r, 17)), rate: N(S(r, 18)), packed: N(S(r, 19)) || 0, diff: N(S(r, 20)), yn: T(S(r, 21)), mark: T(S(r, 22)) }));
    }
    return [{ table: 'po', rows, mode: 'upsert', label: L('수주 (PO) 목록', 'Danh sách PO') }];
  });

  // history sheets of the production workbook (header row is found within the first 4 rows)
  const hdrIdx = (M, re1, re2, re3) => findRow(M, r => hasCell(r, re1) && (!re2 || hasCell(r, re2)) && (!re3 || hasCell(r, re3)), 0, 4);
  const hist = (id, hre, mapRow, proc, label) => D(id, (n, M) => hdrIdx(M, hre[0], hre[1], hre[2]) >= 0, (M, ctx) => {
    const since = ctx.since || '2026-01-01'; const rows = []; const hi = hdrIdx(M, hre[0], hre[1], hre[2]);
    for (let i = hi + 1; i < M.length; i++) { const r = M[i]; const d = S(r, 0); if (!d || !isoRe.test(String(d)) || d < since) continue; const o = mapRow(r); if (o) rows.push(Object.assign({ date: d, process: proc, shift: 'D', source: 'history' }, pick(o))); }
    rows.forEach(o => { if (o.ok_ea === undefined) o.ok_ea = o.ok_qty; if (o.ng_qty === undefined) o.ng_qty = 0; });
    return [{ table: 'prod_log', rows, mode: 'range', proc, label, hasSince: true }];
  });
  hist('h-inj', [/^Machine No\.$/, /product classification/i], (r) => {
    if (!S(r, 1) || !N(S(r, 12))) return null;
    return { machine_no: T(S(r, 1)), division: fixDiv(T(S(r, 2))), part: T(S(r, 3)), name: T(S(r, 3)), code: T(S(r, 3)), work_min: N(S(r, 4)) ? N(S(r, 4)) * 60 : null, cavity: N(S(r, 5)), shots: N(S(r, 11)), ct: N(S(r, 8)), weight_kg: N(S(r, 9)),
      ok_qty: N(S(r, 12)) || 0, raw_material: T(S(r, 18)), raw_kg: N(S(r, 19)), machine: T(S(r, 7)) };
  }, 'INJ', L('이력: 사출 (Injection)', 'Lịch sử: Ép nhựa'));
  hist('h-ref', [/^Refill Code$/, /^Machine No$/], (r) => {
    if (!N(S(r, 10))) return null;
    return { machine_no: T(S(r, 1)), code: T(S(r, 2)), name: T(S(r, 4)), division: fixDiv(T(S(r, 5))), weight_kg: N(S(r, 6)), ok_qty: N(S(r, 10)) || 0, remark: S(r, 3) ? 'BM:' + S(r, 3) : null };
  }, 'REF', L('이력: 리필 (Refill)', 'Lịch sử: Ép lõi'));
  hist('h-asm', [/^Dep$/, /^Machine No$/], (r) => {
    const q = N(S(r, 9)) !== null ? N(S(r, 9)) : N(S(r, 7)); if (!q) return null;
    let ng = N(S(r, 15)); if (ng === null) ng = [10, 11, 12, 13, 14].reduce((a, c) => a + (N(S(r, c)) || 0), 0);
    return { machine_no: T(S(r, 2)), machine: T(S(r, 3)), code: T(S(r, 4)), name: T(S(r, 5)), division: fixDiv(T(S(r, 6))), ok_qty: q, ng_qty: ng || 0 };
  }, 'ASM', L('이력: 조립 (Assembly)', 'Lịch sử: Lắp ráp'));
  hist('h-wrp', [/^Machine No\.$/, /^Color Name$/, /^Loi$/], (r) => {
    if (!N(S(r, 6))) return null; return { machine_no: T(S(r, 1)), division: fixDiv(T(S(r, 2))), name: T(S(r, 3)), plan_qty: N(S(r, 4)), ok_qty: N(S(r, 6)) || 0, ng_qty: N(S(r, 7)) || 0 };
  }, 'WRP', L('이력: 권취 (Wrapping)', 'Lịch sử: Quấn giấy'));
  hist('h-pck', [/^PO#$/, /Qty Packing Set/], (r) => {
    if (!(N(S(r, 7)) || N(S(r, 12)))) return null;
    return { machine_no: T(S(r, 1)), po_no: T(S(r, 2)), code: T(S(r, 9)), division: fixDiv(T(S(r, 4))), po_qty: N(S(r, 6)), ok_qty: N(S(r, 7)) || 0, ok_ea: N(S(r, 12)) || 0, unit: 'set', name: S(r, 5) ? S(r, 5) + 'CL' : null };
  }, 'PCK', L('이력: 포장 (Packing)', 'Lịch sử: Đóng gói'));

  // BOM / masters
  D('bom', (n, M) => hasCell(M[0] || [], /^Retails No$/) && hasCell(M[0] || [], /^Color Code$/), (M) => {
    const rows = []; for (let i = 1; i < M.length; i++) { const r = M[i]; if (!S(r, 0) || !S(r, 1)) continue; rows.push(pick({ retail_no: T(S(r, 0)), color_code: T(S(r, 1)), color_name: T(S(r, 2)), division: T(S(r, 3)), n_colors: N(S(r, 4)), kind: T(S(r, 5)), nose_code: T(S(r, 8)), nose_color: T(S(r, 9)), refill_code: T(S(r, 10)), refill_color: T(S(r, 11)), barrel_code: T(S(r, 12)), barrel_color: T(S(r, 13)), holder: T(S(r, 14)), spoon: T(S(r, 15)) })); }
    return [{ table: 'bom', rows, mode: 'upsert', label: L('BOM (색상별)', 'BOM theo màu') }];
  });
  D('item_bom', (n, M) => findRow(M, r => hasCell(r, /^Item$/) && hasCell(r, /^Manila$/i) && hasCell(r, /^Rfid$/i), 0, 4) >= 0, (M) => {
    const rows = []; for (let i = 1; i < M.length; i++) { const r = M[i]; if (S(r, 2) && !/^Item$/.test(S(r, 2))) rows.push(pick({ item: T(S(r, 2)), manila: T(S(r, 3)), kind: T(S(r, 4)), colors: N(S(r, 5)), rfid: T(S(r, 6)), kind2: T(S(r, 7)), cs: N(S(r, 8)) })); }
    return [{ table: 'item_bom', rows, mode: 'upsert', label: L('품목 구성 (Item BOM)', 'Item BOM') }];
  });
  D('products', (n, M) => findRow(M, r => hasCell(r, /^Color name$/i) && hasCell(r, /Group Code/i), 0, 6) >= 0, (M) => {
    const rows = []; for (let i = 4; i < M.length; i++) { const r = M[i]; if (S(r, 1) && S(r, 2) && /^[A-Za-z]/.test(S(r, 1))) rows.push(pick({ code: T(S(r, 1)), color_name: T(S(r, 2)), group_code: T(S(r, 3)), kind: T(S(r, 4)), version: T(S(r, 5)), nose_code: T(S(r, 6)), refill_code: T(S(r, 7)), barrel_code: T(S(r, 8)), grp: T(S(r, 9)), sku: T(S(r, 10)), remarks: T(S(r, 11)) })); }
    return [{ table: 'products', rows, mode: 'upsert', label: L('제품 색상 (DMSP)', 'Danh mục màu SP (DMSP)') }];
  });
  D('recipes', (n, M) => hasCell(M[0] || [], /^English Name$/), (M) => {
    const hdr = M[0]; const rows = [];
    for (let i = 1; i < M.length; i++) { const r = M[i]; if (!S(r, 0)) continue; for (let j = 5; j < hdr.length; j++) { const h2 = hdr[j]; if (!h2 || /^열\d+$/.test(h2)) continue; const v = N(S(r, j)); if (v) rows.push({ code: T(S(r, 0)), sku: T(S(r, 1)), color: T(S(r, 2)), material: h2, coef: v }); } }
    return [{ table: 'recipes', rows, mode: 'upsert', label: L('배합표 (components)', 'Công thức phối liệu') }];
  });
  // 11차: BOM 사용량 (components 시트: code · item code · color · 원료별 g/개). 원재료 소요량(MRP) · 신고서 계산용 — 재고는 차감하지 않는다.
  // 최신 판을 올리면 통째로 바뀐다(전체 교체). 같은 코드가 두 번이면 첫 행을 쓰고 알린다. 글자만 있는 열(향기오일 이름)은 비고로.
  const usageHdr = (r) => { const n = (r || []).map(x => norm(x)); return n[0] === 'code' && n.includes('itemcode') && n.includes('color'); };
  D('recipes_usage', (n, M) => findRow(M, usageHdr, 0, 3) >= 0, (M) => {
    const hi = findRow(M, usageHdr, 0, 3); const H = M[hi]; const hn = H.map(x => norm(x));
    const ci = { code: hn.indexOf('code'), sku: hn.indexOf('itemcode'), color: hn.indexOf('color') };
    const cols = []; H.forEach((x, j) => { if (j === ci.code || j === ci.sku || j === ci.color) return; const name = typeof x === 'string' ? x.trim() : ''; if (!name || /^열\s*\d+$/.test(name)) return; cols.push({ j, name }); });
    const textOnly = (j) => { let t = 0, nn = 0; for (let i = hi + 1; i < M.length; i++) { const v = S(M[i], j); if (v === null || v === '') continue; if (typeof v === 'number') nn++; else t++; } return t > 0 && nn === 0; };
    const noteCols = cols.filter(c => textOnly(c.j)), matCols = cols.filter(c => !textOnly(c.j));
    const rows = [], seen = new Set(), dups = [], notes = new Map(); let products = 0;
    for (let i = hi + 1; i < M.length; i++) {
      const r = M[i]; const code = String(T(S(r, ci.code)) || '').trim(); if (!code) continue;
      const nt = noteCols.map(c => String(T(S(r, c.j)) || '').trim()).filter(Boolean).join(' · '); if (nt && !notes.has(code)) notes.set(code, nt);
      if (seen.has(code)) { if (!dups.includes(code)) dups.push(code); continue; }
      seen.add(code); products++;
      const sv = S(r, ci.sku); const sku = sv === null || sv === '' || sv === 0 || String(sv).trim() === '0' ? undefined : String(sv).trim();
      const color = String(T(S(r, ci.color)) || '').trim() || undefined;
      matCols.forEach(c => { const v = N(S(r, c.j)); if (!v) return; rows.push(pick({ code, sku, color, material: c.name, coef: v })); });
    }
    rows.forEach(r => { const nt = notes.get(r.code); if (nt) r.note = nt; });
    return [{ table: 'recipes', rows, mode: 'replace', kind: 'recipes_usage', products, dups, materials: matCols.length, label: L('BOM 사용량 · 배합표 (원료 g/개)', 'Định mức NVL (g/cái)'),
      modes: () => ({ replace: L('전체 교체 (최신 판으로 바꾸기)', 'Thay toàn bộ (bản mới nhất)'), upsert: L('같은 품목 · 원료만 갱신', 'Chỉ cập nhật mã · NL trùng') }),
      preview: (j) => ({ parts: [[L('품목', 'Mã'), j.products, 'info'], [L('원료 열', 'Cột NL'), j.materials, 'neutral'], [L('지금 배합표', 'Hiện có'), ERP.db.rows('recipes').length, 'neutral']].concat(j.dups.length ? [[L('중복 코드 (첫 행 사용)', 'Mã trùng (dùng dòng đầu)'), j.dups.length, 'warn']] : []),
        detail: L('재고는 차감하지 않습니다 — 원재료 소요량(MRP) · 신고서 계산용. "전체 교체"면 지금 배합표를 이 파일로 바꿉니다.', 'Không trừ tồn — chỉ để tính nhu cầu NVL (MRP) · tờ khai. "Thay toàn bộ" sẽ thay bằng file này.') + (j.dups.length ? L(' · 중복: ', ' · Trùng: ') + j.dups.slice(0, 8).join(', ') + (j.dups.length > 8 ? ' …' : '') : '') }),
      after: (j) => { const DB = ERP.db; DB.meta.recipeSrc = { file: j.file || '', at: new Date().toISOString(), products: j.products, rows: j.rows.length, dups: j.dups.slice(0, 300), mode: j.mode }; DB.saveMeta(); } }];
  });
  D('refill-spec', (n, M) => hasCell(M[0] || [], /^ERP Code$/i) && hasCell(M[0] || [], /^Phân loại$/), (M) => {
    const rows = []; for (let i = 1; i < M.length; i++) { const r = M[i]; if (S(r, 2) && S(r, 5)) rows.push(pick({ customer: T(S(r, 0)), kind: T(S(r, 1)), code: T(S(r, 2)), name: T(S(r, 3)), class: T(S(r, 4)), erp_code: T(S(r, 5)), plan_weight_g: N(S(r, 6)), g_per_pc: N(S(r, 7)), plan_qty: N(S(r, 8)) })); }
    return [{ table: 'refill_specs', rows, mode: 'upsert', label: L('리필 규격', 'Quy cách refill') }];
  });
  D('semi', (n, M) => hasCell(M[0] || [], /^Mã mặt hàng$/) && hasCell(M[0] || [], /^Danh mục mặt hàng$/), (M) => {
    const semi = [], sub = [];
    for (let i = 1; i < M.length; i++) { const r = M[i]; if (!S(r, 1)) continue; const cat = T(S(r, 3)) || ''; const o = pick({ code: T(S(r, 1)), name: T(S(r, 2)), category: cat, cl1: T(S(r, 4)), cl2: T(S(r, 5)), cl3: T(S(r, 6)) }); (/phụ/i.test(cat) ? sub : semi).push(o); }
    const out = []; if (semi.length) out.push({ table: 'semi_items', rows: semi, mode: 'upsert', label: L('반제품 목록', 'Bán thành phẩm') }); if (sub.length) out.push({ table: 'sub_materials', rows: sub, mode: 'upsert', label: L('부자재 목록', 'Vật liệu phụ') });
    return out;
  });
  D('submat', (n, M) => M.filter(r => typeof r[3] === 'string' && /Nguyên vật liệu phụ/i.test(r[3])).length > 5 && !hasCell(M[0] || [], /^Mã mặt hàng$/), (M) => {
    const rows = []; for (let i = 0; i < M.length; i++) { const r = M[i]; if (S(r, 1) && S(r, 2) && /phụ/i.test(S(r, 3) || '')) rows.push(pick({ code: T(S(r, 1)), name: T(S(r, 2)), category: T(S(r, 3)), customer: T(S(r, 4)), type: T(S(r, 5)), grp: T(S(r, 6)) })); }
    return [{ table: 'sub_materials', rows, mode: 'upsert', label: L('부자재 목록', 'Vật liệu phụ') }];
  });

  // movement slips
  D('movement', (n, M) => findRow(M, r => hasCell(r, /MATERIAL MOVEMENT SLIP/i), 0, 4) >= 0, (M, ctx) => {
    const date = (M.slice(0, 4).flat().find(x => typeof x === 'string' && isoRe.test(x))) || ERP.fmt.today();
    const hi = findRow(M, r => hasCell(r, /^Item code/i), 0, 12); const rows = [];
    const proc = /nh[ựu]a/i.test(ctx.sheet) ? 'Injection' : /l[õo]i/i.test(ctx.sheet) ? 'Refill' : '';
    for (let i = hi + 1; i < M.length; i++) { const r = M[i]; if (!S(r, 1) || !S(r, 2) || (N(S(r, 4)) === null && N(S(r, 5)) === null)) continue; rows.push(pick({ date, slip_type: 'Transfer of Semi-product', from_proc: proc, item_code: T(S(r, 1)), model: T(S(r, 2)), kind: T(S(r, 3)), qty_in: N(S(r, 4)) || 0, qty_out: N(S(r, 5)) || 0, total: N(S(r, 6)) || ((N(S(r, 4)) || 0) + (N(S(r, 5)) || 0)), work_time: T(S(r, 7)), remark: T(S(r, 8)) })); }
    return [{ table: 'movements', rows, mode: 'range', label: L('이동전표 ', 'Phiếu chuyển hàng ') + proc, note: L('전표 구분은 기본값(반제품 이동)입니다. 필요하면 수정하세요.', 'Loại phiếu mặc định: chuyển bán thành phẩm.') }];
  });

  // daily production reports
  function dailyKind(M) {
    const head = M.slice(0, 9).map(rowText).join(' | ');
    if (!/BÁO CÁO SẢN XUẤT HÀNG NGÀY/i.test(head)) return null;
    if (/Hot foil|In chuy/i.test(head)) return 'STP';
    if (/Refill Forming|Tạo ruột lõi/i.test(head)) return 'REF';
    if (/Paper wrapped|Quấn giấy/i.test(head)) return 'WRP';
    if (/Packing|Đóng gói/i.test(head)) return 'PCK';
    if (/Ass\s*\(|Lắp ráp/i.test(head)) return 'ASM';
    return null;
  }
  /** 생산일자: 처음 9행의 날짜 칸(ISO) → "생산일자 / Ngày sản xuất" 옆 칸의 글자 날짜 → 못 찾으면 null (화면에서 날짜를 넣게 한다) */
  const dailyDate = (M) => {
    for (let i = 0; i < 9 && i < M.length; i++) { const x = M[i].find(v => typeof v === 'string' && isoRe.test(v)); if (x) return x; }
    for (let i = 0; i < 9 && i < M.length; i++) {
      const r = M[i]; const li = r.findIndex(v => typeof v === 'string' && /생산일자|ngày sản xuất|ngay san xuat/i.test(v)); if (li < 0) continue;
      for (let j = li + 1; j < r.length; j++) { const d = ERP.fmt.parseDate(r[j]); if (d) return d; }
    }
    return null;
  };
  /** "1. 작업장명 / Tên công đoạn" 옆 칸 (예: "Ass ( floor 1 ) / Lắp ráp tầng 1") — 같은 날 다른 층 일보를 구분한다 */
  const dailyPlace = (M) => {
    for (let i = 0; i < 9 && i < M.length; i++) {
      const r = M[i]; const li = r.findIndex(v => typeof v === 'string' && /작업장명|tên công đoạn|ten cong doan/i.test(v)); if (li < 0) continue;
      for (let j = li + 1; j < r.length; j++) { const v = r[j]; if (typeof v === 'string' && v.trim() && !/생산일자|ngày sản xuất/i.test(v)) return v.replace(/\s+/g, ' ').trim(); }
    }
    return '';
  };
  /** 조: 시트 이름(Ca ngày / Ca đêm · Day / Night · 주간 / 야간) → 행의 DAY/NIGHT 칸 → 기본 D */
  const shiftOfName = (n) => { const f = norm(n); if (/cadem|night|야간/.test(f)) return 'N'; if (/cangay|day|주간/.test(f)) return 'D'; return null; };
  const shiftCell = (v, d) => { const f = norm(v); if (!f) return d; if (/^(d|day|ngay|cangay|주간)$/.test(f)) return 'D'; if (/^(n|night|dem|cadem|야간)$/.test(f)) return 'N'; return d; };
  /** 일보 품목군: 누적 시트의 같은 코드 → ERP CODE 제품군별로 누적 시트에서 가장 많이 쓴 품목군 → 설비 이름 */
  const divIndex = () => !ERP.db ? { code: () => null, line: () => null } : ERP.db.memo('xl.divIdx', ['prod_log', 'items'], () => {
    const byCode = new Map(), byLine = new Map(); const INV = ERP.inv; const IT = INV ? INV.items() : null;
    const bump = (m, k, d) => { let o = m.get(k); if (!o) m.set(k, o = new Map()); o.set(d, (o.get(d) || 0) + 1); };
    ERP.db.rows('prod_log').forEach(r => {
      if (r.source !== 'history' || !r.division || r.code === undefined || r.code === null) return; bump(byCode, String(r.code).toUpperCase(), r.division);
      const it = IT && IT.get(r.code); const line = it ? INV.info(it).line : ''; if (line) bump(byLine, line, r.division);
    });
    const top = (o) => { let best = null, n = -1; o.forEach((v, k) => { if (v > n) { n = v; best = k; } }); return best; };
    return { code: (c) => { const o = byCode.get(String(c || '').toUpperCase()); return o ? top(o) : null; }, line: (l) => { const o = byLine.get(l); return o ? top(o) : null; } };
  });
  const dailyDiv = (code, machine) => {
    const X = divIndex(); const d1 = X.code(code); if (d1) return d1;
    const INV = ERP.inv; const it = INV && INV.items().get(code); const d2 = it ? X.line(INV.info(it).line) : null; if (d2) return d2;
    const m = String(machine || ''); return /mini/i.test(m) ? 'Mini' : /click/i.test(m) ? 'Click pencil' : /pencil/i.test(m) ? 'Pencil' : /regular|dial/i.test(m) ? 'Dial' : null;
  };
  const poItemsOf = (po) => { const s = new Set(); if (po && ERP.db) ERP.db.rows('po').forEach(p => { if (String(p.po_no) === String(po) && p.item_no) s.add(norm(p.item_no)); }); return s; };
  /** 같은 날짜 · 공정의 누적 시트(history) 행이 있는 일보 행 수 (미리보기 안내 · 기본 건너뜀) */
  XL.overlapOf = (rows) => { if (!ERP.db) return 0; const hist = new Set(); ERP.db.rows('prod_log').forEach(r => { if (r.source === 'history') hist.add(r.date + '|' + r.process); }); return (rows || []).filter(r => r.source !== 'history' && hist.has(r.date + '|' + r.process)).length; };
  const okRow = (r, i) => S(r, i) !== null && String(S(r, i)) !== '0';
  D('daily', (n, M) => !!dailyKind(M), (M, ctx) => {
    const kind = dailyKind(M); const date = dailyDate(M) || ''; const shift = ctx.shift || shiftOfName(ctx.sheet) || 'D'; const workplace = dailyPlace(M); const rows = [];
    const base = (o) => rows.push(Object.assign({ date, process: kind, shift, source: 'daily-report', workplace: workplace || undefined }, pick(o)));
    if (kind === 'PCK') {
      // 열: 0 제품명/고객 품번 · 1 완제품(FG, CT) 코드 · 2 마니라(SG, SET) 코드 · 3 PO · … · 9 실적 set · 10 실적 CT · 11 실적 ea
      const hi = findRow(M, r => hasCell(r, /Products name/i), 0, 10); const IT = ERP.inv ? ERP.inv.items() : null;
      for (let i = hi + 2; i < M.length; i++) { const r = M[i]; if (!S(r, 0) || String(S(r, 0)) === '0' || !S(r, 3) || N(S(r, 9)) === null) continue;
        const c0 = T(S(r, 0)), c1 = T(S(r, 1)), c2 = T(S(r, 2)), po = T(S(r, 3)); const pis = poItemsOf(po);
        const code = [c1, c0, c2].find(v => v && pis.has(norm(v))) || c1 || c2;          // PO 품번과 같은 값 (누적 시트와 같은 방식 → PO 진행률)
        const it = [c1, c2].map(v => v && IT && IT.get(v)).find(Boolean);                 // 재고 품목: 완제품(열 1) → 마니라(열 2)
        base({ name: c0, code, item: it ? it.code : undefined, remark: c2 ? 'SG ' + c2 : undefined, po_no: po, po_qty: N(S(r, 4)), machine: T(S(r, 5)), machine_no: T(S(r, 6)), plan_qty: N(S(r, 8)), ok_qty: N(S(r, 9)) || 0, ok_ct: N(S(r, 10)), ok_ea: N(S(r, 11)), unit: 'set', ng_qty: N(S(r, 12)) || 0, start: T(S(r, 13)), end: T(S(r, 14)), break_min: N(S(r, 15)), work_min: N(S(r, 16)), workers: N(S(r, 17)), stop_min: N(S(r, 18)), stop_reason: T(S(r, 19)), shift: shiftCell(S(r, 20), shift) }); }
    } else if (kind === 'REF') {
      const hi = findRow(M, r => hasCell(r, /^Description$/), 0, 10);
      for (let i = hi + 2; i < M.length; i++) { const r = M[i]; if (!S(r, 1) || !S(r, 4) || N(S(r, 9)) === null) continue;
        base({ machine: T(S(r, 1)), machine_no: T(S(r, 2)), name: T(S(r, 3)), code: T(S(r, 4)), division: T(S(r, 1)), plan_qty: N(S(r, 6)), ok_qty: N(S(r, 9)) || 0, ng_qty: N(S(r, 11)) || 0, weight_kg: (N(S(r, 7)) || 0) / 1000, start: T(S(r, 12)), end: T(S(r, 13)), break_min: N(S(r, 14)), work_min: N(S(r, 15)), workers: N(S(r, 16)), stop_min: N(S(r, 17)), remark: T(S(r, 18)), shift: shiftCell(S(r, 19), shift) }); }
    } else if (kind === 'WRP') {
      const hi = findRow(M, r => hasCell(r, /Target product/i), 0, 10);
      for (let i = hi + 2; i < M.length; i++) { const r = M[i]; if (!S(r, 1) || !S(r, 5) || N(S(r, 11)) === null) continue;
        base({ machine: T(S(r, 1)), machine_no: T(S(r, 2)), name: T(S(r, 4)), code: T(S(r, 5)), po_no: T(S(r, 6)), po_qty: N(S(r, 7)), plan_qty: N(S(r, 9)), ok_qty: N(S(r, 11)) || 0, ok_ct: N(S(r, 13)), ng_qty: N(S(r, 14)) || 0, work_min: N(S(r, 15)), workers: N(S(r, 16)), stop_min: N(S(r, 17)), remark: T(S(r, 18)), shift: shiftCell(S(r, 19), shift) }); }
    } else {
      const hi = findRow(M, r => hasCell(r, /^Code\s*\n?Mã hàng/i) || hasCell(r, /^Code$/), 0, 12);
      for (let i = hi + 2; i < M.length; i++) { const r = M[i]; if (!S(r, 0) || String(S(r, 0)).startsWith('0') || !S(r, 2) || N(S(r, 4)) === null) continue;
        if (kind === 'ASM') base({ machine: T(S(r, 0)), machine_no: T(S(r, 1)), code: T(S(r, 2)), name: T(S(r, 3)), ok_qty: N(S(r, 4)) || 0, start: T(S(r, 5)), end: T(S(r, 6)), break_min: N(S(r, 7)), work_min: N(S(r, 8)), stop_min: N(S(r, 9)), workers: N(S(r, 10)), ng_qty: N(S(r, 11)) || 0, remark: T(S(r, 17)), division: dailyDiv(T(S(r, 2)), S(r, 0)) });
        else base({ machine: T(S(r, 0)), machine_no: T(S(r, 1)), code: T(S(r, 2)), name: T(S(r, 3)), ok_qty: N(S(r, 4)) || 0, start: T(S(r, 5)), end: T(S(r, 6)), break_min: N(S(r, 7)), work_min: N(S(r, 8)), stop_min: N(S(r, 9)), ng_qty: N(S(r, 10)) || 0, workers: N(S(r, 11)), remark: T(S(r, 12)), division: dailyDiv(T(S(r, 2)), S(r, 0)) }); }
    }
    rows.forEach(o => { if (o.ok_ea === undefined) o.ok_ea = o.ok_qty; });
    const label = L('생산 일보 · ', 'Báo cáo SX · ') + ERP.procName(kind) + ' ' + (date || L('(날짜 없음)', '(chưa có ngày)')) + (shift === 'N' ? L(' · 야간', ' · ca đêm') : '') + (workplace ? ' · ' + workplace : '');
    return [{ table: 'prod_log', rows, mode: 'range', proc: kind, label, hasShift: true, date, needDate: !date, include: rows.length > 0 && !!date, overlap: XL.overlapOf(rows),
      note: date ? '' : L('생산일자를 읽지 못했습니다 — 날짜를 넣으면 반영할 수 있습니다.', 'Không đọc được ngày sản xuất — hãy nhập ngày để áp dụng.') }];
  });

  // ERP 일보 양식 ("일보 양식 받기"): 시트 이름 prod_<공정>, 머리글 = 생산일 · 주/야 · 그 공정의 입력 칸 (한국어/베트남어)
  const tplProc = (n) => { const m = String(n || '').match(/^prod_(.+)$/i); if (!m) return null; const p = ERP.PROC.find(x => String(x.id).toUpperCase() === m[1].trim().toUpperCase()); return p ? p.id : null; };
  const tplHdr = (r) => hasCell(r, /^(생산일|Ngày SX)$/i);
  D('erp-daily', (n, M) => !!tplProc(n) && findRow(M, tplHdr, 0, 4) >= 0, (M, ctx) => {
    const proc = tplProc(ctx.sheet); const P = ERP.PROC.find(x => x.id === proc); const hi = findRow(M, tplHdr, 0, 4); const cols = ERP.TABLES.prod_log.cols; const map = {};
    M[hi].forEach((x, ci) => {
      if (typeof x !== 'string') return; const nx = norm(x);
      if (/^(생산일|ngaysx)$/.test(nx)) map.date = ci; else if (/^(주야|ca)$/.test(nx)) map.shift = ci;
      else { const c = cols.find(cc => nx === norm(cc.ko) || nx === norm(cc.vi) || nx === norm(cc.k)); if (c && map[c.k] === undefined && !['date', 'process', 'shift', 'source'].includes(c.k)) map[c.k] = ci; }
    });
    const rows = [];
    for (let i = hi + 1; i < M.length; i++) {
      const r = M[i]; if (!r) continue; const o = { process: proc, source: 'template' };
      Object.keys(map).forEach(k => { if (k === 'date' || k === 'shift') return; const c = cols.find(cc => cc.k === k); const v = S(r, map[k]); if (v === null) return; o[k] = c.t === 'n' ? N(v) : T(v); });
      if ((o.ok_qty === undefined || o.ok_qty === null) && (o.ng_qty === undefined || o.ng_qty === null) && (o.ok_ea === undefined || o.ok_ea === null)) continue;   // 빈 줄 · 예시 줄
      o.date = ERP.fmt.parseDate(S(r, map.date)) || ''; o.shift = shiftCell(S(r, map.shift), 'D');
      if (o.ok_qty === undefined || o.ok_qty === null) o.ok_qty = 0; if (o.ok_ea === undefined || o.ok_ea === null) o.ok_ea = o.ok_qty; if (P && P.unit === 'set') o.unit = 'set';
      rows.push(pick(o));
    }
    const need = rows.some(r => !r.date);
    return [{ table: 'prod_log', rows, mode: 'range', proc, label: L('ERP 일보 양식 · ', 'Mẫu báo cáo ERP · ') + ERP.procName(proc), hasShift: true, needDate: need, include: rows.length > 0 && !need, overlap: XL.overlapOf(rows),
      note: need ? L('생산일을 읽지 못한 줄이 있습니다 — 날짜를 넣으면 반영할 수 있습니다.', 'Có dòng không đọc được ngày — hãy nhập ngày.') : '' }];
  });

  // generic (own template / localized export)
  XL.detectSheet = function (name, wsFull) {
    const head = matrix(wsFull, 14, 60); if (!head.some(r => r.some(x => x !== null))) return [];
    for (const d of detectors) {
      let ok = false; try { ok = d.test(name, head); } catch (e) { ok = false; }
      if (ok) return [{ id: d.id, sheet: name, parse: d.parse, head }];
    }
    const m = matchTable(name, head);
    if (m) return [{ id: 'generic', sheet: name, generic: m, head }];
    return [];
  };
  /** returns jobs: {sheet, id, table, label, rows, mode, ...} */
  XL.analyze = function (wb, ctxOpt) {
    const jobs = [];
    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name]; if (!ws || !ws['!ref']) return;
      let found; try { found = XL.detectSheet(name, ws); } catch (e) { console.error(e); found = []; }
      found.forEach(f => {
        try {
          const M = matrix(ws, null, f.id === 'recipes' || f.id === 'recipes_usage' ? 90 : 40); const ctx = Object.assign({ sheet: name }, ctxOpt || {});
          let outs;
          if (f.id === 'generic') outs = [{ table: f.generic.table, rows: genericParse(M, f.generic), mode: 'upsert', label: ERP.tableLabel(f.generic.table) }];
          else outs = f.parse(M, ctx);
          outs = outs.filter(o => o.table !== 'movements');
          // 6차: 예전 원부자재 마스터(materials)는 예시 자료 — 기본으로 반영하지 않는다
          outs.forEach(o => { if (o.table === 'materials' && o.include === undefined) { o.include = false; o.label = (o.label || '') + L(' · 예시 원부자재 마스터', ' · danh mục NVL mẫu'); } });
          if (!outs.length) jobs.push({ sheet: name, id: 'unknown', table: null, rows: [], label: name, unknown: true, include: false });
          outs.forEach(o => jobs.push(Object.assign({ sheet: name, id: f.id, include: o.rows.length > 0, ctx }, o)));
        } catch (e) { console.error('parse failed', name, e); jobs.push({ sheet: name, id: f.id, table: null, rows: [], label: name, error: e.message, include: false }); }
      });
      if (!found.length) jobs.push({ sheet: name, id: 'unknown', table: null, rows: [], label: name, unknown: true, include: false });
    });
    return jobs;
  };

  // ---------------- apply ----------------
  XL.apply = function (job) {
    if (typeof job.apply === 'function') return job.apply(job);
    const res = applyTable(job); if (typeof job.after === 'function') job.after(job, res);   // 11차: 반영 뒤 할 일 (예: 배합표 출처 기록)
    return res;
  };
  function applyTable(job) {
    const DB = ERP.db; const t = job.table; let rows = job.rows.slice(); let res = { added: 0, updated: 0, removed: 0 };
    if (job.since && job.table === 'prod_log') rows = rows.filter(r => r.date >= job.since);
    const mode = job.mode;
    if (mode === 'replace') { res.removed = DB.rows(t).length; DB.replace(t, rows); res.added = rows.length; }
    else if (mode === 'append') { DB.addMany(t, rows); res.added = rows.length; }
    else if (mode === 'range' && t === 'prod_log' && rows.length && rows.every(r => r.source === 'daily-report' || r.source === 'template')) {
      // 일보 · ERP 양식: 같은 날짜 · 공정 · 출처 · 조 · 작업장의 행만 바꾼다 (다른 조 · 다른 층 · 직접 입력 · 누적 시트는 그대로).
      // 같은 날짜 · 공정의 누적 시트(history) 행이 있으면 기본은 그 일보 행을 건너뛰고, "일보로 바꾸기"(overlapMode 'replace')면 그날 누적 행을 지운다.
      let add = rows;
      if (job.overlapMode === 'replace') { const ks = new Set(rows.map(r => r.date + '|' + r.process)); const n0 = DB.rows(t).length; DB.t[t] = DB.rows(t).filter(r => !(r.source === 'history' && ks.has(r.date + '|' + r.process))); res.removed += n0 - DB.t[t].length; }
      else { const hk = new Set(DB.rows(t).filter(r => r.source === 'history').map(r => r.date + '|' + r.process)); add = rows.filter(r => !hk.has(r.date + '|' + r.process)); res.skipped = rows.length - add.length; }
      const key = (r) => [r.date, r.process, r.source, r.shift || 'D'].join('|');
      const ks = new Map(); add.forEach(r => { const k = key(r); let w = ks.get(k); if (!w) ks.set(k, w = new Set()); w.add(norm(r.workplace)); });
      const n0 = DB.rows(t).length;
      DB.t[t] = DB.rows(t).filter(r => { const w = ks.get(key(r)); if (!w) return true; const wp = norm(r.workplace); return !(w.has(wp) || !wp); });   // 작업장이 없는 예전(1.2.0) 행은 같은 일보로 본다
      res.removed += n0 - DB.t[t].length;
      DB.addMany(t, add); res.added = add.length;
    }
    else if (mode === 'range') {
      const ds = rows.map(r => r.date).filter(Boolean).sort(); if (ds.length) {
        const lo = ds[0], hi = ds[ds.length - 1];
        const keep = DB.rows(t).filter(r => !(r.date >= lo && r.date <= hi && (t !== 'prod_log' || !job.proc || r.process === job.proc) && (t !== 'movements' || !job.rows[0] || (r.from_proc || '') === (job.rows[0].from_proc || ''))));
        res.removed = DB.rows(t).length - keep.length; DB.t[t] = keep;
      }
      DB.addMany(t, rows); res.added = rows.length;
    }
    else if (mode === 'slip') { // replace same document numbers, add the rest
      const docs = new Set(rows.map(r => r.doc_no).filter(Boolean));
      const keep = DB.rows(t).filter(r => !(r.doc_no && docs.has(r.doc_no))); res.removed = DB.rows(t).length - keep.length; DB.t[t] = keep;
      // map customer item codes to warehouse codes
      const mats = new Set(DB.rows('materials').map(m => m.code)); const map = new Map(); DB.rows('inout').forEach(r => { if (r.item_code && r.wh_code && mats.has(r.wh_code)) map.set(r.item_code, r.wh_code); });
      let unm = 0; rows.forEach(r => { if (!mats.has(r.wh_code)) { const m = map.get(r.item_code); if (m) r.wh_code = m; else unm++; } });
      DB.addMany(t, rows); res.added = rows.length; res.unmapped = unm;
    }
    else if (mode === 'update') { // update existing only
      const idx = new Map(DB.rows(t).map(r => [String(r.code), r])); let u = 0;
      rows.forEach(r => { const e = idx.get(String(r.code)); if (e) { Object.assign(e, r); u++; } }); DB.touch(t); res.updated = u; res.skipped = rows.length - u;
    }
    else { const r2 = DB.upsert(t, rows); res.added = r2.added; res.updated = r2.updated; }
    return res;
  }
})();
