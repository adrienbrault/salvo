import {
  abs,
  attribute,
  dot,
  float,
  normalView,
  oscSine,
  positionViewDirection,
  pow,
  time,
  uniform,
  vec3,
} from 'three/tsl';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  type Node,
  OctahedronGeometry,
  Quaternion,
  type Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three/webgpu';
import type { Enemy, EnemyKind, Hue } from '../../sim/types';
import type { World } from '../../sim/world';
import { hueColor } from '../palette';
import { enemyGeometry } from './models';

type RegularKind = Exclude<EnemyKind, 'boss'>;
const KINDS: RegularKind[] = ['dart', 'weaver', 'turret', 'diver', 'orbiter', 'carrier', 'mine'];
const HUES: Record<RegularKind, Hue> = {
  dart: 'pink',
  weaver: 'orange',
  turret: 'violet',
  diver: 'red',
  orbiter: 'cyan',
  carrier: 'gold',
  mine: 'lime',
};

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _e = new Euler();

/** Lit metal with a neon fresnel rim; `aFlash` (per instance) whitens on hit. */
function hullMaterial(
  hue: Hue,
  flash: Node<'float'> = attribute('aFlash', 'float'),
): MeshStandardNodeMaterial {
  const base = new Color(0x1a1e2a).lerp(hueColor(hue), 0.12);
  const mat = new MeshStandardNodeMaterial({ color: base, metalness: 0.8, roughness: 0.32 });
  const rim = pow(float(1).sub(abs(dot(normalView, positionViewDirection))), 2.5);
  const c = hueColor(hue);
  mat.emissiveNode = vec3(c.r, c.g, c.b)
    .mul(rim.mul(1.8))
    .add(vec3(1, 1, 1).mul(flash.mul(3.5)));
  return mat;
}

/** Unlit HDR emissive parts, gently pulsing. */
function glowMaterial(
  hue: Hue,
  flash: Node<'float'> = attribute('aFlash', 'float'),
  intensity = 4.5,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial();
  const c = hueColor(hue);
  const pulse = oscSine(time.mul(0.8)).mul(0.25).add(0.9);
  mat.colorNode = vec3(c.r, c.g, c.b)
    .mul(pulse.mul(intensity))
    .add(vec3(1, 1, 1).mul(flash.mul(6)));
  return mat;
}

interface KindView {
  mesh: InstancedMesh;
  flash: InstancedBufferAttribute;
}

/** Instanced rendering for all regular enemies (one draw per kind & material) + the boss. */
export class EnemyLayer {
  readonly group = new Group();
  private readonly views = new Map<RegularKind, KindView>();
  readonly boss: BossView;

  constructor(scene: Scene, capacity = 48) {
    for (const kind of KINDS) {
      const geo = enemyGeometry(kind);
      const flash = new InstancedBufferAttribute(new Float32Array(capacity), 1);
      flash.setUsage(DynamicDrawUsage);
      geo.setAttribute('aFlash', flash);
      const mats: Material[] = [hullMaterial(HUES[kind]), glowMaterial(HUES[kind])];
      const mesh = new InstancedMesh(geo, mats, capacity);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      this.group.add(mesh);
      this.views.set(kind, { mesh, flash });
    }
    this.boss = new BossView();
    this.group.add(this.boss.group);
    scene.add(this.group);
  }

  /** Show one instance of everything (pipeline warm-up). */
  warm(on: boolean): void {
    for (const view of this.views.values()) {
      view.mesh.count = on ? 1 : 0;
      if (on) view.mesh.setMatrixAt(0, new Matrix4().makeTranslation(0, 0, -5));
    }
    this.boss.group.visible = on;
  }

  update(world: World, alpha: number, t: number): void {
    const counts = new Map<RegularKind, number>();
    for (const kind of KINDS) counts.set(kind, 0);
    let boss: Enemy | null = null;
    for (const e of world.enemies.items) {
      if (e.kind === 'boss') {
        boss = e;
        continue;
      }
      const view = this.views.get(e.kind)!;
      const i = counts.get(e.kind)!;
      if (i >= view.mesh.instanceMatrix.count) continue;
      counts.set(e.kind, i + 1);
      const x = e.px + (e.x - e.px) * alpha;
      const y = e.py + (e.y - e.py) * alpha;
      const vx = (e.x - e.px) * 60;
      const spawn = Math.min(1, e.age * 4);
      const scale = spawn * (1 + (e.flash > 0 ? 0.08 : 0));
      _p.set(x, y, 0);
      // Face the travel angle, bank into lateral motion, slight bob.
      _e.set(Math.sin(t * 2 + e.id) * 0.12, Math.max(-0.6, Math.min(0.6, -vx * 0.01)), e.rot, 'ZYX');
      _q.setFromEuler(_e);
      _s.setScalar(scale);
      _m.compose(_p, _q, _s);
      view.mesh.setMatrixAt(i, _m);
      view.flash.setX(i, e.flash > 0 ? 1 : e.kind === 'diver' && e.state === 1 ? 0.35 : 0);
    }
    for (const [kind, view] of this.views) {
      view.mesh.count = counts.get(kind)!;
      view.mesh.instanceMatrix.needsUpdate = true;
      view.flash.needsUpdate = true;
    }
    this.boss.update(boss, alpha, t);
  }
}

