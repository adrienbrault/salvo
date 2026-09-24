import {
  DataArrayTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three/webgpu';
import { Rng } from '../../sim/rng';

/**
 * Procedural PBR texture set for the megastructure, generated at boot (no downloaded assets),
 * Substance-style: each tile is split into panels, every panel gets a paint (mostly
 * dielectric paints, some bare metal) and a per-pixel pass adds bevels, seams, chipped-edge
 * wear exposing bright metal, cavity dirt, drip streaks and pitting. Decals (windows, vents,
 * hazard stripes, circuits, stencils) are then drawn on top with Canvas2D.
 *
 * Layers live in texture arrays so geometry picks one per face and still gets hardware
 * repeat + mipmaps. Maps:
 *  - albedo (sRGB)
 *  - ORM: R = AO, G = roughness, B = metalness, A = height (for parallax)
 *  - normal (from the height)
 *  - emissive *mask* whose channels are light classes the shader colors and animates:
 *    R = warm interior light, G = sector accent, B = alert red
 * plus a small tileable `macro` texture (R blotches, G streaks, B pitting, A mid noise) used
 * at very low and very high frequency to break tiling and add micro detail.
 */
export const LAYER = {
  PLATES: 0,
  PANELS: 1,
  GREEBLE: 2,
  GRILLE: 3,
  WINDOWS: 4,
  HAZARD: 5,
  CIRCUIT: 6,
  RIBS: 7,
  STRIPS: 8,
  DECK: 9,
  RADIATOR: 10,
  GRIME: 11,
  /** Asteroid rock: strata, ridges, cracks. */
  ROCK: 12,
  /** Basalt with glowing magma cracks (warm emissive channel). */
  MAGMA: 13,
  /** Plates in rust/primer paint, heavily weathered. */
  PLATES_RUST: 14,
  /** Clean shipyard panels: white/grey paint, light grime. */
  PANELS_CLEAN: 15,
} as const;
export const LAYER_COUNT = 16;

export interface HullTextureSet {
  albedo: DataArrayTexture;
  orm: DataArrayTexture;
  normal: DataArrayTexture;
  emissive: DataArrayTexture;
  macro: DataTexture;
  size: number;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type RGB = readonly [number, number, number];

function makeCtx(size: number): Ctx {
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Ctx | null;
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
}

// ── Tileable noise ───────────────────────────────────────────────────────────

/**
 * Periodic value-noise fBm over a size×size tile, normalized to 0..1. `cellsX`/`cellsY` set
 * the base lattice (different values stretch the noise into streaks).
 */
function tileNoise(size: number, cellsX: number, cellsY: number, octaves: number, rng: Rng): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cx = cellsX << o;
    const cy = cellsY << o;
    const lattice = new Float32Array(cx * cy);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cy;
      const j0 = Math.floor(fy);
      const ty = fy - j0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (j0 % cy) * cx;
      const r1 = ((j0 + 1) % cy) * cx;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cx;
        const i0 = Math.floor(fx);
        const tx = fx - i0;
        const sx = tx * tx * (3 - 2 * tx);
        const i1 = (i0 + 1) % cx;
        const a = lattice[r0 + (i0 % cx)]!;
        const b = lattice[r0 + i1]!;
        const c = lattice[r1 + (i0 % cx)]!;
        const d = lattice[r1 + i1]!;
        const top = a + (b - a) * sx;
        const bot = c + (d - c) * sx;
        out[y * size + x]! += (top + (bot - top) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / total;
  // Stretch contrast: fBm clusters around 0.5.
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, Math.max(0, (out[i]! - 0.5) * 2.2 + 0.5));
  return out;
}

interface NoiseSet {
  blotch: Float32Array;
  streak: Float32Array;
  pit: Float32Array;
  mid: Float32Array;
}

// ── Paints ───────────────────────────────────────────────────────────────────

interface Paint {
  /** sRGB 0..255 */
  c: RGB;
  metal: number;
  rough: number;
  /** How readily edges chip down to bare metal. */
  wear: number;
}

const PAINT = {
  gunmetal: { c: [70, 74, 80], metal: 0.95, rough: 0.32, wear: 0.15 },
  steel: { c: [104, 108, 114], metal: 0.95, rough: 0.26, wear: 0.05 },
  navy: { c: [36, 44, 60], metal: 0.05, rough: 0.55, wear: 0.8 },
  graphite: { c: [46, 48, 53], metal: 0.05, rough: 0.62, wear: 0.6 },
  grey: { c: [92, 95, 99], metal: 0.05, rough: 0.58, wear: 0.75 },
  white: { c: [176, 178, 176], metal: 0.05, rough: 0.5, wear: 0.95 },
  primer: { c: [104, 44, 34], metal: 0.05, rough: 0.66, wear: 0.9 },
  olive: { c: [70, 72, 54], metal: 0.05, rough: 0.6, wear: 0.8 },
  black: { c: [20, 21, 24], metal: 0.1, rough: 0.42, wear: 0.5 },
} satisfies Record<string, Paint>;
type PaintName = keyof typeof PAINT;
type Scheme = readonly (readonly [PaintName, number])[];

const BARE: RGB = [158, 162, 168];

const SCHEMES: Record<string, Scheme> = {
  hull: [
    ['graphite', 4],
    ['navy', 3],
    ['gunmetal', 3],
    ['grey', 1.5],
    ['white', 0.5],
    ['primer', 0.35],
  ],
  deck: [
    ['graphite', 5],
    ['gunmetal', 2],
    ['olive', 1],
    ['grey', 1],
  ],
  tech: [
    ['gunmetal', 4],
    ['black', 2],
    ['steel', 1],
    ['graphite', 2],
  ],
  rust: [
    ['primer', 4],
    ['olive', 2],
    ['graphite', 2],
    ['gunmetal', 1],
  ],
  clean: [
    ['white', 4],
    ['grey', 3],
    ['navy', 1],
    ['steel', 1],
  ],
  mixed: [
    ['navy', 2],
    ['grey', 2],
    ['white', 1],
    ['primer', 0.6],
    ['gunmetal', 2],
    ['graphite', 2],
  ],
};

// ── Painter ──────────────────────────────────────────────────────────────────

/** Logical drawing size: layers are designed at 512 and scaled to the output resolution. */
const REF = 512;

interface Panel {
  x: number;
  y: number;
  w: number;
  h: number;
  paint: Paint;
  /** Height offset of the whole panel (raised / recessed plates). */
  lift: number;
  /** Bevel width (REF px). */
  bevel: number;
}

interface Feature {
  albedo?: string;
  height?: number;
  rough?: number;
  metal?: number;
  emissive?: string;
  ao?: number;
}

/** Draws into all maps at once so details line up perfectly. */
class Painter {
  readonly s = REF;
  readonly a: Ctx;
  readonly h: Ctx;
  readonly o: Ctx;
  readonly e: Ctx;
  readonly rng: Rng;
  readonly panels: Panel[] = [];
  /** Decals drawn after the per-pixel pass. */
  readonly decals: (() => void)[] = [];
  private readonly k: number;

  constructor(
    readonly px: number,
    seed: string,
    private readonly noise: NoiseSet,
  ) {
    this.a = makeCtx(px);
    this.h = makeCtx(px);
    this.o = makeCtx(px);
    this.e = makeCtx(px);
    this.rng = new Rng(seed);
    this.k = px / REF;
    for (const c of [this.a, this.h, this.o, this.e]) c.setTransform(this.k, 0, 0, this.k, 0, 0);
    this.e.fillStyle = '#000';
    this.e.fillRect(0, 0, REF, REF);
  }

  rnd(): number {
    return this.rng.next();
  }

  r(min: number, max: number): number {
    return this.rng.float(min, max);
  }

  pick(scheme: Scheme): Paint {
    return PAINT[this.rng.weighted(scheme, ([, w]) => w)[0]];
  }

  /**
   * Per-pixel material pass over the panel layout: paint, bevels, seams, chipped edges,
   * cavity dirt, drips and pitting. `grime` scales all weathering.
   */
  raster(grime: number): void {
    const { px, k } = this;
    const n = px * px;
    const id = new Int16Array(n).fill(-1);
    this.panels.forEach((p, i) => {
      const x0 = Math.max(0, Math.round(p.x * k));
      const x1 = Math.min(px, Math.round((p.x + p.w) * k));
      const y0 = Math.max(0, Math.round(p.y * k));
      const y1 = Math.min(px, Math.round((p.y + p.h) * k));
      for (let y = y0; y < y1; y++) id.fill(i, y * px + x0, y * px + x1);
    });
    const ox = Math.floor(this.rnd() * px);
    const oy = Math.floor(this.rnd() * px);
    const at = (f: Float32Array, x: number, y: number) => f[((y + oy) % px) * px + ((x + ox) % px)]!;
    const alb = new ImageData(px, px);
    const hgt = new ImageData(px, px);
    const orm = new ImageData(px, px);
    const seamW = 1.6;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const i = y * px + x;
        const p = this.panels[id[i]!];
        const blotch = at(this.noise.blotch, x, y);
        const streak = at(this.noise.streak, x, y);
        const pit = at(this.noise.pit, x, y);
        const mid = at(this.noise.mid, x, y);
        let r = 40;
        let g = 42;
        let b = 46;
        let h = 0.5;
        let ao = 1;
        let rough = 0.5;
        let metal = 0.5;
        if (p) {
          const ux = (x + 0.5) / k;
          const uy = (y + 0.5) / k;
          const d = Math.min(ux - p.x, p.x + p.w - ux, uy - p.y, p.y + p.h - uy);
          const top = uy - p.y;
          // Height: seam groove, rounded bevel, panel lift, pitting.
          const inGroove = d < seamW;
          const bevel = inGroove ? 0 : Math.min(1, (d - seamW) / p.bevel);
          const bevelS = bevel * bevel * (3 - 2 * bevel);
          h = inGroove ? 0.2 : 0.42 + p.lift + bevelS * 0.12;
          h += (pit - 0.5) * 0.025 + (mid - 0.5) * 0.02;
          // Edge wear: chips along bevels, broken up by noise.
          const edge = inGroove ? 0 : 1 - Math.min(1, (d - seamW) / 7);
          const chip = edge * 0.9 + (pit - 0.5) * 0.9 + (blotch - 0.5) * 0.4 - (1 - p.paint.wear) * 0.9;
          const worn = chip > 0.55 ? 1 : chip > 0.45 ? (chip - 0.45) * 10 : 0;
          // Dirt: cavities near seams, blotches, drips running down from each panel's top.
          const cavity = inGroove ? 1 : Math.max(0, 1 - (d - seamW) / 10);
          const drip = streak > 0.55 ? (streak - 0.55) * 2.2 * Math.max(0, 1 - top / 180) : 0;
          const dirt = Math.min(1, grime * (cavity * 0.55 + Math.max(0, blotch - 0.45) * 0.9 + drip * 0.8));
          const tone = 0.88 + (mid - 0.5) * 0.25;
          const c = p.paint.c;
          r = (c[0] * tone * (1 - worn) + BARE[0] * worn) * (1 - dirt * 0.65);
          g = (c[1] * tone * (1 - worn) + BARE[1] * worn) * (1 - dirt * 0.66);
          b = (c[2] * tone * (1 - worn) + BARE[2] * worn) * (1 - dirt * 0.7);
          if (inGroove) {
            r *= 0.3;
            g *= 0.3;
            b *= 0.3;
          }
          ao = inGroove ? 0.3 : 1 - cavity * 0.35;
          rough = Math.min(1, p.paint.rough * (1 - worn) + 0.24 * worn + dirt * 0.3 + (pit - 0.5) * 0.12);
          metal = p.paint.metal * (1 - worn) + worn;
        }
        const j = i * 4;
        alb.data[j] = r;
        alb.data[j + 1] = g;
        alb.data[j + 2] = b;
        alb.data[j + 3] = 255;
        const hv = Math.max(0, Math.min(255, h * 255));
        hgt.data[j] = hv;
        hgt.data[j + 1] = hv;
        hgt.data[j + 2] = hv;
        hgt.data[j + 3] = 255;
        orm.data[j] = ao * 255;
        orm.data[j + 1] = rough * 255;
        orm.data[j + 2] = metal * 255;
        orm.data[j + 3] = 255;
      }
    }
    this.a.putImageData(alb, 0, 0);
    this.h.putImageData(hgt, 0, 0);
    this.o.putImageData(orm, 0, 0);
    for (const d of this.decals) d();
  }

  /**
   * Per-pixel rock: ridged relief, horizontal strata, crack networks (iso-lines of a noise
   * field). With `glow` > 0 the cracks are molten: dark basalt with hot, emissive fissures.
   */
  rasterRock(base: RGB, glow: number): void {
    const { px } = this;
    const alb = new ImageData(px, px);
    const hgt = new ImageData(px, px);
    const orm = new ImageData(px, px);
    const emi = new ImageData(px, px);
    const ox = Math.floor(this.rnd() * px);
    const oy = Math.floor(this.rnd() * px);
    const at = (f: Float32Array, x: number, y: number) => f[((y + oy) % px) * px + ((x + ox) % px)]!;
    const bands = 5;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const blotch = at(this.noise.blotch, x, y);
        const mid = at(this.noise.mid, x, y);
        const pit = at(this.noise.pit, x, y);
        const streak = at(this.noise.streak, x, y);
        const ridge = 1 - Math.abs(mid * 2 - 1);
        const strata = 0.5 + 0.5 * Math.sin(2 * Math.PI * ((bands * y) / px + blotch * 0.9));
        const crackD = Math.abs(at(this.noise.blotch, (x * 3) % px, (y * 3) % px) - 0.5);
        const crack = Math.max(0, 1 - crackD / 0.035);
        const halo = Math.max(0, 1 - crackD / 0.12);
        let h = 0.35 + ridge * 0.3 + blotch * 0.2 + pit * 0.1 + strata * 0.06 - crack * 0.3;
        h = Math.min(1, Math.max(0, h));
        const shade = (0.62 + ridge * 0.35 + strata * 0.12 + (pit - 0.5) * 0.2) * (1 - crack * 0.8);
        const j = (y * px + x) * 4;
        const heat = glow * halo * halo;
        alb.data[j] = base[0] * shade + heat * 90;
        alb.data[j + 1] = base[1] * shade + heat * 30;
        alb.data[j + 2] = base[2] * shade;
        alb.data[j + 3] = 255;
        const hv = h * 255;
        hgt.data[j] = hv;
        hgt.data[j + 1] = hv;
        hgt.data[j + 2] = hv;
        hgt.data[j + 3] = 255;
        orm.data[j] = (1 - crack * 0.6) * 255;
        orm.data[j + 1] = Math.min(1, 0.78 + (streak - 0.5) * 0.3 + crack * 0.1) * 255;
        orm.data[j + 2] = 0.02 * 255;
        orm.data[j + 3] = 255;
        emi.data[j] = glow * Math.min(1, crack * 1.2 + halo * 0.25) * 255;
        emi.data[j + 3] = 255;
      }
    }
    this.a.putImageData(alb, 0, 0);
    this.h.putImageData(hgt, 0, 0);
    this.o.putImageData(orm, 0, 0);
    if (glow > 0) this.e.putImageData(emi, 0, 0);
    for (const d of this.decals) d();
  }

  /**
   * Pixels flipped vertically: texture row 0 is v = 0, so this puts the canvas's top at the
   * top of each face (faces map v upward), keeping stencils and lights upright.
   */
  pixels(c: Ctx): Uint8ClampedArray {
    const src = c.getImageData(0, 0, this.px, this.px).data;
    const out = new Uint8ClampedArray(src.length);
    const row = this.px * 4;
    for (let y = 0; y < this.px; y++) out.set(src.subarray(y * row, (y + 1) * row), (this.px - 1 - y) * row);
    return out;
  }

  /** Axis-aligned rect drawn with wrap-around so the tile stays seamless. */
  each(x: number, y: number, w: number, h: number, fn: (x: number, y: number) => void): void {
    const s = this.s;
    for (const ox of [0, -s, s]) {
      for (const oy of [0, -s, s]) {
        if (x + ox + w < 0 || x + ox > s || y + oy + h < 0 || y + oy > s) continue;
        fn(x + ox, y + oy);
      }
    }
  }

  rect(x: number, y: number, w: number, h: number, o: Feature): void {
    this.each(x, y, w, h, (px, py) => {
      if (o.albedo) {
        this.a.fillStyle = o.albedo;
        this.a.fillRect(px, py, w, h);
      }
      if (o.height !== undefined) {
        const v = Math.round(Math.max(0, Math.min(255, o.height)));
        this.h.fillStyle = `rgb(${v},${v},${v})`;
        this.h.fillRect(px, py, w, h);
      }
      if (o.rough !== undefined || o.metal !== undefined || o.ao !== undefined) {
        const ao = Math.round((o.ao ?? 1) * 255);
        const ro = Math.round((o.rough ?? 0.5) * 255);
        const me = Math.round((o.metal ?? 0.9) * 255);
        this.o.fillStyle = `rgb(${ao},${ro},${me})`;
        this.o.fillRect(px, py, w, h);
      }
      if (o.emissive) {
        this.e.fillStyle = o.emissive;
        this.e.fillRect(px, py, w, h);
      }
    });
  }

  circle(x: number, y: number, r: number, o: { albedo?: string; height?: number; emissive?: string }): void {
    this.each(x - r, y - r, r * 2, r * 2, (px, py) => {
      const cx = px + r;
      const cy = py + r;
      if (o.albedo) {
        this.a.fillStyle = o.albedo;
        this.a.beginPath();
        this.a.arc(cx, cy, r, 0, Math.PI * 2);
        this.a.fill();
      }
      if (o.height !== undefined) {
        const g = this.h.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
        const v = Math.round(o.height);
        g.addColorStop(0, `rgb(${v},${v},${v})`);
        g.addColorStop(1, 'rgba(128,128,128,0)');
        this.h.fillStyle = g;
        this.h.beginPath();
        this.h.arc(cx, cy, r, 0, Math.PI * 2);
        this.h.fill();
      }
      if (o.emissive) {
        const g = this.e.createRadialGradient(cx, cy, 0, cx, cy, r * 2.2);
        g.addColorStop(0, o.emissive);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        this.e.fillStyle = g;
        this.e.fillRect(cx - r * 2.2, cy - r * 2.2, r * 4.4, r * 4.4);
      }
    });
  }

  rivetRow(x0: number, y0: number, x1: number, y1: number, step: number, r: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.floor(len / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, { albedo: '#8a909a', height: 200 });
    }
  }

  vents(x: number, y: number, w: number, h: number, slots: number, glow: string | null): void {
    this.rect(x - 3, y - 3, w + 6, h + 6, { albedo: '#1a1d22', height: 95, rough: 0.5, metal: 0.9 });
    for (let i = 0; i < slots; i++) {
      const sx = x + ((i + 0.5) / slots) * w - 2;
      this.rect(sx, y, 4, h, {
        albedo: '#040506',
        height: 15,
        rough: 0.9,
        ao: 0.15,
        ...(glow ? { emissive: glow } : {}),
      });
    }
  }

  hazard(x: number, y: number, w: number, h: number): void {
    this.each(x, y, w, h, (px, py) => {
      for (const c of [this.a, this.o]) {
        c.save();
        c.beginPath();
        c.rect(px, py, w, h);
        c.clip();
      }
      this.a.fillStyle = '#17181b';
      this.a.fillRect(px, py, w, h);
      this.a.fillStyle = '#c99a1c';
      this.o.fillStyle = 'rgb(255,150,20)';
      const step = 26;
      for (let k = -h; k < w + h; k += step * 2) {
        for (const c of [this.a, this.o]) {
          c.beginPath();
          c.moveTo(px + k, py + h);
          c.lineTo(px + k + step, py + h);
          c.lineTo(px + k + step + h, py);
          c.lineTo(px + k + h, py);
          c.closePath();
          c.fill();
        }
      }
      this.a.restore();
      this.o.restore();
    });
  }

  stencil(text: string, x: number, y: number, size: number, alpha = 0.3): void {
    this.a.font = `700 ${size}px "Chakra Petch", "Rajdhani", monospace`;
    this.a.fillStyle = `rgba(214,218,222,${alpha})`;
    this.a.fillText(text, x, y);
    this.o.font = this.a.font;
    this.o.fillStyle = 'rgba(255,150,20,0.5)';
    this.o.fillText(text, x, y);
  }
}

