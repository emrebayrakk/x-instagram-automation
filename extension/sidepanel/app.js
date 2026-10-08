'use strict';
/* X Otomasyon — yan panel.
   Ayarları düzenler, görevleri arka plan üzerinden başlatır/durdurur ve chrome.storage
   değişikliklerini dinleyerek canlı durumu (sayaçlar, tempo, kayıt, Instagram sonuçları) çizer.
   Formlar görünüm başına bir kez çizilir; değişen kısımlar yalnızca data-slot alanlarında güncellenir. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const PLATFORM_OF = XO_TASKS;
const TEMPO_WINDOW = 10 * 60 * 1000;
const IG_PAGE = 150;
const CHECKPOINT_TTL = 24 * 60 * 60 * 1000;

function readPref(key, fallback) {
  try { const v = localStorage.getItem('xo:' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem('xo:' + key, JSON.stringify(value)); } catch { /* yalnızca kolaylık */ }
}

const S = {
  settings: xoMergeSettings(),
  daily: xoFreshDaily(),
  logs: [], tasks: {}, accounts: {}, igData: null, igCp: null, igKeep: [], xHistory: {},
  queueSteps: { steps: [], loop: false, onError: 'stop' }, queueRun: null,
  qDraft: { kind: 'follow', source: 'followers', target: '', count: 15, minutes: 15, mode: 'likes' },
  view: readPref('view', 'home'),
  igTab: 'non', igQuery: '', igHideVerified: false, igHidePrivate: false, igOnlyApp: false, igOnlyNoPhoto: false, igHistory: {},
  igSelected: new Set(), igLimit: IG_PAGE, igMemo: null,
  logFilter: 'all',
  lastSaved: ''
};

const T = (key, p) => xoT(S.settings.general.lang, key, p);

// ------------------------------------------------------------------ simgeler

const svg = (body, fill) => `<svg viewBox="0 0 24 24" aria-hidden="true" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;
const ICON = {
  sliders: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  heart: svg('<path d="M12 20s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>'),
  userMinus: svg('<circle cx="9" cy="8" r="4"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0M16 11h6"/>'),
  userPlus: svg('<circle cx="9" cy="8" r="4"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>'),
  compare: svg('<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  steps: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>'),
  eraser: svg('<path d="M8 20h12M4.6 14.6l7.8-7.8a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12 19.2H8.4l-3.8-3.8a1 1 0 0 1 0-.8z"/><path d="M9.5 9.7l5 5"/>'),
  play: svg('<path d="M8 5.5v13l11-6.5z"/>', true),
  stop: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>', true),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  x: svg('<path d="M4 4h4.6l11.4 16h-4.6z"/><path d="M19.5 4L13.6 10.6M4.5 20l5.9-6.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>', true),
  ig: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/>')
};
const MARK = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" class="mark-bg"/><path d="M9 9l14 14" class="mark-a"/><path d="M23 9L9 23" class="mark-b"/></svg>`;

// ------------------------------------------------------------------ biçimlendirme

const fmtCache = {};
function fmt(kind) {
  const lang = S.settings.general.lang;
  const key = kind + lang;
  if (!fmtCache[key]) {
    fmtCache[key] = kind === 'time'
      ? new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' });
  }
  return fmtCache[key];
}
const fmtTime = (t) => fmt('time').format(t);
function relTime(t) {
  const s = Math.round((t - Date.now()) / 1000);
  const a = Math.abs(s);
  if (a < 45) return T('justNow');
  if (a < 3600) return fmt('rel').format(Math.round(s / 60), 'minute');
  if (a < 86400) return fmt('rel').format(Math.round(s / 3600), 'hour');
  return fmt('rel').format(Math.round(s / 86400), 'day');
}
function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const secs = (ms) => Math.round((Number(ms) || 0) / 100) / 10;

// ------------------------------------------------------------------ depolama

async function load() {
  const d = await chrome.storage.local.get(['settings', 'daily', 'logs', 'tasks', 'accounts', 'igData', 'igCp', 'igKeep', 'xHistory', 'igHistory', 'queueSteps', 'queueRun']);
  S.xHistory = d.xHistory || {};
  S.igHistory = d.igHistory || {};
  S.queueSteps = normQueue(d.queueSteps);
  S.queueRun = d.queueRun || null;
  S.settings = xoMergeSettings(d.settings);
  S.daily = xoFreshDaily(d.daily);
  S.logs = d.logs || [];
  S.tasks = d.tasks || {};
  S.accounts = d.accounts || {};
  S.igData = d.igData || null;
  S.igCp = d.igCp || null;
  S.igKeep = d.igKeep || [];
}

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  let full = false;
  if (ch.settings) {
    const json = JSON.stringify(ch.settings.newValue || null);
    if (json !== S.lastSaved) { // başka bir panel ya da sıfırlama: formları yeniden çiz
      S.settings = xoMergeSettings(ch.settings.newValue);
      full = true;
    }
  }
  if (ch.daily) S.daily = xoFreshDaily(ch.daily.newValue);
  if (ch.logs) S.logs = ch.logs.newValue || [];
  if (ch.tasks) S.tasks = ch.tasks.newValue || {};
  if (ch.accounts) S.accounts = ch.accounts.newValue || {};
  if (ch.igData) { S.igData = ch.igData.newValue || null; S.igMemo = null; }
  if (ch.igCp) S.igCp = ch.igCp.newValue || null;
  if (ch.igKeep) { S.igKeep = ch.igKeep.newValue || []; S.igMemo = null; }
  if (ch.xHistory) S.xHistory = ch.xHistory.newValue || {};
  if (ch.igHistory) S.igHistory = ch.igHistory.newValue || {};
  if (ch.queueSteps) S.queueSteps = normQueue(ch.queueSteps.newValue);
  if (ch.queueRun) S.queueRun = ch.queueRun.newValue || null;
  if (full) renderAll(); else renderDynamic();
});

let saveTimer = 0;
function saveSettings(delay = 350) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSettings, delay);
}
function flushSettings() {
  clearTimeout(saveTimer);
  S.lastSaved = JSON.stringify(S.settings);
  return chrome.storage.local.set({ settings: S.settings });
}

async function send(msg) {
  try { return await chrome.runtime.sendMessage(msg); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

function errText(r) {
  if (!r) return T('errGeneric', { e: '—' });
  const p = { ...(r.p || {}) };
  if (p.task) p.task = T('task.' + p.task);
  const key = r.error || '';
  return T(key, p) !== key ? T(key, p) : T('errGeneric', { e: key || '—' });
}

// ------------------------------------------------------------------ yardımcı görünümler

const busyOn = (platform) => Object.keys(PLATFORM_OF).find((id) => PLATFORM_OF[id] === platform && S.tasks[id] && S.tasks[id].running) || null;
const pf = (p) => `<i class="pf ${p === 'ig' ? 'ig' : p === 'x' ? 'x' : ''}">${p === 'ig' ? 'IG' : p === 'x' ? 'X' : '•'}</i>`;

function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}), obj);
  target[last] = value;
}

function unitValue(ms, unit) {
  if (unit === 'sec') return secs(ms);
  if (unit === 'min') return Math.round((Number(ms) || 0) / 6000) / 10;
  return ms;
}

