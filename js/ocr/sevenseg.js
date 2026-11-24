// Seven-segment reader for home blood pressure monitors.
//
// Pure JavaScript, no DOM: runs on the main thread, in a Web Worker and in Node (tests).
// Input is RGBA pixels ({ width, height, data }), e.g. a canvas ImageData.
//
// Pipeline, run over a few threshold/polarity/merge-radius settings, best result wins:
//   1. grayscale + local (Bradley) threshold  -> ink mask
//   2. dilate the mask a little so the segments of one digit join, then label blobs
//   3. keep digit-shaped blobs, group them into horizontal numbers
//   4. per number: remove italic slant, decode each digit from 7 segment zones
//   5. pick SYS / DIA / PULSE from the numbers by value, size and position

const DIGITS = [
  ['0', 'abcdef'], ['1', 'bc'], ['2', 'abdeg'], ['3', 'abcdg'], ['4', 'bcfg'],
  ['5', 'acdfg'], ['6', 'acdefg'], ['6', 'cdefg'], ['7', 'abc'], ['7', 'abcf'],
  ['8', 'abcdefg'], ['9', 'abcdfg'], ['9', 'abcfg'],
];
const SEGS = 'abcdefg';
const PATTERNS = DIGITS.map(([d, s]) => ({ d, on: [...SEGS].map((c) => (s.includes(c) ? 1 : 0)) }));

// Segment zones in a digit box normalised to [0,1] x [0,1] (u = x, v = y). Disjoint.
const ZONES = [
  [0.28, 0.72, 0.0, 0.17], // a
  [0.72, 1.0, 0.13, 0.43], // b
  [0.72, 1.0, 0.57, 0.87], // c
  [0.28, 0.72, 0.83, 1.0], // d
  [0.0, 0.28, 0.57, 0.87], // e
  [0.0, 0.28, 0.13, 0.43], // f
  [0.28, 0.72, 0.42, 0.58], // g
];

const SHEARS = [];
for (let s = -0.36; s <= 0.3601; s += 0.03) SHEARS.push(Math.round(s * 100) / 100);

export function toGray(rgba, width, height, mode = 'luma') {
  const n = width * height;
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = rgba[j], gg = rgba[j + 1], b = rgba[j + 2];
    g[i] = mode === 'max' ? Math.max(r, gg, b) : (r * 77 + gg * 150 + b * 29) >> 8;
  }
  return g;
}

// Box-filter downscale of a gray image (used by Node tests; the browser resizes on a canvas).
export function resizeGray(src, w, h, nw, nh) {
  if (nw === w && nh === h) return src;
  const out = new Uint8Array(nw * nh);
  const sx = w / nw, sy = h / nh;
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let s = 0, c = 0;
      for (let yy = y0; yy < y1 && yy < h; yy++) {
        const row = yy * w;
        for (let xx = x0; xx < x1 && xx < w; xx++) { s += src[row + xx]; c++; }
      }
      out[y * nw + x] = c ? Math.round(s / c) : 0;
    }
  }
  return out;
}

function integral(gray, w, h) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0;
    const r = y * w, o = (y + 1) * (w + 1), p = y * (w + 1);
    for (let x = 0; x < w; x++) {
      rs += gray[r + x];
      I[o + x + 1] = I[p + x + 1] + rs;
    }
  }
  return I;
}

// Bradley local threshold. invert=false: dark ink on a light background (LCD).
export function binarize(gray, I, w, h, win, k, invert) {
  const out = new Uint8Array(w * h);
  const hw = win >> 1;
  const W1 = w + 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - hw), y1 = Math.min(h - 1, y + hw);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - hw), x1 = Math.min(w - 1, x + hw);
      const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = I[(y1 + 1) * W1 + x1 + 1] - I[y0 * W1 + x1 + 1] - I[(y1 + 1) * W1 + x0] + I[y0 * W1 + x0];
      const mean = sum / cnt;
      const g = gray[y * w + x];
      if (invert) {
        if (g > mean * (1 + k) && g - mean > 14) out[y * w + x] = 1;
      } else if (g < mean * (1 - k) && mean - g > 14) out[y * w + x] = 1;
    }
  }
  return out;
}

// Spread between the 1st and 99th percentile grey level (global contrast).
export function grayRange(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const n = gray.length;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.01) { hi = v; break; } }
  return hi - lo;
}

export function boxBlur(gray, w, h, r) {
  if (r <= 0) return gray;
  const I = integral(gray, w, h), out = new Uint8Array(w * h), W1 = w + 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const sum = I[(y1 + 1) * W1 + x1 + 1] - I[y0 * W1 + x1 + 1] - I[(y1 + 1) * W1 + x0] + I[y0 * W1 + x0];
      out[y * w + x] = sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
    }
  }
  return out;
}

