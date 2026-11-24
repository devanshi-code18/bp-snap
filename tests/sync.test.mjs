import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeVaults, fingerprint, wins } from '../js/merge.js';
import * as sync from '../js/sync.js';
import { handle, memoryStore } from '../server/vault-core.mjs';

test('merge: newer copy wins, deletions travel, nothing is lost', () => {
  const a = { people: [{ id: 'p1', name: 'Mom', updatedAt: 5 }], readings: [{ id: 'r1', sys: 120, updatedAt: 10 }, { id: 'r2', sys: 130, updatedAt: 10 }] };
  const b = { people: [{ id: 'p1', name: 'Mother', updatedAt: 7 }], readings: [{ id: 'r2', sys: 130, updatedAt: 20, deletedAt: 20 }, { id: 'r3', sys: 140, updatedAt: 15 }] };
  const m = mergeVaults(a, b);
  assert.equal(m.people[0].name, 'Mother');
  assert.deepEqual(m.readings.map((r) => r.id).sort(), ['r1', 'r2', 'r3']);
  assert.ok(m.readings.find((r) => r.id === 'r2').deletedAt);
  assert.equal(fingerprint(mergeVaults(a, b)), fingerprint(mergeVaults(b, a)));
  assert.equal(wins({ updatedAt: 1, deletedAt: 1 }, { updatedAt: 1 }), true);
  assert.equal(wins({ updatedAt: 1 }, { updatedAt: 1, deletedAt: 1 }), false);
});

test('recovery words round-trip and catch typos', async () => {
  for (let i = 0; i < 20; i++) {
    const secret = crypto.getRandomValues(new Uint8Array(16));
    const words = await sync.wordsFor(secret);
    assert.equal(words.length, 12);
    assert.deepEqual(await sync.secretFromWords(words.join(' ')), secret);
    // Upper case, extra spaces, commas, and only the first 4 letters still work.
    assert.deepEqual(await sync.secretFromWords(` ${words.map((w) => w.slice(0, 4).toUpperCase()).join(',  ')} `), secret);
  }
  const secret = new Uint8Array(16).fill(7);
  const words = await sync.wordsFor(secret);
  const swapped = [...words]; [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  if (swapped[0] !== swapped[1]) await assert.rejects(sync.secretFromWords(swapped.join(' ')), /right order|fit together/);
  await assert.rejects(sync.secretFromWords('only three words'), /all 12 words/);
  await assert.rejects(sync.secretFromWords(`${words.slice(0, 11).join(' ')} xyzzy`), /not a recovery word/);
});

test('recovery link round-trip', () => {
  globalThis.location = { href: 'https://devanshi-code18.github.io/bp-snap/#/home' };
  const secret = crypto.getRandomValues(new Uint8Array(16));
  const link = sync.linkFor(secret);
  assert.match(link, /^https:\/\/devanshi-code18\.github\.io\/bp-snap\/#\/join\/[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(sync.secretFromLink(link), secret);
  assert.deepEqual(sync.secretFromLink(`Keep this message:\n${link}`), secret);
  assert.equal(sync.secretFromLink('hello'), null);
});

test('encryption: only the right secret opens the backup; ciphertext looks random', async () => {
  const s1 = crypto.getRandomValues(new Uint8Array(16)), s2 = crypto.getRandomValues(new Uint8Array(16));
  const data = { people: [{ id: 'p1', name: 'Mom' }], readings: [{ id: 'r1', sys: 128, dia: 82 }] };
  const sealed = await sync.seal(s1, data);
  assert.match(sealed, /^[A-Za-z0-9_-]+$/);
  assert.ok(!sealed.includes('Mom'));
  assert.deepEqual(await sync.open(s1, sealed), data);
  await assert.rejects(sync.open(s2, sealed), /could not be unlocked/);
  assert.notEqual(await sync.vaultId(s1), await sync.vaultId(s2));
  assert.match(await sync.vaultId(s1), /^[a-f0-9]{32}$/);
});

const req = (method, path, body, origin = 'https://devanshi-code18.github.io') => new Request(`https://x.test/api${path}`, {
  method, headers: { origin, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});

test('server: create, read, conflicting writes, validation, CORS', async () => {
  const store = memoryStore();
  const id = 'a'.repeat(32);
  let r = await handle(req('GET', `/v/${id}`), store);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { rev: 0, data: null });
  r = await handle(req('PUT', `/v/${id}`, { rev: 0, data: 'abc' }), store);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).rev, 1);
  r = await handle(req('PUT', `/v/${id}`, { rev: 0, data: 'zzz' }), store);
  assert.equal(r.status, 409, 'a second phone writing over a newer copy is refused');
  const cur = await r.json();
  assert.equal(cur.rev, 1);
  assert.equal(cur.data, 'abc');
  r = await handle(req('PUT', `/v/${id}`, { rev: 1, data: 'def' }), store);
  assert.equal(r.status, 200);
  r = await handle(req('GET', `/v/${id}`), store);
  assert.deepEqual((({ rev, data }) => ({ rev, data }))(await r.json()), { rev: 2, data: 'def' });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://devanshi-code18.github.io');
  assert.equal(store.snapshots.length, 2);
  assert.equal((await handle(req('GET', '/v/../../etc'), store)).status, 400);
  assert.equal((await handle(req('PUT', `/v/${id}`, { rev: 2, data: '<script>' }), store)).status, 400);
  assert.equal((await handle(req('PUT', `/v/${id}`, { rev: 'x', data: 'a' }), store)).status, 400);
  assert.equal((await handle(req('OPTIONS', `/v/${id}`), store)).status, 204);
  r = await handle(req('GET', `/v/${id}`, null, 'https://evil.example'), store);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://devanshi-code18.github.io');
  r = await handle(req('GET', `/v/${id}`, null, 'http://127.0.0.1:8790'), store);
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://127.0.0.1:8790');
});
