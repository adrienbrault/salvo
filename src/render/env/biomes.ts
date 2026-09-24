import { Color, Euler, Matrix4, Vector3 } from 'three/webgpu';
import type { Rng } from '../../sim/rng';
import { HullBuilder, type Surf, type V3 } from './HullBuilder';
import { LAYER } from './HullTextures';
import { B_ACCENT, B_LAMP, B_RED, B_STROBE, SEG, type SideConfig, TRENCH } from './layout';
import { boulder, bumps, groundZ, RockNoise, rockGround, rockWall } from './rock';
import type { LayerRemap, SegmentBuilder } from './SegmentBuilder';

export type FloorMode = 'metal' | 'lava' | 'cloud' | 'void';

export interface BiomePlan {
  cfg: SideConfig;
  layout: (b: SegmentBuilder) => void;
}

/** One sector's world: palette and lighting, what fills the floor, and how segments are built. */
export interface BiomeDef {
  id: string;
  /** Energy lines, beacons, particles. */
  accent: number;
  fog: number;
  key: number;
  keyIntensity: number;
  /** Hull paint multiplier. */
  hull: readonly [number, number, number];
  /** Lit windows, lamps and magma. */
  warm: readonly [number, number, number];
  /** Nebula band of the reflected sky. */
  sky: readonly [number, number, number];
  floor: FloorMode;
  /** Emissive colour of lava / cloud floors. */
  glow: number;
  /** Depth haze: the colour it leans to (and how much), its peak amount and the depth of that peak. */
  haze: { color: number; mix: number; amount: number; bottom: number };
  /** Size of the drifting asteroid field (0 = none). */
  asteroids: number;
  remap: LayerRemap;
  /** Per-trench setup (features that must line up between segments) and the segment layout. */
  plan(rng: Rng): BiomePlan;
}

type Profile = readonly (readonly [number, number, number])[];

const T = TRENCH;
const FLOOD = new Color(0.75, 0.95, 1);
const SODIUM = new Color(1, 0.7, 0.4);
const LAVA = new Color(1, 0.35, 0.08);
const ROCK: Surf = { layer: LAYER.ROCK, tile: 22 };

/** Undisplaced x of a profile at height z (profiles are listed bottom → top). */
function profileX(p: Profile, z: number): number {
  for (let k = 0; k < p.length - 1; k++) {
    const [x0, z0] = p[k]!;
    const [x1, z1] = p[k + 1]!;
    if (z >= z0 && z <= z1) return x0 + ((x1 - x0) * (z - z0)) / (z1 - z0);
  }
  return z < p[0]![1] ? p[0]![0] : p[p.length - 1]![0];
}

/** Right-handed basis of a random tumble (for wreckage). */
function tumble(r: Rng, tilt: number): [V3, V3, V3] {
  const m = new Matrix4().makeRotationFromEuler(
    new Euler(r.float(-tilt, tilt), r.float(-tilt, tilt), r.float(0, Math.PI * 2), 'ZXY'),
  );
  const x = new Vector3();
  const y = new Vector3();
  const z = new Vector3();
  m.extractBasis(x, y, z);
  return [x.toArray(), y.toArray(), z.toArray()];
}

// ── Orbit: the hull trench ────────────────────────────────────────────────────

function orbitPlan(rng: Rng): BiomePlan {
  const cfg: SideConfig = {
    pipes: [
      { z: -24, r: 1.1 },
      { z: -29.5, r: 0.8 },
    ],
    conduits: [],
  };
  for (const side of [-1, 1] as const) {
    for (const x of [64, 92, 126, 168]) {
      cfg.conduits.push({ side, x, kind: rng.pick(['pipes', 'channel', 'rail'] as const) });
    }
  }
  return { cfg, layout: (b) => b.orbit() };
}

// ── Debris belt: a mined rock canyon over the void ────────────────────────────

const BELT_LOWER: Profile = [
  [21, -140, 1],
  [26, -100, 4],
  [29.5, -66, 4],
  [32, -42, 3],
  [34, -27, 1.6],
  [35.3, -18.7, 0.15],
];
const BELT_UPPER: Profile = [
  [41.7, -18.7, 0.15],
  [42.6, -15, 1.6],
  [44.6, -10, 2.8],
  [46.6, -6.6, 2.4],
  [48.2, -3.6, 0.9],
];
const BELT_GROUND = { z: -5.2, amp: 5, from: 47.5 };

function beltPlan(rng: Rng): BiomePlan {
  const rock = new RockNoise(rng.fork('rock'));
  const conveyorX = rng.float(58, 62);
  return { cfg: { pipes: [], conduits: [] }, layout: (b) => belt(b, rock, conveyorX) };
}

