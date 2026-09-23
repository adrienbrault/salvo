import { float, fract, hash, instanceIndex, positionLocal, smoothstep, step, time, uniform } from 'three/tsl';
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  type Scene,
  Vector3,
} from 'three/webgpu';
import { FLOOR_Z, SCROLL_SPEED } from '../palette';

interface Piece {
  x: number;
  y: number;
  h: number;
  w: number;
  rot: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _z = new Vector3(0, 0, 1);

/**
 * Megastructure towers rising out of the liquid-metal sea and scrolling past: gives scale,
 * parallax and something for the sea to reflect. Kept low (tops well below the play plane)
 * and pushed toward the sides so they never compete with bullets for readability.
 */
export class Structures {
  readonly theme = uniform(new Vector3(0.16, 0.42, 1));
  private readonly sets: { mesh: InstancedMesh; pieces: Piece[]; base: BufferGeometry }[] = [];
  private readonly span = 380;

  constructor(scene: Scene) {
    const tower = new BoxGeometry(1, 1, 1);
    tower.translate(0, 0, 0.5);
    const pylon = new CylinderGeometry(0.5, 0.62, 1, 8);
    pylon.rotateX(Math.PI / 2);
    pylon.translate(0, 0, 0.5);
    this.addSet(scene, tower, 22, 0);
    this.addSet(scene, pylon, 14, 1);
  }

  private addSet(scene: Scene, geo: BufferGeometry, count: number, variant: number): void {
    const mat = new MeshStandardNodeMaterial({ color: new Color(0x07090f), metalness: 0.95, roughness: 0.3 });
    // Window strips: rows of lit cells whose pattern varies per instance, slowly flickering.
    const seed = hash(float(instanceIndex).add(variant * 100));
    const rows = fract(positionLocal.z.mul(9).add(seed.mul(7)));
    const cols = fract(positionLocal.x.add(positionLocal.y).mul(3.5));
    const lit = step(0.55, hash(float(instanceIndex).mul(3.1).add(positionLocal.z.mul(9).floor())));
    const win = smoothstep(0.4, 0.5, rows)
      .mul(smoothstep(0.75, 0.65, rows))
      .mul(smoothstep(0.2, 0.3, cols))
      .mul(lit);
    const flicker = float(0.75).add(fract(time.mul(0.3).add(seed)).mul(0.25));
    const topGlow = smoothstep(0.96, 1, positionLocal.z).mul(3);
    mat.emissiveNode = this.theme.mul(win.mul(2.2).mul(flicker).add(topGlow));
    const mesh = new InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const pieces: Piece[] = [];
    for (let i = 0; i < count; i++) {
      const p: Piece = { x: 0, y: -140 + (i / count) * this.span, h: 0, w: 0, rot: 0 };
      this.respawn(p, variant);
      pieces.push(p);
    }
    scene.add(mesh);
    this.sets.push({ mesh, pieces, base: geo });
  }

  private respawn(p: Piece, variant: number): void {
    const side = Math.random() < 0.5 ? -1 : 1;
    // Outside the playfield lane: side scenery that the sea reflects.
    p.x = side * (60 + Math.random() * 90);
    p.w = variant === 0 ? 5 + Math.random() * 9 : 3 + Math.random() * 3;
    p.h = (variant === 0 ? 5 : 8) + Math.random() * 12;
    p.rot = Math.random() * Math.PI;
  }

  update(dt: number, _t: number): void {
    for (let v = 0; v < this.sets.length; v++) {
      const set = this.sets[v]!;
      set.pieces.forEach((p, i) => {
        p.y -= SCROLL_SPEED * dt;
        if (p.y < -150) {
          p.y += this.span;
          this.respawn(p, v);
        }
        _p.set(p.x, p.y, FLOOR_Z - 2);
        _q.setFromAxisAngle(_z, p.rot);
        _s.set(p.w, v === 0 ? p.w * 1.6 : p.w, p.h);
        _m.compose(_p, _q, _s);
        set.mesh.setMatrixAt(i, _m);
      });
      set.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  setTheme(color: Color): void {
    this.theme.value.set(color.r, color.g, color.b);
  }
}
