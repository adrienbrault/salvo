import type { ComponentChildren } from 'preact';
import { resolveRelicDef } from '../../content/registry';
import { describe, type ItemDef, type ItemInstance, KIND_LABEL, RARITY_LABEL } from '../../content/types';
import { Rich } from './Rich';

/** What a Blueprint in `slot` currently copies (null for any other relic). */
export function copyNote(relics: readonly ItemInstance[], slot: number): string | null {
  if (relics[slot]?.id !== 'blueprint') return null;
  const target = resolveRelicDef(relics, slot);
  return target ? `Currently copies: ${target.name}.` : 'Nothing to copy: put a relic to its right.';
}

interface Props {
  def: ItemDef;
  inst?: ItemInstance;
  /** Extra line under the description (e.g. what a Blueprint copies). */
  note?: ComponentChildren;
  /** Small print at the bottom (price, sell value), for the hover detail that has no buttons. */
  foot?: ComponentChildren;
  /** Action buttons. */
  children?: ComponentChildren;
  onClose?: () => void;
}

/** Full description of an item: the shop panel (with actions), hover details, build overview. */
export function ItemDetail({ def, inst, note, foot, children, onClose }: Props) {
  return (
    <div class={`detail r-${def.rarity}`} style={{ '--c': def.color }}>
      <div class="detail-head">
        <span class="detail-glyph">{def.glyph}</span>
        <div class="detail-title">
          <h3>{def.name}</h3>
          <p class="detail-meta">
            <span>{KIND_LABEL[def.kind]}</span>
            <span class="rarity">{RARITY_LABEL[def.rarity]}</span>
          </p>
        </div>
        {onClose && (
          <button type="button" class="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        )}
      </div>
      <p class="detail-desc">
        <Rich text={describe(def, inst)} />
      </p>
      {note && <p class="detail-note">{note}</p>}
      {def.flavor && <p class="detail-flavor">{def.flavor}</p>}
      {foot && <p class="detail-foot">{foot}</p>}
      {children && <div class="detail-actions">{children}</div>}
    </div>
  );
}