// Sliding max (isMax) or min over a (2r+1)^2 square, separable, O(n) with a monotonic deque.
function extreme(src, w, h, r, isMax) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  const dq = new Int32Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let head = 0, tail = 0;
    for (let i = 0; i < w + r; i++) {
      if (i < w) {
        const v = src[row + i];
        if (isMax) while (tail > head && src[row + dq[tail - 1]] <= v) tail--;
        else while (tail > head && src[row + dq[tail - 1]] >= v) tail--;
        dq[tail++] = i;
      }
      const c = i - r;
      if (c < 0) continue;
      while (dq[head] < c - r) head++;
      tmp[row + c] = src[row + dq[head]];
    }
  }
  for (let x = 0; x < w; x++) {
    let head = 0, tail = 0;
    for (let i = 0; i < h + r; i++) {
      if (i < h) {
        const v = tmp[i * w + x];
        if (isMax) while (tail > head && tmp[dq[tail - 1] * w + x] <= v) tail--;
        else while (tail > head && tmp[dq[tail - 1] * w + x] >= v) tail--;
        dq[tail++] = i;
      }
      const c = i - r;
      if (c < 0) continue;
      while (dq[head] < c - r) head++;
      out[c * w + x] = tmp[dq[head] * w + x];
    }
  }
  return out;
}

// Local background: a grey closing (max then min) with radius r erases dark strokes thinner
// than ~2r but keeps large regions (a whole LCD panel darker than the case stays background).
// For light-on-dark displays (invert) it is an opening.
export function background(gray, w, h, r, invert) {
  return invert ? extreme(extreme(gray, w, h, r, false), w, h, r, true) : extreme(extreme(gray, w, h, r, true), w, h, r, false);
}

// Ink = darker (or, inverted, brighter) than the local background by a margin.
export function maskFrom(gray, bg, k, invert, minDiff = 16) {
  const n = gray.length, out = new Uint8Array(n), minInv = minDiff * 1.5;
  for (let i = 0; i < n; i++) {
    const g = gray[i], b = bg[i];
    if (invert) { if (g - b > Math.max(minInv, k * g)) out[i] = 1; }
    else if (b - g > Math.max(minDiff, k * b)) out[i] = 1;
  }
  return out;
}

export function inkMask(gray, w, h, r, k, invert) {
  return maskFrom(gray, background(gray, w, h, r, invert), k, invert);
}

// Rectangular dilation with radii rx, ry (separable, sliding counts).
export function dilate(bin, w, h, rx, ry = rx) {
  if (rx <= 0 && ry <= 0) return bin;
  let r = rx;
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let c = 0;
    for (let x = 0; x < Math.min(r, w); x++) c += bin[row + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) c += bin[row + x + r];
      if (x - r - 1 >= 0) c -= bin[row + x - r - 1];
      tmp[row + x] = c > 0 ? 1 : 0;
    }
  }
  const out = new Uint8Array(w * h);
  r = ry;
  for (let x = 0; x < w; x++) {
    let c = 0;
    for (let y = 0; y < Math.min(r, h); y++) c += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + r < h) c += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) c -= tmp[(y - r - 1) * w + x];
      out[y * w + x] = c > 0 ? 1 : 0;
    }
  }
  return out;
}

// 8-connected labelling. Returns { labels (Int32Array, 0 = background), count }.
export function label(bin, w, h) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let count = 0;
  for (let i = 0; i < w * h; i++) {
    if (!bin[i] || labels[i]) continue;
    count++;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = count;
    while (sp) {
      const p = stack[--sp];
      const px = p % w, py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (bin[q] && !labels[q]) { labels[q] = count; stack[sp++] = q; }
        }
      }
    }
  }
  return { labels, count };
}

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Group the original ink pixels by the dilated blob they fall in.
function blobs(bin, dl, count, w, h) {
  const n = new Int32Array(count + 1);
  const x0 = new Int32Array(count + 1).fill(w), y0 = new Int32Array(count + 1).fill(h);
  const x1 = new Int32Array(count + 1).fill(-1), y1 = new Int32Array(count + 1).fill(-1);
  for (let i = 0; i < w * h; i++) {
    if (!bin[i]) continue;
    const l = dl[i];
    n[l]++;
    const x = i % w, y = (i - x) / w;
    if (x < x0[l]) x0[l] = x;
    if (x > x1[l]) x1[l] = x;
    if (y < y0[l]) y0[l] = y;
    if (y > y1[l]) y1[l] = y;
  }
  const start = new Int32Array(count + 2);
  for (let l = 1; l <= count; l++) start[l + 1] = start[l] + n[l];
  const fillPos = start.slice();
  const pix = new Int32Array(start[count + 1]);
  for (let i = 0; i < w * h; i++) if (bin[i]) pix[fillPos[dl[i]]++] = i;
  const out = [];
  for (let l = 1; l <= count; l++) {
    if (!n[l]) continue;
    out.push({ x0: x0[l], y0: y0[l], x1: x1[l], y1: y1[l], n: n[l], pix: pix.subarray(start[l], start[l + 1]) });
  }
  return out;
}

