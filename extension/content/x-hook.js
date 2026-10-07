// X sayfasının kendi dünyasında (MAIN) çalışır. X'in zaten yaptığı API isteklerinin yanıtlarını
// okur ve içindeki profil bilgisini (takipçi/takip/gönderi sayısı, hesap yaşı, profil ve kapak
// fotoğrafı, konum, gizlilik…) içerik betiğine iletir. Hiçbir ek istek göndermez, hiçbir şeyi değiştirmez.
(function () {
  'use strict';
  if (window.__xoHook) return;
  window.__xoHook = true;

  const TAG = 'xo-hook-v1';
  const API = /\/i\/api\/(graphql|1\.1|2)\//;
  const MAX_DEPTH = 40;

  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const bool = (...vals) => {
    for (const v of vals) if (typeof v === 'boolean') return v;
    return null;
  };

  // X'in kullanıcı nesnesi iki şemada gelebilir: eski (legacy.*) ve 2025 sonrası (core/avatar/location/privacy…).
  function pickUser(r) {
    const L = r.legacy || {};
    const C = r.core || {};
    const handle = C.screen_name || L.screen_name;
    if (!handle || typeof handle !== 'string') return null;
    const avatar = (r.avatar && r.avatar.image_url) || L.profile_image_url_https || '';
    const rel = r.relationship_perspectives || {};
    const created = Date.parse(C.created_at || L.created_at || '');
    return {
      h: handle.toLowerCase(),
      id: String(r.rest_id || ''),
      name: String(C.name || L.name || ''),
      followers: num(L.followers_count),
      following: num(L.friends_count),
      tweets: num(L.statuses_count),
      created: isFinite(created) ? created : null,
      noPhoto: L.default_profile_image === true || /default_profile/.test(avatar),
      banner: !!(L.profile_banner_url || (r.banner && r.banner.image_url)),
      protected: !!bool(r.privacy && r.privacy.protected, L.protected),
      verified: !!(r.is_blue_verified || (r.verification && r.verification.verified) || L.verified),
      location: String((r.location && r.location.location) || L.location || ''),
      bio: String(L.description || (r.profile_bio && r.profile_bio.description) || ''),
      followedBy: bool(rel.followed_by, L.followed_by),
      followingNow: bool(rel.following, L.following)
    };
  }

  function walk(node, out, depth) {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, out, depth + 1);
      return;
    }
    if ((node.__typename === 'User' || node.rest_id) && (node.legacy || node.core)) {
      const u = pickUser(node);
      if (u && !out.has(u.h)) out.set(u.h, u);
    }
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === 'object') walk(v, out, depth + 1);
    }
  }

  // İçerik betiği, X'in ilk yanıtları geldiğinde henüz dinlemiyor olabilir: son kullanıcılar
  // burada tutulur ve içerik betiği hazır olunca ("xo-hook-req") yeniden gönderilir.
  const buffer = new Map();
  const BUFFER_MAX = 3000;

  function inspect(url, text) {
    if (!API.test(url) || !text || text.length > 8e6) return;
    let json;
    try { json = JSON.parse(text); } catch { return; }
    const users = new Map();
    walk(json, users, 0);
    if (!users.size) return;
    for (const u of users.values()) {
      buffer.delete(u.h);
      buffer.set(u.h, u);
    }
    while (buffer.size > BUFFER_MAX) buffer.delete(buffer.keys().next().value);
    window.postMessage({ source: TAG, users: [...users.values()] }, location.origin);
  }

  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.source === 'xo-hook-req' && buffer.size) {
      window.postMessage({ source: TAG, users: [...buffer.values()] }, location.origin);
    }
  });

  const urlOf = (input) => (typeof input === 'string' ? input : (input && input.url) || String(input || ''));

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      const p = nativeFetch.apply(this, arguments);
      try {
        const url = urlOf(input);
        if (API.test(url)) p.then((res) => res.clone().text()).then((t) => inspect(url, t)).catch(() => {});
      } catch { /* yanıtı okumak isteğe asla engel olmasın */ }
      return p;
    };
  }

  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    const open = XHR.open;
    const sendFn = XHR.send;
    XHR.open = function (method, url) {
      try { this.__xoUrl = String(url); } catch { /* yok say */ }
      return open.apply(this, arguments);
    };
    XHR.send = function () {
      try {
        if (API.test(this.__xoUrl || '')) {
          this.addEventListener('load', () => {
            try {
              if (this.responseType === '' || this.responseType === 'text') inspect(this.__xoUrl, this.responseText);
              else if (this.responseType === 'json' && this.response) inspect(this.__xoUrl, JSON.stringify(this.response));
            } catch { /* yok say */ }
          });
        }
      } catch { /* yok say */ }
      return sendFn.apply(this, arguments);
    };
  }
})();
