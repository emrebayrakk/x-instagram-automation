// X sayfasının kendi dünyasında (MAIN) çalışır. Sekme arka plandayken tarayıcı sayfayı çizmez:
// kaydırma olayı, requestAnimationFrame, IntersectionObserver ve ResizeObserver tetiklenmez;
// X de listeyi uzatmaz, yeni gönderi/hesap yüklemez. Görev sürerken içerik betiği her beklemede
// 'xo-pump' gönderir; sekme gizliyse bekleyen kare çağrıları burada çalıştırılır, kaydırma olayı
// verilir ve gözlenen öğelerin görünürlüğü/boyutu elle hesaplanıp X'in kendi gözlemcilerine iletilir.
// Sekme görünürken hiçbir şey yapmaz.
(function () {
  'use strict';
  if (window.__xoAwake) return;
  window.__xoAwake = true;

  const DocProto = Document.prototype;
  const hiddenDesc = Object.getOwnPropertyDescriptor(DocProto, 'hidden');
  const stateDesc = Object.getOwnPropertyDescriptor(DocProto, 'visibilityState');
  if (!hiddenDesc || !stateDesc) return;
  const reallyHidden = () => hiddenDesc.get.call(document);

  let awakeUntil = 0;
  const awake = () => Date.now() < awakeUntil;

  // Görev sürerken X sekmeyi görünür sansın (arka planda yenilemeyi/yüklemeyi kısmasın).
  try {
    Object.defineProperty(DocProto, 'hidden', {
      configurable: true, enumerable: true,
      get() { return awake() ? false : hiddenDesc.get.call(this); }
    });
    Object.defineProperty(DocProto, 'visibilityState', {
      configurable: true, enumerable: true,
      get() { return awake() ? 'visible' : stateDesc.get.call(this); }
    });
    window.addEventListener('visibilitychange', (e) => { if (awake()) e.stopImmediatePropagation(); }, true);
  } catch { /* yok say */ }

  // ---- requestAnimationFrame: gizli sekmede hiç çalışmaz; bekleyenler pompada çalıştırılır.
  const frames = new Map();
  const rafReal = window.requestAnimationFrame;
  const cafReal = window.cancelAnimationFrame;
  if (rafReal && cafReal) {
    window.requestAnimationFrame = function (cb) {
      const id = rafReal.call(window, (t) => { if (frames.delete(id)) cb(t); });
      frames.set(id, cb);
      return id;
    };
    window.cancelAnimationFrame = function (id) {
      frames.delete(id);
      return cafReal.call(window, id);
    };
  }

  function runFrames() {
    if (!frames.size) return;
    const due = [...frames];
    frames.clear();
    const t = performance.now();
    for (const [id, cb] of due) {
      cafReal.call(window, id);
      try { cb(t); } catch (e) { report(e); }
    }
  }

  const report = (e) => setTimeout(() => { throw e; });
  const rect = (x, y, width, height) => (window.DOMRectReadOnly ? DOMRectReadOnly.fromRect({ x, y, width, height }) : { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height });

  // ---- IntersectionObserver: gizli sekmede kesişim hesaplanmaz; pompada elle hesaplanır.
  const ioLive = new Set();
  const IO = window.IntersectionObserver;
  if (IO) {
    const XoIntersectionObserver = class IntersectionObserver extends IO {
      constructor(cb, opts) {
        const seen = new Map();
        super((entries, obs) => {
          for (const e of entries) seen.set(e.target, e.isIntersecting);
          cb.call(obs, entries, obs);
        }, opts);
        this.__xo = { cb, opts: opts || {}, seen, targets: new Set() };
      }
      observe(t) { this.__xo.targets.add(t); ioLive.add(this); return super.observe(t); }
      unobserve(t) { this.__xo.targets.delete(t); this.__xo.seen.delete(t); return super.unobserve(t); }
      disconnect() { this.__xo.targets.clear(); this.__xo.seen.clear(); ioLive.delete(this); return super.disconnect(); }
    };
    window.IntersectionObserver = XoIntersectionObserver;
  }

  // "10px 20%" gibi rootMargin -> [üst, sağ, alt, sol] piksel.
  function margins(str, w, h) {
    const p = String(str || '0px').trim().split(/\s+/).slice(0, 4);
    while (p.length < 4) p.push(p.length === 1 ? p[0] : p.length === 2 ? p[0] : p[1]);
    return p.map((v, i) => {
      const n = parseFloat(v) || 0;
      return v.endsWith('%') ? (n / 100) * (i % 2 ? w : h) : n;
    });
  }

  function checkIntersections() {
    const now = performance.now();
    for (const o of [...ioLive]) {
      const { cb, opts, seen, targets } = o.__xo;
      if (!targets.size) { ioLive.delete(o); continue; }
      const root = opts.root && opts.root.nodeType === 1 ? opts.root : null;
      const rb = root ? root.getBoundingClientRect() : rect(0, 0, innerWidth, innerHeight);
      const [mt, mr, mb, ml] = margins(opts.rootMargin, rb.width, rb.height);
      const top = rb.top - mt, left = rb.left - ml, bottom = rb.bottom + mb, right = rb.right + mr;
      const out = [];
      for (const t of targets) {
        if (!t.isConnected) continue;
        const b = t.getBoundingClientRect();
        const x1 = Math.max(b.left, left), x2 = Math.min(b.right, right);
        const y1 = Math.max(b.top, top), y2 = Math.min(b.bottom, bottom);
        const hit = x2 >= x1 && y2 >= y1 && (b.width > 0 || b.height > 0 || (b.top >= top && b.bottom <= bottom));
        if (seen.get(t) === hit) continue;
        seen.set(t, hit);
        const area = b.width * b.height;
        const iw = hit ? x2 - x1 : 0, ih = hit ? y2 - y1 : 0;
        out.push({
          target: t, time: now, isIntersecting: hit, isVisible: false,
          intersectionRatio: hit ? (area > 0 ? Math.min(1, (iw * ih) / area) : 1) : 0,
          boundingClientRect: b,
          intersectionRect: rect(hit ? x1 : 0, hit ? y1 : 0, iw, ih),
          rootBounds: rect(left, top, right - left, bottom - top)
        });
      }
      if (out.length) { try { cb.call(o, out, o); } catch (e) { report(e); } }
    }
  }

  // ---- ResizeObserver: X'in liste hücreleri yüksekliklerini bununla bildirir; pompada elle ölçülür.
  const roLive = new Set();
  const RO = window.ResizeObserver;
  if (RO) {
    const XoResizeObserver = class ResizeObserver extends RO {
      constructor(cb) {
        const sizes = new Map();
        super((entries, obs) => {
          for (const e of entries) sizes.set(e.target, e.contentRect.width + 'x' + e.contentRect.height);
          cb.call(obs, entries, obs);
        });
        this.__xo = { cb, sizes, targets: new Set() };
      }
      observe(t, o) { this.__xo.targets.add(t); roLive.add(this); return super.observe(t, o); }
      unobserve(t) { this.__xo.targets.delete(t); this.__xo.sizes.delete(t); return super.unobserve(t); }
      disconnect() { this.__xo.targets.clear(); this.__xo.sizes.clear(); roLive.delete(this); return super.disconnect(); }
    };
    window.ResizeObserver = XoResizeObserver;
  }

  function contentBox(el) {
    const cs = getComputedStyle(el);
    const px = (k) => parseFloat(cs[k]) || 0;
    const b = el.getBoundingClientRect();
    const w = Math.max(0, b.width - px('paddingLeft') - px('paddingRight') - px('borderLeftWidth') - px('borderRightWidth'));
    const h = Math.max(0, b.height - px('paddingTop') - px('paddingBottom') - px('borderTopWidth') - px('borderBottomWidth'));
    return { b, w, h, x: px('paddingLeft'), y: px('paddingTop') };
  }

  function checkSizes() {
    for (const o of [...roLive]) {
      const { cb, sizes, targets } = o.__xo;
      if (!targets.size) { roLive.delete(o); continue; }
      const out = [];
      for (const t of targets) {
        if (!t.isConnected) continue;
        const c = contentBox(t);
        const key = c.w + 'x' + c.h;
        if (sizes.get(t) === key) continue;
        sizes.set(t, key);
        const box = [{ inlineSize: c.w, blockSize: c.h }];
        out.push({
          target: t, contentRect: rect(c.x, c.y, c.w, c.h),
          contentBoxSize: box, borderBoxSize: [{ inlineSize: c.b.width, blockSize: c.b.height }],
          devicePixelContentBoxSize: [{ inlineSize: c.w * devicePixelRatio, blockSize: c.h * devicePixelRatio }]
        });
      }
      if (out.length) { try { cb.call(o, out, o); } catch (e) { report(e); } }
    }
  }

  // ---- Pompa: kaydırma olayı -> kare çağrıları -> boyutlar -> kesişimler.
  let lastY = window.scrollY;
  function pump() {
    if (!reallyHidden()) { lastY = window.scrollY; return; }
    awakeUntil = Date.now() + 45000;
    if (window.scrollY !== lastY) {
      lastY = window.scrollY;
      document.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    runFrames();
    checkSizes();
    checkIntersections();
  }

  document.addEventListener('xo-pump', pump);
})();
