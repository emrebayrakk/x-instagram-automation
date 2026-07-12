// Paylasilan durum: ayarlar, olay yayini (event bus), sayaclar, gunluk limitler.
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { t } from './locales.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT, 'settings.json');
const DAILY_PATH = path.join(ROOT, 'daily-stats.json');

// Tum log ve durum degisiklikleri bu bus uzerinden WebSocket'e yayilir.
export const bus = new EventEmitter();
bus.setMaxListeners(50);

export const defaultSettings = {
  general: {
    lang: 'tr',              // arayuz + log + cinsiyet tahmini dili (tr,en,de,es,fr,it)
    username: '',            // @'siz kullanici adiniz (takip listesi icin gerekli)
    headless: false,         // tarayiciyi gizli calistir (giris icin false onerilir)
    dailyLikeCap: 200,       // gunluk toplam begeni tavani (guvenlik)
    dailyUnfollowCap: 100,   // gunluk toplam takipten cikma tavani (guvenlik)
    dailyFollowCap: 150      // gunluk toplam takip etme tavani (guvenlik)
  },
  like: {
    enabled: true,
    minDelayMs: 4000,        // begeniler arasi en az bekleme
    maxDelayMs: 9000,        // begeniler arasi en fazla bekleme (arasi rastgele)
    maxPerSession: 50,       // bu oturumda en fazla begeni
    feed: 'following',       // 'following' = Takip edilenler sekmesi | 'foryou' = Sana ozel
    skipRetweets: true,      // RT / yeniden gonderilenleri begenme
    skipReplies: false,      // yanitlari begenme
    skipPromoted: true       // reklam/promoted gonderileri begenme
  },
  unfollow: {
    enabled: true,
    minDelayMs: 6000,
    maxDelayMs: 14000,
    maxPerSession: 30,
    onlyNonFollowers: true,  // sadece seni geri takip ETMEYENLERI cikar
    whitelist: []            // asla cikarma (kullanici adlari, @ olmadan)
  },
  follow: {
    enabled: true,
    sourceUser: '',          // hedef kullanici (@'siz) - onun listesinden takip edilir
    sourceList: 'followers', // 'followers' = takipcileri | 'following' = takip ettikleri
    minDelayMs: 8000,
    maxDelayMs: 18000,
    maxPerSession: 30,
    requireBio: false,       // biosu dolu olanlari takip et
    minBioLength: 0,         // bio en az bu kadar karakter olsun
    skipVerified: false,     // onaylanmislari (mavi tik) takip etme
    gender: 'all',           // 'all' | 'female' | 'male' (isimden TAHMIN, kesin degil)
    bioInclude: [],          // bio bu kelimelerden birini icermeli (bossa filtre yok)
    bioExclude: [],          // bio bu kelimelerden birini iceriyorsa atla
    skipFollowsYou: false    // seni zaten takip edenleri atla
  }
};

export function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return deepMerge(structuredClone(defaultSettings), raw);
  } catch {
    return structuredClone(defaultSettings);
  }
}

export function saveSettings(s) {
  const merged = deepMerge(structuredClone(defaultSettings), s || {});
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

function deepMerge(base, over) {
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) {
      base[k] = deepMerge(base[k] || {}, over[k]);
    } else if (over[k] !== undefined) {
      base[k] = over[k];
    }
  }
  return base;
}

// ---- Oturum sayaclari ----
export const stats = {
  liked: 0, likeSkipped: 0,
  unfollowed: 0, unfollowSkipped: 0,
  followed: 0, followSkipped: 0,
  errors: 0
};

export function resetStats(which) {
  if (which === 'like') { stats.liked = 0; stats.likeSkipped = 0; }
  else if (which === 'unfollow') { stats.unfollowed = 0; stats.unfollowSkipped = 0; }
  else if (which === 'follow') { stats.followed = 0; stats.followSkipped = 0; }
  emitStats();
}

export function bumpStat(key, n = 1) {
  stats[key] = (stats[key] || 0) + n;
  emitStats();
}

export function emitStats() {
  bus.emit('stats', { ...stats });
}

// ---- Dil ----
// O anki dile göre çeviri kısayolu: tl('anahtar', {param}) -> çevrilmiş metin.
export function currentLang() {
  try { return loadSettings().general.lang || 'tr'; } catch { return 'tr'; }
}
export function tl(key, params) { return t(currentLang(), key, params); }

// ---- Log ----
export function log(level, message) {
  const entry = { time: new Date().toISOString(), level, message };
  bus.emit('log', entry);
  const tag = { info: 'i', ok: '+', warn: '!', error: 'x' }[level] || '-';
  console.log(`[${tag}] ${message}`);
}

// ---- Gunluk limit takibi (guvenlik tavani) ----
function today() { return new Date().toISOString().slice(0, 10); }

function loadDaily() {
  try {
    const d = JSON.parse(fs.readFileSync(DAILY_PATH, 'utf8'));
    if (d.date === today()) return d;
  } catch {}
  return { date: today(), likes: 0, unfollows: 0, follows: 0 };
}

export function getDaily() { return loadDaily(); }

export function addDaily(kind, n = 1) {
  const d = loadDaily();
  if (kind === 'like') d.likes += n;
  else if (kind === 'unfollow') d.unfollows += n;
  else if (kind === 'follow') d.follows = (d.follows || 0) + n;
  fs.writeFileSync(DAILY_PATH, JSON.stringify(d, null, 2));
  return d;
}
