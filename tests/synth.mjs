// Synthetic blood pressure monitor photos for testing the seven-segment reader.
// Renders gray-ish RGBA images with an LCD panel, SYS/DIA/PULSE in 7-segment digits,
// labels, icons, a small clock, slant, segment gaps, ghost segments, lighting, noise, blur.

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const SEGMAP = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};

function fillPoly(buf, W, H, pts, val) {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const [x, y] of pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  const x0 = Math.max(0, Math.floor(minx)), x1 = Math.min(W - 1, Math.ceil(maxx));
  const y0 = Math.max(0, Math.floor(miny)), y1 = Math.min(H - 1, Math.ceil(maxy));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) buf[y * W + x] = val;
    }
  }
}

function segPoly(seg, ox, oy, Hd, Wd, t, gap, slant) {
  const L = t / 2, R = Wd - t / 2, T = t / 2, M = Hd / 2, B = Hd - t / 2;
  const hseg = (y, xa, xb) => [[xa, y], [xa + t / 2, y - t / 2], [xb - t / 2, y - t / 2], [xb, y], [xb - t / 2, y + t / 2], [xa + t / 2, y + t / 2]];
  const vseg = (x, ya, yb) => [[x, ya], [x + t / 2, ya + t / 2], [x + t / 2, yb - t / 2], [x, yb], [x - t / 2, yb - t / 2], [x - t / 2, ya + t / 2]];
  let p;
  switch (seg) {
    case 'a': p = hseg(T, L + gap, R - gap); break;
    case 'g': p = hseg(M, L + gap, R - gap); break;
    case 'd': p = hseg(B, L + gap, R - gap); break;
    case 'f': p = vseg(L, T + gap, M - gap); break;
    case 'b': p = vseg(R, T + gap, M - gap); break;
    case 'e': p = vseg(L, M + gap, B - gap); break;
    case 'c': p = vseg(R, M + gap, B - gap); break;
  }
  return p.map(([x, y]) => [ox + x + slant * (Hd / 2 - y), oy + y]);
}

function drawNumber(buf, W, H, value, nDigits, right, top, Hd, st, ink, ghost) {
  const Wd = Hd * st.aspect, pitch = Wd * (1 + st.spacing);
  const s = String(value);
  for (let k = 0; k < nDigits; k++) {
    const ch = s[s.length - nDigits + k];
    const ox = right - (nDigits - k) * pitch;
    for (const seg of 'abcdefg') {
      const lit = ch !== undefined && SEGMAP[ch].includes(seg);
      if (!lit && ghost == null) continue;
      fillPoly(buf, W, H, segPoly(seg, ox, top, Hd, Wd, st.t * Hd, st.gap * st.t * Hd, st.slant), lit ? ink : ghost);
    }
  }
}

function drawBlobText(buf, W, H, x, y, h, n, val, r) {
  // Label-like text: a few small letter-ish rectangles.
  let cx = x;
  for (let i = 0; i < n; i++) {
    const w = h * (0.5 + 0.3 * r());
    const t = Math.max(1, h * 0.18);
    fillPoly(buf, W, H, [[cx, y], [cx + w, y], [cx + w, y + t], [cx, y + t]], val);
    fillPoly(buf, W, H, [[cx, y], [cx + t, y], [cx + t, y + h], [cx, y + h]], val);
    if (r() < 0.6) fillPoly(buf, W, H, [[cx, y + h - t], [cx + w, y + h - t], [cx + w, y + h], [cx, y + h]], val);
    cx += w * 1.35;
  }
}

