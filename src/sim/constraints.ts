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
    name: 'Blindage frontal',
    glyph: '⛉',
    desc: 'Les tirs verticaux ne font que 25% de dégâts. Attaque de biais, fonce, ou renvoie.',
    minSector: 0,
    armoredFront: 0.25,
  },
  mirror: {
    id: 'mirror',
    name: 'Coques miroir',
    glyph: '◩',
    desc: '1 tir sur 4 qui touche un ennemi repart vers toi.',
    minSector: 0,
    mirrorChance: 0.25,
  },
  fog: {
    id: 'fog',
    name: 'Brouillard',
    glyph: '▒',
    desc: 'Les balles ennemies sont invisibles à plus de 30 m de toi.',
    minSector: 0,
    fogRadius: 30,
  },
  blackout: {
    id: 'blackout',
    name: 'Silence radio',
    glyph: '⌁',
    desc: 'Toutes les 10 s, ton arme et ton action sont coupées pendant 3 s.',
    minSector: 1,
    blackout: { period: 10, duration: 3 },
  },
  haste: {
    id: 'haste',
    name: 'Surrégime',
    glyph: '»',
    desc: 'Les balles ennemies vont 35% plus vite.',
    minSector: 0,
    tune: (d) => {
      d.bulletSpeed *= 1.35;
    },
  },
  colossus: {
    id: 'colossus',
    name: 'Colosse',
    glyph: '⬢',
    desc: 'Les ennemis ont 60% de PV en plus.',
    minSector: 1,
    tune: (d) => {
      d.hpMul *= 1.6;
    },
  },
  austerity: {
    id: 'austerity',
    name: 'Austérité',
    glyph: '÷',
    desc: 'Tous les gains de jauge Mult sont divisés par 2.',
    minSector: 1,
    gaugeMul: 0.5,
  },
  swarm: {
    id: 'swarm',
    name: 'Essaim',
    glyph: '⁂',
    desc: 'Deux fois plus d’ennemis, mais 40% de PV en moins.',
    minSector: 0,
    tune: (d) => {
      d.budgetMul *= 2;
      d.hpMul *= 0.6;
    },
  },
};

export const CONSTRAINT_IDS = Object.keys(CONSTRAINTS) as ConstraintId[];
