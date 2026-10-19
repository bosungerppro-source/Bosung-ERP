/* 6차 재고 엔진 (Inventory engine / Bộ máy tồn kho)
   · items       통합 품목 마스터 (ECOUNT 품목등록) — ERP CODE 로 단계·제품군·분류를 자동 분리
   · stock_open  기초재고 (ECOUNT 재고현황, 범위 WH=창고 / FAC=공장 별 기준일)
   · stock_tx    재고 수불 (입고 IN · 출고 OUT · 이동 MOVE · 조정 ADJ)
   · 생산 반영   생산일보(prod_log)에서 계산한다 (설정 prodPost: off / in / in_bom). 저장하지 않으므로 같은 일보를 다시 올려도 중복되지 않는다.
   현재고(범위별) = 기초재고 + 기준일 다음 날부터의 수불·생산 반영.  C.stock() 는 예전(원부자재) 화면·AI 비서와 같은 모양으로 돌려준다. */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, C = ERP.calc, F = ERP.fmt;
  const num = C.num;
  const INV = ERP.inv = {};
  /** local date-time 'YYYY-MM-DD HH:MM' (upload log) */
  F.now = F.now || (() => { const d = new Date(); return F.today() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); });
  const EPS = 1e-6;
  const str = (v) => (v === undefined || v === null ? '' : String(v)).trim();
  const up = (v) => str(v).toUpperCase();
  const normName = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  INV.normName = normName;
  const r4 = (x) => Math.round((+x || 0) * 10000) / 10000;

  // ------------------------------------------------------------------ ERP CODE dictionary (built-in; code_dict table overrides)
  // g: 'mat' = 자재 단계 (2번째 칸 = 분류), 그 외는 2번째 칸 = 제품군
  const STAGES = [
    { code: 'RM', ko: '원재료', vi: 'Nguyên vật liệu', g: 'mat', etype: '원재료' },
    { code: 'SM', ko: '부자재', vi: 'Vật liệu phụ', g: 'mat', etype: '부재료' },
    { code: 'CM', ko: '소모품', vi: 'Vật tư tiêu hao', g: 'mat', etype: '부재료', guessed: true },
    { code: 'WIP00', ko: '심 (리필)', vi: 'Lõi (refill)', proc: 'REF', etype: '반제품' },
    { code: 'WIP01', ko: '배럴', vi: 'Barrel', proc: 'INJ', etype: '반제품' },
    { code: 'WIP02', ko: '노즈콘', vi: 'Nose cone', proc: 'INJ', etype: '반제품' },
    { code: 'WIP03', ko: '홀더/플러그', vi: 'Holder/plug', proc: 'INJ', etype: '반제품' },
    { code: 'WIP04', ko: '스푼', vi: 'Spoon', proc: 'INJ', etype: '반제품' },
    { code: 'WIPx6', ko: '클릭펜 시스템·부품', vi: 'Hệ thống bút bấm', proc: 'INJ', etype: '반제품', guessed: true, note: 'WIP06 + WIP16·26·36·46·56' },
    { code: 'WIPx5', ko: '리필 컨테이너 부품', vi: 'Linh kiện hộp refill', proc: 'INJ', etype: '반제품', guessed: true, note: 'WIP15·25·35' },
    { code: 'WIP11', ko: '스탬핑 완료 배럴', vi: 'Barrel đã ép nhũ', proc: 'STP', etype: '반제품', guessed: true },
    { code: 'WIP55', ko: '클릭펜슬 조립품', vi: 'Bút bấm đã lắp', proc: 'ASM', etype: '반제품', guessed: true },
    { code: 'WIP', ko: '조립 완료', vi: 'Hoàn thành lắp ráp', proc: 'ASM', etype: '반제품' },
    { code: 'SG', ko: '마니라 포장 완료', vi: 'Đã đóng gói Manila', proc: 'PCK', etype: '반제품' },
    { code: 'FG', ko: '박스 포장 완료', vi: 'Đã đóng thùng (thành phẩm)', proc: 'PCK', etype: '제품' },
  ];
  const EXTRA_STAGES = [{ code: 'ETC', ko: '기타 (ERP CODE 없음)', vi: 'Khác (không có ERP CODE)' }, { code: 'TEST', ko: '테스트 품목', vi: 'Mã thử nghiệm' }];
  const LINES = [
    ['MINI', '미니', 'Mini'], ['REG', '레귤러', 'Regular'], ['PEN', '펜슬', 'Pencil'], ['CPC', '클릭펜슬', 'Click pencil'], ['GLA', '유리용', 'Glass'], ['MARKER', '마커', 'Marker'],
    ['GRA', 'GRA', 'GRA', 1], ['MIX', '혼합', 'Hỗn hợp', 1]];
  const SUBS = [['SUP', '스매쉬업', 'Smash Up'], ['SIL', '실리', 'Silly Scents'], ['NEON', '네온', 'Neon', 1], ['PAS', '파스텔', 'Pastel', 1], ['CLA', '클래식', 'Classic', 1],
    ['CRA', '크레욜라', 'Crayola', 1], ['HF', '핫포일', 'Hot foil', 1], ['RB', '레인보우', 'Rainbow', 1], ['BRR', '배럴', 'Barrel', 1], ['BARREL', '배럴', 'Barrel', 1], ['NCONE', '노즈콘', 'Nose cone', 1],
    ['SP', '스푼', 'Spoon', 1], ['HD', '홀더', 'Holder', 1], ['ASSY', '조립품', 'Lắp ráp', 1], ['SYS', '시스템', 'Hệ thống', 1], ['PBAG', '비닐백', 'Túi nhựa', 1]];
  const CATS = [
    ['RM', 'SCOIL', '향기오일', 'Tinh dầu mùi hương'], ['RM', 'PIG', '안료', 'Sắc tố / Bột màu'], ['RM', 'WAX', '왁스', 'Sáp'], ['RM', 'CHE', '화학물질', 'Hóa chất'], ['RM', 'OC', '유기화학물', 'Chất hữu cơ'],
    ['RM', 'IC', '무기화학물', 'Chất vô cơ'], ['RM', 'EP', '엔지니어링 플라스틱', 'Nhựa kỹ thuật'], ['RM', 'OIL', '오일', 'Dầu', 1],
    ['SM', 'SL', '슬리브/칸막이', 'Vỏ bọc / Tấm ngăn'], ['SM', 'CT', '박스', 'Hộp / Thùng carton'], ['SM', 'PCASE', '플라스틱 케이스', 'Hộp nhựa / Khay nhựa'], ['SM', 'MNA', '마니라', 'Manila'],
    ['SM', 'SRP', '리드트레이 박스', 'Hộp khay đựng'], ['SM', 'INR', '인너박스', 'Hộp bên trong'], ['SM', 'PAP', '종이', 'Giấy'], ['SM', 'PVC', 'PVC 포장지', 'Màng bọc PVC'],
    ['SM', 'PAPER', '종이', 'Giấy', 1], ['SM', 'SRT', '트레이/후드', 'Khay / nắp', 1], ['SM', 'LB', '라벨', 'Nhãn', 1], ['SM', 'BLISTER', '블리스터', 'Vỉ nhựa', 1], ['SM', 'PAD', '패드', 'Miếng đệm', 1],
    ['SM', 'CDU', '진열대 (CDU)', 'Kệ trưng bày', 1], ['SM', 'MANILA', '마니라', 'Manila', 1],
    ['CM', 'LB', '라벨', 'Nhãn', 1], ['CM', 'PET', 'PET 필름', 'Màng PET', 1], ['CM', 'HOTFOIL', '핫포일', 'Nhũ ép nóng', 1], ['CM', 'INMAY', '인쇄 잉크/용제', 'Mực in / dung môi', 1],
    ['CM', 'GLUE', '접착제', 'Keo', 1], ['CM', 'TAPE', '테이프', 'Băng keo', 1], ['CM', 'FILM', '필름', 'Màng', 1], ['CM', 'POF', '수축필름 (POF)', 'Màng co POF', 1], ['CM', 'FOIL', '포일', 'Giấy bạc', 1], ['CM', 'TP', '스티커', 'Decal', 1]];

  const BUILTIN = (() => {
    const rows = [];
    STAGES.concat(EXTRA_STAGES).forEach((s, i) => rows.push({ level: 'stage', code: s.code, ko: s.ko, vi: s.vi, order: i + 1, guessed: !!s.guessed }));
    LINES.forEach((l, i) => rows.push({ level: 'line', code: l[0], ko: l[1], vi: l[2], order: i + 1, guessed: !!l[3] }));
    SUBS.forEach((l, i) => rows.push({ level: 'sub', code: l[0], ko: l[1], vi: l[2], order: i + 1, guessed: !!l[3] }));
    CATS.forEach((c, i) => rows.push({ level: 'cat', code: c[1], parent: c[0], ko: c[2], vi: c[3], order: i + 1, guessed: !!c[4] }));
    return rows;
  })();
  INV.BUILTIN_DICT = BUILTIN;
  INV.STAGES = STAGES; INV.EXTRA_STAGES = EXTRA_STAGES;
  const STAGE_IDX = new Map(STAGES.concat(EXTRA_STAGES).map(s => [s.code, s]));
  const LINE_SET = new Set(LINES.map(l => l[0]));

  /** merged dictionary: built-in + code_dict table (table wins). key = level|parent|code */
  INV.dict = () => DB.memo('inv.dict', ['code_dict'], () => {
    const m = new Map(); const key = (r) => r.level + '|' + (r.level === 'cat' ? (r.parent || '') : '') + '|' + up(r.code);
    BUILTIN.forEach(r => m.set(key(r), Object.assign({}, r)));
    DB.rows('code_dict').forEach(r => { if (!r.level || !r.code) return; const k = key(r); m.set(k, Object.assign({}, m.get(k) || {}, r)); });
    const lines = new Set(LINE_SET); m.forEach(r => { if (r.level === 'line') lines.add(up(r.code)); });
    return { m, lines };
  });
  /** label of a code: level = stage | line | sub | cat (cat needs parent stage) */
  INV.label = function (level, code, parent) {
    if (!code) return ''; const D = INV.dict().m;
    const r = D.get(level + '|' + (level === 'cat' ? (parent || '') : '') + '|' + up(code)) || (level === 'cat' ? Array.from(D.values()).find(x => x.level === 'cat' && up(x.code) === up(code)) : null);
    if (!r) return code;
    const t = ERP.lang === 'vi' ? (r.vi || r.ko) : (r.ko || r.vi); return t || code;
  };
  /** short label for chips / cards: a long dictionary name (e.g. "반제품 펜조립 완료상태") falls back to the built-in short name; the full name stays in tooltips */
  const BUILTIN_IDX = new Map(BUILTIN.map(r => [r.level + '|' + (r.level === 'cat' ? (r.parent || '') : '') + '|' + r.code, r]));
  INV.labelShort = function (level, code, parent) {
    const full = INV.label(level, code, parent); const max = ERP.lang === 'vi' ? 20 : 9;
    if (String(full).length <= max) return full;
    const b = BUILTIN_IDX.get(level + '|' + (level === 'cat' ? (parent || '') : '') + '|' + up(code)) || (level === 'cat' ? BUILTIN.find(r => r.level === 'cat' && r.code === up(code)) : null);
    if (b) { const t = ERP.lang === 'vi' ? (b.vi || b.ko) : (b.ko || b.vi); if (t && t.length < String(full).length) return t; }
    return full;
  };
  INV.isGuessed = (level, code, parent) => { const r = INV.dict().m.get(level + '|' + (level === 'cat' ? (parent || '') : '') + '|' + up(code)); return !!(r && r.guessed); };
  INV.stageList = () => STAGES.map(s => s.code);
  INV.stageInfo = (code) => STAGE_IDX.get(code) || STAGE_IDX.get('ETC');
  INV.stageName = (code) => INV.label('stage', code);

  // ------------------------------------------------------------------ ERP CODE parser
  function stageOf(seg1) {
    const s = up(seg1); if (!s) return 'ETC';
    if (STAGE_IDX.has(s) && s !== 'WIPx6' && s !== 'WIPx5') return s;
    if (/^WIP[0-9]6$/.test(s)) return 'WIPx6';
    if (/^WIP[1-9]5$/.test(s)) return 'WIPx5';      // WIP55 is matched exactly above
    if (s === 'FD') return 'FG';                     // 접두어 FD- 는 FG 오타로 본다 (자료 점검에 표시)
    if (/^T(\d+|T\d*|CT)$/.test(s)) return 'TEST';
    return 'ETC';
  }
  /** "SM-MNA-MINI-52-0708" -> {stage:'SM', cat:'MNA', line:'MINI', sub:''} */
  INV.parse = function (erp, itemCode) {
    const raw = str(erp); if (!raw) return { stage: 'ETC', line: '', sub: '', cat: '', segs: [] };
    const segs = raw.split('-').map(x => x.trim());
    const stage = stageOf(segs[0]);
    if (stage === 'TEST') return { stage, line: '', sub: '', cat: '', segs };
    const lines = INV.dict().lines; const s2 = up(segs[1]), s3 = up(segs[2]);
    const info = STAGE_IDX.get(stage) || {};
    let line = '', sub = '', cat = '';
    if (info.g === 'mat') {
      if (lines.has(s2)) { line = s2; cat = s3; } else { cat = s2; if (lines.has(s3)) line = s3; else sub = s3; }
    } else { line = s2; sub = s3; }
    // the remaining segments are normally the item code itself; a short code is not a sub-type
    if (itemCode && sub && up(itemCode).startsWith(sub) && sub.length >= 2 && /\d/.test(sub)) sub = '';
    return { stage, line, sub, cat, segs };
  };
  const TYPE_STAGE = { RAW: 'RM', PACK: 'SM', PART: 'WIP01', SEMI: 'WIP', FG: 'FG' };
  /** parsed info for an item row (uses stored fields first) */
  INV.info = function (m) {
    if (!m) return { stage: 'ETC', line: '', sub: '', cat: '' };
    if (m.stage) return { stage: m.stage, line: m.line || '', sub: m.sub || '', cat: m.cat || '' };
    if (m.erp_code) return INV.parse(m.erp_code, m.code);
    return { stage: TYPE_STAGE[m.type] || 'ETC', line: '', sub: '', cat: '' };
  };
  /** fill stage/line/sub/cat of an item row from its ERP CODE (mutates) */
  INV.classify = function (m) {
    const p = m.erp_code ? INV.parse(m.erp_code, m.code) : { stage: TYPE_STAGE[m.type] || 'ETC', line: '', sub: '', cat: '' };
    m.stage = p.stage; m.line = p.line || undefined; m.sub = p.sub || undefined; m.cat = p.cat || undefined;
    if (p.stage === 'TEST' && m.hidden === undefined) m.hidden = true;
    return m;
  };

  // ------------------------------------------------------------------ units / scopes
  INV.unitN = function (u) { const x = up(u); if (!x) return ''; if (x === 'KG' || x === 'KGS') return 'kg'; if (x === 'PCS' || x === 'PC' || x === 'EA' || x === 'CÁI') return 'PCS'; return x; };
  INV.unitShow = (u) => INV.unitN(u) || '';
  INV.scopeOf = function (v) {
    const s = String(v === undefined || v === null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').replace(/đ/gi, 'd').toLowerCase().trim();
    if (!s) return null;
    if (s === 'wh' || /창고|^kho|warehouse/.test(s)) return 'WH';
    if (s === 'fac' || /공장|xuong|san xuat|factory|^sx|production|외주|gia cong/.test(s)) return 'FAC';
    return null;
  };
  INV.kindOf = function (v) {
    const s = String(v === undefined || v === null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').replace(/đ/gi, 'd').toLowerCase().trim();
    if (!s) return null;
    if (/^(in|입고|nhap|nhap kho|receive)$/.test(s) || /입고|^nhap/.test(s)) return 'IN';
    if (/^(out|출고|xuat|xuat kho|ship)$/.test(s) || /출고|출하|^xuat/.test(s)) return 'OUT';
    if (/^(move|이동|chuyen|chuyen kho|transfer)$/.test(s) || /이동|chuyen/.test(s)) return 'MOVE';
    if (/^(adj|조정|dieu chinh|adjust)$/.test(s) || /조정|dieu chinh|실사/.test(s)) return 'ADJ';
    return null;
  };

  // ------------------------------------------------------------------ lookups
  INV.items = () => DB.memo('inv.items', ['items'], () => {
    const m = new Map(), u = new Map();
    DB.rows('items').forEach(r => { const c = str(r.code); if (!c) return; m.set(c, r); if (!u.has(c.toUpperCase())) u.set(c.toUpperCase(), r); });
    return { m, u, get: (c) => { const k = str(c); return m.get(k) || u.get(k.toUpperCase()) || null; } };
  });
  INV.item = (c) => INV.items().get(c);
  /** RM items by normalized name (for recipe materials) */
  INV.rmByName = () => DB.memo('inv.rmByName', ['items', 'materials'], () => {
    const m = new Map();
    DB.rows('items').forEach(r => { const st = INV.info(r).stage; if (st !== 'RM') return; const k = normName(r.name); if (k && !m.has(k)) m.set(k, r); });
    // legacy material master names (EN/VN/KR) -> item with the same code
    const IT = INV.items();
    DB.rows('materials').forEach(r => { const it = IT.get(r.code); if (!it) return; [r.name_en, r.name_vn, r.name_kr].forEach(n => { const k = normName(n); if (k && !m.has(k)) m.set(k, it); }); });
    return m;
  });

  const openRows = () => DB.memo('inv.open', ['stock_open'], () => {
    const by = { WH: new Map(), FAC: new Map() }, date = { WH: null, FAC: null }, n = { WH: 0, FAC: 0 };
    DB.rows('stock_open').forEach(r => {
      const sc = r.scope === 'FAC' ? 'FAC' : 'WH'; const c = str(r.code); if (!c) return;
      const o = by[sc].get(c) || { qty: 0, sets: null, pcs: null, unit: r.unit, name: r.name };
      o.qty += num(r.qty);
      if (r.sets !== undefined && r.sets !== null && r.sets !== '') o.sets = (o.sets || 0) + num(r.sets);
      if (r.pcs !== undefined && r.pcs !== null && r.pcs !== '') o.pcs = (o.pcs || 0) + num(r.pcs);
      by[sc].set(c, o); n[sc]++;
      if (r.date && (!date[sc] || r.date > date[sc])) date[sc] = r.date;
    });
    return { by, max: date, n };
  });
  /** 기초재고: 범위별 수량 + 기준일. 기준일은 설정(meta.openDate, 기초재고를 올릴 때 저장)이 이기고, 없으면 행 날짜의 최댓값 —
      행 하나를 나중 날짜로 더하거나 고쳐도 그 범위 전체의 기준일이 바뀌지 않는다 */
  INV.opening = () => { const o = openRows(); const md = DB.meta.openDate || {}; return { by: o.by, n: o.n, max: o.max, date: { WH: md.WH || o.max.WH, FAC: md.FAC || o.max.FAC } }; };
  /** 이동 전표 등 자동 수불의 날짜: 오늘 — 단, 오늘이 기초재고 기준일 이전 · 당일이면 기준일 다음 날 (기준일 당일 수불은 기초재고에 들어 있다고 보므로) */
  INV.suggestDate = () => { const od = INV.openDates(); const t = F.today(); return !od.any || t > od.any ? t : F.addDays(od.any, 1); };
  /** 계산 캐시 키에 넣는 값: 기초재고 기준일 · 공정 단위 (설정만 바뀌어도 다시 계산되게) */
  const calcSig = () => { const d = INV.opening().date; return (d.WH || '') + '/' + (d.FAC || '') + '|' + ERP.PROC.map(p => p.id + ':' + (p.unit || '')).join(','); };
  /** {WH, FAC, any, all} opening dates */
  INV.openDates = () => { const d = INV.opening().date; const arr = [d.WH, d.FAC].filter(Boolean).sort(); return { WH: d.WH, FAC: d.FAC, any: arr.length ? arr[arr.length - 1] : null, first: arr[0] || null }; };

  // ------------------------------------------------------------------ transaction effects
  /** signed effects of one transaction on the scopes: [[scope, qty], ...] */
  INV.effects = function (t) {
    const q = num(t.qty); const o = [];
    switch (t.kind) {
      case 'IN': o.push([t.to_scope || 'WH', q]); break;
      case 'PROD': o.push([t.to_scope || 'FAC', q]); break;
      case 'OUT': o.push([t.from_scope || 'WH', -q]); break;
      case 'USE': o.push([t.from_scope || 'FAC', -q]); break;
      case 'MOVE': o.push([t.from_scope || 'WH', -q]); o.push([t.to_scope || (t.from_scope === 'FAC' ? 'WH' : 'FAC'), q]); break;
      case 'ADJ': o.push([t.to_scope || t.from_scope || 'WH', q]); break;
      default: break;
    }
    return o;
  };
  /** does a dated effect on `scope` count after the opening stock? (same-day rows are part of the opening) */
  const counts = (date, scope, od) => { const d = od[scope]; return !d || !date || date > d; };
  INV.countsAfterOpen = (date, scope) => counts(date, scope, INV.opening().date);

  // ------------------------------------------------------------------ 7차: 원부자재 / 생산현장 구분
  const MAT_STAGES = new Set(['RM', 'SM', 'CM']);
  /** 'mat' = 원부자재 (RM·SM·CM, 코드 없는 원재료·부재료) · 'floor' = 생산현장 (반제품·완제품) · 'test' */
  INV.groupOf = function (s) {
    const st = s && s.stage; if (MAT_STAGES.has(st)) return 'mat'; if (st === 'TEST') return 'test';
    if (st === 'ETC') { const m = s.m || s; const et = str(m && m.etype).replace(/[[\]]/g, ''); return /원재료|부재료|원자재|소모품/.test(et) ? 'mat' : 'floor'; }
    return 'floor';
  };
  INV.MAT_STAGES = ['RM', 'SM', 'CM'];
  INV.FLOOR_STAGES = ['WIP00', 'WIP01', 'WIP02', 'WIP03', 'WIP04', 'WIPx6', 'WIPx5', 'WIP11', 'WIP55', 'WIP', 'SG', 'FG'];

  // ------------------------------------------------------------------ 7차: 코드 연결 (생산일보 코드 · 원료 이름 → ECOUNT 품목코드)
  const mk3 = (proc, div, src) => up(proc) + '|' + normName(div) + '|' + normName(src);
  INV.codeMap = () => DB.memo('inv.codeMap', ['code_map'], () => {
    const daily = new Map(), raw = new Map();
    DB.rows('code_map').forEach(r => { if (!str(r.src) || !str(r.item)) return; if (r.kind === 'raw') raw.set(normName(r.src), str(r.item)); else daily.set(mk3(r.proc, r.div, r.src), str(r.item)); });
    return {
      n: daily.size + raw.size,
      daily: (proc, div, src) => daily.get(mk3(proc, div, src)) || daily.get(mk3(proc, '', src)) || daily.get(mk3('', div, src)) || daily.get(mk3('', '', src)) || null,
      raw: (name) => raw.get(normName(name)) || null,
    };
  });
  /** ERP 품목군(일보 division) → ERP CODE 제품군 */
  INV.lineOfDiv = function (div) {
    const d = normName(div);
    if (!d) return ''; if (/^MINI/.test(d)) return 'MINI'; if (/^(PENCIL|PEN|LEAD)$/.test(d) || d === 'PEEL') return 'PEN'; if (/^(DIAL|REGULAR|REG|BIC|FREEDOM|FD)/.test(d)) return 'REG';
    if (/^(CLICK|CPCL|CPLEAD|CP)/.test(d)) return 'CPC'; if (/^GLASS/.test(d)) return 'GLA'; if (/^MARKER/.test(d)) return 'MARKER'; return '';
  };
  const digits = (c) => String(c || '').replace(/\D/g, '');
  /** how close two item codes are by their digits (shared tail + same leading series digit) */
  function digitScore(a, b) {
    const x = digits(a), y = digits(b); if (!x || !y) return 0;
    let k = 0; while (k < x.length && k < y.length && x[x.length - 1 - k] === y[y.length - 1 - k]) k++;
    const lead = x.replace(/^0+/, '')[0]; return Math.min(k, 3) + (lead && y[0] === lead ? 1 : 0);
  }
  INV.digitScore = digitScore;
  /** items grouped by stage|line (for suggestions and the assembly BOM builder) */
  const byStageLine = () => DB.memo('inv.bySL', ['items', 'code_dict'], () => {
    const m = new Map(); DB.rows('items').forEach(r => { if (r.hidden) return; const inf = INV.info(r); const k = inf.stage + '|' + (inf.line || ''); let a = m.get(k); if (!a) m.set(k, a = []); a.push(r); }); return m;
  });
  const toks = (v) => String(v || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^A-Z0-9]+/).filter(t => t.length >= 2);
  const LINE_WORD = { MINI: 'MINI', PEN: 'PENCIL', REG: 'REGULAR', CPC: 'CLICK', GLA: 'GLASS', MARKER: 'MARKER' };
  /** pick the best item of the given stages within a product line for a part/colour name. returns {code, name, conf:'high'|'review'|'none', how, cands} */
  function pickPart(stages, line, name, sub, ref, shared) {
    const SL = byStageLine(); const nn = normName(name);
    for (const stg of stages) {
      const c = SL.get(stg + '|' + line) || []; if (!c.length) continue;
      const same = nn ? c.filter(x => normName(x.name) === nn) : [];
      if (same.length) {
        const sc = same.map(x => [x, digitScore(ref, x.code) + (sub && up(INV.info(x).sub) === up(sub) ? 1 : 0)]).sort((a, b) => b[1] - a[1]);
        const best = sc[0]; const tie = sc.length > 1 && sc[1][1] === best[1];
        return { code: best[0].code, name: best[0].name, conf: tie ? 'review' : 'high', how: same.length === 1 ? 'name' : 'name+code', cands: sc.slice(0, 6).map(x => x[0].code) };
      }
    }
    // a single (shared) part for the whole product line, e.g. MINI HOLDER, MINI SPOON
    for (const stg of stages) { const c = (SL.get(stg + '|' + line) || []); if (c.length === 1) return { code: c[0].code, name: c[0].name, conf: 'high', how: 'shared', cands: [c[0].code] }; }
    // several parts in the line, one of them named after the line ("PENCIL HOLDER")
    for (const stg of stages) { const c = (SL.get(stg + '|' + line) || []); const w = LINE_WORD[line]; if (c.length > 1 && w) { const hit = c.filter(x => toks(x.name).includes(w)); if (hit.length === 1) return { code: hit[0].code, name: hit[0].name, conf: shared ? 'high' : 'review', how: 'line-name', cands: c.slice(0, 6).map(x => x.code) }; } }
    const pool = stages.flatMap(stg => SL.get(stg + '|' + line) || []);
    if (!pool.length) return null;   // this product line has no such part at all
    const sc = pool.map(x => [x, digitScore(ref, x.code)]).filter(x => x[1] >= 3).sort((a, b) => b[1] - a[1]);
    return { code: '', name: '', conf: 'none', how: 'none', cands: sc.slice(0, 6).map(x => x[0].code) };
  }
  INV.pickPart = pickPart;
  const PART_OF_INJ = { BARREL: 'WIP01', NOSECONE: 'WIP02', NOSE: 'WIP02', HOLDER: 'WIP03', PLUG: 'WIP03', SPOON: 'WIP04' };
  /** suggestions for a daily-report code that is not an item code */
  INV.suggestDaily = function (proc, div, src, name, remark) {
    const out = []; const add = (r, conf, how) => { if (r && r.code && !out.some(x => x.code === r.code)) out.push({ code: r.code, name: r.name, conf, how }); };
    const line = INV.lineOfDiv(div); const IT = INV.items();
    // the report remark "BM:BM01012" names the assembled pen → its line / sub
    const pm = String(remark || '').match(/BM\s*:\s*([A-Z0-9-]+)/i); const parent = pm ? IT.get(pm[1]) : null; const pinf = parent ? INV.info(parent) : null;
    if (proc === 'REF') { const p = pickPart(['WIP00'], (pinf && pinf.line) || line, name, pinf && pinf.sub, src); if (p && p.code) add(IT.get(p.code), p.conf, p.how); if (p && p.cands) p.cands.forEach(c => add(IT.get(c), 'review', 'code')); }
    else if (proc === 'INJ') { const stg = PART_OF_INJ[normName(src)]; if (stg) { const c = byStageLine().get(stg + '|' + line) || []; const w = LINE_WORD[line]; const named = w ? c.filter(x => toks(x.name).includes(w)) : [];
      if (c.length === 1) add(c[0], 'high', 'shared'); else if (named.length === 1) add(named[0], stg === 'WIP03' || stg === 'WIP04' ? 'high' : 'review', 'line-name'); c.slice(0, 5).forEach(x => add(x, 'review', 'line')); } }
    else if (proc === 'STP') { const p = pickPart(['WIP11'], line, name, '', src); if (p && p.code) add(IT.get(p.code), p.conf, p.how); }
    else if (proc === 'ASM' || proc === 'WRP') { const p = pickPart(['WIP', 'WIP55'], line, name, '', src); if (p && p.code) add(IT.get(p.code), p.conf === 'high' ? 'review' : p.conf, p.how); }
    else if (proc === 'PCK') { const k = normName(src); DB.rows('items').forEach(r => { const st = INV.info(r).stage; if ((st === 'SG' || st === 'FG') && k.length >= 4 && normName(r.erp_code).includes(k)) add(r, 'review', 'erp'); }); }
    INV.search(src, 4).forEach(r => add(r, 'review', 'search'));
    if (name && name !== src) INV.search(name, 3).forEach(r => add(r, 'review', 'search'));
    return out.slice(0, 6);
  };
  const RAW_SYN = { PP: ['POLYPROPYLENE', 'PP'], HDPE: ['HDPE', 'HIGHDENSITY'], LDPE: ['LDPE', 'LOWDENSITY'], GPPS: ['GPPS', 'POLYSTYRENE'], ABS: ['ABS'], PS: ['POLYSTYRENE'], PE: ['POLYETHYLENE'], PVC: ['PVC'] };
  /** suggestions for a raw-material name (recipe material / injection resin): synonyms, shared words, word starts */
  INV.suggestRaw = function (name) {
    const k = normName(name); if (!k) return [];
    const rm = DB.rows('items').filter(r => !r.hidden && INV.info(r).stage === 'RM');
    const syn = RAW_SYN[k]; const qt = Array.from(new Set(toks(name)));
    const sc = rm.map(r => {
      const rt = toks(r.name); let v = 0;
      if (normName(r.code) === k) v += 6;
      if (syn && syn.some(w => (w.length <= 4 ? rt.includes(w) : normName(r.name).includes(w)))) v += 5;
      qt.forEach(t => { if (rt.includes(t)) v += t.length >= 4 ? 2 : 1; else if (t.length >= 5 && rt.some(x => x.length >= 5 && x.slice(0, 5) === t.slice(0, 5))) v += 1; });
      return [r, v];
    }).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
    if (!sc.length) return [];
    const top = sc[0][1]; const unique = sc.length === 1 || sc[1][1] < top;
    return sc.slice(0, 6).map((x, i) => ({ code: x[0].code, name: x[0].name, conf: i === 0 && unique && top >= 5 ? 'high' : 'review', how: 'name' }));
  };

  // ------------------------------------------------------------------ 7차: 조립 · 스탬핑 BOM 자동 구성 (ECOUNT 품목코드로)
  const ROLES = [
    { role: 'refill', st: ['WIP00'], old: 'refill_code', ko: '심 (리필)', vi: 'Lõi' }, { role: 'barrel', st: ['WIP11', 'WIP01'], old: 'barrel_code', ko: '배럴', vi: 'Barrel' },
    { role: 'nose', st: ['WIP02'], old: 'nose_code', ko: '노즈콘', vi: 'Nose cone' }, { role: 'holder', st: ['WIP03'], old: 'holder', ko: '홀더', vi: 'Holder' }, { role: 'spoon', st: ['WIP04'], old: 'spoon', ko: '스푼', vi: 'Spoon' }];
  const STP_ROLES = [{ role: 'barrel', st: ['WIP01'], ko: '배럴 (스탬핑 전)', vi: 'Barrel (trước ép nhũ)' }];
  INV.ASM_ROLES = ROLES; INV.STP_ROLES = STP_ROLES;
  INV.roleName = (role, stp) => { const r = (stp ? STP_ROLES : ROLES).find(x => x.role === role) || ROLES.find(x => x.role === role); return r ? L(r.ko, r.vi) : role; };
  /** proposals for every assembled pen (WIP · WIP55) and stamped barrel (WIP11). Existing BOM lines are reported, never overwritten here. */
  INV.asmPlan = () => DB.memo('inv.asmPlan', ['items', 'bom', 'bom_lines', 'code_dict'], () => {
    const old = new Map(); DB.rows('bom').forEach(b => { const c = up(b.color_code); if (c && !old.has(c)) old.set(c, b); });
    const have = new Map(); DB.rows('bom_lines').forEach(l => { const p = str(l.parent); if (!p) return; let a = have.get(p); if (!a) have.set(p, a = []); a.push(l); });
    const out = [];
    DB.rows('items').forEach(m => {
      if (m.hidden) return; const inf = INV.info(m); const stp = inf.stage === 'WIP11'; if (!(inf.stage === 'WIP' || inf.stage === 'WIP55' || stp)) return;
      const ob = old.get(up(m.code)); const parts = [];
      (stp ? STP_ROLES : ROLES).forEach(R => {
        if (ob && R.old && !str(ob[R.old])) return;   // the example BOM says this pen has no such part
        const pk = pickPart(R.st, inf.line, m.name, inf.sub, m.code, R.role === 'holder' || R.role === 'spoon'); if (!pk) return;
        parts.push(Object.assign({ role: R.role }, pk));
      });
      const ex = have.get(m.code) || [];
      const conf = !parts.length ? 'none' : parts.every(p => p.conf === 'high') ? 'high' : parts.some(p => p.conf === 'high') ? 'part' : (parts.some(p => p.conf === 'review') ? 'review' : 'none');
      out.push({ parent: m.code, name: m.name, stage: inf.stage, line: inf.line, sub: inf.sub, stp, parts, conf, existing: ex.length, auto: ex.length > 0 && ex.every(l => l.src === 'auto') });
    });
    return out;
  });
  /** write the proposals of the given parents into bom_lines (src 'auto'). onlyHigh: skip parts that need review. Manual BOMs are kept unless force. */
  INV.applyAsm = function (parents, opt) {
    opt = opt || {}; const plan = new Map(INV.asmPlan().map(x => [x.parent, x])); const pick = opt.pick || {};
    const lines = DB.rows('bom_lines'); const drop = []; const add = []; let done = 0, skipped = 0;
    parents.forEach(pc => {
      const x = plan.get(pc); if (!x) return;
      const cur = lines.filter(l => str(l.parent) === pc);
      if (cur.some(l => l.src !== 'auto') && !opt.force) { skipped++; return; }
      const kids = x.parts.map(p => ({ role: p.role, code: pick[pc + '|' + p.role] !== undefined ? pick[pc + '|' + p.role] : ((p.conf === 'high' || (!opt.onlyHigh && p.conf === 'review')) ? p.code : '') })).filter(k => k.code);
      if (!kids.length) { skipped++; return; }
      cur.forEach(l => drop.push(l._id));
      kids.forEach(k => add.push({ parent: pc, child: k.code, qty: 1, src: 'auto', note: INV.roleName(k.role, x.stp) }));
      done++;
    });
    if (drop.length) DB.remove('bom_lines', drop);
    if (add.length) DB.addMany('bom_lines', add);
    return { done, skipped, lines: add.length };
  };

  // ------------------------------------------------------------------ production postings (computed from prod_log)
  INV.prodMode = () => { const v = DB.setting('prodPost', 'in_bom'); return v === 'off' || v === 'in' ? v : 'in_bom'; };
  INV.PROD_MODES = () => [{ v: 'in_bom', label: L('생산량 입고 + BOM 자재 차감', 'Nhập SX + trừ vật tư theo BOM') }, { v: 'in', label: L('생산량만 입고', 'Chỉ nhập sản lượng') }, { v: 'off', label: L('반영 안 함', 'Không cập nhật') }];

  function bomIndex() {
    return DB.memo('inv.bomIdx', ['bom', 'bom_lines', 'recipes', 'products'], () => {
      const byColor = new Map(), byRefill = new Map(), byRetail = new Map(), lines = new Map(), rec = new Map(), prod = new Map();
      DB.rows('bom').forEach(b => {
        const cc = up(b.color_code); if (cc && !byColor.has(cc)) byColor.set(cc, b);
        const rf = up(b.refill_code); if (rf && !byRefill.has(rf)) byRefill.set(rf, b);
        const rt = str(b.retail_no); if (rt) { let a = byRetail.get(rt); if (!a) byRetail.set(rt, a = []); a.push(b); }
      });
      DB.rows('products').forEach(p => { const c = up(p.code); if (c && !prod.has(c)) prod.set(c, p); });
      DB.rows('bom_lines').forEach(l => { const p = str(l.parent); if (!p) return; let a = lines.get(p); if (!a) lines.set(p, a = []); a.push(l); });
      DB.rows('recipes').forEach(r => { const c = up(r.code); let a = rec.get(c); if (!a) rec.set(c, a = []); a.push(r); });
      return { byColor, byRefill, byRetail, lines, rec, prod };
    });
  }
  /** one-level components of an item for a production row. kids: [{code, per, basis:'main'|'pcs'|'set', raw?}] */
  function bomOf(item, proc, diag) {
    const B = bomIndex(); const code = item.code; const C0 = up(code); const st = INV.info(item).stage;
    const custom = B.lines.get(code) || B.lines.get(C0);
    if (custom && custom.length) return { src: 'custom', kids: custom.map(l => ({ code: str(l.child), per: num(l.qty || 1) * (1 + num(l.loss) / 100), basis: 'main' })) };
    // assembled pen (color code) -> parts
    const b = B.byColor.get(C0); const p = B.prod.get(C0);
    if ((proc === 'ASM' || proc === 'WRP' || st === 'WIP' || st === 'WIP55') && (b || p)) {
      const src = b || p; const parts = b ? [b.nose_code, b.refill_code, b.barrel_code, b.holder, b.spoon] : [p.nose_code, p.refill_code, p.barrel_code];
      return { src: 'color', kids: parts.filter(Boolean).map(x => ({ code: str(x), per: 1, basis: 'pcs' })), ref: src.color_code || src.code };
    }
    // refill (core) -> recipe of its color
    if (proc === 'REF' || st === 'WIP00') {
      const rb = B.byRefill.get(C0); const rr = rb ? (B.rec.get(up(rb.color_code)) || []) : [];
      if (rr.length) return { src: 'recipe', kids: rr.map(r => ({ raw: r.material, per: num(r.coef) / 1000, basis: 'pcs' })), ref: rb.color_code };
    }
    // finished / manila-packed item -> one pencil of every colour per set
    if (proc === 'PCK' || st === 'FG' || st === 'SG') {
      let rows = B.byRetail.get(code), alt = null;
      if (!rows && ERP.bomFor) { const bf = ERP.bomFor(code); rows = bf.rows; if (rows && rows.length && bf.key && bf.key !== code) alt = bf.key; }
      rows = rows || [];
      if (rows.length) {
        if (alt && diag) { diag.similar = diag.similar || new Map(); diag.similar.set(code, alt); }   // 같은 품번 BOM 이 없어 비슷한 품번의 색상 구성을 썼다 (진단에 표시)
        return { src: alt ? 'retail-similar' : 'retail', kids: rows.map(r => ({ code: str(r.color_code), per: 1, basis: 'set' })), ref: alt || undefined };
      }
    }
    return null;
  }

  /** compute postings for prod_log-like rows. returns {rows, diag}. rows: stock_tx-like objects with kind PROD / USE */
  INV.postRows = function (prodRows, opt) {
    opt = opt || {};
    const mode = opt.mode || INV.prodMode(); const od = INV.opening().date; const IT = INV.items(); const rmBy = INV.rmByName(); const MAP = INV.codeMap();
    const diag = { mode, open: od.FAC || od.WH || null, considered: 0, before: 0, prod: 0, use: 0, mapped: 0, resin: 0, notItem: new Map(), noBom: new Map(), noConv: new Map(), missingPart: new Map(), rawUnmatched: new Map(), similar: new Map(), bomSrc: {} };
    // 원료 이름 → RM 품목: 사용자가 연결한 것(code_map raw)이 먼저, 그다음 이름이 같은 RM
    const rawItem = (name) => { const c = MAP.raw(name); const a = c ? IT.get(c) : null; return a || rmBy.get(normName(name)) || null; };
    const out = [];
    if (mode === 'off') return { rows: out, diag };
    const openDate = od.FAC || od.WH;
    if (!openDate) { diag.noOpen = true; return { rows: out, diag }; }
    const bump = (m, k, q) => { const o = m.get(k) || { n: 0, qty: 0 }; o.n++; o.qty += q || 0; m.set(k, o); };
    const procOf = (id) => ERP.PROC.find(x => x.id === id);
    (prodRows || []).forEach(r => {
      if (!r || !r.date) return;
      if (r.date <= openDate) { diag.before++; return; }
      diag.considered++;
      // 재고 품목: 일보의 재고 품목코드(item, 예: 포장 일보의 완제품 코드) → 코드 → 코드 연결(code_map)
      const code = str(r.code); let item = (str(r.item) && IT.get(r.item)) || (code ? IT.get(code) : null);
      const src = code || str(r.part) || str(r.name);
      if (!item && src) { const mc = MAP.daily(r.process, r.division, src); if (mc) { item = IT.get(mc); if (item) diag.mapped++; } }
      const pcs = C.qty(r); const P = procOf(r.process); const setProc = r.process === 'PCK' || (P && P.unit === 'set');
      const base0 = { date: r.date, scope: 'FAC', proc: r.process, ref: r._id, src: 'daily:' + (r.process || '') + ':' + r.date };
      // injection: the resin weight written on the report is used up (unless the part has its own BOM)
      const resin = () => {
        if (mode !== 'in_bom' || r.process !== 'INJ' || !str(r.raw_material) || !(num(r.raw_kg) > 0)) return;
        if (item && bomIndex().lines.get(item.code)) return;
        const rm = rawItem(r.raw_material); if (!rm) { bump(diag.rawUnmatched, str(r.raw_material), num(r.raw_kg)); return; }
        out.push(Object.assign({ kind: 'USE', from_scope: 'FAC', code: rm.code, name: rm.name, qty: r4(num(r.raw_kg)), unit: INV.unitShow(rm.unit) || 'kg', parent: item ? item.code : src }, base0)); diag.use++; diag.resin++;
      };
      if (!item) { bump(diag.notItem, (r.process || '') + '|' + str(r.division) + '|' + (src || '(' + L('코드 없음', 'không mã') + ')'), pcs); resin(); return; }
      const unit = INV.unitN(item.unit); const spc = num(item.set_per_ct), pps = num(item.pcs_per_set);
      let sets = setProc ? num(r.ok_qty) : (pps ? pcs / pps : null);
      let mainQ = null;
      if (unit === 'CT') mainQ = num(r.ok_ct) > 0 ? num(r.ok_ct) : ((sets !== null && spc) ? sets / spc : null);   // 일보에 박스(CT) 실적이 있으면 그대로
      else if (unit === 'SET') mainQ = sets;
      else if (unit === 'kg') mainQ = num(r.weight_kg) || null;
      else mainQ = pcs;
      if (mainQ === null || !isFinite(mainQ)) { bump(diag.noConv, item.code, setProc ? num(r.ok_qty) : pcs); resin(); return; }
      if (!mainQ) { resin(); return; }   // 양품 0 (전부 불량 · 시험 사출)이어도 사출 원료는 쓴 것
      const base = base0;
      out.push(Object.assign({ kind: 'PROD', to_scope: 'FAC', code: item.code, name: item.name, qty: r4(mainQ), unit: INV.unitShow(item.unit) }, base)); diag.prod++;
      if (mode !== 'in_bom') return;
      if (r.process === 'INJ' && !bomIndex().lines.get(item.code)) { resin(); return; }
      const bm = bomOf(item, r.process, diag);
      if (!bm || !bm.kids.length) { bump(diag.noBom, item.code, mainQ); return; }
      diag.bomSrc[bm.src] = (diag.bomSrc[bm.src] || 0) + 1;
      bm.kids.forEach(k => {
        const basisQ = k.basis === 'main' ? mainQ : k.basis === 'set' ? (sets !== null ? sets : (pps ? pcs / pps : null)) : (pcs || (sets !== null && pps ? sets * pps : 0));
        if (!basisQ) return;
        let kid;
        if (k.raw) { kid = rawItem(k.raw); if (!kid) { bump(diag.rawUnmatched, k.raw, basisQ * k.per); return; } }
        else { kid = IT.get(k.code); if (!kid) { bump(diag.missingPart, k.code, basisQ * k.per); return; } }
        out.push(Object.assign({ kind: 'USE', from_scope: 'FAC', code: kid.code, name: kid.name, qty: r4(basisQ * k.per), unit: INV.unitShow(kid.unit), parent: item.code }, base)); diag.use++;
      });
    });
    return { rows: out, diag };
  };
  INV.prodPost = () => { const mode = INV.prodMode(); return DB.memo('inv.post:' + mode + ':' + calcSig(), ['prod_log', 'items', 'stock_open', 'bom', 'bom_lines', 'recipes', 'products', 'item_bom', 'materials', 'code_map'], () => INV.postRows(DB.rows('prod_log'), { mode })); };

  // ------------------------------------------------------------------ the stock map (replaces the old material-only C.stock)
  function mk(code, m) {
    const inf = INV.info(m);
    const unit = m ? INV.unitShow(m.unit) : '';
    return { code, m, name: m ? str(m.name) : '', unit, prim: unit || 'PCS', stage: inf.stage, line: inf.line, sub: inf.sub, cat: inf.cat,
      open: { WH: 0, FAC: 0 }, by: { WH: 0, FAC: 0 }, openSets: null, openPcs: null,
      in: 0, out: 0, move: 0, prod: 0, use: 0, adj: 0, n: 0, last: '', hidden: !!(m && m.hidden), unknown: !m };
  }
  C.stock = function (upTo) {
    const mode = INV.prodMode();
    return DB.memo('stock6:' + (upTo || '') + ':' + mode + ':' + calcSig(), ['items', 'stock_open', 'stock_tx', 'prod_log', 'bom', 'bom_lines', 'recipes', 'products', 'item_bom', 'materials', 'code_dict', 'code_map'], () => {
      const IT = INV.items(), op = INV.opening(), od = op.date, map = new Map();
      const get = (code) => { const m = IT.get(code); const key = m ? m.code : str(code); let s = map.get(key); if (!s) { s = mk(key, m); map.set(key, s); } return s; };
      IT.m.forEach((m, c) => { map.set(c, mk(c, m)); });
      ['WH', 'FAC'].forEach(sc => op.by[sc].forEach((o, c) => {
        const s = get(c); s.open[sc] += o.qty; s.by[sc] += o.qty;
        if (o.sets !== null) s.openSets = (s.openSets || 0) + o.sets; if (o.pcs !== null) s.openPcs = (s.openPcs || 0) + o.pcs;
        if (!s.name && o.name) s.name = str(o.name); if (!s.unit && o.unit) { s.unit = INV.unitShow(o.unit); s.prim = s.unit || 'PCS'; }
      }));
      const apply = (t) => {
        if (!t.code || (upTo && t.date > upTo)) return;
        const s = get(t.code); let any = false;
        INV.effects(t).forEach(([sc, q]) => { if (!counts(t.date, sc, od)) return; s.by[sc] += q; any = true; });
        if (!any) return;
        const q = num(t.qty);
        if (t.kind === 'IN') s.in += q; else if (t.kind === 'OUT') s.out += q; else if (t.kind === 'MOVE') s.move += q; else if (t.kind === 'PROD') s.prod += q; else if (t.kind === 'USE') s.use += q; else if (t.kind === 'ADJ') s.adj += q;
        s.n++; if (t.date > s.last) s.last = t.date;
      };
      DB.rows('stock_tx').forEach(apply);
      INV.prodPost().rows.forEach(apply);
      map.forEach(s => {
        s.by.WH = r4(s.by.WH); s.by.FAC = r4(s.by.FAC);
        s.bal = r4(s.by.WH + s.by.FAC); s.openTot = r4(s.open.WH + s.open.FAC);
        if (s.prim === 'kg') { s.bal_kg = s.bal; s.bal_ea = 0; s.open_kg = s.openTot; s.open_ea = 0; } else { s.bal_ea = s.bal; s.bal_kg = 0; s.open_ea = s.openTot; s.open_kg = 0; }
        const m = s.m; const spc = m ? num(m.set_per_ct) : 0, pps = m ? num(m.pcs_per_set) : 0;
        if (s.prim === 'CT' && spc) { s.sets = r4(s.bal * spc); s.pcs = pps ? r4(s.sets * pps) : null; }
        else if (s.prim === 'SET') { s.sets = s.bal; s.pcs = pps ? r4(s.bal * pps) : null; }
        else if (!s.n && s.openSets !== null) { s.sets = s.openSets; s.pcs = s.openPcs; }
        else { s.sets = null; s.pcs = null; }
        const sf = m && m.safety !== undefined && m.safety !== null && m.safety !== '' ? num(m.safety) : null;
        s.safety = sf;
        s.status = sf === null || sf === 0 ? 'na' : (s.bal < 0 ? 'neg' : (s.bal < sf ? 'low' : (s.bal < sf * 1.2 ? 'near' : 'ok')));
        s.negative = s.bal < -EPS;
        s.susp = (s.by.WH > EPS && s.by.FAC < -EPS) || (s.by.WH < -EPS && s.by.FAC > EPS);
        s.usage = 0; s.cover = null;
        s.active = s.n > 0 || Math.abs(s.openTot) > EPS || Math.abs(s.bal) > EPS;
      });
      return map;
    });
  };
  /** visible stock rows (not hidden, optionally only rows with stock or movement) */
  INV.rows = function (opt) {
    opt = opt || {}; const out = [];
    C.stock(opt.upTo).forEach(s => { if (s.hidden && !opt.hidden) return; if (opt.active && !s.active) return; out.push(s); });
    return out;
  };
  /** meta: opening dates, last manual transaction, last production posting, counts */
  INV.meta = function () {
    const od = INV.openDates(); const tx = DB.rows('stock_tx'); let last = '';
    tx.forEach(t => { if (t.date > last) last = t.date; });
    const pp = INV.prodPost(); let lastP = ''; pp.rows.forEach(r => { if (r.date > lastP) lastP = r.date; });
    return { open: od, lastTx: last || null, lastProd: lastP || null, txCount: tx.length, postCount: pp.rows.length, mode: pp.diag.mode, items: DB.rows('items').length };
  };

  // ------------------------------------------------------------------ ledger (수불부)
  INV.ledger = function (code) {
    const m = INV.item(code); const key = m ? m.code : str(code); const op = INV.opening(); const od = op.date;
    const evs = [];
    DB.rows('stock_tx').forEach(t => { const it = t.code ? INV.item(t.code) : null; if ((it ? it.code : str(t.code)) === key) evs.push(Object.assign({ _manual: true }, t)); });
    INV.prodPost().rows.forEach(t => { if (t.code === key) evs.push(t); });
    evs.sort((a, b) => String(a.date).localeCompare(String(b.date)) || ((a.kind === 'PROD' ? 0 : 1) - (b.kind === 'PROD' ? 0 : 1)));
    const ow = op.by.WH.get(key), of = op.by.FAC.get(key);
    const bal = { WH: ow ? ow.qty : 0, FAC: of ? of.qty : 0 };
    const rows = [{ open: true, date: od.WH || od.FAC || '', kind: 'OPEN', wh: bal.WH, fac: bal.FAC, balWH: bal.WH, balFAC: bal.FAC, bal: bal.WH + bal.FAC }];
    evs.forEach(t => {
      const eff = { WH: 0, FAC: 0 }; let before = true;
      INV.effects(t).forEach(([sc, q]) => { if (counts(t.date, sc, od)) { eff[sc] += q; before = false; } });
      bal.WH += eff.WH; bal.FAC += eff.FAC;
      rows.push({ date: t.date, kind: t.kind, doc_no: t.doc_no, partner: t.partner, note: t.note || (t.parent ? L('상위: ', 'Cha: ') + t.parent : ''), src: t.src, proc: t.proc, manual: !!t._manual, _id: t._id,
        wh: eff.WH, fac: eff.FAC, balWH: r4(bal.WH), balFAC: r4(bal.FAC), bal: r4(bal.WH + bal.FAC), before });
    });
    return { code: key, item: m, rows, open: { WH: ow ? ow.qty : 0, FAC: of ? of.qty : 0, date: od } };
  };

  // ------------------------------------------------------------------ stage summary (공정 흐름 카드)
  INV.stageSummary = function (rows) {
    const by = new Map(); STAGES.concat(EXTRA_STAGES).forEach(s => by.set(s.code, { stage: s.code, items: 0, withStock: 0, negative: 0, low: 0, susp: 0 }));
    rows.forEach(s => { const o = by.get(s.stage) || by.get('ETC'); o.items++; if (Math.abs(s.bal) > EPS) o.withStock++; if (s.negative) o.negative++; if (s.status === 'low' || s.status === 'neg') o.low++; if (s.susp) o.susp++; });
    return Array.from(by.values());
  };

  // ------------------------------------------------------------------ data checks (자료 점검)
  INV.checks = function () {
    return DB.memo('inv.checks', ['items', 'stock_open'], () => {
      const rows = DB.rows('items').filter(r => r.src !== 'local');
      const out = { space: [], emptySeg: [], notEnding: [], dup: [], typeMismatch: [], noUnit: [], unitVariant: [], fd: [], missing: [], test: [], noErp: [], unknownStock: [] };
      const byErp = new Map();
      rows.forEach(r => {
        const e = str(r.erp_code); const inf = INV.info(r);
        if (inf.stage === 'TEST') { out.test.push(r); return; }
        if (!e) { out.noErp.push(r); } else {
          if (/\s/.test(String(r.erp_code).trim())) out.space.push(r);
          if (/--/.test(e)) out.emptySeg.push(r);
          if (!up(e).replace(/\s/g, '').endsWith(up(r.code).replace(/\s/g, ''))) out.notEnding.push(r);
          const k = up(e); let a = byErp.get(k); if (!a) byErp.set(k, a = []); a.push(r);
          if (/^FD-/i.test(e)) out.fd.push(r);
        }
        const exp = (STAGE_IDX.get(inf.stage) || {}).etype; const et = str(r.etype).replace(/[[\]]/g, '');
        if (exp && et && et !== exp) out.typeMismatch.push(Object.assign({ _exp: exp }, r));
        if (!str(r.unit)) out.noUnit.push(r); else if (INV.unitN(r.unit) !== str(r.unit) && !['PCS', 'kg'].includes(str(r.unit))) out.unitVariant.push(r);
        if (r.missing) out.missing.push(r);
      });
      byErp.forEach((a, k) => { if (a.length > 1) out.dup.push({ erp: k, items: a }); });
      const IT = INV.items(); DB.rows('stock_open').forEach(o => { if (!IT.get(o.code)) out.unknownStock.push(o); });
      return out;
    });
  };

  // ------------------------------------------------------------------ helpers for screens
  /** suggested transfer rows that clear "+ in one scope / − in the other" pairs */
  INV.suggestMoves = function (date) {
    const out = [];
    C.stock().forEach(s => {
      if (!s.susp || s.hidden) return;
      const from = s.by.WH > 0 ? 'WH' : 'FAC', to = from === 'WH' ? 'FAC' : 'WH';
      const q = r4(Math.min(Math.abs(s.by[from]), Math.abs(s.by[to]))); if (q <= EPS) return;
      out.push({ date: date || F.today(), kind: 'MOVE', from_scope: from, to_scope: to, code: s.code, name: s.name, qty: q, unit: s.unit, note: L('이동 누락 정리', 'Bổ sung phiếu chuyển kho'), src: 'auto:susp' });
    });
    return out;
  };
  /** next document number like MV251016-03 */
  INV.nextDoc = function (prefix, date) {
    const d = String(date || F.today()).replace(/-/g, '').slice(2); const head = prefix + d + '-';
    let n = 0; DB.rows('stock_tx').forEach(t => { if (t.doc_no && t.doc_no.indexOf(head) === 0) { const k = parseInt(t.doc_no.slice(head.length), 10); if (k > n) n = k; } });
    return head + String(n + 1).padStart(2, '0');
  };
  INV.DOC_PREFIX = { IN: 'IN', OUT: 'OUT', MOVE: 'MV', ADJ: 'ADJ' };

  /** search items by code / ERP CODE / Mã XNK / name (spaces & case ignored) */
  INV.search = function (q, limit) {
    const k = normName(q); if (!k) return [];
    const hits = []; DB.rows('items').forEach(r => {
      if (r.hidden) return;
      const c = normName(r.code), e = normName(r.erp_code), x = normName(r.xnk), n = normName(r.name);
      let score = -1; if (c === k) score = 0; else if (c.startsWith(k)) score = 1; else if (e.includes(k)) score = 2; else if (c.includes(k)) score = 3; else if (x === k) score = 4; else if (n.includes(k)) score = 5;
      if (score >= 0) hits.push([score, r]);
    });
    hits.sort((a, b) => a[0] - b[0] || String(a[1].code).localeCompare(String(b[1].code)));
    return hits.slice(0, limit || 20).map(x => x[1]);
  };

  /** convert legacy KHO NVL ledger / slip rows (inout format) into stock_tx rows */
  INV.ledgerToTx = function (rows, opt) {
    opt = opt || {}; const IT = INV.items(); const out = []; const unmapped = [];
    const byXnk = DB.memo('inv.byXnk', ['items'], () => { const m = new Map(); DB.rows('items').forEach(r => { const x = up(r.xnk); if (!x) return; let a = m.get(x); if (!a) m.set(x, a = []); a.push(r); }); return m; });
    const outMode = opt.outMode || 'move';
    // 원부자재 창고 장부이므로 원부자재 품목으로만 넣는다. 공장 장부의 '품번' 칸에는 카톤 · 마니라가 들어가는 완제품 코드가 적혀 있다 (예: 52-9824-0-006 → 카톤 52-9824-0-808)
    const isMat = (it) => !!it && INV.groupOf({ stage: INV.info(it).stage, m: it }) === 'mat';
    const prefix = (c) => { const p = str(c).toUpperCase().split('-'); return p.length >= 3 ? p.slice(0, 3).join('-') : ''; };
    rows.forEach((r, i) => {
      let it = null; let cands = [];
      const wh = IT.get(r.wh_code), ic = IT.get(r.item_code);
      if (isMat(wh)) it = wh;                                   // 1) 창고코드가 원부자재 품목
      else if (isMat(ic)) it = ic;                              // 2) 품번이 원부자재 품목
      if (!it) {                                                // 3) Mã XNK(공용 세관 코드) 후보를 제품코드 앞부분 · 품명으로 좁힌다
        cands = (byXnk.get(up(r.wh_code)) || []).filter(isMat);
        const pre = prefix(r.item_code), icode = up(r.item_code);
        const narrow = pre ? cands.filter(c => up(c.code).indexOf(pre + '-') === 0 || (icode && up(c.name).indexOf(icode) >= 0)) : [];
        const pool = narrow.length ? narrow : cands;
        if (pool.length === 1) it = pool[0];
        else if (pool.length > 1) { const nn = normName(r.name); const exact = pool.filter(c => normName(c.name) === nn); const part = exact.length ? exact : pool.filter(c => nn && (normName(c.name).includes(nn) || nn.includes(normName(c.name)))); if (part.length === 1) it = part[0]; else cands = pool; }
        if (!it) { const alt = up(r.wh_code).replace(/\s+/g, '').replace(/VN$/, ''); const a = IT.get(alt) || IT.get(up(r.item_code).replace(/\s+/g, '').replace(/VN$/, '')); if (isMat(a)) it = a; }   // 4) 'R-103VN' → R-103
      }
      const isIn = r.type === 'IN';
      const kg = isIn ? num(r.in_kg) : num(r.out_kg), ea = isIn ? num(r.in_ea) : num(r.out_ea);
      const unit = it ? INV.unitN(it.unit) : '';
      const qty = unit === 'kg' ? (kg || ea) : (ea || kg);
      const date = F.parseDate(r.date);
      const tx = { date: date || r.date, doc_no: r.doc_no, kind: isIn ? 'IN' : (outMode === 'move' ? 'MOVE' : 'OUT'), from_scope: isIn ? undefined : 'WH', to_scope: isIn ? 'WH' : (outMode === 'move' ? 'FAC' : undefined),
        code: it ? it.code : undefined, name: it ? it.name : r.name, qty: r4(qty), unit: it ? INV.unitShow(it.unit) : undefined, partner: r.partner_name || undefined, note: r.content || undefined, src: opt.src || 'ledger',
        _orig: { item_code: r.item_code, wh_code: r.wh_code, name: r.name }, _cands: it ? undefined : cands.map(c => c.code) };
      if (!qty) return;
      if (!date) tx._badDate = true;   // 날짜를 읽지 못함 → 반영하지 않고 미리보기에 보인다
      if (!it) unmapped.push(i);
      out.push(tx);
    });
    return { rows: out, unmapped: unmapped.length };
  };
})();
