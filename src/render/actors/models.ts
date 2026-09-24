import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BoxGeometry,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three/webgpu';
import type { EnemyKind } from '../../sim/types';

/**
 * Procedural models. Every model faces +X (sim angle 0) and lies in the XY plane; thickness is Z.
 * `hull` renders with a lit metal material, `glow` with an unlit HDR emissive one.
 */
export interface ModelParts {
  hull: BufferGeometry[];
  glow: BufferGeometry[];
}

const prep = (g: BufferGeometry): BufferGeometry => {
  const ng = g.index ? g.toNonIndexed() : g;
  if (!ng.getAttribute('uv')) throw new Error('model part without uv');
  return ng;
};

/** Merge into a single geometry with two groups: 0 = hull, 1 = glow. */
export function mergeParts(parts: ModelParts): BufferGeometry {
  const hull = mergeGeometries(parts.hull.map(prep), false);
  const glow = mergeGeometries(parts.glow.map(prep), false);
  const merged = mergeGeometries([hull, glow], true);
  if (!merged) throw new Error('mergeGeometries failed');
  merged.computeBoundingSphere();
  return merged;
}

const tx = <T extends BufferGeometry>(g: T, x = 0, y = 0, z = 0): T => {
  g.translate(x, y, z);
  return g;
};
const sc = <T extends BufferGeometry>(g: T, x: number, y: number, z: number): T => {
  g.scale(x, y, z);
  return g;
};
/** Cylinder/cone built along Y, turned to lie along X. */
const alongX = <T extends BufferGeometry>(g: T): T => {
  g.rotateZ(-Math.PI / 2);
  return g;
};
/** Cylinder built along Y, turned to stand along Z (prism seen from above). */
const alongZ = <T extends BufferGeometry>(g: T): T => {
  g.rotateX(Math.PI / 2);
  return g;
};

function dart(): ModelParts {
  return {
    hull: [
      sc(new OctahedronGeometry(1, 0), 3.2, 1.9, 0.8),
      tx(sc(new OctahedronGeometry(1, 0), 1.6, 2.6, 0.35), -0.8, 0, 0),
    ],
    glow: [
      tx(sc(new OctahedronGeometry(1, 0), 1.1, 0.45, 0.9), 0.4, 0, 0.35),
      tx(new SphereGeometry(0.35, 8, 6), -0.9, 2.3, 0),
      tx(new SphereGeometry(0.35, 8, 6), -0.9, -2.3, 0),
      tx(alongX(new ConeGeometry(0.5, 1.4, 8)), -3, 0, 0).rotateZ(Math.PI),
    ],
  };
}

function weaver(): ModelParts {
  const wing = (s: number) => tx(sc(new OctahedronGeometry(1, 0), 1.2, 2.2, 0.25), -0.6, s * 1.8, 0);
  return {
    hull: [sc(new SphereGeometry(1, 16, 10), 2.3, 1.6, 0.8), wing(1), wing(-1)],
    glow: [
      new TorusGeometry(2.6, 0.16, 6, 32),
      tx(new SphereGeometry(0.55, 10, 8), 0.9, 0, 0.5),
      tx(sc(new SphereGeometry(0.4, 8, 6), 1, 1, 1), -2.1, 0, 0),
    ],
  };
}

function turret(): ModelParts {
  const glow: BufferGeometry[] = [new TorusGeometry(3.2, 0.22, 6, 36)];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    glow.push(tx(new BoxGeometry(0.7, 0.7, 0.9), Math.cos(a) * 4.6, Math.sin(a) * 4.6, 0.6));
  }
  glow.push(tx(new SphereGeometry(1.1, 14, 10), 0, 0, 1.4));
  return {
    hull: [
      alongZ(new CylinderGeometry(4.6, 5.2, 2.2, 6)),
      tx(alongZ(new CylinderGeometry(2.6, 3.4, 1.6, 12)), 0, 0, 1.4),
      tx(sc(new BoxGeometry(2.6, 1, 0.8), 1, 1, 1), 4.2, 0, 0.8),
    ],
    glow,
  };
}

function diver(): ModelParts {
  return {
    hull: [
      alongX(new ConeGeometry(1.5, 6.4, 5)),
      tx(sc(new OctahedronGeometry(1, 0), 1.4, 2.6, 0.3), -1.6, 0, 0),
    ],
    glow: [
      tx(new SphereGeometry(0.7, 10, 8), -3, 0, 0),
      tx(sc(new BoxGeometry(3.2, 0.25, 0.3), 1, 1, 1), 0.2, 0, 0.75),
    ],
  };
}

function orbiter(): ModelParts {
  const ring = new TorusGeometry(2.7, 0.5, 8, 28);
  ring.rotateY(0.5);
  const blades: BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const b = tx(sc(new OctahedronGeometry(1, 0), 0.5, 1.4, 0.3), 2.7, 0, 0);
    b.rotateZ((i / 3) * Math.PI * 2);
    blades.push(b);
  }
  return {
    hull: [ring, ...blades],
    glow: [new IcosahedronGeometry(1.5, 1)],
  };
}

