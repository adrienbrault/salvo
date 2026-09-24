import { expect } from 'bun:test';
import type { BufferGeometry } from 'three/webgpu';
import type { V3 } from './HullBuilder';

/** Geometry assertions shared by the environment tests. */
export type Tri = { p: V3[]; n: V3[]; uv: [number, number][]; t: V3[] };

export function triangles(g: BufferGeometry): Tri[] {
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

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Every triangle must be wound so its geometric normal agrees with the stored normals, and
 * the stored tangent / implied bitangent must follow the UV gradients — otherwise faces are
 * culled or normal-mapped relief is lit from the wrong side.
 */
export function checkFrame(g: BufferGeometry): void {
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