function belt(b: SegmentBuilder, rock: RockNoise, conveyorX: number): void {
  const r = b.rng;
  const gz = (x: number, y: number) => groundZ(rock, BELT_GROUND.z, BELT_GROUND.amp, x, y);
  for (const s of [-1, 1] as const) {
    rockWall(b.hb, s, BELT_LOWER, rock, bumps(r, 6, 130), ROCK);
    rockWall(b.hb, s, BELT_UPPER, rock, bumps(r, 2, 16), ROCK, 200);
    rockGround(b.hb, s, BELT_GROUND.from, T.deckX, BELT_GROUND.z, BELT_GROUND.amp, rock, {
      ...ROCK,
      tile: 30,
    });
    b.terrace(s, LAYER.PLATES);
    // Rim posts: a dotted accent line along the canyon edge.
    for (let y = 4; y < SEG; y += 8) {
      const z = gz(48.8, y);
      b.hb.tube([s * 48.8, y, z - 0.6], [s * 48.8, y, z + 1.6], 0.14, 5, { layer: LAYER.RIBS, tile: 2 });
      b.bb.add(s * 48.8, y, z + 1.8, 0.26, B_ACCENT, y * 0.2);
    }
    for (const y of [16, 48]) if (r.chance(0.6)) b.lamp(s, y);
    if (r.chance(0.7)) wallRig(b, s, r.float(10, SEG - 10));
    conveyor(b, s, conveyorX, gz);
    b.farDeck((x0, x1, y0, y1) => {
      const kind = r.weighted(
        ['derrick', 'containers', 'wreck', 'boulders', 'flood', 'drill', 'none'] as const,
        (k) => (k === 'derrick' || k === 'containers' || k === 'boulders' ? 2 : k === 'none' ? 0.8 : 1.2),
      );
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      if (kind === 'derrick') derrick(b, s, cx, cy, gz);
      else if (kind === 'containers') containers(b, s, x0, x1, y0, y1, gz);
      else if (kind === 'wreck') wreck(b, s, cx, cy, gz);
      else if (kind === 'boulders') {
        for (let k = r.int(2, 5); k > 0; k--) {
          const x = r.float(x0 + 3, x1 - 3);
          const y = r.float(y0 + 3, y1 - 3);
          const rad = r.float(1.8, 5.5);
          boulder(
            b.hb,
            [s * x, y, gz(x, y) + rad * 0.1],
            rad,
            r.int(0, 1e6),
            { ...ROCK, tile: 10 },
            0.35,
            r.float(0.5, 0.8),
          );
        }
      } else if (kind === 'flood') floodlight(b, s, cx, cy, gz);
      else if (kind === 'drill') drillRig(b, s, cx, cy, gz);
    });
  }
  if (r.chance(0.4)) conveyorBridge(b, gz);
}

/** A platform bolted to the canyon wall, lit from below, with a hose up to the terrace. */
function wallRig(b: SegmentBuilder, s: 1 | -1, y: number): void {
  const r = b.rng;
  const z = r.float(-52, -36);
  const wx = profileX(BELT_LOWER, z);
  b.sbox(
    s,
    wx - 5,
    wx + 6,
    y - 3,
    y + 3,
    z - 0.8,
    z,
    { layer: LAYER.GRILLE, tile: 4 },
    { in: { layer: LAYER.HAZARD, tile: 3 } },
  );
  b.sbox(
    s,
    wx - 1.5,
    wx + 5,
    y - 2,
    y + 1,
    z,
    z + 2.6,
    { layer: LAYER.PANELS, tile: 4 },
    { nz: null, in: { layer: LAYER.WINDOWS, tile: 5, emit: 1.3, phase: r.next() } },
  );
  b.hb.tube([s * (wx - 0.5), y + 2, z], [s * 34.6, y + 2, T.terraceZ - 0.6], 0.3, 6, {
    layer: LAYER.PLATES,
    tile: 2,
  });
  b.bb.add(s * (wx - 4.8), y, z - 0.45, 0.36, B_LAMP, 0);
  b.cone(new Vector3(s * (wx - 4.8), y, z - 0.6), new Vector3(s * (wx - 12), y, z - 34), 0.26);
  b.light(s * (wx - 6), y, z - 3, SODIUM, 600, 30);
}

/** Trench-long ore conveyor on legs (identical every segment, so it runs unbroken). */
function conveyor(b: SegmentBuilder, s: 1 | -1, x: number, gz: (x: number, y: number) => number): void {
  const rim = Math.min(1, Math.max(0.25, (x + 1.5 - 50) / 14));
  const z = BELT_GROUND.z + BELT_GROUND.amp * rim + 1.4;
  b.sbox(
    s,
    x - 1.3,
    x + 1.3,
    0,
    SEG,
    z,
    z + 0.7,
    { layer: LAYER.PLATES, tile: 4 },
    { pz: { layer: LAYER.GRILLE, tile: 2.6 }, nz: null, py: null, ny: null },
  );
  for (let y = 4; y < SEG; y += 8) {
    for (const dx of [-1.1, 1.1]) {
      b.hb.tube([s * (x + dx), y, gz(x + dx, y) - 0.6], [s * (x + dx), y, z], 0.16, 5, {
        layer: LAYER.RIBS,
        tile: 2,
      });
    }
    if (y % 16 === 4) b.bb.add(s * (x - 1.5), y, z + 0.35, 0.22, B_ACCENT, y * 0.1);
  }
}

