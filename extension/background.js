// X Otomasyon — arka plan servis çalışanı.
// Görev kayıtları, günlük sayaçlar, işlem kaydı ve görev sırası için tek yazıcıdır; yan panel ile
// içerik betikleri arasında köprü kurar. Otomasyonun kendisi ilgili sitenin sekmesinde çalışır.
importScripts('lib/defaults.js', 'lib/gender.js');

const LOG_LIMIT = 500;
const TICK_LIMIT = 80;
const MAX_NAV_TRIES = 3;
const HISTORY_LIMIT = 30000;
const HOME = { x: 'https://x.com/home', ig: 'https://www.instagram.com/' };
const MATCH = { x: ['https://x.com/*', 'https://twitter.com/*'], ig: ['https://www.instagram.com/*'] };
// İçerik betiğinin görev kaydına yazabileceği alanlar (running/status/tabId arka plana aittir).
const PATCHABLE = ['counts', 'nextAt', 'waitFrom', 'waitReason', 'progress', 'pos', 'navTries', 'queue'];
// Görev başlatılırken verilebilecek ek alanlar.
const PAYLOAD = ['queue', 'viewerId', 'fresh', 'overrides', 'queueStep', 'auto'];

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ---- Sıralı depolama yazımı: aynı anahtara iki yerden yazılırken veri kaybolmasın ----
let chain = Promise.resolve();
function mutate(keys, fn) {
  const run = chain.then(async () => {
    const data = await chrome.storage.local.get(keys);
    const out = await fn(data);
    if (out) await chrome.storage.local.set(out);
  });
  chain = run.catch((e) => console.error('[xo] storage', e));
  return run;
}

function pushLog(logs, src, lvl, key, p) {
  logs.push({ t: Date.now(), src, lvl, key, p: p || {} });
  if (logs.length > LOG_LIMIT) logs.splice(0, logs.length - LOG_LIMIT);
}

function addLog(src, lvl, key, p) {
  return mutate(['logs'], ({ logs = [] }) => { pushLog(logs, src, lvl, key, p); return { logs }; });
}

function finish(rec, status) {
  return { ...rec, running: false, status, endedAt: Date.now(), nextAt: 0 };
}

const senderTab = (sender) => (sender && sender.tab ? sender.tab.id : null);

// ---- Sekme bulma: önce bu pencerenin etkin sekmesi, sonra en son kullanılan, yoksa yeni sekme ----
async function resolveTab(platform) {
  const tabs = await chrome.tabs.query({ url: MATCH[platform] });
  if (tabs.length) {
    const win = await chrome.windows.getLastFocused().catch(() => null);
    const pick =
      tabs.find((t) => t.active && win && t.windowId === win.id) ||
      tabs.find((t) => t.active) ||
      tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    return { tab: pick, created: false };
  }
  const tab = await chrome.tabs.create({ url: HOME[platform], active: true });
  return { tab, created: true };
}

async function focusTab(tab) {
  await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
}

// ---- Görev başlat / durdur (panel ve görev sırası ortak kullanır) ----
async function startTask(task, payload) {
  const platform = XO_TASKS[task];
  if (!platform) return { ok: false, error: 'errUnknownTask' };

  const { tasks: current = {} } = await chrome.storage.local.get('tasks');
  const busy = Object.keys(current).find((id) => current[id].running && XO_TASKS[id] === platform);
  if (busy) return { ok: false, error: 'errPlatformBusy', p: { task: busy } };

  const { tab, created } = await resolveTab(platform);
  const rec = {
    running: true, status: 'running', tabId: tab.id, startedAt: Date.now(), endedAt: 0,
    counts: { done: 0, skipped: 0, errors: 0 }, ticks: [], nextAt: 0, navTries: 0, pos: 0, progress: null
  };
  for (const k of PAYLOAD) if (payload && k in payload) rec[k] = payload[k];

  let refused = null;
  await mutate(['tasks', 'logs'], ({ tasks = {}, logs = [] }) => {
    const again = Object.keys(tasks).find((id) => tasks[id].running && XO_TASKS[id] === platform);
    if (again) { refused = again; return null; }
    tasks[task] = rec;
    pushLog(logs, platform, 'info', 'taskStarted', { task });
    return { tasks, logs };
  });
  if (refused) return { ok: false, error: 'errPlatformBusy', p: { task: refused } };

  await focusTab(tab);
  if (!created) {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'run', task, tabId: tab.id }); }
    catch { await chrome.tabs.reload(tab.id).catch(() => {}); } // betik yoksa (eski sekme) yenile; yüklenince görevi devralır
  }
  return { ok: true, tabId: tab.id };
}