const CODES = ['A-07', 'MK IV', '▲ 12', 'K-9', 'HX-2', 'VNT', '∆ 05', 'S-3', 'DK 2'];
/** Emissive mask channels (see header). */
const WARM = 'rgba(255,0,0,0.95)';
const ACCENT = 'rgba(0,255,0,0.95)';
const ALERT = 'rgba(0,0,255,0.95)';
const EMBER = 'rgba(255,0,0,0.35)';

/**
 * Recursive subdivision into kit-bashed panels. Children usually inherit their parent's
 * paint so the hull reads as large painted sections with the odd replaced plate.
 */
function plates(
  p: Painter,
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  detail: number,
  scheme: Scheme,
  paint: Paint = p.pick(scheme),
): void {
  if (depth > 0 && (w > 56 || h > 56) && p.rnd() < 0.88) {
    const inherit = (): Paint => (p.rnd() < 0.72 ? paint : p.pick(scheme));
    if (w > h ? p.rnd() < 0.8 : p.rnd() < 0.2) {
      const cut = Math.round(w * p.r(0.3, 0.7));
      plates(p, x, y, cut, h, depth - 1, detail, scheme, inherit());
      plates(p, x + cut, y, w - cut, h, depth - 1, detail, scheme, inherit());
    } else {
      const cut = Math.round(h * p.r(0.3, 0.7));
      plates(p, x, y, w, cut, depth - 1, detail, scheme, inherit());
      plates(p, x, y + cut, w, h - cut, depth - 1, detail, scheme, inherit());
    }
    return;
  }
  p.panels.push({
    x,
    y,
    w,
    h,
    paint,
    lift: p.rnd() < 0.2 ? p.r(-0.08, 0.1) : 0,
    bevel: p.r(3, 7),
  });
  const roll = p.rnd();
  if (roll < 0.3 * detail && w > 40 && h > 40) {
    p.decals.push(() => {
      p.rivetRow(x + 8, y + 8, x + w - 8, y + 8, 18, 2.4);
      p.rivetRow(x + 8, y + h - 8, x + w - 8, y + h - 8, 18, 2.4);
    });
  } else if (roll < 0.46 * detail && w > 50 && h > 30) {
    const vw = Math.min(w - 20, p.r(40, 110));
    const vh = Math.min(h - 20, p.r(18, 60));
    const glow = p.rnd() < 0.3 ? EMBER : null;
    p.decals.push(() =>
      p.vents(x + (w - vw) / 2, y + (h - vh) / 2, vw, vh, Math.max(3, Math.floor(vw / 10)), glow),
    );
  } else if (roll < 0.52 * detail && w > 30 && h > 30) {
    const col = p.rnd() < 0.5 ? ACCENT : ALERT;
    p.decals.push(() => p.circle(x + w / 2, y + h / 2, 4, { albedo: '#0a0c10', height: 60, emissive: col }));
  }
}

