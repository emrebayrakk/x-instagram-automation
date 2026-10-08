// İçerik betikleri için ortak çekirdek: arka planla mesajlaşma, iptal edilebilir bekleme
// ve görev yaşam döngüsü. x.js ve instagram.js görevlerini XO.register ile buraya kaydeder.
(function (g) {
  'use strict';
  if (g.XO && g.XO.alive()) return;

  let dead = false;          // eklenti yeniden yüklendiyse bu betiğin bağlamı geçersizdir
  let tabId = null;
  const handlers = {};
  const running = new Map(); // görev kimliği -> Control

  function alive() {
    try { return !dead && !!(chrome.runtime && chrome.runtime.id); } catch { return false; }
  }

  async function send(msg) {
    if (dead) return null;
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch {
      if (!alive()) { dead = true; for (const c of running.values()) c.stop(); }
      return null;
    }
  }

  // Görevi durdurma bayrağı; durdurulunca bekleyen tüm beklemeleri hemen bitirir.
  class Control {
    constructor() { this.running = true; this.navigating = false; this.waiters = new Set(); }
    stop() {
      if (!this.running) return;
      this.running = false;
      for (const w of [...this.waiters]) w();
      this.waiters.clear();
    }
    onStop(fn) {
      if (!this.running) { fn(); return () => {}; }
      this.waiters.add(fn);
      return () => this.waiters.delete(fn);
    }
  }

  function randInt(min, max) {
    min = Math.max(0, Number(min) || 0);
    max = Math.max(min, Number(max) || min);
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Her beklemede çağrılır; sekme gizliyken sayfayı dürtmek için (x.js ayarlar).
  let tick = () => {};

  // Arka plandaki sekmede sayfa zamanlayıcıları kısılır (bir süre sonra dakikada bire kadar);
  // sekme gizliyken kısa beklemeler de arka planda tutulur.
  async function pause(ms) {
    if (!document.hidden) return sleep(ms);
    try { tick(); } catch { /* yok say */ }
    const r = await send({ type: 'timer', ms });
    if (!r) await sleep(ms);
  }

  // Uzun bekleme: süre arka planda tutulur (arka plandaki sekmelerde sayfa zamanlayıcıları
  // dakikada bire kadar kısılabilir). Görev durdurulunca hemen döner.
  function wait(ms, ctl) {
    return new Promise((resolve) => {
      let done = false;
      let off = () => {};
      const finish = () => { if (done) return; done = true; off(); resolve(); };
      off = ctl ? ctl.onStop(finish) : off;
      const end = Date.now() + Math.max(0, ms);
      (async () => {
        while (!done) {
          const left = end - Date.now();
          if (left <= 0) break;
          const chunk = Math.min(20000, left);
          if (document.hidden) { try { tick(); } catch { /* yok say */ } }
          const r = await send({ type: 'timer', ms: chunk });
          if (!r) await sleep(chunk);
        }
        finish();
      })();
    });
  }

  // fn() doğru bir değer döndürene kadar yokla; süre dolarsa ya da görev durursa null.
  async function waitFor(fn, timeout = 10000, ctl, every = 250) {
    const end = Date.now() + timeout;
    for (;;) {
      let v = null;
      try { v = fn(); } catch { v = null; }
      if (v) return v;
      if (Date.now() >= end || (ctl && !ctl.running)) return null;
      await pause(every);
    }
  }

  const errText = (e) => String((e && e.message) || e || '').slice(0, 140);

  async function makeCtx(id, ctl) {
    const st = await chrome.storage.local.get(['settings', 'tasks', 'accounts']);
    const rec = (st.tasks || {})[id];
    if (!rec || !rec.running || (tabId != null && rec.tabId !== tabId)) return null;
    const settings = xoMergeSettings(st.settings);
    // Görev sırasından başlatılan adımlar kendi kaynak/adet ayarlarını taşır.
    if (rec.overrides && typeof rec.overrides === 'object') xoMerge(settings, rec.overrides);
    const src = XO_TASKS[id];
    const counts = { done: 0, skipped: 0, errors: 0, ...(rec.counts || {}) };

    // İlerleme yamaları biriktirilip toplu gönderilir; işlem anında (tick) hemen gider.
    let patch = {};
    let timer = 0;
    async function flush(tick) {
      clearTimeout(timer);
      timer = 0;
      const p = patch;
      patch = {};
      if (!Object.keys(p).length && !tick) return;
      await send({ type: 'progress', task: id, patch: p, tick });
    }

    const ctx = {
      id, ctl, rec, settings, src, counts,
      lang: settings.general.lang,
      account: (st.accounts || {})[src] || {},
      log: (lvl, key, p) => send({ type: 'log', src, lvl, key, p }),
      update(p, now) {
        Object.assign(patch, p);
        if (now) return flush();
        if (!timer) timer = setTimeout(() => flush(), 500);
        return Promise.resolve();
      },
      bump(key, n = 1, tick) {
        counts[key] = (counts[key] || 0) + n;
        Object.assign(patch, { counts: { ...counts } });
        if (tick) return flush(tick);
        if (!timer) timer = setTimeout(() => flush(), 500);
        return Promise.resolve();
      },
      // Atlanan hesabı/gönderiyi nedeniyle birlikte say (panel en sık nedenleri gösterir).
      skip(reason) {
        if (reason) {
          counts.reasons = { ...(counts.reasons || {}) };
          counts.reasons[reason] = (counts.reasons[reason] || 0) + 1;
        }
        return ctx.bump('skipped');
      },
      flush: () => flush(),
      // Paneldeki geri sayım için bekleme süresini bildirerek bekle.
      async waitNext(ms, reason = 'next') {
        await ctx.update({ nextAt: Date.now() + ms, waitFrom: Date.now(), waitReason: reason }, true);
        await wait(ms, ctl);
        if (ctl.running) await ctx.update({ nextAt: 0 }, true);
      },
      async dailyGet(kind) {
        const r = await send({ type: 'dailyGet' });
        return (r && r.daily && r.daily[kind]) || 0;
      },
      async dailyAdd(kind) {
        const r = await send({ type: 'dailyAdd', kind });
        return (r && r.count) || 0;
      },
      async gender(name, bio) {
        const r = await send({ type: 'gender', name, bio, lang: settings.general.lang });
        return (r && r.gender) || 'unknown';
      },
      // Tam sayfa geçişi: yeni sayfadaki betik görevi kaldığı yerden devralır.
      async navigate(url) {
        const r = await send({ type: 'nav', task: id });
        if (!r || !r.ok) { ctl.stop(); return { status: 'error' }; }
        ctl.navigating = true;
        await flush();
        location.assign(url);
        return new Promise(() => {});
      }
    };
    return ctx;
  }

  async function run(id) {
    if (running.has(id) || !handlers[id] || dead) return;
    const ctl = new Control();
    running.set(id, ctl);
    let ctx = null;
    let result = null;
    try {
      ctx = await makeCtx(id, ctl);
      if (!ctx) return;
      result = await handlers[id](ctx);
    } catch (e) {
      console.error('[xo]', id, e);
      if (ctx) ctx.log('error', 'taskCrash', { e: errText(e) });
      result = { status: 'error' };
    } finally {
      running.delete(id);
      if (ctx && !ctl.navigating) {
        await ctx.flush();
        // Dışarıdan durdurulduysa kayıt zaten kapatıldı; yalnızca kendiliğinden bitişi bildir.
        if (ctl.running) await send({ type: 'taskEnd', task: id, status: (result && result.status) || 'done' });
      }
    }
  }

  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local' || !ch.tasks) return;
      const tasks = ch.tasks.newValue || {};
      for (const [id, ctl] of running) {
        const r = tasks[id];
        if (!r || !r.running || (tabId != null && r.tabId !== tabId)) ctl.stop();
      }
    });
    chrome.runtime.onMessage.addListener((msg, sender, respond) => {
      if (!msg) return false;
      if (msg.type === 'run') {
        if (msg.tabId != null) tabId = msg.tabId;
        run(msg.task);
        respond({ ok: true });
      } else if (msg.type === 'ping') {
        respond({ ok: true });
      }
      return false;
    });
  } catch { dead = true; }

  async function boot(platform, account) {
    const r = await send({ type: 'hello', platform, account });
    if (!r || !r.ok) return null;
    tabId = r.tabId;
    for (const id of r.run || []) run(id);
    return r;
  }

  g.XO = {
    alive, send, boot, wait, pause, waitFor, randInt, errText,
    register(id, fn) { handlers[id] = fn; },
    setTick(fn) { tick = typeof fn === 'function' ? fn : () => {}; },
    busy: () => running.size > 0,
    log: (src, lvl, key, p) => send({ type: 'log', src, lvl, key, p })
  };
})(globalThis);
