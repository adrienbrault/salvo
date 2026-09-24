import { describe, expect, test } from 'bun:test';
import { getItem } from '../content/registry';
import { createRun } from '../run/run';
import { buy } from '../run/shop';
import type { RunState } from '../run/state';
import { killTypeFit, ownedUpgrades, purchaseMessage, upgradeNote } from './upgrades';

/** A Falcon run with money and a shop holding exactly `ids`. */
function shopWith(ids: string[]): RunState {
  const run = createRun('UPGRADES', 'faucon');
  run.money = 100;
  run.hp = 1;
  run.shop = { offers: [], workshop: ids.map((id) => ({ id, price: getItem(id).price })), rerolls: 0 };
  return run;
}

/** Buys every workshop item in order and returns the toasts. */
function buyAll(run: RunState): string[] {
  return run.shop!.workshop.map((o, i) => {
    const def = getItem(o.id!);
    const res = buy(run, 'workshop', i);
    expect(res.ok).toBe(true);
    return purchaseMessage(run, def, res);
  });
}

describe('purchase feedback', () => {
  test('every purchase says what it did', () => {
    const run = shopWith(['cal_impact', 'cal_impact', 'mod_damage', 'mod_rate', 'mod_hull', 'repair']);
    run.shop!.offers = [
      { id: 'magnet', price: 6 },
      { id: 'w_ram', price: 7 },
    ];
    expect(buyAll(run)).toEqual([
      'Impact calibrated to level 1, but your Blaster doesn’t make Impact kills: pays off with the Ram (Bull)',
      'Impact calibrated to level 2, but your Blaster doesn’t make Impact kills: pays off with the Ram (Bull)',
      'Power Module installed: damage +20% in total',
      'Rate Module installed: rates +15% in total',
      'Hull Plating installed: max HP 4, hull 2/4',
      'Hull repaired: 3/4 HP',
    ]);
    const relic = buy(run, 'offers', 0);
    expect(purchaseMessage(run, getItem('magnet'), relic)).toBe('Magnet joins your relics in slot 1');
    const ram = buy(run, 'offers', 1);
    expect(purchaseMessage(run, getItem('w_ram'), ram)).toBe('Ram equipped; Blaster sold back for $3');
  });

  test('upgrades stay visible after the purchase', () => {
    const run = shopWith(['cal_impact', 'cal_tir', 'cal_tir', 'mod_damage', 'mod_hull']);
    expect(ownedUpgrades(run)).toEqual([]);
    buyAll(run);
    expect(ownedUpgrades(run)).toEqual([
      { id: 'cal_tir', label: 'Shot', value: 'Lv 2' },
      { id: 'cal_impact', label: 'Impact', value: 'Lv 1' },
      { id: 'mod_damage', label: 'Damage', value: '+20%' },
      { id: 'mod_hull', label: 'Max HP', value: '+1' },
    ]);
  });

  test('a calibration note gives its level', () => {
    const run = shopWith(['cal_impact']);
    expect(upgradeNote(run, getItem('cal_impact'))).toBe('{k:Impact} level: 0.');
    buyAll(run);
    expect(upgradeNote(run, getItem('cal_impact'))).toBe(
      '{k:Impact} level 1: {b:+15 Shards} and {m:+1 Mult} on each Impact kill.',
    );
  });

  test('a calibration says whether the ship makes its kill type, and what would', () => {
    const run = shopWith(['cal_tir', 'w_ram']);
    expect(killTypeFit(run, 'tir')).toEqual({
      fits: true,
      source: 'Blaster',
      text: 'Your Blaster makes Shot kills.',
    });
    expect(killTypeFit(run, 'impact').text).toBe(
      'Your Blaster doesn’t make Impact kills: pays off with the Ram (Bull).',
    );
    expect(killTypeFit(run, 'onde').text).toBe(
      'Your Blaster doesn’t make Wave kills: pays off with the Grazer (Firefly).',
    );
    expect(killTypeFit(run, 'reaction')).toEqual({
      fits: false,
      source: 'Blaster',
      text: 'Your Blaster doesn’t make Reaction kills.',
    });
    expect(buyAll(run)[0]).toBe('Shot calibrated to level 1 for your Blaster');
    run.loadout.relics.push({ uid: 99, id: 'chain', state: {}, paid: 7 });
    expect(killTypeFit(run, 'reaction').text).toBe('Your Chain Reaction makes Reaction kills.');
  });
});