export function makeMonitor(seed, opts = {}) {
  const r = rng(seed);
  const W = opts.W || (r() < 0.5 ? 640 : 900), H = opts.H || Math.round(W * (r() < 0.6 ? 1.33 : 0.75));
  const sys = opts.sys ?? 95 + Math.floor(r() * 90);
  const dia = opts.dia ?? Math.min(sys - 18, 50 + Math.floor(r() * 55));
  const pulse = opts.pulse ?? 48 + Math.floor(r() * 60);
  const g = new Float32Array(W * H);
  // Monitor body (light) on a darker table.
  const table = 60 + r() * 60;
  g.fill(table);
  const bx0 = W * (0.05 + r() * 0.08), bx1 = W * (0.92 - r() * 0.08), by0 = H * (0.04 + r() * 0.08), by1 = H * (0.94 - r() * 0.06);
  const body = 175 + r() * 60;
  const lum = new Uint8Array(W * H);
  // Display panel inside the body.
  const pw = (bx1 - bx0) * (0.62 + r() * 0.25), ph = Math.min((by1 - by0) * 0.62, pw * (0.85 + r() * 0.5));
  const px0 = bx0 + ((bx1 - bx0) - pw) / 2, py0 = by0 + (by1 - by0) * 0.08;
  const panel = 150 + r() * 70;
  const ink = 25 + r() * 55;
  const ghost = r() < 0.4 ? panel - (6 + r() * 14) : null;
  const st = { aspect: 0.48 + r() * 0.14, spacing: 0.12 + r() * 0.3, t: 0.1 + r() * 0.07, gap: r() * 0.45, slant: r() < 0.6 ? r() * 0.2 : 0 };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (x >= bx0 && x < bx1 && y >= by0 && y < by1) g[i] = body;
    if (x >= px0 && x < px0 + pw && y >= py0 && y < py0 + ph) g[i] = panel;
  }
  // Panel frame.
  const fr = Math.max(2, pw * 0.01);
  const frameVal = r() < 0.5 ? ink + 20 : body - 40;
  for (const [a, b, c, d] of [[px0 - fr, py0 - fr, px0 + pw + fr, py0], [px0 - fr, py0 + ph, px0 + pw + fr, py0 + ph + fr], [px0 - fr, py0, px0, py0 + ph], [px0 + pw, py0, px0 + pw + fr, py0 + ph]]) {
    for (let y = Math.max(0, Math.floor(b)); y < Math.min(H, c === undefined ? 0 : d); y++) for (let x = Math.max(0, Math.floor(a)); x < Math.min(W, c); x++) g[y * W + x] = frameVal;
  }
  const buf = new Float32Array(g);
  const layout = r() < 0.75 ? 'stack' : 'pulseRight';
  const Hs = ph * (0.24 + r() * 0.06);
  const Hdia = Hs * (r() < 0.5 ? 1 : 0.85 + r() * 0.1);
  const Hp = Hs * (0.45 + r() * 0.2);
  const right = px0 + pw * (layout === 'stack' ? 0.9 : 0.68);
  const top1 = py0 + ph * 0.1;
  const top2 = top1 + Hs + ph * (0.05 + r() * 0.06);
  drawNumber(buf, W, H, sys, 3, right, top1, Hs, st, ink, ghost);
  drawNumber(buf, W, H, dia, 3, right, top2, Hdia, st, ink, ghost);
  let pr, pt;
  if (layout === 'stack') { pr = right; pt = top2 + Hdia + ph * 0.05; }
  else { pr = px0 + pw * 0.96; pt = top2 + Hdia - Hp; }
  if (pt + Hp < py0 + ph) drawNumber(buf, W, H, pulse, 3, pr, pt, Hp, st, ink, ghost);
  // Labels ("SYS", "DIA", "mmHg", "PUL/min") and icons.
  const lh = Hs * 0.16;
  drawBlobText(buf, W, H, px0 + pw * 0.05, top1 + Hs * 0.2, lh, 3, ink, r);
  drawBlobText(buf, W, H, px0 + pw * 0.05, top2 + Hdia * 0.2, lh, 3, ink, r);
  if (r() < 0.7) drawBlobText(buf, W, H, right + pw * 0.01, top1 + Hs * 0.7, lh * 0.8, 4, ink, r);
  if (r() < 0.7) {
    const hx = px0 + pw * 0.12, hy = pt + Hp * 0.3, hr = Hp * 0.25;
    const heart = [];
    for (let a = 0; a < Math.PI * 2; a += 0.3) heart.push([hx + hr * Math.cos(a), hy + hr * Math.sin(a)]);
    fillPoly(buf, W, H, heart, ink);
  }
  if (r() < 0.6) {
    // Small clock at the top of the panel.
    const ch = ph * 0.06, cst = { ...st, t: 0.15, gap: 0.2 };
    drawNumber(buf, W, H, 10 + Math.floor(r() * 2), 2, px0 + pw * 0.35, py0 + ph * 0.015, ch, cst, ink, null);
    drawNumber(buf, W, H, 10 + Math.floor(r() * 50), 2, px0 + pw * 0.55, py0 + ph * 0.015, ch, cst, ink, null);
  }
  // Lighting gradient, glare, noise, blur.
  const gx = (r() - 0.5) * 0.5, gy = (r() - 0.5) * 0.5;
  const glare = r() < 0.3 ? { x: px0 + r() * pw, y: py0 + r() * ph, rad: pw * (0.1 + r() * 0.15), amt: 20 + r() * 30 } : null;
  const noise = 2 + r() * 7;
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = buf[y * W + x] * (1 + gx * (x / W - 0.5) + gy * (y / H - 0.5));
    if (glare) {
      const d = Math.hypot(x - glare.x, y - glare.y) / glare.rad;
      if (d < 1) v += glare.amt * (1 - d * d);
    }
    out[y * W + x] = v + (r() + r() + r() - 1.5) * noise * 1.4;
  }
  const blur = Math.floor(r() * 3);
  let img = out;
  if (blur) {
    img = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dy = -blur; dy <= blur; dy++) for (let dx = -blur; dx <= blur; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < W && yy >= 0 && yy < H) { s += out[yy * W + xx]; c++; }
      }
      img[y * W + x] = s / c;
    }
  }
  // Tint: LCDs are often slightly green/gray; some backlights are blue.
  const tint = r() < 0.2 ? [0.75, 0.9, 1.15] : r() < 0.5 ? [0.95, 1.02, 0.93] : [1, 1, 1];
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = img[i] * tint[0];
    data[i * 4 + 1] = img[i] * tint[1];
    data[i * 4 + 2] = img[i] * tint[2];
    data[i * 4 + 3] = 255;
  }
  void lum;
  return { width: W, height: H, data, truth: { sys, dia, pulse: pt + Hp < py0 + ph ? pulse : null }, style: { ...st, layout, ghost: ghost != null, blur, glare: !!glare } };
}