function derrick(
  b: SegmentBuilder,
  s: 1 | -1,
  x: number,
  y: number,
  gz: (x: number, y: number) => number,
): void {
  const r = b.rng;
  const z = gz(x, y) - 0.4;
  const h = r.float(14, 26);
  b.sbox(s, x - 3, x + 3, y - 3, y + 3, z - 1, z + 2, { layer: LAYER.PANELS, tile: 6 }, { nz: null });
  b.hb.truss([s * x, y, z + 2], [s * x, y, z + h], 2.4, { layer: LAYER.RIBS, tile: 2 });
  b.hb.tube([s * x, y, z - 2], [s * x, y, z + h], 0.25, 6, { layer: LAYER.PLATES, tile: 2 });
  b.sbox(s, x - 2, x + 2, y - 2, y + 2, z + h, z + h + 0.5, { layer: LAYER.GRILLE, tile: 4 });
  b.hb.tube([s * x, y - 1.2, z + h + 1.6], [s * x, y + 1.2, z + h + 1.6], 1.1, 12, {
    layer: LAYER.PLATES,
    tile: 2,
  });
  b.bb.add(s * x, y, z + h + 3, 0.45, B_STROBE, r.float(0, 6));
  b.bb.add(s * (x - 2), y - 2, z + h + 0.8, 0.25, B_RED, r.float(0, 6));
  b.bb.add(s * (x + 2), y + 2, z + h + 0.8, 0.25, B_RED, r.float(0, 6));
}

function containers(
  b: SegmentBuilder,
  s: 1 | -1,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  gz: (x: number, y: number) => number,
): void {
  const r = b.rng;
  for (let k = r.int(3, 7); k > 0; k--) {
    const alongY = r.chance(0.6);
    const hx = alongY ? 1.3 : r.pick([3, 6]);
    const hy = alongY ? r.pick([3, 6]) : 1.3;
    const cx = r.float(x0 + hx + 1, x1 - hx - 1);
    const cy = r.float(y0 + hy + 1, y1 - hy - 1);
    const z =
      Math.min(gz(cx - hx, cy - hy), gz(cx + hx, cy - hy), gz(cx - hx, cy + hy), gz(cx + hx, cy + hy)) - 0.3;
    const stack = r.chance(0.3) ? 2 : 1;
    for (let i = 0; i < stack; i++) {
      b.sbox(
        s,
        cx - hx,
        cx + hx,
        cy - hy,
        cy + hy,
        z + i * 2.6,
        z + (i + 1) * 2.6,
        { layer: r.pick([LAYER.PANELS, LAYER.PLATES, LAYER.RIBS]), tile: 6, shade: r.float(0.6, 1.25) },
        { nz: null },
      );
    }
  }
}

/** A half-buried hull fragment with broken ribs and a salvage beacon. */
function wreck(
  b: SegmentBuilder,
  s: 1 | -1,
  x: number,
  y: number,
  gz: (x: number, y: number) => number,
): void {
  const r = b.rng;
  const z = gz(x, y);
  const [ax, ay, az] = tumble(r, 0.45);
  const c: V3 = [s * x, y, z + 0.6];
  const hx = r.float(6, 10);
  b.hb.orientedBox(c, ax, ay, az, hx, r.float(2.2, 3.5), r.float(1.6, 2.4), { layer: LAYER.PLATES, tile: 8 });
  for (let k = 0; k < 4; k++) {
    const f = r.float(0.2, 1);
    const base: V3 = [c[0] + ax[0] * hx * f, c[1] + ax[1] * hx * f, c[2] + ax[2] * hx * f + 1];
    const tip: V3 = [base[0] + r.float(-3, 3), base[1] + r.float(-3, 3), base[2] + r.float(3, 7)];
    b.hb.tube(base, tip, 0.28, 6, { layer: LAYER.RIBS, tile: 2 });
  }
  for (let k = r.int(2, 4); k > 0; k--) {
    const [px, py, pz] = tumble(r, 0.8);
    const dx = x + r.float(-10, 10);
    const dy = y + r.float(-8, 8);
    b.hb.orientedBox([s * dx, dy, gz(dx, dy) + 0.3], px, py, pz, r.float(1, 3), r.float(0.8, 2), 0.25, {
      layer: LAYER.PLATES,
      tile: 6,
    });
  }
  b.bb.add(c[0], c[1], z + 4, 0.35, B_RED, r.float(0, 6));
}

function floodlight(
  b: SegmentBuilder,
  s: 1 | -1,
  x: number,
  y: number,
  gz: (x: number, y: number) => number,
): void {
  const r = b.rng;
  const z = gz(x, y);
  const h = r.float(9, 14);
  b.hb.tube([s * x, y, z - 0.5], [s * x, y, z + h], 0.35, 8, { layer: LAYER.RIBS, tile: 2 });
  b.sbox(s, x - 1.4, x + 0.3, y - 1.2, y + 1.2, z + h - 0.4, z + h + 1, { layer: LAYER.PLATES, tile: 3 });
  const tx = x - r.float(8, 16);
  const ty = y + r.float(-6, 6);
  b.bb.add(s * (x - 1.5), y, z + h + 0.3, 0.5, B_LAMP, 0);
  b.cone(new Vector3(s * (x - 1.5), y, z + h + 0.3), new Vector3(s * tx, ty, gz(tx, ty)), 0.3);
  b.light(s * tx, ty, gz(tx, ty) + 5, FLOOD, 700, 30);
}

