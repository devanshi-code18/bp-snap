// Merging two copies of the log (this phone and the backup). Every record has an id and an
// updatedAt time; the newer copy of a record wins, and a deletion is just a newer copy with
// deletedAt set, so deletions travel between phones too.

const stamp = (r) => r.updatedAt ?? r.createdAt ?? r.takenAt ?? 0;

// Should `b` replace `a`?
export function wins(b, a) {
  if (!a) return true;
  const tb = stamp(b), ta = stamp(a);
  if (tb !== ta) return tb > ta;
  return !!b.deletedAt && !a.deletedAt;
}

export function mergeLists(a = [], b = []) {
  const m = new Map(a.map((x) => [x.id, x]));
  for (const x of b) if (x && x.id && wins(x, m.get(x.id))) m.set(x.id, x);
  return [...m.values()];
}

export function mergeVaults(a = {}, b = {}) {
  return { people: mergeLists(a.people, b.people), readings: mergeLists(a.readings, b.readings) };
}

// Same records at the same versions?
export function fingerprint(v = {}) {
  const f = (list = []) => list.map((x) => `${x.id}:${stamp(x)}${x.deletedAt ? 'd' : ''}`).sort().join(',');
  return `${f(v.people)}|${f(v.readings)}`;
}