async function stopTask(task) {
  let ended = null;
  await mutate(['tasks', 'logs'], ({ tasks = {}, logs = [] }) => {
    const rec = tasks[task];
    if (!rec || !rec.running) return null;
    tasks[task] = finish(rec, 'stopped');
    pushLog(logs, XO_TASKS[task], 'warn', 'taskStopped', { task });
    ended = rec;
    return { tasks, logs };
  });
  if (ended) queueOnTaskEnd(task, 'stopped', ended);
  return { ok: !!ended };
}

// ---------------------------------------------------------------- görev sırası
// queueSteps (panelin yazdığı): { steps: [{ id, kind, count, source, target, mode, minutes }], loop, onError }
// queueRun (yalnızca burada yazılır): { running, index, phase: 'task'|'wait'|'retry', stepId, waitFrom, waitUntil, cycle, done, status }

const QUEUE_ALARM = 'xo-queue';
const QUEUE_TASK = {
  follow: 'xFollow', like: 'xLike', unfollow: 'xUnfollow', clean: 'xClean',
  igfollow: 'igFollow', igscan: 'igScan', igunfollow: 'igUnfollow'
};
const RETRY_MS = 60000;

// Sıra işlemleri birbirini beklesin: bir adım biterken yenisi aynı anda başlamasın.
let queueLock = Promise.resolve();
function queueSerial(fn) {
  const r = queueLock.then(fn);
  queueLock = r.catch((e) => console.error('[xo] queue', e));
  return r;
}

async function readQueue() {
  const { queueSteps, queueRun } = await chrome.storage.local.get(['queueSteps', 'queueRun']);
  return { cfg: queueSteps || { steps: [] }, run: queueRun || null };
}
const saveRun = (run) => chrome.storage.local.set({ queueRun: run });

// Adımın kendi kaynak/adet ayarları; diğer filtreler modül ayarlarından gelir.
function stepOverrides(step) {
  const n = Math.max(1, Math.round(Number(step.count) || 1));
  const target = String(step.target || '').trim();
  if (step.kind === 'follow') {
    const f = { sourceList: step.source || 'followers', maxPerSession: n };
    if (f.sourceList === 'search') f.query = target;
    else if (f.sourceList === 'retweets') f.tweetUrl = target;
    else if (f.sourceList !== 'mine') f.sourceUser = target;
    return { x: { follow: f } };
  }
  if (step.kind === 'like') {
    const l = { feed: step.source || 'following', maxPerSession: n };
    if (l.feed === 'search') l.query = target;
    if (l.feed === 'profile') l.profile = target;
    return { x: { like: l } };
  }
  if (step.kind === 'unfollow') return { x: { unfollow: { maxPerSession: n } } };
  if (step.kind === 'clean') return { x: { clean: { mode: step.mode === 'reposts' ? 'reposts' : 'likes', maxPerSession: n } } };
  if (step.kind === 'igfollow') {
    const f = { sourceList: step.source || 'followers', maxPerSession: n };
    if (f.sourceList === 'likers') f.postUrl = target;
    else if (f.sourceList !== 'mine') f.sourceUser = target;
    return { ig: { follow: f } };
  }
  return null;
}

// Adımın görev kaydına geçen ek alanları (ayar dışı).
function stepPayload(step) {
  const n = Math.max(1, Math.round(Number(step.count) || 1));
  if (step.kind === 'igscan') return { fresh: true };
  if (step.kind === 'igunfollow') return { auto: { count: n, mode: step.source === 'app' ? 'app' : 'all' } };
  return {};
}

async function endQueue(run, status, key, p) {
  chrome.alarms.clear(QUEUE_ALARM).catch(() => {});
  Object.assign(run, { running: false, phase: null, status, endedAt: Date.now(), waitUntil: 0 });
  await saveRun(run);
  if (key) await addLog('x', status === 'done' ? 'ok' : status === 'error' ? 'error' : 'warn', key, p);
}

