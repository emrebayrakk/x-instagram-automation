// Dashboard on yuz: ayarlari yukle/kaydet, WebSocket ile canli log, baslat/durdur.
const $ = (id) => document.getElementById(id);
const api = (url, body) => fetch(url, {
  method: body ? 'POST' : 'GET',
  headers: { 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined
}).then((r) => r.json());

// Alan <-> ayar eslemesi
const FIELDS = {
  general: {
    lang: 'g_language', username: 'g_username', headless: 'g_headless',
    dailyLikeCap: 'g_dailyLikeCap', dailyUnfollowCap: 'g_dailyUnfollowCap',
    dailyFollowCap: 'g_dailyFollowCap'
  },
  like: {
    feed: 'l_feed', maxPerSession: 'l_maxPerSession',
    minDelayMs: 'l_minDelayMs', maxDelayMs: 'l_maxDelayMs',
    skipRetweets: 'l_skipRetweets', skipReplies: 'l_skipReplies', skipPromoted: 'l_skipPromoted'
  },
  unfollow: {
    maxPerSession: 'u_maxPerSession', minDelayMs: 'u_minDelayMs', maxDelayMs: 'u_maxDelayMs',
    onlyNonFollowers: 'u_onlyNonFollowers', whitelist: 'u_whitelist'
  },
  follow: {
    sourceUser: 'f_sourceUser', sourceList: 'f_sourceList', maxPerSession: 'f_maxPerSession',
    gender: 'f_gender', minDelayMs: 'f_minDelayMs', maxDelayMs: 'f_maxDelayMs',
    minBioLength: 'f_minBioLength', requireBio: 'f_requireBio', skipVerified: 'f_skipVerified',
    skipFollowsYou: 'f_skipFollowsYou', bioInclude: 'f_bioInclude', bioExclude: 'f_bioExclude'
  }
};

// Dizi olarak kaydedilecek alanlar (virgülle ayrılmış metin)
const LIST_FIELDS = new Set(['whitelist', 'bioInclude', 'bioExclude']);

// ---- i18n (çok dil) ----
let I18N = {};        // { supported:[], names:{}, ui:{ tr:{...}, en:{...} } }
let LANG = 'tr';      // o anki dil
function tUI(key) {
  const dict = (I18N.ui && I18N.ui[LANG]) || {};
  return dict[key] ?? key;
}
function applyI18n() {
  const dict = (I18N.ui && I18N.ui[LANG]) || {};
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.getAttribute('data-i18n');
    if (dict[k] !== undefined) el.textContent = dict[k];
  });
  document.documentElement.lang = LANG;
}
async function loadLocales() {
  try {
    I18N = await api('/api/locales');
    const sel = $('g_language');
    sel.innerHTML = '';
    for (const l of (I18N.supported || ['tr'])) {
      const o = document.createElement('option');
      o.value = l; o.textContent = (I18N.names && I18N.names[l]) || l;
      sel.appendChild(o);
    }
  } catch { /* sunucu erisilemezse mevcut TR metinleri kalir */ }
}

function setField(el, val) {
  if (el.type === 'checkbox') el.checked = !!val;
  else if (Array.isArray(val)) el.value = val.join(', ');
  else el.value = val ?? '';
}
function getField(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return Number(el.value);
  return el.value;
}

async function loadSettings() {
  const s = await api('/api/settings');
  for (const [group, map] of Object.entries(FIELDS))
    for (const [key, id] of Object.entries(map))
      if ($(id)) setField($(id), s[group][key]);
  LANG = (s.general && s.general.lang) || 'tr';
  applyI18n();
}

async function saveSettings() {
  const s = {};
  for (const group of Object.keys(FIELDS)) s[group] = {};
  for (const [group, map] of Object.entries(FIELDS))
    for (const [key, id] of Object.entries(map)) {
      if (!$(id)) continue;
      let v = getField($(id));
      if (LIST_FIELDS.has(key)) v = String(v).split(',').map((x) => x.trim()).filter(Boolean);
      s[group][key] = v;
    }
  await api('/api/settings', s);
}

// Ayar degisince otomatik kaydet
document.addEventListener('change', (e) => {
  if (e.target.matches('input, select')) saveSettings();
});

