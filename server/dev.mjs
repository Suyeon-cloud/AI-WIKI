import { Readable } from 'node:stream';
import { createClaudeHandler } from './claude.mjs';
export function aiServerPlugin(env) {
  const handle = createClaudeHandler(env);
  return { name: 'local-claude-server', configureServer(server) {
    server.middlewares.use('/api/claude', async (req, res) => {
      const abort = new AbortController();
      res.on('close', () => { if (!res.writableEnded) abort.abort(); });
      try {
        const request = new Request('http://localhost/api/claude', { method: req.method, headers: req.headers, signal: abort.signal,
          ...(!['GET','HEAD'].includes(req.method) ? { body: Readable.toWeb(req), duplex: 'half' } : {}) });
        const response = await handle(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body) Readable.fromWeb(response.body).on('error', () => res.end()).pipe(res);
        else res.end();
      } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
    });
  } };
}
