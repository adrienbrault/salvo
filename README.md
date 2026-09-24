# SALVO

A vertical shoot'em-up roguelike à la Balatro, in the browser on desktop and mobile. Each level is a timed score attack (Shards × Mult against a quota); between levels, the shop's relics and equipment reshape how you play.

Everything is procedural: textures, models, environments, sound effects and music are generated at runtime, and the repo ships no binary assets. Rendering is three.js on WebGPU, with a WebGL2 fallback.

## Controls

- **Touch**: drag anywhere with one finger (the ship moves with your finger); hold a second finger for the action.
- **Mouse**: the ship follows the cursor; hold the button for the action.
- **Keyboard**: arrows, WASD or ZQSD to move, Space for the action, Shift for precise movement, Esc or P to pause.

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
bun run dev      # dev server with hot reload
bun run check    # typecheck, lint, tests
bun run build    # static site in dist/
bun run preview  # serve dist/
```

URL flags for testing (`?webgl`, `?tier=low`, `?fps`, …) are listed in [docs/browser-testing.md](docs/browser-testing.md). Design, balancing and rendering notes live in [docs/](docs/); [AGENTS.md](AGENTS.md) is the guide for coding agents.
