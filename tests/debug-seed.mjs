// Debug one synthetic seed: node tests/debug-seed.mjs <seed>
import { makeMonitor } from './synth.mjs';
import * as ocr from '../js/ocr/sevenseg.js';

const seed = Number(process.argv[2] || 1);
const img = makeMonitor(seed);
console.log('truth', JSON.stringify(img.truth), JSON.stringify(img.style));
const w = img.width, h = img.height;
const gray = ocr.toGray(img.data, w, h);
const res = ocr.readDisplay(img);
console.log('result', res.ok, res.sys, res.dia, res.pulse, JSON.stringify(res.params), res.ms + 'ms');
for (const k of [0.1, 0.2]) {
  const dbg = ocr._debugAnalyze(gray, w, h, { win: Math.round(Math.min(w, h) / 2.5) | 1, k, invert: false });
  console.log(`k=${k} bands=${dbg.bands} pick=${dbg.pick ? [dbg.pick.S.value, dbg.pick.D.value, dbg.pick.P && dbg.pick.P.value, dbg.pick.score.toFixed(2)] : null}`);
  for (const n of dbg.numbers) console.log('  num', n.digits, n.conf.toFixed(2), 'h', n.h, 'at', n.x0, n.y0, 'shear', n.shear, n.glyphs.map((g) => `${g.d}:${g.conf.toFixed(2)}`).join(' '));
}
if (process.argv[3]) {
  const dbg = ocr._debugAnalyze(gray, w, h, { win: Math.round(Math.min(w, h) / 2.5) | 1, k: 0.1, invert: false });
  for (const n of dbg.numbers) for (const g of n.glyphs) console.log(n.digits, g.d, g.conf.toFixed(2), 'wg', g.wg, 'hg', g.hg, 'hole', g.hole && g.hole.toFixed(2), g.fills && g.fills.map((f) => f.toFixed(2)).join(' '));
}