function drillRig(
  b: SegmentBuilder,
  s: 1 | -1,
  x: number,
  y: number,
  gz: (x: number, y: number) => number,
): void {
  const r = b.rng;
  const z = gz(x, y) - 0.3;
  b.sbox(
    s,
    x - 5,
    x + 5,
    y - 4,
    y + 4,
    z - 1,
    z + 1.5,
    { layer: LAYER.HAZARD, tile: 4 },
    { pz: { layer: LAYER.GRILLE, tile: 4 }, nz: null },
  );
  for (let k = 0; k < 3; k++) {
    b.hb.lathe(
      s * (x - 3 + k * 3),
      y + 2,
      z + 1.5,
      [
        [1.2, 0],
        [1.2, 4],
        [0.9, 4.6],
        [0.001, 4.8],
      ],
      12,
      { layer: LAYER.PANELS, tile: 4, shade: r.float(0.7, 1.1) },
    );
  }
  const top: V3 = [s * (x - 4), y - 2, z + r.float(9, 13)];
  b.hb.truss([s * (x + 3), y - 2, z + 1.5], top, 1.4, { layer: LAYER.RIBS, tile: 2 });
  b.hb.tube(top, [top[0], top[1], z - 1], 0.4, 8, { layer: LAYER.PLATES, tile: 2 });
  b.bb.add(top[0], top[1], top[2] + 0.6, 0.4, B_STROBE, r.float(0, 6));
}

function conveyorBridge(b: SegmentBuilder, gz: (x: number, y: number) => number): void {
  const r = b.rng;
  const y = r.float(12, SEG - 12);
  const z = -7.5;
  b.hb.truss([-50, y, z], [50, y, z], 2.6, { layer: LAYER.RIBS, tile: 2 });
  b.hb.box(
    -51,
    y - 1.3,
    z + 1.3,
    51,
    y + 1.3,
    z + 1.9,
    { layer: LAYER.PLATES, tile: 6 },
    { nz: null, pz: { layer: LAYER.GRILLE, tile: 2.6 } },
  );
  for (let x = -42; x <= 42; x += 12) b.bb.add(x, y, z - 1.6, 0.26, B_ACCENT, x * 0.1);
  for (const s of [-1, 1] as const) {
    b.sbox(
      s,
      47.5,
      54,
      y - 2.5,
      y + 2.5,
      Math.min(gz(50, y) - 1, z),
      z + 1.9,
      { layer: LAYER.PLATES, tile: 4 },
      {
        nz: null,
      },
    );
  }
}

// ── Red nebula: an orbital shipyard over glowing clouds ───────────────────────

const YARD_FRAME = { top: [35.3, -18.7] as const, bottom: [30, -44] as const };

function nebulaPlan(): BiomePlan {
  return { cfg: { pipes: [], conduits: [] }, layout: nebula };
}

function nebula(b: SegmentBuilder): void {
  const r = b.rng;
  for (const s of [-1, 1] as const) {
    b.deck(s, T.lipX + T.lipW, 62, T.hullZ, { layer: LAYER.PANELS, tile: 16 });
    b.parapet(s);
    b.wallPanels(s, T.terraceOut, T.terraceZ, T.lipX, T.hullZ, [
      { layer: LAYER.PANELS, tile: 16 },
      { layer: LAYER.WINDOWS, tile: 16 },
      { layer: LAYER.RIBS, tile: 16 },
      { layer: LAYER.STRIPS, tile: 12.6 },
    ]);
    b.pillars(s);
    for (const y of [16, 48]) if (r.chance(0.5)) b.lamp(s, y);
    b.terrace(s, LAYER.DECK);
    openFrame(b, s);
    skin(b, s, 62, 222);
    b.farDeck((x0, x1, y0, y1, band) => {
      const kind = r.weighted(['scaffold', 'crane', 'module', 'tower', 'pad', 'none'] as const, (k) =>
        k === 'scaffold'
          ? 2
          : k === 'crane'
            ? band > 0
              ? 1.4
              : 0
            : k === 'module'
              ? 1.5
              : k === 'none'
                ? 0.6
                : 0.8,
      );
      if (kind === 'scaffold') scaffold(b, s, x0, x1, y0, y1);
      else if (kind === 'crane') crane(b, s, (x0 + x1) / 2, (y0 + y1) / 2);
      else if (kind === 'module') hullModule(b, s, x0, x1, y0, y1);
      else if (kind === 'tower' || kind === 'pad') b.cell(s, x0, x1, y0, y1, band, kind);
    });
  }
  const roll = r.next();
  if (roll < 0.45) gantry(b);
  else if (roll < 0.6) b.bridge();
}

/**
 * The lower trench wall left open: ribs and stringers diving into the clouds, a few skin
 * panels, and lit decks of the yard's interior behind them.
 */
