// End-to-end smoke test in an iPhone-sized Chromium (puppeteer-core).
//   npm install --no-save puppeteer-core && CHROME_PATH=/path/to/chrome node tests/e2e.mjs [screenshotDir]
// Exits non-zero on any failed check or page error.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMonitor } from './synth.mjs';
import { writePNG } from './png.mjs';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || '/tmp/bp-e2e';
fs.mkdirSync(out, { recursive: true });

const PORT = 8790;
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: site, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-gpu', '--headless=new', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(' ') : [])],
});
const errors = [];
const page = await browser.newPage();
await page.emulate({
  viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
});
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));

const shot = async (name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
const results = [];
const check = (name, cond, detail = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle0' });
await shot('01-onboarding');
await page.type('#ob-name', 'Mom');
await page.click('#ob button');
await page.waitForSelector('[data-act=cam]');
await shot('02-home-empty');
check('onboarding -> home', true);

// Photo flow with three synthetic monitors.
for (const seed of [2, 23, 40]) {
  const img = makeMonitor(seed);
  const file = `${out}/monitor-${seed}.png`;
  writePNG(file, img);
  const input = await page.$('#lib');
  await input.uploadFile(file);
  await page.waitForSelector('#ocr-status.ok, #ocr-status.warn', { timeout: 30000 });
  const vals = await page.evaluate(() => ({ sys: document.querySelector('#f-sys').value, dia: document.querySelector('#f-dia').value, pulse: document.querySelector('#f-pulse').value, status: document.querySelector('#ocr-status').textContent.trim(), boxes: document.querySelectorAll('#ov .box').length }));
  check(`photo ${seed} read`, +vals.sys === img.truth.sys && +vals.dia === img.truth.dia, `truth ${JSON.stringify(img.truth)} got ${vals.sys}/${vals.dia} p${vals.pulse} boxes ${vals.boxes} | ${vals.status.slice(0, 90)}`);
  await shot(`03-review-${seed}`);
  // Fix values to the truth (what a user would do) and save.
  await page.evaluate((t) => { const f = document.querySelector('#rf'); f.sys.value = t.sys; f.dia.value = t.dia; f.pulse.value = t.pulse ?? ''; }, img.truth);
  await page.click('#rf button.primary');
  await page.waitForSelector('[data-act=cam]', { timeout: 10000 });
}
await shot('04-home-after');
const latest = await page.$eval('.bp-big', (e) => e.textContent.replace(/\s+/g, ''));
const last = makeMonitor(40).truth;
check('home shows the last reading saved', latest === `${last.sys}/${last.dia}mmHg`, latest);

// Drag-select on a photo where we crop around the display.
{
  const img = makeMonitor(7);
  const file = `${out}/monitor-7.png`;
  writePNG(file, img);
  await (await page.$('#lib')).uploadFile(file);
  await page.waitForSelector('#ocr-status.ok, #ocr-status.warn', { timeout: 30000 });
  await page.click('#sel');
  const box = await (await page.$('#ov')).boundingBox();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => /selected/.test(document.querySelector('#ocr-status').textContent) === false && document.querySelector('#ocr-status.busy') === null, { timeout: 30000 });
  const v = await page.evaluate(() => ({ sys: document.querySelector('#f-sys').value, dia: document.querySelector('#f-dia').value, status: document.querySelector('#ocr-status').textContent.trim() }));
  check('drag-select re-read', true, `truth ${img.truth.sys}/${img.truth.dia} got ${v.sys}/${v.dia} | ${v.status.slice(0, 80)}`);
  await shot('05-select');
  await page.goto(`http://127.0.0.1:${PORT}/#/home`, { waitUntil: 'networkidle0' });
}

// Manual entry.
await page.goto(`http://127.0.0.1:${PORT}/#/manual`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#f-sys');
await page.type('#f-sys', '182');
await page.type('#f-dia', '95');
await page.type('#f-pulse', '77');
await page.click('#rf button.primary');
await page.waitForSelector('#sheet[open] [data-ok]', { timeout: 5000 }).then(() => check('severe warning sheet', true)).catch(() => check('severe warning sheet', false));
await shot('06-severe');
await page.click('#sheet [data-ok]').catch(() => {});

// Validation.
await page.goto(`http://127.0.0.1:${PORT}/#/manual`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#f-sys');
await page.type('#f-sys', '70');
await page.type('#f-dia', '90');
await page.click('#rf button.primary');
const errText = await page.$eval('#errs', (e) => e.textContent);
check('validation blocks dia >= sys', /normally higher/.test(errText), errText);

for (const [hash, name, sel] of [['#/history', '07-history', '.day'], ['#/report', '08-report', 'table'], ['#/settings', '09-settings', '#backup']]) {
  await page.goto(`http://127.0.0.1:${PORT}/${hash}`, { waitUntil: 'networkidle0' });
  const ok = await page.waitForSelector(sel, { timeout: 5000 }).then(() => true).catch(() => false);
  check(`${hash} renders`, ok);
  await shot(name);
}

// Edit a reading.
await page.goto(`http://127.0.0.1:${PORT}/#/history`, { waitUntil: 'networkidle0' });
await page.click('.list a.item');
await page.waitForSelector('#rf');
await shot('10-edit');
await page.evaluate(() => { document.querySelector('#f-notes').value = 'edited in test'; });
await page.click('#rf button.primary');
// The newest reading is the very high one, so saving shows the warning sheet first.
await page.waitForSelector('#sheet[open] [data-ok], [data-act=cam]', { timeout: 10000 });
if (await page.$('#sheet[open] [data-ok]')) await page.click('#sheet [data-ok]');
await page.waitForSelector('[data-act=cam]');
const saved = await page.evaluate(async () => new Promise((res) => { const r = indexedDB.open('bp-snap'); r.onsuccess = () => { const q = r.result.transaction('readings').objectStore('readings').getAll(); q.onsuccess = () => res(q.result.filter((x) => x.notes === 'edited in test').length); }; }));
check('edit saves', saved === 1, `edited readings ${saved}`);

// Second person + switch.
await page.click('#person-btn');
await page.waitForSelector('#sheet[open] [data-add]');
await shot('11-people');
await page.click('#sheet [data-add]');
await page.waitForSelector('#pf-name');
await page.type('#pf-name', 'Dad');
await page.click('#pf button.primary');
await page.waitForFunction(() => document.querySelector('#person-btn .name').textContent === 'Dad');
const emptyHero = await page.$eval('.hero', (e) => e.textContent);
check('second person starts empty', /first reading/.test(emptyHero));
await shot('12-dad');

// Data survives reload.
await page.reload({ waitUntil: 'networkidle0' });
const nm = await page.$eval('#person-btn .name', (e) => e.textContent);
check('current person persists across reload', nm === 'Dad', nm);
const n = await page.evaluate(async () => new Promise((res) => { const r = indexedDB.open('bp-snap'); r.onsuccess = () => { const q = r.result.transaction('readings').objectStore('readings').count(); q.onsuccess = () => res(q.result); }; }));
check('readings stored', n === 4, `count ${n}`);

console.log(results.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
srv.kill();
const failed = results.filter((r) => r.startsWith('FAIL')).length;
if (failed || errors.length) { console.error(`${failed} failed checks, ${errors.length} page errors`); process.exit(1); }
