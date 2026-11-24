// Local backup server for tests and development: same logic as the real one, kept in memory.
//   node tests/sync-server.mjs [port]
import http from 'node:http';
import { handle, memoryStore } from '../server/vault-core.mjs';

export function startSyncServer(port = 8792) {
  const store = memoryStore();
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
    const response = await handle(request, store);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ store, close: () => server.close(), port })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] || 8792);
  await startSyncServer(port);
  console.log(`backup server on http://127.0.0.1:${port}/api`);
}