const field = {
  num(path, label, o = {}) {
    return `<label class="field"><span>${esc(label)}</span><input type="number" inputmode="numeric" min="${o.min ?? 0}" ${o.max ? `max="${o.max}"` : ''} step="1" data-bind="${path}" data-type="int" ${o.zero ? 'data-zero="1" placeholder="0"' : ''} value="${esc(getPath(S.settings, path))}"></label>`;
  },
  dur(path, label, unit) {
    return `<label class="field"><span>${esc(label)}</span><input type="number" inputmode="decimal" min="0" step="${unit === 'min' ? '0.5' : '0.5'}" data-bind="${path}" data-type="${unit}" value="${esc(unitValue(getPath(S.settings, path), unit))}"></label>`;
  },
  range(pMin, pMax, label) {
    const box = (p, aria) => `<input type="number" inputmode="decimal" min="0" step="0.5" data-bind="${p}" data-type="sec" value="${esc(secs(getPath(S.settings, p)))}" aria-label="${esc(label + ' · ' + aria)}">`;
    return `<div class="field"><span>${esc(label)}</span><div class="range">${box(pMin, T('min'))}<span class="range-sep" aria-hidden="true">–</span>${box(pMax, T('max'))}</div></div>`;
  },
  // Sayı aralığı (0 = sınır yok); type 'float' ondalık kabul eder (ör. oran).
  numRange(pMin, pMax, label, type = 'int') {
    const step = type === 'float' ? '0.1' : '1';
    const box = (p, aria) => `<input type="number" inputmode="decimal" min="0" step="${step}" data-bind="${p}" data-type="${type}" data-zero="1" value="${esc(getPath(S.settings, p))}" placeholder="0" aria-label="${esc(label + ' · ' + aria)}">`;
    return `<div class="field"><span>${esc(label)}</span><div class="range">${box(pMin, T('min'))}<span class="range-sep" aria-hidden="true">–</span>${box(pMax, T('max'))}</div></div>`;
  },
  text(path, label, placeholder) {
    return `<label class="field"><span>${esc(label)}</span><input type="text" spellcheck="false" autocomplete="off" data-bind="${path}" data-type="str" placeholder="${esc(placeholder)}" value="${esc(getPath(S.settings, path))}"></label>`;
  },
  check(path, label) {
    return `<label class="check"><input type="checkbox" data-bind="${path}" data-type="bool" ${getPath(S.settings, path) ? 'checked' : ''}><span>${esc(label)}</span></label>`;
  },
  select(path, label, options) {
    const cur = getPath(S.settings, path);
    return `<label class="field"><span>${esc(label)}</span><select data-bind="${path}" data-type="str">${options.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  },
  handle(path, label, placeholder) {
    return `<label class="field"><span>${esc(label)}</span><span class="prefix"><input type="text" spellcheck="false" autocomplete="off" data-bind="${path}" data-type="handle" placeholder="${esc(placeholder)}" value="${esc(getPath(S.settings, path))}"></span></label>`;
  },
  list(path, label, placeholder) {
    return `<label class="field"><span>${esc(label)}</span><textarea rows="2" spellcheck="false" data-bind="${path}" data-type="list" placeholder="${esc(placeholder)}">${esc((getPath(S.settings, path) || []).join(', '))}</textarea></label>`;
  }
};

// ------------------------------------------------------------------ iskelet

function applyTheme() {
  const t = S.settings.general.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  document.documentElement.lang = S.settings.general.lang;
}

function renderAll() {
  applyTheme();
  const tabs = [['home', T('navHome')], ['x', 'X'], ['ig', 'Instagram'], ['queue', T('navQueue')], ['log', T('navLog')]];
  $('#app').innerHTML = `
    <header class="top">
      <div class="brand"><span class="mark">${MARK}</span><span class="brand-text"><b>X Otomasyon</b><small>X · Instagram</small></span></div>
      <button type="button" class="icon-btn gear" data-action="view" data-view="settings" aria-label="${esc(T('settingsTitle'))}" title="${esc(T('settingsTitle'))}">${ICON.sliders}</button>
    </header>
    <nav class="tabs" role="tablist" aria-label="${esc(T('navLabel'))}">
      ${tabs.map(([v, label]) => `<button type="button" role="tab" class="tab" data-action="view" data-view="${v}" aria-selected="false">${esc(label)}<span data-slot="dot:${v}"></span></button>`).join('')}
    </nav>
    <main id="view" class="view"></main>
    <div class="toasts" id="toasts" role="status" aria-live="polite"></div>
    <dialog id="dlg" class="dlg"></dialog>`;
  renderView();
}

function renderView() {
  if (!VIEWS[S.view]) S.view = 'home';
  $$('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === S.view)));
  const gear = $('.gear');
  if (gear) gear.setAttribute('aria-pressed', String(S.view === 'settings'));
  const v = $('#view');
  v.innerHTML = VIEWS[S.view]();
  v.dataset.view = S.view;
  bindForms(v);
  if (S.view === 'queue') qSyncForm();
  renderDynamic();
  window.scrollTo({ top: 0 });
}

function renderDynamic(only) {
  for (const el of $$('[data-slot]')) {
    const [name, arg] = el.dataset.slot.split(':');
    if (only && !only.includes(name)) continue;
    const fn = SLOTS[name];
    if (!fn) continue;
    const html = fn(arg, el);
    if (html !== undefined && el.__html !== html) { el.innerHTML = html; el.__html = html; }
  }
}

// ------------------------------------------------------------------ görünümler

const VIEWS = {};

VIEWS.home = () => `
  ${S.settings.general.noticeDismissed ? '' : `<div class="notice" role="note"><p>${esc(T('noticeBody'))}</p><button type="button" class="btn ghost sm" data-action="dismiss-notice">${esc(T('noticeOk'))}</button></div>`}
  <section class="block">
    <h2 class="eyebrow">${esc(T('accounts'))}</h2>
    <div class="acct-list"><div data-slot="acct:x"></div><div data-slot="acct:ig"></div></div>
  </section>
  <section class="block">
    <h2 class="eyebrow">${esc(T('today'))}</h2>
    <div data-slot="daily"></div>
  </section>
  <section class="block">
    <h2 class="eyebrow">${esc(T('activeTasks'))}</h2>
    <div data-slot="active"></div>
  </section>
  <section class="block">
    <div class="block-head"><h2 class="eyebrow">${esc(T('recentActivity'))}</h2><button type="button" class="link-btn" data-action="view" data-view="log">${esc(T('seeAll'))}</button></div>
    <ol class="log" data-slot="recent"></ol>
  </section>`;

function moduleCard(id, icon, title, desc, form) {
  const open = readPref('fold:' + id, false);
  return `<article class="module" data-module="${id}">
    <header class="module-head">
      <span class="module-icon">${icon}</span>
      <div class="module-title"><h3>${esc(title)}</h3><div data-slot="pill:${id}"></div></div>
      <div class="module-ctl" data-slot="ctl:${id}"></div>
    </header>
    <p class="module-desc">${esc(desc)}</p>
    <div data-slot="run:${id}"></div>
    ${form ? `<details class="fold" data-fold="${id}" ${open ? 'open' : ''}><summary>${esc(T('settingsFold'))}<span data-slot="fcount:${id}"></span></summary><div class="form">${form}</div></details>` : ''}
  </article>`;
}

// Gönderi dili seçenekleri: adlar tarayıcının dil adlarından (Intl) gelir, çeviri gerekmez.
const TWEET_LANGS = ['tr', 'en', 'de', 'es', 'fr', 'it', 'pt', 'nl', 'ar', 'fa', 'ru', 'ja', 'ko', 'hi', 'id'];
function langName(code) {
  try { return new Intl.DisplayNames([S.settings.general.lang], { type: 'language' }).of(code) || code; } catch { return code; }
}

const sub = (key) => `<h4 class="sub">${esc(T(key))}</h4>`;
const when = (cond, html) => `<div class="when" data-when="${cond}">${html}</div>`;

VIEWS.x = () => {
  const like = `
    <div class="grid2">
      ${field.select('x.like.feed', T('lblSource'), [['following', T('optFollowing')], ['foryou', T('optForyou')], ['search', T('optSearch')], ['profile', T('optProfile')]])}
      ${field.num('x.like.maxPerSession', T('lblMax'), { min: 1 })}
    </div>
    ${when('x.like.feed=search', field.text('x.like.query', T('lblQuery'), T('phQuery')))}
    ${when('x.like.feed=profile', field.handle('x.like.profile', T('lblProfileUser'), T('phSourceUser')))}
    ${field.range('x.like.minDelayMs', 'x.like.maxDelayMs', T('lblDelay'))}
    ${sub('subPosts')}
    <div class="checks">
      ${field.check('x.like.skipRetweets', T('chkSkipRT'))}
      ${field.check('x.like.skipReplies', T('chkSkipReplies'))}
      ${field.check('x.like.skipPromoted', T('chkSkipPromoted'))}
      ${field.check('x.like.skipNoPhoto', T('chkSkipNoPhotoAuthor'))}
      ${field.check('x.like.skipVerifiedAuthors', T('chkSkipVerifiedAuthor'))}
    </div>
    <div class="grid2">
      ${field.select('x.like.lang', T('lblLang'), [['', T('optAnyLang')], ...TWEET_LANGS.map((c) => [c, langName(c)])])}
      ${field.num('x.like.maxAgeHours', T('lblMaxAge'), { zero: true })}
    </div>
    ${field.list('x.like.keywordsInclude', T('lblKwInclude'), T('phKwInclude'))}
    ${field.list('x.like.keywordsExclude', T('lblKwExclude'), T('phKwExclude'))}`;

  const unfollow = `
    <div class="grid2">
      ${field.num('x.unfollow.maxPerSession', T('lblMax'), { min: 1 })}
    </div>
    ${field.range('x.unfollow.minDelayMs', 'x.unfollow.maxDelayMs', T('lblDelay'))}
    ${sub('subWho')}
    <div class="checks">
      ${field.check('x.unfollow.onlyNonFollowers', T('chkOnlyNon'))}
      ${field.check('x.unfollow.alsoNoPhoto', T('chkAlsoNoPhoto'))}
      ${field.check('x.unfollow.onlyHistory', T('chkOnlyHistory'))}
    </div>
    <div class="grid2">${field.num('x.unfollow.minDaysSinceFollow', T('lblMinDaysSinceFollow'), { zero: true })}</div>
    ${sub('subKeep')}
    <div class="checks">${field.check('x.unfollow.keepVerified', T('chkKeepVerified'))}</div>
    <div class="grid2">${field.num('x.unfollow.keepMinFollowers', T('lblKeepMinFollowers'), { zero: true })}</div>
    ${field.list('x.unfollow.whitelist', T('lblWhitelist'), T('phWhitelist'))}
    <p class="hint">${esc(T('unfollowHistoryHint'))}</p>`;

  const follow = `
    <div class="grid2">
      ${field.select('x.follow.sourceList', T('lblSourceList'), [
        ['followers', T('optFollowers')], ['following', T('optFollowingList')], ['verified', T('optVerifiedFollowers')],
        ['search', T('optSearchPeople')], ['retweets', T('optRetweeters')], ['mine', T('optMyFollowers')]])}
      ${field.num('x.follow.maxPerSession', T('lblMax'), { min: 1 })}
    </div>
    ${when('x.follow.sourceList=followers|following|verified', field.handle('x.follow.sourceUser', T('lblSourceUser'), T('phSourceUser')))}
    ${when('x.follow.sourceList=search', field.text('x.follow.query', T('lblPeopleQuery'), T('phPeopleQuery')))}
    ${when('x.follow.sourceList=retweets', field.text('x.follow.tweetUrl', T('lblTweetUrl'), T('phTweetUrl')))}
    ${when('x.follow.sourceList=mine', `<p class="hint">${esc(T('mineHint'))}</p>`)}
    ${field.range('x.follow.minDelayMs', 'x.follow.maxDelayMs', T('lblDelay'))}
    ${sub('subProfile')}
    <div class="checks">
      ${field.check('x.follow.skipNoPhoto', T('chkSkipNoPhoto'))}
      ${field.check('x.follow.skipNoBanner', T('chkSkipNoBanner'))}
      ${field.check('x.follow.skipProtected', T('chkSkipProtected'))}
      ${field.check('x.follow.skipBotHandles', T('chkSkipBotHandles'))}
      ${field.check('x.follow.requireBio', T('chkRequireBio'))}
    </div>
    <div class="grid2">
      ${field.select('x.follow.verifiedMode', T('lblVerifiedMode'), [['any', T('optVerAny')], ['skip', T('optVerSkip')], ['only', T('optVerOnly')]])}
      ${field.num('x.follow.minBioLength', T('lblMinBio'), { zero: true })}
    </div>
    ${sub('subNumbers')}
    <div class="grid2">
      ${field.numRange('x.follow.minFollowers', 'x.follow.maxFollowers', T('lblFollowersRange'))}
      ${field.numRange('x.follow.minFollowing', 'x.follow.maxFollowing', T('lblFollowingRange'))}
    </div>
    ${field.numRange('x.follow.minRatio', 'x.follow.maxRatio', T('lblRatioRange'), 'float')}
    <div class="grid2">
      ${field.num('x.follow.minTweets', T('lblMinTweets'), { zero: true })}
      ${field.num('x.follow.minAgeDays', T('lblMinAgeDays'), { zero: true })}
    </div>
    <p class="hint">${esc(T('numbersHint'))}</p>
    ${sub('subText')}
    ${field.list('x.follow.bioInclude', T('lblBioInclude'), T('phBioInclude'))}
    ${field.list('x.follow.bioExclude', T('lblBioExclude'), T('phBioExclude'))}
    ${field.list('x.follow.nameInclude', T('lblNameInclude'), T('phName'))}
    ${field.list('x.follow.nameExclude', T('lblNameExclude'), T('phNameExclude'))}
    ${field.list('x.follow.locationInclude', T('lblLocationInclude'), T('phLocation'))}
    ${sub('subOther')}
    <div class="grid2">
      ${field.select('x.follow.gender', T('lblGender'), [['all', T('optGenderAll')], ['female', T('optGenderFemale')], ['male', T('optGenderMale')]])}
    </div>
    <div class="checks">
      ${field.check('x.follow.skipFollowsYou', T('chkSkipFollowsYou'))}
      ${field.check('x.follow.skipHistory', T('chkSkipHistory'))}
    </div>
    <p class="hint">${esc(T('followHint'))}</p>`;

  const clean = `
    <div class="grid2">
      ${field.select('x.clean.mode', T('lblCleanMode'), [['likes', T('optCleanLikes')], ['reposts', T('optCleanReposts')]])}
      ${field.num('x.clean.maxPerSession', T('lblMax'), { min: 1 })}
    </div>
    ${field.range('x.clean.minDelayMs', 'x.clean.maxDelayMs', T('lblDelay'))}
    <div class="grid2">${field.num('x.clean.olderThanDays', T('lblOlderThanDays'), { zero: true })}</div>
    <p class="hint">${esc(T('cleanHint'))}</p>`;

  return `
    <div data-slot="acct:x"></div>
    ${moduleCard('xLike', ICON.heart, T('likeTitle'), T('likeDesc'), like)}
    ${moduleCard('xFollow', ICON.userPlus, T('followTitle'), T('followDesc'), follow)}
    ${moduleCard('xUnfollow', ICON.userMinus, T('unfollowTitle'), T('unfollowDesc'), unfollow)}
    ${moduleCard('xClean', ICON.eraser, T('cleanTitle'), T('cleanDesc'), clean)}
    <section class="card">
      <h3 class="eyebrow">${esc(T('histTitle'))}</h3>
      <div data-slot="hist"></div>
    </section>
    <p class="fineprint">${esc(T('xVisibleHint'))}</p>`;
};

VIEWS.ig = () => {
  const timing = `
    <h4 class="sub">${esc(T('igSubScan'))}</h4>
    ${field.range('ig.scanDelayMin', 'ig.scanDelayMax', T('lblScanDelay'))}
    <div class="grid2">
      ${field.num('ig.scanPauseEvery', T('lblScanPauseEvery'))}
      ${field.dur('ig.scanPauseMs', T('lblScanPauseLen'), 'sec')}
      ${field.num('ig.usersPerRequest', T('lblUsersPerRequest'), { min: 10, max: 200 })}
    </div>
    <h4 class="sub">${esc(T('igSubUnfollow'))}</h4>
    ${field.range('ig.unfollowDelayMin', 'ig.unfollowDelayMax', T('lblDelay'))}
    <div class="grid2">
      ${field.num('ig.unfollowPauseEvery', T('lblCooldownEvery'))}
      ${field.dur('ig.unfollowPauseMs', T('lblCooldownLen'), 'min')}
    </div>
    <p class="hint">${esc(T('igTimingHint'))}</p>
    <button type="button" class="link-btn" data-action="ig-timing-defaults">${esc(T('restoreDefaults'))}</button>`;
  const follow = `
    <div class="grid2">
      ${field.select('ig.follow.sourceList', T('lblSourceList'), [
        ['followers', T('optFollowers')], ['following', T('optFollowingList')], ['likers', T('igOptLikers')], ['mine', T('optMyFollowers')]])}
      ${field.num('ig.follow.maxPerSession', T('lblMax'), { min: 1 })}
    </div>
    ${when('ig.follow.sourceList=followers|following', field.handle('ig.follow.sourceUser', T('lblSourceUser'), T('phSourceUser')))}
    ${when('ig.follow.sourceList=likers', field.text('ig.follow.postUrl', T('igLblPostUrl'), T('igPhPostUrl')))}
    ${when('ig.follow.sourceList=mine', `<p class="hint">${esc(T('igMineHint'))}</p>`)}
    ${field.range('ig.follow.delayMin', 'ig.follow.delayMax', T('lblDelay'))}
    <div class="grid2">
      ${field.num('ig.follow.pauseEvery', T('lblCooldownEvery'))}
      ${field.dur('ig.follow.pauseMs', T('lblCooldownLen'), 'min')}
    </div>
    ${sub('subProfile')}
    <div class="checks">
      ${field.check('ig.follow.skipNoPhoto', T('chkSkipNoPhoto'))}
      ${field.check('ig.follow.skipPrivate', T('chkSkipProtected'))}
      ${field.check('ig.follow.skipBotHandles', T('chkSkipBotHandles'))}
    </div>
    <div class="grid2">
      ${field.select('ig.follow.verifiedMode', T('lblVerifiedMode'), [['any', T('optVerAny')], ['skip', T('optVerSkip')], ['only', T('optVerOnly')]])}
      ${field.select('ig.follow.gender', T('lblGender'), [['all', T('optGenderAll')], ['female', T('optGenderFemale')], ['male', T('optGenderMale')]])}
    </div>
    ${field.list('ig.follow.nameInclude', T('lblNameInclude'), T('phName'))}
    ${field.list('ig.follow.nameExclude', T('lblNameExclude'), T('phNameExclude'))}
    ${sub('igSubDetail')}
    <p class="hint">${esc(T('igDetailHint'))}</p>
    <div class="grid2">
      ${field.numRange('ig.follow.minFollowers', 'ig.follow.maxFollowers', T('lblFollowersRange'))}
      ${field.numRange('ig.follow.minFollowing', 'ig.follow.maxFollowing', T('lblFollowingRange'))}
    </div>
    ${field.numRange('ig.follow.minRatio', 'ig.follow.maxRatio', T('lblRatioRange'), 'float')}
    <div class="grid2">
      ${field.num('ig.follow.minPosts', T('lblMinTweets'), { zero: true })}
      ${field.num('ig.follow.minBioLength', T('lblMinBio'), { zero: true })}
    </div>
    <div class="checks">
      ${field.check('ig.follow.requireBio', T('chkRequireBio'))}
      ${field.check('ig.follow.skipBusiness', T('igChkSkipBusiness'))}
    </div>
    ${field.list('ig.follow.bioInclude', T('lblBioInclude'), T('phBioInclude'))}
    ${field.list('ig.follow.bioExclude', T('lblBioExclude'), T('phBioExclude'))}
    ${field.range('ig.follow.lookupDelayMin', 'ig.follow.lookupDelayMax', T('igLblLookupDelay'))}
    ${sub('subOther')}
    <div class="checks">
      ${field.check('ig.follow.skipFollowsYou', T('chkSkipFollowsYou'))}
      ${field.check('ig.follow.skipHistory', T('chkSkipHistory'))}
    </div>
    <p class="hint">${esc(T('igFollowHint'))}</p>`;
  const open = readPref('fold:igTiming', false);
  return `
    <div data-slot="acct:ig"></div>
    ${moduleCard('igFollow', ICON.userPlus, T('igFollowTitle'), T('igFollowDesc'), follow)}
    ${moduleCard('igScan', ICON.compare, T('igScanTitle'), T('igScanDesc'), '')}
    <section class="results is-empty" aria-label="${esc(T('igResults'))}">
      <div data-slot="igseg"></div>
      <div class="toolbar">
        <label class="search">${ICON.search}<input type="search" id="igQuery" placeholder="${esc(T('igSearch'))}" aria-label="${esc(T('igSearch'))}" value="${esc(S.igQuery)}"></label>
        <div class="chips">
          <button type="button" class="chip" data-action="ig-filter" data-filter="igHideVerified" aria-pressed="${S.igHideVerified}">${esc(T('igHideVerified'))}</button>
          <button type="button" class="chip" data-action="ig-filter" data-filter="igHidePrivate" aria-pressed="${S.igHidePrivate}">${esc(T('igHidePrivate'))}</button>
          <button type="button" class="chip" data-action="ig-filter" data-filter="igOnlyApp" aria-pressed="${S.igOnlyApp}">${esc(T('igOnlyApp'))}</button>
          <button type="button" class="chip" data-action="ig-filter" data-filter="igOnlyNoPhoto" aria-pressed="${S.igOnlyNoPhoto}">${esc(T('igOnlyNoPhoto'))}</button>
        </div>
      </div>
      <div data-slot="igsel"></div>
      <ul class="ulist" data-slot="iglist"></ul>
      <div class="actionbar" data-slot="igact"></div>
    </section>
    <section class="card">
      <h3 class="eyebrow">${esc(T('igHistTitle'))}</h3>
      <div data-slot="ighist"></div>
    </section>
    <details class="fold card" data-fold="igTiming" ${open ? 'open' : ''}><summary>${esc(T('igTimingTitle'))}</summary><div class="form">${timing}</div></details>
    <p class="fineprint">${esc(T('igPrivacyNote'))}</p>`;
};

VIEWS.log = () => `
  <div class="log-tools">
    <div class="chips" role="group" aria-label="${esc(T('logFilter'))}">
      ${[['all', T('logAll')], ['x', 'X'], ['ig', 'Instagram'], ['error', T('logErrors')]].map(([k, l]) =>
        `<button type="button" class="chip" data-action="log-filter" data-filter="${k}" aria-pressed="${S.logFilter === k}">${esc(l)}</button>`).join('')}
    </div>
    <div class="btns">
      <button type="button" class="btn ghost sm" data-action="log-export">${esc(T('export'))}</button>
      <button type="button" class="btn ghost sm" data-action="log-clear">${esc(T('clear'))}</button>
    </div>
  </div>
  <ol class="log" data-slot="log"></ol>`;

VIEWS.settings = () => `
  <h2 class="view-title">${esc(T('settingsTitle'))}</h2>
  <section class="card form">
    <h3 class="eyebrow">${esc(T('secGeneral'))}</h3>
    <div class="grid2">
      ${field.select('general.lang', T('lblLanguage'), XO_LANGS.map((l) => [l, XO_LANG_NAMES[l]]))}
      ${field.select('general.theme', T('lblTheme'), [['auto', T('themeAuto')], ['light', T('themeLight')], ['dark', T('themeDark')]])}
    </div>
  </section>
  <section class="card form">
    <h3 class="eyebrow">X</h3>
    ${field.handle('x.username', T('lblUsername'), (S.accounts.x && S.accounts.x.username) || T('phAuto'))}
    <p class="hint">${esc(T('usernameHint'))}</p>
    <div class="grid2">
      ${field.num('x.dailyLikeCap', T('lblDailyLike'))}
      ${field.num('x.dailyFollowCap', T('lblDailyFollow'))}
      ${field.num('x.dailyUnfollowCap', T('lblDailyUnfollow'))}
      ${field.num('x.dailyCleanCap', T('lblDailyClean'))}
    </div>
  </section>
  <section class="card form">
    <h3 class="eyebrow">Instagram</h3>
    <div class="grid2">${field.num('ig.dailyFollowCap', T('lblDailyIgFollow'))}${field.num('ig.dailyUnfollowCap', T('lblDailyIgUnfollow'))}${field.num('ig.unfollowMinDays', T('lblIgUnfollowMinDays'))}</div>
    <p class="hint">${esc(T('capsHint'))}</p>
  </section>
  <section class="card">
    <h3 class="eyebrow">${esc(T('secData'))}</h3>
    <div class="data-rows">
      <div class="data-row"><span>${esc(T('igHistTitle'))}</span><button type="button" class="btn ghost sm" data-action="ighist-clear">${esc(T('clear'))}</button></div>
      <div class="data-row"><span>${esc(T('dataIg'))}</span><button type="button" class="btn ghost sm" data-action="clear-ig">${esc(T('btnDelete'))}</button></div>
      <div class="data-row"><span>${esc(T('histTitle'))}</span><button type="button" class="btn ghost sm" data-action="hist-clear">${esc(T('clear'))}</button></div>
      <div class="data-row"><span>${esc(T('dataLogs'))}</span><button type="button" class="btn ghost sm" data-action="log-clear">${esc(T('clear'))}</button></div>
      <div class="data-row"><span>${esc(T('dataSettings'))}</span><button type="button" class="btn ghost sm" data-action="reset-settings">${esc(T('btnReset'))}</button></div>
    </div>
  </section>
  <section class="about">
    <p>${esc(T('noticeBody'))}</p>
    <p class="mono">X Otomasyon v${esc(chrome.runtime.getManifest().version)}</p>
  </section>`;

// ------------------------------------------------------------------ dinamik alanlar

const SLOTS = {};

SLOTS.dot = (v) => {
  if (v === 'queue') return S.queueRun && S.queueRun.running ? '<i class="live" aria-hidden="true"></i>' : '';
  const p = v === 'x' ? 'x' : v === 'ig' ? 'ig' : null;
  return p && busyOn(p) ? '<i class="live" aria-hidden="true"></i>' : '';
};

SLOTS.acct = (p) => {
  const a = S.accounts[p] || {};
  const site = p === 'x' ? 'X' : 'Instagram';
  const open = !!a.tabId;
  let cls = 'off';
  let status = T('tabClosed');
  if (open && a.loggedIn === false) { cls = 'warn'; status = T('notSignedIn'); }
  else if (open && a.username) { cls = 'on'; status = '@' + a.username; }
  else if (open && a.loggedIn) { cls = 'on'; status = T('signedIn'); }
  else if (open) { cls = 'wait'; status = T('detecting'); }
  return `<div class="acct ${cls}">
    <span class="acct-icon ${p}">${p === 'x' ? ICON.x : ICON.ig}</span>
    <span class="acct-text"><b>${site}</b><span class="${cls === 'on' ? 'mono' : ''}">${esc(status)}</span></span>
    <button type="button" class="btn ghost sm" data-action="open-tab" data-platform="${p}">${esc(open ? T('goToTab') : T('openSite', { site }))}</button>
  </div>`;
};

const DAILY_ROWS = [
  ['xLike', 'x', 'dailyLikeCap', 'meterXLike'],
  ['xFollow', 'x', 'dailyFollowCap', 'meterXFollow'],
  ['xUnfollow', 'x', 'dailyUnfollowCap', 'meterXUnfollow'],
  ['xClean', 'x', 'dailyCleanCap', 'meterXClean'],
  ['igFollow', 'ig', 'dailyFollowCap', 'meterIgFollow'],
  ['igUnfollow', 'ig', 'dailyUnfollowCap', 'meterIgUnfollow']
];

// Ayar katlamasının başlığında "N filtre etkin" rozeti.
function activeFilters(id) {
  const x = S.settings.x;
  if (id === 'xFollow') {
    const s = x.follow;
    return [s.skipNoPhoto, s.skipNoBanner, s.skipProtected, s.verifiedMode !== 'any', s.skipBotHandles, s.requireBio,
      s.minBioLength > 0, s.minFollowers > 0 || s.maxFollowers > 0, s.minFollowing > 0 || s.maxFollowing > 0,
      s.minRatio > 0 || s.maxRatio > 0, s.minTweets > 0, s.minAgeDays > 0, s.bioInclude.length, s.bioExclude.length,
      s.nameInclude.length, s.nameExclude.length, s.locationInclude.length, s.gender !== 'all', s.skipFollowsYou, s.skipHistory
    ].filter(Boolean).length;
  }
  if (id === 'xLike') {
    const s = x.like;
    return [s.skipRetweets, s.skipReplies, s.skipPromoted, s.skipNoPhoto, s.skipVerifiedAuthors, s.lang, s.maxAgeHours > 0,
      s.keywordsInclude.length, s.keywordsExclude.length].filter(Boolean).length;
  }
  if (id === 'igFollow') {
    const s = S.settings.ig.follow;
    return [s.skipNoPhoto, s.skipPrivate, s.verifiedMode !== 'any', s.skipBotHandles, s.nameInclude.length, s.nameExclude.length,
      s.minFollowers > 0 || s.maxFollowers > 0, s.minFollowing > 0 || s.maxFollowing > 0, s.minRatio > 0 || s.maxRatio > 0,
      s.minPosts > 0, s.requireBio, s.minBioLength > 0, s.bioInclude.length, s.bioExclude.length, s.skipBusiness,
      s.gender !== 'all', s.skipFollowsYou, s.skipHistory].filter(Boolean).length;
  }
  if (id === 'xUnfollow') {
    const s = x.unfollow;
    return [s.onlyNonFollowers, s.alsoNoPhoto, s.onlyHistory, s.minDaysSinceFollow > 0, s.keepVerified, s.keepMinFollowers > 0,
      s.whitelist.length].filter(Boolean).length;
  }
  return 0;
}
SLOTS.fcount = (id) => {
  const n = activeFilters(id);
  return n ? ` <i class="badge">${esc(T('filtersActive', { n }))}</i>` : '';
};

SLOTS.hist = () => {
  const all = Object.values(S.xHistory || {});
  if (!all.length) return `<p class="empty">${esc(T('histEmpty'))}</p>`;
  const followed = all.filter((e) => e.f).length;
  const back = all.filter((e) => e.f && e.b).length;
  const dropped = all.filter((e) => e.u).length;
  const rate = new Intl.NumberFormat(S.settings.general.lang, { style: 'percent' }).format(followed ? back / followed : 0);
  return `<dl class="stats two">
      <div><dt>${esc(T('histFollowed'))}</dt><dd class="mono">${followed}</dd></div>
      <div class="hl"><dt>${esc(T('histBack'))}</dt><dd class="mono">${back}<small> · ${esc(rate)}</small></dd></div>
      <div><dt>${esc(T('histUnfollowed'))}</dt><dd class="mono">${dropped}</dd></div>
      <div><dt>${esc(T('histTotal'))}</dt><dd class="mono">${all.length}</dd></div>
    </dl>
    <p class="hint">${esc(T('histHint'))}</p>
    <div class="btns"><button type="button" class="btn ghost sm" data-action="hist-csv">${esc(T('csv'))}</button><button type="button" class="btn ghost sm" data-action="hist-clear">${esc(T('clear'))}</button></div>`;
};
SLOTS.daily = () => {
  const d = xoFreshDaily(S.daily);
  return `<div class="meters card">${DAILY_ROWS.map(([k, p, capKey, label]) => {
    const used = d[k] || 0;
    const cap = Number(S.settings[p][capKey]) || 0;
    const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
    return `<div class="meter ${pct >= 100 ? 'full' : pct >= 80 ? 'high' : ''}">
      <span class="meter-label">${pf(p)}${esc(T(label))}</span>
      <span class="meter-val mono">${used}<small> / ${cap}</small></span>
      <span class="meter-bar"><span style="width:${pct.toFixed(1)}%"></span></span>
    </div>`;
  }).join('')}</div>`;
};

SLOTS.active = () => {
  const ids = Object.keys(PLATFORM_OF).filter((id) => S.tasks[id] && S.tasks[id].running);
  const run = S.queueRun;
  const queue = run && run.running ? `<div class="card active">
      <div class="active-head">${pf('x')}<b>${esc(T('qTitle'))}</b>${qStopBtn()}</div>
      <p class="qstatus">${esc(qStatusText())}</p>
      ${run.phase === 'wait' || run.phase === 'retry' ? qWaitBar(run) : ''}
    </div>` : '';
  if (!ids.length && !queue) return `<p class="empty">${esc(T('noActive'))}</p>`;
  return queue + ids.map((id) => `<div class="card active">
    <div class="active-head">${pf(PLATFORM_OF[id])}<b>${esc(T('task.' + id))}</b>${stopBtn(id)}</div>
    ${runBlock(id)}
  </div>`).join('');
};

SLOTS.recent = () => logLines(S.logs.slice(-6).reverse());
SLOTS.log = () => {
  const f = S.logFilter;
  const list = S.logs.filter((e) => f === 'all' || (f === 'error' ? e.lvl === 'error' || e.lvl === 'warn' : e.src === f));
  return logLines(list.slice(-300).reverse());
};

SLOTS.pill = (id) => {
  const r = S.tasks[id];
  if (r && r.running) return `<span class="pill run"><i aria-hidden="true"></i>${esc(T('stRunning'))}</span>`;
  const map = { done: ['ok', 'stDone'], stopped: ['mute', 'stStopped'], error: ['bad', 'stError'], capped: ['warn', 'stCapped'] };
  const [cls, key] = (r && map[r.status]) || ['mute', 'stReady'];
  return `<span class="pill ${cls}">${esc(T(key))}${r && r.endedAt ? ` · ${esc(relTime(r.endedAt))}` : ''}</span>`;
};

const stopBtn = (id) => `<button type="button" class="btn stop sm" data-action="stop" data-task="${id}">${ICON.stop}${esc(T('btnStop'))}</button>`;

function cpUsable() {
  const cp = S.igCp;
  if (!cp || Date.now() - (cp.savedAt || 0) > CHECKPOINT_TTL) return null;
  const me = S.accounts.ig && S.accounts.ig.userId;
  return !me || cp.viewerId === me ? cp : null;
}

SLOTS.ctl = (id) => {
  const r = S.tasks[id];
  if (r && r.running) return stopBtn(id);
  const busy = busyOn(PLATFORM_OF[id]);
  const dis = busy ? `disabled title="${esc(T('errPlatformBusy', { task: T('task.' + busy) }))}"` : '';
  if (id === 'igScan') {
    if (cpUsable()) {
      return `<div class="btns"><button type="button" class="btn ghost" data-action="ig-rescan" ${dis}>${esc(T('btnRestart'))}</button><button type="button" class="btn go" data-action="start" data-task="igScan" ${dis}>${ICON.play}${esc(T('btnResume'))}</button></div>`;
    }
    return `<button type="button" class="btn go" data-action="ig-rescan" ${dis}>${ICON.play}${esc(T(S.igData ? 'btnRescan' : 'btnScan'))}</button>`;
  }
  return `<button type="button" class="btn go" data-action="start" data-task="${id}" ${dis}>${ICON.play}${esc(T('btnStart'))}</button>`;
};

SLOTS.run = (id) => (id === 'igScan' && !(S.tasks.igScan && S.tasks.igScan.running) ? igSummary() : runBlock(id));

function taskMax(id, r) {
  if (id === 'xLike') return S.settings.x.like.maxPerSession;
  if (id === 'xUnfollow') return S.settings.x.unfollow.maxPerSession;
  if (id === 'xFollow') return S.settings.x.follow.maxPerSession;
  if (id === 'xClean') return S.settings.x.clean.maxPerSession;
  if (id === 'igUnfollow') return (r.queue || []).length;
  if (id === 'igFollow') return S.settings.ig.follow.maxPerSession;
  return 0;
}
const DONE_LABEL = { xLike: 'cntLiked', xUnfollow: 'cntUnfollowed', xFollow: 'cntFollowed', xClean: 'cntCleaned', igUnfollow: 'cntUnfollowed', igFollow: 'cntFollowed' };

// En sık atlanma nedenleri: filtrelerin neyi elediğini gösterir, ayar yapmayı kolaylaştırır.
function reasonsLine(reasons) {
  const top = Object.entries(reasons || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!top.length) return '';
  return `<div class="why"><span>${esc(T('skipReasons'))}</span>${top.map(([k, n]) => `<i>${esc(T('why.' + k))} <b class="mono">${n}</b></i>`).join('')}</div>`;
}

// compact: yalnızca sayaçlar ve geri sayım (yapışkan alt çubuk için).
function runBlock(id, compact) {
  const r = S.tasks[id];
  if (!r) return '';
  if (id === 'igScan') return r.running ? scanProgress(r) + tempo(r, true) : '';
  const c = r.counts || {};
  const max = taskMax(id, r);
  return `<div class="counters">
      <span><b class="mono">${c.done || 0}${max ? `<small>/${max}</small>` : ''}</b>${esc(T(DONE_LABEL[id]))}</span>
      ${id !== 'igUnfollow' ? `<span><b class="mono">${c.skipped || 0}</b>${esc(T('cntSkipped'))}</span>` : ''}
      <span class="${c.errors ? 'bad' : ''}"><b class="mono">${c.errors || 0}</b>${esc(T('cntErrors'))}</span>
    </div>
    ${compact ? '' : reasonsLine(c.reasons)}
    ${r.running ? tempo(r, compact) : ''}`;
}

// İmza öğe: son 10 dakikadaki işlemler bir zaman çizgisinde çentik olarak, bir sonraki
// işleme kalan süre ise boşalan kehribar bir çubuk olarak gösterilir.
function tempo(r, waitOnly) {
  const now = Date.now();
  const waiting = r.nextAt && r.nextAt > now;
  const left = waiting ? r.nextAt - now : 0;
  const total = waiting ? Math.max(1, r.nextAt - (r.waitFrom || now)) : 1;
  const pct = waiting ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  const reason = r.waitReason === 'cooldown' ? 'waitCooldown' : r.waitReason === 'scanPause' ? 'waitScanPause' : 'waitNext';
  const next = `<div class="tempo-row"><span class="tempo-next ${waiting ? 'wait' : ''}">${esc(waiting ? T(reason) : T('working'))}</span><b class="mono">${waiting ? fmtClock(left) : ''}</b></div>
    <div class="tempo-bar"><span style="width:${pct.toFixed(2)}%;--left:${Math.round(left)}ms"></span></div>`;
  if (waitOnly) return waiting ? `<div class="tempo">${next}</div>` : '';
  const ticks = (r.ticks || []).filter((t) => now - t.t <= TEMPO_WINDOW);
  const marks = ticks.map((t) => `<i class="tick ${t.k === 'err' ? 'err' : 'ok'}" style="left:${(((t.t - (now - TEMPO_WINDOW)) / TEMPO_WINDOW) * 100).toFixed(2)}%"></i>`).join('');
  const okCount = ticks.filter((t) => t.k !== 'err').length;
  return `<div class="tempo">
    <div class="tempo-track" aria-hidden="true">${marks}<i class="now"></i></div>
    <div class="tempo-axis" aria-hidden="true"><span>−10 ${esc(T('unitMin'))}</span><span>${esc(T('now'))}</span></div>
    <p class="sr">${esc(T('tempoCaption', { n: okCount }))}</p>
    ${next}
  </div>`;
}

function scanProgress(r) {
  const pr = r.progress || {};
  const followersPhase = pr.phase === 'followers';
  const pct = pr.total ? Math.min(100, ((pr.cur || 0) / pr.total) * 100) : null;
  return `<div class="progress">
    <ol class="steps">
      <li class="${followersPhase ? 'done' : 'cur'}">${esc(T('scanFollowing'))}</li>
      <li class="${followersPhase ? 'cur' : ''}">${esc(T('scanFollowers'))}</li>
    </ol>
    <div class="progress-row"><span>${esc(T(followersPhase ? 'scanFollowers' : 'scanFollowing'))}</span><b class="mono">${pr.cur || 0}${pr.total ? ` / ${pr.total}` : ''}</b></div>
    <div class="progress-bar ${pct === null ? 'indeterminate' : ''}"><span style="width:${pct === null ? 30 : pct.toFixed(1)}%"></span></div>
  </div>`;
}

function igSummary() {
  const cp = cpUsable();
  const partial = cp ? `<p class="note warn">${esc(T('igPartial', { n: cp.following.length + cp.followers.length }))}${cp.stopReason ? ' ' + esc(T('igStopReason.' + cp.stopReason)) : ''}</p>` : '';
  const d = S.igData;
  if (!d) return partial || `<p class="empty">${esc(T('igNoScan'))}</p>`;
  const m = igModel();
  const me = S.accounts.ig && S.accounts.ig.userId;
  const other = me && d.viewerId !== me ? `<p class="note warn">${esc(T('igOtherAccount', { h: d.username || d.viewerId }))}</p>` : '';
  return `${partial}${other}<dl class="stats">
      <div><dt>${esc(T('igFollowing'))}</dt><dd class="mono">${d.following.length}</dd></div>
      <div><dt>${esc(T('igFollowers'))}</dt><dd class="mono">${d.followers.length}</dd></div>
      <div class="hl"><dt>${esc(T('igTabNon'))}</dt><dd class="mono">${m.non.length}</dd></div>
    </dl>
    <p class="meta">${esc(T('igScannedAt', { t: relTime(d.scannedAt) }))}${d.username ? ' · @' + esc(d.username) : ''}</p>`;
}

// ---- Instagram sonuç modeli (veri değişmedikçe yeniden hesaplanmaz) ----
function igModel() {
  const d = S.igData;
  if (!d) return null;
  if (S.igMemo && S.igMemo.d === d && S.igMemo.k === S.igKeep) return S.igMemo;
  const keep = new Set(S.igKeep);
  const followerIds = new Set(d.followers.map((u) => u.id));
  const followingIds = new Set(d.following.map((u) => u.id));
  const m = {
    d, k: S.igKeep, keep,
    non: d.following.filter((u) => !followerIds.has(u.id) && !keep.has(u.id)),
    fans: d.followers.filter((u) => !followingIds.has(u.id)),
    kept: d.following.filter((u) => keep.has(u.id))
  };
  S.igMemo = m;
  return m;
}

// Eklentinin takip ettiği (ve henüz bırakmadığı) hesabın geçmiş kaydı.
const appFollowed = (id) => { const e = (S.igHistory || {})[id]; return e && e.f && !e.u ? e : null; };

function igVisible(m) {
  const q = S.igQuery.trim().toLowerCase().replace(/^@/, '');
  return (m[S.igTab] || []).filter((u) =>
    (!S.igHideVerified || !u.verified) &&
    (!S.igHidePrivate || !u.private) &&
    (!S.igOnlyApp || appFollowed(u.id)) &&
    (!S.igOnlyNoPhoto || u.noPhoto) &&
    (!q || u.username.toLowerCase().includes(q) || u.name.toLowerCase().includes(q)));
}

SLOTS.ighist = () => {
  const all = Object.values(S.igHistory || {});
  if (!all.length) return `<p class="empty">${esc(T('igHistEmpty'))}</p>`;
  const followed = all.filter((e) => e.f).length;
  const back = all.filter((e) => e.f && e.b).length;
  const dropped = all.filter((e) => e.u).length;
  const rate = new Intl.NumberFormat(S.settings.general.lang, { style: 'percent' }).format(followed ? back / followed : 0);
  return `<dl class="stats two">
      <div><dt>${esc(T('histFollowed'))}</dt><dd class="mono">${followed}</dd></div>
      <div class="hl"><dt>${esc(T('histBack'))}</dt><dd class="mono">${back}<small> · ${esc(rate)}</small></dd></div>
      <div><dt>${esc(T('histUnfollowed'))}</dt><dd class="mono">${dropped}</dd></div>
      <div><dt>${esc(T('histTotal'))}</dt><dd class="mono">${all.length}</dd></div>
    </dl>
    <p class="hint">${esc(T('igHistHint'))}</p>
    <div class="btns"><button type="button" class="btn ghost sm" data-action="ighist-csv">${esc(T('csv'))}</button><button type="button" class="btn ghost sm" data-action="ighist-clear">${esc(T('clear'))}</button></div>`;
};

const selectedUsers = (m) => m.non.filter((u) => S.igSelected.has(u.id));

SLOTS.igseg = (_, el) => {
  const m = igModel();
  const results = el.closest('.results');
  if (results) results.classList.toggle('is-empty', !m);
  if (!m) return '';
  const tabs = [['non', T('igTabNon'), m.non.length], ['fans', T('igTabFans'), m.fans.length], ['kept', T('igTabKept'), m.kept.length]];
  return `<div class="seg" role="tablist" aria-label="${esc(T('igResults'))}">${tabs.map(([k, l, n]) =>
    `<button type="button" role="tab" class="seg-btn" data-action="ig-tab" data-tab="${k}" aria-selected="${S.igTab === k}"><b class="mono">${n}</b><span>${esc(l)}</span></button>`).join('')}</div>`;
};

SLOTS.igsel = () => {
  const m = igModel();
  if (!m) return '';
  const vis = igVisible(m);
  const tools = `<span class="sel-tools"><button type="button" class="link-btn" data-action="ig-copy">${esc(T('copy'))}</button><button type="button" class="link-btn" data-action="ig-csv">${esc(T('csv'))}</button></span>`;
  if (S.igTab !== 'non') return `<div class="selbar"><span class="muted">${esc(T('igShown', { n: vis.length }))}</span>${tools}</div>`;
  const all = vis.length > 0 && vis.every((u) => S.igSelected.has(u.id));
  return `<div class="selbar">
    <label class="check"><input type="checkbox" data-action="ig-select-all" ${all ? 'checked' : ''} ${vis.length ? '' : 'disabled'}><span>${esc(T('igSelectAll', { n: vis.length }))}</span></label>
    ${tools}
  </div>`;
};

function igRow(u, m) {
  const selectable = S.igTab === 'non';
  const sel = selectable && S.igSelected.has(u.id);
  const kept = m.keep.has(u.id);
  const initial = esc((u.username[0] || '?').toUpperCase());
  return `<li class="urow ${sel ? 'sel' : ''} ${selectable ? 'selectable' : ''}">
    ${selectable ? `<input type="checkbox" class="ucheck" data-action="ig-select" data-id="${esc(u.id)}" ${sel ? 'checked' : ''} aria-label="${esc(T('igSelectUser', { h: u.username }))}">` : ''}
    <span class="av" data-initial="${initial}">${u.pic ? `<img src="${esc(u.pic)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>
    <span class="who"><a class="handle" href="https://www.instagram.com/${encodeURIComponent(u.username)}/" target="_blank" rel="noopener noreferrer">${esc(u.username)}</a><span class="name">${esc(u.name)}</span></span>
    <span class="tags">${(() => { const e = appFollowed(u.id); return e ? `<i class="tag app" title="${esc(T('igTagAppHint'))}">${esc(T('igTagApp', { d: Math.max(0, Math.floor((Date.now() - e.f) / 86400000)) }))}</i>` : ''; })()}${u.verified ? `<i class="tag blue">${esc(T('tagVerified'))}</i>` : ''}${u.private ? `<i class="tag">${esc(T('tagPrivate'))}</i>` : ''}</span>
    ${S.igTab !== 'fans' ? `<button type="button" class="mini" data-action="ig-keep" data-id="${esc(u.id)}" aria-pressed="${kept}" title="${esc(T(kept ? 'igUnkeepHint' : 'igKeepHint'))}">${esc(T(kept ? 'igUnkeep' : 'igKeep'))}</button>` : ''}
  </li>`;
}

SLOTS.iglist = () => {
  const m = igModel();
  if (!m) return '';
  const vis = igVisible(m);
  if (!vis.length) {
    const key = m[S.igTab].length ? 'igNoMatch' : { non: 'igAllFollowBack', fans: 'igNoFans', kept: 'igNoKept' }[S.igTab];
    return `<li class="empty">${esc(T(key))}</li>`;
  }
  const rows = vis.slice(0, S.igLimit).map((u) => igRow(u, m)).join('');
  const rest = vis.length - S.igLimit;
  return rows + (rest > 0 ? `<li class="more"><button type="button" class="btn ghost sm" data-action="ig-more">${esc(T('showMore', { n: rest }))}</button></li>` : '');
};

SLOTS.igact = () => {
  const r = S.tasks.igUnfollow;
  if (r && r.running) {
    const total = (r.queue || []).length;
    return `<div class="act card">
      <div class="active-head">${pf('ig')}<b>${esc(T('igUnfollowProgress', { n: r.pos || 0, total }))}</b>${stopBtn('igUnfollow')}</div>
      ${runBlock('igUnfollow', true)}
    </div>`;
  }
  const m = igModel();
  if (!m || S.igTab !== 'non') return '';
  const n = selectedUsers(m).length;
  if (!n) return m.non.length ? `<p class="act-hint">${esc(T('igSelectHint'))}</p>` : '';
  const busy = busyOn('ig');
  return `<div class="act ready">
    <span><b class="mono">${n}</b> ${esc(T('igSelected'))}</span>
    <button type="button" class="btn danger" data-action="ig-unfollow" ${busy ? 'disabled' : ''}>${esc(T('igUnfollowBtn', { n }))}</button>
  </div>`;
};

function logText(e) {
  const p = { ...(e.p || {}) };
  if (p.task) p.task = T('task.' + p.task);
  if (p.kindKey) p.kind = T(p.kindKey);
  if (p.listKey) p.list = T('log.' + p.listKey);
  if (p.modeKey) p.mode = T('log.' + p.modeKey);
  if (p.st) p.st = T(Q_STATUS[p.st] || 'stError');
  return T('log.' + e.key, p);
}

function logLines(list) {
  if (!list.length) return `<li class="empty">${esc(T('logEmpty'))}</li>`;
  return list.map((e) => `<li class="ln ${esc(e.lvl)}"><time class="mono" datetime="${new Date(e.t).toISOString()}">${esc(fmtTime(e.t))}</time>${pf(e.src)}<span>${esc(logText(e))}</span></li>`).join('');
}

// ------------------------------------------------------------------ görev sırası
// Adımlar sırayla çalışır: bir işlem adımı (takip, beğeni…) bitince sıradaki başlar; "bekle" adımı
// belirtilen dakika kadar bekletir. Sırayı arka plan yürütür; panel kapalıyken de devam eder.

const Q_KIND = {
  follow: 'qTypeFollow', like: 'qTypeLike', unfollow: 'qTypeUnfollow', clean: 'qTypeClean',
  igfollow: 'qTypeIgFollow', igscan: 'qTypeIgScan', igunfollow: 'qTypeIgUnfollow', wait: 'qTypeWait'
};
const Q_IG = new Set(['igfollow', 'igscan', 'igunfollow']);
const Q_TASK = { follow: 'xFollow', like: 'xLike', unfollow: 'xUnfollow', clean: 'xClean', igfollow: 'igFollow', igscan: 'igScan', igunfollow: 'igUnfollow' };
const Q_SOURCES = {
  follow: [['followers', 'optFollowers'], ['following', 'optFollowingList'], ['verified', 'optVerifiedFollowers'],
    ['search', 'optSearchPeople'], ['retweets', 'optRetweeters'], ['mine', 'optMyFollowers']],
  like: [['following', 'optFollowing'], ['foryou', 'optForyou'], ['search', 'optSearch'], ['profile', 'optProfile']],
  clean: [['likes', 'optCleanLikes'], ['reposts', 'optCleanReposts']],
  igfollow: [['followers', 'optFollowers'], ['following', 'optFollowingList'], ['likers', 'igOptLikers'], ['mine', 'optMyFollowers']],
  igunfollow: [['all', 'qIgUnfAll'], ['app', 'qIgUnfApp']]
};
const Q_ICON = { follow: ICON.userPlus, like: ICON.heart, unfollow: ICON.userMinus, clean: ICON.eraser, wait: ICON.clock, igfollow: ICON.userPlus, igscan: ICON.compare, igunfollow: ICON.userMinus };
const Q_STATUS = { done: 'stDone', stopped: 'stStopped', error: 'stError', capped: 'stCapped', running: 'stRunning' };

function normQueue(v) {
  return {
    steps: v && Array.isArray(v.steps) ? v.steps : [],
    loop: !!(v && v.loop),
    onError: v && v.onError === 'next' ? 'next' : 'stop'
  };
}
const saveQueue = () => chrome.storage.local.set({ queueSteps: S.queueSteps });
const qRunning = () => !!(S.queueRun && S.queueRun.running);

// Adımın hedef alanı ne bekliyor: kullanıcı adı, arama sorgusu, gönderi bağlantısı ya da hiçbiri.
function targetKind(kind, source) {
  if (kind === 'follow') return ['followers', 'following', 'verified'].includes(source) ? 'handle' : source === 'search' ? 'query' : source === 'retweets' ? 'url' : null;
  if (kind === 'like') return source === 'search' ? 'query' : source === 'profile' ? 'handle' : null;
  if (kind === 'igfollow') return ['followers', 'following'].includes(source) ? 'handle' : source === 'likers' ? 'url' : null;
  return null;
}

function stepText(st) {
  if (st.kind === 'wait') return { title: `${T('qTypeWait')} · ${st.minutes} ${T('unitMin')}`, sub: '' };
  if (st.kind === 'igscan') return { title: T('qTypeIgScan'), sub: T('qIgScanSub') };
  const cur = st.kind === 'clean' ? st.mode : st.source;
  const src = (Q_SOURCES[st.kind] || []).find(([v]) => v === cur);
  const tk = targetKind(st.kind, st.source);
  const target = tk === 'handle' ? '@' + st.target : tk === 'query' ? `"${st.target}"` : tk === 'url' ? st.target.replace(/^https?:\/\/(www\.)?/, '') : '';
  return { title: `${T(Q_KIND[st.kind])} · ${st.count}`, sub: [target, src ? T(src[1]) : ''].filter(Boolean).join(' · ') };
}

function qWaitBar(run) {
  const now = Date.now();
  const left = Math.max(0, (run.waitUntil || 0) - now);
  const total = Math.max(1, (run.waitUntil || 0) - (run.waitFrom || now));
  const pct = Math.min(100, (left / total) * 100);
  return `<div class="qwait"><div class="tempo-bar"><span style="width:${pct.toFixed(2)}%;--left:${Math.round(left)}ms"></span></div><b class="mono">${fmtClock(left)}</b></div>`;
}

function qStatusText() {
  const run = S.queueRun;
  const total = S.queueSteps.steps.length;
  if (run && run.running) {
    const n = run.index + 1;
    const cycle = run.cycle > 1 ? ` · ${T('qCycle', { n: run.cycle })}` : '';
    if (run.phase === 'wait') return T('qStatusWait', { n, total }) + cycle;
    if (run.phase === 'retry') return T('qStatusRetry') + cycle;
    return T('qStatusTask', { n, total }) + cycle;
  }
  if (run && run.endedAt) return T('qLast', { st: T(Q_STATUS[run.status] || 'stStopped'), t: relTime(run.endedAt) });
  return T('qStatusIdle', { n: total });
}

const qStopBtn = () => `<button type="button" class="btn stop sm" data-action="q-stop">${ICON.stop}${esc(T('btnStop'))}</button>`;

VIEWS.queue = () => {
  const q = S.queueSteps;
  return `
  <article class="module qcard">
    <header class="module-head">
      <span class="module-icon">${ICON.steps}</span>
      <div class="module-title"><h3>${esc(T('qTitle'))}</h3><div data-slot="qpill"></div></div>
      <div class="module-ctl" data-slot="qctl"></div>
    </header>
    <p class="module-desc">${esc(T('qDesc'))}</p>
    <div data-slot="qstatus"></div>
    <div class="qopts">
      <label class="check"><input type="checkbox" data-qopt="loop" ${q.loop ? 'checked' : ''}><span>${esc(T('qLoop'))}</span></label>
      <label class="field"><span>${esc(T('qOnError'))}</span><select data-qopt="onError">
        <option value="stop" ${q.onError === 'stop' ? 'selected' : ''}>${esc(T('qOnErrorStop'))}</option>
        <option value="next" ${q.onError === 'next' ? 'selected' : ''}>${esc(T('qOnErrorNext'))}</option>
      </select></label>
    </div>
  </article>
  <section class="block">
    <div class="block-head"><h2 class="eyebrow">${esc(T('qSteps'))}</h2><button type="button" class="link-btn" data-action="q-clear">${esc(T('qClear'))}</button></div>
    <ol class="qsteps" data-slot="qsteps"></ol>
  </section>
  <section class="card form qadd">
    <h3 class="eyebrow">${esc(T('qAddTitle'))}</h3>
    <div class="grid2">
      <label class="field"><span>${esc(T('qType'))}</span><select data-q="kind">${Object.entries(Q_KIND).map(([v, k]) => `<option value="${v}">${esc(T(k))}</option>`).join('')}</select></label>
      <label class="field" data-qw="source"><span>${esc(T('lblSource'))}</span><select data-q="source"></select></label>
    </div>
    <label class="field" data-qw="target"><span data-qlabel></span><span class="qtarget"><input type="text" spellcheck="false" autocomplete="off" data-q="target"></span></label>
    <div class="grid2">
      <label class="field" data-qw="count"><span>${esc(T('qCount'))}</span><input type="number" min="1" step="1" data-q="count"></label>
      <label class="field" data-qw="minutes"><span>${esc(T('qMinutes'))}</span><input type="number" min="0.5" step="0.5" data-q="minutes"></label>
    </div>
    <button type="button" class="btn go" data-action="q-add">${esc(T('qAdd'))}</button>
  </section>
  <details class="fold card" data-fold="qbulk" ${readPref('fold:qbulk', true) ? 'open' : ''}><summary>${esc(T('qBulkTitle'))}</summary><div class="form">
    <p class="hint">${esc(T('qBulkDesc'))}</p>
    <label class="field"><span>${esc(T('qBulkAccounts'))}</span><textarea rows="3" spellcheck="false" data-qb="accounts" placeholder="${esc(T('qBulkPh'))}"></textarea></label>
    <div class="grid3">
      <label class="field"><span>${esc(T('lblSource'))}</span><select data-qb="source">${Q_SOURCES.follow.slice(0, 3).map(([v, k]) => `<option value="${v}">${esc(T(k))}</option>`).join('')}</select></label>
      <label class="field"><span>${esc(T('qCount'))}</span><input type="number" min="1" step="1" value="15" data-qb="count"></label>
      <label class="field"><span>${esc(T('qBulkWait'))}</span><input type="number" min="0" step="0.5" value="15" data-qb="minutes"></label>
    </div>
    <button type="button" class="btn ghost" data-action="q-bulk">${esc(T('qBulkAdd'))}</button>
  </div></details>
  <p class="fineprint">${esc(T('qHint'))}</p>`;
};

// Ekleme formunu taslağa göre doldur; tür/kaynak değişince görünen alanları ayarla.
function qSyncForm() {
  const d = S.qDraft;
  const kind = $('[data-q="kind"]');
  if (!kind) return;
  kind.value = d.kind;
  const opts = Q_SOURCES[d.kind] || [];
  const key = d.kind === 'clean' ? 'mode' : 'source';
  if (opts.length && !opts.some(([v]) => v === d[key])) d[key] = opts[0][0];
  const src = $('[data-q="source"]');
  src.innerHTML = opts.map(([v, k]) => `<option value="${v}">${esc(T(k))}</option>`).join('');
  if (opts.length) src.value = d[key];
  const tk = targetKind(d.kind, d.source);
  const show = (name, on) => { const el = $(`[data-qw="${name}"]`); if (el) el.hidden = !on; };
  show('source', opts.length > 0);
  show('target', !!tk);
  show('count', d.kind !== 'wait' && d.kind !== 'igscan');
  show('minutes', d.kind === 'wait');
  const ig = d.kind === 'igfollow';
  const label = { handle: d.kind === 'like' ? 'lblProfileUser' : 'lblSourceUser', query: 'lblQuery', url: ig ? 'igLblPostUrl' : 'lblTweetUrl' }[tk] || 'lblSourceUser';
  const ph = { handle: 'phSourceUser', query: d.kind === 'follow' ? 'phPeopleQuery' : 'phQuery', url: ig ? 'igPhPostUrl' : 'phTweetUrl' }[tk] || 'phSourceUser';
  $('[data-qlabel]').textContent = T(label);
  const target = $('[data-q="target"]');
  target.placeholder = T(ph);
  target.value = d.target;
  target.parentElement.classList.toggle('prefix', tk === 'handle');
  $('[data-q="count"]').value = d.count;
  $('[data-q="minutes"]').value = d.minutes;
}

const qId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const cleanHandle = (s) => String(s || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(x|twitter|instagram)\.com\//i, '').split(/[/?#\s]/)[0];

SLOTS.qpill = () => {
  const run = S.queueRun;
  if (run && run.running) return `<span class="pill run"><i aria-hidden="true"></i>${esc(T('stRunning'))}</span>`;
  const cls = { done: 'ok', error: 'bad', stopped: 'mute' }[run && run.status] || 'mute';
  return `<span class="pill ${cls}">${esc(run && run.status ? T(Q_STATUS[run.status] || 'stReady') : T('stReady'))}</span>`;
};

SLOTS.qctl = () => {
  const run = S.queueRun;
  if (run && run.running) {
    const skip = run.phase === 'wait' || run.phase === 'retry'
      ? `<button type="button" class="btn ghost sm" data-action="q-skip">${esc(T('qSkipWait'))}</button>` : '';
    return `<div class="btns">${skip}${qStopBtn()}</div>`;
  }
  const ready = S.queueSteps.steps.some((s) => Q_TASK[s.kind]);
  return `<button type="button" class="btn go" data-action="q-start" ${ready ? '' : 'disabled'}>${ICON.play}${esc(T('btnQueueStart'))}</button>`;
};

SLOTS.qstatus = () => `<p class="qstatus">${esc(qStatusText())}</p>`;

SLOTS.qsteps = () => {
  const { steps } = S.queueSteps;
  const run = S.queueRun;
  const running = qRunning();
  if (!steps.length) return `<li class="empty">${esc(T('qEmpty'))}</li>`;
  return steps.map((st, i) => {
    const res = run && run.done ? run.done[st.id] : null;
    const cur = running && run.stepId === st.id;
    const state = cur ? 'cur' : res === 'done' ? 'done' : res ? 'bad' : '';
    const { title, sub } = stepText(st);
    let extra = '';
    if (cur && (run.phase === 'wait' || run.phase === 'retry')) extra = qWaitBar(run);
    else if (cur && run.phase === 'task') {
      const r = S.tasks[Q_TASK[st.kind]];
      const c = (r && r.counts) || {};
      extra = st.count ? `<span class="qprog mono">${c.done || 0}/${st.count} · ${esc(T('cntSkipped'))} ${c.skipped || 0}</span>` : '';
    }
    const mark = state === 'done' ? '✓' : state === 'bad' ? '!' : String(i + 1);
    const btns = running ? '' : `<span class="qbtns">
        <button type="button" class="mini" data-action="q-move" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="${esc(T('qMoveUp'))}" title="${esc(T('qMoveUp'))}">↑</button>
        <button type="button" class="mini" data-action="q-move" data-i="${i}" data-d="1" ${i === steps.length - 1 ? 'disabled' : ''} aria-label="${esc(T('qMoveDown'))}" title="${esc(T('qMoveDown'))}">↓</button>
        <button type="button" class="mini" data-action="q-del" data-i="${i}" aria-label="${esc(T('qDelete'))}" title="${esc(T('qDelete'))}">✕</button>
      </span>`;
    return `<li class="qstep ${state} ${st.kind === 'wait' ? 'is-wait' : ''}">
      <span class="qnum mono">${mark}</span>
      <span class="qicon ${Q_IG.has(st.kind) ? 'ig' : ''}">${Q_ICON[st.kind] || ''}</span>
      <span class="qtext"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}${extra}</span>
      ${btns}
    </li>`;
  }).join('') + (running ? `<li class="qlock">${esc(T('qLocked'))}</li>` : '');
};

// Sıra eylemleri; aşağıda ACTIONS'a eklenir.
const ACTIONS_EXTRA = {};
Object.assign(ACTIONS_EXTRA, {
  async 'q-add'() {
    const d = S.qDraft;
    const tk = targetKind(d.kind, d.source);
    let target = String(d.target || '').trim();
    if (tk === 'handle') target = cleanHandle(target);
    if (tk && !target) { toast(T('qNeedTarget'), 'bad'); $('[data-q="target"]').focus(); return; }
    if (tk === 'url' && d.kind === 'follow' && !/\/status(es)?\/\d+/.test(target)) { toast(T('needTweetUrl'), 'bad'); return; }
    if (tk === 'url' && d.kind === 'igfollow' && !/instagram\.com\/(?:[\w.]+\/)?(p|reel|reels|tv)\/[\w-]+/.test(target)) { toast(T('igNeedPostUrl'), 'bad'); return; }
    const step = { id: qId(), kind: d.kind };
    if (d.kind === 'wait') step.minutes = Math.max(0.5, Number(d.minutes) || 1);
    else if (d.kind === 'igscan') { /* parametresiz adım */ }
    else {
      step.count = Math.max(1, Math.round(Number(d.count) || 1));
      if (['follow', 'like', 'igfollow', 'igunfollow'].includes(d.kind)) step.source = d.source;
      if (d.kind === 'clean') step.mode = d.mode;
      if (tk) step.target = target;
    }
    S.queueSteps.steps = [...S.queueSteps.steps, step];
    S.qDraft.target = '';
    await saveQueue();
    qSyncForm();
    toast(T('qAdded', { n: 1 }));
  },

  async 'q-bulk'() {
    const box = (k) => $(`[data-qb="${k}"]`);
    const handles = [...new Set(box('accounts').value.split(/[\s,;]+/).map(cleanHandle).filter((h) => /^[A-Za-z0-9_]{1,15}$/.test(h)))];
    if (!handles.length) { toast(T('qNeedTarget'), 'bad'); box('accounts').focus(); return; }
    const source = box('source').value;
    const count = Math.max(1, Math.round(Number(box('count').value) || 15));
    const minutes = Math.max(0, Number(String(box('minutes').value).replace(',', '.')) || 0);
    const add = [];
    handles.forEach((h, i) => {
      if (i > 0 && minutes > 0) add.push({ id: qId(), kind: 'wait', minutes });
      add.push({ id: qId(), kind: 'follow', source, target: h, count });
    });
    // Sıranın sonunda zaten adım varsa araya da bekleme koy.
    const last = S.queueSteps.steps[S.queueSteps.steps.length - 1];
    if (last && last.kind !== 'wait' && minutes > 0) add.unshift({ id: qId(), kind: 'wait', minutes });
    S.queueSteps.steps = [...S.queueSteps.steps, ...add];
    box('accounts').value = '';
    await saveQueue();
    toast(T('qAdded', { n: add.length }));
  },

  async 'q-move'(el) {
    if (qRunning()) return;
    const i = Number(el.dataset.i);
    const j = i + Number(el.dataset.d);
    const steps = [...S.queueSteps.steps];
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    S.queueSteps.steps = steps;
    await saveQueue();
  },

  async 'q-del'(el) {
    if (qRunning()) return;
    S.queueSteps.steps = S.queueSteps.steps.filter((_, i) => i !== Number(el.dataset.i));
    await saveQueue();
  },

  async 'q-clear'() {
    if (qRunning() || !S.queueSteps.steps.length) return;
    const ok = await confirmDialog({ title: T('qConfirmClear'), body: [T('qConfirmClearBody')], ok: T('qClear'), danger: true });
    if (!ok) return;
    S.queueSteps.steps = [];
    await saveQueue();
  },

  async 'q-start'(el) {
    el.disabled = true;
    await flushSettings();
    await saveQueue();
    const r = await send({ type: 'queueStart' });
    el.disabled = false;
    if (!r || !r.ok) toast(T(r && r.error === 'qNeedSteps' ? 'qNeedSteps' : 'errGeneric', { e: (r && r.error) || '—' }), 'bad');
  },

  'q-stop'(el) { el.disabled = true; send({ type: 'queueStop' }); },
  'q-skip'(el) { el.disabled = true; send({ type: 'queueSkipWait' }); }
});

// ------------------------------------------------------------------ formlar

function readField(el) {
  const t = el.dataset.type;
  if (t === 'bool') return el.checked;
  // data-zero: boş bırakılan filtre alanı "0 = sınır yok" demektir; diğer sayı alanlarında boşluk yok sayılır.
  if ((t === 'int' || t === 'float') && el.value.trim() === '') return el.dataset.zero ? 0 : undefined;
  if (t === 'int') {
    const n = parseInt(el.value, 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
  if (t === 'float') {
    const n = parseFloat(String(el.value).replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
  if (t === 'sec' || t === 'min') {
    const n = parseFloat(String(el.value).replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * (t === 'sec' ? 1000 : 60000)) : undefined;
  }
  if (t === 'list') return el.value.split(/[,\n]/).map((s) => s.trim().replace(/^@/, '')).filter(Boolean);
  if (t === 'handle') {
    return el.value.trim().replace(/^@/, '')
      .replace(/^https?:\/\/(www\.)?(x|twitter|instagram)\.com\//i, '').split(/[/?#\s]/)[0];
  }
  return el.value;
}

// data-when="yol=değer1|değer2": alan yalnızca ilgili seçimde görünür (ör. kaynak = arama).
function applyWhen(root = document) {
  for (const el of $$('[data-when]', root)) {
    const [path, vals] = el.dataset.when.split('=');
    el.hidden = !vals.split('|').includes(String(getPath(S.settings, path)));
  }
}

function onField(el) {
  const v = readField(el);
  if (v === undefined) return;
  const path = el.dataset.bind;
  setPath(S.settings, path, v);
  if (path === 'general.lang' || path === 'general.theme') {
    flushSettings();
    renderAll();
    return;
  }
  saveSettings();
  applyWhen();
  renderDynamic();
}

function bindForms(root) {
  for (const el of $$('[data-bind]', root)) {
    const instant = el.type === 'checkbox' || el.tagName === 'SELECT';
    el.addEventListener(instant ? 'change' : 'input', () => onField(el));
  }
  for (const d of $$('details[data-fold]', root)) {
    d.addEventListener('toggle', () => writePref('fold:' + d.dataset.fold, d.open));
  }
  applyWhen(root);
  const q = $('#igQuery', root);
  if (q) {
    q.addEventListener('input', () => {
      S.igQuery = q.value;
      S.igLimit = IG_PAGE;
      renderDynamic(['igsel', 'iglist', 'igact']);
    });
  }
}

// ------------------------------------------------------------------ geri bildirim

function toast(msg, kind = '') {
  const box = $('#toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  box.append(el);
  setTimeout(() => el.classList.add('out'), 2800);
  setTimeout(() => el.remove(), 3200);
}

function confirmDialog({ title, body, ok, danger }) {
  return new Promise((resolve) => {
    const d = $('#dlg');
    d.innerHTML = `<form method="dialog" class="dlg-body">
      <h3>${esc(title)}</h3>
      ${body.map((p) => `<p>${esc(p)}</p>`).join('')}
      <div class="dlg-actions">
        <button type="submit" value="cancel" class="btn ghost">${esc(T('cancel'))}</button>
        <button type="submit" value="ok" class="btn ${danger ? 'danger' : 'go'}">${esc(ok)}</button>
      </div>
    </form>`;
    d.returnValue = '';
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    d.showModal();
    const cancel = d.querySelector('button[value="cancel"]');
    if (cancel) cancel.focus();
  });
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

// Panelde seçim varsa seçilenler, yoksa ekrandaki (filtrelenmiş) liste dışa aktarılır.
function igExportList() {
  const m = igModel();
  if (!m) return [];
  if (S.igTab === 'non' && S.igSelected.size) return selectedUsers(m);
  return igVisible(m);
}

// ------------------------------------------------------------------ eylemler

// Seçilen kaynak için gereken alan boşsa görevi başlatmadan söyle.
function missingInput(task) {
  const x = S.settings.x;
  if (task === 'xFollow') {
    const s = x.follow;
    if (['followers', 'following', 'verified'].includes(s.sourceList) && !s.sourceUser) return { path: 'x.follow.sourceUser', msg: 'needSource' };
    if (s.sourceList === 'search' && !String(s.query).trim()) return { path: 'x.follow.query', msg: 'needQuery' };
    if (s.sourceList === 'retweets' && !/\/status(es)?\/\d+/.test(s.tweetUrl)) return { path: 'x.follow.tweetUrl', msg: 'needTweetUrl' };
  }
  if (task === 'igFollow') {
    const s = S.settings.ig.follow;
    if (['followers', 'following'].includes(s.sourceList) && !s.sourceUser) return { path: 'ig.follow.sourceUser', msg: 'needSource' };
    if (s.sourceList === 'likers' && !/instagram\.com\/(?:[\w.]+\/)?(p|reel|reels|tv)\/[\w-]+/.test(s.postUrl)) return { path: 'ig.follow.postUrl', msg: 'igNeedPostUrl' };
  }
  if (task === 'xLike') {
    if (x.like.feed === 'search' && !String(x.like.query).trim()) return { path: 'x.like.query', msg: 'needQuery' };
    if (x.like.feed === 'profile' && !x.like.profile) return { path: 'x.like.profile', msg: 'needProfile' };
  }
  return null;
}

const ACTIONS = {
  view(el) {
    S.view = el.dataset.view;
    writePref('view', S.view);
    renderView();
  },

  async start(el) {
    const task = el.dataset.task;
    const missing = missingInput(task);
    if (missing) {
      toast(T(missing.msg), 'bad');
      const fold = $(`details[data-fold="${task}"]`);
      if (fold) { fold.open = true; const inp = $(`[data-bind="${missing.path}"]`, fold); if (inp) inp.focus(); }
      return;
    }
    el.disabled = true;
    await flushSettings();
    const r = await send({ type: 'start', task });
    el.disabled = false;
    if (!r || !r.ok) toast(errText(r), 'bad');
  },

  async stop(el) {
    el.disabled = true;
    await send({ type: 'stop', task: el.dataset.task });
  },

  'open-tab'(el) { send({ type: 'openTab', platform: el.dataset.platform }); },

  'dismiss-notice'() {
    S.settings.general.noticeDismissed = true;
    flushSettings();
    const n = $('.notice');
    if (n) n.remove();
  },

  async 'ig-rescan'(el) {
    el.disabled = true;
    await flushSettings();
    const r = await send({ type: 'start', task: 'igScan', payload: { fresh: true } });
    el.disabled = false;
    if (!r || !r.ok) toast(errText(r), 'bad');
  },

  'ig-tab'(el) {
    S.igTab = el.dataset.tab;
    S.igLimit = IG_PAGE;
    renderDynamic(['igseg', 'igsel', 'iglist', 'igact']);
  },

  'ig-filter'(el) {
    const k = el.dataset.filter;
    S[k] = !S[k];
    el.setAttribute('aria-pressed', String(S[k]));
    S.igLimit = IG_PAGE;
    renderDynamic(['igsel', 'iglist', 'igact']);
  },

  'ig-more'() {
    S.igLimit += IG_PAGE;
    renderDynamic(['iglist']);
  },

  async 'ig-keep'(el) {
    const id = el.dataset.id;
    const keep = new Set(S.igKeep);
    if (keep.has(id)) keep.delete(id); else { keep.add(id); S.igSelected.delete(id); }
    S.igKeep = [...keep];
    S.igMemo = null;
    await chrome.storage.local.set({ igKeep: S.igKeep });
  },

  async 'ig-copy'() {
    const list = igExportList();
    if (!list.length) return;
    const ok = await copyText(list.map((u) => u.username).join('\n'));
    toast(ok ? T('copied', { n: list.length }) : T('copyFailed'), ok ? '' : 'bad');
  },

  'ig-csv'() {
    const list = igExportList();
    if (!list.length) return;
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [['username', 'full_name', 'verified', 'private', 'profile_url'].join(',')]
      .concat(list.map((u) => [q(u.username), q(u.name), u.verified, u.private, q(`https://www.instagram.com/${u.username}/`)].join(',')));
    download(`instagram-${S.igTab}-${xoToday()}.csv`, '﻿' + rows.join('\r\n'), 'text/csv;charset=utf-8');
  },

  async 'ig-unfollow'() {
    const m = igModel();
    if (!m) return;
    const users = selectedUsers(m);
    if (!users.length) return;
    const s = S.settings.ig;
    const n = users.length;
    const pauses = s.unfollowPauseEvery > 0 ? Math.floor((n - 1) / s.unfollowPauseEvery) : 0;
    const etaMin = Math.max(1, Math.ceil((((n - 1) * (s.unfollowDelayMin + s.unfollowDelayMax)) / 2 + pauses * s.unfollowPauseMs) / 60000));
    const capLeft = Math.max(0, s.dailyUnfollowCap - (xoFreshDaily(S.daily).igUnfollow || 0));
    const body = [
      s.unfollowPauseEvery > 0
        ? T('igConfirmPace', { min: secs(s.unfollowDelayMin), max: secs(s.unfollowDelayMax), every: s.unfollowPauseEvery, pause: unitValue(s.unfollowPauseMs, 'min') })
        : T('igConfirmPaceNoPause', { min: secs(s.unfollowDelayMin), max: secs(s.unfollowDelayMax) }),
      T('igConfirmEta', { m: etaMin })
    ];
    if (n > capLeft) body.push(T('igConfirmCap', { cap: capLeft }));
    body.push(T('igConfirmIrreversible'));
    const ok = await confirmDialog({ title: T('igConfirmTitle', { n }), body, ok: T('igUnfollowBtn', { n }), danger: true });
    if (!ok) return;
    await flushSettings();
    const r = await send({
      type: 'start', task: 'igUnfollow',
      payload: { queue: users.map((u) => ({ id: u.id, username: u.username })), viewerId: S.igData.viewerId }
    });
    if (r && r.ok) { S.igSelected.clear(); renderDynamic(); } else toast(errText(r), 'bad');
  },

  async 'ig-timing-defaults'() {
    const d = XO_DEFAULTS.ig;
    for (const k of Object.keys(d)) if (k !== 'dailyUnfollowCap') S.settings.ig[k] = d[k];
    await flushSettings();
    renderView();
    toast(T('defaultsRestored'));
  },

  'log-filter'(el) {
    S.logFilter = el.dataset.filter;
    $$('[data-action="log-filter"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === S.logFilter)));
    renderDynamic(['log']);
  },

  'log-clear'() { send({ type: 'clearLogs' }); },

  'log-export'() {
    const lines = S.logs.map((e) => `${new Date(e.t).toISOString()}\t${e.src}\t${e.lvl}\t${logText(e)}`);
    download(`x-otomasyon-log-${xoToday()}.txt`, lines.join('\n'), 'text/plain;charset=utf-8');
  },

  'hist-csv'() {
    const iso = (t) => (t ? new Date(t).toISOString() : '');
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [['username', 'followed_at', 'followed_back_seen_at', 'unfollowed_at', 'source', 'profile_url'].join(',')]
      .concat(Object.entries(S.xHistory || {}).map(([h, e]) =>
        [q(h), iso(e.f), iso(e.b), iso(e.u), q(e.s || ''), q(`https://x.com/${h}`)].join(',')));
    download(`x-takip-gecmisi-${xoToday()}.csv`, '﻿' + rows.join('\r\n'), 'text/csv;charset=utf-8');
  },

  async 'hist-clear'() {
    const ok = await confirmDialog({ title: T('confirmClearHist'), body: [T('confirmClearHistBody')], ok: T('clear'), danger: true });
    if (!ok) return;
    await chrome.storage.local.remove('xHistory');
    toast(T('deleted'));
  },

  'ighist-csv'() {
    const iso = (t) => (t ? new Date(t).toISOString() : '');
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [['user_id', 'username', 'followed_at', 'followed_back_seen_at', 'unfollowed_at', 'source', 'profile_url'].join(',')]
      .concat(Object.entries(S.igHistory || {}).map(([id, e]) =>
        [q(id), q(e.h || ''), iso(e.f), iso(e.b), iso(e.u), q(e.s || ''), q(e.h ? `https://www.instagram.com/${e.h}/` : '')].join(',')));
    download(`instagram-takip-gecmisi-${xoToday()}.csv`, '﻿' + rows.join('\r\n'), 'text/csv;charset=utf-8');
  },

  async 'ighist-clear'() {
    const ok = await confirmDialog({ title: T('confirmClearHist'), body: [T('confirmClearHistBody')], ok: T('clear'), danger: true });
    if (!ok) return;
    await chrome.storage.local.remove('igHistory');
    toast(T('deleted'));
  },

  async 'clear-ig'() {
    const ok = await confirmDialog({ title: T('confirmClearIg'), body: [T('confirmClearIgBody')], ok: T('btnDelete'), danger: true });
    if (!ok) return;
    await chrome.storage.local.remove(['igData', 'igCp']);
    S.igSelected.clear();
    toast(T('deleted'));
  },

  async 'reset-settings'() {
    const ok = await confirmDialog({ title: T('confirmReset'), body: [T('confirmResetBody')], ok: T('btnReset'), danger: true });
    if (!ok) return;
    const keep = { lang: S.settings.general.lang, theme: S.settings.general.theme, noticeDismissed: true };
    S.settings = xoMergeSettings({ general: keep });
    await flushSettings();
    renderAll();
    toast(T('resetDone'));
  }
};

Object.assign(ACTIONS, ACTIONS_EXTRA);

// Görev sırası: ekleme taslağı ve sıra seçenekleri.
function onQueueField(el, final) {
  if (el.dataset.q) {
    const k = el.dataset.q;
    const d = S.qDraft;
    if (k === 'kind') { d.kind = el.value; qSyncForm(); }
    else if (k === 'source') { if (d.kind === 'clean') d.mode = el.value; else d.source = el.value; qSyncForm(); }
    else if (k === 'count') d.count = el.value;
    else if (k === 'minutes') d.minutes = String(el.value).replace(',', '.');
    else if (k === 'target') d.target = el.value;
    return true;
  }
  if (el.dataset.qopt && final) {
    if (el.dataset.qopt === 'loop') S.queueSteps.loop = el.checked;
    if (el.dataset.qopt === 'onError') S.queueSteps.onError = el.value === 'next' ? 'next' : 'stop';
    saveQueue();
    return true;
  }
  return false;
}
document.addEventListener('input', (e) => { if (e.target.dataset && e.target.dataset.q) onQueueField(e.target, false); });

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && el.tagName !== 'INPUT') {
    const fn = ACTIONS[el.dataset.action];
    if (fn && !el.disabled) fn(el, e);
    return;
  }
  // Satırın boş bir yerine tıklamak seçim kutusunu değiştirir.
  const row = e.target.closest('.urow.selectable');
  if (row && !e.target.closest('a, button, input')) {
    const cb = $('.ucheck', row);
    if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (onQueueField(el, true)) return;
  if (el.dataset.action === 'ig-select') {
    if (el.checked) S.igSelected.add(el.dataset.id); else S.igSelected.delete(el.dataset.id);
    const row = el.closest('.urow');
    if (row) row.classList.toggle('sel', el.checked);
    renderDynamic(['igsel', 'igact']);
  } else if (el.dataset.action === 'ig-select-all') {
    const m = igModel();
    if (!m) return;
    for (const u of igVisible(m)) { if (el.checked) S.igSelected.add(u.id); else S.igSelected.delete(u.id); }
    renderDynamic(['igsel', 'iglist', 'igact']);
  }
});

// Profil resmi yüklenemezse baş harf görünür kalsın.
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.parentElement && t.parentElement.classList.contains('av')) t.remove();
}, true);

// Geri sayım, tempo çizgisi ve göreli zamanlar saniyede bir tazelenir.
setInterval(() => renderDynamic(['run', 'active', 'igact', 'pill', 'dot', 'qsteps', 'qstatus', 'qctl', 'qpill']), 1000);

load().then(renderAll);
