import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMonitor } from './synth.mjs';
import { readDisplay, pickReading } from '../js/ocr/sevenseg.js';

test('reads a clean monitor', () => {
  const img = makeMonitor(2);
  const r = readDisplay(img);
  assert.equal(r.ok, true);
  assert.equal(r.sys, img.truth.sys);
  assert.equal(r.dia, img.truth.dia);
});

test('synthetic monitors: SYS/DIA accuracy stays high', () => {
  const N = 40;
  let sd = 0, exact = 0, wrongConfident = 0;
  for (let s = 1000; s < 1000 + N; s++) {
    const img = makeMonitor(s);
    const r = readDisplay(img);
    const ok = r.ok && r.sys === img.truth.sys && r.dia === img.truth.dia;
    if (ok) sd++;
    if (ok && (img.truth.pulse == null || r.pulse === img.truth.pulse)) exact++;
    if (r.ok && !ok && r.confidence >= 0.7) wrongConfident++;
  }
  assert.ok(sd / N >= 0.8, `sys/dia ${sd}/${N}`);
  assert.ok(exact / N >= 0.65, `exact ${exact}/${N}`);
  assert.ok(wrongConfident <= 2, `confident misreads ${wrongConfident}`);
});

test('blank image reads nothing', () => {
  const w = 300, h = 400;
  const data = new Uint8ClampedArray(w * h * 4).fill(200);
  const r = readDisplay({ width: w, height: h, data });
  assert.equal(r.ok, false);
});

test('pickReading prefers SYS above DIA with pulse below', () => {
  const n = (digits, x0, y0, h, conf = 0.9) => ({ digits, value: +digits, conf, x0, y0, x1: x0 + h * 0.6 * digits.length, y1: y0 + h, h, w: h * 0.6 * digits.length, cx: x0 + h * 0.3 * digits.length, cy: y0 + h / 2 });
  const p = pickReading([n('128', 100, 50, 100), n('82', 160, 170, 100), n('64', 200, 290, 50), n('12', 0, 0, 20)]);
  assert.equal(p.S.value, 128);
  assert.equal(p.D.value, 82);
  assert.equal(p.P.value, 64);
  assert.equal(pickReading([n('82', 160, 170, 100)]), null);
});
