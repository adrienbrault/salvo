import { describe, expect, test } from 'bun:test';
import type { BufferGeometry } from 'three/webgpu';
import { HullBuilder, type V3 } from './HullBuilder';

type Tri = { p: V3[]; n: V3[]; uv: [number, number][]; t: V3[] };

function triangles(g: BufferGeometry): Tri[] {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const tan = g.getAttribute('tangent');
  const idx = g.getIndex()!;
  const out: Tri[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const tri: Tri = { p: [], n: [], uv: [], t: [] };
    for (let k = 0; k < 3; k++) {
      const v = idx.getX(i + k);
      tri.p.push([pos.getX(v), pos.getY(v), pos.getZ(v)]);
      tri.n.push([nrm.getX(v), nrm.getY(v), nrm.getZ(v)]);
      tri.uv.push([uv.getX(v), uv.getY(v)]);
      tri.t.push([tan.getX(v), tan.getY(v), tan.getZ(v)]);
    }
    out.push(tri);
  }
  return out;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Every triangle must be wound so its geometric normal agrees with the stored normals, and
 * the stored tangent / implied bitangent must follow the UV gradients — otherwise faces are
 * culled or normal-mapped relief is lit from the wrong side.
 */
function checkFrame(g: BufferGeometry): void {
  let checked = 0;
  for (const tri of triangles(g)) {
    const e1 = sub(tri.p[1]!, tri.p[0]!);
    const e2 = sub(tri.p[2]!, tri.p[0]!);
    const geoN = cross(e1, e2);
    if (Math.hypot(...geoN) < 1e-6) continue; // degenerate (lathe pole)
    const du1 = tri.uv[1]![0] - tri.uv[0]![0];
    const dv1 = tri.uv[1]![1] - tri.uv[0]![1];
    const du2 = tri.uv[2]![0] - tri.uv[0]![0];
    const dv2 = tri.uv[2]![1] - tri.uv[0]![1];
    const det = du1 * dv2 - du2 * dv1;
    const T: V3 = [
      (e1[0] * dv2 - e2[0] * dv1) / det,
      (e1[1] * dv2 - e2[1] * dv1) / det,
      (e1[2] * dv2 - e2[2] * dv1) / det,
    ];
    const B: V3 = [
      (e2[0] * du1 - e1[0] * du2) / det,
      (e2[1] * du1 - e1[1] * du2) / det,
      (e2[2] * du1 - e1[2] * du2) / det,
    ];
    for (let k = 0; k < 3; k++) {
      const n = tri.n[k]!;
      const t = tri.t[k]!;
      expect(dot(geoN, n)).toBeGreaterThan(0);
      expect(Math.abs(dot(n, t))).toBeLessThan(1e-4);
      expect(dot(T, t)).toBeGreaterThan(0);
      expect(dot(B, cross(n, t))).toBeGreaterThan(0);
    }
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
}

describe('HullBuilder', () => {
  test('box faces point outward with consistent tangent frames', () => {
    const b = new HullBuilder();
    b.box(-1, -2, -3, 4, 5, 6, { layer: 0, tile: 3 });
    const g = b.build();
    checkFrame(g);
    // Outward: every face normal points away from the box centre.
    for (const tri of triangles(g)) {
      const c: V3 = [1.5, 1.5, 1.5];
      expect(dot(sub(tri.p[0]!, c), tri.n[0]!)).toBeGreaterThan(0);
    }
  });

  test('sloped quads (trench walls) on both sides face the trench', () => {
    for (const s of [-1, 1]) {
      const b = new HullBuilder();
      b.quad([s * 42, s > 0 ? 64 : 0, -18], [0, -s * 64, 0], [s * 4, 0, 12], { layer: 1 });
      const g = b.build();
      checkFrame(g);
      const n = g.getAttribute('normal');
      expect(Math.sign(n.getX(0))).toBe(-s);
      expect(n.getZ(0)).toBeGreaterThan(0);
    }
  });

  test('lathes, tubes and discs have consistent frames', () => {
    const b = new HullBuilder();
    b.lathe(
      3,
      4,
      5,
      [
        [2, 0],
        [2, 1],
        [1.4, 1.8],
        [0, 2],
      ],
      12,
      { layer: 2 },
    );
    b.tube([0, 0, 0], [0, 20, 0], 1, 10, { layer: 3 });
    b.tube([-5, 3, -2], [5, 3, -2], 0.5, 8, { layer: 3 });
    b.tube([1, 1, 0], [1, 1, 9], 0.3, 6, { layer: 3 });
    b.disc(0, 0, 2, 3, 12, { layer: 4 });
    checkFrame(b.build());
  });

  test('world-aligned UVs make adjacent boxes tile seamlessly', () => {
    const b = new HullBuilder();
    b.box(0, 0, 0, 8, 8, 1, { layer: 0, tile: 16 }, { px: null, nx: null, py: null, ny: null, nz: null });
    b.box(8, 0, 0, 16, 8, 1, { layer: 0, tile: 16 }, { px: null, nx: null, py: null, ny: null, nz: null });
    const uv = b.build().getAttribute('uv');
    // Right edge of the first top face meets the left edge of the second at u = 0.5.
    expect(uv.getX(1)).toBeCloseTo(0.5);
    expect(uv.getX(4)).toBeCloseTo(0.5);
  });
});
