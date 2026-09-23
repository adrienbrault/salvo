import { Color, Vector2 } from 'three/webgpu';
import type { FxEvent } from '../../sim/types';
import type { World } from '../../sim/world';
import type { PlayerShip } from '../actors/PlayerShip';
import type { CameraRig } from '../CameraRig';
import type { Sea } from '../env/Sea';
import type { Trench } from '../env/Trench';
import type { Post } from '../Post';
import { hueColor } from '../palette';
import type { LightPool } from './Lights';
import type { Particles } from './Particles';

const WHITE = new Color(1, 1, 1);
const EMBER = new Color(1, 0.45, 0.12);
const DEBRIS = new Color(0.9, 0.85, 1);
const HURT = new Color(1, 0.15, 0.2);
const _s = new Vector2();

/**
 * Turns simulation events into spectacle: GPU particles, light flashes, sea ripples,
 * screen-space shockwaves, camera trauma, bloom/aberration spikes and hit-stop requests.
 * This is the single place to tune "juice".
 */
export class FxDirector {
  /** Seconds of hit-stop requested by the last batch (the app freezes the sim). */
  hitStop = 0;
  /** Slow-motion factor requested (1 = normal). */
  slowMo = 1;
  private bloomKick = 0;
  private aberrationKick = 0;
  private dangerLevel = 0;
  private flashLevel = 0;

  constructor(
    private readonly rig: CameraRig,
    private readonly post: Post,
    private readonly particles: Particles,
    private readonly lights: LightPool,
    private readonly sea: Sea,
    private readonly trench: Trench,
    private ship: PlayerShip | null,
    private readonly screen: () => { w: number; h: number },
  ) {}

  setShip(ship: PlayerShip | null): void {
    this.ship = ship;
  }

  private screenShock(x: number, y: number, size: number, strength: number, life?: number): void {
    const { w, h } = this.screen();
    this.rig.worldToScreen(x, y, 0, _s);
    this.post.shock(_s.x / w, 1 - _s.y / h, size, strength, life);
  }

