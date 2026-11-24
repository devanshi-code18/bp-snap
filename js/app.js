// BP Snap: photo -> reading -> a log on this phone, with an encrypted backup online.
import * as db from './db.js';
import * as S from './stats.js';
import { chartSVG } from './chart.js';
import { exifDate } from './exif.js';
import * as IMG from './image.js';
import * as OCR from './ocr/client.js';
import * as sync from './sync.js';

const VERSION = '1.1.0';
const REPO = 'https://github.com/devanshi-code18/bp-snap';
const COLORS = ['#c2352f', '#2f6fd1', '#1f7a45', '#8a4fd1', '#b85c00', '#0e7f8a', '#b8357f', '#5f5b57'];
const TEXT_SIZES = [[1, 'Normal'], [1.15, 'Large'], [1.32, 'Extra large']];

const ICONS = {
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  select: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>',
  rotate: '<path d="M21 2v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
const icon = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
const sheet = $('#sheet');

const state = { people: [], personId: null, readings: [], draft: null, joinSecret: null };

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
  return d.toLocaleDateString([], { weekday: long ? 'long' : 'short', month: long ? 'long' : 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}
function dayLabel(ms) {
  const d = new Date(ms); d.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return fmtDate(ms, true);
}
const when = (ms) => `${dayLabel(ms)} at ${fmtTime(ms)}`;
function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `on ${fmtDate(ms)}`;
}
const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function fromLocalInput(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : null;
}
const todLabel = (r) => S.TIMES_OF_DAY.find((t) => t.key === S.todOf(r)).label;
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? c : '#5f5b57');
const chip = (c) => (c ? `<span class="chip" style="background:${c.color};color:${c.ink}">${esc(c.short)}</span>` : '');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const int = (v) => { const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : null; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const possessive = (name) => `${name}${/s$/i.test(name) ? '\u2019' : '\u2019s'}`;

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

// ---------- environment ----------
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// Apps that open links in their own browser, where saved data may not last.
const inAppBrowser = () => /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Snapchat|Twitter|Line\/|MicroMessenger|GSA\/|Slack|Gmail|Pinterest/i.test(navigator.userAgent);

// Base size follows the iPhone's own text size setting (Settings > Display > Text Size).
function applyTextSize() {
  const scale = settings.get('textScale', 1.15);
  let base = 17;
  try {
    if (CSS.supports('font', '-apple-system-body')) {
      const p = document.createElement('span');
      p.style.cssText = 'font:-apple-system-body;position:absolute;visibility:hidden';
      document.body.appendChild(p);
      base = parseFloat(getComputedStyle(p).fontSize) || 17;
      p.remove();
    }
  } catch { /* keep 17 */ }
  base = Math.min(Math.max(base, 15), 24);
  document.documentElement.style.fontSize = `${(base * scale).toFixed(1)}px`;
}

// ---------- files ----------
function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  // iOS asks "Download?" first; keep the blob alive long enough.
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 120000);
}

// On iPhone the share sheet is the natural way to put a file in Files / iCloud Drive or email it.
// Resolves 'shared' | 'downloaded' | 'cancelled' | 'blocked' (share needs a fresh tap).
async function saveFile(name, blob, title) {
  const file = new File([blob], name, { type: blob.type });
  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'shared'; } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      if (err.name === 'NotAllowedError') return 'blocked';
    }
  }
  download(name, blob);
  return 'downloaded';
}

// Save a file that took a while to build: if iOS refused the share sheet because the tap is
// too old, offer a button that shares it straight away.
async function deliverFile(name, blob, title, onDone) {
  const res = await saveFile(name, blob, title);
  if (res !== 'blocked') { if (res !== 'cancelled') onDone?.(res); return; }
  openSheet(`<h2>${esc(title)} is ready</h2><p>${esc(name)}</p>
    <button class="btn primary block" data-go>${icon('share')} Save or send it</button>
    <button class="btn block" data-x style="margin-top:.6rem">Cancel</button>`, (el) => {
    $('[data-x]', el).addEventListener('click', closeSheet);
    $('[data-go]', el).addEventListener('click', async () => {
      const r = await saveFile(name, blob, title);
      closeSheet();
      if (r === 'shared' || r === 'downloaded') onDone?.(r);
    });
  });
}

// ---------- people ----------
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

async function reloadAll() {
  state.people = await db.allPeople();
  const saved = settings.get('person', null);
  if (state.people.length) await setPerson(state.people.some((p) => p.id === saved) ? saved : state.people[0].id);
  else { state.personId = null; state.readings = []; renderHeader(); }
}

function renderHeader() {
  const p = person();
  const b = $('#person-btn');
  b.hidden = !p;
  if (p) {
    $('.name', b).textContent = p.name;
    $('.dot', b).style.background = safeColor(p.color);
    b.setAttribute('aria-label', `Readings for ${p.name}. Tap to change person`);
  }
}

// ---------- sheet (bottom dialog) ----------
const sheetOpen = () => sheet.open || sheet.hasAttribute('open');
function openSheet(html, bind) {
  sheet.innerHTML = html;
  if (!sheetOpen()) {
    try { if (typeof sheet.showModal === 'function') sheet.showModal(); else sheet.setAttribute('open', ''); } catch { sheet.setAttribute('open', ''); }
  }
  bind?.(sheet);
}
function closeSheet() {
  if (!sheetOpen()) return;
  if (typeof sheet.close === 'function' && sheet.open) sheet.close(); else { sheet.removeAttribute('open'); sheet.dispatchEvent(new Event('close')); }
}
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

function peopleSheet() {
  const items = state.people.map((p) => `<li><button class="btn block person-pick" data-id="${esc(p.id)}">
    <span class="dot" style="background:${safeColor(p.color)}"></span><span>${esc(p.name)}</span>${p.id === state.personId ? '<span class="muted" style="margin-left:auto">now</span>' : ''}</button></li>`).join('');
  openSheet(`<h2>Whose readings?</h2><ul class="plain-list">${items}</ul>
    <button class="btn block" data-add style="margin-top:1rem">+ Add another person</button>
    <button class="btn block" data-close style="margin-top:.6rem">Close</button>`, (el) => {
    $$('[data-id]', el).forEach((b) => b.addEventListener('click', async () => { closeSheet(); await setPerson(b.dataset.id); route(); }));
    $('[data-add]', el).addEventListener('click', () => personForm());
    $('[data-close]', el).addEventListener('click', closeSheet);
  });
}

function personForm(p = null) {
  const color = p?.color || COLORS[state.people.length % COLORS.length];
  const swatches = COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('');
  openSheet(`<form id="pf"><h2>${p ? 'Change name' : 'Add a person'}</h2>
    <label class="f" for="pf-name">Name</label>
    <input id="pf-name" name="name" required maxlength="40" autocomplete="off" placeholder="For example: Dad" value="${esc(p?.name || '')}">
    <label class="f">Colour</label><div class="colors">${swatches}</div>
    <button class="btn primary block" style="margin-top:1.2rem">Save</button>
    <button type="button" class="btn block" data-cancel style="margin-top:.6rem">Cancel</button>
    ${p && state.people.length > 1 ? '<button type="button" class="btn danger block" data-del style="margin-top:1.4rem">Delete this person and their readings</button>' : ''}</form>`, (el) => {
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
      toast(p ? 'Saved' : `Now showing ${name}`);
      route();
    });
    setTimeout(() => $('#pf-name', el).focus(), 50);
  });
}

