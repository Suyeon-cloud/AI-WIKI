import { Readable } from 'node:stream';
import { createClaudeHandler } from './claude.mjs';
import { createKciHandler } from './kci.mjs';
export function aiServerPlugin(env) {
  const route = (handle) => async (req, res) => {
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      const request = new Request(`http://localhost${req.originalUrl ?? req.url}`, { method: req.method, headers: req.headers, signal: abort.signal,
        ...(!['GET','HEAD'].includes(req.method) ? { body: Readable.toWeb(req), duplex: 'half' } : {}) });
      const response = await handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).on('error', () => res.end()).pipe(res);
      else res.end();
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  };
  return { name: 'local-api-server', configureServer(server) {
    server.middlewares.use('/api/claude', route(createClaudeHandler(env)));
    server.middlewares.use('/api/kci', route(createKciHandler(env)));
  } };
}