function openFrame(b: SegmentBuilder, s: 1 | -1): void {
  const r = b.rng;
  const [tx, tz] = YARD_FRAME.top;
  const [bx, bz] = YARD_FRAME.bottom;
  const len = Math.hypot(tx - bx, tz - bz);
  const ay: V3 = [(s * (tx - bx)) / len, 0, (tz - bz) / len];
  const ax: V3 = [0, 1, 0];
  const az: V3 = [
    ax[1] * ay[2] - ax[2] * ay[1],
    ax[2] * ay[0] - ax[0] * ay[2],
    ax[0] * ay[1] - ax[1] * ay[0],
  ];
  const mid: V3 = [(s * (tx + bx)) / 2, 0, (tz + bz) / 2];
  for (let y = 4; y < SEG; y += 8) {
    b.hb.orientedBox([mid[0], y, mid[2]], ax, ay, az, 0.45, len / 2, 0.7, { layer: LAYER.RIBS, tile: 4 });
  }
  for (const f of [0.3, 0.55, 0.8]) {
    const x = bx + (tx - bx) * f - 0.9;
    const z = bz + (tz - bz) * f;
    b.hb.tube([s * x, 0, z], [s * x, SEG, z], 0.35, 8, { layer: LAYER.PLATES, tile: 3 });
  }
  // Skin on some bays (upper part only), set back behind the ribs.
  for (let y = 4; y < SEG - 4; y += 8) {
    if (!r.chance(0.4)) continue;
    const f = r.float(0.3, 0.6);
    b.wall(s, y, y + 8, bx + (tx - bx) * f + 0.4, bz + (tz - bz) * f, tx + 0.4, tz, {
      layer: LAYER.PANELS,
      tile: 8,
      shade: r.float(0.8, 1.05),
    });
  }
  // The interior: a lit back wall and one deck level.
  b.wall(s, 0, SEG, 36.5, -40, 40, T.terraceZ - 0.8, {
    layer: r.pick([LAYER.WINDOWS, LAYER.STRIPS]),
    tile: 12,
    emit: 1.3,
    phase: r.next(),
  });
  const dz = -28;
  const inner = bx + ((tx - bx) * (dz - bz)) / (tz - bz) + 0.8;
  const outer = 36.5 + ((40 - 36.5) * (dz + 40)) / (T.terraceZ - 0.8 + 40);
  b.sbox(
    s,
    inner,
    outer,
    0,
    SEG,
    dz - 0.5,
    dz,
    { layer: LAYER.GRILLE, tile: 4 },
    { in: { layer: LAYER.STRIPS, tile: 1, v0: 0.2 }, py: null, ny: null, out: null },
  );
}

/** Hull skin in 16×16 plates with open bays showing lit machinery below. */
function skin(b: SegmentBuilder, s: 1 | -1, xa: number, xb: number): void {
  const r = b.rng;
  const z = T.hullZ;
  for (let x = xa; x < xb; x += 16) {
    for (let y = 0; y < SEG; y += 16) {
      const x0 = s > 0 ? x : -(x + 16);
      if (!r.chance(0.2)) {
        b.hb.quad([x0, y, z], [16, 0, 0], [0, 16, 0], {
          layer: LAYER.PANELS,
          tile: 16,
          u0: x0 / 16,
          v0: y / 16,
          shade: r.float(0.8, 1.05),
        });
        continue;
      }
      b.recess(
        x0,
        x0 + 16,
        y,
        y + 16,
        z,
        6,
        { layer: r.pick([LAYER.CIRCUIT, LAYER.WINDOWS, LAYER.GREEBLE]), tile: 8, emit: 1.2, phase: r.next() },
        { layer: LAYER.RIBS, tile: 6 },
      );
      const ym = y + r.float(5, 11);
      b.hb.box(x0, ym - 0.4, z - 1.2, x0 + 16, ym + 0.4, z, { layer: LAYER.RIBS, tile: 4 }, { nz: null });
      b.bb.add(x0 + 8, ym, z + 0.3, 0.28, B_STROBE, r.float(0, 6));
    }
  }
}

function scaffold(b: SegmentBuilder, s: 1 | -1, x0: number, x1: number, y0: number, y1: number): void {
  const r = b.rng;
  const z = T.hullZ;
  const ax = x0 + 2;
  const bx = x1 - 2;
  const ay = y0 + 2;
  const by = y1 - 2;
  const levels = r.int(2, 4);
  const lh = 3.2;
  const top = z + levels * lh;
  // What is being built inside.
  if (r.chance(0.75)) {
    b.sbox(
      s,
      ax + 1.6,
      bx - 1.6,
      ay + 1.6,
      by - 1.6,
      z,
      z + (top - z) * r.float(0.55, 0.95),
      { layer: LAYER.PANELS, tile: 8 },
      { nz: null, [r.pick(['in', 'py', 'ny'] as const)]: { layer: LAYER.RIBS, tile: 6 } },
    );
  }
  const pole: Surf = { layer: LAYER.RIBS, tile: 2 };
  const nx = Math.max(2, Math.round((bx - ax) / 5));
  const ny = Math.max(2, Math.round((by - ay) / 5));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      if (i > 0 && i < nx && j > 0 && j < ny) continue;
      const px = ax + ((bx - ax) * i) / nx;
      const py = ay + ((by - ay) * j) / ny;
      b.sbox(s, px - 0.15, px + 0.15, py - 0.15, py + 0.15, z, top, pole, { nz: null });
    }
  }
  for (let l = 1; l <= levels; l++) {
    const lz = z + l * lh;
    b.sbox(s, ax, bx, ay - 0.12, ay + 0.12, lz - 0.25, lz, pole);
    b.sbox(s, ax, bx, by - 0.12, by + 0.12, lz - 0.25, lz, pole);
    b.sbox(s, ax - 0.12, ax + 0.12, ay, by, lz - 0.25, lz, pole);
    b.sbox(s, bx - 0.12, bx + 0.12, ay, by, lz - 0.25, lz, pole);
    if (r.chance(0.6)) b.sbox(s, ax, bx, ay, ay + 1.4, lz - 0.1, lz, { layer: LAYER.GRILLE, tile: 3 });
    if (r.chance(0.6)) b.sbox(s, ax, ax + 1.4, ay, by, lz - 0.1, lz, { layer: LAYER.GRILLE, tile: 3 });
  }
  // Welding arcs.
  for (let k = r.int(2, 4); k > 0; k--) {
    b.bb.add(
      s * r.float(ax + 1.6, bx - 1.6),
      r.pick([ay + 1.4, by - 1.4]),
      r.float(z + 1, top),
      0.3,
      B_STROBE,
      r.float(0, 6),
    );
  }
  b.bb.add(s * ax, ay, top + 0.3, 0.3, B_RED, r.float(0, 6));
}

