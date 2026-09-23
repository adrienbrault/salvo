import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  abs,
  attribute,
  dot,
  float,
  floor,
  fract,
  hash,
  mix,
  mx_noise_float,
  normalMap,
  normalView,
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
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  type Node,
  type Object3D,
  Quaternion,
  type Scene,
  Vector3,
  Vector4,
} from 'three/webgpu';
import { Rng } from '../../sim/rng';
import type { LightPool } from '../fx/Lights';
import { FLOOR_Z, SCROLL_SPEED } from '../palette';
import { HullBuilder, type Surf } from './HullBuilder';
import { type HullTextureSet, LAYER } from './HullTextures';

/** Cross-section of the trench, for the +x side (mirrored for −x). World units. */
export const TRENCH = {
  hullZ: -6,
  lipX: 46,
  lipW: 3,
  lipH: 1.2,
  terraceZ: -18,
  terraceOut: 42,
  terraceIn: 35,
  bedX: 31,
  bedZ: FLOOR_Z - 5,
  deckX: 240,
  railX: 38.4,
} as const;

const SEG = 64;
const ACTIVE = 6;
const POOL = 10;
/** A segment whose far end scrolls below this is recycled to the top. */
const Y_MIN = -184;
const MAX_SHOCKS = 4;
const CARS = 6;
const CAR_LEN = 9.6;
const CAR_GAP = 0.9;

/** Beacon kinds (see beacon material). */
const B_RED = 0;
const B_ACCENT = 1;
const B_STROBE = 2;
const B_LAMP = 3;
const B_FLOW = 4;

const WARM_LIGHT = new Color(1, 0.72, 0.45);
const HEADLIGHT = new Color(1, 0.9, 0.75);

interface Prop {
  obj: Object3D;
  kind: 'dish' | 'turret';
  x: number;
  y: number;
  speed: number;
  angle: number;
}

interface Lamp {
  x: number;
  y: number;
  z: number;
  color: Color;
  intensity: number;
  distance: number;
}

interface Segment {
  group: Group;
  props: Prop[];
  lamps: Lamp[];
}

interface Train {
  side: 1 | -1;
  y: number;
  speed: number;
  wait: number;
  on: boolean;
}

interface Materials {
  hull: MeshStandardNodeMaterial;
  beacon: MeshBasicNodeMaterial;
  cone: MeshBasicNodeMaterial;
  shadows: boolean;
}

/** Features that must line up across segments (so they are fixed per trench, not per segment). */
interface SideConfig {
  pipes: { z: number; r: number }[];
}

export interface TrenchOptions {
  /** Feed environment lamps into the dynamic light pool (needs a large pool). */
  lamps: boolean;
  shadows: boolean;
}

// ── Emissive-only geometry: beacons and light bars ─────────────────────────────

class BeaconBuilder {
  private readonly pos: number[] = [];
  private readonly attr: number[] = [];

  private tri(a: number[], b: number[], c: number[], kind: number, phase: number): void {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.attr.push(kind, phase);
  }

  /** Small octahedron light. */
  add(x: number, y: number, z: number, r: number, kind: number, phase: number): void {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const a = [x + sx * r, y, z];
          const b = [x, y + sy * r, z];
          const c = [x, y, z + sz * r * 1.3];
          if (sx * sy * sz > 0) this.tri(a, b, c, kind, phase);
          else this.tri(a, c, b, kind, phase);
        }
      }
    }
  }

  /** Glowing bar (box without bottom). */
  bar(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kind: number, phase = 0): void {
    const q = (a: number[], b: number[], c: number[], d: number[]) => {
      this.tri(a, b, c, kind, phase);
      this.tri(a, c, d, kind, phase);
    };
    q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    q([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]);
    q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
    q([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]);
  }

  build(): BufferGeometry | null {
    if (this.pos.length === 0) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aBeacon', new Float32BufferAttribute(this.attr, 2));
    g.computeBoundingSphere();
    return g;
  }
}

// ── Segment layout ─────────────────────────────────────────────────────────────

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3(1, 1, 1);
const ONE = new Vector3(1, 1, 1);
const DOWN = new Vector3(0, -1, 0);

