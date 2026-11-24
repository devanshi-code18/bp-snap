// Runs the seven-segment reader off the main thread.
import { readDisplay } from './sevenseg.js';

self.onmessage = (e) => {
  const { id, width, height, buffer, opts } = e.data;
  try {
    const res = readDisplay({ width, height, data: new Uint8ClampedArray(buffer) }, opts);
    self.postMessage({ id, res });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
