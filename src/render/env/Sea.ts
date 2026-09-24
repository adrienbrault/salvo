import {
  abs,
  Fn,
  float,
  Loop,
  mix,
  mx_fractal_noise_float,
  normalize,
  positionWorld,
  reflector,
  sin,
  smoothstep,
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
const SIM_DT = 1 / 60;

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
  private readonly scrollUV = uniform(0);
  private readonly scroll = uniform(0);
  private readonly lava = uniform(0);
  private readonly cloud = uniform(0);
  private readonly glow = uniform(new Color(1, 0.35, 0.08));
  private pending: Vector4[] = [];
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

    // ── Simulation pass ──────────────────────────────────────────────────────
    this.simTex = texture(this.rtA.texture);
    const texel = vec2(1 / sw, 1 / sh);
    const origin = vec2(DOMAIN.x0, DOMAIN.y0);
    const size = vec2(DOMAIN.w, DOMAIN.h);
    const simMat = new NodeMaterial();
    const prev = this.simTex;
    const drops = this.dropNode;
    const scrollUV = this.scrollUV;
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
      return vec4(next.mul(edge).clamp(-4, 4), c.x.mul(edge), 0, 1);
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
    const clouds = mix(valley, this.glow.mul(0.7), crest).add(this.glow.mul(disturbed.mul(0.5)));
    const solid = this.lava.add(this.cloud);

    const mat = new MeshStandardNodeMaterial();
    mat.colorNode = mix(
      vec3(0.0018, 0.0025, 0.004),
      mix(vec3(0.02, 0.013, 0.011), this.glow.mul(dens.mul(0.04)), this.cloud),
      solid,
    );
    mat.metalnessNode = solid.oneMinus();
    mat.normalNode = transformNormalToView(nWorld);
    mat.roughnessNode = mix(float(0.12).add(swellX.abs().mul(0.25)), float(0.9), solid);
    mat.emissiveNode = refl.rgb
      .mul(mix(float(0.6), this.lava.mul(0.08), solid))
      .add(molten.mul(this.lava))
      .add(clouds.mul(this.cloud));
    // Reflections come from the reflector; the studio env map would paint grey blotches.
    mat.envMapIntensity = 0;

    this.mesh = new Mesh(new PlaneGeometry(DOMAIN.w * 1.6, DOMAIN.h * 1.4), mat);
    this.mesh.position.set(0, DOMAIN.y0 + DOMAIN.h / 2, FLOOR_Z);
    this.mesh.add(refl.target);
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    for (const rt of [this.rtA, this.rtB]) {
      renderer.setRenderTarget(rt);
      renderer.clear();
    }
    renderer.setRenderTarget(null);
  }

  /** Disturb the surface at world (x, y). `strength` ~0.3 small, ~2 huge. */
  drop(x: number, y: number, radius: number, strength: number): void {
    if (this.pending.length >= MAX_DROPS) return;
    this.pending.push(new Vector4(x, y, radius, strength));
  }

  setFloor(mode: FloorMode, glow: Color): void {
    this.mesh.visible = mode !== 'void';
    this.lava.value = mode === 'lava' ? 1 : 0;
    this.cloud.value = mode === 'cloud' ? 1 : 0;
    this.glow.value.copy(glow);
  }

  update(dt: number): void {
    if (!this.mesh.visible) return;
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
    this.scrollUV.value = (SCROLL_SPEED * SIM_DT) / DOMAIN.h;
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