type SideFace = 'in' | 'out' | 'py' | 'ny' | 'pz' | 'nz';

class SegmentBuilder {
  private readonly hb = new HullBuilder();
  private readonly bb = new BeaconBuilder();
  private readonly cones: BufferGeometry[] = [];
  private readonly props: Prop[] = [];
  private readonly lamps: Lamp[] = [];
  private readonly group = new Group();

  constructor(
    private readonly rng: Rng,
    private readonly m: Materials,
    private readonly cfg: SideConfig,
  ) {}

  build(): Segment {
    for (const s of [-1, 1] as const) this.side(s);
    const roll = this.rng.next();
    if (roll < 0.4) this.bridge();
    else if (roll < 0.65) this.pipeCrossing();

    const hull = new Mesh(this.hb.build(), this.m.hull);
    hull.castShadow = this.m.shadows;
    hull.receiveShadow = true;
    this.group.add(hull);
    const beacons = this.bb.build();
    if (beacons) this.group.add(new Mesh(beacons, this.m.beacon));
    if (this.cones.length) {
      const cones = new Mesh(mergeGeometries(this.cones), this.m.cone);
      cones.renderOrder = 5;
      this.group.add(cones);
    }
    return { group: this.group, props: this.props, lamps: this.lamps };
  }

  /** Box given in distances from the trench axis on side `s` (xa < xb). */
  private sbox(
    s: 1 | -1,
    xa: number,
    xb: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    surf: Surf,
    faces: Partial<Record<SideFace, Surf | null>> = {},
  ): void {
    const map: Partial<Record<'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz', Surf | null>> = {};
    for (const [k, v] of Object.entries(faces) as [SideFace, Surf | null][]) {
      if (k === 'in') map[s > 0 ? 'nx' : 'px'] = v;
      else if (k === 'out') map[s > 0 ? 'px' : 'nx'] = v;
      else map[k] = v;
    }
    const x0 = s > 0 ? xa : -xb;
    const x1 = s > 0 ? xb : -xa;
    this.hb.box(x0, y0, z0, x1, y1, z1, surf, map);
  }

  /** Horizontal deck strip between distances xa..xb, full segment length. */
  private deck(s: 1 | -1, xa: number, xb: number, z: number, surf: Surf): void {
    const x0 = s > 0 ? xa : -xb;
    const tile = surf.tile ?? 16;
    this.hb.quad([x0, 0, z], [xb - xa, 0, 0], [0, SEG, 0], { ...surf, u0: x0 / tile, v0: 0 });
  }

  /** Sloped wall facing the trench, from (xBottom, zBottom) up to (xTop, zTop), over ya..yb. */
  private wall(
    s: 1 | -1,
    ya: number,
    yb: number,
    xBottom: number,
    zBottom: number,
    xTop: number,
    zTop: number,
    surf: Surf,
  ): void {
    const tile = surf.tile ?? 16;
    this.hb.quad(
      [s * xBottom, s > 0 ? yb : ya, zBottom],
      [0, -s * (yb - ya), 0],
      [s * (xTop - xBottom), 0, zTop - zBottom],
      { ...surf, u0: (s > 0 ? -yb : ya) / tile },
    );
  }