function boxOf(pixArr, w) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const i of pixArr) {
    const x = i % w, y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, n: pixArr.length, pix: pixArr };
}

// Split a blob that looks like 2-3 touching digits at the emptiest columns.
function splitWide(b, w) {
  const W = b.x1 - b.x0 + 1, H = b.y1 - b.y0 + 1;
  const parts = Math.max(2, Math.min(3, Math.round(W / (0.6 * H))));
  const proj = new Int32Array(W);
  for (const i of b.pix) proj[(i % w) - b.x0]++;
  const cuts = [];
  for (let k = 1; k < parts; k++) {
    const c = Math.round((k * W) / parts), r = Math.round(W * 0.14);
    let best = c, bv = Infinity;
    for (let x = Math.max(1, c - r); x <= Math.min(W - 2, c + r); x++) if (proj[x] < bv) { bv = proj[x]; best = x; }
    cuts.push(best + b.x0);
  }
  const buckets = Array.from({ length: parts }, () => []);
  for (const i of b.pix) {
    const x = i % w;
    let k = 0;
    while (k < cuts.length && x >= cuts[k]) k++;
    buckets[k].push(i);
  }
  return buckets.filter((p) => p.length).map((p) => boxOf(Int32Array.from(p), w));
}

function glyphCandidates(list, w, h) {
  const minDim = Math.min(w, h);
  const minH = Math.max(10, 0.03 * minDim), maxH = 0.95 * h;
  const out = [];
  const consider = (b, allowSplit) => {
    const W = b.x1 - b.x0 + 1, H = b.y1 - b.y0 + 1;
    if (H < minH || H > maxH || W > 0.6 * w) return;
    const fill = b.n / (W * H), asp = H / W;
    if (asp >= 1.05 && asp <= 3.3 && fill > 0.1 && fill < 0.88) out.push({ ...b, W, H, one: false });
    else if (asp > 3.3 && asp < 16 && fill > 0.35) out.push({ ...b, W, H, one: true });
    else if (allowSplit && asp >= 0.32 && asp < 1.05 && fill > 0.1 && fill < 0.8) {
      for (const p of splitWide(b, w)) consider({ ...p, split: true }, false);
    }
  };
  for (const b of list) consider(b, true);
  return out;
}

// Digit-like blobs (found at several merge radii) seed horizontal bands, one per number.
function makeBands(seeds) {
  const bands = [];
  for (const sd of seeds) {
    let hit = null;
    for (const b of bands) {
      const vo = Math.min(b.y1, sd.y1) - Math.max(b.y0, sd.y0) + 1;
      const hr = sd.H / b.H;
      if (hr < 0.8 || hr > 1.25 || vo < 0.7 * Math.min(sd.H, b.H)) continue;
      if (Math.max(b.x0, sd.x0) - Math.min(b.x1, sd.x1) > 2 * b.H) continue;
      hit = b;
      break;
    }
    if (hit) {
      hit.x0 = Math.min(hit.x0, sd.x0); hit.x1 = Math.max(hit.x1, sd.x1); hit.seeds.push(sd);
      hit.ys0.push(sd.y0); hit.ys1.push(sd.y1);
      hit.y0 = median(hit.ys0); hit.y1 = median(hit.ys1); hit.H = hit.y1 - hit.y0 + 1;
    } else bands.push({ x0: sd.x0, x1: sd.x1, y0: sd.y0, y1: sd.y1, H: sd.H, ys0: [sd.y0], ys1: [sd.y1], seeds: [sd] });
  }
  return bands;
}

function matchDigit(fn) {
  let best = null, second = null;
  for (const p of PATTERNS) {
    let cost = 0;
    for (let z = 0; z < 7; z++) cost += Math.abs(fn[z] - p.on[z]);
    if (!best || cost < best.cost) {
      if (best && best.d !== p.d) second = best;
      best = { d: p.d, cost };
    } else if (p.d !== best.d && (!second || cost < second.cost)) second = { d: p.d, cost };
  }
  return { best, margin: second ? second.cost - best.cost : 3 };
}