function paintLayer(p: Painter, layer: number): void {
  const s = p.s;
  switch (layer) {
    case LAYER.PLATES:
      plates(p, 0, 0, s, s, 3, 0.8, SCHEMES.hull!);
      p.raster(0.8);
      break;
    case LAYER.PANELS: {
      plates(p, 0, 0, s, s, 4, 1.2, SCHEMES.mixed!);
      p.raster(0.9);
      const code = CODES[Math.floor(p.rnd() * CODES.length)]!;
      p.stencil(code, s * p.r(0.1, 0.5), s * p.r(0.2, 0.9), 30);
      break;
    }
    case LAYER.GREEBLE: {
      plates(p, 0, 0, s, s, 6, 1.6, SCHEMES.tech!);
      p.raster(1.1);
      for (let i = 0; i < 12; i++) {
        const w = p.r(20, 90);
        const h = p.r(10, 30);
        p.rect(p.r(0, s), p.r(0, s), w, h, { albedo: '#3a3f47', height: 200, rough: 0.35, metal: 0.95 });
      }
      break;
    }
    case LAYER.GRILLE:
      plates(p, 0, 0, s, s, 1, 0, SCHEMES.tech!);
      p.raster(0.7);
      for (let x = 0; x < s; x += s / 16) {
        p.rect(x + 3, 0, s / 16 - 6, s, { albedo: '#060709', height: 20, rough: 0.9, ao: 0.2 });
      }
      for (let y = 0; y < s; y += s / 4) p.rect(0, y, s, 10, { albedo: '#3a3f47', height: 170, rough: 0.35 });
      break;
    case LAYER.WINDOWS: {
      plates(p, 0, 0, s, s, 2, 0.3, SCHEMES.hull!);
      p.raster(0.7);
      const rows = 4;
      for (let r = 0; r < rows; r++) {
        const y = (r + 0.5) * (s / rows) - s / 24;
        p.rect(0, y - 6, s, s / 12 + 12, { albedo: '#17191d', height: 95, rough: 0.4, metal: 0.9 });
        const cols = 10;
        for (let c = 0; c < cols; c++) {
          const x = (c + 0.1) * (s / cols);
          const lit = p.rnd() < 0.65;
          // Glass: glossy dielectric, recessed.
          p.rect(x, y, (s / cols) * 0.8, s / 12, {
            albedo: '#07090c',
            height: 60,
            rough: 0.06,
            metal: 0,
            ...(lit ? { emissive: p.rnd() < 0.8 ? WARM : ACCENT } : {}),
          });
        }
      }
      break;
    }
    case LAYER.HAZARD:
      plates(p, 0, 0, s, s, 2, 0.5, SCHEMES.deck!);
      p.raster(1.2);
      p.hazard(0, s * 0.35, s, s * 0.3);
      p.rivetRow(10, s * 0.32, s - 10, s * 0.32, 24, 3);
      p.rivetRow(10, s * 0.68, s - 10, s * 0.68, 24, 3);
      break;
    case LAYER.CIRCUIT: {
      plates(p, 0, 0, s, s, 1, 0, [['black', 1]]);
      p.raster(0.4);
      for (let i = 0; i < 26; i++) {
        let x = Math.floor(p.r(0, s) / 16) * 16;
        let y = Math.floor(p.r(0, s) / 16) * 16;
        const col = p.rnd() < 0.85 ? ACCENT : ALERT;
        for (let k = 0; k < 7; k++) {
          const horiz = p.rnd() < 0.5;
          const len = Math.floor(p.r(2, 8)) * 16;
          const w = horiz ? len : 3;
          const h = horiz ? 3 : len;
          p.rect(x, y, w, h, { albedo: '#2a3440', height: 150, rough: 0.3, metal: 1, emissive: col });
          if (horiz) x += len;
          else y += len;
        }
        p.circle(x, y, 4, { albedo: '#aab4c4', height: 190, emissive: col });
      }
      break;
    }
    case LAYER.RIBS:
      plates(p, 0, 0, s, s, 2, 0.6, SCHEMES.hull!);
      p.raster(1);
      for (let x = 0; x < s; x += s / 4) {
        p.rect(x, 0, s / 14, s, { albedo: '#50555e', height: 235, rough: 0.3, metal: 0.95 });
        p.rect(x + s / 14, 0, 4, s, { albedo: '#07080a', height: 30, ao: 0.3 });
      }
      break;
    case LAYER.STRIPS:
      plates(p, 0, 0, s, s, 3, 0.5, SCHEMES.hull!);
      p.raster(0.7);
      for (const y of [s * 0.25, s * 0.75]) {
        p.rect(0, y - 7, s, 14, { albedo: '#101318', height: 90 });
        p.rect(0, y - 3, s, 6, { albedo: '#dfe8ff', height: 150, rough: 0.2, metal: 0, emissive: ACCENT });
      }
      break;
    case LAYER.DECK: {
      plates(p, 0, 0, s, s, 2, 0.3, SCHEMES.deck!);
      p.raster(1.1);
      p.rect(s * 0.1, s * 0.47, s * 0.8, 10, { albedo: 'rgba(214,170,30,0.7)', rough: 0.65, metal: 0 });
      if (p.rnd() < 0.6) p.stencil(CODES[Math.floor(p.rnd() * CODES.length)]!, s * 0.12, s * 0.4, 56, 0.22);
      for (let i = 0; i < 4; i++) {
        p.circle(s * (0.2 + i * 0.2), s * 0.62, 5, {
          albedo: '#0a0c10',
          height: 60,
          emissive: i % 2 ? WARM : ALERT,
        });
      }
      break;
    }
    case LAYER.RADIATOR:
      plates(p, 0, 0, s, s, 0, 0, [['gunmetal', 1]]);
      p.raster(0.5);
      for (let x = 0; x < s; x += 12) {
        p.rect(x, 0, 6, s, { albedo: '#60666f', height: 220, rough: 0.22, metal: 1 });
        p.rect(x + 6, 0, 6, s, { albedo: '#0e1014', height: 40, ao: 0.4 });
      }
      p.rect(0, s * 0.48, s, s * 0.04, { albedo: '#2c323c', height: 180, emissive: EMBER });
      break;
    case LAYER.ROCK:
      p.rasterRock([118, 104, 92], 0);
      break;
    case LAYER.MAGMA:
      p.rasterRock([52, 44, 40], 1);
      break;
    case LAYER.PLATES_RUST:
      plates(p, 0, 0, s, s, 3, 0.9, SCHEMES.rust!);
      p.raster(1.7);
      break;
    case LAYER.PANELS_CLEAN: {
      plates(p, 0, 0, s, s, 4, 1, SCHEMES.clean!);
      p.raster(0.35);
      const code = CODES[Math.floor(p.rnd() * CODES.length)]!;
      p.stencil(code, s * p.r(0.1, 0.5), s * p.r(0.2, 0.9), 30, 0.45);
      break;
    }
    default:
      plates(p, 0, 0, s, s, 2, 0.4, SCHEMES.deck!);
      p.raster(2.2);
      break;
  }
}