  private side(s: 1 | -1): void {
    const T = TRENCH;
    const r = this.rng;

    // Hull deck in bands of decreasing detail away from the trench.
    this.deck(s, T.lipX + T.lipW, 62, T.hullZ, { layer: r.pick([LAYER.DECK, LAYER.PLATES]), tile: 16 });
    this.deck(s, 62, 140, T.hullZ, { layer: r.pick([LAYER.PLATES, LAYER.PANELS]), tile: 32, shade: 0.9 });
    this.deck(s, 140, T.deckX, T.hullZ, {
      layer: r.pick([LAYER.PLATES, LAYER.GRIME]),
      tile: 40,
      shade: 0.75,
    });

    // Parapet along the trench edge with a flowing light bar and chase beacons.
    this.sbox(
      s,
      T.lipX,
      T.lipX + T.lipW,
      0,
      SEG,
      T.hullZ,
      T.hullZ + T.lipH,
      { layer: LAYER.RIBS, tile: 6 },
      { in: { layer: LAYER.HAZARD, tile: 4 }, nz: null, py: null, ny: null },
    );
    this.bb.bar(
      s > 0 ? T.lipX - 0.12 : -T.lipX,
      0,
      T.hullZ + 0.35,
      s > 0 ? T.lipX : -T.lipX + 0.12,
      SEG,
      T.hullZ + 0.6,
      B_FLOW,
    );
    for (let y = 4; y < SEG; y += 8) {
      this.bb.add(s * (T.lipX + 1.5), y, T.hullZ + T.lipH + 0.3, 0.32, B_RED, -y * 0.09);
    }

    // Upper wall: panels of different kinds, with pillars and lamps.
    this.wallPanels(s, T.terraceOut, T.terraceZ, T.lipX, T.hullZ, [
      { layer: LAYER.WINDOWS, tile: 16 },
      { layer: LAYER.WINDOWS, tile: 16 },
      { layer: LAYER.PANELS, tile: 16 },
      { layer: LAYER.RIBS, tile: 16 },
      { layer: LAYER.CIRCUIT, tile: 12 },
      { layer: LAYER.GRILLE, tile: 10 },
      { layer: LAYER.STRIPS, tile: 12.6 },
    ]);
    for (const y of [0, 32]) {
      this.sbox(
        s,
        T.terraceOut - 1.2,
        T.terraceOut + 2.4,
        y - 1.3,
        y + 1.3,
        T.terraceZ,
        T.hullZ - 1.4,
        { layer: LAYER.RIBS, tile: 6 },
        { nz: null, out: null },
      );
      this.bb.add(s * (T.terraceOut - 1.4), y, T.hullZ - 2.2, 0.3, B_ACCENT, y);
    }
    for (const y of [16, 48]) if (r.chance(0.8)) this.lamp(s, y);

    // Terrace: deck, maglev rails, edge curb and service boxes.
    this.deck(s, T.terraceIn, T.terraceOut, T.terraceZ, {
      layer: r.pick([LAYER.DECK, LAYER.GRILLE, LAYER.PLATES]),
      tile: 12,
      shade: 0.85,
    });
    for (const off of [-1.1, 1.1]) {
      const x = T.railX + off;
      this.bb.bar(
        s > 0 ? x - 0.18 : -x - 0.18,
        0,
        T.terraceZ,
        s > 0 ? x + 0.18 : -x + 0.18,
        SEG,
        T.terraceZ + 0.28,
        B_FLOW,
      );
    }
    this.sbox(
      s,
      T.terraceIn - 0.5,
      T.terraceIn + 0.6,
      0,
      SEG,
      T.terraceZ,
      T.terraceZ + 0.7,
      { layer: LAYER.HAZARD, tile: 4 },
      { nz: null, py: null, ny: null },
    );
    let y = r.float(2, 8);
    while (y < SEG - 4) {
      const len = r.float(3, 9);
      if (r.chance(0.7)) {
        this.sbox(
          s,
          40.4,
          T.terraceOut - 0.1,
          y,
          y + len,
          T.terraceZ,
          T.terraceZ + r.float(0.8, 1.8),
          { layer: r.pick([LAYER.PANELS, LAYER.GRILLE, LAYER.RADIATOR]), tile: 4 },
          { nz: null, out: null },
        );
      }
      y += len + r.float(1, 6);
    }

    // Lower wall down into the liquid metal, with trench-long pipes.
    this.wallPanels(s, T.bedX, T.bedZ, T.terraceIn, T.terraceZ, [
      { layer: LAYER.GREEBLE, tile: 14 },
      { layer: LAYER.PLATES, tile: 16 },
      { layer: LAYER.RIBS, tile: 14 },
      { layer: LAYER.GRIME, tile: 16 },
      { layer: LAYER.WINDOWS, tile: 14, emit: 0.7 },
    ]);
    for (const p of this.cfg.pipes) {
      const xw = T.bedX + ((T.terraceIn - T.bedX) * (p.z - T.bedZ)) / (T.terraceZ - T.bedZ);
      const cx = s * (xw - p.r * 0.4);
      this.hb.tube([cx, 0, p.z], [cx, SEG, p.z], p.r, 12, { layer: LAYER.PLATES, tile: 4, shade: 0.9 });
      for (let cy = 6; cy < SEG; cy += 16) {
        this.hb.tube([cx, cy, p.z], [cx, cy + 1.2, p.z], p.r + 0.22, 12, { layer: LAYER.HAZARD, tile: 3 });
      }
    }

    // Near-deck greebles (only seen on wide screens) and a trench-long conduit.
    this.hb.tube([s * 52, 0, T.hullZ + 0.55], [s * 52, SEG, T.hullZ + 0.55], 0.55, 8, {
      layer: LAYER.RIBS,
      tile: 2,
    });
    y = r.float(0, 6);
    while (y < SEG - 5) {
      const len = r.float(5, 14);
      this.nearGreeble(s, 54, 61, y, y + len);
      y += len + r.float(2, 7);
    }

    // Far deck: a grid of cells filled with towers, domes, radiators, masts, dishes, turrets.
    const bands: [number, number][] = [
      [66, 90],
      [94, 124],
      [128, 166],
      [170, 214],
    ];
    bands.forEach(([x0, x1], bi) => {
      for (const [y0, y1] of [
        [2, 30],
        [34, 62],
      ] as const) {
        this.cell(s, x0, x1, y0, y1, bi);
      }
    });
  }

