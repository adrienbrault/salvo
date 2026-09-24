import { describe, expect, test } from 'bun:test';
import { freshRun, playLevel } from '../test/bot';
import { applyLevelResult, computeReward, createRun } from './run';
import { buy, canBuy, moveRelic, reroll, rerollCost, sellRelic } from './shop';
import { newInstance, RELIC_SLOTS } from './state';

describe('run', () => {
  test('createRun is deterministic', () => {
    expect(createRun('SEED', 'faucon')).toEqual(createRun('SEED', 'faucon'));
  });

  test('clearing a level pays out and opens a shop', () => {
    const run = freshRun('faucon');
    const w = playLevel(run, { godMode: true });
    const before = run.money;
    const report = applyLevelResult(run, w);
    expect(report.won).toBe(true);
    expect(report.outcome).toBe('shop');
    expect(run.money).toBe(before + report.reward!.total);
    expect(run.level).toBe(1);
    expect(run.shop?.offers.length).toBe(3);
  });

  test('interest is capped', () => {
    const run = freshRun('faucon');
    run.money = 100;
    expect(computeReward(run, 0, 3).interest).toBe(5);
    run.loadout.relics.push(newInstance(run, 'saver', 6));
    expect(computeReward(run, 0, 3).interest).toBe(10);
  });

  test('losing ends the run', () => {
    const run = freshRun('faucon');
    const w = playLevel(run, { maxSeconds: 0.1 });
    w.result = 'lost';
    w.lostReason = 'death';
    expect(applyLevelResult(run, w).outcome).toBe('runLost');
  });
});

describe('shop', () => {
  function shopRun() {
    const run = freshRun('faucon', 'SHOP');
    const w = playLevel(run, { godMode: true });
    applyLevelResult(run, w);
    run.money = 50;
    return run;
  }

  test('buying a relic fills a slot and costs money', () => {
    const run = shopRun();
    const idx = 0;
    run.shop!.offers[idx] = { id: 'mult_flat', price: 4 };
    const price = run.shop!.offers[idx]!.price;
    expect(buy(run, 'offers', idx).ok).toBe(true);
    expect(run.loadout.relics.length).toBe(1);
    expect(run.money).toBe(50 - price);
    expect(canBuy(run, run.shop!.offers[idx]!)).toBe('sold');
  });

  test('relic slots are limited', () => {
    const run = shopRun();
    for (let i = 0; i < RELIC_SLOTS; i++) run.loadout.relics.push(newInstance(run, 'mult_flat', 4));
    run.shop!.offers[0] = { id: 'base_flat', price: 4 };
    expect(buy(run, 'offers', 0).error).toBe('slots');
  });

  test('equipment replaces the current piece and refunds it', () => {
    const run = shopRun();
    run.shop!.offers[0] = { id: 'w_ram', price: 7 };
    const res = buy(run, 'offers', 0);
    expect(res.ok).toBe(true);
    expect(run.loadout.weapon.id).toBe('w_ram');
    expect(res.refund).toBe(3);
    expect(run.money).toBe(50 - 7 + 3);
  });

  test('reroll costs escalate and change offers', () => {
    const run = shopRun();
    const c0 = rerollCost(run);
    expect(reroll(run)).toBe(true);
    expect(rerollCost(run)).toBe(c0 + 1);
  });

  test('sell and reorder relics', () => {
    const run = shopRun();
    run.loadout.relics.push(newInstance(run, 'mult_flat', 4), newInstance(run, 'glass', 9));
    moveRelic(run, 1, 0);
    expect(run.loadout.relics.map((r) => r.id)).toEqual(['glass', 'mult_flat']);
    const m = run.money;
    expect(sellRelic(run, 0)).toBe(4);
    expect(run.money).toBe(m + 4);
  });
});