// ---------- routing ----------
const currentRoute = () => location.hash.replace(/^#\/?/, '').split('/');

async function route() {
  closeSheet();
  const [name = 'home', arg] = currentRoute();
  // Screens where you fill something in get no tab bar: nothing to tap by mistake.
  const bare = !state.people.length || ['join', 'new', 'manual', 'r', 'saved'].includes(name);
  document.body.classList.toggle('bare', bare);
  if (name === 'join') return joinView(arg);
  if (!state.people.length) return onboarding();
  $$('.tabs a').forEach((a) => {
    const on = a.dataset.tab === name || (name === '' && a.dataset.tab === 'home');
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const views = { home, history, report, settings: settingsView, new: reviewPhoto, manual: manualEntry, r: editReading, saved: savedView, safe: safeView };
  await (views[name] || home)(arg);
  view.focus({ preventScroll: true });
}
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

// ---------- warnings about where the data lives ----------
const shareIcon = '<svg class="share-ic" viewBox="0 0 20 24" width="18" height="22" aria-label="Share"><path d="M10 1v14M5.5 5.5 10 1l4.5 4.5M6 9H3v14h14V9h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function inAppWarning() {
  if (!inAppBrowser()) return '';
  return `<section class="card alert" id="inapp"><h2>Open this page in Safari</h2>
    <p>You opened BP Snap inside another app. Readings saved here may be lost.</p>
    <p>Tap the <b>•••</b> or compass button, then <b>Open in Safari</b>.</p></section>`;
}

function installSteps() {
  return `<ol class="steps">
    <li>Tap the Share button ${shareIcon} at the bottom of Safari.</li>
    <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
    <li>Open BP Snap from its new icon on your Home Screen.</li></ol>`;
}

function installBanner() {
  if (standalone() || !isIOS() || inAppBrowser()) return '';
  if (Date.now() - settings.get('installDismissed', 0) < 3 * 86400000) return '';
  return `<section class="card banner" id="install"><h2>Put BP Snap on your Home Screen</h2>
    <p>Safari can clear websites you haven't opened for a week. On the Home Screen your readings are kept.</p>
    ${installSteps()}
    <button class="btn block" data-dismiss>Not now</button></section>`;
}

function recoveryBanner() {
  if (!sync.available() || !sync.getSecret() || settings.get('recoverySaved', false) || !state.readings.length) return '';
  return `<section class="card banner warn" id="recovery"><h2>${icon('shield')} Keep your readings safe</h2>
    <p>If this phone is lost or reset, you will need your recovery link to get your readings back.</p>
    <a class="btn primary block" href="#/safe">Save my recovery link</a></section>`;
}

function safetyLine() {
  const s = sync.status();
  let backup = '';
  if (sync.available() && sync.getSecret()) {
    if (s.state === 'ok' && s.at) backup = `<span class="ok">${icon('check')} Backed up online ${esc(ago(s.at))}</span>`;
    else if (s.state === 'error') backup = `<span class="bad">Not backed up yet. ${esc(s.message || '')} It will try again.</span>`;
    else backup = '<span>Backing up…</span>';
  }
  return `<a class="card safe-line" id="safe-line" href="#/safe"><span class="ok">${icon('check')} Saved on this phone</span>${backup}<span class="more">Details ›</span></a>`;
}

function refreshSafetyLine() {
  const el = $('#safe-line');
  if (el) el.outerHTML = safetyLine();
  const st = $('#safe-status');
  if (st) st.innerHTML = safeStatusText();
}

// ---------- onboarding ----------
function onboarding() {
  $$('.tabs a').forEach((a) => a.classList.remove('active'));
  const safariTip = isIOS() && !standalone() && !inAppBrowser();
  view.innerHTML = `${inAppWarning()}
  <section class="card">
    <h1>Welcome to BP Snap</h1>
    <p class="lead">Keep a record of your blood pressure by taking a photo of your monitor.</p>
  </section>
  ${safariTip ? `<section class="card banner"><h2>First, put BP Snap on your Home Screen</h2>
    <p>That way your readings are kept safe.</p>${installSteps()}</section>` : ''}
  <section class="card">
    <h2>Start a new log</h2>
    <form id="ob"><label class="f" for="ob-name">Whose blood pressure will you track?</label>
      <input id="ob-name" name="name" required maxlength="40" placeholder="For example: Mom" autocomplete="off">
      <button class="btn primary block xl" style="margin-top:1rem">Start</button></form>
    <p class="muted" style="margin-top:.8rem">You can add more people later.</p>
  </section>
  <section class="card">
    <h2>Already use BP Snap?</h2>
    <p>For example on another phone, or before this phone was reset. Open your <b>recovery link</b>, or type your <b>12 recovery words</b> here:</p>
    <textarea id="ob-words" rows="3" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="12 recovery words, or paste the recovery link"></textarea>
    <div id="ob-err" class="errors" role="alert"></div>
    ${navigator.clipboard?.readText ? '<button class="btn block" id="ob-paste" type="button">Paste my recovery link</button>' : ''}
    <button class="btn primary block" id="ob-join" type="button" style="margin-top:.6rem">Get my readings</button>
    <button class="btn block" id="ob-restore" type="button" style="margin-top:.6rem">${icon('upload')} Restore from a backup file</button>
  </section>`;
  $('#ob-restore').addEventListener('click', () => $('#restore-file').click());
  $('#ob-paste')?.addEventListener('click', async () => {
    try { $('#ob-words').value = await navigator.clipboard.readText(); } catch { $('#ob-err').textContent = 'Couldn\'t paste. Press and hold in the box, then tap Paste.'; }
  });
  $('#ob-join').addEventListener('click', async () => {
    const text = $('#ob-words').value;
    $('#ob-err').textContent = '';
    try {
      const secret = sync.secretFromLink(text) || (await sync.secretFromWords(text));
      state.joinSecret = secret;
      go('#/join');
    } catch (err) {
      $('#ob-err').textContent = text.trim() ? err.message : 'Type your 12 recovery words, or paste your recovery link.';
    }
  });
  $('#ob').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    if (sync.available()) sync.ensureSecret();
    const p = { id: db.uid(), name, color: COLORS[0], createdAt: Date.now() };
    await db.putPerson(p);
    state.people = await db.allPeople();
    await setPerson(p.id);
    go('#/home');
  });
}