  private wallPanels(s: 1 | -1, xB: number, zB: number, xT: number, zT: number, kinds: Surf[]): void {
    let ya = 0;
    while (ya < SEG) {
      const n = this.rng.int(1, 2);
      const yb = Math.min(SEG, ya + n * 16);
      const k = this.rng.pick(kinds);
      this.wall(s, ya, yb, xB, zB, xT, zT, {
        ...k,
        phase: this.rng.next(),
        shade: this.rng.float(0.85, 1.05),
      });
      ya = yb;
    }
  }

  private lamp(s: 1 | -1, y: number): void {
    const T = TRENCH;
    this.sbox(
      s,
      43.4,
      45.6,
      y - 1,
      y + 1,
      T.hullZ - 3.4,
      T.hullZ - 2,
      { layer: LAYER.PLATES, tile: 4 },
      { out: null },
    );
    this.bb.add(s * 43.6, y, T.hullZ - 2.9, 0.42, B_LAMP, 0);
    const apex = new Vector3(s * 43.6, y, T.hullZ - 3);
    const target = new Vector3(s * 31, y, FLOOR_Z);
    const dir = target.clone().sub(apex);
    const h = dir.length();
    dir.normalize();
    const g = new ConeGeometry(h * 0.22, h, 20, 1, true);
    g.translate(0, -h / 2, 0);
    _q.setFromUnitVectors(DOWN, dir);
    _m.compose(apex, _q, ONE);
    g.applyMatrix4(_m);
    this.cones.push(g);
    this.lamps.push({
      x: s * 37,
      y,
      z: T.terraceZ + 4,
      color: WARM_LIGHT,
      intensity: 900,
      distance: 36,
    });
  }

  private nearGreeble(s: 1 | -1, xa: number, xb: number, y0: number, y1: number): void {
    const r = this.rng;
    const z = TRENCH.hullZ;
    const kind = r.pick(['vent', 'rad', 'box', 'dome', 'none'] as const);
    if (kind === 'vent') {
      this.sbox(
        s,
        xa,
        xb,
        y0,
        y1,
        z,
        z + r.float(0.8, 1.6),
        { layer: LAYER.PANELS, tile: 6 },
        {
          pz: { layer: LAYER.GRILLE, tile: 4 },
          nz: null,
        },
      );
    } else if (kind === 'rad') {
      for (let y = y0; y < y1; y += 1.3) {
        this.sbox(s, xa, xb, y, y + 0.45, z, z + 2.2, { layer: LAYER.RADIATOR, tile: 4 }, { nz: null });
      }
    } else if (kind === 'box') {
      this.sbox(
        s,
        xa + 1,
        xb,
        y0,
        y1,
        z,
        z + r.float(1.2, 3),
        { layer: LAYER.GREEBLE, tile: 6 },
        {
          nz: null,
        },
      );
      this.bb.add(s * (xa + 1.5), (y0 + y1) / 2, z + 3.2, 0.3, B_RED, r.float(0, 6));
    } else if (kind === 'dome') {
      const rad = Math.min(3.2, (y1 - y0) / 2);
      this.dome(s * ((xa + xb) / 2), (y0 + y1) / 2, rad, LAYER.PANELS);
    }
  }

