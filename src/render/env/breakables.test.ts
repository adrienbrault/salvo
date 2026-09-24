import { describe, expect, test } from 'bun:test';
import { type Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, Vector3 } from 'three/webgpu';
import { Rng } from '../../sim/rng';
import { BIOMES } from './biomes';
import {
  animateBreak,
  breakIt,
  PART_TEXELS,
  PartTable,
  partCenter,
  posePoint,
  resetBreakable,
} from './breakables';
import { type BreakPart, type Materials, SEG, type Segment, TRENCH } from './layout';
import { MAX_BREAKABLES, MAX_PARTS, SegmentBuilder } from './SegmentBuilder';

const mats: Materials = {
  hull: new MeshStandardNodeMaterial(),
  beacon: new MeshBasicNodeMaterial(),
  cone: new MeshBasicNodeMaterial(),
  shadows: false,
};

/** A biome's whole segment pool (every variant a run can show), rows allotted as Trench does. */
function pool(biome: number, seed: string): Segment[] {
  const def = BIOMES[biome]!;
  const rng = new Rng(`${seed}/${def.id}`);
  const { cfg, layout } = def.plan(rng.fork('plan'));
  return Array.from({ length: 10 }, (_, i) =>
    new SegmentBuilder(rng.fork(`seg${i}`), mats, cfg, def.remap, 1 + i * MAX_PARTS).build(layout),
  );
}

/** Every vertex (segment-local) of each part, from the segment's meshes. */
function partVertices(seg: Segment, material: unknown): Map<number, Vector3[]> {
  const out = new Map<number, Vector3[]>();
  for (const o of seg.group.children) {
    const mesh = o as Mesh;
    if (!mesh.isMesh || mesh.material !== material) continue;
    const pos = mesh.geometry.getAttribute('position');
    const part = mesh.geometry.getAttribute('aPart');
    for (let i = 0; i < pos.count; i++) {
      const k = part.getX(i);
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }
  }
  return out;
}

describe('breakables', () => {
  test.each(BIOMES.map((b, i) => [b.id, i] as const))(
    '%s: bounded, and falls stay out of the play field',
    (_id, i) => {
      let total = 0;
      let crossings = 0;
      pool(i, 'seed-b').forEach((seg, si) => {
        expect(seg.breakables.length).toBeLessThanOrEqual(MAX_BREAKABLES);
        total += seg.breakables.length;
        const verts = partVertices(seg, mats.hull);
        const lights = partVertices(seg, mats.beacon);
        // Rows stay inside the segment's allotment of the part table.
        for (const k of [...verts.keys(), ...lights.keys()]) {
          if (k !== 0) {
            expect(k).toBeGreaterThanOrEqual(1 + si * MAX_PARTS);
            expect(k).toBeLessThan(1 + (si + 1) * MAX_PARTS);
          }
        }
        const out = new Vector3();
        for (const b of seg.breakables) {
          for (const v of [b.x0, b.x1, b.y0, b.y1, b.zTop, b.size]) expect(Number.isFinite(v)).toBe(true);
          expect(b.x0).toBeLessThan(b.x1);
          expect(Math.max(Math.abs(b.x0), Math.abs(b.x1))).toBeLessThanOrEqual(TRENCH.deckX);
          expect(b.y0).toBeGreaterThan(-8);
          expect(b.y1).toBeLessThan(SEG + 8);
          expect(b.hp).toBeGreaterThan(0);
          if (b.parts.length === 2) crossings++;

          breakIt(b, 0);
          animateBreak(b, 10);
          for (const p of b.parts) {
            const vs = verts.get(p.index) ?? [];
            expect(vs.length).toBeGreaterThan(0);
            // Nothing ends up over the play field: whatever lies inside |x| < 50 stays below z −2.
            for (const v of vs) {
              posePoint(p, v, out);
              if (Math.abs(out.x) < 50) expect(out.z).toBeLessThan(-2);
            }
          }
          // Crossings snap and sag: each half's free end drops below its hinge.
          if (b.parts.length === 2) {
            for (const p of b.parts) expect(partCenter(p, new Vector3()).z).toBeLessThan(p.pivot.z);
          }
        }
      });
      expect(total).toBeGreaterThan(10);
      // Every biome has spans across the trench somewhere in its pool.
      expect(crossings).toBeGreaterThan(0);
    },
  );

  test('the part table tracks a break and resets exactly', () => {
    const seg = pool(0, 'seed-c')[0]!;
    const table = new PartTable(1 + MAX_PARTS);
    const b = seg.breakables[0]!;
    const row = (p: BreakPart) =>
      Array.from(table.data.slice(p.index * PART_TEXELS * 4, (p.index + 1) * PART_TEXELS * 4));
    table.set(b, 0);
    const pristine = b.parts.map(row);
    for (const r of pristine) {
      expect(r.slice(0, 4)).toEqual([0, 0, 0, 1]);
      expect(r[7]).toBe(0);
      expect(r[8]).toBe(0);
    }

    breakIt(b, 3);
    expect(b.brokenAt).toBe(3);
    expect(b.hp).toBe(0);
    animateBreak(b, 1);
    table.set(b, 0.5);
    for (const p of b.parts) {
      const r = row(p);
      expect(r[8]).toBe(1);
      expect(r[9]).toBe(0.5);
      expect(r.slice(0, 4)).toEqual([p.q.x, p.q.y, p.q.z, p.q.w].map(Math.fround));
    }
    expect(b.parts.some((p) => p.q.w < 1 || p.drop > 0)).toBe(true);

    resetBreakable(b);
    table.set(b, 0);
    expect(b.brokenAt).toBe(-1);
    expect(b.hp).toBe(b.maxHp);
    expect(b.parts.map(row)).toEqual(pristine);
  });
});
