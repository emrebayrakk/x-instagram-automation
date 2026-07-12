// İsimden TAHMİNİ cinsiyet: 'gender-detection-from-name' npm paketi (çevrimdışı, Türkçe destekli).
// Not: Yine de kaba bir tahmindir; takma ad, unisex isim ve yabancı isimler yanlış sınıflanabilir.
import pkg from 'gender-detection-from-name';
const { getGender } = pkg;

// Görünen addan ilk ismi al (emoji/işaretleri temizle, Türkçe harfleri koru).
function firstName(displayName) {
  const cleaned = (displayName || '')
    .replace(/[^\p{L}\s]/gu, ' ') // harf ve boşluk dışını (emoji, sayı, işaret) at
    .trim();
  return cleaned.split(/\s+/)[0] || '';
}

// Türkçe özel harfleri ASCII karşılığına indir (paket veri setiyle daha iyi eşleşir).
function asciiFold(s) {
  return s
    .replace(/ç/g, 'c').replace(/Ç/g, 'C')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ı/g, 'i').replace(/İ/g, 'I')
    .replace(/ö/g, 'o').replace(/Ö/g, 'O')
    .replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U');
}

// Bir ismi seçilen dilde + genel veri setinde dene.
function lookup(name, lang) {
  try {
    const byLang = getGender(name, lang);
    if (byLang === 'male' || byLang === 'female') return byLang;
    const any = getGender(name); // dil belirtmeden (tüm diller)
    if (any === 'male' || any === 'female') return any;
  } catch { /* paket beklenmedik bir şey dönerse yut */ }
  return 'unknown';
}

// 'female' | 'male' | 'unknown'
// lang: seçilen arayüz dili (tr,en,de,es,fr,it) — paketin veri seti buna göre önceliklenir.
export function guessGender(displayName, bio = '', lang = 'tr') {
  // Önce bio'daki açık ipuçları
  const b = (bio || '').toLowerCase();
  if (/(she\/her|kadın|kadin|👩|♀)/.test(b)) return 'female';
  if (/(he\/him|erkek|👨|♂)/.test(b)) return 'male';

  const fn = firstName(displayName);
  if (!fn) return 'unknown';

  // Önce olduğu gibi, sonra ASCII sadeleştirilmiş halini dene.
  let g = lookup(fn, lang);
  if (g === 'unknown') {
    const folded = asciiFold(fn);
    if (folded !== fn) g = lookup(folded, lang);
  }
  return g;
}