// Read the number(s) in one band: remove slant, cut digits at empty columns, decode each.
function readBand(bin, w, h, band) {
  const H0 = band.H;
  const m = Math.round(0.06 * H0);
  const yA = Math.max(0, Math.round(band.y0) - m), yB = Math.min(h - 1, Math.round(band.y1) + m);
  const xA = Math.max(0, Math.round(band.x0 - 2.2 * H0)), xB = Math.min(w - 1, Math.round(band.x1 + 2.2 * H0));
  const cy = (yA + yB) / 2;
  const XS = [], YS = [];
  for (let y = yA; y <= yB; y++) {
    const row = y * w;
    for (let x = xA; x <= xB; x++) if (bin[row + x]) { XS.push(x); YS.push(y); }
  }
  const n = XS.length;
  if (n < 20) return [];
  const off = Math.ceil(0.37 * (yB - yA)) + 2;
  const span = xB - xA + 1 + 2 * off;
  const cols = new Int32Array(span);
  const step = n > 30000 ? Math.ceil(n / 30000) : 1;
  // Slant from the seed digits only (frame lines and labels nearby are upright).
  const sx0 = band.x0 - 0.15 * H0, sx1 = band.x1 + 0.15 * H0;
  let shear = 0, bestE = -1;
  for (const s of SHEARS) {
    cols.fill(0);
    for (let i = 0; i < n; i += step) if (XS[i] >= sx0 && XS[i] <= sx1) cols[Math.round(XS[i] - s * (YS[i] - cy)) - xA + off]++;
    let e = 0;
    for (let j = 0; j < span; j++) e += cols[j] * cols[j];
    if (e > bestE * 1.002 || (e > bestE * 0.998 && Math.abs(s) < Math.abs(shear))) { if (e > bestE) bestE = e; shear = s; }
  }
  cols.fill(0);
  const CI = new Int32Array(n);
  for (let i = 0; i < n; i++) { const c = Math.round(XS[i] - shear * (YS[i] - cy)) - xA + off; CI[i] = c; cols[c]++; }
  const numbers = [];
  // Segment digits at empty columns (a 1-column gap may still be inside a digit).
  // Whole-digit blobs from the merge step tell which column runs belong to one digit on
  // displays that leave wide gaps between segments.
  const seedRanges = [];
  for (const sd of band.seeds || []) {
    const asp = sd.H / sd.W;
    if (sd.one || sd.split || asp < 1.3 || asp > 2.6 || sd.H < 0.85 * H0 || sd.H > 1.18 * H0) continue;
    let lo = Infinity, hi = -Infinity;
    const st = sd.pix.length > 800 ? Math.ceil(sd.pix.length / 800) : 1;
    for (let q = 0; q < sd.pix.length; q += st) {
      const i = sd.pix[q], x = i % w, y = (i - x) / w;
      const c = Math.round(x - shear * (y - cy)) - xA + off;
      if (c < lo) lo = c;
      if (c > hi) hi = c;
    }
    seedRanges.push([lo - 1, hi + 1]);
  }
  const segment = (gapTol, alt, ranges = null) => {
    // Column runs (allow 1 empty column inside a digit).
    const runs0 = [];
    for (let j = 0; j < span; j++) {
      if (cols[j] < 2) continue;
      const last = runs0[runs0.length - 1];
      if (last && j - last[1] <= gapTol) last[1] = j;
      else runs0.push([j, j]);
    }
    // Touching digits: split a run that is too wide at its emptiest column.
    const runs = [];
    const splitRun = ([a, b]) => {
      if (b - a + 1 <= 0.8 * H0) { runs.push([a, b]); return; }
      let best = -1, bv = Infinity;
      const lo = a + Math.max(2, Math.round(0.12 * (b - a))), hi = b - Math.max(2, Math.round(0.12 * (b - a)));
      for (let j = lo; j <= hi; j++) if (cols[j] < bv) { bv = cols[j]; best = j; }
      const sorted = [...cols.subarray(a, b + 1)].sort((x, y) => x - y);
      if (best < 0 || bv > 0.25 * sorted[sorted.length >> 1]) { runs.push([a, b]); return; }
      splitRun([a, best - 1]);
      splitRun([best + 1, b]);
    };
    if (ranges) {
      // Merge neighbouring runs that sit inside one whole-digit blob.
      for (let k = runs0.length - 2; k >= 0; k--) {
        const a = runs0[k], b = runs0[k + 1];
        if (ranges.some(([lo, hi]) => a[0] >= lo && b[1] <= hi)) { a[1] = b[1]; runs0.splice(k + 1, 1); }
      }
    }
    for (const r of runs0) splitRun(r);
    const runOf = new Int32Array(span).fill(-1);
    runs.forEach(([a, b], k) => { for (let j = a; j <= b; j++) runOf[j] = k; });
    const G = runs.map(([c0, c1]) => ({ c0, c1, wg: c1 - c0 + 1, y0: Infinity, y1: -1, x0: Infinity, x1: -1, idx: [] }));
    for (let i = 0; i < n; i++) {
      const k = runOf[CI[i]];
      if (k < 0) continue;
      const g = G[k];
      g.idx.push(i);
      if (YS[i] < g.y0) g.y0 = YS[i];
      if (YS[i] > g.y1) g.y1 = YS[i];
      if (XS[i] < g.x0) g.x0 = XS[i];
      if (XS[i] > g.x1) g.x1 = XS[i];
    }
    for (const g of G) g.hg = g.y1 - g.y0 + 1;
    const tall = G.filter((g) => g.hg >= 0.75 * H0 && g.wg >= 0.3 * H0 && g.wg <= 1.2 * H0);
    const yTop = tall.length ? median(tall.map((g) => g.y0)) : band.y0;
    const yBot = tall.length ? median(tall.map((g) => g.y1)) : band.y1;
    const H = yBot - yTop + 1;
    const typW = tall.length ? median(tall.map((g) => g.wg)) : 0.55 * H;
    for (const g of G) {
      g.kind = 'skip';
      if (g.hg < 0.6 * H || g.wg > 1.25 * H || g.idx.length < 8) continue;
      if (g.wg < 0.55 * typW || g.wg < 0.24 * H) {
        // Narrow: a "1" if it is a bar spanning the digit height that does not run past it.
        let top = 0, bot = 0;
        for (const i of g.idx) { if (YS[i] < (yTop + yBot) / 2) top++; else bot++; }
        const span01 = g.hg / H;
        let outside = 0;
        const ext = Math.max(2, Math.round(0.15 * H));
        for (const [ya, yb] of [[g.y0 - ext, g.y0 - 2], [g.y1 + 2, g.y1 + ext]]) {
          for (let y = Math.max(0, ya); y <= Math.min(h - 1, yb); y++) {
            for (let x = g.x0; x <= g.x1; x++) outside += bin[y * w + x];
          }
        }
        const barArea = (g.x1 - g.x0 + 1) * 2 * (ext - 1);
        const ok = span01 > 0.72 && top > 0.25 * g.idx.length && bot > 0.25 * g.idx.length && outside < 0.25 * barArea;
        g.kind = 'one';
        g.digit = ok ? '1' : null;
        g.conf = ok ? Math.min(0.7, 0.5 + (0.4 * (span01 - 0.72)) / 0.28) : 0;
        continue;
      }
      const cnt = new Float64Array(7);
      let hole = 0;
      for (const i of g.idx) {
        const u = (CI[i] - g.c0 + 0.5) / g.wg, v = (YS[i] - yTop + 0.5) / H;
        if (u > 0.34 && u < 0.66 && ((v > 0.22 && v < 0.36) || (v > 0.64 && v < 0.78))) hole++;
        for (let z = 0; z < 7; z++) {
          const Z = ZONES[z];
          if (u >= Z[0] && u < Z[1] && v >= Z[2] && v < Z[3]) { cnt[z]++; break; }
        }
      }
      g.fills = ZONES.map((Z, z) => cnt[z] / Math.max(1, (Z[1] - Z[0]) * g.wg * (Z[3] - Z[2]) * H));
      g.holeFill = hole / Math.max(1, 0.32 * g.wg * 0.28 * H);
      g.kind = 'digit';
    }
    for (const g of G) {
      if (g.kind !== 'digit') continue;
      // Normalise by the glyph's own strong segments (every digit lights at least 2).
      const f = g.fills.map((x) => Math.min(1.2, x));
      const ref = Math.max(0.25, [...f].sort((a, b) => b - a)[1]);
      const { best, margin } = matchDigit(f.map((x) => Math.min(1, x / ref)));
      const ok = best.cost <= 1.9 && g.holeFill < 0.3;
      g.digit = ok ? best.d : null;
      g.conf = ok ? Math.max(0, 1 - best.cost / 2.2) * (0.45 + 0.55 * Math.min(1, margin / 1.4)) : 0;
    }
    if (globalThis.__bpDebug) globalThis.__bpDebug.push({ band: [band.x0, band.y0, band.x1, band.y1, Math.round(H0)], yTop, yBot, shear, typW, glyphs: G.filter((g) => g.kind !== 'skip' || g.hg > 0.3 * H).map((g) => `${g.kind}:${g.digit ?? '-'}@${g.x0}-${g.x1} w${g.wg} h${g.hg}${g.fills ? ' f' + g.fills.map((f) => f.toFixed(1)).join('') + ' hole' + g.holeFill.toFixed(2) : ''}`) });
    // Numbers = runs of decoded glyphs; split at failures and wide gaps.
    let cur = [];
    const emit = (gs, factor) => {
      const x0 = Math.min(...gs.map((g) => g.x0)), x1 = Math.max(...gs.map((g) => g.x1));
      const confs = gs.map((g) => g.conf);
      const mean = confs.reduce((a, b) => a + b, 0) / confs.length;
      const digits = gs.map((g) => g.digit).join('');
      numbers.push({
        digits, value: parseInt(digits, 10), conf: factor * (0.5 * mean + 0.5 * Math.min(...confs)) * (gs.some((g) => g.kind === 'digit') ? 1 : 0.6),
        x0, x1, y0: Math.round(yTop), y1: Math.round(yBot), h: H, w: x1 - x0 + 1, cx: (x0 + x1) / 2, cy: (yTop + yBot) / 2, shear,
        glyphs: gs.map((g) => ({ x0: g.x0, x1: g.x1, d: g.digit, conf: g.conf, fills: g.fills, hole: g.holeFill, wg: g.wg, hg: g.hg })),
      });
    };
    const flush = () => {
      if (cur.length) {
        emit(cur, alt);
        // Frame edges and bar graphs next to a number read as extra "1"s: also offer the
        // 2-3 digit pieces (cheaper when a real digit is dropped than when a "1" is).
        const n = cur.length;
        if (n >= 3) {
          for (let len = Math.min(3, n - 1); len >= 2; len--) {
            for (let i = 0; i + len <= n; i++) {
              const dropped = [...cur.slice(0, i), ...cur.slice(i + len)];
              emit(cur.slice(i, i + len), alt * (dropped.every((g) => g.kind === 'one') ? 0.9 : 0.7));
            }
          }
        }
      }
      cur = [];
    };
    let prev = null;
    for (const g of G) {
      if (g.kind === 'skip') continue;
      if (!g.digit) { flush(); prev = null; continue; }
      if (prev && g.c0 - prev.c1 > 0.8 * H) flush();
      cur.push(g);
      prev = g;
    }
    flush();
  };
  segment(2, 1);
  if (seedRanges.length) segment(2, 0.95, seedRanges);
  return numbers;
}

