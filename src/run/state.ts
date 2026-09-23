import type { ItemInstance } from '../content/types';
import type { ConstraintId } from '../sim/constraints';
import type { KillType } from '../sim/types';

export const RELIC_SLOTS = 5;
export const SECTORS = 4;
export const LEVELS_PER_SECTOR = 3;

export interface Loadout {
  weapon: ItemInstance;
  engine: ItemInstance;
  core: ItemInstance;
  /** Order matters: hooks run left → right. */
  relics: ItemInstance[];
}

export interface RunStats {
  kills: number;
  bestKill: number;
  totalScore: number;
  levelsCleared: number;
  damageTaken: number;
  moneyEarned: number;
  grazes: number;
}

export interface ShopOffer {
  /** Item id, or null once bought. */
  id: string | null;
  price: number;
}

export interface ShopState {
  offers: ShopOffer[];
  workshop: ShopOffer[];
  rerolls: number;
}

/** Entire run, plain JSON — saved to localStorage between levels. */
export interface RunState {
  v: 1;
  seed: string;
  chassis: string;
  sector: number;
  level: number;
  money: number;
  hp: number;
  loadout: Loadout;
  calibrations: Record<KillType, number>;
  modules: { damage: number; rate: number; hull: number };
  /** Boss constraint for each sector, rolled at run start. */
  constraints: ConstraintId[];
  nextUid: number;
  stats: RunStats;
  shop: ShopState | null;
  shopVisits: number;
  /** Continue past the last sector. */
  endless: boolean;
}

export function newInstance(run: Pick<RunState, 'nextUid'>, id: string, paid: number): ItemInstance {
  return { uid: run.nextUid++, id, state: {}, paid };
}
