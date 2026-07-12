// Kucuk yardimcilar: rastgele/insansi bekleme, iptal edilebilir uyku.
export function randInt(min, max) {
  min = Math.max(0, Number(min) || 0);
  max = Math.max(min, Number(max) || min);
  return Math.floor(min + Math.random() * (max - min + 1));
}

// control.running false olursa beklemeyi erken keser.
export function sleep(ms, control) {
  return new Promise((resolve) => {
    const step = 200;
    let elapsed = 0;
    const t = setInterval(() => {
      elapsed += step;
      if (elapsed >= ms || (control && !control.running)) {
        clearInterval(t);
        resolve();
      }
    }, step);
  });
}
