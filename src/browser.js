// Playwright kalici tarayici yonetimi: bir kere giris yaparsiniz, oturum diskte saklanir.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { log, tl } from './state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA = path.join(__dirname, '..', 'user-data');

let context = null;
let page = null;

export function getPage() { return page; }
export function isOpen() { return !!context; }

export async function ensureBrowser(headless = false) {
  if (context) return { context, page };
  log('info', tl('browserStarting'));
  context = await chromium.launchPersistentContext(USER_DATA, {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
    // Otomasyon izini biraz azalt
    ignoreDefaultArgs: ['--enable-automation']
  });
  // navigator.webdriver = false
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  page = context.pages()[0] || await context.newPage();
  context.on('close', () => { context = null; page = null; });
  return { context, page };
}

export async function closeBrowser() {
  if (context) {
    await context.close().catch(() => {});
    context = null; page = null;
    log('info', tl('browserClosed'));
  }
}

// Ana sayfaya gidip giris yapilmis mi kontrol et.
export async function checkLogin() {
  if (!page) return { loggedIn: false, username: '' };
  try {
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
  } catch {}
  const loggedIn = await page.$('a[data-testid="SideNav_NewTweet_Button"], [data-testid="SideNav_AccountSwitcher_Button"]')
    .then(Boolean).catch(() => false);
  let username = '';
  if (loggedIn) {
    username = await detectUsername();
  }
  return { loggedIn, username };
}

// Giris ekranini ac (kullanici elle giris yapar; 2FA/captcha dahil).
export async function openLogin() {
  await ensureBrowser(false); // giris icin gorunur tarayici sart
  try {
    await page.goto('https://x.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch {}
  log('warn', tl('loginPrompt'));
}

// Kenar menudeki hesap dugmesinden @kullanici adini oku.
export async function detectUsername() {
  try {
    const handle = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
      if (!btn) return '';
      const spans = btn.querySelectorAll('span');
      for (const s of spans) {
        const t = (s.textContent || '').trim();
        if (t.startsWith('@')) return t.slice(1);
      }
      return '';
    });
    return handle || '';
  } catch { return ''; }
}
