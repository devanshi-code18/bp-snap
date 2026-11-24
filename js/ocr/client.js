// Client for the reader: Web Worker when available, main thread otherwise.
import { readDisplay } from './sevenseg.js';

let worker;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      clearTimeout(p.timer);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.res);
    };
    worker.onerror = () => {
      worker = null;
      for (const p of pending.values()) { clearTimeout(p.timer); p.fallback(); }
      pending.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** @param {ImageData} imageData */
export function read(imageData, opts = {}) {
  const w = getWorker();
  const local = () => readDisplay(imageData, opts);
  if (!w) return Promise.resolve().then(local);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const fallback = () => { try { resolve(local()); } catch (err) { reject(err); } };
    const timer = setTimeout(() => { pending.delete(id); fallback(); }, 20000);
    pending.set(id, { resolve, reject, fallback, timer });
    const copy = imageData.data.slice().buffer;
    w.postMessage({ id, width: imageData.width, height: imageData.height, buffer: copy, opts }, [copy]);
  });
}
