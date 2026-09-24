import { aimed, ring, spiral } from './patterns';
import type { Enemy } from './types';
import type { World } from './world';

const HOLD_Y = 50;

/**
 * Leviathan — three phases keyed on HP (100–66–33 %). Each phase change cancels
 * all enemy bullets (breathing room + a satisfying flash).
 *
 * Fields: state 0 = entering / 1 = fighting; b = current phase; d = spiral angle;
 * fireT = primary emitter; c = secondary emitter.
 */
export function updateBoss(e: Enemy, w: World, dt: number): void {
  e.rot = -Math.PI / 2;
  if (e.state === 0) {
    const dy = e.y - HOLD_Y;
    e.y -= Math.max(7, dy * 1.1) * dt;
    if (dy < 0.6) {
      e.state = 1;
      e.stateT = 0;
      e.fireT = 0.6;
      e.c = 1.4;
    }
    return;
  }

  const frac = e.hp / e.maxHp;
  const phase = frac > 0.66 ? 0 : frac > 0.33 ? 1 : 2;
  if (phase !== e.b) {
    e.b = phase;
    e.fireT = 1.1;
    e.c = 1.8;
    w.cancelEnemyBullets();
    w.fx.push({ t: 'bossPhase', x: e.x, y: e.y, phase });
  }

  e.stateT += dt;
  e.x = Math.sin(e.stateT * 0.42) * 22;
  e.y = HOLD_Y + Math.sin(e.stateT * 0.84) * 6;

  const bs = w.diff.bulletSpeed;
  e.fireT -= dt * w.diff.fireRate;
  e.c -= dt * w.diff.fireRate;

  if (phase === 0) {
    if (e.fireT <= 0) {
      e.fireT = 0.12;
      e.d += 0.21;
      spiral(w, e.x, e.y - 4, 2, e.d, 27 * bs, { hue: 'red' });
    }
    if (e.c <= 0) {
      e.c = 2.2;
      aimed(w, e.x, e.y - 7, 46 * bs, 5, 0.7, { hue: 'orange', style: 'needle' });
    }
  } else if (phase === 1) {
    if (e.fireT <= 0) {
      e.fireT = 0.9;
      e.d += 0.5;
      ring(w, e.x, e.y, 20, 25 * bs, e.d, { hue: 'violet', style: 'bigOrb', radius: 1.8 });
    }
    if (e.c <= 0) {
      e.c = 1.25;
      for (const ox of [-9, 0, 9])
        aimed(w, e.x + ox, e.y - 5, 52 * bs, 1, 0, { hue: 'pink', style: 'needle' });
    }
  } else {
    if (e.fireT <= 0) {
      e.fireT = 0.1;
      e.d += 0.19;
      spiral(w, e.x, e.y, 3, e.d, 29 * bs, { hue: 'red' });
      spiral(w, e.x, e.y, 3, -e.d * 1.3, 22 * bs, { hue: 'pink', style: 'needle' });
    }
    if (e.c <= 0) {
      e.c = 3.2;
      for (const side of [-1, 1]) w.spawnEnemy('mine', e.x + side * 9, e.y - 8, { a: side * 11, b: 13 });
    }
  }
}
