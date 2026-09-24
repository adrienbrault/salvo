import { updateBoss } from './boss';
import { FIELD } from './constants';
import { clamp } from './math';
import { aimed, fan, ring, spiral } from './patterns';
import type { Enemy, EnemyKind, Hue } from './types';
import type { World } from './world';

export interface EnemyArchetype {
  kind: EnemyKind;
  name: string;
  radius: number;
  /** HP at sector 1 before multipliers. */
  hp: number;
  /** Shards at sector 1 before multipliers. */
  value: number;
  heavy: boolean;
  hue: Hue;
  update(e: Enemy, w: World, dt: number): void;
}

const TOP = FIELD.halfH;

/** Fires only while comfortably on screen, so bullets never come from off-field. */
const canFire = (e: Enemy): boolean =>
  e.y < TOP - 4 && e.y > -FIELD.halfH + 30 && Math.abs(e.x) < FIELD.halfW;

const dart: EnemyArchetype = {
  kind: 'dart',
  name: 'Dart',
  radius: 2.6,
  hp: 2.5,
  value: 10,
  heavy: false,
  hue: 'red',
  // a: horizontal drift, b: descent speed, c: fire time (<0 = already fired)
  update(e, w, dt) {
    e.x += e.a * dt;
    e.y -= e.b * dt;
    e.rot = Math.atan2(-e.b, e.a);
    if (e.c > 0 && e.age >= e.c) {
      e.c = -1;
      if (canFire(e) && e.y > w.player.y + 20)
        aimed(w, e.x, e.y - 2, 40 * w.diff.bulletSpeed, 1, 0, { hue: 'red' });
    }
  },
};

const weaver: EnemyArchetype = {
  kind: 'weaver',
  name: 'Weaver',
  radius: 3.2,
  hp: 6,
  value: 16,
  heavy: false,
  hue: 'orange',
  // a: centre x, b: angular freq, c: amplitude, d: phase
  update(e, w, dt) {
    const prevX = e.x;
    e.y -= 20 * dt;
    e.x = e.a + Math.sin(e.age * e.b + e.d) * e.c;
    e.rot = Math.atan2(-20 * dt, e.x - prevX);
    e.fireT -= dt * w.diff.fireRate;
    if (e.fireT <= 0) {
      e.fireT = 1.7;
      if (canFire(e)) {
        aimed(w, e.x, e.y - 2, 36 * w.diff.bulletSpeed, 3, 0.5, { hue: 'orange', style: 'needle' });
      }
    }
  },
};

const turret: EnemyArchetype = {
  kind: 'turret',
  name: 'Bastion',
  radius: 5.2,
  hp: 28,
  value: 45,
  heavy: true,
  hue: 'violet',
  // a: stop y, state: 0 enter, 1 firing, 2 leaving; d: spiral angle
  update(e, w, dt) {
    e.rot += dt * 0.8;
    if (e.state === 0) {
      const dy = e.y - e.a;
      e.y -= Math.max(6, dy * 1.6) * dt;
      if (dy < 0.5) {
        e.state = 1;
        e.stateT = 0;
      }
      return;
    }
    e.stateT += dt;
    if (e.state === 1) {
      e.fireT -= dt * w.diff.fireRate;
      if (e.fireT <= 0) {
        e.state = e.stateT > 7 ? 2 : 1;
        const burst = Math.floor(e.stateT / 1.5) % 3;
        if (burst === 2) {
          e.fireT = 0.09;
          e.d += 0.37;
          spiral(w, e.x, e.y, 3, e.d, 30 * w.diff.bulletSpeed, { hue: 'violet' });
        } else {
          e.fireT = 1.5;
          ring(w, e.x, e.y, 14, 28 * w.diff.bulletSpeed, e.d, {
            hue: 'violet',
            style: 'bigOrb',
            radius: 1.7,
          });
          e.d += 0.22;
        }
      }
    } else {
      e.y -= 14 * dt;
    }
  },
};

