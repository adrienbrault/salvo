import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three/webgpu';

/**
 * Procedural PBR texture set for the megastructure, painted at boot with Canvas2D
 * (no downloaded assets). Every layer is a seamless tile; layers live in texture arrays
 * so geometry can pick one per face and still use hardware repeat + mipmaps.
 *
 * Maps: albedo (sRGB), ORM (R = AO, G = roughness, B = metalness), normal (from a height
 * pass) and an emissive *mask* whose channels are light classes the shader colors and
 * animates at runtime: R = warm interior light, G = sector accent, B = alert red.
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
} as const;
export const LAYER_COUNT = 12;

export interface HullTextureSet {
  albedo: DataArrayTexture;
  orm: DataArrayTexture;
  normal: DataArrayTexture;
  emissive: DataArrayTexture;
  size: number;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx } {
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Ctx | null;
  if (!ctx) throw new Error('2D canvas unavailable');
  return { canvas, ctx };
}

/** Logical drawing size: layers are designed at 512 and scaled to the output resolution. */
const REF = 512;

/** Draws into all four maps at once so details line up perfectly. */
class Painter {
  readonly s = REF;
  readonly a: Ctx;
  readonly h: Ctx;
  readonly o: Ctx;
  readonly e: Ctx;
  readonly rnd: () => number;