/** Tower crane whose jib slowly slews (kept clear of the play field). */
function crane(b: SegmentBuilder, s: 1 | -1, x: number, y: number): void {
  const r = b.rng;
  const z = T.hullZ;
  const h = r.float(18, 28);
  b.sbox(s, x - 2.2, x + 2.2, y - 2.2, y + 2.2, z, z + 1.2, { layer: LAYER.HAZARD, tile: 4 }, { nz: null });
  b.hb.truss([s * x, y, z + 1.2], [s * x, y, z + h], 2.2, { layer: LAYER.RIBS, tile: 2 });
  b.sbox(
    s,
    x - 1.6,
    x + 1.6,
    y - 1.6,
    y + 1.6,
    z + h,
    z + h + 2.2,
    { layer: LAYER.PANELS, tile: 4 },
    { in: { layer: LAYER.WINDOWS, tile: 3, emit: 1.4, phase: r.next() } },
  );
  b.bb.add(s * x, y, z + h + 2.6, 0.32, B_RED, r.float(0, 6));
  const jib = new HullBuilder();
  const reach = Math.min(26, x - 58);
  const back = 8;
  jib.truss([-back, 0, 0], [reach, 0, 0], 1.6, { layer: LAYER.RIBS, tile: 2 });
  jib.box(-back - 1, -1.4, -2.4, -back + 2.6, 1.4, 0.4, { layer: LAYER.PLATES, tile: 3 });
  const d = r.float(8, reach - 2);
  const drop = r.float(6, h - 4);
  jib.box(d - 1, -0.9, -1.4, d + 1, 0.9, -0.7, { layer: LAYER.PLATES, tile: 3 });
  jib.tube([d, 0, -1.4], [d, 0, -drop], 0.08, 4, { layer: LAYER.PLATES, tile: 2 });
  jib.box(d - 0.8, -0.8, -drop - 1.4, d + 0.8, 0.8, -drop, { layer: LAYER.HAZARD, tile: 2 });
  const mesh = b.prop(jib, s * x, y, z + h + 3.2, 'spin', r.float(0.04, 0.1) * r.sign());
  mesh.rotation.z = r.float(0, Math.PI * 2);
}

/** A ship module on cradles: ribs and stringers, skinned over part of its length. */
function hullModule(b: SegmentBuilder, s: 1 | -1, x0: number, x1: number, y0: number, y1: number): void {
  const r = b.rng;
  const R = Math.min((x1 - x0) / 2 - 2, 7);
  const cx = s * ((x0 + x1) / 2);
  const zc = T.hullZ + R + 1.2;
  const ya = y0 + 2;
  const yb = y1 - 2;
  for (const cy of [ya + 3, yb - 3]) {
    b.hb.box(
      cx - R * 0.8,
      cy - 0.8,
      T.hullZ,
      cx + R * 0.8,
      cy + 0.8,
      zc - R * 0.6,
      { layer: LAYER.PLATES, tile: 4 },
      {
        nz: null,
      },
    );
  }
  for (let y = ya; y <= yb - 0.5; y += 3) {
    b.hb.tube([cx, y, zc], [cx, y + 0.5, zc], R + 0.25, 20, { layer: LAYER.RIBS, tile: 4 });
  }
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const px = cx + Math.cos(a) * R;
    const pz = zc + Math.sin(a) * R;
    if (pz < T.hullZ) continue;
    b.hb.tube([px, ya, pz], [px, yb, pz], 0.15, 4, { layer: LAYER.RIBS, tile: 2 });
  }
  const ys = r.float(ya + 4, yb - 4);
  const skinned = r.chance(0.5);
  b.hb.tube([cx, skinned ? ya : ys, zc], [cx, skinned ? ys : yb, zc], R, 20, {
    layer: LAYER.PANELS,
    tile: 8,
  });
  for (let k = r.int(2, 4); k > 0; k--) {
    const a = r.float(0.2, Math.PI - 0.2);
    b.bb.add(cx + Math.cos(a) * R, ys, zc + Math.sin(a) * R, 0.3, B_STROBE, r.float(0, 6));
  }
}

/** Gantry straddling the trench on the maglev terraces, its trolley lighting the clouds. */
function gantry(b: SegmentBuilder): void {
  const r = b.rng;
  const y = r.float(10, SEG - 10);
  const z = -8.5;
  b.hb.truss([-44, y, z], [44, y, z], 2.4, { layer: LAYER.RIBS, tile: 2 });
  for (const s of [-1, 1] as const) {
    b.sbox(
      s,
      40.6,
      42.4,
      y - 1.3,
      y + 1.3,
      T.terraceZ,
      z + 1.2,
      { layer: LAYER.RIBS, tile: 4 },
      { in: { layer: LAYER.HAZARD, tile: 3 }, nz: null },
    );
    b.bb.add(s * 40.4, y, z + 1.6, 0.3, B_RED, r.float(0, 6));
  }
  const tx = r.float(-26, 26);
  b.hb.box(tx - 2.2, y - 1.8, z - 2.6, tx + 2.2, y + 1.8, z - 1.2, { layer: LAYER.PANELS, tile: 4 });
  b.bb.add(tx, y, z - 2.8, 0.42, B_LAMP, 0);
  b.cone(new Vector3(tx, y, z - 2.9), new Vector3(tx, y, -34), 0.2);
  for (let x = -36; x <= 36; x += 12) b.bb.add(x, y - 1.35, z, 0.22, B_ACCENT, x * 0.1);
}