// ---------- joining a shared log (recovery link or words) ----------
async function joinView(code) {
  const secret = (code && sync.secretFromLink(code)) || state.joinSecret;
  if (code) { state.joinSecret = secret; window.history.replaceState(null, '', '#/join'); }
  if (!secret) return go('#/home');
  view.innerHTML = `<section class="card"><h1>Get your readings</h1>
    <p id="join-status" class="status busy">Looking for the readings…</p>
    <div id="join-actions"></div></section>`;
  if (!sync.available()) {
    $('#join-status').className = 'status warn';
    $('#join-status').textContent = 'Online backup isn\'t available in this browser.';
    return;
  }
  let found = null;
  try {
    found = await sync.fetchVault(secret);
  } catch (err) {
    $('#join-status').className = 'status warn';
    $('#join-status').textContent = `${err.message} Check the internet connection and try again.`;
    $('#join-actions').innerHTML = '<button class="btn primary block" id="join-retry">Try again</button>';
    $('#join-retry').addEventListener('click', () => joinView());
    return;
  }
  const same = sync.getSecret() && sync.b64uEncode(sync.getSecret()) === sync.b64uEncode(secret);
  const names = found ? found.vault.people.filter((p) => !p.deletedAt).map((p) => String(p.name)) : [];
  const n = found ? found.vault.readings.filter((r) => !r.deletedAt).length : 0;
  $('#join-status').className = found ? 'status ok' : 'status warn';
  $('#join-status').textContent = same ? 'This phone is already connected to this log.'
    : found ? `Found ${plural(n, 'reading')} for ${names.join(', ') || 'your log'}.`
      : 'No readings are stored with this code yet. If you just made it on another phone, wait a minute and try again.';
  const hasOwn = state.people.length > 0 && !same;
  $('#join-actions').innerHTML = same ? '<a class="btn primary block" href="#/home">OK</a>' : `
    ${hasOwn ? '<p>The readings already on this phone will be kept and added to this log.</p>' : ''}
    <button class="btn primary block xl" id="join-go">${found ? 'Get these readings' : 'Connect anyway'}</button>
    <a class="btn block" href="#/home" style="margin-top:.6rem">Cancel</a>`;
  $('#join-go')?.addEventListener('click', async () => {
    // Copy the link now (needs the tap) so it can be pasted into the Home Screen app.
    const link = sync.linkFor(secret);
    const copied = isIOS() && !standalone() ? navigator.clipboard?.writeText(link).then(() => true, () => false) : Promise.resolve(false);
    const btn = $('#join-go');
    btn.disabled = true;
    btn.textContent = 'Getting your readings…';
    try {
      await sync.join(secret);
      settings.set('recoverySaved', true);
      state.joinSecret = null;
      await reloadAll();
      // The user moved on while it was working: don't pull them back.
      if (currentRoute()[0] !== 'join') { toast('Your readings are here'); route(); return; }
      if (isIOS() && !standalone() && (await copied)) {
        view.innerHTML = `<section class="card"><h1>${icon('check')} Done</h1>
          <p class="lead">Your readings are on this phone.</p></section>
          <section class="card banner"><h2>Now put BP Snap on your Home Screen</h2>${installSteps()}
          <p>The Home Screen app keeps its own copy. When it opens, choose <b>Already use BP Snap?</b> and tap <b>Paste my recovery link</b>. (We copied it for you.)</p>
          <a class="btn block" href="#/home">Keep using it here</a></section>`;
        document.body.classList.remove('bare');
        return;
      }
      toast('Your readings are here');
      go('#/home');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Try again';
      $('#join-status').className = 'status warn';
      $('#join-status').textContent = err.message;
    }
  });
}

// ---------- home ----------
const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'All']];
function rangeFrom(days, rs) {
  if (days) return Date.now() - days * 86400000;
  return rs.length ? Math.min(...rs.map((r) => r.takenAt)) : Date.now() - 7 * 86400000;
}

// How regularly readings were taken in the last 7 days (doctors ask for morning + evening).
function adherence(rs) {
  const am = new Set(), pm = new Set();
  for (const r of S.lastDays(rs, 7)) {
    const day = new Date(r.takenAt).toDateString(), t = S.todOf(r);
    if (t === 'morning') am.add(day);
    if (t === 'evening' || t === 'night') pm.add(day);
  }
  return { am: am.size, pm: pm.size };
}

async function home() {
  const p = person();
  const rs = state.readings;
  const latest = rs[0];
  const s7 = S.summarize(S.lastDays(rs, 7));
  const cat = latest && S.category(latest.sys, latest.dia);
  const adh = adherence(rs);
  view.innerHTML = `${inAppWarning()}
  <section class="card hero">
    ${latest ? `<h2>${esc(possessive(p.name))} last reading</h2>
      <p class="muted">${esc(when(latest.takenAt))}</p>
      <div class="bp-big">${latest.sys}<span class="slash">/</span>${latest.dia}<span class="unit">mmHg</span></div>
      <p class="lead">${latest.pulse ? `Pulse ${latest.pulse} &nbsp;` : ''}${chip(cat)}</p>`
    : `<h2>How it works</h2>
      <ol class="steps">
        <li>Measure ${esc(possessive(p.name))} blood pressure as usual.</li>
        <li>When the numbers stop changing, tap the red button below and take a photo of the monitor's screen.</li>
        <li>Check the numbers, then tap <b>Save</b>.</li>
      </ol>`}
  </section>
  <div class="actions">
    <button class="btn primary xl block" data-act="cam">${icon('camera')} Take a photo of the monitor</button>
    <a class="btn block" href="#/manual">${icon('pencil')} Type the numbers instead</a>
    <button class="btn link" data-act="lib">Use a photo already on this phone</button>
  </div>
  ${recoveryBanner()}${installBanner()}
  ${rs.length ? `<section class="card"><h2>This week</h2>
    ${s7.count ? `<p class="lead">Average <b>${s7.sys}/${s7.dia}</b> ${chip(s7.category)}</p>
      <p>${plural(s7.count, 'reading')} in the last 7 days. Mornings on ${adh.am} of 7 days, evenings on ${adh.pm} of 7.</p>`
    : '<p>No readings in the last 7 days.</p>'}
    <a class="btn block" href="#/history">See all readings</a></section>` : ''}
  ${safetyLine()}
  ${tipsCard()}`;
  $('[data-act=cam]').addEventListener('click', () => $('#cam').click());
  $('[data-act=lib]').addEventListener('click', () => $('#lib').click());
  $('[data-dismiss]')?.addEventListener('click', () => { settings.set('installDismissed', Date.now()); $('#install').remove(); });
}

function tipsCard(open = false) {
  return `<section class="card"><details ${open ? 'open' : ''}><summary>How to measure correctly</summary>
    <ol class="steps">
      <li>No coffee, smoking or exercise for 30 minutes before. Use the bathroom first.</li>
      <li>Sit quietly for 5 minutes with your back supported and feet flat on the floor.</li>
      <li>Rest your arm on a table at heart level, with the cuff on bare skin. Don't talk.</li>
      <li>Take 2 readings, 1 minute apart. Measure at the same times each day, morning and evening.</li>
    </ol>
    <p><b>For a good photo:</b> wait until the numbers stop changing, hold the phone straight over the screen, and fill most of the photo with the screen. Tilt the phone a little if there's a reflection.</p>
  </details></section>`;
}

