import { hasItem } from '../content/registry';
import type { RunState } from '../run/state';
import { defaultSettings, type Settings } from '../ui/store';

/** Minimal Storage surface (localStorage in the browser, a Map in tests). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const RUN_KEY = 'salvo.run.v1';
const SETTINGS_KEY = 'salvo.settings.v1';
const RECORDS_KEY = 'salvo.records.v1';

export interface Records {
  runs: number;
  wins: number;
  bestSector: number;
  bestLevelScore: number;
  bestKill: number;
}

const emptyRecords = (): Records => ({ runs: 0, wins: 0, bestSector: 0, bestLevelScore: 0, bestKill: 0 });

export function browserStore(): KeyValueStore | null {
  try {
    const s = globalThis.localStorage;
    s.setItem('salvo.probe', '1');
    s.removeItem('salvo.probe');
    return s;
  } catch {
    return null;
  }
}

function readJson<T>(store: KeyValueStore | null, key: string): T | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(store: KeyValueStore | null, key: string, value: unknown): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Quota / private mode: saving is best-effort.
  }
}

/** Structural validation: a stale or tampered save must never crash the game. */
export function isValidRun(r: unknown): r is RunState {
  if (!r || typeof r !== 'object') return false;
  const run = r as RunState;
  if (run.v !== 1 || typeof run.seed !== 'string' || typeof run.money !== 'number') return false;
  const lo = run.loadout;
  if (!lo || !Array.isArray(lo.relics)) return false;
  const insts = [lo.weapon, lo.engine, lo.core, ...lo.relics];
  if (insts.some((i) => !i || typeof i.id !== 'string' || !hasItem(i.id))) return false;
  const offers = run.shop ? [...run.shop.offers, ...run.shop.workshop] : [];
  if (offers.some((o) => o.id !== null && !hasItem(o.id))) return false;
  return typeof run.sector === 'number' && typeof run.level === 'number' && typeof run.hp === 'number';
}

export const saveRun = (store: KeyValueStore | null, run: RunState): void => writeJson(store, RUN_KEY, run);

export function loadRun(store: KeyValueStore | null): RunState | null {
  const r = readJson<unknown>(store, RUN_KEY);
  return isValidRun(r) ? r : null;
}

export const clearRun = (store: KeyValueStore | null): void => {
  try {
    store?.removeItem(RUN_KEY);
  } catch {
    // ignore
  }
};

export function loadSettings(store: KeyValueStore | null): Settings {
  return { ...defaultSettings(), ...(readJson<Partial<Settings>>(store, SETTINGS_KEY) ?? {}) };
}

export const saveSettings = (store: KeyValueStore | null, s: Settings): void =>
  writeJson(store, SETTINGS_KEY, s);

export function loadRecords(store: KeyValueStore | null): Records {
  return { ...emptyRecords(), ...(readJson<Partial<Records>>(store, RECORDS_KEY) ?? {}) };
}

export const saveRecords = (store: KeyValueStore | null, r: Records): void =>
  writeJson(store, RECORDS_KEY, r);
