'use strict';
/* 15차(v1.10.0) 자동 시험: 프로그램 자동 업데이트 (electron/updater.js · 서버 API · 설정 화면 · 화면 위 알림)
   1 버전 비교 · 2 확인 · 받기 (가짜 GitHub: latest → 버전 주소로 넘김, 없음 · 최신 · 새 버전 · 다시 받지 않음 · SHA-256 · 크기 · 이름 검사)
   3 켤 때 설치 (데이터 복사 · /UPDATE /D= · 두 번 실패하면 멈춤 · 자동 끔 · 손상 · 설치 뒤 기록) · 4 [지금 업데이트] · 자동 켜고 끄기 · 확인 주기
   5 서버 API (이 PC 만 확인 · 설치 · 끄기, 다른 PC 는 보기만, 설치형이 아니면 없음) · 6 화면 (설정 카드 · 알림 · 지금 업데이트 · 업데이트 뒤 알림 · 베트남어)
   7 설치 프로그램 · Release · Windows 시험 · 버전 번호
   실제 설치 프로그램 · Electron 으로 하는 시험은 tools/update_e2e.js (GitHub Actions Windows)
   사용:  npm run test:v15   (Playwright 필요: npm i -D playwright 또는 playwright-core + 설치된 Chrome/Edge) */
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let pw; try { pw = require('playwright'); } catch (e) { try { pw = require('playwright-core'); } catch (e2) { console.error('Playwright가 필요합니다 / cần Playwright:  npm i -D playwright'); process.exit(2); } }
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
const serverMod = require(path.join(ROOT, 'server.js'));
const updater = require(path.join(ROOT, 'electron', 'updater.js'));

let pass = 0, fail = 0; const failures = [];
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 600 ? s.slice(0, 600) + '…' : s; };
function ok(name, cond, detail) { if (cond) { pass++; return true; } fail++; const line = name + (detail !== undefined ? '  → ' + short(detail) : ''); failures.push(line); console.log('  ✗ ' + line); return false; }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
async function sec(t, fn) { console.log('\n■ ' + t); try { await fn(); } catch (e) { ok(t + ' — 예외', false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); } }
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function req(port, method, p, body, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const headers = Object.assign({}, o.headers || {});
    if (data !== null) headers['Content-Type'] = 'application/json';
    if (o.cookie) headers.Cookie = o.cookie;
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers, localAddress: o.localAddress }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    r.on('error', reject); if (data !== null) r.write(data); r.end();
  });
}

// ---------------------------------------------------------------- 가짜 GitHub Release (latest → 버전 주소로 넘김)
function fakeGh() {
  const files = new Map(); const hits = [];
  const srv = http.createServer((q, res) => {
    hits.push(q.url); const f = files.get(q.url);
    if (!f) { res.writeHead(404); return res.end('not found'); }
    if (f.redirect) { res.writeHead(302, { Location: f.redirect }); return res.end(); }
    res.writeHead(f.status || 200, { 'Content-Type': 'application/octet-stream' }); res.end(f.body);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ base: 'http://127.0.0.1:' + srv.address().port + '/releases', files, hits, close: () => srv.close() })));
}
function publish(gh, ver, opt) {
  opt = opt || {}; const name = opt.name || 'ColorPencil-ERP-Setup-' + ver + '.exe';
  const body = opt.body || crypto.randomBytes(opt.size || 300000);
  const man = Object.assign({ version: ver, file: name, sha256: sha(body), size: body.length }, opt.man || {});
  gh.files.clear();
  gh.files.set('/releases/latest/download/latest.json', { redirect: '/releases/download/v' + ver + '/latest.json' });
  gh.files.set('/releases/download/v' + ver + '/latest.json', { body: JSON.stringify(man) });
  gh.files.set('/releases/download/v' + ver + '/' + name, { body: opt.serve || body });
  return { name, body, man };
}
const INSTALL_DIR = 'C:\\Programs\\Color Pencil ERP';
function dataDirWith(ud) {
  const d = path.join(ud, 'data'); fs.mkdirSync(path.join(d, 'tables'), { recursive: true }); fs.mkdirSync(path.join(d, 'backup', '2026-10-20'), { recursive: true });
  fs.writeFileSync(path.join(d, 'tables', 'po.json'), JSON.stringify([{ _id: 'p1', po_no: 'V15-PO' }]));
  fs.writeFileSync(path.join(d, 'backup', '2026-10-20', 'po.json'), '[]'); fs.writeFileSync(path.join(d, 'meta.json'), '{}');
  return d;
}
function mk(gh, o) {
  const ud = (o && o.ud) || tmp('erp-v15-ud-'); if (!fs.existsSync(path.join(ud, 'data'))) dataDirWith(ud);
  const calls = { spawn: [], quit: 0, before: 0, saveAuto: [] };
  const up = updater.create(Object.assign({ version: '1.10.0', dir: path.join(ud, 'update'), backupDir: path.join(ud, 'update_backup'), dataDir: path.join(ud, 'data'),
    installDir: INSTALL_DIR, fetch: global.fetch, base: gh.base, firstCheck: 3600000,
    spawn: (file, args, opts) => { calls.spawn.push({ file, args, opts }); return { unref() {} }; },
    quit: () => { calls.quit++; }, beforeInstall: async () => { calls.before++; }, saveAuto: (v) => { calls.saveAuto.push(v); } }, o || {}));
  return { up, ud, calls };
}
const pendingOf = (ud) => { try { return JSON.parse(fs.readFileSync(path.join(ud, 'update', 'pending.json'), 'utf8')); } catch (e) { return null; } };
const updFiles = (ud) => { try { return fs.readdirSync(path.join(ud, 'update')).sort(); } catch (e) { return []; } };
const backups = (ud) => { try { return fs.readdirSync(path.join(ud, 'update_backup')).sort(); } catch (e) { return []; } };