// ---------- capture ----------
async function startCapture(file) {
  if (!file || !person()) return;
  const now = Date.now();
  let takenAt = now, timeHint = '';
  try {
    const t = exifDate(await file.slice(0, 256 * 1024).arrayBuffer());
    if (t && t < now + 60000 && now - t < 400 * 86400000) { takenAt = t; timeHint = Math.abs(now - t) > 120000 ? 'This is when the photo was taken.' : ''; }
    else if (file.lastModified && now - file.lastModified > 120000 && now - file.lastModified < 400 * 86400000) {
      takenAt = file.lastModified; timeHint = 'This time comes from the photo. Please check it.';
    }
  } catch { /* keep now */ }
  let loaded;
  try {
    loaded = await IMG.loadImage(file);
  } catch (e) {
    toast(e.message || 'Could not open this photo.');
    return;
  }
  if (state.draft?.url) URL.revokeObjectURL(state.draft.url);
  // Work on a copy no bigger than 2400 px: 48 MP photos exceed iOS canvas limits.
  const { naturalWidth: nw, naturalHeight: nh } = loaded.img;
  const img = Math.max(nw, nh) > 2400 ? IMG.toCanvas(loaded.img, 2400) : loaded.img;
  state.draft = { ...loaded, img, src: img, rot: 0, view: null, takenAt, timeHint, ocr: null, token: 0, touched: false };
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
  const num = (id, name, title, sub, val, cls = '') => `<label class="numrow ${cls}" for="${id}">
      <span class="nl"><b>${title}</b><small>${sub}</small></span>
      <input id="${id}" name="${name}" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" value="${val ?? ''}"></label>`;
  return `<form id="rf" novalidate>
    ${opts.beforeNums ?? ''}
    <div class="numrows">
      ${num('f-sys', 'sys', 'Top number', 'SYS', v.sys, 'sys')}
      ${num('f-dia', 'dia', 'Bottom number', 'DIA', v.dia, 'dia')}
      ${num('f-pulse', 'pulse', 'Pulse', 'PUL · if shown', v.pulse)}
    </div>
    <label class="f" for="f-time">Date and time</label>
    <input id="f-time" name="time" type="datetime-local" value="${toLocalInput(v.takenAt ?? Date.now())}" data-orig="${v.takenAt ?? ''}">
    ${opts.timeHint ? `<p class="muted">${esc(opts.timeHint)}</p>` : ''}
    <details class="more" ${v.notes ? 'open' : ''}><summary>More details (optional)</summary>
      <label class="f">Which arm?</label><div class="pills">${pill('arm', 'left', 'Left', arm)}${pill('arm', 'right', 'Right', arm)}</div>
      <label class="f">Position</label><div class="pills">${pill('position', 'sitting', 'Sitting', pos)}${pill('position', 'standing', 'Standing', pos)}${pill('position', 'lying', 'Lying down', pos)}</div>
      <label class="f" for="f-notes">Notes</label>
      <textarea id="f-notes" name="notes" maxlength="500" placeholder="For example: took my pills at 8am">${esc(v.notes ?? '')}</textarea>
    </details>
    <div id="errs" class="errors" role="alert"></div>
    <button class="btn primary block xl">${opts.submit ?? 'Save this reading'}</button>
    <a class="btn block" href="${opts.cancel ?? '#/home'}" style="margin-top:.6rem">Cancel</a>
    ${opts.extra ?? ''}
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

// Run a form's save once at a time (a double tap must not save twice).
async function once(form, fn) {
  const btn = $('button.primary', form);
  if (btn.disabled) return;
  btn.disabled = true;
  try { await fn(); } catch (err) { showErrors(form, [`Could not save: ${err.message || err}`]); } finally { btn.disabled = false; }
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
  if (isNew) go(`#/saved/${encodeURIComponent(r.id)}`);
  else { toast('Changes saved'); go('#/history'); }
}

