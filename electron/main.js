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
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
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
          await dialog.showMessageBox({ message: c.lan ? '다음 실행부터 같은 네트워크의 PC에서 접속할 수 있습니다.\nLAN access ON after restart.' : 'LAN access OFF after restart.' });
          await flushRenderer(); app.relaunch(); app.exit(0);
        } },
      { type: 'separator' }, { role: 'quit', label: '종료 / Thoát' } ] },
    { label: '보기 / Xem', submenu: [ { role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'toggleDevTools' } ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}