const overlapFrac = (a, b) => {
  const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return ix > 0 && iy > 0 ? (ix * iy) / Math.min(a.w * a.h, b.w * b.h) : 0;
};

// Choose SYS / DIA / PULSE among the numbers read.
export function pickReading(numbers) {
  const cand = [];
  for (const n0 of numbers) {
    if (n0.digits.length < 2 || n0.digits.length > 3 || n0.conf < 0.2 || n0.digits[0] === '0') continue;
    // "11", "111": frame edges and bar graphs look like ones; real readings rarely are.
    const n = { ...n0, conf: (n0.eff ?? n0.conf) * (/^1+$/.test(n0.digits) ? 0.7 : 1) };
    const dup = cand.find((c) => c.digits === n.digits && overlapFrac(c, n) > 0.5);
    if (dup) { if (n.conf > dup.conf) Object.assign(dup, n); continue; }
    cand.push(n);
  }
  if (cand.length < 2) return null;
  const real = cand.filter((n) => /[02-9]/.test(n.digits) && n.conf > 0.3);
  const maxH = Math.max(...(real.length ? real : cand).map((n) => n.h));
  let best = null;
  for (const S of cand) {
    if (S.value < 60 || S.value > 260) continue;
    for (const D of cand) {
      if (D === S || D.value < 30 || D.value > 160 || S.value - D.value < 8 || overlapFrac(S, D) > 0.2) continue;
      const hr = D.h / S.h;
      if (hr < 0.55 || hr > 1.5) continue;
      const stacked = S.cy < D.cy - 0.45 * Math.min(S.h, D.h) &&
        Math.min(S.x1, D.x1) - Math.max(S.x0, D.x0) > -0.6 * Math.max(S.h, D.h);
      const side = Math.abs(S.cy - D.cy) < 0.4 * Math.min(S.h, D.h) && S.cx < D.cx;
      if (!stacked && !side) continue;
      let score = 1 + S.conf + D.conf + 0.6 * Math.min(1, (S.h + D.h) / (2 * maxH));
      // Usual layout: DIA right under SYS.
      if (stacked && D.y0 - S.y1 < 0.6 * Math.min(S.h, D.h)) score += 0.3;
      let P = null, pScore = 0;
      for (const p of cand) {
        if (p === S || p === D || p.value < 30 || p.value > 200 || p.h > 1.15 * Math.max(S.h, D.h) || p.h < 0.3 * D.h) continue;
        if (overlapFrac(p, S) > 0.2 || overlapFrac(p, D) > 0.2 || !/[02-9]/.test(p.digits)) continue;
        const below = p.cy > D.cy - 0.3 * D.h;
        const right = p.cx > Math.max(S.cx, D.cx);
        if (!below && !right) continue;
        // Pulse sits under DIA, right-aligned with it, or to the right; memory counters and
        // clocks sit further left.
        const aligned = Math.abs(p.x1 - D.x1) < 0.7 * D.h || p.x0 > D.x1 - 0.2 * D.h;
        const ps = 0.3 + 0.7 * p.conf + (below ? 0.1 : 0) + (aligned ? 0.25 : 0);
        if (ps > pScore) { pScore = ps; P = p; }
      }
      score += pScore;
      if (!best || score > best.score) best = { S, D, P, score };
    }
  }
  return best;
}

