// 'gender-detection-from-name' paketinin isim listelerini, eklentinin okuduğu
// sıkıştırılmış extension/lib/names.json dosyasına dönüştürür.
// Kullanım (proje kökünde, npm install sonrası):  npm run ext:names
const fs = require('fs');
const path = require('path');

const LANGS = ['tr', 'en', 'de', 'es', 'fr', 'it'];
const pkgDir = path.dirname(require.resolve('gender-detection-from-name/package.json'));
const out = {};

for (const lang of LANGS) {
  const map = require(path.join(pkgDir, 'names', `${lang}.js`));
  const female = [];
  const male = [];
  for (const [name, gender] of map) {
    if (name.includes('|')) continue;
    if (gender === 'female') female.push(name);
    else if (gender === 'male') male.push(name);
  }
  out[lang] = { f: female.join('|'), m: male.join('|') };
}

const target = path.join(__dirname, '..', 'lib', 'names.json');
fs.writeFileSync(target, JSON.stringify(out));
const kb = Math.round(fs.statSync(target).size / 1024);
console.log(`names.json yazıldı (${kb} KB) -> ${target}`);
