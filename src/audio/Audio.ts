import { ZZFX } from 'zzfx';
import type { FxEvent } from '../sim/types';
import { Music } from './Music';

/** ZzFX parameter lists (volume, randomness, frequency, attack, sustain, release, shape, …). */
const SOUNDS = {
  shoot: [0.22, 0.05, 1250, 0, 0.01, 0.05, 2, 1.5, -30, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0.02],
  salvo: [0.55, 0.05, 320, 0.01, 0.08, 0.3, 2, 1, -5, 0, 0, 0, 0, 0.4, 0, 0, 0, 0.8, 0.05],
  pop: [0.55, 0.1, 110, 0.01, 0.08, 0.3, 4, 1.5, -2, 0, 0, 0, 0, 1.1, 0, 0.3, 0, 0.6, 0.1],
  boom: [1.1, 0.1, 55, 0.02, 0.3, 0.9, 4, 2, -1, 0, 0, 0, 0, 1.5, 0, 0.5, 0.1, 0.5, 0.3],
  hit: [0.18, 0.1, 320, 0, 0.01, 0.04, 3, 1, 0, 0, 0, 0, 0, 0.8],
  hurt: [1, 0.1, 150, 0.01, 0.15, 0.5, 3, 1.5, -10, 0, 0, 0, 0, 2, 0, 0.4, 0.1, 0.6, 0.2],
  death: [1.4, 0.1, 70, 0.05, 0.5, 1.6, 4, 2, -1, 0, 0, 0, 0, 1.5, 0, 0.8, 0.2, 0.4, 0.5],
  graze: [0.12, 0.05, 1700, 0, 0, 0.05, 0, 1.5, 50],
  wave: [1, 0.05, 60, 0.05, 0.3, 0.8, 1, 2, -3, 0, 0, 0, 0, 0.5, 0, 0, 0.1, 0.7, 0.2],
  dash: [0.55, 0.1, 520, 0.01, 0.05, 0.2, 1, 1, -40, 0, 0, 0, 0, 0.6],
  absorb: [0.14, 0.05, 900, 0, 0.01, 0.08, 0, 1, 20],
  release: [0.8, 0.05, 400, 0.01, 0.1, 0.4, 2, 1, 15, 0, 0, 0, 0, 0, 0, 0, 0.05],
  coin: [0.45, 0.02, 1200, 0, 0.03, 0.15, 1, 1.5, 0, 0, 400, 0.05],
  buy: [0.55, 0, 700, 0.01, 0.05, 0.2, 1, 1, 0, 0, 300, 0.06],
  reroll: [0.4, 0.05, 500, 0, 0.08, 0.1, 1, 1, 20, 0, 0, 0, 0.05],
  error: [0.4, 0.02, 150, 0, 0.05, 0.1, 2, 1, -5],
  quota: [0.9, 0, 520, 0.02, 0.3, 0.6, 1, 1, 0, 0, 260, 0.12, 0, 0, 0, 0, 0, 0.8],
  relic: [0.16, 0.02, 1400, 0, 0.01, 0.05, 1, 1, 0, 0, 200, 0.02],
  boss: [1.1, 0.05, 40, 0.3, 0.6, 1.2, 1, 2, 0, 0, 0, 0, 0, 0.3, 5, 0, 0, 0.6, 0.5],
  warning: [0.35, 0, 880, 0, 0.05, 0.1, 1, 1, 0, 0, 0, 0, 0.12],
  click: [0.22, 0, 900, 0, 0, 0.03, 1],
  heal: [0.5, 0, 600, 0.02, 0.1, 0.3, 0, 1, 10, 0, 200, 0.05],
  start: [0.6, 0, 300, 0.05, 0.2, 0.4, 1, 1, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0.7],
  phase: [1, 0.05, 90, 0.05, 0.4, 0.8, 2, 1, -2, 0, 0, 0, 0, 0.6, 3, 0.2, 0.1],
} as const;

export type SoundId = keyof typeof SOUNDS;

/** Minimum seconds between two plays of the same sound (avoids machine-gun clipping). */
const THROTTLE: Partial<Record<SoundId, number>> = {
  shoot: 0.07,
  hit: 0.045,
  graze: 0.05,
  pop: 0.03,
  absorb: 0.05,
  relic: 0.06,
  coin: 0.05,
};

/**
 * Procedural audio: ZzFX samples rendered once, played through a master bus with a
 * compressor (so 40 simultaneous explosions stay musical) + the procedural music.
 */
export class Audio {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly sfxBus: GainNode;
  private readonly buffers = new Map<SoundId, AudioBuffer>();
  private readonly lastPlay = new Map<SoundId, number>();
  readonly music: Music;

  constructor() {
    this.ctx = ZZFX.audioContext;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.connect(comp).connect(this.master).connect(this.ctx.destination);
    for (const [id, params] of Object.entries(SOUNDS)) {
      const samples = ZZFX.buildSamples(...(params as unknown as number[]));
      const buf = this.ctx.createBuffer(1, samples.length, ZZFX.sampleRate);
      buf.getChannelData(0).set(samples);
      this.buffers.set(id as SoundId, buf);
    }
    this.music = new Music(this.ctx, this.master);
  }

  /** Must be called from a user gesture (autoplay policies). */
  unlock(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  setVolume(sfx: number, music: number): void {
    this.sfxBus.gain.value = sfx;
    this.music.setVolume(music);
  }

  play(id: SoundId, volume = 1, pitch = 1, pan = 0): void {
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const gap = THROTTLE[id];
    if (gap !== undefined && now - (this.lastPlay.get(id) ?? -1) < gap) return;
    this.lastPlay.set(id, now);
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get(id)!;
    src.playbackRate.value = pitch * (1 + (Math.random() - 0.5) * 0.06);
    const g = this.ctx.createGain();
    g.gain.value = volume;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(g).connect(p).connect(this.sfxBus);
    src.start();
  }

  handle(events: readonly FxEvent[]): void {
    const pan = (x: number) => x / 60;
    for (const e of events) {
      switch (e.t) {
        case 'muzzle':
          this.play('shoot', 0.5, 1, pan(e.x));
          break;
        case 'salvo':
          this.play('salvo');
          break;
        case 'explode':
          if (e.kind === 'boss') this.play('boom', 1.4, 0.6);
          else if (e.size > 5) this.play('boom', 0.8, 1.1, pan(e.x));
          else this.play('pop', 0.7, 1 + (3 - e.size) * 0.08, pan(e.x));
          break;
        case 'hit':
          this.play('hit', 0.6, 1, pan(e.x));
          break;
        case 'playerHit':
          this.play('hurt');
          break;
        case 'playerDeath':
          this.play('death');
          break;
        case 'graze':
          this.play('graze', e.close ? 0.9 : 0.5, e.close ? 1.3 : 1, pan(e.x));
          break;
        case 'wave':
          this.play('wave');
          break;
        case 'dash':
          this.play('dash');
          break;
        case 'absorb':
          this.play('absorb');
          break;
        case 'release':
          this.play('release', 1, 1 + Math.min(0.5, e.count * 0.01));
          break;
        case 'money':
          this.play('coin');
          break;
        case 'relic':
          this.play('relic', 0.7, 1 + (e.slot ?? 0) * 0.08);
          break;
        case 'heal':
          this.play('heal');
          break;
        case 'bossSpawn':
          this.play('boss');
          break;
        case 'bossPhase':
          this.play('phase');
          break;
        case 'quota':
          this.play('quota');
          break;
        case 'timeWarning':
          this.play('warning');
          break;
        default:
          break;
      }
    }
  }
}
