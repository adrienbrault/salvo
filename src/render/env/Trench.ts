import {
  abs,
  attribute,
  dot,
  float,
  floor,
  fract,
  hash,
  int,
  ivec2,
  max,
  mix,
  mx_noise_float,
  normalLocal,
  normalMap,
  normalView,
  normalWorldGeometry,
  parallaxDirection,
  positionLocal,
  positionViewDirection,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  tangentLocal,
  texture,
  textureLoad,
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
  type NodeBuilder,
  Quaternion,
  type Scene,
  Vector3,
  Vector4,
} from 'three/webgpu';
import { Rng } from '../../sim/rng';
import type { LightPool } from '../fx/Lights';
import { AO_LAYER, SCROLL_SPEED } from '../palette';
import type { BiomeDef } from './biomes';
import {
  animateBreak,
  breakIt,
  PART_TEXELS,
  PartTable,
  partCenter,
  posePoint,
  reach,
  resetBreakable,
} from './breakables';
import { HullBuilder, type Surf } from './HullBuilder';
import { type HullTextureSet, LAYER } from './HullTextures';
import { type Breakable, type Materials, type Prop, SEG, type Segment, TRENCH } from './layout';
import { asteroidGeometry } from './rock';
import { MAX_PARTS, SegmentBuilder } from './SegmentBuilder';

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
/** Shockwave rings race out at this speed (world units/s); blast damage travels with them. */
const RING_SPEED = 130;
const TRAIN_HP = 1.2;
/** Seconds between a wrecked train's cars going up, one after the other. */
const CAR_DELAY = 0.16;
const CAR_BURN = 5;
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
  hp: number;
  /** Trench clock when it was blown apart; −1 while whole. */
  deadAt: number;
}

interface Train {
  side: 1 | -1;
  y: number;
  speed: number;
  wait: number;
  on: boolean;
  hp: number;
  /** Trench clock when it was wrecked; −1 while running. */
  wreckAt: number;
  /** Cars already blown up (from the front). */
  lost: number;
}

/** Something that just blew apart (world coordinates), for the FX director. */
export interface Wreck {
  /** collapse: a structure gives way; blast: an explosive one goes up; car / rock: a train car or asteroid. */
  kind: 'collapse' | 'blast' | 'car' | 'rock';
  x: number;
  y: number;
  z: number;
  size: number;
}

/** Something burning on the wreckage (world coordinates, refreshed every frame). */
export interface Fire {
  x: number;
  y: number;
  z: number;
  size: number;
  /** 1 when it starts, falling to 0 as it burns out. */
  heat: number;
}

/** Blast damage on its way to a structure (it lands when the shockwave ring gets there). */
interface Hit {
  b: Breakable;
  seg: Segment;
  dmg: number;
  at: number;
}

export interface TrenchOptions {
  /** Feed environment lamps into the dynamic light pool (needs a large pool). */
  lamps: boolean;
  shadows: boolean;
  /** Parallax offset mapping on the hull (one extra dependent texture read). */
  parallax: boolean;
  /** (char, heat) of blast scorch at a world position (the sea simulation's, see Sea.scorchAt). */
  scorch?: (xy: Node<'vec2'>) => Node<'vec2'>;
}

/** How long a broken structure burns (and its metal glows). */
const burnTime = (b: Breakable): number => (b.explosive ? 10 : Math.min(9, 4 + b.size * 0.15));

/**
 * Reads a vertex's row of the part table (see PartTable): `pose` moves a point or direction
 * the way its part has fallen, `broken` / `heat` say how it looks. Row 0 never moves.
 */
function partNodes(table: PartTable) {
  const row = int(attribute<'float'>('aPart', 'float')).mul(PART_TEXELS);
  const q = textureLoad(table.texture, ivec2(row, int(0)));
  const pivot = textureLoad(table.texture, ivec2(row.add(1), int(0)));
  const state = textureLoad(table.texture, ivec2(row.add(2), int(0)));
  const rotate = (v: Node<'vec3'>): Node<'vec3'> => v.add(q.xyz.cross(q.xyz.cross(v).add(v.mul(q.w))).mul(2));
  return {
    rotate,
    position: rotate(positionLocal.sub(pivot.xyz))
      .add(pivot.xyz)
      .sub(vec3(0, 0, pivot.w)),
    /** Collapsed onto the pivot once broken: the lights of a fallen structure are gone. */
    collapsed: mix(positionLocal, pivot.xyz, state.x),
    state,
  };
}

