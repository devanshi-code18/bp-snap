// Encrypted cloud backup and family sharing.
//
// Each log has a secret: 16 random bytes kept on the phone. From it we derive
//   - the vault id the server files the backup under, and
//   - an AES-GCM key that encrypts the backup on the phone before upload.
// The server never sees the secret or the key, only encrypted text.
//
// People keep the secret as a recovery link (".../#/join/<secret>"), sent to themselves or a
// family member by text or email, or as 12 recovery words written on paper. Opening the link
// (or typing the words) on any phone brings the whole log back and keeps both phones in sync.
import * as db from './db.js';
import { mergeVaults, fingerprint } from './merge.js';
import { SYNC_API } from './config.js';

const KEY_SECRET = 'bp.sync.secret';
const KEY_STATUS = 'bp.sync.status';
const te = new TextEncoder();
const td = new TextDecoder();

// ---------- encodings ----------
export function b64uEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uDecode(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const concat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// ---------- the secret ----------
export const apiBase = () => { try { return localStorage.getItem('bp.syncApi') || SYNC_API; } catch { return SYNC_API; } };
export const available = () => !!apiBase() && !!globalThis.crypto?.subtle;

export function getSecret() {
  try {
    const s = localStorage.getItem(KEY_SECRET);
    const b = s ? b64uDecode(s) : null;
    return b && b.length === 16 ? b : null;
  } catch { return null; }
}
export function setSecret(bytes) { localStorage.setItem(KEY_SECRET, b64uEncode(bytes)); keyCache = null; }
export function ensureSecret() {
  let s = getSecret();
  if (!s) { s = crypto.getRandomValues(new Uint8Array(16)); setSecret(s); }
  return s;
}

export function linkFor(secret = getSecret()) {
  const base = location.href.split('#')[0].split('?')[0];
  return `${base}#/join/${b64uEncode(secret)}`;
}

// Accepts a recovery link, or just the code at its end.
export function secretFromLink(text) {
  const m = /(?:#\/join\/|^)([A-Za-z0-9_-]{22})\s*$/.exec(String(text).trim());
  if (!m) return null;
  try { const b = b64uDecode(m[1]); return b.length === 16 ? b : null; } catch { return null; }
}

// 12 recovery words (BIP-39: 128 bits + a 4-bit check, so typos are caught).
export async function wordsFor(secret = getSecret()) {
  const { WORDS } = await import('./words.js');
  const check = (await sha256(secret))[0] >> 4;
  let bits = '';
  for (const b of secret) bits += b.toString(2).padStart(8, '0');
  bits += check.toString(2).padStart(4, '0');
  const out = [];
  for (let i = 0; i < 12; i++) out.push(WORDS[parseInt(bits.slice(i * 11, i * 11 + 11), 2)]);
  return out;
}

export async function secretFromWords(text) {
  const { WORDS } = await import('./words.js');
  const parts = String(text).toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').filter(Boolean);
  if (parts.length !== 12) throw new Error(`Please enter all 12 words (you entered ${parts.length}).`);
  const idx = parts.map((w, i) => {
    let k = WORDS.indexOf(w);
    // Every word is unique by its first 4 letters, so "abso" or "absolutly" still work.
    if (k < 0 && w.length >= 4) k = WORDS.findIndex((x) => x.startsWith(w.slice(0, 4)));
    if (k < 0) throw new Error(`Word ${i + 1}, "${w}", is not a recovery word. Check the spelling.`);
    return k;
  });
  const bits = idx.map((k) => k.toString(2).padStart(11, '0')).join('');
  const secret = new Uint8Array(16);
  for (let i = 0; i < 16; i++) secret[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  if (((await sha256(secret))[0] >> 4) !== parseInt(bits.slice(128), 2)) {
    throw new Error('Those words don\'t fit together. Check each word and that they are in the right order.');
  }
  return secret;
}

// ---------- encryption ----------
let keyCache = null;
async function keysFor(secret) {
  const tag = b64uEncode(secret);
  if (keyCache && keyCache.tag === tag) return keyCache;
  const id = hex(await sha256(concat(te.encode('bp-snap:vault-id:v1:'), secret))).slice(0, 32);
  const raw = await sha256(concat(te.encode('bp-snap:aes-key:v1:'), secret));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  keyCache = { tag, id, key };
  return keyCache;
}
export async function vaultId(secret) { return (await keysFor(secret)).id; }

export async function seal(secret, obj) {
  const { key } = await keysFor(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj))));
  return b64uEncode(concat(iv, ct));
}
export async function open(secret, data) {
  const { key } = await keysFor(secret);
  const bytes = b64uDecode(data);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    return JSON.parse(td.decode(pt));
  } catch {
    throw new Error('This backup could not be unlocked with this recovery code.');
  }
}

