// Instagram görevleri: takip ettiklerini takipçilerinle karşılaştırma ve seçilen hesapları yavaş
// tempoyla takipten çıkma. Oturumu açık instagram.com sekmesinde, Instagram'ın kendi web uç
// noktalarını senin çerezlerinle çağırır; veri tarayıcı dışına gönderilmez.
// Yöntem (uç noktalar, sayfalama, engel/sınır sınıflandırması) cobanov/instagram projesinden uyarlanmıştır.
(function () {
  'use strict';
  if (!globalThis.XO || globalThis.XO_IG_LOADED) return;
  globalThis.XO_IG_LOADED = true;
  const { register, boot, wait, randInt, send, errText } = XO;

  const IG_HEADERS = { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' };
  const CHECKPOINT_TTL = 24 * 60 * 60 * 1000;
  const MAX_RETRIES = 3;
  const ERR_KEY = { rate: 'igRate', blocked: 'igBlocked', session: 'igSession', network: 'igNetwork', http: 'igHttp', limited: 'igLimited' };

  const api = (path) => location.origin + path;
  const sec = (ms) => Math.round((Number(ms) || 0) / 100) / 10;

  function cookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  class IgError extends Error {
    constructor(kind, status) { super(kind); this.kind = kind; this.status = status || 0; }
  }

  // Instagram'ın bir taramayı bitirme biçimlerini sınıflandırır: oturum düşmesi, hız sınırı,
  // engel (feedback/checkpoint/challenge — HTTP 200 olsa bile). Yalnızca ağ ve 5xx hataları yeniden denenir.
  async function igFetch(url, ctl) {
    for (let attempt = 0; ; attempt++) {
      if (ctl && !ctl.running) throw new IgError('cancelled');
      let res;
      try {
        res = await fetch(url, { credentials: 'include', headers: IG_HEADERS });
      } catch {
        if (attempt >= MAX_RETRIES) throw new IgError('network');
        await wait(Math.min(30000, 3000 * 2 ** attempt), ctl);
        continue;
      }
      const body = await res.text();
      let json = null;
      try { json = JSON.parse(body); } catch { /* aşağıda sınıflandırılır */ }
      const msg = json ? String(json.message || json.error_type || '') : body.slice(0, 2000);
      if (res.status === 401 || (json && json.require_login) || /login_required/i.test(msg)) throw new IgError('session', res.status);
      if (res.status === 429 || /rate_limit|too many requests|please wait a few minutes/i.test(msg)) throw new IgError('rate', res.status);
      if (res.status === 403 || (json && (json.spam || json.challenge || json.checkpoint_url || json.feedback_required)) ||
          /feedback_required|checkpoint_required|challenge_required/i.test(msg)) throw new IgError('blocked', res.status);
      if (res.status >= 500) {
        if (attempt >= MAX_RETRIES) throw new IgError('http', res.status);
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        await wait(retryAfter > 0 ? retryAfter : Math.min(60000, 5000 * 2 ** attempt), ctl);
        continue;
      }
      if (res.ok) {
        if (!json || typeof json !== 'object') throw new IgError('session', res.status);
        if (json.status && json.status !== 'ok') throw new IgError('http', res.status);
        return json;
      }
      throw new IgError('http', res.status);
    }
  }

  const normUser = (r) => ({
    id: String(r.pk || r.id || r.pk_id || ''),
    username: String(r.username || ''),
    name: String(r.full_name || ''),
    pic: String(r.profile_pic_url || ''),
    verified: !!r.is_verified,
    private: !!r.is_private
  });

  function listUrl(viewerId, kind, cursor, count) {
    const n = Math.min(200, Math.max(1, Math.round(Number(count) || 50)));
    const base = api(`/api/v1/friendships/${encodeURIComponent(viewerId)}/${kind}/?count=${n}`);
    return cursor ? `${base}&max_id=${encodeURIComponent(cursor)}` : base;
  }

  function freshCheckpoint(viewerId) {
    return {
      viewerId, startedAt: Date.now(), savedAt: Date.now(), stopReason: '',
      following: [], followingCursor: '', followingDone: false, followingTotal: 0,
      followers: [], followersCursor: '', followersDone: false, followersTotal: 0
    };
  }

  async function saveCheckpoint(cp) {
    cp.savedAt = Date.now();
    await chrome.storage.local.set({ igCp: cp });
  }

  async function fetchProfile(viewerId, ctl) {
    const info = await igFetch(api(`/api/v1/users/${encodeURIComponent(viewerId)}/info/`), ctl);
    return (info && info.user) || {};
  }

  // ------------------------------------------------------------------ tarama

  register('igScan', async (ctx) => {
    const ctl = ctx.ctl;
    const s = ctx.settings.ig;
    const viewerId = cookie('ds_user_id');
    if (!viewerId) { ctx.log('error', 'igNoSession'); return { status: 'error' }; }

    // Önceki tarama yarım kaldıysa (aynı hesap, 24 saat içinde) kaldığı yerden sür.
    const { igCp } = await chrome.storage.local.get('igCp');
    const resume = !ctx.rec.fresh && igCp && igCp.viewerId === viewerId && Date.now() - (igCp.savedAt || 0) < CHECKPOINT_TTL;
    const cp = resume ? igCp : freshCheckpoint(viewerId);
    cp.stopReason = '';
    if (resume) ctx.log('info', 'igScanResume', { n: cp.following.length + cp.followers.length });
    else ctx.log('info', 'igScanStart');

    let username = ctx.account.userId === viewerId ? ctx.account.username || '' : '';
    if (!cp.followingTotal) {
      try {
        const u = await fetchProfile(viewerId, ctl);
        cp.followingTotal = Number(u.following_count) || 0;
        cp.followersTotal = Number(u.follower_count) || 0;
        if (u.username) {
          username = u.username;
          send({ type: 'account', platform: 'ig', account: { userId: viewerId, username, loggedIn: true } });
        }
      } catch (e) {
        if (e.kind === 'cancelled') return pauseScan();
        // Profil bilgisi yalnızca ilerleme çubuğu için; asıl hatalar liste isteğinde yakalanır.
      }
    }
    await saveCheckpoint(cp);

    async function pauseScan() {
      await saveCheckpoint(cp);
      ctx.log('warn', 'igScanPaused');
      return { status: 'stopped' };
    }

    async function fail(e) {
      if (e.kind === 'cancelled') return pauseScan();
      cp.stopReason = e.kind;
      await saveCheckpoint(cp);
      ctx.log('error', ERR_KEY[e.kind] || 'igHttp', { status: e.status || '—' });
      return { status: 'error' };
    }

    for (const kind of ['following', 'followers']) {
      if (cp[kind + 'Done']) continue;
      ctx.log('info', 'igScanPhase', { kindKey: kind === 'following' ? 'scanFollowing' : 'scanFollowers' });
      const seen = new Set(cp[kind].map((u) => u.id));
      const cursors = new Set();
      let cursor = cp[kind + 'Cursor'] || '';
      let page = 0;
      ctx.update({ progress: { phase: kind, cur: cp[kind].length, total: cp[kind + 'Total'] } }, true);

      for (;;) {
        if (!ctl.running) return pauseScan();
        let json;
        try {
          json = await igFetch(listUrl(viewerId, kind, cursor, s.usersPerRequest), ctl);
        } catch (e) {
          // Eski oturumdan kalan imleç reddedilebilir: yalnızca bu listeyi baştan al.
          if (e.kind === 'http' && e.status === 400 && cursor) {
            cursor = ''; cp[kind] = []; seen.clear(); cursors.clear();
            continue;
          }
          return fail(e);
        }
        if (!Array.isArray(json.users)) return fail(new IgError('http'));
        if (json.should_limit_list_of_followers === true || json.should_limit_list_of_followings === true) {
          return fail(new IgError('limited'));
        }

        for (const raw of json.users) {
          const u = normUser(raw);
          if (u.id && u.username && !seen.has(u.id)) { seen.add(u.id); cp[kind].push(u); }
        }

        const next = json.next_max_id == null ? '' : String(json.next_max_id);
        if (json.has_more === true && !next) return fail(new IgError('http'));
        const finished = json.has_more === false || !next;
        if (!finished && (!json.users.length || cursors.has(next))) return fail(new IgError('http'));

        cursor = finished ? '' : next;
        cp[kind + 'Cursor'] = cursor;
        page++;
        ctx.update({ progress: { phase: kind, cur: cp[kind].length, total: cp[kind + 'Total'] } });

        if (finished) {
          cp[kind + 'Done'] = true;
          await saveCheckpoint(cp);
          break;
        }
        cursors.add(next);
        if (page % 4 === 0) await saveCheckpoint(cp);

        await wait(randInt(500, 2000), ctl);
        await wait(randInt(s.scanDelayMin, s.scanDelayMax), ctl);
        if (s.scanPauseEvery > 0 && page % s.scanPauseEvery === 0 && ctl.running) {
          await ctx.waitNext(Math.max(0, s.scanPauseMs + randInt(-5000, 5000)), 'scanPause');
        }
      }
    }

    const followerIds = new Set(cp.followers.map((u) => u.id));
    const followingIds = new Set(cp.following.map((u) => u.id));
    await chrome.storage.local.set({
      igData: { viewerId, username, scannedAt: Date.now(), following: cp.following, followers: cp.followers }
    });
    await chrome.storage.local.remove('igCp');
    ctx.log('ok', 'igScanDone', {
      following: cp.following.length,
      followers: cp.followers.length,
      non: cp.following.filter((u) => !followerIds.has(u.id)).length,
      fans: cp.followers.filter((u) => !followingIds.has(u.id)).length
    });
    return { status: 'done' };
  });

  // ------------------------------------------------------------------ takipten çıkma

  function evaluateUnfollow(status, text) {
    let payload = null;
    try { payload = JSON.parse(text); } catch { payload = null; }
    const message = String((payload && payload.message) || '');
    const blocked = (payload && (payload.feedback_required === true || payload.spam === true || payload.require_login === true)) ||
      /feedback_required|checkpoint_required|challenge_required|login_required/i.test(message);
    if (status === 401 || status === 403 || status === 429 || blocked) return { ok: false, blocked: true, reason: message || `HTTP ${status}` };
    if (status < 200 || status >= 300) return { ok: false, blocked: false, reason: message || `HTTP ${status}` };
    if (!payload) return { ok: false, blocked: false, reason: 'unexpected response' };
    if (payload.status === 'ok' || payload.friendship_status !== undefined) return { ok: true, blocked: false, reason: '' };
    return { ok: false, blocked: false, reason: message || String(payload.status || 'rejected') };
  }

  async function unfollowUser(id, ctl) {
    const csrf = cookie('csrftoken');
    const form = { 'content-type': 'application/x-www-form-urlencoded', 'x-csrftoken': csrf };
    const attempts = [
      { url: api(`/api/v1/friendships/destroy/${encodeURIComponent(id)}/`), headers: { ...IG_HEADERS, ...form } },
      { url: api(`/web/friendships/${encodeURIComponent(id)}/unfollow/`), headers: form }
    ];
    let out = { ok: false, blocked: false, reason: '' };
    for (let i = 0; i < attempts.length; i++) {
      if (i > 0) await wait(randInt(1200, 2500), ctl);
      if (!ctl.running) return { ok: false, cancelled: true };
      let res;
      try {
        res = await fetch(attempts[i].url, { method: 'POST', credentials: 'include', headers: attempts[i].headers });
      } catch (e) {
        out = { ok: false, blocked: false, reason: errText(e) || 'network error' };
        continue;
      }
      out = evaluateUnfollow(res.status, await res.text().catch(() => ''));
      if (out.ok || out.blocked) return out;
    }
    return out;
  }

  // Takipten çıkılan hesabı sonuç listesinden düş (tarama ile bu görev aynı anda çalışmaz).
  async function dropFromResults(id) {
    const { igData } = await chrome.storage.local.get('igData');
    if (!igData || !Array.isArray(igData.following)) return;
    igData.following = igData.following.filter((u) => u.id !== id);
    await chrome.storage.local.set({ igData });
  }

  register('igUnfollow', async (ctx) => {
    const ctl = ctx.ctl;
    const s = ctx.settings.ig;
    const queue = Array.isArray(ctx.rec.queue) ? ctx.rec.queue : [];
    let pos = Math.max(0, ctx.rec.pos || 0);
    const viewerId = cookie('ds_user_id');

    if (!viewerId) { ctx.log('error', 'igNoSession'); return { status: 'error' }; }
    if (ctx.rec.viewerId && ctx.rec.viewerId !== viewerId) { ctx.log('error', 'igWrongAccount'); return { status: 'error' }; }
    if (!cookie('csrftoken')) { ctx.log('error', 'igNoCsrf'); return { status: 'error' }; }

    if (pos === 0) {
      ctx.log('info', 'igUnfollowStart', { n: queue.length, min: sec(s.unfollowDelayMin), max: sec(s.unfollowDelayMax) });
    }
    let used = await ctx.dailyGet('igUnfollow');
    ctx.update({ progress: { cur: pos, total: queue.length } }, true);

    while (ctl.running && pos < queue.length) {
      if (used >= s.dailyUnfollowCap) {
        ctx.log('warn', 'igDailyCap', { cap: s.dailyUnfollowCap, rest: queue.length - pos });
        return { status: 'capped' };
      }
      const u = queue[pos];
      const out = await unfollowUser(u.id, ctl);
      if (out.cancelled) break;
      pos++;
      ctx.update({ pos, progress: { cur: pos, total: queue.length } });

      if (out.ok) {
        used = await ctx.dailyAdd('igUnfollow');
        await dropFromResults(u.id);
        await ctx.bump('done', 1, 'ok');
        ctx.log('ok', 'igUnfollowed', { n: ctx.counts.done, max: queue.length, h: u.username });
      } else {
        await ctx.bump('errors', 1, 'err');
        if (out.blocked) {
          ctx.log('error', 'igUnfollowBlocked', { h: u.username, rest: queue.length - pos });
          return { status: 'error' };
        }
        ctx.log('warn', 'igUnfollowFail', { h: u.username, reason: out.reason });
      }

      if (ctl.running && pos < queue.length) {
        await ctx.waitNext(randInt(s.unfollowDelayMin, s.unfollowDelayMax));
        if (ctl.running && s.unfollowPauseEvery > 0 && pos % s.unfollowPauseEvery === 0) {
          await ctx.waitNext(s.unfollowPauseMs, 'cooldown');
        }
      }
    }

    ctx.log('info', 'igUnfollowDone', { ok: ctx.counts.done, fail: ctx.counts.errors });
    return { status: 'done' };
  });

  // ------------------------------------------------------------------ açılış

  const viewerId = cookie('ds_user_id');
  boot('ig', { userId: viewerId, loggedIn: !!viewerId }).then(async (r) => {
    if (!r || !viewerId) return;
    const known = r.account || {};
    if (known.userId === viewerId && known.username) return;
    try {
      const u = await fetchProfile(viewerId);
      if (u.username) send({ type: 'account', platform: 'ig', account: { userId: viewerId, username: u.username, loggedIn: true } });
    } catch { /* kullanıcı adı yalnızca görüntü için */ }
  });
})();
