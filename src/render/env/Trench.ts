import {
  abs,
  attribute,
  dot,
  float,
  floor,
  fract,
  hash,
  max,
  mix,
  mx_noise_float,
  normalMap,
  normalView,
  parallaxDirection,
  positionViewDirection,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  texture,
  time,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import {
  AdditiveBlending,
  type BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  type Node,
  Quaternion,
  type Scene,
  Vector3,
  Vector4,
} from 'three/webgpu';
import { Rng } from '../../sim/rng';
import type { LightPool } from '../fx/Lights';
import { AO_LAYER, SCROLL_SPEED } from '../palette';
import type { BiomeDef } from './biomes';
import { HullBuilder, type Surf } from './HullBuilder';
import { type HullTextureSet, LAYER } from './HullTextures';
import { type Materials, SEG, type Segment, TRENCH } from './layout';
import { asteroidGeometry } from './rock';
import { SegmentBuilder } from './SegmentBuilder';

export { TRENCH } from './layout';

const ACTIVE = 6;
const POOL = 10;
/** A segment whose far end scrolls below this is recycled to the top. */
const Y_MIN = -184;
const MAX_SHOCKS = 4;
const CARS = 6;
const CAR_LEN = 9.6;
const CAR_GAP = 0.9;
const MAX_ROCKS = 48;
/** Asteroids live in this band along y (the visible trench plus margins) and wrap around. */
const ROCK_SPAN = ACTIVE * SEG + 40;

const HEADLIGHT = new Color(1, 0.9, 0.75);

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3(1, 1, 1);

interface Asteroid {
  x: number;
  y: number;
  z: number;
  size: Vector3;
  rot: Euler;
  spin: Vector3;
  drift: number;
}

interface Train {
  side: 1 | -1;
  y: number;
  speed: number;
  wait: number;
  on: boolean;
}

export interface TrenchOptions {
  /** Feed environment lamps into the dynamic light pool (needs a large pool). */
  lamps: boolean;
  shadows: boolean;
  /** Parallax offset mapping on the hull (one extra dependent texture read). */
  parallax: boolean;
}

// ── The trench ─────────────────────────────────────────────────────────────────

/**
 * The world under the battle: a trench scrolling past, whose walls, floor and surroundings
 * come from the current sector's biome (see biomes.ts) — a hull trench over liquid metal, a
 * mined canyon over the void, a shipyard over clouds, a reactor over lava. Maglev trains race
 * along the terraces and turrets track the player. Everything uses one PBR material driven by
 * the procedural texture arrays, with animated emissive classes (flickering windows, energy
 * flowing down the trench, blinking alerts, throbbing magma) and explosion shockwaves that
 * ripple light across every surface.
 *
 * Segments are prebuilt per biome and run seed (a pool of variants) and recycled as they
 * scroll; switching biome swaps geometry only, so no pipeline is ever compiled during play.
 */
export class Trench {
  readonly accent = uniform(new Vector3(0.16, 0.42, 1));
  private readonly tint = uniform(new Vector3(1, 1, 1));
  private readonly warm = uniform(new Color(1, 0.55, 0.25));
  private readonly energy = uniform(1);
  private readonly alert = uniform(0);
  private alertTarget = 0;
  private readonly shocks: Vector4[] = [];
  private readonly shockNode;
  private readonly root = new Group();
  private active: Segment[] = [];
  private readonly spares: Segment[] = [];
  private readonly trains: Train[] = [];
  private readonly cars: InstancedMesh;
  private readonly rocks: InstancedMesh;
  private asteroids: Asteroid[] = [];
  private readonly mats: Materials;
  private rng = new Rng('trench');
  private biomeKey = '';

  constructor(
    scene: Scene,
    tex: HullTextureSet,
    private readonly opts: TrenchOptions,
  ) {
    for (let i = 0; i < MAX_SHOCKS; i++) this.shocks.push(new Vector4(0, 0, 0, 0));
    this.shockNode = uniformArray<'vec4'>(this.shocks, 'vec4');
    const mats: Materials = {
      hull: this.hullMaterial(tex),
      beacon: this.beaconMaterial(),
      cone: this.coneMaterial(),
      shadows: opts.shadows,
    };
    this.mats = mats;

    this.cars = new InstancedMesh(carGeometry(), mats.hull, CARS * 2);
    this.cars.instanceMatrix.setUsage(DynamicDrawUsage);
    this.cars.frustumCulled = false;
    this.cars.castShadow = opts.shadows;
    this.cars.layers.enable(AO_LAYER);
    this.root.add(this.cars);
    this.rocks = new InstancedMesh(asteroidGeometry(7, LAYER.ROCK), mats.hull, MAX_ROCKS);
    this.rocks.instanceMatrix.setUsage(DynamicDrawUsage);
    this.rocks.frustumCulled = false;
    this.rocks.castShadow = opts.shadows;
    this.rocks.receiveShadow = true;
    this.rocks.layers.enable(AO_LAYER);
    this.root.add(this.rocks);
    for (const side of [-1, 1] as const) {
      this.trains.push({ side, y: 0, speed: 0, wait: this.rng.float(0.5, 3), on: false });
    }
    this.updateTrains(0, null);

    scene.add(this.root);
  }

  private hullMaterial(tex: HullTextureSet): MeshStandardNodeMaterial {
    const info = attribute<'vec4'>('aInfo', 'vec4');
    const layer = info.x;
    const st0 = uv();
    // Offset parallax (height lives in ORM alpha): relief shifts toward the viewer.
    const view = parallaxDirection as Node<'vec3'>;
    const height = texture(tex.orm, st0).depth(layer).a;
    const st: Node<'vec2'> = this.opts.parallax ? st0.add(view.xy.mul(height.sub(0.5).mul(0.03))) : st0;
    const alb = texture(tex.albedo, st).depth(layer);
    const orm = texture(tex.orm, st).depth(layer);
    const nrm = texture(tex.normal, st).depth(layer);
    const em = texture(tex.emissive, st).depth(layer);

    const mat = new MeshStandardNodeMaterial();
    // Light pools along the trench; the deck far from it sinks into the night.
    const falloff = mix(float(0.3), float(1), smoothstep(230, 60, abs(positionWorld.x)));
    // Macro variation at a frequency unrelated to the tiles hides repetition (UVs are
    // world-aligned, so it is continuous across pieces); micro pitting breaks up highlights.
    const macro = texture(tex.macro, st0.mul(0.113));
    const micro = texture(tex.macro, st0.mul(4.7)).b;
    const grime = smoothstep(0.35, 0.9, macro.r).mul(0.45).add(macro.g.mul(0.12));
    const tone = macro.a.mul(0.3).add(0.85);
    mat.colorNode = alb.rgb.mul(info.z).mul(this.tint).mul(falloff).mul(float(1).sub(grime)).mul(tone);
    mat.aoNode = orm.r;
    mat.roughnessNode = orm.g.add(grime.mul(0.3)).add(micro.sub(0.5).mul(0.16)).clamp(0.04, 1);
    mat.metalnessNode = orm.b;
    mat.normalNode = normalMap(nrm);
    mat.envMapIntensity = 1;

    // Warm interior light: windows (10×4 grid per tile) switch off now and then.
    const cell = floor(st.mul(vec2(10, 4)));
    const cellHash = hash(cell.x.add(cell.y.mul(57.31)).add(info.w.mul(131.7)));
    // Magma never switches off: it throbs instead.
    const magma = step(LAYER.MAGMA - 0.5, layer).mul(step(layer, LAYER.MAGMA + 0.5));
    const lit = max(step(0.12, fract(time.mul(0.035).add(cellHash))), magma);
    const heat = magma
      .mul(
        sin(time.mul(1.1).add(positionWorld.y.mul(0.07)))
          .mul(0.5)
          .add(0.5),
      )
      .add(1);
    const warm = this.warm.mul(em.r.mul(lit).mul(heat).mul(1.5));
    // Accent: energy pulses flowing down the trench toward the player; boss alert turns it red.
    const flow = pow(fract(positionWorld.y.div(96).add(time.mul(0.85))), 10);
    const alarm = this.alert.mul(sin(time.mul(4)).mul(0.5).add(0.5));
    const accentCol = mix(this.accent, vec3(1, 0.06, 0.04), alarm);
    const accent = accentCol.mul(em.g.mul(flow.mul(2.5).add(0.7)).mul(this.energy));
    const blink = step(0.55, fract(time.mul(0.6).add(cellHash)));
    const red = vec3(1, 0.05, 0.03).mul(em.b.mul(blink.mul(1.5).add(this.alert.mul(2))));
    // Explosion shockwaves: rings of light racing across every surface.
    let ring: Node<'float'> = float(0);
    for (let i = 0; i < MAX_SHOCKS; i++) {
      const s = this.shockNode.element(i);
      const d = positionWorld.xy.sub(s.xy).length();
      ring = ring.add(smoothstep(6, 0, d.sub(s.z).abs()).mul(s.w));
    }
    const wave = accentCol.mul(ring.mul(em.g.mul(4).add(em.r.mul(2)).add(0.35)));
    mat.emissiveNode = warm.add(accent).add(red).mul(info.y).add(wave);
    return mat;
  }

  private beaconMaterial(): MeshBasicNodeMaterial {
    const b = attribute<'vec2'>('aBeacon', 'vec2');
    const kind = b.x;
    const ph = b.y;
    const k0 = float(1).sub(step(0.5, kind));
    const k1 = step(0.5, kind).sub(step(1.5, kind));
    const k2 = step(1.5, kind).sub(step(2.5, kind));
    const k3 = step(2.5, kind).sub(step(3.5, kind));
    const k4 = step(3.5, kind);
    const red = vec3(1, 0.06, 0.04).mul(
      pow(sin(time.mul(2.6).add(ph)).mul(0.5).add(0.5), 6)
        .mul(9)
        .add(0.4)
        .add(this.alert.mul(4)),
    );
    const acc = this.accent.mul(sin(time.mul(1.3).add(ph)).mul(1.5).add(4)).mul(this.energy);
    const strobe = vec3(1, 1, 1).mul(
      step(0.94, fract(time.mul(0.7).add(ph.mul(0.37))))
        .mul(22)
        .add(0.3),
    );
    const lamp = vec3(1, 0.8, 0.6).mul(7);
    const flow = this.accent.mul(
      pow(fract(positionWorld.y.div(96).add(time.mul(0.85))), 10)
        .mul(7)
        .add(1.4),
    );
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = red.mul(k0).add(acc.mul(k1)).add(strobe.mul(k2)).add(lamp.mul(k3)).add(flow.mul(k4));
    return mat;
  }

  private coneMaterial(): MeshBasicNodeMaterial {
    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    mat.side = DoubleSide;
    mat.fog = false;
    const along = uv().y; // 1 at the lamp, 0 at the far end
    const edge = pow(abs(dot(normalView, positionViewDirection)), 2);
    const dust = mx_noise_float(positionWorld.mul(0.3).add(vec3(0, 0, time.mul(0.5))))
      .mul(0.4)
      .add(0.8);
    const col = vec3(1, 0.78, 0.55).mul(pow(along, 1.8).mul(edge).mul(dust).mul(0.3));
    mat.colorNode = vec4(col, 1);
    return mat;
  }

  /**
   * Switch to a biome, rebuilding the segment pool from `seed` (each run gets its own
   * trench). Rebuilding only happens when the biome or seed actually changes.
   */
  setBiome(def: BiomeDef, seed: string): void {
    const accent = new Color(def.accent);
    this.accent.value.set(accent.r, accent.g, accent.b);
    // Paint is kept dark so emissives, lamps and gunfire carry the image.
    this.tint.value.set(...def.hull).multiplyScalar(0.6);
    this.warm.value.setRGB(...def.warm);

    const key = `${seed}/${def.id}`;
    if (key === this.biomeKey) return;
    this.biomeKey = key;
    this.rng = new Rng(key);

    for (const seg of [...this.active, ...this.spares]) {
      this.root.remove(seg.group);
      seg.group.traverse((o) => o instanceof Mesh && o.geometry.dispose());
    }
    const { cfg, layout } = def.plan(this.rng.fork('plan'));
    const segments: Segment[] = [];
    for (let i = 0; i < POOL; i++) {
      const seg = new SegmentBuilder(this.rng.fork(`seg${i}`), this.mats, cfg, def.remap).build(layout);
      seg.group.visible = false;
      this.root.add(seg.group);
      segments.push(seg);
    }
    this.active = segments.slice(0, ACTIVE);
    this.active.forEach((seg, k) => {
      seg.group.position.y = Y_MIN + k * SEG;
      seg.group.visible = true;
    });
    this.spares.length = 0;
    this.spares.push(...segments.slice(ACTIVE));

    const ar = this.rng.fork('asteroids');
    this.asteroids = [];
    for (let i = 0; i < Math.min(MAX_ROCKS, def.asteroids); i++) {
      const z = ar.float(-105, -30);
      const r = ar.float(1.5, 4) + ((-30 - z) / 75) * ar.float(1, 6);
      const a: Asteroid = {
        x: 0,
        y: Y_MIN + ar.float(0, ROCK_SPAN),
        z,
        size: new Vector3(ar.float(0.7, 1.3), ar.float(0.7, 1.3), ar.float(0.6, 1.1)).multiplyScalar(r),
        rot: new Euler(ar.float(0, 6), ar.float(0, 6), ar.float(0, 6)),
        spin: new Vector3(ar.float(-0.3, 0.3), ar.float(-0.3, 0.3), ar.float(-0.3, 0.3)),
        drift: ar.float(-3, 3),
      };
      this.placeAsteroid(a, ar);
      this.asteroids.push(a);
    }
    this.rocks.count = this.asteroids.length;
    this.rocks.visible = this.asteroids.length > 0;
  }

  /** Random x that keeps the rock clear of the canyon walls at its depth. */
  private placeAsteroid(a: Asteroid, r: Rng): void {
    const wall = 24.7 + (a.z + 110) * 0.113;
    const room = Math.max(0, wall - 3 - Math.max(a.size.x, a.size.y));
    a.x = r.float(-room, room);
  }

  /** Mult gauge → how hard the trench's energy lines pulse. */
  setEnergy(gauge: number): void {
    this.energy.value = 0.8 + Math.min(1.4, (gauge - 1) * 0.3);
  }

  /** Boss alert: accent turns to pulsing red, alert lights flare. */
  setAlert(on: boolean): void {
    this.alertTarget = on ? 1 : 0;
  }

  /** Ring of light spreading across the hull from world (x, y). */
  shockwave(x: number, y: number, strength: number): void {
    let slot = this.shocks[0]!;
    for (const s of this.shocks) if (s.w < slot.w) slot = s;
    slot.set(x, y, 0, strength);
  }

  update(dt: number, t: number, lights: LightPool, player: { x: number; y: number } | null): void {
    const dy = SCROLL_SPEED * dt;
    for (const seg of this.active) seg.group.position.y -= dy;
    while (this.active[0] && this.active[0].group.position.y + SEG < Y_MIN) {
      const old = this.active.shift()!;
      old.group.visible = false;
      const top = this.active[this.active.length - 1]!;
      const next = this.spares.splice(Math.floor(this.rng.next() * this.spares.length), 1)[0]!;
      this.spares.push(old);
      next.group.position.y = top.group.position.y + SEG;
      next.group.visible = true;
      this.active.push(next);
    }

    for (const seg of this.active) {
      const sy = seg.group.position.y;
      for (const p of seg.props) {
        if (p.kind === 'spin') {
          p.obj.rotation.z += p.speed * dt;
          continue;
        }
        const wy = sy + p.y;
        const target = player
          ? Math.atan2(player.y - wy, player.x - p.x) - Math.PI / 2
          : Math.sin(t * 0.3 + p.x) * 1.2;
        let d = target - p.angle;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        p.angle += d * Math.min(1, dt * 2.5);
        p.obj.rotation.z = p.angle;
      }
      if (this.opts.lamps) {
        for (const l of seg.lamps) {
          const wy = sy + l.y;
          if (wy > -130 && wy < 190) lights.add(l.x, wy, l.z, l.color, l.intensity, l.distance);
        }
      }
    }

    this.updateTrains(dt, lights);
    this.updateAsteroids(dt, dy);

    for (const s of this.shocks) {
      if (s.w <= 0.002) {
        s.w = 0;
        continue;
      }
      s.z += 130 * dt;
      s.w *= Math.exp(-dt * 2.2);
      s.y -= dy;
    }
    this.alert.value += (this.alertTarget - this.alert.value) * Math.min(1, dt * 2);
  }

  private updateAsteroids(dt: number, dy: number): void {
    if (!this.asteroids.length) return;
    this.asteroids.forEach((a, i) => {
      a.y -= dy + a.drift * dt;
      if (a.y < Y_MIN - 20) {
        a.y += ROCK_SPAN;
        this.placeAsteroid(a, this.rng);
      } else if (a.y > Y_MIN - 20 + ROCK_SPAN) a.y -= ROCK_SPAN;
      a.rot.x += a.spin.x * dt;
      a.rot.y += a.spin.y * dt;
      a.rot.z += a.spin.z * dt;
      _v.set(a.x, a.y, a.z);
      _q.setFromEuler(a.rot);
      _m.compose(_v, _q, a.size);
      this.rocks.setMatrixAt(i, _m);
    });
    this.rocks.instanceMatrix.needsUpdate = true;
  }

  private updateTrains(dt: number, lights: LightPool | null): void {
    const T = TRENCH;
    this.trains.forEach((tr, ti) => {
      if (!tr.on) {
        tr.wait -= dt;
        if (tr.wait <= 0) {
          const up = this.rng.chance(0.5);
          tr.speed = up ? this.rng.float(24, 42) : -this.rng.float(34, 60);
          tr.y = up ? -240 : 300;
          tr.on = true;
        }
      } else {
        tr.y += tr.speed * dt;
        if (tr.y < -300 || tr.y > 360) {
          tr.on = false;
          tr.wait = this.rng.float(1, 5);
        }
      }
      const dir = Math.sign(tr.speed) || 1;
      for (let c = 0; c < CARS; c++) {
        const y = tr.y - dir * (CAR_LEN / 2 + c * (CAR_LEN + CAR_GAP));
        _v.set(tr.side * T.railX, y, T.terraceZ + 0.75);
        _s.setScalar(tr.on ? 1 : 0);
        _q.identity();
        _m.compose(_v, _q, _s);
        this.cars.setMatrixAt(ti * CARS + c, _m);
      }
      if (tr.on && lights && tr.y > -150 && tr.y < 200) {
        lights.add(tr.side * T.railX, tr.y + dir * 3, T.terraceZ + 2.5, HEADLIGHT, 2200, 48);
      }
    });
    this.cars.instanceMatrix.needsUpdate = true;
  }
}

function carGeometry(): BufferGeometry {
  const b = new HullBuilder();
  const h = CAR_LEN / 2;
  const win: Surf = { layer: LAYER.WINDOWS, tile: 7, v0: -0.05, emit: 1.6 };
  b.box(-1.9, -h, 0, 1.9, h, 2.4, { layer: LAYER.PLATES, tile: 6 }, { px: win, nx: win, nz: null });
  b.box(-1.2, -h + 1, 2.4, 1.2, h - 1, 2.9, { layer: LAYER.GREEBLE, tile: 4 }, { nz: null });
  return b.build();
}