// ---------- server ----------
async function api(method, id, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${apiBase()}/v/${id}`, {
      method, cache: 'no-store', signal: ctrl.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } catch (err) {
    const e = new Error(navigator.onLine === false ? 'No internet connection.' : 'Couldn\'t reach the backup server.');
    e.offline = true;
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Read and unlock the backup for a secret (null if there is none yet).
export async function fetchVault(secret) {
  const { id } = await keysFor(secret);
  const { status, json } = await api('GET', id);
  if (status !== 200) throw new Error(`The backup server answered ${status}.`);
  if (!json.data) return null;
  return { rev: json.rev, vault: await open(secret, json.data) };
}

// ---------- status ----------
const statusListeners = new Set();
export const onStatus = (fn) => statusListeners.add(fn);
export function status() {
  try { return JSON.parse(localStorage.getItem(KEY_STATUS) || 'null') || { state: 'never' }; } catch { return { state: 'never' }; }
}
function setStatus(s) {
  const next = { ...status(), ...s };
  try { localStorage.setItem(KEY_STATUS, JSON.stringify(next)); } catch { /* ignore */ }
  for (const fn of statusListeners) { try { fn(next); } catch { /* ignore */ } }
}

// ---------- syncing ----------
let running = null, again = false, timer = null;

// Bring this phone and the backup together: download, merge both ways, upload the result.
export async function syncNow() {
  if (!available() || !getSecret()) return status();
  if (running) { again = true; return running; }
  running = (async () => {
    const secret = getSecret();
    try {
      setStatus({ state: 'working', changed: 0 });
      let changedHere = 0;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { id } = await keysFor(secret);
        const remote = await api('GET', id);
        if (remote.status !== 200) throw new Error(`The backup server answered ${remote.status}.`);
        const has = !!remote.json.data;
        const rev = has ? remote.json.rev : 0;
        const theirs = has ? await open(secret, remote.json.data) : { people: [], readings: [] };
        // New records from other phones come in first.
        changedHere += (await db.mergeIn(theirs, { silent: true })).applied;
        const mine = await db.snapshot();
        const merged = mergeVaults(theirs, mine);
        if (has && fingerprint(merged) === fingerprint(theirs)) {
          setStatus({ state: 'ok', at: Date.now(), rev, message: '', changed: changedHere });
          return { state: 'ok', changedHere };
        }
        const put = await api('PUT', id, { rev, data: await seal(secret, { v: 1, ...merged, savedAt: Date.now() }) });
        if (put.status === 200) {
          setStatus({ state: 'ok', at: Date.now(), rev: put.json.rev, message: '', changed: changedHere });
          return { state: 'ok', changedHere };
        }
        if (put.status !== 409) throw new Error(`The backup server answered ${put.status}.`);
        // Another phone saved in between: go round again with its version.
      }
      throw new Error('Another phone keeps saving at the same time. Will try again shortly.');
    } catch (err) {
      setStatus({ state: 'error', errorAt: Date.now(), message: err.message || String(err), offline: !!err.offline, changed: 0 });
      return { state: 'error', message: err.message };
    } finally {
      running = null;
      if (again) { again = false; schedule(500); }
    }
  })();
  return running;
}

export function schedule(ms = 1500) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow(); }, ms);
}

// Join an existing log on this phone (from a recovery link or words). What was already on
// this phone is kept and added to the shared log.
export async function join(secret) {
  const remote = await fetchVault(secret);
  if (remote) await db.mergeIn(remote.vault, { silent: true });
  setSecret(secret);
  const res = await syncNow();
  return { found: !!remote, ...res };
}

let started = false;
export function start() {
  if (started || !available()) return;
  started = true;
  db.onChange(() => schedule());
  let lastPull = 0;
  const pull = () => { if (getSecret() && Date.now() - lastPull > 20000) { lastPull = Date.now(); syncNow(); } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
  window.addEventListener('online', () => schedule(200));
  // Family phones see each other's new readings while the app is open.
  setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 120000);
  if (getSecret()) schedule(300);
}
