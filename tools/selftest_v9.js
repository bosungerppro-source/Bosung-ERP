'use strict';
/* 9차(v1.4.0) 자동 시험: 여러 PC 동시 사용 · 보안 · 백업
   행 합치기(merge3) · 두 PC 가 같은 표를 동시에 고침(409 → 합쳐서 다시 저장) · 설정 항목별 저장 · 다른 PC 변경 불러오기와 화면 다시 그리기 ·
   저장 실패 뒤 다시 시도 · 보내는 중인 저장까지 기다리는 flush · Host/Origin/JSON 검사 · 정적 파일 경로 · 사내망 PIN(다른 주소에서 접속) ·
   매일 자동 백업(폴더 · 구글 드라이브 흉내) · Code.gs 3판 · .json.gz 복원 · 옛 화면(버전 없이 저장)
   사용:  npm run test:v9   (Playwright 필요: npm i -D playwright 또는 NODE_PATH 로 전역 설치본) */
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), net = require('net'), zlib = require('zlib'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pw; try { pw = require('playwright'); } catch (e) { try { pw = require('playwright-core'); } catch (e2) { console.error('Playwright가 필요합니다 / cần Playwright:  npm i -D playwright'); process.exit(2); } }
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const serverMod = require(path.join(ROOT, 'server.js'));

let pass = 0, fail = 0; const failures = [];
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 500 ? s.slice(0, 500) + '…' : s; };
function ok(name, cond, detail) { if (cond) { pass++; return true; } fail++; const line = name + (detail !== undefined ? '  → ' + short(detail) : ''); failures.push(line); console.log('  ✗ ' + line); return false; }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const section = (t) => console.log('\n■ ' + t);
/** 한 단락: 예외가 나도(예: 옛 버전 코드) 실패로 세고 다음 단락으로 */
async function sec(t, fn) { section(t); try { await fn(); } catch (e) { ok(t + ' — 예외', false, String((e && e.message) || e).split('\n')[0].slice(0, 200)); } }
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/** raw HTTP request (Node) — o: {headers, ct, cookie, localAddress, host} */
function req(port, method, p, body, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const headers = Object.assign({}, o.headers || {});
    if (data !== null && o.ct !== null) headers['Content-Type'] = o.ct || 'application/json';
    if (o.cookie) headers.Cookie = o.cookie;
    if (o.host) headers.Host = o.host;
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers, localAddress: o.localAddress }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    r.on('error', reject); if (data !== null) r.write(data); r.end();
  });
}
/** 가짜 Apps Script (구글 드라이브 백업 받기) */
function startMockGas() {
  const got = []; let mode = 'ok';
  const srv = http.createServer((rq, rs) => {
    const chunks = []; rq.on('data', c => chunks.push(c));
    rq.on('end', () => {
      let b = {}; try { b = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { /* bad */ }
      got.push(b); rs.writeHead(200, { 'Content-Type': 'application/json' });
      if (b.token !== 'tok9') return rs.end(JSON.stringify({ ok: false, error: 'bad token' }));
      if (mode === 'old') return rs.end(JSON.stringify({ ok: false, error: 'unknown action' }));
      rs.end(JSON.stringify({ ok: true, name: b.name, url: 'https://drive.example/' + b.name }));
    });
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ port: srv.address().port, got, setMode: (m) => { mode = m; }, close: () => srv.close() })));
}

