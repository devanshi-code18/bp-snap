// Debug a real photo: node tests/debug-real.mjs <key> [dir]
import fs from 'node:fs';
import path from 'node:path';
import * as ocr from '../js/ocr/sevenseg.js';
import { writePNG } from './png.mjs';

const k = process.argv[2], dir = process.argv[3] || '/tmp/bpimg/raw';
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const [W, H] = meta[k];
const data = new Uint8ClampedArray(fs.readFileSync(path.join(dir, `${k}.rgba`)));
const maxDim = Number(process.env.MAXDIM || 760);
const s = Math.min(1, maxDim / Math.max(W, H));
const w = Math.round(W * s), h = Math.round(H * s);
const gray = ocr.resizeGray(ocr.toGray(data, W, H), W, H, w, h);
const minDim = Math.min(w, h);
const mode = process.env.MODE || 'luma';
const g2 = mode === 'max' ? ocr.resizeGray(ocr.toGray(data, W, H, 'max'), W, H, w, h) : gray;
for (const invert of [false, true]) for (const R of [0.012, 0.025, 0.05].map((f) => Math.max(2, Math.round(f * minDim)))) for (const k2 of [0.18, 0.3]) {
  const dbg = ocr._debugAnalyze(g2, w, h, { R, k: k2, invert });
  const win = R;
  const nums = dbg.numbers.filter((n) => n.digits.length >= 2).map((n) => `${n.digits}(${n.conf.toFixed(2)} h${Math.round(n.h)} @${n.x0},${n.y0} s${n.shear})`);
  console.log(`inv=${invert} k=${k2} win=${win} bands=${dbg.bands} pick=${dbg.pick ? [dbg.pick.S.value, dbg.pick.D.value, dbg.pick.P && dbg.pick.P.value].join('/') : '-'} :: ${nums.join(' ')}`);
}
if (process.env.DUMP) {
  const [R, kk, inv] = process.env.DUMP.split(',');
  const bin = ocr.inkMask(g2, w, h, Number(R), Number(kk), inv === '1');
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = bin[i] ? 0 : 255; out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255; }
  writePNG(`/tmp/bin_${k}.png`, { width: w, height: h, data: out });
}
