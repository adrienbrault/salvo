import type { JSX } from 'preact';
import { type ItemDef, KIND_LABEL } from '../../content/types';
import type { HoverBind } from './HoverDetail';

interface Props {
  def: ItemDef;
  /** Shows a price tag. */
  price?: number;
  selected?: boolean;
  /** Greyed out (e.g. unaffordable) but still selectable. */
  dim?: boolean;
  /** Increment to replay the "no" shake. */
  shake?: number;
  /** Pop-in delay, ms (stagger). */
  delay?: number;
  /** Shows the item's detail on hover (see useHover). */
  hover?: HoverBind;
  onSelect?: () => void;
}

const TILT = 14;

/** Tilt toward the mouse (desktop only: touch has no hover). */
function tilt(e: JSX.TargetedPointerEvent<HTMLButtonElement>): void {
  if (e.pointerType !== 'mouse') return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  el.style.setProperty('--rx', `${(-y * TILT).toFixed(2)}deg`);
  el.style.setProperty('--ry', `${(x * TILT).toFixed(2)}deg`);
  el.style.setProperty('--gx', `${Math.round((x + 0.5) * 100)}%`);
}

function untilt(e: JSX.TargetedPointerEvent<HTMLButtonElement>): void {
  const el = e.currentTarget;
  el.style.removeProperty('--rx');
  el.style.removeProperty('--ry');
  el.style.removeProperty('--gx');
}

/** Balatro-style item card: glyph, name, rarity frame, optional price tag. */
export function ItemCard({ def, price, selected, dim, shake = 0, delay = 0, hover, onSelect }: Props) {
  const cls = ['card', `r-${def.rarity}`, `k-${def.kind}`];
  if (selected) cls.push('selected');
  if (dim) cls.push('dim');
  return (
    <button
      type="button"
      class={cls.join(' ')}
      style={{ '--c': def.color, '--delay': `${delay}ms` }}
      aria-pressed={selected}
      aria-label={price === undefined ? def.name : `${def.name}, $${price}`}
      onPointerEnter={hover?.onPointerEnter}
      onPointerMove={tilt}
      onPointerLeave={(e) => {
        untilt(e);
        hover?.onPointerLeave(e);
      }}
      onFocus={hover?.onFocus}
      onBlur={hover?.onBlur}
      onClick={onSelect}
    >
      <span class={shake ? 'card-face no' : 'card-face'} key={shake}>
        <span class="card-kind">{KIND_LABEL[def.kind]}</span>
        <span class="card-glyph">{def.glyph}</span>
        <span class="card-name">{def.name}</span>
      </span>
      {price !== undefined && <span class="price-tag">${price}</span>}
    </button>
  );
}

/** Empty spot left by a bought offer. */
export function SoldCard() {
  return (
    <div class="card card-sold">
      <span>Sold</span>
    </div>
  );
}