  handle(events: readonly FxEvent[], _world: World | null): void {
    let hits = 0;
    let cancels = 0;
    for (const e of events) {
      switch (e.t) {
        case 'explode': {
          const s = e.size;
          const col = hueColor(e.hue);
          const big = s > 6;
          this.particles.emit({
            x: e.x,
            y: e.y,
            count: Math.round(34 + s * 14),
            speed: [18, 60 + s * 9],
            life: 0.9,
            size: 0.8,
            color: col,
            intensity: 4,
            kind: 'spark',
            zBias: 0.5,
          });
          this.particles.emit({
            x: e.x,
            y: e.y,
            count: Math.round(8 + s * 4),
            speed: [4, 16 + s],
            life: 1.5,
            size: 1.4 + s * 0.2,
            color: EMBER,
            intensity: 3,
            kind: 'ember',
          });
          this.particles.emit({
            x: e.x,
            y: e.y,
            count: Math.round(6 + s * 3),
            speed: [14, 44],
            life: 2.4,
            size: 0.55,
            color: DEBRIS,
            intensity: 2.5,
            kind: 'debris',
            zBias: 0.9,
          });
          this.lights.flash(e.x, e.y, 2, col, 2600 * (0.6 + s * 0.35), 55 + s * 4, 0.4 + s * 0.03);
          this.sea.drop(e.x, e.y, 3 + s * 0.7, 0.45 + s * 0.09);
          this.trench.shockwave(e.x, e.y, 0.25 + s * 0.08);
          this.particles.shock(e.x, e.y, 60 + s * 12);
          this.rig.addTrauma(Math.min(0.35, 0.05 + s * 0.02));
          if (big) {
            this.screenShock(e.x, e.y, 0.35, 0.03);
            this.bloomKick = Math.max(this.bloomKick, 0.5);
            this.hitStop = Math.max(this.hitStop, 0.05);
          }
          if (e.kind === 'boss') {
            this.rig.addTrauma(1);
            this.flashLevel = 0.8;
            this.hitStop = 0.18;
            this.slowMo = 0.35;
            this.screenShock(e.x, e.y, 0.9, 0.07, 1.2);
            for (let i = 0; i < 4; i++) {
              this.particles.emit({
                x: e.x,
                y: e.y,
                count: 500,
                speed: [30, 160],
                life: 2,
                size: 1.1,
                color: i % 2 ? col : WHITE,
                intensity: 5,
                kind: 'spark',
                zBias: 0.6,
              });
            }
            this.sea.drop(e.x, e.y, 22, 2.5);
            this.trench.shockwave(e.x, e.y, 3);
          }
          break;
        }
        case 'hit': {
          if (++hits > 24) break;
          this.particles.emit({
            x: e.x,
            y: e.y,
            count: e.deflected ? 10 : 5,
            speed: [20, 55],
            life: 0.35,
            size: 0.5,
            color: e.deflected ? WHITE : hueColor(e.hue),
            intensity: 4,
            kind: 'spark',
            dir: -Math.PI / 2,
            spread: e.deflected ? 1.4 : 2.6,
            zBias: 0.3,
          });
          break;
        }
        case 'muzzle':
          this.lights.flash(e.x, e.y + 2, 1, hueColor(e.hue), 900, 40, 0.06);
          break;
        case 'salvo':
          this.particles.emit({
            x: e.x,
            y: e.y + 3,
            count: 60,
            speed: [40, 110],
            life: 0.5,
            size: 0.7,
            color: hueColor('blue'),
            intensity: 4,
            kind: 'spark',
            dir: Math.PI / 2,
            spread: 2,
            zBias: 0.2,
          });
          this.lights.flash(e.x, e.y, 2, hueColor('blue'), 5000, 60, 0.25);
          this.rig.addTrauma(0.12);
          this.rig.addPunch(0.4);
          break;
        case 'playerHit':
          this.rig.addTrauma(0.6);
          this.aberrationKick = 1;
          this.dangerLevel = 1;
          this.flashLevel = Math.max(this.flashLevel, 0.25);
          this.hitStop = Math.max(this.hitStop, 0.12);
          this.particles.emit({
            x: e.x,
            y: e.y,
            count: 160,
            speed: [30, 120],
            life: 0.8,
            size: 0.9,
            color: HURT,
            intensity: 5,
            kind: 'spark',
          });
          this.screenShock(e.x, e.y, 0.5, 0.05, 0.7);
          this.sea.drop(e.x, e.y, 10, 1.2);
          break;
        case 'playerDeath':
          this.rig.addTrauma(1);
          this.flashLevel = 1;
          this.slowMo = 0.3;
          this.hitStop = 0.25;
          for (let i = 0; i < 3; i++) {
            this.particles.emit({
              x: e.x,
              y: e.y,
              count: 600,
              speed: [20, 170],
              life: 1.8,
              size: 1,
              color: i === 1 ? WHITE : HURT,
              intensity: 5,
              kind: 'spark',
              zBias: 0.8,
            });
          }
          this.lights.flash(e.x, e.y, 3, WHITE, 40000, 120, 1.2);
          this.screenShock(e.x, e.y, 1, 0.08, 1.4);
          this.sea.drop(e.x, e.y, 26, 3);
          break;
        case 'graze':
          this.particles.emit({
            x: e.x,
            y: e.y,
            count: e.close ? 10 : 4,
            speed: [10, 30],
            life: 0.4,
            size: 0.45,
            color: hueColor('gold'),
            intensity: e.close ? 6 : 3,
            kind: 'spark',
            zBias: 0.2,
          });
          if (e.close) this.lights.flash(e.x, e.y, 1, hueColor('gold'), 700, 30, 0.12);
          break;
        case 'wave': {
          const col = hueColor(e.hue);
          this.screenShock(e.x, e.y, Math.min(0.9, e.maxR / 90), 0.06, 0.6);
          this.particles.shock(e.x, e.y, 220);
          this.particles.emit({
            x: e.x,
            y: e.y,
            count: Math.round(120 + e.maxR * 5),
            speed: [e.maxR * 1.6, e.maxR * 3],
            life: 0.7,
            size: 0.9,
            color: col,
            intensity: 5,
            kind: 'spark',
            zBias: 0.05,
          });
          this.lights.flash(e.x, e.y, 3, col, 9000 + e.maxR * 300, 40 + e.maxR * 1.5, 0.5);
          this.sea.drop(e.x, e.y, e.maxR * 0.35, 1.6);
          this.rig.addTrauma(0.25);
          this.bloomKick = Math.max(this.bloomKick, 0.6);
          break;
        }
        case 'dash':
          this.particles.emit({
            x: e.x,
            y: e.y,
            count: 70,
            speed: [30, 90],
            life: 0.5,
            size: 0.8,
            color: hueColor('red'),
            intensity: 4,
            kind: 'spark',
            dir: Math.atan2(-e.dy, -e.dx),
            spread: 1.2,
            zBias: 0.2,
          });
          this.sea.drop(e.x, e.y, 6, 0.9);
          this.particles.shock(e.x, e.y, 90);
          this.rig.addTrauma(0.15);
          this.rig.addPunch(0.3);
          break;
        case 'absorb':
          this.ship?.pulseShield();
          break;
        case 'release':
          this.screenShock(e.x, e.y, 0.3, 0.04);
          this.lights.flash(e.x, e.y, 2, WHITE, 5000 + e.count * 200, 60, 0.3);
          this.rig.addTrauma(Math.min(0.4, 0.1 + e.count * 0.01));
          this.particles.emit({
            x: e.x,
            y: e.y,
            count: 40 + e.count * 4,
            speed: [30, 100],
            life: 0.5,
            size: 0.7,
            color: WHITE,
            intensity: 4,
            kind: 'spark',
            dir: Math.PI / 2,
            spread: 2.4,
          });
          break;
        case 'cancel':
          if (++cancels > 40) break;
          this.particles.emit({
            x: e.x,
            y: e.y,
            count: 3,
            speed: [4, 14],
            life: 0.5,
            size: 0.7,
            color: hueColor(e.hue),
            intensity: 3,
            kind: 'ember',
          });
          break;
        case 'bossSpawn':
          this.rig.addTrauma(0.5);
          this.screenShock(e.x, Math.min(e.y, 70), 0.8, 0.05, 1.2);
          this.sea.drop(e.x, 60, 30, 2);
          break;
        case 'bossPhase':
          this.flashLevel = Math.max(this.flashLevel, 0.45);
          this.rig.addTrauma(0.6);
          this.screenShock(e.x, e.y, 0.7, 0.06, 0.9);
          this.particles.shock(e.x, e.y, 260);
          this.hitStop = Math.max(this.hitStop, 0.1);
          break;
        case 'quota':
          this.flashLevel = Math.max(this.flashLevel, 0.35);
          this.bloomKick = 1;
          break;
        default:
          break;
      }
    }
  }

  /** Per-frame decay of transient post effects. */
  update(dt: number, gauge: number): void {
    this.bloomKick = Math.max(0, this.bloomKick - dt * 1.5);
    this.aberrationKick = Math.max(0, this.aberrationKick - dt * 2.5);
    this.dangerLevel = Math.max(0, this.dangerLevel - dt * 1.2);
    this.flashLevel = Math.max(0, this.flashLevel - dt * 2.2);
    this.slowMo = Math.min(1, this.slowMo + dt * 0.8);
    // The Mult gauge literally makes the world glow harder.
    const gaugeGlow = Math.min(0.5, Math.log2(Math.max(1, gauge)) * 0.12);
    this.post.bloomStrength.value = 0.85 + gaugeGlow + this.bloomKick * 0.6;
    this.post.aberration.value = this.aberrationKick * 0.9;
    this.post.danger.value = this.dangerLevel * 0.8;
    this.post.flash.value = this.flashLevel * this.flashLevel;
  }

  /** Persistent low-HP pulse. */
  setLowHp(on: boolean, t: number): void {
    if (on) this.dangerLevel = Math.max(this.dangerLevel, 0.14 + Math.sin(t * 5) * 0.07);
  }
}