function analyze(bin, w, h, radii) {
  const seeds = [];
  for (const r of radii) {
    const d = dilate(bin, w, h, r, r ? 2 * r : 0);
    const { labels, count } = label(d, w, h);
    if (count > 25000) continue;
    seeds.push(...glyphCandidates(blobs(bin, labels, count, w, h), w, h));
  }
  const bands = makeBands(seeds);
  const numbers = [];
  for (const b of bands.slice(0, 80)) numbers.push(...readBand(bin, w, h, b));
  const pick = pickReading(numbers);
  return { numbers, pick, score: pick ? pick.score : 0, bands: bands.length };
}

// Merge the numbers read under different thresholds: the same digits at the same place
// count as votes. Stable reads win over one-off ones.
function consolidate(all, runs) {
  const groups = [];
  for (const n of all) {
    const g = groups.find((x) => x.n.digits === n.digits && overlapFrac(x.n, n) > 0.5);
    if (g) { g.runs.add(n.run); if (n.conf > g.n.conf) g.n = n; } else groups.push({ n, runs: new Set([n.run]) });
  }
  return groups.map(({ n, runs: r }) => ({ ...n, votes: r.size, eff: n.conf * (0.35 + 0.65 * Math.min(1, r.size / Math.max(1, runs * 0.5))) }));
}

