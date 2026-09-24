export type Tier = 'ultra' | 'high' | 'medium' | 'low';

export interface Quality {
  tier: Tier;
  /** Max device pixel ratio for the canvas. */
  pixelRatio: number;
  /**
   * Most drawing-buffer pixels: on a large high-DPI screen the pixel ratio is lowered to fit,
   * since every pass (post included) costs per pixel.
   */
  maxPixels: number;
  /** Scene pass resolution, relative to the canvas. */
  resolutionScale: number;
  /** Lowest factor dynamic resolution may apply to the canvas pixel ratio. */
  minResolutionScale: number;
  reflectionScale: number;
  /** Ripple sim texels (x, y); the domain is 96 × 420 world units. */
  seaSim: [number, number];
  /** Resolution of each procedural hull texture layer. */
  hullTexture: number;
  /** Trench lamps feed the dynamic light pool (needs clustered lighting's budget). */
  envLamps: boolean;
  particles: number;
  motes: number;
  lights: number;
  /** Forward+ clustered lighting (WebGPU only). */
  clustered: boolean;
  bloom: boolean;
  chromatic: boolean;
  grain: boolean;
  shadows: boolean;
  smaa: boolean;
  ao: boolean;
}

export const TIERS: Record<Tier, Quality> = {
  ultra: {
    tier: 'ultra',
    pixelRatio: 2,
    maxPixels: 3_700_000,
    resolutionScale: 1,
    minResolutionScale: 0.6,
    reflectionScale: 0.5,
    seaSim: [128, 560],
    hullTexture: 512,
    envLamps: true,
    particles: 65536,
    motes: 14000,
    lights: 256,
    clustered: true,
    bloom: true,
    chromatic: true,
    grain: true,
    shadows: true,
    smaa: true,
    ao: true,
  },
  high: {
    tier: 'high',
    pixelRatio: 2,
    maxPixels: 2_400_000,
    resolutionScale: 0.8,
    minResolutionScale: 0.5,
    reflectionScale: 0.35,
    seaSim: [96, 420],
    hullTexture: 512,
    envLamps: true,
    particles: 32768,
    motes: 7000,
    lights: 96,
    clustered: true,
    bloom: true,
    chromatic: true,
    grain: true,
    shadows: false,
    smaa: true,
    ao: true,
  },
  medium: {
    tier: 'medium',
    pixelRatio: 1.5,
    maxPixels: 1_600_000,
    resolutionScale: 0.9,
    minResolutionScale: 0.5,
    reflectionScale: 0.4,
    seaSim: [96, 420],
    hullTexture: 256,
    envLamps: false,
    particles: 24576,
    motes: 5000,
    lights: 12,
    clustered: false,
    bloom: true,
    chromatic: true,
    grain: false,
    shadows: false,
    smaa: true,
    ao: false,
  },
  low: {
    tier: 'low',
    pixelRatio: 1.25,
    maxPixels: 1_000_000,
    resolutionScale: 0.75,
    minResolutionScale: 0.45,
    reflectionScale: 0.25,
    seaSim: [64, 280],
    hullTexture: 256,
    envLamps: false,
    particles: 12288,
    motes: 2500,
    lights: 6,
    clustered: false,
    bloom: true,
    chromatic: false,
    grain: false,
    shadows: false,
    smaa: false,
    ao: false,
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

/** Canvas pixel ratio for a tier at this CSS size: the device's, within the tier's caps. */
export function pixelRatioFor(q: Quality, width: number, height: number, dpr: number): number {
  const fit = Math.sqrt(q.maxPixels / Math.max(1, width * height));
  return Math.max(0.5, Math.min(dpr, q.pixelRatio, fit));
}

/**
 * Dynamic resolution: keeps the frame rate up by scaling the canvas pixel ratio (so the scene
 * and every post pass shrink together), between `min` and 1. Reacts to sustained slow frames
 * only (ignores one-off hitches), faster going down than coming back up.
 */
export class DynamicResolution {
  private avg = 16.7;
  private slow = 0;
  private fast = 0;
  scale = 1;

  constructor(private readonly min: number) {}

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
    if (this.slow > 30 && this.scale > this.min) {
      this.slow = 0;
      this.scale = Math.max(this.min, this.scale - 0.1);
      return this.scale;
    }
    if (this.fast > 240 && this.scale < 1) {
      this.fast = 0;
      this.scale = Math.min(1, this.scale + 0.05);
      return this.scale;
    }
    return null;
  }
}