function carrier(): ModelParts {
  const pod = (s: number) => tx(alongX(new CylinderGeometry(1.4, 1.6, 9, 12)), 0, s * 4.6, 0);
  const glow: BufferGeometry[] = [];
  for (let i = -2; i <= 2; i++) glow.push(tx(new BoxGeometry(0.5, 0.5, 0.4), i * 1.9, 0, 1.55));
  glow.push(tx(alongX(new CylinderGeometry(1.2, 1.2, 0.6, 12)), -4.8, 4.6, 0));
  glow.push(tx(alongX(new CylinderGeometry(1.2, 1.2, 0.6, 12)), -4.8, -4.6, 0));
  glow.push(tx(sc(new SphereGeometry(1, 12, 8), 1.2, 0.8, 0.6), 4.6, 0, 0.8));
  return {
    hull: [
      new BoxGeometry(10, 6.4, 2.6),
      pod(1),
      pod(-1),
      tx(new BoxGeometry(4, 3, 1.4), 1, 0, 1.6),
      tx(alongX(new ConeGeometry(2.6, 3, 4)), 6, 0, 0),
    ],
    glow,
  };
}

function mine(): ModelParts {
  const spikes: BufferGeometry[] = [];
  const ico = new IcosahedronGeometry(1, 0);
  const pos = ico.getAttribute('position');
  const seen = new Set<string>();
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < pos.count; i++) {
    const v = new Vector3().fromBufferAttribute(pos, i).normalize();
    const key = v
      .toArray()
      .map((n) => n.toFixed(2))
      .join();
    if (seen.has(key)) continue;
    seen.add(key);
    const cone = new ConeGeometry(0.32, 1.3, 6);
    cone.translate(0, 2.1, 0);
    cone.applyQuaternion(new Quaternion().setFromUnitVectors(up, v));
    spikes.push(cone);
  }
  // Solid spikes round a small glowing heart: a thing to shoot, not a bullet to dodge.
  return {
    hull: [new IcosahedronGeometry(1.8, 0), ...spikes],
    glow: [new IcosahedronGeometry(1.1, 1)],
  };
}

const BUILDERS: Record<Exclude<EnemyKind, 'boss'>, () => ModelParts> = {
  dart,
  weaver,
  turret,
  diver,
  orbiter,
  carrier,
  mine,
};

export function enemyGeometry(kind: Exclude<EnemyKind, 'boss'>): BufferGeometry {
  return mergeParts(BUILDERS[kind]());
}

/** Player fighter, nose along +Y. Returns separate parts so materials can differ. */
export function playerParts(): { hull: BufferGeometry; trim: BufferGeometry; canopy: BufferGeometry } {
  const body = new Shape();
  body.moveTo(0, 4.2);
  body.lineTo(0.9, 1.6);
  body.lineTo(1.2, -0.6);
  body.lineTo(3.9, -2.2);
  body.lineTo(4.1, -3.1);
  body.lineTo(1.3, -2.5);
  body.lineTo(1.0, -3.4);
  body.lineTo(-1.0, -3.4);
  body.lineTo(-1.3, -2.5);
  body.lineTo(-4.1, -3.1);
  body.lineTo(-3.9, -2.2);
  body.lineTo(-1.2, -0.6);
  body.lineTo(-0.9, 1.6);
  body.closePath();
  const hull = new ExtrudeGeometry(body, {
    depth: 0.7,
    bevelEnabled: true,
    bevelThickness: 0.35,
    bevelSize: 0.25,
    bevelSegments: 3,
  });
  hull.translate(0, 0, -0.35);
  const spine = tx(sc(new SphereGeometry(1, 16, 12), 0.75, 2.8, 0.7), 0, -0.2, 0.45);
  const nacelleL = tx(new CylinderGeometry(0.55, 0.65, 3, 12), -1.55, -2.2, 0.1);
  const nacelleR = tx(new CylinderGeometry(0.55, 0.65, 3, 12), 1.55, -2.2, 0.1);
  const hullMerged = mergeGeometries([prep(hull), prep(spine), prep(nacelleL), prep(nacelleR)], false);

  const trim = mergeGeometries(
    [
      prep(tx(new BoxGeometry(2.6, 0.18, 0.2), -2.6, -2.55, 0.5).rotateZ(0)),
      prep(tx(new BoxGeometry(2.6, 0.18, 0.2), 2.6, -2.55, 0.5)),
      prep(tx(new SphereGeometry(0.28, 8, 6), -4, -3, 0.2)),
      prep(tx(new SphereGeometry(0.28, 8, 6), 4, -3, 0.2)),
      prep(tx(new CylinderGeometry(0.42, 0.42, 0.3, 14), -1.55, -3.75, 0.1)),
      prep(tx(new CylinderGeometry(0.42, 0.42, 0.3, 14), 1.55, -3.75, 0.1)),
    ],
    false,
  );
  const canopy = tx(sc(new SphereGeometry(1, 18, 12), 0.55, 1.35, 0.5), 0, 1.0, 0.75);
  return { hull: hullMerged, trim, canopy: prep(canopy) };
}
