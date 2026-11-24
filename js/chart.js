// SVG trend chart for systolic / diastolic readings. Returns markup (no dependencies).
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function chartSVG(readings, { from, to, width = 360, height = 200 } = {}) {
  const pts = readings.filter((r) => r.takenAt >= from && r.takenAt <= to).sort((a, b) => a.takenAt - b.takenAt);
  if (!pts.length) return '<p class="muted center">No readings in this range yet.</p>';
  if (to - from < 3600000) { from -= 1800000; to += 1800000; }
  const padL = 30, padR = 10, padT = 10, padB = 24;
  const lo = Math.min(60, ...pts.map((r) => r.dia)) - 10, hi = Math.max(150, ...pts.map((r) => r.sys)) + 10;
  const yMin = Math.floor(lo / 20) * 20, yMax = Math.ceil(hi / 20) * 20;
  const X = (t) => padL + ((t - from) / (to - from)) * (width - padL - padR);
  const Y = (v) => padT + ((yMax - v) / (yMax - yMin)) * (height - padT - padB);
  const parts = [];
  for (let v = yMin; v <= yMax; v += 20) {
    parts.push(`<line x1="${padL}" x2="${width - padR}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/>`);
    parts.push(`<text x="${padL - 4}" y="${Y(v) + 3}" class="ylab">${v}</text>`);
  }
  for (const [v, cls] of [[120, 'ref-sys'], [80, 'ref-dia']]) {
    if (v > yMin && v < yMax) parts.push(`<line x1="${padL}" x2="${width - padR}" y1="${Y(v)}" y2="${Y(v)}" class="${cls}"/>`);
  }
  const span = to - from;
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const t = from + (span * i) / ticks;
    const d = new Date(t);
    const lab = span > 2 * 86400000 ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const anchor = i === 0 ? 'start' : i === ticks ? 'end' : 'middle';
    parts.push(`<text x="${X(t)}" y="${height - 6}" class="xlab" text-anchor="${anchor}">${esc(lab)}</text>`);
  }
  const line = (key) => pts.map((r) => `${X(r.takenAt).toFixed(1)},${Y(r[key]).toFixed(1)}`).join(' ');
  if (pts.length > 1) {
    parts.push(`<polyline points="${line('sys')}" class="l-sys"/>`);
    parts.push(`<polyline points="${line('dia')}" class="l-dia"/>`);
  }
  for (const r of pts) {
    parts.push(`<circle cx="${X(r.takenAt).toFixed(1)}" cy="${Y(r.sys).toFixed(1)}" r="3" class="d-sys"/>`);
    parts.push(`<circle cx="${X(r.takenAt).toFixed(1)}" cy="${Y(r.dia).toFixed(1)}" r="3" class="d-dia"/>`);
  }
  return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="Blood pressure trend, ${pts.length} readings">${parts.join('')}</svg>
<div class="legend"><span class="k-sys">Systolic (top)</span><span class="k-dia">Diastolic (bottom)</span><span class="k-ref">dashed: 120 / 80</span></div>`;
}
