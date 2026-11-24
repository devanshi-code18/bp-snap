// Backup server logic, shared by the Netlify Function and the local test server.
//
// It stores one encrypted blob per family log. The phone encrypts before upload with a key
// that never leaves the phones, so this server only ever sees random-looking text.
//   GET  /api/v/<id>   -> 200 { rev, data, updatedAt }   (rev 0 and data null when there is none yet)
//   PUT  /api/v/<id>   body { rev, data }; rev must equal the current revision (0 = new)
//                      -> 200 { rev, updatedAt } | 409 { rev, data, updatedAt } (someone else wrote first)
//   GET  /api/health   -> 200 { ok: true }
//
// `store` is { get(id) -> {value, etag} | null, put(id, value, etag|null) -> boolean, snapshot?(id, value) }.

const ID = /^[a-f0-9]{32}$/;
const DATA = /^[A-Za-z0-9_-]+$/;
const MAX_BYTES = 4_000_000;
const ALLOWED_ORIGINS = [/^https:\/\/devanshi-code18\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.some((r) => r.test(origin)) ? origin : 'https://devanshi-code18.github.io',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

export async function handle(req, store) {
  const headers = corsHeaders(req.headers.get('origin') || '');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const url = new URL(req.url);
  if (url.pathname.endsWith('/health')) return json({ ok: true }, 200, headers);
  const id = url.pathname.split('/').pop();
  if (!ID.test(id)) return json({ error: 'bad id' }, 400, headers);

  if (req.method === 'GET') {
    const cur = await store.get(id);
    return json(cur ? cur.value : { rev: 0, data: null }, 200, headers);
  }

  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: 'too big' }, 413, headers);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400, headers); }
    if (!body || !Number.isInteger(body.rev) || body.rev < 0 || typeof body.data !== 'string' || !DATA.test(body.data)) {
      return json({ error: 'bad body' }, 400, headers);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = await store.get(id);
      const curRev = cur ? cur.value.rev : 0;
      if (body.rev !== curRev) return json(cur ? cur.value : { rev: 0 }, 409, headers);
      const next = { rev: curRev + 1, data: body.data, updatedAt: Date.now() };
      if (await store.put(id, next, cur ? cur.etag : null)) {
        try { await store.snapshot?.(id, next); } catch { /* snapshots are best effort */ }
        return json({ rev: next.rev, updatedAt: next.updatedAt }, 200, headers);
      }
      // Lost a race with another phone; the loop re-reads and answers 409.
    }
    const now = await store.get(id);
    return json(now ? now.value : { rev: 0 }, 409, headers);
  }

  return json({ error: 'method not allowed' }, 405, headers);
}

// In-memory store for tests and local development.
export function memoryStore() {
  const m = new Map();
  let n = 0;
  return {
    snapshots: [],
    async get(id) { return m.has(id) ? { value: structuredClone(m.get(id).value), etag: m.get(id).etag } : null; },
    async put(id, value, etag) {
      const cur = m.get(id);
      if ((cur ? cur.etag : null) !== etag) return false;
      m.set(id, { value: structuredClone(value), etag: `e${++n}` });
      return true;
    },
    async snapshot(id, value) { this.snapshots.push({ id, rev: value.rev }); },
  };
}
