import { type Color, PointLight, type Scene } from 'three/webgpu';

interface LightReq {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
  distance: number;
  /** Seconds left; <= 0 = one frame only. */
  life: number;
  maxLife: number;
}

/**
 * Fixed pool of point lights (never added/removed at runtime, so materials never recompile).
 * Each frame the brightest requests win the pool: explosions, muzzle flashes, the engines and
 * a sample of bullets. With WebGPU + clustered lighting the pool is large (hundreds); on the
 * WebGL fallback it is small.
 */
export class LightPool {
  private readonly lights: PointLight[] = [];
  private readonly timed: LightReq[] = [];
  private frameReqs: LightReq[] = [];

  constructor(
    scene: Scene,
    readonly size: number,
  ) {
    for (let i = 0; i < size; i++) {
      const l = new PointLight(0xffffff, 0, 1, 2);
      l.position.set(0, 0, -999);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
    }
  }

  /** Timed light (explosion flash): decays quadratically over `life`. */
  flash(
    x: number,
    y: number,
    z: number,
    color: Color,
    intensity: number,
    distance: number,
    life: number,
  ): void {
    if (this.timed.length > 256) this.timed.shift();
    this.timed.push({
      x,
      y,
      z,
      r: color.r,
      g: color.g,
      b: color.b,
      intensity,
      distance,
      life,
      maxLife: life,
    });
  }

  /** Light for this frame only (engines, bullets). */
  add(x: number, y: number, z: number, color: Color, intensity: number, distance: number): void {
    this.frameReqs.push({
      x,
      y,
      z,
      r: color.r,
      g: color.g,
      b: color.b,
      intensity,
      distance,
      life: 0,
      maxLife: 0,
    });
  }

  update(dt: number): void {
    const reqs = this.frameReqs;
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i]!;
      t.life -= dt;
      if (t.life <= 0) {
        this.timed.splice(i, 1);
        continue;
      }
      const k = t.life / t.maxLife;
      reqs.push({ ...t, intensity: t.intensity * k * k });
    }
    if (reqs.length > this.size) reqs.sort((a, b) => b.intensity - a.intensity);
    const n = Math.min(reqs.length, this.size);
    for (let i = 0; i < this.size; i++) {
      const l = this.lights[i]!;
      if (i < n) {
        const q = reqs[i]!;
        l.position.set(q.x, q.y, q.z);
        l.color.setRGB(q.r, q.g, q.b);
        l.intensity = q.intensity;
        l.distance = q.distance;
      } else if (l.intensity !== 0) {
        l.intensity = 0;
        l.position.set(0, 0, -999);
        l.distance = 1;
      }
    }
    this.frameReqs = [];
  }
}
