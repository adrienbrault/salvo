# SALVO

A vertical shoot'em-up roguelike à la Balatro for the web, desktop and mobile alike: each level is a timed score attack (Shards × Mult against a quota), and between levels the shop's relics and equipment reshape how you play. Bun, TypeScript, three.js WebGPU (WebGL2 fallback), Preact.

## Architecture

The gameplay core — `src/sim` (a deterministic simulation: fixed 60 Hz step, seeded `Rng`), `src/content` (item definitions, whose hooks the sim calls) and `src/run` (levels, quotas, shop, saves) — is pure TypeScript with no DOM and no three.js, so it runs headless in tests and in the balance bot. `src/render`, `src/ui` and `src/audio` read the simulation's state and drain its `World.fx` events; `src/app/Game.ts` orchestrates the run and `src/main.tsx` boots everything. Dependencies point from presentation to core, never back.

Everything is procedural: textures, models, environments, sound effects and music are generated at runtime; the repo ships no binary assets.

## Conventions

- Player-facing text is English. Internal ids are stable identifiers (some are French, e.g. chassis `faucon`) — they are save-format keys; leave them as they are.
- Desktop and mobile are both first-class: touch and pointer input, portrait and landscape, safe areas, quality tiers, and the WebGL2 fallback.
- Gates: `bun run check` (typecheck, Biome, tests) is green before every commit. Commits are atomic and conventional (`feat(render): …`, `fix(sim): …`).
- Path-scoped rules in `.claude/rules/` load with the files they cover.

## Docs

- `docs/design.md` — rules and intent: the loop, scoring and hook order, which stats reach which weapon, relics, shop, constraints; read before changing gameplay or content.
- `docs/balancing.md` — the headless bot and its blind spots, the balance report, where numbers live and which are coupled; read before changing a quota, price, reward, difficulty or item value.
- `docs/rendering.md` — pipeline stability, readability, the procedural environment kit and biomes; read before structural changes in `src/render`.
- `docs/browser-testing.md` — URL flags, hidden-window gotchas, the `salvo` debug handle, phones over https; read before checking anything in a browser.
