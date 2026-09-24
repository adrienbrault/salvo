import { describe, expect, test } from 'bun:test';
import { type Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { Rng } from '../../sim/rng';
import { BIOMES } from './biomes';
import { checkFrame, dot } from './geometry.testing';
import { HullBuilder } from './HullBuilder';
import { LAYER, LAYER_COUNT } from './HullTextures';
import type { Materials } from './layout';
import { SEG } from './layout';
import { boulder, bumps, RockNoise, rockGround, rockWall } from './rock';
import { SegmentBuilder } from './SegmentBuilder';

const mats: Materials = {
  hull: new MeshStandardNodeMaterial(),
  beacon: new MeshBasicNodeMaterial(),
  cone: new MeshBasicNodeMaterial(),
  shadows: false,
};

function buildSegment(biome: number, seed: string, index = 0) {
  const def = BIOMES[biome]!;
  const rng = new Rng(`${seed}/${def.id}`);
  const { cfg, layout } = def.plan(rng.fork('plan'));
  return new SegmentBuilder(rng.fork(`seg${index}`), mats, cfg, def.remap).build(layout);
}

function hullMeshes(biome: number, seed: string): Mesh[] {
  const out: Mesh[] = [];
  buildSegment(biome, seed).group.traverse((o) => {
    if ((o as Mesh).isMesh && (o as Mesh).material === mats.hull) out.push(o as Mesh);
  });
  return out;
}

describe('rock', () => {
  const rock = new RockNoise(new Rng('rock-test'));

  test('relief repeats exactly every segment', () => {
    for (const t of [0, 7.3, 41, 180]) expect(rock.at(0, t)).toBeCloseTo(rock.at(SEG, t), 9);
  });

  test('walls join seamlessly between segments and face the trench', () => {
    for (const s of [-1, 1] as const) {
      const hb = new HullBuilder();
      const profile = [
        [26, -90, 3],
        [31, -40, 3],
        [35, -18, 0.2],
      ] as const;
      rockWall(hb, s, profile, rock, bumps(new Rng(`b${s}`), 5, 80), { layer: LAYER.ROCK });
      const g = hb.build();
      checkFrame(g);
      const pos = g.getAttribute('position');
      const nrm = g.getAttribute('normal');
      const start = new Map<string, number>();
      const end = new Map<string, number>();
      for (let i = 0; i < pos.count; i++) {
        const key = pos.getZ(i).toFixed(3);
        if (Math.abs(pos.getY(i)) < 1e-6) start.set(key, pos.getX(i));
        if (Math.abs(pos.getY(i) - SEG) < 1e-6) end.set(key, pos.getX(i));
        // Walls face the trench axis.
        expect(Math.sign(nrm.getX(i))).toBe(-s);
      }
      expect(start.size).toBeGreaterThan(10);
      for (const [z, x] of start) expect(end.get(z)).toBeCloseTo(x, 6);
    }
  });

  test('ground and boulders have consistent frames and face out', () => {
    const hb = new HullBuilder();
    rockGround(hb, -1, 48, 120, -5, 5, rock, { layer: LAYER.ROCK });
    rockGround(hb, 1, 48, 120, -5, 5, rock, { layer: LAYER.ROCK });
    const ground = hb.build();
    checkFrame(ground);
    const n = ground.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect(n.getZ(i)).toBeGreaterThan(0.3);

    const b = new HullBuilder();
    boulder(b, [3, 4, 5], 2, 11, { layer: LAYER.ROCK });
    const g = b.build();
    checkFrame(g);
    const p = g.getAttribute('position');
    const bn = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      const out = [p.getX(i) - 3, p.getY(i) - 4, p.getZ(i) - 5] as const;
      expect(dot(out, [bn.getX(i), bn.getY(i), bn.getZ(i)])).toBeGreaterThan(0);
    }
  });
});

describe('biomes', () => {
  test.each(BIOMES.map((b, i) => [b.id, i] as const))('%s builds valid, bounded geometry', (_id, i) => {
    let verts = 0;
    for (const mesh of hullMeshes(i, 'seed-a')) {
      const pos = mesh.geometry.getAttribute('position').array as Float32Array;
      for (const v of pos) expect(Number.isFinite(v)).toBe(true);
      const info = mesh.geometry.getAttribute('aInfo').array as Float32Array;
      for (let k = 0; k < info.length; k += 4) {
        expect(Number.isInteger(info[k])).toBe(true);
        expect(info[k]).toBeGreaterThanOrEqual(0);
        expect(info[k]).toBeLessThan(LAYER_COUNT);
      }
      verts += pos.length / 3;
    }
    // Ten segments per biome stay resident: keep each within a mobile-friendly budget.
    expect(verts).toBeLessThan(90_000);
  });

  test('a seed always rebuilds the same trench, and seeds differ', () => {
    const sig = (seed: string) =>
      hullMeshes(1, seed)
        .map((m) => m.geometry.getAttribute('position').count)
        .join(',') +
      '/' +
      (hullMeshes(1, seed)[0]!.geometry.getAttribute('position').array as Float32Array)
        .slice(0, 64)
        .join(',');
    expect(sig('run-1')).toBe(sig('run-1'));
    expect(sig('run-1')).not.toBe(sig('run-2'));
  });

  test('biome remaps are applied (no raw plates in the rusty belt)', () => {
    for (const mesh of hullMeshes(1, 'seed-a')) {
      const info = mesh.geometry.getAttribute('aInfo').array as Float32Array;
      for (let k = 0; k < info.length; k += 4) expect(info[k]).not.toBe(LAYER.PLATES);
    }
  });
});