/** Hull material whose normals and tangents follow falling parts too (for lighting and AO). */
class HullMaterial extends MeshStandardNodeMaterial {
  constructor(private readonly rotate: (v: Node<'vec3'>) => Node<'vec3'>) {
    super();
  }

  override setupPosition(builder: NodeBuilder): Node {
    const p = super.setupPosition(builder);
    normalLocal.assign(this.rotate(normalLocal));
    tangentLocal.assign(this.rotate(tangentLocal));
    return p;
  }
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
  /** Poses of every breakable part in the segment pool (MAX_PARTS rows per segment, after row 0). */
  private readonly table = new PartTable(1 + POOL * MAX_PARTS);
  private rng = new Rng('trench');
  private biomeKey = '';
  /** Seconds since the trench was created (breakables and wrecks are timed against it). */
  private clock = 0;
  private readonly hits: Hit[] = [];
  private readonly detonations: { b: Breakable; seg: Segment; at: number }[] = [];
  private readonly carFires: { x: number; y: number; z: number; at: number }[] = [];
  /** Destruction since the FX director last drained it. */
  readonly wrecks: Wreck[] = [];
  /** What is burning right now. */
  readonly fires: Fire[] = [];

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
    this.cars.receiveShadow = true;
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
      this.trains.push({
        side,
        y: 0,
        speed: 0,
        wait: this.rng.float(0.5, 3),
        on: false,
        hp: TRAIN_HP,
        wreckAt: -1,
        lost: 0,
      });
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

    const part = partNodes(this.table);
    const mat = new HullMaterial(part.rotate);
    mat.positionNode = part.position;
    // Broken structures are charred; freshly broken metal glows with heat.
    const broken = part.state.x.toVertexStage();
    const glow = part.state.y.toVertexStage();
    // Scorch from blasts overhead, on surfaces facing up near the battle (magma shrugs it off).
    const magma = step(LAYER.MAGMA - 0.5, layer).mul(step(layer, LAYER.MAGMA + 0.5));
    const burnt = this.opts.scorch?.(positionWorld.xy) ?? vec2(0, 0);
    const exposed = smoothstep(0.3, 0.8, normalWorldGeometry.z)
      .mul(smoothstep(-46, -22, positionWorld.z))
      .mul(float(1).sub(magma));
    const scorched = burnt.x.mul(exposed);
    const char = float(1)
      .sub(broken.mul(0.72))
      .mul(float(1).sub(scorched.mul(0.8)));
    // Light pools along the trench; the deck far from it sinks into the night.
    const falloff = mix(float(0.3), float(1), smoothstep(230, 60, abs(positionWorld.x)));
    // Macro variation at a frequency unrelated to the tiles hides repetition (UVs are
    // world-aligned, so it is continuous across pieces); micro pitting breaks up highlights.
    const macro = texture(tex.macro, st0.mul(0.113));
    const micro = texture(tex.macro, st0.mul(4.7)).b;
    const grime = smoothstep(0.35, 0.9, macro.r).mul(0.45).add(macro.g.mul(0.12));
    const tone = macro.a.mul(0.3).add(0.85);
    mat.colorNode = alb.rgb
      .mul(info.z)
      .mul(this.tint)
      .mul(falloff)
      .mul(float(1).sub(grime))
      .mul(tone)
      .mul(char);
    mat.aoNode = orm.r;
    mat.roughnessNode = orm.g
      .add(grime.mul(0.3))
      .add(micro.sub(0.5).mul(0.16))
      .add(broken.mul(0.35))
      .add(scorched.mul(0.3))
      .clamp(0.04, 1);
    mat.metalnessNode = orm.b;
    mat.normalNode = normalMap(nrm);
    mat.envMapIntensity = 1;

