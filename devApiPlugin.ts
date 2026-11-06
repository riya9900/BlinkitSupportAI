// DEV-ONLY helper. `npm run dev` normally serves just the frontend, while on
// Vercel the files in /api become serverless functions. This plugin lets the
// local dev server run those same /api files, so the UI can talk to the real
// backend without installing the Vercel CLI. It never runs in `vite build`
// and is never part of the deployed app.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, type Plugin } from 'vite';

export function devApi(): Plugin {
  return {
    name: 'blinkit-dev-api',
    apply: 'serve',

    // Make .env values (MONGODB_URI, GEMINI_API_KEY...) visible to the API code.
    // They stay server-side: Vite only exposes variables starting with VITE_
    // to browser code, and nothing here changes that.
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, '');
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const match = /^\/api\/([a-z0-9-]+)$/.exec(url.pathname);
        if (!match) return next();

        const sendJson = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };

        const file = path.join(server.config.root, 'api', `${match[1]}.ts`);
        if (!existsSync(file)) return sendJson(404, { error: 'No such API endpoint.' });

        try {
          const mod = await server.ssrLoadModule(`/api/${match[1]}.ts`);
          const handler = mod[req.method ?? 'GET'];
          if (typeof handler !== 'function') {
            return sendJson(405, { error: `${req.method} is not supported here.` });
          }

          const headers = new Headers();
          for (const [name, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers.set(name, value);
          }
          // Vercel tells the function who is calling; do the same locally so rate limiting works.
          if (!headers.has('x-real-ip')) headers.set('x-real-ip', req.socket.remoteAddress ?? 'unknown');
          let body: Uint8Array | undefined;
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            body = new Uint8Array(Buffer.concat(chunks));
          }

          const response: Response = await handler(
            new Request(url, { method: req.method, headers, body }),
          );
          res.statusCode = response.status;
          response.headers.forEach((value, name) => res.setHeader(name, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          if (err instanceof Error) server.ssrFixStacktrace(err);
          server.config.logger.error(`[dev-api] ${String(err)}`);
          sendJson(500, { error: 'Something went wrong on our side. Please try again.' });
        }
      });
    },
  };
}
