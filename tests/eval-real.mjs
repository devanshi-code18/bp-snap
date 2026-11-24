// Accuracy on real monitor photos (Wikimedia Commons, see tests/real/README.md):
// node tests/eval-real.mjs <dir with NN.rgba + meta.json>
import fs from 'node:fs';
import path from 'node:path';
import { readDisplay } from '../js/ocr/sevenseg.js';

const dir = process.argv[2] || '/tmp/bpimg/raw';
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
// Ground truth read by eye. pulse undefined = don't score pulse.
const TRUTH = {
  '00': [120, 74, 80], '01': [138, 73, 74], '02': [105, 80, 67], '03': [128, 91, 76], '05': [102, 63, 51],
  '06': [114, 75, 72], '08': [128, 88, 105], '10': [126, 70, null], '23': [122, 65, 75], '25': [131, 78, 67],
  '27': [113, 61, 56], '28': [109, 82, 71], '29': [161, 89, 64], '31': [150, 93, 77], '35': [120, 80, undefined],
  '48': [140, 114, 59], '56': [136, 87, 89],
};
const only = process.argv[3] ? process.argv[3].split(',') : null;
let pos = 0, sd = 0, ex = 0, neg = 0, fp = 0, ms = 0;
for (const k of Object.keys(meta).sort()) {
  if (only && !only.includes(k)) continue;
  if (k === 'c35') continue;
  if (process.env.SET === 'crops' && !k.startsWith('c')) continue;
  if (process.env.SET === 'full' && /^[ca]/.test(k)) continue;
  if (process.env.SET && process.env.SET.startsWith('a') && !k.startsWith(process.env.SET + '_')) continue;
  const [w, h] = meta[k];
  const data = new Uint8ClampedArray(fs.readFileSync(path.join(dir, `${k}.rgba`)));
  // The app hands the reader a canvas scaled to 1100 px; do the same here.
  const r = readDisplay({ width: w, height: h, data }, { maxDim: /^[ca]/.test(k) ? 820 : 760 });
  ms += r.ms;
  const t = k.startsWith('c') ? TRUTH[k.slice(1)] : k.startsWith('a') ? TRUTH[k.split('_')[1]] : TRUTH[k];
  const got = r.ok ? `${r.sys}/${r.dia} p${r.pulse} c${r.confidence.toFixed(2)}` : 'none';
  if (t) {
    pos++;
    const okSD = r.ok && r.sys === t[0] && r.dia === t[1];
    const okP = t[2] === undefined || (r.ok && (r.pulse ?? null) === t[2]);
    if (okSD) sd++;
    if (okSD && okP) ex++;
    console.log(`${okSD ? (okP ? 'OK  ' : 'OK-p') : 'MISS'} ${k} truth ${t[0]}/${t[1]} p${t[2]} got ${got} ${r.ms}ms nums=${r.numbers.map((n) => n.digits).join(',')}`);
  } else {
    neg++;
    if (r.ok) fp++;
    if (r.ok) console.log(`FP   ${k} got ${got}`);
  }
}
console.log(`real photos: sys/dia ${sd}/${pos}, all three ${ex}/${pos}, false readings on ${fp}/${neg} photos without a reading, avg ${Math.round(ms / (pos + neg))} ms`);
