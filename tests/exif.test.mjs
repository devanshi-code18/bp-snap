import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exifDate } from '../js/exif.js';

// Build a minimal JPEG: SOI + APP1(Exif, little-endian TIFF, IFD0 -> ExifIFD with DateTimeOriginal/OffsetTimeOriginal) + EOI.
function jpegWithExif(dt, offset) {
  const entries = [[0x9003, dt + '\0']];
  if (offset) entries.push([0x9011, offset + '\0']);
  const ifd0Off = 8, exifOff = ifd0Off + 2 + 12 + 4;
  const exifSize = 2 + entries.length * 12 + 4;
  let dataOff = exifOff + exifSize;
  const tiff = new DataView(new ArrayBuffer(dataOff + entries.reduce((s, [, v]) => s + v.length, 0)));
  tiff.setUint16(0, 0x4949); tiff.setUint16(2, 42, true); tiff.setUint32(4, ifd0Off, true);
  tiff.setUint16(ifd0Off, 1, true);
  tiff.setUint16(ifd0Off + 2, 0x8769, true); tiff.setUint16(ifd0Off + 4, 4, true); tiff.setUint32(ifd0Off + 6, 1, true); tiff.setUint32(ifd0Off + 10, exifOff, true);
  tiff.setUint32(ifd0Off + 14, 0, true);
  tiff.setUint16(exifOff, entries.length, true);
  entries.forEach(([tag, val], i) => {
    const e = exifOff + 2 + i * 12;
    tiff.setUint16(e, tag, true); tiff.setUint16(e + 2, 2, true); tiff.setUint32(e + 4, val.length, true);
    if (val.length <= 4) for (let k = 0; k < val.length; k++) tiff.setUint8(e + 8 + k, val.charCodeAt(k));
    else {
      tiff.setUint32(e + 8, dataOff, true);
      for (let k = 0; k < val.length; k++) tiff.setUint8(dataOff + k, val.charCodeAt(k));
      dataOff += val.length;
    }
  });
  const tb = new Uint8Array(tiff.buffer);
  const app1Len = 2 + 6 + tb.length;
  const out = new Uint8Array(2 + 2 + app1Len + 2);
  out.set([0xff, 0xd8, 0xff, 0xe1, app1Len >> 8, app1Len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  out.set(tb, 12);
  out.set([0xff, 0xd9], out.length - 2);
  return out.buffer;
}

test('reads DateTimeOriginal with offset', () => {
  const ms = exifDate(jpegWithExif('2026:11:24 07:45:10', '-08:00'));
  assert.equal(new Date(ms).toISOString(), '2026-11-24T15:45:10.000Z');
});

test('reads DateTimeOriginal without offset as local time', () => {
  const ms = exifDate(jpegWithExif('2026:11:24 07:45:10'));
  assert.equal(ms, new Date(2026, 10, 24, 7, 45, 10).getTime());
});

test('non-JPEG or no EXIF returns null', () => {
  assert.equal(exifDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), null);
  assert.equal(exifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer), null);
  assert.equal(exifDate(new ArrayBuffer(0)), null);
});
