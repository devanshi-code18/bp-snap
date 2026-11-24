// Tiny IndexedDB wrapper: people, readings, photos (Blob per reading id).
const DB_NAME = 'bp-snap';
const VERSION = 1;
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
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
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

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function allPeople() {
  const list = await done((await store('people')).getAll());
  return list.sort((a, b) => a.createdAt - b.createdAt);
}
export async function putPerson(p) { await done((await store('people', 'readwrite')).put(p)); return p; }

export async function readingsFor(personId) {
  const list = await done((await store('readings')).index('person').getAll(personId));
  return list.sort((a, b) => b.takenAt - a.takenAt || (b.createdAt || 0) - (a.createdAt || 0));
}
export async function allReadings() { return done((await store('readings')).getAll()); }
export async function putReading(r) { await done((await store('readings', 'readwrite')).put(r)); return r; }
export async function deleteReading(id) {
  await inTx(['readings', 'photos'], (s) => { s.readings.delete(id); s.photos.delete(id); });
}
export async function deletePerson(id) {
  const rs = await readingsFor(id);
  await inTx(['people', 'readings', 'photos'], (s) => {
    s.people.delete(id);
    for (const r of rs) { s.readings.delete(r.id); s.photos.delete(r.id); }
  });
}

export async function putPhoto(id, blob) { await done((await store('photos', 'readwrite')).put(blob, id)); }
export async function getPhoto(id) { return done((await store('photos')).get(id)); }

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

// Backups travel by email and chat: keep only well-formed fields, never trust markup.
export function cleanBackup(data) {
  if (!data || data.app !== 'bp-snap' || !Array.isArray(data.people) || !Array.isArray(data.readings)) {
    throw new Error('This file is not a BP Snap backup.');
  }
  const people = data.people.filter((p) => p && ID.test(p.id)).map((p) => ({
    id: p.id, name: str(p.name, 40).trim() || 'Person', createdAt: num(p.createdAt, 0, 9e15) ?? Date.now(),
    color: /^#[0-9a-f]{6}$/i.test(String(p.color)) ? p.color : '#6d6966',
  }));
  const ids = new Set(people.map((p) => p.id));
  const readings = [];
  for (const r of data.readings) {
    if (!r || !ID.test(r.id) || !ids.has(r.personId)) continue;
    const sys = num(r.sys, 30, 350), dia = num(r.dia, 20, 250), takenAt = num(r.takenAt, 0, 9e15);
    if (sys == null || dia == null || takenAt == null) continue;
    const o = r.ocr && typeof r.ocr === 'object' ? { sys: num(r.ocr.sys, 0, 999), dia: num(r.ocr.dia, 0, 999), pulse: num(r.ocr.pulse, 0, 999), confidence: Number(r.ocr.confidence) || 0 } : null;
    readings.push({
      id: r.id, personId: r.personId, sys, dia, pulse: num(r.pulse, 10, 300), takenAt,
      tzOffset: num(r.tzOffset, -900, 900), arm: oneOf(r.arm, ['left', 'right']), position: oneOf(r.position, ['sitting', 'standing', 'lying']),
      notes: str(r.notes, 500), source: oneOf(r.source, ['photo', 'manual']) || 'manual', ocr: o, edited: !!r.edited,
      hasPhoto: !!r.hasPhoto, createdAt: num(r.createdAt, 0, 9e15) ?? takenAt, updatedAt: num(r.updatedAt, 0, 9e15) ?? takenAt,
    });
  }
  const photos = {};
  const keep = new Set(readings.map((r) => r.id));
  for (const [id, url] of Object.entries(data.photos || {})) {
    if (keep.has(id) && typeof url === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(url)) photos[id] = url;
  }
  for (const r of readings) if (r.hasPhoto && !photos[r.id]) r.hasPhoto = false;
  return { people, readings, photos, skipped: data.readings.length - readings.length };
}

// Merge a backup into this device: same ids are overwritten, nothing is deleted.
export async function importAll(raw) {
  const data = cleanBackup(raw);
  // Keep existing photos for readings that are already on this phone.
  for (const r of data.readings) if (!r.hasPhoto && !data.photos[r.id] && (await getPhoto(r.id))) r.hasPhoto = true;
  const blobs = {};
  for (const [id, url] of Object.entries(data.photos)) blobs[id] = await (await fetch(url)).blob();
  await inTx(['people', 'readings', 'photos'], (s) => {
    for (const p of data.people) s.people.put(p);
    for (const r of data.readings) s.readings.put(r);
    for (const [id, b] of Object.entries(blobs)) s.photos.put(b, id);
  });
  return { people: data.people.length, readings: data.readings.length, skipped: data.skipped };
}
