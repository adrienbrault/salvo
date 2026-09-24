import { describe, expect, test } from 'bun:test';
import { checkFrame, dot, sub, triangles } from './geometry.testing';
import { HullBuilder, type V3 } from './HullBuilder';

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

  test('displaced grids, oriented boxes and trusses have consistent frames', () => {
    const b = new HullBuilder();
    b.grid(
      6,
      9,
      (i, j) => [j * 2, Math.sin(i * 1.3 + j) * 0.6, i * 1.5],
      (i, j) => [j * 0.2, i * 0.15],
      { layer: 1 },
    );
    const c = Math.cos(0.6);
    const sn = Math.sin(0.6);
    // Rotated frame (about z then tilted): still right-handed.
    b.orientedBox([3, 2, 1], [c, sn, 0], [-sn * c, c * c, sn], [sn * sn, -c * sn, c], 2, 1, 0.5, {
      layer: 2,
    });
    b.truss([0, 0, 0], [12, 3, 4], 1.5, { layer: 3 });
    checkFrame(b.build());
  });

  test('oriented boxes face outward', () => {
    const b = new HullBuilder();
    b.orientedBox([5, -2, 3], [0, 1, 0], [-1, 0, 0], [0, 0, 1], 1, 2, 3, { layer: 0 });
    for (const tri of triangles(b.build())) {
      expect(dot(sub(tri.p[0]!, [5, -2, 3]), tri.n[0]!)).toBeGreaterThan(0);
    }
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
