# Balancing

Balance is measured, not guessed. The sim is deterministic, so a headless bot replays a level exactly: any change in its numbers comes from your change. The rules the numbers serve are in `docs/design.md`.

## The bot

`playLevel(run, { godMode })` in `src/test/bot.ts` builds the run's current level and plays it with `botInput`, which sways at the bottom of the field under the lowest enemy and fires the action on a fixed per-weapon rhythm. Its blind spots:

- **God mode measures scoring potential, not survival.** It sets `invuln` every tick, so the bot is never hit: the gauge never halves, Untouchable's reset never happens, and Last Breath fires only through Glass Heart's 1 max HP. Difficulty (bullet density, patterns, fairness) needs a human in the browser (`docs/browser-testing.md`).
- **Its play is crude.** It collects Mult shards only when they fall into its path. It never grazes on purpose and fires its action on a timer (Mirror holds 1.4 s of every 2.2 s; Ram dashes every 50 ticks), whatever is on screen. Compare a chassis with its own earlier numbers, never with another chassis.
- **It plays single levels.** No shop, no `applyLevelResult`: rewards, interest and `onLevelEnd` hooks never run, so the economy is not simulated.

## The report

`bun scripts/balance.ts [sectors=2] [seeds=3]` plays every chassis on every level of the first `sectors` sectors, averaged over seeds `BAL0`, `BAL1`…, with the fresh starting loadout (no relics, calibrations or modules) in god mode. It takes a second or two; use `4 6` or more before deciding anything.

A fresh loadout makes it a measure of the gap the build must fill: how far each naked chassis gets against the quota curve. Reading it:

- **`% quota`** — a won level stops at the quota, so winning rows read about 100% (boss rows overshoot by the boss kill). The number means something on losing rows: how far short.
- **`time`** — includes the intro and the outro, so a row that timed out on every seed reads duration + 3.8 s (43.8 / 48.8 / 63.8). On winning rows, lower means more headroom.
- **`result`** — wins / seeds.
- **Boss rows are noisier**: each seed rolls its own constraints, so a boss row averages different constraints.
- The output is byte-identical between runs of the same code: `diff` a before and after.

The intended shape (`src/run/levels.ts`): quotas outgrow a naked ship's output on purpose, so the build must scale the Mult. Today naked Falcon clears sectors 1–2 (its sector-2 boss about half the time) and falls short from sector 3 on; a change that moves this wall is a design change, not a tuning one.

## Measuring an item

The report has no item option; A/B a loadout inline from the repo root (arguments: chassis, level as `sector-level`, relic ids):

```sh
bun -e "
import { createRun } from './src/run/run';
import { newInstance } from './src/run/state';
import { playLevel } from './src/test/bot';
const [chassis, level, ...ids] = process.argv.slice(1);
const [sector, index] = level!.split('-').map((n) => Number(n) - 1);
for (const relics of [[], ids]) {
  let score = 0, time = 0, wins = 0;
  for (let k = 0; k < 6; k++) {
    const run = createRun('BAL' + k, chassis!);
    run.sector = sector!; run.level = index!;
    for (const id of relics) run.loadout.relics.push(newInstance(run, id, 0));
    const w = playLevel(run, { godMode: true });
    score += w.score; time += w.time; if (w.result === 'won') wins++;
  }
  console.log(relics.join('+') || 'none', Math.round(score / 6), (time / 6).toFixed(1) + 's', wins + '/6');
}" faucon 3-1 mult_flat glass
```

The `none` line matches the report's row for that level. Equipment, calibrations and modules go in the same way: replace `run.loadout.weapon` / `engine` / `core` with `newInstance(run, id, 0)`, or set `run.calibrations.tir` / `run.modules.damage`.

## Where the numbers live

| Numbers | Home |
| --- | --- |
| Quotas and endless growth, level-kind multipliers, durations, base rewards | `src/run/levels.ts` |
| Start money, sector heal, time-bonus cap | `src/run/run.ts` |
| Interest, reroll base, time-bonus step (`BASE_ECONOMY`); ship stats (`BASE_STATS`); module effects (`MODULE_EFFECT`) | `src/sim/stats.ts` |
| Offer count, equipment chance, rarity weights, workshop weighting | `src/run/shop.ts` |
| Item prices and rarities | each def in `src/content/` |
| Per-sector difficulty, big/boss modifiers | `difficultyFor` in `src/sim/level.ts`; constraints' `tune` |
| Enemy HP, Shard value and patterns; the boss | `src/sim/enemies.ts`, `src/sim/boss.ts` |
| Spawn budget, formation costs and weights, enemy cap | `src/sim/director.ts` |
| Weapon numbers | the constant block above each weapon in `src/sim/weapons.ts` |
| Gauge, Mult shards (drops, value, fall speed), hit and level-timing constants | `src/sim/constants.ts` |

## Coupled numbers

Change these together:

- **Descriptions quote numbers.** A few interpolate the constant (`POINT_BLANK`, `LONG_RANGE`, `CALIBRATION_BONUS`); most hardcode it: weapon descs (Salvo size and cooldown, Ram charges) against `BLASTER` / `RAM`, module descs against `MODULE_EFFECT`, constraint `desc` against its fields and `tune`, every relic and core desc against its own code.
- **Calibration bonus** — `World.killEnemy` hardcodes `lvl * 15` and `gauge + lvl`; `CALIBRATION_BONUS` feeds only the description and the UI. Change both.
- **Starting equipment** — `createRun` hardcodes the starting pieces' `paid` (7 / 5 / 6), which sets their refund when replaced; keep it equal to their prices.
- **Weapon → kill type** — `WEAPON_KILL_TYPE` in `src/run/shop.ts` (the workshop's calibration weighting) repeats the kill type each weapon deals.
- **Bot rhythm** — `botInput`'s action timing is tuned to each weapon's cooldown or charge; change an action's timing and retune the bot, or the report measures the bot.
- **Quotas against output** — raw output per level grows with `valueMul` (Shards) and `budgetMul` (enemy count) in `difficultyFor`; quotas must outgrow both to keep the build necessary.
- **Tests pin numbers.** Falcon must clear level 1-1 in god mode (`sim.test.ts`; `run.test.ts` builds its shop on that win). Scoring tests pin Mult Cannon +3, Glass Heart ×2.5, Blueprint and the Dagger's 2× sell value; `run.test.ts` pins the interest cap (5, 10 with Nest Egg), the $3 refund of a $7 weapon and the +$1 reroll step.

## Procedure

1. Baseline before editing: `bun scripts/balance.ts 4 6 > "$TMPDIR/before.txt"`, plus an inline A/B for any item involved.
2. Change the number and everything coupled to it above.
3. Re-run into `after.txt` and `diff`. Read losing rows by `% quota` and winning rows by `time`, on every chassis, not only the one you targeted.
4. `bun run check`. A pinned test that fails is a decision: update it only when the new number is the intended one.
5. Play anything the bot cannot judge — survival, readability, feel — in the browser.
