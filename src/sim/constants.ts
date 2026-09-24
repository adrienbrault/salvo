/** Simulation runs at a fixed rate; rendering interpolates between steps. */
export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;

/**
 * Playfield in world units (9:16 portrait), origin at the center, +y = up the screen.
 * Distances in item descriptions are expressed in "m" = world units.
 */
export const FIELD = {
  w: 90,
  h: 160,
  halfW: 45,
  halfH: 80,
} as const;

/** Entities further than this outside the field are despawned. */
export const DESPAWN_MARGIN = 14;

/** Player may not leave this inset rectangle. */
export const PLAYER_BOUNDS = {
  minX: -FIELD.halfW + 3,
  maxX: FIELD.halfW - 3,
  minY: -FIELD.halfH + 6,
  maxY: FIELD.halfH - 14,
} as const;

export const PLAYER_SPAWN = { x: 0, y: -FIELD.halfH + 26 } as const;

/** Seconds of "READY" before spawns and timer start. */
export const LEVEL_INTRO = 1.6;
/** Seconds of victory outro (screen clear) before the level ends. */
export const LEVEL_OUTRO = 1.8;
/** Seconds of death sequence before the run ends. */
export const DEATH_OUTRO = 2.2;

/** Invulnerability after taking a hit. */
export const HIT_INVULN = 1.6;
/** Radius around the player in which enemy bullets are cancelled when hit (fairness). */
export const HIT_CLEAR_RADIUS = 28;

/** Base Mult-gauge gain per kill, before `gaugeGainMul`. */
export const GAUGE_PER_KILL = 0.05;
/** Fraction of gauge bonus kept when hit. */
export const GAUGE_KEEP_ON_HIT = 0.5;

/** Distance thresholds used by several relics (world units). */
export const POINT_BLANK = 25;
export const LONG_RANGE = 80;
