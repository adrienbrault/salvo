import {
  abs,
  Fn,
  float,
  Loop,
  max,
  mix,
  mx_fractal_noise_float,
  normalize,
  positionWorld,
  reflector,
  sin,
  smoothstep,
  step,
  texture,
  time,
  transformNormalToView,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node, Object3D } from 'three/webgpu';
import {
  Color,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshStandardNodeMaterial,
  NodeMaterial,
  PlaneGeometry,
  QuadMesh,
  RenderTarget,
  type Scene,
  type Texture,
  Vector2,
  Vector4,
  type WebGPURenderer,
} from 'three/webgpu';
import { FLOOR_Z, SCROLL_SPEED } from '../palette';
import type { FloorMode } from './biomes';

const MAX_DROPS = 24;
const MAX_SCORCH = 16;
const SIM_DT = 1 / 60;
/** Scorch marks fade over this many seconds (they mostly scroll away first); heat much faster. */
const CHAR_FADE = 25;
const HEAT_FADE = 2.2;

/** World-space rectangle covered by the ripple simulation (the trench floor, plus margin). */
const DOMAIN = { x0: -48, y0: -150, w: 96, h: 420 };

export interface SeaOptions {
  simSize: [number, number];
  reflectionScale: number;
  /** Tileable noise (the hull set's macro texture) for lava crust and cloud banks. */
  noise: Texture;
}

/**
 * The floor of the trench, in one of the biome's modes:
 *  - liquid metal: PBR metal with planar reflections (`reflector`) distorted by ripples;
 *  - lava: dark crust split by molten cracks, hotter where it is disturbed;
 *  - cloud: glowing cloud banks drifting under the scroll;
 *  - void: nothing (the mesh is hidden).
 * All share one material (modes are uniforms), so switching never compiles a pipeline.
 * Ripples come from a GPU wave-equation heightfield (ping-pong render targets, WebGPU and
 * WebGL2) fed by explosions and the ship's engine downwash, advected by the scroll.
 *
 * The same targets carry scorch (B: char, A: heat) left by explosions. It is advected in whole
 * texels so marks stay crisp, and the hull reads it too (`scorchAt`), so terraces and bridges
 * under a blast are burnt as well.
 */
export class Sea {
  readonly mesh: Mesh;
  private readonly rtA: RenderTarget;
  private readonly rtB: RenderTarget;
  private readonly simTex;
  private readonly heightTex;
  private readonly quad: QuadMesh;
  private readonly drops: Vector4[] = [];
  private readonly dropNode;
  private readonly scorches: Vector4[] = [];
  private readonly scorchNode;
  private pendingScorch: Vector4[] = [];
  /** Scroll the scorch channels have yet to catch up with, in texels (and as a uv offset). */
  private lagTexels = 0;
  private readonly scorchShift = uniform(0);
  private readonly scorchLag = uniform(0);
  private readonly texelsY: number;
  private readonly scrollUV = uniform(0);
  private readonly scroll = uniform(0);
  private readonly lava = uniform(0);
  private readonly cloud = uniform(0);
  private readonly glow = uniform(new Color(1, 0.35, 0.08));
  private pending: Vector4[] = [];
  private reflective = true;
  /**
   * What the floor never mirrors: ghost bullets and ships under the field read as more things
   * to dodge. Hidden for the reflection's render only.
   */
  readonly unreflected: Object3D[] = [];
  private acc = 0;
  private flip = false;