// Test hook: one binarization with fixed parameters on a gray image.
export function _debugAnalyze(gray, w, h, { win, R, k, invert, radii = [0, 1, 2, 3, 5] }) {
  const bin = R ? inkMask(gray, w, h, R, k, invert) : binarize(gray, integral(gray, w, h), w, h, win, k, invert);
  return analyze(bin, w, h, radii);
}

/**
 * Read a blood pressure monitor display.
 * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} img RGBA pixels
 * @returns {{ok:boolean, sys?:number, dia?:number, pulse?:number|null, confidence:number,
 *            boxes:Array, numbers:Array, params?:object, ms:number}}
 */
// Rotate a gray image by `deg` around its centre (borders replicated, nearest sample).
// Returns the image plus a mapper from rotated coordinates back to the original.
function rotateGray(src, w, h, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const cx = w / 2, cy = h / 2, out = new Uint8Array(w * h);
  const back = (x, y) => [c * (x - cx) + sn * (y - cy) + cx, -sn * (x - cx) + c * (y - cy) + cy];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = back(x, y);
      const ix = Math.min(w - 1, Math.max(0, Math.round(sx))), iy = Math.min(h - 1, Math.max(0, Math.round(sy)));
      out[y * w + x] = src[iy * w + ix];
    }
  }
  return { gray: out, back };
}

// All threshold passes over one gray image; returns the best reading or null.
function search(gray, getMax, w, h, quick = false) {
  const minDim = Math.min(w, h);
  const rads = [0.012, 0.025, 0.05].map((f) => Math.max(2, Math.round(f * minDim)));
  // Washed-out or dim photos get gentler thresholds.
  const range = grayRange(gray);
  const ks = range < 110 ? [0.1, 0.18] : [0.18, 0.3];
  const minDiff = Math.max(8, Math.min(16, Math.round(0.11 * range)));
  const radii = [0, 1, 2, 3, 5].filter((r) => r < minDim / 25);
  const all = [];
  let runs = 0, best = null;
  const pass = (g, mode, invert) => {
    for (const R of rads) {
      const bg = background(g, w, h, R, invert);
      for (const k of ks) {
        runs++;
        for (const n of analyze(maskFrom(g, bg, k, invert, minDiff), w, h, radii).numbers) { n.run = runs; n.mode = mode; n.invert = invert; all.push(n); }
      }
    }
    const numbers = consolidate(all, runs);
    const pick = pickReading(numbers);
    best = pick ? { numbers, pick, score: pick.score } : best && { ...best, numbers };
  };
  const strong = () => best && best.pick.S.votes >= 3 && best.pick.D.votes >= 3 && best.score > 2.6;
  pass(gray, 'luma', false);
  if (!strong() && !quick) pass(gray, 'luma', true);
  if (!strong() && getMax && !quick) {
    const gm = getMax();
    pass(gm, 'max', false);
    if (!strong()) pass(gm, 'max', true);
  }
  if (best) best.runs = runs;
  return best && best.pick ? best : null;
}

