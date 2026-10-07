// İsimden TAHMİNİ cinsiyet — masaüstü sürümündeki src/names.js'in eklenti karşılığı.
// Veri, 'gender-detection-from-name' paketinden üretilen lib/names.json'dur
// (yeniden üretmek için: npm run ext:names). Yalnızca arka planda, ilk ihtiyaçta yüklenir.
(function (g) {
  'use strict';

  // Paketle aynı arama sırası: önce seçilen dil, sonra sabit sıra.
  const ORDER = ['tr', 'de', 'fr', 'es', 'en', 'it'];
  let maps = null;
  let loading = null;

  function load() {
    if (maps) return Promise.resolve(maps);
    if (!loading) {
      loading = fetch(chrome.runtime.getURL('lib/names.json'))
        .then((r) => r.json())
        .then((data) => {
          const out = {};
          for (const [lang, lists] of Object.entries(data)) {
            const m = new Map();
            for (const n of (lists.f || '').split('|')) if (n) m.set(n, 'female');
            for (const n of (lists.m || '').split('|')) if (n) m.set(n, 'male');
            out[lang] = m;
          }
          maps = out;
          return maps;
        })
        .catch((e) => { loading = null; throw e; });
    }
    return loading;
  }

  function lookup(all, name, lang) {
    const key = name.toLowerCase();
    for (const l of [lang, ...ORDER]) {
      const v = all[l] && all[l].get(key);
      if (v) return v;
    }
    return 'unknown';
  }

  // Görünen addan ilk ismi al (emoji/işaretleri at, harfleri koru).
  function firstName(displayName) {
    const cleaned = String(displayName || '').replace(/[^\p{L}\s]/gu, ' ').trim();
    return cleaned.split(/\s+/)[0] || '';
  }

  // Türkçe harfleri ASCII karşılığına indir (veri setiyle daha iyi eşleşir).
  function asciiFold(s) {
    return s
      .replace(/ç/g, 'c').replace(/Ç/g, 'C')
      .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
      .replace(/ı/g, 'i').replace(/İ/g, 'I')
      .replace(/ö/g, 'o').replace(/Ö/g, 'O')
      .replace(/ş/g, 's').replace(/Ş/g, 'S')
      .replace(/ü/g, 'u').replace(/Ü/g, 'U');
  }

  // 'female' | 'male' | 'unknown'
  async function guessGender(displayName, bio = '', lang = 'tr') {
    const b = String(bio || '').toLowerCase();
    if (/(she\/her|kadın|kadin|👩|♀)/u.test(b)) return 'female';
    if (/(he\/him|erkek|👨|♂)/u.test(b)) return 'male';

    const fn = firstName(displayName);
    if (!fn) return 'unknown';

    const all = await load();
    let res = lookup(all, fn, lang);
    if (res === 'unknown') {
      const folded = asciiFold(fn);
      if (folded !== fn) res = lookup(all, folded, lang);
    }
    return res;
  }

  g.xoGuessGender = guessGender;
})(globalThis);