/** Léviathan: a layered war-machine with counter-rotating rings and a pulsing core. */
export class BossView {
  readonly group = new Group();
  private readonly flash = uniform(0);
  private readonly rage = uniform(0);
  private readonly ringA: Group;
  private readonly ringB: Group;
  private readonly arms: Group;

  constructor() {
    const g = this.group;
    g.visible = false;
    const hull = hullMaterial('red', this.flash);
    const coreMat = new MeshBasicNodeMaterial();
    const c = hueColor('red');
    coreMat.colorNode = vec3(c.r, c.g, c.b)
      .mul(
        oscSine(time.mul(this.rage.mul(2).add(1)))
          .mul(0.35)
          .add(1)
          .mul(this.rage.mul(3).add(5)),
      )
      .add(vec3(1, 1, 1).mul(this.flash.mul(6)));
    const glowV = glowMaterial('violet', this.flash, 4);
    const glowO = glowMaterial('orange', this.flash, 5);

    const core = new Mesh(new SphereGeometry(4.2, 32, 20), coreMat);
    const shell = new Mesh(new SphereGeometry(6.2, 28, 16, 0, Math.PI * 2, 0.9, Math.PI - 1.8), hull);
    shell.rotation.x = Math.PI / 2;
    g.add(core, shell);

    this.ringA = new Group();
    const ringMeshA = new Mesh(new TorusGeometry(9.5, 0.7, 10, 64), hull);
    this.ringA.add(ringMeshA);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const pod = new Mesh(new OctahedronGeometry(1.1, 0), glowV);
      pod.position.set(Math.cos(a) * 9.5, Math.sin(a) * 9.5, 0.6);
      this.ringA.add(pod);
    }
    this.ringB = new Group();
    const ringMeshB = new Mesh(new TorusGeometry(12.5, 0.35, 8, 72), glowO);
    this.ringB.add(ringMeshB);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const fin = new Mesh(new BoxGeometry(2.2, 0.8, 0.8), hull);
      fin.position.set(Math.cos(a) * 12.5, Math.sin(a) * 12.5, 0);
      fin.rotation.z = a;
      this.ringB.add(fin);
    }
    this.arms = new Group();
    for (const side of [-1, 1]) {
      const arm = new Mesh(new BoxGeometry(10, 2.4, 2), hull);
      arm.position.set(side * 13, 3, -0.5);
      arm.rotation.z = side * -0.35;
      const cannon = new Mesh(new CylinderGeometry(1.1, 1.5, 5, 12), hull);
      cannon.position.set(side * 17.5, 0.5, 0);
      const muzzle = new Mesh(new SphereGeometry(0.9, 12, 8), glowO);
      muzzle.position.set(side * 17.5, -2.4, 0);
      this.arms.add(arm, cannon, muzzle);
    }
    g.add(this.ringA, this.ringB, this.arms);
    g.traverse((o) => {
      o.castShadow = true;
    });
  }

  update(e: Enemy | null, alpha: number, t: number): void {
    const g = this.group;
    if (!e) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha, 0);
    const frac = e.hp / e.maxHp;
    this.rage.value = 1 - frac;
    this.flash.value = e.flash > 0 ? 1 : 0;
    const spin = 0.5 + (1 - frac) * 1.5;
    this.ringA.rotation.z = t * spin;
    this.ringB.rotation.z = -t * spin * 0.6;
    this.ringA.rotation.x = Math.sin(t * 0.7) * 0.25;
    this.ringB.rotation.y = Math.cos(t * 0.5) * 0.2;
    this.arms.rotation.z = Math.sin(t * 0.9) * 0.08;
    g.rotation.x = Math.sin(t * 0.6) * 0.08;
  }
}
