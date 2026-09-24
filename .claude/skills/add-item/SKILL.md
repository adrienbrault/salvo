---
name: add-item
description: Add or change a SALVO item — relic, weapon, engine, core, calibration (kill type) or module: where the def goes, its hooks, description markup, rarity and price, tests and a balance check. Use when creating, reworking or retuning any shop item or starting equipment.
---

# Add or change an item

An item is an `ItemDef` (data, text, hooks) in `src/content/`; the sim calls its hooks. Rules, hook order and the per-weapon stat table: `docs/design.md`. Measuring: `docs/balancing.md`.

1. **Place the def.** By kind:
   - relic — `RELIC_ITEMS` in `src/content/relics.ts`, inside its family section;
   - engine or core — `ENGINE_ITEMS` / `CORE_ITEMS` in `src/content/equipment.ts`;
   - weapon — `WEAPON_ITEMS` in the same file, plus the weapon branch in step 2;
   - calibration — generated per kill type in `src/content/upgrades.ts`, so a new one is a new kill type (step 2);
   - module — `MODULE_ITEMS` in `src/content/upgrades.ts`, plus its effect in the `module` case of `buy()` in `src/run/shop.ts` (a stat module also needs a `RunState.modules` field that loads from saves lacking it, a `MODULE_EFFECT` entry and a line in `computeStats`).

   Adding to the array registers it: `ALL_ITEMS` spreads the arrays, relics and equipment join the shop pool, calibrations and modules the workshop. A new id is unique English `snake_case`; an existing id never changes (ids are save keys, and `isValidRun` discards saves with unknown ids). Done when `getItem(id)` returns the def.

2. **Wire the behaviour.** Effects go through the hooks (`onKill`, `onGraze`, `onHit`, `onAction`, `onTick`, `onLevelStart`, `onLevelEnd`) and `modifyStats` / `modifyEconomy`. `onKill` mutates `base`, `mult` and `repeats`; gauge and money go through `c.addGauge` / `c.addMoney`; randomness through `c.world.rng`. Call `c.trigger(label?)` whenever the effect visibly fires. Counters live in `c.inst.state` (numbers only), carry across levels unless reset in `onLevelStart`, and are per-copy under Blueprint; set `noCopy` when a copy would break the effect. A stat effect helps only the weapons that read that stat (design.md's table), and a stat that is *set* rather than added overrides everything applied before it.
   - A **weapon** also needs its id in `WeaponId` (`src/content/types.ts`), a `WeaponImpl` with its constant block in `src/sim/weapons.ts` registered in `WEAPONS`, its kill type in `WEAPON_KILL_TYPE` (`src/run/shop.ts` — typed `Record<string, …>`, so the compiler will not flag a missing entry), an action rhythm in `botInput` (`src/test/bot.ts`), and the presentation mappings keyed on weapon id: the action gauge in `Game.pushHud` and `src/ui/screens/Hud.tsx`, and `src/render/actors/PlayerShip.ts`. A chassis built on it goes in `CHASSIS`.
   - A **kill type** also needs `KillType`, `KILL_TYPES` and `KILL_TYPE_LABEL` (`src/sim/types.ts`), `CALIB_GLYPH` / `CALIB_COLOR` (`src/content/upgrades.ts`), `zeroByType` (`src/sim/world.ts`), the `calibrations` literal in `createRun`, and a load path for saves whose `calibrations` lack it (`buy()` increments the entry).

   Done when `bun run typecheck` passes and every place listed for the item's kind is updated.

3. **Write the text.** `name`, `desc` and an optional `flavor` are English. `desc` uses the markup `{m:+3 Mult}`, `{b:+20 Shards}`, `{x:×2 Mult}`, `{$:$1}`, `{k:keyword}`, `{g:+0.15}`, with braces only inside tags; kill types and mechanics go in `{k:}`, distances in m, and a weapon's `desc` ends with its kill type (`Kills: {k:Shot}.`). Interpolate a constant when one exists (`${POINT_BLANK}`); a counter-based relic uses `desc: (inst) => …` ending in `(now: …)`. `glyph` is one text-presentation character (append U+FE0E to emoji-prone symbols, as `⚡︎` does); `color` is a CSS hex accent. Done when every number the code uses appears in the description and matches it.

4. **Price it.** `rarity` sets the shop weight (`RARITY_WEIGHT`). Current bands: common relics $4–5, rare $6–7, legendary $9–10; equipment $5–7; calibrations $3; stat modules $5–6; Repair $3. The price also sets the sell value (half) and what Ritual Dagger banks. Done when rarity and price sit in the band of comparable items, or you can state why they differ.

5. **Test it.** An `onKill` effect gets a `scoreOneKill([...ids])` case in `src/sim/sim.test.ts` asserting the exact total — with a +Mult or ×Mult neighbour when order matters. A stat effect gets a `computeStats` assertion; an economy effect a `computeReward` or shop assertion in `src/run/run.test.ts`. Already automatic: every relic plays a bot level, every `desc` parses (`src/ui/markup.test.ts`). Done when changing the effect's number or its trigger condition makes a test fail.

6. **Measure it.** Run the inline A/B from `docs/balancing.md` (Measuring an item) with and without the item, on the chassis it targets, at the sector where it should matter. For a weapon, equipment or a shared number, also diff `bun scripts/balance.ts 4 6` before and after. Done when you can state the item's effect on score and clear time, and it fits the rarity and price from step 4.

7. **Gates.** `bun run check`. Done when it is green.
