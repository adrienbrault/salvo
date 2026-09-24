import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { fmt } from '../format';

interface Props {
  value: number;
  /** Value shown on mount, rolling toward `value` (defaults to `value`: no initial roll). */
  from?: number;
  format?: (n: number) => string;
  /** Roll duration in seconds. */
  duration?: number;
  /** Delay before the first roll, in seconds. */
  delay?: number;
  /** Scale punch when the value goes up. */
  punch?: boolean;
  class?: string;
}

/**
 * Rolling number. Text is written imperatively (no re-render per frame), so parents can
 * re-render at HUD rate without fighting the animation.
 */
export function Counter({ value, from, format = fmt, duration = 0.45, delay = 0, punch, class: cls }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const s = useRef({ shown: from ?? value, from: from ?? value, to: from ?? value, t0: 0, raf: 0 });

  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = format(s.current.shown);
  }, [format]);

  useEffect(() => {
    const st = s.current;
    if (value === st.to) return;
    const up = value > st.to;
    st.from = st.shown;
    st.to = value;
    st.t0 = performance.now() + delay * 1000;
    cancelAnimationFrame(st.raf);
    const step = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - st.t0) / (duration * 1000)));
      const e = 1 - (1 - k) ** 3;
      st.shown = k >= 1 ? st.to : st.from + (st.to - st.from) * e;
      const el = ref.current;
      if (el) el.textContent = format(st.shown);
      if (k < 1) st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
    if (punch && up) {
      ref.current?.animate(
        [
          { transform: 'scale(1.18)', filter: 'brightness(1.6)' },
          { transform: 'scale(1)', filter: 'none' },
        ],
        { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
  }, [value, delay, duration, format, punch]);

  useEffect(() => () => cancelAnimationFrame(s.current.raf), []);

  return <span ref={ref} class={cls ? `counter ${cls}` : 'counter'} />;
}
