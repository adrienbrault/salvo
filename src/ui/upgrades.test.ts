import { describe, expect, test } from 'bun:test';
import { getItem } from '../content/registry';
import { createRun } from '../run/run';
import { buy } from '../run/shop';
import type { RunState } from '../run/state';
import { ownedUpgrades, purchaseMessage, upgradeNote } from './upgrades';

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
      'Impact calibrated to level 1',
      'Impact calibrated to level 2',
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

  test('a calibration note gives its level and whether the weapon scores that kill type', () => {
    const run = shopWith(['cal_impact']);
    expect(upgradeNote(run, getItem('cal_impact'))).toBe(
      '{k:Impact} level: 0. Your Blaster scores Shot kills, not Impact kills.',
    );
    buyAll(run);
    expect(upgradeNote(run, getItem('cal_impact'))).toBe(
      '{k:Impact} level 1: {b:+15 Shards} and {m:+1 Mult} on each Impact kill. Your Blaster scores Shot kills, not Impact kills.',
    );
    expect(upgradeNote(run, getItem('cal_tir'))).toBe('{k:Shot} level: 0. Your Blaster scores Shot kills.');
  });
});
