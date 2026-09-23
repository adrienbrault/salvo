import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from 'three/webgpu';

export type V3 = readonly [number, number, number];

/** Surface description: which texture layer, texel density and per-piece variation. */
export interface Surf {
  layer: number;
  /** World units per texture repeat. */
  tile?: number;
  /** Emissive multiplier (0 = unpowered). */
  emit?: number;
  /** Albedo brightness multiplier. */
  shade?: number;
  /** Random offset for flicker / blink patterns. */
  phase?: number;
  /** Extra UV offset (in tiles). */
  u0?: number;
  v0?: number;
}

export type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

const DEFAULT_TILE = 16;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => scale(a, 1 / (len(a) || 1));

/**
 * Accumulates hull geometry with the attributes the hull material expects:
 * position, normal, uv (in texture repeats, world-aligned so neighbours tile seamlessly),
 * tangent (explicit, so normal maps are lit correctly on every face) and
 * `aInfo` = (layer, emit, shade, phase).
 *
 * Every primitive follows one convention: `du` is the viewer's right and `dv` the viewer's up
 * when looking at the front face, so textures are never mirrored and the face normal is
 * cross(du, dv).
 */
export class HullBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uvs: number[] = [];
  private readonly tan: number[] = [];
  private readonly info: number[] = [];
  private readonly idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  private vert(p: V3, n: V3, u: number, v: number, t: V3, s: Surf): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uvs.push(u, v);
    this.tan.push(t[0], t[1], t[2], 1);
    this.info.push(s.layer, s.emit ?? 1, s.shade ?? 1, s.phase ?? 0);
    return this.pos.length / 3 - 1;
  }

  /** Quad from corner `p0` spanned by `du` (viewer-right) and `dv` (viewer-up). */
  quad(p0: V3, du: V3, dv: V3, s: Surf): void {
    const tile = s.tile ?? DEFAULT_TILE;
    const n = norm(cross(du, dv));
    const t = norm(du);
    const u0 = s.u0 ?? 0;
    const v0 = s.v0 ?? 0;
    const u1 = u0 + len(du) / tile;
    const v1 = v0 + len(dv) / tile;
    const a = this.vert(p0, n, u0, v0, t, s);
    const b = this.vert(add(p0, du), n, u1, v0, t, s);
    const c = this.vert(add(add(p0, du), dv), n, u1, v1, t, s);
    const d = this.vert(add(p0, dv), n, u0, v1, t, s);
    this.idx.push(a, b, c, a, c, d);
  }

  /**
   * Axis-aligned box with world-aligned UVs. `faces` overrides the surface per face;
   * `null` skips a face (e.g. bottoms nobody sees).
   */
  box(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    s: Surf,
    faces: Partial<Record<Face, Surf | null>> = {},
  ): void {
    const tileOf = (f: Surf) => f.tile ?? DEFAULT_TILE;
    const pick = (f: Face): Surf | null => (f in faces ? (faces[f] ?? null) : s);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const put = (f: Face, p0: V3, du: V3, dv: V3, u: number, v: number) => {
      const surf = pick(f);
      if (!surf) return;
      const k = tileOf(surf);
      this.quad(p0, du, dv, { ...surf, u0: u / k + (surf.u0 ?? 0), v0: v / k + (surf.v0 ?? 0) });
    };
    put('px', [x1, y0, z0], [0, dy, 0], [0, 0, dz], y0, z0);
    put('nx', [x0, y1, z0], [0, -dy, 0], [0, 0, dz], -y1, z0);
    put('py', [x1, y1, z0], [-dx, 0, 0], [0, 0, dz], -x1, z0);
    put('ny', [x0, y0, z0], [dx, 0, 0], [0, 0, dz], x0, z0);
    put('pz', [x0, y0, z1], [dx, 0, 0], [0, dy, 0], x0, y0);
    put('nz', [x0, y1, z0], [dx, 0, 0], [0, -dy, 0], x0, -y1);
  }

  /**
   * Surface of revolution around the +z axis through (cx, cy, cz). `profile` is a list of
   * (radius, height) points walked bottom → top for an outward-facing surface (reverse it for
   * an inward-facing one, e.g. the inside of a dish).
   */
  lathe(
    cx: number,
    cy: number,
    cz: number,
    profile: readonly (readonly [number, number])[],
    segments: number,
    s: Surf,
    frame: { x: V3; y: V3; z: V3 } = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
  ): void {
    const tile = s.tile ?? DEFAULT_TILE;
    const n = profile.length;
    // Per-profile-point 2D normals (averaged across adjacent segments) and arc lengths.
    const pn: [number, number][] = [];
    const arc: number[] = [0];
    for (let i = 0; i < n; i++) {
      const prev = profile[Math.max(0, i - 1)]!;
      const next = profile[Math.min(n - 1, i + 1)]!;
      const dr = next[0] - prev[0];
      const dh = next[1] - prev[1];
      const l = Math.hypot(dr, dh) || 1;
      pn.push([dh / l, -dr / l]);
      if (i > 0) {
        const a = profile[i - 1]!;
        const b = profile[i]!;
        arc.push(arc[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
      }
    }
    const maxR = Math.max(...profile.map((p) => Math.abs(p[0])));
    const circumference = 2 * Math.PI * Math.max(0.01, maxR);
    const at = (lx: number, ly: number, lz: number): V3 => [
      cx + frame.x[0] * lx + frame.y[0] * ly + frame.z[0] * lz,
      cy + frame.x[1] * lx + frame.y[1] * ly + frame.z[1] * lz,
      cz + frame.x[2] * lx + frame.y[2] * ly + frame.z[2] * lz,
    ];
    const dir = (lx: number, ly: number, lz: number): V3 => norm(sub(at(lx, ly, lz), at(0, 0, 0)));
    const base = this.vertexCount;
    for (let i = 0; i < n; i++) {
      const [r, h] = profile[i]!;
      const [nr, nh] = pn[i]!;
      for (let j = 0; j <= segments; j++) {
        const a = (j / segments) * Math.PI * 2;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        this.vert(
          at(r * c, r * sn, h),
          dir(nr * c, nr * sn, nh),
          (j / segments) * (circumference / tile) + (s.u0 ?? 0),
          arc[i]! / tile + (s.v0 ?? 0),
          dir(-sn, c, 0),
          s,
        );
      }
    }
    const row = segments + 1;
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < segments; j++) {
        const a = base + i * row + j;
        const b = a + 1;
        const c = a + row + 1;
        const d = a + row;
        this.idx.push(a, b, c, a, c, d);
      }
    }
  }

  /** Open cylinder between two points (pipes, masts, barrels). */
  tube(a: V3, b: V3, r: number, segments: number, s: Surf): void {
    const axis = sub(b, a);
    const z = norm(axis);
    const helper: V3 = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const x = norm(cross(helper, z));
    const y = cross(z, x);
    this.lathe(
      a[0],
      a[1],
      a[2],
      [
        [r, 0],
        [r, len(axis)],
      ],
      segments,
      s,
      { x, y, z },
    );
  }

  /** Flat disc (cap) facing +z at height z. */
  disc(cx: number, cy: number, z: number, r: number, segments: number, s: Surf): void {
    const tile = s.tile ?? DEFAULT_TILE;
    const c = this.vert([cx, cy, z], [0, 0, 1], cx / tile, cy / tile, [1, 0, 0], s);
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      this.vert([px, py, z], [0, 0, 1], px / tile, py / tile, [1, 0, 0], s);
    }
    for (let j = 0; j < segments; j++) this.idx.push(c, c + 1 + j, c + 2 + j);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('tangent', new Float32BufferAttribute(this.tan, 4));
    g.setAttribute('aInfo', new Float32BufferAttribute(this.info, 4));
    g.setIndex(new Uint32BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