  private dome(x: number, y: number, rad: number, layer: number): void {
    const z = TRENCH.hullZ;
    const prof: [number, number][] = [
      [rad + 0.5, 0],
      [rad + 0.5, 0.6],
      [rad, 0.6],
    ];
    for (let k = 1; k <= 8; k++) {
      const a = (k / 8) * (Math.PI / 2);
      prof.push([Math.max(0.001, rad * Math.cos(a)), 0.6 + rad * Math.sin(a) * 0.8]);
    }
    this.hb.lathe(x, y, z, prof, 20, { layer, tile: 6 });
    this.bb.add(x, y, z + 0.9 + rad * 0.8, 0.35, B_STROBE, this.rng.float(0, 6));
  }

  private cell(s: 1 | -1, x0: number, x1: number, y0: number, y1: number, band: number): void {
    const r = this.rng;
    const kind = r.weighted(
      ['tower', 'tower', 'dome', 'radiator', 'mast', 'dish', 'turret', 'pad', 'none'] as const,
      (k) => (k === 'tower' ? 3 : k === 'none' ? 1.2 : 1),
    );
    const z = TRENCH.hullZ;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    if (kind === 'tower') {
      let ax = x0 + r.float(0, 4);
      let bx = x1 - r.float(0, 4);
      let ay = y0 + r.float(0, 4);
      let by = y1 - r.float(0, 4);
      let zz = z;
      let h = r.float(4, 10) + band * r.float(1, 4);
      const tiers = r.int(1, 3);
      const win: Surf = { layer: LAYER.WINDOWS, tile: 12, emit: r.float(0.5, 1.4), phase: r.next() };
      for (let t = 0; t < tiers; t++) {
        this.sbox(
          s,
          ax,
          bx,
          ay,
          by,
          zz,
          zz + h,
          { layer: r.pick([LAYER.PLATES, LAYER.GRILLE]), tile: 8 },
          {
            in: win,
            out: win,
            py: win,
            ny: win,
            nz: null,
          },
        );
        zz += h;
        const shrinkX = (bx - ax) * r.float(0.12, 0.25);
        const shrinkY = (by - ay) * r.float(0.12, 0.25);
        ax += shrinkX;
        bx -= shrinkX;
        ay += shrinkY;
        by -= shrinkY;
        h *= r.float(0.35, 0.7);
      }
      for (const [px, py] of [
        [ax, ay],
        [bx, by],
      ] as const) {
        this.bb.add(s * px, py, zz + 0.3, 0.35, B_RED, r.float(0, 6));
      }
      if (r.chance(0.5)) this.mast(s * ((ax + bx) / 2), (ay + by) / 2, zz, r.float(4, 10));
    } else if (kind === 'dome') {
      this.dome(
        s * cx,
        cy,
        Math.min(x1 - x0, y1 - y0) * r.float(0.3, 0.42),
        r.pick([LAYER.PANELS, LAYER.PLATES]),
      );
    } else if (kind === 'radiator') {
      const h = r.float(2.5, 5);
      this.sbox(s, x0, x1, y0, y1, z, z + 0.6, { layer: LAYER.PLATES, tile: 8 }, { nz: null });
      for (let y = y0 + 1; y < y1 - 1; y += 1.6) {
        this.sbox(
          s,
          x0 + 1,
          x1 - 1,
          y,
          y + 0.5,
          z + 0.6,
          z + h,
          { layer: LAYER.RADIATOR, tile: 6 },
          { nz: null },
        );
      }
    } else if (kind === 'mast') {
      this.mast(s * cx, cy, z, r.float(10, 24));
    } else if (kind === 'dish') {
      this.dish(s * cx, cy, Math.min(x1 - x0, y1 - y0) * r.float(0.22, 0.34));
    } else if (kind === 'turret') {
      this.turret(s * cx, cy);
    } else if (kind === 'pad') {
      this.sbox(
        s,
        x0 + 1,
        x1 - 1,
        y0 + 1,
        y1 - 1,
        z,
        z + 0.4,
        { layer: LAYER.HAZARD, tile: 8 },
        {
          pz: { layer: LAYER.DECK, tile: Math.min(x1 - x0, y1 - y0) - 2, u0: 0, v0: 0 },
          nz: null,
        },
      );
      for (const [px, py] of [
        [x0 + 2, y0 + 2],
        [x1 - 2, y0 + 2],
        [x0 + 2, y1 - 2],
        [x1 - 2, y1 - 2],
      ] as const) {
        this.bb.add(s * px, py, z + 0.7, 0.3, B_ACCENT, r.float(0, 6));
      }
    }
  }

