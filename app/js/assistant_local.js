/* AI 생산 비서 · 내장 모드 (chế độ tích hợp, không cần internet / API key).
   Keyword-based understanding of Korean / Vietnamese (with or without diacritics) / English questions.
   It is NOT an AI: it recognises a fixed set of question types, runs the read-only tools (assistant_tools.js)
   and formats the numbers. When it does not understand it says so and shows examples instead of guessing. */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, C = ERP.calc, F = ERP.fmt, A = ERP.ai, T = A.tools, U = A.util;

  // ---------- text helpers ----------
  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = (w) => new RegExp('(^|[^a-z0-9])' + esc(w) + '([^a-z0-9]|$)');
  const HANGUL = /[\uac00-\ud7a3]/;
  const VI_PLAIN = new RegExp('(^|[^a-z0-9])(' + ['toi', 'cho', 'cua', 'nao', 'nvl', 'thieu', 'chao', 'cam on', 'xin chao', 'bao nhieu', 'hom nay', 'hom qua', 'hom kia', 'don hang', 'ton kho', 'ton an toan', 'san xuat', 'san luong',
    'tre han', 'qua han', 'sap den han', 'den han', 'dat hang', 'can mua', 'dung may', 'ngung may', 'may hong', 'hong may', 'dong goi', 'lap rap', 'ban tin', 'nhu cau', 'ty le loi', 'hang loi', 'bao cao', 'tuan nay', 'tuan truoc', 'tuan qua',
    'thang nay', 'thang truoc', 'thang qua', 'tinh hinh', 'tom tat', 'gan day', 'het hang', 'sap het', 'tien do', 'giao hang', 'vat tu', 'nguyen vat lieu'].join('|') + ')([^a-z0-9]|$)');

  function detectLang(raw) {
    if (HANGUL.test(raw)) return 'ko';
    if (/[ăâêôơưđàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i.test(raw)) return 'vi';
    // Vietnamese typed without diacritics ("ban tin hom nay"): look for common words/phrases (not "may", "can", "ton" … which are also English words)
    if (VI_PLAIN.test(fold(raw))) return 'vi';
    return ERP.lang === 'vi' ? 'vi' : 'ko';
  }
  const tokens = (raw) => raw.split(/[\s,;:()\[\]{}'"“”‘’?!~]+/).map(t => t.replace(/^[^\w가-힣]+|[^\w가-힣]+$/g, '')).filter(Boolean);
  const cleanTok = (t) => t.replace(/^(.*[a-z0-9\-_&.])[가-힣]+$/i, '$1');           // "4700026166은" → "4700026166"

  // ---------- period / process ----------
  const dowOf = (s) => new Date(s + 'T00:00:00').getDay();
  const monday = (s) => F.addDays(s, -((dowOf(s) + 6) % 7));
  const pad = (x) => String(x).padStart(2, '0');
  function parsePeriod(raw, low, f) {
    const today = F.today(), latest = C.latestProdDate();
    const day = (d) => ({ from: d, to: d, kind: 'day' });
    const iso = Array.from(raw.matchAll(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/g)).map(x => x[1] + '-' + pad(x[2]) + '-' + pad(x[3])).filter(U.validDate);
    if (iso.length >= 2) return { from: iso[0], to: iso[1], kind: 'range' };
    if (iso.length === 1) return day(iso[0]);
    const md = low.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) || f.match(/ngay\s*(\d{1,2})\s*thang\s*(\d{1,2})/);
    if (md) {
      const m = HANGUL.test(md[0]) ? +md[1] : +md[2], d = HANGUL.test(md[0]) ? +md[2] : +md[1];
      let y = +today.slice(0, 4), s = y + '-' + pad(m) + '-' + pad(d); if (s > today) s = (y - 1) + '-' + pad(m) + '-' + pad(d);
      if (U.validDate(s)) return day(s);
    }
    const t = (ko, vi) => ko.test(low) || vi.test(f);
    if (t(/그저께|그제/, /hom kia/)) return day(F.addDays(today, -2));
    if (t(/어제/, /hom qua|yesterday/)) return day(F.addDays(today, -1));
    if (t(/오늘/, /hom nay|today/)) return day(today);
    if (t(/지난\s*주|저번\s*주/, /tuan truoc|tuan qua|last week/)) { const s = F.addDays(monday(today), -7); return { from: s, to: F.addDays(s, 6), kind: 'range' }; }
    if (t(/이번\s*주/, /tuan nay|this week/)) return { from: monday(today), to: today, kind: 'range' };
    if (t(/지난\s*(달|월)|저번\s*달/, /thang truoc|thang qua|last month/)) { const first = today.slice(0, 8) + '01'; const to = F.addDays(first, -1); return { from: to.slice(0, 8) + '01', to, kind: 'range' }; }
    if (t(/이번\s*(달|월)/, /thang nay|this month/)) return { from: today.slice(0, 8) + '01', to: today, kind: 'range' };
    const nd = low.match(/최근\s*(\d{1,3})\s*일|(\d{1,3})\s*일\s*(간|동안)/) || f.match(/(\d{1,3})\s*ngay\s*(gan day|qua|vua qua)|last\s*(\d{1,3})\s*days/);
    if (nd) { const n = +(nd[1] || nd[2] || nd[3]); if (n >= 1 && n <= 366) return { from: F.addDays(today, -(n - 1)), to: today, kind: 'range' }; }
    return { from: latest, to: latest, kind: 'latest' };
  }
  const PROC_SYN = { INJ: ['사출', 'injection', 'ep nhua'], REF: ['리필', 'refill', 'ep loi'], STP: ['스탬핑', '스탬프', '핫포일', 'stamping', 'hot foil', 'in chuyen'], ASM: ['조립', 'assembly', 'lap rap'], WRP: ['권취', 'wrapping', 'quan giay'], PCK: ['포장', 'packing', 'dong goi'] };
  function parseProcess(low, f) {
    for (const p of ERP.PROC) {
      const toks = [p.id.toLowerCase(), p.ko, fold(String(p.vi || '').replace(/\(.*?\)/g, '')).trim(), String(p.en || '').toLowerCase()].concat(PROC_SYN[p.id] || []).filter(x => x && x.length >= 2);
      for (const tk of toks) { if (HANGUL.test(tk)) { if (low.includes(tk)) return p.id; } else if (word(fold(tk)).test(f)) return p.id; }
    }
    return null;
  }

  // ---------- entities found in the question ----------
  const poMap = () => DB.memo('ai.pomap', ['po', 'prod_log'], () => new Map(C.poGroups().map(g => [String(g.po_no).toLowerCase(), g.po_no])));
  const itemSet = () => DB.memo('ai.items', ['po', 'bom'], () => { const s = new Set(); DB.rows('po').forEach(p => p.item_no && s.add(String(p.item_no).toLowerCase())); DB.rows('bom').forEach(b => b.retail_no && s.add(String(b.retail_no).toLowerCase())); return s; });
  const matMap = () => DB.memo('ai.matmap', ['items', 'stock_open', 'stock_tx', 'materials'], () => { const m = new Map(); C.stock().forEach((s, k) => { if (!s.hidden) m.set(String(k).toLowerCase(), k); }); return m; });
  const customers = () => DB.memo('ai.custs', ['po'], () => Array.from(new Set(DB.rows('po').map(p => String(p.customer || '').trim()).filter(c => c.length >= 3 && c.toLowerCase() !== 'from'))));
  function findPoToken(toks) {
    const map = poMap();
    for (let i = 0; i < toks.length; i++) {
      const t = cleanTok(toks[i]).toLowerCase(), prev = (toks[i - 1] || '').toLowerCase(), cands = [t], m = t.match(/^po[-_#:]?(.+)$/); if (m) cands.push(m[1]);
      for (const c of cands) if (map.has(c) && (c.length >= 4 || /^(po|수주|주문)$/.test(prev))) return map.get(c);
    }
    return null;
  }
  function findItemToken(toks) { const s = itemSet(); for (const t0 of toks) { const t = cleanTok(t0).toLowerCase(); if (t.length >= 5 && /\d/.test(t) && s.has(t)) return cleanTok(t0); } return null; }
  function findMatCode(toks) { const m = matMap(); for (const t0 of toks) { const t = cleanTok(t0).toLowerCase(); if (t.length >= 3 && /\d/.test(t) && m.has(t)) return m.get(t); } return null; }
  function findCustomer(low) {
    const cs = customers(); const hit = cs.filter(c => low.includes(c.toLowerCase())).sort((a, b) => b.length - a.length)[0]; if (hit) return hit;
    for (const c of cs) { const w = c.toLowerCase().split(/[\s&.,-]+/)[0]; if (w.length >= 5 && word(w).test(low)) return c; }
    return null;
  }

  // ---------- keyword groups (Korean on lower-cased text, Vietnamese/English on diacritic-folded text) ----------
  const KW = {
    brief: [/브리핑|현황\s*(요약|보고)|오늘\s*(현황|상황|할\s*일|체크)|전체\s*(현황|상황)|종합\s*(현황|보고)|아침\s*보고|한눈에/, /brief|ban tin|tong quan|tom tat (hom nay|chung)|tinh hinh (chung|hom nay)|bao cao nhanh|hom nay (co gi|the nao)|daily report|status report/],
    late: [/지연|늦어|늦은|밀린|밀렸|연체|납기\s*(경과|초과|지남|지난|넘)/, /\b(tre|tre han|qua han|cham tien do|late|overdue|delayed|behind schedule)\b/],
    soon: [/임박|7일\s*(내|이내)|일주일\s*(내|이내)|이번\s*주\s*납기|곧\s*납기|납기\s*(임박|예정|다가)/, /(sap|gan)\s*(den\s*)?han|den han|due soon|due this week|trong 7 ngay|7 ngay (toi|nua)/],
    stale: [/오래된|오래\s*지연|묵은|방치|장기\s*(미결|지연|미완)|60일\s*(넘|초과)/, /\bstale\b|qua cu|ton dong lau|qua han lau|han lau|long overdue|very late/],
    deadline: [/납기|납품|출하\s*일정|위험/, /\bdue\b|deadline|han giao|rui ro/],
    // NOTE: Korean patterns run on the raw text, so they must not contain ASCII word boundaries (\b treats Vietnamese letters such as "ượ" as non-word
    // characters: "lượng" would match \bng\b). Latin-letter words (po, ng, mrp) are matched only on the diacritic-folded text (second pattern).
    orders: [/수주|오더|주문서|고객\s*주문/, /don hang|\bpo\b|dang mo|\borders?\b/],
    lowStock: [/안전\s*재고|재고\s*(부족|미달|없|바닥|적)|부족한?\s*(자재|원료|원부자재|재고)|미달|바닥|모자[라란랄르]/, /ton an toan|thieu|het hang|sap het|low stock|shortage|below safety/],
    stock: [/재고|잔량|남은|얼마나\s*있/, /\bton\b|ton kho|con bao nhieu|stock|inventory/],
    reorder: [/발주|구매\s*(요청|필요)|사야|구입|주문해야/, /dat hang|can mua|mua them|reorder|purchase/],
    prod: [/생산|실적|생산량|만든|제조|output/, /san xuat|san luong|ket qua|production|output|da lam/],
    quality: [/불량|품질|엔지|결함|폐기|파손/, /\bloi\b|hang loi|ty le loi|\bng\b|chat luong|phe pham|hang hong|hang hu|hu hong|defect|reject|scrap|quality/],
    downtime: [/정지|다운|고장|멈춤|멈춘|비가동|가동\s*중단/, /(?<!su )dung may|hong may|may (hong|dung|ngung|bi hong)|may nao (bi )?(dung|hong|ngung)|ngung|downtime|breakdown|stoppage/],
    // 설비 사용 · 가동 현황 ("sử dụng máy") 은 정지가 아니라 생산 실적 (공정별 가동 설비 수 포함)
    machUse: [/설비\s*(사용|가동|활용)|가동\s*(률|현황|대수)|돌아간\s*설비/, /su dung may|cong suat may|may (dang )?chay|van hanh may|utilization|machine usage/],
    mrp: [/소요량|필요\s*(자재|원료|원부자재)|자재\s*(소요|필요)|원료\s*(소요|필요)/, /nhu cau (nvl|vat tu|nguyen)|\bmrp\b|can bao nhieu|vat tu can|material requirement/],
    help: [/도움말|도와|뭘\s*(할|물어)|무엇을|기능|사용법/, /giup|lam duoc gi|huong dan|\bhelp\b|what can you/],
    greet: [/^(안녕|하이|반가|헬로)/, /^(xin chao|chao|hello|hi|hey)\b/],
    thanks: [/고마|감사/, /cam on|thanks|thank you/],
    generic: [/현황|요약|상황|상태/, /tinh hinh|tom tat|status|summary/],
    done: [/완료|끝난|끝났|마감|다\s*만든/, /hoan thanh|hoan tat|\bdone\b|completed|finished|lam xong|da xong|xong roi|\bxong\b/],
    inprod: [/생산\s*중/, /dang san xuat|in production/],
    hold: [/보류|홀드/, /\bhold\b|tam dung|tam ngung|on hold/],
    cancel: [/취소된|취소\s*(된|한)?\s*(po|수주|주문)/, /\bhuy\b|da huy|cancel(l)?ed/],
  };
  const NOISE = new RegExp('^(' + ['알려줘', '알려', '알려주세요', '주세요', '줘', '좀', '현재', '지금', '얼마', '몇', '있어', '있나', '뭐', '뭐야', '어때', '어떻게', '해줘', '보여줘', '보여', '재고', '자재', '원료', '원부자재', '현황', '상태', '수량', '잔량', '남은', '조회', '검색', '확인', '찾아줘', '찾아', '그리고', '및', '는', '은', '이', '가', '을', '를', '의', '에', '도', '요', '인가', '인지', '얼마나', '며칠', '정도', '전체', '모든', '전부', '목록', '리스트', '알려줄래', '궁금해', '궁금',
    'list', 'show', 'tell', 'me', 'the', 'a', 'of', 'is', 'are', 'how', 'many', 'much', 'what', 'stock', 'inventory', 'status', 'check', 'please', 'of', 'in', 'for',
    'cho', 'toi', 'biet', 'xem', 'ton', 'kho', 'nvl', 'nguyen', 'vat', 'lieu', 'bao', 'nhieu', 'con', 'la', 'gi', 'cua', 'va', 'co', 'khong', 'nao', 'hien', 'tai', 'dang', 'the'].map(esc).join('|') + ')$', 'i');
  const restTokens = (q) => q.toks.map(cleanTok).filter(t => t.length >= 2 && !/^\d+$/.test(t) && !NOISE.test(fold(t)) && !NOISE.test(t) && !/^\d{4}[-./]\d/.test(t))
    .map(t => (HANGUL.test(t) ? t.replace(/(은|는|이|가|을|를|의|에|도|만|으로|로|이랑|랑|과|와|에서|부터)$/, (m, p, off) => (off >= 2 ? '' : m)) : t)).filter(t => t.length >= 2);

  /** 'ép lõi'(리필 성형) · 'lõi'(심)와 'lỗi'(불량)는 성조를 빼면 둘 다 'loi' → 불량으로 알아듣지 않게 바꾼 글 */
  function coreFix(raw, f) { let x = f.replace(/\bep loi\b/g, 'ep_core'); if (/lõi/i.test(raw) && !/lỗi/i.test(raw)) x = x.replace(/\bloi\b/g, 'core'); return x; }
  const QTY_ASK = /몇|얼마|수량|bao nhieu|so luong|how many|how much/;

  // ---------- intent ----------
  function parse(text) {
    const raw = String(text || '').trim(), low = raw.toLowerCase(), f = fold(raw), toks = tokens(raw);
    const q = { raw, low, f, toks, lang: detectLang(raw), period: parsePeriod(raw, low, f), process: parseProcess(low, f), k: {} };
    const fq = coreFix(raw, f);
    Object.keys(KW).forEach(k => { q.k[k] = KW[k][0].test(low) || KW[k][1].test(k === 'quality' ? fq : f); });
    q.po = findPoToken(toks); q.item = findItemToken(toks); q.matCode = findMatCode(toks); q.customer = findCustomer(low); q.rest = restTokens(q);
    q.intent = decide(q);
    return q;
  }
  function decide(q) {
    const k = q.k;
    if (!q.raw) return { name: 'help' };
    if (q.po) return k.mrp ? { name: 'mrp', po: q.po } : { name: 'po', po: q.po };
    if (q.item) {
      if (k.mrp) return { name: 'mrp', item: q.item };
      if ((k.stock || k.lowStock) && q.matCode) return { name: 'material', query: q.matCode };   // 품번 + 재고 = 그 품목의 재고 (수주 목록이 아님)
      return { name: 'orders', query: q.item, status: 'all', title: 'item' };
    }
    if (q.matCode) return { name: 'material', query: q.matCode };
    if (k.brief) return { name: 'briefing' };
    // 보류 · 취소 PO ("PO tạm ngưng", "보류된 수주") — '멈춤(ngưng)' 이 있어도 설비 정지가 아님
    if ((k.hold || k.cancel) && (k.orders || !k.downtime)) return { name: 'orders', query: q.customer || '', status: k.cancel && !k.hold ? 'cancel' : 'hold', title: 'list' };
    if (k.quality || k.downtime) return { name: 'qd', focus: k.downtime && !k.quality ? 'stop' : (k.quality && !k.downtime ? 'ng' : 'both') };
    if (k.reorder && !k.orders) return { name: 'reorder' };
    if (k.mrp) return { name: 'mrp_ask' };
    // 끝난 PO ("PO nào đã làm xong", "đã làm xong chưa", "완료된 수주") → 완료 목록. 공정 · 수량을 물으면 생산 실적
    if (k.done && (k.orders || (!q.process && !QTY_ASK.test(q.low) && !QTY_ASK.test(q.f)))) return { name: 'orders', query: q.customer || '', status: 'done', title: 'list' };
    // 지연 · 임박 · 오래된 PO 는 '생산' 이란 말이 있어도 납기 질문 ("생산 지연 PO") — 공정을 콕 집어 묻지 않을 때
    if ((k.late || k.soon || k.stale) && !q.process) return { name: 'deadline', view: k.stale ? 'stale' : (k.late && !k.soon ? 'late' : (k.soon && !k.late ? 'soon' : 'both')), customer: q.customer };
    // a process name on its own ("포장 어제", "đóng gói tuần này") is a production question too
    const procOnly = q.process && !k.orders && !q.customer && !k.stock && !k.lowStock && !k.reorder && !k.late && !k.soon && !k.stale && !k.deadline;
    if ((k.prod || procOnly || k.machUse) && !(k.inprod && (k.orders || q.customer))) return { name: 'production' };
    if (k.late || k.soon || k.stale || (k.deadline && !k.stock)) return { name: 'deadline', view: k.stale ? 'stale' : (k.late && !k.soon ? 'late' : (k.soon && !k.late ? 'soon' : 'both')), customer: q.customer };
    if (k.lowStock) return { name: 'low_stock' };
    if (k.stock && q.rest.length) return { name: 'material', query: q.rest.join(' '), parts: q.rest };
    if (k.stock) return { name: 'low_stock' };
    if (k.orders || q.customer) return { name: 'orders', query: q.customer || '', status: k.done ? 'done' : (k.inprod ? 'prod' : 'open'), title: 'list' };
    if (k.generic) return { name: 'briefing' };
    if (k.greet) return { name: 'greet' };
    if (k.thanks) return { name: 'thanks' };
    if (k.help) return { name: 'help' };
    return { name: 'search', parts: q.rest };
  }

  // ---------- formatting ----------
  function ctx(lang) {
    const loc = lang === 'vi' ? 'vi-VN' : 'ko-KR';
    const c = { lang,
      n: (x, d) => (x === null || x === undefined || isNaN(x)) ? '–' : Number(x).toLocaleString(loc, { maximumFractionDigits: d || 0 }),
      s: (ko, vi) => (lang === 'vi' ? vi : ko),
      dow: (d) => (lang === 'vi' ? ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] : ['일', '월', '화', '수', '목', '금', '토'])[dowOf(d)],
      dd: (x) => (x === null || x === undefined) ? '' : x < 0 ? c.s(`${-x}일 지연`, `trễ ${-x} ngày`) : x === 0 ? 'D-Day' : 'D-' + x,
      pname: (id) => { const p = ERP.PROC.find(z => z.id === id); return p ? c.s(p.ko, p.vi) : id; },
    };
    return c;
  }
  // 7차: 답변 = 블록 (제목 · 구역 · 표(+표 밑 코멘트) · 메모 · 목록). 화면은 표로 그리고, text 는 복사·메신저용 글자 버전
  const B = {
    h: (text) => ({ t: 'h', text }), sec: (text) => ({ t: 'sec', text }), p: (text) => ({ t: 'p', text }), note: (text) => ({ t: 'note', text }), list: (items) => ({ t: 'list', items }),
    /** cols: [{l, num}] · recs: source records · o.cell(rec) → cells · o.line(rec) → text line · o.title · o.more · o.cmt (comment under the table) */
    table: (cols, recs, o) => ({ t: 'table', cols, rows: recs.map(o.cell), lines: o.line ? recs.map(o.line) : null, title: o.title, more: o.more, cmt: o.cmt }),
  };
  const cellTxt = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? String(v.v === undefined ? '' : v.v) : String(v));
  const mark = (t) => (/^\s*(※|⚠)/.test(t) ? t : '※ ' + t);
  function toText(blocks) {
    const out = [];
    blocks.forEach(b => {
      if (!b) return;
      if (b.t === 'h') out.push('■ ' + b.text);
      else if (b.t === 'sec') { if (out.length) out.push(''); out.push(b.text); }
      else if (b.t === 'p') out.push(b.text);
      else if (b.t === 'note') out.push(mark(b.text));
      else if (b.t === 'list') b.items.forEach(x => out.push('  · ' + x));
      else if (b.t === 'table') { if (b.title) out.push(b.title); (b.lines || b.rows.map(r => '▸ ' + r.map(cellTxt).filter(Boolean).join(' · '))).forEach(l => out.push(l)); if (b.more) out.push('  ' + b.more); if (b.cmt) out.push(mark(b.cmt)); }
    });
    return out.join('\n');
  }
  A.blocksToText = toText;
  const items = (r) => (r.items || []).filter(Boolean);
  const poLine = (r, c) => '▸ ' + [r.po_no, r.customer || '–', items(r).slice(0, 2).join(', ') + (items(r).length > 2 ? ' …' : ''),
    r.due ? c.s('납기 ', 'hạn ') + r.due + (r.days_to_due !== null && r.days_to_due !== undefined ? ' (' + c.dd(r.days_to_due) + ')' : '') : c.s('납기 미정', 'chưa có hạn'),
    r.sets ? c.s('진행 ', 'tiến độ ') + r.progress_pct + '% (' + c.n(r.packed_sets) + '/' + c.n(r.sets) + ' set)' : c.s('set 수량 미입력', 'chưa nhập số lượng set')].filter(Boolean).join(' · ');
  const matLine = (r, c) => '▸ ' + r.code + ' ' + (r.name || '') + ': ' + c.n(r.balance, 1) + (r.safety_stock ? ' / ' + c.n(r.safety_stock) : '') + ' ' + r.unit
    + (r.pct_of_safety !== null && r.pct_of_safety !== undefined ? ' (' + r.pct_of_safety + '%)' : c.s(' (안전재고 미설정)', ' (chưa cài tồn an toàn)'))
    + (r.status === 'neg' ? c.s(' · 마이너스', ' · ÂM') : '') + (r.recommended_order ? c.s(' · 발주 권장 ', ' · đề xuất đặt ') + c.n(r.recommended_order) : '')
    + (r.balance > 0 && r.days_cover !== null && r.days_cover !== undefined && r.days_cover < 60 ? c.s(` · 약 ${r.days_cover}일치`, ` · đủ ~${r.days_cover} ngày`) : '')
    + (r.warehouse !== undefined && r.factory !== undefined && (Math.abs(r.factory) > 0 && Math.abs(r.warehouse) > 0 || r.transfer_missing_suspected) ? c.s(` · 창고 ${c.n(r.warehouse, 1)} / 공장 ${c.n(r.factory, 1)}`, ` · Kho ${c.n(r.warehouse, 1)} / Xưởng ${c.n(r.factory, 1)}`) : '')
    + (r.transfer_missing_suspected ? c.s(' (이동 누락 의심)', ' (nghi thiếu phiếu chuyển)') : '');
  const moreTxt = (total, shown, c) => (total > shown ? c.s(`… 외 ${c.n(total - shown)}건`, `… và ${c.n(total - shown)} mục nữa`) : '');
  // late = overdue ≤60 days (dashboard); stale = older. The orders screen's "납기 경과" tab counts both → say so, so the numbers can be reconciled
  const staleNote = (n, c, late) => (n ? [c.s(`※ 납기가 ${U.STALE_DAYS}일 넘게 지난 PO ${c.n(n)}건은 대시보드 기준 밖이라 제외했습니다${late !== undefined ? ` (수주 관리 "납기 경과" 탭 ${c.n(late + n)}건 = ${c.n(late)} + ${c.n(n)})` : ''}. "오래된 지연 PO"라고 물으면 보여드립니다.`,
    `※ ${c.n(n)} PO quá hạn hơn ${U.STALE_DAYS} ngày nằm ngoài tiêu chí của Tổng quan nên không tính ở trên${late !== undefined ? ` (tab "Quá hạn" ở màn hình Đơn hàng: ${c.n(late + n)} = ${c.n(late)} + ${c.n(n)})` : ''}. Hỏi "PO quá hạn lâu" để xem.`)] : []);

  // ---- common tables
  const thisYear = () => F.today().slice(0, 4);
  const dshort = (d) => (d && String(d).slice(0, 4) === thisYear() ? String(d).slice(5, 10) : (d || ''));
  function poTable(rows, total, c, o) {
    o = o || {};
    const cols = [{ l: 'PO' }, { l: c.s('거래처', 'Khách hàng') }, { l: c.s('품번', 'Mã hàng') }, { l: c.s('납기 (남은 날)', 'Hạn (còn)') }, { l: c.s('진행 · set', 'Tiến độ · set'), num: 1 }];
    return B.table(cols, rows, { title: o.title, more: moreTxt(total, rows.length, c), cmt: o.cmt, line: (r) => poLine(r, c),
      cell: (r) => [{ v: r.po_no, b: 1 }, String(r.customer || '–').slice(0, 16), items(r).slice(0, 2).join(', ') + (items(r).length > 2 ? ' …' : ''),
        !r.due ? { v: c.s('미정', 'chưa có'), tone: 'muted' } : { v: dshort(r.due) + (r.days_to_due === null || r.days_to_due === undefined ? '' : ' · ' + c.dd(r.days_to_due)), tone: r.days_to_due < 0 ? 'bad' : r.days_to_due <= 3 ? 'warn' : '' },
        r.sets ? { v: r.progress_pct + '% · ' + c.n(r.packed_sets) + '/' + c.n(r.sets), tone: r.progress_pct >= 99.9 ? 'ok' : '' } : { v: c.s('set 미입력', 'chưa có set'), tone: 'muted' }] });
  }
  /** a short comment on a list of POs: zero-progress / almost-done counts, the most urgent one */
  function poComment(rows, total, c, kind) {
    if (!rows.length) return '';
    const zero = rows.filter(r => r.sets && r.progress_pct === 0).length, hi = rows.filter(r => r.sets && r.progress_pct >= 90).length, noSet = rows.filter(r => !r.sets).length;
    if (kind === 'late') {
      const worst = rows.slice().sort((a, b) => a.days_to_due - b.days_to_due)[0];
      return c.s(`가장 오래된 건은 ${worst.po_no} (${c.dd(worst.days_to_due)}). 표의 ${c.n(rows.length)}건 중 진행 0% ${zero}건 · 90% 이상 ${hi}건${noSet ? ` · set 미입력 ${noSet}건` : ''}. 0%는 마감·취소 처리 누락인지, 90% 이상은 잔량만 남았는지 확인하세요.`,
        `Lâu nhất: ${worst.po_no} (${c.dd(worst.days_to_due)}). Trong ${c.n(rows.length)} đơn: 0% có ${zero} · ≥90% có ${hi}${noSet ? ` · chưa có set ${noSet}` : ''}. Đơn 0% có thể chưa đóng/hủy; đơn ≥90% có thể chỉ còn phần dư.`);
    }
    const first = rows.slice().sort((a, b) => (a.days_to_due === null ? 999 : a.days_to_due) - (b.days_to_due === null ? 999 : b.days_to_due))[0];
    const behind = rows.filter(r => r.sets && r.progress_pct < 50).length;
    return c.s(`가장 급한 건: ${first.po_no}${first.due ? ' (' + c.dd(first.days_to_due) + ', 진행 ' + (first.sets ? first.progress_pct + '%' : '–') + ')' : ''}. 진행 50% 미만 ${behind}건은 생산 일정을 확인하세요.`,
      `Gấp nhất: ${first.po_no}${first.due ? ' (' + c.dd(first.days_to_due) + ', ' + (first.sets ? first.progress_pct + '%' : '–') + ')' : ''}. ${behind} đơn dưới 50% — kiểm tra kế hoạch sản xuất.`);
  }
  function matTable(rows, total, c, o) {
    o = o || {};
    const showScope = !o.reorder && rows.some(r => r.transfer_missing_suspected || (Math.abs(r.factory || 0) > 0 && Math.abs(r.warehouse || 0) > 0));
    const cols = [{ l: c.s('코드', 'Mã') }, { l: c.s('품명', 'Tên') }, { l: c.s('재고', 'Tồn'), num: 1 }, { l: c.s('안전재고', 'Tồn AT'), num: 1 }].concat(o.reorder ? [{ l: c.s('발주 권장', 'Đề xuất đặt'), num: 1 }] : [{ l: '%', num: 1 }]).concat(showScope ? [{ l: c.s('창고 / 공장', 'Kho / Xưởng'), num: 1 }] : []);
    return B.table(cols, rows, { title: o.title, more: moreTxt(total, rows.length, c), cmt: o.cmt, line: (r) => matLine(r, c),
      cell: (r) => [{ v: r.code, b: 1 }, String(r.name || '').slice(0, 22), { v: c.n(r.balance, 1) + ' ' + (r.unit || ''), tone: r.balance < 0 ? 'bad' : '' }, r.safety_stock ? c.n(r.safety_stock) : '–']
        .concat(o.reorder ? [{ v: c.n(r.recommended_order) + ' ' + (r.unit || ''), b: 1 }] : [r.pct_of_safety !== null && r.pct_of_safety !== undefined ? { v: r.pct_of_safety + '%', tone: r.pct_of_safety < 100 ? 'bad' : r.pct_of_safety < 120 ? 'warn' : 'ok' } : { v: c.s('미설정', 'chưa cài'), tone: 'muted' }])
        .concat(showScope ? [{ v: c.n(r.warehouse, 1) + ' / ' + c.n(r.factory, 1) + (r.transfer_missing_suspected ? ' ⚠' : ''), tone: r.transfer_missing_suspected ? 'warn' : '' }] : []) });
  }
  function matComment(rows, c) {
    if (!rows.length) return '';
    const neg = rows.filter(r => r.status === 'neg' || r.balance < 0).length, sus = rows.filter(r => r.transfer_missing_suspected).length;
    const short = rows.filter(r => r.balance > 0 && r.days_cover !== null && r.days_cover !== undefined && r.days_cover < 14).map(r => r.code);
    const parts = [];
    if (neg) parts.push(c.s(`마이너스 ${neg}종`, `${neg} mã âm`));
    if (sus) parts.push(c.s(`이동 누락 의심 ${sus}종 — 창고와 공장 중 한쪽만 마이너스라 창고→공장 이동 전표가 빠졌을 수 있습니다`, `${sus} mã nghi thiếu phiếu chuyển Kho → Xưởng (một bên âm)`));
    if (short.length) parts.push(c.s(`2주 안에 바닥날 품목: ${short.slice(0, 4).join(', ')}`, `Sắp hết trong 2 tuần: ${short.slice(0, 4).join(', ')}`));
    return parts.length ? parts.join(' · ') + '.' : c.s('표의 품목은 모두 안전재고 대비 부족하지만 마이너스는 없습니다.', 'Các mã trong bảng đều thiếu so với tồn an toàn nhưng không âm.');
  }
  const basisNote = (res, c) => { const b = res && res.stock_basis; if (!(b && (b.opening_date_warehouse || b.opening_date_factory))) return null;
    return B.note(c.s(`재고 기준: 기초재고(ECOUNT) ${b.opening_date_warehouse || b.opening_date_factory} + 이후 수불 ${c.n(b.transactions)}건` + (b.production_posting !== 'off' ? ' + 생산일보 반영' : ''), `Cơ sở tồn: tồn đầu (ECOUNT) ${b.opening_date_warehouse || b.opening_date_factory} + ${c.n(b.transactions)} phiếu sau đó` + (b.production_posting !== 'off' ? ' + báo cáo sản xuất' : ''))); };

  function fmtBriefing(b, c) {
    const { n, s } = c, p = b.production, o = b.orders, m = b.materials, X = [];
    X.push(B.h(s('오늘 브리핑', 'Bản tin hôm nay') + ' · ' + b.today + ' (' + c.dow(b.today) + ')'));
    if (p.date) {
      X.push(B.sec(s('[생산] 최근 일보 ', '[Sản xuất] Báo cáo gần nhất ') + p.date + (p.days_since > 0 ? s(` (${p.days_since}일 전)`, ` (${p.days_since} ngày trước)`) : s(' (오늘)', ' (hôm nay)'))));
      const low = p.by_process.filter(x => x.vs_recent_avg_pct !== null && x.vs_recent_avg_pct < 80).sort((a, b2) => a.vs_recent_avg_pct - b2.vs_recent_avg_pct);
      const cm = [];
      if (low.length) cm.push(s(`${low.map(x => c.pname(x.process) + ' ' + x.vs_recent_avg_pct + '%').join(', ')} — 최근 평균보다 낮습니다`, `${low.map(x => c.pname(x.process) + ' ' + x.vs_recent_avg_pct + '%').join(', ')} — thấp hơn trung bình gần đây`));
      else if (p.by_process.length) cm.push(s('입력된 공정은 최근 평균 수준입니다', 'Các công đoạn đã nhập ở mức trung bình gần đây'));
      if (p.processes_without_report.length) cm.push(s('일보 없음: ', 'Chưa có báo cáo: ') + p.processes_without_report.map(c.pname).join(', '));
      const hiNg = p.by_process.filter(x => (x.ng_rate_pct || 0) >= 3); if (hiNg.length) cm.push(s('불량률 3% 이상: ', 'Tỷ lệ lỗi ≥3%: ') + hiNg.map(x => c.pname(x.process) + ' ' + x.ng_rate_pct + '%').join(', '));
      X.push(B.table([{ l: s('공정', 'Công đoạn') }, { l: s('양품 pcs', 'Đạt (pcs)'), num: 1 }, { l: 'set', num: 1 }, { l: s('최근 평균 대비', 'So với TB'), num: 1 }, { l: s('불량률', 'Tỷ lệ lỗi'), num: 1 }], p.by_process, {
        cmt: cm.join(' · ') + '.',
        line: (x) => '  · ' + c.pname(x.process) + ' ' + n(x.good_pcs) + ' pcs' + (x.good_sets !== undefined ? ' · ' + n(x.good_sets) + ' set' : '') + (x.vs_recent_avg_pct !== null ? s(` (최근 평균 대비 ${x.vs_recent_avg_pct}%)`, ` (${x.vs_recent_avg_pct}% so với TB gần đây)`) : '') + ((x.ng_rate_pct || 0) >= 3 ? s(` · 불량률 ${x.ng_rate_pct}%`, ` · tỷ lệ lỗi ${x.ng_rate_pct}%`) : ''),
        cell: (x) => [{ v: c.pname(x.process), b: 1 }, n(x.good_pcs), x.good_sets !== undefined ? n(x.good_sets) : '', x.vs_recent_avg_pct !== null ? { v: x.vs_recent_avg_pct + '%', tone: x.vs_recent_avg_pct < 80 ? 'warn' : 'ok' } : '–', x.ng_rate_pct !== null && x.ng_rate_pct !== undefined ? { v: x.ng_rate_pct + '%', tone: x.ng_rate_pct >= 3 ? 'bad' : '' } : '–'] }));
    } else X.push(B.sec(s('[생산] 생산일보 데이터가 없습니다.', '[Sản xuất] Chưa có dữ liệu báo cáo.')));
    X.push(B.sec(s(`[수주] 진행 중 ${n(o.open)}건 · 납기 경과 ${n(o.late)}건 · 7일 내 납기 ${n(o.due_within_7days)}건`, `[Đơn hàng] Đang mở ${n(o.open)} · quá hạn ${n(o.late)} · đến hạn ≤7 ngày ${n(o.due_within_7days)}`)));
    if (o.late_top.length) X.push(poTable(o.late_top, o.late, c, { title: s('납기 경과 (오래된 순)', 'Quá hạn (lâu nhất trước)'), cmt: poComment(o.late_top, o.late, c, 'late') }));
    if (o.due_soon_top.length) X.push(poTable(o.due_soon_top, o.due_within_7days, c, { title: s('7일 내 납기', 'Đến hạn trong 7 ngày'), cmt: poComment(o.due_soon_top, o.due_within_7days, c, 'soon') }));
    staleNote(o.stale_late, c, o.late).forEach(t => X.push(B.note(t)));
    X.push(B.sec(s(`[자재] 안전재고 미달 ${n(m.below_safety)}종 · 임박(120% 미만) ${n(m.near_safety)}종`, `[NVL] Dưới tồn an toàn ${n(m.below_safety)} mã · sắp chạm (<120%) ${n(m.near_safety)} mã`)));
    if (m.top_low.length) X.push(matTable(m.top_low, m.below_safety, c, { cmt: matComment(m.top_low, c) }));
    const warn = [];
    if (p.days_since >= 3) warn.push(s(`생산일보가 ${p.days_since}일째 입력되지 않았습니다.`, `Báo cáo sản xuất đã ${p.days_since} ngày chưa được nhập.`));
    if (o.po_without_valid_due) warn.push(s(`납기가 비었거나 날짜 형식이 아닌 PO가 ${n(o.po_without_valid_due)}건 있습니다.`, `Có ${n(o.po_without_valid_due)} PO chưa có hạn giao hợp lệ.`));
    warn.push(s(`안전재고를 설정한 ${n(m.with_safety_set)}종(전체 ${n(m.total)}종)만 부족 여부를 판단합니다.`, `Chỉ ${n(m.with_safety_set)}/${n(m.total)} mã đã cài tồn an toàn được kiểm tra.`));
    X.push(B.sec(s('확인 필요', 'Cần lưu ý') + ':'), B.list(warn));
    return X;
  }
  function fmtDeadline(late, soon, stale, view, c, cust) {
    const { s } = c, X = [];
    const head = (t, total) => X.push(B.h(t + (cust ? ' · ' + cust : '') + ' — ' + s(`${c.n(total)}건`, `${c.n(total)} đơn`)));
    if (view === 'stale') {
      head(s(`오래된 지연 PO (${U.STALE_DAYS}일 초과)`, `PO quá hạn lâu (> ${U.STALE_DAYS} ngày)`), stale.total);
      const sb = stale.stale_breakdown;
      X.push(poTable(stale.rows.slice(0, 10), stale.total, c, { cmt: sb ? s(`진행률: 0% ${c.n(sb.zero_progress)}건 · 90% 이상 ${c.n(sb.ge90_progress)}건 · 그 사이 ${c.n(sb.in_between)}건. 포장 실적이 없는 건은 이미 출하·취소됐는데 마감 처리가 안 됐을 수 있고, 90% 이상인 건은 잔량이 남은 채 닫히지 않았을 수 있습니다. 수주 관리에서 확인하세요.`, `Tiến độ: 0% ${c.n(sb.zero_progress)} đơn · ≥90% ${c.n(sb.ge90_progress)} đơn · ở giữa ${c.n(sb.in_between)} đơn. Đơn 0% có thể đã giao/hủy nhưng chưa đóng; đơn ≥90% có thể còn dư chưa đóng. Hãy kiểm tra ở màn hình Đơn hàng.`) : '' }));
      return X;
    }
    if (view !== 'soon') { head(s(`납기 경과 PO (${U.STALE_DAYS}일 이내, 오래된 순)`, `PO quá hạn (≤ ${U.STALE_DAYS} ngày, lâu nhất trước)`), late.total); if (!late.rows.length) X.push(B.p(s('없습니다.', 'Không có.'))); else X.push(poTable(late.rows.slice(0, 10), late.total, c, { cmt: poComment(late.rows.slice(0, 10), late.total, c, 'late') })); }
    if (view !== 'late') { head(s('7일 내 납기 PO', 'PO đến hạn trong 7 ngày'), soon.total); if (!soon.rows.length) X.push(B.p(s('없습니다.', 'Không có.'))); else X.push(poTable(soon.rows.slice(0, 10), soon.total, c, { cmt: poComment(soon.rows.slice(0, 10), soon.total, c, 'soon') })); }
    if (!cust) staleNote(stale.total, c, late.total).forEach(t => X.push(B.note(t)));
    return X;
  }
  function fmtPo(r, c) {
    const { s } = c, p = r.po, X = [];
    X.push(B.h(`PO ${p.po_no} — ${r.customer || '–'}${r.country ? ' (' + r.country + ')' : ''}`));
    const st = { done: s('완료', 'Hoàn thành'), late: s('납기 경과', 'Quá hạn'), prod: s('생산 중', 'Đang SX'), wait: s('대기', 'Chờ'), cancel: s('취소', 'Hủy'), hold: s('보류', 'Tạm dừng') }[p.status] || p.status;
    const kv = [[s('상태', 'Trạng thái'), { v: st, tone: p.status === 'late' ? 'bad' : p.status === 'done' ? 'ok' : '' }], [s('진행', 'Tiến độ'), p.progress_pct + '% (' + c.n(p.packed_sets) + ' / ' + c.n(p.sets) + ' set)'], [s('남은 수량', 'Còn lại'), c.n(Math.max(0, (p.sets || 0) - (p.packed_sets || 0))) + ' set'], [s('납기', 'Hạn giao'), (p.due || '–') + (p.days_to_due !== null && p.days_to_due !== undefined ? ' (' + c.dd(p.days_to_due) + ')' : '')]];
    X.push(B.table([{ l: s('항목', 'Mục') }, { l: s('값', 'Giá trị') }], kv, { cell: (x) => [{ v: x[0], b: 1 }, x[1]], line: (x) => x[0] + ' ' + cellTxt(x[1]) }));
    if (p.stale) X.push(B.note(s(`납기가 ${U.STALE_DAYS}일 넘게 지난 건입니다 (대시보드 기준 밖). 이미 출하됐다면 마감 처리를 확인하세요.`, `Quá hạn hơn ${U.STALE_DAYS} ngày (ngoài tiêu chí Tổng quan). Nếu đã giao, hãy kiểm tra việc đóng đơn.`)));
    const behind = r.lines.filter(l => l.sets && l.progress_pct < 100).sort((a, b) => a.progress_pct - b.progress_pct);
    X.push(B.table([{ l: s('품번', 'Mã hàng') }, { l: s('품목군', 'Nhóm') }, { l: s('포장 / 주문 set', 'Đã đóng / đặt (set)'), num: 1 }, { l: s('진행', 'Tiến độ'), num: 1 }, { l: s('납기', 'Hạn'), num: 0 }], r.lines, { title: s('품번별', 'Theo mã hàng'),
      cmt: r.lines.length > 1 && behind.length ? s(`가장 늦은 품번: ${behind[0].item_no || '–'} (${behind[0].progress_pct}%)`, `Mã chậm nhất: ${behind[0].item_no || '–'} (${behind[0].progress_pct}%)`) : '',
      line: (l) => '  · ' + (l.item_no || '–') + (l.kind ? ' (' + l.kind + ')' : '') + ': ' + c.n(l.packed_sets) + '/' + c.n(l.sets) + ' set · ' + l.progress_pct + '%' + (l.due ? ' · ' + s('납기 ', 'hạn ') + l.due : ''),
      cell: (l) => [{ v: l.item_no || '–', b: 1 }, l.kind || '', c.n(l.packed_sets) + ' / ' + c.n(l.sets), { v: l.progress_pct + '%', tone: l.progress_pct >= 99.9 ? 'ok' : '' }, l.due || ''] }));
    if (r.packing_not_matching_any_line) X.push(B.note(s(`어느 품번과도 맞지 않는 포장 실적 ${c.n(r.packing_not_matching_any_line)} set — 포장일보의 코드를 PO 품번과 같게 입력하세요.`, `${c.n(r.packing_not_matching_any_line)} set đóng gói không khớp mã hàng nào — hãy nhập mã trùng với mã của PO.`)));
    if (r.recent_packing.length) X.push(B.table([{ l: s('최근 포장일', 'Ngày đóng gói') }, { l: 'set', num: 1 }], r.recent_packing.slice(0, 5), { title: s('최근 포장(set)', 'Đóng gói gần đây (set)'), cell: (x) => [x.date, c.n(x.qty_sets)], line: (x) => '  · ' + x.date + ' ' + c.n(x.qty_sets) }));
    return X;
  }
  function fmtOrders(res, title, c) {
    const X = [B.h(title + ' — ' + c.s(`${c.n(res.total)}건`, `${c.n(res.total)} đơn`))];
    if (!res.rows.length) { X.push(B.p(c.s('해당하는 PO가 없습니다.', 'Không có PO phù hợp.'))); return X; }
    const rows = res.rows.slice(0, 12); const open = rows.filter(r => r.status !== 'done'); const late = rows.filter(r => r.status === 'late');
    const cmt = !open.length ? c.s(`표의 PO는 모두 완료되었습니다 (포장 ${c.n(rows.reduce((a, r) => a + (r.packed_sets || 0), 0))} set).`, `Các PO trong bảng đều đã xong (${c.n(rows.reduce((a, r) => a + (r.packed_sets || 0), 0))} set).`)
      : (late.length ? c.s(`납기 경과 ${late.length}건 · `, `${late.length} đơn quá hạn · `) : '') + poComment(open, res.total, c, 'soon');
    X.push(poTable(rows, res.total, c, { cmt }));
    return X;
  }
  function fmtStockList(res, title, c, note) {
    const X = [B.h(title + ' — ' + c.s(`${c.n(res.total)}종`, `${c.n(res.total)} mã`))];
    if (!res.rows.length) X.push(B.p(c.s('해당하는 자재가 없습니다.', 'Không có NVL phù hợp.')));
    else X.push(matTable(res.rows.slice(0, 15), res.total, c, { cmt: matComment(res.rows.slice(0, 15), c) }));
    if (note) X.push(B.note(note));
    const bn = basisNote(res, c); if (bn) X.push(bn);
    return X;
  }
  function fmtProduction(res, per, c, fallback) {
    const { s } = c, X = [];
    const range = res.from === res.to ? res.from + ' (' + c.dow(res.from) + ')' : res.from + ' ~ ' + res.to;
    if (fallback) X.push(B.p(fallback));
    X.push(B.h(s('생산 실적', 'Sản lượng') + ' · ' + range + (res.process !== 'all' ? ' · ' + c.pname(res.process) : '')));
    if (!res.output.length) { X.push(B.p(s(`이 기간의 생산일보가 없습니다. 최근 입력된 일보는 ${res.latest_report_date_in_data || '–'} 입니다.`, `Không có báo cáo trong kỳ này. Báo cáo gần nhất: ${res.latest_report_date_in_data || '–'}.`))); return X; }
    const hasSet = res.output.some(x => x.good_sets !== undefined), hasMach = res.output.some(x => x.machines);
    const top = res.output.slice().sort((a, b) => b.good_pcs - a.good_pcs)[0]; const ng = res.output.filter(x => x.ng_rate_pct !== null && x.ng_rate_pct >= 3);
    X.push(B.table([{ l: s('공정', 'Công đoạn') }, { l: s('양품 pcs', 'Đạt (pcs)'), num: 1 }].concat(hasSet ? [{ l: 'set', num: 1 }] : []).concat([{ l: s('불량률', 'Tỷ lệ lỗi'), num: 1 }]).concat(hasMach ? [{ l: s('가동 설비', 'Máy chạy'), num: 1 }] : []), res.output, {
      cmt: s(`일보 ${c.n(res.report_rows)}행 · 입력된 날 ${res.days_with_reports}일` + (hasSet ? ' · 포장은 set과 pcs 환산을 함께 표시' : '') + (ng.length ? ' · 불량률 3% 이상: ' + ng.map(x => c.pname(x.process)).join(', ') : '') + '.', `${c.n(res.report_rows)} dòng báo cáo · ${res.days_with_reports} ngày có dữ liệu` + (hasSet ? ' · đóng gói hiển thị cả set và pcs' : '') + (ng.length ? ' · lỗi ≥3%: ' + ng.map(x => c.pname(x.process)).join(', ') : '') + '.'),
      line: (x) => '  · ' + c.pname(x.process) + ' ' + c.n(x.good_pcs) + ' pcs' + (x.good_sets !== undefined ? ' · ' + c.n(x.good_sets) + ' set' : '') + (x.ng_rate_pct !== null ? s(` · 불량률 ${x.ng_rate_pct}%`, ` · tỷ lệ lỗi ${x.ng_rate_pct}%`) : '') + (x.machines ? s(` · 설비 ${x.machines}대`, ` · ${x.machines} máy`) : ''),
      cell: (x) => [{ v: c.pname(x.process), b: 1, tone: x === top ? 'ok' : '' }, c.n(x.good_pcs)].concat(hasSet ? [x.good_sets !== undefined ? c.n(x.good_sets) : ''] : []).concat([x.ng_rate_pct !== null ? { v: x.ng_rate_pct + '%', tone: x.ng_rate_pct >= 3 ? 'bad' : '' } : '–']).concat(hasMach ? [x.machines ? c.n(x.machines) : '–'] : []) }));
    return X;
  }
  function fmtQD(res, focus, c) {
    const { s } = c, X = [], range = res.from === res.to ? res.from + ' (' + c.dow(res.from) + ')' : res.from + ' ~ ' + res.to;
    X.push(B.h(s('불량 · 설비 정지', 'Lỗi · Dừng máy') + ' · ' + range + (res.process !== 'all' ? ' · ' + c.pname(res.process) : '')));
    if (!res.report_rows) { X.push(B.p(s('이 기간의 생산일보가 없습니다.', 'Không có báo cáo trong kỳ này.'))); return X; }
    const rate = (x) => (x.ng_rate_pct === null ? '–' : { v: x.ng_rate_pct + '%', tone: x.ng_rate_pct >= 3 ? 'bad' : x.ng_rate_pct >= 1 ? 'warn' : '' });
    const ng = () => {
      X.push(B.sec(s('[불량]', '[Lỗi]')));
      const worstP = res.by_process.filter(x => x.ng_rate_pct !== null).sort((a, b) => b.ng_rate_pct - a.ng_rate_pct)[0];
      X.push(B.table([{ l: s('공정', 'Công đoạn') }, { l: s('불량 수량', 'SL lỗi'), num: 1 }, { l: s('불량률', 'Tỷ lệ lỗi'), num: 1 }], res.by_process, { cmt: worstP && worstP.ng_qty ? s(`불량률이 가장 높은 공정: ${c.pname(worstP.process)} ${worstP.ng_rate_pct}%`, `Công đoạn lỗi cao nhất: ${c.pname(worstP.process)} ${worstP.ng_rate_pct}%`) : '',
        line: (x) => '  · ' + c.pname(x.process) + ': ' + s('불량 ', 'lỗi ') + c.n(x.ng_qty) + ' (' + (x.ng_rate_pct === null ? '–' : x.ng_rate_pct + '%') + ')', cell: (x) => [{ v: c.pname(x.process), b: 1 }, c.n(x.ng_qty), rate(x)] }));
      if (res.worst_machines_by_ng.length) X.push(B.table([{ l: s('설비', 'Máy') }, { l: s('불량 수량', 'SL lỗi'), num: 1 }, { l: s('불량률', 'Tỷ lệ lỗi'), num: 1 }], res.worst_machines_by_ng, { title: s('불량 많은 설비', 'Máy nhiều lỗi nhất'),
        line: (x) => '  ▸ ' + c.pname(x.process) + ' #' + x.machine_no + ': ' + c.n(x.ng_qty) + ' (' + (x.ng_rate_pct === null ? '–' : x.ng_rate_pct + '%') + ')', cell: (x) => [{ v: c.pname(x.process) + ' #' + x.machine_no, b: 1 }, c.n(x.ng_qty), rate(x)] }));
    };
    const stop = () => {
      X.push(B.sec(s(`[정지] 총 ${c.n(res.stop_total_min)}분 · ${c.n(res.stop_events)}건`, `[Dừng máy] Tổng ${c.n(res.stop_total_min)} phút · ${c.n(res.stop_events)} lần`)));
      if (!res.stop_events) { X.push(B.p(s('기록된 정지가 없습니다.', 'Không có ghi nhận dừng máy.'))); return; }
      const top = res.stop_by_reason[0];
      X.push(B.table([{ l: s('사유', 'Lý do') }, { l: s('분', 'Phút'), num: 1 }, { l: s('건수', 'Lần'), num: 1 }], res.stop_by_reason, { cmt: top ? s(`가장 큰 사유: ${top.reason} (${c.n(top.minutes)}분, 전체의 ${Math.round(top.minutes / Math.max(1, res.stop_total_min) * 100)}%)`, `Lý do lớn nhất: ${top.reason} (${c.n(top.minutes)} phút, ${Math.round(top.minutes / Math.max(1, res.stop_total_min) * 100)}%)`) : '',
        line: (x) => '  · ' + x.reason + ': ' + c.n(x.minutes) + s('분', ' phút') + ' (' + x.events + ')', cell: (x) => [{ v: x.reason, b: 1 }, c.n(x.minutes), c.n(x.events)] }));
      if (res.stop_by_machine.length) X.push(B.table([{ l: s('설비', 'Máy') }, { l: s('정지 분', 'Phút dừng'), num: 1 }], res.stop_by_machine, { title: s('정지 많은 설비', 'Máy dừng nhiều nhất'), line: (x) => '  ▸ ' + c.pname(x.process) + ' #' + x.machine_no + ': ' + c.n(x.minutes) + s('분', ' phút'), cell: (x) => [{ v: c.pname(x.process) + ' #' + x.machine_no, b: 1 }, c.n(x.minutes)] }));
    };
    if (focus === 'stop') stop(); else if (focus === 'ng') ng(); else { ng(); stop(); }
    const zero = !res.stop_events && res.by_process.every(x => !x.ng_qty);
    if (zero && res.from === res.to) X.push(B.note(s('이 날은 기록된 불량·정지가 없습니다. 다른 기간도 물어보세요 (예: "이번 달 불량률").', 'Ngày này không có lỗi/dừng máy được ghi nhận. Hãy hỏi kỳ khác (vd: "tỷ lệ lỗi tháng này").')));
    return X;
  }
  function fmtReorder(res, c) {
    const { s } = c, X = [B.h(s('발주 필요 자재', 'NVL cần đặt hàng') + ' — ' + s(`${c.n(res.total_below_safety)}종`, `${c.n(res.total_below_safety)} mã`) + s(` (목표 = 안전재고 × ${res.target_multiplier})`, ` (mục tiêu = tồn an toàn × ${res.target_multiplier})`))];
    if (!res.rows.length) X.push(B.p(s('안전재고 미달 품목이 없습니다.', 'Không có mã nào dưới tồn an toàn.')));
    else X.push(matTable(res.rows, res.total_below_safety, c, { reorder: true, cmt: matComment(res.rows, c) }));
    X.push(B.note(s(`안전재고를 설정한 ${c.n(res.materials_with_safety_set)}종만 판단합니다. 설정하지 않은 ${c.n(res.materials_without_safety_set)}종은 발주 목록에 나오지 않습니다 (품목·재고 → 발주 · 안전재고에서 설정).`, `Chỉ ${c.n(res.materials_with_safety_set)} mã đã cài tồn an toàn được kiểm tra; ${c.n(res.materials_without_safety_set)} mã chưa cài sẽ không xuất hiện.`)));
    return X;
  }
  function fmtMrp(res, subject, c) {
    const { s } = c, X = [B.h(s('자재 소요량', 'Nhu cầu NVL') + ' · ' + subject)];
    if (res.error) { X.push(B.p(res.error)); return X; }
    X.push(B.p(s('계산 대상: ', 'Tính cho: ') + res.lines.map(l => l.code + ' ' + c.n(l.qty) + ' ' + l.unit).join(', ')));
    res.route_info.filter(i => i.bom_key_used).forEach(i => X.push(B.note(s(`${i.code}와 같은 BOM이 없어 비슷한 품번 ${i.bom_key_used}의 BOM(${i.colors}색)을 사용했습니다.`, `Không có BOM đúng mã ${i.code}; dùng BOM của mã gần giống ${i.bom_key_used} (${i.colors} màu).`))));
    if (res.unknown_items.length) X.push(B.note(s('⚠ BOM이 없어 계산하지 못한 품번: ', '⚠ Không có BOM nên không tính được: ') + res.unknown_items.join(', ')));
    if (!res.rows_total && !res.unknown_items.length) X.push(B.note(s('⚠ 이 품번의 BOM에 부품 코드나 배합표가 없어 소요량을 계산하지 못했습니다. "부족 없음"이 아닙니다 — 제품 · BOM · 배합 화면에서 확인하세요.', '⚠ BOM của mã này chưa có mã chi tiết hoặc công thức nên không tính được nhu cầu. Đây KHÔNG phải "không thiếu" — hãy kiểm tra ở màn hình Sản phẩm · BOM.')));
    else {
      const kinds = Object.keys(res.shortage_by_kind).map(k => ({ raw: s('원료', 'NL'), semi: s('반제품', 'BTP'), asm: s('조립품', 'Cụm') }[k] || k) + ' ' + res.shortage_by_kind[k]).join(', ');
      X.push(B.sec(s(`소요 항목 ${c.n(res.rows_total)}개 중 부족 ${c.n(res.shortage_count)}개`, `${c.n(res.rows_total)} mục, thiếu ${c.n(res.shortage_count)} mục`) + (kinds ? ' (' + kinds + ')' : '')));
      const shown = res.rows.slice(0, 15);
      X.push(B.table([{ l: s('코드', 'Mã') }, { l: s('품명', 'Tên') }, { l: s('필요', 'Cần'), num: 1 }, { l: s('재고', 'Tồn'), num: 1 }, { l: s('부족', 'Thiếu'), num: 1 }, { l: s('단위', 'ĐV') }], shown, { more: moreTxt(res.shortage_count, shown.length, c),
        cmt: res.shortage_count ? s(`부족한 ${c.n(res.shortage_count)}개를 먼저 확인하세요. 표는 부족 수량이 큰 순서입니다.`, `Hãy kiểm tra ${c.n(res.shortage_count)} mục thiếu trước; bảng xếp theo lượng thiếu.`) : ((res.unknown_items.length || res.stock_unknown_count) ? s('계산된 항목에는 부족이 없습니다. 다만 ⚠ 표시한 항목은 계산하지 못했으니 "모두 충분"이 아닙니다.', 'Các mục đã tính không thiếu. Nhưng các mục ⚠ chưa tính được nên KHÔNG phải "đủ hết".') : s('계산된 항목은 모두 재고로 충분합니다.', 'Các mục đã tính đều đủ tồn.')),
        line: (r) => '▸ ' + r.code + ' ' + (r.name || '') + ': ' + s('필요 ', 'cần ') + c.n(r.need, 1) + ' / ' + s('재고 ', 'tồn ') + (r.stock === null ? '?' : c.n(r.stock, 1)) + ' ' + r.unit + (r.short ? s(' → 부족 ', ' → thiếu ') + c.n(r.short, 1) : ''),
        cell: (r) => [{ v: r.code, b: 1 }, String(r.name || '').slice(0, 26), c.n(r.need, 1), r.stock === null ? '?' : c.n(r.stock, 1), r.short ? { v: c.n(r.short, 1), tone: 'bad', b: 1 } : '·', r.unit] }));
      if (res.stock_unknown_count) X.push(B.note(s(`⚠ 재고 마스터와 연결되지 않은 원료 ${c.n(res.stock_unknown_count)}개는 부족 여부를 알 수 없습니다.`, `⚠ ${c.n(res.stock_unknown_count)} NL chưa khớp danh mục kho nên chưa biết có thiếu hay không.`)));
      if (res.shortage_by_kind.semi) X.push(B.note(s('반제품 부족은 반제품 재고를 입력하지 않은 경우에도 나타납니다.', 'BTP "thiếu" cũng xuất hiện khi chưa nhập tồn BTP.')));
    }
    return X;
  }
  function fmtHelp(c, pre) {
    const { s } = c, X = [];
    if (pre) X.push(B.p(pre));
    X.push(B.p(s('이렇게 물어보세요:', 'Bạn có thể hỏi:')), B.list(s('오늘 브리핑|납기 위험 PO / 납기 경과 PO / 오래된 지연 PO|PO번호 (예: 5100356783) 또는 품번|안전재고 미달 자재 / HDPE 재고 / 발주 필요한 자재|어제 생산 요약 / 이번 주 포장 실적 / 조립 지난주 실적|어제 불량률 / 설비 정지 시간|5100356783 자재 소요량',
      'Bản tin hôm nay|PO sắp đến hạn / PO quá hạn / PO quá hạn lâu|Số PO (vd: 5100356783) hoặc mã hàng|NVL dưới tồn an toàn / tồn HDPE / NVL cần đặt hàng|Sản lượng hôm qua / đóng gói tuần này / lắp ráp tuần trước|Tỷ lệ lỗi hôm qua / thời gian dừng máy|Nhu cầu NVL của PO 5100356783').split('|')));
    return X;
  }

  // ---------- navigation actions (buttons under an answer) ----------
  const go = (id, pre) => () => { if (pre) pre(); if (location.hash === '#/' + id) ERP.render(); else ERP.goto(id); };
  const openPo = (po) => go('orders', () => { ERP.state.ord = Object.assign(ERP.state.ord || { view: 'po' }, { tab: 'all', sel: String(po) }); });
  const openMrp = (lines) => () => ERP.goto('bom', { tab: 'mrp', lines: lines.map(l => ({ code: l.code, qty: l.qty, unit: l.unit || 'set' })) });
  const act = (c, ko, vi, fn) => ({ label: c.s(ko, vi), run: fn });

  // ---------- answer ----------
  function answer(text) {
    const q = parse(text), c = ctx(q.lang), I = q.intent, s = c.s; let X = [], actions = [];
    const P = (t) => [B.p(t)];
    const pages = {
      orders: act(c, '수주 관리 열기', 'Mở Đơn hàng', go('orders')), materials: act(c, '품목·재고 열기', 'Mở Hàng hóa · Tồn kho', go('materials', () => { ERP.state.matTab = 'stock'; })),
      reorder: act(c, '발주 필요 목록 열기', 'Mở danh sách cần đặt', go('materials', () => { ERP.state.matTab = 'reorder'; ERP.state.reo = Object.assign(ERP.state.reo || {}, { view: 'list' }); })),
      production: act(c, '생산 관리 열기', 'Mở Sản xuất', go('production')), dashboard: act(c, '종합 현황 열기', 'Mở Tổng quan', go('dashboard')) };
    switch (I.name) {
      case 'briefing': X = fmtBriefing(T.briefing(), c); actions = [pages.dashboard, pages.orders, pages.reorder]; break;
      case 'po': {
        const r = T.get_po({ po_no: I.po }); X = fmtPo(r, c);
        actions = [act(c, '이 PO 열기', 'Mở PO này', openPo(I.po)), act(c, '자재 소요량 화면에서 보기', 'Xem nhu cầu NVL ở màn hình MRP', () => { const m = T.mrp({ po_no: I.po }); if (m.lines) openMrp(m.lines)(); })];
        break; }
      case 'mrp': {
        if (I.po) { const r = T.mrp({ po_no: I.po }); X = fmtMrp(r, 'PO ' + I.po, c); if (r.lines) actions = [act(c, 'MRP 화면에서 보기', 'Xem ở màn hình MRP', openMrp(r.lines)), act(c, '이 PO 열기', 'Mở PO này', openPo(I.po))]; }
        else { const gs = T.find_orders({ query: I.item, status: 'open', limit: 1 }); const left = gs.rows[0] ? Math.max(1, gs.rows[0].remaining_sets) : 1000; const lines = [{ code: I.item, qty: left, unit: 'set' }]; const r = T.mrp({ lines }); X = fmtMrp(r, I.item, c); if (r.lines) actions = [act(c, 'MRP 화면에서 보기', 'Xem ở màn hình MRP', openMrp(r.lines))]; }
        break; }
      case 'mrp_ask': X = P(s('자재 소요량은 PO 번호나 품번이 필요합니다. 예: "5100356783 자재 소요량"', 'Cần số PO hoặc mã hàng để tính nhu cầu NVL. Ví dụ: "nhu cầu NVL của PO 5100356783"')); break;
      case 'orders': {
        const r = T.find_orders({ query: I.query, status: I.status, limit: 12 });
        const t = I.title === 'item' ? s('품번 ', 'Mã hàng ') + I.query : (I.query ? I.query + ' · ' : '') + ({ open: s('진행 중 PO', 'PO đang mở'), prod: s('생산 중 PO', 'PO đang sản xuất'), done: s('완료 PO', 'PO hoàn thành'), hold: s('보류 PO', 'PO tạm dừng'), cancel: s('취소 PO', 'PO đã hủy'), all: s('PO', 'PO') }[I.status] || 'PO');
        X = fmtOrders(r, t, c); if (I.status === 'open' && !I.query) staleNote(r.context.stale_late, c, r.context.late).forEach(x => X.push(B.note(x)));
        actions = [pages.orders]; if (r.rows[0]) actions.unshift(act(c, r.rows[0].po_no + ' 열기', 'Mở ' + r.rows[0].po_no, openPo(r.rows[0].po_no))); break; }
      case 'deadline': {
        const o = { query: I.customer || '' };
        X = fmtDeadline(T.find_orders(Object.assign({ status: 'late', limit: 10 }, o)), T.find_orders(Object.assign({ status: 'due_soon', limit: 10 }, o)), T.find_orders(Object.assign({ status: 'stale', limit: 10 }, o)), I.view, c, I.customer);
        actions = [pages.orders, pages.dashboard]; break; }
      case 'low_stock': { const r = T.material_stock({ only_low: true, include_near: false, limit: 15 }); X = fmtStockList(r, s('안전재고 미달 자재', 'NVL dưới tồn an toàn'), c, s(`안전재고를 설정한 품목만 판단합니다. 발주 권장량은 "발주 필요한 자재"로 물어보세요.`, `Chỉ kiểm tra mã đã cài tồn an toàn. Hỏi "NVL cần đặt hàng" để xem đề xuất.`)); actions = [pages.reorder, pages.materials]; break; }
      case 'material': {
        let r = T.material_stock({ query: I.query, limit: 12 }), used = I.query;
        if (!r.total && I.parts && I.parts.length > 1) for (const p of I.parts.slice().sort((a, b) => b.length - a.length)) { const t = T.material_stock({ query: p, limit: 12 }); if (t.total) { r = t; used = p; break; } }
        if (!r.total) { X = P(s(`"${I.query}"에 맞는 품목을 찾지 못했습니다. 품목코드(예: R-101, BM09)나 ERP CODE·이름의 일부로 다시 물어보세요.`, `Không tìm thấy mã phù hợp "${I.query}". Hãy thử mã (vd: R-101, BM09), ERP CODE hoặc một phần tên.`)); break; }
        X = fmtStockList(r, s('재고', 'Tồn kho') + ' · ' + used, c); actions = [pages.materials]; const top = r.rows[0]; if (top) actions.unshift(act(c, top.code + ' 상세', 'Chi tiết ' + top.code, () => ERP.materialDetail(top.code))); break; }
      case 'reorder': { const r = T.reorder({ limit: 15 }); X = fmtReorder(r, c); actions = [pages.reorder]; break; }
      case 'production': {
        const per = q.period; let res = T.production_summary({ from: per.from, to: per.to, process: q.process || undefined }), fb = '';
        if (!res.report_rows && per.kind === 'day' && res.latest_report_date_in_data) { const d = res.latest_report_date_in_data; fb = s(`${per.from}에는 입력된 생산일보가 없어 가장 최근 일보(${d})를 보여드립니다.`, `Ngày ${per.from} chưa có báo cáo, hiển thị báo cáo gần nhất (${d}).`); res = T.production_summary({ from: d, to: d, process: q.process || undefined }); }
        X = fmtProduction(res, per, c, fb); actions = [pages.production, pages.dashboard]; break; }
      case 'qd': {
        const per = q.period; let res = T.quality_downtime({ from: per.from, to: per.to, process: q.process || undefined }), pre = '';
        if (!res.report_rows && per.kind === 'day') { const d = C.latestProdDate(); if (d) { pre = s(`${per.from}에는 입력된 생산일보가 없어 가장 최근 일보(${d})를 보여드립니다.`, `Ngày ${per.from} chưa có báo cáo, hiển thị báo cáo gần nhất (${d}).`); res = T.quality_downtime({ from: d, to: d, process: q.process || undefined }); } }
        X = (pre ? [B.p(pre)] : []).concat(fmtQD(res, I.focus, c)); actions = [pages.production]; break; }
      case 'greet': X = fmtHelp(c, s('안녕하세요! 무엇을 도와드릴까요?', 'Xin chào! Tôi có thể giúp gì cho bạn?')); break;
      case 'thanks': X = P(s('도움이 되었다니 다행입니다. 더 필요한 게 있으면 말씀하세요.', 'Rất vui được giúp bạn. Cần gì thêm cứ hỏi nhé.')); break;
      case 'search': {
        const parts = (I.parts || []).slice().sort((a, b) => b.length - a.length); let done = false;
        for (const p of parts) { const m = T.material_stock({ query: p, limit: 12 }); if (m.total && m.total <= 30) { X = fmtStockList(m, s('재고', 'Tồn kho') + ' · ' + p, c); actions = [pages.materials]; done = true; break; } }
        if (!done) for (const p of parts) { const r = T.find_orders({ query: p, status: 'all', limit: 12 }); if (r.total) { X = fmtOrders(r, p, c); actions = [pages.orders]; done = true; break; } }
        if (!done) X = fmtHelp(c, s('질문을 정확히 이해하지 못했습니다.', 'Tôi chưa hiểu rõ câu hỏi.'));
        break; }
      default: X = fmtHelp(c);
    }
    X = X.filter(Boolean);
    return { text: toText(X), blocks: X, actions, intent: I.name, lang: q.lang };
  }

  A.localParse = parse;
  A.localAnswer = answer;
})();
