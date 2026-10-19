'use strict';
/* 10차(v1.5.0) Electron 실행 시험 (Linux + Xvfb): 설치형과 같은 electron/main.js 로 띄워서
   서버가 Electron 안에서 뜨는지 · 화면이 서버 모드로 열리는지 · 바깥 주소 이동과 팝업을 막는지 · X 버튼으로 닫을 때 대기 중인 저장을 보내고 끝나는지 확인한다.
   준비:  node node_modules/electron/install.js   (Linux 용 Electron 실행 파일 받기 — npm ci 를 ELECTRON_SKIP_BINARY_DOWNLOAD=1 로 했을 때)
   사용:  npm run test:electron      (xvfb-run 과 Playwright 필요 · Electron 을 올릴 때마다 돌린다) */
const { spawn } = require('child_process'); const path = require('path'); const fs = require('fs'); const os = require('os');
let pw; try { pw = require('playwright'); } catch (e) { try { pw = require('playwright-core'); } catch (e2) { console.error('Playwright가 필요합니다 / cần Playwright'); process.exit(2); } }
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail).slice(0, 300) : '')); } };

(async () => {
  const bin = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');
  if (!fs.existsSync(bin)) { console.error('Electron 실행 파일이 없습니다: node node_modules/electron/install.js'); process.exit(2); }
  const want = require(path.join(ROOT, 'package.json')).version, elVer = require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-electron-'));
  const env = Object.assign({}, process.env, { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), ELECTRON_ENABLE_LOGGING: '1' });
  const dport = 9400 + Math.floor(Math.random() * 500), iport = dport + 600;
  const el = spawn('xvfb-run', ['-a', bin, '--no-sandbox', '--inspect=' + iport, '--remote-debugging-port=' + dport, ROOT], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = ''; el.stdout.on('data', d => { log += d; }); el.stderr.on('data', d => { log += d; });
  let exited = null; el.on('exit', (c, s) => { exited = { c, s }; });
  let edit = null;
  try {
    let browser = null;
    for (let i = 0; i < 60 && !browser; i++) { await sleep(1000); try { browser = await pw.chromium.connectOverCDP('http://127.0.0.1:' + dport); } catch (e) { /* 아직 */ } }
    if (!browser) throw new Error('Electron 창에 연결하지 못함');
    const ctx = browser.contexts()[0]; let page = ctx.pages()[0];
    for (let i = 0; i < 60 && !page; i++) { await sleep(500); page = ctx.pages()[0]; }
    await page.waitForFunction(() => window.ERP && ERP.db && ERP.db.ready && document.querySelector('.side'), null, { timeout: 120000 });
    console.log('■ Electron ' + elVer + ' · ERP ' + want);
    const st = await page.evaluate(() => ({ v: ERP.v, mode: ERP.db.mode, loop: ERP.db.ping && ERP.db.ping.loopback, po: ERP.db.rows('po').length, ua: navigator.userAgent }));
    ok('서버가 Electron 안에서 뜨고 화면이 서버 모드 · 이 PC(loopback)', st.mode === 'server' && st.loop === true && st.po > 0, st);
    ok('화면 버전 = package.json · Electron 버전', st.v === want && st.ua.includes('Electron/' + elVer), st);
    const url0 = page.url();
    await page.evaluate(() => { location.href = 'https://example.com/'; }); await sleep(1500);
    ok('ERP 창은 바깥 주소로 이동하지 않음', page.url() === url0, page.url());
    const n0 = ctx.pages().length; await page.evaluate(() => { window.open('file:///etc/passwd'); window.open('https://example.com/'); }); await sleep(1500);
    ok('팝업 창은 열리지 않음 (http/https 는 기본 브라우저로)', ctx.pages().length === n0, ctx.pages().length);
    // 0.7초 대기 중인 저장이 있는 상태에서 X 버튼처럼 닫기 (메인 프로세스의 BrowserWindow.close)
    edit = await page.evaluate(() => { const r = ERP.db.rows('po').find(x => x.po_no); ERP.db.update('po', r._id, { remarks: 'electron-close-flush' }); return r._id; });
    await page.evaluate(() => { window.addEventListener('beforeunload', () => { console.log('PENDING_AT_UNLOAD=' + ERP.db.hasPending()); }, true); });
    const list = await (await fetch('http://127.0.0.1:' + iport + '/json/list')).json();
    const ws = new WebSocket(list[0].webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: "process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].close(); 'closing'" } }));
    await new Promise(res => { ws.onmessage = res; setTimeout(res, 3000); });
    ws.close(); await browser.close().catch(() => {});
    for (let i = 0; i < 30 && !exited; i++) await sleep(500);
  } catch (e) { ok('실행 중 예외 없음', false, String(e && e.message || e)); }
  if (!exited) { try { process.kill(-el.pid, 'SIGTERM'); } catch (e) { /* 이미 끝남 */ } for (let i = 0; i < 10 && !exited; i++) await sleep(500); }
  try { process.kill(-el.pid, 'SIGKILL'); } catch (e) { /* 이미 끝남 */ }
  ok('닫으면 프로그램이 정상 종료 (코드 0)', exited && exited.c === 0, exited);
  ok('닫기 전에 대기 중인 저장을 모두 보냄', /PENDING_AT_UNLOAD=false/.test(log), (log.match(/PENDING_AT_UNLOAD=\w+/) || ['없음'])[0]);
  let saved = false; try { saved = JSON.parse(fs.readFileSync(path.join(home, '.config', 'ColorPencil ERP', 'data', 'tables', 'po.json'), 'utf8')).some(r => r._id === edit && r.remarks === 'electron-close-flush'); } catch (e) { /* 없음 */ }
  ok('닫기 직전에 고친 내용이 데이터 폴더에 저장됨', saved);
  const bad = log.split('\n').filter(l => /Uncaught|TypeError|ReferenceError|deprecat/i.test(l));
  ok('화면 · 메인 오류 없음', !bad.length, bad.slice(0, 5));
  console.log('\n' + (fail ? '✗ 실패 ' + fail + '개' : '✓ 모두 통과') + '  (통과 ' + pass + ' / 전체 ' + (pass + fail) + ')');
  process.exit(fail ? 1 : 0);
})();