// Sıradaki adımı başlat (queueSerial içinden çağrılır).
async function runStep() {
  const { cfg, run } = await readQueue();
  if (!run || !run.running) return;
  const steps = cfg.steps || [];
  let guard = 0;
  while (run.index < steps.length && !QUEUE_TASK[steps[run.index].kind] && steps[run.index].kind !== 'wait' && guard++ < 100) run.index++;

  if (run.index >= steps.length) {
    if (cfg.loop && steps.some((s) => QUEUE_TASK[s.kind])) {
      run.index = 0;
      run.cycle = (run.cycle || 1) + 1;
      run.done = {};
      await addLog('x', 'info', 'queueLoop', { n: run.cycle });
    } else {
      return endQueue(run, 'done', 'queueDone');
    }
  }

  const step = steps[run.index];
  const now = Date.now();
  run.stepId = step.id;
  if (step.kind === 'wait') {
    const min = Math.max(0.5, Number(step.minutes) || 1);
    Object.assign(run, { phase: 'wait', waitFrom: now, waitUntil: now + min * 60000 });
    await saveRun(run);
    chrome.alarms.create(QUEUE_ALARM, { when: run.waitUntil });
    await addLog('x', 'info', 'queueWait', { m: min, n: run.index + 1, total: steps.length });
    return;
  }

  const task = QUEUE_TASK[step.kind];
  const r = await startTask(task, { ...stepPayload(step), overrides: stepOverrides(step), queueStep: step.id });
  if (!r.ok) {
    if (r.error === 'errPlatformBusy') {
      // Elle başlatılmış bir görev çalışıyor: bir dakika sonra yeniden dene.
      Object.assign(run, { phase: 'retry', waitFrom: now, waitUntil: now + RETRY_MS });
      await saveRun(run);
      chrome.alarms.create(QUEUE_ALARM, { when: run.waitUntil });
      await addLog('x', 'warn', 'queueBusy', { task: r.p && r.p.task });
      return;
    }
    return endQueue(run, 'error', 'queueStartFail', { e: r.error || '' });
  }
  Object.assign(run, { phase: 'task', waitUntil: 0 });
  await saveRun(run);
  await addLog('x', 'info', 'queueStep', { n: run.index + 1, total: steps.length, task });
}

// Bir görev bittiğinde: sıradaki adıma geç ya da sırayı durdur.
function queueOnTaskEnd(task, status, rec) {
  return queueSerial(async () => {
    const { cfg, run } = await readQueue();
    if (!run || !run.running || run.phase !== 'task' || !rec || rec.queueStep !== run.stepId) return;
    run.done = { ...(run.done || {}), [run.stepId]: status };
    if (status === 'done') {
      run.index++;
      await saveRun(run);
      return runStep();
    }
    if (status === 'stopped') return endQueue(run, 'stopped', 'queueStopped');
    if (cfg.onError === 'next') {
      await addLog('x', 'warn', 'queueSkipStep', { n: run.index + 1, st: status });
      run.index++;
      await saveRun(run);
      return runStep();
    }
    return endQueue(run, 'error', 'queueHalted', { n: run.index + 1, st: status });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== QUEUE_ALARM) return;
  queueSerial(async () => {
    const { run } = await readQueue();
    if (!run || !run.running) return;
    if (run.phase === 'wait') {
      run.done = { ...(run.done || {}), [run.stepId]: 'done' };
      run.index++;
      await saveRun(run);
      return runStep();
    }
    if (run.phase === 'retry') return runStep();
  });
});

