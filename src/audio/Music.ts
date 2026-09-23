/**
 * Procedural synthwave soundtrack (no audio files): a look-ahead step sequencer driving
 * WebAudio oscillators. Layers fade in with the action:
 *   0 = menus (pad + soft bass), 1 = level (drums + bass), 2 = heat (arp, open hats), boss = darker chords.
 */

const BPM = 112;
const STEP = 60 / BPM / 4; // 16th note
const LOOKAHEAD = 0.12;

/** A minor progressions as MIDI roots (i–VI–III–VII) and a darker boss variant. */
const PROG = [57, 53, 60, 55];
const PROG_BOSS = [57, 58, 57, 52];
const MINOR_CHORD = [0, 3, 7, 12];
const MAJOR_CHORD = [0, 4, 7, 12];
const IS_MAJOR = new Set([53, 60, 55, 58]);

const midi = (n: number): number => 440 * 2 ** ((n - 69) / 12);

export class Music {
  private readonly out: GainNode;
  private readonly drums: GainNode;
  private readonly bass: GainNode;
  private readonly arp: GainNode;
  private readonly pad: GainNode;
  private readonly delay: DelayNode;
  private readonly noise: AudioBuffer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private intensity = 0;
  private boss = false;
  private volume = 0.5;

  constructor(
    private readonly ctx: AudioContext,
    master: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(master);
    const mk = (v: number) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(this.out);
      return g;
    };
    this.drums = mk(0);
    this.bass = mk(0.5);
    this.arp = mk(0);
    this.pad = mk(0.35);
    // Ping-pong-ish delay on the arp.
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    this.delay.connect(lp).connect(fb).connect(this.delay);
    lp.connect(this.arp);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number): void {
    this.volume = v;
    this.out.gain.setTargetAtTime(this.timer ? v * 0.55 : 0, this.ctx.currentTime, 0.3);
  }

  start(): void {
    if (this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.schedule(), 25);
    this.out.gain.setTargetAtTime(this.volume * 0.55, this.ctx.currentTime, 0.8);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
  }

  /** 0 menu, 1 play, 2 heat. */
  setIntensity(level: number, boss = false): void {
    this.intensity = level;
    this.boss = boss;
    const t = this.ctx.currentTime;
    this.drums.gain.setTargetAtTime(level >= 1 ? 0.8 : 0, t, 0.5);
    this.arp.gain.setTargetAtTime(level >= 2 ? 0.28 : level >= 1 ? 0.08 : 0, t, 0.8);
    this.pad.gain.setTargetAtTime(level >= 1 ? 0.14 : 0.35, t, 0.8);
    this.bass.gain.setTargetAtTime(level >= 1 ? 0.55 : 0.3, t, 0.5);
  }

  private schedule(): void {
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(s: number, t: number): void {
    const bar = Math.floor(s / 16);
    const inBar = s % 16;
    const prog = this.boss ? PROG_BOSS : PROG;
    const root = prog[bar % prog.length]!;
    const chord = IS_MAJOR.has(root) ? MAJOR_CHORD : MINOR_CHORD;

    // Drums
    if (this.intensity >= 1) {
      if (inBar % 4 === 0) this.kick(t);
      if (inBar === 4 || inBar === 12) this.snare(t);
      if (inBar % 2 === 1 || this.intensity >= 2)
        this.hat(t, inBar % 4 === 2 ? 0.09 : 0.05, this.intensity >= 2 && inBar % 4 === 2);
    }
    // Bass: driving 8ths with octave jumps.
    if (inBar % 2 === 0) {
      const oct = inBar % 4 === 2 ? 12 : 0;
      this.bassNote(t, midi(root - 24 + oct), STEP * 1.8);
    }
    // Arp: 16ths over chord tones, two octaves.
    const arpNote = root + chord[inBar % 4]! + (Math.floor(inBar / 4) % 2) * 12;
    this.arpNote(t, midi(arpNote), STEP * 0.9);
    // Pad: whole-bar chord.
    if (inBar === 0) this.padChord(t, root, chord, STEP * 16);
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 1, 0.002, 0.3);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.35);
  }

  private snare(t: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.7;
    const g = this.ctx.createGain();
    this.env(g, t, 0.55, 0.002, 0.18);
    src.connect(bp).connect(g).connect(this.drums);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.22);
  }

  private hat(t: number, len: number, open: boolean): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    this.env(g, t, open ? 0.2 : 0.13, 0.001, open ? 0.16 : len);
    src.connect(hp).connect(g).connect(this.drums);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.2);
  }

  private bassNote(t: number, f: number, len: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + len);
    const g = this.ctx.createGain();
    this.env(g, t, 0.5, 0.005, len);
    o.connect(lp).connect(g).connect(this.bass);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  private arpNote(t: number, f: number, len: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const g = this.ctx.createGain();
    this.env(g, t, 0.12, 0.003, len);
    o.connect(lp).connect(g);
    g.connect(this.arp);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  private padChord(t: number, root: number, chord: number[], len: number): void {
    for (const iv of chord.slice(0, 3)) {
      for (const det of [-7, 7]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(root - 12 + iv);
        o.detune.value = det;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + len * 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len * 1.05);
        o.connect(lp).connect(g).connect(this.pad);
        o.start(t);
        o.stop(t + len * 1.1);
      }
    }
  }
}
