// BP Snap: photo -> reading -> local log. No server; everything stays on this device.
import * as db from './db.js';
import * as S from './stats.js';
import { chartSVG } from './chart.js';
import { exifDate } from './exif.js';
import * as IMG from './image.js';
import * as OCR from './ocr/client.js';

const VERSION = '1.0.0';
const REPO = 'https://github.com/devanshi-code18/bp-snap';
const COLORS = ['#c2352f', '#2f6fd1', '#2e9d5b', '#8a4fd1', '#e07b00', '#0e9aa7', '#d14f9b', '#6d6966'];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
const sheet = $('#sheet');

const state = { people: [], personId: null, readings: [], draft: null };

const settings = {
  get(k, d) { try { const v = localStorage.getItem('bp.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bp.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---------- formatting ----------
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function fmtDate(ms, long = false) {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString([], { weekday: long ? 'long' : 'short', month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}
function dayLabel(ms) {
  const d = new Date(ms); d.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return fmtDate(ms, diff < 7);
}
const when = (ms) => `${dayLabel(ms)}, ${fmtTime(ms)}`;
const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function fromLocalInput(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : null;
}
const todLabel = (ms) => S.TIMES_OF_DAY.find((t) => t.key === S.timeOfDay(ms)).label;
const chip = (c) => (c ? `<span class="chip" style="background:${c.color}">${esc(c.short)}</span>` : '');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const int = (v) => { const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : null; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

const person = () => state.people.find((p) => p.id === state.personId);
const peopleById = () => Object.fromEntries(state.people.map((p) => [p.id, p]));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

async function loadReadings() {
  state.readings = state.personId ? await db.readingsFor(state.personId) : [];
}

async function setPerson(id) {
  state.personId = id;
  settings.set('person', id);
  await loadReadings();
  renderHeader();
}

function renderHeader() {
  const p = person();
  const b = $('#person-btn');
  b.hidden = !p;
  if (p) {
    $('.name', b).textContent = p.name;
    $('.dot', b).style.background = p.color;
    b.setAttribute('aria-label', `Tracking ${p.name}. Switch person`);
  }
}

// ---------- sheet (bottom dialog) ----------
function openSheet(html, bind) {
  sheet.innerHTML = html;
  if (typeof sheet.showModal === 'function') sheet.showModal(); else sheet.setAttribute('open', '');
  bind?.(sheet);
}
function closeSheet() { if (sheet.open) (sheet.close ? sheet.close() : sheet.removeAttribute('open')); }
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

function peopleSheet() {
  const items = state.people.map((p) => `<li><button class="item btn block" data-id="${p.id}" style="justify-content:flex-start">
    <span class="dot" style="background:${p.color}"></span><span>${esc(p.name)}</span>${p.id === state.personId ? '<span class="muted small" style="margin-left:auto">current</span>' : ''}</button></li>`).join('');
  openSheet(`<h2>Who is this reading for?</h2><ul class="list" style="display:grid;gap:.4rem">${items}</ul>
    <div class="row" style="margin-top:1rem"><button class="btn" data-add>+ Add person</button><button class="btn" data-close style="margin-left:auto">Close</button></div>`, (el) => {
    $$('[data-id]', el).forEach((b) => b.addEventListener('click', async () => { closeSheet(); await setPerson(b.dataset.id); route(); }));
    $('[data-add]', el).addEventListener('click', () => personForm());
    $('[data-close]', el).addEventListener('click', closeSheet);
  });
}

function personForm(p = null) {
  const color = p?.color || COLORS[state.people.length % COLORS.length];
  const swatches = COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('');
  openSheet(`<form id="pf"><h2>${p ? 'Edit person' : 'Add a person'}</h2>
    <label class="f" for="pf-name">Name</label>
    <input id="pf-name" name="name" required maxlength="40" autocomplete="off" placeholder="e.g. Mom" value="${esc(p?.name || '')}">
    <label class="f">Color</label><div class="colors">${swatches}</div>
    <div class="row" style="margin-top:1rem">${p && state.people.length > 1 ? '<button type="button" class="btn danger" data-del>Delete</button>' : ''}
      <button type="button" class="btn" data-cancel style="margin-left:auto">Cancel</button><button class="btn primary">Save</button></div></form>`, (el) => {
    const f = $('#pf', el);
    $('[data-cancel]', el).addEventListener('click', closeSheet);
    $('[data-del]', el)?.addEventListener('click', async () => {
      const n = (await db.readingsFor(p.id)).length;
      if (!confirm(`Delete ${p.name} and ${plural(n, 'reading')}? This can't be undone.`)) return;
      await db.deletePerson(p.id);
      state.people = await db.allPeople();
      if (state.personId === p.id) await setPerson(state.people[0].id);
      closeSheet(); toast(`Deleted ${p.name}`); route();
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = f.name.value.trim();
      if (!name) return;
      const rec = p ? { ...p, name, color: f.color.value } : { id: db.uid(), name, color: f.color.value, createdAt: Date.now() };
      await db.putPerson(rec);
      state.people = await db.allPeople();
      closeSheet();
      if (!p) await setPerson(rec.id); else renderHeader();
      toast(p ? 'Saved' : `Now tracking ${name}`);
      route();
    });
    setTimeout(() => $('#pf-name', el).focus(), 50);
  });
}

// ---------- routing ----------
async function route() {
  closeSheet();
  const [name = 'home', arg] = location.hash.replace(/^#\/?/, '').split('/');
  if (!state.people.length) return onboarding();
  $$('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name || (name === '' && a.dataset.tab === 'home')));
  const views = { home, history, report, settings: settingsView, new: reviewPhoto, manual: manualEntry, r: editReading };
  await (views[name] || home)(arg);
}
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

// ---------- onboarding ----------
function onboarding() {
  $$('.tabs a').forEach((a) => a.classList.remove('active'));
  view.innerHTML = `<section class="card">
    <h1>Welcome to BP Snap</h1>
    <p>Take a photo of a blood pressure monitor after a measurement. BP Snap reads the numbers, you check them, and it keeps a log with the date and time.</p>
    <p class="muted small">Your readings stay on this phone. Nothing is uploaded.</p>
    <form id="ob"><label class="f" for="ob-name">Whose blood pressure are you tracking?</label>
      <input id="ob-name" name="name" required maxlength="40" placeholder="Your name, or e.g. Mom" autocomplete="off">
      <button class="btn primary block" style="margin-top:1rem">Start</button></form>
    <p class="muted small" style="margin-top:1rem">You can add more people later (for example, everyone in the family on one phone).</p>
  </section>`;
  $('#ob').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    const p = { id: db.uid(), name, color: COLORS[0], createdAt: Date.now() };
    await db.putPerson(p);
    state.people = await db.allPeople();
    await setPerson(p.id);
    go('#/home');
  });
}

// ---------- home ----------
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function installBanner() {
  if (standalone() || !isIOS()) return '';
  const dismissed = settings.get('installDismissed', 0);
  if (Date.now() - dismissed < 14 * 86400000) return '';
  return `<section class="card banner" id="install"><div>
    <strong>Add BP Snap to your Home Screen</strong>
    <p class="small">In Safari, tap the Share button <svg class="share-ic" viewBox="0 0 20 24" width="14" height="17" aria-label="Share"><path d="M10 1v14M5.5 5.5 10 1l4.5 4.5M6 9H3v14h14V9h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>, then <b>Add to Home Screen</b>. It opens like an app, works offline, and Safari won't clear your readings.</p></div>
    <button class="x" aria-label="Dismiss" data-dismiss>×</button></section>`;
}

function backupNudge() {
  const n = state.readings.length;
  const last = settings.get('lastBackup', 0);
  if (n < 10 || Date.now() - last < 30 * 86400000) return '';
  return `<section class="card banner"><div><strong>Back up your readings</strong>
    <p class="small">They only live on this phone. Save a backup file to iCloud Drive or email it to yourself.</p>
    <a class="btn small" href="#/settings">Back up now</a></div></section>`;
}

const statBox = (label, s) => `<div class="stat"><div class="v">${s.count ? `${s.sys}/${s.dia}` : '–'}</div>
  <div class="l">${esc(label)}${s.count ? ` · ${plural(s.count, 'reading')}` : ''}</div></div>`;

function itemHTML(r) {
  const c = S.category(r.sys, r.dia);
  return `<li><a class="item" href="#/r/${r.id}"><span class="catdot" style="background:${c?.color}" title="${esc(c?.label)}"></span>
    <span class="val">${r.sys}/${r.dia}</span>
    <span class="meta">${r.pulse ? `♥ ${r.pulse} · ` : ''}${fmtTime(r.takenAt)} · ${todLabel(r.takenAt)}${r.notes ? ' · 📝' : ''}${r.hasPhoto ? ' · 📷' : ''}</span>
    <span class="chev" aria-hidden="true">›</span></a></li>`;
}

const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'All']];
function rangeFrom(days, rs) {
  if (days) return Date.now() - days * 86400000;
  return rs.length ? Math.min(...rs.map((r) => r.takenAt)) : Date.now() - 7 * 86400000;
}

async function home() {
  const p = person();
  const rs = state.readings;
  const latest = rs[0];
  const s7 = S.summarize(S.lastDays(rs, 7)), s30 = S.summarize(S.lastDays(rs, 30));
  const tod = S.byTimeOfDay(S.lastDays(rs, 30));
  const range = settings.get('range', 30);
  const cat = latest && S.category(latest.sys, latest.dia);
  view.innerHTML = `${installBanner()}${backupNudge()}
  <section class="card hero">
    ${latest ? `<p class="muted small">Latest for ${esc(p.name)} · ${esc(when(latest.takenAt))}</p>
      <div class="bp-big">${latest.sys}<span class="slash">/</span>${latest.dia}<span class="unit">mmHg</span></div>
      <p>${latest.pulse ? `Pulse ${latest.pulse} · ` : ''}${todLabel(latest.takenAt)} ${chip(cat)}</p>`
    : `<h2>Log ${esc(p.name)}'s first reading</h2>
      <p class="muted">Measure as usual. When the final numbers show, take a photo of the monitor's screen. BP Snap reads them; you check and save.</p>`}
  </section>
  <div class="actions">
    <button class="btn primary big" data-act="cam">📷 Take photo of monitor</button>
    <button class="btn" data-act="lib">🖼️ Choose a photo</button>
    <a class="btn" href="#/manual">⌨️ Type it in</a>
  </div>
  ${rs.length ? `<section class="card"><h2>Averages</h2>
    <div class="stats">${statBox('Last 7 days', s7)}${statBox('Last 30 days', s30)}${statBox('Mornings, 30 days', tod.morning)}${statBox('Evenings, 30 days', tod.evening)}</div>
    ${s7.count ? `<p class="small" style="margin-top:.6rem">7-day average: ${chip(s7.category)} <span class="muted">${esc(s7.category.label)}</span></p>` : ''}
  </section>
  <section class="card"><h2>Trend <span class="seg" id="range">${RANGES.map(([d, l]) => `<button data-d="${d}" class="${d === range ? 'on' : ''}">${l}</button>`).join('')}</span></h2>
    <div id="chart">${chartSVG(rs, { from: rangeFrom(range, rs), to: Date.now() })}</div></section>
  <section class="card"><h2>Recent <a class="small" href="#/history">All ${rs.length} →</a></h2><ul class="list">${rs.slice(0, 5).map(itemHTML).join('')}</ul></section>` : ''}
  ${tipsCard()}`;
  $('[data-act=cam]').addEventListener('click', () => $('#cam').click());
  $('[data-act=lib]').addEventListener('click', () => $('#lib').click());
  $('[data-dismiss]')?.addEventListener('click', () => { settings.set('installDismissed', Date.now()); $('#install').remove(); });
  $$('#range button').forEach((b) => b.addEventListener('click', () => {
    const d = +b.dataset.d;
    settings.set('range', d);
    $$('#range button').forEach((x) => x.classList.toggle('on', x === b));
    $('#chart').innerHTML = chartSVG(rs, { from: rangeFrom(d, rs), to: Date.now() });
  }));
}

function tipsCard(open = false) {
  return `<section class="card"><details ${open ? 'open' : ''}><summary>How to get an accurate reading</summary>
    <ol class="tips small">
      <li>No coffee, smoking or exercise for 30 minutes before. Use the bathroom first.</li>
      <li>Sit quietly for 5 minutes: back supported, feet flat, legs uncrossed.</li>
      <li>Rest your arm on a table at heart level, cuff on bare skin. Don't talk.</li>
      <li>Take 2 readings, 1 minute apart. Do it at the same times each day (morning and evening).</li>
    </ol>
    <p class="small"><strong>Photo tips:</strong> wait for the final numbers, hold the phone straight over the screen, fill the frame with the display, and tilt it a little if you see glare.</p>
  </details></section>`;
}

// ---------- capture ----------
async function startCapture(file) {
  if (!file) return;
  if (!person()) return;
  const now = Date.now();
  let takenAt = now, timeHint = '';
  try {
    const t = exifDate(await file.slice(0, 256 * 1024).arrayBuffer());
    if (t && t < now + 60000 && now - t < 400 * 86400000) { takenAt = t; timeHint = Math.abs(now - t) > 120000 ? 'Time taken from the photo.' : ''; }
    else if (file.lastModified && now - file.lastModified > 120000 && now - file.lastModified < 400 * 86400000) {
      takenAt = file.lastModified; timeHint = 'Time taken from the photo file. Check it.';
    }
  } catch { /* keep now */ }
  let loaded;
  try {
    loaded = await IMG.loadImage(file);
  } catch (e) {
    toast(e.message || 'Could not open this image.');
    return;
  }
  if (state.draft?.url) URL.revokeObjectURL(state.draft.url);
  state.draft = { ...loaded, src: loaded.img, rot: 0, takenAt, timeHint, ocr: null, token: 0, touched: false };
  go('#/new');
}
for (const id of ['cam', 'lib']) {
  $('#' + id).addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; startCapture(f); });
}

function pill(name, value, label, cur) {
  return `<label><input type="radio" name="${name}" value="${value}" ${cur === value ? 'checked' : ''}><span>${label}</span></label>`;
}

function formHTML(v, opts = {}) {
  const arm = v.arm ?? settings.get('arm', '');
  const pos = v.position ?? settings.get('position', 'sitting');
  return `<form id="rf" novalidate>
    <div class="nums">
      <div class="sys"><label class="f" for="f-sys">SYS · top</label><input id="f-sys" name="sys" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" value="${v.sys ?? ''}" aria-describedby="errs"></div>
      <div class="dia"><label class="f" for="f-dia">DIA · bottom</label><input id="f-dia" name="dia" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" value="${v.dia ?? ''}"></div>
      <div><label class="f" for="f-pulse">Pulse</label><input id="f-pulse" name="pulse" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" value="${v.pulse ?? ''}"></div>
    </div>
    <label class="f" for="f-time">Date and time</label>
    <input id="f-time" name="time" type="datetime-local" value="${toLocalInput(v.takenAt ?? Date.now())}" data-orig="${v.takenAt ?? ''}">
    ${opts.timeHint ? `<p class="muted small">${esc(opts.timeHint)}</p>` : ''}
    <label class="f">Arm</label><div class="pills">${pill('arm', 'left', 'Left', arm)}${pill('arm', 'right', 'Right', arm)}</div>
    <label class="f">Position</label><div class="pills">${pill('position', 'sitting', 'Sitting', pos)}${pill('position', 'standing', 'Standing', pos)}${pill('position', 'lying', 'Lying down', pos)}</div>
    <label class="f" for="f-notes">Notes</label>
    <textarea id="f-notes" name="notes" maxlength="500" placeholder="Optional: e.g. took meds at 8am, felt dizzy">${esc(v.notes ?? '')}</textarea>
    <div id="errs" class="errors" role="alert"></div>
    <div class="row" style="margin-top:1rem">${opts.extra ?? ''}<a class="btn" href="#/home" style="margin-left:auto">Cancel</a><button class="btn primary">${opts.submit ?? 'Save reading'}</button></div>
  </form>`;
}

function readForm(form) {
  const fd = new FormData(form);
  const sys = int(fd.get('sys')), dia = int(fd.get('dia'));
  const pulse = String(fd.get('pulse') ?? '').trim() === '' ? null : int(fd.get('pulse'));
  const errs = S.validReading(sys, dia, pulse);
  // Keep the exact capture time (seconds matter for back-to-back readings) unless the user edited it.
  const orig = Number(form.time.dataset.orig);
  const takenAt = orig && fd.get('time') === toLocalInput(orig) ? orig : fromLocalInput(fd.get('time'));
  if (!takenAt) errs.push('Please set the date and time.');
  else if (takenAt > Date.now() + 5 * 60000) errs.push('The date and time is in the future.');
  return { errs, values: { sys, dia, pulse, takenAt, arm: fd.get('arm') || '', position: fd.get('position') || '', notes: String(fd.get('notes') ?? '').trim() } };
}

function showErrors(form, errs) {
  $('#errs', form).innerHTML = errs.map((e) => `<p>${esc(e)}</p>`).join('');
  if (errs.length) $('#errs', form).scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function afterSave(r, isNew) {
  settings.set('arm', r.arm);
  settings.set('position', r.position);
  navigator.storage?.persist?.().catch(() => {});
  await loadReadings();
  const c = S.category(r.sys, r.dia);
  if (c?.key === 'severe') {
    openSheet(`<h2>That reading is very high</h2>
      <p><b>${r.sys}/${r.dia}</b> is above 180/120.</p>
      <p>The American Heart Association advises: wait 5 minutes and measure again. If it is still this high, contact your doctor right away.</p>
      <p><b>Call 911</b> if you also have chest pain, shortness of breath, back pain, numbness or weakness, vision changes, or trouble speaking.</p>
      <button class="btn primary block" data-ok>OK</button>`, (el) => $('[data-ok]', el).addEventListener('click', () => { closeSheet(); go('#/home'); }));
  } else {
    toast(isNew ? `Saved ${r.sys}/${r.dia} for ${person().name}` : 'Saved');
    go('#/home');
  }
}

// ---------- review a photo ----------
async function reviewPhoto() {
  const d = state.draft;
  if (!d) return go('#/home');
  view.innerHTML = `<section class="review">
    <h2>Check the numbers</h2>
    <div class="photo-wrap" id="pw"><canvas class="photo" id="photo"></canvas><div class="overlay" id="ov"></div></div>
    <div class="row" style="margin-top:.5rem">
      <button type="button" class="btn small" id="sel">⬚ Select numbers</button>
      <button type="button" class="btn small" id="rot">↻ Rotate</button>
      <button type="button" class="btn small" id="retake">📷 Retake</button>
    </div>
    <p id="ocr-status" class="status busy">Reading the numbers…</p>
    ${formHTML({ ...(d.values || {}), takenAt: d.takenAt }, { timeHint: d.timeHint })}
  </section>`;
  const form = $('#rf');
  $$('#f-sys, #f-dia, #f-pulse', form).forEach((i) => i.addEventListener('input', () => { d.touched = true; }));
  $('#retake').addEventListener('click', () => $('#cam').click());
  $('#rot').addEventListener('click', () => { d.rot = (d.rot + 1) % 4; d.src = d.rot ? IMG.rotate(d.img, d.rot) : d.img; drawPhoto(); runReader(); });
  setupSelect();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { errs, values } = readForm(form);
    showErrors(form, errs);
    if (errs.length) return;
    const btn = $('button.primary', form);
    btn.disabled = true;
    try {
      const keep = settings.get('keepPhotos', true);
      const o = d.ocr && d.ocr.ok ? { sys: d.ocr.sys, dia: d.ocr.dia, pulse: d.ocr.pulse, confidence: +d.ocr.confidence.toFixed(2) } : null;
      const r = {
        id: db.uid(), personId: state.personId, ...values, source: 'photo',
        ocr: o, edited: o ? o.sys !== values.sys || o.dia !== values.dia || (o.pulse ?? null) !== values.pulse : true,
        hasPhoto: keep, createdAt: Date.now(), updatedAt: Date.now(), tzOffset: new Date(values.takenAt).getTimezoneOffset(),
      };
      if (keep) await db.putPhoto(r.id, await IMG.jpeg(IMG.toCanvas(d.src, 960), 0.72));
      await db.putReading(r);
      URL.revokeObjectURL(d.url);
      state.draft = null;
      await afterSave(r, true);
    } catch (err) {
      btn.disabled = false;
      showErrors(form, [`Could not save: ${err.message || err}`]);
    }
  });
  drawPhoto();
  runReader();
}

const srcSize = (src) => ({ w: src.naturalWidth || src.width, h: src.naturalHeight || src.height });

function drawPhoto() {
  const d = state.draft;
  const cv = $('#photo');
  if (!cv) return;
  const shown = IMG.toCanvas(d.src, 1200);
  cv.width = shown.width; cv.height = shown.height;
  cv.getContext('2d').drawImage(shown, 0, 0);
  $('#ov').innerHTML = '';
}

function drawBoxes(boxes, extra = '') {
  const d = state.draft;
  const { w, h } = srcSize(d.src);
  $('#ov').innerHTML = boxes.map((b) => `<div class="box" style="left:${(b.x / w) * 100}%;top:${(b.y / h) * 100}%;width:${(b.w / w) * 100}%;height:${(b.h / h) * 100}%"><span>${esc(b.label)} ${b.value}</span></div>`).join('') + extra;
}

function setStatus(cls, html) {
  const st = $('#ocr-status');
  if (!st) return;
  st.className = 'status ' + cls;
  st.innerHTML = html;
}

async function readCanvas(src, crop) {
  const cv = crop ? IMG.toCanvas(src, 900, crop) : IMG.toCanvas(src, 1100);
  const scale = (crop ? crop.w : srcSize(src).w) / cv.width;
  const res = await OCR.read(IMG.pixels(cv), { maxDim: crop ? 820 : 760 });
  if (res.ok) {
    const ox = crop ? crop.x : 0, oy = crop ? crop.y : 0;
    res.boxes = res.boxes.map((b) => ({ ...b, x: b.x * scale + ox, y: b.y * scale + oy, w: b.w * scale, h: b.h * scale }));
  }
  return res;
}

async function runReader(crop = null) {
  const d = state.draft;
  const token = ++d.token;
  setStatus('busy', crop ? 'Reading the area you selected…' : 'Reading the numbers…');
  await nextFrame();
  let res;
  try {
    res = await readCanvas(d.src, crop);
    // Sideways photo? Try the other two orientations before giving up.
    if (!res.ok && !crop) {
      for (const q of [1, 3]) {
        const rsrc = IMG.rotate(d.img, (d.rot + q) % 4);
        const r2 = await readCanvas(rsrc, null);
        if (r2.ok) { d.rot = (d.rot + q) % 4; d.src = rsrc; drawPhoto(); res = r2; break; }
      }
    }
  } catch (err) {
    res = { ok: false, error: String(err.message || err) };
  }
  if (token !== d.token || state.draft !== d || !$('#rf')) return;
  d.ocr = res;
  const form = $('#rf');
  if (res.ok) {
    drawBoxes(res.boxes);
    if (!d.touched) {
      form.sys.value = res.sys;
      form.dia.value = res.dia;
      form.pulse.value = res.pulse ?? '';
    }
    const sure = res.confidence >= 0.5 && res.pulse != null;
    setStatus(sure ? 'ok' : 'warn', `${sure ? 'Read' : 'Best guess'}: <b>${res.sys}/${res.dia}</b>${res.pulse != null ? `, pulse <b>${res.pulse}</b>` : ', no pulse found'}. Check them against the monitor and fix anything that's off.
      <br><span class="small muted">Wrong? Tap ⬚ Select numbers and drag a box around the screen's numbers.</span>`);
  } else {
    drawBoxes([]);
    setStatus('warn', `Couldn't read the numbers in this photo. Tap <b>⬚ Select numbers</b> and drag a box around them, or type them in below.`);
  }
}

function setupSelect() {
  const pw = $('#pw'), ov = $('#ov'), btn = $('#sel');
  let on = false, start = null, box = null;
  const setOn = (v) => {
    on = v;
    btn.classList.toggle('primary', on);
    pw.style.touchAction = on ? 'none' : '';
    if (on) setStatus('', 'Drag a box around the numbers on the screen (SYS, DIA and pulse).');
  };
  btn.addEventListener('click', () => setOn(!on));
  const pt = (e) => {
    const r = pw.getBoundingClientRect();
    const { w, h } = srcSize(state.draft.src);
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * w, y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * h };
  };
  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  const show = (r) => {
    const { w, h } = srcSize(state.draft.src);
    if (!box) { box = document.createElement('div'); box.className = 'box sel'; ov.appendChild(box); }
    Object.assign(box.style, { left: `${(r.x / w) * 100}%`, top: `${(r.y / h) * 100}%`, width: `${(r.w / w) * 100}%`, height: `${(r.h / h) * 100}%` });
  };
  ov.addEventListener('pointerdown', (e) => {
    if (!on) return;
    e.preventDefault();
    ov.innerHTML = ''; box = null;
    start = pt(e);
    ov.setPointerCapture?.(e.pointerId);
  });
  ov.addEventListener('pointermove', (e) => { if (on && start) show(rectOf(start, pt(e))); });
  const end = (e) => {
    if (!on || !start) return;
    const r = rectOf(start, pt(e));
    start = null;
    const { w, h } = srcSize(state.draft.src);
    if (r.w < w * 0.05 || r.h < h * 0.03) { setStatus('warn', 'That box is too small. Drag across all the numbers.'); return; }
    setOn(false);
    const m = 0.03;
    const crop = { x: Math.max(0, r.x - r.w * m), y: Math.max(0, r.y - r.h * m), w: Math.min(w, r.w * (1 + 2 * m)), h: Math.min(h, r.h * (1 + 2 * m)) };
    crop.w = Math.min(crop.w, w - crop.x); crop.h = Math.min(crop.h, h - crop.y);
    runReader(crop);
  };
  ov.addEventListener('pointerup', end);
  ov.addEventListener('pointercancel', () => { start = null; });
}

// ---------- manual entry / edit ----------
async function manualEntry() {
  view.innerHTML = `<section class="card"><h2>Type in a reading for ${esc(person().name)}</h2>${formHTML({ takenAt: Date.now() })}</section>`;
  const form = $('#rf');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { errs, values } = readForm(form);
    showErrors(form, errs);
    if (errs.length) return;
    const r = { id: db.uid(), personId: state.personId, ...values, source: 'manual', ocr: null, hasPhoto: false, createdAt: Date.now(), updatedAt: Date.now(), tzOffset: new Date(values.takenAt).getTimezoneOffset() };
    await db.putReading(r);
    await afterSave(r, true);
  });
  setTimeout(() => $('#f-sys')?.focus(), 50);
}

async function editReading(id) {
  const r = state.readings.find((x) => x.id === id);
  if (!r) return go('#/history');
  const c = S.category(r.sys, r.dia);
  view.innerHTML = `<section class="card">
    <h2>${r.sys}/${r.dia} ${chip(c)}</h2>
    <p class="muted small">${esc(when(r.takenAt))} · ${r.source === 'photo' ? (r.edited ? 'from a photo, corrected by hand' : 'read from a photo') : 'typed in'}</p>
    <div id="ph"></div>
    ${formHTML(r, { submit: 'Save changes', extra: '<button type="button" class="btn danger" data-del>Delete</button>' })}
  </section>`;
  if (r.hasPhoto) {
    const b = await db.getPhoto(r.id);
    if (b) {
      const url = URL.createObjectURL(b);
      $('#ph').innerHTML = `<img src="${url}" alt="Photo of the monitor for this reading" style="width:100%;border-radius:12px;margin:.5rem 0">`;
    }
  }
  const form = $('#rf');
  $('[data-del]', form).addEventListener('click', async () => {
    if (!confirm(`Delete the reading ${r.sys}/${r.dia} from ${when(r.takenAt)}?`)) return;
    await db.deleteReading(r.id);
    await loadReadings();
    toast('Deleted');
    go('#/history');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { errs, values } = readForm(form);
    showErrors(form, errs);
    if (errs.length) return;
    const nr = { ...r, ...values, updatedAt: Date.now() };
    if (r.ocr) nr.edited = r.ocr.sys !== values.sys || r.ocr.dia !== values.dia || (r.ocr.pulse ?? null) !== values.pulse;
    await db.putReading(nr);
    await afterSave(nr, false);
  });
}

// ---------- history ----------
async function history() {
  const rs = state.readings;
  if (!rs.length) {
    view.innerHTML = `<section class="card center"><h2>No readings yet</h2><p class="muted">Readings for ${esc(person().name)} will show up here.</p><a class="btn primary" href="#/home">Add a reading</a></section>`;
    return;
  }
  let html = `<section class="card"><h2>${esc(person().name)} · ${plural(rs.length, 'reading')}</h2>`;
  let day = null;
  for (const r of rs) {
    const dl = dayLabel(r.takenAt);
    if (dl !== day) { html += `${day ? '</ul>' : ''}<div class="day">${esc(dl)}</div><ul class="list">`; day = dl; }
    html += itemHTML(r);
  }
  html += '</ul></section>';
  view.innerHTML = html;
}

// ---------- report ----------
const REPORT_RANGES = [[7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year'], [0, 'All time']];

async function report() {
  const days = settings.get('reportRange', 30);
  const p = person();
  const all = state.readings;
  const rs = days ? S.lastDays(all, days) : all;
  const s = S.summarize(rs);
  const tod = S.byTimeOfDay(rs);
  const cats = S.categoryCounts(rs);
  const from = rangeFrom(days, all);
  const todRows = S.TIMES_OF_DAY.filter((t) => tod[t.key].count).map((t) => {
    const x = tod[t.key];
    return `<tr><td>${t.label}</td><td>${x.sys}/${x.dia}</td><td>${x.pulse ?? '–'}</td><td>${x.count}</td></tr>`;
  }).join('');
  const catRows = S.CATEGORIES.filter((c) => cats[c.key]).map((c) => `<tr><td>${chip(c)} ${esc(c.label)}</td><td>${cats[c.key]}</td><td>${Math.round((100 * cats[c.key]) / rs.length)}%</td></tr>`).join('');
  const rows = [...rs].sort((a, b) => a.takenAt - b.takenAt).map((r) => `<tr><td>${esc(fmtDate(r.takenAt))}</td><td>${fmtTime(r.takenAt)}</td><td><b>${r.sys}/${r.dia}</b></td><td>${r.pulse ?? ''}</td><td>${esc([r.arm && `${r.arm} arm`, r.position !== 'sitting' ? r.position : '', r.notes].filter(Boolean).join(' · '))}</td></tr>`).join('');
  view.innerHTML = `<section class="card no-print"><div class="spread"><label for="rr" class="f" style="margin:0">Period</label>
      <select id="rr" style="width:auto">${REPORT_RANGES.map(([d, l]) => `<option value="${d}" ${d === days ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="row" style="margin-top:.8rem"><button class="btn small" id="print">🖨️ Print / PDF</button><button class="btn small" id="csv">⬇️ CSV</button>${navigator.share ? '<button class="btn small" id="share">📤 Share</button>' : ''}</div>
  </section>
  <section class="card"><h1 style="font-size:1.3rem">Blood pressure report: ${esc(p.name)}</h1>
    <p class="muted small">${rs.length ? `${esc(fmtDate(s.first))} to ${esc(fmtDate(s.last))}` : 'No readings in this period'} · made ${esc(fmtDate(Date.now()))} with BP Snap</p>
    ${rs.length ? `<div class="stats" style="margin-top:.6rem">
      <div class="stat"><div class="v">${s.sys}/${s.dia}</div><div class="l">Average · ${chip(s.category)}</div></div>
      <div class="stat"><div class="v">${s.pulse ?? '–'}</div><div class="l">Average pulse</div></div>
      <div class="stat"><div class="v">${s.sysMin}–${s.sysMax}</div><div class="l">Systolic range</div></div>
      <div class="stat"><div class="v">${s.diaMin}–${s.diaMax}</div><div class="l">Diastolic range</div></div>
    </div>` : ''}
  </section>
  ${rs.length ? `<section class="card"><h2>Trend</h2>${chartSVG(rs, { from, to: Date.now() })}</section>
  <section class="card"><h2>By time of day</h2><table><thead><tr><th>When</th><th>Average</th><th>Pulse</th><th>Readings</th></tr></thead><tbody>${todRows}</tbody></table>
    <p class="muted small">Morning 4am–noon · afternoon noon–5pm · evening 5–10pm · night 10pm–4am</p></section>
  <section class="card"><h2>Categories</h2><table><tbody>${catRows}</tbody></table>
    <p class="muted small">ACC/AHA categories: normal &lt;120/&lt;80 · elevated 120–129/&lt;80 · stage 1 130–139 or 80–89 · stage 2 ≥140 or ≥90.</p></section>
  <section class="card"><h2>All readings (${rs.length})</h2><table><thead><tr><th>Date</th><th>Time</th><th>BP</th><th>Pulse</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></section>` : ''}
  <p class="muted small center">Home readings for discussion with a doctor. BP Snap is not a medical device.</p>`;
  $('#rr').addEventListener('change', (e) => { settings.set('reportRange', +e.target.value); report(); });
  $('#print').addEventListener('click', () => window.print());
  const csvName = `bp-${slug(p.name)}-${today()}.csv`;
  $('#csv').addEventListener('click', () => download(csvName, S.toCSV(rs, peopleById()), 'text/csv'));
  $('#share')?.addEventListener('click', async () => {
    const file = new File([S.toCSV(rs, peopleById())], csvName, { type: 'text/csv' });
    const text = s.count ? `${p.name}'s blood pressure, ${rs.length} readings: average ${s.sys}/${s.dia}${s.pulse ? `, pulse ${s.pulse}` : ''}.` : '';
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Blood pressure log', text });
      else await navigator.share({ title: 'Blood pressure log', text });
    } catch (err) { if (err.name !== 'AbortError') toast('Sharing failed'); }
  });
}

// ---------- settings ----------
function ics(times) {
  const url = location.href.split('#')[0];
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const t = new Date(now.getTime() + 86400000);
  const ymd = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}`;
  const ev = times.map((hm, i) => {
    const [hh, mm] = hm.split(':');
    return ['BEGIN:VEVENT', `UID:bp-snap-${stamp}-${i}@bp-snap`, `DTSTAMP:${stamp}`, `DTSTART:${ymd}T${hh}${mm}00`, 'DURATION:PT10M', 'RRULE:FREQ=DAILY',
      'SUMMARY:Measure blood pressure', `DESCRIPTION:Sit quietly for 5 minutes first. Then log it: ${url}`, `URL:${url}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Measure blood pressure', 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT'].join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BP Snap//EN', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR', ''].join('\r\n');
}

