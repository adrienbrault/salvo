/**
 * Dev server: Bun bundles index.html (TS, TSX, CSS, fonts) on the fly with HMR.
 * Listens on all interfaces so a phone on the same LAN can connect.
 *
 * WebGPU requires a secure context: over plain http on a LAN IP the game falls back to WebGL2.
 * Set TLS_CERT / TLS_KEY (PEM paths) to serve https — see docs/mobile-testing.md.
 */
import { networkInterfaces } from 'node:os';
import index from '../index.html';

const port = Number(process.env.PORT ?? 5173);
const certPath = process.env.TLS_CERT;
const keyPath = process.env.TLS_KEY;
const tls = certPath && keyPath ? { cert: Bun.file(certPath), key: Bun.file(keyPath) } : undefined;

const server = Bun.serve({
  hostname: '0.0.0.0',
  port,
  tls,
  development: { hmr: true, console: true },
  routes: { '/': index },
});

const scheme = tls ? 'https' : 'http';
console.log(`\n  SALVO dev server\n  → ${scheme}://localhost:${server.port}`);
for (const addrs of Object.values(networkInterfaces())) {
  for (const a of addrs ?? []) {
    if (a.family === 'IPv4' && !a.internal) console.log(`  → ${scheme}://${a.address}:${server.port}  (LAN)`);
  }
}
console.log('');
