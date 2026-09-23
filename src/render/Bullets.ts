import { attribute, float, max, pow, smoothstep, uv, vec3, vec4 } from 'three/tsl';
import {
  AdditiveBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
} from 'three/webgpu';
import type { Bullet, BulletStyle } from '../sim/types';
import { hueColor } from './palette';

/**
 * Per-style visual recipe. Quads lie flat on the gameplay plane, rotated along velocity.
 * `len`/`wid` are half-extents in multiples of the hit radius; the colored body roughly
 * matches the hitbox so what you see is what hits you.
 */
interface StyleShape {
  len: number;
  wid: number;
  core: number;
  body: number;
  glow: number;
  white: number;
  intensity: number;
}

const SHAPES: Record<BulletStyle, StyleShape> = {
  orb: { len: 2.4, wid: 2.4, core: 0.3, body: 0.56, glow: 0.9, white: 1, intensity: 2.6 },
  bigOrb: { len: 2.3, wid: 2.3, core: 0.34, body: 0.6, glow: 0.8, white: 1, intensity: 2.4 },
  needle: { len: 3.6, wid: 1.9, core: 0.34, body: 0.62, glow: 0.7, white: 1, intensity: 2.8 },
  bolt: { len: 3.4, wid: 1.0, core: 0.55, body: 0.9, glow: 0.6, white: 0.9, intensity: 3.2 },
  spark: { len: 2.6, wid: 1.4, core: 0.45, body: 0.85, glow: 0.9, white: 1, intensity: 4 },
  reflect: { len: 3.2, wid: 1.3, core: 0.5, body: 0.85, glow: 0.8, white: 1.2, intensity: 3.5 },
};

export interface BulletViewOpts {
  alpha: number;
  /** Hide bullets beyond this distance from the player (constraint "Brouillard"). 0 = off. */
  fogRadius: number;
  playerX: number;
  playerY: number;
  z: number;
}

/**
 * One instanced draw call for a whole bullet pool. Additive HDR sprites: white-hot core,
 * saturated body, soft glow — bloom does the rest.
 */
export class BulletLayer {
  readonly mesh: InstancedMesh;
  private readonly colors: InstancedBufferAttribute;
  private readonly shapes: InstancedBufferAttribute;

  constructor(readonly capacity: number) {
    const geo = new PlaneGeometry(2, 2);
    this.colors = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.shapes = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.colors.setUsage(DynamicDrawUsage);
    this.shapes.setUsage(DynamicDrawUsage);
    geo.setAttribute('aColor', this.colors);
    geo.setAttribute('aShape', this.shapes);

    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    const color = attribute('aColor', 'vec4');
    const shape = attribute('aShape', 'vec4');
    const p = uv().sub(0.5).mul(2);
    const d = p.length();
    const core = smoothstep(shape.x, shape.x.mul(0.3), d).mul(shape.w);
    const body = smoothstep(shape.y, shape.y.mul(0.55), d);
    const glow = pow(max(float(1).sub(d), 0), 2.2).mul(shape.z);
    const rgb = color.xyz.mul(body.add(glow)).add(vec3(1, 1, 1).mul(core).mul(1.6));
    mat.colorNode = vec4(rgb.mul(color.w), 1);

    this.mesh = new InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 10;
  }

  update(items: readonly Bullet[], o: BulletViewOpts): void {
    const n = Math.min(items.length, this.capacity);
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const c = this.colors.array as Float32Array;
    const s = this.shapes.array as Float32Array;
    const fog2 = o.fogRadius > 0 ? o.fogRadius * o.fogRadius : 0;
    for (let i = 0; i < n; i++) {
      const b = items[i]!;
      const x = b.px + (b.x - b.px) * o.alpha;
      const y = b.py + (b.y - b.py) * o.alpha;
      const shape = SHAPES[b.style];
      const ang = Math.atan2(b.vy, b.vx);
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      // Pop-in: bullets grow over their first 60 ms.
      const grow = Math.min(1, 0.35 + b.age * 11);
      const sx = shape.len * b.radius * grow;
      const sy = shape.wid * b.radius * grow;
      const k = i * 16;
      m[k] = cos * sx;
      m[k + 1] = sin * sx;
      m[k + 2] = 0;
      m[k + 3] = 0;
      m[k + 4] = -sin * sy;
      m[k + 5] = cos * sy;
      m[k + 6] = 0;
      m[k + 7] = 0;
      m[k + 8] = 0;
      m[k + 9] = 0;
      m[k + 10] = 1;
      m[k + 11] = 0;
      m[k + 12] = x;
      m[k + 13] = y;
      m[k + 14] = o.z;
      m[k + 15] = 1;

      let vis = shape.intensity;
      if (fog2 > 0) {
        const d2 = (x - o.playerX) ** 2 + (y - o.playerY) ** 2;
        const f = 1 - Math.min(1, Math.max(0, (Math.sqrt(d2) - o.fogRadius * 0.7) / (o.fogRadius * 0.3)));
        vis *= f;
      }
      const col = hueColor(b.hue);
      const j = i * 4;
      c[j] = col.r;
      c[j + 1] = col.g;
      c[j + 2] = col.b;
      c[j + 3] = vis;
      s[j] = shape.core;
      s[j + 1] = shape.body;
      s[j + 2] = shape.glow;
      s[j + 3] = shape.white;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colors.needsUpdate = true;
    this.shapes.needsUpdate = true;
  }
}