  private mast(x: number, y: number, z0: number, h: number): void {
    this.hb.tube([x, y, z0], [x, y, z0 + h], 0.32, 8, { layer: LAYER.RIBS, tile: 2 });
    for (const k of [0.45, 0.8]) {
      const zz = z0 + h * k;
      this.hb.box(x - 1.6, y - 0.12, zz, x + 1.6, y + 0.12, zz + 0.25, { layer: LAYER.PLATES, tile: 2 });
    }
    this.bb.add(x, y, z0 + h + 0.3, 0.45, B_STROBE, this.rng.float(0, 6));
    this.bb.add(x - 1.6, y, z0 + h * 0.8 + 0.4, 0.25, B_RED, this.rng.float(0, 6));
    this.bb.add(x + 1.6, y, z0 + h * 0.8 + 0.4, 0.25, B_RED, this.rng.float(0, 6));
  }

  private dish(x: number, y: number, rad: number): void {
    const z = TRENCH.hullZ;
    this.hb.lathe(
      x,
      y,
      z,
      [
        [1.6, 0],
        [1.6, 0.8],
        [0.7, 1.2],
        [0.7, 3.2],
      ],
      12,
      { layer: LAYER.PLATES, tile: 4 },
    );
    const b = new HullBuilder();
    const depth = rad * 0.35;
    const inner: [number, number][] = [];
    const outer: [number, number][] = [];
    for (let k = 0; k <= 6; k++) {
      const rr = Math.max(0.001, (rad * k) / 6);
      const hh = (rr * rr * depth) / (rad * rad);
      outer.push([rr, hh - 0.25]);
      inner.push([rr, hh]);
    }
    b.lathe(0, 0, 0, inner.reverse(), 24, { layer: LAYER.CIRCUIT, tile: rad, emit: 0.8 });
    b.lathe(0, 0, 0, outer, 24, { layer: LAYER.RIBS, tile: 6 });
    b.tube([0, 0, 0], [0, 0, rad * 0.75], 0.2, 6, { layer: LAYER.PLATES, tile: 2 });
    b.box(-0.9, -0.9, -1.8, 0.9, 0.9, -0.2, { layer: LAYER.GREEBLE, tile: 3 });
    const head = new Group();
    head.position.set(x, y, z + 3.2 + 0.9);
    const tilt = new Mesh(b.build(), this.m.hull);
    tilt.rotation.x = 0.9;
    tilt.castShadow = this.m.shadows;
    head.add(tilt);
    this.group.add(head);
    this.bb.add(x, y, z + 3.4, 0.25, B_RED, this.rng.float(0, 6));
    this.props.push({
      obj: head,
      kind: 'dish',
      x,
      y,
      speed: this.rng.float(0.25, 0.7) * this.rng.sign(),
      angle: 0,
    });
  }