const confidenceOf = ({ S, D, P }) => {
  const confs = [S.conf, D.conf].concat(P ? [P.conf] : []);
  return Math.max(0, Math.min(1, (confs.reduce((a, b) => a + b, 0) / confs.length) * (P ? 1 : 0.9)));
};

/**
 * Read a blood pressure monitor display.
 * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} img RGBA pixels
 * @returns {{ok:boolean, sys?:number, dia?:number, pulse?:number|null, confidence:number,
 *            boxes:Array, numbers:Array, params?:object, ms:number}}
 */
export function readDisplay(img, opts = {}) {
  const t0 = Date.now();
  const maxDim = opts.maxDim || 720;
  const minConf = opts.minConfidence ?? 0.28;
  let { width: w, height: h } = img;
  let gray = toGray(img.data, w, h, 'luma');
  let scale = 1;
  if (Math.max(w, h) > maxDim) {
    scale = maxDim / Math.max(w, h);
    const nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
    gray = resizeGray(gray, w, h, nw, nh);
    w = nw; h = nh;
  }
  // Light blur against sensor noise and LCD texture.
  const blurR = opts.blur ?? Math.max(1, Math.round(Math.min(w, h) / 450));
  gray = boxBlur(gray, w, h, blurR);
  let gmCache = null;
  const getMax = () => {
    if (!gmCache) {
      let gm = toGray(img.data, img.width, img.height, 'max');
      if (scale !== 1) gm = resizeGray(gm, img.width, img.height, w, h);
      gmCache = boxBlur(gm, w, h, blurR);
    }
    return gmCache;
  };
  let best = search(gray, getMax, w, h, opts.quick);
  let back = null, angle = 0;
  // Photo taken at an angle: when something number-like was found but the read is weak,
  // try a slight tilt each way before giving up.
  if ((!best || confidenceOf(best.pick) < minConf) && !opts.quick && opts.tilt !== false) {
    for (const deg of [-7, 7]) {
      const rot = rotateGray(gray, w, h, deg);
      const res = search(rot.gray, null, w, h, true);
      // A tilted read must be clearly good to replace an upright one.
      if (res && confidenceOf(res.pick) >= minConf + 0.07 && (!best || res.score > best.score || confidenceOf(best.pick) < minConf)) {
        best = res; back = rot.back; angle = deg;
        break;
      }
    }
  }
  const ms = Date.now() - t0;
  const tried = best ? best.runs : 0;
  if (!best) return { ok: false, confidence: 0, boxes: [], numbers: [], ms, tried };
  const inv = 1 / scale;
  const toBox = (n, lab) => {
    let x0 = n.x0, y0 = n.y0, x1 = n.x1 + 1, y1 = n.y1 + 1;
    if (back) {
      const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => back(x, y));
      x0 = Math.min(...pts.map((p) => p[0])); x1 = Math.max(...pts.map((p) => p[0]));
      y0 = Math.min(...pts.map((p) => p[1])); y1 = Math.max(...pts.map((p) => p[1]));
    }
    return { x: x0 * inv, y: y0 * inv, w: (x1 - x0) * inv, h: (y1 - y0) * inv, label: lab, value: n.value };
  };
  const { S, D, P } = best.pick;
  const confidence = confidenceOf(best.pick);
  if (confidence < minConf) return { ok: false, confidence, boxes: [], numbers: [], ms, tried, guess: { sys: S.value, dia: D.value, pulse: P ? P.value : null } };
  return {
    ok: true,
    sys: S.value, dia: D.value, pulse: P ? P.value : null,
    confidence,
    boxes: [toBox(S, 'SYS'), toBox(D, 'DIA')].concat(P ? [toBox(P, 'PULSE')] : []),
    numbers: best.numbers.map((n) => ({ value: n.value, digits: n.digits, conf: n.conf, box: toBox(n, '') })),
    params: { runs: best.runs, sysVotes: S.votes, diaVotes: D.votes, angle }, ms, tried,
  };
}
