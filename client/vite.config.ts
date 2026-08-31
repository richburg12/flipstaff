import { defineConfig } from 'vite';

// The client is a plain Canvas 2D app. It imports the shared `@flickfight/sim`
// TypeScript package straight from source (workspace symlink) — Vite transpiles
// it, so there's no separate sim build step. Output lands in client/dist, which
// the Node server serves in production (one URL for page + WebSocket).
export default defineConfig({
  root: __dirname,
  server: { host: true, port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
