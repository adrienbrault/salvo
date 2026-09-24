/**
 * Core simulation types. The sim is pure TypeScript: no DOM, no three.js.
 * Renderers/UI read these structures (read-only) and drain `World.fx`.
 */

/** How an enemy died — the shmup equivalent of a Balatro "hand type". Calibrations level them up. */
export type KillType = 'tir' | 'impact' | 'renvoi' | 'onde' | 'reaction';
export const KILL_TYPES: readonly KillType[] = ['tir', 'impact', 'renvoi', 'onde', 'reaction'];
export const KILL_TYPE_LABEL: Record<KillType, string> = {
  tir: 'Shot',
  impact: 'Impact',
  renvoi: 'Reflect',
  onde: 'Wave',
  reaction: 'Reaction',
};

export type EnemyKind = 'dart' | 'weaver' | 'turret' | 'diver' | 'orbiter' | 'carrier' | 'mine' | 'boss';

/** Visual family of a bullet; the renderer picks mesh/material from it. */
export type BulletStyle = 'orb' | 'bigOrb' | 'needle' | 'bolt' | 'spark' | 'reflect';

/** Palette slot — renderers map it to HDR colors. */
export type Hue = 'pink' | 'orange' | 'cyan' | 'lime' | 'violet' | 'gold' | 'white' | 'red' | 'blue';

/**
 * A Mult shard dropped by a kill: it pops out, then falls through the field. Flying within
 * the graze radius collects it into the gauge.
 */
export interface Pickup {
  x: number;
  y: number;
  /** Position at the previous step (render interpolation). */
  px: number;
  py: number;
  vx: number;
  vy: number;
  age: number;
  /** Render-only spin phase, seeded so shards don't turn in step. */
  spin: number;
}

export interface Bullet {
  x: number;
  y: number;
  /** Position at the previous step (render interpolation). */
  px: number;
  py: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  friendly: boolean;
  style: BulletStyle;
  hue: Hue;
  age: number;
  life: number;
  /** Speed change per second, clamped to [0, maxSpeed]. */
  accel: number;
  maxSpeed: number;
  /** Angular velocity of the velocity vector (rad/s) — curving bullets. */
  spin: number;
  /** Max turn rate toward the nearest enemy (friendly homing bullets), rad/s. */
  homing: number;
  /** Extra enemies this bullet can pass through. */
  pierce: number;
  /** Remaining bounces on the field side walls. */
  bounces: number;
  killType: KillType;
  grazed: boolean;
  lastHitId: number;
  /** Set when the player's Mirror reflected it — for visuals. */
  reflected: boolean;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  /** Shards awarded on kill (Balatro "chips"). */
  value: number;
  heavy: boolean;
  boss: boolean;
  age: number;
  /** Hit flash timer (render). */
  flash: number;
  hue: Hue;
  /** Facing angle for rendering (radians, 0 = +x). Enemies face down by default. */
  rot: number;
  /** Generic behaviour parameters, meaning depends on `kind`. */
  a: number;
  b: number;
  c: number;
  d: number;
  fireT: number;
  state: number;
  stateT: number;
  /** Last dash id that damaged this enemy (hit-once per dash). */
  dashHit: number;
  dead: boolean;
}

export interface Wave {
  id: number;
  x: number;
  y: number;
  r: number;
  maxR: number;
  speed: number;
  damage: number;
  killType: KillType;
  /** Cancels enemy bullets it sweeps over. */
  cancels: boolean;
  hue: Hue;
  hit: Set<number>;
}

export interface Player {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  hp: number;
  invuln: number;
  alive: boolean;
  /** Seconds without significant movement. */
  still: number;
  fireT: number;
  /** Action cooldown remaining / max (Blaster salvo). */
  cooldown: number;
  cooldownMax: number;
  /** 0..1 gauge: graze charge (Grazer) or shield energy (Mirror). */
  charge: number;
  /** Bullets absorbed by the Mirror shield, waiting to be released. */
  stored: number;
  shield: boolean;
  /** Dash (Ram). */
  dashT: number;
  dashDx: number;
  dashDy: number;
  dashId: number;
  charges: number;
  maxCharges: number;
  chargeT: number;
  /** Weapon disabled (constraint "Radio Silence"). */
  disabled: boolean;
}

/** One simulation step of player intent. Produced by the input layer. */
export interface InputFrame {
  /** Pointer-driven: move toward (tx, ty) in world units. */
  hasTarget: boolean;
  tx: number;
  ty: number;
  /** Keyboard-driven direction, each in [-1, 1]. Ignored when hasTarget. */
  dx: number;
  dy: number;
  /** Precision mode (slower movement). */
  precise: boolean;
  /** Action button held (2nd finger, click, Space). */
  action: boolean;
}

export const emptyInput = (): InputFrame => ({
  hasTarget: false,
  tx: 0,
  ty: 0,
  dx: 0,
  dy: 0,
  precise: false,
  action: false,
});

/** Derived from the loadout (engine, core, modules, relics). Recomputed on loadout change. */
export interface PlayerStats {
  speed: number;
  hitRadius: number;
  grazeRadius: number;
  maxHp: number;
  damageMul: number;
  /** Fire rate / charge-gain multiplier. */
  rateMul: number;
  /** Action recharge speed multiplier. */
  actionRecharge: number;
  pierce: number;
  bounces: number;
  gaugeGainMul: number;
  /** Enemies explode on death (Reaction kills). */
  chainExplosions: boolean;
}

export interface KillInfo {
  enemy: Enemy;
  killType: KillType;
  /** Distance player → enemy at the time of the kill. */
  dist: number;
  duringDash: boolean;
  /** 1-based kill counter within the level. */
  killIndex: number;
}

/** Mutable score computation for one kill: score = round(base × mult) × repeats. */
export interface ScoreCalc {
  base: number;
  mult: number;
  repeats: number;
}

export type FxEvent =
  | { t: 'explode'; x: number; y: number; size: number; hue: Hue; kind: EnemyKind }
  | { t: 'hit'; x: number; y: number; hue: Hue; deflected: boolean }
  | { t: 'muzzle'; x: number; y: number; hue: Hue }
  | { t: 'salvo'; x: number; y: number }
  | { t: 'playerHit'; x: number; y: number; hpLeft: number }
  | { t: 'playerDeath'; x: number; y: number }
  | { t: 'graze'; x: number; y: number; close: boolean }
  | { t: 'wave'; x: number; y: number; maxR: number; hue: Hue }
  | { t: 'dash'; x: number; y: number; dx: number; dy: number }
  | { t: 'absorb'; x: number; y: number }
  | { t: 'release'; x: number; y: number; count: number }
  | { t: 'cancel'; x: number; y: number; hue: Hue }
  | { t: 'score'; x: number; y: number; base: number; mult: number; total: number; repeats: number }
  | { t: 'relic'; slot: number; label?: string }
  | { t: 'money'; amount: number; x: number; y: number }
  | { t: 'pickup'; x: number; y: number; gauge: number }
  | { t: 'heal'; x: number; y: number }
  | { t: 'enemyShot'; x: number; y: number; count: number }
  | { t: 'bossSpawn'; x: number; y: number }
  | { t: 'bossPhase'; x: number; y: number; phase: number }
  | { t: 'quota' }
  | { t: 'timeWarning' }
  | { t: 'blackout'; on: boolean };
