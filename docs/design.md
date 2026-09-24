# Game design

SALVO puts Balatro's structure on a vertical shmup: each level is a timed score attack against a quota, and the shop between levels is where a run is won. Numbers and how to tune them are in `docs/balancing.md`; this file is the rules and the reasons behind them.

## The Balatro mapping

| Balatro | SALVO | Code |
| --- | --- | --- |
| Ante | Sector (4, then endless) | `SECTORS`; `LevelSpec.sector` is 0-based |
| Small / Big / Boss blind | Patrol / Offensive / Leviathan level | `LevelKind`: `small` / `big` / `boss` |
| Boss blind effect | Boss constraint | `src/sim/constraints.ts` |
| Chips | Shards (an enemy's value) | `Enemy.value`, `ScoreCalc.base` |
| Mult | Mult (the gauge plus item bonuses) | `ScoreCalc.mult` |
| Hand type | Kill type | `KillType` |
| Planet card | Calibration | `cal_<killType>` |
| Joker (ordered slots) | Relic (5 slots) | `RELIC_SLOTS` |
| Deck | Chassis (starting weapon + engine + core) | `src/content/chassis.ts` |

Level rewards, interest and the small/big/boss quota ratios echo Balatro's, so its intuitions transfer.

## The run

- 4 sectors × 3 levels (small, big, boss). Failing a level — timer out or HP 0 — ends the run; there are no retries.
- After the 4th boss the player may continue into endless: quotas grow geometrically (`QUOTA_ENDLESS_GROWTH` per sector) while enemy difficulty grows linearly, so endless always ends.
- HP is a run resource: damage carries across levels (`RunState.hp`); a sector clear repairs `SECTOR_HEAL`; otherwise HP comes back only through the workshop (Repair, Hull Plating) or Vampire.
- A shop opens after every cleared level, not only between sectors.
- Everything random derives from the run seed through labelled forks: constraints are fixed at run start, and each level's waves and each shop's rolls depend only on the seed and what the player has done.

## A level

- Reach the quota before the timer ends. A quota is `quotaBase(sector) × KIND_MUL[kind]`, rounded to two significant digits so it reads cleanly. The kill that reaches it wins instantly: remaining enemies explode without scoring and bullets vanish. Time left pays a bonus, so clearing fast is worth money.
- The `Director` accrues a spawn budget over time and spends it on formations; `MAX_ENEMIES` caps the screen. Sector difficulty (`difficultyFor`) scales enemy HP, bullet speed, fire rate, Shard value and spawn budget; big levels add HP and budget.
- Fairness rules, to keep when adding enemies or patterns: enemies fire only while comfortably on screen (`canFire`); a hit cancels bullets around the ship (`HIT_CLEAR_RADIUS`) and grants `HIT_INVULN`; mines burst into a ring on death, which makes killing them up close a risk you choose.
- Boss levels: the Leviathan (the same archetype in every sector) enters during the intro and fights in three HP phases; each phase change cancels every enemy bullet (breathing room and a payoff flash). The quota, not the boss kill, wins the level: the boss is a heavy, high-value target, and regular enemies keep spawning on a reduced budget. Body contact without a dash never damages it.

## Scoring

Each kill scores `round(base × mult) × repeats`, built in `World.killEnemy`:

1. `base` = the enemy's Shards + 15 per calibration level of the kill type.
2. `mult` = the level gauge + 1 per calibration level of the kill type.
3. Every item's `onKill` mutates `{ base, mult, repeats }`, in hook order.
4. After scoring, the gauge gains `GAUGE_PER_KILL`.

The **gauge** is the level's running Mult: it starts at 1 each level, grows with kills and gauge effects (`addGauge`, scaled by `gaugeGainMul` and the constraint's `gaugeMul`), never drops below 1, and loses half its bonus above 1 on every hit. It rewards streaks and clean play, and keeps an item-less ship viable early on.

