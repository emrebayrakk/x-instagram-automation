// Otomatik takipten çıkma modülü: takip listenizi tarar, sizi geri takip
// etmeyenleri (whitelist hariç) belirli aralıklarla takipten çıkarır.
import { log, tl, bumpStat, resetStats, addDaily, getDaily } from './state.js';
import { randInt, sleep } from './utils.js';

// Bir kullanıcı hücresini çöz: @kullanıcı adı + "seni takip ediyor" rozeti + takipten çıkma düğmesi var mı.
async function analyzeCell(cell) {
  return await cell.evaluate((el) => {
    let handle = '';
    const links = el.querySelectorAll('a[href^="/"]');
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      // Profil linki: tek segment (/kullanici), status/photo vb. değil
      if (/^\/[A-Za-z0-9_]+$/.test(href)) { handle = href.slice(1); break; }
    }
    const text = (el.innerText || '').toLowerCase();
    const followsYou = text.includes('follows you') || text.includes('seni takip ediyor');
    const unfollowBtn = el.querySelector('button[data-testid$="-unfollow"]');
    return { handle, followsYou, hasUnfollow: !!unfollowBtn };
  });
}

export async function runUnfollower(page, settings, control) {
  const s = settings.unfollow;
  const username = (settings.general.username || '').replace('@', '').trim();
  resetStats('unfollow');

  if (!username) {
    log('error', tl('unfollowNeedUser'));
    control.running = false;
    return;
  }

  const whitelist = new Set((s.whitelist || []).map((u) => String(u).replace('@', '').trim().toLowerCase()));
  log('info', tl('unfollowStart', { max: s.maxPerSession, min: s.minDelayMs, max2: s.maxDelayMs }));

  try {
    await page.goto(`https://x.com/${username}/following`, { waitUntil: 'domcontentloaded' });
    await sleep(3000, control);
  } catch {
    log('error', tl('unfollowOpenErr'));
    control.running = false;
    return;
  }

  const processed = new Set();
  let unfollowed = 0;
  let idlePasses = 0; // üst üste hiç yeni kişi görülmeyen tur sayısı (gerçek liste sonu)

  // Her turda listeyi TAZE sorgula: uzun beklemelerde hücre handle'ları bayatlamasın.
  while (control.running && unfollowed < s.maxPerSession) {
    const daily = getDaily();
    if (daily.unfollows >= settings.general.dailyUnfollowCap) {
      log('warn', tl('unfollowDailyCap', { cap: settings.general.dailyUnfollowCap }));
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
      sawNew = true;
      processed.add(handle.toLowerCase());

      if (whitelist.has(handle.toLowerCase())) {
        bumpStat('unfollowSkipped');
        log('info', tl('skipWhitelist', { h: handle }));
        continue;
      }
      if (s.onlyNonFollowers && info.followsYou) { bumpStat('unfollowSkipped'); continue; } // geri takip ediyor
      if (!info.hasUnfollow) { bumpStat('unfollowSkipped'); continue; }

      target = cell; targetHandle = handle;
      break; // ilk uygun kişiyi taze handle ile hemen işle
    }

    if (target) {
      idlePasses = 0;
      try {
        const btn = await target.$('button[data-testid$="-unfollow"]');
        if (!btn) { bumpStat('unfollowSkipped'); continue; }
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        // Playwright actionability kontrolünü atla: butonun kendi click handler'ını doğrudan tetikle.
        await btn.evaluate((el) => el.click());
        // Onay penceresi
        const confirm = await page.waitForSelector('[data-testid="confirmationSheetConfirm"]', { timeout: 6000 }).catch(() => null);
        if (confirm) {
          await confirm.evaluate((el) => el.click()).catch(async () => { await confirm.click({ force: true }).catch(() => {}); });
          unfollowed++;
          addDaily('unfollow');
          bumpStat('unfollowed');
          log('ok', tl('unfollowed', { n: unfollowed, max: s.maxPerSession, h: targetHandle }));
        } else {
          bumpStat('errors');
          log('warn', tl('confirmNotOpen', { h: targetHandle }));
        }
      } catch (e) {
        bumpStat('errors');
        log('error', tl('unfollowError', { h: targetHandle, e: String(e.message || e).slice(0, 100) }));
      }

      if (unfollowed < s.maxPerSession && control.running) {
        await sleep(randInt(s.minDelayMs, s.maxDelayMs), control);
      }
    } else {
      // Bu görünümde işlenecek yeni kişi yok: kaydır, daha fazla yükle.
      if (!sawNew) {
        idlePasses++;
        if (idlePasses >= 12) {
          log('warn', tl('listEnd'));
          break;
        }
      } else {
        idlePasses = 0; // yeni kişiler vardı ama hepsi atlandı; devam
      }
      await page.mouse.wheel(0, 900).catch(() => {});
      await sleep(1500, control);
    }
  }

  log('info', tl('unfollowDone', { n: unfollowed }));
  control.running = false;
}
