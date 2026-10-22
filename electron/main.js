'use strict';
const { app, BrowserWindow, Menu, shell, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const server = require('../server.js');
const updater = require('./updater.js');

// 시험용: 실제 데이터와 따로 띄운다 (자동 업데이트 시험 · tools/update_e2e.js). 보통은 %APPDATA%\ColorPencil ERP
if (process.env.ERP_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.ERP_USER_DATA_DIR));

let win = null; let info = null; let up = null;
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
function readCfg() { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch (e) { return { lan: false, port: 3210 }; } }
function writeCfg(c) { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2)); }

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    const cfg = readCfg(); const ud = app.getPath('userData');
    // 15차: 자동 업데이트 — 설치형(Windows)에서만 설치한다. 개발 실행(npm start)은 확인 · 받기까지만
    up = updater.create({ version: app.getVersion(), dir: path.join(ud, 'update'), backupDir: path.join(ud, 'update_backup'), dataDir: path.join(ud, 'data'),
      installDir: app.isPackaged && process.platform === 'win32' ? path.dirname(process.execPath) : null,
      fetch: (url, init) => net.fetch(url, init), spawn, auto: cfg.autoUpdate !== false,
      saveAuto: (v) => { const c = readCfg(); c.autoUpdate = v; writeCfg(c); buildMenu(readCfg()); },
      base: process.env.ERP_UPDATE_BASE || undefined, firstCheck: process.env.ERP_UPDATE_FIRST_CHECK ? Number(process.env.ERP_UPDATE_FIRST_CHECK) : undefined,
      beforeInstall: () => flushAll(), quit: () => { if (info) info.close(); app.exit(0); }, log: (m) => console.log('[update] ' + m) });
    // 받아 둔 새 버전이 있으면 ERP 를 띄우기 전에 설치한다 (설치 프로그램이 끝나면 새 버전을 다시 켠다)
    if (up.startup()) { app.exit(0); return; }
    info = await server.start({
      dataDir: path.join(ud, 'data'),
      appDir: path.join(__dirname, '..', 'app'),
      host: cfg.lan ? '0.0.0.0' : '127.0.0.1',
      port: cfg.port || 3210,
      // AI · 구글 호출은 Chromium 네트워크(net.fetch)로 → Windows 의 회사 프록시 · 인증서 설정을 그대로 따른다
      fetch: (url, init) => net.fetch(url, init),
      update: up,
    });
    buildMenu(cfg);
    win = new BrowserWindow({ width: 1480, height: 920, minWidth: 1100, minHeight: 700, backgroundColor: '#F2F3F5',
      title: 'ERP', autoHideMenuBar: false, webPreferences: { contextIsolation: true, sandbox: true } });
    win.loadURL(info.url);
    // 바깥 링크는 기본 브라우저로 — http/https 만 (file:// · 다른 프로그램 주소는 열지 않음), ERP 창은 ERP 주소에서 벗어나지 않음
    const openOut = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
    win.webContents.setWindowOpenHandler(({ url }) => { openOut(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, legacyUrl) => { const url = String((e && e.url) || legacyUrl || ''); if (url !== info.url && !url.startsWith(info.url + '/')) { e.preventDefault(); openOut(url); } });
    // 닫기 전에 화면에서 대기 중인 저장(0.7초)을 먼저 보낸다 → 마지막 입력이 사라지지 않게 (18차: 구글 드라이브 공유가 켜져 있으면 구글에도)
    let flushed = false;
    win.on('close', (e) => { if (flushed) return; e.preventDefault(); flushAll().then(() => { flushed = true; if (win && !win.isDestroyed()) win.close(); }); });
    win.on('closed', () => { win = null; });
    up.schedule();
  });
  app.on('window-all-closed', () => { if (up) up.stop(); if (info) info.close(); app.quit(); });
}

/** 화면(ERP.db)에서 대기 중인 저장을 보내고 끝날 때까지 기다린다 (최대 5초) */
async function flushRenderer() {
  if (!win || win.isDestroyed()) return;
  try { await Promise.race([win.webContents.executeJavaScript('(window.ERP && ERP.db && ERP.db.flush) ? ERP.db.flush() : 0', true), new Promise(r => setTimeout(r, 5000))]); } catch (e) { /* 화면이 이미 닫힘 */ }
}

/** 18차: 화면 저장 → 구글 드라이브 공유 (켜져 있고 아직 보내지 않은 변경이 있으면, 최대 15초) */
async function flushAll() {
  await flushRenderer();
  if (!info || !info.cloud || !info.cloud.pending()) return;
  if (win && !win.isDestroyed()) win.webContents.executeJavaScript("window.ERP && ERP.toast && ERP.toast(L('구글 드라이브에 보내는 중… (공유)', 'Đang gửi lên Google Drive…'), 'info')", true).catch(() => {});
  try { await info.cloud.flush(15000); } catch (e) { /* 다음에 켤 때 보냄 */ }
}

