// Static file server for the built client (client/dist). In production the game
// server serves the page itself, so one URL carries both the page and the
// WebSocket. Also answers /health for Railway. Anything that isn't a real file
// falls back to index.html so /?room=CODE and stray paths load the game.

import { createReadStream, existsSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const DIST_DIR = fileURLToPath(new URL('../../client/dist', import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);

  if (urlPath === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  if (!existsSync(path.join(DIST_DIR, 'index.html'))) {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('FLICK FIGHT server running (no client build — run `npm run build`).');
    return;
  }

  let filePath = path.normalize(path.join(DIST_DIR, urlPath));
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}
