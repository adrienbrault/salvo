import type { KillInfo, KillType, PlayerStats, ScoreCalc } from '../sim/types';
import type { World } from '../sim/world';

export type ItemKind = 'weapon' | 'engine' | 'core' | 'relic' | 'calibration' | 'module';
export type Rarity = 'common' | 'rare' | 'legendary';
export type WeaponId = 'blaster' | 'grazer' | 'mirror' | 'ram';

/** An owned item. Only serialisable data: the behaviour lives in the ItemDef. */
export interface ItemInstance {
  uid: number;
  id: string;
  /** Per-item counters for scaling effects (numbers only, persisted with the run). */
  state: Record<string, number>;
  /** Price paid, used to compute the sell value. */
  paid: number;
}

export interface LevelEndInfo {
  won: boolean;
  damageTaken: number;
  timeLeft: number;
}

export interface GrazeInfo {
  x: number;
  y: number;
  /** Distance from the bullet edge to the player's hitbox edge. */
  gap: number;
  /** Very close graze (within 3 m of the hitbox). */
  close: boolean;
}

/**
 * Context handed to item hooks. `inst.state` is where scaling items keep counters.
 * A copied effect (Plan / Blueprint) receives the *copier's* instance, so counters are never shared.
 */
export interface HookCtx {
  readonly world: World;
  readonly inst: ItemInstance;
  /** Relic slot index (0-based), or -1 for weapon/engine/core. */
  readonly slot: number;
  /** Signals a visible trigger: pulses the relic in the HUD and counts it for the level recap. */
  trigger(label?: string): void;
  /** Adds to the level's Mult gauge (scaled by gaugeGainMul and constraints). */
  addGauge(amount: number): void;
  addMoney(amount: number): void;
}

export interface ItemHooks {
  onLevelStart?(c: HookCtx): void;
  onLevelEnd?(c: HookCtx, info: LevelEndInfo): void;
  onTick?(c: HookCtx, dt: number): void;
  /** Mutate `s` in place. Order matters: relics run left → right (+Mult before ×Mult if placed so). */
  onKill?(c: HookCtx, kill: KillInfo, s: ScoreCalc): void;
  onGraze?(c: HookCtx, graze: GrazeInfo): void;
  onHit?(c: HookCtx): void;
  onAction?(c: HookCtx): void;
}

export interface EconomyStats {
  interestCap: number;
  interestStep: number;
  rerollBase: number;
  levelRewardDelta: number;
  /** Money per 6 seconds left when clearing a level. */
  timeBonusPer: number;
}

export interface ItemDef extends ItemHooks {
  id: string;
  kind: ItemKind;
  name: string;
  /** Short glyph displayed as the item icon (text presentation). */
  glyph: string;
  /** Accent color (CSS hex). */
  color: string;
  rarity: Rarity;
  price: number;
  /**
   * Rich description. Markup: {m:+3 Mult} red, {b:+20 Éclats} blue, {x:×2 Mult} red chip,
   * {$:$1} gold, {k:Impact} keyword, {g:0,15} gauge (red, italic).
   */
  desc: string | ((inst: ItemInstance | undefined) => string);
  flavor?: string;
  /** Synergy tags: 'graze', 'impact', 'shots', 'action', 'economy', 'defense', 'risk'… */
  tags?: readonly string[];
  weapon?: WeaponId;
  /** Calibration target. */
  killType?: KillType;
  modifyStats?(stats: PlayerStats, inst: ItemInstance): void;
  modifyEconomy?(eco: EconomyStats, inst: ItemInstance): void;
  /** Cannot be copied by Plan (e.g. Plan itself). */
  noCopy?: boolean;
}

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Commun',
  rare: 'Rare',
  legendary: 'Légendaire',
};

export const KIND_LABEL: Record<ItemKind, string> = {
  weapon: 'Arme',
  engine: 'Moteur',
  core: 'Cœur',
  relic: 'Relique',
  calibration: 'Calibrage',
  module: 'Module',
};

export const describe = (def: ItemDef, inst?: ItemInstance): string =>
  typeof def.desc === 'function' ? def.desc(inst) : def.desc;

export const sellValue = (inst: ItemInstance): number => Math.max(1, Math.floor(inst.paid / 2));
