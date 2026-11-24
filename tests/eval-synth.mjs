// Quick accuracy run on synthetic monitors: node tests/eval-synth.mjs [count] [seed0]
import { makeMonitor } from './synth.mjs';
import { readDisplay } from '../js/ocr/sevenseg.js';

const N = Number(process.argv[2] || 40), S0 = Number(process.argv[3] || 1);
let ok = 0, okSD = 0, totalMs = 0;
const fails = [];
for (let s = S0; s < S0 + N; s++) {
  const img = makeMonitor(s);
  const res = readDisplay(img);
  totalMs += res.ms;
  const t = img.truth;
  const sd = res.ok && res.sys === t.sys && res.dia === t.dia;
  if (sd) okSD++;
  if (sd && (t.pulse == null || res.pulse === t.pulse)) ok++;
  else fails.push({ seed: s, truth: t, got: res.ok ? { sys: res.sys, dia: res.dia, pulse: res.pulse, conf: +res.confidence.toFixed(2) } : null, nums: res.numbers.map((n) => n.digits).join(','), style: img.style, params: res.params });
}
console.log(`exact ${ok}/${N}  sys+dia ${okSD}/${N}  avg ${Math.round(totalMs / N)} ms`);
for (const f of fails.slice(0, 15)) console.log(JSON.stringify(f));
