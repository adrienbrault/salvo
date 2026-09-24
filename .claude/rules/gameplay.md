---
paths:
  - "src/sim/**"
  - "src/run/**"
  - "src/content/**"
  - "src/test/**"
---

# Gameplay rules

Read `docs/design.md` before changing rules, scoring, weapons, items, the shop or constraints. Read `docs/balancing.md` before changing a number that moves score, difficulty or money.

## Determinism

A level replays identically from its run state, seed and inputs; tests, the balance report and resumed saves rely on it.

- Randomness comes from `Rng`, one fork per consumer, each with its own label (`constraints`, `level-{sector}-{level}`, `director`, `shop-{visits}-{label}`). A new consumer takes a new fork so existing streams stay put; items and constraints draw from `world.rng`. `randomSeed()` is the one app-side exception.
- Time is the `dt` passed to `step()` (fixed `DT`). Enemies and enemy bullets run on the slowed `edt` (Chronostasis), so code uses the dt it is handed.
- The sim is pure TypeScript: state and time come from the world, never from `Math.random`, `Date`, `performance`, the DOM or three.js.

## Pools and the renderer contract

- `enemies`, `bullets` and `shots` are `Pool`s. `spawn()` returns a recycled, dirty object, so every spawn path sets every field (a new `Bullet`/`Enemy` field goes into `newBullet`/`newEnemy` and into `fireEnemy`/`fireShot`/`spawnEnemy`); release while iterating backwards. Entities come only from the pools; allocation stays limited to per-event objects (`FxEvent`s, kill records, a `waves` entry with its `Set`).
- Renderers, audio and UI read world state read-only and consume `World.fx`, drained once per frame after up to 5 steps. An `FxEvent` carries values (positions, amounts), never a pooled entity: it is recycled by the time the event is read.

## Saves

`RunState` is plain JSON in localStorage (`v: 1`), saved between levels only.

- Item, chassis, kill-type and constraint ids are save keys: add new ones, keep existing ones. `isValidRun` rejects a save holding an unknown item id, so renaming or removing an item discards players' runs.
- `ItemInstance.state` holds numbers only. A new `RunState` field, kill type or module kind loads from saves that lack it, or bumps `v` and the storage key.

## Text

Player-facing text (names, `desc`, `flavor`, taglines, labels, constraint text, trigger labels) is English; ids stay as they are, some French (`tir`, `renvoi`, `onde`, `faucon`…). `desc` uses the markup documented on `ItemDef.desc` — `{m:}` +Mult, `{b:}` Shards, `{x:}` ×Mult, `{$:}` money, `{k:}` keyword, `{g:}` gauge — and distances in m (world units). Numbers in a `desc` match the code; interpolate the constant when one exists.

## Tests

- `src/sim/sim.test.ts` — Rng forks, level determinism, win/timeout/hit rules, the score formula, relic order, Blueprint, Ritual Dagger, every relic surviving a bot level.
- `src/run/run.test.ts` — run creation, rewards and interest, shop buy/slots/refund/reroll/sell/reorder.
- `src/app/save.test.ts` — save round-trip, rejection of unknown ids.
- `src/ui/markup.test.ts` — every item `desc` parses cleanly.

A new effect gets a test asserting its exact number (`scoreOneKill` for `onKill` effects).
