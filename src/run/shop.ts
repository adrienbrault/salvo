import { EQUIPMENT, getItem, RELICS } from '../content/registry';
import { type ItemDef, type ItemInstance, type Rarity, sellValue } from '../content/types';
import { CALIBRATION_ITEMS, MODULE_ITEMS } from '../content/upgrades';
import { Rng } from '../sim/rng';
import { computeEconomy, computeStats } from '../sim/stats';
import type { KillType } from '../sim/types';
import { newInstance, RELIC_SLOTS, type RunState, type ShopOffer, type ShopState } from './state';

export const OFFER_COUNT = 3;
export const EQUIPMENT_CHANCE = 0.24;
export const RARITY_WEIGHT: Record<Rarity, number> = { common: 70, rare: 25, legendary: 5 };

const WEAPON_KILL_TYPE: Record<string, KillType> = {
  blaster: 'tir',
  grazer: 'onde',
  mirror: 'renvoi',
  ram: 'impact',
};

/** The kill type the equipped weapon scores (the workshop favours its calibration). */
export const weaponKillType = (run: RunState): KillType =>
  WEAPON_KILL_TYPE[getItem(run.loadout.weapon.id).weapon ?? 'blaster'] ?? 'tir';

const shopRng = (run: RunState, label: string): Rng =>
  new Rng(run.seed).fork(`shop-${run.shopVisits}-${label}`);

function ownedIds(run: RunState): Set<string> {
  const lo = run.loadout;
  return new Set([lo.weapon.id, lo.engine.id, lo.core.id, ...lo.relics.map((r) => r.id)]);
}

function rollOffers(run: RunState, rng: Rng): ShopOffer[] {
  const owned = ownedIds(run);
  const picked = new Set<string>();
  const offers: ShopOffer[] = [];
  for (let i = 0; i < OFFER_COUNT; i++) {
    const wantEquipment = rng.next() < EQUIPMENT_CHANCE;
    const pool: readonly ItemDef[] = (wantEquipment ? EQUIPMENT : RELICS).filter(
      (d) => !owned.has(d.id) && !picked.has(d.id),
    );
    if (pool.length === 0) continue;
    const def = rng.weighted(pool, (d) => RARITY_WEIGHT[d.rarity]);
    picked.add(def.id);
    offers.push({ id: def.id, price: def.price });
  }
  return offers;
}

function rollWorkshop(run: RunState, rng: Rng): ShopOffer[] {
  const weaponType = weaponKillType(run);
  const calib = rng.weighted(CALIBRATION_ITEMS, (d) => (d.killType === weaponType ? 5 : 1));
  const modules = MODULE_ITEMS.filter((d) => d.id !== 'repair');
  const mod = rng.pick(modules);
  const hurt = run.hp < computeStats(run).maxHp;
  const third = hurt ? getItem('repair') : rng.pick(CALIBRATION_ITEMS.filter((d) => d.id !== calib.id));
  return [calib, mod, third].map((d) => ({ id: d.id, price: d.price }));
}

export function generateShop(run: RunState): ShopState {
  return {
    offers: rollOffers(run, shopRng(run, 'offers-0')),
    workshop: rollWorkshop(run, shopRng(run, 'workshop')),
    rerolls: 0,
  };
}

export function rerollCost(run: RunState): number {
  const eco = computeEconomy(run);
  return Math.max(0, eco.rerollBase + (run.shop?.rerolls ?? 0));
}

export function reroll(run: RunState): boolean {
  const shop = run.shop;
  if (!shop) return false;
  const cost = rerollCost(run);
  if (run.money < cost) return false;
  run.money -= cost;
  shop.rerolls++;
  shop.offers = rollOffers(run, shopRng(run, `offers-${shop.rerolls}`));
  return true;
}

export type BuyError = 'money' | 'slots' | 'sold' | 'full-hp';

export interface BuyResult {
  ok: boolean;
  error?: BuyError;
  /** Equipment that was replaced (refunded at sell value). */
  replaced?: ItemInstance;
  refund?: number;
}

export function canBuy(run: RunState, offer: ShopOffer): BuyError | null {
  if (!offer.id) return 'sold';
  const def = getItem(offer.id);
  if (run.money < offer.price) return 'money';
  if (def.kind === 'relic' && run.loadout.relics.length >= RELIC_SLOTS) return 'slots';
  if (def.id === 'repair' && run.hp >= computeStats(run).maxHp) return 'full-hp';
  return null;
}

export function buy(run: RunState, area: 'offers' | 'workshop', index: number): BuyResult {
  const shop = run.shop;
  const offer = shop?.[area][index];
  if (!shop || !offer) return { ok: false, error: 'sold' };
  const err = canBuy(run, offer);
  if (err) return { ok: false, error: err };
  const def = getItem(offer.id!);
  run.money -= offer.price;
  offer.id = null;

  const lo = run.loadout;
  const result: BuyResult = { ok: true };
  switch (def.kind) {
    case 'relic':
      lo.relics.push(newInstance(run, def.id, offer.price));
      break;
    case 'weapon':
    case 'engine':
    case 'core': {
      const old = lo[def.kind];
      const refund = sellValue(old);
      lo[def.kind] = newInstance(run, def.id, offer.price);
      run.money += refund;
      result.replaced = old;
      result.refund = refund;
      run.hp = Math.min(run.hp, computeStats(run).maxHp);
      if (run.hp <= 0) run.hp = 1;
      break;
    }
    case 'calibration':
      if (def.killType) run.calibrations[def.killType]++;
      break;
    case 'module':
      if (def.id === 'mod_damage') run.modules.damage++;
      else if (def.id === 'mod_rate') run.modules.rate++;
      else if (def.id === 'mod_hull') {
        run.modules.hull++;
        run.hp = Math.min(computeStats(run).maxHp, run.hp + 1);
      } else if (def.id === 'repair') run.hp = Math.min(computeStats(run).maxHp, run.hp + 1);
      break;
  }
  // Max HP may have changed (e.g. Glass Heart): keep HP within bounds.
  run.hp = Math.min(run.hp, computeStats(run).maxHp);
  return result;
}

export function sellRelic(run: RunState, index: number): number {
  const inst = run.loadout.relics[index];
  if (!inst) return 0;
  const value = sellValue(inst);
  run.loadout.relics.splice(index, 1);
  run.money += value;
  return value;
}

/** Reorder relics (left → right trigger order matters). */
export function moveRelic(run: RunState, from: number, to: number): void {
  const relics = run.loadout.relics;
  if (from === to || from < 0 || to < 0 || from >= relics.length || to >= relics.length) return;
  const [it] = relics.splice(from, 1);
  relics.splice(to, 0, it!);
}