// ── The core: a reactor canyon over a lava river ──────────────────────────────

const CORE_LOWER: Profile = [
  [28.5, -44, 1.2],
  [30.8, -34, 2.2],
  [33.2, -26, 2],
  [35.3, -18.7, 0.15],
];

function corePlan(rng: Rng): BiomePlan {
  const rock = new RockNoise(rng.fork('rock'));
  const cfg: SideConfig = { pipes: [], conduits: [] };
  for (const side of [-1, 1] as const) {
    for (const x of [64, 92, 126, 168])
      cfg.conduits.push({ side, x, kind: rng.pick(['pipes', 'pipes', 'channel', 'rail'] as const) });
  }
  return { cfg, layout: (b) => core(b, rock) };
}

function core(b: SegmentBuilder, rock: RockNoise): void {
  const r = b.rng;
  for (const s of [-1, 1] as const) {
    b.deck(s, T.lipX + T.lipW, 62, T.hullZ, { layer: LAYER.DECK, tile: 16 });
    b.deck(s, 62, 140, T.hullZ, { layer: r.pick([LAYER.PLATES, LAYER.RADIATOR]), tile: 32, shade: 0.85 });
    b.deck(s, 140, T.deckX, T.hullZ, { layer: LAYER.GRIME, tile: 40, shade: 0.7 });
    b.parapet(s);
    b.wallPanels(s, T.terraceOut, T.terraceZ, T.lipX, T.hullZ, [
      { layer: LAYER.RADIATOR, tile: 12 },
      { layer: LAYER.PLATES, tile: 16 },
      { layer: LAYER.GRILLE, tile: 10 },
      { layer: LAYER.STRIPS, tile: 12.6 },
      { layer: LAYER.WINDOWS, tile: 16 },
    ]);
    b.pillars(s);
    for (const y of [16, 48]) if (r.chance(0.6)) b.lamp(s, y);
    b.terrace(s, LAYER.GRILLE);
    rockWall(b.hb, s, CORE_LOWER, rock, bumps(r, 3, 30), { layer: LAYER.MAGMA, tile: 16 });
    // Lava light licking the walls.
    b.light(s * 29, r.float(8, SEG - 8), -31, LAVA, 900, 36);
    b.hb.tube([s * 52, 0, T.hullZ + 0.8], [s * 52, SEG, T.hullZ + 0.8], 0.8, 10, {
      layer: LAYER.PLATES,
      tile: 3,
    });
    for (const c of b.cfg.conduits) if (c.side === s) b.conduit(s, c.x, c.kind);
    for (let i = 0; i < 4; i++) b.scatter(s, r.float(56, 215), r.float(0, SEG), r.float(4, 10), r.int(8, 16));
    b.farDeck((x0, x1, y0, y1, band) => {
      const kind = r.weighted(
        ['cooling', 'exchanger', 'reactor', 'pylon', 'radiator', 'tower', 'none'] as const,
        (k) => (k === 'cooling' ? (band > 0 ? 1.6 : 0) : k === 'exchanger' ? 1.5 : k === 'none' ? 0.5 : 1),
      );
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      if (kind === 'cooling') coolingTower(b, s, cx, cy, Math.min(x1 - x0, y1 - y0) / 2 - 1);
      else if (kind === 'exchanger') exchanger(b, s, x0, x1, y0, y1);
      else if (kind === 'reactor') reactor(b, s, cx, cy, Math.min(x1 - x0, y1 - y0) * 0.3);
      else if (kind === 'pylon') b.mast(s * cx, cy, T.hullZ, r.float(14, 26));
      else if (kind === 'radiator' || kind === 'tower') b.cell(s, x0, x1, y0, y1, band, kind);
    });
  }
  const roll = r.next();
  if (roll < 0.35) b.pipeCrossing();
  else if (roll < 0.6) b.bridge();
}