// ---------- after saving ----------
async function savedView(id) {
  const r = state.readings.find((x) => x.id === id);
  if (!r) return go('#/home');
  const c = S.category(r.sys, r.dia);
  const severe = c?.key === 'severe';
  view.innerHTML = `<section class="card saved center">
    <div class="tick" aria-hidden="true">${icon('check')}</div>
    <h1>Saved</h1>
    <p class="lead">${esc(person().name)} · ${esc(when(r.takenAt))}</p>
    <div class="bp-big">${r.sys}<span class="slash">/</span>${r.dia}<span class="unit">mmHg</span></div>
    ${r.pulse ? `<p class="lead">Pulse ${r.pulse}</p>` : ''}
  </section>
  ${severe ? `<section class="card alert" id="severe" role="alert"><h2>This reading is very high</h2>
    <p><b>${r.sys}/${r.dia}</b> is above 180/120.</p>
    <p>The American Heart Association advises: wait 5 minutes and measure again. If it is still this high, contact your doctor right away.</p>
    <p><b>Call 911</b> if you also have chest pain, shortness of breath, back pain, numbness or weakness, changes in vision, or trouble speaking.</p></section>`
    : `<section class="card cat" style="border-left-color:${c.color}"><p class="lead">${chip(c)}</p><p>${esc(c.plain)}</p>
      <p class="muted">One reading doesn't tell the whole story. Doctors look at the average over several days.</p></section>`}
  <button class="btn primary block xl" id="saved-done">Done</button>
  <button class="btn block" id="saved-again" style="margin-top:.6rem">${icon('camera')} Take a second reading</button>
  <p class="muted center" style="margin-top:.6rem">Doctors suggest 2 readings, 1 minute apart.</p>`;
  $('#saved-done').addEventListener('click', () => go('#/home'));
  $('#saved-again').addEventListener('click', () => $('#cam').click());
}

// ---------- check a photo ----------
async function reviewPhoto() {
  const d = state.draft;
  if (!d) return go('#/home');
  view.innerHTML = `<section class="review">
    <h1>Check the numbers</h1>
    <p class="for">For <b>${esc(person().name)}</b> <button type="button" class="btn link inline" id="for-change">Change</button></p>
    <div class="photo-wrap" id="pw"><canvas class="photo" id="photo"></canvas><div class="overlay" id="ov"></div></div>
    <div class="tools">
      <button type="button" class="btn" id="retake">${icon('camera')} Take again</button>
      <button type="button" class="btn" id="rot">${icon('rotate')} Turn photo</button>
      <button type="button" class="btn" id="sel">${icon('select')} Show where</button>
    </div>
    <p id="ocr-status" class="status busy" role="status">Reading the numbers…</p>
    ${formHTML({ ...(d.values || {}), takenAt: d.values?.takenAt ?? d.takenAt }, { timeHint: d.timeHint })}
  </section>`;
  const form = $('#rf');
  $$('#f-sys, #f-dia, #f-pulse', form).forEach((i) => i.addEventListener('input', () => { d.touched = true; }));
  // Keep what was typed if the view re-renders (e.g. switching person).
  const remember = () => { d.values = readForm(form).values; };
  form.addEventListener('input', remember);
  form.addEventListener('change', remember);
  $('#for-change').addEventListener('click', peopleSheet);
  $('#retake').addEventListener('click', () => $('#cam').click());
  $('#rot').addEventListener('click', () => { d.rot = (d.rot + 1) % 4; d.src = d.rot ? IMG.rotate(d.img, d.rot) : d.img; d.view = null; drawPhoto(); runReader(); });
  setupSelect();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button.primary', form);
    if (btn.disabled) return;
    const { errs, values } = readForm(form);
    showErrors(form, errs);
    if (errs.length) return;
    btn.disabled = true;
    try {
      const keep = settings.get('keepPhotos', true);
      const o = d.ocr && d.ocr.ok ? { sys: d.ocr.sys, dia: d.ocr.dia, pulse: d.ocr.pulse, confidence: +d.ocr.confidence.toFixed(2) } : null;
      const r = {
        id: db.uid(), personId: state.personId, ...values, source: 'photo',
        ocr: o, edited: o ? o.sys !== values.sys || o.dia !== values.dia || (o.pulse ?? null) !== values.pulse : true,
        hasPhoto: keep, createdAt: Date.now(), tzOffset: new Date(values.takenAt).getTimezoneOffset(),
      };
      if (keep) await db.putPhoto(r.id, await IMG.jpeg(IMG.toCanvas(d.src, 800), 0.72));
      const saved = await db.putReading(r);
      URL.revokeObjectURL(d.url);
      state.draft = null;
      await afterSave(saved, true);
    } catch (err) {
      btn.disabled = false;
      showErrors(form, [`Could not save: ${err.message || err}`]);
    }
  });
  drawPhoto();
  if (d.ocr) showResult(d.ocr); else runReader();
}

const srcSize = (src) => ({ w: src.naturalWidth || src.width, h: src.naturalHeight || src.height });

// The part of the photo on screen: the whole photo, or zoomed on the display after a read.
const viewRect = (d) => d.view || { x: 0, y: 0, ...srcSize(d.src) };

function drawPhoto() {
  const d = state.draft;
  const cv = $('#photo');
  if (!cv) return;
  const shown = IMG.toCanvas(d.src, 1200, d.view);
  cv.width = shown.width; cv.height = shown.height;
  cv.getContext('2d').drawImage(shown, 0, 0);
  $('#ov').innerHTML = '';
}

const BOX_LABEL = { SYS: 'Top', DIA: 'Bottom', PULSE: 'Pulse' };
function drawBoxes(boxes, extra = '') {
  const v = viewRect(state.draft);
  $('#ov').innerHTML = boxes.map((b) => `<div class="box" style="left:${((b.x - v.x) / v.w) * 100}%;top:${((b.y - v.y) / v.h) * 100}%;width:${(b.w / v.w) * 100}%;height:${(b.h / v.h) * 100}%"><span>${esc(BOX_LABEL[b.label] || b.label)} ${b.value}</span></div>`).join('') + extra;
}

// Zoom the preview on the numbers that were read, so they are easy to check on a phone.
function zoomTo(boxes) {
  const d = state.draft;
  const { w, h } = srcSize(d.src);
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const m = 0.45 * Math.max(x1 - x0, y1 - y0);
  const r = { x: Math.max(0, x0 - m), y: Math.max(0, y0 - m * 0.6) };
  r.w = Math.min(w, x1 + m) - r.x;
  r.h = Math.min(h, y1 + m * 0.6) - r.y;
  d.view = r.w * r.h < 0.7 * w * h ? r : null;
  drawPhoto();
}

function setStatus(cls, html) {
  const st = $('#ocr-status');
  if (!st) return;
  st.className = 'status ' + cls;
  st.innerHTML = html;
}

async function readCanvas(src, crop, quick = false) {
  const cv = crop ? IMG.toCanvas(src, 900, crop) : IMG.toCanvas(src, 1100);
  const scale = (crop ? crop.w : srcSize(src).w) / cv.width;
  const res = await OCR.read(IMG.pixels(cv), { maxDim: crop ? 820 : 760, quick });
  if (res.ok) {
    const ox = crop ? crop.x : 0, oy = crop ? crop.y : 0;
    res.boxes = res.boxes.map((b) => ({ ...b, x: b.x * scale + ox, y: b.y * scale + oy, w: b.w * scale, h: b.h * scale }));
  }
  return res;
}

async function runReader(crop = null) {
  const d = state.draft;
  const token = ++d.token;
  setStatus('busy', crop ? 'Reading the part you showed…' : 'Reading the numbers…');
  await nextFrame();
  let res;
  try {
    res = await readCanvas(d.src, crop);
    // Sideways photo? Try the other two orientations before giving up.
    if (!res.ok && !crop) {
      for (const q of [1, 3]) {
        const rsrc = IMG.rotate(d.img, (d.rot + q) % 4);
        const r2 = await readCanvas(rsrc, null, true);
        if (token !== d.token) return; // the user turned the photo or showed where meanwhile
        if (r2.ok) { d.rot = (d.rot + q) % 4; d.src = rsrc; drawPhoto(); res = r2; break; }
      }
    }
  } catch (err) {
    res = { ok: false, error: String(err.message || err) };
  }
  if (token !== d.token || state.draft !== d || !$('#rf')) return;
  d.ocr = res;
  showResult(res);
}

function showResult(res) {
  const d = state.draft;
  const form = $('#rf');
  if (res.ok) {
    zoomTo(res.boxes);
    drawBoxes(res.boxes);
    if (!d.touched) {
      form.sys.value = res.sys;
      form.dia.value = res.dia;
      form.pulse.value = res.pulse ?? '';
    }
    const sure = res.confidence >= 0.5;
    setStatus(sure ? 'ok' : 'warn', `${sure ? '<b>Please check:</b> do these numbers match your monitor?' : '<b>We\'re not sure about these numbers.</b> Please compare each one with your monitor.'}
      ${res.pulse == null ? '<br>We couldn\'t read the pulse. Type it in if your monitor shows one.' : ''}
      <br><span class="muted">If a number is wrong, tap it below and type the right one.</span>`);
  } else {
    if (d.view) { d.view = null; drawPhoto(); }
    drawBoxes([]);
    const g = res.guess && res.confidence >= 0.18 ? res.guess : null;
    setStatus('warn', `<b>We couldn't read the numbers in this photo.</b>
      ${g ? `<br>Our best guess is <b>${Number(g.sys)}/${Number(g.dia)}</b>${g.pulse != null ? `, pulse ${Number(g.pulse)}` : ''}. <button type="button" class="btn small" id="use-guess">Use these numbers</button>` : ''}
      <br>You can type the numbers below, take the photo again closer to the screen, or tap <b>Show where</b> and draw a box around the numbers.`);
    $('#use-guess')?.addEventListener('click', () => {
      form.sys.value = g.sys; form.dia.value = g.dia; form.pulse.value = g.pulse ?? '';
      d.touched = true;
      d.values = readForm(form).values;
      form.sys.focus();
    });
  }
}

function setupSelect() {
  const pw = $('#pw'), ov = $('#ov'), btn = $('#sel');
  let on = false, start = null, box = null;
  const setOn = (v) => {
    on = v;
    btn.classList.toggle('primary', on);
    pw.classList.toggle('selecting', on);
    pw.style.touchAction = on ? 'none' : '';
    if (on) {
      // Select on the whole photo.
      if (state.draft.view) { state.draft.view = null; drawPhoto(); }
      setStatus('', '<b>Use your finger to draw a box around the numbers</b> on the monitor\'s screen in the photo.');
      pw.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
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
    if (r.w < w * 0.05 || r.h < h * 0.03) { setStatus('warn', 'That box is too small. Draw it around all the numbers.'); return; }
    setOn(false);
    const m = 0.03;
    const crop = { x: Math.max(0, r.x - r.w * m), y: Math.max(0, r.y - r.h * m), w: Math.min(w, r.w * (1 + 2 * m)), h: Math.min(h, r.h * (1 + 2 * m)) };
    crop.w = Math.min(crop.w, w - crop.x); crop.h = Math.min(crop.h, h - crop.y);
    runReader(crop);
  };
  ov.addEventListener('pointerup', end);
  ov.addEventListener('pointercancel', () => { start = null; });
}

// ---------- typing a reading / changing one ----------
async function manualEntry() {
  view.innerHTML = `<section class="card"><h1>Type the numbers</h1>
    <p class="for">For <b>${esc(person().name)}</b> <button type="button" class="btn link inline" id="for-change">Change</button></p>
    ${formHTML({ takenAt: Date.now() })}</section>`;
  $('#for-change').addEventListener('click', peopleSheet);
  const form = $('#rf');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    once(form, async () => {
      const { errs, values } = readForm(form);
      showErrors(form, errs);
      if (errs.length) return;
      const r = { id: db.uid(), personId: state.personId, ...values, source: 'manual', ocr: null, hasPhoto: false, createdAt: Date.now(), tzOffset: new Date(values.takenAt).getTimezoneOffset() };
      const saved = await db.putReading(r);
      await afterSave(saved, true);
    });
  });
  // Open the keyboard on the first box, unless the user already tapped into a box.
  setTimeout(() => { if (!view.contains(document.activeElement) || document.activeElement === view) $('#f-sys')?.focus(); }, 50);
}

async function editReading(id) {
  const r = state.readings.find((x) => x.id === id);
  if (!r) return go('#/history');
  const c = S.category(r.sys, r.dia);
  view.innerHTML = `<section class="card">
    <h1>${r.sys}/${r.dia} ${chip(c)}</h1>
    <p class="muted">${esc(when(r.takenAt))} · ${r.source === 'photo' ? (r.edited ? 'from a photo, corrected by hand' : 'read from a photo') : 'typed in'}</p>
    <div id="ph"></div>
    ${formHTML(r, { submit: 'Save changes', cancel: '#/history', extra: '<button type="button" class="btn danger block" data-del style="margin-top:1.6rem">Delete this reading</button>' })}
  </section>`;
  if (r.hasPhoto) {
    const b = await db.getPhoto(r.id);
    if (b) {
      const url = URL.createObjectURL(b);
      $('#ph').innerHTML = `<img src="${url}" alt="Photo of the monitor for this reading" class="thumb">`;
    }
  }
  const form = $('#rf');
  $('[data-del]', form).addEventListener('click', async () => {
    if (!confirm(`Delete the reading ${r.sys}/${r.dia} from ${when(r.takenAt)}?`)) return;
    await db.deleteReading(r.id);
    await loadReadings();
    toast('Reading deleted');
    go('#/history');
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    once(form, async () => {
      const { errs, values } = readForm(form);
      showErrors(form, errs);
      if (errs.length) return;
      const nr = { ...r, ...values };
      if (r.ocr) nr.edited = r.ocr.sys !== values.sys || r.ocr.dia !== values.dia || (r.ocr.pulse ?? null) !== values.pulse;
      const saved = await db.putReading(nr);
      await afterSave(saved, false);
    });
  });
}

// ---------- all readings ----------
function itemHTML(r) {
  const c = S.category(r.sys, r.dia);
  return `<li><a class="item" href="#/r/${encodeURIComponent(r.id)}">
    <span class="time">${fmtTime(r.takenAt)}</span>
    <span class="mid"><span class="val">${Number(r.sys)}/${Number(r.dia)}</span>
      <span class="meta">${chip(c)}${r.pulse ? ` <span>pulse ${Number(r.pulse)}</span>` : ''}${r.notes ? ' <span>· note</span>' : ''}</span></span>
    <span class="chev" aria-hidden="true">›</span></a></li>`;
}

async function history() {
  const rs = state.readings;
  if (!rs.length) {
    view.innerHTML = `<section class="card center"><h1>No readings yet</h1><p class="lead">${esc(possessive(person().name))} readings will show up here.</p><a class="btn primary block xl" href="#/home">Add a reading</a></section>`;
    return;
  }
  let html = `<section class="card"><h1>${esc(possessive(person().name))} readings</h1><p class="muted">${plural(rs.length, 'reading')}. Tap one to change or delete it.</p>`;
  let day = null;
  // Newest first; readings minutes apart are one sitting and get an average line.
  const sits = S.sessions(rs).reverse();
  for (const sit of sits) {
    const dl = dayLabel(sit.takenAt);
    if (dl !== day) { html += `${day ? '</ul>' : ''}<h2 class="day">${esc(dl)}</h2><ul class="list">`; day = dl; }
    html += [...sit.readings].reverse().map(itemHTML).join('');
    if (sit.readings.length > 1) html += `<li class="session">Average of these ${sit.readings.length}: <b>${sit.sys}/${sit.dia}</b>${sit.pulse ? `, pulse ${sit.pulse}` : ''}</li>`;
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
  const catRows = S.CATEGORIES.filter((c) => cats[c.key]).map((c) => `<tr><td>${chip(c)}</td><td>${cats[c.key]}</td><td>${Math.round((100 * cats[c.key]) / rs.length)}%</td></tr>`).join('');
  // Only mention the arm when both arms were used in this period.
  const mixedArms = new Set(rs.map((r) => r.arm).filter(Boolean)).size > 1;
  const rows = [...rs].sort((a, b) => a.takenAt - b.takenAt).map((r) => `<tr><td>${esc(fmtDate(r.takenAt))}</td><td>${fmtTime(r.takenAt)}</td><td><b>${Number(r.sys)}/${Number(r.dia)}</b></td><td>${r.pulse != null ? Number(r.pulse) : ''}</td><td>${esc([mixedArms && r.arm && `${r.arm} arm`, r.position && r.position !== 'sitting' ? r.position : '', r.notes].filter(Boolean).join(' · '))}</td></tr>`).join('');
  view.innerHTML = `<section class="card no-print"><h1>Report for the doctor</h1>
    <label for="rr" class="f">Which days?</label>
    <select id="rr">${REPORT_RANGES.map(([d, l]) => `<option value="${d}" ${d === days ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button class="btn primary block" id="print" style="margin-top:1rem">${icon('print')} Print or save as PDF</button>
    ${navigator.share ? `<button class="btn block" id="share" style="margin-top:.6rem">${icon('share')} Send to someone</button>` : ''}
    <button class="btn block" id="csv" style="margin-top:.6rem">${icon('download')} Spreadsheet file (CSV)</button>
  </section>
  <section class="card"><h1 style="font-size:1.3rem">Blood pressure report: ${esc(p.name)}</h1>
    <p class="muted">${rs.length ? `${esc(fmtDate(s.first))} to ${esc(fmtDate(s.last))}` : 'No readings in this period'} · made ${esc(fmtDate(Date.now()))} with BP Snap</p>
    ${rs.length ? `<div class="stats" style="margin-top:.6rem">
      <div class="stat"><div class="v">${s.sys}/${s.dia}</div><div class="l">Average ${chip(s.category)}</div></div>
      <div class="stat"><div class="v">${s.pulse ?? '–'}</div><div class="l">Average pulse</div></div>
      <div class="stat"><div class="v">${s.sysMin}–${s.sysMax}</div><div class="l">Top number range</div></div>
      <div class="stat"><div class="v">${s.diaMin}–${s.diaMax}</div><div class="l">Bottom number range</div></div>
    </div>` : ''}
  </section>
  ${rs.length ? `<section class="card"><h2>Trend</h2>${chartSVG(rs, { from, to: Date.now() })}</section>
  <section class="card"><h2>By time of day</h2><table><thead><tr><th>When</th><th>Average</th><th>Pulse</th><th>Readings</th></tr></thead><tbody>${todRows}</tbody></table>
    <p class="muted">Morning 4am–noon · afternoon noon–5pm · evening 5–10pm · night 10pm–4am</p></section>
  <section class="card"><h2>How often in each range</h2><table><tbody>${catRows}</tbody></table>
    <p class="muted">ACC/AHA categories: normal under 120/80 · elevated 120–129 and under 80 · stage 1 130–139 or 80–89 · stage 2 140 or more, or 90 or more.</p></section>
  <section class="card"><h2>All readings (${rs.length})</h2><table><thead><tr><th>Date</th><th>Time</th><th>BP</th><th>Pulse</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></section>` : ''}
  <p class="muted center">Home readings to discuss with a doctor. BP Snap is not a medical device.</p>`;
  $('#rr').addEventListener('change', (e) => { settings.set('reportRange', +e.target.value); report(); });
  $('#print').addEventListener('click', () => window.print());
  const csvName = `bp-${slug(p.name)}-${today()}.csv`;
  $('#csv').addEventListener('click', () => saveFile(csvName, new Blob([S.toCSV(rs, peopleById())], { type: 'text/csv' }), 'Blood pressure log'));
  $('#share')?.addEventListener('click', async () => {
    const file = new File([S.toCSV(rs, peopleById())], csvName, { type: 'text/csv' });
    const text = s.count ? `${p.name}'s blood pressure, ${rs.length} readings: average ${s.sys}/${s.dia}${s.pulse ? `, pulse ${s.pulse}` : ''}.` : '';
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Blood pressure log', text });
      else await navigator.share({ title: 'Blood pressure log', text });
    } catch (err) { if (err.name !== 'AbortError') toast('Sharing didn\'t work'); }
  });
}

// ---------- keeping readings safe ----------
function safeStatusText() {
  if (!sync.apiBase()) return 'Saved on this phone. Online backup isn\'t turned on yet, so for now save a backup file now and then (below).';
  if (!sync.available()) return 'Saved on this phone. Online backup doesn\'t work in this browser, so save a backup file now and then (below).';
  const s = sync.status();
  if (!sync.getSecret()) return 'Online backup is off.';
  if (s.state === 'ok' && s.at) return `${icon('check')} Saved on this phone and backed up online ${esc(ago(s.at))}.`;
  if (s.state === 'error') return `Saved on this phone. <b>Not backed up online yet:</b> ${esc(s.message || '')} It will try again by itself.`;
  return 'Saved on this phone. Backing up online…';
}

async function safeView() {
  if (sync.available() && !sync.getSecret()) sync.ensureSecret();
  const on = sync.available() && sync.getSecret();
  const link = on ? sync.linkFor() : '';
  view.innerHTML = `<section class="card"><h1>${icon('shield')} Keep your readings safe</h1>
    <p class="status ${sync.status().state === 'error' ? 'warn' : 'ok'}" id="safe-status">${safeStatusText()}</p>
    ${on ? `<p>The online copy is locked with your own <b>recovery code</b>. Nobody can read it without that code, not even us.</p>
      <button class="btn block" id="sync-now">Back up now</button>` : ''}
  </section>
  ${on ? `<section class="card"><h2>1. Send yourself your recovery link</h2>
    <p>Send it to yourself by text message or email, or to a family member. If this phone is ever lost or reset, open the link on any phone to get all the readings back.</p>
    <button class="btn primary block xl" id="share-link">${icon('share')} Send my recovery link</button>
    <button class="btn block" id="copy-link" style="margin-top:.6rem">${icon('link')} Copy the link</button>
    <p class="muted">Anyone with this link can see and add readings. Only give it to family you trust.</p>
  </section>
  <section class="card"><h2>2. Or write down 12 words</h2>
    <p>Keep them somewhere safe, like with your important papers. They work just like the link.</p>
    <div id="words"><button class="btn block" id="show-words">Show my 12 words</button></div>
  </section>
  <section class="card"><h2>Use on another phone</h2>
    <p>Open the recovery link on the other phone, or choose <b>Already use BP Snap?</b> there and type the 12 words. Both phones then show the same readings.</p>
  </section>` : ''}
  <section class="card"><h2>Backup file</h2>
    <p>You can also save all readings in one file, for example in iCloud Drive.</p>
    <label class="check"><input type="checkbox" id="bk-photos"> Include the photos (bigger file)</label>
    <button class="btn block" id="backup">${icon('save')} Save a backup file</button>
    <button class="btn block" id="restore" style="margin-top:.6rem">${icon('upload')} Restore from a backup file</button>
  </section>`;
  bindBackupButtons();
  if (!on) return;
  $('#sync-now').addEventListener('click', async () => { $('#safe-status').innerHTML = 'Backing up…'; await sync.syncNow(); refreshSafetyLine(); });
  const markSaved = () => { settings.set('recoverySaved', true); };
  $('#share-link').addEventListener('click', async () => {
    const who = state.people.map((p) => p.name).join(', ');
    const text = `BP Snap recovery link for ${who}'s blood pressure readings. Keep this message. Open the link to get the readings back on any phone:`;
    if (navigator.share) {
      try { await navigator.share({ title: 'BP Snap recovery link', text, url: link }); markSaved(); toast('Recovery link sent'); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(`${text}\n${link}`); markSaved(); toast('Link copied. Paste it into a message or email to yourself.'); } catch { prompt('Copy this link and keep it safe:', link); markSaved(); }
  });
  $('#copy-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); markSaved(); toast('Link copied. Paste it into a message or email to yourself.'); } catch { prompt('Copy this link and keep it safe:', link); markSaved(); }
  });
  $('#show-words').addEventListener('click', async () => {
    const words = await sync.wordsFor();
    $('#words').innerHTML = `<ol class="words">${words.map((w) => `<li>${esc(w)}</li>`).join('')}</ol>
      <p class="muted">Write them in this order. Upper or lower case doesn't matter.</p>
      <button class="btn block" id="print-words">${icon('print')} Print them</button>
      <button class="btn primary block" id="wrote-words" style="margin-top:.6rem">I wrote them down</button>`;
    $('#print-words').addEventListener('click', () => { document.body.classList.add('print-words'); window.print(); setTimeout(() => document.body.classList.remove('print-words'), 1000); });
    $('#wrote-words').addEventListener('click', () => { markSaved(); toast('Great. Keep them somewhere safe.'); go('#/home'); });
  });
}

function bindBackupButtons() {
  $('#backup')?.addEventListener('click', async () => {
    const data = await db.exportAll({ photos: $('#bk-photos')?.checked });
    const name = `bp-snap-backup-${today()}.json`;
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    // Only count it as backed up once the file was actually saved or sent.
    await deliverFile(name, blob, 'BP Snap backup', () => {
      settings.set('lastBackup', Date.now());
      toast(`Backup file saved: ${plural(data.readings.length, 'reading')}`);
    });
  });
  $('#restore')?.addEventListener('click', () => $('#restore-file').click());
}

// ---------- settings ----------
// iCalendar lines longer than 75 octets must be folded (CRLF + space).
const fold = (line) => {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
};

function ics(times) {
  const url = location.href.split('#')[0];
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = times.map((hm, i) => {
    const [hh, mm] = hm.split(':').map(Number);
    // Start today if that time is still ahead, else tomorrow.
    const t = new Date(now); t.setHours(hh, mm, 0, 0);
    if (t <= now) t.setDate(t.getDate() + 1);
    const ymd = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}`;
    return ['BEGIN:VEVENT', `UID:bp-snap-${stamp}-${i}@bp-snap`, `DTSTAMP:${stamp}`, `DTSTART:${ymd}T${pad(hh)}${pad(mm)}00`, 'DURATION:PT10M', 'RRULE:FREQ=DAILY',
      'SUMMARY:Measure blood pressure', `DESCRIPTION:Sit quietly for 5 minutes first. Then log it: ${url}`, `URL:${url}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Measure blood pressure', 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT'].map(fold).join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BP Snap//EN', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR', ''].join('\r\n');
}

// Safari on iPhone offers "Add to Calendar" when it opens a calendar file; elsewhere download it.
function openCalendarFile(text) {
  const blob = new Blob([text], { type: 'text/calendar' });
  if (!isIOS()) return download('bp-reminders.ics', blob);
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

async function settingsView() {
  const counts = {};
  for (const r of await db.allReadings()) counts[r.personId] = (counts[r.personId] || 0) + 1;
  const keep = settings.get('keepPhotos', true);
  const scale = settings.get('textScale', 1.15);
  view.innerHTML = `<h1 class="page-title">Settings</h1>
  <section class="card"><h2>Text size</h2>
    <div class="sizes">${TEXT_SIZES.map(([v, l]) => `<button class="btn ${Math.abs(v - scale) < 0.01 ? 'primary' : ''}" data-scale="${v}" aria-pressed="${Math.abs(v - scale) < 0.01}" style="font-size:${v}em">${l}</button>`).join('')}</div>
    <p class="muted">BP Snap also follows the text size set on your iPhone.</p></section>

  <a class="card safe-line" href="#/safe" id="settings-safe"><span><b>${icon('shield')} Keep your readings safe</b></span><span>Recovery link, 12 words, backup file</span><span class="more">Open ›</span></a>

  <section class="card"><h2>People</h2>
    <ul class="plain-list">${state.people.map((p) => `<li><button class="btn block person-pick" data-edit="${esc(p.id)}">
      <span class="dot" style="background:${safeColor(p.color)}"></span><span>${esc(p.name)}</span><span class="muted" style="margin-left:auto">${plural(counts[p.id] || 0, 'reading')}</span></button></li>`).join('')}</ul>
    <button class="btn block" id="add-person" style="margin-top:.8rem">+ Add another person</button></section>

  <section class="card"><h2>Daily reminders</h2>
    <p>Adds a daily reminder to your phone's calendar.</p>
    <div class="times"><label>Morning <input type="time" id="rem-am" value="${esc(settings.get('remAm', '07:30'))}"></label>
      <label>Evening <input type="time" id="rem-pm" value="${esc(settings.get('remPm', '19:30'))}"></label></div>
    <button class="btn block" id="rem" style="margin-top:.8rem">${icon('calendar')} Add to my calendar</button></section>

  <section class="card"><h2>Photos</h2>
    <label class="check"><input type="checkbox" id="keep" ${keep ? 'checked' : ''}> Keep a small copy of each photo with its reading</label>
    <p class="muted">Handy for checking a reading later. Photos stay on this phone only.</p></section>

  <section class="card"><h2>Backup file</h2>
    <label class="check"><input type="checkbox" id="bk-photos"> Include the photos (bigger file)</label>
    <button class="btn block" id="backup">${icon('save')} Save a backup file</button>
    <button class="btn block" id="restore" style="margin-top:.6rem">${icon('upload')} Restore from a backup file</button>
    <button class="btn block" id="csv-all" style="margin-top:.6rem">${icon('download')} Spreadsheet of everyone (CSV)</button></section>

  <section class="card"><h2>About</h2>
    <p>BP Snap reads the numbers from your photo on this phone. Readings are saved on this phone and, locked with your recovery code, backed up online.</p>
    <p>It is not a medical device. Always check the numbers against your monitor, and talk to your doctor about your readings.</p>
    <p class="muted">Version ${VERSION} · <a href="${REPO}" rel="noopener">source code</a></p></section>`;
  $$('[data-scale]').forEach((b) => b.addEventListener('click', () => { settings.set('textScale', +b.dataset.scale); applyTextSize(); settingsView(); }));
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => personForm(state.people.find((p) => p.id === b.dataset.edit))));
  $('#add-person').addEventListener('click', () => personForm());
  $('#keep').addEventListener('change', (e) => settings.set('keepPhotos', e.target.checked));
  $('#csv-all').addEventListener('click', async () => {
    const blob = new Blob([S.toCSV(await db.allReadings(), peopleById())], { type: 'text/csv' });
    deliverFile(`bp-all-${today()}.csv`, blob, 'Blood pressure log');
  });
  bindBackupButtons();
  $('#rem').addEventListener('click', () => {
    const am = $('#rem-am').value, pm = $('#rem-pm').value;
    settings.set('remAm', am); settings.set('remPm', pm);
    openCalendarFile(ics([am, pm].filter(Boolean)));
  });
}

