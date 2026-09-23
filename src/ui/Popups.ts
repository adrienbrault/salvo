import { Vector2 } from 'three/webgpu';
import type { FxEvent } from '../sim/types';

const POOL = 28;
const _s = new Vector2();

export interface WorldToScreen {
  worldToScreen(x: number, y: number, z: number, out: Vector2): Vector2;
}

export const fmt = (n: number): string => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}G`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return Math.round(n).toLocaleString('fr-FR');
};

export const fmtMult = (m: number): string =>
  m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m.toFixed(2);

/**
 * Balatro-style floating numbers over kills: blue Éclats × red Mult, the total punching in.
 * Imperative DOM pool (no framework per frame) positioned by projecting world coordinates.
 */
export class Popups {
  private readonly layer: HTMLDivElement;
  private readonly els: HTMLDivElement[] = [];
  private next = 0;

  constructor(parent: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'popups';
    parent.appendChild(this.layer);
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'popup';
      this.layer.appendChild(el);
      this.els.push(el);
    }
  }

  private spawn(x: number, y: number, html: string, cls: string, cam: WorldToScreen): void {
    cam.worldToScreen(x, y, 0, _s);
    const el = this.els[this.next]!;
    this.next = (this.next + 1) % POOL;
    el.className = `popup ${cls}`;
    el.innerHTML = html;
    el.style.left = `${_s.x}px`;
    el.style.top = `${_s.y}px`;
    // Restart the CSS animation.
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }

  handle(events: readonly FxEvent[], cam: WorldToScreen): void {
    let n = 0;
    for (const e of events) {
      if (e.t === 'score') {
        if (++n > 6) continue;
        const big = e.total >= 1000 || e.repeats > 1;
        const rep = e.repeats > 1 ? `<i>×${e.repeats}</i>` : '';
        this.spawn(
          e.x,
          e.y,
          `<b class="c">${fmt(e.base)}</b><span>×</span><b class="m">${fmtMult(e.mult)}</b>${rep}<em>${fmt(e.total)}</em>`,
          big ? 'score big' : 'score',
          cam,
        );
      } else if (e.t === 'money') {
        this.spawn(e.x, e.y + 6, `+$${e.amount}`, 'money', cam);
      } else if (e.t === 'heal') {
        this.spawn(e.x, e.y + 6, '+1 PV', 'heal', cam);
      }
    }
  }

  clear(): void {
    for (const el of this.els) el.className = 'popup';
  }
}