/** Hyperboloid cooling tower with a glowing core and aviation lights round the rim. */
function coolingTower(b: SegmentBuilder, s: 1 | -1, x: number, y: number, R: number): void {
  const r = b.rng;
  const z = T.hullZ;
  const H = R * r.float(2.2, 2.8);
  const waist = 0.62;
  const h0 = H * 0.75;
  const c = h0 / Math.sqrt(1 / (waist * waist) - 1);
  const outer: [number, number][] = [];
  for (let k = 0; k <= 12; k++) {
    const h = (H * k) / 12;
    outer.push([waist * R * Math.sqrt(1 + ((h - h0) / c) ** 2), h]);
  }
  const top = outer[outer.length - 1]![0];
  const inner = outer.map(([rr, h]) => [rr - 0.4, h] as [number, number]).reverse();
  b.hb.lathe(s * x, y, z, outer, 28, { layer: LAYER.PLATES, tile: 8 });
  b.hb.lathe(s * x, y, z, inner, 28, { layer: LAYER.PLATES, tile: 8, shade: 0.45 });
  b.hb.lathe(
    s * x,
    y,
    z + H - 0.6,
    [
      [top + 0.3, 0],
      [top + 0.3, 0.9],
    ],
    28,
    { layer: LAYER.HAZARD, tile: 3 },
  );
  b.hb.disc(s * x, y, z + 1.5, R * 0.9, 20, { layer: LAYER.MAGMA, tile: 12 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    b.bb.add(s * x + Math.cos(a) * (top + 0.4), y + Math.sin(a) * (top + 0.4), z + H + 0.5, 0.3, B_RED, k);
  }
}

function exchanger(b: SegmentBuilder, s: 1 | -1, x0: number, x1: number, y0: number, y1: number): void {
  const r = b.rng;
  const z = T.hullZ + 0.8;
  b.sbox(s, x0 + 1, x1 - 1, y0 + 1, y1 - 1, T.hullZ, z, { layer: LAYER.PLATES, tile: 8 }, { nz: null });
  const n = r.int(2, 3);
  const R = Math.min(2.4, (x1 - x0 - 6) / (2 * n));
  for (let k = 0; k < n; k++) {
    const tx = s * (x0 + 3 + R + ((x1 - x0 - 6 - 2 * R) * k) / Math.max(1, n - 1));
    const ya = y0 + 3;
    const yb = y1 - 3;
    const surf: Surf = { layer: LAYER.PANELS, tile: 6, shade: r.float(0.8, 1.1) };
    b.hb.tube([tx, ya, z + R], [tx, yb, z + R], R, 14, surf);
    const cap = (yy: number, dir: 1 | -1) =>
      b.hb.lathe(
        tx,
        yy,
        z + R,
        [
          [R, 0],
          [R * 0.75, R * 0.45],
          [0.001, R * 0.6],
        ],
        14,
        surf,
        { x: [1, 0, 0], y: [0, 0, -dir], z: [0, dir, 0] },
      );
    cap(yb, 1);
    cap(ya, -1);
    for (let yy = ya + 3; yy < yb - 1; yy += 6) {
      b.hb.tube([tx, yy, z + R], [tx, yy + 0.8, z + R], R + 0.15, 14, { layer: LAYER.HAZARD, tile: 3 });
    }
    b.hb.tube([tx, (ya + yb) / 2, z + 2 * R - 0.2], [tx, (ya + yb) / 2, z + 2 * R + 3], 0.4, 8, {
      layer: LAYER.PLATES,
      tile: 2,
    });
  }
  b.bb.add(s * (x0 + 2), y0 + 2, z + 0.4, 0.28, B_RED, r.float(0, 6));
}

function reactor(b: SegmentBuilder, s: 1 | -1, x: number, y: number, R: number): void {
  const z = T.hullZ;
  b.dome(s * x, y, R, LAYER.PANELS);
  b.hb.lathe(
    s * x,
    y,
    z,
    [
      [R + 2.6, 0],
      [R + 2.6, 1.2],
      [R + 1.4, 1.8],
    ],
    32,
    { layer: LAYER.RIBS, tile: 4 },
  );
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.bb.add(s * x + Math.cos(a) * (R + 2.7), y + Math.sin(a) * (R + 2.7), z + 1.4, 0.3, B_ACCENT, k * 0.5);
  }
  b.light(s * x, y, z + R + 5, SODIUM, 700, 36);
}

// ── The sectors ───────────────────────────────────────────────────────────────

export const BIOMES: readonly BiomeDef[] = [
  {
    id: 'orbit',
    accent: 0x2a6cff,
    fog: 0x03060f,
    key: 0x9fc4ff,
    keyIntensity: 1.5,
    hull: [0.95, 1, 1.1],
    warm: [1, 0.55, 0.25],
    sky: [0.16, 0.06, 0.24],
    floor: 'metal',
    glow: 0x000000,
    haze: { color: 0x2a6cff, mix: 0.07, amount: 0.18, bottom: -38 },
    asteroids: 0,
    remap: {},
    plan: orbitPlan,
  },
  {
    id: 'belt',
    accent: 0x19d3c5,
    fog: 0x020a0c,
    key: 0xc8f4ff,
    keyIntensity: 1.8,
    hull: [0.95, 1, 1],
    warm: [1, 0.68, 0.36],
    sky: [0.03, 0.14, 0.15],
    floor: 'void',
    glow: 0x000000,
    haze: { color: 0x19d3c5, mix: 0.05, amount: 0.8, bottom: -130 },
    asteroids: 40,
    remap: { [LAYER.PLATES]: LAYER.PLATES_RUST },
    plan: beltPlan,
  },
  {
    id: 'nebula',
    accent: 0xff3d6e,
    fog: 0x0d0307,
    key: 0xffc2d0,
    keyIntensity: 1.4,
    hull: [1.08, 0.97, 0.97],
    warm: [1, 0.62, 0.48],
    sky: [0.32, 0.05, 0.12],
    floor: 'cloud',
    glow: 0xff3d78,
    haze: { color: 0xff5078, mix: 0.1, amount: 0.3, bottom: -36 },
    asteroids: 0,
    remap: { [LAYER.PANELS]: LAYER.PANELS_CLEAN },
    plan: nebulaPlan,
  },
  {
    id: 'core',
    accent: 0xffa31a,
    fog: 0x0c0703,
    key: 0xffd9a0,
    keyIntensity: 1.3,
    hull: [1.12, 1, 0.8],
    warm: [1, 0.4, 0.1],
    sky: [0.24, 0.08, 0.02],
    floor: 'lava',
    glow: 0xff5a10,
    haze: { color: 0xff5a10, mix: 0.1, amount: 0.25, bottom: -36 },
    asteroids: 0,
    remap: { [LAYER.PLATES]: LAYER.PLATES_RUST },
    plan: corePlan,
  },
];
