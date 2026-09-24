import { KILL_TYPE_LABEL, KILL_TYPES, type KillType } from '../sim/types';
import type { ItemDef } from './types';

/** Calibration bonus per level (Balatro planets): applied to kills of that type. */
export const CALIBRATION_BONUS = { base: 15, mult: 1 } as const;

const CALIB_GLYPH: Record<KillType, string> = {
  tir: '⇡',
  impact: '⟫',
  renvoi: '⟲',
  onde: '◌',
  reaction: '✺',
};

const CALIB_COLOR: Record<KillType, string> = {
  tir: '#4de8ff',
  impact: '#ff5d73',
  renvoi: '#e8e8ff',
  onde: '#ffd166',
  reaction: '#ff922b',
};

/** What counts as a kill of each type, in plain words (the sources are in docs/design.md). */
export const KILL_TYPE_SOURCE: Record<KillType, string> = {
  tir: 'A Shot kill is an enemy destroyed by your shots: Blaster bolts and the Salvo.',
  impact:
    'An Impact kill is an enemy you ram: with the Ram’s dash, or by flying into it (without a dash, that hurts you too).',
  renvoi: 'A Reflect kill is an enemy destroyed by the bullets your Mirror sends back.',
  onde: 'A Wave kill is an enemy destroyed by a Wave: the Grazer’s Wave and graze sparks, or Supernova’s shockwave.',
  reaction: 'A Reaction kill is an enemy destroyed by a Chain Reaction explosion.',
};

/** Workshop items applied immediately on purchase (never occupy a slot). */
export const CALIBRATION_ITEMS: ItemDef[] = KILL_TYPES.map((kt) => ({
  id: `cal_${kt}`,
  kind: 'calibration',
  killType: kt,
  name: `Calibration: ${KILL_TYPE_LABEL[kt]}`,
  glyph: CALIB_GLYPH[kt],
  color: CALIB_COLOR[kt],
  rarity: 'common',
  price: 3,
  desc: `{k:${KILL_TYPE_LABEL[kt]}} kills: {b:+${CALIBRATION_BONUS.base} Shards} and {m:+${CALIBRATION_BONUS.mult} Mult} (stacks). ${KILL_TYPE_SOURCE[kt]}`,
}));

export const MODULE_ITEMS: ItemDef[] = [
  {
    id: 'mod_damage',
    kind: 'module',
    name: 'Power Module',
    glyph: '▲',
    color: '#ff6b6b',
    rarity: 'common',
    price: 5,
    desc: '{k:+20%} damage (stacks).',
  },
  {
    id: 'mod_rate',
    kind: 'module',
    name: 'Rate Module',
    glyph: '≡',
    color: '#4dabf7',
    rarity: 'common',
    price: 5,
    desc: '{k:+15%} fire rate, charge rate and recharge speed (stacks).',
  },
  {
    id: 'mod_hull',
    kind: 'module',
    name: 'Hull Plating',
    glyph: '▣',
    color: '#adb5bd',
    rarity: 'common',
    price: 6,
    desc: '{k:+1 max HP} and repairs {k:1 HP}.',
  },
  {
    id: 'repair',
    kind: 'module',
    name: 'Repair',
    glyph: '✚',
    color: '#51cf66',
    rarity: 'common',
    price: 3,
    desc: 'Repairs {k:1 HP}.',
  },
];
