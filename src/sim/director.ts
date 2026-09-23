import { FIELD } from './constants';
import type { Rng } from './rng';
import type { World } from './world';

/**
 * Wave director: accumulates a spawn budget over time and spends it on formations.
 * Everything it does goes through the level RNG, so a level replays identically for a seed.
 */

interface Formation {
  id: string;
  cost: number;
  minSector: number;
  weight: number;
  spawn(w: World, rng: Rng, d: Director): void;
}

const TOP = FIELD.halfH + 6;
const HW = FIELD.halfW;

const FORMATIONS: Formation[] = [
  {
    id: 'darts_line',
    cost: 10,
    minSector: 0,
    weight: 3,
    spawn(w, rng) {
      const n = 5;
      const cx = rng.float(-15, 15);
      for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * 11;
        w.spawnEnemy('dart', x, TOP + Math.abs(i - 2) * 3, { a: 0, b: 42, c: rng.float(0.7, 1.8) });
      }
    },
  },
  {
    id: 'darts_v',
    cost: 13,
    minSector: 0,
    weight: 2.5,
    spawn(w, rng) {
      const cx = rng.float(-20, 20);
      for (let i = -3; i <= 3; i++) {
        w.spawnEnemy('dart', cx + i * 6, TOP + Math.abs(i) * 5, { a: 0, b: 46, c: rng.float(0.8, 1.6) });
      }
    },
  },
  {
    id: 'darts_stream',
    cost: 11,
    minSector: 0,
    weight: 2,
    spawn(w, rng, d) {
      const side = rng.sign();
      for (let i = 0; i < 6; i++) {
        d.schedule(i * 0.28, () =>
          w.spawnEnemy('dart', side * (HW - 6), TOP, { a: -side * 22, b: 40, c: 0.9 + (i % 2) * 0.4 }),
        );
      }
    },
  },
  {
    id: 'weaver_pair',
    cost: 12,
    minSector: 0,
    weight: 2.5,
    spawn(w, rng) {
      const amp = rng.float(10, 18);
      const off = rng.float(14, 24);
      for (const side of [-1, 1]) {
        w.spawnEnemy('weaver', side * off, TOP, { a: side * off, b: 1.6, c: amp, d: side > 0 ? Math.PI : 0 });
      }
    },
  },
  {
    id: 'weaver_snake',
    cost: 18,
    minSector: 0,
    weight: 1.6,
    spawn(w, rng, d) {
      const cx = rng.float(-18, 18);
      const amp = rng.float(14, 22);
      for (let i = 0; i < 5; i++) {
        d.schedule(i * 0.38, () => w.spawnEnemy('weaver', cx, TOP, { a: cx, b: 1.9, c: amp, d: 0 }));
      }
    },
  },
  {
    id: 'turret',
    cost: 18,
    minSector: 0,
    weight: 1.6,
    spawn(w, rng) {
      w.spawnEnemy('turret', rng.float(-28, 28), TOP, { a: rng.float(28, 52) });
    },
  },
  {
    id: 'divers',
    cost: 12,
    minSector: 0,
    weight: 2,
    spawn(w, rng, d) {
      for (let i = 0; i < 4; i++) {
        const x = rng.float(-36, 36);
        d.schedule(i * 0.45, () => w.spawnEnemy('diver', x, TOP, { a: rng.float(25, 55) }));
      }
    },
  },
  {
    id: 'orbiters',
    cost: 16,
    minSector: 0,
    weight: 1.6,
    spawn(w, rng) {
      const cx = rng.float(-18, 18);
      for (let i = 0; i < 2; i++) {
        w.spawnEnemy('orbiter', cx, TOP, { a: cx, b: TOP, c: 1.7 * (i ? 1 : -1), d: i * Math.PI });
      }
    },
  },
  {
    id: 'mines',
    cost: 10,
    minSector: 0,
    weight: 1.4,
    spawn(w, rng) {
      for (let i = 0; i < 5; i++) {
        w.spawnEnemy('mine', rng.float(-38, 38), TOP + rng.float(0, 18), {
          a: rng.float(-6, 6),
          b: rng.float(10, 17),
        });
      }
    },
  },
  {
    id: 'carrier',
    cost: 34,
    minSector: 1,
    weight: 1,
    spawn(w, rng) {
      w.spawnEnemy('carrier', rng.float(-14, 14), TOP + 4, { a: rng.float(-10, 10), c: 2.5 });
    },
  },
  {
    id: 'escort',
    cost: 26,
    minSector: 1,
    weight: 1.2,
    spawn(w, rng) {
      const x = rng.float(-20, 20);
      w.spawnEnemy('turret', x, TOP, { a: rng.float(34, 50) });
      for (const side of [-1, 1]) {
        for (let i = 0; i < 2; i++) {
          w.spawnEnemy('dart', x + side * (8 + i * 6), TOP + 4 + i * 4, { a: 0, b: 40, c: 1.1 + i * 0.3 });
        }
      }
    },
  },
];

const MAX_ENEMIES = 34;
const BASE_RATE = 5.2;

export class Director {
  private budget: number;
  private next: Formation | null = null;
  private lastId = '';
  private readonly queue: { at: number; fn: () => void }[] = [];
  private clock = 0;

  constructor(
    private readonly w: World,
    private readonly rng: Rng,
  ) {
    this.budget = 12;
  }

  schedule(delay: number, fn: () => void): void {
    this.queue.push({ at: this.clock + delay, fn });
  }

  update(dt: number, spawning: boolean): void {
    this.clock += dt;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i]!;
      if (q.at <= this.clock) {
        this.queue.splice(i, 1);
        if (spawning) q.fn();
      }
    }
    if (!spawning) return;
    this.budget += BASE_RATE * this.w.diff.budgetMul * dt;
    if (this.w.enemies.size >= MAX_ENEMIES) return;
    if (!this.next) this.next = this.pick();
    if (this.budget >= this.next.cost) {
      this.budget -= this.next.cost;
      this.lastId = this.next.id;
      this.next.spawn(this.w, this.rng, this);
      this.next = null;
    }
  }

  private pick(): Formation {
    const s = this.w.spec.sector;
    const pool = FORMATIONS.filter((f) => f.minSector <= s && f.id !== this.lastId);
    return this.rng.weighted(pool, (f) => f.weight);
  }
}
