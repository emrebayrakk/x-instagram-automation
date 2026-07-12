// Otomatik begeni modulu: ana sayfa akisindaki gonderileri filtreleyip begenir.
import { log, tl, bumpStat, resetStats, addDaily, getDaily } from './state.js';
import { randInt, sleep } from './utils.js';

// Akış sekmesini seç (Takip edilenler / Sana özel).
async function selectFeed(page, feed) {
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  if (feed === 'following') {
    const tabs = await page.$$('[role="tab"]');
    for (const t of tabs) {
      const txt = ((await t.innerText().catch(() => '')) || '').trim().toLowerCase();
      if (txt.includes('following') || txt.includes('takip')) {
        await t.click().catch(() => {});
        log('info', tl('feedFollowing'));
        break;
      }
    }
    await sleep(2500);
  } else {
    log('info', tl('feedForyou'));
  }
}

// Bir gonderiyi tek evaluate ile coz: kimlik, tur, begeni dugmesi durumu.
async function analyze(art) {
  return await art.evaluate((el) => {
    const sc = el.querySelector('[data-testid="socialContext"]');
    const scText = sc ? (sc.innerText || '').toLowerCase() : '';
    const full = (el.innerText || '').toLowerCase();
    const link = el.querySelector('a[href*="/status/"]');
    const href = link ? link.getAttribute('href') : '';
    const hasLike = !!el.querySelector('button[data-testid="like"]');
    return { scText, full, href, hasLike };
  });
}

export async function runLiker(page, settings, control) {
  const s = settings.like;
  resetStats('like');
  log('info', tl('likeStart', { max: s.maxPerSession, min: s.minDelayMs, max2: s.maxDelayMs }));

  await selectFeed(page, s.feed).catch(() => {});

  const seen = new Set();
  let liked = 0;
  let emptyPasses = 0;

  while (control.running && liked < s.maxPerSession) {
    // Gunluk tavan kontrolu
    const daily = getDaily();
    if (daily.likes >= settings.general.dailyLikeCap) {
      log('warn', tl('likeDailyCap', { cap: settings.general.dailyLikeCap }));
      break;
    }

    let articles = [];
    try { articles = await page.$$('article[data-testid="tweet"]'); } catch { articles = []; }
    let acted = false;

    for (const art of articles) {
      if (!control.running || liked >= s.maxPerSession) break;

      let info;
      try { info = await analyze(art); } catch { continue; }
      const m = (info.href || '').match(/status\/(\d+)/);
      const id = m ? m[1] : info.href;
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const isRetweet = info.scText.includes('repost') || info.scText.includes('gönderd') || info.scText.includes('gonderd');
      const isReply = info.full.includes('replying to') || info.full.includes('yanit olarak') || info.full.includes('yanıt olarak');
      const isPromoted = info.full.includes('promoted') || info.full.includes('reklam');

      if (s.skipRetweets && isRetweet) { bumpStat('likeSkipped'); continue; }
      if (s.skipReplies && isReply) { bumpStat('likeSkipped'); continue; }
      if (s.skipPromoted && isPromoted) { bumpStat('likeSkipped'); continue; }
      if (!info.hasLike) { bumpStat('likeSkipped'); continue; } // zaten begenilmis ya da dugme yok

      try {
        const btn = await art.$('button[data-testid="like"]');
        if (!btn) { bumpStat('likeSkipped'); continue; }
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        // Playwright actionability kontrolünü atla: butonun kendi click handler'ını doğrudan tetikle.
        await btn.evaluate((el) => el.click());
        liked++;
        acted = true;
        addDaily('like');
        bumpStat('liked');
        log('ok', tl('liked', { n: liked, max: s.maxPerSession, id }));
      } catch (e) {
        bumpStat('errors');
        log('error', tl('likeError', { e: String(e.message || e).slice(0, 120) }));
      }

      if (liked < s.maxPerSession && control.running) {
        await sleep(randInt(s.minDelayMs, s.maxDelayMs), control);
      }
    }

    if (!acted) {
      emptyPasses++;
      await page.mouse.wheel(0, 1600).catch(() => {});
      await sleep(1800, control);
      if (emptyPasses >= 6) {
        log('warn', tl('likeEnd'));
        break;
      }
    } else {
      emptyPasses = 0;
      await page.mouse.wheel(0, 1200).catch(() => {});
      await sleep(1200, control);
    }
  }

  log('info', tl('likeDone', { n: liked }));
  control.running = false;
}
