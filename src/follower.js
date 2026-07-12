// Otomatik takip etme modülü: bir hedef kullanıcının takipçi/takip listesini tarar,
// filtreleri geçen hesapları belirli aralıklarla takip eder.
import { log, tl, bumpStat, resetStats, addDaily, getDaily } from './state.js';
import { randInt, sleep } from './utils.js';
import { guessGender } from './names.js';

// Bir kullanıcı hücresini çöz: ad, @handle, bio, mavi tik, takip düğmesi, "seni takip ediyor".
async function analyzeCell(cell) {
  return await cell.evaluate((el) => {
    const text = el.innerText || '';
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);

    let handle = '';
    const links = el.querySelectorAll('a[href^="/"]');
    for (const a of links) {
      const h = a.getAttribute('href') || '';
      if (/^\/[A-Za-z0-9_]+$/.test(h)) { handle = h.slice(1); break; }
    }

    const name = lines[0] || '';
    const lower = text.toLowerCase();
    const followsYou = lower.includes('follows you') || lower.includes('seni takip ediyor');
    const verified = !!el.querySelector('[data-testid="icon-verified"]') ||
                     !!el.querySelector('svg[aria-label*="erified"]');
    // "-follow" ile biten (takip et) düğmesi -> henüz takip etmiyoruz demektir
    const hasFollow = !!el.querySelector('button[data-testid$="-follow"]');

    // Bio = ad / @handle / rozet / düğme metni dışındaki satırlar
    const skipLabels = new Set(['follow', 'following', 'takip et', 'takip ediliyor', 'follows you', 'seni takip ediyor']);
    const bio = lines.filter((l) => {
      const ll = l.toLowerCase();
      if (l === name) return false;
      if (l.startsWith('@')) return false;
      if (skipLabels.has(ll)) return false;
      return true;
    }).join(' ').trim();

    return { handle, name, bio, verified, hasFollow, followsYou };
  });
}

// Filtreler: geçerse null döner, geçmezse atlama sebebini döner.
function rejectReason(info, s, lang) {
  if (!info.hasFollow) return 'zaten takip'; // takip düğmesi yok
  if (s.skipVerified && info.verified) return 'onaylı';
  if (s.skipFollowsYou && info.followsYou) return 'seni takip ediyor';
  if (s.requireBio && info.bio.length === 0) return 'bio yok';
  if (s.minBioLength > 0 && info.bio.length < s.minBioLength) return 'bio kısa';

  const bioLower = info.bio.toLowerCase();
  const inc = (s.bioInclude || []).map((x) => String(x).toLowerCase().trim()).filter(Boolean);
  if (inc.length && !inc.some((k) => bioLower.includes(k))) return 'kelime eşleşmedi';
  const exc = (s.bioExclude || []).map((x) => String(x).toLowerCase().trim()).filter(Boolean);
  if (exc.length && exc.some((k) => bioLower.includes(k))) return 'yasak kelime';

  if (s.gender && s.gender !== 'all') {
    const g = guessGender(info.name, info.bio, lang); // seçilen dile göre tahmin
    if (g !== s.gender) return 'cinsiyet uymadı';
  }
  return null;
}

export async function runFollower(page, settings, control) {
  const s = settings.follow;
  const source = (s.sourceUser || '').replace('@', '').trim();
  const lang = settings.general.lang || 'tr';
  resetStats('follow');

  if (!source) {
    log('error', tl('followNeedTarget'));
    control.running = false;
    return;
  }

  const listName = s.sourceList === 'following' ? 'following' : 'followers';
  const listLabel = tl(s.sourceList === 'following' ? 'listFollowing' : 'listFollowers');
  log('info', tl('followStart', { src: source, list: listLabel, max: s.maxPerSession, min: s.minDelayMs, max2: s.maxDelayMs }));

  try {
    await page.goto(`https://x.com/${source}/${listName}`, { waitUntil: 'domcontentloaded' });
    await sleep(3000, control);
  } catch {
    log('error', tl('followOpenErr'));
    control.running = false;
    return;
  }

  const processed = new Set();
  let followed = 0;
  let idlePasses = 0;

  while (control.running && followed < s.maxPerSession) {
    const daily = getDaily();
    if ((daily.follows || 0) >= settings.general.dailyFollowCap) {
      log('warn', tl('followDailyCap', { cap: settings.general.dailyFollowCap }));
      break;
    }

    let cells = [];
    try { cells = await page.$$('[data-testid="UserCell"]'); } catch { cells = []; }

    let target = null, targetHandle = '', sawNew = false;
    for (const cell of cells) {
      let info;
      try { info = await analyzeCell(cell); } catch { continue; }
      const handle = info.handle;
      if (!handle || processed.has(handle.toLowerCase())) continue;
      if (handle.toLowerCase() === source.toLowerCase()) continue; // kaynak kişinin kendi kartı
      sawNew = true;
      processed.add(handle.toLowerCase());

      const reason = rejectReason(info, s, lang);
      if (reason) { bumpStat('followSkipped'); continue; }

      target = cell; targetHandle = handle;
      break; // ilk uygun kişiyi taze handle ile hemen işle
    }

    if (target) {
      idlePasses = 0;
      try {
        const btn = await target.$('button[data-testid$="-follow"]');
        if (!btn) { bumpStat('followSkipped'); continue; }
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.evaluate((el) => el.click()); // actionability kontrolünü atla
        // Bazı hesaplarda takip onay penceresi çıkabilir; varsa onayla.
        const confirm = await page.waitForSelector('[data-testid="confirmationSheetConfirm"]', { timeout: 1500 }).catch(() => null);
        if (confirm) await confirm.evaluate((el) => el.click()).catch(() => {});
        followed++;
        addDaily('follow');
        bumpStat('followed');
        log('ok', tl('followed', { n: followed, max: s.maxPerSession, h: targetHandle }));
      } catch (e) {
        bumpStat('errors');
        log('error', tl('followError', { h: targetHandle, e: String(e.message || e).slice(0, 100) }));
      }

      if (followed < s.maxPerSession && control.running) {
        await sleep(randInt(s.minDelayMs, s.maxDelayMs), control);
      }
    } else {
      if (!sawNew) {
        idlePasses++;
        if (idlePasses >= 12) {
          log('warn', tl('listEnd'));
          break;
        }
      } else {
        idlePasses = 0;
      }
      await page.mouse.wheel(0, 900).catch(() => {});
      await sleep(1500, control);
    }
  }

  log('info', tl('followDone', { n: followed }));
  control.running = false;
}
