import { BufferGeometry, Float32BufferAttribute } from 'three/webgpu';

/** Emissive-only geometry (beacons and light bars) with a per-vertex (kind, phase). */
export class BeaconBuilder {
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
