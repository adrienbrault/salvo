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

/** Workshop items applied immediately on purchase (never occupy a slot). */
export const CALIBRATION_ITEMS: ItemDef[] = KILL_TYPES.map((kt) => ({
  id: `cal_${kt}`,
  kind: 'calibration',
  killType: kt,
  name: `Calibrage : ${KILL_TYPE_LABEL[kt]}`,
  glyph: CALIB_GLYPH[kt],
  color: CALIB_COLOR[kt],
  rarity: 'common',
  price: 3,
  desc: `Kills {k:${KILL_TYPE_LABEL[kt]}} : {b:+${CALIBRATION_BONUS.base} Éclats} et {m:+${CALIBRATION_BONUS.mult} Mult} (cumulable).`,
}));

export const MODULE_ITEMS: ItemDef[] = [
  {
    id: 'mod_damage',
    kind: 'module',
    name: 'Module de puissance',
    glyph: '▲',
    color: '#ff6b6b',
    rarity: 'common',
    price: 5,
    desc: '{k:+20%} de dégâts (cumulable).',
  },
  {
    id: 'mod_rate',
    kind: 'module',
    name: 'Module de cadence',
    glyph: '≡',
    color: '#4dabf7',
    rarity: 'common',
    price: 5,
    desc: '{k:+15%} de cadence de tir, de charge et de recharge (cumulable).',
  },
  {
    id: 'mod_hull',
    kind: 'module',
    name: 'Blindage de coque',
    glyph: '▣',
    color: '#adb5bd',
    rarity: 'common',
    price: 6,
    desc: '{k:+1 PV max} et répare {k:1 PV}.',
  },
  {
    id: 'repair',
    kind: 'module',
    name: 'Réparation',
    glyph: '✚',
    color: '#51cf66',
    rarity: 'common',
    price: 3,
    desc: 'Répare {k:1 PV}.',
  },
];
