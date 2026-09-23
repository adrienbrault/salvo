export const TAU = Math.PI * 2;

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a));

export const saturate = (v: number): number => clamp(v, 0, 1);

export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
};

export const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.sqrt(dist2(ax, ay, bx, by));

/** Angle (radians) from a to b; 0 = +x, PI/2 = +y (up the field). */
export const angleTo = (ax: number, ay: number, bx: number, by: number): number =>
  Math.atan2(by - ay, bx - ax);

export const wrapAngle = (a: number): number => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

/** Rotate angle `from` toward `to` by at most `maxStep` radians. */
export const turnToward = (from: number, to: number, maxStep: number): number => {
  const d = wrapAngle(to - from);
  return from + clamp(d, -maxStep, maxStep);
};

/** Move value toward target by at most `step`. */
export const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = saturate((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;