(async () => {
  const gh = await fakeGh();

  // ------------------------------------------------------------------------------------------
  await sec('1. 버전 비교 (숫자로)', async () => {
    const c = updater.cmpVer;
    eq('1.10.0 > 1.9.0 · 1.9.0 < 1.10.0 · 같음 · 2.0.0 > 1.99.99', [c('1.10.0', '1.9.0'), c('1.9.0', '1.10.0'), c('1.10.0', '1.10.0'), c('2.0.0', '1.99.99')], [1, -1, 0, 1]);
    ok('설치 파일 이름 규칙', updater.FILE_RE.test('ColorPencil-ERP-Setup-1.10.1.exe') && !updater.FILE_RE.test('../ColorPencil-ERP-Setup-1.10.1.exe') && !updater.FILE_RE.test('ColorPencil-ERP-Setup-1.10.1.exe.bat'));
    ok('기본 주소 = 이 저장소의 Release', updater.REPO_BASE === 'https://github.com/bosungerppro-source/Bosung-ERP/releases', updater.REPO_BASE);
  });

  // ------------------------------------------------------------------------------------------
  await sec('2. 확인 · 받기', async () => {
    gh.files.clear();
    const { up, ud } = mk(gh);
    const s0 = up.status();
    eq('처음: 확인 전 · 자동 켜짐 · 설치 가능 · 받아 둔 것 없음', [s0.state, s0.auto, s0.canInstall, s0.ready, s0.current], ['idle', true, true, null, '1.10.0']);
    const s1 = await up.check();
    eq('Release 가 없으면 (404) → 정보 없음 (오류 아님)', [s1.state, s1.error, !!s1.checkedAt], ['none', '', true]);
    publish(gh, '1.10.0');
    eq('같은 버전 → 최신', (await up.check()).state, 'latest');
    publish(gh, '1.9.5');
    eq('더 옛 버전 → 최신 (내려가지 않음)', (await up.check()).state, 'latest');
    const rel = publish(gh, '1.10.1'); gh.hits.length = 0;
    const s2 = await up.check();
    ok('새 버전 1.10.1 → 받아 둠 (latest → 버전 주소로 넘어감)', s2.state === 'ready' && s2.ready && s2.ready.version === '1.10.1' && s2.latest === '1.10.1' && gh.hits.includes('/releases/latest/download/latest.json') && gh.hits.includes('/releases/download/v1.10.1/' + rel.name), { s2, hits: gh.hits });
    const p = pendingOf(ud);
    ok('pending.json (버전 · 파일 · SHA-256 · 크기 · 지금 버전) · 파일 내용 그대로', p && p.version === '1.10.1' && p.sha256 === rel.man.sha256 && p.size === rel.body.length && p.from === '1.10.0' && p.tries === 0
      && sha(fs.readFileSync(path.join(ud, 'update', rel.name))) === rel.man.sha256 && !updFiles(ud).some(f => f.endsWith('.part')), { p, files: updFiles(ud) });
    gh.hits.length = 0; await up.check();
    ok('같은 새 버전이면 다시 받지 않음', !gh.hits.some(u => u.endsWith('.exe')), gh.hits);
    // 동시에 두 번 눌러도 한 번만
    const g2 = await fakeGh(); const b2 = mk(g2); publish(g2, '1.10.2'); const [x, y] = await Promise.all([b2.up.check(), b2.up.check()]);
    ok('동시에 확인해도 한 번만 받음', x.state === 'ready' && y.state === 'ready' && g2.hits.filter(u => u.endsWith('.exe')).length === 1, g2.hits); g2.close();
    // 손상 · 크기 · 이름
    const bad = mk(gh); publish(gh, '1.10.3', { man: { sha256: '0'.repeat(64) } });
    const sb = await bad.up.check();
    ok('SHA-256 이 다르면 → 오류 · 받아 둔 것 없음 · 받던 파일 지움', sb.state === 'error' && /SHA-256/.test(sb.error) && !sb.ready && !pendingOf(bad.ud) && !updFiles(bad.ud).some(f => /\.exe/.test(f)), { sb, files: updFiles(bad.ud) });
    const big = mk(gh); const rb = publish(gh, '1.10.3', { size: 1000 }); gh.files.set('/releases/download/v1.10.3/' + rb.name, { body: Buffer.concat([rb.body, Buffer.from('extra')]) });
    const sz = await big.up.check();
    ok('받은 크기가 더 크면 → 오류', sz.state === 'error' && /크기/.test(sz.error) && !pendingOf(big.ud), sz);
    const short1 = mk(gh); const rs = publish(gh, '1.10.3', { size: 1000 }); gh.files.set('/releases/download/v1.10.3/' + rs.name, { body: rs.body.subarray(0, 600) });
    const ss = await short1.up.check();
    ok('받은 크기가 모자라면 → 오류', ss.state === 'error' && /크기/.test(ss.error) && !pendingOf(short1.ud), ss);
    for (const [label, man] of [['../ 경로', { file: '../ColorPencil-ERP-Setup-1.10.3.exe' }], ['버전과 파일 이름이 다름', { file: 'ColorPencil-ERP-Setup-1.10.4.exe' }], ['bat 파일', { file: 'ColorPencil-ERP-Setup-1.10.3.bat' }], ['버전 형식', { version: '1.10.3-beta' }]]) {
      const t = mk(gh); publish(gh, '1.10.3', { man }); const s = await t.up.check();
      ok('latest.json 검사: ' + label + ' → 오류 · 받지 않음', s.state === 'error' && /latest\.json/.test(s.error) && !updFiles(t.ud).some(f => /\.exe/.test(f)), s);
    }
    gh.files.set('/releases/latest/download/latest.json', { status: 500, body: 'x' });
    const e5 = mk(gh); const s5 = await e5.up.check();
    eq('서버 오류 → 오류 (HTTP 500)', [s5.state, s5.error], ['error', 'HTTP 500']);
    const off = mk({ base: 'http://127.0.0.1:1/releases' }); const so = await off.up.check();
    ok('인터넷이 안 되면 → 오류 (ERP 는 그대로)', so.state === 'error' && so.error.length > 0, so);
  });

  // ------------------------------------------------------------------------------------------
  await sec('3. 켤 때 설치', async () => {
    const { up, ud, calls } = mk(gh); const rel = publish(gh, '1.10.1'); await up.check();
    const t0 = up.startup();
    const c = calls.spawn[0] || {};
    ok('받아 둔 새 버전 → 설치 파일 실행 · ERP 를 띄우지 않음 (true)', t0 === true && calls.spawn.length === 1 && c.file === path.join(ud, 'update', rel.name), { t0, spawn: calls.spawn });
    eq('인자 = /UPDATE /D=<설치 폴더> (따옴표 없이 맨 끝)', c.args, ['/UPDATE', '/D=' + INSTALL_DIR]);
    ok('실행 방식: 따로 떨어진 프로세스 · 인자 그대로 · 프로그램 이름만 따옴표', c.opts && c.opts.detached === true && c.opts.windowsVerbatimArguments === true && c.opts.argv0 === '"' + c.file + '"' && c.opts.stdio === 'ignore', c.opts);
    const bk = backups(ud); const bdir = bk[0] && path.join(ud, 'update_backup', bk[0]);
    ok('설치 전에 데이터 폴더 복사 (이름 = 시각_v지금_to_v새 버전)', bk.length === 1 && /^\d{4}-\d\d-\d\d_\d{6}_v1\.10\.0_to_v1\.10\.1$/.test(bk[0]) && JSON.parse(fs.readFileSync(path.join(bdir, 'tables', 'po.json'), 'utf8'))[0].po_no === 'V15-PO' && fs.existsSync(path.join(bdir, 'meta.json')), bk);
    ok('복사본에 하루 백업(backup/) 은 넣지 않음', bdir && !fs.existsSync(path.join(bdir, 'backup')), bdir && fs.readdirSync(bdir));
    eq('시도 횟수 1 · 상태 = 설치 시작', [pendingOf(ud).tries, up.status().state], [1, 'installing']);
    ok('기록 파일 (update.log)', /install 1\.10\.0 -> 1\.10\.1 \(try 1\)/.test(fs.readFileSync(path.join(ud, 'update', 'update.log'), 'utf8')));
    // 설치가 되지 않고 다시 켜짐 (옛 버전 그대로) → 한 번 더 → 두 번 실패하면 멈춤
    const r2 = mk(gh, { ud }); ok('두 번째 켤 때 다시 설치', r2.up.startup() === true && pendingOf(ud).tries === 2);
    const r3 = mk(gh, { ud }); const t3 = r3.up.startup(); const s3 = r3.up.status();
    ok('두 번 실패하면 저절로 다시 하지 않음 (ERP 는 켜짐) · 오류 + 지금 업데이트 가능', t3 === false && r3.calls.spawn.length === 0 && s3.state === 'error' && /두 번/.test(s3.error) && s3.ready && s3.ready.version === '1.10.1', s3);
    // 자동 업데이트 끔 · 설치할 수 없는 실행 (개발 · Windows 아님)
    const r4 = mk(gh, { ud: tmp('erp-v15-ud-'), auto: false }); publish(gh, '1.10.1'); await r4.up.check();
    ok('자동 업데이트를 끄면 켤 때 설치하지 않음 (받아 둔 것은 남음)', r4.up.startup() === false && r4.calls.spawn.length === 0 && r4.up.status().ready, r4.up.status());
    const r5 = mk(gh, { ud: tmp('erp-v15-ud-'), installDir: null }); await r5.up.check();
    ok('설치형이 아니면 (installDir 없음) 설치하지 않음', r5.up.startup() === false && r5.calls.spawn.length === 0 && r5.up.status().canInstall === false);
    // 받아 둔 파일이 손상 → 지우고 ERP 를 그대로 켬
    const r6 = mk(gh, { ud: tmp('erp-v15-ud-') }); const rel6 = publish(gh, '1.10.1'); await r6.up.check();
    const f6 = path.join(r6.ud, 'update', rel6.name); const b6 = fs.readFileSync(f6); b6[10] ^= 0xff; fs.writeFileSync(f6, b6);
    ok('받아 둔 파일이 손상 → 설치하지 않고 지움', r6.up.startup() === false && r6.calls.spawn.length === 0 && !pendingOf(r6.ud) && !fs.existsSync(f6));
    // 설치가 끝나 새 버전으로 켜짐 → 기록 · 정리
    const r7 = mk(gh, { ud: tmp('erp-v15-ud-') }); const rel7 = publish(gh, '1.10.1'); await r7.up.check();
    const n7 = mk(gh, { ud: r7.ud, version: '1.10.1' }); const t7 = n7.up.startup(); const s7 = n7.up.status();
    ok('새 버전으로 켜짐 → 업데이트 기록 1.10.0 → 1.10.1 · 방금 업데이트 표시', t7 === false && s7.last && s7.last.from === '1.10.0' && s7.last.to === '1.10.1' && s7.justUpdated && s7.justUpdated.to === '1.10.1', s7);
    ok('받아 둔 설치 파일 · pending.json 정리', !fs.existsSync(path.join(r7.ud, 'update', rel7.name)) && !pendingOf(r7.ud) && n7.calls.spawn.length === 0, updFiles(r7.ud));
    const n8 = mk(gh, { ud: r7.ud, version: '1.10.1' }); n8.up.startup();
    ok('다음에 켤 때는 방금 업데이트 표시 없음 (기록은 남음)', n8.up.status().justUpdated === null && n8.up.status().last.to === '1.10.1');
    // 남은 설치 파일 (끝난 설치 프로그램이 열려 있어 못 지운 것) → 다음에 켤 때 지움
    const r8 = mk(gh, { ud: tmp('erp-v15-ud-') }); fs.mkdirSync(path.join(r8.ud, 'update'), { recursive: true });
    fs.writeFileSync(path.join(r8.ud, 'update', 'ColorPencil-ERP-Setup-1.9.9.exe'), 'x'); fs.writeFileSync(path.join(r8.ud, 'update', 'ColorPencil-ERP-Setup-1.9.9.exe.part'), 'x');
    ok('남은 설치 파일 · 받다 만 파일 → 켤 때 지움', r8.up.startup() === false && !updFiles(r8.ud).some(f => /\.exe/.test(f)), updFiles(r8.ud));
    // 데이터 복사본은 최근 5개만
    let T = Date.parse('2026-10-21T08:00:00'); const r9 = mk(gh, { ud: tmp('erp-v15-ud-'), now: () => (T += 1000) });
    for (let i = 0; i < 7; i++) r9.up.backupData({ version: '1.10.1' });
    eq('데이터 복사본 최근 5개만', backups(r9.ud).length, 5);
  });

  // ------------------------------------------------------------------------------------------
  await sec('4. [지금 업데이트] · 자동 켜고 끄기 · 확인 주기', async () => {
    const { up, ud, calls } = mk(gh); publish(gh, '1.10.1');
    let err = null; try { await up.installNow(0); } catch (e) { err = e.message; }
    ok('받아 둔 것이 없으면 → 오류', /받아 둔 새 버전이 없습니다/.test(err || ''), err);
    await up.check();
    const pj = pendingOf(ud); pj.tries = 2; fs.writeFileSync(path.join(ud, 'update', 'pending.json'), JSON.stringify(pj));
    const r = await up.installNow(30);
    eq('지금 업데이트 → 바로 답 (ok · 버전)', r, { ok: true, version: '1.10.1' });
    eq('응답 뒤에 시작 (아직 실행 전)', [calls.before, calls.spawn.length, calls.quit], [0, 0, 0]);
    await sleep(200);
    eq('화면 저장 → 백업 · 설치 파일 실행 → 끝내기', [calls.before, calls.spawn.length, calls.quit, backups(ud).length], [1, 1, 1, 1]);
    eq('두 번 실패했어도 지금 업데이트는 됨 (시도 횟수 0 → 1)', pendingOf(ud).tries, 1);
    // 설치 파일을 못 띄우면 ERP 를 끝내지 않음
    const f = mk(gh, { ud: tmp('erp-v15-ud-'), spawn: () => { throw new Error('ENOENT'); } }); publish(gh, '1.10.1'); await f.up.check();
    await f.up.installNow(0); await sleep(100);
    ok('설치 파일 실행 실패 → ERP 그대로 (끝내지 않음) · 오류', f.calls.quit === 0 && f.up.status().state === 'error' && /실행하지 못했습니다/.test(f.up.status().error), f.up.status());
    // 설치형이 아님
    const nd = mk(gh, { ud: tmp('erp-v15-ud-'), installDir: null }); publish(gh, '1.10.1'); await nd.up.check();
    let e2 = null; try { await nd.up.installNow(0); } catch (e) { e2 = e.message; }
    ok('설치형이 아니면 지금 업데이트 → 오류', /설치형/.test(e2 || ''), e2);
    // 자동 켜고 끄기 · 확인 주기
    const a = mk(gh, { ud: tmp('erp-v15-ud-'), firstCheck: 30, every: 3600000 }); publish(gh, '1.10.1');
    const s = a.up.setAuto(false);
    ok('자동 끄기 → 설정에 저장 · 상태', s.auto === false && a.calls.saveAuto.join() === 'false');
    gh.hits.length = 0; a.up.schedule(); await sleep(200);
    ok('자동이 꺼져 있으면 저절로 확인하지 않음', !gh.hits.length, gh.hits);
    a.up.stop(); a.up.setAuto(true); a.up.schedule(); await sleep(400);
    ok('자동이 켜져 있으면 저절로 확인 · 받기', gh.hits.includes('/releases/latest/download/latest.json') && a.up.status().state === 'ready', { hits: gh.hits, st: a.up.status() });
    a.up.stop();
  });

  // ------------------------------------------------------------------------------------------
  const port0 = 6900 + Math.floor(Math.random() * 300);
  const U = mk(gh); publish(gh, '1.10.1');
  const S = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir: tmp('erp-v15-data-'), host: '127.0.0.1', port: port0, backupDelay: 3600000, update: U.up, updateWait: 3000 });
  const S0 = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir: tmp('erp-v15-data0-'), host: '127.0.0.1', port: port0 + 400, backupDelay: 3600000 });
  await sec('5. 서버 API', async () => {
    const o = S.port;
    const g = await req(o, 'GET', '/api/update');
    ok('GET /api/update → 설치형 · 이 PC · 지금 버전', g.status === 200 && g.json.desktop === true && g.json.local === true && g.json.current === '1.10.0', g.json);
    const c = await req(o, 'POST', '/api/update/check', {});
    ok('POST /api/update/check → 받아 둠', c.status === 200 && c.json.state === 'ready' && c.json.ready.version === '1.10.1', c.json);
    const pu = await req(o, 'PUT', '/api/update', { auto: false });
    ok('PUT /api/update {auto:false} → 꺼짐', pu.status === 200 && pu.json.auto === false && U.calls.saveAuto.slice(-1)[0] === false, pu.json);
    await req(o, 'PUT', '/api/update', { auto: true });
    eq('쓰기는 JSON 만 (text/plain → 403)', await new Promise((res) => { const q = http.request({ host: '127.0.0.1', port: o, method: 'POST', path: '/api/update/install', headers: { 'Content-Type': 'text/plain' } }, r => { r.resume(); res(r.statusCode); }); q.end('{}'); }), 403);
    eq('다른 출처(Origin) 의 설치 요청 → 403', (await req(o, 'POST', '/api/update/install', {}, { headers: { Origin: 'http://evil.example' } })).status, 403);
    eq('설치형이 아닌 서버: 보기 = desktop false · 확인 → 404', [(await req(S0.port, 'GET', '/api/update')).json.desktop, (await req(S0.port, 'POST', '/api/update/check', {})).status], [false, 404]);
    // 다른 PC (사내망): 보기만
    const L2 = { localAddress: '127.0.0.2' }; let can = true; try { await req(o, 'GET', '/api/ping', undefined, L2); } catch (e) { can = false; }
    if (!can) console.log('  (건너뜀: 127.0.0.2 로 연결할 수 없는 환경)');
    else {
      eq('다른 PC: 로그인 전 → 401', (await req(o, 'GET', '/api/update', undefined, L2)).status, 401);
      await req(o, 'PUT', '/api/lan/pin', { pin: '1357' });
      const lg = await req(o, 'POST', '/api/login', { pin: '1357' }, L2); const cookie = String((lg.headers['set-cookie'] || [''])[0]).split(';')[0];
      const C = Object.assign({ cookie }, L2);
      const rg = await req(o, 'GET', '/api/update', undefined, C);
      ok('다른 PC: 상태는 보임 (local false)', rg.status === 200 && rg.json.local === false && rg.json.desktop === true, rg.json);
      eq('다른 PC: 확인 · 설치 · 끄기 → 403', [(await req(o, 'POST', '/api/update/check', {}, C)).status, (await req(o, 'POST', '/api/update/install', {}, C)).status, (await req(o, 'PUT', '/api/update', { auto: false }, C)).status], [403, 403, 403]);
      await req(o, 'PUT', '/api/lan/pin', { pin: '' });
    }
    eq('아직 설치를 시작하지 않음', U.calls.spawn.length, 0);
  });

  // ------------------------------------------------------------------------------------------
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];
  const newPage = async (ctx) => { const pg = await ctx.newPage(); pg.on('pageerror', e => errors.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Failed to fetch/.test(m.text())) errors.push('console: ' + m.text()); }); return pg; };
  const ready = (pg) => pg.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 180000 });
  await sec('6. 화면 (설정 카드 · 알림 · 지금 업데이트)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 } }); const A = await newPage(ctx);
    await A.goto(S.url + '/#/dashboard'); await ready(A);
    await A.waitForSelector('#main > .upd-bar', { timeout: 10000 }).catch(() => {});
    const bar = await A.evaluate(() => { const b = document.querySelector('#main > .upd-bar'); return b && b.innerText; });
    ok('화면 위 알림: 새 버전 1.10.1 · 다음에 켤 때 · 지금 업데이트', bar && /1\.10\.1/.test(bar) && /다음에 ERP 를 켤 때/.test(bar) && /지금 업데이트/.test(bar), bar);
    await A.evaluate(() => { location.hash = '#/orders'; }); await A.waitForTimeout(300);
    ok('다른 화면에서도 알림', await A.evaluate(() => !!document.querySelector('#main > .upd-bar')));
    await A.evaluate(() => { location.hash = '#/settings'; }); await A.waitForSelector('#updCard dl', { timeout: 10000 });
    const card = await A.evaluate(() => document.querySelector('#updCard').innerText);
    ok('설정 카드: 지금 버전 · 새 버전 준비됨 · 자동 업데이트 · 지금 확인 · 지금 업데이트 (1.10.1)', /지금 버전/.test(card) && /1\.10\.0/.test(card) && /새 버전 1\.10\.1 준비됨/.test(card) && /자동 업데이트/.test(card) && /지금 확인/.test(card) && /지금 업데이트 \(1\.10\.1\)/.test(card) && /update_backup/.test(card), card);
    ok('설정 카드 · 알림에 null · undefined 글자 없음', !/null|undefined/.test(card + (await A.evaluate(() => document.querySelector('#main').innerText))), card);
    await A.click('#updCard input[type=checkbox]'); await A.waitForTimeout(500);
    ok('자동 업데이트 끄기 (화면) → 서버 · 알림', U.up.status().auto === false && /자동 업데이트를 껐습니다/.test(await A.evaluate(() => document.querySelector('#toasts').innerText)), U.up.status().auto);
    await A.click('#updCard input[type=checkbox]'); await A.waitForTimeout(500);
    await A.click('#updCard >> text=지금 확인'); await A.waitForTimeout(600);
    ok('지금 확인 (화면) → 상태 다시 그림', /새 버전 1\.10\.1 준비됨/.test(await A.evaluate(() => document.querySelector('#updCard').innerText)));
    // 지금 업데이트 → 확인 창 → 가림막 → 설치 시작
    await A.click('#main > .upd-bar button'); await A.waitForSelector('.modal');
    const msg = await A.evaluate(() => document.querySelector('.modal').innerText);
    ok('확인 창: 닫고 설치한 뒤 다시 켬 · 다른 PC 도 끊김', /1\.10\.1/.test(msg) && /다시 켭니다/.test(msg) && /다른 PC/.test(msg), msg);
    await A.click('.modal .modal-foot button.primary'); await A.waitForSelector('.upd-gate', { timeout: 5000 }).catch(() => {});
    ok('설치 중 가림막', /업데이트 설치 중/.test(await A.evaluate(() => (document.querySelector('.upd-gate') || {}).innerText || '')));
    await A.waitForTimeout(900);
    eq('서버 → 저장 · 백업 · 설치 파일 실행 · 끝내기', [U.calls.before, U.calls.spawn.length, U.calls.quit], [1, 1, 1]);
    eq('설치 파일 인자', U.calls.spawn[0] && U.calls.spawn[0].args, ['/UPDATE', '/D=' + INSTALL_DIR]);
    await ctx.close();
  });

  await sec('6-2. 업데이트 뒤 알림 · 베트남어 · 설치형이 아닐 때', async () => {
    const r = mk(gh, { ud: tmp('erp-v15-ud-') }); publish(gh, '1.10.1'); await r.up.check();
    const n = mk(gh, { ud: r.ud, version: '1.10.1' }); n.up.startup();
    const S2 = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir: tmp('erp-v15-data2-'), host: '127.0.0.1', port: port0 + 200, backupDelay: 3600000, update: n.up });
    const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 } }); const A = await newPage(ctx);
    // 알림(toast)은 몇 초 뒤 사라지므로 나타난 글자를 모두 적어 둔다
    await A.addInitScript(() => { window.__toastLog = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('toast')) window.__toastLog.push(n.textContent); }))).observe(document, { childList: true, subtree: true }); });
    const toasts = () => A.evaluate(() => window.__toastLog.join(' | '));
    await A.goto(S2.url + '/#/dashboard'); await ready(A);
    await A.waitForFunction(() => window.__toastLog.some(t => /새 버전으로 바꿨습니다/.test(t)), null, { timeout: 15000 }).catch(() => {});
    const t1 = await toasts();
    ok('새 버전으로 켜지면 한 번 알림 (1.10.0 → 1.10.1) · 화면 위 알림 없음', /새 버전으로 바꿨습니다/.test(t1) && /1\.10\.0 → 1\.10\.1/.test(t1) && !(await A.evaluate(() => !!document.querySelector('.upd-bar'))), t1);
    await A.reload(); await ready(A);
    await A.waitForFunction(() => window.ERP && ERP.upd, null, { timeout: 15000 }).catch(() => {}); await A.waitForTimeout(300);
    ok('다시 열면 알리지 않음', !/새 버전으로 바꿨습니다/.test(await toasts()), await toasts());
    await A.evaluate(() => { location.hash = '#/settings'; }); await A.waitForSelector('#updCard dl', { timeout: 10000 });
    ok('설정 카드: 마지막 업데이트 1.10.0 → 1.10.1', /1\.10\.0 → 1\.10\.1/.test(await A.evaluate(() => document.querySelector('#updCard').innerText)));
    await A.evaluate(() => ERP.setLang('vi')); await A.waitForSelector('#updCard dl', { timeout: 10000 }); await A.waitForTimeout(300);
    const vi = await A.evaluate(() => document.querySelector('#updCard').innerText);
    ok('베트남어: 카드 글자 · undefined · null 없음', /Cập nhật chương trình/.test(vi) && /Phiên bản hiện tại/.test(vi) && /Tự động cập nhật/.test(vi) && !/undefined|null/.test(vi), vi);
    await A.evaluate(() => ERP.setLang('ko'));
    const B = await newPage(ctx); await B.goto(S0.url + '/#/settings'); await ready(B); await B.waitForSelector('#updCard', { timeout: 10000 }); await B.waitForTimeout(500);
    ok('설치형이 아닌 서버: "PC 설치형 ERP 에만"', /PC 설치형 ERP 에만/.test(await B.evaluate(() => document.querySelector('#updCard').innerText)));
    ok('설치형이 아니면 화면 위 알림 없음', !(await B.evaluate(() => !!document.querySelector('.upd-bar'))));
    await ctx.close(); S2.close();
  });

  // ------------------------------------------------------------------------------------------
  await sec('7. 설치 프로그램 · Release · Windows 시험 · 버전 번호', async () => {
    const nsi = fs.readFileSync(path.join(ROOT, 'build', 'installer.nsi'), 'utf8');
    ok('설치 프로그램: /UPDATE → 화면 건너뜀 · 진행 막대 뒤 자동 닫힘 · 끝나면 ERP 다시 켬 · 닫히기를 기다림',
      /\$\{GetOptions\} \$R1 "\/UPDATE" \$R2/.test(nsi) && (nsi.match(/MUI_PAGE_CUSTOMFUNCTION_PRE SkipInUpdate/g) || []).length === 3 && /SetAutoClose true/.test(nsi) && /Function \.onInstSuccess[\s\S]*?Exec '"\$INSTDIR\\\$\{EXENAME\}"'/.test(nsi) && /\$R9 < 60[\s\S]*?Sleep 500/.test(nsi));
    ok('설치 프로그램: 사용자 권한 · 바탕화면 바로가기를 지운 PC 에 다시 만들지 않음', /RequestExecutionLevel user/.test(nsi) && /\$\{OrIf\} \$\{FileExists\} "\$DESKTOP\\\$\{APPNAME\}\.lnk"/.test(nsi));
    const rel = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
    ok('Release: latest.json (version · file · sha256 · size) 를 같이 올림', /dist\/latest\.json/.test(rel) && /gh release upload[^\n]*dist\/latest\.json/.test(rel) && /gh release create[^\n]*dist\/latest\.json/.test(rel) && /sha256: s, size: Number\(n\)/.test(rel));
    const ut = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'update-test.yml'), 'utf8');
    ok('Windows 자동 업데이트 시험 워크플로', /runs-on: windows-latest/.test(ut) && /node tools\/update_e2e\.js/.test(ut) && /ERP_E2E_OK: '1'/.test(ut) && fs.existsSync(path.join(ROOT, 'tools', 'update_e2e.js')));
    const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
    ok('Electron: 시험용 데이터 폴더는 잠금 전에 · 켤 때 설치는 서버 전에 · 설치형에서만 설치',
      main.indexOf('ERP_USER_DATA_DIR') < main.indexOf('requestSingleInstanceLock') && main.indexOf('up.startup()') < main.indexOf('server.start(') && /installDir: app\.isPackaged && process\.platform === 'win32'/.test(main) && /update: up/.test(main));
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const core = (fs.readFileSync(path.join(ROOT, 'app', 'js', 'core.js'), 'utf8').match(/g\.ERP = \{ v: '([^']+)'/) || [])[1];
    const nsv = (nsi.match(/!define VERSION "([^"]+)"/) || [])[1], rlv = (rel.match(/default: '(\d+\.\d+\.\d+)'/) || [])[1], dsv = (pkg.scripts.dist.match(/-DVERSION=(\S+)/) || [])[1];
    eq('버전 번호가 모두 같음 (package.json · core.js · installer.nsi · release.yml · dist)', [core, nsv, rlv, dsv], [pkg.version, pkg.version, pkg.version, pkg.version]);
    ok('electron/** 는 설치형에 들어감 (updater.js 포함)', pkg.build.files.includes('electron/**'));
  });

  // ------------------------------------------------------------------------------------------
  const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const fits = (pg) => pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  await sec('8. 휴대폰 화면 (공장 Wi-Fi · 사내망 접속)', async () => {
    const ctx = await browser.newContext(PHONE); const A = await newPage(ctx);
    await A.goto(S.url + '/#/dashboard'); await ready(A); await A.waitForTimeout(800);
    const nv = await A.evaluate(() => ({ tog: getComputedStyle(document.querySelector('.nav-toggle')).display, nav: getComputedStyle(document.querySelector('nav.side .nav')).display, txt: document.querySelector('.nav-toggle').innerText }));
    ok('메뉴는 접힘 · [☰ 지금 화면] 버튼', nv.tog !== 'none' && nv.nav === 'none' && /종합 현황/.test(nv.txt), nv);
    await A.click('.nav-toggle'); await A.waitForTimeout(200);
    ok('[☰] → 메뉴 열림', await A.evaluate(() => getComputedStyle(document.querySelector('nav.side .nav')).display !== 'none' && document.querySelector('.nav-toggle').getAttribute('aria-expanded') === 'true'));
    await A.click('nav.side .nav a[href="#/production"]'); await A.waitForTimeout(800);
    ok('메뉴에서 생산 관리 → 메뉴 다시 접힘', await A.evaluate(() => /#\/production/.test(location.hash) && getComputedStyle(document.querySelector('nav.side .nav')).display === 'none' && /생산 관리/.test(document.querySelector('.nav-toggle').innerText)));
    for (const pg of ['dashboard', 'production', 'orders', 'floor', 'materials', 'settings']) {
      await A.evaluate((p) => { location.hash = '#/' + p; }, pg); await A.waitForTimeout(900);
      const f = await fits(A); ok('휴대폰 폭(390)에 맞음 · 옆으로 밀리지 않음: ' + pg, f.sw <= 391 && f.iw === 390, f);
    }
    await A.evaluate(() => { location.hash = '#/production'; }); await A.waitForTimeout(500);
    for (const tab of ['log', 'entry', 'analysis', 'machines', 'procs']) {
      await A.evaluate((t) => { ERP.state.prodTab = t; ERP.render(); }, tab); await A.waitForTimeout(700);
      const f = await fits(A); ok('생산 관리 탭도 휴대폰 폭에 맞음: ' + tab, f.sw <= 391 && f.iw === 390, f);
    }
    await A.evaluate(() => { ERP.state.prodTab = 'log'; });
    const man = await req(S.port, 'GET', '/manifest.webmanifest');
    ok('홈 화면에 추가: manifest (이름 · 시작 화면 · 아이콘) · 아이콘 파일', man.status === 200 && /application\/manifest\+json/.test(man.headers['content-type']) && man.json.short_name === 'ERP' && man.json.display === 'standalone' && (await req(S.port, 'GET', '/icon-256.png')).status === 200, man.json);
    ok('index.html: manifest · apple-touch-icon · theme-color', await A.evaluate(() => !!document.querySelector('link[rel=manifest]') && !!document.querySelector('link[rel=apple-touch-icon]') && !!document.querySelector('meta[name=theme-color]')));
    await A.evaluate(() => { location.hash = '#/settings'; }); await A.waitForSelector('#phoneCard h4', { timeout: 10000 });
    const pc = await A.evaluate(() => document.querySelector('#phoneCard').innerText);
    ok('설정 → 휴대폰으로 보기: 사내망 접속이 꺼져 있으면 켜는 법 (메뉴 · 방화벽 허용 · PIN)', /공장 Wi-Fi 안에서/.test(pc) && /사내망 접속 꺼짐/.test(pc) && /사내망 접속 켜기/.test(pc) && /허용/.test(pc) && /공장 밖에서/.test(pc), pc);
    await ctx.close();
    // 사내망 접속이 켜진 ERP (0.0.0.0) — 주소 · QR · PIN 없음
    const S4 = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir: tmp('erp-v15-lan-'), host: '0.0.0.0', port: port0 + 800, backupDelay: 3600000 });
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const B = await newPage(c2);
    await B.goto('http://127.0.0.1:' + S4.port + '/#/settings'); await ready(B); await B.waitForSelector('#phoneCard h4', { timeout: 10000 });
    const info = (await req(S4.port, 'GET', '/api/info')).json;
    const card = await B.evaluate(() => ({ t: document.querySelector('#phoneCard').innerText, img: (document.querySelector('#phoneCard .qr img') || {}).src || '' }));
    if (info.lan.length) ok('사내망 켜짐: 휴대폰 주소 · QR 코드 · PIN 없음 알림 · 순서 (Wi-Fi · QR · PIN · 홈 화면에 추가)', card.t.includes(info.lan[0]) && /^data:image\/gif;base64,/.test(card.img) && /PIN 없음/.test(card.t) && /홈 화면에 추가/.test(card.t), card.t);
    else ok('사내망 켜짐 (이 PC 에 네트워크 주소 없음) → 알림', /네트워크 주소를 찾지 못했습니다/.test(card.t), card.t);
    await c2.close(); S4.close();
  });

  // ------------------------------------------------------------------------------------------
  // 구글 Apps Script 를 흉내 낸다 — 실제 google/Code.gs 를 Node vm 에서 돌림
  function gas() {
    const props = new Map(), cache = new Map(), files = new Map(); let made = false;
    const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
    const mkFile = (name, content) => { const f = { content, getName: () => name, setContent(c) { f.content = c; return f; }, getBlob: () => ({ getDataAsString: () => String(f.content) }), setTrashed(t) { if (t) files.delete(name); }, getUrl: () => 'https://drive.example/' + name }; return f; };
    const folder = { getFilesByName: (n) => iter(files.has(n) ? [files.get(n)] : []), getFiles: () => iter(Array.from(files.values())),
      createFile(a, b) { const f = typeof a === 'string' ? mkFile(a, b) : mkFile(a.name, Buffer.from(a.bytes).toString('latin1')); files.set(f.getName(), f); return f; } };
    const c = {
      ContentService: { MimeType: { JSON: 'json' }, createTextOutput(s) { const o = { setMimeType: () => o, getContent: () => s }; return o; } },
      HtmlService: { XFrameOptionsMode: { DEFAULT: 'DEFAULT' }, createHtmlOutput(html) { const o = { meta: {}, setTitle(t) { o.title = t; return o; }, addMetaTag(k, v) { o.meta[k] = v; return o; }, setXFrameOptionsMode(x) { o.xf = x; return o; }, getContent: () => html }; return o; } },
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getName: () => 'TEST', getUrl: () => 'https://sheet.example' }) },
      DriveApp: { getFoldersByName: () => iter(made ? [folder] : []), createFolder: () => { made = true; return folder; } },
      PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperties: (o) => Object.keys(o).forEach(k => props.set(k, String(o[k]))), deleteProperty: (k) => props.delete(k) }) },
      CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, String(v)), remove: (k) => cache.delete(k) }) },
      Utilities: { DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' }, getUuid: () => crypto.randomUUID(),
        computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
        newBlob: (bytes, mime, name) => ({ name, bytes, getBytes: () => bytes }), base64Decode: (b) => Array.from(Buffer.from(b, 'base64')), formatDate: () => '20261021_0000' },
    };
    require('vm').createContext(c); require('vm').runInContext(fs.readFileSync(path.join(ROOT, 'google', 'Code.gs'), 'utf8').replace("var TOKEN = 'CHANGE-ME';", "var TOKEN = 'T15';"), c);
    const post = (o) => JSON.parse(c.doPost({ postData: { contents: JSON.stringify(o) } }).getContent());
    return { c, props, cache, files, post };
  }
  await sec('9. 구글 웹 앱 (Code.gs 4판)', async () => {
    const G = gas();
    const g = G.c.doGet({ parameter: {} });
    ok('브라우저로 열면 휴대폰 화면 (제목 · 휴대폰 폭 · 화면 글자는 textContent)', g.title === 'ColorPencil ERP' && g.meta.viewport === 'width=device-width, initial-scale=1' && /google\.script\.run/.test(g.getContent()) && !/innerHTML/.test(g.getContent()), { title: g.title, meta: g.meta });
    eq('?ping=1 → 상태 JSON (4판)', JSON.parse(G.c.doGet({ parameter: { ping: '1' } }).getContent()).ver, 4);
    eq('TOKEN 이 틀리면 거절', G.post({ token: 'x', action: 'ping' }).error, 'bad token');
    eq('ping → 4판', G.post({ token: 'T15', action: 'ping' }).ver, 4);
    eq('비밀번호 없음 → NO_PW', G.c.mobileData('secret12').error, 'NO_PW');
    eq('비밀번호 6자 미만 → 거절', G.post({ token: 'T15', action: 'mobile_pw', pw: '12345' }).ok, false);
    ok('비밀번호 정하기 → 소금 + SHA-256 해시만 저장 (원문 없음)', G.post({ token: 'T15', action: 'mobile_pw', pw: 'secret12' }).on === true && /^[0-9a-f]{64}$/.test(G.props.get('MOBILE_HASH')) && G.props.get('MOBILE_SALT') && !Array.from(G.props.values()).some(v => v.includes('secret12')), Array.from(G.props.entries()));
    eq('요약을 아직 안 보냄 → NO_DATA', G.c.mobileData('secret12').error, 'NO_DATA');
    eq('요약 형식 검사 (JSON 이 아니면 거절)', G.post({ token: 'T15', action: 'mobile', summary: '{bad' }).ok, false);
    ok('요약 받기 → 드라이브 파일 하나', G.post({ token: 'T15', action: 'mobile', summary: JSON.stringify({ v: 1, n: 1 }) }).ok && G.files.has('ERP_mobile.json'));
    G.post({ token: 'T15', action: 'mobile', summary: JSON.stringify({ v: 1, n: 2 }) });
    eq('다시 보내면 같은 파일을 바꿈', [G.files.size, JSON.parse(G.files.get('ERP_mobile.json').content).n], [1, 2]);
    eq('틀린 비밀번호 → BAD_PW', G.c.mobileData('wrong').error, 'BAD_PW');
    const r = G.c.mobileData('secret12'); ok('맞는 비밀번호 → 요약', r.ok && JSON.parse(r.data).n === 2, r);
    for (let i = 0; i < 10; i++) G.c.mobileData('wrong');
    eq('10번 틀리면 잠금 (맞는 비밀번호도 WAIT)', G.c.mobileData('secret12').error, 'WAIT');
    G.post({ token: 'T15', action: 'mobile_pw', pw: 'newpass99' });
    ok('비밀번호를 바꾸면 잠금 풀림 · 옛 비밀번호는 안 됨', G.c.mobileData('newpass99').ok && G.c.mobileData('secret12').error === 'BAD_PW');
    G.post({ token: 'T15', action: 'mobile_pw', pw: '' });
    eq('끄기 (빈 비밀번호) → NO_PW', G.c.mobileData('newpass99').error, 'NO_PW');
    ok('3판 기능 그대로 (드라이브 백업)', G.post({ token: 'T15', action: 'backup', name: 'ERP_backup_2026-10-21.json.gz', b64: Buffer.from('x').toString('base64') }).ok === true);
    eq('모르는 요청 → unknown action', G.post({ token: 'T15', action: 'nope' }).error, 'unknown action');
  });

  await sec('10. 휴대폰 요약 → 구글 웹 앱 → 휴대폰 화면', async () => {
    const G = gas(); const posts = []; let oldScript = false;
    const readAll = (q) => new Promise(r => { const ch = []; q.on('data', d => ch.push(d)); q.on('end', () => r(Buffer.concat(ch).toString('utf8'))); });
    const gsrv = http.createServer(async (q, res) => {
      const body = await readAll(q);
      if (q.method === 'POST' && q.url.startsWith('/macros/s/T15/exec')) {
        const j = JSON.parse(body); posts.push(j);
        const out = oldScript && /^mobile/.test(j.action) ? JSON.stringify({ ok: false, error: 'unknown action' }) : G.c.doPost({ postData: { contents: body } }).getContent();
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(out);
      }
      if (q.method === 'GET' && q.url.startsWith('/macros/s/T15/exec')) { const o = G.c.doGet({ parameter: {} }); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(o.getContent().replace('<head>', '<head><meta name="viewport" content="' + o.meta.viewport + '">')); }
      if (q.method === 'POST' && q.url === '/run/mobileData') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(G.c.mobileData(JSON.parse(body).pw))); }
      res.writeHead(404); res.end();
    });
    await new Promise(r => gsrv.listen(0, '127.0.0.1', r)); const gUrl = 'http://127.0.0.1:' + gsrv.address().port + '/macros/s/T15/exec';
    const S3 = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir: tmp('erp-v15-g-'), host: '127.0.0.1', port: port0 + 600, backupDelay: 3600000, googleHosts: /^127\.0\.0\.1$/ });
    const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 } }); const A = await newPage(ctx);
    await A.goto(S3.url + '/#/dashboard'); await ready(A); await A.waitForTimeout(500);
    // 요약 = 종합 현황 화면과 같은 숫자
    const sm = await A.evaluate(() => { const s = ERP.mobileSummary(); const w = (id) => { const e = document.querySelector('.w[data-id="' + id + '"] .kpi-val .v'); return e ? e.textContent : null; }; return { s, due: w('kpi_due'), pck: w('kpi_pck_day'), procs: ERP.dashProcs().map(p => p.id), ref: ERP.calc.latestProdDate() }; });
    const S1 = sm.s;
    ok('요약: 기준일 = 최신 생산일보 · 공정 = 종합 현황 공정 · 14일 · 목록 8개까지', S1.ref === sm.ref && S1.procs.map(p => p.id).join() === sm.procs.join() && S1.daily.days.length === 14 && S1.daily.days[0] === sm.ref && S1.due.length <= 8 && S1.low.length <= 8 && S1.month.length === sm.procs.length, { ref: S1.ref, procs: S1.procs.map(p => p.id), days: S1.daily.days.length });
    ok('요약 숫자 = 종합 현황 위젯 (납기 임박/경과 · 기준일 포장)', sm.due !== null && Number(sm.due.replace(/[^\d]/g, '')) === S1.kpi.due.soon + S1.kpi.due.late && Number(sm.pck.replace(/[^\d]/g, '')) === S1.kpi.pckDay.ok, { widget: [sm.due, sm.pck], sum: [S1.kpi.due, S1.kpi.pckDay.ok] });
    ok('납기 임박 목록은 납기 순', S1.due.every((o, i) => !i || S1.due[i - 1].due <= o.due), S1.due.map(o => o.due));
    // 설정 카드 (이 PC)
    await A.evaluate(async (u) => { ERP.db.setSetting('gUrl', u); ERP.db.setSetting('gToken', 'T15'); await ERP.db.flush(); location.hash = '#/settings'; }, gUrl);
    await A.waitForSelector('#phoneCard h4', { timeout: 10000 });
    const c0 = await A.evaluate(() => ({ t: document.querySelector('#phoneCard').innerText, qr: document.querySelectorAll('#phoneCard .qr img').length }));
    ok('공장 밖에서: 꺼짐 · 웹 앱 주소 · QR · 비밀번호 정하고 켜기', /꺼짐/.test(c0.t) && c0.t.includes(gUrl) && c0.qr >= 1 && /비밀번호 정하고 켜기/.test(c0.t), c0.t);
    await A.fill('#phoneCard input[type=password]', '123'); await A.click('#phoneCard >> text=비밀번호 정하고 켜기'); await A.waitForTimeout(400);
    ok('비밀번호가 짧으면 알림 · 보내지 않음', /6~32자/.test(await A.evaluate(() => document.querySelector('#toasts').innerText)) && !posts.some(p => p.action === 'mobile_pw'));
    await A.fill('#phoneCard input[type=password]', 'secret12'); await A.click('#phoneCard >> text=비밀번호 정하고 켜기');
    await A.waitForFunction(() => /켜짐/.test((document.querySelector('#phoneCard') || {}).innerText || '') && /지금 보내기/.test(document.querySelector('#phoneCard').innerText), null, { timeout: 10000 }).catch(() => {});
    const pwPost = posts.find(p => p.action === 'mobile_pw'); const mPost = posts.find(p => p.action === 'mobile');
    ok('비밀번호 → 구글 (TOKEN 과 함께) → 요약 보내기 → 켜짐', pwPost && pwPost.pw === 'secret12' && pwPost.token === 'T15' && mPost && JSON.parse(mPost.summary).kpi && /켜짐/.test(await A.evaluate(() => document.querySelector('#phoneCard').innerText)) && G.files.has('ERP_mobile.json'), posts.map(p => p.action));
    ok('설정에 켜짐 저장 · 비밀번호는 ERP 에 남기지 않음', await A.evaluate(() => ERP.db.setting('mobileOn') === true && !JSON.stringify(ERP.db.meta).includes('secret12')));
    const n0 = posts.filter(p => p.action === 'mobile').length;
    await A.click('#phoneCard >> text=지금 보내기'); await A.waitForTimeout(800);
    ok('지금 보내기', posts.filter(p => p.action === 'mobile').length === n0 + 1 && /요약을 보냈습니다/.test(await A.evaluate(() => document.querySelector('#toasts').innerText)));
    // 15분마다 보내기: 바뀐 것이 없고 1시간 안이면 보내지 않음, 바뀌면 보냄
    const n1 = posts.filter(p => p.action === 'mobile').length;
    await A.evaluate(() => ERP.mobileAuto(30, 600000)); await A.waitForTimeout(700);
    ok('자동: 바뀐 것이 없으면 보내지 않음', posts.filter(p => p.action === 'mobile').length === n1, posts.length);
    await A.evaluate(async () => { const r = ERP.db.rows('po').find(x => x.po_no && ERP.calc.isOpen(ERP.calc.poGroups().find(g => g.po_no === x.po_no) || {})); if (r) ERP.db.update('po', r._id, { due: ERP.fmt.addDays(ERP.fmt.today(), 2) }); await ERP.db.flush(); ERP.mobileAuto(30, 600000); });
    await A.waitForTimeout(900);
    ok('자동: 바뀌면 보냄', posts.filter(p => p.action === 'mobile').length === n1 + 1, posts.length);
    await A.evaluate(() => clearTimeout(ERP.mob.timer));
    // 휴대폰 화면 (구글 웹 앱 주소)
    const P = await browser.newContext(PHONE); const M = await newPage(P);
    await M.addInitScript(() => { window.google = { script: { run: { withSuccessHandler(ok) { return { withFailureHandler(bad) { return { mobileData(pw) { fetch('/run/mobileData', { method: 'POST', body: JSON.stringify({ pw }) }).then(r => r.json()).then(ok, bad); } }; } }; } } } }; });
    await M.goto(gUrl); await M.waitForSelector('input[type=password]');
    await M.fill('input[type=password]', 'wrongpw'); await M.click('button.btn.p'); await M.waitForTimeout(500);
    ok('휴대폰: 틀린 비밀번호 → 알림', /비밀번호가 맞지 않습니다/.test(await M.evaluate(() => document.body.innerText)));
    await M.fill('input[type=password]', 'secret12'); await M.click('button.btn.p'); await M.waitForSelector('h2 >> text=생산 관리', { timeout: 10000 }).catch(() => {});
    const ph = await M.evaluate(() => ({ t: document.body.innerText, sw: document.documentElement.scrollWidth, iw: innerWidth }));
    const last = JSON.parse(G.files.get('ERP_mobile.json').content);
    ok('휴대폰: 종합 현황 · 공정별 실적 · 납기 임박 · 안전재고 · 생산 관리 · 14일 표', /종합 현황/.test(ph.t) && /공정별 실적/.test(ph.t) && /납기 임박 수주/.test(ph.t) && /안전재고 미달 자재/.test(ph.t) && /이번 달 누계/.test(ph.t) && /최근 14일 생산량/.test(ph.t) && ph.t.includes(last.ref), ph.t.slice(0, 300));
    ok('휴대폰: 보낸 요약의 숫자 (진행 중 PO · 첫 납기 PO)', ph.t.includes(Number(last.kpi.open.n).toLocaleString('ko-KR')) && (!last.due.length || ph.t.includes(last.due[0].po)), { open: last.kpi.open.n, due0: last.due[0] });
    ok('휴대폰 폭(390)에 맞음 (표는 안에서 옆으로)', ph.sw <= 391 && ph.iw === 390, ph);
    ok('휴대폰: null · undefined · NaN 글자 없음', !/\bnull\b|undefined|NaN/.test(ph.t), (ph.t.match(/.{0,30}(null|undefined|NaN).{0,30}/) || [])[0]);
    await M.click('.lg button[data-l=vi]'); await M.waitForTimeout(200);
    ok('휴대폰: 베트남어', /Tổng quan/.test(await M.evaluate(() => document.body.innerText)) && /Sản xuất/.test(await M.evaluate(() => document.body.innerText)));
    await M.reload(); await M.waitForSelector('.k', { timeout: 10000 }).catch(() => {});
    ok('휴대폰: 비밀번호 기억 → 다시 열면 바로 보임 (베트남어 그대로)', /Tổng quan/.test(await M.evaluate(() => document.body.innerText)) && !(await M.$('input[type=password]')));
    await M.click('text=Khóa'); await M.waitForTimeout(200);
    ok('잠그기 → 비밀번호 화면 · 기억 지움', !!(await M.$('input[type=password]')) && !(await M.evaluate(() => localStorage.getItem('erpm_pw'))));
    await P.close();
    // 옛 Code.gs · 끄기
    oldScript = true; await A.click('#phoneCard >> text=지금 보내기'); await A.waitForTimeout(800);
    ok('옛 Code.gs → "4판을 다시 배포" 알림 · 카드에 실패 표시', /4판/.test(await A.evaluate(() => document.querySelector('#toasts').innerText)) && /실패/.test(await A.evaluate(() => document.querySelector('#phoneCard').innerText)));
    oldScript = false;
    await A.click('#phoneCard >> text=끄기'); await A.waitForSelector('.modal'); await A.click('.modal .modal-foot button.primary');
    await A.waitForFunction(() => /꺼짐/.test(document.querySelector('#phoneCard').innerText), null, { timeout: 10000 }).catch(() => {});
    ok('끄기 → 구글 비밀번호 지움 · 꺼짐 · 더 보내지 않음', !G.props.has('MOBILE_HASH') && await A.evaluate(() => ERP.db.setting('mobileOn') === false) && /꺼짐/.test(await A.evaluate(() => document.querySelector('#phoneCard').innerText)));
    const n2 = posts.filter(p => p.action === 'mobile').length; await A.evaluate(() => ERP.mobileAuto(30, 600000)); await A.waitForTimeout(500);
    ok('꺼져 있으면 자동으로 보내지 않음', posts.filter(p => p.action === 'mobile').length === n2);
    await A.evaluate(() => clearTimeout(ERP.mob.timer));
    await A.evaluate(() => ERP.setLang('vi')); await A.waitForSelector('#phoneCard h4', { timeout: 10000 }); await A.waitForTimeout(300);
    const vi = await A.evaluate(() => document.querySelector('#phoneCard').innerText);
    ok('설정 카드 베트남어 · null 없음', /Xem trên điện thoại/.test(vi) && /Ngoài nhà máy/.test(vi) && !/\bnull\b|undefined/.test(vi), vi);
    await A.evaluate(() => ERP.setLang('ko'));
    await ctx.close(); S3.close(); gsrv.close();
  });

  // ------------------------------------------------------------------------------------------
  await sec('11. 월별 조립 생산량 — 종합 현황 · 생산 관리 · 휴대폰 (1.10.1)', async () => {
    const S5 = await serverMod.start({ appDir: path.join(ROOT, 'app'), dataDir: tmp('erp-v15-m-'), host: '127.0.0.1', port: port0 + 900, backupDelay: 3600000 });
    const ctx = await browser.newContext({ viewport: { width: 1480, height: 1000 } }); const A = await newPage(ctx);
    await A.goto(S5.url + '/#/dashboard'); await ready(A); await A.waitForTimeout(800);
    const d = await A.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('.wgrid .w')).map(e => e.getAttribute('data-id'));
      const w = document.querySelector('.w[data-id=asm_monthly]'); const C = ERP.calc; const ref = C.latestProdDate(); const y = ref.slice(0, 4), mo = ref.slice(0, 7);
      const asm = C.rowsBetween(y + '-01-01', y + '-12-31', 'ASM'); const sum = asm.reduce((a, r) => a + C.qty(r), 0), sumM = asm.filter(r => r.date.slice(0, 7) === mo).reduce((a, r) => a + C.qty(r), 0);
      return { ids, title: w && w.querySelector('h2').textContent, y, sum, sumM, mi: +mo.slice(5, 7), tot: w ? Array.from(w.querySelectorAll('tbody tr.tot td')).map(td => td.textContent) : null };
    });
    ok('종합 현황 기본 배치: 일별 조립 생산량 바로 다음에 월별 조립 생산량', d.ids.indexOf('asm_monthly') === d.ids.indexOf('asm_daily') + 1 && d.ids.indexOf('asm_daily') >= 0, d.ids);
    eq('위젯 제목', d.title, '월별 조립 생산량 · ' + d.y);
    const num = (s) => Number(String(s || '').replace(/[^\d]/g, ''));
    ok('연 합계 = 그해 조립 양품 합 · 이 달 칸 = 그 달 합 (예시 자료 ' + d.y + ')', d.sum > 0 && d.tot && num(d.tot[1]) === d.sum && num(d.tot[1 + d.mi]) === d.sumM, { tot: d.tot, sum: d.sum, sumM: d.sumM });
    await A.click('.w[data-id=asm_monthly] .seg button:last-child'); await A.waitForTimeout(500);
    ok('표 → 차트', await A.evaluate(() => !!document.querySelector('.w[data-id=asm_monthly] canvas')));
    await A.click('.w[data-id=asm_monthly] .seg button:first-child'); await A.waitForTimeout(300);
    await A.click('.w[data-id=asm_monthly] .wnav button[aria-label=prev]'); await A.waitForTimeout(300);
    ok('‹ → 전년', await A.evaluate((y) => document.querySelector('.w[data-id=asm_monthly] h2').textContent.includes(String(y - 1)), +d.y));
    // 저장한 배치 (월별 없음) → 한 번만 일별 아래에, 사용자가 빼면 다시 넣지 않음
    const mig = await A.evaluate(async () => {
      const DB = ERP.db; DB.setSetting('dash', [{ k: 'a', id: 'kpi_due', w: 1 }, { k: 'b', id: 'asm_daily', w: 4 }, { k: 'c', id: 'flow', w: 2 }]); DB.setSetting('dashAsmMonthly', false); await DB.flush();
      ERP.render(); await new Promise(r => setTimeout(r, 300)); const ids1 = ERP.dashLayout().map(x => x.id);
      DB.setSetting('dash', ERP.dashLayout().filter(x => x.id !== 'asm_monthly').map(x => ({ k: x.k, id: x.id, w: x.w }))); await DB.flush();
      ERP.render(); await new Promise(r => setTimeout(r, 300)); return { ids1, ids2: ERP.dashLayout().map(x => x.id), flag: DB.setting('dashAsmMonthly') };
    });
    eq('저장한 배치에 한 번 넣음 (일별 다음)', mig.ids1, ['kpi_due', 'asm_daily', 'asm_monthly', 'flow']);
    eq('사용자가 빼면 다시 넣지 않음', [mig.ids2, mig.flag], [['kpi_due', 'asm_daily', 'flow'], true]);
    // 생산 관리: 일별 · 월별 조립 생산량 탭
    await A.evaluate(() => { ERP.state.prodTab = 'analysis'; ERP.state.pan = null; ERP.state.pmon = null; location.hash = '#/production'; ERP.render(); }); await A.waitForTimeout(700);
    const tabs = await A.evaluate(() => Array.from(document.querySelectorAll('.tabs .tab')).map(t => t.textContent));
    ok('생산 관리 탭: 일별 조립 생산량 · 월별 조립 생산량', tabs.includes('일별 조립 생산량') && tabs.includes('월별 조립 생산량'), tabs);
    const dailyTot = await A.evaluate(() => { const t = document.querySelector('main table.tbl'); const tr = t && Array.from(t.querySelectorAll('tbody tr')).pop(); return tr ? tr.lastChild.textContent : null; });   // 첫 표 = 날짜별 표, 마지막 줄 = 월 합계
    await A.evaluate(() => { ERP.state.prodTab = 'monthly'; ERP.render(); }); await A.waitForTimeout(900);
    const mt = await A.evaluate(() => { const ref = ERP.calc.latestProdDate(); const trs = Array.from(document.querySelectorAll('main table.tbl tbody tr'));
      return { h2: document.querySelector('main .card h2').textContent, n: trs.length, month: trs[+ref.slice(5, 7) - 1] ? trs[+ref.slice(5, 7) - 1].lastChild.textContent : null, year: ref.slice(0, 4), chart: !!document.querySelector('main canvas'), kpi: document.querySelector('main .kpis').innerText }; });
    ok('월별 조립 생산량 탭: 1~12월 + 연 합계 · 제목 · 막대 · 연 생산량 · 가장 많은 달', mt.n === 13 && mt.h2 === '월별 조립 생산량 · ' + mt.year && mt.chart && /가장 많은 달/.test(mt.kpi) && mt.kpi.includes(mt.year + '년 조립 생산량'), mt);
    eq('이 달 칸 = 일별 조립 생산량 탭의 월 합계', num(mt.month), num(dailyTot));
    ok('연 합계 = 그해 조립 합', await A.evaluate((s) => Number(Array.from(document.querySelectorAll('main table.tbl tbody tr')).pop().lastChild.textContent.replace(/[^\d]/g, '')) === s, d.sum));
    await A.selectOption('main .toolbar select:nth-of-type(2)', 'INJ'); await A.waitForTimeout(800);
    ok('공정을 바꾸면 탭 이름 · 제목도 (월별 사출 생산량)', await A.evaluate(() => Array.from(document.querySelectorAll('.tabs .tab')).some(t => t.textContent === '월별 사출 생산량') && /월별 사출 생산량/.test(document.querySelector('main .card h2').textContent)));
    await A.evaluate(() => { ERP.state.pmon = null; ERP.setLang('vi'); }); await A.waitForTimeout(500);
    const vi = await A.evaluate(() => document.querySelector('main').innerText);
    ok('베트남어 · null 없음', /theo tháng/.test(vi) && !/\bnull\b|undefined/.test(vi));
    await A.evaluate(() => ERP.setLang('ko'));
    // 휴대폰: 요약 · 화면
    const sumJson = JSON.stringify(await A.evaluate(() => ERP.mobileSummary())); const sm = JSON.parse(sumJson);
    ok('휴대폰 요약: 일별 · 월별 조립 생산량 (품목군별, 숫자 같음)', sm.asmDaily && sm.asmDaily.days.length > 0 && sm.asmDaily.grand === d.sumM && sm.asmMonthly && sm.asmMonthly.total.length === 12 && sm.asmMonthly.grand === d.sum && sm.asmMonthly.divs.length > 0, { ad: sm.asmDaily && sm.asmDaily.grand, am: sm.asmMonthly && sm.asmMonthly.grand, d });
    const G = gas(); const html = G.c.doGet({ parameter: {} }).getContent().replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1">');
    const ps = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(html); }); await new Promise(r => ps.listen(0, '127.0.0.1', r));
    const P = await browser.newContext(PHONE); const M = await newPage(P);
    await M.addInitScript((data) => { window.google = { script: { run: { withSuccessHandler(ok) { return { withFailureHandler() { return { mobileData() { setTimeout(() => ok({ ok: true, data }), 10); } }; } }; } } } }; }, sumJson);
    await M.goto('http://127.0.0.1:' + ps.address().port + '/'); await M.fill('input[type=password]', 'secret12'); await M.click('button.btn.p'); await M.waitForTimeout(500);
    const ph = await M.evaluate(() => ({ t: document.body.innerText, sw: document.documentElement.scrollWidth, iw: innerWidth }));
    ok('휴대폰 화면: 일별 조립 생산량 · 월별 조립 생산량 표 · 폭 맞음 · null 없음', /일별 조립 생산량/.test(ph.t) && /월별 조립 생산량/.test(ph.t) && ph.t.includes(Number(d.sum).toLocaleString('ko-KR')) && ph.sw <= 391 && !/\bnull\b|undefined|NaN/.test(ph.t), { sw: ph.sw, t: ph.t.slice(0, 200) });
    // 생산 관리 월별 탭도 휴대폰 폭에 맞음
    const Q = await newPage(P); await Q.goto(S5.url + '/#/production'); await ready(Q); await Q.evaluate(() => { ERP.state.prodTab = 'monthly'; ERP.render(); }); await Q.waitForTimeout(800);
    ok('월별 조립 생산량 탭 휴대폰 폭(390)', (await fits(Q)).sw <= 391, await fits(Q));
    await P.close(); await ctx.close(); ps.close(); S5.close();
  });

  ok('화면 오류 없음', !errors.length, errors.slice(0, 5));
  await browser.close(); S.close(); S0.close(); gh.close();
  console.log('\n' + (fail ? '✗ 실패 ' + fail + '건' : '✓ 모두 통과') + '  (통과 ' + pass + ' / 전체 ' + (pass + fail) + ')');
  if (fail) { console.log('실패 목록:'); failures.forEach(f => console.log(' - ' + f)); }
  process.exit(fail ? 1 : 0);
})();
