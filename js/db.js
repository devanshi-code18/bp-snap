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
  fn(stores);
  return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
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

// Merge a backup into this device: same ids are overwritten, nothing is deleted.
export async function importAll(data) {
  if (!data || data.app !== 'bp-snap' || !Array.isArray(data.people) || !Array.isArray(data.readings)) {
    throw new Error('This file is not a BP Snap backup.');
  }
  const photos = data.photos || {};
  const blobs = {};
  for (const [id, url] of Object.entries(photos)) blobs[id] = await (await fetch(url)).blob();
  await inTx(['people', 'readings', 'photos'], (s) => {
    for (const p of data.people) s.people.put(p);
    for (const r of data.readings) s.readings.put(r);
    for (const [id, b] of Object.entries(blobs)) s.photos.put(b, id);
  });
  return { people: data.people.length, readings: data.readings.length };
}
