export type Tier = 'ultra' | 'high' | 'medium' | 'low';

export interface Quality {
  tier: Tier;
  /** Max device pixel ratio for the canvas. */
  pixelRatio: number;
  /** Scene pass resolution scale (dynamic resolution moves it between min and this). */
  resolutionScale: number;
  minResolutionScale: number;
  reflectionScale: number;
  seaSim: [number, number];
  particles: number;
  motes: number;
  lights: number;
  /** Forward+ clustered lighting (WebGPU only). */
  clustered: boolean;
  bloom: boolean;
  chromatic: boolean;
  grain: boolean;
  shadows: boolean;
}

export const TIERS: Record<Tier, Quality> = {
  ultra: {
    tier: 'ultra',
    pixelRatio: 2,
    resolutionScale: 1,
    minResolutionScale: 0.6,
    reflectionScale: 0.5,
    seaSim: [256, 320],
    particles: 65536,
    motes: 14000,
    lights: 256,
    clustered: true,
    bloom: true,
    chromatic: true,
    grain: true,
    shadows: true,
  },
  high: {
    tier: 'high',
    pixelRatio: 2,
    resolutionScale: 0.8,
    minResolutionScale: 0.5,
    reflectionScale: 0.35,
    seaSim: [192, 240],
    particles: 32768,
    motes: 7000,
    lights: 96,
    clustered: true,
    bloom: true,
    chromatic: true,
    grain: true,
    shadows: false,
  },
  medium: {
    tier: 'medium',
    pixelRatio: 1.5,
    resolutionScale: 0.9,
    minResolutionScale: 0.5,
    reflectionScale: 0.4,
    seaSim: [192, 240],
    particles: 24576,
    motes: 5000,
    lights: 12,
    clustered: false,
    bloom: true,
    chromatic: true,
    grain: false,
    shadows: false,
  },
  low: {
    tier: 'low',
    pixelRatio: 1.25,
    resolutionScale: 0.75,
    minResolutionScale: 0.45,
    reflectionScale: 0.25,
    seaSim: [128, 160],
    particles: 12288,
    motes: 2500,
    lights: 6,
    clustered: false,
    bloom: true,
    chromatic: false,
    grain: false,
    shadows: false,
  },
};

export const isCoarsePointer = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/** Auto tier: WebGPU + fine pointer → ultra; WebGPU phone → high; WebGL → medium/low. */
export function autoTier(webgpu: boolean): Tier {
  const coarse = isCoarsePointer();
  if (webgpu) return coarse ? 'high' : 'ultra';
  return coarse ? 'low' : 'medium';
}

/**
 * Dynamic resolution: keeps the frame rate up by moving the scene resolution scale.
 * Reacts to sustained slow frames only (ignores one-off hitches).
 */
export class DynamicResolution {
  private avg = 16.7;
  private slow = 0;
  private fast = 0;
  scale: number;

  constructor(
    private readonly max: number,
    private readonly min: number,
  ) {
    this.scale = max;
  }

  /** Returns the new scale when it changed, otherwise null. */
  sample(frameMs: number): number | null {
    this.avg += (Math.min(frameMs, 60) - this.avg) * 0.08;
    if (this.avg > 19.5) {
      this.slow++;
      this.fast = 0;
    } else if (this.avg < 14) {
      this.fast++;
      this.slow = 0;
    } else {
      this.slow = Math.max(0, this.slow - 1);
      this.fast = Math.max(0, this.fast - 1);
    }
    if (this.slow > 45 && this.scale > this.min) {
      this.slow = 0;
      this.scale = Math.max(this.min, this.scale - 0.1);
      return this.scale;
    }
    if (this.fast > 240 && this.scale < this.max) {
      this.fast = 0;
      this.scale = Math.min(this.max, this.scale + 0.05);
      return this.scale;
    }
    return null;
  }
}
