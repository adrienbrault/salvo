import { CORE_ITEMS, ENGINE_ITEMS, WEAPON_ITEMS } from './equipment';
import { RELIC_ITEMS } from './relics';
import type { ItemDef, ItemInstance } from './types';
import { CALIBRATION_ITEMS, MODULE_ITEMS } from './upgrades';

export const ALL_ITEMS: readonly ItemDef[] = [
  ...WEAPON_ITEMS,
  ...ENGINE_ITEMS,
  ...CORE_ITEMS,
  ...RELIC_ITEMS,
  ...CALIBRATION_ITEMS,
  ...MODULE_ITEMS,
];

const BY_ID = new Map<string, ItemDef>(ALL_ITEMS.map((d) => [d.id, d]));

export function getItem(id: string): ItemDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown item id: ${id}`);
  return def;
}

export const hasItem = (id: string): boolean => BY_ID.has(id);

export const RELICS = RELIC_ITEMS;
export const EQUIPMENT: readonly ItemDef[] = [...WEAPON_ITEMS, ...ENGINE_ITEMS, ...CORE_ITEMS];

/**
 * The def whose effects apply for relic `slot`. Blueprint copies the next relic to its
 * right, following chains of Blueprints. Returns null when nothing valid can be copied.
 */
export function resolveRelicDef(relics: readonly ItemInstance[], slot: number): ItemDef | null {
  let j = slot;
  let def = getItem(relics[j]!.id);
  while (def.id === 'blueprint') {
    j++;
    const next = relics[j];
    if (!next) return null;
    def = getItem(next.id);
    if (def.noCopy && def.id !== 'blueprint') return null;
  }
  return def;
}
