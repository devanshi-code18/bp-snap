// IndexedDB: people, readings, photos (Blob per reading id).
//
// Keeping the log safe:
// - Deletes are soft (deletedAt) so they can travel to the backup and other phones.
// - Every change also refreshes a compact second copy in localStorage ("mirror"); at start
//   the app merges it back in, so a damaged IndexedDB doesn't lose readings.
// - Listeners (the cloud backup) hear about every change the user makes.
import { wins } from './merge.js';

const DB_NAME = 'bp-snap';
const VERSION = 1;
const MIRROR_KEY = 'bp.mirror';
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('people')) db.createObjectStore('people', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('readings')) {
          db.createObjectStore('readings', { keyPath: 'id' }).createIndex('person', 'personId');
        }
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another tab upgraded or deleted the database: reopen next time.
        db.onversionchange = () => { db.close(); dbp = null; };
        resolve(db);
      };
      req.onerror = () => { dbp = null; reject(req.error); };
      req.onblocked = () => { /* another tab holds an old version; wait for it */ };
    });
  }
  return dbp;
}

const done = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

async function inTx(names, fn) {
  const db = await open();
  const tx = db.transaction(names, 'readwrite');
  const stores = Object.fromEntries(names.map((n) => [n, tx.objectStore(n)]));
  const doneP = new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Nothing was changed.')); });
  try { fn(stores); } catch (err) { try { tx.abort(); } catch { /* already finished */ } doneP.catch(() => {}); throw err; }
  return doneP;
}

// ---------- change notifications + the localStorage mirror ----------
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
let mirrorTimer = null;
function changed(silent = false) {
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(writeMirror, 300);
  if (!silent) for (const fn of listeners) { try { fn(); } catch { /* keep going */ } }
}

export async function writeMirror() {
  try {
    const data = { v: 1, at: Date.now(), people: await allPeople({ withDeleted: true }), readings: await allReadings({ withDeleted: true }) };
    localStorage.setItem(MIRROR_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false; // full or blocked: the IndexedDB copy is still there
  }
}

export function readMirror() {
  try { return JSON.parse(localStorage.getItem(MIRROR_KEY) || 'null'); } catch { return null; }
}

// Put back anything the mirror has that IndexedDB lost. Returns how many records came back.
export async function recoverFromMirror() {
  const m = readMirror();
  if (!m || !Array.isArray(m.people)) return 0;
  return (await mergeIn(m, { silent: true })).applied;
}

// ---------- records ----------
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const alive = (x) => x && !x.deletedAt;

export async function allPeople({ withDeleted = false } = {}) {
  const list = await done((await store('people')).getAll());
  return list.filter((p) => withDeleted || alive(p)).sort((a, b) => a.createdAt - b.createdAt);
}

export async function putPerson(p) {
  const rec = { ...p, updatedAt: Date.now() };
  await done((await store('people', 'readwrite')).put(rec));
  changed();
  return rec;
}

const newestFirst = (a, b) => b.takenAt - a.takenAt || (b.createdAt || 0) - (a.createdAt || 0);

export async function readingsFor(personId) {
  const list = await done((await store('readings')).index('person').getAll(personId));
  return list.filter(alive).sort(newestFirst);
}

export async function allReadings({ withDeleted = false } = {}) {
  const list = await done((await store('readings')).getAll());
  return withDeleted ? list : list.filter(alive);
}

export async function putReading(r) {
  const rec = { ...r, updatedAt: Date.now() };
  await done((await store('readings', 'readwrite')).put(rec));
  changed();
  return rec;
}

export async function deleteReading(id) {
  const r = await done((await store('readings')).get(id));
  if (!r) return;
  const now = Date.now();
  await inTx(['readings', 'photos'], (s) => { s.readings.put({ ...r, deletedAt: now, updatedAt: now }); s.photos.delete(id); });
  changed();
}

export async function deletePerson(id) {
  const p = await done((await store('people')).get(id));
  if (!p) return;
  const rs = await readingsFor(id);
  const now = Date.now();
  await inTx(['people', 'readings', 'photos'], (s) => {
    s.people.put({ ...p, deletedAt: now, updatedAt: now });
    for (const r of rs) { s.readings.put({ ...r, deletedAt: now, updatedAt: now }); s.photos.delete(r.id); }
  });
  changed();
}

export async function putPhoto(id, blob) { await done((await store('photos', 'readwrite')).put(blob, id)); }
export async function getPhoto(id) { return done((await store('photos')).get(id)); }

// Merge records from elsewhere (backup, another phone, the mirror): newer copies win.
// silent: don't tell the cloud backup (used when the data came from it).
export async function mergeIn(data, { silent = false } = {}) {
  const { people, readings } = cleanRecords(data.people || [], data.readings || []);
  const curP = new Map((await allPeople({ withDeleted: true })).map((p) => [p.id, p]));
  const curR = new Map((await allReadings({ withDeleted: true })).map((r) => [r.id, r]));
  const putP = people.filter((p) => wins(p, curP.get(p.id)));
  const putR = readings.filter((r) => wins(r, curR.get(r.id)));
  if (putP.length || putR.length) {
    await inTx(['people', 'readings', 'photos'], (s) => {
      for (const p of putP) s.people.put(p);
      for (const r of putR) { s.readings.put(r); if (r.deletedAt) s.photos.delete(r.id); }
    });
    changed(silent);
  }
  return { applied: putP.length + putR.length, people: putP.length, readings: putR.length };
}

// Everything, including deletions, without photos: what goes into the cloud backup.
export async function snapshot() {
  return { people: await allPeople({ withDeleted: true }), readings: await allReadings({ withDeleted: true }) };
}

// ---------- backup files ----------
const blobToDataUrl = (b) => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => rej(f.error); f.readAsDataURL(b); });