const diver: EnemyArchetype = {
  kind: 'diver',
  name: 'Diver',
  radius: 2.6,
  hp: 3.5,
  value: 12,
  heavy: false,
  hue: 'red',
  // a: pause y; state 0 enter, 1 telegraph, 2 dive (vx, vy)
  update(e, w, dt) {
    if (e.state === 0) {
      e.y -= 38 * dt;
      e.rot = -Math.PI / 2;
      if (e.y <= e.a) {
        e.state = 1;
        e.stateT = 0;
      }
    } else if (e.state === 1) {
      e.stateT += dt;
      const target = Math.atan2(w.player.y - e.y, w.player.x - e.x);
      e.rot = target;
      if (e.stateT > 0.55) {
        e.state = 2;
        e.vx = Math.cos(target) * 20;
        e.vy = Math.sin(target) * 20;
      }
    } else {
      const speed = Math.min(135, Math.hypot(e.vx, e.vy) + 240 * dt);
      const ang = Math.atan2(e.vy, e.vx);
      e.vx = Math.cos(ang) * speed;
      e.vy = Math.sin(ang) * speed;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.rot = ang;
    }
  },
};

const orbiter: EnemyArchetype = {
  kind: 'orbiter',
  name: 'Satellite',
  radius: 3,
  hp: 9,
  value: 20,
  heavy: false,
  hue: 'cyan',
  // a: centre x, b: centre y (descends), c: angular speed, d: angle; state 0 = entering radius
  update(e, w, dt) {
    e.b -= (e.b > 20 ? 16 : 5) * dt;
    e.d += e.c * dt;
    const r = Math.min(12, e.age * 10);
    e.x = e.a + Math.cos(e.d) * r;
    e.y = e.b + Math.sin(e.d) * r;
    e.rot = e.d + Math.PI / 2;
    e.fireT -= dt * w.diff.fireRate;
    if (e.fireT <= 0) {
      e.fireT = 2.3;
      if (canFire(e)) {
        for (let i = 0; i < 3; i++) {
          aimed(w, e.x, e.y, (34 + i * 7) * w.diff.bulletSpeed, 1, 0, { hue: 'cyan', style: 'needle' });
        }
      }
    }
  },
};

const carrier: EnemyArchetype = {
  kind: 'carrier',
  name: 'Carrier',
  radius: 7.5,
  hp: 70,
  value: 90,
  heavy: true,
  hue: 'gold',
  // a: base x, state 0 enter, 1 strafe, 2 leave; c: launch timer
  update(e, w, dt) {
    e.rot = -Math.PI / 2;
    if (e.state === 0) {
      e.y -= 14 * dt;
      if (e.y < 44) e.state = 1;
      return;
    }
    e.stateT += dt;
    if (e.state === 1) {
      e.x = e.a + Math.sin(e.stateT * 0.6) * 18;
      e.x = clamp(e.x, -FIELD.halfW + 10, FIELD.halfW - 10);
      e.fireT -= dt * w.diff.fireRate;
      if (e.fireT <= 0) {
        e.fireT = 2.6;
        fan(w, e.x, e.y - 4, -Math.PI / 2, 15, 2.4, 22 * w.diff.bulletSpeed, {
          hue: 'gold',
          style: 'bigOrb',
          radius: 1.9,
          accel: 10,
          maxSpeed: 44 * w.diff.bulletSpeed,
        });
      }
      e.c -= dt;
      if (e.c <= 0) {
        e.c = 4.5;
        for (const side of [-1, 1]) {
          w.spawnEnemy('dart', e.x + side * 6, e.y - 3, { a: side * 16, b: 38, c: 0.9 });
        }
      }
      if (e.stateT > 13) e.state = 2;
    } else {
      e.y += 10 * dt;
    }
  },
};

const mine: EnemyArchetype = {
  kind: 'mine',
  name: 'Mine',
  radius: 2.8,
  hp: 5,
  value: 8,
  heavy: false,
  hue: 'lime',
  // a: drift x speed, b: descent speed
  update(e, _w, dt) {
    e.x += e.a * dt;
    e.y -= e.b * dt;
    e.rot += dt * 2;
  },
};

/** Mines burst into a ring when destroyed — killing them close is dangerous. */
export function onEnemyDeath(e: Enemy, w: World): void {
  if (e.kind === 'mine') {
    ring(w, e.x, e.y, 10, 26 * w.diff.bulletSpeed, e.age, { hue: 'lime', style: 'bigOrb', radius: 1.6 });
  }
}

const boss: EnemyArchetype = {
  kind: 'boss',
  name: 'Leviathan',
  radius: 11,
  hp: 300,
  value: 400,
  heavy: true,
  hue: 'red',
  update: updateBoss,
};

export const ARCHETYPES: Record<EnemyKind, EnemyArchetype> = {
  dart,
  weaver,
  turret,
  diver,
  orbiter,
  carrier,
  mine,
  boss,
};

export const ENEMY_KINDS = Object.keys(ARCHETYPES) as EnemyKind[];
