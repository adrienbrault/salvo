import {
  Fn,
  float,
  Loop,
  mx_fractal_noise_float,
  normalize,
  positionWorld,
  reflector,
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
  Vector2,
  Vector4,
  type WebGPURenderer,
} from 'three/webgpu';
import { FLOOR_Z, SCROLL_SPEED } from '../palette';

const MAX_DROPS = 24;
const SIM_DT = 1 / 60;

/** World-space rectangle covered by the ripple simulation (the trench floor, plus margin). */
const DOMAIN = { x0: -48, y0: -150, w: 96, h: 420 };

export interface SeaOptions {
  simSize: [number, number];
  reflectionScale: number;
}

/**
 * Liquid-metal river at the bottom of the trench:
 *  - a GPU wave-equation heightfield (ping-pong render targets, works on WebGPU and WebGL2)
 *    fed by explosions and the ship's engine downwash, advected by the scroll;
 *  - planar reflections (`reflector`) distorted by the ripples;
 *  - PBR metal lit by every dynamic light in the scene.
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

    const mat = new MeshStandardNodeMaterial({ color: new Color(0x06080d), metalness: 1, roughness: 0.2 });
    mat.normalNode = transformNormalToView(nWorld);
    mat.roughnessNode = float(0.12).add(swellX.abs().mul(0.25));
    mat.emissiveNode = refl.rgb.mul(0.6);
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