export async function exportAll({ photos = false } = {}) {
  const people = await allPeople();
  const readings = await allReadings();
  const out = { app: 'bp-snap', version: 1, exportedAt: new Date().toISOString(), people, readings };
  if (photos) {
    out.photos = {};
    for (const r of readings) {
      const b = r.hasPhoto ? await getPhoto(r.id) : null;
      if (b) out.photos[r.id] = await blobToDataUrl(b);
    }
  }
  return out;
}

const ID = /^[a-z0-9_-]{1,64}$/i;
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null; };
const str = (v, max) => (v == null ? '' : String(v).slice(0, max));
const oneOf = (v, list) => (list.includes(v) ? v : '');

// Data from outside this phone (backup files travel by email and chat; the cloud copy comes
// from other phones): keep only well-formed fields, never trust markup.
export function cleanRecords(rawPeople, rawReadings) {
  const people = rawPeople.filter((p) => p && ID.test(p.id)).map((p) => {
    const createdAt = num(p.createdAt, 0, 9e15) ?? Date.now();
    const out = {
      id: p.id, name: str(p.name, 40).trim() || 'Person', createdAt, updatedAt: num(p.updatedAt, 0, 9e15) ?? createdAt,
      color: /^#[0-9a-f]{6}$/i.test(String(p.color)) ? p.color : '#6d6966',
    };
    const del = num(p.deletedAt, 0, 9e15);
    if (del) out.deletedAt = del;
    return out;
  });
  const readings = [];
  for (const r of rawReadings) {
    if (!r || !ID.test(r.id) || !ID.test(String(r.personId))) continue;
    const sys = num(r.sys, 30, 350), dia = num(r.dia, 20, 250), takenAt = num(r.takenAt, 0, 9e15);
    if (sys == null || dia == null || takenAt == null) continue;
    const o = r.ocr && typeof r.ocr === 'object' ? { sys: num(r.ocr.sys, 0, 999), dia: num(r.ocr.dia, 0, 999), pulse: num(r.ocr.pulse, 0, 999), confidence: Number(r.ocr.confidence) || 0 } : null;
    const out = {
      id: r.id, personId: r.personId, sys, dia, pulse: num(r.pulse, 10, 300), takenAt,
      tzOffset: num(r.tzOffset, -900, 900), arm: oneOf(r.arm, ['left', 'right']), position: oneOf(r.position, ['sitting', 'standing', 'lying']),
      notes: str(r.notes, 500), source: oneOf(r.source, ['photo', 'manual']) || 'manual', ocr: o, edited: !!r.edited,
      hasPhoto: !!r.hasPhoto, createdAt: num(r.createdAt, 0, 9e15) ?? takenAt, updatedAt: num(r.updatedAt, 0, 9e15) ?? takenAt,
    };
    const del = num(r.deletedAt, 0, 9e15);
    if (del) out.deletedAt = del;
    readings.push(out);
  }
  return { people, readings };
}

export function cleanBackup(data) {
  if (!data || data.app !== 'bp-snap' || !Array.isArray(data.people) || !Array.isArray(data.readings)) {
    throw new Error('This file is not a BP Snap backup.');
  }
  const { people, readings: all } = cleanRecords(data.people, data.readings);
  const ids = new Set(people.map((p) => p.id));
  const readings = all.filter((r) => ids.has(r.personId));
  const photos = {};
  const keep = new Set(readings.map((r) => r.id));
  for (const [id, url] of Object.entries(data.photos || {})) {
    if (keep.has(id) && typeof url === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(url)) photos[id] = url;
  }
  for (const r of readings) if (r.hasPhoto && !photos[r.id]) r.hasPhoto = false;
  return { people, readings, photos, skipped: data.readings.length - readings.length };
}

// Merge a backup file into this phone: newer copies win, nothing is removed.
export async function importAll(raw) {
  const data = cleanBackup(raw);
  // Keep existing photos for readings that are already on this phone.
  for (const r of data.readings) if (!r.hasPhoto && !data.photos[r.id] && (await getPhoto(r.id))) r.hasPhoto = true;
  const blobs = {};
  for (const [id, url] of Object.entries(data.photos)) blobs[id] = await (await fetch(url)).blob();
  const res = await mergeIn(data);
  if (Object.keys(blobs).length) await inTx(['photos'], (s) => { for (const [id, b] of Object.entries(blobs)) s.photos.put(b, id); });
  return { people: data.people.length, readings: data.readings.length, skipped: data.skipped, applied: res.applied };
}
