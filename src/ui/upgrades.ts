/**
 * What a purchase did, and the upgrades it leaves behind: calibrations and modules change the
 * ship for good but take no slot, so the shop names them (toast, notes, chips).
 */
import { CHASSIS } from '../content/chassis';
import { WEAPON_ITEMS } from '../content/equipment';
import { getItem } from '../content/registry';
import type { ItemDef } from '../content/types';
import { CALIBRATION_BONUS } from '../content/upgrades';
import { type BuyResult, WEAPON_KILL_TYPE, weaponKillType } from '../run/shop';
import type { RunState } from '../run/state';
import { computeStats, MODULE_EFFECT } from '../sim/stats';
import { KILL_TYPE_LABEL, KILL_TYPES, type KillType } from '../sim/types';

const pct = (v: number): number => Math.round(v * 100);
const damagePct = (run: RunState): number => pct(run.modules.damage * MODULE_EFFECT.damage);
const ratePct = (run: RunState): number => pct(run.modules.rate * MODULE_EFFECT.rate);

/** The toast after a successful purchase, read from the run as it is now. */
export function purchaseMessage(run: RunState, def: ItemDef, res: BuyResult): string {
  const maxHp = computeStats(run).maxHp;
  switch (def.kind) {
    case 'relic':
      return `${def.name} joins your relics in slot ${run.loadout.relics.length}`;
    case 'weapon':
    case 'engine':
    case 'core': {
      const old = res.replaced ? getItem(res.replaced.id).name : null;
      return old ? `${def.name} equipped; ${old} sold back for $${res.refund ?? 0}` : `${def.name} equipped`;
    }
    case 'calibration': {
      const kt = def.killType;
      if (!kt) return `${def.name} bought`;
      const fit = killTypeFit(run, kt);
      const done = `${KILL_TYPE_LABEL[kt]} calibrated to level ${run.calibrations[kt]}`;
      return fit.fits
        ? `${done} for your ${fit.source}`
        : `${done}, but ${lower(fit.text).replace(/\.$/, '')}`;
    }
    case 'module':
      if (def.id === 'mod_damage') return `${def.name} installed: damage +${damagePct(run)}% in total`;
      if (def.id === 'mod_rate') return `${def.name} installed: rates +${ratePct(run)}% in total`;
      if (def.id === 'mod_hull') return `${def.name} installed: max HP ${maxHp}, hull ${run.hp}/${maxHp}`;
      if (def.id === 'repair') return `Hull repaired: ${run.hp}/${maxHp} HP`;
      return `${def.name} installed`;
  }
}

const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

export interface KillTypeFit {
  /** The ship makes kills of this type right now. */
  fits: boolean;
  /** What makes them (the weapon, or Chain Reaction for Reaction kills). */
  source: string;
  text: string;
}

/**
 * Whether the ship as equipped makes kills of type `kt`, and if not, which weapon (and starting
 * chassis) does: a calibration for a kill type the ship never makes buys nothing until it does.
 */
export function killTypeFit(run: RunState, kt: KillType): KillTypeFit {
  const label = KILL_TYPE_LABEL[kt];
  const weapon = getItem(run.loadout.weapon.id).name;
  if (weaponKillType(run) === kt)
    return { fits: true, source: weapon, text: `Your ${weapon} makes ${label} kills.` };
  if (kt === 'reaction' && computeStats(run).chainExplosions) {
    const chain = getItem('chain').name;
    return { fits: true, source: chain, text: `Your ${chain} makes ${label} kills.` };
  }
  const maker = WEAPON_ITEMS.find((w) => w.weapon && WEAPON_KILL_TYPE[w.weapon] === kt);
  const chassis = maker && CHASSIS.find((c) => c.weapon === maker.id);
  const payoff = maker ? `: pays off with the ${maker.name}${chassis ? ` (${chassis.name})` : ''}` : '';
  return { fits: false, source: weapon, text: `Your ${weapon} doesn’t make ${label} kills${payoff}.` };
}

/**
 * Where a workshop item stands in this run, as description markup: a calibration's level (see
 * killTypeFit for whether it pays off), a module's total, the hull. Null otherwise.
 */
export function upgradeNote(run: RunState, def: ItemDef): string | null {
  const kt = def.killType;
  if (def.kind === 'calibration' && kt) {
    const n = run.calibrations[kt];
    const label = KILL_TYPE_LABEL[kt];
    const level =
      n === 0
        ? `{k:${label}} level: 0.`
        : `{k:${label}} level ${n}: {b:+${n * CALIBRATION_BONUS.base} Shards} and {m:+${n * CALIBRATION_BONUS.mult} Mult} on each ${label} kill.`;
    return level;
  }
  const m = run.modules;
  const hull = `Hull: ${run.hp}/${computeStats(run).maxHp} HP.`;
  switch (def.id) {
    case 'mod_damage':
      return m.damage > 0 ? `Installed ${m.damage}×: {k:+${damagePct(run)}%} damage in total.` : null;
    case 'mod_rate':
      return m.rate > 0 ? `Installed ${m.rate}×: {k:+${ratePct(run)}%} rates in total.` : null;
    case 'mod_hull':
      return m.hull > 0
        ? `Installed ${m.hull}×: {k:+${m.hull * MODULE_EFFECT.hull} max HP} in total. ${hull}`
        : hull;
    case 'repair':
      return hull;
  }
  return null;
}

export interface OwnedUpgrade {
  /** The workshop item whose detail explains it. */
  id: string;
  label: string;
  value: string;
}

/** Calibrations and modules bought so far, for the shop's Upgrades row. */
export function ownedUpgrades(run: RunState): OwnedUpgrade[] {
  const out: OwnedUpgrade[] = [];
  for (const kt of KILL_TYPES) {
    const n = run.calibrations[kt];
    if (n > 0) out.push({ id: `cal_${kt}`, label: KILL_TYPE_LABEL[kt], value: `Lv ${n}` });
  }
  const m = run.modules;
  if (m.damage > 0) out.push({ id: 'mod_damage', label: 'Damage', value: `+${damagePct(run)}%` });
  if (m.rate > 0) out.push({ id: 'mod_rate', label: 'Rates', value: `+${ratePct(run)}%` });
  if (m.hull > 0) out.push({ id: 'mod_hull', label: 'Max HP', value: `+${m.hull * MODULE_EFFECT.hull}` });
  return out;
}
