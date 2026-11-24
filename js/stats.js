// Blood pressure stats: categories, time of day, averages, CSV. Pure functions (tested in Node).

// 2017 ACC/AHA categories (kept in the 2025 AHA/ACC guideline).
// `ink` is the chip text colour with at least 4.5:1 contrast on `color`.
export const CATEGORIES = [
  { key: 'normal', label: 'Normal', short: 'Normal', color: '#1f7a45', ink: '#ffffff' },
  { key: 'elevated', label: 'Elevated', short: 'Elevated', color: '#e6c200', ink: '#1d1b1a' },
  { key: 'stage1', label: 'High, stage 1', short: 'Stage 1', color: '#f08a1c', ink: '#1d1b1a' },
  { key: 'stage2', label: 'High, stage 2', short: 'Stage 2', color: '#c62f2a', ink: '#ffffff' },
  { key: 'severe', label: 'Very high (over 180/120)', short: 'Very high', color: '#8e1b1b', ink: '#ffffff' },
];
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

export function category(sys, dia) {
  if (!(sys > 0) || !(dia > 0)) return null;
  if (sys > 180 || dia > 120) return CAT.severe;
  if (sys >= 140 || dia >= 90) return CAT.stage2;
  if (sys >= 130 || dia >= 80) return CAT.stage1;
  if (sys >= 120) return CAT.elevated;
  return CAT.normal;
}

export const TIMES_OF_DAY = [
  { key: 'morning', label: 'Morning', from: 4, to: 12 },
  { key: 'afternoon', label: 'Afternoon', from: 12, to: 17 },
  { key: 'evening', label: 'Evening', from: 17, to: 22 },
  { key: 'night', label: 'Night', from: 22, to: 28 },
];

// tzOffset (minutes, as Date#getTimezoneOffset) = the clock where the reading was taken.
export function timeOfDay(ms, tzOffset = null) {
  const h = tzOffset == null ? new Date(ms).getHours() : new Date(ms - tzOffset * 60000).getUTCHours();
  const hh = h < 4 ? h + 24 : h;
  return TIMES_OF_DAY.find((t) => hh >= t.from && hh < t.to).key;
}
export const todOf = (r) => timeOfDay(r.takenAt, r.tzOffset ?? null);

const round = (x) => Math.round(x);
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

export function summarize(readings) {
  const r = readings.filter((x) => x.sys > 0 && x.dia > 0);
  if (!r.length) return { count: 0 };
  const pulses = r.map((x) => x.pulse).filter((p) => p > 0);
  const s = avg(r.map((x) => x.sys)), d = avg(r.map((x) => x.dia));
  return {
    count: r.length,
    sys: round(s), dia: round(d), pulse: pulses.length ? round(avg(pulses)) : null,
    sysMin: Math.min(...r.map((x) => x.sys)), sysMax: Math.max(...r.map((x) => x.sys)),
    diaMin: Math.min(...r.map((x) => x.dia)), diaMax: Math.max(...r.map((x) => x.dia)),
    category: category(round(s), round(d)),
    first: Math.min(...r.map((x) => x.takenAt)), last: Math.max(...r.map((x) => x.takenAt)),
  };
}

export function inRange(readings, fromMs, toMs = Infinity) {
  return readings.filter((r) => r.takenAt >= fromMs && r.takenAt <= toMs);
}

export function lastDays(readings, days, now = Date.now()) {
  return inRange(readings, now - days * 86400000, now + 60000);
}

export function byTimeOfDay(readings) {
  const out = {};
  for (const t of TIMES_OF_DAY) out[t.key] = summarize(readings.filter((r) => todOf(r) === t.key));
  return out;
}

export function categoryCounts(readings) {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0]));
  for (const r of readings) { const c = category(r.sys, r.dia); if (c) out[c.key]++; }
  return out;
}

// Readings taken within `gapMin` minutes of each other form one sitting (AHA suggests 2-3 readings, averaged).
export function sessions(readings, gapMin = 10) {
  const sorted = [...readings].sort((a, b) => a.takenAt - b.takenAt);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.takenAt - last.readings[last.readings.length - 1].takenAt <= gapMin * 60000) last.readings.push(r);
    else out.push({ readings: [r] });
  }
  for (const s of out) Object.assign(s, summarize(s.readings), { takenAt: s.readings[0].takenAt });
  return out;
}

function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  // Spreadsheet apps run cells starting with = + - @ as formulas; keep free text as text.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function localIso(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

export function toCSV(readings, peopleById = {}) {
  const head = ['person', 'date_time', 'systolic', 'diastolic', 'pulse', 'category', 'time_of_day', 'arm', 'position', 'notes', 'source'];
  const rows = [...readings].sort((a, b) => a.takenAt - b.takenAt).map((r) => [
    peopleById[r.personId]?.name ?? '', localIso(r.takenAt), r.sys, r.dia, r.pulse ?? '',
    category(r.sys, r.dia)?.label ?? '', todOf(r), r.arm ?? '', r.position ?? '', r.notes ?? '', r.source ?? '',
  ]);
  // BOM so Excel reads names like "José" as UTF-8.
  return '\uFEFF' + [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function validReading(sys, dia, pulse) {
  const errs = [];
  if (!(sys >= 50 && sys <= 300)) errs.push('Systolic (top number) should be between 50 and 300.');
  if (!(dia >= 25 && dia <= 200)) errs.push('Diastolic (bottom number) should be between 25 and 200.');
  if (sys > 0 && dia > 0 && dia >= sys) errs.push('The top number (systolic) is normally higher than the bottom number (diastolic).');
  if (pulse != null && pulse !== '' && !(pulse >= 25 && pulse <= 250)) errs.push('Pulse should be between 25 and 250.');
  return errs;
}
