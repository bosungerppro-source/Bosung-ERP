'use strict';
/* Self-test for the AI production assistant ("나만의 비서" / "Trợ lý của tôi").
   Covers
     1. server: API-key protection (key never returned, only changeable from the PC itself), proxy headers / error mapping
     2. numbers: assistant tools == dashboard KPIs
     3. built-in mode: Korean / Vietnamese (with and without diacritics) / English questions on the real sample data
     4. UI: floating button, panel, quick questions, action buttons, language switch, personal settings, backup / wipe
     5. AI mode: scripted fake of the Anthropic API (tool loop, system prompt, error rollback, fallback to built-in mode)
     6. end-to-end through the real server proxy (upstream Anthropic call is faked)
     7. all screens open without errors; single-file demo mode (browser-direct API path)
   The real Anthropic API is NEVER called.
   Needs Playwright (development only):   npm i -D playwright      (CHROMIUM=<path of chrome/edge/chromium> to use an installed browser)
   Run:   npm run test:assistant            (add --no-demo to skip the demo-file part) */
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const ROOT = path.join(__dirname, '..');

let pw;
try { pw = require('playwright'); } catch (e) { try { pw = require('playwright-core'); } catch (e2) { console.error('Playwright가 필요합니다 / cần Playwright:  npm i -D playwright'); process.exit(2); } }
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });

