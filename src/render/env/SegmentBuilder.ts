import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  type BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import type { Rng } from '../../sim/rng';
import { AO_LAYER, FLOOR_Z } from '../palette';
import { BeaconBuilder } from './Beacons';
import { HullBuilder, type Surf } from './HullBuilder';
import { LAYER } from './HullTextures';
import {
  B_ACCENT,
  B_FLOW,
  B_LAMP,
  B_RED,
  B_STROBE,
  type Lamp,
  type Materials,
  type Prop,
  SEG,
  type Segment,
  type SideConfig,
  TRENCH,
} from './layout';

const WARM_LIGHT = new Color(1, 0.72, 0.45);

const _m = new Matrix4();
const _q = new Quaternion();
const ONE = new Vector3(1, 1, 1);
const DOWN = new Vector3(0, -1, 0);

type SideFace = 'in' | 'out' | 'py' | 'ny' | 'pz' | 'nz';

export class SegmentBuilder {
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
    hull.layers.enable(AO_LAYER);
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

    for (const c of this.cfg.conduits) if (c.side === s) this.conduit(s, c.x, c.kind);
    // Clusters of small greebles: a dense, shadow-catching surface instead of flat plating.
    for (let i = 0; i < 7; i++)
      this.scatter(s, r.float(56, 215), r.float(0, SEG), r.float(4, 11), r.int(8, 20));

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

  /** Trench-long conduit (identical in every segment so it runs unbroken to the horizon). */
  private conduit(s: 1 | -1, x: number, kind: 'pipes' | 'channel' | 'rail'): void {
    const z = TRENCH.hullZ;
    if (kind === 'pipes') {
      for (const [dx, r] of [
        [-0.9, 0.55],
        [0.6, 0.8],
      ] as const) {
        const cx = s * (x + dx);
        this.hb.tube([cx, 0, z + r], [cx, SEG, z + r], r, 10, { layer: LAYER.PLATES, tile: 3 });
      }
      for (let y = 8; y < SEG; y += 16) {
        this.sbox(
          s,
          x - 1.8,
          x + 1.8,
          y,
          y + 0.8,
          z,
          z + 1.9,
          { layer: LAYER.HAZARD, tile: 3 },
          { nz: null },
        );
      }
    } else if (kind === 'channel') {
      this.sbox(
        s,
        x - 1.6,
        x + 1.6,
        0,
        SEG,
        z,
        z + 0.7,
        { layer: LAYER.RIBS, tile: 3 },
        {
          pz: { layer: LAYER.GRILLE, tile: 3 },
          nz: null,
          py: null,
          ny: null,
        },
      );
    } else {
      this.sbox(
        s,
        x - 1,
        x + 1,
        0,
        SEG,
        z,
        z + 0.45,
        { layer: LAYER.PLATES, tile: 4 },
        { nz: null, py: null, ny: null },
      );
      const bx = s > 0 ? x : -x;
      this.bb.bar(bx - 0.15, 0, z + 0.45, bx + 0.15, SEG, z + 0.6, B_FLOW);
    }
  }

  /** A cluster of small boxes around (distance x, y). */
  private scatter(s: 1 | -1, x: number, y: number, radius: number, count: number): void {
    const r = this.rng;
    const z = TRENCH.hullZ;
    const top = r.pick([LAYER.GRILLE, LAYER.PLATES, LAYER.PANELS]);
    for (let i = 0; i < count; i++) {
      const w = r.chance(0.3) ? r.float(3, 7) : r.float(0.6, 2.8);
      const d = r.chance(0.3) ? r.float(3, 7) : r.float(0.6, 2.8);
      const h = r.chance(0.15) ? r.float(1.6, 3.2) : r.float(0.25, 1.3);
      const cx = x + r.float(-radius, radius);
      const cy = Math.min(SEG - d, Math.max(0, y + r.float(-radius, radius)));
      if (cx - w / 2 < TRENCH.lipX + TRENCH.lipW + 1) continue;
      const lit = r.chance(0.12);
      this.sbox(
        s,
        cx - w / 2,
        cx + w / 2,
        cy,
        cy + d,
        z,
        z + h,
        { layer: LAYER.GREEBLE, tile: 4 },
        {
          pz: { layer: top, tile: r.float(3, 6) },
          nz: null,
          ...(lit ? { in: { layer: LAYER.STRIPS, tile: h * 2, v0: 0.75 - (z + h / 2) / (h * 2) } } : {}),
        },
      );
      if (r.chance(0.06)) this.bb.add(s * cx, cy + d / 2, z + h + 0.25, 0.22, B_RED, r.float(0, 6));
    }
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
    tilt.layers.enable(AO_LAYER);
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
    head.layers.enable(AO_LAYER);
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