async function settingsView() {
  const counts = {};
  for (const r of await db.allReadings()) counts[r.personId] = (counts[r.personId] || 0) + 1;
  const persisted = (await navigator.storage?.persisted?.().catch(() => null)) ?? null;
  const keep = settings.get('keepPhotos', true);
  const last = settings.get('lastBackup', 0);
  view.innerHTML = `<section class="card"><h2>People</h2>
    <ul class="list">${state.people.map((p) => `<li><button class="item btn block" data-edit="${p.id}" style="justify-content:flex-start;border:0;padding-left:0">
      <span class="dot" style="background:${p.color}"></span><span>${esc(p.name)}</span><span class="muted small" style="margin-left:auto">${plural(counts[p.id] || 0, 'reading')}</span><span class="chev">›</span></button></li>`).join('')}</ul>
    <button class="btn small" id="add-person" style="margin-top:.5rem">+ Add person</button></section>

  <section class="card"><h2>Back up and export</h2>
    <p class="small muted">Readings live only in this browser on this phone. Keep a backup somewhere safe (Files, iCloud Drive, email).${last ? ` Last backup: ${esc(fmtDate(last))}.` : ''}</p>
    <label class="row small"><input type="checkbox" id="bk-photos" style="width:auto"> Include photos (bigger file)</label>
    <div class="row" style="margin-top:.5rem"><button class="btn small" id="backup">💾 Save backup</button><button class="btn small" id="restore">📂 Restore backup</button><button class="btn small" id="csv-all">⬇️ CSV, everyone</button></div></section>

  <section class="card"><h2>Daily reminders</h2>
    <p class="small muted">Adds repeating events with an alert to your phone's calendar.</p>
    <div class="row"><label class="small">Morning <input type="time" id="rem-am" value="${esc(settings.get('remAm', '07:30'))}" style="width:auto"></label>
      <label class="small">Evening <input type="time" id="rem-pm" value="${esc(settings.get('remPm', '19:30'))}" style="width:auto"></label></div>
    <button class="btn small" id="rem" style="margin-top:.6rem">📅 Add to calendar</button></section>

  <section class="card"><h2>Photos</h2>
    <label class="row small"><input type="checkbox" id="keep" style="width:auto" ${keep ? 'checked' : ''}> Keep a small copy of each photo with its reading</label>
    <p class="small muted">Handy for double-checking a reading later. Photos stay on this phone.</p></section>

  <section class="card"><h2>About</h2>
    <p class="small">BP Snap reads seven-segment monitor screens right on your phone; no photo or reading is uploaded anywhere. ${persisted === true ? 'Storage is marked persistent.' : standalone() ? '' : 'Add it to your Home Screen so Safari keeps your data.'}</p>
    <p class="small">It is not a medical device. Always check the numbers against the monitor, and talk to a doctor about your readings.</p>
    <p class="small muted">Version ${VERSION} · <a href="${REPO}" rel="noopener">source code</a></p></section>`;
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => personForm(state.people.find((p) => p.id === b.dataset.edit))));
  $('#add-person').addEventListener('click', () => personForm());
  $('#keep').addEventListener('change', (e) => settings.set('keepPhotos', e.target.checked));
  $('#csv-all').addEventListener('click', async () => download(`bp-all-${today()}.csv`, S.toCSV(await db.allReadings(), peopleById()), 'text/csv'));
  $('#backup').addEventListener('click', async () => {
    const data = await db.exportAll({ photos: $('#bk-photos').checked });
    download(`bp-snap-backup-${today()}.json`, JSON.stringify(data), 'application/json');
    settings.set('lastBackup', Date.now());
    toast(`Backup saved: ${plural(data.readings.length, 'reading')}`);
  });
  $('#restore').addEventListener('click', () => $('#restore-file').click());
  $('#rem').addEventListener('click', () => {
    const am = $('#rem-am').value, pm = $('#rem-pm').value;
    settings.set('remAm', am); settings.set('remPm', pm);
    download('bp-reminders.ics', ics([am, pm].filter(Boolean)), 'text/calendar');
  });
}

$('#restore-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const res = await db.importAll(JSON.parse(await f.text()));
    state.people = await db.allPeople();
    if (!person()) await setPerson(state.people[0].id); else await loadReadings();
    renderHeader();
    toast(`Restored ${plural(res.readings, 'reading')} for ${plural(res.people, 'person')}`);
    route();
  } catch (err) {
    toast(err.message || 'Could not read that file');
  }
});

$('#person-btn').addEventListener('click', peopleSheet);

// ---------- boot ----------
async function boot() {
  try {
    state.people = await db.allPeople();
  } catch (err) {
    view.innerHTML = `<section class="card"><h2>Storage is unavailable</h2><p>BP Snap needs browser storage to keep your log. Private Browsing can block it; open the page in a normal Safari tab.</p><p class="muted small">${esc(err.message || err)}</p></section>`;
    return;
  }
  const saved = settings.get('person', null);
  if (state.people.length) await setPerson(state.people.some((p) => p.id === saved) ? saved : state.people[0].id);
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
boot();
