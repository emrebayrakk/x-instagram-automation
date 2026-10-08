# Gizlilik Politikası · Privacy Policy

**X Otomasyon** (Chrome eklentisi / Chrome extension)

Son güncelleme / Last updated: 8 Ekim 2026 / October 8, 2026

[Türkçe](#türkçe) · [English](#english)

---

## Türkçe

### Kısaca

X Otomasyon **hiçbir veriyi geliştiriciye ya da üçüncü taraflara göndermez**. Sunucusu, analitik aracı veya reklamı yoktur. Eklentinin işlediği her şey yalnızca senin tarayıcında, Chrome'un yerel depolamasında (`chrome.storage.local`) tutulur.

### Hangi verileri işler?

| Veri | Ne için | Nerede |
|---|---|---|
| Ayarlar (filtreler, limitler, bekleme süreleri), günlük işlem sayaçları, işlem kaydı, görev ve görev sırası durumu | Eklentinin çalışması ve oturumlar arasında hatırlanması | Yalnızca tarayıcında |
| Kendi X ve Instagram kullanıcı adın, Instagram kullanıcı kimliğin | Hangi hesapta oturum açık olduğunu panelde göstermek ve doğru hesabın listelerini açmak | Yalnızca tarayıcında |
| X sayfalarındaki içerik: gönderiler, profil adları, kullanıcı adları, biyografiler, takipçi/takip sayıları, hesap tarihi, konum | Senin belirlediğin filtreleri uygulamak (ör. "profil fotoğrafı olmayanları takip etme") | Sayfa üzerinde işlenir, saklanmaz |
| X takip geçmişi: eklentiyle takip ettiğin ve bıraktığın hesapların kullanıcı adları ve tarihleri | "Tekrar takip etme" gibi filtreler ve geri takip oranı | Yalnızca tarayıcında |
| Instagram'da takip ettiklerin ve takipçilerin: kullanıcı kimliği, kullanıcı adı, görünen ad, profil fotoğrafı adresi, onaylı/gizli bilgisi | Seni geri takip etmeyenleri bulmak | Yalnızca tarayıcında |
| Instagram oturum çerezleri (`ds_user_id`, `csrftoken`) | Instagram'a, senin zaten açık olan oturumunla istek gönderebilmek | Okunur, başka hiçbir yere gönderilmez |

İsimden cinsiyet tahmini (isteğe bağlı filtre) eklentinin içindeki isim listesiyle **cihazında** yapılır.

### Ağ bağlantıları

Eklenti yalnızca şu adreslerle iletişim kurar:

- **x.com / twitter.com:** sayfanın kendi düğmelerine senin adına tıklar.
- **www.instagram.com:** takip/takipçi listelerini almak ve seçtiğin hesapları takipten çıkarmak için Instagram'ın kendi web isteklerini senin oturumunla gönderir.
- **Instagram görsel sunucuları:** panelde profil fotoğraflarını göstermek için.

Bunların dışında hiçbir sunucuya istek gönderilmez. Eklenti dışarıdan kod indirmez veya çalıştırmaz.

### Veri paylaşımı

Veriler satılmaz, kiralanmaz, paylaşılmaz ve eklentinin amacı dışında hiçbir şekilde kullanılmaz. Kredi değerlendirmesi veya benzeri amaçlarla kullanılmaz.

### Saklama süresi ve silme

Veriler sen silene kadar tarayıcında kalır:

- Panelde **Ayarlar → Veriler** bölümünden Instagram tarama sonuçlarını, işlem kaydını, takip geçmişini silebilir ve ayarları sıfırlayabilirsin.
- Eklentiyi kaldırdığında Chrome eklentinin bütün verilerini siler.

### İzinler

- `storage`, `unlimitedStorage`: yukarıdaki verileri yerelde saklamak (büyük hesaplarda tarama sonuçları varsayılan sınırı aşabilir).
- `sidePanel`: arayüzü Chrome'un yan panelinde açmak.
- `alarms`: görev sırasındaki bekleme adımlarından sonra bir sonraki adımı başlatmak.
- x.com, twitter.com ve www.instagram.com erişimi: eklentinin yalnızca bu sitelerde çalışması.

### Değişiklikler

Bu politika değişirse güncel hali bu sayfada yayınlanır ve "Son güncelleme" tarihi değiştirilir.

### İletişim

Sorular için: [emrebayrak.com.tr](https://emrebayrak.com.tr) ya da bu repoda bir [issue](https://github.com/emrebayrakk/x-instagram-automation/issues) aç.

X Otomasyon, X Corp. veya Meta Platforms, Inc. ile bağlantılı değildir ve onlar tarafından onaylanmamıştır.

---

## English

### In short

X Otomasyon **does not send any data to the developer or to third parties**. It has no server, no analytics and no ads. Everything the extension handles stays in your browser, in Chrome's local storage (`chrome.storage.local`).

### What data it handles

| Data | Why | Where |
|---|---|---|
| Settings (filters, limits, delays), daily action counters, activity log, task and task queue state | To run the extension and remember it between sessions | Your browser only |
| Your own X and Instagram usernames, your Instagram user ID | To show which account is signed in and open the right account's lists | Your browser only |
| Content on X pages: posts, display names, usernames, bios, follower/following counts, account creation date, location | To apply the filters you set (e.g. "don't follow accounts without a profile photo") | Processed on the page, not stored |
| X follow history: usernames and dates of accounts you followed and unfollowed with the extension | For filters like "don't re-follow" and the follow-back rate | Your browser only |
| Your Instagram following and followers: user ID, username, display name, profile picture URL, verified/private flags | To find accounts that don't follow you back | Your browser only |
| Instagram session cookies (`ds_user_id`, `csrftoken`) | To send requests to Instagram with the session you already have open | Read, never sent anywhere else |

Gender guessing from names (an optional filter) runs **on your device** using a name list bundled with the extension.

### Network connections

The extension only talks to:

- **x.com / twitter.com:** clicks the page's own buttons on your behalf.
- **www.instagram.com:** sends Instagram's own web requests with your session to list your following/followers and unfollow the accounts you select.
- **Instagram image servers:** to show profile pictures in the panel.

No requests are sent to any other server. The extension does not download or run remote code.

### Data sharing

Data is not sold, rented or shared, and is not used for anything other than the extension's purpose. It is not used for creditworthiness or similar purposes.

### Retention and deletion

Data stays in your browser until you delete it:

- In the panel, **Settings → Data** lets you delete Instagram scan results, the activity log and the follow history, and reset your settings.
- Removing the extension makes Chrome delete all of its data.

### Permissions

- `storage`, `unlimitedStorage`: to keep the data above locally (scan results for large accounts can exceed the default limit).
- `sidePanel`: to show the interface in Chrome's side panel.
- `alarms`: to start the next step after a wait step in the task queue.
- Access to x.com, twitter.com and www.instagram.com: the extension only works on these sites.

### Changes

If this policy changes, the updated version is published on this page and the "Last updated" date changes.

### Contact

Questions: [emrebayrak.com.tr](https://emrebayrak.com.tr) or open an [issue](https://github.com/emrebayrakk/x-instagram-automation/issues) in this repository.

X Otomasyon is not affiliated with or endorsed by X Corp. or Meta Platforms, Inc.