// Dil degisince arayuzu aninda guncelle
$('g_language').addEventListener('change', (e) => {
  LANG = e.target.value || 'tr';
  applyI18n();
  refreshStatus(); // rozet metnini de guncelle
});

// ---- Log ----
const logEl = $('log');
function addLog(e) {
  const div = document.createElement('div');
  div.className = 'line';
  const time = new Date(e.time).toLocaleTimeString('tr-TR');
  div.innerHTML = `<span class="t">${time}</span><span class="${e.level}">${escapeHtml(e.message)}</span>`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.childNodes.length > 500) logEl.removeChild(logEl.firstChild);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ---- Durum ----
function applyStatus(st) {
  const badge = $('loginBadge');
  if (st.loggedIn) { badge.textContent = tUI('badgeIn'); badge.className = 'badge on'; }
  else { badge.textContent = tUI('badgeOut'); badge.className = 'badge off'; }
  $('userBadge').textContent = st.username ? '@' + st.username : '';

  if ('likeRunning' in st) {
    $('btnLikeStart').disabled = st.likeRunning;
    $('btnLikeStop').disabled = !st.likeRunning;
  }
  if ('unfollowRunning' in st) {
    $('btnUnfollowStart').disabled = st.unfollowRunning;
    $('btnUnfollowStop').disabled = !st.unfollowRunning;
  }
  if ('followRunning' in st) {
    $('btnFollowStart').disabled = st.followRunning;
    $('btnFollowStop').disabled = !st.followRunning;
  }
}
function applyStats(s) {
  $('c_liked').textContent = s.liked ?? 0;
  $('c_likeSkipped').textContent = s.likeSkipped ?? 0;
  $('c_unfollowed').textContent = s.unfollowed ?? 0;
  $('c_unfollowSkipped').textContent = s.unfollowSkipped ?? 0;
  $('c_followed').textContent = s.followed ?? 0;
  $('c_followSkipped').textContent = s.followSkipped ?? 0;
}

// ---- WebSocket ----
function connectWS() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const { type, data } = JSON.parse(ev.data);
    if (type === 'log') addLog(data);
    else if (type === 'stats') applyStats(data);
    else if (type === 'status') applyStatus(data);
  };
  ws.onclose = () => setTimeout(connectWS, 2000);
}

async function refreshStatus() {
  const st = await api('/api/status');
  applyStatus(st);
  applyStats(st.stats);
}

// ---- Butonlar ----
$('btnLogin').onclick = async () => { await saveSettings(); await api('/api/login', {}); };
$('btnRefresh').onclick = async () => { const st = await api('/api/refresh', {}); applyStatus(st); refreshStatus(); };
$('btnClose').onclick = async () => { await api('/api/browser/close', {}); refreshStatus(); };

$('btnLikeStart').onclick = async () => {
  await saveSettings();
  const r = await api('/api/like/start', {});
  if (!r.ok) addLog({ time: Date.now(), level: 'error', message: r.error || tUI('startFailed') });
  else applyStatus({ likeRunning: true });
};
$('btnLikeStop').onclick = () => api('/api/like/stop', {});

$('btnUnfollowStart').onclick = async () => {
  await saveSettings();
  const r = await api('/api/unfollow/start', {});
  if (!r.ok) addLog({ time: Date.now(), level: 'error', message: r.error || tUI('startFailed') });
  else applyStatus({ unfollowRunning: true });
};
$('btnUnfollowStop').onclick = () => api('/api/unfollow/stop', {});

$('btnFollowStart').onclick = async () => {
  await saveSettings();
  const r = await api('/api/follow/start', {});
  if (!r.ok) addLog({ time: Date.now(), level: 'error', message: r.error || tUI('startFailed') });
  else applyStatus({ followRunning: true });
};
$('btnFollowStop').onclick = () => api('/api/follow/stop', {});

$('btnClearLog').onclick = () => { logEl.innerHTML = ''; };

// ---- Baslat ----
(async () => {
  await loadLocales();
  await loadSettings();
  connectWS();
  refreshStatus();
  setInterval(refreshStatus, 5000);
})();
