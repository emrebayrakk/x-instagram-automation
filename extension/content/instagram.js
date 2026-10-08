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

  // Instagram'ın varsayılan (boş) profil fotoğrafı dosyası.
  const DEFAULT_PIC = /44884218_345707102882519_2446069589734326272_n/;
  const normUser = (r) => ({
    id: String(r.pk || r.id || r.pk_id || ''),
    username: String(r.username || ''),
    name: String(r.full_name || ''),
    pic: String(r.profile_pic_url || ''),
    verified: !!r.is_verified,
    private: !!r.is_private,
    noPhoto: r.has_anonymous_profile_picture === true || DEFAULT_PIC.test(String(r.profile_pic_url || ''))
  });

  const igHistoryOps = (ops) => (ops.length ? send({ type: 'igHistory', ops }) : null);

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
    // Eklentinin takip ettiği ve artık takipçi listesinde görünen hesapları "geri takip etti" diye işaretle.
    const { igHistory = {} } = await chrome.storage.local.get('igHistory');
    igHistoryOps(cp.followers.filter((u) => { const e = igHistory[u.id]; return e && e.f && !e.u && !e.b; })
      .map((u) => ({ op: 'back', id: u.id, h: u.username })));
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

  // Görev sırasından gelen "N kişiyi bırak" adımı: listeyi son taramadan kur.
  // Korunanlar hariç; mode 'app' ise yalnızca eklentinin en az N gün önce takip ettikleri.
  async function autoQueue(ctx, viewerId) {
    const { igData, igKeep = [], igHistory = {} } = await chrome.storage.local.get(['igData', 'igKeep', 'igHistory']);
    if (!igData || igData.viewerId !== viewerId) return null;
    const keep = new Set(igKeep);
    const followers = new Set(igData.followers.map((u) => u.id));
    const minAge = Math.max(0, Number(ctx.settings.ig.unfollowMinDays) || 0) * 86400000;
    return igData.following
      .filter((u) => !followers.has(u.id) && !keep.has(u.id))
      .filter((u) => {
        if (ctx.rec.auto.mode !== 'app') return true;
        const e = igHistory[u.id];
        return e && e.f && !e.u && Date.now() - e.f >= minAge;
      })
      .slice(0, Math.max(1, Number(ctx.rec.auto.count) || 1))
      .map((u) => ({ id: u.id, username: u.username }));
  }

  register('igUnfollow', async (ctx) => {
    const ctl = ctx.ctl;
    const s = ctx.settings.ig;
    let queue = Array.isArray(ctx.rec.queue) ? ctx.rec.queue : [];
    let pos = Math.max(0, ctx.rec.pos || 0);
    const viewerId = cookie('ds_user_id');

    if (!viewerId) { ctx.log('error', 'igNoSession'); return { status: 'error' }; }
    if (ctx.rec.viewerId && ctx.rec.viewerId !== viewerId) { ctx.log('error', 'igWrongAccount'); return { status: 'error' }; }
    if (!cookie('csrftoken')) { ctx.log('error', 'igNoCsrf'); return { status: 'error' }; }

    if (ctx.rec.auto && !Array.isArray(ctx.rec.queue)) {
      const q = await autoQueue(ctx, viewerId);
      if (!q) { ctx.log('error', 'igNeedScan'); return { status: 'error' }; }
      if (!q.length) { ctx.log('info', 'igAutoEmpty'); return { status: 'done' }; }
      queue = q;
      await ctx.update({ queue }, true);
    }

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
        igHistoryOps([{ op: 'unfollow', id: u.id, h: u.username }]);
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

  // ------------------------------------------------------------------ filtreli takip

  const DAY = 86400000;
  const lcList = (a) => (a || []).map((x) => String(x).toLowerCase().trim()).filter(Boolean);
  const handleOf = (s) => String(s || '').trim().replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').split(/[/?#\s]/)[0];

  // Gönderi bağlantısındaki kısa koddan (instagram.com/p/KOD/) medya kimliğine.
  function mediaIdFromUrl(url) {
    const m = String(url || '').match(/instagram\.com\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/) ||
      String(url || '').match(/^([A-Za-z0-9_-]{6,})$/);
    if (!m) return '';
    const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let id = 0n;
    for (const c of m[1].slice(0, 11)) { const i = ABC.indexOf(c); if (i < 0) return ''; id = id * 64n + BigInt(i); }
    return id.toString();
  }

  async function profileByName(username, ctl) {
    const json = await igFetch(api(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`), ctl);
    const u = json && json.data && json.data.user;
    if (!u) throw new IgError('http', 404);
    const count = (e) => (e && typeof e.count === 'number' ? e.count : null);
    return {
      id: String(u.id || ''),
      username: String(u.username || username),
      name: String(u.full_name || ''),
      bio: String(u.biography || ''),
      followers: count(u.edge_followed_by),
      following: count(u.edge_follow),
      posts: count(u.edge_owner_to_timeline_media),
      private: !!u.is_private,
      verified: !!u.is_verified,
      business: !!(u.is_business_account || u.is_professional_account),
      noPhoto: DEFAULT_PIC.test(String(u.profile_pic_url || '')),
      followedByViewer: !!u.followed_by_viewer,
      followsViewer: !!u.follows_viewer,
      requested: !!u.requested_by_viewer
    };
  }

  // Takip edilecek adayların kaynağı; her next() çağrısı bir sayfa döndürür, bitince null.
  async function openFollowSource(ctx, s, viewerId, mine) {
    const ctl = ctx.ctl;
    if (s.sourceList === 'mine') {
      if (!mine) throw new IgError('needScan');
      const following = new Set(mine.following.map((u) => u.id));
      let given = false;
      return { label: '@' + (ctx.account.username || 'me'), listKey: 'igListMine', mine: true,
        next: async () => (given ? null : ((given = true), mine.followers.filter((u) => !following.has(u.id)))) };
    }
    if (s.sourceList === 'likers') {
      const mediaId = mediaIdFromUrl(s.postUrl);
      if (!mediaId) throw new IgError('badPost');
      let given = false;
      return { label: String(s.postUrl).replace(/^https?:\/\/(www\.)?/, '').slice(0, 60), listKey: 'igListLikers',
        next: async () => {
          if (given) return null;
          given = true;
          const json = await igFetch(api(`/api/v1/media/${mediaId}/likers/`), ctl);
          return (json.users || []).map(normUser);
        } };
    }
    const target = handleOf(s.sourceUser);
    if (!target) throw new IgError('needTarget');
    const p = await profileByName(target, ctl);
    if (p.private && !p.followedByViewer) throw new IgError('targetPrivate');
    const kind = s.sourceList === 'following' ? 'following' : 'followers';
    let cursor = '';
    let done = false;
    const seenCursors = new Set();
    return { label: '@' + target, listKey: kind === 'following' ? 'igListFollowing' : 'igListFollowers', exclude: p.id,
      next: async () => {
        if (done) return null;
        let url = api(`/api/v1/friendships/${p.id}/${kind}/?count=25&search_surface=follow_list_page`);
        if (cursor) url += `&max_id=${encodeURIComponent(cursor)}`;
        const json = await igFetch(url, ctl);
        const nextId = json.next_max_id == null ? '' : String(json.next_max_id);
        if (!nextId || json.has_more === false || seenCursors.has(nextId)) done = true;
        seenCursors.add(nextId);
        cursor = nextId;
        return (json.users || []).map(normUser);
      } };
  }

  const outside = (v, min, max) => (min > 0 || max > 0) && (v == null || (min > 0 && v < min) || (max > 0 && v > max));
  const needsDetail = (s) => !!(s.minFollowers > 0 || s.maxFollowers > 0 || s.minFollowing > 0 || s.maxFollowing > 0 ||
    s.minRatio > 0 || s.maxRatio > 0 || s.minPosts > 0 || s.requireBio || s.minBioLength > 0 ||
    lcList(s.bioInclude).length || lcList(s.bioExclude).length || s.skipBusiness);

  // Liste verisiyle yapılabilen (ek istek gerektirmeyen) eleme.
  function quickReject(u, s, f) {
    if (f.followingIds.has(u.id)) return 'following';
    if (s.skipHistory && f.history[u.id]) return 'history';
    if (!f.mine && s.skipFollowsYou && f.followerIds.has(u.id)) return 'followsYou';
    if (s.skipNoPhoto && u.noPhoto) return 'noPhoto';
    if (s.skipPrivate && u.private) return 'protected';
    if (s.verifiedMode === 'skip' && u.verified) return 'verified';
    if (s.verifiedMode === 'only' && !u.verified) return 'notVerified';
    if (s.skipBotHandles && /\d{5,}/.test(u.username)) return 'botHandle';
    const name = `${u.name} ${u.username}`.toLowerCase();
    if (f.nameIn.length && !f.nameIn.some((k) => name.includes(k))) return 'name';
    if (f.nameOut.some((k) => name.includes(k))) return 'badName';
    return null;
  }

  // Profil sayfası okunarak yapılan eleme.
  function detailReject(p, s, f) {
    if (p.followedByViewer) return 'following';
    if (p.requested) return 'pending';
    if (!f.mine && s.skipFollowsYou && p.followsViewer) return 'followsYou';
    if (s.skipNoPhoto && p.noPhoto) return 'noPhoto';
    if (s.skipBusiness && p.business) return 'business';
    if (outside(p.followers, s.minFollowers, s.maxFollowers)) return 'followers';
    if (outside(p.following, s.minFollowing, s.maxFollowing)) return 'followingCount';
    if (s.minRatio > 0 || s.maxRatio > 0) {
      if (p.followers == null || p.following == null) return 'noData';
      const r = p.followers / Math.max(1, p.following);
      if ((s.minRatio > 0 && r < s.minRatio) || (s.maxRatio > 0 && r > s.maxRatio)) return 'ratio';
    }
    if (s.minPosts > 0 && (p.posts == null || p.posts < s.minPosts)) return 'posts';
    if (s.requireBio && !p.bio) return 'noBio';
    if (s.minBioLength > 0 && p.bio.length < s.minBioLength) return 'shortBio';
    const bio = p.bio.toLowerCase();
    if (f.bioIn.length && !f.bioIn.some((k) => bio.includes(k))) return 'noKeyword';
    if (f.bioOut.some((k) => bio.includes(k))) return 'badKeyword';
    return null;
  }

  async function followUser(id, ctl) {
    const csrf = cookie('csrftoken');
    const form = { 'content-type': 'application/x-www-form-urlencoded', 'x-csrftoken': csrf };
    const body = `user_id=${encodeURIComponent(id)}`;
    const attempts = [
      { url: api(`/api/v1/friendships/create/${encodeURIComponent(id)}/`), headers: { ...IG_HEADERS, ...form } },
      { url: api(`/web/friendships/${encodeURIComponent(id)}/follow/`), headers: form }
    ];
    let out = { ok: false, blocked: false, reason: '' };
    for (let i = 0; i < attempts.length; i++) {
      if (i > 0) await wait(randInt(1200, 2500), ctl);
      if (!ctl.running) return { ok: false, cancelled: true };
      let res;
      let text = '';
      try {
        res = await fetch(attempts[i].url, { method: 'POST', credentials: 'include', headers: attempts[i].headers, body });
        text = await res.text().catch(() => '');
      } catch (e) {
        out = { ok: false, blocked: false, reason: errText(e) || 'network error' };
        continue;
      }
      out = evaluateUnfollow(res.status, text);
      if (out.ok) {
        let fs = null;
        try { fs = JSON.parse(text).friendship_status; } catch { fs = null; }
        out.requested = !!(fs && fs.outgoing_request && !fs.following);
        return out;
      }
      if (out.blocked) return out;
    }
    return out;
  }

  const IG_FOLLOW_ERR = { needScan: 'igNeedScan', badPost: 'igBadPost', needTarget: 'igNeedTarget', targetPrivate: 'igTargetPrivate' };

  register('igFollow', async (ctx) => {
    const ctl = ctx.ctl;
    const s = ctx.settings.ig.follow;
    const cap = ctx.settings.ig.dailyFollowCap;
    const viewerId = cookie('ds_user_id');
    if (!viewerId) { ctx.log('error', 'igNoSession'); return { status: 'error' }; }
    if (!cookie('csrftoken')) { ctx.log('error', 'igNoCsrf'); return { status: 'error' }; }

    const { igData, igHistory = {} } = await chrome.storage.local.get(['igData', 'igHistory']);
    const mine = igData && igData.viewerId === viewerId ? igData : null;
    const f = {
      mine: s.sourceList === 'mine',
      history: igHistory,
      followingIds: new Set(mine ? mine.following.map((u) => u.id) : []),
      followerIds: new Set(mine ? mine.followers.map((u) => u.id) : []),
      nameIn: lcList(s.nameInclude), nameOut: lcList(s.nameExclude),
      bioIn: lcList(s.bioInclude), bioOut: lcList(s.bioExclude)
    };
    const detail = needsDetail(s);

    let source;
    try {
      source = await openFollowSource(ctx, s, viewerId, mine);
    } catch (e) {
      if (e.kind === 'cancelled') return { status: 'stopped' };
      ctx.log('error', IG_FOLLOW_ERR[e.kind] || ERR_KEY[e.kind] || 'igHttp', { status: e.status || '—' });
      return { status: 'error' };
    }
    ctx.log('info', 'igFollowStart', { src: source.label, listKey: source.listKey, max: s.maxPerSession, min: sec(s.delayMin), max2: sec(s.delayMax) });
    if (!mine) ctx.log('info', 'igFollowNoScan');

    const seen = new Set();
    let used = await ctx.dailyGet('igFollow');
    let fails = 0;
    let actions = 0;

    while (ctl.running && ctx.counts.done < s.maxPerSession) {
      let batch;
      try {
        batch = await source.next();
      } catch (e) {
        if (e.kind === 'cancelled') break;
        ctx.log('error', ERR_KEY[e.kind] || 'igHttp', { status: e.status || '—' });
        return { status: 'error' };
      }
      if (batch === null) { ctx.log('warn', 'listEnd'); break; }

      for (const u of batch) {
        if (!ctl.running || ctx.counts.done >= s.maxPerSession) break;
        if (used >= cap) { ctx.log('warn', 'igFollowDailyCap', { cap }); return { status: 'capped' }; }
        if (!u.id || seen.has(u.id) || u.id === viewerId || u.id === source.exclude) continue;
        seen.add(u.id);

        let why = quickReject(u, s, f);
        let p = null;
        if (!why && detail) {
          await wait(randInt(s.lookupDelayMin, s.lookupDelayMax), ctl);
          if (!ctl.running) break;
          try {
            p = await profileByName(u.username, ctl);
            why = detailReject(p, s, f);
          } catch (e) {
            if (e.kind === 'cancelled') break;
            if (e.kind === 'rate' || e.kind === 'blocked' || e.kind === 'session') {
              ctx.log('error', ERR_KEY[e.kind], { status: e.status || '—' });
              return { status: 'error' };
            }
            why = 'noData';
          }
        }
        if (!why && s.gender && s.gender !== 'all') {
          const g = await ctx.gender(u.name || (p && p.name) || '', (p && p.bio) || '');
          if (g !== s.gender) why = 'gender';
        }
        if (why) { ctx.skip(why); continue; }

        const out = await followUser(u.id, ctl);
        if (out.cancelled) break;
        actions++;
        if (out.ok) {
          fails = 0;
          used = await ctx.dailyAdd('igFollow');
          f.followingIds.add(u.id);
          igHistoryOps([{ op: 'follow', id: u.id, h: u.username, src: source.label }]);
          await ctx.bump('done', 1, 'ok');
          ctx.log('ok', out.requested ? 'igFollowRequested' : 'igFollowed', { n: ctx.counts.done, max: s.maxPerSession, h: u.username });
        } else {
          await ctx.bump('errors', 1, 'err');
          if (out.blocked) { ctx.log('error', 'igFollowBlocked', { h: u.username }); return { status: 'error' }; }
          ctx.log('warn', 'igFollowFail', { h: u.username, reason: out.reason });
          if (++fails >= 3) { ctx.log('error', 'igFollowBlocked', { h: u.username }); return { status: 'error' }; }
        }

        if (ctl.running && ctx.counts.done < s.maxPerSession) {
          await ctx.waitNext(randInt(s.delayMin, s.delayMax));
          if (ctl.running && s.pauseEvery > 0 && actions % s.pauseEvery === 0) await ctx.waitNext(s.pauseMs, 'cooldown');
        }
      }
      // sayfalar arası tarama temposu
      if (ctl.running && ctx.counts.done < s.maxPerSession) await wait(randInt(ctx.settings.ig.scanDelayMin, ctx.settings.ig.scanDelayMax), ctl);
    }

    ctx.log('info', 'igFollowDone', { n: ctx.counts.done });
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
