// Renders the app icons: node tools/make-icons.mjs
import { writePNG } from '../tests/png.mjs';

function icon(size) {
  const ss = 4;
  const data = new Uint8ClampedArray(size * size * 4);
  const ecg = [[-0.95, 0.02], [-0.42, 0.02], [-0.26, -0.3], [-0.06, 0.42], [0.14, -0.12], [0.26, 0.02], [0.95, 0.02]];
  const segDist = (px, py, [ax, ay], [bx, by]) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size, v = (y + (sy + 0.5) / ss) / size;
          // Background gradient.
          let cr = 214 - 40 * v, cg = 62 - 20 * v, cb = 56 - 18 * v;
          // Heart in the middle 60%.
          const hx = (u - 0.5) * 2.7, hy = (0.47 - v) * 2.7;
          const f = (hx * hx + hy * hy - 1) ** 3 - hx * hx * hy ** 3;
          if (f <= 0) {
            cr = 255; cg = 255; cb = 255;
            const ex = (u - 0.5) * 2.4, ey = (v - 0.47) * 2.4;
            let d = Infinity;
            for (let i = 0; i < ecg.length - 1; i++) d = Math.min(d, segDist(ex, ey, ecg[i], ecg[i + 1]));
            if (d < 0.065) { cr = 194; cg = 53; cb = 47; }
          }
          r += cr; g += cg; b += cb;
        }
      }
      const i = (y * size + x) * 4, n = ss * ss;
      data[i] = r / n; data[i + 1] = g / n; data[i + 2] = b / n; data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) {
  writePNG(new URL(`../icons/${name}.png`, import.meta.url).pathname, icon(size));
}
console.log('icons written');
