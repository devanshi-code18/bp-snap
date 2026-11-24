// README screenshots in an iPhone-sized Chromium with two weeks of sample readings.
//   npm install --no-save puppeteer-core && CHROME_PATH=/path/to/chrome node tools/screens.mjs docs/
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMonitor, rng } from '../tests/synth.mjs';
import { writePNG } from '../tests/png.mjs';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || 'docs');
fs.mkdirSync(out, { recursive: true });
const PORT = 8791;
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: site, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-gpu', '--headless=new', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(' ') : [])],
});
const page = await browser.newPage();
await page.emulate({
  viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { await sleep(300); await page.screenshot({ path: path.join(out, name) }); };

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.setItem('bp.installDismissed', JSON.stringify(Date.now())));
await page.type('#ob-name', 'Mom');
await page.click('#ob button');
await page.waitForSelector('[data-act=cam]');

// Two weeks of morning + evening readings (2 per sitting some days).
const r = rng(7);
const now = Date.now();
const readings = [];
for (let d = 13; d >= 0; d--) {
  for (const [hh, base] of [[7, [134, 86]], [20, [127, 81]]]) {
    const t0 = new Date(now - d * 86400000); t0.setHours(hh, Math.floor(r() * 40), 0, 0);
    if (t0.getTime() > now) continue;
    const n = r() < 0.4 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const trend = -0.35 * (13 - d);
      readings.push({ sys: Math.round(base[0] + trend + (r() - 0.5) * 12), dia: Math.round(base[1] + trend * 0.5 + (r() - 0.5) * 8), pulse: Math.round(66 + (r() - 0.5) * 14), takenAt: t0.getTime() + k * 70000, source: r() < 0.8 ? 'photo' : 'manual' });
    }
  }
}
await page.evaluate(async (rs) => {
  const pid = JSON.parse(localStorage.getItem('bp.person'));
  const db = await new Promise((res) => { const q = indexedDB.open('bp-snap'); q.onsuccess = () => res(q.result); });
  const tx = db.transaction('readings', 'readwrite');
  rs.forEach((x, i) => tx.objectStore('readings').put({ id: 'demo' + i, personId: pid, arm: 'left', position: 'sitting', notes: i === 5 ? 'after coffee' : '', hasPhoto: false, createdAt: x.takenAt, updatedAt: x.takenAt, ...x }));
  await new Promise((res) => { tx.oncomplete = res; });
}, readings);
await page.goto(`http://127.0.0.1:${PORT}/#/home`, { waitUntil: 'networkidle0' });
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('.bp-big');
await shot('home.png');

const img = makeMonitor(28, { W: 900, H: 1200, sys: 128, dia: 82, pulse: 71 });
const file = '/tmp/bp-demo-monitor.png';
writePNG(file, img);
await (await page.$('#lib')).uploadFile(file);
await page.waitForSelector('#ocr-status.ok, #ocr-status.warn', { timeout: 30000 });
await shot('review.png');

await page.goto(`http://127.0.0.1:${PORT}/#/history`, { waitUntil: 'networkidle0' });
await shot('history.png');
await page.goto(`http://127.0.0.1:${PORT}/#/report`, { waitUntil: 'networkidle0' });
await page.evaluate(() => window.scrollTo(0, 140));
await shot('report.png');
await browser.close();
srv.kill();
console.log('screens written to', out);
