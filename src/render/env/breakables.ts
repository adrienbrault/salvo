import { DataTexture, FloatType, NearestFilter, Quaternion, RGBAFormat, Vector3 } from 'three/webgpu';
import type { Rng } from '../../sim/rng';
import type { Breakable, BreakPart, Fall } from './layout';

/** What a layout says about a structure it wants breakable (everything else is derived). */
export interface BreakOpts {
  hp?: number;
  explosive?: boolean;
  fall?: Fall;
}

const UP = new Vector3(0, 0, 1);
/** Seconds a fallen part takes to settle after it lands. */
const LAND = 0.4;

/**
 * Fall parameters for a standing structure pivoted at its base. Toppling structures fall
 * outward or along the trench — never toward it, so nothing ends up over the play field.
 */
export function fallFor(
  fall: Fall,
  height: number,
  side: number,
  rng: Rng,
): Pick<BreakPart, 'axis' | 'angle' | 'sink' | 'duration'> {
  if (fall === 'topple') {
    const dir = rng.pick([
      new Vector3(Math.sign(side) || 1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, -1, 0),
    ]);
    return {
      axis: new Vector3().crossVectors(UP, dir).normalize(),
      angle: rng.float(1.2, 1.45),
      sink: height * 0.08,
      duration: 1.5,
    };
  }
  const a = rng.float(0, Math.PI * 2);
  const axis = new Vector3(Math.cos(a), Math.sin(a), 0);
  if (fall === 'sink') return { axis, angle: rng.float(0.04, 0.1), sink: height * 0.72, duration: 2.6 };
  return { axis, angle: rng.float(0.15, 0.35), sink: height * 0.35, duration: 0.8 };
}

/** Marks a breakable broken (the part table then chars it and puts its lights out). */
export function breakIt(b: Breakable, now: number): void {
  if (b.brokenAt >= 0) return;
  b.hp = 0;
  b.brokenAt = now;
}

/** Poses a broken breakable `t` seconds after it broke. Returns false once settled. */
export function animateBreak(b: Breakable, t: number): boolean {
  let moving = false;
  for (const p of b.parts) {
    const f = Math.min(1, Math.max(0, t / p.duration));
    // Falling accelerates, then it jolts back a little as it hits the ground and settles.
    const u = (t - p.duration) / LAND;
    const rebound = u > 0 && u < 1 ? Math.sin(u * Math.PI) * 0.06 * (1 - u) : 0;
    const k = f * f - rebound;
    p.q.setFromAxisAngle(p.axis, p.angle * k);
    p.drop = p.sink * k;
    if (u < 1) moving = true;
  }
  return moving;
}

/** Back to pristine (a recycled segment comes back as new structures). */
export function resetBreakable(b: Breakable): void {
  b.hp = b.maxHp;
  b.brokenAt = -1;
  for (const p of b.parts) {
    p.q.identity();
    p.drop = 0;
  }
}

/** Where segment-local point `v` of a part is now (the same maths as the vertex shader). */
export function posePoint(p: BreakPart, v: Vector3, out: Vector3): Vector3 {
  out.copy(v).sub(p.pivot).applyQuaternion(p.q).add(p.pivot);
  out.z -= p.drop;
  return out;
}

/** Segment-local centre of a part as it lies now (fallen or not). */
export function partCenter(p: BreakPart, out: Vector3): Vector3 {
  out.copy(p.center).applyQuaternion(p.q).add(p.pivot);
  out.z -= p.drop;
  return out;
}

/** Horizontal distance from (x, y) to the breakable's footprint, plus a penalty for depth. */
export function reach(b: Breakable, x: number, y: number, z = 0): number {
  const dx = Math.max(b.x0 - x, 0, x - b.x1);
  const dy = Math.max(b.y0 - y, 0, y - b.y1);
  return Math.hypot(dx, dy) + Math.max(0, z - b.zTop) * 0.3;
}

/** Texels per part: rotation quaternion; pivot and drop; broken flag and heat. */
export const PART_TEXELS = 3;

/**
 * Every part's pose as a float texture that the hull, beacon and cone materials read in the
 * vertex shader. Index 0 is the identity, for everything that never moves. Updating a pose is a
 * small texture upload and the geometry never changes, so breaking costs no draw call and no
 * pipeline.
 */
export class PartTable {
  readonly data: Float32Array;
  readonly texture: DataTexture;

  constructor(readonly size: number) {
    this.data = new Float32Array(size * PART_TEXELS * 4);
    const id = new Quaternion();
    const origin = new Vector3();
    for (let i = 0; i < size; i++) this.write(i, id, origin, 0, false, 0);
    this.texture = new DataTexture(this.data, size * PART_TEXELS, 1, RGBAFormat, FloatType);
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.needsUpdate = true;
  }

  private write(i: number, q: Quaternion, pivot: Vector3, drop: number, broken: boolean, heat: number): void {
    const o = i * PART_TEXELS * 4;
    const d = this.data;
    d[o] = q.x;
    d[o + 1] = q.y;
    d[o + 2] = q.z;
    d[o + 3] = q.w;
    d[o + 4] = pivot.x;
    d[o + 5] = pivot.y;
    d[o + 6] = pivot.z;
    d[o + 7] = drop;
    d[o + 8] = broken ? 1 : 0;
    d[o + 9] = heat;
  }

  /** Writes a breakable's current pose; `heat` (1 → 0) makes freshly broken metal glow. */
  set(b: Breakable, heat: number): void {
    for (const p of b.parts) this.write(p.index, p.q, p.pivot, p.drop, b.brokenAt >= 0, heat);
    this.texture.needsUpdate = true;
  }
}
