'use strict';
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const server = require('../server.js');

let win = null; let info = null;
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
function readCfg() { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch (e) { return { lan: false, port: 3210 }; } }
function writeCfg(c) { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2)); }

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    const cfg = readCfg();
    info = await server.start({
      dataDir: path.join(app.getPath('userData'), 'data'),
      appDir: path.join(__dirname, '..', 'app'),
      host: cfg.lan ? '0.0.0.0' : '127.0.0.1',
      port: cfg.port || 3210,
    });
    buildMenu(cfg);
    win = new BrowserWindow({ width: 1480, height: 920, minWidth: 1100, minHeight: 700, backgroundColor: '#F2F3F5',
      title: 'ERP', autoHideMenuBar: false, webPreferences: { contextIsolation: true, sandbox: true } });
    win.loadURL(info.url);
    // 바깥 링크는 기본 브라우저로 — http/https 만 (file:// · 다른 프로그램 주소는 열지 않음), ERP 창은 ERP 주소에서 벗어나지 않음
    const openOut = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
    win.webContents.setWindowOpenHandler(({ url }) => { openOut(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => { if (url !== info.url && !url.startsWith(info.url + '/')) { e.preventDefault(); openOut(url); } });
    // 닫기 전에 화면에서 대기 중인 저장(0.7초)을 먼저 보낸다 → 마지막 입력이 사라지지 않게
    let flushed = false;
    win.on('close', (e) => { if (flushed) return; e.preventDefault(); flushRenderer().then(() => { flushed = true; if (win && !win.isDestroyed()) win.close(); }); });
    win.on('closed', () => { win = null; });
  });
  app.on('window-all-closed', () => { if (info) info.close(); app.quit(); });
}

/** 화면(ERP.db)에서 대기 중인 저장을 보내고 끝날 때까지 기다린다 (최대 5초) */
async function flushRenderer() {
  if (!win || win.isDestroyed()) return;
  try { await Promise.race([win.webContents.executeJavaScript('(window.ERP && ERP.db && ERP.db.flush) ? ERP.db.flush() : 0', true), new Promise(r => setTimeout(r, 5000))]); } catch (e) { /* 화면이 이미 닫힘 */ }
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
          await flushRenderer(); app.relaunch(); app.exit(0);
        } },
      { label: '자동 백업 폴더 고르기… / Chọn thư mục sao lưu…', click: async () => {
          const r = await dialog.showOpenDialog(win, { title: '매일 자동 백업 폴더 / Thư mục sao lưu hằng ngày', properties: ['openDirectory', 'createDirectory'], defaultPath: info.backup.cfg().dir || undefined });
          if (r.canceled || !r.filePaths[0]) return;
          try { info.backup.set({ dir: r.filePaths[0] }); } catch (e) { await dialog.showMessageBox({ type: 'error', message: '이 폴더에 쓸 수 없습니다 / Không ghi được vào thư mục này\n' + e.message }); return; }
          const res = await info.backup.run();
          await dialog.showMessageBox({ type: res.error ? 'warning' : 'info', message: res.error ? '백업 실패 / Sao lưu thất bại\n' + res.error : '매일 이 폴더에 백업합니다 (방금 1회 저장).\nSao lưu mỗi ngày vào thư mục này (vừa lưu 1 lần).\n\n' + res.file });
          if (win && !win.isDestroyed()) win.webContents.executeJavaScript("(location.hash.indexOf('settings') >= 0 && window.ERP && ERP.refresh) ? ERP.refresh() : 0", true).catch(() => {});
        } },
      { type: 'separator' }, { role: 'quit', label: '종료 / Thoát' } ] },
    { label: '보기 / Xem', submenu: [ { role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'toggleDevTools' } ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}
