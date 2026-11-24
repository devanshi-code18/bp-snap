// Read the capture time from a JPEG's EXIF (DateTimeOriginal + OffsetTimeOriginal).
// Returns epoch ms or null. Works on an ArrayBuffer; no dependencies.

export function exifDate(buf) {
  try {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let p = 2;
    while (p + 4 <= v.byteLength) {
      const marker = v.getUint16(p);
      if ((marker & 0xff00) !== 0xff00) return null;
      const len = v.getUint16(p + 2);
      if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966) return parseTiff(v, p + 10);
      if (marker === 0xffda) return null;
      p += 2 + len;
    }
  } catch { /* corrupt EXIF: fall through */ }
  return null;
}

function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(t + o, le), u32 = (o) => v.getUint32(t + o, le);
  const str = (off, n) => {
    let s = '';
    for (let i = 0; i < n; i++) { const c = v.getUint8(t + off + i); if (!c) break; s += String.fromCharCode(c); }
    return s;
  };
  const readIfd = (off) => {
    const tags = {};
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      if (type === 2) tags[tag] = str(count > 4 ? u32(e + 8) : e + 8, count);
      else if (type === 4) tags[tag] = u32(e + 8);
      else if (type === 3) tags[tag] = u16(e + 8);
    }
    return tags;
  };
  const ifd0 = readIfd(u32(4));
  const sub = ifd0[0x8769] ? readIfd(ifd0[0x8769]) : {};
  const dt = sub[0x9003] || sub[0x9004] || ifd0[0x0132];
  if (!dt) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(dt);
  if (!m) return null;
  const off = sub[0x9011] || sub[0x9010];
  if (off && /^[+-]\d{2}:\d{2}$/.test(off)) {
    return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${off}`) || null;
  }
  // No offset: the camera's local time; treat it as this device's local time.
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() || null;
}
