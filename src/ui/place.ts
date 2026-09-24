/** Placement of a floating box (the hover detail) beside an anchor, inside the viewport. */

export type Side = 'right' | 'left' | 'top' | 'bottom';

/** Beside first (cards are tall), then below or above. */
export const BESIDE: readonly Side[] = ['right', 'left', 'bottom', 'top'];
/** Above first (small tiles low on the screen), then below or beside. */
export const ABOVE: readonly Side[] = ['top', 'bottom', 'right', 'left'];

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Placed {
  x: number;
  y: number;
  side: Side;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Where a `box`-sized popover goes next to `a`: on the first side of `order` with room for
 * it (else the roomiest), centred on the anchor along that side and clamped `margin` inside
 * the `view`. It never overlaps the anchor unless no side has room.
 */
export function placeBeside(
  a: Rect,
  box: Size,
  view: Size,
  order: readonly Side[],
  gap = 10,
  margin = 8,
): Placed {
  const room: Record<Side, number> = {
    right: view.w - margin - (a.right + gap) - box.w,
    left: a.left - gap - margin - box.w,
    bottom: view.h - margin - (a.bottom + gap) - box.h,
    top: a.top - gap - margin - box.h,
  };
  let side = order.find((s) => room[s] >= 0);
  if (!side) side = order.reduce((best, s) => (room[s] > room[best] ? s : best), order[0] ?? 'right');

  const maxX = Math.max(margin, view.w - margin - box.w);
  const maxY = Math.max(margin, view.h - margin - box.h);
  const cx = clamp((a.left + a.right) / 2 - box.w / 2, margin, maxX);
  const cy = clamp((a.top + a.bottom) / 2 - box.h / 2, margin, maxY);
  switch (side) {
    case 'right':
      return { x: clamp(a.right + gap, margin, maxX), y: cy, side };
    case 'left':
      return { x: clamp(a.left - gap - box.w, margin, maxX), y: cy, side };
    case 'bottom':
      return { x: cx, y: clamp(a.bottom + gap, margin, maxY), side };
    case 'top':
      return { x: cx, y: clamp(a.top - gap - box.h, margin, maxY), side };
  }
}
