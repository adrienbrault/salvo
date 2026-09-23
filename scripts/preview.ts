/** Serves the production build from dist/ (run `bun run build` first). */
import { join, normalize } from 'node:path';

const root = join(import.meta.dir, '..', 'dist');
const port = Number(process.env.PORT ?? 4173);

const server = Bun.serve({
  hostname: '0.0.0.0',
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = Bun.file(join(root, path === '/' ? 'index.html' : path));
    if (await file.exists()) return new Response(file);
    return new Response(Bun.file(join(root, 'index.html')));
  },
});
console.log(`SALVO preview → http://localhost:${server.port}`);
