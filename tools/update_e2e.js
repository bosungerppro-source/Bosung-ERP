'use strict';
/* 15차(v1.10.0) 자동 업데이트 실제 시험 — Windows (GitHub Actions "자동 업데이트 시험 (Windows)").
   설치 파일 두 개를 만든다: A = package.json 버전, B = A 의 끝자리 + 100. 가짜 업데이트 서버(이 PC 127.0.0.1)가 B 를 내놓는다.
   1 A 를 조용히 설치 → 켜면 B 를 받아 둠 → 닫고 다시 켜면 B 를 설치하고 B 로 다시 켜짐 (다음에 켤 때 설치)
   2 A 를 다시 설치 → 켜서 받아 둔 뒤 [지금 업데이트] (POST /api/update/install) → B 로 다시 켜짐
   3 A 를 다시 설치 → SHA-256 이 틀린 latest.json → 받지 않고 오류, 설치도 하지 않음
   레지스트리(앱 및 기능) · 바로가기를 쓰므로 일하는 PC 에서는 돌리지 않는다 — ERP_E2E_OK=1 일 때만 (워크플로가 넣음).
   필요: Windows, makensis (NSIS 3), npm ci */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
if (process.platform !== 'win32' || process.env.ERP_E2E_OK !== '1') { console.error('Windows CI 에서만 돌립니다 (ERP_E2E_OK=1). 일하는 PC 의 앱 및 기능 · 바로가기를 바꾸기 때문'); process.exit(2); }

const W = 'C:\\erp-e2e', APPDIR = path.join(W, 'Color Pencil App'), UD = path.join(W, 'userdata'), PORT = 3299, UPORT = 8099;
const EXE = path.join(APPDIR, 'ColorPencil ERP.exe');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const failures = [];
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 700 ? s.slice(0, 700) + '…' : s; };
function ok(name, cond, detail) { if (cond) { pass++; console.log('  ✓ ' + name); return true; } fail++; const line = name + (detail !== undefined ? '  → ' + short(detail) : ''); failures.push(line); console.log('  ✗ ' + line); return false; }
async function sec(t, fn) { console.log('\n■ ' + t); try { await fn(); } catch (e) { ok(t + ' — 예외', false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); } }
const run = (cmd, args) => { console.log('$ ' + cmd + ' ' + args.join(' ')); const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd: ROOT }); if (r.status !== 0) throw new Error(cmd + ' 실패 (' + r.status + ')'); };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// ---------------------------------------------------------------- 설치 파일 두 개
const pkgFile = path.join(ROOT, 'package.json'), pkgText = fs.readFileSync(pkgFile, 'utf8');
const A = JSON.parse(pkgText).version; const [ma, mi, pa] = A.split('.').map(Number); const B = ma + '.' + mi + '.' + (pa + 100);
function build(ver) {
  const p = JSON.parse(pkgText); p.version = ver; fs.writeFileSync(pkgFile, JSON.stringify(p, null, 2) + '\n');
  try {
    fs.rmSync(path.join(ROOT, 'dist', 'win-unpacked'), { recursive: true, force: true });
    run('npx', ['electron-builder', '--win', 'dir', '--x64']);
    run('makensis', ['-DVERSION=' + ver, 'build\\installer.nsi']);
  } finally { fs.writeFileSync(pkgFile, pkgText); }
  const src = path.join(ROOT, 'dist', 'ColorPencil-ERP-Setup-' + ver + '.exe'), dst = path.join(W, 'setup', path.basename(src));
  fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); return dst;
}

// ---------------------------------------------------------------- 가짜 업데이트 서버 (GitHub 처럼 latest → 버전 주소로 넘김)
function updServer(ver, file, opt) {
  const name = path.basename(file), size = fs.statSync(file).size, digest = (opt && opt.badSha) ? '0'.repeat(64) : sha(file); const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/releases/latest/download/latest.json') { res.writeHead(302, { Location: '/releases/download/v' + ver + '/latest.json' }); return res.end(); }
    if (req.url === '/releases/download/v' + ver + '/latest.json') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(JSON.stringify({ version: ver, file: name, sha256: digest, size })); }
    if (req.url === '/releases/download/v' + ver + '/' + name) { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size }); return fs.createReadStream(file).pipe(res); }
    res.writeHead(404); res.end('not found');
  });
  return new Promise(r => srv.listen(UPORT, '127.0.0.1', () => r({ hits, close: () => new Promise(c => srv.close(() => c())) })));
}