    // Warm interior light: windows (10×4 grid per tile) switch off now and then.
    const cell = floor(st.mul(vec2(10, 4)));
    const cellHash = hash(cell.x.add(cell.y.mul(57.31)).add(info.w.mul(131.7)));
    // Magma never switches off: it throbs instead.
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
    // Glowing seams and patches on hot wreckage and fresh scorch, cooling from orange to nothing.
    const grain = texture(tex.macro, st0.mul(0.9));
    const speckle = smoothstep(0.62, 0.9, grain.b.mul(0.7).add(macro.b.mul(0.3)));
    const hot = glow.mul(glow).mul(glow).mul(2.6);
    const seared = burnt.y.mul(exposed);
    const embers = vec3(1, 0.3, 0.05).mul(
      hot
        .mul(speckle.add(smoothstep(0.35, 0.1, height).mul(0.3)))
        .add(seared.mul(seared).mul(speckle.mul(2.5).add(0.25))),
    );
    const powered = float(1)
      .sub(broken)
      .mul(float(1).sub(scorched.mul(0.7)));
    mat.emissiveNode = warm.add(accent).add(red).mul(info.y).mul(powered).add(wave).add(embers);
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
    mat.positionNode = partNodes(this.table).collapsed;
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
    mat.positionNode = partNodes(this.table).collapsed;
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
      const seg = new SegmentBuilder(
        this.rng.fork(`seg${i}`),
        this.mats,
        cfg,
        def.remap,
        1 + i * MAX_PARTS,
      ).build(layout);
      for (const b of seg.breakables) this.table.set(b, 0);
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
    this.hits.length = 0;
    this.detonations.length = 0;
    this.carFires.length = 0;
    this.wrecks.length = 0;

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
        hp: 0,
        deadAt: -1,
      };
      a.hp = rockHp(a);
      this.placeAsteroid(a, ar);
      this.asteroids.push(a);
    }
    this.rocks.count = this.asteroids.length;
    this.rocks.visible = this.asteroids.length > 0;
  }

  /**
   * Warm-up: show the asteroid field even in a biome without rocks, so its pipelines compile.
   * Sharing the cars' material is not enough: three names an instanced mesh's matrix buffer
   * after the mesh, so every InstancedMesh compiles shaders of its own.
   */
  prewarm(on: boolean): void {
    this.rocks.count = on ? Math.max(1, this.asteroids.length) : this.asteroids.length;
    this.rocks.visible = this.rocks.count > 0;
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

  /**
   * A blast at world (x, y, z): structures, train cars and asteroids within `radius` take up
   * to `power` damage (less with distance), each when the shockwave ring reaches it.
   */
  damage(x: number, y: number, radius: number, power: number, z = 0): void {
    for (const seg of this.active) {
      const sy = seg.group.position.y;
      for (const b of seg.breakables) {
        if (b.brokenAt >= 0) continue;
        const d = reach(b, x, y - sy, z);
        if (d < radius)
          this.hits.push({ b, seg, dmg: power * (1 - d / radius), at: this.clock + d / RING_SPEED });
      }
    }
    const T = TRENCH;
    for (const tr of this.trains) {
      if (!tr.on || tr.wreckAt >= 0) continue;
      const len = CARS * (CAR_LEN + CAR_GAP);
      const y0 = tr.speed > 0 ? tr.y - len : tr.y;
      const dx = Math.abs(x - tr.side * T.railX) - 2;
      const dyy = Math.max(y0 - y, 0, y - (y0 + len));
      const d = Math.hypot(Math.max(0, dx), dyy) + Math.abs(z - T.terraceZ) * 0.3;
      if (d < radius) {
        tr.hp -= power * (1 - d / radius);
        if (tr.hp <= 0) tr.wreckAt = this.clock;
      }
    }
    for (const a of this.asteroids) {
      if (a.deadAt >= 0) continue;
      const d = Math.max(0, Math.hypot(a.x - x, a.y - y) - a.size.x) + Math.abs(a.z - z) * 0.3;
      if (d < radius) {
        a.hp -= power * (1 - d / radius);
        if (a.hp <= 0) {
          a.deadAt = this.clock;
          this.wrecks.push({ kind: 'rock', x: a.x, y: a.y, z: a.z, size: a.size.x });
        }
      }
    }
  }

  private breakDown(b: Breakable, seg: Segment): void {
    breakIt(b, this.clock);
    for (const p of seg.props) if (p.owner === b) p.restQ.copy(p.obj.quaternion);
    const sy = seg.group.position.y;
    const x = (b.x0 + b.x1) / 2;
    const y = sy + (b.y0 + b.y1) / 2;
    this.wrecks.push({ kind: 'collapse', x, y, z: b.zTop, size: b.size });
    if (b.explosive) this.detonations.push({ b, seg, at: this.clock + this.rng.float(0.15, 0.4) });
  }

  /** Applies blast damage whose ring has arrived, sets off explosives, poses what is falling. */
  private updateDestruction(): void {
    const now = this.clock;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!;
      if (h.at > now) continue;
      this.hits.splice(i, 1);
      if (h.b.brokenAt >= 0 || !this.active.includes(h.seg)) continue;
      h.b.hp -= h.dmg;
      if (h.b.hp <= 0) this.breakDown(h.b, h.seg);
    }
    for (let i = this.detonations.length - 1; i >= 0; i--) {
      const d = this.detonations[i]!;
      if (d.at > now) continue;
      this.detonations.splice(i, 1);
      if (!this.active.includes(d.seg)) continue;
      const b = d.b;
      const x = (b.x0 + b.x1) / 2;
      const y = d.seg.group.position.y + (b.y0 + b.y1) / 2;
      const z = b.zTop * 0.5 + TRENCH.hullZ * 0.5;
      this.wrecks.push({ kind: 'blast', x, y, z, size: b.size });
      this.damage(x, y, 10 + b.size * 0.6, 2, z);
    }
    this.fires.length = 0;
    for (const seg of this.active) {
      const sy = seg.group.position.y;
      for (const b of seg.breakables) {
        if (b.brokenAt < 0) continue;
        const age = now - b.brokenAt;
        const burn = burnTime(b);
        if (age < burn + 0.5) {
          animateBreak(b, age);
          this.table.set(b, Math.max(0, 1 - age / burn));
        }
        if (age >= burn) continue;
        for (const p of b.parts) {
          partCenter(p, _v);
          this.fires.push({
            x: _v.x,
            y: sy + _v.y,
            z: _v.z,
            size: Math.min(24, b.size / b.parts.length),
            heat: 1 - age / burn,
          });
        }
      }
    }
    for (let i = this.carFires.length - 1; i >= 0; i--) {
      const f = this.carFires[i]!;
      const age = now - f.at;
      if (age >= CAR_BURN || f.y < Y_MIN) this.carFires.splice(i, 1);
      else this.fires.push({ x: f.x, y: f.y, z: f.z, size: 4, heat: 1 - age / CAR_BURN });
    }
  }

  update(dt: number, t: number, lights: LightPool, player: { x: number; y: number } | null): void {
    this.clock += dt;
    const dy = SCROLL_SPEED * dt;
    for (const seg of this.active) seg.group.position.y -= dy;
    for (const f of this.carFires) f.y -= dy;
    while (this.active[0] && this.active[0].group.position.y + SEG < Y_MIN) {
      const old = this.active.shift()!;
      old.group.visible = false;
      for (const b of old.breakables) {
        resetBreakable(b);
        this.table.set(b, 0);
      }
      for (const p of old.props) {
        p.obj.position.copy(p.rest);
        if (p.owner) p.obj.quaternion.copy(p.restQ);
      }
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
        if (p.owner && p.owner.brokenAt >= 0) {
          this.ride(p);
          continue;
        }
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
          if (l.owner && l.owner.brokenAt >= 0) continue;
          const wy = sy + l.y;
          if (wy > -130 && wy < 190) lights.add(l.x, wy, l.z, l.color, l.intensity, l.distance);
        }
      }
    }

    this.updateTrains(dt, lights);
    this.updateAsteroids(dt, dy);
    this.updateDestruction();

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

  /** A prop on a broken structure rides its part down. */
  private ride(p: Prop): void {
    const part = p.owner!.parts[p.part ?? 0];
    if (!part) return;
    posePoint(part, p.rest, p.obj.position);
    p.obj.quaternion.multiplyQuaternions(part.q, p.restQ);
  }

  private updateAsteroids(dt: number, dy: number): void {
    if (!this.asteroids.length) return;
    this.asteroids.forEach((a, i) => {
      a.y -= dy + a.drift * dt;
      if (a.y < Y_MIN - 20) {
        a.y += ROCK_SPAN;
        this.placeAsteroid(a, this.rng);
        // A fresh rock comes round in place of a shattered one.
        a.deadAt = -1;
        a.hp = rockHp(a);
      } else if (a.y > Y_MIN - 20 + ROCK_SPAN) a.y -= ROCK_SPAN;
      a.rot.x += a.spin.x * dt;
      a.rot.y += a.spin.y * dt;
      a.rot.z += a.spin.z * dt;
      _v.set(a.x, a.y, a.z);
      _q.setFromEuler(a.rot);
      // Shattered: gone in a fifth of a second.
      const k = a.deadAt < 0 ? 1 : Math.max(0, 1 - (this.clock - a.deadAt) * 5);
      _s.copy(a.size).multiplyScalar(k);
      _m.compose(_v, _q, _s);
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
          tr.hp = TRAIN_HP;
          tr.wreckAt = -1;
          tr.lost = 0;
        }
      } else {
        tr.y += tr.speed * dt;
        if (tr.y < -300 || tr.y > 360 || tr.lost === CARS) {
          tr.on = false;
          tr.wait = this.rng.float(tr.lost ? 4 : 1, tr.lost ? 8 : 5);
        }
      }
      const dir = Math.sign(tr.speed) || 1;
      const wrecked = tr.wreckAt >= 0;
      if (wrecked) {
        // Brakes on: the wreck grinds to a halt against the scrolling trench.
        tr.speed += (-SCROLL_SPEED - tr.speed) * Math.min(1, dt * 2.5);
      }
      for (let c = 0; c < CARS; c++) {
        const y = tr.y - dir * (CAR_LEN / 2 + c * (CAR_LEN + CAR_GAP));
        _v.set(tr.side * T.railX, y, T.terraceZ + 0.75);
        if (wrecked && c === tr.lost && this.clock - tr.wreckAt >= c * CAR_DELAY) {
          tr.lost++;
          this.wrecks.push({ kind: 'car', x: _v.x, y, z: _v.z + 1.2, size: 4 });
          this.carFires.push({ x: _v.x, y, z: _v.z + 0.5, at: this.clock });
        }
        _s.setScalar(tr.on && c >= tr.lost ? 1 : 0);
        _q.identity();
        _m.compose(_v, _q, _s);
        this.cars.setMatrixAt(ti * CARS + c, _m);
      }
      if (tr.on && !wrecked && lights && tr.y > -150 && tr.y < 200) {
        lights.add(tr.side * T.railX, tr.y + dir * 3, T.terraceZ + 2.5, HEADLIGHT, 2200, 48);
      }
    });
    this.cars.instanceMatrix.needsUpdate = true;
  }
}

function rockHp(a: Asteroid): number {
  return 0.5 + a.size.x * 0.12;
}

function carGeometry(): BufferGeometry {
  const b = new HullBuilder();
  const h = CAR_LEN / 2;
  const win: Surf = { layer: LAYER.WINDOWS, tile: 7, v0: -0.05, emit: 1.6 };
  b.box(-1.9, -h, 0, 1.9, h, 2.4, { layer: LAYER.PLATES, tile: 6 }, { px: win, nx: win, nz: null });
  b.box(-1.2, -h + 1, 2.4, 1.2, h - 1, 2.9, { layer: LAYER.GREEBLE, tile: 4 }, { nz: null });
  return b.build();
}