/** Height → tangent-space normal (wrapping, so the tile stays seamless). Rows run along +v. */
function heightToNormal(
  h: Uint8ClampedArray,
  s: number,
  strength: number,
  out: Uint8Array,
  offset: number,
): void {
  const at = (x: number, y: number) => h[(((y + s) % s) * s + ((x + s) % s)) * 4]! / 255;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      // Sobel: smoother than a central difference, keeps bevels soft.
      const tl = at(x - 1, y - 1);
      const t = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const l = at(x - 1, y);
      const r = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const b = at(x, y + 1);
      const br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br - tl - 2 * l - bl) * 0.25 * strength;
      const dy = (bl + 2 * b + br - tl - 2 * t - tr) * 0.25 * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = offset + (y * s + x) * 4;
      out[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
}

function arrayTexture(data: Uint8Array, s: number, srgb: boolean, anisotropy: number): DataArrayTexture {
  const t = new DataArrayTexture(data, s, s, LAYER_COUNT);
  t.type = UnsignedByteType;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function macroTexture(size: number, noise: NoiseSet, anisotropy: number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = noise.blotch[i]! * 255;
    data[i * 4 + 1] = noise.streak[i]! * 255;
    data[i * 4 + 2] = noise.pit[i]! * 255;
    data[i * 4 + 3] = noise.mid[i]! * 255;
  }
  const t = new DataTexture(data, size, size);
  t.type = UnsignedByteType;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

let yieldChannel: MessageChannel | null = null;
const yielded: (() => void)[] = [];

/**
 * Yields to the event loop between layers (so the loading screen stays alive). A message
 * rather than a timer: timers in a background tab are throttled to one a second or slower,
 * which would stall boot for minutes if the player switches tabs while it loads. One channel,
 * held for good: a throwaway MessageChannel can be garbage collected before its message is
 * delivered, and boot then waits forever.
 */
function nextFrame(): Promise<void> {
  if (!yieldChannel) {
    yieldChannel = new MessageChannel();
    yieldChannel.port1.onmessage = () => yielded.shift()?.();
  }
  const ch = yieldChannel;
  return new Promise<void>((r) => {
    yielded.push(r);
    ch.port2.postMessage(0);
  });
}

export async function generateHullTextures(
  size: number,
  anisotropy = 8,
  onLayer?: (layer: number, count: number) => void,
): Promise<HullTextureSet> {
  const rng = new Rng('hull-noise');
  const noise: NoiseSet = {
    blotch: tileNoise(size, 4, 4, 5, rng),
    streak: tileNoise(size, 24, 3, 3, rng),
    pit: tileNoise(size, 64, 64, 2, rng),
    mid: tileNoise(size, 12, 12, 3, rng),
  };
  const layerBytes = size * size * 4;
  const albedo = new Uint8Array(layerBytes * LAYER_COUNT);
  const orm = new Uint8Array(layerBytes * LAYER_COUNT);
  const normal = new Uint8Array(layerBytes * LAYER_COUNT);
  const emissive = new Uint8Array(layerBytes * LAYER_COUNT);
  for (let layer = 0; layer < LAYER_COUNT; layer++) {
    onLayer?.(layer, LAYER_COUNT);
    const p = new Painter(size, `hull/${layer}`, noise);
    paintLayer(p, layer);
    const off = layer * layerBytes;
    albedo.set(p.pixels(p.a), off);
    emissive.set(p.pixels(p.e), off);
    const h = p.pixels(p.h);
    const o = p.pixels(p.o);
    for (let i = 0; i < layerBytes; i += 4) o[i + 3] = h[i]!;
    orm.set(o, off);
    heightToNormal(h, size, (7 * size) / REF, normal, off);
    await nextFrame();
  }
  return {
    albedo: arrayTexture(albedo, size, true, anisotropy),
    orm: arrayTexture(orm, size, false, anisotropy),
    normal: arrayTexture(normal, size, false, anisotropy),
    emissive: arrayTexture(emissive, size, false, anisotropy),
    macro: macroTexture(size, noise, anisotropy),
    size,
  };
}
