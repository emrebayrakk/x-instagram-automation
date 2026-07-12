// X Otomasyon - yerel sunucu. Dashboard'u sunar, WebSocket ile canli log akitir,
// Playwright otomasyon dongulerini baslatir/durdurur.
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { bus, loadSettings, saveSettings, stats, getDaily, log, tl } from './src/state.js';
import { locales, SUPPORTED, LANG_NAMES } from './src/locales.js';
import { ensureBrowser, closeBrowser, openLogin, checkLogin, getPage, isOpen } from './src/browser.js';
import { runLiker } from './src/liker.js';
import { runUnfollower } from './src/unfollower.js';
import { runFollower } from './src/follower.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4477;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ---- WebSocket yayini ----
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}
bus.on('log', (e) => broadcast('log', e));
bus.on('stats', (s) => broadcast('stats', s));

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'stats', data: { ...stats } }));
  ws.send(JSON.stringify({ type: 'hello', data: {} }));
});

// ---- Otomasyon kontrol durumu ----
const likeControl = { running: false };
const unfollowControl = { running: false };
const followControl = { running: false };
let loginState = { loggedIn: false, username: '' };

// ---- API ----
app.get('/api/status', (req, res) => {
  res.json({
    browserOpen: isOpen(),
    loggedIn: loginState.loggedIn,
    username: loginState.username,
    likeRunning: likeControl.running,
    unfollowRunning: unfollowControl.running,
    followRunning: followControl.running,
    stats: { ...stats },
    daily: getDaily()
  });
});

app.get('/api/settings', (req, res) => res.json(loadSettings()));

// Arayüz çevirileri (yalnızca ui bölümü) + dil listesi.
app.get('/api/locales', (req, res) => {
  const ui = {};
  for (const l of SUPPORTED) ui[l] = locales[l].ui;
  res.json({ supported: SUPPORTED, names: LANG_NAMES, ui });
});

app.post('/api/settings', (req, res) => {
  const saved = saveSettings(req.body);
  res.json(saved);
});

app.post('/api/login', async (req, res) => {
  try {
    await openLogin();
    res.json({ ok: true });
  } catch (e) {
    log('error', tl('loginOpenErr', { e: e.message }));
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/refresh', async (req, res) => {
  try {
    if (!isOpen()) await ensureBrowser(loadSettings().general.headless);
    loginState = await checkLogin();
    if (loginState.loggedIn) {
      log('ok', tl('loginOk', { u: loginState.username || '?' }));
      // Kullanıcı adını otomatik doldur
      if (loginState.username) {
        const s = loadSettings();
        if (!s.general.username) { s.general.username = loginState.username; saveSettings(s); }
      }
    } else {
      log('warn', tl('loginNotFound'));
    }
    res.json(loginState);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/browser/close', async (req, res) => {
  likeControl.running = false;
  unfollowControl.running = false;
  followControl.running = false;
  await closeBrowser();
  loginState = { loggedIn: false, username: '' };
  res.json({ ok: true });
});

// --- Begeni ---
app.post('/api/like/start', async (req, res) => {
  if (likeControl.running) return res.json({ ok: false, error: tl('errAlready') });
  const page = getPage();
  if (!page || !loginState.loggedIn) return res.status(400).json({ ok: false, error: tl('errLoginFirst') });
  likeControl.running = true;
  broadcastStatus();
  runLiker(page, loadSettings(), likeControl)
    .catch((e) => log('error', tl('likeCrash', { e: e.message })))
    .finally(() => { likeControl.running = false; broadcastStatus(); });
  res.json({ ok: true });
});

app.post('/api/like/stop', (req, res) => {
  likeControl.running = false;
  log('warn', tl('likeStopping'));
  res.json({ ok: true });
});

// --- Takipten cikma ---
app.post('/api/unfollow/start', async (req, res) => {
  if (unfollowControl.running) return res.json({ ok: false, error: tl('errAlready') });
  const page = getPage();
  if (!page || !loginState.loggedIn) return res.status(400).json({ ok: false, error: tl('errLoginFirst') });
  unfollowControl.running = true;
  broadcastStatus();
  runUnfollower(page, loadSettings(), unfollowControl)
    .catch((e) => log('error', tl('unfollowCrash', { e: e.message })))
    .finally(() => { unfollowControl.running = false; broadcastStatus(); });
  res.json({ ok: true });
});

app.post('/api/unfollow/stop', (req, res) => {
  unfollowControl.running = false;
  log('warn', tl('unfollowStopping'));
  res.json({ ok: true });
});

// --- Takip etme ---
app.post('/api/follow/start', async (req, res) => {
  if (followControl.running) return res.json({ ok: false, error: tl('errAlready') });
  const page = getPage();
  if (!page || !loginState.loggedIn) return res.status(400).json({ ok: false, error: tl('errLoginFirst') });
  followControl.running = true;
  broadcastStatus();
  runFollower(page, loadSettings(), followControl)
    .catch((e) => log('error', tl('followCrash', { e: e.message })))
    .finally(() => { followControl.running = false; broadcastStatus(); });
  res.json({ ok: true });
});

app.post('/api/follow/stop', (req, res) => {
  followControl.running = false;
  log('warn', tl('followStopping'));
  res.json({ ok: true });
});

function broadcastStatus() {
  broadcast('status', {
    browserOpen: isOpen(),
    loggedIn: loginState.loggedIn,
    username: loginState.username,
    likeRunning: likeControl.running,
    unfollowRunning: unfollowControl.running,
    followRunning: followControl.running
  });
}

server.listen(PORT, () => {
  console.log(`\n  X Otomasyon calisiyor:  http://localhost:${PORT}\n`);
  log('info', tl('serverStarted', { port: PORT }));
});
