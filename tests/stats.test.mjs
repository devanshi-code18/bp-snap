import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/stats.js';

const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test('ACC/AHA categories', () => {
  assert.equal(S.category(115, 75).key, 'normal');
  assert.equal(S.category(120, 79).key, 'elevated');
  assert.equal(S.category(129, 70).key, 'elevated');
  assert.equal(S.category(130, 70).key, 'stage1');
  assert.equal(S.category(118, 80).key, 'stage1');
  assert.equal(S.category(139, 89).key, 'stage1');
  assert.equal(S.category(140, 70).key, 'stage2');
  assert.equal(S.category(125, 90).key, 'stage2');
  assert.equal(S.category(181, 100).key, 'severe');
  assert.equal(S.category(150, 121).key, 'severe');
  assert.equal(S.category(180, 120).key, 'stage2');
  assert.equal(S.category(0, 80), null);
});

test('time of day uses the clock where the reading was taken', () => {
  const ms = Date.UTC(2026, 10, 24, 15, 0); // 15:00 UTC
  assert.equal(S.timeOfDay(ms, 480), 'morning'); // 07:00 in UTC-8
  assert.equal(S.timeOfDay(ms, -330), 'evening'); // 20:30 in UTC+5:30
  assert.equal(S.timeOfDay(ms, -540), 'night'); // 00:00 in UTC+9
  assert.equal(S.todOf({ takenAt: ms, tzOffset: 480 }), 'morning');
});

test('time of day buckets', () => {
  assert.equal(S.timeOfDay(at(2026, 11, 24, 7)), 'morning');
  assert.equal(S.timeOfDay(at(2026, 11, 24, 11, 59)), 'morning');
  assert.equal(S.timeOfDay(at(2026, 11, 24, 12)), 'afternoon');
  assert.equal(S.timeOfDay(at(2026, 11, 24, 18)), 'evening');
  assert.equal(S.timeOfDay(at(2026, 11, 24, 23)), 'night');
  assert.equal(S.timeOfDay(at(2026, 11, 24, 2)), 'night');
  assert.equal(S.timeOfDay(at(2026, 11, 24, 4)), 'morning');
});

test('summaries and averages', () => {
  const rs = [
    { sys: 120, dia: 80, pulse: 70, takenAt: at(2026, 11, 20, 8) },
    { sys: 130, dia: 84, pulse: null, takenAt: at(2026, 11, 20, 20) },
    { sys: 125, dia: 81, pulse: 74, takenAt: at(2026, 11, 21, 8) },
  ];
  const s = S.summarize(rs);
  assert.equal(s.count, 3);
  assert.equal(s.sys, 125);
  assert.equal(s.dia, 82);
  assert.equal(s.pulse, 72);
  assert.equal(s.sysMin, 120);
  assert.equal(s.sysMax, 130);
  assert.equal(s.category.key, 'stage1');
  const tod = S.byTimeOfDay(rs);
  assert.equal(tod.morning.count, 2);
  assert.equal(tod.morning.sys, 123);
  assert.equal(tod.evening.count, 1);
  assert.equal(tod.afternoon.count, 0);
  assert.equal(S.summarize([]).count, 0);
  assert.deepEqual(S.categoryCounts(rs), { normal: 0, elevated: 0, stage1: 3, stage2: 0, severe: 0 });
});

test('lastDays window', () => {
  const now = at(2026, 11, 24, 12);
  const rs = [{ sys: 1, dia: 1, takenAt: now - 2 * 86400000 }, { sys: 1, dia: 1, takenAt: now - 8 * 86400000 }];
  assert.equal(S.lastDays(rs, 7, now).length, 1);
  assert.equal(S.lastDays(rs, 30, now).length, 2);
});

test('sessions group readings minutes apart', () => {
  const t = at(2026, 11, 24, 8);
  const rs = [
    { sys: 130, dia: 80, takenAt: t },
    { sys: 126, dia: 78, takenAt: t + 2 * 60000 },
    { sys: 120, dia: 76, takenAt: t + 11 * 3600000 },
  ];
  const ss = S.sessions(rs);
  assert.equal(ss.length, 2);
  assert.equal(ss[0].count, 2);
  assert.equal(ss[0].sys, 128);
});

test('CSV export escapes and orders by time', () => {
  const people = { p1: { name: 'Mom, "Asha"' } };
  const rs = [
    { personId: 'p1', sys: 140, dia: 90, pulse: 70, takenAt: at(2026, 11, 22, 19), notes: 'after dinner\nfelt ok', source: 'photo', arm: 'left', position: 'sitting' },
    { personId: 'p1', sys: 118, dia: 76, pulse: null, takenAt: at(2026, 11, 22, 7), source: 'manual' },
  ];
  const csv = S.toCSV(rs, people);
  assert.ok(csv.startsWith('\uFEFF'));
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines[0], 'person,date_time,systolic,diastolic,pulse,category,time_of_day,arm,position,notes,source');
  assert.match(lines[1], /^"Mom, ""Asha""",2026-11-22T07:00[+-]\d\d:\d\d,118,76,,Normal,morning,,,,manual$/);
  assert.ok(csv.includes('"after dinner\nfelt ok"'));
  assert.ok(lines.length >= 3);
});

test('CSV export neutralises spreadsheet formulas in free text', () => {
  const csv = S.toCSV([{ personId: 'p', sys: 120, dia: 80, takenAt: Date.now(), notes: '=HYPERLINK("x")' }], { p: { name: '+me' } });
  const row = csv.slice(1).trim().split('\r\n')[1];
  assert.ok(row.startsWith("'+me,"));
  assert.ok(row.includes('"\'=HYPERLINK(""x"")"'));
});

test('validation', () => {
  assert.deepEqual(S.validReading(120, 80, 70), []);
  assert.deepEqual(S.validReading(120, 80, null), []);
  assert.equal(S.validReading(80, 120, 70).length, 1);
  assert.equal(S.validReading(null, 80, null).length, 1);
  assert.equal(S.validReading(120, 80, 5).length, 1);
  assert.equal(S.validReading(400, 80, 70).length, 1);
});
