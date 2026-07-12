# X Otomasyon Paneli / X Automation Panel

`@xxxxx` gibi **kendi** X (Twitter) hesabınız için tarayıcı tabanlı otomasyon aracı — otomatik beğeni, geri takip etmeyenleri takipten çıkarma ve başka bir kullanıcının listesinden filtreli takip etme. **API anahtarı gerekmez** (Playwright ile web arayüzünü sürer). Çok dilli arayüz (TR/EN/DE/ES/FR/IT). Hem **web** hem **masaüstü (Electron)** olarak çalışır.

> A browser-based automation tool for **your own** X (Twitter) account — auto-like, unfollow non-followers, and follow filtered users from another account's list. **No API key required** (drives the web UI via Playwright). Multi-language UI (TR/EN/DE/ES/FR/IT). Runs as a **web** app or a **desktop (Electron)** app.

---

## ⚠ Uyarı / Warning

**TR:** Otomatik beğeni ve toplu takip/takipten-çıkma, **X'in Kullanım Koşulları / Automation Rules kurallarına aykırıdır** ve kendi hesabınızda bile **askıya alınma riski** taşır. Kullanım tamamen sizin sorumluluğunuzdadır. Düşük limitler ve geniş, rastgele `ms` aralıkları önerilir (varsayılanlar temkinlidir). Cinsiyet tahmini isimden yapılır, **kesin değildir**.

**EN:** Auto-liking and bulk follow/unfollow **violate X's Terms of Service / Automation Rules** and can get your account **suspended**, even on your own account. Use entirely at your own risk. Low limits and wide, randomized `ms` intervals are recommended (defaults are conservative). Gender is guessed from the name and is **not accurate**.

---

## Kurulum / Installation

**TR — Gereksinim:** [Node.js](https://nodejs.org) 18+ kurulu olmalı.
**EN — Requirement:** [Node.js](https://nodejs.org) 18+ must be installed.

```bash
cd x-otomasyon
npm install                    # bağımlılıklar / dependencies
npx playwright install chromium   # otomasyon tarayıcısı / automation browser (bir kez / once)
```

---

## Çalıştırma / Running

Uygulamayı iki şekilde çalıştırabilirsiniz. / You can run it two ways.

### 1) Masaüstü uygulaması / Desktop app (Electron)

```bash
npm run desktop
```

**TR:** Pano ayrı bir masaüstü penceresinde açılır. (İlk çalıştırmada Electron ikilisi indirilebilir.)
**EN:** The panel opens in a dedicated desktop window. (On first run, the Electron binary may download.)

### 2) Web uygulaması / Web app

```bash
npm start
```

**TR:** Sonra tarayıcıda **http://localhost:4477** adresini açın.
**EN:** Then open **http://localhost:4477** in your browser.

> Port değiştirmek için / To change the port: `PORT=5000 npm start` (veya / or `PORT=5000 npm run desktop`).

---

## Kullanım / Usage

**TR:**
1. **Sağ üstten dili seçin** (TR/EN/DE/ES/FR/IT). Arayüz ve loglar anında değişir; cinsiyet tahmini de bu dile göre yapılır.
2. **"Tarayıcıyı Aç / Giriş"** → açılan Chromium'da hesabınıza giriş yapın (2FA/şifre elle). Oturum kaydedilir; her sefer giriş gerekmez.
3. **"Durumu Yenile"** → giriş doğrulanır, kullanıcı adınız otomatik dolar.
4. İstediğiniz modülün ayarlarını yapıp **Başlat**'a basın; işlemleri **Canlı İşlem Kaydı**'ndan izleyin. İstediğiniz an **Durdur**.

**EN:**
1. **Pick a language** (top-right: TR/EN/DE/ES/FR/IT). The UI and logs switch instantly; gender guessing uses this language too.
2. **"Open Browser / Sign In"** → sign in to your account in the opened Chromium (handle 2FA/password manually). The session is saved; no need to sign in every time.
3. **"Refresh Status"** → sign-in is verified and your username is auto-filled.
4. Configure a module and click **Start**; watch the **Live Activity Log**. **Stop** anytime.

### Modüller / Modules

- **❤ Otomatik Beğeni / Auto Like** — akış filtreleri (RT/yanıt/reklam), ms aralık, oturum + günlük limit. / feed filters (retweets/replies/ads), ms interval, session + daily cap.
- **✕ Takipten Çıkma / Unfollow** — geri takip etmeyenleri çıkarır, whitelist, limitler. / unfollows non-followers, whitelist, limits.
- **➕ Takip Etme / Follow** — hedef kullanıcının takipçi/takip listesinden filtreli takip: biosu dolu olanlar, mavi tik hariç, cinsiyet tahmini, bio kelime içerir/hariç, ms aralık, limitler. / follow from a target's followers/following list with filters: has-bio, exclude verified, gender guess, bio keyword include/exclude, ms interval, limits.

---

## Notlar / Notes

- **TR:** Giriş oturumu `user-data/` klasöründe saklanır (git'e dahil değil). Çıkış için klasörü silin. Ayarlar `settings.json`, günlük sayaçlar `daily-stats.json` dosyasında tutulur.
- **EN:** The login session is stored in `user-data/` (not in git). Delete it to sign out. Settings live in `settings.json`, daily counters in `daily-stats.json`.
- **TR:** Masaüstü modunda pencereyi kapatmak sunucuyu da kapatır. Web modunda durdurmak için terminalde `Ctrl+C`.
- **EN:** In desktop mode, closing the window also stops the server. In web mode, press `Ctrl+C` in the terminal to stop.

---

## Proje Yapısı / Project Structure

```
x-otomasyon/
  electron-main.cjs   Masaüstü sarmalayıcı / desktop wrapper (Electron)
  server.js           Express + WebSocket sunucu / server
  src/
    state.js          Ayarlar, olay yayını, sayaçlar, dil / settings, events, counters, language
    locales.js        Çeviriler (6 dil) / translations (6 languages)
    browser.js        Playwright kalıcı tarayıcı + giriş / persistent browser + login
    liker.js          Otomatik beğeni / auto like
    unfollower.js     Takipten çıkma / unfollow
    follower.js       Takip etme / follow
    names.js          İsimden cinsiyet tahmini / gender guess (gender-detection-from-name)
    utils.js          Rastgele/iptal edilebilir bekleme / delays
  public/             Pano arayüzü / dashboard UI (index.html, app.js, style.css)
```

---

## (İsteğe bağlı) Tek dosya .exe / (Optional) Standalone .exe

**TR:** Kurulmuş bir masaüstü uygulaması (.exe) üretmek isterseniz `electron-builder` kullanabilirsiniz:
**EN:** To produce an installable desktop app (.exe), you can use `electron-builder`:

```bash
npm install --save-dev electron-builder
npx electron-builder --win
```
