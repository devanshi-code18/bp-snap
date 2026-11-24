// Image helpers (browser): decode a photo, scale/crop/rotate on a canvas, JPEG thumbnails.

export async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not open this image.')); });
  }
  return { img, url };
}

const dims = (src) => ({ w: src.naturalWidth || src.width, h: src.naturalHeight || src.height });

// Draw `src` (optionally only the `crop` rect, in source pixels) scaled to fit maxDim.
export function toCanvas(src, maxDim, crop = null) {
  const { w, h } = dims(src);
  const c = crop || { x: 0, y: 0, w, h };
  const s = Math.min(1, maxDim / Math.max(c.w, c.h));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(c.w * s));
  cv.height = Math.max(1, Math.round(c.h * s));
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, cv.width, cv.height);
  return cv;
}

export function rotate(src, quarterTurns = 1) {
  const { w, h } = dims(src);
  const q = ((quarterTurns % 4) + 4) % 4;
  const cv = document.createElement('canvas');
  cv.width = q % 2 ? h : w;
  cv.height = q % 2 ? w : h;
  const ctx = cv.getContext('2d');
  ctx.translate(cv.width / 2, cv.height / 2);
  ctx.rotate((q * Math.PI) / 2);
  ctx.drawImage(src, -w / 2, -h / 2);
  return cv;
}

export function pixels(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function jpeg(canvas, quality = 0.8) {
  return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', quality));
}
