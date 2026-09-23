import { LONG_RANGE, POINT_BLANK } from '../sim/constants';
import { type ItemDef, sellValue } from './types';

const st = (inst: { state: Record<string, number> } | undefined, key: string): number =>
  inst?.state[key] ?? 0;

/**
 * Relics = Balatro jokers. They plug into the score formula (Éclats × Mult) or bend a rule.
 * Families: flat, conditional, scaling, ×Mult, economy, rule-changer, copy, sacrifice.
 */
export const RELIC_ITEMS: ItemDef[] = [
  // ── Flat ────────────────────────────────────────────────────────────────────
  {
    id: 'mult_flat',
    kind: 'relic',
    name: 'Canon à Mult',
    glyph: '✚',
    color: '#ff4d6d',
    rarity: 'common',
    price: 4,
    desc: '{m:+3 Mult} sur chaque kill.',
    onKill(c, _k, s) {
      s.mult += 3;
      c.trigger();
    },
  },
  {
    id: 'base_flat',
    kind: 'relic',
    name: 'Collecteur',
    glyph: '◇',
    color: '#4dabff',
    rarity: 'common',
    price: 4,
    desc: '{b:+20 Éclats} sur chaque kill.',
    onKill(c, _k, s) {
      s.base += 20;
      c.trigger();
    },
  },
  // ── Conditional ─────────────────────────────────────────────────────────────
  {
    id: 'point_blank',
    kind: 'relic',
    name: 'Tête brûlée',
    glyph: '☄',
    color: '#ff7b39',
    rarity: 'common',
    price: 5,
    tags: ['impact', 'risk'],
    desc: `Kill à moins de ${POINT_BLANK} m : {m:+8 Mult}.`,
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
    name: 'Longue-vue',
    glyph: '⌖',
    color: '#5ad1ff',
    rarity: 'common',
    price: 5,
    tags: ['shots'],
    desc: `Kill à plus de ${LONG_RANGE} m : {b:+60 Éclats}.`,
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
    name: 'Chasseur de gros',
    glyph: '♜',
    color: '#ffb000',
    rarity: 'rare',
    price: 6,
    desc: 'Kills d’ennemis {k:lourds} et de {k:boss} : {x:×3 Mult}.',
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
    name: 'Ancrage',
    glyph: '⚓',
    color: '#7aa2ff',
    rarity: 'rare',
    price: 6,
    tags: ['shots'],
    desc: 'Immobile depuis 0,5 s : {x:×2 Mult} par kill.',
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
    name: 'Dernier souffle',
    glyph: '☽',
    color: '#c77dff',
    rarity: 'rare',
    price: 6,
    tags: ['risk'],
    desc: 'Quand il te reste {k:1 PV} : {x:×3 Mult}.',
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
    name: 'Frisson',
    glyph: '≈',
    color: '#ffd166',
    rarity: 'common',
    price: 5,
    tags: ['graze'],
    desc: 'Chaque {k:frôlement} : {g:+0,15} à la jauge Mult.',
    onGraze(c) {
      c.addGauge(0.15);
      c.trigger();
    },
  },
  {
    id: 'adrenaline',
    kind: 'relic',
    name: 'Adrénaline',
    glyph: '⚡︎',
    color: '#ffe14d',
    rarity: 'common',
    price: 5,
    tags: ['action'],
    desc: 'Chaque utilisation de l’{k:action} : {g:+0,3} à la jauge Mult.',
    onAction(c) {
      c.addGauge(0.3);
      c.trigger();
    },
  },
  {
    id: 'untouched',
    kind: 'relic',
    name: 'Invaincu',
    glyph: '⛨',
    color: '#6cf0c2',
    rarity: 'rare',
    price: 6,
    tags: ['defense'],
    desc: 'Toutes les 4 s sans être touché : {g:+0,5} à la jauge Mult.',
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
    name: 'Vétéran',
    glyph: '✪',
    color: '#ff8fab',
    rarity: 'rare',
    price: 6,
    tags: ['defense'],
    desc: (inst) =>
      `Gagne {m:+2 Mult} par kill à chaque niveau fini sans dégât. (actuel : {m:+${st(inst, 'bonus')} Mult})`,
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
    name: 'Pilleur',
    glyph: '⛃',
    color: '#ffd23f',
    rarity: 'common',
    price: 5,
    tags: ['economy'],
    desc: '{$:+$1} tous les 12 kills.',
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
    name: 'Épargnant',
    glyph: '⊕',
    color: '#ffe066',
    rarity: 'rare',
    price: 6,
    tags: ['economy'],
    desc: 'Plafond d’intérêts {$:+$5}.',
    modifyEconomy(e) {
      e.interestCap += 5;
    },
  },
  {
    id: 'speed_bonus',
    kind: 'relic',
    name: 'Prime de vitesse',
    glyph: '⏱︎',
    color: '#ffc14d',
    rarity: 'common',
    price: 4,
    tags: ['economy'],
    desc: 'Finir un niveau avec au moins 15 s restantes : {$:+$3}.',
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
    name: 'Surchauffe',
    glyph: '♨',
    color: '#ff6b35',
    rarity: 'common',
    price: 5,
    desc: '{k:+30%} de dégâts.',
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
    desc: 'Tes projectiles {k:rebondissent} une fois sur les bords.',
    modifyStats(s) {
      s.bounces += 1;
    },
  },
  {
    id: 'pierce',
    kind: 'relic',
    name: 'Perce-blindage',
    glyph: '⇶',
    color: '#74c0fc',
    rarity: 'common',
    price: 5,
    tags: ['shots'],
    desc: 'Tes projectiles {k:traversent} un ennemi de plus.',
    modifyStats(s) {
      s.pierce += 1;
    },
  },
  {
    id: 'magnet',
    kind: 'relic',
    name: 'Aimant',
    glyph: '⊂',
    color: '#ffa94d',
    rarity: 'common',
    price: 4,
    tags: ['graze'],
    desc: 'Rayon de {k:frôlement} {k:+60%}.',
    modifyStats(s) {
      s.grazeRadius *= 1.6;
    },
  },
  {
    id: 'cooldown',
    kind: 'relic',
    name: 'Accélérateur',
    glyph: '↻',
    color: '#69db7c',
    rarity: 'common',
    price: 4,
    tags: ['action'],
    desc: 'Ton {k:action} se recharge {k:35%} plus vite.',
    modifyStats(s) {
      s.actionRecharge += 0.35;
    },
  },
  {
    id: 'chain',
    kind: 'relic',
    name: 'Réaction en chaîne',
    glyph: '✺',
    color: '#ff922b',
    rarity: 'rare',
    price: 7,
    desc: 'Les ennemis détruits {k:explosent} et blessent leurs voisins (kills : {k:Réaction}).',
    modifyStats(s) {
      s.chainExplosions = true;
    },
  },
  {
    id: 'echo',
    kind: 'relic',
    name: 'Écho',
    glyph: '⧉',
    color: '#9775fa',
    rarity: 'rare',
    price: 6,
    desc: '1 chance sur 4 qu’un kill rapporte {x:2 fois} son score.',
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
    desc: 'Tous les 50 kills : {k:+1 PV}.',
    onKill(c) {
      const n = st(c.inst, 'n') + 1;
      c.inst.state.n = n;
      if (n % 50 === 0) {
        c.world.heal(1);
        c.trigger('+1 PV');
      }
    },
  },
  {
    id: 'bullet_time',
    kind: 'relic',
    name: 'Chronostase',
    glyph: '⧗',
    color: '#66d9e8',
    rarity: 'rare',
    price: 7,
    tags: ['graze'],
    desc: 'Un {k:frôlement de près} ralentit les ennemis et leurs balles pendant 0,7 s.',
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
    name: 'Élan',
    glyph: '➹',
    color: '#ff6b6b',
    rarity: 'rare',
    price: 6,
    tags: ['impact'],
    desc: 'Un kill pendant une {k:ruée} rend une charge. Kills {k:Impact} : {m:+4 Mult}.',
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
    name: 'Plan',
    glyph: '⎘',
    color: '#4dabf7',
    rarity: 'legendary',
    price: 10,
    noCopy: true,
    desc: 'Copie l’effet de la relique {k:à sa droite} (avec son propre compteur).',
  },
  {
    id: 'dagger',
    kind: 'relic',
    name: 'Dague rituelle',
    glyph: '†',
    color: '#fa5252',
    rarity: 'rare',
    price: 7,
    noCopy: true,
    tags: ['risk'],
    desc: (inst) =>
      `Début de niveau : détruit la relique {k:à sa droite} et gagne 2× sa valeur de revente en {m:Mult} par kill. (actuel : {m:+${st(inst, 'bonus')} Mult})`,
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
    name: 'Cœur de verre',
    glyph: '◊',
    color: '#a5d8ff',
    rarity: 'legendary',
    price: 9,
    tags: ['risk'],
    desc: '{x:×2,5 Mult} sur chaque kill. Tes PV max passent à {k:1}.',
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
    desc: 'Chaque {k:25e kill} du niveau : {x:×5 Mult} et une onde de choc gratuite.',
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