  private turret(x: number, y: number): void {
    const z = TRENCH.hullZ;
    this.hb.lathe(
      x,
      y,
      z,
      [
        [5.2, 0],
        [5.2, 0.7],
        [4.4, 1.6],
        [0.001, 1.6],
      ],
      24,
      { layer: LAYER.PLATES, tile: 6 },
    );
    const b = new HullBuilder();
    b.box(
      -3,
      -3,
      0,
      3,
      3.6,
      2.6,
      { layer: LAYER.PANELS, tile: 6 },
      { pz: { layer: LAYER.GREEBLE, tile: 6 }, nz: null },
    );
    b.box(-2, -2.6, 2.6, 2, 1.4, 3.4, { layer: LAYER.PLATES, tile: 4 }, { nz: null });
    for (const bx of [-1.3, 1.3]) {
      b.tube([bx, 3.6, 1.3], [bx, 14, 1.3], 0.48, 10, { layer: LAYER.RIBS, tile: 2 });
      b.tube([bx, 13, 1.3], [bx, 14.6, 1.3], 0.72, 10, { layer: LAYER.PLATES, tile: 2 });
    }
    const head = new Mesh(b.build(), this.m.hull);
    head.position.set(x, y, z + 1.6);
    head.castShadow = this.m.shadows;
    this.group.add(head);
    this.bb.add(x, y - 2, z + 5.4, 0.3, B_RED, this.rng.float(0, 6));
    this.props.push({ obj: head, kind: 'turret', x, y, speed: 0, angle: this.rng.float(-1, 1) });
  }

  private bridge(): void {
    const T = TRENCH;
    const r = this.rng;
    const w = r.float(6, 10);
    const yb = r.float(10 + w / 2, SEG - 10 - w / 2);
    const z1 = T.hullZ - 0.4;
    const z0 = z1 - r.float(2.5, 3.8);
    const side: Surf = { layer: LAYER.WINDOWS, tile: 10, emit: 1.2, phase: r.next() };
    this.hb.box(
      -T.lipX - 1,
      yb - w / 2,
      z0,
      T.lipX + 1,
      yb + w / 2,
      z1,
      { layer: LAYER.DECK, tile: 16 },
      {
        py: side,
        ny: side,
        nz: { layer: LAYER.PLATES, tile: 16, shade: 0.6 },
        px: null,
        nx: null,
      },
    );
    for (const e of [-1, 1]) {
      const ya = yb + e * (w / 2 - 1);
      this.hb.box(
        -T.lipX,
        ya - 0.6,
        z0 - 2.4,
        T.lipX,
        ya + 0.6,
        z0,
        { layer: LAYER.GREEBLE, tile: 8 },
        {
          px: null,
          nx: null,
        },
      );
      this.bb.bar(
        -T.lipX,
        yb + e * (w / 2 - 0.35) - 0.15,
        z1,
        T.lipX,
        yb + e * (w / 2 - 0.35) + 0.15,
        z1 + 0.22,
        B_FLOW,
      );
      for (let x = -T.lipX + 6; x < T.lipX; x += 12)
        this.bb.add(x, yb + e * (w / 2), z0 - 0.3, 0.3, B_ACCENT, x * 0.1);
    }
    // Brackets into the upper walls (kept above the maglev's clearance).
    for (const s of [-1, 1] as const) {
      this.sbox(
        s,
        T.terraceOut + 0.5,
        T.lipX,
        yb - 1.2,
        yb + 1.2,
        z0 - 3,
        z0,
        { layer: LAYER.RIBS, tile: 6 },
        {
          out: null,
        },
      );
    }
  }

  private pipeCrossing(): void {
    const T = TRENCH;
    const r = this.rng;
    const y = r.float(12, SEG - 12);
    const z = r.float(-30, -24);
    const rad = r.float(1.4, 2.2);
    this.hb.tube([-T.terraceIn - 2, y, z], [T.terraceIn + 2, y, z], rad, 16, {
      layer: LAYER.PLATES,
      tile: 6,
    });
    for (let x = -T.terraceIn + 4; x < T.terraceIn; x += 10) {
      this.hb.tube([x, y, z], [x + 1.4, y, z], rad + 0.3, 16, { layer: LAYER.HAZARD, tile: 4 });
    }
    this.bb.add(0, y, z + rad + 0.4, 0.35, B_RED, r.float(0, 6));
  }
}

