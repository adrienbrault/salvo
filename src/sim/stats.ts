import { getItem, resolveRelicDef } from '../content/registry';
import type { EconomyStats } from '../content/types';
import type { RunState } from '../run/state';
import type { PlayerStats } from './types';

export const BASE_STATS: Readonly<PlayerStats> = {
  speed: 110,
  hitRadius: 1.25,
  grazeRadius: 7,
  maxHp: 3,
  damageMul: 1,
  rateMul: 1,
  actionRecharge: 1,
  pierce: 0,
  bounces: 0,
  gaugeGainMul: 1,
  chainExplosions: false,
};

export const BASE_ECONOMY: Readonly<EconomyStats> = {
  interestCap: 5,
  interestStep: 5,
  rerollBase: 4,
  levelRewardDelta: 0,
  timeBonusPer: 6,
};

/** Module upgrades bought in the workshop, per level. */
export const MODULE_EFFECT = { damage: 0.2, rate: 0.15, hull: 1 } as const;

/**
 * Stats = base → weapon → engine → core → modules → relics (left → right, Blueprint copies the next relic).
 * Order matters for relics that set values (Glass Heart sets max HP to 1 after everything else).
 */
export function computeStats(run: RunState): PlayerStats {
  const s: PlayerStats = { ...BASE_STATS };
  const lo = run.loadout;
  for (const inst of [lo.weapon, lo.engine, lo.core]) getItem(inst.id).modifyStats?.(s, inst);
  s.damageMul += run.modules.damage * MODULE_EFFECT.damage;
  s.rateMul += run.modules.rate * MODULE_EFFECT.rate;
  s.maxHp += run.modules.hull * MODULE_EFFECT.hull;
  lo.relics.forEach((inst, slot) => {
    resolveRelicDef(lo.relics, slot)?.modifyStats?.(s, inst);
  });
  s.maxHp = Math.max(1, s.maxHp);
  return s;
}

export function computeEconomy(run: RunState): EconomyStats {
  const e: EconomyStats = { ...BASE_ECONOMY };
  const lo = run.loadout;
  for (const inst of [lo.weapon, lo.engine, lo.core]) getItem(inst.id).modifyEconomy?.(e, inst);
  lo.relics.forEach((inst, slot) => {
    resolveRelicDef(lo.relics, slot)?.modifyEconomy?.(e, inst);
  });
  return e;
}
