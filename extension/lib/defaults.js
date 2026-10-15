// Varsayılan ayarlar ve küçük ortak yardımcılar.
// Arka plan, yan panel ve içerik betikleri bu dosyayı aynen paylaşır (klasik betik, global atar).
(function (g) {
  'use strict';

  const DEFAULTS = {
    general: {
      lang: 'tr',               // arayüz + kayıt + cinsiyet tahmini dili (tr, en, de, es, fr, it)
      theme: 'auto',            // 'auto' | 'light' | 'dark'
      noticeDismissed: false    // ilk açılıştaki kullanım uyarısı kapatıldı mı
    },
    x: {
      username: '',             // boşsa açık X sekmesinden algılanır
      dailyLikeCap: 200,
      dailyUnfollowCap: 150,
      dailyFollowCap: 100,
      dailyCleanCap: 300,
      like: {
        minDelayMs: 4000,
        maxDelayMs: 9000,
        maxPerSession: 50,
        feed: 'following',      // 'following' | 'foryou' | 'search' (anahtar kelime) | 'profile' (bir hesabın gönderileri)
        query: '',              // feed = 'search' için
        profile: '',            // feed = 'profile' için
        skipRetweets: true,
        skipReplies: false,
        skipPromoted: true,
        keywordsInclude: [],    // gönderi bu kelimelerden birini içermeli (boşsa filtre yok)
        keywordsExclude: [],
        maxAgeHours: 0,         // 0 = sınır yok
        lang: '',               // '' = fark etmez; aksi halde X'in gönderiye verdiği dil kodu (tr, en…)
        skipNoPhoto: false,     // profil fotoğrafı olmayan yazarları geç
        skipVerifiedAuthors: false
      },
      unfollow: {
        minDelayMs: 6000,
        maxDelayMs: 14000,
        maxPerSession: 30,
        onlyNonFollowers: true,
        alsoNoPhoto: false,     // profil fotoğrafı olmayanları seni takip etse bile bırak
        keepVerified: false,
        keepMinFollowers: 0,    // bu kadar ya da daha çok takipçisi olanları bırakma (0 = kapalı)
        onlyHistory: false,     // yalnızca bu eklentinin takip ettiklerini bırak
        minDaysSinceFollow: 0,  // eklentinin takip ettiklerinde en az bu kadar gün geçmiş olsun
        whitelist: []
      },
      follow: {
        sourceList: 'followers', // 'followers' | 'following' | 'verified' | 'search' | 'retweets' | 'mine' (geri takip)
        sourceUser: '',
        query: '',               // sourceList = 'search'
        tweetUrl: '',            // sourceList = 'retweets'
        minDelayMs: 8000,
        maxDelayMs: 18000,
        maxPerSession: 30,
        // profil
        skipNoPhoto: true,
        skipNoBanner: false,
        skipProtected: false,
        verifiedMode: 'any',     // 'any' | 'skip' | 'only'
        skipBotHandles: false,
        requireBio: false,
        minBioLength: 0,
        // sayılar (0 = sınır yok)
        minFollowers: 0,
        maxFollowers: 0,
        minFollowing: 0,
        maxFollowing: 0,
        minRatio: 0,             // takipçi / takip
        maxRatio: 0,
        minTweets: 0,
        minAgeDays: 0,
        // metin
        bioInclude: [],
        bioExclude: [],
        nameInclude: [],
        nameExclude: [],
        locationInclude: [],
        // diğer
        gender: 'all',           // 'all' | 'female' | 'male' (isimden TAHMİN)
        skipFollowsYou: true,
        skipHistory: true        // daha önce takip edilen/bırakılan hesapları yeniden takip etme
      },
      clean: {
        mode: 'likes',           // 'likes' = beğenileri geri al | 'reposts' = yeniden gönderileri geri al
        minDelayMs: 3000,
        maxDelayMs: 7000,
        maxPerSession: 100,
        olderThanDays: 0         // yalnızca bundan eski gönderiler (0 = hepsi)
      }
    },
    ig: {
      dailyUnfollowCap: 150,
      dailyFollowCap: 60,
      unfollowMinDays: 3,       // sırada "eklentinin takip ettiklerini bırak": takipten bu kadar gün sonra
      follow: {
        sourceList: 'followers', // 'followers' | 'following' | 'likers' (bir gönderiyi beğenenler) | 'mine' (geri takip)
        sourceUser: '',
        postUrl: '',
        maxPerSession: 20,
        delayMin: 20000,
        delayMax: 45000,
        pauseEvery: 10,
        pauseMs: 600000,
        lookupDelayMin: 2500,    // ayrıntılı filtreler için profil okuma arası bekleme
        lookupDelayMax: 5000,
        // hızlı filtreler (liste verisinden)
        skipNoPhoto: true,
        skipPrivate: false,
        verifiedMode: 'any',     // 'any' | 'skip' | 'only'
        skipBotHandles: false,
        nameInclude: [],
        nameExclude: [],
        skipFollowsYou: true,
        skipHistory: true,
        gender: 'all',
        // ayrıntılı filtreler (aday başına profil okunur; 0 = sınır yok)
        minFollowers: 0,
        maxFollowers: 0,
        minFollowing: 0,
        maxFollowing: 0,
        minRatio: 0,
        maxRatio: 0,
        minPosts: 0,
        requireBio: false,
        minBioLength: 0,
        bioInclude: [],
        bioExclude: [],
        skipBusiness: false
      },
      // Tarama temposu (cobanov/instagram varsayılanlarına yakın)
      scanDelayMin: 1000,
      scanDelayMax: 2000,
      scanPauseEvery: 7,
      scanPauseMs: 10000,
      usersPerRequest: 50,
      // Takipten çıkma temposu
      unfollowDelayMin: 8000,
      unfollowDelayMax: 15000,
      unfollowPauseEvery: 10,
      unfollowPauseMs: 300000
    }
  };

  // Görev kimliği -> platform. Aynı platformda aynı anda tek görev çalışır.
  const TASKS = { xLike: 'x', xUnfollow: 'x', xFollow: 'x', xClean: 'x', igScan: 'ig', igUnfollow: 'ig', igFollow: 'ig' };

  function merge(base, over) {
    for (const k of Object.keys(over || {})) {
      const v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) base[k] = merge(base[k] && typeof base[k] === 'object' ? base[k] : {}, v);
      else if (v !== undefined) base[k] = v;
    }
    return base;
  }

  function mergeSettings(saved) {
    const out = merge(structuredClone(DEFAULTS), saved || {});
    // v2.0 -> v2.1: "onaylıları geç" kutusu üç seçenekli ayara dönüştü.
    const f = out.x.follow;
    if (f.skipVerified !== undefined) {
      if (f.skipVerified === true && !(saved && saved.x && saved.x.follow && saved.x.follow.verifiedMode)) f.verifiedMode = 'skip';
      delete f.skipVerified;
    }
    return out;
  }

  // Yerel saate göre YYYY-AA-GG (günlük tavanlar gece yarısı sıfırlanır).
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function freshDaily(d) {
    if (d && d.date === today()) return d;
    return { date: today(), xLike: 0, xUnfollow: 0, xFollow: 0, xClean: 0, igUnfollow: 0, igFollow: 0 };
  }

  // ---------------------------------------------------------------- planlar (görev sırası)
  // queuePlans = { plans: [plan], activeId }
  // plan = { id, name, color, steps, after: 'stop'|'loop'|'plan', next, onError: 'stop'|'next',
  //          schedule: { on, days: [0-6 (Pazar=0)], time: 'SS:DD' }, createdAt, updatedAt }
  const PLAN_COLORS = ['amber', 'green', 'blue', 'pink', 'violet', 'teal'];

  function normPlan(p, i) {
    const s = (p && p.schedule) || {};
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time || '') ? s.time : '09:00';
    const days = Array.isArray(s.days) ? [...new Set(s.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : [1, 2, 3, 4, 5];
    return {
      id: String((p && p.id) || 'plan-' + Date.now().toString(36) + i),
      name: String((p && p.name) || 'Plan ' + String.fromCharCode(65 + (i % 26))).slice(0, 40),
      color: PLAN_COLORS.includes(p && p.color) ? p.color : PLAN_COLORS[i % PLAN_COLORS.length],
      steps: p && Array.isArray(p.steps) ? p.steps : [],
      after: p && ['stop', 'loop', 'plan'].includes(p.after) ? p.after : p && p.loop ? 'loop' : 'stop',
      next: (p && p.next) || '',
      onError: p && p.onError === 'next' ? 'next' : 'stop',
      schedule: { on: !!s.on, days, time },
      createdAt: (p && p.createdAt) || Date.now(),
      updatedAt: (p && p.updatedAt) || Date.now()
    };
  }

  // Eski tek sıra (queueSteps) varsa "Plan A" olarak taşınır. Kimlik sabittir: panel ve arka plan
  // aynı anda taşısa da tek plan oluşur.
  function normPlans(v, legacy) {
    if (v && Array.isArray(v.plans)) {
      const plans = v.plans.map(normPlan);
      const activeId = plans.some((p) => p.id === v.activeId) ? v.activeId : plans[0] ? plans[0].id : '';
      return { plans, activeId };
    }
    if (legacy && Array.isArray(legacy.steps)) {
      const p = normPlan({ id: 'plan-a', name: 'Plan A', steps: legacy.steps, loop: legacy.loop, onError: legacy.onError }, 0);
      return { plans: [p], activeId: p.id };
    }
    return { plans: [], activeId: '' };
  }

  // Zamanlanmış bir planın bir sonraki başlama anı (ms); zamanlama kapalıysa 0.
  function nextPlanRun(schedule, now = Date.now()) {
    if (!schedule || !schedule.on || !schedule.days || !schedule.days.length) return 0;
    const [hh, mm] = String(schedule.time || '09:00').split(':').map(Number);
    for (let d = 0; d <= 7; d++) {
      const c = new Date(now);
      c.setDate(c.getDate() + d);
      c.setHours(hh, mm, 0, 0);
      if (c.getTime() > now + 1000 && schedule.days.includes(c.getDay())) return c.getTime();
    }
    return 0;
  }

  g.XO_PLAN_COLORS = PLAN_COLORS;
  g.xoNormPlan = normPlan;
  g.xoNormPlans = normPlans;
  g.xoNextPlanRun = nextPlanRun;

  g.XO_DEFAULTS = DEFAULTS;
  g.XO_TASKS = TASKS;
  g.xoMergeSettings = mergeSettings;
  g.xoMerge = merge;
  g.xoToday = today;
  g.xoFreshDaily = freshDaily;
})(globalThis);
