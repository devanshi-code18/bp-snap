import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanBackup } from '../js/db.js';

test('backup cleaning drops markup and malformed records', () => {
  const evil = {
    app: 'bp-snap', version: 1,
    people: [{ id: 'p1', name: '<img src=x onerror=alert(1)>', color: 'red"><img src=x onerror=alert(1)>' }, { id: 'bad id"><', name: 'x' }],
    readings: [
      { id: 'r1', personId: 'p1', sys: '120', dia: 80, pulse: 70, takenAt: 1795510942000, notes: 'ok', arm: 'left', position: 'sitting', source: 'photo' },
      { id: 'r2', personId: 'p1', sys: '<b>', dia: 80, takenAt: 1 },
      { id: 'r3"><', personId: 'p1', sys: 120, dia: 80, takenAt: 1 },
      { id: 'r4', personId: 'nobody', sys: 120, dia: 80, takenAt: 1 },
      { id: 'r5', personId: 'p1', sys: 130, dia: 85, takenAt: 2, arm: '<x>', hasPhoto: true },
    ],
    photos: { r1: 'javascript:alert(1)', r5: 'data:image/jpeg;base64,AAAA' },
  };
  const c = cleanBackup(evil);
  assert.deepEqual(c.people.map((p) => p.id), ['p1']);
  assert.equal(c.people[0].color, '#6d6966');
  assert.equal(c.people[0].name, '<img src=x onerror=alert(1)>'); // kept as text; the app escapes it
  assert.deepEqual(c.readings.map((r) => r.id), ['r1', 'r5']);
  assert.equal(c.readings[0].sys, 120);
  assert.equal(c.readings[1].arm, '');
  assert.equal(c.readings[1].hasPhoto, true);
  assert.deepEqual(Object.keys(c.photos), ['r5']);
  assert.equal(c.skipped, 3);
});

test('not a backup', () => {
  assert.throws(() => cleanBackup({ hello: 1 }), /not a BP Snap backup/);
  assert.throws(() => cleanBackup(null), /not a BP Snap backup/);
});