  constructor(
    private readonly renderer: WebGPURenderer,
    scene: Scene,
    opts: SeaOptions,
  ) {
    const [sw, sh] = opts.simSize;
    const rtOpts = {
      type: HalfFloatType,
      depthBuffer: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    };
    this.rtA = new RenderTarget(sw, sh, rtOpts);
    this.rtB = new RenderTarget(sw, sh, rtOpts);
    for (let i = 0; i < MAX_DROPS; i++) this.drops.push(new Vector4(0, 0, 1, 0));
    this.dropNode = uniformArray<'vec4'>(this.drops, 'vec4');
    for (let i = 0; i < MAX_SCORCH; i++) this.scorches.push(new Vector4(0, 0, 1, 0));
    this.scorchNode = uniformArray<'vec4'>(this.scorches, 'vec4');
    this.texelsY = sh;

    // ── Simulation pass ──────────────────────────────────────────────────────
    this.simTex = texture(this.rtA.texture);
    const texel = vec2(1 / sw, 1 / sh);
    const origin = vec2(DOMAIN.x0, DOMAIN.y0);
    const size = vec2(DOMAIN.w, DOMAIN.h);
    const simMat = new NodeMaterial();
    const prev = this.simTex;
    const drops = this.dropNode;
    const scorches = this.scorchNode;
    const scorchShift = this.scorchShift;
    const scrollUV = this.scrollUV;
    const noise = opts.noise;
    simMat.fragmentNode = Fn(() => {
      const st = uv().add(vec2(0, scrollUV));
      const c = prev.sample(st);
      const hN = prev.sample(st.add(vec2(0, texel.y))).x;
      const hS = prev.sample(st.sub(vec2(0, texel.y))).x;
      const hE = prev.sample(st.add(vec2(texel.x, 0))).x;
      const hW = prev.sample(st.sub(vec2(texel.x, 0))).x;
      const next = hN.add(hS).add(hE).add(hW).mul(0.5).sub(c.y).mul(0.986).toVar();
      const wp = uv().mul(size).add(origin);
      Loop(MAX_DROPS, ({ i }) => {
        const d = drops.element(i);
        const dist = wp.sub(d.xy).length();
        next.addAssign(d.w.mul(float(1).sub(smoothstep(0, d.z, dist))));
      });
      // Soft edges so waves fade instead of bouncing off the domain border.
      const edge = smoothstep(0, 0.04, uv().x)
        .mul(smoothstep(1, 0.96, uv().x))
        .mul(smoothstep(0, 0.04, uv().y))
        .mul(smoothstep(1, 0.96, uv().y));
      // Scorch moves in whole texels (exact fetches at texel centres), so it never blurs.
      const burnt = prev
        .sample(uv().add(vec2(0, scorchShift)))
        .zw.mul(vec2(Math.exp(-SIM_DT / CHAR_FADE), Math.exp(-SIM_DT / HEAT_FADE)))
        .toVar();
      // Ragged marks: the distance is warped by noise, so blasts leave splashes, not discs.
      const warp = texture(noise, wp.mul(0.045)).r.sub(0.5);
      Loop(MAX_SCORCH, ({ i }) => {
        const d = scorches.element(i);
        const dist = wp.sub(d.xy).length().add(warp.mul(d.z).mul(0.9));
        const char = d.w.mul(smoothstep(d.z, d.z.mul(0.3), dist));
        const heat = d.w.min(1).mul(smoothstep(d.z.mul(0.75), d.z.mul(0.15), dist));
        burnt.assign(max(burnt, vec2(char, heat)));
      });
      return vec4(next.mul(edge).clamp(-4, 4), c.x.mul(edge), burnt.mul(edge));
    })();
    this.quad = new QuadMesh(simMat);

    // ── Sea surface ──────────────────────────────────────────────────────────
    this.heightTex = texture(this.rtA.texture);
    const h = this.heightTex;
    const simUV = positionWorld.xy.sub(origin).div(size);
    const ex = float(2 / sw);
    const ey = float(2 / sh);
    const dhx = h.sample(simUV.add(vec2(ex, 0))).x.sub(h.sample(simUV.sub(vec2(ex, 0))).x);
    const dhy = h.sample(simUV.add(vec2(0, ey))).x.sub(h.sample(simUV.sub(vec2(0, ey))).x);
    // Small procedural swell, scrolling with the environment.
    const flow = positionWorld.xy.add(vec2(0, this.scroll));
    const swellX = mx_fractal_noise_float(vec3(flow.mul(0.045), time.mul(0.25)), 3).mul(0.18);
    const swellY = mx_fractal_noise_float(vec3(flow.mul(0.045).add(17.3), time.mul(0.25)), 3).mul(0.18);
    const nWorld = normalize(vec3(dhx.mul(-2.2).add(swellX), dhy.mul(-2.2).add(swellY), 1));

    const refl = reflector({ resolutionScale: opts.reflectionScale });
    refl.uvNode = refl.uvNode!.add(nWorld.xy.mul(0.09));
    // Lava and clouds don't reflect: skip the reflector's whole scene pass for them (three has
    // no switch for it, so gate its per-frame update).
    const base = refl.reflector as { updateBefore: (frame: unknown) => unknown };
    const updateReflection = base.updateBefore.bind(base);
    base.updateBefore = (frame) => {
      if (!this.reflective) return undefined;
      const hidden = this.unreflected.filter((o) => o.visible);
      for (const o of hidden) o.visible = false;
      try {
        return updateReflection(frame);
      } finally {
        for (const o of hidden) o.visible = true;
      }
    };
    // Under the field the floor is a plain dark background; the walls' reflections stay along
    // the banks (the bed runs to |x| = 31).
    const banks = smoothstep(18, 29, abs(positionWorld.x));

    // Lava: crust cracks where two drifting noise layers cross mid-value; pools where both are high.
    const tex = opts.noise;
    const n1 = texture(tex, flow.mul(0.011).add(vec2(time.mul(0.004), 0)));
    const n2 = texture(tex, flow.mul(0.029).sub(vec2(0, time.mul(0.009))));
    const n = n1.r.mul(0.6).add(n2.a.mul(0.4));
    const crack = smoothstep(0.045, 0, abs(n.sub(0.5)));
    const pool = smoothstep(0.8, 0.92, n);
    const disturbed = h.sample(simUV).x.abs().mul(0.8);
    const throb = sin(time.mul(0.9).add(flow.y.mul(0.02)))
      .mul(0.15)
      .add(0.85);
    const molten = this.glow.mul(crack.mul(1.1).add(pool.mul(1.3)).mul(throb).add(disturbed).add(0.008));
    // Clouds: two slow layers; dim violet valleys, bright crests, stirred by explosions.
    const c1 = texture(tex, flow.mul(0.007).add(vec2(time.mul(0.003), time.mul(0.002)))).a;
    const c2 = texture(tex, flow.mul(0.019).add(vec2(time.mul(-0.006), 0))).r;
    const dens = smoothstep(0.3, 0.85, c1.mul(0.65).add(c2.mul(0.35)));
    const crest = dens.mul(dens).mul(dens);
    const valley = vec3(0.35, 0.2, 0.9).mul(this.glow).mul(0.03);
    // Crests stay well below bullet brightness: bullets (often the same hue) fly over them.
    const clouds = mix(valley, this.glow.mul(0.36), crest).add(this.glow.mul(disturbed.mul(0.35)));
    const solid = this.lava.add(this.cloud);
    // Scorch: blackened metal and crust, soot in the clouds, glowing while it is hot.
    const burnt = h.sample(simUV.add(vec2(0, this.scorchLag)));
    const char = burnt.z.clamp(0, 1);
    const heat = burnt.w.clamp(0, 1);
    const clean = float(1).sub(char.mul(0.85));
    const embers = vec3(1, 0.28, 0.05).mul(heat.mul(heat).mul(smoothstep(0.35, 0.75, n).mul(3).add(0.4)));

    const mat = new MeshStandardNodeMaterial();
    mat.colorNode = mix(
      vec3(0.0018, 0.0025, 0.004),
      mix(vec3(0.02, 0.013, 0.011), this.glow.mul(dens.mul(0.04)), this.cloud),
      solid,
    ).mul(clean);
    mat.metalnessNode = solid.oneMinus().mul(clean);
    mat.normalNode = transformNormalToView(nWorld);
    mat.roughnessNode = mix(
      mix(float(0.12).add(swellX.abs().mul(0.25)), float(0.9), solid),
      float(0.85),
      char,
    );
    mat.emissiveNode = refl.rgb
      .mul(solid.oneMinus().mul(banks).mul(0.6))
      .add(molten.mul(this.lava))
      .add(clouds.mul(this.cloud))
      .mul(clean)
      .add(embers);
    // Reflections come from the reflector; the studio env map would paint grey blotches.
    mat.envMapIntensity = 0;

    this.mesh = new Mesh(new PlaneGeometry(DOMAIN.w * 1.6, DOMAIN.h * 1.4), mat);
    this.mesh.position.set(0, DOMAIN.y0 + DOMAIN.h / 2, FLOOR_Z);
    this.mesh.add(refl.target);
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    this.clear();
  }

