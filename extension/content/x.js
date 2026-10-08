// X (Twitter) görevleri: otomatik beğeni, takipten çıkma, filtreli takip ve hesap temizliği.
// Masaüstü sürümündeki Playwright modüllerinin sayfa içi karşılığıdır: açık sekmede, sayfanın
// kendi düğmelerine tıklayarak çalışır. Sayısal profil filtreleri (takipçi, hesap yaşı…) için
// content/x-hook.js'in X'in kendi API yanıtlarından okuduğu profil verisini kullanır.
(function () {
  'use strict';
  if (!globalThis.XO || globalThis.XO_X_LOADED) return;
  globalThis.XO_X_LOADED = true;
  const { register, boot, pause, waitFor, randInt, send } = XO;

  const SEL = {
    primary: '[data-testid="primaryColumn"]',
    tweet: 'article[data-testid="tweet"]',
    tweetText: '[data-testid="tweetText"]',
    tweetAvatar: '[data-testid="Tweet-User-Avatar"] img',
    like: 'button[data-testid="like"]',
    unlike: 'button[data-testid="unlike"]',
    retweet: 'button[data-testid="retweet"]',
    unretweet: 'button[data-testid="unretweet"]',
    unretweetConfirm: '[data-testid="unretweetConfirm"]',
    social: '[data-testid="socialContext"]',
    cell: '[data-testid="UserCell"]',
    follow: 'button[data-testid$="-follow"]',
    unfollow: 'button[data-testid$="-unfollow"]',
    pending: 'button[data-testid$="-cancel"]',
    confirm: '[data-testid="confirmationSheetConfirm"]',
    followsYou: '[data-testid="userFollowIndicator"]',
    verified: '[data-testid="icon-verified"]',
    lock: '[data-testid="icon-lock"]',
    emptyState: '[data-testid="emptyState"]',
    profileLink: 'a[data-testid="AppTabBar_Profile_Link"]'
  };
  const HOOK_TAG = 'xo-hook-v1';
  const DAY = 86400000;
  // Dile bağlı yedek kontroller (asıl kontroller data-testid ile yapılır).
  const RE_REPLY = /(replying to|yanıt olarak|antwort an|en respuesta a|en réponse à|in risposta a)/i;
  const RE_FOLLOWS_YOU = /(follows you|seni takip ediyor|folgt dir|te sigue|vous suit|ti segue)/i;
  const AD_LABELS = new Set(['ad', 'promoted', 'reklam', 'sponsorlu', 'anzeige', 'gesponsert', 'anuncio',
    'promocionado', 'publicité', 'sponsorisé', 'annuncio', 'sponsorizzato']);

  const handleOf = (s) => String(s || '').trim().replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').split(/[/?#\s]/)[0];
  const onPath = (p) => location.pathname.replace(/\/+$/, '').toLowerCase() === p.toLowerCase();
  const sec = (ms) => Math.round((Number(ms) || 0) / 100) / 10;
  const lc = (x) => String(x).toLowerCase().trim();
  const words = (list) => (list || []).map(lc).filter(Boolean);
  const isDefaultAvatar = (img) => (img ? /default_profile/.test(img.getAttribute('src') || '') : null);
  // Sağ sütundaki "Kimi takip etmeli" önerilerini dışarıda bırak.
  const cells = () => [...document.querySelectorAll(SEL.cell)].filter((c) => c.closest(SEL.primary));
  const listReady = () => cells()[0] || document.querySelector(`${SEL.primary} ${SEL.emptyState}`);

  // ------------------------------------------------------------------ profil verisi

  // x-hook.js, X'in yanıtlarındaki kullanıcıları buraya iletir. Sayfadan gelen veri yalnızca filtrelemede kullanılır.
  const profiles = new Map();
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== HOOK_TAG || !Array.isArray(e.data.users)) return;
    for (const u of e.data.users) {
      if (!u || typeof u.h !== 'string') continue;
      profiles.delete(u.h);
      profiles.set(u.h, u);
      if (u.followedBy === true) noteBack(u.h);
    }
    while (profiles.size > 8000) profiles.delete(profiles.keys().next().value);
  });
  // Bu betik yüklenmeden önce gelen yanıtları kancadan yeniden iste.
  window.postMessage({ source: 'xo-hook-req' }, location.origin);
  const profileOf = (h) => profiles.get(String(h).toLowerCase()) || null;
  const profileWait = (h, ms, ctl) => (ms > 0 ? waitFor(() => profileOf(h), ms, ctl, 200) : Promise.resolve(profileOf(h)));

  // ------------------------------------------------------------------ takip geçmişi

  let history = {};
  try {
    chrome.storage.local.get('xHistory').then((d) => { history = d.xHistory || {}; }).catch(() => {});
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch.xHistory) history = ch.xHistory.newValue || {};
    });
  } catch { /* eklenti bağlamı geçersiz */ }

  const backQueue = new Set();
  const backSent = new Set();
  let backTimer = 0;
  // Eklentinin takip ettiği biri seni geri takip ediyorsa bir kez işaretle (geri dönüş oranı için).
  function noteBack(h) {
    const e = history[h];
    if (!e || !e.f || e.u || e.b || backSent.has(h)) return;
    backSent.add(h);
    backQueue.add(h);
    if (!backTimer) {
      backTimer = setTimeout(() => {
        backTimer = 0;
        const ops = [...backQueue].map((x) => ({ op: 'back', h: x }));
        backQueue.clear();
        if (ops.length) send({ type: 'history', ops });
      }, 1500);
    }
  }
  const recordHistory = (op, h, src) => send({ type: 'history', ops: [{ op, h, src }] });

  // ------------------------------------------------------------------ ortak

  // Önce profil bağlantısı, yoksa (dar pencere vb.) hesap değiştirici düğmesindeki @kullanıcı.
  function detectUsername() {
    const a = document.querySelector(SEL.profileLink);
    if (a) return handleOf((a.getAttribute('href') || '').slice(1));
    const sw = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    for (const s of sw ? sw.querySelectorAll('span') : []) {
      const t = (s.textContent || '').trim();
      if (t.startsWith('@')) return handleOf(t);
    }
    return '';
  }

  const looksSignedIn = () => !!document.querySelector(
    '[data-testid="AppTabBar_Home_Link"], [data-testid="SideNav_NewTweet_Button"], [data-testid="SideNav_AccountSwitcher_Button"]');

  async function resolveMe(ctx) {
    const me = handleOf(ctx.settings.x.username) || detectUsername() || handleOf(ctx.account.username);
    return me || handleOf(await waitFor(detectUsername, 10000, ctx.ctl));
  }

  // Anlık kaydırma: yumuşak kaydırma animasyonu, sekme görünmezken hiç ilerlemez.
  async function humanScrollTo(el) {
    el.scrollIntoView({ block: 'center' });
    await pause(randInt(450, 1000));
  }

  // Sekme gizliyken sayfanın kendi dünyasındaki x-awake.js'i dürt: X kaydırmayı görsün, listeyi uzatsın.
  let hiddenNoted = false;
  XO.setTick(() => {
    document.dispatchEvent(new CustomEvent('xo-pump'));
    if (!hiddenNoted && XO.busy()) { hiddenNoted = true; XO.log('x', 'info', 'tabHidden'); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) hiddenNoted = false; });

  const RE_RETRY = /^(retry|try again|tekrar dene|yeniden dene|erneut versuchen|wiederholen|reintentar|réessayer|riprova)$/i;

  // "Bir şeyler ters gitti" kutusundaki yeniden dene düğmesi.
  function clickRetry() {
    for (const b of document.querySelectorAll(`${SEL.primary} button, ${SEL.primary} [role="button"]`)) {
      if (RE_RETRY.test((b.textContent || '').trim())) { b.click(); return true; }
    }
    return false;
  }

  const lastOf = (sel) => {
    const all = document.querySelectorAll(sel);
    return all.length ? all[all.length - 1] : null;
  };

  // Aşağı kaydır ve X'in yeni öğe göstermesini bekle. Liste sonundaysak biraz yukarı çıkıp tekrar
  // en alta iner (X'in yükleyicisini yeniden tetikler); hata kutusu çıktıysa yeniden dener.
  // Sekme görünürken de gizliyken de çalışır (gizliyken pause() her adımda sayfayı dürter).
  async function loadMore(ctl, sel) {
    const el = document.scrollingElement || document.documentElement;
    const before = { h: el.scrollHeight, last: lastOf(sel) };
    const changed = () => el.scrollHeight !== before.h || lastOf(sel) !== before.last;
    const y = window.scrollY;
    window.scrollBy(0, randInt(700, 1100));
    if (window.scrollY - y < 80) {
      window.scrollBy(0, -randInt(300, 500));
      await pause(350);
      window.scrollTo(0, el.scrollHeight);
    }
    if (await waitFor(changed, 6000, ctl)) { await pause(randInt(300, 700)); return true; }
    if (!ctl.running) return false;
    if (clickRetry()) return !!(await waitFor(changed, 8000, ctl));
    return false;
  }

  const searchQuery = () => new URLSearchParams(location.search).get('q') || '';
  const searchUrl = (q, f) => `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=${f}`;

  // ------------------------------------------------------------------ gönderiler

  // Gönderi metninden önceki kısım (ad, tarih, "yanıt olarak" satırı); gövdedeki kelimeler yanıltmasın.
  function headText(art) {
    const full = art.innerText || '';
    const body = art.querySelector(SEL.tweetText);
    const start = body ? (body.innerText || '').trim().slice(0, 40) : '';
    const at = start ? full.indexOf(start) : -1;
    return (at >= 0 ? full.slice(0, at) : full).slice(0, 220);
  }

  function isReply(art) {
    for (const a of art.querySelectorAll('a[href^="/"]')) {
      if (!(a.textContent || '').trim().startsWith('@')) continue;
      if (a.closest('[data-testid="User-Name"], [data-testid="tweetText"]')) continue;
      return true; // "@kişi adlı kullanıcıya yanıt olarak" satırı
    }
    return RE_REPLY.test(headText(art));
  }

  function isPromoted(art) {
    if (!art.querySelector('time')) return true; // reklamlarda tarih yerine "Reklam" etiketi olur
    for (const sp of art.querySelectorAll('span')) {
      if (sp.children.length || sp.closest(SEL.tweetText)) continue;
      const t = lc(sp.textContent || '');
      if (t.length <= 14 && AD_LABELS.has(t)) return true;
    }
    return false;
  }

  function tweetInfo(art) {
    const links = [...art.querySelectorAll('a[href*="/status/"]')];
    const main = links.find((a) => a.querySelector('time')) || links[0];
    const m = (main ? main.getAttribute('href') || '' : '').match(/^\/([^/]+)\/status\/(\d+)/);
    const time = main ? main.querySelector('time') : null;
    const body = art.querySelector(SEL.tweetText);
    return {
      id: m ? m[2] : '',
      author: m ? m[1] : '',
      at: time ? Date.parse(time.getAttribute('datetime') || '') : NaN,
      text: body ? body.innerText || '' : '',
      lang: body ? body.getAttribute('lang') || '' : '',
      social: !!art.querySelector(SEL.social), // yeniden gönderi, sabitlenmiş ya da "X beğendi" gibi akış önerisi
      reply: isReply(art),
      promoted: isPromoted(art),
      likeable: !!art.querySelector(SEL.like),
      noPhoto: isDefaultAvatar(art.querySelector(SEL.tweetAvatar)),
      verified: !!art.querySelector(`[data-testid="User-Name"] ${SEL.verified}`)
    };
  }

  // ------------------------------------------------------------------ beğeni

  function likeTarget(s) {
    if (s.feed === 'search') {
      const q = String(s.query || '').trim();
      if (!q) return { error: 'likeNeedQuery' };
      return {
        url: searchUrl(q, 'live'),
        at: () => location.pathname === '/search' && searchQuery() === q,
        stay: () => location.pathname === '/search',
        log: ['feedSearch', { q }],
        sorted: true
      };
    }
    if (s.feed === 'profile') {
      const h = handleOf(s.profile);
      if (!h) return { error: 'likeNeedProfile' };
      return { url: 'https://x.com/' + h, at: () => onPath('/' + h), stay: () => onPath('/' + h), log: ['feedProfile', { h }], sorted: true };
    }
    return { url: 'https://x.com/home', at: () => onPath('/home'), stay: () => onPath('/home'), home: true };
  }

  async function selectFeed(ctx, feed) {
    const tabs = [...document.querySelectorAll(`${SEL.primary} [role="tablist"] [role="tab"]`)];
    if (tabs.length >= 2) {
      const want = feed === 'following' ? tabs[1] : tabs[0];
      if (want.getAttribute('aria-selected') !== 'true') {
        want.click();
        await pause(2500);
      }
    }
    window.scrollTo({ top: 0 });
    ctx.log('info', feed === 'following' ? 'feedFollowing' : 'feedForyou');
  }

  function likeReject(info, s, kwIn, kwOut) {
    if (!info.likeable) return 'liked';
    if (s.skipPromoted && info.promoted) return 'ad';
    if (s.skipRetweets && info.social) return 'repost';
    if (s.skipReplies && info.reply) return 'reply';
    if (s.maxAgeHours > 0 && isFinite(info.at) && Date.now() - info.at > s.maxAgeHours * 3600000) return 'old';
    const text = info.text.toLowerCase();
    if (kwIn.length && !kwIn.some((k) => text.includes(k))) return 'noKeyword';
    if (kwOut.some((k) => text.includes(k))) return 'badKeyword';
    if (s.lang && info.lang !== s.lang) return 'lang';
    const p = profileOf(info.author);
    if (s.skipNoPhoto && (p ? p.noPhoto : info.noPhoto) === true) return 'noPhoto';
    if (s.skipVerifiedAuthors && (info.verified || (p && p.verified))) return 'verified';
    return null;
  }

  register('xLike', async (ctx) => {
    const s = ctx.settings.x.like;
    const cap = ctx.settings.x.dailyLikeCap;
    const ctl = ctx.ctl;
    const tgt = likeTarget(s);
    if (tgt.error) { ctx.log('error', tgt.error); return { status: 'error' }; }
    if (!tgt.at()) return ctx.navigate(tgt.url);
    ctx.update({ navTries: 0 });
    ctx.log('info', 'likeStart', { max: s.maxPerSession, min: sec(s.minDelayMs), max2: sec(s.maxDelayMs) });

    if (!(await waitFor(() => document.querySelector(SEL.tweet) || document.querySelector(SEL.emptyState), 25000, ctl))) {
      if (ctl.running) ctx.log('error', 'timelineErr');
      return { status: 'error' };
    }
    if (tgt.home) await selectFeed(ctx, s.feed);
    else ctx.log('info', tgt.log[0], tgt.log[1]);
    await waitFor(() => document.querySelector(SEL.tweet), 15000, ctl);

    const kwIn = words(s.keywordsInclude);
    const kwOut = words(s.keywordsExclude);
    const seen = new Set();
    let used = await ctx.dailyGet('xLike');
    let idle = 0;
    let fails = 0;
    let oldStreak = 0;

    while (ctl.running && ctx.counts.done < s.maxPerSession) {
      if (!tgt.stay()) { ctx.log('warn', 'pageLeft'); return { status: 'stopped' }; }
      if (used >= cap) { ctx.log('warn', 'likeDailyCap', { cap }); return { status: 'capped' }; }

      let target = null;
      let fresh = false;
      for (const art of document.querySelectorAll(SEL.tweet)) {
        const info = tweetInfo(art);
        if (!info.id || seen.has(info.id)) continue;
        seen.add(info.id);
        fresh = true;
        const why = likeReject(info, s, kwIn, kwOut);
        // Zamana göre sıralı kaynaklarda (arama, profil) art arda eski gönderiler: daha yenisi kalmadı.
        oldStreak = why === 'old' ? oldStreak + 1 : info.social ? oldStreak : 0;
        if (why) { ctx.skip(why); continue; }
        target = { art, info };
        break;
      }

      if (tgt.sorted && oldStreak >= 10) { ctx.log('warn', 'likeEnd'); break; }
      if (!target) {
        idle = fresh ? 0 : idle + 1;
        if (idle >= 5) { ctx.log('warn', 'likeEnd'); break; }
        await loadMore(ctl, SEL.tweet);
        continue;
      }

      idle = 0;
      const { art, info } = target;
      const btn = art.querySelector(SEL.like);
      if (!btn) { ctx.skip('liked'); continue; }
      await humanScrollTo(btn);
      if (!ctl.running) break;
      btn.click();

      if (await waitFor(() => art.querySelector(SEL.unlike), 2500, ctl)) {
        fails = 0;
        used = await ctx.dailyAdd('xLike');
        await ctx.bump('done', 1, 'ok');
        ctx.log('ok', 'liked', { n: ctx.counts.done, max: s.maxPerSession, h: info.author, id: info.id });
      } else if (ctl.running) {
        fails++;
        await ctx.bump('errors', 1, 'err');
        ctx.log('warn', 'likeNotApplied', { h: info.author });
        if (fails >= 3) { ctx.log('error', 'xRateLimited'); return { status: 'error' }; }
      }

      if (ctl.running && ctx.counts.done < s.maxPerSession) await ctx.waitNext(randInt(s.minDelayMs, s.maxDelayMs));
    }

    ctx.log('info', 'likeDone', { n: ctx.counts.done });
    return { status: 'done' };
  });

  // ------------------------------------------------------------------ kullanıcı hücreleri

  // Bio = hücrenin, ad/@kullanıcı bağlantıları, düğmeler ve rozetler çıkarıldıktan sonraki metni.
  function extractBio(cell, handle) {
    const clone = cell.cloneNode(true);
    clone.querySelectorAll(`button, ${SEL.followsYou}, svg, img`).forEach((n) => n.remove());
    const own = '/' + handle.toLowerCase();
    clone.querySelectorAll('a[href]').forEach((a) => {
      if ((a.getAttribute('href') || '').toLowerCase() === own) a.remove();
    });
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function parseCell(cell) {
    let handle = '';
    for (const a of cell.querySelectorAll('a[href^="/"]')) {
      const h = a.getAttribute('href') || '';
      if (/^\/[A-Za-z0-9_]{1,15}$/.test(h)) { handle = h.slice(1); break; }
    }
    const text = cell.innerText || '';
    const first = text.split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
    const name = handle ? first.replace('@' + handle, '').trim() : first;
    const avatar = cell.querySelector('[data-testid^="UserAvatar-Container"] img') ||
      cell.querySelector('img[src*="profile_images"], img[src*="default_profile"]');
    return {
      handle,
      name,
      bio: handle ? extractBio(cell, handle) : '',
      followsYou: !!cell.querySelector(SEL.followsYou) || RE_FOLLOWS_YOU.test(text),
      verified: !!cell.querySelector(SEL.verified),
      protected: !!cell.querySelector(SEL.lock),
      noPhoto: isDefaultAvatar(avatar),
      canFollow: !!cell.querySelector(SEL.follow),
      canUnfollow: !!cell.querySelector(SEL.unfollow)
    };
  }

  // Liste sayfasında bir sonraki işlenecek hücreyi bul. pick() false dönerse hücre atlanır.
  async function nextCell(processed, pick) {
    let fresh = false;
    for (const cell of cells()) {
      const info = parseCell(cell);
      if (!info.handle) continue;
      const key = info.handle.toLowerCase();
      if (processed.has(key)) continue;
      processed.add(key);
      fresh = true;
      if (await pick(info)) return { cell, info, fresh };
    }
    return { cell: null, info: null, fresh };
  }

  // Profil verisi art arda gelmiyorsa bir kez uyar ve beklemeyi bırak (sayfa kancası çalışmıyor olabilir).
  function dataWatch(ctx) {
    let streak = 0;
    let warned = false;
    return {
      waitMs: () => (streak >= 5 ? 0 : 2000),
      hit() { streak = 0; },
      miss() {
        streak++;
        if (streak >= 15 && !warned) { warned = true; ctx.log('warn', 'xNoProfileData'); }
      }
    };
  }

  // ------------------------------------------------------------------ takipten çıkma

  async function unfollowCell(cell, ctl) {
    const btn = cell.querySelector(SEL.unfollow);
    if (!btn) return 'gone';
    await humanScrollTo(btn);
    if (!ctl.running || !btn.isConnected) return 'gone';
    btn.click();
    const sheet = await waitFor(() => document.querySelector(SEL.confirm), 6000, ctl);
    if (!sheet) return 'noconfirm';
    sheet.click();
    const done = await waitFor(() => !cell.isConnected || cell.querySelector(SEL.follow), 4000, ctl);
    return done ? 'ok' : 'fail';
  }

  register('xUnfollow', async (ctx) => {
    const s = ctx.settings.x.unfollow;
    const cap = ctx.settings.x.dailyUnfollowCap;
    const ctl = ctx.ctl;
    const user = await resolveMe(ctx);
    if (!user) { ctx.log('error', 'unfollowNeedUser'); return { status: 'error' }; }

    const path = `/${user}/following`;
    if (!onPath(path)) return ctx.navigate('https://x.com' + path);
    ctx.update({ navTries: 0 });
    ctx.log('info', 'unfollowStart', { max: s.maxPerSession, min: sec(s.minDelayMs), max2: sec(s.maxDelayMs) });

    if (!(await waitFor(listReady, 25000, ctl))) {
      if (ctl.running) ctx.log('error', 'unfollowOpenErr');
      return { status: 'error' };
    }

    const me = user.toLowerCase();
    const whitelist = new Set((s.whitelist || []).map((u) => handleOf(u).toLowerCase()).filter(Boolean));
    const data = dataWatch(ctx);
    const processed = new Set();
    let used = await ctx.dailyGet('xUnfollow');
    let idle = 0;
    let fails = 0;

    while (ctl.running && ctx.counts.done < s.maxPerSession) {
      if (!onPath(path)) { ctx.log('warn', 'pageLeft'); return { status: 'stopped' }; }
      if (used >= cap) { ctx.log('warn', 'unfollowDailyCap', { cap }); return { status: 'capped' }; }

      const { cell, info, fresh } = await nextCell(processed, async (c) => {
        const key = c.handle.toLowerCase();
        if (key === me) return false;
        let p = profileOf(key);
        const followsYou = c.followsYou || !!(p && p.followedBy);
        if (followsYou) noteBack(key);
        if (whitelist.has(key)) { ctx.skip('whitelist'); ctx.log('info', 'skipWhitelist', { h: c.handle }); return false; }
        if (!c.canUnfollow) { ctx.skip('pending'); return false; }
        const forced = s.alsoNoPhoto && (p ? p.noPhoto : c.noPhoto) === true;
        if (!forced && s.onlyNonFollowers && followsYou) { ctx.skip('followsYou'); return false; }
        if (s.keepVerified && (c.verified || (p && p.verified))) { ctx.skip('verified'); return false; }
        if (s.keepMinFollowers > 0) {
          if (!p) p = await profileWait(key, data.waitMs(), ctl);
          if (!p || p.followers == null) { data.miss(); ctx.skip('noData'); return false; }
          data.hit();
          if (p.followers >= s.keepMinFollowers) { ctx.skip('popular'); return false; }
        }
        const hist = history[key];
        const fromApp = !!(hist && hist.f && !hist.u);
        if (s.onlyHistory && !fromApp) { ctx.skip('notFromApp'); return false; }
        if (s.minDaysSinceFollow > 0 && fromApp && Date.now() - hist.f < s.minDaysSinceFollow * DAY) { ctx.skip('tooRecent'); return false; }
        return true;
      });

      if (!cell) {
        idle = fresh ? 0 : idle + 1;
        if (idle >= 5) { ctx.log('warn', 'listEnd'); break; }
        await loadMore(ctl, SEL.cell);
        continue;
      }

      idle = 0;
      const res = await unfollowCell(cell, ctl);
      if (!ctl.running) break;
      if (res === 'ok') {
        fails = 0;
        used = await ctx.dailyAdd('xUnfollow');
        recordHistory('unfollow', info.handle);
        await ctx.bump('done', 1, 'ok');
        ctx.log('ok', 'unfollowed', { n: ctx.counts.done, max: s.maxPerSession, h: info.handle });
      } else if (res === 'gone') {
        ctx.skip('gone');
        continue;
      } else {
        fails++;
        await ctx.bump('errors', 1, 'err');
        ctx.log('warn', res === 'noconfirm' ? 'confirmNotOpen' : 'unfollowNotApplied', { h: info.handle });
        if (fails >= 3) { ctx.log('error', 'xRateLimited'); return { status: 'error' }; }
      }

      if (ctl.running && ctx.counts.done < s.maxPerSession) await ctx.waitNext(randInt(s.minDelayMs, s.maxDelayMs));
    }

    ctx.log('info', 'unfollowDone', { n: ctx.counts.done });
    return { status: 'done' };
  });

  // ------------------------------------------------------------------ filtreli takip

  // Takip edilecek hesapların kaynağı: bir hesabın listeleri, kişi araması, bir gönderiyi
  // yeniden gönderenler ya da seni takip edenler (geri takip).
  function followSource(s, me) {
    if (s.sourceList === 'search') {
      const q = String(s.query || '').trim();
      if (!q) return { error: 'followNeedQuery' };
      return {
        url: searchUrl(q, 'user'),
        at: () => location.pathname === '/search' && searchQuery() === q && new URLSearchParams(location.search).get('f') === 'user',
        stay: () => location.pathname === '/search',
        src: `"${q}"`, listKey: 'listSearch'
      };
    }
    if (s.sourceList === 'retweets') {
      const m = String(s.tweetUrl || '').match(/(?:^|\/)([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)/);
      if (!m) return { error: 'followNeedTweet' };
      const path = `/${m[1]}/status/${m[2]}/retweets`;
      return { url: 'https://x.com' + path, at: () => onPath(path), stay: () => onPath(path), src: '@' + m[1], listKey: 'listRetweets', exclude: m[1].toLowerCase() };
    }
    if (s.sourceList === 'mine') {
      if (!me) return { error: 'unfollowNeedUser' };
      const path = `/${me}/followers`;
      return { url: 'https://x.com' + path, at: () => onPath(path), stay: () => onPath(path), src: '@' + me, listKey: 'listMine', mine: true };
    }
    const src = handleOf(s.sourceUser);
    if (!src) return { error: 'followNeedTarget' };
    const seg = s.sourceList === 'following' ? 'following' : s.sourceList === 'verified' ? 'verified_followers' : 'followers';
    const listKey = seg === 'following' ? 'listFollowing' : seg === 'verified_followers' ? 'listVerified' : 'listFollowers';
    const path = `/${src}/${seg}`;
    return { url: 'https://x.com' + path, at: () => onPath(path), stay: () => onPath(path), src: '@' + src, listKey, exclude: src.toLowerCase() };
  }

  // Sayısal/kapak/konum filtreleri X'in profil verisini gerektirir.
  const needsProfileData = (s) => !!(s.skipNoBanner || s.minFollowers > 0 || s.maxFollowers > 0 || s.minFollowing > 0 ||
    s.maxFollowing > 0 || s.minRatio > 0 || s.maxRatio > 0 || s.minTweets > 0 || s.minAgeDays > 0 || words(s.locationInclude).length);

  const outside = (v, min, max) => (min > 0 || max > 0) && (v == null || (min > 0 && v < min) || (max > 0 && v > max));

  async function followReject(ctx, c, s, f, data) {
    const key = c.handle.toLowerCase();
    if (!c.canFollow) return 'following'; // zaten takip ediliyor ya da istek bekliyor
    if (s.skipHistory && history[key]) return 'history';
    if (s.skipBotHandles && /\d{5,}/.test(c.handle)) return 'botHandle';
    let p = profileOf(key);
    if (!p && f.needData) p = await profileWait(key, data.waitMs(), ctx.ctl);
    if (s.skipNoPhoto && (p ? p.noPhoto : c.noPhoto) === true) return 'noPhoto';
    if (s.skipProtected && (c.protected || (p && p.protected))) return 'protected';
    const verified = c.verified || !!(p && p.verified);
    if (s.verifiedMode === 'skip' && verified) return 'verified';
    if (s.verifiedMode === 'only' && !verified) return 'notVerified';
    if (!f.mine && s.skipFollowsYou && (c.followsYou || (p && p.followedBy))) return 'followsYou';

    const bioRaw = c.bio || (p && p.bio) || '';
    if (s.requireBio && !bioRaw) return 'noBio';
    if (s.minBioLength > 0 && bioRaw.length < s.minBioLength) return 'shortBio';
    const bio = bioRaw.toLowerCase();
    if (f.bioIn.length && !f.bioIn.some((k) => bio.includes(k))) return 'noKeyword';
    if (f.bioOut.some((k) => bio.includes(k))) return 'badKeyword';
    const name = `${c.name || (p && p.name) || ''} ${key}`.toLowerCase();
    if (f.nameIn.length && !f.nameIn.some((k) => name.includes(k))) return 'name';
    if (f.nameOut.some((k) => name.includes(k))) return 'badName';

    if (f.needData) {
      if (!p) { data.miss(); return 'noData'; }
      data.hit();
      if (s.skipNoBanner && !p.banner) return 'noBanner';
      if (outside(p.followers, s.minFollowers, s.maxFollowers)) return 'followers';
      if (outside(p.following, s.minFollowing, s.maxFollowing)) return 'followingCount';
      if (s.minRatio > 0 || s.maxRatio > 0) {
        if (p.followers == null || p.following == null) return 'noData';
        const r = p.followers / Math.max(1, p.following);
        if ((s.minRatio > 0 && r < s.minRatio) || (s.maxRatio > 0 && r > s.maxRatio)) return 'ratio';
      }
      if (s.minTweets > 0 && (p.tweets == null || p.tweets < s.minTweets)) return 'tweets';
      if (s.minAgeDays > 0 && (!p.created || Date.now() - p.created < s.minAgeDays * DAY)) return 'age';
      if (f.loc.length && !f.loc.some((k) => (p.location || '').toLowerCase().includes(k))) return 'location';
    }

    if (s.gender && s.gender !== 'all') {
      const g = await ctx.gender(c.name || (p && p.name) || '', bioRaw);
      if (g !== s.gender) return 'gender';
    }
    return null;
  }

  async function followCell(cell, ctl) {
    const btn = cell.querySelector(SEL.follow);
    if (!btn) return 'gone';
    await humanScrollTo(btn);
    if (!ctl.running || !btn.isConnected) return 'gone';
    btn.click();
    // Bazı hesaplarda onay penceresi çıkar.
    const sheet = await waitFor(() => document.querySelector(SEL.confirm), 1500, ctl);
    if (sheet) sheet.click();
    const flipped = await waitFor(() => !cell.isConnected || cell.querySelector(`${SEL.unfollow}, ${SEL.pending}`), 3000, ctl);
    if (!flipped) return 'fail';
    // X sınırdayken düğmeyi kısa süre sonra geri çevirebilir.
    await pause(1200);
    if (cell.isConnected && !cell.querySelector(`${SEL.unfollow}, ${SEL.pending}`)) return 'fail';
    return 'ok';
  }

  register('xFollow', async (ctx) => {
    const s = ctx.settings.x.follow;
    const cap = ctx.settings.x.dailyFollowCap;
    const ctl = ctx.ctl;
    const me = (s.sourceList === 'mine' ? await resolveMe(ctx) : handleOf(ctx.settings.x.username) || detectUsername() || handleOf(ctx.account.username)).toLowerCase();
    const src = followSource(s, me);
    if (src.error) { ctx.log('error', src.error); return { status: 'error' }; }
    if (!src.at()) return ctx.navigate(src.url);
    ctx.update({ navTries: 0 });
    ctx.log('info', 'followStart', { src: src.src, listKey: src.listKey, max: s.maxPerSession, min: sec(s.minDelayMs), max2: sec(s.maxDelayMs) });

    if (!(await waitFor(listReady, 25000, ctl)) || !cells()[0]) {
      if (ctl.running) ctx.log('error', 'followOpenErr');
      return { status: 'error' };
    }

    const f = {
      mine: !!src.mine,
      needData: needsProfileData(s),
      bioIn: words(s.bioInclude), bioOut: words(s.bioExclude),
      nameIn: words(s.nameInclude), nameOut: words(s.nameExclude),
      loc: words(s.locationInclude)
    };
    const data = dataWatch(ctx);
    const processed = new Set();
    let used = await ctx.dailyGet('xFollow');
    let idle = 0;
    let fails = 0;

    while (ctl.running && ctx.counts.done < s.maxPerSession) {
      if (!src.stay()) { ctx.log('warn', 'pageLeft'); return { status: 'stopped' }; }
      if (used >= cap) { ctx.log('warn', 'followDailyCap', { cap }); return { status: 'capped' }; }

      const { cell, info, fresh } = await nextCell(processed, async (c) => {
        const key = c.handle.toLowerCase();
        if (key === me || key === src.exclude) return false;
        const why = await followReject(ctx, c, s, f, data);
        if (why) { ctx.skip(why); return false; }
        return true;
      });

      if (!cell) {
        idle = fresh ? 0 : idle + 1;
        if (idle >= 5) { ctx.log('warn', 'listEnd'); break; }
        await loadMore(ctl, SEL.cell);
        continue;
      }

      idle = 0;
      const res = await followCell(cell, ctl);
      if (!ctl.running) break;
      if (res === 'ok') {
        fails = 0;
        used = await ctx.dailyAdd('xFollow');
        recordHistory('follow', info.handle, src.src);
        await ctx.bump('done', 1, 'ok');
        ctx.log('ok', 'followed', { n: ctx.counts.done, max: s.maxPerSession, h: info.handle });
      } else if (res === 'gone') {
        ctx.skip('gone');
        continue;
      } else {
        fails++;
        await ctx.bump('errors', 1, 'err');
        ctx.log('warn', 'followNotApplied', { h: info.handle });
        if (fails >= 3) { ctx.log('error', 'xRateLimited'); return { status: 'error' }; }
      }

      if (ctl.running && ctx.counts.done < s.maxPerSession) await ctx.waitNext(randInt(s.minDelayMs, s.maxDelayMs));
    }

    ctx.log('info', 'followDone', { n: ctx.counts.done });
    return { status: 'done' };
  });

  // ------------------------------------------------------------------ hesap temizliği

  // Beğenileri ya da yeniden gönderileri geri alır (kendi profilinde). Silme yapmaz.
  async function undoOne(art, reposts, ctl) {
    const btn = art.querySelector(reposts ? SEL.unretweet : SEL.unlike);
    if (!btn) return 'gone';
    await humanScrollTo(btn);
    if (!ctl.running || !btn.isConnected) return 'gone';
    btn.click();
    if (reposts) {
      const item = await waitFor(() => document.querySelector(SEL.unretweetConfirm), 3000, ctl);
      if (!item) return 'fail';
      item.click();
    }
    const done = await waitFor(() => !art.isConnected || art.querySelector(reposts ? SEL.retweet : SEL.like), 3000, ctl);
    return done ? 'ok' : 'fail';
  }

  register('xClean', async (ctx) => {
    const s = ctx.settings.x.clean;
    const cap = ctx.settings.x.dailyCleanCap;
    const ctl = ctx.ctl;
    const reposts = s.mode === 'reposts';
    const user = await resolveMe(ctx);
    if (!user) { ctx.log('error', 'unfollowNeedUser'); return { status: 'error' }; }

    const path = reposts ? `/${user}` : `/${user}/likes`;
    if (!onPath(path)) return ctx.navigate('https://x.com' + path);
    ctx.update({ navTries: 0 });
    ctx.log('info', 'cleanStart', { modeKey: reposts ? 'cleanModeReposts' : 'cleanModeLikes', max: s.maxPerSession, min: sec(s.minDelayMs), max2: sec(s.maxDelayMs) });

    if (!(await waitFor(() => document.querySelector(SEL.tweet) || document.querySelector(SEL.emptyState), 25000, ctl))) {
      if (ctl.running) ctx.log('error', 'cleanOpenErr');
      return { status: 'error' };
    }

    const btnSel = reposts ? SEL.unretweet : SEL.unlike;
    const seen = new Set();
    let used = await ctx.dailyGet('xClean');
    let idle = 0;
    let fails = 0;

    while (ctl.running && ctx.counts.done < s.maxPerSession) {
      if (!onPath(path)) { ctx.log('warn', 'pageLeft'); return { status: 'stopped' }; }
      if (used >= cap) { ctx.log('warn', 'cleanDailyCap', { cap }); return { status: 'capped' }; }

      let target = null;
      let fresh = false;
      for (const art of document.querySelectorAll(SEL.tweet)) {
        const info = tweetInfo(art);
        if (!info.id || seen.has(info.id)) continue;
        seen.add(info.id);
        fresh = true;
        if (!art.querySelector(btnSel)) { ctx.skip(reposts ? 'notRepost' : 'notLiked'); continue; }
        if (s.olderThanDays > 0 && isFinite(info.at) && Date.now() - info.at < s.olderThanDays * DAY) { ctx.skip('tooNew'); continue; }
        target = { art, info };
        break;
      }

      if (!target) {
        idle = fresh ? 0 : idle + 1;
        if (idle >= 5) { ctx.log('warn', 'listEnd'); break; }
        await loadMore(ctl, SEL.tweet);
        continue;
      }

      idle = 0;
      const res = await undoOne(target.art, reposts, ctl);
      if (!ctl.running) break;
      if (res === 'ok') {
        fails = 0;
        used = await ctx.dailyAdd('xClean');
        await ctx.bump('done', 1, 'ok');
        ctx.log('ok', 'cleaned', { n: ctx.counts.done, max: s.maxPerSession, h: target.info.author });
      } else if (res === 'gone') {
        ctx.skip('gone');
        continue;
      } else {
        fails++;
        await ctx.bump('errors', 1, 'err');
        ctx.log('warn', 'cleanNotApplied', { h: target.info.author });
        if (fails >= 3) { ctx.log('error', 'xRateLimited'); return { status: 'error' }; }
      }

      if (ctl.running && ctx.counts.done < s.maxPerSession) await ctx.waitNext(randInt(s.minDelayMs, s.maxDelayMs));
    }

    ctx.log('info', 'cleanDone', { n: ctx.counts.done });
    return { status: 'done' };
  });

  // ------------------------------------------------------------------ açılış

  boot('x').then(async (r) => {
    if (!r) return;
    const name = await waitFor(detectUsername, 30000, null, 1000);
    const known = r.account || {};
    const account = { username: name || '', loggedIn: !!name || looksSignedIn() };
    if (account.username !== known.username || account.loggedIn !== known.loggedIn) {
      send({ type: 'account', platform: 'x', account });
    }
  });

})();
