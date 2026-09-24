import type { BufferGeometry } from 'three/webgpu';
import type { Rng } from '../../sim/rng';
import { HullBuilder, type Surf, type V3 } from './HullBuilder';
import { SEG } from './layout';

/**
 * Rock relief that repeats exactly every SEG along y (every wave has a whole number of
 * periods per segment), so displaced walls and ground join seamlessly between segments.
 * Mixed with its ridged fold it reads as broken rock rather than waves.
 */
export class RockNoise {
  private readonly waves: { ky: number; kt: number; a: number; c: number }[] = [];

  constructor(rng: Rng) {
    for (const k of [1, 2, 3, 4, 6, 9, 13, 19]) {
      for (let d = 0; d < 2; d++) {
        const base = (2 * Math.PI * k) / SEG;
        this.waves.push({
          ky: base * (rng.chance(0.5) ? 1 : -1),
          kt: base * rng.float(-1.3, 1.3),
          a: 1 / k ** 0.9,
          c: rng.float(0, Math.PI * 2),
        });
      }
    }
  }

  /** Roughly −1..1 at segment-local y and a surface coordinate t (world units). */
  at(y: number, t: number): number {
    let v = 0;
    let n = 0;
    for (const w of this.waves) {
      v += w.a * Math.sin(w.ky * y + w.kt * t + w.c);
      n += w.a;
    }
    const f = (v / n) * 1.8;
    return f * 0.55 + (0.5 - Math.abs(f)) * 0.9;
  }
}

/** Local, per-segment relief that fades to zero at both segment ends (keeps seams closed). */
export interface Bump {
  y: number;
  t: number;
  r: number;
  a: number;
}

export function bumps(rng: Rng, count: number, tMax: number): Bump[] {
  return Array.from({ length: count }, () => ({
    y: rng.float(8, SEG - 8),
    t: rng.float(0, tMax),
    r: rng.float(4, 12),
    a: rng.float(-1.2, 1.2),
  }));
}

function bumpAt(list: readonly Bump[], y: number, t: number): number {
  let v = 0;
  for (const b of list) v += b.a * Math.exp(-((y - b.y) ** 2 + (t - b.t) ** 2) / (b.r * b.r));
  const fade = Math.sin((Math.PI * y) / SEG);
  return v * fade * fade;
}

/**
 * Rock face on side `s` following a profile of (distance from axis, z, displacement) points
 * listed bottom → top. Displacement pushes along the profile's inward normal.
 */
export function rockWall(
  hb: HullBuilder,
  s: 1 | -1,
  profile: readonly (readonly [number, number, number])[],
  noise: RockNoise,
  local: readonly Bump[],
  surf: Surf,
  /** Offset into the noise, so walls sharing one RockNoise don't repeat each other. */
  t0 = 0,
  step = 1.6,
): void {
  const pts: { x: number; z: number; t: number; nx: number; nz: number; amp: number }[] = [];
  let t = t0;
  for (let k = 0; k < profile.length - 1; k++) {
    const [x0, z0, a0] = profile[k]!;
    const [x1, z1, a1] = profile[k + 1]!;
    const l = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(l / step));
    for (let i = 0; i < n || (k === profile.length - 2 && i === n); i++) {
      const f = i / n;
      pts.push({
        x: x0 + (x1 - x0) * f,
        z: z0 + (z1 - z0) * f,
        t: t + l * f,
        nx: -(z1 - z0) / l,
        nz: (x1 - x0) / l,
        amp: a0 + (a1 - a0) * f,
      });
    }
    t += l;
  }
  const cols = Math.ceil(SEG / step) + 1;
  const yAt = (j: number) => (s > 0 ? SEG * (1 - j / (cols - 1)) : (SEG * j) / (cols - 1));
  const tile = surf.tile ?? 16;
  hb.grid(
    pts.length,
    cols,
    (i, j) => {
      const p = pts[i]!;
      const y = yAt(j);
      const d = p.amp * (noise.at(y, p.t) + bumpAt(local, y, p.t));
      return [s * (p.x + p.nx * d), y, p.z + p.nz * d];
    },
    (i, j) => [(s > 0 ? -yAt(j) : yAt(j)) / tile, pts[i]!.t / tile],
    surf,
  );
}

/** Height of rocky ground at distance `ax` from the axis (shared by the mesh and placement). */
export function groundZ(noise: RockNoise, z0: number, amp: number, ax: number, y: number): number {
  const rim = Math.min(1, Math.max(0.25, (ax - 50) / 14));
  return z0 + amp * rim * (noise.at(y, ax + 300) * 0.5 + 0.5);
}

/** Rolling rocky ground on side `s` from distance xa to xb. */
export function rockGround(
  hb: HullBuilder,
  s: 1 | -1,
  xa: number,
  xb: number,
  z0: number,
  amp: number,
  noise: RockNoise,
  surf: Surf,
  step = 3,
): void {
  const cols = Math.ceil((xb - xa) / step) + 1;
  const rows = Math.ceil(SEG / step) + 1;
  const tile = surf.tile ?? 32;
  const xAt = (j: number) => (s > 0 ? xa + ((xb - xa) * j) / (cols - 1) : -xb + ((xb - xa) * j) / (cols - 1));
  hb.grid(
    rows,
    cols,
    (i, j) => {
      const x = xAt(j);
      const y = (SEG * i) / (rows - 1);
      return [x, y, groundZ(noise, z0, amp, Math.abs(x), y)];
    },
    (i, j) => [xAt(j) / tile, (SEG * i) / (rows - 1) / tile],
    surf,
  );
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h =
    Math.imul(x, 374761393) ^
    Math.imul(y, 668265263) ^
    Math.imul(z, 1440670441) ^
    Math.imul(seed, 2654435761);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const sm = (t: number) => t * t * (3 - 2 * t);
  const fx = sm(x - xi);
  const fy = sm(y - yi);
  const fz = sm(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
    l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}

/** Lumpy rock: a displaced sphere, squashed by `squash` along z. */
export function boulder(
  hb: HullBuilder,
  c: V3,
  r: number,
  seed: number,
  surf: Surf,
  rough = 0.35,
  squash = 0.75,
  detail = 1,
): void {
  const rows = Math.round(10 * detail) + 1;
  const cols = Math.round(15 * detail) + 1;
  const dir = (i: number, j: number): V3 => {
    const lat = -Math.PI / 2 + (Math.PI * i) / (rows - 1);
    const lon = (2 * Math.PI * j) / (cols - 1);
    return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  };
  const tile = surf.tile ?? 8;
  hb.grid(
    rows,
    cols,
    (i, j) => {
      const d = dir(i, j);
      const n =
        vnoise3(d[0] * 1.6 + 5, d[1] * 1.6, d[2] * 1.6, seed) * 0.7 +
        vnoise3(d[0] * 4 + 9, d[1] * 4, d[2] * 4, seed + 1) * 0.3;
      const k = r * (1 + rough * (n * 2 - 1));
      return [c[0] + d[0] * k, c[1] + d[1] * k, c[2] + d[2] * k * squash];
    },
    (i, j) => [((j / (cols - 1)) * 2 * Math.PI * r) / tile, ((i / (rows - 1)) * Math.PI * r) / tile],
    surf,
    (i, j) => dir(i, j),
  );
}

/** A standalone asteroid mesh (for the drifting field), unit-ish radius. */
export function asteroidGeometry(seed: number, layer: number): BufferGeometry {
  const hb = new HullBuilder();
  boulder(hb, [0, 0, 0], 1, seed, { layer, tile: 2.5 }, 0.45, 0.85, 2);
  return hb.build();
}
