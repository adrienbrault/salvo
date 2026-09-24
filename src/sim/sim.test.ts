import { describe, expect, test } from 'bun:test';
import { CHASSIS } from '../content/chassis';
import { RELICS } from '../content/registry';
import { currentSpec, levelRng } from '../run/run';
import { newInstance } from '../run/state';
import { freshRun, playLevel } from '../test/bot';
import { DT } from './constants';
import { Rng } from './rng';
import { computeStats } from './stats';
import { emptyInput, type ScoreCalc } from './types';
import { World } from './world';

describe('Rng', () => {
  test('same seed, same sequence', () => {
    const a = new Rng('ABC');
    const b = new Rng('ABC');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  test('forks are independent of parent consumption', () => {
    const a = new Rng('ABC');
    const b = new Rng('ABC');
    for (let i = 0; i < 17; i++) b.next();
    expect(a.fork('x').next()).toBe(b.fork('x').next());
    expect(a.fork('x').next()).not.toBe(a.fork('y').next());
  });

  test('int stays in range', () => {
    const r = new Rng('range');
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});

describe('World', () => {
  test('each chassis plays a full level without throwing', () => {
    for (const ch of CHASSIS) {
      const run = freshRun(ch.id);
      const w = playLevel(run, { godMode: true });
      expect(w.phase).toBe('done');
      expect(w.tally.kills).toBeGreaterThan(5);
      expect(Number.isFinite(w.score)).toBe(true);
    }
  });

  test('a level is deterministic for a seed and input sequence', () => {
    const a = playLevel(freshRun('faucon', 'DET'), { godMode: true });
    const b = playLevel(freshRun('faucon', 'DET'), { godMode: true });
    expect(a.score).toBe(b.score);
    expect(a.tally.kills).toBe(b.tally.kills);
    expect(a.time).toBe(b.time);
  });

  test('reaching the quota wins and clears the screen', () => {
    const run = freshRun('faucon');
    const w = playLevel(run, { godMode: true });
    expect(w.result).toBe('won');
    expect(w.score).toBeGreaterThanOrEqual(w.spec.quota);
    expect(w.enemies.size).toBe(0);
  });

  test('doing nothing times out', () => {
    const run = freshRun('luciole');
    const w = new World(run, currentSpec(run), levelRng(run));
    for (let i = 0; i < (w.spec.duration + 10) / DT && w.phase !== 'done'; i++) {
      w.player.invuln = 1;
      w.step(emptyInput(), DT);
    }
    expect(w.result).toBe('lost');
    expect(w.lostReason).toBe('time');
  });

  test('getting hit costs HP and halves the gauge bonus', () => {
    const run = freshRun('faucon');
    const w = new World(run, currentSpec(run), levelRng(run));
    w.gauge = 3;
    const hp = w.player.hp;
    w.hurtPlayer();
    expect(w.player.hp).toBe(hp - 1);
    expect(w.gauge).toBeCloseTo(2);
  });
});

describe('Scoring & relics', () => {
  /** Kill one fresh enemy with the given relic ids and return the score delta. */
  function scoreOneKill(relicIds: string[], base = 10): { total: number; calc: ScoreCalc } {
    const run = freshRun('faucon');
    for (const id of relicIds) run.loadout.relics.push(newInstance(run, id, 4));
    const w = new World(run, currentSpec(run), levelRng(run));
    w.step(emptyInput(), DT);
    w.phase = 'play';
    const e = w.spawnEnemy('dart', 0, 40);
    e.value = base;
    const before = w.score;
    w.damageEnemy(e, 999, 'tir');
    const ev = w.fx.find((f) => f.t === 'score');
    if (ev?.t !== 'score') throw new Error('no score event');
    return { total: w.score - before, calc: { base: ev.base, mult: ev.mult, repeats: ev.repeats } };
  }

  test('base formula is shards × gauge', () => {
    expect(scoreOneKill([]).total).toBe(10);
  });

  test('relic order matters: +Mult then ×Mult vs ×Mult then +Mult', () => {
    const plusThenTimes = scoreOneKill(['mult_flat', 'glass']).total; // (1+3)×2.5 = 10 → 100
    const timesThenPlus = scoreOneKill(['glass', 'mult_flat']).total; // 1×2.5+3 = 5.5 → 55
    expect(plusThenTimes).toBe(100);
    expect(timesThenPlus).toBe(55);
  });

  test('Blueprint copies the relic to its right', () => {
    expect(scoreOneKill(['blueprint', 'mult_flat']).total).toBe(70); // 1+3+3
    expect(scoreOneKill(['mult_flat', 'blueprint']).total).toBe(40); // nothing to copy
  });

  test('Glass Heart sets max HP to 1', () => {
    const run = freshRun('prisme');
    run.loadout.relics.push(newInstance(run, 'glass', 9));
    expect(computeStats(run).maxHp).toBe(1);
  });

  test('Ritual Dagger eats its right neighbour at level start', () => {
    const run = freshRun('faucon');
    run.loadout.relics.push(newInstance(run, 'dagger', 7), newInstance(run, 'mult_flat', 4));
    new World(run, currentSpec(run), levelRng(run));
    expect(run.loadout.relics.map((r) => r.id)).toEqual(['dagger']);
    expect(run.loadout.relics[0]!.state.bonus).toBe(4);
  });

  test('every relic survives a full level with the bot', () => {
    for (const def of RELICS) {
      const run = freshRun('faucon', `R-${def.id}`);
      run.loadout.relics.push(newInstance(run, def.id, def.price));
      const w = playLevel(run, { godMode: true });
      expect(w.phase).toBe('done');
    }
  });
});
