/**
 * Boss-level constraints (Balatro "boss blinds"). Announced on the sector map,
 * before the shops, so the player can buy around them.
 */

export type ConstraintId =
  | 'armored'
  | 'mirror'
  | 'fog'
  | 'blackout'
  | 'haste'
  | 'colossus'
  | 'austerity'
  | 'swarm';

export interface Difficulty {
  hpMul: number;
  bulletSpeed: number;
  fireRate: number;
  valueMul: number;
  budgetMul: number;
}

export interface ConstraintDef {
  id: ConstraintId;
  name: string;
  glyph: string;
  desc: string;
  /** Lowest sector index (0-based) where it may appear. */
  minSector: number;
  tune?(d: Difficulty): void;
  /** Vertical player shots deal this damage fraction. */
  armoredFront?: number;
  /** Chance a player shot hitting an enemy is sent back at the player. */
  mirrorChance?: number;
  /** Enemy bullets are invisible beyond this distance from the player. */
  fogRadius?: number;
  /** Weapon and action disabled `duration` seconds every `period`. */
  blackout?: { period: number; duration: number };
  gaugeMul?: number;
}

export const CONSTRAINTS: Record<ConstraintId, ConstraintDef> = {
  armored: {
    id: 'armored',
    name: 'Frontal Armor',
    glyph: '⛉',
    desc: 'Vertical shots deal only 25% damage. Strike at an angle, ram, or reflect.',
    minSector: 0,
    armoredFront: 0.25,
  },
  mirror: {
    id: 'mirror',
    name: 'Mirror Hulls',
    glyph: '◩',
    desc: '1 in 4 shots that hit an enemy bounce back at you.',
    minSector: 0,
    mirrorChance: 0.25,
  },
  fog: {
    id: 'fog',
    name: 'Fog',
    glyph: '▒',
    desc: 'Enemy bullets are invisible more than 30 m away from you.',
    minSector: 0,
    fogRadius: 30,
  },
  blackout: {
    id: 'blackout',
    name: 'Radio Silence',
    glyph: '⌁',
    desc: 'Every 10 s, your weapon and action cut out for 3 s.',
    minSector: 1,
    blackout: { period: 10, duration: 3 },
  },
  haste: {
    id: 'haste',
    name: 'Overdrive',
    glyph: '»',
    desc: 'Enemy bullets fly 35% faster.',
    minSector: 0,
    tune: (d) => {
      d.bulletSpeed *= 1.35;
    },
  },
  colossus: {
    id: 'colossus',
    name: 'Colossus',
    glyph: '⬢',
    desc: 'Enemies have 60% more HP.',
    minSector: 1,
    tune: (d) => {
      d.hpMul *= 1.6;
    },
  },
  austerity: {
    id: 'austerity',
    name: 'Austerity',
    glyph: '÷',
    desc: 'All Mult gauge gains are halved.',
    minSector: 1,
    gaugeMul: 0.5,
  },
  swarm: {
    id: 'swarm',
    name: 'Swarm',
    glyph: '⁂',
    desc: 'Twice the enemies, but 40% less HP.',
    minSector: 0,
    tune: (d) => {
      d.budgetMul *= 2;
      d.hpMul *= 0.6;
    },
  },
};

export const CONSTRAINT_IDS = Object.keys(CONSTRAINTS) as ConstraintId[];
