import { TAU } from './math';
import type { BulletStyle, Hue } from './types';
import type { World } from './world';

export interface ShotOpts {
  style?: BulletStyle;
  hue?: Hue;
  radius?: number;
  accel?: number;
  maxSpeed?: number;
  spin?: number;
  life?: number;
}

/** Bullets aimed at the player (optionally a fan of `count` spread over `spread` radians). */
export function aimed(
  w: World,
  x: number,
  y: number,
  speed: number,
  count = 1,
  spread = 0,
  opts: ShotOpts = {},
): void {
  const p = w.player;
  const base = Math.atan2(p.y - y, p.x - x);
  fan(w, x, y, base, count, spread, speed, opts);
}

/** `count` bullets centred on `angle`, spread over `spread` radians. */
export function fan(
  w: World,
  x: number,
  y: number,
  angle: number,
  count: number,
  spread: number,
  speed: number,
  opts: ShotOpts = {},
): void {
  if (count <= 1) {
    w.fireEnemy(x, y, angle, speed, opts);
    return;
  }
  const step = spread / (count - 1);
  const start = angle - spread / 2;
  for (let i = 0; i < count; i++) w.fireEnemy(x, y, start + step * i, speed, opts);
}

/** Full circle of `count` bullets, rotated by `offset`. */
export function ring(
  w: World,
  x: number,
  y: number,
  count: number,
  speed: number,
  offset = 0,
  opts: ShotOpts = {},
): void {
  const step = TAU / count;
  for (let i = 0; i < count; i++) w.fireEnemy(x, y, offset + step * i, speed, opts);
}

/** `arms` bullets evenly spaced around `angle` — call repeatedly with a moving angle for spirals. */
export function spiral(
  w: World,
  x: number,
  y: number,
  arms: number,
  angle: number,
  speed: number,
  opts: ShotOpts = {},
): void {
  const step = TAU / arms;
  for (let i = 0; i < arms; i++) w.fireEnemy(x, y, angle + step * i, speed, opts);
}
