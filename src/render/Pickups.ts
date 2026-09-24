import { abs, dot, float, normalView, positionViewDirection, pow, vec3 } from 'three/tsl';
import {
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import type { Pickup } from '../sim/types';
import { SHARD } from './palette';

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _axis = new Vector3(0.3, 0.2, 1).normalize();

/**
 * Mult shards: one instanced draw of small lit gems that spin as they fall. Mint, faceted and
 * lit, so they read as loot: not magenta (bullets), not a cyan streak (the player's shots),
 * and dimmer than bullets.
 */
export class PickupLayer {
  readonly mesh: InstancedMesh;

  constructor(readonly capacity = 160) {
    const geo = new OctahedronGeometry(1.4, 0);
    geo.scale(0.8, 0.8, 1.3);
    const mat = new MeshStandardNodeMaterial({ color: SHARD.clone().multiplyScalar(0.35), metalness: 0.2 });
    mat.roughness = 0.25;
    // A glowing rim over lit facets: visible on any floor, well below bullet brightness.
    const rim = pow(float(1).sub(abs(dot(normalView, positionViewDirection))), 1.5);
    mat.emissiveNode = vec3(SHARD.r, SHARD.g, SHARD.b).mul(rim.mul(1.1).add(0.5));
    this.mesh = new InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  update(items: readonly Pickup[], alpha: number, t: number): void {
    const n = Math.min(items.length, this.capacity);
    for (let i = 0; i < n; i++) {
      const p = items[i]!;
      // Pop in over the first 0.15 s.
      const grow = Math.min(1, 0.3 + p.age * 5);
      _p.set(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, 0.4);
      _q.setFromAxisAngle(_axis, p.spin + t * 3);
      _s.setScalar(grow);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
