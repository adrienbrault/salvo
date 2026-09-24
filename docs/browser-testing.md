# Browser testing

How to see the game while working on it: in Chrome (automated or not) and on a phone.

## URL flags

| Flag | Effect |
| --- | --- |
| `?quick=<chassisId>&seed=<s>` | Skip the menus: start a run with that chassis (ids: `faucon`, `luciole`, `prisme`, `taureau`) and seed. |
| `?webgl` | Force the WebGL2 backend. |
| `?tier=ultra\|high\|medium\|low` | Force a quality tier instead of auto-detection. |
| `?rafshim` | Drive `requestAnimationFrame` from a MessageChannel — required when the tab is hidden or its window occluded. |
| `?fps` | Overlay: frame rate, average and worst frame time, tier, backend, canvas size and dynamic-resolution factor. |

## Hidden windows

An automated Chrome window is usually hidden (`document.visibilityState === 'hidden'`), and a hidden tab never fires `requestAnimationFrame`. The game then never finishes booting (three's WebGL backend polls pipeline compilation with rAF) and the loop never ticks. Load pages with `?rafshim`.

Hidden windows are also throttled (timers, and the whole process when macOS naps an occluded Chrome): boot can take 20 s to a few minutes, and wall-clock frame timings mean little. Wait for `window.salvo` with separate short polls — a script spinning on `requestAnimationFrame` under the shim starves boot.

## Measuring GPU cost

Frame rate in a hidden window is unreliable, but GPU timestamps are not. On WebGPU, `salvo.gr.renderer.backend.trackTimestamp = true`, then after each of a few frames `await salvo.gr.renderer.resolveTimestampsAsync('render')` returns that frame's GPU milliseconds. Resolve one at a time (overlapping resolves hang the query pool), run long experiments as an in-page async task that writes results to `window` and poll it, and compare by toggling one thing at a time (`gr.key.castShadow`, `gr.sea.reflective`, `gr.trench.root.visible`, `renderer.setPixelRatio`).

## The `salvo` debug handle

`window.salvo = { game, gr, ui }` (set in `src/main.tsx`):

- Jump into a sector: `salvo.game.newRun('faucon', 'DEMO'); salvo.game.run.sector = 2; salvo.game.startLevel()`.
- Preview a biome without playing: `salvo.gr.setTheme(sector, seed)`.
- Clean environment shots: `document.getElementById('ui').style.visibility = 'hidden'`.
- Renderer facts: `salvo.gr.isWebGPU`, `salvo.gr.quality.tier`.

## Other agents editing the tree

Every saved file makes the dev server reload the page (modules don't accept hot updates), which restarts whatever you were inspecting. When other agents are editing, serve a snapshot instead: `rsync -a --exclude node_modules --exclude .git ./ <scratch>/snap/`, symlink `node_modules` into it, run `PORT=5174 bun scripts/dev.ts` from the snapshot, and re-run the rsync whenever you want your latest changes on screen.

## Phones

`bun run dev` listens on the LAN and prints the address. Over plain http a phone gets the WebGL2 fallback: WebGPU needs a secure context. For WebGPU, serve https with a locally trusted certificate (`.certs/` is git-ignored):

1. `mkcert -install`, then `mkcert -cert-file .certs/cert.pem -key-file .certs/key.pem <lan-ip> localhost`.
2. Trust mkcert's root CA on the phone (`mkcert -CAROOT` shows where `rootCA.pem` lives; install it as a profile on iOS or a CA certificate on Android).
3. `TLS_CERT=.certs/cert.pem TLS_KEY=.certs/key.pem bun run dev`, then open `https://<lan-ip>:5173`.

Check portrait and landscape, the safe areas (notch, home indicator), touch controls, and that the auto tier (high on WebGPU phones) holds its frame rate.