(async () => {
  const dataDir = tmp('erp-v9-'); const mock = await startMockGas();
  const S = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir, host: '127.0.0.1', port: 5200 + Math.floor(Math.random() * 300), allowHosts: '127.0.0.5', googleHosts: /^127\.0\.0\.1$/, backupDelay: 3600000 });
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const pages = []; const errors = [];
  async function openPc(name, hash, base) {
    const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 }, acceptDownloads: true });
    const pg = await ctx.newPage(); pg.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|HTTP 500|disk full|net::ERR_FAILED|Failed to fetch|LOGIN/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    await pg.goto((base || S.url) + '/' + (hash || '#/orders'));
    pages.push(pg); return pg;
  }
  const ready = (pg) => pg.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 120000 });
  const file = (t) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'tables', t + '.json'), 'utf8')); } catch (e) { return []; } };
  const metaFile = () => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8')); } catch (e) { return {}; } };

  // PC A 가 처음 열면서 예시 자료를 넣은 뒤 PC B 를 연다 (둘 다 이 PC = loopback)
  const A = await openPc('A'); await ready(A);
  const B = await openPc('B'); await ready(B);
  const po = file('po').filter(r => r.po_no).slice(0, 12).map(r => r._id);

  // ------------------------------------------------------------------------------------------
  await sec('1. 행 합치기 (3-way merge) 단위 시험', async () => {
    const r = await A.evaluate(() => {
      const m3 = ERP.db._merge3, sig = ERP.db._sigOf;
      const base0 = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => ({ _id: id, v: 1 }));
      const base = new Map(base0.map(x => [x._id, sig(x)]));
      const local = [{ _id: 'a', v: 2 }, { _id: 'c', v: 1 }, { _id: 'd', v: 'L' }, { _id: 'e', v: 1 }, { _id: 'g', v: 1 }, { _id: 'n1', v: 1 }];
      const remote = [{ _id: 'n2', v: 1 }, { _id: 'a', v: 1 }, { _id: 'b', v: 1 }, { _id: 'c', v: 3, w: 'x' }, { _id: 'd', v: 'R' }, { _id: 'f', v: 'R' }, { _id: 'g', v: 1 }];
      const c0 = local[1]; const m = m3(base, local, remote);
      return { rows: m.rows.map(x => x._id + ':' + x.v), conflicts: m.conflicts, changed: m.changed, sameObj: m.rows.find(x => x._id === 'c') === c0, cSig: sig(c0) === sig(remote[3]) };
    });
    eq('결과: 다른 PC 추가 · 이 PC 수정 · 이 PC 삭제 · 다른 PC 수정 · 둘 다 수정(이 PC) · 지움↔고침(고친 행) · 다른 PC 삭제 · 이 PC 추가', r.rows, ['n2:1', 'a:2', 'c:3', 'd:L', 'f:R', 'g:1', 'n1:1']);
    eq('겹침 2 (둘 다 고침 · 지움↔고침) · 다른 PC 변경 4', [r.conflicts, r.changed], [2, 4]);
    ok('다른 PC 가 고친 행은 같은 객체를 고쳐 씀 (열린 편집 창 유지) · 키 순서까지 같음', r.sameObj && r.cSig, r);
  });

  // ------------------------------------------------------------------------------------------
  await sec('2. 두 PC 가 같은 표를 동시에 고침', async () => {
    const v0 = (await req(S.port, 'GET', '/api/versions')).json;
    ok('/api/versions: 표마다 저장 번호', v0 && v0.t && v0.t.po >= 1 && typeof v0.meta === 'number', v0);
    // 서로 다른 행: A 는 X, B 는 Y — B 가 먼저 저장, A 는 409 → 합쳐 다시 저장
    await A.evaluate((id) => ERP.db.update('po', id, { remarks: 'A-x' }), po[0]);
    await B.evaluate((id) => ERP.db.update('po', id, { remarks: 'B-y' }), po[1]);
    await B.evaluate(() => ERP.db.flush());
    const ra = await A.evaluate(async () => { const n = await ERP.db.flush(); return { n, conflicts: ERP.db.conflicts, pending: ERP.db.hasPending() }; });
    const f1 = file('po');
    eq('서버 파일: 두 PC 의 수정이 모두 남음', [f1.find(r => r._id === po[0]).remarks, f1.find(r => r._id === po[1]).remarks], ['A-x', 'B-y']);
    ok('다른 행이면 겹침 0 · 대기 없음', ra.conflicts === 0 && !ra.pending, ra);
    const vA = await A.evaluate(() => ({ y: ERP.db.rows('po').find(r => r.remarks === 'B-y') ? 1 : 0, ver: ERP.db.sver.po }));
    ok('A 는 합치면서 B 의 수정도 받음 · 저장 번호 = 서버', vA.y === 1 && vA.ver === (await req(S.port, 'GET', '/api/versions')).json.t.po, vA);
    // B 는 불러오기(poll)로 A 의 수정을 받음
    const pb = await B.evaluate(async (id) => { const got = await ERP.db.poll(); return { got, x: ERP.db.rows('po').find(r => r._id === id).remarks }; }, po[0]);
    ok('B: 20초 불러오기 → A 의 수정 반영', pb.got >= 1 && pb.x === 'A-x', pb);
    // 추가 + 삭제를 동시에
    const nrow = await A.evaluate(() => ERP.db.add('po', { po_no: 'T9-NEW', item_no: 'T9', qty: 1, remarks: 'added-by-A' })._id);
    await B.evaluate((id) => ERP.db.remove('po', id), po[2]);
    await A.evaluate(() => ERP.db.flush()); await B.evaluate(() => ERP.db.flush());
    const f2 = file('po');
    ok('A 추가 + B 삭제 → 서버에 둘 다 반영 (중복 없음)', f2.filter(r => r._id === nrow).length === 1 && !f2.some(r => r._id === po[2]), { n: f2.length });
    // 같은 행을 둘 다 고침: 먼저 저장한 A → 뒤에 저장한 B 의 내용 (B 에 겹침 1 알림)
    await A.evaluate((id) => ERP.db.update('po', id, { remarks: 'A-same' }), po[3]);
    await B.evaluate((id) => ERP.db.update('po', id, { remarks: 'B-same' }), po[3]);
    await A.evaluate(() => ERP.db.flush());
    const rb = await B.evaluate(async () => { const c0 = ERP.db.conflicts; await ERP.db.flush(); return { c: ERP.db.conflicts - c0, toast: document.querySelector('#toasts') ? document.querySelector('#toasts').innerText : '' }; });
    eq('같은 행: 나중에 저장한 PC 의 내용', file('po').find(r => r._id === po[3]).remarks, 'B-same');
    ok('B 에 겹침 1 · "동시에 고쳤습니다" 알림', rb.c === 1 && /동시에 고쳤습니다/.test(rb.toast), rb);
    const pa = await A.evaluate(async (id) => { await ERP.db.poll(); return ERP.db.rows('po').find(r => r._id === id).remarks; }, po[3]);
    eq('A 도 불러오기 뒤 B 의 내용', pa, 'B-same');
    // 지움 ↔ 고침: B 가 고친 행을 A 가 지움 → 고친 행을 남김
    await B.evaluate((id) => ERP.db.update('po', id, { remarks: 'B-keep' }), po[4]); await B.evaluate(() => ERP.db.flush());
    await A.evaluate((id) => ERP.db.remove('po', id), po[4]); await A.evaluate(() => ERP.db.flush());
    eq('다른 PC 가 고친 행은 지우지 않고 남김', (file('po').find(r => r._id === po[4]) || {}).remarks, 'B-keep');
    // 변경이 없으면 불러오기는 표를 받지 않음
    await A.evaluate(() => ERP.db.poll()); await B.evaluate(() => ERP.db.poll());
    const reqs = []; const onReq = (q) => { if (/\/api\/(t|meta)/.test(q.url())) reqs.push(q.url()); }; A.on('request', onReq);
    const g0 = await A.evaluate(() => ERP.db.poll()); A.off('request', onReq);
    ok('바뀐 것이 없으면 /api/versions 만 확인', g0 === 0 && reqs.length === 0, reqs);
  });

  // ------------------------------------------------------------------------------------------
  await sec('3. 설정(meta) 항목별 저장', async () => {
    await Promise.all([A.evaluate(() => ERP.db.setSetting('t9a', 'A')), B.evaluate(() => ERP.db.setSetting('t9b', 'B'))]);
    await A.evaluate(() => ERP.db.flush()); await B.evaluate(() => ERP.db.flush());
    eq('두 PC 가 다른 항목 → 둘 다 저장', [metaFile().t9a, metaFile().t9b], ['A', 'B']);
    const ma = await A.evaluate(async () => { await ERP.db.poll(); return ERP.db.meta.t9b; });
    eq('A: 불러오기 → B 의 항목', ma, 'B');
    // 이 PC 에서 바꾸고 아직 못 보낸 항목은 다른 PC 의 값으로 덮지 않음
    await B.evaluate(() => { ERP.db.meta.t9c = 'B-local'; });
    await A.evaluate(async () => { ERP.db.setSetting('t9c', 'A-remote'); await ERP.db.flush(); });
    const mb = await B.evaluate(async () => { await ERP.db.poll(); const before = ERP.db.meta.t9c; await ERP.db.saveMeta(); return before; });
    eq('B 의 아직 안 보낸 값 유지 → 저장', [mb, metaFile().t9c], ['B-local', 'B-local']);
    await A.evaluate(async () => { delete ERP.db.meta.t9a; await ERP.db.saveMeta(); });
    const md = await B.evaluate(async () => { await ERP.db.poll(); return 't9a' in ERP.db.meta; });
    ok('항목 지움도 전달 (서버 · 다른 PC)', !('t9a' in metaFile()) && md === false, metaFile());
    const put = await req(S.port, 'PATCH', '/api/meta', { set: { t9d: 1 }, del: ['t9b'] });
    ok('PATCH /api/meta {set, del} → 합친 설정과 저장 번호', put.status === 200 && put.json.meta.t9d === 1 && !('t9b' in put.json.meta) && put.json.ver > 0, put.json && put.json.ver);
  });

  // ------------------------------------------------------------------------------------------
  await sec('4. 다른 PC 변경 → 화면 다시 그리기 (입력 중이 아니면) · 스크롤 유지', async () => {
    await A.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.__renders = 0; const o = ERP.render; ERP.render = function () { window.__renders++; return o.apply(this, arguments); }; });
    await sleep(3200);   // 3초 넘게 손대지 않음
    await B.evaluate(async (id) => { ERP.db.update('po', id, { remarks: 'B-live' }); await ERP.db.flush(); }, po[5]);
    const r1 = await A.evaluate(async () => { await ERP.db.poll(); await new Promise(r => setTimeout(r, 200)); return { renders: window.__renders, stale: !!ERP.state.remoteStale }; });
    ok('조용할 때: 불러오면 바로 다시 그림', r1.renders >= 1 && !r1.stale, r1);
    // 창이 열려 있으면 기다렸다가 닫은 뒤 다시 그림
    await A.evaluate(() => { window.__renders = 0; ERP.modal({ title: 't9', body: h('p', 'x'), buttons: [{ label: 'OK' }] }); });
    await B.evaluate(async (id) => { ERP.db.update('po', id, { remarks: 'B-live2' }); await ERP.db.flush(); }, po[5]);
    const r2 = await A.evaluate(async () => { await ERP.db.poll(); await new Promise(r => setTimeout(r, 200)); const el = document.getElementById('remote'); return { renders: window.__renders, stale: !!ERP.state.remoteStale, shown: el && el.style.display !== 'none', text: el && el.textContent }; });
    ok('창이 열려 있으면 다시 그리지 않고 "다른 PC 변경 있음" 표시', r2.renders === 0 && r2.stale && r2.shown && /다른 PC 변경/.test(r2.text), r2);
    await A.click('.modal-foot .btn'); await A.mouse.move(5, 5);
    await A.waitForFunction(() => !ERP.state.remoteStale && window.__renders >= 1, null, { timeout: 12000 }).catch(() => {});
    const r3 = await A.evaluate(() => ({ renders: window.__renders, stale: !!ERP.state.remoteStale, x: ERP.db.rows('po').some(r => r.remarks === 'B-live2') }));
    ok('창을 닫고 조용해지면 다시 그림 · 데이터는 이미 최신', r3.renders >= 1 && !r3.stale && r3.x, r3);
    // 스크롤 유지
    const sc = await A.evaluate(async () => { ERP.goto('dashboard'); ERP.render(); await new Promise(r => setTimeout(r, 600)); const max = document.documentElement.scrollHeight - innerHeight; window.scrollTo(0, Math.min(700, max)); const y0 = window.scrollY; ERP.refresh(); return { y0, y1: window.scrollY, max }; });
    ok('다시 그려도 스크롤 위치 유지', sc.y0 > 100 && Math.abs(sc.y1 - sc.y0) < 5, sc);
    await A.evaluate(() => { ERP.goto('orders'); ERP.render(); });
  });

  // ------------------------------------------------------------------------------------------
  await sec('5. 저장 실패 → 버리지 않고 다시 시도 · flush 는 보내는 중인 저장까지 기다림', async () => {
    await A.route('**/api/t/po', (route) => route.request().method() === 'PUT' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"disk full"}' }) : route.continue());
    const r1 = await A.evaluate(async (id) => { const D = ERP.db; D.update('po', id, { remarks: 'retry-me' }); await D.saveTable('po'); return { dirty: !!D._dirty.po, pending: D.hasPending(), state: document.querySelector('#savestate').className, toast: document.querySelector('#toasts').innerText }; }, po[6]);
    ok('실패: 변경 유지 · "저장 오류" · 알림', r1.dirty && r1.pending && r1.state === 'error' && /저장 실패/.test(r1.toast), r1);
    ok('실패하는 동안 서버 파일은 그대로', file('po').find(r => r._id === po[6]).remarks !== 'retry-me');
    await A.unroute('**/api/t/po');
    await A.waitForFunction(() => !ERP.db.hasPending(), null, { timeout: 15000 }).catch(() => {});
    const r2 = await A.evaluate(() => ({ pending: ERP.db.hasPending(), state: document.querySelector('#savestate').className, toast: document.querySelector('#toasts').innerText }));
    ok('2초 뒤 다시 시도 → 저장됨 · "다시 저장했습니다"', !r2.pending && r2.state === 'saved' && /다시 저장했습니다/.test(r2.toast), r2);
    eq('서버 파일에 반영', file('po').find(r => r._id === po[6]).remarks, 'retry-me');
    // 네트워크 끊김
    await A.route('**/api/t/po', (route) => route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
    const r3 = await A.evaluate(async (id) => { ERP.db.update('po', id, { remarks: 'offline' }); await ERP.db.saveTable('po'); return ERP.db._dirty.po; }, po[6]);
    await A.unroute('**/api/t/po');
    const r4 = await A.evaluate(async () => { await ERP.db.flush(); return ERP.db.hasPending(); });
    ok('끊겼다가 flush → 저장', r3 === true && r4 === false && file('po').find(r => r._id === po[6]).remarks === 'offline', { r3, r4 });
    // flush: 보내는 중인 저장 + 그 사이 바뀐 것까지 기다림
    await A.route('**/api/t/po', async (route) => { if (route.request().method() === 'PUT') await sleep(1200); route.continue(); });
    const r5 = await A.evaluate(async (id) => { const D = ERP.db; D.update('po', id, { remarks: 'f1' }); D.saveTable('po'); await new Promise(r => setTimeout(r, 100)); D.update('po', id, { remarks: 'f2' }); const t0 = Date.now(); const n = await D.flush(); return { n, ms: Date.now() - t0, left: D.hasPending() }; }, po[6]);
    const fv = file('po').find(r => r._id === po[6]).remarks;
    await A.unroute('**/api/t/po');
    ok('flush 가 보내는 중인 저장과 다음 저장까지 기다림 → 서버에 마지막 값', r5.n === 1 && !r5.left && r5.ms >= 2000 && fv === 'f2', Object.assign({ fv }, r5));
    await A.route('**/api/meta', async (route) => { if (route.request().method() === 'PATCH') await sleep(800); route.continue(); });
    const r6 = await A.evaluate(async () => { ERP.db.setSetting('t9flush', 7); await ERP.db.flush(); return ERP.db.hasPending(); });
    await A.unroute('**/api/meta');
    ok('flush 가 보내는 중인 설정 저장도 기다림', r6 === false && metaFile().t9flush === 7, metaFile().t9flush);
  });

  // ------------------------------------------------------------------------------------------
  await sec('6. 옛 화면 · 서버 API', async () => {
    const v = (await req(S.port, 'GET', '/api/t/returns')).json;
    ok('GET /api/t/:name → {rows, ver}', Array.isArray(v.rows) && typeof v.ver === 'number', v && v.ver);
    const stale = await req(S.port, 'PUT', '/api/t/returns', [], { headers: { 'X-Base-Ver': String(v.ver + 50) } });
    ok('PUT 저장 번호가 다르면 409 + 서버 자료', stale.status === 409 && stale.json.error === 'CONFLICT' && Array.isArray(stale.json.rows) && stale.json.ver === v.ver, stale.status);
    const legacy = await req(S.port, 'PUT', '/api/t/returns', v.rows);
    ok('저장 번호 없이 PUT (1.3.0 화면) → 그대로 저장 · 번호 증가', legacy.status === 200 && legacy.json.ver === v.ver + 1, legacy.json);
    const lm = await req(S.port, 'PUT', '/api/meta', Object.assign({}, metaFile(), { t9legacy: 1 }));
    ok('옛 PUT /api/meta 도 동작', lm.status === 200 && metaFile().t9legacy === 1, lm.status);
    const bad = await req(S.port, 'PUT', '/api/t/' + encodeURIComponent('../x'), []);
    ok('표 이름 검사', bad.status === 400 || bad.status === 404, bad.status);
    const ping = (await req(S.port, 'GET', '/api/ping')).json;
    ok('/api/ping: version 2 · 이 PC 는 로그인 필요 없음', ping.version === 2 && ping.auth === true && ping.loopback === true, ping);
    // _id 가 없는 행(손으로 고친 파일): 두 PC 가 같은 id 를 만들어 합칠 때 늘어나지 않음
    fs.writeFileSync(path.join(dataDir, 'tables', 'returns.json'), JSON.stringify([{ date: '2026-10-01', item: 'T9-R1', qty: 1 }, { date: '2026-10-02', item: 'T9-R2', qty: 2 }]));
    await A.reload(); await ready(A); await B.reload(); await ready(B);
    const ids = await Promise.all([A, B].map(p => p.evaluate(() => ERP.db.rows('returns').map(r => r._id))));
    ok('_id 없는 행 → 두 PC 에서 같은 id', ids[0].length === 2 && JSON.stringify(ids[0]) === JSON.stringify(ids[1]), ids);
    await A.evaluate(() => ERP.db.update('returns', ERP.db.rows('returns')[0]._id, { qty: 10 }));
    await B.evaluate(() => ERP.db.update('returns', ERP.db.rows('returns')[1]._id, { qty: 20 }));
    await A.evaluate(() => ERP.db.flush()); await B.evaluate(() => ERP.db.flush());
    eq('합쳐도 2행 · 두 수정 모두', file('returns').map(r => r.qty), [10, 20]);
  });

  // ------------------------------------------------------------------------------------------
  await sec('7. 다른 웹사이트 요청 막기 (Host · Origin · JSON) · 정적 파일 경로', async () => {
    const o = S.port;
    eq('Host 가 다른 이름 → 403 (DNS rebinding)', [(await req(o, 'GET', '/api/db', undefined, { host: 'evil.example:' + o })).status, (await req(o, 'GET', '/', undefined, { host: 'evil.example:' + o })).status], [403, 403]);
    eq('Host 포트가 다름 → 403', (await req(o, 'GET', '/api/ping', undefined, { host: '127.0.0.1:1' })).status, 403);
    eq('허용한 이름(ERP_ALLOW_HOSTS) · localhost → 통과', [(await req(o, 'GET', '/api/ping', undefined, { host: '127.0.0.5:' + o })).status, (await req(o, 'GET', '/api/ping', undefined, { host: 'localhost:' + o })).status], [200, 200]);
    const evil = await req(o, 'PUT', '/api/t/returns', [], { headers: { Origin: 'http://evil.example' } });
    eq('다른 출처(Origin)의 쓰기 → 403', [evil.status, evil.json && evil.json.error], [403, 'bad origin']);
    eq('Origin: null (파일 · 샌드박스) → 403', (await req(o, 'POST', '/api/backup/run', {}, { headers: { Origin: 'null' } })).status, 403);
    eq('같은 출처 Origin → 통과', (await req(o, 'PATCH', '/api/meta', { set: { t9o: 1 } }, { headers: { Origin: 'http://127.0.0.1:' + o } })).status, 200);
    const form = await req(o, 'PUT', '/api/t/returns', '[]', { ct: 'text/plain' });
    eq('쓰기 요청은 JSON 만 (form · text/plain → 403)', [form.status, form.json && form.json.error], [403, 'json only']);
    eq('Content-Type 없는 POST → 403', (await req(o, 'POST', '/api/backup/run', '{}', { ct: null })).status, 403);
    eq('file(returns) 그대로', file('returns').length, 2);
    // 정적 파일: app 폴더 밖으로 못 나감 (이름이 app 으로 시작하는 옆 폴더 포함)
    const sb = tmp('erp-v9-static-'); fs.mkdirSync(path.join(sb, 'app')); fs.mkdirSync(path.join(sb, 'app2'));
    fs.writeFileSync(path.join(sb, 'app', 'index.html'), 'ok'); fs.writeFileSync(path.join(sb, 'app2', 'secret.txt'), 'SECRET');
    const S2 = await serverMod.start({ appDir: path.join(sb, 'app'), dataDir: path.join(sb, 'data'), host: '127.0.0.1', port: S.port + 400, backupDelay: 3600000 });
    const t1 = await req(S2.port, 'GET', '/..%2fapp2%2fsecret.txt'); const t2 = await req(S2.port, 'GET', '/%2e%2e/app2/secret.txt'); const t3 = await req(S2.port, 'GET', '/index.html');
    ok('옆 폴더(app2) · 상위 폴더 파일은 못 읽음', t1.status === 403 && !/SECRET/.test(t1.text) && !/SECRET/.test(t2.text) && t3.text === 'ok', [t1.status, t2.status, t3.status]);
    S2.close();
  });

  // ------------------------------------------------------------------------------------------
  await sec('8. 사내망 PIN (다른 PC 주소에서 접속)', async () => {
    const o = S.port; const L2 = { localAddress: '127.0.0.2' }, L3 = { localAddress: '127.0.0.3' };
    let can = true; try { await req(o, 'GET', '/api/ping', undefined, L2); } catch (e) { can = false; }
    if (!can) console.log('  (건너뜀: 127.0.0.2 로 연결할 수 없는 환경)');
    else {
      const p0 = (await req(o, 'GET', '/api/ping', undefined, L2)).json;
      eq('다른 PC: ping 은 됨 · 로그인 필요 · PIN 없음', [p0.auth, p0.hasPin, p0.loopback], [false, false, false]);
      const d0 = await req(o, 'GET', '/api/db', undefined, L2);
      eq('로그인 전 자료 → 401 LOGIN', [d0.status, d0.json.error], [401, 'LOGIN']);
      eq('PIN 이 없으면 로그인 불가 (NO_PIN)', (await req(o, 'POST', '/api/login', { pin: '0000' }, L2)).json.error, 'NO_PIN');
      eq('PIN 형식 검사 (4~12자리 숫자)', [(await req(o, 'PUT', '/api/lan/pin', { pin: '12' })).status, (await req(o, 'PUT', '/api/lan/pin', { pin: 'abcd' })).status], [400, 400]);
      const sp = await req(o, 'PUT', '/api/lan/pin', { pin: '2468' });
      ok('이 PC 에서 PIN 정하기', sp.status === 200 && sp.json.hasPin === true, sp.json);
      ok('PIN 은 해시로만 저장', !/2468/.test(fs.readFileSync(path.join(dataDir, 'lan.json'), 'utf8')));
      const bads = []; for (let i = 0; i < 5; i++) bads.push((await req(o, 'POST', '/api/login', { pin: '1111' }, L2)).status);
      const locked = await req(o, 'POST', '/api/login', { pin: '2468' }, L2);
      ok('5번 틀리면 잠시 잠금 (맞는 PIN 도 429)', bads.every(s => s === 401) && locked.status === 429 && locked.json.wait > 0, { bads, locked: locked.json });
      const lg = await req(o, 'POST', '/api/login', { pin: '2468' }, L3);
      const ck = String(lg.headers['set-cookie'] || ''); const cookie = (ck.match(/erp_s=[^;]+/) || [''])[0];
      ok('맞는 PIN → 쿠키 (HttpOnly · SameSite=Strict · 7일)', lg.status === 200 && cookie && /HttpOnly/.test(ck) && /SameSite=Strict/.test(ck) && /Max-Age=604800/.test(ck), ck);
      const C3 = Object.assign({ cookie }, L3);
      eq('쿠키로 자료 읽기 → 200', (await req(o, 'GET', '/api/db', undefined, C3)).status, 200);
      eq('다른 PC 는 AI 키 · PIN · 백업 설정을 못 바꿈 (403)', [(await req(o, 'PUT', '/api/ai/config', { key: 'sk-x' }, C3)).status, (await req(o, 'PUT', '/api/lan/pin', { pin: '9999' }, C3)).status, (await req(o, 'PUT', '/api/backup', { dir: '/tmp' }, C3)).status], [403, 403, 403]);
      eq('다른 PC 도 표 저장은 됨', (await req(o, 'PUT', '/api/t/returns', file('returns'), C3)).status, 200);
      await req(o, 'POST', '/api/logout', {}, C3);
      eq('로그아웃 뒤 → 401', (await req(o, 'GET', '/api/db', undefined, C3)).status, 401);
      // 화면: 다른 PC 브라우저 → PIN 화면 → 들어가기 (127.0.0.5 로 받아 127.0.0.4 에서 서버로 넘기는 중계)
      let fwd = null;
      try {
        fwd = net.createServer(c => { const s = net.connect({ host: '127.0.0.1', port: o, localAddress: '127.0.0.4' }); c.pipe(s); s.pipe(c); s.on('error', () => c.destroy()); c.on('error', () => s.destroy()); });
        await new Promise((res, rej) => { fwd.once('error', rej); fwd.listen(o, '127.0.0.5', res); });
      } catch (e) { fwd = null; console.log('  (건너뜀: 127.0.0.5 중계 불가 — ' + e.message + ')'); }
      if (fwd) {
        const C = await openPc('LAN', '#/settings', 'http://127.0.0.5:' + o);
        await C.waitForSelector('.login-gate input', { timeout: 30000 });
        await C.fill('.login-gate input', '1357'); await C.click('.login-gate .btn.primary');
        await C.waitForFunction(() => /맞지 않습니다/.test(document.querySelector('.login-gate').innerText), null, { timeout: 10000 }).catch(() => {});
        const wrong = await C.evaluate(() => ({ gate: !!document.querySelector('.login-gate'), msg: document.querySelector('.login-gate').innerText }));
        ok('PIN 화면 · 틀린 PIN → 알림', wrong.gate && /맞지 않습니다/.test(wrong.msg), wrong.msg);
        await C.fill('.login-gate input', '2468'); await C.keyboard.press('Enter');
        await ready(C);
        const inside = await C.evaluate(() => ({ gate: !!document.querySelector('.login-gate'), mode: ERP.db.mode, po: ERP.db.rows('po').length, loop: ERP.db.ping.loopback }));
        ok('맞는 PIN → ERP 화면 (서버 자료)', !inside.gate && inside.mode === 'server' && inside.po > 100 && inside.loop === false, inside);
        await C.waitForFunction(() => document.querySelector('#lanCard') && /PIN 으로 들어옴/.test(document.querySelector('#lanCard').innerText), null, { timeout: 10000 }).catch(() => {});
        const card = await C.evaluate(() => { const c = document.querySelector('#lanCard'); return c ? { t: c.innerText, dis: Array.from(c.querySelectorAll('input')).filter(i => i.type !== 'password').every(i => i.disabled) } : null; });
        ok('설정: "PIN 으로 들어옴" · 로그아웃 · 백업 설정 잠김', card && /PIN 으로 들어옴/.test(card.t) && /로그아웃/.test(card.t) && card.dis, card);
        // PIN 이 바뀌면 → 다음 요청에서 PIN 화면 → 새 PIN 으로 다시 들어오면 못 보낸 저장을 보냄
        await req(o, 'PUT', '/api/lan/pin', { pin: '8642' });
        await C.evaluate(() => { ERP.db.update('returns', ERP.db.rows('returns')[0]._id, { qty: 77 }); return ERP.db.saveTable('returns'); });
        await C.waitForSelector('.login-gate input', { timeout: 10000 }).catch(() => {});
        const again = await C.evaluate(() => ({ gate: !!document.querySelector('.login-gate'), dirty: !!ERP.db._dirty.returns }));
        ok('PIN 이 바뀜 → PIN 화면 · 변경은 보관', again.gate && again.dirty, again);
        await C.fill('.login-gate input', '8642'); await C.keyboard.press('Enter');
        await C.waitForFunction(() => !document.querySelector('.login-gate') && !ERP.db.hasPending(), null, { timeout: 15000 }).catch(() => {});
        eq('새 PIN 으로 들어오면 보관한 변경을 저장', file('returns')[0].qty, 77);
        fwd.close();
      }
      await req(o, 'PUT', '/api/lan/pin', { pin: '' });
      ok('PIN 지우기', (await req(o, 'GET', '/api/ping')).json.hasPin === false);
    }
  });

  // ------------------------------------------------------------------------------------------
  await sec('9. 매일 자동 백업 (폴더 · 구글 드라이브)', async () => {
    const o = S.port; const bdir = tmp('erp-v9-bk-');
    eq('상대 경로 · 쓸 수 없는 폴더 → 400', [(await req(o, 'PUT', '/api/backup', { dir: 'backup' })).status, (await req(o, 'PUT', '/api/backup', { dir: '/proc/erp-v9/x' })).status], [400, 400]);
    const set = await req(o, 'PUT', '/api/backup', { dir: bdir, keep: 3 });
    ok('백업 폴더 · 보관 3개 설정', set.status === 200 && set.json.dir === bdir && set.json.keep === 3, set.json);
    ok('설정했고 오늘 백업이 없으면 예약 실행 대상', S.backup.due() === true);
    ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'].forEach(d => fs.writeFileSync(path.join(bdir, 'ERP_backup_' + d + '.json'), '{}'));
    fs.writeFileSync(path.join(bdir, 'my_notes.txt'), 'keep me');
    const run = await req(o, 'POST', '/api/backup/run', {});
    const name = 'ERP_backup_' + today() + '.json'; const files = fs.readdirSync(bdir).sort();
    ok('지금 백업 → 오늘 파일', run.status === 200 && !run.json.error && run.json.file === path.join(bdir, name), run.json);
    const snap = JSON.parse(fs.readFileSync(path.join(bdir, name), 'utf8'));
    ok('백업 내용 = 서버 자료 (표 · 설정)', snap.app === 'colorpencil-erp' && snap.tables.po.length === file('po').length && snap.meta.t9flush === 7, { po: snap.tables.po && snap.tables.po.length });
    eq('보관 개수만 남기고 오래된 백업 삭제 (다른 파일은 그대로)', files, ['ERP_backup_2026-01-03.json', 'ERP_backup_2026-01-04.json', name, 'my_notes.txt']);
    ok('오늘 성공했으면 예약 실행 안 함', S.backup.due() === false);
    // 구글 드라이브 (가짜 Apps Script)
    await req(o, 'PATCH', '/api/meta', { set: { gUrl: 'http://127.0.0.1:' + mock.port + '/exec', gToken: 'tok9' } });
    await req(o, 'PUT', '/api/backup', { google: true });
    const g = await req(o, 'POST', '/api/backup/run', {}); const last = mock.got[mock.got.length - 1] || {};
    let gz = null; try { gz = JSON.parse(zlib.gunzipSync(Buffer.from(last.b64, 'base64')).toString('utf8')); } catch (e) { /* bad */ }
    ok('구글 드라이브: action backup · 이름 .json.gz · 압축 풀면 같은 자료 · 보관 3', last.action === 'backup' && last.name === name + '.gz' && last.keep === 3 && gz && gz.tables.po.length === file('po').length && !g.json.error && /drive\.example/.test(g.json.drive), { name: last.name, err: g.json.error });
    mock.setMode('old');
    const g2 = await req(o, 'POST', '/api/backup/run', {});
    ok('옛 Apps Script → "Code.gs 3판" 안내 · 폴더 백업은 성공', /Code\.gs 3/.test(g2.json.error || '') && g2.json.file === path.join(bdir, name), g2.json);
    const st = (await req(o, 'GET', '/api/backup')).json;
    ok('상태: 마지막 시도 · 오류 · 크기 기록', st.lastTry && /Code\.gs 3/.test(st.lastError) && st.lastSize > 1000, st);
    mock.setMode('ok');
    await req(o, 'PATCH', '/api/meta', { set: { gUrl: 'https://evil.example/exec' } });
    const g3 = await req(o, 'POST', '/api/backup/run', {});
    ok('Apps Script 가 아닌 주소로는 보내지 않음', /Apps Script/.test(g3.json.error || '') && mock.got.length === 2, g3.json.error);
    await req(o, 'PATCH', '/api/meta', { del: ['gUrl', 'gToken'] }); await req(o, 'PUT', '/api/backup', { google: false });
    // 설정 화면 (이 PC)
    await A.evaluate(() => { ERP.goto('settings'); ERP.render(); });
    await A.waitForFunction(() => document.querySelector('#lanCard') && /지금 백업/.test(document.querySelector('#lanCard').innerText), null, { timeout: 10000 }).catch(() => {});
    const ui = await A.evaluate(() => { const c = document.querySelector('#lanCard'); return c ? { t: c.innerText, dir: (c.querySelector('input.inp:not([type])') || {}).value } : null; });
    ok('설정 화면: 사내망 · PIN 정하기 · 백업 폴더 · 마지막 성공 · 지금 백업', ui && /사내망 접속/.test(ui.t) && /PIN 정하기/.test(ui.t) && /마지막 성공/.test(ui.t) && ui.dir === bdir, ui);
    fs.rmSync(path.join(bdir, name));
    await A.click('#lanCard .btn.primary');
    await A.waitForFunction(() => /백업했습니다/.test((document.querySelector('#toasts') || {}).innerText || ''), null, { timeout: 15000 }).catch(() => {});
    ok('"지금 백업" 버튼 → 파일 생김', fs.existsSync(path.join(bdir, name)));
    await A.fill('#lanCard input[type=password]', '4321'); await A.click('#lanCard >> text=PIN 정하기');
    await A.waitForFunction(() => /PIN 을 저장했습니다/.test((document.querySelector('#toasts') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    ok('화면에서 PIN 정하기', (await req(o, 'GET', '/api/ping')).json.hasPin === true);
    await req(o, 'PUT', '/api/lan/pin', { pin: '' }); await req(o, 'PUT', '/api/backup', { dir: '' });
  });

  // ------------------------------------------------------------------------------------------
  await sec('10. Code.gs 3판 (구글 드라이브 백업 받기)', async () => {
    const files = []; let seq = 0;
    const mkFile = (name, blob) => { const f = { name, blob, trashed: false, id: ++seq, getName: () => f.name, setTrashed: (v) => { f.trashed = v; }, getUrl: () => 'https://drive/' + f.id }; files.push(f); return f; };
    const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
    const folder = { getFilesByName: (n) => iter(files.filter(f => !f.trashed && f.name === n)), getFiles: () => iter(files.filter(f => !f.trashed)), createFile: (b) => mkFile(b.name, b) };
    const sb = { DriveApp: { getFoldersByName: () => iter([folder]), createFolder: () => folder },
      Utilities: { base64Decode: (s) => Array.from(Buffer.from(s, 'base64')), newBlob: (bytes, type, name) => ({ name, type, getBytes: () => bytes }) },
      ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getName: () => 'S', getUrl: () => 'u' }) } };
    vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(ROOT, 'google', 'Code.gs'), 'utf8').replace("var TOKEN = 'CHANGE-ME'", "var TOKEN = 't'"), sb);
    const call = (b) => JSON.parse(sb.doPost({ postData: { contents: JSON.stringify(Object.assign({ token: 't' }, b)) } }));
    eq('ping ver 3', call({ action: 'ping' }).ver, 3);
    for (let d = 1; d <= 5; d++) mkFile('ERP_backup_2026-02-0' + d + '.json.gz', null);
    mkFile('ERP_20260101_0900', null);
    const b64 = zlib.gzipSync('{"tables":{}}').toString('base64');
    const r1 = call({ action: 'backup', name: 'ERP_backup_2026-02-05.json.gz', b64, keep: 3 });
    const live = files.filter(f => !f.trashed).map(f => f.name).sort();
    ok('같은 날 이름은 바꾸고 최근 3개만 남김 (다른 파일은 그대로)', r1.ok && JSON.stringify(live) === JSON.stringify(['ERP_20260101_0900', 'ERP_backup_2026-02-03.json.gz', 'ERP_backup_2026-02-04.json.gz', 'ERP_backup_2026-02-05.json.gz']) && r1.size === Buffer.from(b64, 'base64').length, { live, r1 });
    eq('이상한 이름은 거절', call({ action: 'backup', name: '../evil.gs', b64, keep: 3 }).ok, false);
  });

  // ------------------------------------------------------------------------------------------
  await sec('11. 복원: 구글 드라이브의 .json.gz', async () => {
    const snap = (await req(S.port, 'GET', '/api/db')).json;
    const row = snap.tables.po.find(r => r._id === po[7]); row.remarks = 'from-gz';
    const gzPath = path.join(tmp('erp-v9-gz-'), 'ERP_backup_' + today() + '.json.gz');
    fs.writeFileSync(gzPath, zlib.gzipSync(JSON.stringify({ app: 'colorpencil-erp', version: 1, meta: snap.meta, tables: snap.tables })));
    await A.evaluate(() => { ERP.state.dataTab = 'backup'; ERP.goto('data'); ERP.render(); }); await sleep(300);
    await A.setInputFiles('input[type=file][accept=".json,.gz"]', gzPath);
    await A.waitForSelector('.modal-back .btn.primary', { timeout: 10000 }); await A.click('.modal-back .btn.primary');
    await A.waitForFunction(() => /복원했습니다/.test((document.querySelector('#toasts') || {}).innerText || ''), null, { timeout: 60000 }).catch(() => {});
    const r = await A.evaluate((id) => ERP.db.rows('po').find(x => x._id === id).remarks, po[7]);
    eq('.json.gz 복원 → 화면 · 서버 파일', [r, file('po').find(x => x._id === po[7]).remarks], ['from-gz', 'from-gz']);
    const rb = await B.evaluate(async (id) => { await ERP.db.poll(); return ERP.db.rows('po').find(x => x._id === id).remarks; }, po[7]);
    eq('다른 PC 도 불러오기로 받음', rb, 'from-gz');
  });

  // ------------------------------------------------------------------------------------------
  section('12. 오류 없음');
  ok('화면 오류 0', errors.length === 0, errors);
  const state = await Promise.all([A, B].map(p => p.evaluate(() => ({ pending: ERP.db.hasPending(), failing: Array.from(ERP.db._failing || []) }))));
  ok('두 PC 모두 대기 · 실패 없음', state.every(s => !s.pending && !s.failing.length), state);

  await browser.close(); S.close(); mock.close();
  console.log('\n' + (fail ? '✗ 실패 ' + fail + '개' : '✓ 모두 통과') + '  (통과 ' + pass + ' / 전체 ' + (pass + fail) + ')');
  if (fail) { console.log('\n실패 목록:'); failures.forEach(f => console.log(' - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