/** 메뉴 → 업데이트 확인: 새 버전이 있으면 받기를 시작하고, 받아 둔 것이 있으면 지금 설치할지 묻는다 */
async function checkDialog() {
  const s = await Promise.race([up.check(), new Promise(r => setTimeout(() => r(up.status()), 15000))]);
  const pct = Math.round((s.progress || 0) * 100);
  if (s.state === 'ready' && s.ready) {
    const r = await dialog.showMessageBox(win, { type: 'info', buttons: ['지금 업데이트 / Cập nhật ngay', '나중에 / Để sau'], defaultId: 0, cancelId: 1,
      message: '새 버전 ' + s.ready.version + ' 을 받아 두었습니다 (지금 ' + s.current + ').\nĐã tải bản mới ' + s.ready.version + '.',
      detail: '지금 업데이트하면 ERP 가 닫히고 설치가 끝나면 새 버전으로 다시 켜집니다. 나중에 하면 다음에 ERP 를 켤 때 설치합니다.\nCập nhật ngay: ERP đóng lại và mở lại bản mới sau khi cài. Để sau: cài khi mở ERP lần sau.' });
    if (r.response === 0) { try { await up.installNow(); } catch (e) { await dialog.showMessageBox(win, { type: 'error', message: e.message }); } }
    return;
  }
  const text = s.state === 'latest' ? '최신 버전입니다 (' + s.current + ').\nĐang dùng bản mới nhất.'
    : s.state === 'none' ? '아직 GitHub 에 업데이트 정보(Release)가 없습니다. 지금 ' + s.current + '.\nChưa có thông tin cập nhật.'
      : s.state === 'downloading' ? '새 버전 ' + s.latest + ' 을 받는 중입니다 (' + pct + '%). 다 받으면 다음에 켤 때 설치합니다.\nĐang tải bản mới ' + s.latest + ' (' + pct + '%).'
        : '업데이트를 확인하지 못했습니다 / Không kiểm tra được cập nhật\n' + (s.error || s.state);
  await dialog.showMessageBox(win, { type: s.state === 'error' ? 'warning' : 'info', message: text });
}

function buildMenu(cfg) {
  const tpl = [
    { label: 'ERP', submenu: [
      { label: '데이터 폴더 열기 / Mở thư mục dữ liệu', click: () => shell.openPath(info.dataDir) },
      { label: cfg.lan ? '사내망 접속 끄기 (재시작) / Tắt LAN' : '사내망 접속 켜기 (재시작) / Bật LAN (khởi động lại)', click: async () => {
          const c = readCfg(); c.lan = !c.lan; writeCfg(c);
          // 9차: 다른 PC 는 PIN 을 넣어야 들어온다 (PIN 이 없으면 아무도 못 들어옴)
          const pinMsg = info.hasPin() ? '\n\n다른 PC 의 브라우저는 처음 한 번 PIN 을 넣어야 합니다.\nMáy khác phải nhập mã PIN một lần.'
            : '\n\n아직 PIN 이 없습니다. 재시작 뒤 설정 → 사내망 접속 · 자동 백업에서 PIN 을 정해야 다른 PC 가 들어올 수 있습니다.\nChưa có mã PIN. Sau khi khởi động lại, hãy đặt PIN ở Cài đặt → Mạng nội bộ · Sao lưu thì máy khác mới vào được.';
          await dialog.showMessageBox({ message: c.lan ? '다음 실행부터 같은 네트워크의 PC에서 접속할 수 있습니다.\nLAN access ON after restart.' + pinMsg : 'LAN access OFF after restart.' });
          await flushAll(); app.relaunch(); app.exit(0);
        } },
      { label: '자동 백업 폴더 고르기… / Chọn thư mục sao lưu…', click: async () => {
          const r = await dialog.showOpenDialog(win, { title: '매일 자동 백업 폴더 / Thư mục sao lưu hằng ngày', properties: ['openDirectory', 'createDirectory'], defaultPath: info.backup.cfg().dir || undefined });
          if (r.canceled || !r.filePaths[0]) return;
          try { info.backup.set({ dir: r.filePaths[0] }); } catch (e) { await dialog.showMessageBox({ type: 'error', message: '이 폴더에 쓸 수 없습니다 / Không ghi được vào thư mục này\n' + e.message }); return; }
          const res = await info.backup.run();
          await dialog.showMessageBox({ type: res.error ? 'warning' : 'info', message: res.error ? '백업 실패 / Sao lưu thất bại\n' + res.error : '매일 이 폴더에 백업합니다 (방금 1회 저장).\nSao lưu mỗi ngày vào thư mục này (vừa lưu 1 lần).\n\n' + res.file });
          if (win && !win.isDestroyed()) win.webContents.executeJavaScript("(location.hash.indexOf('settings') >= 0 && window.ERP && ERP.refresh) ? ERP.refresh() : 0", true).catch(() => {});
        } },
      { type: 'separator' },
      // 15차: 자동 업데이트
      { label: '업데이트 확인… / Kiểm tra cập nhật…', click: () => checkDialog().catch(() => {}) },
      { label: '자동 업데이트 / Tự động cập nhật', type: 'checkbox', checked: cfg.autoUpdate !== false, click: (mi) => up.setAuto(mi.checked) },
      { label: 'ColorPencil ERP ' + app.getVersion(), enabled: false },
      { type: 'separator' }, { role: 'quit', label: '종료 / Thoát' } ] },
    { label: '보기 / Xem', submenu: [ { role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'toggleDevTools' } ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}
