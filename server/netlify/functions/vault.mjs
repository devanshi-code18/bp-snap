// Netlify Function: the BP Snap backup server (see ../../vault-core.mjs).
import { getStore } from '@netlify/blobs';
import { handle } from '../../vault-core.mjs';

const KEEP_DAYS = 14;

function blobStore() {
  const s = getStore({ name: 'vaults', consistency: 'strong' });
  return {
    async get(id) {
      const r = await s.getWithMetadata(id, { type: 'json' });
      return r ? { value: r.data, etag: r.etag } : null;
    },
    async put(id, value, etag) {
      const res = await s.setJSON(id, value, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
      return res.modified;
    },
    // One copy per day for the last two weeks, in case a phone ever uploads something bad.
    async snapshot(id, value) {
      const day = new Date(value.updatedAt).toISOString().slice(0, 10);
      await s.setJSON(`snap/${id}/${day}`, value);
      const { blobs } = await s.list({ prefix: `snap/${id}/` });
      const old = blobs.map((b) => b.key).sort().slice(0, -KEEP_DAYS);
      for (const key of old) await s.delete(key);
    },
  };
}

export default async (req) => handle(req, blobStore());

export const config = { path: ['/api/v/:id', '/api/health'] };