// ---------------------------------------------------------------- 설치 · 실행 · 닫기
function installSilent(setup) {
  // /D= 는 맨 끝 · 따옴표 없이 (NSIS) — 설치 폴더 이름에 빈칸이 있어도 되는지 같이 본다
  const r = spawnSync(setup, ['/S', '/D=' + APPDIR], { windowsVerbatimArguments: true, argv0: '"' + setup + '"', stdio: 'inherit', timeout: 600000 });
  if (r.status !== 0) throw new Error('조용한 설치 실패 ' + r.status);
}
const ENV = Object.assign({}, process.env, { ERP_USER_DATA_DIR: UD, ERP_UPDATE_BASE: 'http://127.0.0.1:' + UPORT + '/releases', ERP_UPDATE_FIRST_CHECK: '1500', ELECTRON_ENABLE_LOGGING: '1' });
function launch() { const c = spawn(EXE, [], { env: ENV, detached: true, stdio: 'ignore' }); c.unref(); }
const running = () => /ColorPencil ERP\.exe/i.test(String(spawnSync('tasklist', ['/FI', 'IMAGENAME eq ColorPencil ERP.exe', '/NH'], { encoding: 'utf8' }).stdout || ''));
async function waitExit(ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (!running()) return true; await sleep(500); } return false; }
async function closeApp(force) {
  spawnSync('taskkill', force ? ['/F', '/T', '/IM', 'ColorPencil ERP.exe'] : ['/IM', 'ColorPencil ERP.exe'], { stdio: 'ignore' });   // /F 없음 = 창 닫기 (사용자가 X 누른 것과 같음)
  if (await waitExit(30000)) return true;
  if (!force) { spawnSync('taskkill', ['/F', '/T', '/IM', 'ColorPencil ERP.exe'], { stdio: 'ignore' }); await waitExit(15000); }
  return false;
}
async function api(p, method) {
  try { const r = await fetch('http://127.0.0.1:' + PORT + p, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: method ? '{}' : undefined, signal: AbortSignal.timeout(10000) }); return { code: r.status, j: await r.json().catch(() => ({})) }; } catch (e) { return null; }
}
async function waitStatus(fn, ms, label) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < ms) { const r = await api('/api/update'); if (r && r.code === 200) { last = r.j; if (fn(r.j)) return r.j; } await sleep(1000); }
  throw new Error(label + ' 기다리다 시간 초과 · 마지막 상태 ' + short(last));
}
const regVer = () => { const o = String(spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ColorPencilERP', '/v', 'DisplayVersion'], { encoding: 'utf8' }).stdout || ''); const m = o.match(/DisplayVersion\s+REG_SZ\s+(\S+)/); return m ? m[1] : null; };
const backups = () => { try { return fs.readdirSync(path.join(UD, 'update_backup')).sort(); } catch (e) { return []; } };
const updFiles = () => { try { return fs.readdirSync(path.join(UD, 'update')).sort(); } catch (e) { return []; } };
const logText = () => { try { return fs.readFileSync(path.join(UD, 'update', 'update.log'), 'utf8'); } catch (e) { return ''; } };

(async () => {
  console.log('■ 설치 파일 만들기: A ' + A + ' · B ' + B);
  fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W, { recursive: true });
  const setupA = build(A), setupB = build(B);
  ok('설치 파일 A · B', fs.existsSync(setupA) && fs.existsSync(setupB), [setupA, setupB]);
  // 시험용 데이터 (업데이트 뒤에도 남는지 · 설치 전에 복사되는지). 이미 쓰던 ERP 처럼 — seeded 표시가 없으면 처음 켤 때 예시 자료로 바뀐다
  fs.mkdirSync(path.join(UD, 'data', 'tables'), { recursive: true });
  fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ lan: false, port: PORT }));
  const t0 = '2026-10-01T00:00:00.000Z'; fs.writeFileSync(path.join(UD, 'data', 'meta.json'), JSON.stringify({ seeded: t0, v6: t0, v11: t0 }));
  fs.writeFileSync(path.join(UD, 'data', 'tables', 'po.json'), JSON.stringify([{ _id: 'e2e1', po_no: 'E2E-PO-1', due: '2099-01-01', pcs: 1, sets: 1 }]));
  const poKept = () => { try { return JSON.parse(fs.readFileSync(path.join(UD, 'data', 'tables', 'po.json'), 'utf8')).some(r => r.po_no === 'E2E-PO-1'); } catch (e) { return false; } };
  let srv = null;

  await sec('1. 받아 두었다가 다음에 켤 때 설치', async () => {
    installSilent(setupA);
    ok('A 조용한 설치 (빈칸 있는 폴더)', fs.existsSync(EXE) && regVer() === A, { exe: fs.existsSync(EXE), reg: regVer() });
    srv = await updServer(B, setupB);
    launch();
    const s1 = await waitStatus(s => s.state === 'ready' || s.state === 'error', 240000, 'B 받기');
    ok('A 가 켜져서 B 를 받아 둠', s1.current === A && s1.state === 'ready' && s1.ready && s1.ready.version === B && s1.canInstall === true, s1);
    ok('GitHub 처럼 latest → 버전 주소로 넘어가 받음', srv.hits.includes('/releases/latest/download/latest.json') && srv.hits.some(u => u.endsWith('.exe')), srv.hits);
    ok('닫기 (창 닫기)', await closeApp(false));
    launch();   // 다음에 켤 때 → 설치 프로그램(/UPDATE) → B 로 다시 켜짐
    const s2 = await waitStatus(s => s.current === B, 420000, 'B 로 다시 켜짐');
    ok('B 로 다시 켜짐 · 앱 및 기능 버전 = B', s2.current === B && regVer() === B, { s2, reg: regVer() });
    ok('업데이트 기록 A → B · 방금 업데이트 표시', s2.last && s2.last.from === A && s2.last.to === B && s2.justUpdated && s2.justUpdated.to === B, s2);
    ok('데이터 그대로 + 설치 전 복사본', poKept() && backups().length === 1 && fs.existsSync(path.join(UD, 'update_backup', backups()[0], 'tables', 'po.json')), { kept: poKept(), backups: backups() });
    for (let i = 0; i < 45 && updFiles().some(f => /\.exe$|pending\.json$/.test(f)); i++) await sleep(1000);   // 끝난 설치 프로그램이 닫힌 뒤 지움 (30초 뒤 다시)
    ok('받아 둔 설치 파일 정리', !updFiles().some(f => /\.exe$|pending\.json$/.test(f)), updFiles());
    ok('기록에 설치 · 끝남', /install .*-> ?/.test(logText()) && /updated .* -> /.test(logText()), logText().split('\n').slice(-8));
  });

  await sec('2. [지금 업데이트]', async () => {
    await closeApp(true);
    installSilent(setupA);
    ok('A 로 되돌림', regVer() === A, regVer());
    launch();
    const s1 = await waitStatus(s => s.state === 'ready' || s.state === 'error', 240000, 'B 받기');
    ok('B 를 다시 받아 둠', s1.current === A && s1.state === 'ready', s1);
    const r = await api('/api/update/install', 'POST');
    ok('지금 업데이트 → 200', r && r.code === 200 && r.j.ok === true && r.j.version === B, r);
    const s2 = await waitStatus(s => s.current === B, 420000, 'B 로 다시 켜짐');
    ok('B 로 다시 켜짐 · 앱 및 기능 버전 = B', s2.current === B && regVer() === B, { s2, reg: regVer() });
    ok('데이터 그대로 · 복사본 2개', poKept() && backups().length === 2, backups());
  });

  await sec('3. SHA-256 이 틀리면 받지 않음', async () => {
    await closeApp(true); await srv.close();
    installSilent(setupA);
    srv = await updServer(B, setupB, { badSha: true });
    launch();
    const s1 = await waitStatus(s => s.state === 'error' || s.state === 'ready', 240000, '받기 오류');
    ok('오류 · 받아 둔 것 없음', s1.state === 'error' && /SHA-256/.test(s1.error) && !s1.ready && !updFiles().some(f => /\.exe/.test(f)), { s1, files: updFiles() });
    await closeApp(false); launch();
    await sleep(8000);
    const s2 = await waitStatus(() => true, 60000, '다시 켜짐');
    ok('다시 켜도 A 그대로 (설치 안 함)', s2.current === A && regVer() === A, { s2, reg: regVer() });
  });

  await closeApp(true); if (srv) await srv.close().catch(() => {});
  console.log('\n--- update.log ---\n' + logText().split('\n').slice(-30).join('\n'));
  if (fail) { failures.forEach(f => console.log('::error title=자동 업데이트 시험::' + f.replace(/\r?\n/g, ' '))); console.log('\n✗ 실패 ' + fail + '건  (통과 ' + pass + ' / 전체 ' + (pass + fail) + ')'); }
  else console.log('\n✓ 모두 통과  (통과 ' + pass + ' / 전체 ' + pass + ')');
  process.exit(fail ? 1 : 0);
})();
