import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu';
import { FIELD } from '../sim/constants';

const _v = new Vector3();
const _ndc = new Vector2();
const _ray = new Raycaster();
const _plane = new Plane(new Vector3(0, 0, 1), 0);

export interface Insets {
  top: number;
  bottom: number;
}

/**
 * Perspective camera looking down at the gameplay plane (z = 0) with a forward tilt, so the
 * sea below reflects the battle. `fit()` solves the distance so the whole 9:16 field is
 * visible for any aspect ratio, leaving room for HUD insets.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  /** Tilt from vertical, radians. */
  tilt = 0.3;
  private dist = 200;
  private targetY = 0;
  private trauma = 0;
  private t = 0;
  private punch = 0;
  private sway = 0;
  private width = 1;
  private height = 1;

  constructor() {
    this.camera = new PerspectiveCamera(36, 9 / 16, 1, 1200);
    this.camera.up.set(0, 1, 0);
  }

  fit(width: number, height: number, insets: Insets = { top: 0, bottom: 0 }): void {
    this.width = width;
    this.height = height;
    const cam = this.camera;
    cam.aspect = width / height;
    cam.updateProjectionMatrix();
    const mTop = (insets.top / height) * 2 + 0.02;
    const mBottom = (insets.bottom / height) * 2 + 0.02;
    const mx = 0.035;
    const corners = [
      [-FIELD.halfW, -FIELD.halfH],
      [FIELD.halfW, -FIELD.halfH],
      [-FIELD.halfW, FIELD.halfH],
      [FIELD.halfW, FIELD.halfH],
    ] as const;

    const fits = (d: number, ty: number): { ok: boolean; lo: number; hi: number } => {
      this.place(d, ty, 0, 0, 0);
      let lo = 1;
      let hi = -1;
      let ok = true;
      for (const [x, y] of corners) {
        _v.set(x, y, 0).project(cam);
        if (Math.abs(_v.x) > 1 - mx) ok = false;
        lo = Math.min(lo, _v.y);
        hi = Math.max(hi, _v.y);
      }
      if (lo < -1 + mBottom || hi > 1 - mTop) ok = false;
      return { ok, lo, hi };
    };

    const minDist = (ty: number): number => {
      let a = 40;
      let b = 2000;
      for (let i = 0; i < 40; i++) {
        const m = (a + b) / 2;
        if (fits(m, ty).ok) b = m;
        else a = m;
      }
      return b;
    };

    // Golden-section search for the look-at y that lets the camera come closest.
    let a = -60;
    let b = 60;
    const g = (Math.sqrt(5) - 1) / 2;
    let c = b - g * (b - a);
    let d = a + g * (b - a);
    for (let i = 0; i < 30; i++) {
      if (minDist(c) < minDist(d)) b = d;
      else a = c;
      c = b - g * (b - a);
      d = a + g * (b - a);
    }
    this.targetY = (a + b) / 2;
    this.dist = minDist(this.targetY) * 1.005;
    this.place(this.dist, this.targetY, 0, 0, 0);
  }

  private place(d: number, ty: number, ox: number, oy: number, roll: number): void {
    const cam = this.camera;
    const s = Math.sin(this.tilt);
    const c = Math.cos(this.tilt);
    cam.position.set(ox, ty - s * d + oy, c * d);
    cam.up.set(Math.sin(roll), Math.cos(roll), 0);
    cam.lookAt(ox * 0.6, ty + oy, 0);
    cam.updateMatrixWorld(true);
  }

  /** Adds screen shake (0..1). Shake intensity is trauma². */
  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Brief zoom-in punch (0..1). */
  addPunch(amount: number): void {
    this.punch = Math.min(1, this.punch + amount);
  }

  update(dt: number, playerX: number): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.punch = Math.max(0, this.punch - dt * 3.5);
    this.sway += (playerX * 0.07 - this.sway) * Math.min(1, dt * 3);
    const shake = this.trauma * this.trauma;
    const n = (f: number, o: number) =>
      Math.sin(this.t * f + o) * 0.6 + Math.sin(this.t * f * 2.13 + o * 1.7) * 0.4;
    const ox = this.sway + shake * 3.2 * n(37, 0);
    const oy = shake * 3.2 * n(41, 3);
    const roll = shake * 0.035 * n(29, 7);
    this.place(this.dist * (1 - this.punch * 0.03), this.targetY, ox, oy, roll);
  }

  /** Client pixel → point on the gameplay plane (z = 0), in sim coordinates. */
  screenToWorld(clientX: number, clientY: number, rect: DOMRect, out: Vector2): boolean {
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    _ray.setFromCamera(_ndc, this.camera);
    const hit = _ray.ray.intersectPlane(_plane, _v);
    if (!hit) return false;
    out.set(_v.x, _v.y);
    return true;
  }

  /** World (sim) point → CSS pixel position relative to the canvas. */
  worldToScreen(x: number, y: number, z: number, out: Vector2): Vector2 {
    _v.set(x, y, z).project(this.camera);
    return out.set(((_v.x + 1) / 2) * this.width, ((1 - _v.y) / 2) * this.height);
  }
}
