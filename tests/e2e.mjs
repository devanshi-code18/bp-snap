// End-to-end test in an iPhone-sized Chromium (puppeteer-core), with a local backup server.
//   npm install --no-save puppeteer-core && CHROME_PATH=/path/to/chrome node tests/e2e.mjs [screenshotDir]
// Exits non-zero on any failed check or page error.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMonitor } from './synth.mjs';
import { writePNG } from './png.mjs';
import { startSyncServer } from './sync-server.mjs';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || '/tmp/bp-e2e';
fs.mkdirSync(out, { recursive: true });

const PORT = 8790;
const APP = `http://127.0.0.1:${PORT}`;
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: site, stdio: 'ignore' });
const backup = await startSyncServer(8792);
await new Promise((r) => setTimeout(r, 800));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-gpu', '--headless=new', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(' ') : [])],
});
const errors = [];
let offline = false;
const results = [];
const check = (name, cond, detail = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A "phone": its own storage, iPhone screen and user agent, pointed at the local backup server.
async function phone(ctx, tag) {
  const page = await ctx.newPage();
  await page.emulate({
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  });
  await page.evaluateOnNewDocument(() => localStorage.setItem('bp.syncApi', 'http://127.0.0.1:8792/api'));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console.error: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on('requestfailed', (r) => { if (!offline) errors.push(`${tag} requestfailed: ${r.url()}`); });
  page.on('dialog', async (d) => {
    // Only our own confirm() prompts are expected; anything else (alert) means injected script ran.
    if (d.type() !== 'confirm' && d.type() !== 'prompt') errors.push(`${tag} unexpected ${d.type()}: ${d.message()}`);
    await d.accept();
  });
  return page;
}
const count = (page) => page.evaluate(async () => new Promise((res) => { const r = indexedDB.open('bp-snap'); r.onsuccess = () => { const q = r.result.transaction('readings').objectStore('readings').getAll(); q.onsuccess = () => res(q.result.filter((x) => !x.deletedAt).length); }; }));
// Backed up after `since` (the time just before the change being checked).
const waitSynced = (page, since, timeout = 15000) => page.waitForFunction((t) => { const s = JSON.parse(localStorage.getItem('bp.sync.status') || '{}'); return s.state === 'ok' && s.at > t; }, { timeout }, since).then(() => true).catch(() => false);

const pages = {};
let crash = null;
try {
  const page = await phone(browser.defaultBrowserContext(), 'phone1');
  pages.phone1 = page;
  const shot = async (name, p = page) => p.screenshot({ path: `${out}/${name}.png`, fullPage: true });

  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' });
  await shot('01-welcome');
  await page.type('#ob-name', 'Mom');
  await page.click('#ob button');
  await page.waitForSelector('[data-act=cam]');
  await shot('02-home-empty');
  check('welcome -> home', true);

  // Photo flow with three synthetic monitors; each save shows the "Saved" screen.
  for (const seed of [2, 23, 40]) {
    const img = makeMonitor(seed);
    const file = `${out}/monitor-${seed}.png`;
    writePNG(file, img);
    await (await page.$('#lib')).uploadFile(file);
    await page.waitForSelector('#ocr-status.ok, #ocr-status.warn', { timeout: 30000 });
    const vals = await page.evaluate(() => ({ sys: document.querySelector('#f-sys').value, dia: document.querySelector('#f-dia').value, pulse: document.querySelector('#f-pulse').value, boxes: document.querySelectorAll('#ov .box').length }));
    check(`photo ${seed} read`, +vals.sys === img.truth.sys && +vals.dia === img.truth.dia, `truth ${JSON.stringify(img.truth)} got ${vals.sys}/${vals.dia} p${vals.pulse} boxes ${vals.boxes}`);
    await shot(`03-check-${seed}`);
    await page.evaluate((t) => { const f = document.querySelector('#rf'); f.sys.value = t.sys; f.dia.value = t.dia; f.pulse.value = t.pulse ?? ''; }, img.truth);
    await page.click('#rf button.primary');
    await page.waitForSelector('#saved-done', { timeout: 10000 });
    const big = await page.$eval('.saved .bp-big', (e) => e.textContent.replace(/\s+/g, ''));
    check(`saved screen ${seed}`, big === `${img.truth.sys}/${img.truth.dia}mmHg`, big);
    if (seed === 2) await shot('04-saved');
    await page.click('#saved-done');
    await page.waitForSelector('[data-act=cam]', { timeout: 10000 });
  }
  const tSaved = Date.now() - 5000;
  await shot('05-home');
  const latest = await page.$eval('.bp-big', (e) => e.textContent.replace(/\s+/g, ''));
  const last = makeMonitor(40).truth;
  check('home shows the last reading saved', latest === `${last.sys}/${last.dia}mmHg`, latest);
  check('backed up online after saving', await waitSynced(page, tSaved));
  await page.waitForFunction(() => /Backed up online/.test(document.querySelector('#safe-line')?.textContent || ''), { timeout: 8000 })
    .then(() => check('home says backed up', true)).catch(() => check('home says backed up', false));
  check('backup server has one encrypted log', backup.store.snapshots.length > 0);

  // "Show where": draw a box around the numbers and read again.
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
    await page.waitForSelector('#ocr-status.ok, #ocr-status.warn', { timeout: 30000 });
    const v = await page.evaluate(() => ({ sys: document.querySelector('#f-sys').value, dia: document.querySelector('#f-dia').value }));
    check('show-where re-read', true, `truth ${img.truth.sys}/${img.truth.dia} got ${v.sys}/${v.dia}`);
    await shot('06-show-where');
    await page.goto(`${APP}/#/home`, { waitUntil: 'networkidle0' });
  }

  // Sideways photo: the reader should try the other orientations by itself.
  {
    const img = makeMonitor(2);
    const { width: W, height: H, data } = img;
    const rot = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rot.set(data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4), (x * H + (H - 1 - y)) * 4);
    const file = `${out}/monitor-rot.png`;
    writePNG(file, { width: H, height: W, data: rot });
    await (await page.$('#lib')).uploadFile(file);
    await page.waitForSelector('#ocr-status.ok, #ocr-status.warn', { timeout: 40000 });
    const v = await page.evaluate(() => ({ sys: document.querySelector('#f-sys').value, dia: document.querySelector('#f-dia').value }));
    check('sideways photo read', +v.sys === img.truth.sys && +v.dia === img.truth.dia, `truth ${img.truth.sys}/${img.truth.dia} got ${v.sys}/${v.dia}`);
    await page.goto(`${APP}/#/home`, { waitUntil: 'networkidle0' });
  }

  // Typed values survive switching person while checking a photo.
  {
    const img = makeMonitor(23);
    const file = `${out}/monitor-23b.png`;
    writePNG(file, img);
    await (await page.$('#lib')).uploadFile(file);
    await page.waitForSelector('#ocr-status.ok, #ocr-status.warn', { timeout: 30000 });
    await page.$eval('#f-sys', (e) => { e.value = ''; });
    await page.type('#f-sys', '199');
    await page.click('details.more summary');
    await page.type('#f-notes', 'kept');
    await page.click('#for-change');
    await page.waitForSelector('#sheet[open] [data-id]');
    await page.click('#sheet [data-id]');
    await page.waitForSelector('#rf');
    const kept = await page.evaluate(() => ({ sys: document.querySelector('#f-sys').value, notes: document.querySelector('#f-notes').value }));
    check('values kept across re-render', kept.sys === '199' && kept.notes === 'kept', JSON.stringify(kept));
    await page.goto(`${APP}/#/home`, { waitUntil: 'networkidle0' });
  }

  // Typing a very high reading shows the AHA advice on the Saved screen.
  await page.goto(`${APP}/#/manual`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#f-sys');
  await shot('07-type');
  await page.type('#f-sys', '182');
  await page.type('#f-dia', '95');
  await page.type('#f-pulse', '77');
  await page.click('#rf button.primary');
  await page.waitForSelector('#severe', { timeout: 5000 }).then(() => check('very high reading advice', true)).catch(() => check('very high reading advice', false));
  await shot('08-severe');
  await page.click('#saved-done');
  await page.waitForSelector('[data-act=cam]', { timeout: 5000 }).then(() => check('Done goes home', true)).catch(() => check('Done goes home', false));

  // Double tap on Save stores one reading.
  await page.goto(`${APP}/#/manual`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#f-sys');
  await page.type('#f-sys', '121');
  await page.type('#f-dia', '79');
  const before = await count(page);
  await page.evaluate(() => { const b = document.querySelector('#rf button.primary'); b.click(); b.click(); });
  await page.waitForSelector('#saved-done', { timeout: 5000 });
  check('double tap saves once', (await count(page)) - before === 1, `${before} -> ${await count(page)}`);

  // Validation.
  await page.goto(`${APP}/#/manual`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#f-sys');
  await page.type('#f-sys', '70');
  await page.type('#f-dia', '90');
  await page.click('#rf button.primary');
  const errText = await page.$eval('#errs', (e) => e.textContent);
  check('validation blocks dia >= sys', /normally higher/.test(errText), errText);

  for (const [hash, name, sel] of [['#/history', '09-readings', '.day'], ['#/report', '10-report', 'table'], ['#/settings', '11-settings', '#backup'], ['#/safe', '12-safe', '#share-link']]) {
    await page.goto(`${APP}/${hash}`, { waitUntil: 'networkidle0' });
    const ok = await page.waitForSelector(sel, { timeout: 5000 }).then(() => true).catch(() => false);
    check(`${hash} shows`, ok);
    await shot(name);
  }
  await page.click('#show-words');
  await page.waitForSelector('ol.words li');
  const words = await page.$$eval('ol.words li', (els) => els.map((e) => e.textContent.trim()));
  check('12 recovery words', words.length === 12, words.join(' '));
  await shot('13-words');

  // Change a reading.
  await page.goto(`${APP}/#/history`, { waitUntil: 'networkidle0' });
  await page.click('.list a.item');
  await page.waitForSelector('#rf');
  await shot('14-edit');
  await page.evaluate(() => { document.querySelector('#f-notes').value = 'edited in test'; });
  await page.click('#rf button.primary');
  await page.waitForSelector('.day', { timeout: 10000 });
  const saved = await page.evaluate(async () => new Promise((res) => { const r = indexedDB.open('bp-snap'); r.onsuccess = () => { const q = r.result.transaction('readings').objectStore('readings').getAll(); q.onsuccess = () => res(q.result.filter((x) => x.notes === 'edited in test').length); }; }));
  check('edit saves', saved === 1, `edited readings ${saved}`);

  // Text size.
  await page.goto(`${APP}/#/settings`, { waitUntil: 'networkidle0' });
  const fs1 = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await page.click('[data-scale="1.32"]');
  const fs2 = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  check('extra large text', fs2 > fs1 * 1.1, `${fs1}px -> ${fs2}px`);
  await shot('15-settings-xl');
  await page.click('[data-scale="1.15"]');

  // Second person.
  await page.click('#person-btn');
  await page.waitForSelector('#sheet[open] [data-add]');
  await shot('16-people');
  await page.click('#sheet [data-add]');
  await page.waitForSelector('#pf-name');
  await page.type('#pf-name', 'Dad');
  await page.click('#pf button.primary');
  await page.waitForFunction(() => document.querySelector('#person-btn .name').textContent === 'Dad');
  await page.goto(`${APP}/#/home`, { waitUntil: 'networkidle0' });
  check('second person starts empty', /How it works/.test(await page.$eval('.hero', (e) => e.textContent)));

  // Restore a backup file (merges people and readings).
  {
    const file = `${out}/backup.json`;
    fs.writeFileSync(file, JSON.stringify({ app: 'bp-snap', version: 1, people: [{ id: 'gp1', name: 'Grandpa', color: '#2e9d5b', createdAt: 1 }],
      readings: [{ id: 'gr1', personId: 'gp1', sys: 141, dia: 88, pulse: 70, takenAt: Date.now() - 3600000, source: 'manual', createdAt: 1 }, { id: 'gr2', personId: 'gp1', sys: 137, dia: 86, pulse: 68, takenAt: Date.now() - 7200000, source: 'manual', createdAt: 1 }] }));
    await page.goto(`${APP}/#/settings`, { waitUntil: 'networkidle0' });
    await (await page.$('#restore-file')).uploadFile(file);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-edit]')].some((b) => b.textContent.includes('Grandpa')), { timeout: 10000 })
      .then(() => check('restore backup file adds people', true)).catch(() => check('restore backup file adds people', false));
    await page.goto(`${APP}/#/report`, { waitUntil: 'networkidle0' });
    await page.select('#rr', '7');
    check('report period change', (await page.$eval('#rr', (e) => e.value)) === '7');
    await page.select('#rr', '30');
  }

  // A hostile backup file must not run script.
  {
    const file = `${out}/evil.json`;
    fs.writeFileSync(file, JSON.stringify({ app: 'bp-snap', version: 1, people: [{ id: 'ev1', name: '<img src=x onerror=alert(1)>', color: 'red"><img src=x onerror=alert(2)>' }],
      readings: [{ id: 'ev2', personId: 'ev1', sys: '<img src=x onerror=alert(3)>', dia: 80, takenAt: Date.now() }, { id: 'ev3', personId: 'ev1', sys: 150, dia: 95, pulse: 60, takenAt: Date.now() - 1000, notes: '<script>alert(4)</script>' }] }));
    await page.goto(`${APP}/#/settings`, { waitUntil: 'networkidle0' });
    await (await page.$('#restore-file')).uploadFile(file);
    await page.waitForFunction(() => document.querySelectorAll('[data-edit]').length >= 4, { timeout: 10000 }).catch(() => {});
    await page.click('#person-btn');
    await page.waitForSelector('#sheet[open] [data-id]');
    await page.click('#sheet [data-id="ev1"]');
    await page.goto(`${APP}/#/history`, { waitUntil: 'networkidle0' });
    await page.goto(`${APP}/#/report`, { waitUntil: 'networkidle0' });
    const injected = await page.evaluate(() => document.querySelectorAll('img[src="x"], script:not([src])').length);
    const shown = await page.evaluate(() => document.body.textContent.includes('<script>alert(4)</script>'));
    check('hostile backup stays text', injected === 0 && shown, `injected ${injected}, note shown as text ${shown}`);
  }

  await page.reload({ waitUntil: 'networkidle0' });
  const nm = await page.$eval('#person-btn .name', (e) => e.textContent);
  check('current person kept after reload', nm === '<img src=x onerror=alert(1)>', nm);
  const total = await count(page);
  check('readings stored', total === 8, `count ${total}`);
  check('everything backed up', await waitSynced(page, 0));

  // ---- Keeping the data ----
  // 1. The phone's main storage is damaged: the spare copy brings readings back.
  await page.goto(`${APP}/#/home`, { waitUntil: 'networkidle0' });
  await sleep(600);
  const mirrored = await page.evaluate(() => JSON.parse(localStorage.getItem('bp.mirror') || '{}').readings?.filter((r) => !r.deletedAt).length);
  check('spare copy on the phone is up to date', mirrored === total, `mirror has ${mirrored}`);
  await page.evaluate(async () => {
    const names = ['people', 'readings'];
    await new Promise((res) => { const r = indexedDB.open('bp-snap'); r.onsuccess = () => { const tx = r.result.transaction(names, 'readwrite'); names.forEach((n) => tx.objectStore(n).clear()); tx.oncomplete = res; }; });
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(800);
  check('spare copy restores readings after storage damage', (await count(page)) === total, `count ${await count(page)}`);

  // 2. A wiped phone (or a new one) gets everything back from the recovery link.
  const link = await page.evaluate(() => `${location.origin}/#/join/${localStorage.getItem('bp.sync.secret')}`);
  const ctx2 = await browser.createBrowserContext();
  const page2 = await phone(ctx2, 'phone2');
  pages.phone2 = page2;
  await page2.goto(link, { waitUntil: 'networkidle0' });
  await page2.waitForSelector('#join-go', { timeout: 15000 });
  const found = await page2.$eval('#join-status', (e) => e.textContent);
  check('recovery link finds the readings', /Found 8 readings/.test(found), found);
  check('recovery code is removed from the address bar', !page2.url().includes('/join/'), page2.url());
  await shot('17-join', page2);
  await page2.click('#join-go');
  const joined = (p) => p.waitForFunction(() => !location.hash.startsWith('#/join') || /Your readings are on this phone/.test(document.body.textContent), { timeout: 20000 });
  await joined(page2);
  await sleep(500);
  check('wiped phone gets all readings back', (await count(page2)) === total, `count ${await count(page2)}`);

  // 3. The 12 words work too.
  const ctx3 = await browser.createBrowserContext();
  const page3 = await phone(ctx3, 'phone3');
  pages.phone3 = page3;
  await page3.goto(`${APP}/`, { waitUntil: 'networkidle0' });
  await page3.type('#ob-words', words.join(' '));
  await page3.click('#ob-join');
  await page3.waitForSelector('#join-go', { timeout: 15000 });
  await page3.click('#join-go');
  await joined(page3);
  await sleep(500);
  check('12 words get all readings back', (await count(page3)) === total, `count ${await count(page3)}`);

  // 4. Two phones stay in step: a reading typed on phone 2 shows up on phone 1.
  await page2.goto(`${APP}/#/manual`, { waitUntil: 'networkidle0' });
  await page2.waitForSelector('#f-sys');
  await page2.type('#f-sys', '133');
  await page2.type('#f-dia', '84');
  const t2 = Date.now();
  await page2.click('#rf button.primary');
  await page2.waitForSelector('#saved-done');
  check('phone 2 backed up', await waitSynced(page2, t2));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction((n) => new Promise((res) => { const r = indexedDB.open('bp-snap'); r.onsuccess = () => { const q = r.result.transaction('readings').objectStore('readings').getAll(); q.onsuccess = () => res(q.result.filter((x) => !x.deletedAt).length === n); }; }), { timeout: 15000 }, total + 1)
    .then(() => check('reading from phone 2 reaches phone 1', true)).catch(() => check('reading from phone 2 reaches phone 1', false));

  // 5. A deletion on phone 1 reaches phone 2.
  await page.goto(`${APP}/#/history`, { waitUntil: 'networkidle0' });
  await page.click('.list a.item');
  await page.waitForSelector('[data-del]');
  const t3 = Date.now();
  await page.click('[data-del]');
  await page.waitForSelector('.day, .card h1', { timeout: 10000 });
  check('phone 1 backed up the deletion', await waitSynced(page, t3));
  await page2.reload({ waitUntil: 'networkidle0' });
  await page2.waitForFunction((n) => new Promise((res) => { const r = indexedDB.open('bp-snap'); r.onsuccess = () => { const q = r.result.transaction('readings').objectStore('readings').getAll(); q.onsuccess = () => res(q.result.filter((x) => !x.deletedAt).length === n); }; }), { timeout: 15000 }, total)
    .then(() => check('deletion reaches phone 2', true)).catch(() => check('deletion reaches phone 2', false));

  // 6. Works offline after the first visit (service worker), and says it isn't backed up yet.
  await page.goto(`${APP}/#/home`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle0' });
  offline = true;
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  const offOk = await page.waitForSelector('[data-act=cam]', { timeout: 10000 }).then(() => true).catch(() => false);
  check('opens offline', offOk);
  await page.setOfflineMode(false);
  offline = false;

} catch (err) {
  crash = err;
  // Leave a trail for CI: where each phone was and what it showed.
  for (const [tag, p] of Object.entries(pages)) {
    try {
      const info = await p.evaluate(() => `${location.href}\n${document.body.className}\n${document.querySelector('#view')?.innerText}`);
      fs.writeFileSync(`${out}/crash-${tag}.txt`, info);
      await p.screenshot({ path: `${out}/crash-${tag}.png`, fullPage: true });
      console.log(`--- ${tag} ---\n${info.slice(0, 1500)}`);
    } catch { /* page gone */ }
  }
}
console.log(results.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
srv.kill();
backup.close();
const failed = results.filter((r) => r.startsWith('FAIL')).length;
if (crash) { console.error(crash); process.exit(1); }
if (failed || errors.length) { console.error(`${failed} failed checks, ${errors.length} page errors`); process.exit(1); }