// ---- Mesajlar ----
const HANDLERS = {
  // İçerik betiği yüklendi: hesabı kaydet, bu sekmeye ait yarım kalmış görevleri devret.
  async hello(msg, sender) {
    const tabId = senderTab(sender);
    const platform = msg.platform;
    let before = {};
    const run = [];
    await mutate(['tasks', 'accounts'], ({ tasks = {}, accounts = {} }) => {
      before = accounts[platform] || {};
      let acc = before;
      // Farklı bir hesaba geçilmişse eski kullanıcı adını taşıma.
      if (msg.account && 'userId' in msg.account && msg.account.userId !== before.userId) acc = {};
      accounts[platform] = { ...acc, ...(msg.account || {}), tabId, seenAt: Date.now() };
      for (const [id, rec] of Object.entries(tasks)) {
        if (rec.running && rec.tabId === tabId && XO_TASKS[id] === platform) run.push(id);
      }
      return { accounts };
    });
    return { ok: true, tabId, run, account: before };
  },

  async account(msg, sender) {
    const tabId = senderTab(sender);
    await mutate(['accounts'], ({ accounts = {} }) => {
      accounts[msg.platform] = { ...(accounts[msg.platform] || {}), ...(msg.account || {}), tabId, seenAt: Date.now() };
      return { accounts };
    });
  },

  async log(msg) {
    await addLog(msg.src || 'sys', msg.lvl || 'info', msg.key, msg.p);
  },

  async progress(msg, sender) {
    const tabId = senderTab(sender);
    await mutate(['tasks'], ({ tasks = {} }) => {
      const rec = tasks[msg.task];
      if (!rec || rec.tabId !== tabId) return null;
      const next = { ...rec };
      for (const k of PATCHABLE) if (msg.patch && k in msg.patch) next[k] = msg.patch[k];
      if (msg.tick) next.ticks = [...(rec.ticks || []), { t: Date.now(), k: msg.tick }].slice(-TICK_LIMIT);
      tasks[msg.task] = next;
      return { tasks };
    });
  },

  async taskEnd(msg, sender) {
    const tabId = senderTab(sender);
    const status = msg.status || 'done';
    let ended = null;
    await mutate(['tasks'], ({ tasks = {} }) => {
      const rec = tasks[msg.task];
      if (!rec || !rec.running || rec.tabId !== tabId) return null;
      tasks[msg.task] = finish(rec, status);
      ended = rec;
      return { tasks };
    });
    if (ended) queueOnTaskEnd(msg.task, status, ended);
  },

  // Görev sayfasına gitmeden önce: sonsuz yönlendirme döngüsüne karşı sayaç.
  async nav(msg, sender) {
    const tabId = senderTab(sender);
    let ok = false;
    let failed = null;
    await mutate(['tasks', 'logs'], ({ tasks = {}, logs = [] }) => {
      const rec = tasks[msg.task];
      if (!rec || !rec.running || rec.tabId !== tabId) return null;
      const tries = (rec.navTries || 0) + 1;
      if (tries > MAX_NAV_TRIES) {
        tasks[msg.task] = finish(rec, 'error');
        pushLog(logs, XO_TASKS[msg.task], 'error', 'navFail', { task: msg.task });
        failed = rec;
        return { tasks, logs };
      }
      tasks[msg.task] = { ...rec, navTries: tries };
      ok = true;
      return { tasks };
    });
    if (failed) queueOnTaskEnd(msg.task, 'error', failed);
    return { ok };
  },

  async dailyGet() {
    const { daily } = await chrome.storage.local.get('daily');
    return { ok: true, daily: xoFreshDaily(daily) };
  },

  async dailyAdd(msg) {
    let count = 0;
    await mutate(['daily'], ({ daily }) => {
      const d = { ...xoFreshDaily(daily) };
      d[msg.kind] = (d[msg.kind] || 0) + (msg.n || 1);
      count = d[msg.kind];
      return { daily: d };
    });
    return { ok: true, count };
  },

  // X takip geçmişi: { kullanıcı: { f: takip zamanı, u: bırakma zamanı, b: geri takip görüldü, s: kaynak } }
  async history(msg) {
    const ops = Array.isArray(msg.ops) ? msg.ops.slice(0, 500) : [];
    if (!ops.length) return { ok: true };
    await mutate(['xHistory'], ({ xHistory = {} }) => {
      const now = Date.now();
      let changed = false;
      for (const o of ops) {
        const h = String((o && o.h) || '').toLowerCase();
        if (!/^[a-z0-9_]{1,15}$/.test(h)) continue;
        const e = { ...(xHistory[h] || {}) };
        if (o.op === 'follow') {
          e.f = now;
          delete e.u;
          delete e.b;
          if (o.src) e.s = String(o.src).slice(0, 80);
        } else if (o.op === 'unfollow') {
          e.u = now;
        } else if (o.op === 'back') {
          if (!e.f || e.b) continue;
          e.b = now;
        } else continue;
        xHistory[h] = e;
        changed = true;
      }
      if (!changed) return null;
      const keys = Object.keys(xHistory);
      if (keys.length > HISTORY_LIMIT) {
        const last = (h) => Math.max(xHistory[h].f || 0, xHistory[h].u || 0);
        keys.sort((a, b) => last(a) - last(b));
        for (const h of keys.slice(0, keys.length - HISTORY_LIMIT)) delete xHistory[h];
      }
      return { xHistory };
    });
    return { ok: true };
  },

  // Instagram takip geçmişi (kullanıcı kimliğine göre): { id: { h: kullanıcı adı, f, u, b, s } }
  async igHistory(msg) {
    const ops = Array.isArray(msg.ops) ? msg.ops.slice(0, 2000) : [];
    if (!ops.length) return { ok: true };
    await mutate(['igHistory'], ({ igHistory = {} }) => {
      const now = Date.now();
      let changed = false;
      for (const o of ops) {
        const id = String((o && o.id) || '');
        if (!/^\d{1,25}$/.test(id)) continue;
        const e = { ...(igHistory[id] || {}) };
        if (o.h) e.h = String(o.h).slice(0, 40);
        if (o.op === 'follow') {
          e.f = now;
          delete e.u;
          delete e.b;
          if (o.src) e.s = String(o.src).slice(0, 80);
        } else if (o.op === 'unfollow') {
          e.u = now;
        } else if (o.op === 'back') {
          if (!e.f || e.b) continue;
          e.b = now;
        } else continue;
        igHistory[id] = e;
        changed = true;
      }
      if (!changed) return null;
      const keys = Object.keys(igHistory);
      if (keys.length > HISTORY_LIMIT) {
        const last = (k) => Math.max(igHistory[k].f || 0, igHistory[k].u || 0);
        keys.sort((a, b) => last(a) - last(b));
        for (const k of keys.slice(0, keys.length - HISTORY_LIMIT)) delete igHistory[k];
      }
      return { igHistory };
    });
    return { ok: true };
  },

  async gender(msg) {
    try { return { ok: true, gender: await xoGuessGender(msg.name, msg.bio, msg.lang) }; }
    catch { return { ok: true, gender: 'unknown' }; }
  },

  // Sayfa zamanlayıcıları arka plandaki sekmelerde kısılır; bekleme burada tutulur.
  timer(msg) {
    const ms = Math.max(0, Math.min(25000, Number(msg.ms) || 0));
    return new Promise((resolve) => setTimeout(() => resolve({ ok: true }), ms));
  },

  // ---- Yan panelden ----
  start(msg) {
    return startTask(msg.task, msg.payload);
  },

  stop(msg) {
    return stopTask(msg.task);
  },

  queueStart(msg) {
    return queueSerial(async () => {
      const { cfg, run } = await readQueue();
      if (run && run.running) return { ok: true };
      const steps = cfg.steps || [];
      if (!steps.some((s) => QUEUE_TASK[s.kind])) return { ok: false, error: 'qNeedSteps' };
      const from = Math.max(0, Math.min(steps.length - 1, Number(msg.from) || 0));
      await saveRun({ running: true, status: 'running', index: from, phase: null, cycle: 1, done: {}, startedAt: Date.now(), endedAt: 0 });
      await addLog('x', 'info', 'queueStarted', { n: steps.length });
      await runStep();
      return { ok: true };
    });
  },

  queueStop() {
    return queueSerial(async () => {
      const { run } = await readQueue();
      if (!run || !run.running) return { ok: false };
      const phase = run.phase;
      const stepId = run.stepId;
      await endQueue(run, 'stopped', 'queueStopped');
      if (phase === 'task') {
        const { tasks = {} } = await chrome.storage.local.get('tasks');
        for (const [id, rec] of Object.entries(tasks)) if (rec.running && rec.queueStep === stepId) await stopTask(id);
      }
      return { ok: true };
    });
  },

  // Bekleme adımını beklemeden geç.
  queueSkipWait() {
    return queueSerial(async () => {
      const { run } = await readQueue();
      if (!run || !run.running || (run.phase !== 'wait' && run.phase !== 'retry')) return { ok: false };
      chrome.alarms.clear(QUEUE_ALARM).catch(() => {});
      if (run.phase === 'wait') {
        run.done = { ...(run.done || {}), [run.stepId]: 'done' };
        run.index++;
        await saveRun(run);
      }
      await runStep();
      return { ok: true };
    });
  },

  async openTab(msg) {
    if (!MATCH[msg.platform]) return { ok: false };
    const { tab } = await resolveTab(msg.platform);
    await focusTab(tab);
    return { ok: true };
  },

  async clearLogs() {
    await mutate(['logs'], () => ({ logs: [] }));
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fn = msg && HANDLERS[msg.type];
  if (!fn) return false;
  Promise.resolve()
    .then(() => fn(msg, sender))
    .then((r) => sendResponse(r || { ok: true }), (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});

// Görevin sekmesi kapanırsa görevi durdur.
chrome.tabs.onRemoved.addListener((tabId) => {
  const ended = [];
  mutate(['tasks', 'accounts', 'logs'], ({ tasks = {}, accounts = {}, logs = [] }) => {
    let changed = false;
    for (const [id, rec] of Object.entries(tasks)) {
      if (rec.running && rec.tabId === tabId) {
        tasks[id] = finish(rec, 'stopped');
        pushLog(logs, XO_TASKS[id], 'warn', 'tabClosed', { task: id });
        ended.push([id, rec]);
        changed = true;
      }
    }
    for (const p of Object.keys(accounts)) {
      if (accounts[p] && accounts[p].tabId === tabId) { accounts[p] = { ...accounts[p], tabId: null }; changed = true; }
    }
    return changed ? { tasks, accounts, logs } : null;
  }).then(() => { for (const [id, rec] of ended) queueOnTaskEnd(id, 'stopped', rec); });
});

// Görev süren sekmeyi Chrome'un bellek tasarrufu arka planda atmasın (sekme boşaltılırsa görev kesilir).
const runningTabs = (tasks) => new Set(Object.values(tasks || {}).filter((r) => r && r.running && r.tabId != null).map((r) => r.tabId));
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || !ch.tasks) return;
  const before = runningTabs(ch.tasks.oldValue);
  const now = runningTabs(ch.tasks.newValue);
  for (const id of now) if (!before.has(id)) chrome.tabs.update(id, { autoDiscardable: false }).catch(() => {});
  for (const id of before) if (!now.has(id)) chrome.tabs.update(id, { autoDiscardable: true }).catch(() => {});
});

