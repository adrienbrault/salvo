import type { LevelKind, LevelSpec } from '../sim/level';
import type { RunState } from './state';

/**
 * Balance tables. Quotas grow faster than raw kill output on purpose: the build (relics,
 * calibrations) must scale the Mult, exactly like Balatro blinds.
 */
export const QUOTA_BASE = [600, 1800, 4500, 10000] as const;
/** Growth per sector beyond the table (endless). */
export const QUOTA_ENDLESS_GROWTH = 2.6;
export const KIND_MUL: Record<LevelKind, number> = { small: 1, big: 1.5, boss: 1.8 };
export const DURATION: Record<LevelKind, number> = { small: 40, big: 45, boss: 60 };
export const REWARD: Record<LevelKind, number> = { small: 3, big: 4, boss: 5 };
export const KIND_NAME: Record<LevelKind, string> = {
  small: 'Patrouille',
  big: 'Offensive',
  boss: 'Léviathan',
};

export const SECTOR_NAMES = ['Orbite basse', 'Ceinture de débris', 'Nébuleuse rouge', 'Le Noyau'] as const;

export const sectorName = (s: number): string => SECTOR_NAMES[s] ?? `Abîme ${s - SECTOR_NAMES.length + 1}`;

const KINDS: LevelKind[] = ['small', 'big', 'boss'];

export function quotaBase(sector: number): number {
  const table = QUOTA_BASE as readonly number[];
  if (sector < table.length) return table[sector]!;
  const last = table[table.length - 1]!;
  return Math.round(last * QUOTA_ENDLESS_GROWTH ** (sector - table.length + 1));
}

export function levelSpecFor(run: RunState, sector = run.sector, index = run.level): LevelSpec {
  const kind = KINDS[index] ?? 'small';
  return {
    sector,
    index,
    kind,
    name: KIND_NAME[kind],
    quota: roundQuota(quotaBase(sector) * KIND_MUL[kind]),
    duration: DURATION[kind],
    reward: REWARD[kind],
    constraint: kind === 'boss' ? (run.constraints[sector] ?? null) : null,
  };
}

/** Round to 2 significant digits so quotas read cleanly (1 234 → 1 200). */
function roundQuota(q: number): number {
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(q)) - 1);
  return Math.round(q / mag) * mag;
}
