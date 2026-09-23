import { createRun, currentSpec, levelRng } from '../run/run';
import type { RunState } from '../run/state';
import { DT } from '../sim/constants';
import type { InputFrame } from '../sim/types';
import { World } from '../sim/world';

/**
 * Scripted headless player used by tests and balance checks. It sways at the bottom of the
 * field and uses its action rhythmically — crude, but deterministic and weapon-agnostic.
 */
export function botInput(w: World, tick: number): InputFrame {
  const t = tick * DT;
  const weapon = w.weapon.id;
  let action = false;
  if (weapon === 'mirror') action = t % 2.2 < 1.4;
  else if (weapon === 'ram') action = tick % 50 === 0;
  else if (weapon === 'grazer') action = w.player.charge > 0.7 && tick % 10 === 0;
  else action = tick % 90 === 0;
  // Aim roughly under the lowest enemy, sway otherwise.
  let tx = Math.sin(t * 0.9) * 30;
  let lowest = Number.POSITIVE_INFINITY;
  for (const e of w.enemies.items) {
    if (!e.dead && e.y < lowest && e.y > w.player.y + 10) {
      lowest = e.y;
      tx = e.x;
    }
  }
  const ty = weapon === 'ram' ? -40 + Math.sin(t * 1.3) * 25 : -55;
  return { hasTarget: true, tx, ty, dx: 0, dy: 0, precise: false, action };
}

export interface BotOptions {
  /** Never lose HP (measure scoring potential only). */
  godMode?: boolean;
  maxSeconds?: number;
}

/** Runs the run's current level to completion with the bot. */
export function playLevel(run: RunState, opts: BotOptions = {}): World {
  const w = new World(run, currentSpec(run), levelRng(run));
  const maxTicks = Math.ceil((opts.maxSeconds ?? w.spec.duration + 10) / DT);
  for (let tick = 0; tick < maxTicks && w.phase !== 'done'; tick++) {
    if (opts.godMode) w.player.invuln = 1;
    w.step(botInput(w, tick), DT);
    w.fx.length = 0;
  }
  return w;
}

export function freshRun(chassis: string, seed = 'TESTSEED'): RunState {
  return createRun(seed, chassis);
}