// ---------- tiny test kit ----------
let pass = 0, fail = 0; const failures = [];
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 400 ? s.slice(0, 400) + '…' : s; };
function ok(name, cond, detail) { if (cond) { pass++; return true; } fail++; const line = name + (detail !== undefined ? '  → ' + short(detail) : ''); failures.push(line); console.log('  ✗ ' + line); return false; }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const section = (t) => console.log('\n■ ' + t);
const BAD_TEXT = /undefined|NaN|\[object|Infinity|\bnull\b/;
const HANGUL = /[\uac00-\ud7a3]/;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- server helpers ----------
const serverMod = require(path.join(ROOT, 'server.js'));
const tmpDirs = [];
const mkTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-assist-')); tmpDirs.push(d); return d; };
function req(port, method, p, body, opts) {
  return new Promise((resolve, reject) => {
    const r = http.request(Object.assign({ host: '127.0.0.1', port, path: p, method, headers: body !== undefined ? { 'content-type': 'application/json' } : {} }, opts || {}), (res) => {
      let d = ''; res.on('data', c => { d += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) { /* not json */ } resolve({ status: res.statusCode, text: d, json: j, headers: res.headers }); });
    });
    r.on('error', reject); if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body)); r.end();
  });
}
// fake of https://api.anthropic.com (the server process is this process, so global.fetch is what the proxy uses)
const upstream = { calls: [], script: [] };
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.anthropic.com/')) {
    upstream.calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    const s = upstream.script.shift();
    if (!s) return new Response(JSON.stringify({ type: 'error', error: { message: 'no scripted reply' } }), { status: 500, headers: { 'content-type': 'application/json' } });
    if (s instanceof Error) throw s;
    return new Response(JSON.stringify(s.body), { status: s.status || 200, headers: Object.assign({ 'content-type': 'application/json' }, s.headers || {}) });
  }
  return realFetch(url, init);
};
const textReply = (text) => ({ body: { id: 'msg_x', type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
const sysText = (sy) => (typeof sy === 'string' ? sy : (sy || []).map(b => b.text).join('\n'));   // 9차: system 은 캐시 표시를 단 text 블록 배열
const toolReply = (name, input, id) => ({ body: { id: 'msg_t', type: 'message', role: 'assistant', content: [{ type: 'text', text: '조회합니다' }, { type: 'tool_use', id: id || 'toolu_1', name, input: input || {} }], stop_reason: 'tool_use' } });

let portSeq = 3700 + Math.floor(Math.random() * 300) /* 4045 · 4190 은 브라우저가 막는 포트라 피함 */;
async function startServer(dataDir) { return serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir: dataDir || mkTmp(), host: '127.0.0.1', port: portSeq++ }); }

async function openApp(url, errors) {
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side') && document.getElementById('aiFab'), null, { timeout: 90000 });
  return { browser, page };
}

// ---------- the question table ----------
const TABLE = [
  // 9차: 예전에 잘못 알아듣던 질문 (ép lõi = 리필 성형 ≠ lỗi 불량 · 생산 지연 PO = 납기 · 끝난 PO · 품번+재고 · 모자란 · 품질/폐기/파손 · 어느 설비가 · 설비 사용 · 보류/취소 PO)
  ['ép lõi hôm qua bao nhiêu', 'production', 'vi'], ['sản lượng ép lõi tuần này', 'production', 'vi'], ['ep loi hom qua', 'production'], ['lỗi ép lõi tuần này', 'qd', 'vi'],
  ['생산 지연 PO', 'deadline', 'ko'], ['생산 지연', 'deadline', 'ko'], ['PO nào đã làm xong', 'orders', 'vi'], ['đã làm xong chưa', 'orders', 'vi'], ['어제 포장 완료 수량', 'production', 'ko'],
  ['52-0712-0-009 재고', 'material', 'ko'], ['52-0712-0-009', 'orders'], ['모자란 자재', 'low_stock', 'ko'], ['chất lượng tuần này', 'qd', 'vi'], ['phế phẩm tháng này', 'qd', 'vi'], ['hàng hỏng hôm qua', 'qd', 'vi'],
  ['máy nào dừng nhiều nhất', 'qd', 'vi'], ['sử dụng máy', 'production', 'vi'], ['tình hình sử dụng máy tuần này', 'production', 'vi'], ['설비 가동 현황', 'production', 'ko'],
  ['PO tạm ngưng', 'orders', 'vi'], ['보류된 수주', 'orders', 'ko'], ['취소된 PO', 'orders', 'ko'], ['dừng máy hôm qua', 'qd', 'vi'],
  // Korean
  ['오늘 브리핑', 'briefing', 'ko'], ['오늘 현황 요약해줘', 'briefing', 'ko'], ['전체 현황', 'briefing', 'ko'], ['현황', 'briefing', 'ko'],
  ['납기 위험 PO', 'deadline', 'ko'], ['납기 경과 PO', 'deadline', 'ko'], ['지연된 수주', 'deadline', 'ko'], ['7일 내 납기', 'deadline', 'ko'], ['납기 임박한 수주', 'deadline', 'ko'], ['오래된 지연 PO', 'deadline', 'ko'],
  ['안전재고 미달 자재', 'low_stock', 'ko'], ['재고 부족한 자재', 'low_stock', 'ko'], ['부족한 원료 알려줘', 'low_stock', 'ko'],
  ['HDPE 재고', 'material', 'ko'], ['R-001 재고', 'material', 'ko'], ['발주 필요한 자재', 'reorder', 'ko'], ['발주해야 할 자재', 'reorder', 'ko'],
  ['어제 생산 요약', 'production', 'ko'], ['이번 주 포장 실적', 'production', 'ko'], ['조립 지난주 실적', 'production', 'ko'], ['포장 어제', 'production', 'ko'], ['사출 오늘', 'production', 'ko'],
  ['어제 불량률', 'qd', 'ko'], ['NG율 이번 달', 'qd', 'ko'], ['설비 정지 시간', 'qd', 'ko'], ['지난달 고장', 'qd', 'ko'],
  ['자재 소요량', 'mrp_ask', 'ko'], ['MRP', 'mrp_ask', 'ko'], ['진행 중 수주', 'orders', 'ko'], ['수주 목록', 'orders', 'ko'], ['완료된 수주', 'orders', 'ko'],
  ['안녕', 'greet', 'ko'], ['고마워', 'thanks', 'ko'], ['도움말', 'help', 'ko'], ['', 'help', 'ko'],
  // Vietnamese with diacritics
  ['Bản tin hôm nay', 'briefing', 'vi'], ['Tóm tắt hôm nay', 'briefing', 'vi'], ['Tình hình chung', 'briefing', 'vi'],
  ['PO sắp đến hạn', 'deadline', 'vi'], ['Đơn hàng trễ hạn', 'deadline', 'vi'], ['PO quá hạn', 'deadline', 'vi'], ['PO quá hạn lâu', 'deadline', 'vi'],
  ['NVL dưới tồn an toàn', 'low_stock', 'vi'], ['NVL sắp hết', 'low_stock', 'vi'], ['Tồn kho HDPE', 'material', 'vi'], ['NVL cần đặt hàng', 'reorder', 'vi'], ['Cần mua thêm gì', 'reorder', 'vi'],
  ['Sản lượng hôm qua', 'production', 'vi'], ['Đóng gói tuần này', 'production', 'vi'], ['Lắp ráp tuần trước', 'production', 'vi'], ['Sản xuất hôm nay', 'production', 'vi'],
  ['Tỷ lệ lỗi hôm qua', 'qd', 'vi'], ['Thời gian dừng máy', 'qd', 'vi'], ['Máy hỏng tháng này', 'qd', 'vi'],
  ['Nhu cầu NVL', 'mrp_ask', 'vi'], ['Danh sách đơn hàng đang mở', 'orders', 'vi'], ['Xin chào', 'greet', 'vi'], ['Cảm ơn', 'thanks', 'vi'], ['Giúp tôi', 'help', 'vi'], ['Bạn làm được gì', 'help', 'vi'],
  // Vietnamese without diacritics
  ['Ban tin hom nay', 'briefing', 'vi'], ['don hang tre han', 'deadline', 'vi'], ['PO qua han lau', 'deadline', 'vi'], ['PO sap den han', 'deadline', 'vi'],
  ['NVL duoi ton an toan', 'low_stock', 'vi'], ['ton kho HDPE', 'material', 'vi'], ['NVL can dat hang', 'reorder', 'vi'],
  ['San luong hom qua', 'production', 'vi'], ['dong goi tuan nay', 'production', 'vi'], ['ty le loi hom qua', 'qd', 'vi'], ['dung may hom qua', 'qd', 'vi'],
  ['nhu cau NVL', 'mrp_ask', 'vi'], ['xin chao', 'greet', 'vi'], ['cam on', 'thanks', 'vi'],
  // English (answered in the screen language)
  ['show late orders', 'deadline'], ['overdue POs', 'deadline'], ['stale POs', 'deadline'], ['daily report', 'briefing'], ['low stock materials', 'low_stock'], ['stock of HDPE', 'material'],
  ['what should I reorder', 'reorder'], ['production yesterday', 'production'], ['packing this week', 'production'], ['defect rate last week', 'qd'], ['machine downtime', 'qd'],
  ['hello', 'greet'], ['thanks', 'thanks'], ['help', 'help'], ['what can you do', 'help'],
];

(async () => {
  const errors = [];

  // =====================================================================================================
  section('1. 서버: API 키 보호 · 프록시');
  {
    const dataDir = mkTmp(); const S = await startServer(dataDir);
    let r = await req(S.port, 'GET', '/api/ai/config');
    ok('키 없음 상태', r.status === 200 && r.json.hasKey === false && r.json.keyTail === '', r.json);
    r = await req(S.port, 'POST', '/api/ai/messages', { messages: [] });
    ok('키 없이 호출하면 400 NO_KEY', r.status === 400 && /NO_KEY/.test(r.text), r.text);

    const KEY = 'sk-ant-api03-TESTKEY-1234567890-wxyz';
    r = await req(S.port, 'PUT', '/api/ai/config', { key: KEY, model: 'claude-test-model' });
    ok('키 저장', r.status === 200 && r.json.hasKey === true && r.json.model === 'claude-test-model' && r.json.keyTail === 'wxyz', r.json);
    ok('저장 응답에 키 전체가 없음', !r.text.includes('TESTKEY'), r.text);
    r = await req(S.port, 'GET', '/api/ai/config');
    ok('조회 응답에 키 전체가 없음 (끝 4자리만)', r.status === 200 && !r.text.includes('TESTKEY') && r.json.keyTail === 'wxyz', r.text);
    const f = path.join(dataDir, 'ai.json');
    ok('ai.json 에 보관', fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).key === KEY);
    if (process.platform !== 'win32') ok('ai.json 권한 600', (fs.statSync(f).mode & 0o777) === 0o600, (fs.statSync(f).mode & 0o777).toString(8));
    r = await req(S.port, 'GET', '/api/db');
    ok('/api/db (전체 데이터)에 키가 섞이지 않음', !r.text.includes('TESTKEY'));
    r = await req(S.port, 'GET', '/api/info');
    ok('/api/info 에 키가 섞이지 않음', !r.text.includes('TESTKEY'));

    // proxy → fake upstream
    upstream.calls.length = 0; upstream.script = [textReply('pong')];
    r = await req(S.port, 'POST', '/api/ai/messages', { max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] });
    const c0 = upstream.calls[0] || {};
    ok('프록시: 응답 전달', r.status === 200 && r.json && r.json.content && r.json.content[0].text === 'pong', r.text);
    ok('프록시: Anthropic 주소·키·버전 헤더', c0.url === 'https://api.anthropic.com/v1/messages' && c0.headers['x-api-key'] === KEY && c0.headers['anthropic-version'] === '2023-06-01', c0);
    ok('프록시: 설정된 모델 사용', c0.body && c0.body.model === 'claude-test-model', c0.body);
    upstream.script = [{ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }];
    const one = { messages: [{ role: 'user', content: 'x' }] };
    r = await req(S.port, 'POST', '/api/ai/messages', one);
    ok('프록시: 401 그대로 전달', r.status === 401 && /invalid x-api-key/.test(r.text), r.text);
    const te = new Error('The operation was aborted due to timeout'); te.name = 'TimeoutError'; upstream.script = [te];
    r = await req(S.port, 'POST', '/api/ai/messages', one);
    ok('프록시: 시간 초과 → 504 Timeout', r.status === 504 && /Timeout/.test(r.text), r.text);
    upstream.script = [new Error('fetch failed')];
    r = await req(S.port, 'POST', '/api/ai/messages', one);
    ok('프록시: 네트워크 오류 → 502 Network', r.status === 502 && /Network/.test(r.text), r.text);
    ok('프록시 오류 응답에 키가 없음', !r.text.includes('TESTKEY'));

    // 9차: 중계는 정해진 필드만 넘기고 모델 · 길이는 서버 설정으로, 서버 도구는 거절, retry-after 전달, 하루 사용량 · 한도
    upstream.calls.length = 0; upstream.script = [textReply('ok1')];
    r = await req(S.port, 'POST', '/api/ai/messages', { model: 'claude-fable-5-1', max_tokens: 999999, stream: true, temperature: 0.2, metadata: { user_id: 'x' }, messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'overview', description: 'd', input_schema: { type: 'object', properties: {} }, cache_control: { type: 'ephemeral' } }], tool_choice: { type: 'any' }, output_config: { effort: 'max', format: { type: 'json_schema' } }, fallbacks: 'default', cache_control: { type: 'ephemeral', ttl: '1h' } });
    let ub = (upstream.calls[0] || {}).body || {};
    ok('중계: 모델은 서버 설정 · max_tokens 16000 이하 · 모르는 필드 버림', r.status === 200 && ub.model === 'claude-test-model' && ub.max_tokens === 16000 && !('stream' in ub) && !('temperature' in ub) && !('metadata' in ub) && !('tool_choice' in ub) && !('output_config' in ub), ub);
    ok('중계: fallbacks 는 받는 모델일 때만 (베타 헤더도)', !('fallbacks' in ub) && !(upstream.calls[0].headers || {})['anthropic-beta'] && ub.cache_control && ub.cache_control.type === 'ephemeral' && !ub.cache_control.ttl, { fb: ub.fallbacks, h: upstream.calls[0].headers });
    await req(S.port, 'PUT', '/api/ai/config', { model: 'claude-sonnet-5-5' });
    upstream.calls.length = 0; upstream.script = [textReply('ok2')];
    await req(S.port, 'POST', '/api/ai/messages', { messages: [{ role: 'user', content: 'hi' }], output_config: { effort: 'low' }, fallbacks: 'default', tool_choice: { type: 'none' } });
    ub = (upstream.calls[0] || {}).body || {};
    ok('중계: claude-sonnet-5-5 → fallbacks "default" + server-side-fallback-2026-07-01 헤더 · effort low · tool_choice none', ub.fallbacks === 'default' && upstream.calls[0].headers['anthropic-beta'] === 'server-side-fallback-2026-07-01' && ub.output_config.effort === 'low' && ub.tool_choice.type === 'none', { ub, h: upstream.calls[0].headers });
    upstream.calls.length = 0;
    r = await req(S.port, 'POST', '/api/ai/messages', { messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'web_search_20260209', name: 'web_search' }] });
    ok('중계: 서버 도구(웹 검색 등)는 거절 · Anthropic 호출 없음', r.status === 400 && /custom tools/.test(r.text) && upstream.calls.length === 0, r.text);
    upstream.script = [{ status: 429, headers: { 'retry-after': '7' }, body: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } } }];
    r = await req(S.port, 'POST', '/api/ai/messages', one);
    ok('중계: 429 의 retry-after 전달', r.status === 429 && r.headers['retry-after'] === '7', r.headers);
    let cf = (await req(S.port, 'GET', '/api/ai/config')).json; const used0 = cf.today.requests;
    upstream.script = [{ body: { id: 'm', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'u' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 5 } } }];
    await req(S.port, 'POST', '/api/ai/messages', one);
    cf = (await req(S.port, 'GET', '/api/ai/config')).json;
    ok('하루 사용량 기록 (호출 · 입력 · 출력 · 캐시)', cf.today.requests === used0 + 1 && cf.today.input_tokens >= 100 && cf.today.output_tokens >= 20 && cf.today.cache_read >= 50 && cf.dailyLimit === 400, cf);
    await req(S.port, 'PUT', '/api/ai/config', { dailyLimit: used0 + 2 });
    upstream.script = [textReply('last')]; const okLast = (await req(S.port, 'POST', '/api/ai/messages', one)).status;
    upstream.calls.length = 0; r = await req(S.port, 'POST', '/api/ai/messages', one);
    ok('하루 한도를 넘으면 429 DAILY_LIMIT · Anthropic 호출 없음', okLast === 200 && r.status === 429 && /DAILY_LIMIT/.test(r.text) && upstream.calls.length === 0, r.text);
    await req(S.port, 'PUT', '/api/ai/config', { dailyLimit: 0, model: 'claude-test-model' });
    upstream.script = [textReply('free')]; ok('한도 0 = 제한 없음', (await req(S.port, 'POST', '/api/ai/messages', one)).status === 200);
    ok('사용량 파일에 키가 없음', !fs.readFileSync(path.join(dataDir, 'ai_usage.json'), 'utf8').includes('TESTKEY'));

    // another machine on the LAN must not be able to read or change the key (simulated with a different loopback source address)
    let lan; try { lan = await req(S.port, 'PUT', '/api/ai/config', { key: 'sk-ant-evil' }, { localAddress: '127.0.0.2' }); } catch (e) { lan = null; }
    // 9차: 사내망 PIN 으로 들어오기 전에는 401(LOGIN), PIN 으로 들어온 뒤에도 키 변경은 403 (selftest_v9 에서 확인)
    if (lan) { ok('다른 PC에서는 키 변경 불가 (401 로그인 전)', lan.status === 401 || lan.status === 403, lan.text); const g = await req(S.port, 'GET', '/api/ai/config'); ok('거부된 뒤에도 기존 키 유지', g.json.keyTail === 'wxyz'); }
    else console.log('  (건너뜀: 127.0.0.2 로 연결할 수 없는 환경 — LAN 거부 시험 생략)');

    r = await req(S.port, 'PUT', '/api/ai/config', { key: '' });
    ok('키 삭제', r.status === 200 && r.json.hasKey === false && r.json.keyTail === '', r.json);
    ok('삭제 후 ai.json 에 키 없음', !JSON.parse(fs.readFileSync(f, 'utf8')).key);
    S.close();
  }

  // =====================================================================================================
  const dataDir = mkTmp(); const S = await startServer(dataDir);
  const { browser, page } = await openApp(S.url, errors);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const mode = await ev(() => ERP.db.mode); eq('서버 저장 모드로 실행', mode, 'server');

  // =====================================================================================================
  section('2. 숫자: 비서 도구 = 대시보드');
  {
    const r = await ev(() => {
      ERP.goto('dashboard'); const txt = document.querySelector('.wgrid').innerText;
      const ov = ERP.ai.tools.overview(), T = ERP.ai.tools, C = ERP.calc, o = { txt, ov };
      o.late = T.find_orders({ status: 'late', limit: 500 }); o.stale = T.find_orders({ status: 'stale', limit: 500 }); o.soon = T.find_orders({ status: 'due_soon', limit: 500 }); o.open = T.find_orders({ status: 'open', limit: 1 });
      o.low = T.material_stock({ only_low: true, limit: 500 }); o.re = T.reorder({ limit: 500 });
      const day = ov.latest_production_date; o.day = day; o.prod = T.production_summary({ from: day, to: day });
      const pck = C.agg(C.rowsBetween(day, day, 'PCK')); o.dashPck = { ok: pck.ok, ea: pck.ea };
      o.bad = T.production_summary({ from: '2026-13-45', to: '2026-13-46' });
      o.noPo = T.get_po({ po_no: 'NO-SUCH-PO-123' });
      return o;
    });
    const num = (re) => { const m = r.txt.match(re); return m ? +m[1].replace(/,/g, '') : null; };
    eq('진행 중 PO = 대시보드 "진행 중"', r.ov.open_po, num(/진행 중\s*([\d,]+)건/));
    eq('납기 경과 PO = 대시보드 "경과"', r.ov.late_po, num(/경과\s*([\d,]+)/));
    eq('7일 내 납기 = 대시보드', r.ov.due_within_7days, num(/7일 내 납기\s*([\d,]+)건/));
    eq('안전재고 미달 = 대시보드', r.ov.materials_below_safety, num(/안전재고 미달 자재\s*([\d,]+)\s*품목/));
    eq('find_orders(late).total = overview.late_po', r.late.total, r.ov.late_po);
    eq('find_orders(stale).total = overview.stale_late_po', r.stale.total, r.ov.stale_late_po);
    eq('find_orders(due_soon).total = overview.due_within_7days', r.soon.total, r.ov.due_within_7days);
    eq('find_orders(open).total = overview.open_po', r.open.total, r.ov.open_po);
    ok('경과 PO 는 오래된 순 (D-일수 오름차순)', r.late.rows.every((x, i, a) => !i || a[i - 1].days_to_due <= x.days_to_due), r.late.rows.map(x => x.days_to_due).slice(0, 8));
    ok('경과 PO 는 모두 60일 이내', r.late.rows.every(x => x.days_to_due >= -60 && x.days_to_due < 0), r.late.rows.map(x => x.days_to_due));
    ok('오래된 지연(stale) PO 는 모두 60일 초과', r.stale.rows.every(x => x.days_to_due < -60));
    ok('stale 진행률 분류 합계 = 전체', r.stale.stale_breakdown && r.stale.stale_breakdown.zero_progress + r.stale.stale_breakdown.ge90_progress + r.stale.stale_breakdown.in_between === r.stale.total, r.stale.stale_breakdown);
    eq('material_stock(only_low).total = 안전재고 미달', r.low.total, r.ov.materials_below_safety);
    ok('발주 목록은 모두 권장 수량 > 0', r.re.rows.length > 0 && r.re.rows.every(x => x.recommended_order > 0), r.re.rows.slice(0, 3));
    eq('발주 대상 수 = 안전재고 미달 수', r.re.total_below_safety, r.ov.materials_below_safety);
    ok('마스터 자재 수 = 안전재고 설정 수 이상', r.ov.materials_total >= r.ov.materials_with_safety_set && r.ov.materials_total > 0, r.ov);
    const pck = (r.prod.output || []).find(x => x.process === 'PCK');
    ok('최근 일보 포장 set 수 = 대시보드 포장 실적', pck && pck.good_sets === r.dashPck.ok && pck.good_pcs === r.dashPck.ea, { pck, dash: r.dashPck });
    ok('잘못된 날짜는 오류로 알려줌 (0건 아님)', r.bad && r.bad.error, r.bad);
    ok('없는 PO 는 오류 + 비슷한 번호 목록 필드', r.noPo && r.noPo.error && Array.isArray(r.noPo.similar_po_numbers), r.noPo);
  }

  // =====================================================================================================
  section('3. 내장 모드: 질문 분류');
  {
    const res = await ev((table) => table.map(([u, want, lang]) => { const q = ERP.ai.localParse(u); return { u, want, lang, got: q.intent.name, gotLang: q.lang }; }), TABLE);
    res.forEach(x => ok('"' + x.u + '" → ' + x.want + (x.lang ? '/' + x.lang : ''), x.got === x.want && (!x.lang || x.gotLang === x.lang), 'got ' + x.got + '/' + x.gotLang));
  }
  {
    // entities taken from the real data
    const e = await ev(() => {
      const C = ERP.calc, DB = ERP.db, o = {};
      const open = C.poGroups().filter(g => g.st !== 'done' && /^\d{8,}$/.test(String(g.po_no)));
      o.po = (open.find(g => g.st === 'prod') || open[0]).po_no;
      const withBom = new Set(DB.rows('bom').map(b => b.retail_no));
      o.item = Array.from(new Set(DB.rows('po').map(p => p.item_no))).find(i => i && /^\d\d-\d{4}-/.test(i) && withBom.has(i)) || '';
      o.mat = Array.from(C.stock().keys()).find(k => /^[A-Z]-\d{3}$/.test(k)) || '';
      o.cust = Array.from(new Set(DB.rows('po').map(p => String(p.customer || '').trim()))).find(c => c.length >= 5 && !/^from$/i.test(c)) || '';
      return o;
    });
    ok('시험용 PO·품번·자재·고객을 데이터에서 찾음', e.po && e.item && e.mat && e.cust, e);
    const cases = [
      [e.po, 'po'], ['PO ' + e.po + ' 진행 상황', 'po'], [e.po + ' 자재 소요량', 'mrp'], ['PO ' + e.po + ' tiến độ thế nào', 'po', 'vi'], ['nhu cầu NVL của PO ' + e.po, 'mrp', 'vi'],
      [e.item, 'orders'], [e.item + ' 자재 소요량', 'mrp'], ['mã hàng ' + e.item, 'orders', 'vi'],
      [e.mat + ' 재고', 'material'], ['tồn kho ' + e.mat, 'material', 'vi'], [e.mat, 'material'],
      [e.cust + ' 납기', 'deadline'], [e.cust + ' 수주 현황', 'orders'], ['đơn hàng của ' + e.cust, 'orders', 'vi'],
    ];
    const res = await ev((cs) => cs.map(([u, want, lang]) => { const q = ERP.ai.localParse(u); return { u, want, lang, got: q.intent.name, gotLang: q.lang }; }), cases);
    res.forEach(x => ok('"' + x.u + '" → ' + x.want, x.got === x.want && (!x.lang || x.gotLang === x.lang), 'got ' + x.got + '/' + x.gotLang));

    // every answer: no undefined / NaN / [object …], no exception; Vietnamese answers contain no Korean in the fixed text
    const utter = TABLE.map(t => t[0]).concat(cases.map(c => c[0])).concat([
      '5월 3일 생산', '2026-10-01 ~ 2026-10-10 포장', '최근 7일 불량률', 'sản lượng 3 ngày gần đây', 'tháng trước đóng gói', '어제 사출 정지', 'ngày 5 tháng 10 lắp ráp', 'last 14 days assembly',
      '아무말 대잔치', 'zzzzqx', '????', '   ', 'a', '1', 'ㅋㅋㅋ', '<script>alert(1)</script>', 'PO', '재고', 'ton']);
    const all = await ev((us) => ['ko', 'vi'].flatMap(lang => { ERP.lang = lang; return us.map(u => { try { const a = ERP.ai.localAnswer(u); return { lang, u, intent: a.intent, outLang: a.lang, text: a.text, n: a.actions.length }; } catch (err) { return { lang, u, err: String(err && err.stack || err) }; } }); }), utter);
    await ev(() => { ERP.lang = 'ko'; });
    const thrown = all.filter(x => x.err), badTxt = all.filter(x => x.text !== undefined && (BAD_TEXT.test(x.text) || !x.text.trim()));
    ok('질문 ' + all.length + '개에서 예외 없음', !thrown.length, thrown.slice(0, 2));
    ok('답변에 undefined/NaN/[object 가 없음 · 빈 답변 없음', !badTxt.length, badTxt.slice(0, 3).map(x => [x.u, x.text.split('\n').filter(l => BAD_TEXT.test(l)).slice(0, 2)]));
    const koInVi = all.filter(x => x.outLang === 'vi' && x.text).map(x => ({ u: x.u, lines: x.text.split('\n').filter(l => HANGUL.test(l) && !/^\s*[▸·]/.test(l) && !l.includes(x.u)) })).filter(x => x.lines.length);
    ok('베트남어 답변의 고정 문구에 한글이 섞이지 않음', !koInVi.length, koInVi.slice(0, 3));
    const unknown = all.find(x => x.u === 'zzzzqx' && x.lang === 'ko');
    ok('모르는 질문은 지어내지 않고 도움말을 보여줌', unknown && /이렇게 물어보세요/.test(unknown.text), unknown && unknown.text.slice(0, 80));
  }
  {
    // numbers inside answers match the tools
    const r = await ev(() => { const ov = ERP.ai.tools.overview(); return { ov, brief: ERP.ai.localAnswer('오늘 브리핑').text, dl: ERP.ai.localAnswer('납기 경과 PO').text, low: ERP.ai.localAnswer('안전재고 미달 자재').text }; });
    ok('브리핑에 진행 중·경과·7일 내 납기 숫자가 대시보드와 같음', r.brief.includes('진행 중 ' + r.ov.open_po + '건') && r.brief.includes('납기 경과 ' + r.ov.late_po + '건') && r.brief.includes('7일 내 납기 ' + r.ov.due_within_7days + '건'), r.brief.split('\n').filter(l => /\[수주\]/.test(l)));
    ok('납기 경과 답변 머리글 건수 = overview.late_po', new RegExp('— ' + r.ov.late_po + '건').test(r.dl), r.dl.split('\n')[0]);
    ok('안전재고 답변 머리글 건수 = overview', new RegExp('— ' + r.ov.materials_below_safety + '종').test(r.low), r.low.split('\n')[0]);
    ok('60일 초과 지연 건수를 별도 안내', r.ov.stale_late_po === 0 || r.brief.includes(String(r.ov.stale_late_po)), r.brief.split('\n').filter(l => /※/.test(l)));
    const recon = (r.ov.late_po + r.ov.stale_late_po) + '건 = ' + r.ov.late_po + ' + ' + r.ov.stale_late_po;
    ok('수주 화면 "납기 경과" 탭 숫자(경과+60일 초과)와 맞춰 볼 수 있게 안내', r.ov.stale_late_po === 0 || (r.brief.includes(recon) && r.dl.includes(recon)), recon);
  }

  // =====================================================================================================
  section('4. 화면: 비서 창 · 버튼 · 언어 · 내 설정');
  {
    const vis = (sel) => page.locator(sel).isVisible();
    ok('우측 하단 ✦ 버튼', await vis('#aiFab'));
    ok('처음엔 창이 닫혀 있음', !(await vis('#aiPanel')));
    await page.click('#aiFab'); await page.waitForSelector('#aiPanel.on');
    ok('버튼을 누르면 창이 열림', await vis('#aiPanel'));
    const head = await page.locator('#aiPanel .ah').innerText();
    ok('내장 모드 표시 (키 없음)', /내장 모드/.test(head), head);
    eq('기본 단축 질문 4개', await page.locator('#aiPanel .chips button').count(), 4);
    await page.click('#aiPanel .chips button:nth-child(1)');
    await page.waitForFunction(() => document.querySelectorAll('#aiPanel .b.a').length >= 2, null, { timeout: 15000 });
    let txt = await page.locator('#aiPanel .am').innerText();
    ok('브리핑 답변이 화면에 나옴', /■ 오늘 브리핑/.test(txt) && /\[수주\]/.test(txt) && /\[자재\]/.test(txt), txt.slice(0, 200));
    ok('답변 아래에 이동 버튼', (await page.locator('#aiPanel .acts button').count()) >= 2);
    await page.locator('#aiPanel .acts button', { hasText: '수주 관리 열기' }).first().click();
    await sleep(300);
    eq('"수주 관리 열기" → #/orders', await ev(() => location.hash), '#/orders');
    ok('화면 이동 후에도 비서 창 유지', await vis('#aiPanel'));

    // free typing + Enter
    const po = await ev(() => ERP.calc.poGroups().find(g => g.st === 'prod' && /^\d{8,}$/.test(String(g.po_no))).po_no);
    await page.fill('#aiPanel .af textarea', 'PO ' + po + ' 진행 상황'); await page.press('#aiPanel .af textarea', 'Enter');
    await page.waitForFunction((p) => Array.from(document.querySelectorAll('#aiPanel .b.a')).some(e => e.textContent.includes('■ PO ' + p)), po, { timeout: 15000 });
    ok('PO 번호 질문 → PO 상세 답변', true);
    await page.locator('#aiPanel .acts button', { hasText: '이 PO 열기' }).last().click(); await sleep(300);
    eq('"이 PO 열기" → 수주 화면', await ev(() => location.hash), '#/orders');
    ok('PO 가 선택되어 표시됨', await ev((p) => ERP.state.ord && ERP.state.ord.sel === String(p), po));
    await page.locator('#aiPanel .acts button', { hasText: '자재 소요량 화면에서 보기' }).last().click(); await sleep(500);
    ok('"MRP 화면" 버튼 → 제품·BOM 화면', (await ev(() => location.hash)) === '#/bom');

    // every action button of several answers runs without errors
    const labels = await ev(() => ['오늘 브리핑', '납기 위험 PO', '안전재고 미달 자재', 'HDPE 재고', '발주 필요한 자재', '어제 생산 요약', '어제 불량률'].map(q => ({ q, a: ERP.ai.localAnswer(q).actions.length })));
    ok('모든 답변에 이동 버튼이 있음', labels.every(x => x.a >= 1), labels);
    const nBtn = await ev(() => { let n = 0; ['오늘 브리핑', '납기 위험 PO', '안전재고 미달 자재', 'HDPE 재고', '발주 필요한 자재', '어제 생산 요약', '어제 불량률', '5100361450', 'R-001'].forEach(q => { const a = ERP.ai.localAnswer(q); a.actions.forEach(b => { b.run(); n++; document.querySelectorAll('.modal-back').forEach(m => m.remove()); }); }); return n; });
    ok('이동 버튼 ' + nBtn + '개 실행 (오류 없음)', nBtn > 10 && !errors.length, errors);

    // language switch keeps the conversation
    await ev(() => ERP.goto('dashboard'));
    const before = await page.locator('#aiPanel .b').count();
    await ev(() => ERP.setLang('vi')); await sleep(300);
    ok('언어를 바꿔도 비서 창이 열려 있음', await vis('#aiPanel'));
    ok('언어를 바꿔도 대화 내용 유지', (await page.locator('#aiPanel .b').count()) >= before - 1, { before, after: await page.locator('#aiPanel .b').count() });
    eq('버튼 이름이 베트남어로 바뀜', (await page.locator('#aiFab').innerText()).replace(/\s+/g, ' ').trim(), '✦ Trợ lý AI');
    // static texts in Vietnamese: clear the (Korean) transcript, rebuild, look for Hangul
    await ev(() => { ERP.ai.transcript.length = 0; ERP.aiMount(); });
    await page.waitForSelector('#aiPanel.on');
    await page.click('#aiPanel .ah button[title="Cài đặt trợ lý"]');
    const stat = await ev(() => { const p = document.getElementById('aiPanel'); const attrs = Array.from(p.querySelectorAll('[placeholder],[title],[aria-label]')).map(e => e.getAttribute('placeholder') || e.getAttribute('title') || e.getAttribute('aria-label')); return { text: p.innerText, attrs, fab: document.getElementById('aiFab').innerText }; });
    ok('베트남어 화면의 비서 창(설정 포함)에 한글이 없음', !HANGUL.test(stat.text + ' ' + stat.attrs.join(' ') + ' ' + stat.fab), (stat.text + ' ' + stat.attrs.join(' ')).match(/.{0,20}[\uac00-\ud7a3]+.{0,20}/g));
    await page.click('#aiPanel .set .toolbar button:last-child'); // close settings
    // a Vietnamese question typed in the Vietnamese UI
    await page.fill('#aiPanel .af textarea', 'Sản lượng hôm qua'); await page.press('#aiPanel .af textarea', 'Enter');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#aiPanel .b.a')).some(e => /■ Sản lượng/.test(e.textContent)), null, { timeout: 15000 });
    ok('베트남어 질문 → 베트남어 생산 답변', true);
    await ev(() => ERP.setLang('ko')); await sleep(200);
  }
  {
    // ---- my assistant: name / title / style / notes / own quick questions
    await page.click('#aiPanel .ah button[title="내 비서 설정"]');
    const inputs = page.locator('#aiPanel .set input.inp');
    await inputs.nth(0).fill('소미'); await inputs.nth(1).fill('박 팀장님');
    await page.locator('#aiPanel .set select.inp').selectOption('detail');
    await page.locator('#aiPanel .set textarea').fill('우선순위: 납기 > 재고. "서리"는 포장 박스를 뜻한다.');
    await page.click('#aiPanel .set button:has-text("내 질문 추가")');
    const q = page.locator('#aiPanel .set .qrow'); await q.nth(0).locator('input').nth(0).fill('오늘 포장'); await q.nth(0).locator('input').nth(1).fill('이번 주 포장 실적');
    await page.click('#aiPanel .set button:has-text("내 질문 추가")');
    await q.nth(1).locator('input').nth(1).fill('안전재고 미달 자재'); // no label → text is used
    await page.click('#aiPanel .set button:has-text("내 질문 추가")'); // empty row: must be dropped on save
    await page.click('#aiPanel .set .toolbar button:has-text("저장")'); await sleep(500);
    const meta = await ev(() => ({ n: ERP.db.setting('aiName'), u: ERP.db.setting('aiUser'), s: ERP.db.setting('aiStyle'), p: ERP.db.setting('aiPrompt'), q: ERP.db.setting('aiQuick'), off: ERP.db.setting('aiOff') }));
    eq('이름·호칭·스타일 저장', [meta.n, meta.u, meta.s], ['소미', '박 팀장님', 'detail']);
    ok('공장 지침 저장', /서리/.test(meta.p), meta.p);
    eq('내 단축 질문 저장 (빈 항목 제외)', meta.q, [{ label: '오늘 포장', text: '이번 주 포장 실적' }, { label: '', text: '안전재고 미달 자재' }]);
    eq('버튼에 비서 이름 표시', (await page.locator('#aiFab').innerText()).replace(/\s+/g, ' ').trim(), '✦ 소미');
    eq('창 제목이 비서 이름', (await page.locator('#aiPanel .ah b').innerText()).trim(), '소미');
    const chips = await page.locator('#aiPanel .chips button').allInnerTexts();
    ok('내 단축 질문이 ★ 버튼으로 나타남', chips.includes('★ 오늘 포장') && chips.some(c => c.startsWith('★ 안전재고')), chips);
    const greet = await page.locator('#aiPanel .am .b.a').first().innerText();
    ok('인사말에 호칭과 이름', /박 팀장님/.test(greet) && /소미/.test(greet), greet.slice(0, 80));
    await page.click('#aiPanel .chips button.me >> nth=0'); await page.waitForFunction(() => Array.from(document.querySelectorAll('#aiPanel .b.a')).some(e => /■ 생산 실적/.test(e.textContent)), null, { timeout: 15000 });
    ok('★ 단축 질문 실행 → 포장 실적 답변', true);

    // persisted on the server and included in a backup
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8'));
    ok('서버 meta.json 에 저장됨', saved.aiName === '소미' && saved.aiUser === '박 팀장님' && saved.aiQuick.length === 2, saved);
    const snap = await ev(() => ERP.db.snapshot().meta);
    ok('백업(스냅샷)에 비서 설정 포함', snap.aiName === '소미' && snap.aiPrompt && snap.aiQuick.length === 2, snap);
    ok('API 키는 meta·백업에 들어가지 않음', !JSON.stringify(saved).includes('sk-ant') && !JSON.stringify(snap).includes('sk-ant'));

    // reload → still there
    await page.reload(); await page.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.getElementById('aiFab'), null, { timeout: 60000 });
    eq('새로고침 후에도 비서 이름 유지', (await page.locator('#aiFab').innerText()).replace(/\s+/g, ' ').trim(), '✦ 소미');
  }

  // =====================================================================================================
  section('4-1. 7차: 답변은 표 + 표 밑 코멘트 (내장 모드 블록 · AI 모드 Markdown)');
  {
    const r = await ev(() => {
      const kinds = ['오늘 브리핑', '납기 위험 PO', '안전재고 미달 자재', 'HDPE 재고', '발주 필요한 자재', '어제 생산 요약', '어제 불량률', 'Bản tin hôm nay', 'PO quá hạn'];
      const out = kinds.map(q => { const a = ERP.ai.localAnswer(q); const tables = (a.blocks || []).filter(b => b.t === 'table'); return { q, lang: a.lang, n: tables.length, rowsOk: tables.every(t => t.rows.every(rw => rw.length === t.cols.length)), cmt: tables.filter(t => t.cmt).length, text: a.text, blocks: a.blocks }; });
      // Vietnamese answers: no Korean in the fixed parts (titles, sections, column labels, comments, notes)
      const viKo = []; out.filter(x => x.lang === 'vi').forEach(x => x.blocks.forEach(b => { const fixed = [b.text, b.title, b.cmt, b.more].concat(b.cols ? b.cols.map(c => c.l) : []).concat(b.items || []).filter(Boolean).join(' '); if (/[가-힣]/.test(fixed)) viKo.push(x.q + ': ' + fixed.slice(0, 80)); }));
      const md = ERP.ai.renderMd('**T**\n\n| A | B |\n|---|---:|\n| x | 1,000 |\n| y | 20% |\n\n※ comment\n- one\n- two');
      const box = document.createElement('div'); md.forEach(n => box.appendChild(n));
      return { out: out.map(x => ({ q: x.q, n: x.n, rowsOk: x.rowsOk, cmt: x.cmt })), viKo, md: { tables: box.querySelectorAll('table').length, num: box.querySelectorAll('td.n').length, cmt: !!box.querySelector('.acmt'), li: box.querySelectorAll('li').length, bold: !!box.querySelector('b') } };
    });
    ok('목록형 답변은 모두 표로 나옴 (브리핑·납기·재고·발주·생산·불량)', r.out.every(x => x.n >= 1), r.out);
    ok('표의 모든 행이 열 수와 같음', r.out.every(x => x.rowsOk), r.out);
    ok('표 밑 코멘트가 있음 (브리핑 · 납기 · 재고 · 생산)', ['오늘 브리핑', '납기 위험 PO', '안전재고 미달 자재', '어제 생산 요약'].every(q => (r.out.find(x => x.q === q) || {}).cmt >= 1), r.out);
    ok('베트남어 답변의 표 머리글·코멘트에 한글 없음', !r.viKo.length, r.viKo.slice(0, 4));
    eq('AI 모드 Markdown: 표 1 · 숫자 칸 2 · 표 밑 ※ 코멘트 · 목록 2 · 굵게', [r.md.tables, r.md.num, r.md.cmt, r.md.li, r.md.bold], [1, 2, true, 2, true]);
    // on screen
    await ev(async () => { if (ERP.lang !== 'ko') ERP.setLang('ko'); await ERP.ai.open(); document.getElementById('aiPanel').classList.remove('cfg'); }); await sleep(300);
    await page.fill('#aiPanel .af textarea', '오늘 브리핑'); await page.press('#aiPanel .af textarea', 'Enter');
    await page.waitForFunction(() => { const a = Array.from(document.querySelectorAll('#aiPanel .b.a')).pop(); return a && a.querySelector('table.at'); }, null, { timeout: 15000 });
    const ui = await ev(() => { const a = Array.from(document.querySelectorAll('#aiPanel .b.a')).pop(); return { tables: a.querySelectorAll('table.at').length, cmt: a.querySelectorAll('.acmt').length, copy: Array.from(a.nextElementSibling ? a.nextElementSibling.querySelectorAll('button') : []).some(b => /복사/.test(b.textContent)) }; });
    ok('화면: 브리핑이 표 3개 이상 + 코멘트 + 복사 버튼', ui.tables >= 3 && ui.cmt >= 2 && ui.copy, ui);
  }

  // =====================================================================================================
  section('5. AI 모드: 가짜 Anthropic API (도구 호출 · 오류 복구 · 내장 모드로 전환)');
  {
    const r = await ev(async () => {
      const A = ERP.ai, out = {}, calls = [];
      A.hasKey = true; A.model = 'claude-test'; A.history.length = 0;
      // (a) happy path: tool_use → tool_result → final text built from the tool's data
      let seenResult = null;
      A._call = async (body) => {
        calls.push(JSON.parse(JSON.stringify(body)));
        if (calls.length === 1) return { content: [{ type: 'text', text: '조회합니다' }, { type: 'tool_use', id: 'tu1', name: 'overview', input: {} }], stop_reason: 'tool_use' };
        const last = body.messages[body.messages.length - 1]; seenResult = JSON.parse(last.content[0].content);
        return { content: [{ type: 'text', text: '진행 중 PO ' + seenResult.open_po + '건' }], stop_reason: 'end_turn' };
      };
      const steps = []; out.a = await A.ask('현황 알려줘', (n) => steps.push(n));
      out.aSteps = steps; out.aCalls = calls.length; out.aOpen = seenResult && seenResult.open_po; out.aHist = A.history.length;
      out.sys = (typeof calls[0].system === 'string' ? calls[0].system : calls[0].system.map(b => b.text).join('\n')); out.toolNames = calls[0].tools.map(t => t.name); out.maxTokens = calls[0].max_tokens; out.effort = calls[0].output_config && calls[0].output_config.effort;
      out.toolIdMatch = calls[1].messages[calls[1].messages.length - 1].content[0].tool_use_id;
      out.firstIsUser = calls[0].messages[0].role === 'user';
      out.today = ERP.fmt.today();

      // (b) error in the middle of the loop → history rolled back, respond() falls back to the built-in answer with a note
      A.history.length = 0; calls.length = 0;
      A._call = async (body) => { calls.push(1); if (calls.length === 1) return { content: [{ type: 'tool_use', id: 'tu2', name: 'briefing', input: {} }], stop_reason: 'tool_use' }; const e = new Error('rate limit'); e.status = 429; throw e; };
      const rb = await A.respond('오늘 브리핑'); out.b = { via: rb.via, note: rb.note, has: /■ 오늘 브리핑/.test(rb.text), hist: A.history.length, calls: calls.length };

      // (c) never-ending tool loop stops after 8 rounds and leaves no half-finished history
      A.history.length = 0; calls.length = 0;
      A._call = async () => { calls.push(1); return { content: [{ type: 'tool_use', id: 'tu' + calls.length, name: 'overview', input: {} }], stop_reason: 'tool_use' }; };
      try { await A.ask('무한'); out.c = 'no error'; } catch (e) { out.c = { msg: e.message, calls: calls.length, hist: A.history.length }; }

      // (d) unknown tool / tool that throws → error text goes back to the model, loop continues
      A.history.length = 0; calls.length = 0; let tr = null;
      A._call = async (body) => { calls.push(1); if (calls.length === 1) return { content: [{ type: 'tool_use', id: 'x1', name: 'delete_everything', input: {} }, { type: 'tool_use', id: 'x2', name: 'get_po', input: null }], stop_reason: 'tool_use' }; tr = body.messages[body.messages.length - 1].content.map(c => c.content); return { content: [{ type: 'text', text: '완료' }], stop_reason: 'end_turn' }; };
      out.d = { text: await A.ask('이상한 도구'), results: tr };

      // (e) 9차: history is append-only — earlier turns are never cut off (that would invalidate thinking blocks); long chats start a new conversation instead (5b)
      A._call = async () => ({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' });
      A.history.length = 0; await A.ask('시작'); for (let i = 0; i < 40; i++) A.history.push({ role: i % 2 ? 'user' : 'assistant', content: i % 2 ? 'm' + i : [{ type: 'text', text: 'm' + i }] });
      await A.ask('끝'); out.e = { len: A.history.length, first: A.history[0].role + ':' + typeof A.history[0].content, firstText: A.history[0].content };

      // (f) AI switched off → built-in mode, API never called
      A.history.length = 0; calls.length = 0; ERP.db.meta.aiOff = true;
      A._call = async () => { calls.push(1); throw new Error('must not be called'); };
      const rf = await A.respond('오늘 브리핑'); out.f = { via: rf.via, calls: calls.length, useAI: A.useAI() }; ERP.db.meta.aiOff = false;

      // (g) no key → built-in mode
      A.hasKey = false; const rg = await A.respond('오늘 브리핑'); out.g = { via: rg.via, useAI: A.useAI() };
      A.history.length = 0;
      return out;
    });
    eq('도구 호출 → 결과를 근거로 답변', r.a, '진행 중 PO ' + r.aOpen + '건');
    ok('도구 결과가 모델에 전달됨 (tool_use_id 일치)', r.toolIdMatch === 'tu1' && r.aCalls === 2 && r.aSteps.join() === 'overview', r);
    eq('대화 기록: 질문·도구호출·결과·답변 4건', r.aHist, 4);
    eq('도구 9개 전달', r.toolNames.slice().sort(), ['briefing', 'find_orders', 'get_po', 'material_stock', 'mrp', 'overview', 'production_summary', 'quality_downtime', 'reorder']);
    ok('읽기 전용 (쓰기·삭제 도구 없음)', !r.toolNames.some(n => /delete|update|create|write|set_|add_|remove/.test(n)), r.toolNames);
    ok('시스템 프롬프트: 공장·오늘 날짜·화면 언어', /BOSUNG VINA/.test(r.sys) && r.sys.includes(r.today) && /Korean/.test(r.sys), r.sys.slice(-400));
    ok('시스템 프롬프트: 비서 이름·호칭', /Your name is "소미"/.test(r.sys) && /Address the user as "박 팀장님"/.test(r.sys), r.sys.slice(-500));
    ok('시스템 프롬프트: 자세히 스타일 + 우리 공장 지침', /more detail — tables/.test(r.sys) && /COMPANY-SPECIFIC INSTRUCTIONS[\s\S]*서리/.test(r.sys));
    ok('시스템 프롬프트: 표(Markdown) + 표 밑 ※ 코멘트 형식', /Markdown table/.test(r.sys) && /starting with "※"/.test(r.sys), r.sys.slice(0, 200));
    ok('시스템 프롬프트: 60일 기준·MRP 경고 규칙', /60 days/.test(r.sys) && /NO_COMPONENTS/.test(r.sys) && /never say "no shortage"/.test(r.sys));
    ok('응답 한도 16000 · 자세히 스타일은 effort medium', r.maxTokens === 16000 && r.effort === 'medium', [r.maxTokens, r.effort]);
    ok('중간 오류(429)는 한 번 다시 시도 → 그래도 실패하면 내장 모드로 답하고 이유를 알림', r.b.via === 'local' && r.b.has && /사용 한도|요청이 많/.test(r.b.note) && r.b.hist === 0 && r.b.calls === 3, r.b);
    ok('무한 도구 호출은 8회에서 중단하고 기록을 되돌림', r.c && r.c.calls === 8 && r.c.hist === 0 && /너무 길어/.test(r.c.msg), r.c);
    ok('모르는 도구·잘못된 입력도 오류 문구로 돌려주고 계속 진행', r.d.text === '완료' && /unknown tool/.test(r.d.results[0]) && r.d.results.length === 2, r.d);
    ok('대화 기록은 앞을 잘라내지 않음 (뒤에 붙이기만)', r.e.len === 44 && r.e.first === 'user:string' && r.e.firstText === '시작', r.e);
    ok('AI 사용 안 함이면 API 호출 없이 내장 모드', r.f.via === 'local' && r.f.calls === 0 && r.f.useAI === false, r.f);
    ok('키 없으면 내장 모드', r.g.via === 'local' && r.g.useAI === false, r.g);
    await page.reload(); await page.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.getElementById('aiFab'), null, { timeout: 60000 });
  }

  // =====================================================================================================
  section('5b. 9차 AI 대화: 기록은 뒤에 붙이기만 · 생각 블록 그대로 · 거절/잘림 · 다시 시도 · 새 대화 · 결과 줄이기');
  {
    const r = await ev(async () => {
      const A = ERP.ai, out = {}, snap = (b) => JSON.parse(JSON.stringify(b));
      A.hasKey = true; A.model = 'claude-sonnet-5-5'; A.history.length = 0; A.opts = { fallbacks: true, effort: true, cache: true, sysMsg: true };
      ERP.db.meta.aiStyle = 'short';
      const isResult = (m) => m.role === 'user' && Array.isArray(m.content) && m.content[0] && m.content[0].type === 'tool_result';
      // 질문마다: 생각 블록 + 도구 호출 → 생각 블록 + 답
      const calls = []; let n = 0;
      A._call = async (body) => { calls.push(snap(body)); n++; const last = body.messages[body.messages.length - 1];
        if (isResult(last)) return { content: [{ type: 'thinking', thinking: '', signature: 'sig-b' + n }, { type: 'text', text: 'answer ' + n }], stop_reason: 'end_turn' };
        return { content: [{ type: 'thinking', thinking: '', signature: 'sig-a' + n }, { type: 'tool_use', id: 'tu' + n, name: 'overview', input: {} }], stop_reason: 'tool_use' }; };
      const origToday = ERP.fmt.today;
      for (let i = 0; i < 10; i++) { if (i === 5) ERP.lang = 'vi'; if (i === 7) ERP.fmt.today = () => '2099-01-02'; await A.ask('질문 ' + i); }
      ERP.fmt.today = origToday; ERP.lang = 'ko';
      out.n = calls.length; out.hist = A.history.length;
      out.sysSame = calls.every(c => JSON.stringify(c.system) === JSON.stringify(calls[0].system));
      out.toolsSame = calls.every(c => JSON.stringify(c.tools) === JSON.stringify(calls[0].tools));
      out.prefix = calls.every((c, k) => k === 0 || JSON.stringify(calls[k - 1].messages) === JSON.stringify(c.messages.slice(0, calls[k - 1].messages.length)));
      out.thinkingBack = calls[1].messages.some(m => m.role === 'assistant' && JSON.stringify(m.content).includes('sig-a1')) && calls[19].messages.some(m => m.role === 'assistant' && JSON.stringify(m.content).includes('sig-b2'));
      const lastMsgs = calls[calls.length - 1].messages;
      out.sysMsgs = lastMsgs.filter(m => m.role === 'system').map(m => m.content);
      out.sysPlaced = lastMsgs.every((m, i) => m.role !== 'system' || (lastMsgs[i - 1].role === 'user' && typeof lastMsgs[i - 1].content === 'string'));
      out.sysFrozen = /Korean/.test(calls[calls.length - 1].system[0].text) && !/2099/.test(calls[calls.length - 1].system[0].text);
      const c0 = calls[0]; out.fields = { max: c0.max_tokens, effort: c0.output_config && c0.output_config.effort, cache: !!c0.cache_control, sysCache: !!(c0.system[0] && c0.system[0].cache_control), fb: c0.fallbacks, tc: c0.tool_choice };
      // 거절 · 잘림 → 이번 질문은 기록에 남기지 않고 이유 + 내장 답변
      const before = A.history.length;
      A._call = async () => ({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } });
      const rr = await A.respond('오늘 브리핑'); out.refusal = { via: rr.via, note: rr.note, kept: A.history.length === before, has: /■ 오늘 브리핑/.test(rr.text) };
      A._call = async () => ({ content: [{ type: 'text', text: 'partial…' }], stop_reason: 'max_tokens' });
      const rm = await A.respond('오늘 브리핑'); out.maxTok = { via: rm.via, note: rm.note, kept: A.history.length === before };
      // 도구 오류는 is_error
      A._call = async (body) => { const last = body.messages[body.messages.length - 1]; if (isResult(last)) { out.isErr = last.content.map(c => !!c.is_error); return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }; }
        return { content: [{ type: 'tool_use', id: 'e1', name: 'nope', input: {} }, { type: 'tool_use', id: 'e2', name: 'overview', input: {} }, { type: 'tool_use', id: 'e3', name: 'production_summary', input: { from: 'x' } }], stop_reason: 'tool_use' }; };
      await A.ask('도구 오류');
      // 마지막(8번째) 호출은 tool_choice none
      const tc = []; A._call = async (body) => { tc.push(body.tool_choice ? body.tool_choice.type : ''); return { content: [{ type: 'tool_use', id: 'z' + tc.length, name: 'overview', input: {} }], stop_reason: 'tool_use' }; };
      const h0 = A.history.length; try { await A.ask('무한2'); } catch (e) { out.tc = { calls: tc.length, last: tc[tc.length - 1], before: tc.slice(0, -1).every(x => !x), kept: A.history.length === h0 }; }
      // 429 → retry-after 만큼 기다렸다가 한 번 더
      let k429 = 0; const t0 = Date.now();
      A._call = async () => { k429++; if (k429 === 1) { const e = new Error('rate limited'); e.status = 429; e.retryAfter = 1; throw e; } return { content: [{ type: 'text', text: 'after wait' }], stop_reason: 'end_turn' }; };
      out.retry = { text: await A.ask('재시도'), calls: k429, waited: Date.now() - t0 };
      // fallbacks 를 받지 않으면(400) 끄고 다시 보내고, 다음부터 보내지 않음
      const seen = []; A._call = async (body) => { seen.push('fallbacks' in body); if ('fallbacks' in body) { const e = new Error('fallbacks: Extra inputs are not permitted'); e.status = 400; throw e; } return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }; };
      await A.ask('폴백'); await A.ask('다시'); out.fb = { seen, opt: A.opts.fallbacks }; A.opts.fallbacks = true;
      // 대화 중 system 메시지를 받지 않는 모델 → 질문 뒤 <system-reminder> 로
      A.history.length = 0; const seen2 = [];
      A._call = async (body) => { seen2.push(snap(body.messages)); if (body.messages.some(m => m.role === 'system')) { const e = new Error("role 'system' is not supported on this model"); e.status = 400; throw e; } return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }; };
      await A.ask('첫 질문'); ERP.lang = 'vi'; await A.ask('câu hỏi 2'); ERP.lang = 'ko';
      const lastSeen = seen2[seen2.length - 1]; out.sysFallback = { opt: A.opts.sysMsg, reminder: JSON.stringify(lastSeen).includes('<system-reminder>') && JSON.stringify(lastSeen).includes('Vietnamese'), noSys: !lastSeen.some(m => m.role === 'system') };
      A.opts.sysMsg = true;
      // 너무 긴 대화 → 앞을 자르지 않고 요약 한 줄로 새 대화
      A.history.length = 0; let lastBody = null; A._call = async (body) => { lastBody = snap(body); return { content: [{ type: 'text', text: '답 ' + body.messages.length }], stop_reason: 'end_turn' }; };
      const saveMax = A.MAX_HISTORY_CHARS; A.MAX_HISTORY_CHARS = 600;
      await A.ask('첫 번째 질문 ' + 'x'.repeat(300)); await A.ask('두 번째 질문 ' + 'y'.repeat(300)); await A.ask('세 번째');
      const m0 = lastBody.messages[0].content;
      out.newConv = { len: lastBody.messages.length, head: m0.slice(0, 22), hasQ: m0.includes('[Question]\n세 번째'), hasPrev: m0.includes('두 번째 질문'), hist: A.history.length };
      A.MAX_HISTORY_CHARS = saveMax;
      // 큰 도구 결과: JSON 을 자르지 않고 목록을 줄이며 _total · _truncated 표시
      const big = { total: 500, rows: Array.from({ length: 500 }, (_, i) => ({ code: 'C' + i, name: 'name ' + i, qty: i })) };
      const fs0 = A._fitResult(big, 12000); const fo = JSON.parse(fs0);
      out.fit = { len: fs0.length, rows: fo.rows.length, total: fo.rows_total, trunc: fo.rows_truncated };
      A.history.length = 0;
      return out;
    });
    ok('10번 질문 + 언어 · 날짜 바뀜: 매 요청 시스템 프롬프트 · 도구 그대로, 앞 대화는 그대로 두고 뒤에만 붙임', r.n === 20 && r.sysSame && r.toolsSame && r.prefix && r.hist === 42, r);
    ok('생각(thinking) 블록을 바꾸지 않고 다시 보냄', r.thinkingBack, r);
    ok('언어 · 날짜가 바뀌면 질문 바로 뒤 system 메시지로 알림 (시스템 프롬프트는 고정)', r.sysMsgs.length === 2 && /Vietnamese/.test(r.sysMsgs[0]) && /2099-01-02/.test(r.sysMsgs[1]) && r.sysPlaced && r.sysFrozen, r.sysMsgs);
    ok('요청: max_tokens 16000 · effort low(간단히) · 캐시(시스템 + 대화 끝) · fallbacks default · tool_choice 없음', r.fields.max === 16000 && r.fields.effort === 'low' && r.fields.cache && r.fields.sysCache && r.fields.fb === 'default' && !r.fields.tc, r.fields);
    ok('거절(refusal) → 기록에 남기지 않음 · 이유(안전 정책 · 분류) + 내장 답변', r.refusal.via === 'local' && r.refusal.kept && r.refusal.has && /안전 정책/.test(r.refusal.note) && /cyber/.test(r.refusal.note), r.refusal);
    ok('잘림(max_tokens) → 기록에 남기지 않음 · 이유', r.maxTok.via === 'local' && r.maxTok.kept && /너무 길어/.test(r.maxTok.note), r.maxTok);
    eq('도구 오류(모르는 도구 · 잘못된 입력)는 is_error', r.isErr, [true, false, true]);
    ok('8번째 호출은 tool_choice none (도구 없이 답하게) · 실패하면 그 질문만 되돌림', r.tc && r.tc.calls === 8 && r.tc.last === 'none' && r.tc.before && r.tc.kept, r.tc);
    ok('429 → retry-after(1초) 기다렸다가 한 번 더', r.retry.text === 'after wait' && r.retry.calls === 2 && r.retry.waited >= 950, r.retry);
    ok('fallbacks 를 받지 않으면 끄고 다시 · 다음부터 안 보냄', JSON.stringify(r.fb.seen) === '[true,false,false]' && r.fb.opt === false, r.fb);
    ok('system 메시지를 받지 않는 모델 → <system-reminder> 로 바꿔 보냄', r.sysFallback.opt === false && r.sysFallback.reminder && r.sysFallback.noSys, r.sysFallback);
    ok('긴 대화 → 앞을 자르지 않고 요약 한 줄로 새 대화', r.newConv.len === 1 && r.newConv.head.startsWith('[Earlier in this chat') && r.newConv.hasQ && r.newConv.hasPrev && r.newConv.hist === 2, r.newConv);
    ok('큰 도구 결과: 목록을 줄이고 _total · _truncated (올바른 JSON)', r.fit.len <= 12000 && r.fit.rows < 500 && r.fit.total === 500 && r.fit.trunc === true, r.fit);
  }

  // =====================================================================================================
  section('6. 처음부터 끝까지: 화면 → 서버 프록시 → (가짜) Anthropic');
  {
    const KEY = 'sk-ant-api03-E2E-KEY-abcd';
    await page.click('#aiFab'); await page.waitForSelector('#aiPanel.on');
    await page.click('#aiPanel .ah button[title="내 비서 설정"]');
    await page.locator('#aiPanel .set input.inp[type=password]').fill(KEY);
    await page.click('#aiPanel .set .toolbar button:has-text("저장")'); await sleep(600);
    const st = await ev(() => ({ hasKey: ERP.ai.hasKey, tail: ERP.ai.keyTail, use: ERP.ai.useAI(), html: document.documentElement.outerHTML.includes('E2E-KEY'), ls: JSON.stringify(Object.assign({}, localStorage)).includes('E2E-KEY') }));
    ok('키 저장 후 AI 모드 (화면에는 끝 4자리만)', st.hasKey && st.tail === 'abcd' && st.use && !st.html && !st.ls, st);
    ok('키는 서버 data/ai.json 에만 있음', JSON.parse(fs.readFileSync(path.join(dataDir, 'ai.json'), 'utf8')).key === KEY);
    ok('키가 meta.json·테이블 파일에 없음', !fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8').includes('E2E-KEY'));
    const head = await page.locator('#aiPanel .ah').innerText(); ok('헤더가 AI 모드 표시', /AI · /.test(head), head);
    // 9차: 프로그램을 다시 열어도 AI 모드 (예전: 서버 모드를 알기 전에 키 설정을 읽어 꺼져 있었음)
    await page.reload(); await page.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.getElementById('aiFab'), null, { timeout: 60000 });
    await page.waitForFunction(() => ERP.ai.hasKey !== null, null, { timeout: 10000 }).catch(() => {});
    const re = await ev(() => ({ hasKey: ERP.ai.hasKey, use: ERP.ai.useAI(), fab: document.getElementById('aiFab').textContent }));
    ok('다시 열어도 AI 모드 (키 설정을 데이터를 불러온 뒤 읽음)', re.hasKey === true && re.use === true, re);
    await page.click('#aiFab'); await page.waitForSelector('#aiPanel.on');

    upstream.calls.length = 0; upstream.script = [toolReply('briefing', {}, 'toolu_b1'), textReply('STUB-ANSWER 오늘은 PO가 많습니다')];
    await ev(() => ERP.ai.transcript.length = 0); await page.click('#aiPanel .ah button[title="대화 초기화"]');
    await page.fill('#aiPanel .af textarea', '오늘 뭐부터 봐야 해?'); await page.press('#aiPanel .af textarea', 'Enter');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#aiPanel .b.a')).some(e => e.textContent.includes('STUB-ANSWER')), null, { timeout: 20000 });
    ok('AI 답변이 화면에 표시됨', true);
    eq('Anthropic 호출 2번 (도구 호출 + 최종 답변)', upstream.calls.length, 2);
    const c1 = upstream.calls[0], c2 = upstream.calls[1];
    ok('서버가 저장된 키로 호출', c1.headers['x-api-key'] === KEY && c1.headers['anthropic-version'] === '2023-06-01', c1.headers);
    ok('시스템 프롬프트에 비서 이름·지침 포함', /Your name is "소미"/.test(sysText(c1.body.system)) && /서리/.test(sysText(c1.body.system)));
    ok('도구 정의 9개 전송', c1.body.tools.length === 9);
    const tr = c2.body.messages[c2.body.messages.length - 1].content[0];
    ok('두 번째 호출에 briefing 결과가 실림', tr.type === 'tool_result' && tr.tool_use_id === 'toolu_b1' && JSON.parse(tr.content).orders && JSON.parse(tr.content).materials, short(tr.content));
    const stale = await ev(() => ERP.ai.history.length); eq('대화 기록 4건', stale, 4);

    // API failure (401) → built-in answer + reason
    upstream.calls.length = 0; upstream.script = [{ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }];
    await page.fill('#aiPanel .af textarea', '안전재고 미달 자재'); await page.press('#aiPanel .af textarea', 'Enter');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#aiPanel .b.s')).some(e => /키가 올바르지 않습니다/.test(e.textContent)), null, { timeout: 20000 });
    const lastA = await ev(() => Array.from(document.querySelectorAll('#aiPanel .b.a')).pop().textContent);
    ok('AI 실패 시 내장 답변 + 이유 표시', /■ 안전재고 미달 자재/.test(lastA));
    // key deletion
    await page.click('#aiPanel .ah button[title="내 비서 설정"]'); await page.click('#aiPanel .set .toolbar button:has-text("키 삭제")'); await sleep(500);
    ok('키 삭제 → 내장 모드', await ev(() => !ERP.ai.useAI() && !ERP.ai.hasKey));
    ok('서버 ai.json 에서 키 삭제됨', !JSON.parse(fs.readFileSync(path.join(dataDir, 'ai.json'), 'utf8')).key);
    await page.click('#aiPanel .set .toolbar button:has-text("닫기")');
    // 9차: 사내망의 다른 PC 브라우저 — 키 · 모델 · 한도 칸은 잠기고, 내 비서 설정 저장은 오류 없이 된다 (키 설정 요청을 보내지 않음)
    await ev(async () => { ERP.db.ping.loopback = false; ERP.aiMount(); if (!document.querySelector('#aiPanel.on')) await ERP.ai.open(); });
    await page.waitForSelector('#aiPanel.on'); await page.click('#aiPanel .ah button[title="내 비서 설정"]');
    const puts = []; const onReq = (q) => { if (/\/api\/ai\/config/.test(q.url()) && q.method() === 'PUT') puts.push(q.url()); }; page.on('request', onReq);
    const lanUi = await ev(() => { const set = document.querySelector('#aiPanel .set'); return { keyDis: set.querySelector('input[type=password]').disabled, note: /ERP 가 실행 중인 PC 에서만/.test(set.innerText), del: Array.from(set.querySelectorAll('button')).some(b => /키 삭제/.test(b.textContent)) }; });
    await page.locator('#aiPanel .set input.inp').first().fill('랜 비서');
    await page.click('#aiPanel .set .toolbar button:has-text("저장")'); await sleep(500); page.off('request', onReq);
    const lanSaved = await ev(() => ({ name: ERP.db.setting('aiName'), cfg: document.querySelector('#aiPanel').classList.contains('cfg') }));
    ok('다른 PC 브라우저: 키 칸 잠김 · 안내 · 키 삭제 버튼 없음', lanUi.keyDis && lanUi.note && !lanUi.del, lanUi);
    ok('다른 PC 브라우저: 내 비서 설정은 저장 (키 설정 요청 없음 · 오류 없음)', lanSaved.name === '랜 비서' && !lanSaved.cfg && puts.length === 0, { lanSaved, puts });
    await ev(() => { ERP.db.ping.loopback = true; ERP.db.meta.aiName = '소미'; ERP.db.saveMeta(); ERP.aiMount(); });
  }

  // =====================================================================================================
  section('7. 모든 화면 열기 · 복원/삭제');
  {
    const pages = await ev(() => Object.keys(ERP.pages));
    for (const id of pages) {
      const r = await ev((id) => { ERP.goto(id); const m = document.getElementById('main'); return { kids: m.children.length, err: /Error/.test((m.querySelector('h2') || {}).textContent || '') && !!m.querySelector('pre') }; }, id);
      ok('화면 열림: ' + id, r.kids > 0 && !r.err, r);
    }
    ok('화면 이동 중 오류 없음', !errors.length, errors);

    // backup → wipe → restore keeps the assistant settings; wipe does not bring the sample data back after a restart
    const r = await ev(async () => {
      const DB = ERP.db, snap = DB.snapshot(), n0 = DB.rows('po').length, o = {};
      await DB.wipe(); o.afterWipe = { po: DB.rows('po').length, name: DB.setting('aiName'), quick: (DB.setting('aiQuick') || []).length, seeded: !!DB.meta.seeded };
      return Object.assign(o, { n0, snapN: snap.tables.po.length });
    });
    ok('전체 삭제 후에도 비서 설정과 seeded 표시 유지', r.afterWipe.po === 0 && r.afterWipe.name === '소미' && r.afterWipe.quick === 2 && r.afterWipe.seeded, r);
    await page.reload(); await page.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.getElementById('aiFab'), null, { timeout: 60000 });
    const after = await ev(() => ({ po: ERP.db.rows('po').length, name: ERP.db.setting('aiName') }));
    ok('재시작해도 샘플 데이터가 다시 들어오지 않음', after.po === 0 && after.name === '소미', after);
    const emp = await ev(() => { const a = ERP.ai.localAnswer('오늘 브리핑'); const b = ERP.ai.localAnswer('납기 위험 PO'); const c = ERP.ai.localAnswer('HDPE 재고'); const d = ERP.ai.localAnswer('어제 생산 요약'); return [a, b, c, d].map(x => x.text); });
    ok('데이터가 비어 있어도 내장 모드가 오류 없이 답함', emp.every(t => t && !BAD_TEXT.test(t)), emp.map(t => t.slice(0, 120)));
    ok('빈 데이터에서 오류 없음', !errors.length, errors);
  }
  await browser.close(); S.close();

  // =====================================================================================================
  if (!process.argv.includes('--no-demo')) {
    section('8. 단일 파일 데모 (서버 없음 · 브라우저에서 직접 API 호출)');
    const demo = path.join(ROOT, 'dist', 'ERP_Demo.html');
    require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build_demo.js')], { stdio: 'inherit' }); // always test the current source
    const derr = [];
    const D = await openApp('file://' + demo.replace(/\\/g, '/'), derr);
    const dev = (fn, arg) => D.page.evaluate(fn, arg);
    eq('데모는 브라우저 저장 모드', await dev(() => ERP.db.mode), 'local');
    const a = await dev(() => ERP.ai.localAnswer('오늘 브리핑'));
    ok('데모에서도 내장 모드가 답함', /■ 오늘 브리핑/.test(a.text) && !BAD_TEXT.test(a.text), a.text.slice(0, 100));
    // key + direct call (intercepted)
    const seen = [];
    await D.page.route('https://api.anthropic.com/**', async (route) => {
      const rq = route.request(); seen.push({ headers: rq.headers(), body: JSON.parse(rq.postData() || '{}') });
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(textReply('DEMO-STUB OK').body) });
    });
    await D.page.click('#aiFab'); await D.page.waitForSelector('#aiPanel.on');
    await D.page.click('#aiPanel .ah button[title="내 비서 설정"]');
    await D.page.locator('#aiPanel .set input.inp[type=password]').fill('sk-ant-demo-KEY-9999');
    await D.page.click('#aiPanel .set .toolbar button:has-text("저장")'); await sleep(400);
    ok('데모: 키는 이 창의 메모리에만 (localStorage 에 없음) · AI 모드', await dev(() => ERP.ai.useAI() && ERP.ai.keyTail === '9999' && !JSON.stringify(Object.assign({}, localStorage)).includes('demo-KEY')));
    await D.page.fill('#aiPanel .af textarea', '현황'); await D.page.press('#aiPanel .af textarea', 'Enter');
    await D.page.waitForFunction(() => Array.from(document.querySelectorAll('#aiPanel .b.a')).some(e => e.textContent.includes('DEMO-STUB OK')), null, { timeout: 20000 });
    const s0 = seen[0] || {};
    ok('데모: 브라우저에서 직접 호출 (키·버전·브라우저 직접 접근 헤더)', s0.headers && s0.headers['x-api-key'] === 'sk-ant-demo-KEY-9999' && s0.headers['anthropic-version'] === '2023-06-01' && s0.headers['anthropic-dangerous-direct-browser-access'] === 'true', s0.headers);
    ok('데모: 모델과 도구 전달', s0.body && s0.body.model && s0.body.tools && s0.body.tools.length === 9, s0.body && s0.body.model);
    await D.page.reload(); await D.page.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.getElementById('aiFab'), null, { timeout: 60000 }); await sleep(300);
    ok('데모: 새로 고치면 키는 없어짐 (내장 모드)', await dev(() => !ERP.ai.hasKey && !ERP.ai.useAI()));
    ok('데모 실행 중 오류 없음', !derr.length, derr);
    await D.browser.close();
  }

  // ---------- result ----------
  global.fetch = realFetch;
  tmpDirs.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
  console.log('\n' + (fail ? '✗ 실패 ' + fail + '건' : '✓ 모두 통과') + '  (통과 ' + pass + ' / 전체 ' + (pass + fail) + ')');
  if (fail) { console.log('\n실패 목록:'); failures.forEach(f => console.log(' - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('시험 중 예외:', e); process.exit(1); });