**Mult shards** are the level's loot: every kill drops one (a heavy enemy 3, the boss 10), which bursts out, then falls through the field and off the bottom. Flying within the graze radius collects it into the gauge (`PICKUP_GAUGE`). They reward moving through the field rather than parking in a corner, and a hit halves the gauge they fed, so diving into a pattern for them is a risk the player chooses. Drops draw from their own seeded stream (`rng.fork('loot')`), so they never change a level's waves.

Three kinds of scoring effect, each with its markup: **gauge** (`{g:}`) lasts the level and feeds every later kill; **+Mult / +Shards** (`{m:}` / `{b:}`) apply to this kill only; **×Mult** (`{x:}`) multiplies this kill's Mult as it stands when the relic runs.

**Hook order** is weapon, engine, core (slot −1, their `trigger()` is silent), then relics left → right. Placement is the puzzle: a +Mult left of a ×Mult gets multiplied, the reverse does not — `sim.test.ts` pins (1 + 3) × 2.5 = 10 against 1 × 2.5 + 3 = 5.5. Stats follow the same order — base → weapon/engine/core → modules → relics — so a relic that *sets* a stat overrides everything before it (Glass Heart's max HP 1 wipes Armored Core and Hull Plating).

**Kill types** record how an enemy died; calibrations level them up:

| Id | Label | Sources |
| --- | --- | --- |
| `tir` | Shot | Blaster bolts and Salvo |
| `impact` | Impact | Ram dashes; ramming an enemy without a dash (which also hurts you) |
| `renvoi` | Reflect | Mirror release |
| `onde` | Wave | Grazer's Wave and graze sparks; Supernova's shockwave |
| `reaction` | Reaction | Chain Reaction explosions |

A weapon produces essentially one kill type, so calibrations and kill-type relics tie a build to its weapon; the workshop weights calibrations toward the equipped weapon's kill type.

## Weapons: the single action button

The player has one action (a second finger on touch, the mouse button, Space). The weapon defines both what the action does and how the ship deals damage, so the weapon *is* the play style. Each weapon's numbers sit in the constant block above it in `src/sim/weapons.ts`.

- **Blaster** (Falcon) — the baseline shooter. Twin bolts fire nonstop; the action is a Salvo, a wide fan of stronger bolts on a cooldown. Play: stay under targets, spend the Salvo on crowds. Kills: Shot. Pairs with Anchor, Spyglass, Armor Piercer, Ricochet.
- **Grazer** (Firefly) — never fires. Charge trickles in and jumps with every graze, and each graze sheds a homing spark. The action (above `minCharge`) releases a Wave whose radius and damage scale with charge and which cancels bullets. Play: dance close to bullets, release into crowds. Kills: Wave. Pairs with Magnet, Thrill, Chronostasis.
- **Mirror** (Prism) — never fires. Holding the action raises a shield that absorbs bullets, drains energy and slows the ship; releasing it (or running dry) sends back homing shots, two per absorbed bullet. Play: invite fire, then release into formations; more enemy bullets means more damage. Kills: Reflect.
- **Ram** (Bull) — never fires. The action dashes in the movement direction (straight up when still): invulnerable, shreds bullets, hits each enemy once per dash. Charges refill over time. Play: close-range aggression. Kills: Impact. Pairs with Hothead, Momentum.

Stat multipliers reach each weapon differently; check this before writing an item that claims to help "your weapon":

| Stat | Blaster | Grazer | Mirror | Ram |
| --- | --- | --- | --- | --- |
| `damageMul` | bolts, Salvo | Wave, sparks | reflected shots | dash |
| `rateMul` | auto-fire rate | passive and graze charge | shield regen | charge refill |
| `actionRecharge` | Salvo cooldown | — | shield regen | charge refill |
| `pierce`, `bounces` | bolts | sparks | reflected shots | — |

## Chassis and equipment

A chassis is a Balatro deck: the starting weapon, engine and core. Equipment is replaceable from the shop, so a chassis is a starting identity, not a lock. Falcon is the learning ship; Firefly pairs the Grazer with the Micro-reactor (small hitbox, large graze radius); Prism and Bull, whose weapons play close to danger, take the Armored Core (more HP, lower level reward), and Bull adds the Afterburner (fast, larger hitbox). Engines trade speed, hitbox and graze radius; cores trade HP against money or the gauge (Unstable Core: less HP, doubled gauge gains; Merchant Core: higher interest cap, cheaper rerolls).

## Relics

Relics are jokers: they plug into the score formula or bend a rule. The families are the sections of `src/content/relics.ts`:

- **Flat** — +Mult or +Shards on every kill.
- **Conditional** — a bonus while a situation holds: kill distance (`POINT_BLANK`, `LONG_RANGE`), heavy or boss target, standing still, 1 HP.
- **Scaling** — gauge feeders (grazes, action uses, time without a hit) and persistent growth (Veteran, per damage-free level).
- **Economy** — money during or after a level, a higher interest cap.
- **Rule changers** — stats (damage, pierce, bounces, graze radius, action recharge) and new mechanics (Chain Reaction, Echo, Vampire, Chronostasis, Momentum).
- **Copy** — Blueprint applies the next relic to its right, with its own counters; a chain of Blueprints resolves to the first non-Blueprint, and `noCopy` blocks copying.
- **Sacrifice** — Ritual Dagger destroys its right neighbour at level start and banks twice its sell value as permanent +Mult.
- **Legendary ×Mult** — Glass Heart, Supernova.

Risk is a deliberate axis: the strongest multipliers cost survivability (Glass Heart, Last Breath, Unstable Core, Hothead's point-blank range).

Counters live in `inst.state` (numbers, saved with the run). A relic that should reset each level resets in `onLevelStart` (Untouchable); everything else carries across levels (Plunderer's and Vampire's kill counts, Veteran's and Ritual Dagger's bonus). Supernova keys on the level's `killIndex`. A relic calls `c.trigger(label?)` when it visibly fires: that pulses its HUD slot and counts toward the level recap.

## Shop and economy

The reward for a cleared level is the level's base reward (adjusted by `levelRewardDelta`) + a time bonus (per `timeBonusPer` seconds left, capped by `MAX_TIME_BONUS`) + interest ($1 per `interestStep` held, up to `interestCap`). Interest counts the money held when the level ends, before the reward, including money earned during the level. Holding money pays, so every purchase competes with compounding.

- **Offers** — `OFFER_COUNT` items; each slot is equipment with `EQUIPMENT_CHANCE`, otherwise a relic, weighted by `RARITY_WEIGHT`; owned items never appear. Prices are the defs' `price`, flat across sectors.
- **Reroll** — rerolls the offers only; the cost starts at `rerollBase` and rises by $1 per reroll within the same shop.
- **Workshop** (never rerolled) — a calibration weighted toward the weapon's kill type, a random stat module, and Repair when hurt (a second calibration otherwise). Calibrations and modules apply on purchase and take no slot.
- **Selling** — relics sell for half the price paid (at least $1); replacing equipment refunds the old piece the same way. Selling is how a build pivots, and the paid price is what Ritual Dagger feeds on.

## Boss constraints

Balatro's boss blinds: each sector's boss level carries one constraint, rolled from the seed at run start (never the same twice in a row, gated by `minSector`) and shown on the sector map before the shops, so the player can buy around it. A constraint needs a counterplay the shop can supply — Frontal Armor's text names its own (strike at an angle, ram or reflect). Mechanically it either tunes the level's `Difficulty` (`tune`: Overdrive, Colossus, Swarm) or sets a field the world reads (`armoredFront`, `mirrorChance`, `blackout`, `gaugeMul`); `fogRadius` is read only by the renderer, so Fog changes nothing in the sim or the bot. Constraints are rolled for `SECTORS + 8` sectors; endless bosses beyond that have none.
