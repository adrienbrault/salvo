/** Production build: static site in dist/ (deployable on any static host). */
import { rm } from 'node:fs/promises';

await rm('./dist', { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ['./index.html'],
  outdir: './dist',
  target: 'browser',
  minify: true,
  sourcemap: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Response headers for Cloudflare's static assets (wrangler.jsonc): a chunk's name carries its
// content hash, so browsers keep it for good instead of revalidating it on every visit.
await Bun.write('./dist/_headers', '/chunk-*\n  Cache-Control: public, max-age=31536000, immutable\n');

let total = 0;
for (const out of result.outputs) {
  total += out.size;
  if (out.kind !== 'sourcemap') console.log(`${(out.size / 1024).toFixed(1).padStart(9)} kB  ${out.path}`);
}
console.log(`${(total / 1024).toFixed(1).padStart(9)} kB  total`);