  constructor(
    readonly px: number,
    seed: number,
  ) {
    this.a = makeCanvas(px).ctx;
    this.h = makeCanvas(px).ctx;
    this.o = makeCanvas(px).ctx;
    this.e = makeCanvas(px).ctx;
    this.rnd = mulberry32(seed);
    const k = px / REF;
    for (const c of [this.a, this.h, this.o, this.e]) c.setTransform(k, 0, 0, k, 0, 0);
    this.fill(this.a, '#2b313b');
    this.fill(this.h, 'rgb(128,128,128)');
    this.fill(this.o, 'rgb(255,120,220)'); // AO 1, rough ~0.47, metal ~0.86
    this.fill(this.e, '#000');
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

  private fill(c: Ctx, style: string): void {
    c.fillStyle = style;
    c.fillRect(0, 0, this.s, this.s);
  }

  r(min: number, max: number): number {
    return min + (max - min) * this.rnd();
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

  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    o: { albedo?: string; height?: number; rough?: number; metal?: number; emissive?: string; ao?: number },
  ): void {
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
        const ro = Math.round((o.rough ?? 0.47) * 255);
        const me = Math.round((o.metal ?? 0.86) * 255);
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

  /** Recessed seam around a rectangle (dark line in albedo, groove in height). */
  seam(x: number, y: number, w: number, h: number, width = 2): void {
    const d = { albedo: '#0b0d11', height: 40, rough: 0.8, ao: 0.35 };
    this.rect(x, y, w, width, d);
    this.rect(x, y + h - width, w, width, d);
    this.rect(x, y, width, h, d);
    this.rect(x + w - width, y, width, h, d);
    // Light catch on the upper/left bevel.
    this.rect(x + width, y + width, w - width * 2, 1, { albedo: 'rgba(210,225,255,0.10)' });
    this.rect(x + width, y + width, 1, h - width * 2, { albedo: 'rgba(210,225,255,0.06)' });
  }

  rivetRow(x0: number, y0: number, x1: number, y1: number, step: number, r: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.floor(len / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, { albedo: '#5b6472', height: 210 });
    }
  }

  vents(
    x: number,
    y: number,
    w: number,
    h: number,
    slots: number,
    vertical: boolean,
    glow: string | null,
  ): void {
    this.rect(x - 3, y - 3, w + 6, h + 6, { albedo: '#1a1e25', height: 110 });
    for (let i = 0; i < slots; i++) {
      const t = (i + 0.5) / slots;
      const sx = vertical ? x + t * w - 2 : x;
      const sy = vertical ? y : y + t * h - 2;
      const sw = vertical ? 4 : w;
      const sh = vertical ? h : 4;
      this.rect(sx, sy, sw, sh, {
        albedo: '#040507',
        height: 10,
        rough: 0.9,
        ao: 0.1,
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
      this.a.fillStyle = '#16181d';
      this.a.fillRect(px, py, w, h);
      this.a.fillStyle = '#d6a21e';
      this.o.fillStyle = 'rgb(255,150,60)';
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

  stencil(text: string, x: number, y: number, size: number, alpha = 0.16): void {
    this.a.font = `700 ${size}px "Chakra Petch", "Rajdhani", monospace`;
    this.a.fillStyle = `rgba(220,228,240,${alpha})`;
    this.a.fillText(text, x, y);
    this.o.font = this.a.font;
    this.o.fillStyle = 'rgba(255,170,40,0.5)';
    this.o.fillText(text, x, y);
  }

  /** Weathering: grime pools, rain streaks, fine scratches, grain. */
  weather(amount: number): void {
    const s = this.s;
    for (let i = 0; i < 14 * amount; i++) {
      const x = this.rnd() * s;
      const y = this.rnd() * s;
      const r = this.r(s * 0.05, s * 0.25);
      this.each(x - r, y - r, r * 2, r * 2, (px, py) => {
        const g = this.a.createRadialGradient(px + r, py + r, 0, px + r, py + r, r);
        g.addColorStop(0, `rgba(8,6,4,${0.22 * amount})`);
        g.addColorStop(1, 'rgba(8,6,4,0)');
        this.a.fillStyle = g;
        this.a.fillRect(px, py, r * 2, r * 2);
        const go = this.o.createRadialGradient(px + r, py + r, 0, px + r, py + r, r);
        go.addColorStop(0, 'rgba(170,230,120,0.35)');
        go.addColorStop(1, 'rgba(170,230,120,0)');
        this.o.fillStyle = go;
        this.o.fillRect(px, py, r * 2, r * 2);
      });
    }
    for (let i = 0; i < 40 * amount; i++) {
      const x = this.rnd() * s;
      const y = this.rnd() * s;
      const len = this.r(20, s * 0.3);
      this.rect(x, y, this.r(1, 3), len, { albedo: `rgba(10,8,6,${this.r(0.05, 0.16)})` });
    }
    this.a.lineWidth = 1;
    for (let i = 0; i < 60 * amount; i++) {
      const x = this.rnd() * s;
      const y = this.rnd() * s;
      const ang = this.rnd() * Math.PI;
      const len = this.r(6, 60);
      this.a.strokeStyle = `rgba(200,210,225,${this.r(0.05, 0.18)})`;
      this.a.beginPath();
      this.a.moveTo(x, y);
      this.a.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      this.a.stroke();
      this.o.strokeStyle = 'rgba(255,60,255,0.5)';
      this.o.beginPath();
      this.o.moveTo(x, y);
      this.o.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      this.o.stroke();
    }
    const img = this.a.getImageData(0, 0, this.px, this.px);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (this.rnd() - 0.5) * 10;
      d[i] = Math.max(0, Math.min(255, d[i]! + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n * 1.1));
    }
    this.a.putImageData(img, 0, 0);
  }
}

const CODES = ['A-07', 'SLV', 'MK IV', '03', '▲ 12', 'K-9', 'HX-2', 'DX', '41', 'VNT', 'B7', '∆ 05'];
/** Emissive mask channels (see header). */
const WARM = 'rgba(255,0,0,0.95)';
const ACCENT = 'rgba(0,255,0,0.95)';
const ALERT = 'rgba(0,0,255,0.95)';
const EMBER = 'rgba(255,0,0,0.35)';

/** Recursive subdivision into kit-bashed panels. */
function plates(p: Painter, x: number, y: number, w: number, h: number, depth: number, detail: number): void {
  if (depth > 0 && (w > 60 || h > 60) && p.rnd() < 0.85) {
    if (w > h ? p.rnd() < 0.8 : p.rnd() < 0.2) {
      const cut = Math.round(w * p.r(0.3, 0.7));
      plates(p, x, y, cut, h, depth - 1, detail);
      plates(p, x + cut, y, w - cut, h, depth - 1, detail);
    } else {
      const cut = Math.round(h * p.r(0.3, 0.7));
      plates(p, x, y, w, cut, depth - 1, detail);
      plates(p, x, y + cut, w, h - cut, depth - 1, detail);
    }
    return;
  }
  const tone = Math.round(p.r(36, 58));
  const blue = tone + Math.round(p.r(4, 12));
  p.rect(x, y, w, h, {
    albedo: `rgb(${tone},${tone + 4},${blue})`,
    height: p.r(120, 170),
    rough: p.r(0.35, 0.65),
    metal: p.r(0.75, 0.95),
  });
  p.seam(x, y, w, h, 2);
  const roll = p.rnd();
  if (roll < 0.35 * detail && w > 40 && h > 40) {
    p.rivetRow(x + 8, y + 8, x + w - 8, y + 8, 18, 2.6);
    p.rivetRow(x + 8, y + h - 8, x + w - 8, y + h - 8, 18, 2.6);
  } else if (roll < 0.5 * detail && w > 50 && h > 30) {
    const vw = Math.min(w - 20, p.r(40, 110));
    const vh = Math.min(h - 20, p.r(18, 60));
    p.vents(
      x + (w - vw) / 2,
      y + (h - vh) / 2,
      vw,
      vh,
      Math.max(3, Math.floor(vw / 10)),
      true,
      p.rnd() < 0.3 ? EMBER : null,
    );
  } else if (roll < 0.62 * detail && w > 70 && h > 26) {
    p.stencil(
      CODES[Math.floor(p.rnd() * CODES.length)]!,
      x + 10,
      y + Math.min(h - 8, 40),
      Math.min(34, h * 0.6),
    );
  } else if (roll < 0.7 * detail && w > 30 && h > 30) {
    p.circle(x + w / 2, y + h / 2, 4, {
      albedo: '#0a0c10',
      height: 60,
      emissive: p.rnd() < 0.5 ? ACCENT : ALERT,
    });
  }
}

function paintLayer(p: Painter, layer: number): void {
  const s = p.s;
  switch (layer) {
    case LAYER.PLATES:
      plates(p, 0, 0, s, s, 3, 0.8);
      p.weather(0.8);
      break;
    case LAYER.PANELS:
      plates(p, 0, 0, s, s, 4, 1.2);
      p.weather(1);
      break;
    case LAYER.GREEBLE: {
      plates(p, 0, 0, s, s, 6, 1.6);
      for (let i = 0; i < 10; i++) {
        const w = p.r(20, 90);
        const h = p.r(10, 30);
        p.rect(p.r(0, s), p.r(0, s), w, h, { albedo: '#39404c', height: 200, rough: 0.4 });
      }
      p.weather(1.2);
      break;
    }
    case LAYER.GRILLE:
      p.rect(0, 0, s, s, { albedo: '#1d2229', height: 120, rough: 0.6 });
      for (let x = 0; x < s; x += s / 16) {
        p.rect(x + 3, 0, s / 16 - 6, s, { albedo: '#07080b', height: 20, rough: 0.9, ao: 0.2 });
      }
      for (let y = 0; y < s; y += s / 4) p.rect(0, y, s, 10, { albedo: '#2e343f', height: 170 });
      p.weather(0.8);
      break;
    case LAYER.WINDOWS: {
      plates(p, 0, 0, s, s, 2, 0.4);
      const rows = 4;
      for (let r = 0; r < rows; r++) {
        const y = (r + 0.5) * (s / rows) - s / 24;
        p.rect(0, y - 6, s, s / 12 + 12, { albedo: '#15181e', height: 100 });
        const cols = 10;
        for (let c = 0; c < cols; c++) {
          const x = (c + 0.1) * (s / cols);
          const lit = p.rnd() < 0.65;
          p.rect(x, y, (s / cols) * 0.8, s / 12, {
            albedo: '#0a0d12',
            height: 70,
            rough: 0.1,
            metal: 0.1,
            ...(lit ? { emissive: p.rnd() < 0.8 ? WARM : ACCENT } : {}),
          });
        }
      }
      p.weather(0.6);
      break;
    }
    case LAYER.HAZARD:
      plates(p, 0, 0, s, s, 2, 0.5);
      p.hazard(0, s * 0.35, s, s * 0.3);
      p.rivetRow(10, s * 0.32, s - 10, s * 0.32, 24, 3);
      p.rivetRow(10, s * 0.68, s - 10, s * 0.68, 24, 3);
      p.weather(1.3);
      break;
    case LAYER.CIRCUIT: {
      p.rect(0, 0, s, s, { albedo: '#15191f', height: 130, rough: 0.3, metal: 0.9 });
      for (let i = 0; i < 26; i++) {
        let x = Math.floor(p.r(0, s) / 16) * 16;
        let y = Math.floor(p.r(0, s) / 16) * 16;
        const col = p.rnd() < 0.85 ? ACCENT : ALERT;
        for (let k = 0; k < 7; k++) {
          const horiz = p.rnd() < 0.5;
          const len = Math.floor(p.r(2, 8)) * 16;
          const w = horiz ? len : 3;
          const h = horiz ? 3 : len;
          p.rect(x, y, w, h, { albedo: '#2a3440', height: 150, emissive: col });
          if (horiz) x += len;
          else y += len;
        }
        p.circle(x, y, 4, { albedo: '#aab4c4', height: 190, emissive: col });
      }
      p.weather(0.5);
      break;
    }
    case LAYER.RIBS:
      plates(p, 0, 0, s, s, 2, 0.6);
      for (let x = 0; x < s; x += s / 4) {
        p.rect(x, 0, s / 14, s, { albedo: '#414957', height: 235, rough: 0.35 });
        p.rect(x + s / 14, 0, 4, s, { albedo: '#07080b', height: 30, ao: 0.3 });
      }
      p.weather(1);
      break;
    case LAYER.STRIPS:
      plates(p, 0, 0, s, s, 3, 0.5);
      for (const y of [s * 0.25, s * 0.75]) {
        p.rect(0, y - 7, s, 14, { albedo: '#101318', height: 90 });
        p.rect(0, y - 3, s, 6, { albedo: '#dfe8ff', height: 150, rough: 0.2, emissive: ACCENT });
      }
      p.weather(0.7);
      break;
    case LAYER.DECK: {
      plates(p, 0, 0, s, s, 2, 0.3);
      p.rect(s * 0.1, s * 0.47, s * 0.8, 10, { albedo: 'rgba(230,190,40,0.55)', rough: 0.7, metal: 0.2 });
      p.stencil(CODES[Math.floor(p.rnd() * CODES.length)]!, s * 0.12, s * 0.4, 64, 0.1);
      for (let i = 0; i < 4; i++) {
        p.circle(s * (0.2 + i * 0.2), s * 0.62, 5, {
          albedo: '#0a0c10',
          height: 60,
          emissive: i % 2 ? WARM : ALERT,
        });
      }
      p.weather(1.1);
      break;
    }
    case LAYER.RADIATOR:
      p.rect(0, 0, s, s, { albedo: '#23282f', height: 120, rough: 0.3, metal: 0.95 });
      for (let x = 0; x < s; x += 12) {
        p.rect(x, 0, 6, s, { albedo: '#4a5261', height: 220, rough: 0.25 });
        p.rect(x + 6, 0, 6, s, { albedo: '#0e1116', height: 40, ao: 0.4 });
      }
      p.rect(0, s * 0.48, s, s * 0.04, { albedo: '#2c323c', height: 180, emissive: EMBER });
      p.weather(0.6);
      break;
    default:
      plates(p, 0, 0, s, s, 2, 0.4);
      p.weather(2.2);
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
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
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

export function generateHullTextures(size: number, anisotropy = 8): HullTextureSet {
  const layerBytes = size * size * 4;
  const albedo = new Uint8Array(layerBytes * LAYER_COUNT);
  const orm = new Uint8Array(layerBytes * LAYER_COUNT);
  const normal = new Uint8Array(layerBytes * LAYER_COUNT);
  const emissive = new Uint8Array(layerBytes * LAYER_COUNT);
  for (let layer = 0; layer < LAYER_COUNT; layer++) {
    const p = new Painter(size, 1337 + layer * 7919);
    paintLayer(p, layer);
    const off = layer * layerBytes;
    albedo.set(p.pixels(p.a), off);
    orm.set(p.pixels(p.o), off);
    emissive.set(p.pixels(p.e), off);
    heightToNormal(p.pixels(p.h), size, (8 * size) / REF, normal, off);
  }
  return {
    albedo: arrayTexture(albedo, size, true, anisotropy),
    orm: arrayTexture(orm, size, false, anisotropy),
    normal: arrayTexture(normal, size, false, anisotropy),
    emissive: arrayTexture(emissive, size, false, anisotropy),
    size,
  };
}
