import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { BESIDE, placeBeside, type Side } from '../place';

/** What is being hovered: the screen's own target value and the element to anchor to. */
export interface HoverAt<T> {
  target: T;
  key: string;
  el: HTMLElement;
  sides: readonly Side[];
}

/** Event props that make an element show its detail on hover (mouse) and keyboard focus. */
export interface HoverBind {
  onPointerEnter(e: PointerEvent): void;
  onPointerLeave(e: PointerEvent): void;
  onFocus(e: FocusEvent): void;
  onBlur(e: FocusEvent): void;
}

/** Keyboard focus only: a tap or click also focuses a button, and touch has its own tap-to-read. */
function focusVisible(el: HTMLElement): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * Hover state for a screen's items. `bind(target, key)` goes on each item; the screen renders
 * `<HoverDetail at={at}>` with the detail of `at.target`. Touch never opens it (tap selects, as
 * before); scrolling or resizing closes it, since the anchor moves.
 */
export function useHover<T>() {
  const [at, setAt] = useState<HoverAt<T> | null>(null);
  useEffect(() => {
    if (!at) return;
    const hide = () => setAt(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [at]);

  const leave = (key: string) => setAt((cur) => (cur?.key === key ? null : cur));
  const bind = (target: T, key: string, sides: readonly Side[] = BESIDE): HoverBind => ({
    onPointerEnter(e) {
      if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
      setAt({ target, key, el: e.currentTarget as HTMLElement, sides });
    },
    onPointerLeave: () => leave(key),
    onFocus(e) {
      const el = e.currentTarget as HTMLElement;
      if (focusVisible(el)) setAt({ target, key, el, sides });
    },
    onBlur: () => leave(key),
  });
  return { at, bind, hide: () => setAt(null) };
}

/**
 * The hovered item's detail, floating beside it. Pointer-transparent, so it never steals the
 * hover (no flicker when it overlaps a neighbour). Render it at the screen's root: a transformed
 * or clipped ancestor would trap or cut a fixed box.
 */
export function HoverDetail<T>({ at, children }: { at: HoverAt<T> | null; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box || !at) return;
    const doc = document.documentElement;
    const p = placeBeside(
      at.el.getBoundingClientRect(),
      { w: box.offsetWidth, h: box.offsetHeight },
      { w: doc.clientWidth, h: doc.clientHeight },
      at.sides,
    );
    box.style.left = `${Math.round(p.x)}px`;
    box.style.top = `${Math.round(p.y)}px`;
    box.dataset.side = p.side;
  });
  if (!at || !children || !at.el.isConnected) return null;
  return (
    <div class="hover-detail" ref={ref} role="tooltip">
      {children}
    </div>
  );
}
