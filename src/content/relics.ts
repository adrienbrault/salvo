import { LONG_RANGE, POINT_BLANK } from '../sim/constants';
import { type ItemDef, sellValue } from './types';

const st = (inst: { state: Record<string, number> } | undefined, key: string): number =>
  inst?.state[key] ?? 0;

/**
 * Relics = Balatro jokers. They plug into the score formula (Shards × Mult) or bend a rule.
 * Families: flat, conditional, scaling, ×Mult, economy, rule-changer, copy, sacrifice.
 */
export const RELIC_ITEMS: ItemDef[] = [
  // ── Flat ────────────────────────────────────────────────────────────────────
  {
    id: 'mult_flat',
    kind: 'relic',
    name: 'Mult Cannon',
    glyph: '✚',
    color: '#ff4d6d',
    rarity: 'common',
    price: 4,
    desc: '{m:+3 Mult} on every kill.',
    onKill(c, _k, s) {
      s.mult += 3;
      c.trigger();
    },
  },
  {
    id: 'base_flat',
    kind: 'relic',
    name: 'Collector',
    glyph: '◇',
    color: '#4dabff',
    rarity: 'common',
    price: 4,
    desc: '{b:+20 Shards} on every kill.',
    onKill(c, _k, s) {
      s.base += 20;
      c.trigger();
    },
  },
  // ── Conditional ─────────────────────────────────────────────────────────────
  {
    id: 'point_blank',
    kind: 'relic',
    name: 'Hothead',
    glyph: '☄',
    color: '#ff7b39',
    rarity: 'common',
    price: 5,
    tags: ['impact', 'risk'],
    desc: `Kills within ${POINT_BLANK} m: {m:+8 Mult}.`,
    onKill(c, k, s) {
      if (k.dist < POINT_BLANK) {
        s.mult += 8;
        c.trigger();
      }
    },
  },
  {
    id: 'sniper',
    kind: 'relic',
    name: 'Spyglass',
    glyph: '⌖',
    color: '#5ad1ff',
    rarity: 'common',
    price: 5,
    tags: ['shots'],
    desc: `Kills beyond ${LONG_RANGE} m: {b:+60 Shards}.`,
    onKill(c, k, s) {
      if (k.dist > LONG_RANGE) {
        s.base += 60;
        c.trigger();
      }
    },
  },
  {
    id: 'big_game',
    kind: 'relic',
    name: 'Big Game Hunter',
    glyph: '♜',
    color: '#ffb000',
    rarity: 'rare',
    price: 6,
    desc: '{k:Heavy} enemy and {k:boss} kills: {x:×3 Mult}.',
    onKill(c, k, s) {
      if (k.enemy.heavy) {
        s.mult *= 3;
        c.trigger();
      }
    },
  },
  {
    id: 'anchor',
    kind: 'relic',
    name: 'Anchor',
    glyph: '⚓',
    color: '#7aa2ff',
    rarity: 'rare',
    price: 6,
    tags: ['shots'],
    desc: 'Still for 0.5 s: {x:×2 Mult} per kill.',
    onKill(c, _k, s) {
      if (c.world.player.still >= 0.5) {
        s.mult *= 2;
        c.trigger();
      }
    },
  },
  {
    id: 'last_breath',
    kind: 'relic',
    name: 'Last Breath',
    glyph: '☽',
    color: '#c77dff',
    rarity: 'rare',
    price: 6,
    tags: ['risk'],
    desc: 'While at {k:1 HP}: {x:×3 Mult}.',
    onKill(c, _k, s) {
      if (c.world.player.hp === 1) {
        s.mult *= 3;
        c.trigger();
      }
    },
  },
  // ── Scaling (level gauge / persistent) ─────────────────────────────────────
  {
    id: 'graze_gauge',
    kind: 'relic',
    name: 'Thrill',
    glyph: '≈',
    color: '#ffd166',
    rarity: 'common',
    price: 5,
    tags: ['graze'],
    desc: 'Each {k:graze}: {g:+0.15} to the Mult gauge.',
    onGraze(c) {
      c.addGauge(0.15);
      c.trigger();
    },
  },
  {
    id: 'adrenaline',
    kind: 'relic',
    name: 'Adrenaline',
    glyph: '⚡︎',
    color: '#ffe14d',
    rarity: 'common',
    price: 5,
    tags: ['action'],
    desc: 'Each {k:action} use: {g:+0.3} to the Mult gauge.',
    onAction(c) {
      c.addGauge(0.3);
      c.trigger();
    },
  },
  {
    id: 'untouched',
    kind: 'relic',
    name: 'Untouchable',
    glyph: '⛨',
    color: '#6cf0c2',
    rarity: 'rare',
    price: 6,
    tags: ['defense'],
    desc: 'Every 4 s without a hit: {g:+0.5} to the Mult gauge.',
    onLevelStart(c) {
      c.inst.state.t = 0;
    },
    onTick(c, dt) {
      const t = st(c.inst, 't') + dt;
      if (t >= 4) {
        c.inst.state.t = t - 4;
        c.addGauge(0.5);
        c.trigger();
      } else {
        c.inst.state.t = t;
      }
    },
    onHit(c) {
      c.inst.state.t = 0;
    },
  },
  {
    id: 'veteran',
    kind: 'relic',
    name: 'Veteran',
    glyph: '✪',
    color: '#ff8fab',
    rarity: 'rare',
    price: 6,
    tags: ['defense'],
    desc: (inst) =>
      `Gains {m:+2 Mult} per kill for each level cleared without damage. (now: {m:+${st(inst, 'bonus')} Mult})`,
    onKill(c, _k, s) {
      const b = st(c.inst, 'bonus');
      if (b > 0) {
        s.mult += b;
        c.trigger();
      }
    },
    onLevelEnd(c, info) {
      if (info.won && info.damageTaken === 0) {
        c.inst.state.bonus = st(c.inst, 'bonus') + 2;
        c.trigger('+2');
      }
    },
  },
  // ── Economy ─────────────────────────────────────────────────────────────────
  {
    id: 'plunder',
    kind: 'relic',
    name: 'Plunderer',
    glyph: '⛃',
    color: '#ffd23f',
    rarity: 'common',
    price: 5,
    tags: ['economy'],
    desc: '{$:+$1} every 12 kills.',
    onKill(c) {
      const n = st(c.inst, 'n') + 1;
      c.inst.state.n = n;
      if (n % 12 === 0) {
        c.addMoney(1);
        c.trigger('+$1');
      }
    },
  },
  {
    id: 'saver',
    kind: 'relic',
    name: 'Nest Egg',
    glyph: '⊕',
    color: '#ffe066',
    rarity: 'rare',
    price: 6,
    tags: ['economy'],
    desc: 'Interest cap {$:+$5}.',
    modifyEconomy(e) {
      e.interestCap += 5;
    },
  },
  {
    id: 'speed_bonus',
    kind: 'relic',
    name: 'Speed Bonus',
    glyph: '⏱︎',
    color: '#ffc14d',
    rarity: 'common',
    price: 4,
    tags: ['economy'],
    desc: 'Clear a level with 15 s or more left: {$:+$3}.',
    onLevelEnd(c, info) {
      if (info.won && info.timeLeft >= 15) {
        c.addMoney(3);
        c.trigger('+$3');
      }
    },
  },
  // ── Rule changers ───────────────────────────────────────────────────────────
  {
    id: 'firepower',
    kind: 'relic',
    name: 'Overheat',
    glyph: '♨',
    color: '#ff6b35',
    rarity: 'common',
    price: 5,
    desc: '{k:+30%} damage.',
    modifyStats(s) {
      s.damageMul += 0.3;
    },
  },
  {
    id: 'ricochet',
    kind: 'relic',
    name: 'Ricochet',
    glyph: '⤨',
    color: '#63e6be',
    rarity: 'common',
    price: 4,
    tags: ['shots'],
    desc: 'Your shots {k:bounce} off the side walls once.',
    modifyStats(s) {
      s.bounces += 1;
    },
  },
  {
    id: 'pierce',
    kind: 'relic',
    name: 'Armor Piercer',
    glyph: '⇶',
    color: '#74c0fc',
    rarity: 'common',
    price: 5,
    tags: ['shots'],
    desc: 'Your shots {k:pierce} one more enemy.',
    modifyStats(s) {
      s.pierce += 1;
    },
  },
  {
    id: 'magnet',
    kind: 'relic',
    name: 'Magnet',
    glyph: '⊂',
    color: '#ffa94d',
    rarity: 'common',
    price: 4,
    tags: ['graze'],
    desc: '{k:Graze} and pickup radius {k:+60%}.',
    modifyStats(s) {
      s.grazeRadius *= 1.6;
    },
  },
  {
    id: 'cooldown',
    kind: 'relic',
    name: 'Accelerator',
    glyph: '↻',
    color: '#69db7c',
    rarity: 'common',
    price: 4,
    tags: ['action'],
    desc: 'Your {k:action} recharges {k:35%} faster.',
    modifyStats(s) {
      s.actionRecharge += 0.35;
    },
  },
  {
    id: 'chain',
    kind: 'relic',
    name: 'Chain Reaction',
    glyph: '✺',
    color: '#ff922b',
    rarity: 'rare',
    price: 7,
    desc: 'Destroyed enemies {k:explode}, hurting their neighbors (kills: {k:Reaction}).',
    modifyStats(s) {
      s.chainExplosions = true;
    },
  },
  {
    id: 'echo',
    kind: 'relic',
    name: 'Echo',
    glyph: '⧉',
    color: '#9775fa',
    rarity: 'rare',
    price: 6,
    desc: '1 in 4 chance for a kill to score {x:twice}.',
    onKill(c, _k, s) {
      if (c.world.rng.next() < 0.25) {
        s.repeats *= 2;
        c.trigger('×2');
      }
    },
  },
  {
    id: 'vampire',
    kind: 'relic',
    name: 'Vampire',
    glyph: '⚕',
    color: '#e64980',
    rarity: 'rare',
    price: 6,
    tags: ['defense'],
    desc: 'Every 50 kills: {k:+1 HP}.',
    onKill(c) {
      const n = st(c.inst, 'n') + 1;
      c.inst.state.n = n;
      if (n % 50 === 0) {
        c.world.heal(1);
        c.trigger('+1 HP');
      }
    },
  },
  {
    id: 'bullet_time',
    kind: 'relic',
    name: 'Chronostasis',
    glyph: '⧗',
    color: '#66d9e8',
    rarity: 'rare',
    price: 7,
    tags: ['graze'],
    desc: 'A {k:close graze} slows enemies and their bullets for 0.7 s.',
    onGraze(c, g) {
      if (g.close) {
        c.world.slowT = 0.7;
        c.trigger();
      }
    },
  },
  {
    id: 'momentum',
    kind: 'relic',
    name: 'Momentum',
    glyph: '➹',
    color: '#ff6b6b',
    rarity: 'rare',
    price: 6,
    tags: ['impact'],
    desc: 'A kill mid-{k:dash} refunds a charge. {k:Impact} kills: {m:+4 Mult}.',
    onKill(c, k, s) {
      const p = c.world.player;
      let fired = false;
      if (k.duringDash && p.charges < p.maxCharges) {
        p.charges++;
        fired = true;
      }
      if (k.killType === 'impact') {
        s.mult += 4;
        fired = true;
      }
      if (fired) c.trigger();
    },
  },
  // ── Legendary / sacrifice / copy ────────────────────────────────────────────
  {
    id: 'blueprint',
    kind: 'relic',
    name: 'Blueprint',
    glyph: '⎘',
    color: '#4dabf7',
    rarity: 'legendary',
    price: 10,
    noCopy: true,
    desc: 'Copies the effect of the relic {k:to its right} (with its own counters).',
  },
  {
    id: 'dagger',
    kind: 'relic',
    name: 'Ritual Dagger',
    glyph: '†',
    color: '#fa5252',
    rarity: 'rare',
    price: 7,
    noCopy: true,
    tags: ['risk'],
    desc: (inst) =>
      `Level start: destroys the relic {k:to its right} and gains 2× its sell value as {m:Mult} per kill. (now: {m:+${st(inst, 'bonus')} Mult})`,
    onLevelStart(c) {
      const relics = c.world.run.loadout.relics;
      const idx = relics.indexOf(c.inst);
      const victim = relics[idx + 1];
      if (idx >= 0 && victim) {
        relics.splice(idx + 1, 1);
        c.inst.state.bonus = st(c.inst, 'bonus') + 2 * sellValue(victim);
        c.trigger('†');
      }
    },
    onKill(c, _k, s) {
      const b = st(c.inst, 'bonus');
      if (b > 0) {
        s.mult += b;
        c.trigger();
      }
    },
  },
  {
    id: 'glass',
    kind: 'relic',
    name: 'Glass Heart',
    glyph: '◊',
    color: '#a5d8ff',
    rarity: 'legendary',
    price: 9,
    tags: ['risk'],
    desc: '{x:×2.5 Mult} on every kill. Your max HP drops to {k:1}.',
    modifyStats(s) {
      s.maxHp = 1;
    },
    onKill(c, _k, s) {
      s.mult *= 2.5;
      c.trigger();
    },
  },
  {
    id: 'supernova',
    kind: 'relic',
    name: 'Supernova',
    glyph: '✹',
    color: '#ffec99',
    rarity: 'legendary',
    price: 10,
    desc: 'Every {k:25th kill} of the level: {x:×5 Mult} and a free shockwave.',
    onKill(c, k, s) {
      if (k.killIndex % 25 === 0) {
        s.mult *= 5;
        const p = c.world.player;
        c.world.spawnWave(p.x, p.y, 42, 20 * c.world.stats.damageMul, 'onde', {
          cancels: true,
          hue: 'white',
        });
        c.trigger('×5');
      }
    },
  },
];