$('#restore-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const res = await db.importAll(JSON.parse(await f.text()));
    state.people = await db.allPeople();
    if (!state.people.length) throw new Error('That backup has no people in it.');
    if (sync.available()) sync.ensureSecret();
    if (!person()) await setPerson(state.people[0].id); else await loadReadings();
    renderHeader();
    toast(`Restored ${plural(res.readings, 'reading')} for ${plural(res.people, 'person')}`);
    if (!currentRoute()[0] || currentRoute()[0] === 'join') go('#/home'); else route();
  } catch (err) {
    toast(err.message || 'Could not read that file');
  }
});

$('#person-btn').addEventListener('click', peopleSheet);

// ---------- boot ----------
async function boot() {
  applyTextSize();
  try {
    // Put back anything the second copy has that the main storage lost.
    const back = await db.recoverFromMirror();
    await reloadAll();
    if (back && state.people.length) toast('Your readings were restored from this phone\u2019s spare copy.');
  } catch (err) {
    view.innerHTML = `<section class="card alert"><h2>BP Snap can't save here</h2><p>This browser isn't letting BP Snap store readings. Private Browsing can do this: open the page in a normal Safari window.</p><p class="muted">${esc(err.message || err)}</p></section>`;
    return;
  }
  // Ask the browser not to clear our data when space runs low.
  navigator.storage?.persist?.().catch(() => {});
  if (sync.available()) {
    if (state.people.length) sync.ensureSecret();
    sync.onStatus(async (s) => {
      refreshSafetyLine();
      if (s.state === 'ok' && s.changed > 0) {
        // Readings came in from another phone.
        await reloadAll();
        const name = currentRoute()[0] || 'home';
        if (['home', 'history', 'report', 'settings', ''].includes(name)) route();
      }
    });
    sync.start();
  }
  db.writeMirror();
  route();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
boot();
