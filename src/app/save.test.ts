import { describe, expect, test } from 'bun:test';
import { createRun } from '../run/run';
import { newInstance } from '../run/state';
import { clearRun, isValidRun, type KeyValueStore, loadRun, loadSettings, saveRun } from './save';

const memStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

describe('save', () => {
  test('a run round-trips through storage', () => {
    const store = memStore();
    const run = createRun('SAVE', 'prisme');
    run.loadout.relics.push(newInstance(run, 'veteran', 6));
    run.loadout.relics[0]!.state.bonus = 4;
    saveRun(store, run);
    expect(loadRun(store)).toEqual(run);
    clearRun(store);
    expect(loadRun(store)).toBeNull();
  });

  test('corrupted or stale saves are rejected', () => {
    const store = memStore();
    store.setItem('salvo.run.v1', '{not json');
    expect(loadRun(store)).toBeNull();
    const run = createRun('SAVE', 'faucon');
    run.loadout.relics.push({ uid: 99, id: 'removed_relic', state: {}, paid: 4 });
    expect(isValidRun(run)).toBe(false);
  });

  test('settings merge over defaults', () => {
    const store = memStore();
    store.setItem('salvo.settings.v1', JSON.stringify({ volume: 0.2 }));
    const s = loadSettings(store);
    expect(s.volume).toBe(0.2);
    expect(s.quality).toBe('auto');
  });

  test('missing storage is harmless', () => {
    expect(loadRun(null)).toBeNull();
    expect(() => saveRun(null, createRun('X', 'faucon'))).not.toThrow();
  });
});
