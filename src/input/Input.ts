import { Vector2 } from 'three/webgpu';
import type { InputFrame } from '../sim/types';

/** Converts client pixels to gameplay-plane coordinates (implemented by the camera rig). */
export interface ScreenMapper {
  screenToWorld(clientX: number, clientY: number, rect: DOMRect, out: Vector2): boolean;
}

export interface InputOptions {
  /** Touch drag multiplier (1 = the ship moves exactly as much as the finger). */
  touchSensitivity: number;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  // Physical positions: WASD on QWERTY = ZQSD on AZERTY.
  KeyW: [0, 1],
  KeyS: [0, -1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
};
const ACTION_KEYS = new Set(['Space', 'KeyJ', 'KeyK', 'Enter']);
const PRECISE_KEYS = new Set(['ShiftLeft', 'ShiftRight']);

/**
 * One code path for mouse, touch, pen and keyboard (Pointer Events).
 *  - Touch/pen: the first finger drags the ship *relatively* (it stays above your finger);
 *    any extra finger held = action.
 *  - Mouse: the ship chases the cursor; button held = action.
 *  - Keyboard: arrows / WASD / ZQSD, Space = action, Shift = precision.
 */
export class InputController {
  enabled = true;
  onPause: (() => void) | null = null;
  private mode: 'pointer' | 'keys' = 'pointer';
  private readonly target = new Vector2();
  private hasTarget = false;
  private drag: { id: number; anchorWorld: Vector2; anchorShip: Vector2 } | null = null;
  private readonly actionPointers = new Set<number>();
  private readonly keys = new Set<string>();
  private mouseDown = false;
  private readonly tmp = new Vector2();
  private readonly frameOut: InputFrame = {
    hasTarget: false,
    tx: 0,
    ty: 0,
    dx: 0,
    dy: 0,
    precise: false,
    action: false,
  };

  constructor(
    private readonly el: HTMLElement,
    private readonly mapper: ScreenMapper,
    private readonly ship: () => { x: number; y: number } | null,
    private readonly opts: InputOptions = { touchSensitivity: 1 },
  ) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.reset);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setSensitivity(v: number): void {
    this.opts.touchSensitivity = v;
  }

  reset = (): void => {
    this.drag = null;
    this.actionPointers.clear();
    this.keys.clear();
    this.mouseDown = false;
    this.hasTarget = false;
  };

  /** Current intent; call once per simulation step. */
  frame(): InputFrame {
    const f = this.frameOut;
    let dx = 0;
    let dy = 0;
    for (const k of this.keys) {
      const d = MOVE_KEYS[k];
      if (d) {
        dx += d[0];
        dy += d[1];
      }
    }
    if (dx !== 0 || dy !== 0) this.mode = 'keys';
    f.dx = Math.max(-1, Math.min(1, dx));
    f.dy = Math.max(-1, Math.min(1, dy));
    f.hasTarget = this.mode === 'pointer' && this.hasTarget;
    f.tx = this.target.x;
    f.ty = this.target.y;
    f.precise = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    let keyAction = false;
    for (const k of ACTION_KEYS) if (this.keys.has(k)) keyAction = true;
    f.action = this.enabled && (keyAction || this.mouseDown || this.actionPointers.size > 0);
    return f;
  }

  private world(e: PointerEvent, out: Vector2): boolean {
    return this.mapper.screenToWorld(e.clientX, e.clientY, this.el.getBoundingClientRect(), out);
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    this.mode = 'pointer';
    if (e.pointerType === 'mouse') {
      if (e.button === 0 || e.button === 2) this.mouseDown = true;
      if (this.world(e, this.tmp)) {
        this.target.copy(this.tmp);
        this.hasTarget = true;
      }
      return;
    }
    e.preventDefault();
    if (!this.drag) {
      const ship = this.ship();
      if (!ship || !this.world(e, this.tmp)) return;
      this.drag = { id: e.pointerId, anchorWorld: this.tmp.clone(), anchorShip: new Vector2(ship.x, ship.y) };
      this.target.set(ship.x, ship.y);
      this.hasTarget = true;
      this.el.setPointerCapture?.(e.pointerId);
    } else {
      this.actionPointers.add(e.pointerId);
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      this.mode = 'pointer';
      if (this.world(e, this.tmp)) {
        this.target.copy(this.tmp);
        this.hasTarget = true;
      }
      return;
    }
    const d = this.drag;
    if (!d || d.id !== e.pointerId || !this.world(e, this.tmp)) return;
    const s = this.opts.touchSensitivity;
    this.target.set(
      d.anchorShip.x + (this.tmp.x - d.anchorWorld.x) * s,
      d.anchorShip.y + (this.tmp.y - d.anchorWorld.y) * s,
    );
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      this.mouseDown = false;
      return;
    }
    if (this.drag?.id === e.pointerId) {
      this.drag = null;
      // Keep the ship where it is: re-anchor to its current position.
      const ship = this.ship();
      if (ship) this.target.set(ship.x, ship.y);
    }
    this.actionPointers.delete(e.pointerId);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      this.onPause?.();
      return;
    }
    if (MOVE_KEYS[e.code] || ACTION_KEYS.has(e.code) || PRECISE_KEYS.has(e.code)) {
      if (e.target instanceof HTMLElement && e.target.closest('button, input, select')) return;
      e.preventDefault();
      this.keys.add(e.code);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
}