// ── The trench ─────────────────────────────────────────────────────────────────

/**
 * The world under the battle: a trench cut into a capital ship's hull, scrolling past.
 * Terraced walls step down to the liquid-metal sea; maglev trains race along the terraces;
 * the deck beyond is crowded with towers, domes, radiators, masts, radar dishes and turrets
 * that track the player. Everything uses one PBR material driven by the procedural texture
 * arrays, with animated emissive classes (flickering windows, energy flowing down the trench,
 * blinking alerts) and explosion shockwaves that ripple light across the hull.
 *
 * Segments are prebuilt once (a pool of variants) and recycled as they scroll, so nothing is
 * allocated or compiled during play.
 */
export class Trench {
  readonly accent = uniform(new Vector3(0.16, 0.42, 1));
  private readonly tint = uniform(new Vector3(1, 1, 1));
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
  private readonly rng = new Rng('trench');

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

    const cfg: SideConfig = { pipes: [] };
    cfg.pipes.push({ z: -24, r: 1.1 }, { z: -29.5, r: 0.8 });

    const segments: Segment[] = [];
    for (let i = 0; i < POOL; i++) {
      const seg = new SegmentBuilder(this.rng.fork(`seg${i}`), mats, cfg).build();
      seg.group.visible = false;
      this.root.add(seg.group);
      segments.push(seg);
    }
    for (let k = 0; k < ACTIVE; k++) {
      const seg = segments[k]!;
      seg.group.position.y = Y_MIN + k * SEG;
      seg.group.visible = true;
      this.active.push(seg);
    }
    this.spares.push(...segments.slice(ACTIVE));

    this.cars = new InstancedMesh(carGeometry(), mats.hull, CARS * 2);
    this.cars.instanceMatrix.setUsage(DynamicDrawUsage);
    this.cars.frustumCulled = false;
    this.cars.castShadow = opts.shadows;
    this.root.add(this.cars);
    for (const side of [-1, 1] as const) {
      this.trains.push({ side, y: 0, speed: 0, wait: this.rng.float(0.5, 3), on: false });
    }
    this.updateTrains(0, null);

    scene.add(this.root);
  }

  private hullMaterial(tex: HullTextureSet): MeshStandardNodeMaterial {
    const info = attribute<'vec4'>('aInfo', 'vec4');
    const layer = info.x;
    const st = uv();
    const alb = texture(tex.albedo, st).depth(layer);
    const orm = texture(tex.orm, st).depth(layer);
    const nrm = texture(tex.normal, st).depth(layer);
    const em = texture(tex.emissive, st).depth(layer);

    const mat = new MeshStandardNodeMaterial();
    // Light pools along the trench; the deck far from it sinks into the night.
    const falloff = mix(float(0.3), float(1), smoothstep(230, 60, abs(positionWorld.x)));
    mat.colorNode = alb.rgb.mul(info.z).mul(this.tint).mul(falloff);
    mat.aoNode = orm.r;
    mat.roughnessNode = orm.g;
    mat.metalnessNode = orm.b;
    mat.normalNode = normalMap(nrm);
    mat.envMapIntensity = 0.35;

    // Warm interior light: windows (10×4 grid per tile) switch off now and then.
    const cell = floor(st.mul(vec2(10, 4)));
    const cellHash = hash(cell.x.add(cell.y.mul(57.31)).add(info.w.mul(131.7)));
    const lit = step(0.12, fract(time.mul(0.035).add(cellHash)));
    const warm = vec3(1, 0.55, 0.25).mul(em.r.mul(lit).mul(1.5));
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

  setTheme(accent: Color, tint: Color): void {
    this.accent.value.set(accent.r, accent.g, accent.b);
    // Paint is kept dark so emissives, lamps and gunfire carry the image.
    this.tint.value.set(tint.r, tint.g, tint.b).multiplyScalar(0.6);
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
        if (p.kind === 'dish') {
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
