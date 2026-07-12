// Electron masaüstü sarmalayıcı.
// Mevcut yapıyı bozmadan: server.js'i ayrı bir süreçte başlatır (web modundaki gibi),
// sonra panoyu native pencerede http://localhost:PORT üzerinden açar.
// Playwright otomasyon tarayıcısı yine ayrı bir pencerede açılır (davranış aynı).
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = process.env.PORT || 4477;
const URL = `http://localhost:${PORT}`;
let serverProc = null;
let win = null;

// server.js'i "Node olarak" çalıştır (ELECTRON_RUN_AS_NODE), böylece ayrı Node kurulumu gerekmez.
function startServer() {
  serverProc = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: __dirname,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT) },
    stdio: 'inherit'
  });
  serverProc.on('exit', (code) => {
    serverProc = null;
    if (code && code !== 0) console.error('Sunucu süreci kapandı, kod:', code);
  });
}

// Sunucu ayağa kalkana kadar bekle, sonra pencereyi yükle.
function waitForServer(cb, tries = 0) {
  http.get(URL, () => cb()).on('error', () => {
    if (tries > 80) return cb(); // ~24 sn sonra yine de dene
    setTimeout(() => waitForServer(cb, tries + 1), 300);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 900,
    title: 'X Otomasyon',
    autoHideMenuBar: true,
    backgroundColor: '#0d1117',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.loadURL(URL);
  // Dış bağlantıları sistem tarayıcısında aç (pano içinde değil).
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  startServer();
  waitForServer(createWindow);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Pencere kapanınca uygulamadan çık ve sunucu sürecini durdur.
app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', () => { if (serverProc) { try { serverProc.kill(); } catch { /* yoksay */ } } });
