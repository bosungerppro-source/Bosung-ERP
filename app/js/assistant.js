/* AI 생산 비서 (Trợ lý sản xuất AI) — 나만의 비서.
   · AI 모드: Claude (tool-use) 가 assistant_tools.js 의 읽기 전용 도구로 ERP 데이터를 조회해 답한다.
   · 내장 모드: API 키/인터넷 없이 assistant_local.js 가 답한다 (키가 없거나 AI 연결이 실패하면 자동).
   · 나만의 설정: 비서 이름, 호칭, 답변 스타일, 우리 공장 지침, 내 단축 질문 — ERP 설정(meta)에 저장되어 백업에 포함된다.
   Server mode: key lives on the server (data/ai.json), calls go through /api/ai/messages.
   Browser/demo mode: key is kept in this browser's localStorage and the API is called directly. */
(function () {
  'use strict';
  const ERP = window.ERP, DB = ERP.db, F = ERP.fmt; // L() and h() are globals from core.js
  const A = ERP.ai;

  // ---------- my assistant: profile (stored in ERP settings → included in backups) ----------
  const P = A.profile = {
    name: () => String(DB.setting('aiName', '') || '').trim(),
    displayName: () => P.name() || L('AI 비서', 'Trợ lý AI'),
    user: () => String(DB.setting('aiUser', '') || '').trim(),
    style: () => (DB.setting('aiStyle', 'short') === 'detail' ? 'detail' : 'short'),
    notes: () => String(DB.setting('aiPrompt', '') || '').trim(),
    quick: () => { const q = DB.setting('aiQuick', []); return Array.isArray(q) ? q.filter(x => x && String(x.text || '').trim()).slice(0, 8) : []; },
    off: () => !!DB.setting('aiOff', false),
  };

  const BASE_PROMPT = [
    'You are the production assistant built into the ERP of BOSUNG VINA, a colored-pencil factory in Vietnam.',
    'You help staff and managers with: purchase orders (PO; one PO may contain several item numbers), production (injection INJ, refill REF, hot-foil stamping STP, assembly ASM, paper winding WRP, packing PCK), stock of every item (raw RM, sub-materials SM/CM, parts, semi-finished WIP, manila-packed SG, finished FG), MRP and shortages, quality (NG) and machine stops.',
    'RULES',
    '- Answer ONLY from the data returned by your tools. Never invent numbers, PO numbers, dates or stock. If a tool returns nothing or an error, say so plainly.',
    '- Call tools whenever a question needs data (several if needed). For a general "status / briefing / what should I look at" question call `briefing`. All tools are read-only: you cannot change ERP data; if asked to change something, say which ERP screen to use.',
    '- Reply in the language the user writes in (Korean or Vietnamese). Lead with the answer, then only the few numbers that matter. Use units (set, pcs, kg) and dates as YYYY-MM-DD. Keep PO numbers and codes exactly as returned.',
    '- Flag risks proactively (late POs, material shortages) but do not pad the answer.',
    '- Messages with role "system" later in the conversation are updates from the ERP (new date, screen language or assistant settings). Follow the most recent one.',
    '- When a tool result marks a list as truncated (`<list>_truncated: true`), the list is partial: say so and give the full count from `<list>_total`.',
    'DEFINITIONS (they must match the ERP screens)',
    '- "Late" PO = overdue by up to 60 days (the dashboard KPI). POs overdue by more than 60 days are "stale": outside the dashboard window; some are leftovers that were never closed in the system, some are real unfinished orders (use stale_breakdown if asked). Mention their count in one short line at the end; never list them unless asked.',
    '- Safety-stock checks only cover materials that have a safety stock set; say how many have none when you talk about shortages or reordering.',
    '- Stock = opening stock imported from ECOUNT (date in stock_basis) + transactions entered after that date (receipts, issues, warehouse↔factory transfers, adjustments) + production postings from daily reports (output in, BOM components out). There are two scopes: warehouse (창고 / Kho) and factory (공장 / Xưởng, incl. subcontractors); balance = both. Mention the opening date when you give stock figures. One scope + and the other − usually means a warehouse→factory transfer was not entered.',
    '- MRP: if `warnings` contains NO_COMPONENTS or NO_BOM, the requirement could NOT be calculated — say so; never say "no shortage". STOCK_UNKNOWN = some raw materials are not matched to the stock master. kind=semi shortages often only mean semi-finished stock is not recorded.',
    '- Packing (PCK) is counted in sets (good_sets) and as pcs (good_pcs); PO quantities are in sets. "set" is the sales unit (e.g. a Mini set = 24 pencils); pcs = pieces.',
    '- A PO can have several item lines; its progress is the sum over its lines (packing is matched by po_no + item code).',
    'FORMAT (the chat window renders Markdown tables)',
    '- Start with one short bold title line (e.g. **납기 경과 PO — 26건**).',
    '- Whenever the answer has more than two items or numbers (POs, items/materials, processes, machines, days), put them in a Markdown table (| col | col |, header separator row) with only the useful columns: code, name, quantity with unit, date, %. At most 12 rows; if there are more, say how many more under the table.',
    '- Directly under every table write a comment of one or two short lines starting with "※": what matters in that table (the biggest risk or gap, a trend, what to check next). Do not repeat the table in prose.',
    '- Use plain sentences only for single facts. No long paragraphs.',
  ].join('\n');

  const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekday = (d) => WEEKDAY[new Date(d + 'T00:00:00').getDay()];
  const styleText = (st) => (st === 'detail' ? 'more detail — tables plus a few short comment lines with the reasoning, still only facts from the tools.' : 'concise — a title line, the needed table(s) and a one-line comment under each; no preamble.');
  /** 대화의 바탕(날짜 · 화면 언어 · 내 비서 설정). 대화를 시작할 때 시스템 프롬프트에 고정하고, 바뀌면 대화 중 system 메시지로 알린다 */
  const ctxNow = () => ({ date: F.today(), lang: ERP.lang, name: P.name(), user: P.user(), style: P.style(), notes: P.notes() });
  function systemPrompt(ctx) {
    ctx = ctx || ctxNow();
    return BASE_PROMPT + '\n\nToday is ' + ctx.date + ' (' + weekday(ctx.date) + '). The ERP screen language is ' + (ctx.lang === 'vi' ? 'Vietnamese' : 'Korean') + '.'
      + (ctx.name ? '\nYour name is "' + ctx.name + '".' : '') + (ctx.user ? '\nAddress the user as "' + ctx.user + '".' : '')
      + '\nSTYLE: ' + styleText(ctx.style)
      + (ctx.notes ? '\n\nCOMPANY-SPECIFIC INSTRUCTIONS (from the user):\n' + ctx.notes : '');
  }
  A.systemPrompt = systemPrompt;
  /** 대화 중에 바뀐 것만 알리는 system 메시지 글 */
  function ctxNote(a, b) {
    const out = [];
    if (a.date !== b.date) out.push('Today is now ' + b.date + ' (' + weekday(b.date) + ').');
    if (a.lang !== b.lang) out.push('The ERP screen language is now ' + (b.lang === 'vi' ? 'Vietnamese' : 'Korean') + '.');
    if (a.name !== b.name) out.push(b.name ? 'Your name is now "' + b.name + '".' : 'You no longer have a custom name.');
    if (a.user !== b.user) out.push(b.user ? 'From now on address the user as "' + b.user + '".' : 'No special form of address for the user from now on.');
    if (a.style !== b.style) out.push('STYLE from now on: ' + styleText(b.style));
    if (a.notes !== b.notes) out.push(b.notes ? 'The COMPANY-SPECIFIC INSTRUCTIONS were updated. Follow these from now on (they replace the earlier ones):\n' + b.notes : 'The company-specific instructions were removed.');
    return out.join('\n');
  }

  // ---------- transport ----------
  // 데모(브라우저): 키는 이 창의 메모리에만 둔다 (새로 고치면 지워짐). 모델 이름만 localStorage 에 남긴다
  const LS = 'erp_ai_cfg';
  const localCfg = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } };
  const saveLocal = (c) => { try { localStorage.setItem(LS, JSON.stringify(c)); } catch (e) { /* ignore */ } };
  const BETA_FALLBACK = 'server-side-fallback-2026-07-01';
  // 안전 정책으로 거절하면 Anthropic 이 알맞은 다른 모델로 다시 답하게 하는 fallbacks: "default" 를 받는 모델 (Claude API)
  const FALLBACK_MODELS = /^claude-(sonnet-5-5|opus-5-5|opus-5|fable-5-1|fable-5)$/;
  /** ERP 화면이 이 PC(서버)에서 열렸는가 — AI 키 · 모델 · 하루 한도는 이 PC 에서만 바꾼다 */
  const ownPc = () => DB.mode !== 'server' || !(DB.ping && DB.ping.loopback === false);

  A.loadCfg = async function () {
    if (DB.mode === 'server') {
      try { const c = await (await fetch('/api/ai/config', { cache: 'no-store' })).json(); A.hasKey = !!c.hasKey; A.model = c.model || A.model; A.keyTail = c.keyTail || ''; A.limit = c.dailyLimit; A.usage = c.today || null; }
      catch (e) { A.hasKey = false; }
    } else {
      const c = localCfg(); if (c.key) { A._memKey = c.key; delete c.key; saveLocal(c); }   // 예전 버전이 저장한 키: 이번 창에서만 쓰고 저장소에서 지운다
      A.hasKey = !!A._memKey; A.model = c.model || A.model; A.keyTail = A._memKey ? A._memKey.slice(-4) : '';
    }
  };
  A.saveCfg = async function (key, model, limit) {
    if (DB.mode === 'server') {
      const body = {}; if (key !== undefined) body.key = key; if (model) body.model = model; if (limit !== undefined) body.dailyLimit = limit;
      const r = await fetch('/api/ai/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const c = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof c.error === 'string' ? c.error : ('HTTP ' + r.status));
      A.hasKey = !!c.hasKey; A.model = c.model || A.model; A.keyTail = c.keyTail || ''; A.limit = c.dailyLimit; A.usage = c.today || A.usage;
    } else {
      if (key !== undefined) A._memKey = key || null;
      const c = localCfg(); delete c.key; if (model) c.model = model; saveLocal(c);
      A.hasKey = !!A._memKey; A.model = c.model || A.model; A.keyTail = A._memKey ? A._memKey.slice(-4) : '';
    }
  };
  async function callApi(body) {
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(240000) : undefined;
    let r;
    if (DB.mode === 'server') r = await fetch('/api/ai/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    else {
      if (!A._memKey) throw new Error('NO_KEY');
      const headers = { 'content-type': 'application/json', 'x-api-key': A._memKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
      if (body.fallbacks !== undefined) headers['anthropic-beta'] = BETA_FALLBACK;
      r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal, headers, body: JSON.stringify(Object.assign({ model: A.model }, body)) });
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error((j.error && j.error.message) || (typeof j.error === 'string' ? j.error : '') || ('HTTP ' + r.status)); e.status = r.status;
      const ra = r.headers && r.headers.get ? r.headers.get('retry-after') : null; if (ra !== null && ra !== '' && !isNaN(Number(ra))) e.retryAfter = Number(ra);
      throw e;
    }
    return j;
  }
  A._call = callApi; // overridable (tests)

  function friendlyError(e) {
    const m = String((e && e.message) || e || ''), st = e && e.status;
    if (e && e.refusal) return L('AI 가 이 질문에는 답하지 않았습니다 (안전 정책' + (e.category ? ' · ' + e.category : '') + ')', 'AI từ chối trả lời câu hỏi này (chính sách an toàn' + (e.category ? ' · ' + e.category : '') + ')');
    if (e && e.maxTokens) return L('답이 너무 길어 끝까지 받지 못했습니다. 질문을 더 좁혀 주세요', 'Câu trả lời quá dài nên không nhận hết. Hãy hỏi cụ thể hơn');
    if (/NO_KEY/.test(m)) return L('API 키가 설정되지 않았습니다', 'Chưa cài API key');
    if (/DAILY_LIMIT/.test(m)) return L('오늘 AI 사용 한도를 다 썼습니다 (ERP 가 실행 중인 PC 의 비서 설정에서 바꿀 수 있음)', 'Đã dùng hết hạn mức AI hôm nay (đổi trong cài đặt trợ lý trên máy chạy ERP)');
    if (st === 401 || /invalid x-api-key|authentication/i.test(m)) return L('API 키가 올바르지 않습니다 (⚙에서 다시 입력)', 'API key không hợp lệ (nhập lại ở ⚙)');
    if (/credit balance/i.test(m)) return L('API 크레딧이 부족합니다 (Anthropic 콘솔에서 충전)', 'Hết credit API (nạp tại Anthropic Console)');
    if (st === 403) return L('이 키로는 사용할 수 없습니다 (권한/지역 제한)', 'Key này không được phép sử dụng');
    if (st === 429) return L('요청이 많거나 사용 한도를 넘었습니다. 잠시 후 다시 시도하세요', 'Quá nhiều yêu cầu hoặc hết hạn mức. Hãy thử lại sau');
    if (st === 529 || st === 503 || /overloaded/i.test(m)) return L('AI 서버가 혼잡합니다. 잠시 후 다시 시도하세요', 'Máy chủ AI đang quá tải. Hãy thử lại sau');
    if (e && (e.name === 'AbortError' || e.name === 'TimeoutError' || /timeout|timed out/i.test(m))) return L('응답 시간이 초과되었습니다', 'Quá thời gian chờ phản hồi');
    if (/Failed to fetch|NetworkError|Network:|fetch failed/i.test(m)) return L('인터넷에 연결할 수 없습니다', 'Không kết nối được internet');
    return m || 'error';
  }
  A.friendlyError = friendlyError;

  // ---------- AI conversation ----------
  // 9차: 대화 기록은 뒤에 붙이기만 한다. Claude 의 생각(thinking) 블록은 앞의 대화 · 시스템 프롬프트 · 도구가 바뀌면 무효가 되고
  // (2026-08-31 이후 만든 계정은 400 오류), 프롬프트 캐시도 깨진다. 그래서
  //  - 시스템 프롬프트는 대화를 시작할 때 고정하고, 날짜 · 언어 · 설정이 바뀌면 대화 중 system 메시지로 알린다
  //  - 앞을 잘라내지 않고, 너무 길어지면 요약 한 줄로 새 대화를 연다
  //  - 실패한 질문은 그 질문의 기록만 뒤에서 걷어낸다 (앞부분은 그대로)
  const MAX_CALLS = 8;
  A.MAX_HISTORY_CHARS = 300000;
  // 모델 · 계정이 받지 않는 선택 항목(400)은 한 번 끄고 다시 보낸다 (설정에서 옛 모델을 고른 경우 등)
  A.opts = { fallbacks: true, effort: true, cache: true, sysMsg: true };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const oneLine = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
  const textOf = (resp) => (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

  /** 도구 결과가 너무 길면 가장 긴 목록부터 줄이고 <목록>_total · <목록>_truncated 를 붙인다 (JSON 을 중간에서 자르지 않음) */
  function fitResult(out, limit) {
    let s = JSON.stringify(out === undefined ? null : out); if (s.length <= limit) return s;
    const o = JSON.parse(s);
    for (let guard = 0; guard < 60 && s.length > limit; guard++) {
      let best = null;
      (function walk(x, parent, key) {
        if (Array.isArray(x)) { if (x.length > 3 && parent && !Array.isArray(parent)) { const len = JSON.stringify(x).length; if (!best || len > best.len) best = { parent, key, arr: x, len }; } x.forEach(v => walk(v, x, null)); }
        else if (x && typeof x === 'object') Object.keys(x).forEach(k => walk(x[k], x, k));
      })(o, null, null);
      if (!best) break;
      const total = best.parent[best.key + '_total'] || best.arr.length;
      best.parent[best.key] = best.arr.slice(0, Math.max(3, Math.floor(best.arr.length / 2)));
      best.parent[best.key + '_total'] = total; best.parent[best.key + '_truncated'] = true;
      s = JSON.stringify(o);
    }
    if (s.length > limit) s = JSON.stringify({ truncated: true, note: 'Result too large to show. Ask for a narrower period or a filter.', head: s.slice(0, Math.max(0, limit - 200)) });
    return s;
  }
  A._fitResult = fitResult;
  function runTool(u, onStep) {
    onStep && onStep(u.name);
    let out;
    try { out = A.tools[u.name] ? A.tools[u.name](u.input || {}) : { error: 'unknown tool: ' + u.name }; } catch (e) { out = { error: String(e.message || e) }; }
    const r = { type: 'tool_result', tool_use_id: u.id, content: fitResult(out, 12000) };
    if (out && out.error) r.is_error = true;
    return r;
  }
  /** 긴 대화를 새 대화로 옮길 때 넘기는 요약: 최근 질문 · 답 6쌍 (짧게) */
  function summary(msgs) {
    const qa = []; let cur = null;
    msgs.forEach(m => {
      if (m.role === 'user') {
        let q = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) && m.content[0] && m.content[0].type === 'text' ? m.content[0].text : null);
        if (q === null) return;
        const k = q.indexOf('[Question]\n'); if (q.startsWith('[Earlier in this chat') && k >= 0) q = q.slice(k + 11);
        cur = { q, a: '' }; qa.push(cur);
      } else if (m.role === 'assistant' && cur) { const t = (m.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim(); if (t) cur.a = t; }
    });
    return '[Earlier in this chat (summary; the numbers may have changed since, check with the tools)]\n' + qa.slice(-6).map(x => 'Q: ' + oneLine(x.q, 160) + '\nA: ' + oneLine(x.a || '-', 320)).join('\n') + '\n\n[Question]\n';
  }
  /** 대화 중 알림: system 메시지 (받지 않는 모델이면 질문 뒤에 붙인 <system-reminder>) */
  function addNote(msgs, note) {
    if (A.opts.sysMsg) { msgs.push({ role: 'system', content: note }); return; }
    const u = msgs[msgs.length - 1]; if (typeof u.content === 'string') u.content = [{ type: 'text', text: u.content }];
    u.content.push({ type: 'text', text: '<system-reminder>\n' + note + '\n</system-reminder>' });
  }
  function sysToUser(list) {
    for (let i = list.length - 1; i > 0; i--) {
      if (list[i].role !== 'system') continue;
      const prev = list[i - 1], txt = '<system-reminder>\n' + (typeof list[i].content === 'string' ? list[i].content : '') + '\n</system-reminder>';
      if (prev && prev.role === 'user') { if (typeof prev.content === 'string') prev.content = [{ type: 'text', text: prev.content }]; prev.content.push({ type: 'text', text: txt }); }
      list.splice(i, 1);
    }
  }
  function buildBody(conv, msgs, last) {
    const b = { max_tokens: 16000, system: [{ type: 'text', text: conv.sys }], tools: A.toolDefs, messages: msgs };
    if (A.opts.cache) { b.system[0].cache_control = { type: 'ephemeral' }; b.cache_control = { type: 'ephemeral' }; }   // 고정한 앞부분(도구 · 시스템) + 자라는 대화 끝
    if (A.opts.effort) b.output_config = { effort: P.style() === 'detail' ? 'medium' : 'low' };
    if (A.opts.fallbacks && FALLBACK_MODELS.test(A.model)) b.fallbacks = 'default';
    if (last) b.tool_choice = { type: 'none' };   // 마지막 호출: 도구 없이 지금까지의 결과로 답하게
    return b;
  }
  /** 429 · 529 · 503 은 retry-after 만큼 기다렸다가 한 번 더. 받지 않는 선택 항목(400)은 끄고 다시 */
  async function callWithRetry(body) {
    let waited = false;
    for (let k = 0; k < 6; k++) {
      try { return await A._call(body); } catch (e) {
        const st = e && e.status, m = String((e && e.message) || '');
        if ((st === 429 || st === 529 || st === 503) && !waited && !/DAILY_LIMIT/.test(m)) { waited = true; await sleep(Math.min(20, e.retryAfter >= 0 ? e.retryAfter : 3) * 1000); continue; }
        if (st === 400) {
          if (body.fallbacks !== undefined && /fallback/i.test(m)) { A.opts.fallbacks = false; delete body.fallbacks; continue; }
          if (body.output_config && /effort|output_config/i.test(m)) { A.opts.effort = false; delete body.output_config; continue; }
          if (body.cache_control && /cache_control/i.test(m)) { A.opts.cache = false; delete body.cache_control; if (Array.isArray(body.system)) delete body.system[0].cache_control; continue; }
          if (A.opts.sysMsg && /role.{0,8}system|system.{0,30}not supported/i.test(m) && (body.messages || []).some(x => x.role === 'system')) { A.opts.sysMsg = false; sysToUser(body.messages); continue; }
        }
        throw e;
      }
    }
    throw new Error('retry');
  }
  /** one user turn through Claude, looping over tool calls. onStep(toolName) reports progress. On failure only this turn is taken back. */
  A.ask = async function (text, onStep) {
    let conv = A.conv, msgs = A.history;
    if (!msgs.length || !conv) { conv = { sys: systemPrompt(), ctx: ctxNow() }; msgs = []; }
    else if (JSON.stringify(msgs).length > A.MAX_HISTORY_CHARS) { text = summary(msgs) + text; conv = { sys: systemPrompt(), ctx: ctxNow() }; msgs = []; }
    else msgs = msgs.slice();   // 성공하면 바꿔 넣는다 (실패하면 기록은 그대로)
    const now = ctxNow(), note = ctxNote(conv.ctx, now);
    msgs.push({ role: 'user', content: text });
    if (note) addNote(msgs, note);
    for (let i = 0; i < MAX_CALLS; i++) {
      const resp = await callWithRetry(buildBody(conv, msgs, i === MAX_CALLS - 1));
      if (resp.stop_reason === 'refusal') { const e = new Error('REFUSAL'); e.refusal = true; e.category = (resp.stop_details && resp.stop_details.category) || null; throw e; }
      if (resp.stop_reason === 'max_tokens') { const e = new Error('MAX_TOKENS'); e.maxTokens = true; throw e; }
      msgs.push({ role: 'assistant', content: resp.content || [] });   // 생각 블록까지 그대로 (다음 요청에 바꾸지 않고 다시 보냄)
      const uses = (resp.content || []).filter(b => b.type === 'tool_use');
      if (resp.stop_reason !== 'tool_use' || !uses.length) {
        conv.ctx = now; A.conv = conv; A.history.splice(0, A.history.length, ...msgs);
        return textOf(resp) || '…';
      }
      msgs.push({ role: 'user', content: uses.map(u => runTool(u, onStep)) });
    }
    throw new Error(L('조회가 너무 길어졌습니다. 질문을 더 좁혀 주세요.', 'Truy vấn quá dài, hãy hỏi cụ thể hơn.'));
  };
  A.useAI = () => !!A.hasKey && !P.off();
  /** answer one question: AI when a key is set (and not switched off), otherwise — or when the AI call fails — the built-in mode */
  A.respond = async function (text, onStep) {
    if (A.hasKey === null) await A.loadCfg();
    if (A.useAI()) {
      try { return { text: await A.ask(text, onStep), via: 'ai', md: true }; }
      catch (e) {
        const l = A.localAnswer(text);
        const pre = e && (e.refusal || e.maxTokens) ? L('AI 답변을 받지 못해 내장 모드로 답했습니다: ', 'Không nhận được câu trả lời AI → trả lời bằng chế độ tích hợp: ') : L('AI 연결 실패 → 내장 모드로 답했습니다: ', 'Lỗi kết nối AI → trả lời bằng chế độ tích hợp: ');
        return { text: l.text, blocks: l.blocks, actions: l.actions, via: 'local', note: pre + friendlyError(e) };
      }
    }
    const l = A.localAnswer(text); return { text: l.text, blocks: l.blocks, actions: l.actions, via: 'local' };
  };
  /** AI 연결 시험: 짧은 요청 하나 → {model, ms} */
  A.test = async function () {
    const t0 = Date.now(); const b = { max_tokens: 512, messages: [{ role: 'user', content: 'Reply with the single word OK.' }] };
    if (A.opts.effort) b.output_config = { effort: 'low' };
    if (A.opts.fallbacks && FALLBACK_MODELS.test(A.model)) b.fallbacks = 'default';
    const r = await callWithRetry(b);
    return { model: r.model || A.model, ms: Date.now() - t0, refusal: r.stop_reason === 'refusal' };
  };

  // ---------- UI ----------
  const css = document.createElement('style');
  css.textContent = `
  #aiFab{position:fixed;right:22px;bottom:22px;z-index:900;height:48px;padding:0 18px;border-radius:24px;border:0;background:#2B6CE6;color:#fff;font:600 14px inherit;box-shadow:0 6px 20px rgba(20,40,90,.35);cursor:pointer;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 44px)}
  #aiFab span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #aiFab:hover{background:#2159c8}
  #aiPanel{position:fixed;right:22px;bottom:84px;z-index:900;width:min(600px,calc(100vw - 24px));height:min(720px,calc(100vh - 110px));background:var(--card,#fff);border:1px solid var(--line,#dde2ea);border-radius:14px;box-shadow:0 12px 40px rgba(20,30,60,.28);display:none;flex-direction:column;overflow:hidden}
  #aiPanel.on{display:flex}
  #aiPanel.wide{width:min(980px,calc(100vw - 24px));height:min(860px,calc(100vh - 100px))}
  #aiPanel .b.rich{white-space:normal;max-width:100%;width:100%;box-sizing:border-box}
  #aiPanel .b.rich>*+*{margin-top:8px}
  #aiPanel .b.rich p{margin:0}
  #aiPanel .ah1{font-weight:700;font-size:14.5px;line-height:1.4}
  #aiPanel .asec{font-weight:700;font-size:13px;color:#174A94;padding-top:6px;border-top:1px solid #DDE2EA}
  #aiPanel .atb{display:flex;flex-direction:column;gap:4px}
  #aiPanel .att{font-size:12px;font-weight:700;color:#5b6575}
  #aiPanel .atw{overflow:auto;max-height:340px;border:1px solid #D5DBE4;border-radius:8px;background:#fff}
  #aiPanel table.at{border-collapse:collapse;width:100%;font-size:12.5px;line-height:1.35}
  #aiPanel table.at th{position:sticky;top:0;background:#F3F5F8;color:#4B5563;font-weight:600;text-align:left;padding:6px 8px;border-bottom:1px solid #D5DBE4;white-space:nowrap}
  #aiPanel table.at td{padding:5px 8px;border-bottom:1px solid #EEF0F3;white-space:nowrap;vertical-align:top}
  #aiPanel table.at tr:last-child td{border-bottom:0}
  #aiPanel table.at tbody tr:nth-child(even) td{background:#FAFBFC}
  #aiPanel table.at .n{text-align:right;font-variant-numeric:tabular-nums}
  #aiPanel table.at .b{font-weight:700}
  #aiPanel table.at .t-bad{color:#B3261E;font-weight:600}#aiPanel table.at .t-warn{color:#9A5B00;font-weight:600}#aiPanel table.at .t-ok{color:#0B6B52;font-weight:600}#aiPanel table.at .t-muted{color:#8A93A0}
  #aiPanel .amore{font-size:11.5px;color:#7a8596;padding-left:2px}
  #aiPanel .acmt{font-size:12.5px;line-height:1.5;background:#FFF8E1;border:1px solid #F2DFA4;border-radius:8px;padding:6px 9px;color:#3D3420}
  #aiPanel .anote{font-size:12px;line-height:1.5;color:#5b6575;background:#F3F5F8;border-radius:8px;padding:5px 9px}
  #aiPanel ul.al{margin:0;padding-left:18px}#aiPanel ul.al li{margin:2px 0}
  #aiPanel .b.rich code{background:#E4E8EF;border-radius:4px;padding:0 4px;font-size:12px}
  #aiPanel .b.rich hr{border:0;border-top:1px solid #DDE2EA;margin:8px 0}
  #aiPanel .ah{padding:10px 12px;border-bottom:1px solid var(--line,#dde2ea);display:flex;align-items:center;gap:6px;font-weight:700}
  #aiPanel .ah .t{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25}
  #aiPanel .ah .t b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #aiPanel .ah .mode{font-size:11px;font-weight:600;color:#5b6575}
  #aiPanel .ah .mode.ai{color:#0B6B52}
  #aiPanel .am{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px;font-size:13.5px}
  #aiPanel .b{max-width:94%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;line-height:1.5;word-break:break-word}
  #aiPanel .b.u{align-self:flex-end;background:#2B6CE6;color:#fff;border-bottom-right-radius:3px}
  #aiPanel .b.a{align-self:flex-start;background:#EEF1F6;color:#1c2430;border-bottom-left-radius:3px}
  #aiPanel .b.s{align-self:flex-start;background:none;color:#7a8596;font-size:12px;padding:0 4px}
  #aiPanel .chips,#aiPanel .acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:-4px}
  #aiPanel .chips button,#aiPanel .acts button{border:1px solid var(--line,#dde2ea);background:var(--card,#fff);border-radius:14px;padding:5px 10px;font-size:12.5px;cursor:pointer;color:inherit}
  #aiPanel .chips button:hover,#aiPanel .acts button:hover{background:#EEF1F6}
  #aiPanel .chips button.me{border-color:#2B6CE6;color:#174A94}
  #aiPanel .acts button{font-size:12px;padding:3px 9px;color:#174A94}
  #aiPanel .af{border-top:1px solid var(--line,#dde2ea);padding:10px;display:flex;gap:8px}
  #aiPanel .af textarea{flex:1;resize:none;height:44px;border:1px solid var(--line,#dde2ea);border-radius:10px;padding:8px 10px;font:inherit;background:var(--card,#fff);color:inherit}
  #aiPanel .set{padding:12px;display:none;flex-direction:column;gap:10px;font-size:13px;overflow:auto;flex:1}
  #aiPanel .set>*{flex-shrink:0}
  #aiPanel .set h4{margin:8px 0 0;font-size:13px;border-top:1px solid var(--line,#dde2ea);padding-top:10px}
  #aiPanel .set h4:first-of-type{border-top:0;padding-top:0;margin-top:0}
  #aiPanel .set label{display:flex;flex-direction:column;gap:4px}
  #aiPanel .set label.row{flex-direction:row;align-items:center;gap:8px}
  #aiPanel .set textarea{height:110px;width:100%;border:1px solid var(--line,#dde2ea);border-radius:8px;padding:8px;font:inherit;background:var(--card,#fff);color:inherit}
  #aiPanel .set input.inp,#aiPanel .set select.inp{width:100%}
  #aiPanel .set .qrow{display:grid;grid-template-columns:110px 1fr 28px;gap:6px}
  #aiPanel .set .toolbar{display:flex;gap:6px;flex-wrap:wrap}
  #aiPanel.cfg .set{display:flex}#aiPanel.cfg .am,#aiPanel.cfg .af{display:none}
  @media print{#aiFab,#aiPanel{display:none!important}}`;
  document.head.appendChild(css);

  let panel, msgBox, input, modeEl, titleEl, built = false;
  const scroll = () => { if (msgBox) msgBox.scrollTop = msgBox.scrollHeight; };
  const TOOL_LABEL = { briefing: ['브리핑 준비', 'Chuẩn bị bản tin'], overview: ['현황 확인', 'Xem tổng quan'], find_orders: ['수주 조회', 'Tra cứu PO'], get_po: ['PO 상세 조회', 'Chi tiết PO'], material_stock: ['자재 재고 조회', 'Tra cứu tồn NVL'],
    production_summary: ['생산 실적 집계', 'Tổng hợp sản xuất'], quality_downtime: ['불량·정지 집계', 'Tổng hợp lỗi/dừng máy'], reorder: ['발주 필요 확인', 'Kiểm tra cần đặt hàng'], mrp: ['자재 소요량 계산', 'Tính nhu cầu NVL'] };

  // ---------- rich answers: built-in mode blocks · AI-mode Markdown (tables, lists, ※ comments). DOM only (no innerHTML) ----------
  const NUMV = /^[-+−]?[\d.,]+\s*(%|pcs|set|kg|건|종|개|CT|PCS|SET|đơn|mã|phút|분)?$/i;
  function inline(text) {
    const out = []; const re = /(\*\*[^*]+\*\*|`[^`]+`)/g; let last = 0, m; const s0 = String(text || '');
    while ((m = re.exec(s0))) { if (m.index > last) out.push(s0.slice(last, m.index)); const t = m[0]; out.push(t.startsWith('**') ? h('b', t.slice(2, -2)) : h('code', t.slice(1, -1))); last = m.index + t.length; }
    if (last < s0.length) out.push(s0.slice(last)); return out;
  }
  function tableEl(head, rows, numCol, isMd) {
    return h('div', { class: 'atw' }, h('table', { class: 'at' }, h('thead', h('tr', head.map((x, j) => h('th', { class: numCol[j] ? 'n' : '' }, isMd ? inline(x) : x)))),
      h('tbody', rows.map(r => h('tr', head.map((_, j) => { const cell = r[j]; const o = cell && typeof cell === 'object' ? cell : { v: cell }; const v = o.v === undefined || o.v === null ? '' : String(o.v);
        return h('td', { class: [numCol[j] ? 'n' : '', o.tone ? 't-' + o.tone : '', o.b ? 'b' : ''].filter(Boolean).join(' ') }, isMd ? inline(v) : v); }))))));
  }
  function renderBlocks(blocks) {
    return blocks.map(b => {
      if (!b) return null;
      if (b.t === 'h') return h('div', { class: 'ah1' }, '■ ' + b.text);
      if (b.t === 'sec') return h('div', { class: 'asec' }, b.text);
      if (b.t === 'p') return h('p', b.text);
      if (b.t === 'note') return h('div', { class: 'anote' }, /^\s*(※|⚠)/.test(b.text) ? b.text : '※ ' + b.text);
      if (b.t === 'list') return h('ul', { class: 'al' }, b.items.map(x => h('li', x)));
      if (b.t === 'table') return h('div', { class: 'atb' }, b.title ? h('div', { class: 'att' }, b.title) : null, tableEl(b.cols.map(c => c.l), b.rows, b.cols.map(c => !!c.num), false),
        b.more ? h('div', { class: 'amore' }, b.more) : null, b.cmt ? h('div', { class: 'acmt' }, '※ ' + String(b.cmt).replace(/^\s*※\s*/, '')) : null);
      return null;
    });
  }
  /** a small, safe Markdown subset: # headings, **bold**, `code`, - lists, | tables |, ※ comment lines, --- */
  function renderMd(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n'); const out = []; let i = 0;
    const isRow = (l) => /^\s*\|.*\|\s*$/.test(l); const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
    const cells = (x) => x.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    const special = /^\s*(#{1,4}\s|[-*·•]\s|\d+[.)]\s|※|⚠|\|)/;
    while (i < lines.length) {
      const l = lines[i];
      if (isRow(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
        const head = cells(l); const al = cells(lines[i + 1]); i += 2; const body = [];
        while (i < lines.length && isRow(lines[i])) { body.push(cells(lines[i])); i++; }
        const numCol = head.map((_, j) => /:$/.test(al[j] || '') || (body.length > 0 && body.every(r => !String(r[j] || '').trim() || NUMV.test(String(r[j] || '').replace(/\*\*/g, '').trim()))));
        out.push(tableEl(head, body, numCol, true)); continue;
      }
      if (/^\s*#{1,4}\s+/.test(l)) { out.push(h('div', { class: 'ah1' }, inline(l.replace(/^\s*#{1,4}\s+/, '')))); i++; continue; }
      if (/^\s*([-*·•]|\d+[.)])\s+/.test(l)) { const ul = h('ul', { class: 'al' }); while (i < lines.length && /^\s*([-*·•]|\d+[.)])\s+/.test(lines[i])) { ul.appendChild(h('li', inline(lines[i].replace(/^\s*([-*·•]|\d+[.)])\s+/, '')))); i++; } out.push(ul); continue; }
      if (/^\s*(---+|\*\*\*+)\s*$/.test(l)) { out.push(h('hr')); i++; continue; }
      if (/^\s*(※|⚠)/.test(l)) { const prevTable = out.length && out[out.length - 1].classList && out[out.length - 1].classList.contains('atw'); out.push(h('div', { class: prevTable ? 'acmt' : 'anote' }, inline(l.trim()))); i++; continue; }
      if (!l.trim()) { i++; continue; }
      const para = []; while (i < lines.length && lines[i].trim() && !special.test(lines[i]) && !(isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1]))) { para.push(lines[i]); i++; }
      if (!para.length) { out.push(h('p', inline(l))); i++; continue; }
      const p = h('p'); para.forEach((x, k) => { if (k) p.appendChild(h('br')); inline(x).forEach(n => p.append(n)); }); out.push(p);
    }
    return out;
  }
  A.renderMd = renderMd; A.renderBlocks = renderBlocks;
  const copyText = (t) => { try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(() => ERP.toast(L('복사했습니다', 'Đã sao chép'), 'ok'), () => {}); return; } } catch (e) { /* ignore */ }
    const ta = h('textarea', { style: { position: 'fixed', left: '-9999px' } }); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ERP.toast(L('복사했습니다', 'Đã sao chép'), 'ok'); } catch (e) { /* ignore */ } ta.remove(); };
  function drawMsg(m) {
    const rich = m.cls === 'a' && ((m.blocks && m.blocks.length) || m.md);
    const d = h('div', { class: 'b ' + m.cls + (rich ? ' rich' : '') });
    if (rich) { (m.blocks && m.blocks.length ? renderBlocks(m.blocks) : renderMd(m.text)).forEach(x => x && d.appendChild(x)); } else d.textContent = m.text;
    msgBox.appendChild(d);
    if (rich && m.text) m.actions = (m.actions || []).filter(a => !a._copy).concat([{ _copy: true, label: L('⧉ 복사', '⧉ Sao chép'), run: () => copyText(m.text) }]);
    if (m.actions && m.actions.length) msgBox.appendChild(h('div', { class: 'acts' }, m.actions.map(a => h('button', { type: 'button', onclick: () => { try { a.run(); } catch (e) { console.error(e); ERP.toast(String(e.message || e), 'bad'); } } }, a.label))));
    scroll(); return d;
  }
  function addMsg(cls, text, actions, extra) { const m = Object.assign({ cls, text, actions }, extra || {}); A.transcript.push(m); if (A.transcript.length > 60) A.transcript.shift(); return drawMsg(m); }
  function modeText() { return A.useAI() ? 'AI · ' + A.model : L('내장 모드 · 키·인터넷 불필요', 'Chế độ tích hợp · không cần key/internet'); }
  function refreshHeader() {
    if (titleEl) titleEl.textContent = P.displayName();
    if (modeEl) { modeEl.textContent = modeText(); modeEl.className = 'mode' + (A.useAI() ? ' ai' : ''); modeEl.title = A.useAI() ? L('Claude AI가 ERP 데이터를 조회해 답합니다', 'Claude AI tra cứu dữ liệu ERP để trả lời') : L('정해진 질문 유형을 이해하는 내장 모드입니다. 자유로운 대화는 ⚙에서 API 키를 넣으면 AI 모드가 됩니다.', 'Chế độ tích hợp hiểu một số loại câu hỏi cố định. Nhập API key ở ⚙ để dùng AI.'); }
    const f = document.getElementById('aiFab'); if (f) f.firstChild.nextSibling.textContent = P.displayName();
  }
  function defaultChips() {
    return [[L('☀ 오늘 브리핑', '☀ Bản tin hôm nay'), L('오늘 브리핑', 'Bản tin hôm nay')],
      [L('납기 위험 PO', 'PO sắp/quá hạn'), L('7일 내 납기이거나 지연된 PO를 알려줘', 'Cho tôi các PO đến hạn trong 7 ngày hoặc đã trễ')],
      [L('안전재고 미달 자재', 'NVL dưới tồn an toàn'), L('안전재고보다 부족한 원부자재를 알려줘', 'NVL nào đang dưới mức tồn an toàn?')],
      [L('어제 생산 요약', 'Sản lượng hôm qua'), L('어제 공정별 생산량을 요약해줘', 'Tóm tắt sản lượng theo công đoạn hôm qua')]];
  }
  async function send(text) {
    text = String(text || '').trim(); if (!text || A.busy) return;
    if (A.hasKey === null) await A.loadCfg();
    A.busy = true; if (input) input.value = ''; addMsg('u', text);
    const stat = h('div', { class: 'b s' }, L('생각 중…', 'Đang xử lý…')); msgBox.appendChild(stat); scroll();
    try {
      const r = await A.respond(text, (n) => { stat.textContent = '… ' + L((TOOL_LABEL[n] || [n])[0], (TOOL_LABEL[n] || [0, n])[1]); });
      stat.remove(); addMsg('a', r.text, r.actions, { blocks: r.blocks, md: r.md }); if (r.note) addMsg('s', r.note);
    } catch (e) { stat.remove(); addMsg('a', L('오류: ', 'Lỗi: ') + friendlyError(e)); }
    A.busy = false; refreshHeader(); input && input.focus();
  }
  A.send = send;

  function greet() {
    const user = P.user(), name = P.displayName();
    msgBox.appendChild(h('div', { class: 'b a' }, L('안녕하세요' + (user ? ', ' + user : '') + '. 저는 ' + name + '입니다. 수주·납기, 생산 실적, 불량·정지, 자재 재고, 발주, 소요량(MRP)에 대해 물어보세요. 저는 ERP 데이터를 읽기만 합니다.',
      'Xin chào' + (user ? ' ' + user : '') + '. Tôi là ' + name + '. Hãy hỏi về PO/hạn giao, sản lượng, lỗi/dừng máy, tồn NVL, đặt hàng, nhu cầu vật tư (MRP). Tôi chỉ đọc dữ liệu ERP.')
      + (A.useAI() ? '' : '\n\n' + L('지금은 내장 모드입니다 (키·인터넷 불필요, 정해진 질문 유형만 이해). 자유로운 대화는 ⚙ 에서 Anthropic API 키를 넣으면 AI 모드로 바뀝니다.', 'Hiện đang ở chế độ tích hợp (không cần key/internet, chỉ hiểu một số loại câu hỏi). Nhập Anthropic API key ở ⚙ để dùng AI.'))));
    const chips = defaultChips().map(x => h('button', { type: 'button', onclick: () => send(x[1]) }, x[0]))
      .concat(P.quick().map(x => h('button', { type: 'button', class: 'me', title: x.text, onclick: () => send(x.text) }, '★ ' + (x.label || x.text).slice(0, 24))));
    msgBox.appendChild(h('div', { class: 'chips' }, chips));
  }
  function redraw() { msgBox.replaceChildren(); greet(); A.transcript.forEach(drawMsg); scroll(); }

  function build() {
    if (built) return; built = true;
    msgBox = h('div', { class: 'am' });
    input = h('textarea', { placeholder: L('질문을 입력하세요 (Enter 전송)', 'Nhập câu hỏi (Enter để gửi)'), onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); } } });

    // ---- settings view
    const nameIn = h('input', { class: 'inp', value: DB.setting('aiName', '') || '', maxlength: 30, placeholder: L('예) 박 팀장 비서', 'VD: Trợ lý của anh Park') });
    const userIn = h('input', { class: 'inp', value: DB.setting('aiUser', '') || '', maxlength: 30, placeholder: L('예) 박 팀장님', 'VD: anh Park') });
    const styleSel = h('select', { class: 'inp' }, h('option', { value: 'short' }, L('간단히 (핵심만)', 'Ngắn gọn')), h('option', { value: 'detail' }, L('자세히 (근거까지)', 'Chi tiết'))); styleSel.value = P.style();
    const promptIn = h('textarea', { placeholder: L('예) 우리 공장 용어, 우선순위, 답변 형식… (다른 프로젝트에서 만든 비서 지침을 붙여넣어도 됩니다)', 'Ví dụ: thuật ngữ, ưu tiên, định dạng trả lời…') }); promptIn.value = DB.setting('aiPrompt', '') || '';
    let qs = P.quick().map(x => ({ label: x.label || '', text: x.text }));
    const qBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    const drawQs = () => {
      qBox.replaceChildren(...qs.map((q, i) => h('div', { class: 'qrow' },
        h('input', { class: 'inp', value: q.label, placeholder: L('버튼 이름', 'Tên nút'), maxlength: 24, oninput: (e) => { q.label = e.target.value; } }),
        h('input', { class: 'inp', value: q.text, placeholder: L('질문 내용 (예: 5100356783 어디까지 됐어?)', 'Câu hỏi (vd: PO 5100356783 đến đâu rồi?)'), oninput: (e) => { q.text = e.target.value; } }),
        h('button', { type: 'button', class: 'btn', title: L('삭제', 'Xóa'), onclick: () => { qs.splice(i, 1); drawQs(); } }, '×'))),
        qs.length < 8 ? h('div', h('button', { type: 'button', class: 'btn', onclick: () => { qs.push({ label: '', text: '' }); drawQs(); } }, '+ ' + L('내 질문 추가', 'Thêm câu hỏi'))) : null);
    };
    drawQs();
    const offChk = h('input', { type: 'checkbox' }); offChk.checked = P.off();
    // AI 키 · 모델 · 하루 한도는 ERP 가 실행 중인 PC 에서만 바꾼다 (다른 PC 브라우저는 내 비서 설정만 저장)
    const own = ownPc();
    const keyIn = h('input', { class: 'inp', type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off', disabled: !own });
    const modelIn = h('input', { class: 'inp', value: A.model, disabled: !own });
    const limitIn = h('input', { class: 'inp', type: 'number', min: '0', step: '10', value: A.limit === undefined ? '' : A.limit, disabled: !own });
    const stateLn = h('div', { class: 'help' }), useLn = h('div', { class: 'help' });
    const upd = () => {
      modelIn.value = A.model; if (A.limit !== undefined) limitIn.value = A.limit;
      stateLn.textContent = (A.hasKey ? L('API 키: 저장됨', 'API key: đã lưu') + (A.keyTail ? ' (…' + A.keyTail + ')' : '') + (DB.mode === 'server' ? L(' · 서버에만 보관', ' · chỉ lưu trên máy chủ') : L(' · 이 창에만 기억 (새로 고치면 다시 입력)', ' · chỉ nhớ trong cửa sổ này (tải lại phải nhập lại)')) : L('API 키가 없습니다 — 내장 모드로 동작합니다', 'Chưa có API key — đang dùng chế độ tích hợp')) + ' · ' + modeText();
      const u = A.usage; useLn.textContent = DB.mode === 'server' && u ? L('오늘 AI 호출 ', 'Hôm nay đã gọi AI ') + F.n(u.requests || 0) + (A.limit ? ' / ' + F.n(A.limit) : '') + L('회 · 입력 ', ' lần · vào ') + F.n(u.input_tokens || 0) + L(' · 캐시 ', ' · cache ') + F.n(u.cache_read || 0) + L(' · 출력 ', ' · ra ') + F.n(u.output_tokens || 0) + ' tokens' : '';
    };
    const settings = h('div', { class: 'set' },
      h('h4', L('내 비서', 'Trợ lý của tôi')),
      h('label', L('비서 이름', 'Tên trợ lý'), nameIn), h('label', L('나를 부르는 호칭', 'Cách gọi tôi'), userIn), h('label', L('답변 스타일 (AI 모드)', 'Phong cách trả lời (chế độ AI)'), styleSel),
      h('h4', L('우리 공장 지침 (선택)', 'Hướng dẫn riêng của nhà máy (tùy chọn)')), promptIn,
      h('div', { class: 'help' }, L('AI 모드에서 비서가 항상 따릅니다. 내장 모드에는 적용되지 않습니다.', 'Trợ lý luôn tuân theo ở chế độ AI. Không áp dụng cho chế độ tích hợp.')),
      h('h4', L('내 단축 질문 (최대 8개)', 'Câu hỏi nhanh của tôi (tối đa 8)')), qBox,
      h('h4', L('AI 연결', 'Kết nối AI')), stateLn,
      h('label', L('Anthropic API 키', 'Anthropic API key'), keyIn), h('label', L('모델', 'Model'), modelIn),
      DB.mode === 'server' ? h('label', L('하루 AI 호출 한도 (0 = 제한 없음 · 질문 1개 = 호출 1~8회)', 'Hạn mức gọi AI mỗi ngày (0 = không giới hạn · 1 câu hỏi = 1~8 lần gọi)'), limitIn) : null, useLn,
      own ? null : h('div', { class: 'help' }, L('AI 키 · 모델 · 하루 한도는 ERP 가 실행 중인 PC 에서만 바꿀 수 있습니다. 여기서는 내 비서 설정만 저장됩니다.', 'API key · model · hạn mức chỉ đổi được trên máy đang chạy ERP. Ở đây chỉ lưu cài đặt trợ lý.')),
      h('label', { class: 'row' }, offChk, L('AI 사용 안 함 (내장 모드만 · 데이터가 외부로 나가지 않음)', 'Không dùng AI (chỉ chế độ tích hợp · dữ liệu không ra ngoài)')),
      h('div', { class: 'help' }, L('AI 모드에서는 질문에 필요한 조회 결과(수주·재고·생산 수치)가 Anthropic API로 전송되고 사용료가 부과됩니다. 비서는 ERP 데이터를 읽기만 합니다(수정 불가).', 'Ở chế độ AI, kết quả tra cứu cần thiết (đơn hàng, tồn kho, sản lượng) được gửi tới Anthropic API và có tính phí. Trợ lý chỉ đọc dữ liệu ERP (không sửa).')),
      h('div', { class: 'toolbar' },
        h('button', { type: 'button', class: 'btn primary', onclick: async () => {
          const items = qs.map(x => ({ label: String(x.label || '').trim(), text: String(x.text || '').trim() })).filter(x => x.text);
          Object.assign(DB.meta, { aiName: nameIn.value.trim(), aiUser: userIn.value.trim(), aiStyle: styleSel.value, aiPrompt: promptIn.value, aiQuick: items, aiOff: offChk.checked }); DB.saveMeta();
          if (own) { try { const lim = limitIn.value === '' ? undefined : Math.max(0, Math.floor(Number(limitIn.value) || 0)); await A.saveCfg(keyIn.value.trim() || undefined, modelIn.value.trim(), DB.mode === 'server' ? lim : undefined); keyIn.value = ''; } catch (e) { ERP.toast(friendlyError(e), 'bad'); return; } }
          upd(); refreshHeader(); redraw(); ERP.toast(L('저장됨', 'Đã lưu')); panel.classList.remove('cfg');
        } }, L('저장', 'Lưu')),
        h('button', { type: 'button', class: 'btn', onclick: async () => {
          try { if (own && keyIn.value.trim()) await A.saveCfg(keyIn.value.trim(), modelIn.value.trim()); keyIn.value = ''; const t = await A.test(); if (DB.mode === 'server') await A.loadCfg(); upd(); ERP.toast(L('AI 연결 성공', 'Kết nối AI thành công') + ' · ' + t.model + ' · ' + (t.ms / 1000).toFixed(1) + L('초', ' giây'), 'ok'); }
          catch (e) { upd(); ERP.toast(L('AI 연결 실패: ', 'Kết nối AI thất bại: ') + friendlyError(e), 'bad'); }
        } }, L('AI 연결 테스트', 'Kiểm tra kết nối AI')),
        own ? h('button', { type: 'button', class: 'btn', onclick: async () => { try { await A.saveCfg('', undefined); } catch (e) { ERP.toast(friendlyError(e), 'bad'); } upd(); refreshHeader(); } }, L('키 삭제', 'Xóa key')) : null,
        h('button', { type: 'button', class: 'btn', onclick: () => panel.classList.remove('cfg') }, L('닫기', 'Đóng'))));

    modeEl = h('span', { class: 'mode' }); titleEl = h('b', P.displayName());
    panel = h('div', { id: 'aiPanel', role: 'dialog', 'aria-label': P.displayName(), onkeydown: (e) => { if (e.key === 'Escape') panel.classList.remove('on'); } },
      h('div', { class: 'ah' }, h('div', { class: 't' }, titleEl, modeEl),
        h('button', { type: 'button', class: 'btn', title: L('넓게 보기 / 좁게 보기', 'Mở rộng / thu nhỏ'), onclick: () => { const w = !panel.classList.contains('wide'); panel.classList.toggle('wide', w); try { localStorage.setItem('erp_ai_wide', w ? '1' : ''); } catch (e) { /* ignore */ } } }, '⤢'),
        h('button', { type: 'button', class: 'btn', title: L('대화 초기화', 'Làm mới'), onclick: () => { A.history.length = 0; A.transcript.length = 0; redraw(); } }, '↺'),
        h('button', { type: 'button', class: 'btn', title: L('내 비서 설정', 'Cài đặt trợ lý'), onclick: async () => { if (!panel.classList.contains('cfg') && DB.mode === 'server') await A.loadCfg(); upd(); panel.classList.toggle('cfg'); } }, '⚙'),
        h('button', { type: 'button', class: 'btn', title: L('닫기', 'Đóng'), onclick: () => panel.classList.remove('on') }, '✕')),
      msgBox, settings,
      h('div', { class: 'af' }, input, h('button', { type: 'button', class: 'btn primary', onclick: () => send(input.value) }, L('전송', 'Gửi'))));
    redraw(); refreshHeader(); upd();
    try { if (localStorage.getItem('erp_ai_wide')) panel.classList.add('wide'); } catch (e) { /* ignore */ }
    document.body.appendChild(panel);
  }

  /** open the panel (optionally with a question, sent immediately) — usable from other screens: ERP.ai.open('5100356783') */
  A.open = async function (text, autoSend) {
    build(); if (A.hasKey === null) await A.loadCfg(); refreshHeader(); panel.classList.add('on');
    if (text) { if (autoSend) send(text); else { input.value = text; input.focus(); } } else input.focus();
  };
  function mount() {
    if (document.getElementById('aiFab')) return;
    const fab = h('button', { id: 'aiFab', type: 'button', 'aria-label': 'AI', onclick: () => { if (panel && panel.classList.contains('on')) panel.classList.remove('on'); else A.open(); } }, h('span', '✦'), h('span', P.displayName()));
    document.body.appendChild(fab);
    if (DB.ready) A.loadCfg().then(refreshHeader);
  }
  // the profile (name …) and the server mode are known only after the data is loaded: main.js calls this once the data is ready
  // (9차: 키 설정도 여기서 읽는다 — 예전에는 서버 모드를 알기 전에 읽어 재시작하면 AI 모드가 꺼져 있었다)
  ERP.aiReady = function () { refreshHeader(); A.loadCfg().then(refreshHeader); };
  // re-label on language switch / profile change: rebuild (the conversation is kept in A.transcript / A.history)
  ERP.aiMount = function () { const was = panel && panel.classList.contains('on'); if (panel) { panel.remove(); panel = null; built = false; } const f = document.getElementById('aiFab'); if (f) f.remove(); mount(); if (was) { build(); panel.classList.add('on'); } };
  if (document.readyState !== 'loading') setTimeout(mount, 0); else document.addEventListener('DOMContentLoaded', mount);
})();