// Kurulum, güncelleme ya da tarayıcı açılışı: yarım kalan görevler ve sıra artık sahipsizdir.
async function init(reason) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.alarms.clear(QUEUE_ALARM).catch(() => {});
  const open = new Set((await chrome.tabs.query({}).catch(() => [])).map((t) => t.id));
  await mutate(['settings', 'tasks', 'accounts', 'queueRun'], ({ settings, tasks = {}, accounts = {}, queueRun }) => {
    const merged = xoMergeSettings(settings);
    if (!settings && reason === 'install') {
      const ui = (chrome.i18n.getUILanguage() || 'tr').slice(0, 2).toLowerCase();
      if (['tr', 'en', 'de', 'es', 'fr', 'it'].includes(ui)) merged.general.lang = ui;
    }
    for (const id of Object.keys(tasks)) if (tasks[id].running) tasks[id] = finish(tasks[id], 'stopped');
    // Tarayıcı yeniden açıldığında sekme kimlikleri baştan dağıtılır; eskileri geçersizdir.
    for (const p of Object.keys(accounts)) {
      if (accounts[p] && (reason === 'startup' || !open.has(accounts[p].tabId))) accounts[p] = { ...accounts[p], tabId: null };
    }
    const out = { settings: merged, tasks, accounts };
    if (queueRun && queueRun.running) out.queueRun = { ...queueRun, running: false, phase: null, status: 'stopped', endedAt: Date.now() };
    return out;
  });
}

chrome.runtime.onInstalled.addListener((d) => { init(d.reason); });
chrome.runtime.onStartup.addListener(() => { init('startup'); });