  /** Flat, cold and unburnt (the clear alpha matters: A is heat). */
  private clear(): void {
    const r = this.renderer;
    const color = r.getClearColor(new Color());
    const alpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const rt of [this.rtA, this.rtB]) {
      r.setRenderTarget(rt);
      r.clear();
    }
    r.setRenderTarget(null);
    r.setClearColor(color, alpha);
  }

  /** Disturb the surface at world (x, y). `strength` ~0.3 small, ~2 huge. */
  drop(x: number, y: number, radius: number, strength: number): void {
    if (this.pending.length >= MAX_DROPS) return;
    this.pending.push(new Vector4(x, y, radius, strength));
  }

  /**
   * Burn a mark into the floor (and whatever hull lies under it) at world (x, y). `strength`
   * ~0.4 a scuff, 1 black; heat starts at min(strength, 1) and cools in a couple of seconds.
   */
  scorch(x: number, y: number, radius: number, strength: number): void {
    if (this.pendingScorch.length >= MAX_SCORCH || !Sea.domainContains(x, y)) return;
    this.pendingScorch.push(new Vector4(x, y, radius, strength));
  }

  /**
   * (char, heat) at world `xy`, for other materials (0 outside the domain). The node follows
   * the ping-pong targets because it samples the sea's own texture node.
   */
  scorchAt(xy: Node<'vec2'>): Node<'vec2'> {
    const st = xy.sub(vec2(DOMAIN.x0, DOMAIN.y0)).div(vec2(DOMAIN.w, DOMAIN.h));
    const inside = step(0, st.x).mul(step(st.x, 1)).mul(step(0, st.y)).mul(step(st.y, 1));
    return this.heightTex
      .sample(st.add(vec2(0, this.scorchLag)))
      .zw.clamp(0, 1)
      .mul(inside);
  }

  setFloor(mode: FloorMode, glow: Color): void {
    this.mesh.visible = mode !== 'void';
    this.reflective = mode === 'metal';
    this.pending = [];
    this.pendingScorch = [];
    // A new sector's trench starts clean.
    this.clear();
    this.lava.value = mode === 'lava' ? 1 : 0;
    this.cloud.value = mode === 'cloud' ? 1 : 0;
    this.glow.value.copy(glow);
  }

  /** Runs even over the void: the hull's scorch lives in the same simulation. */
  update(dt: number): void {
    this.scroll.value += SCROLL_SPEED * dt;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < 3) {
      this.acc -= SIM_DT;
      steps++;
      this.step();
    }
    if (steps === 3) this.acc = 0;
  }

  private step(): void {
    const read = this.flip ? this.rtB : this.rtA;
    const write = this.flip ? this.rtA : this.rtB;
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = this.pending[i];
      if (d) this.drops[i]!.copy(d);
      else this.drops[i]!.set(0, 0, 1, 0);
    }
    this.pending = [];
    for (let i = 0; i < MAX_SCORCH; i++) {
      const d = this.pendingScorch[i];
      if (d) this.scorches[i]!.copy(d);
      else this.scorches[i]!.set(0, 0, 1, 0);
    }
    this.pendingScorch = [];
    this.scrollUV.value = (SCROLL_SPEED * SIM_DT) / DOMAIN.h;
    // Scorch scrolls by whole texels; what it still owes is added back when it is sampled.
    this.lagTexels += this.scrollUV.value * this.texelsY;
    const shift = Math.floor(this.lagTexels);
    this.lagTexels -= shift;
    this.scorchShift.value = shift / this.texelsY;
    this.scorchLag.value = this.lagTexels / this.texelsY;
    this.simTex.value = read.texture;
    this.renderer.setRenderTarget(write);
    this.quad.render(this.renderer);
    this.renderer.setRenderTarget(null);
    this.heightTex.value = write.texture;
    this.flip = !this.flip;
  }

  get domain(): typeof DOMAIN {
    return DOMAIN;
  }

  static domainContains(x: number, y: number): boolean {
    return x > DOMAIN.x0 && x < DOMAIN.x0 + DOMAIN.w && y > DOMAIN.y0 && y < DOMAIN.y0 + DOMAIN.h;
  }
}

export const SEA_SIM_ORIGIN = new Vector2(DOMAIN.x0, DOMAIN.y0);
