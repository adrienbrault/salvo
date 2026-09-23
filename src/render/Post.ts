import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import {
  Fn,
  float,
  Loop,
  luminance,
  mix,
  pass,
  screenUV,
  smoothstep,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import {
  type Node,
  type PerspectiveCamera,
  RenderPipeline,
  type Scene,
  Vector4,
  type WebGPURenderer,
} from 'three/webgpu';

const MAX_SHOCKS = 8;

export interface PostOptions {
  resolutionScale: number;
  bloom: boolean;
  chromatic: boolean;
  grain: boolean;
}

interface Shock {
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
  strength: number;
}

/**
 * Post chain: shockwave refraction → HDR bloom → chromatic aberration → grade (saturation,
 * flash, damage vignette) → film grain → AgX tone mapping (renderer output).
 * Every uniform here is driven by gameplay through `GameRenderer`/`FxDirector`.
 */
export class Post {
  readonly pipeline: RenderPipeline;
  readonly bloomStrength = uniform(0.9);
  readonly aberration = uniform(0);
  readonly flash = uniform(0);
  readonly danger = uniform(0);
  readonly saturation = uniform(1.08);
  readonly exposure = uniform(1);
  private readonly shockData: Vector4[] = [];
  private readonly shockNode;
  private readonly aspect = uniform(1);
  private readonly shocks: Shock[] = [];
  private readonly scenePass;

  constructor(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, o: PostOptions) {
    for (let i = 0; i < MAX_SHOCKS; i++) this.shockData.push(new Vector4(0, 0, 0, 0));
    this.shockNode = uniformArray<'vec4'>(this.shockData, 'vec4');

    const scenePass = pass(scene, camera);
    scenePass.setResolutionScale(o.resolutionScale);
    this.scenePass = scenePass;
    const color = scenePass.getTextureNode('output');

    const shockData = this.shockNode;
    const aspect = this.aspect;
    const distortedUV = Fn(() => {
      const uvv = screenUV.toVar();
      const offset = vec2(0, 0).toVar();
      Loop(MAX_SHOCKS, ({ i }) => {
        const s = shockData.element(i);
        const dv = uvv.sub(s.xy).mul(vec2(aspect, 1));
        const d = dv.length();
        const w = float(0.035);
        const band = smoothstep(w, 0, d.sub(s.z).abs());
        offset.addAssign(dv.normalize().mul(band.mul(s.w)).div(vec2(aspect, 1)));
      });
      return uvv.sub(offset);
    })();
    const base = color.sample(distortedUV);

    let out: Node<'vec4'> = base;
    if (o.bloom) {
      const b = bloom(base, 1, 0.55, 0.62);
      b.strength = this.bloomStrength;
      out = out.add(b);
    }
    if (o.chromatic) {
      out = chromaticAberration(out, this.aberration, vec2(0.5, 0.5), float(1.1)) as unknown as Node<'vec4'>;
    }
    // Grade as pure expressions (no mutated vars: TSL would see a self-reference).
    const src = vec3(out.rgb);
    const l = luminance(src);
    const saturated = mix(vec3(l, l, l), src, this.saturation);
    const exposed = saturated.mul(this.exposure).add(vec3(1, 0.95, 0.9).mul(this.flash));
    const v = screenUV
      .sub(0.5)
      .mul(vec2(aspect.mul(0.9), 1))
      .length();
    const edge = smoothstep(0.5, 1.1, v);
    const hurt = mix(exposed, vec3(0.9, 0.05, 0.08).mul(0.6).add(exposed.mul(0.3)), edge.mul(this.danger));
    const vignetted = hurt.mul(float(1).sub(smoothstep(0.55, 1.1, v).mul(0.55)));
    const graded = vec4(vignetted, 1);
    out = o.grain ? (film(graded, float(0.18)) as unknown as Node<'vec4'>) : graded;

    this.pipeline = new RenderPipeline(renderer, out);
  }

  setResolutionScale(s: number): void {
    this.scenePass.setResolutionScale(s);
  }

  /** Screen-space refraction ring at screen uv (x, y ∈ 0..1). */
  shock(x: number, y: number, size: number, strength: number, life = 0.55): void {
    if (this.shocks.length >= MAX_SHOCKS) this.shocks.shift();
    this.shocks.push({ x, y, age: 0, life, size, strength });
  }

  update(dt: number, width: number, height: number): void {
    this.aspect.value = width / Math.max(1, height);
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i]!;
      s.age += dt;
      if (s.age >= s.life) this.shocks.splice(i, 1);
    }
    for (let i = 0; i < MAX_SHOCKS; i++) {
      const s = this.shocks[i];
      const d = this.shockData[i]!;
      if (!s) {
        d.set(0, 0, 0, 0);
        continue;
      }
      const t = s.age / s.life;
      const ease = 1 - (1 - t) ** 3;
      d.set(s.x, s.y, ease * s.size, s.strength * (1 - t) * (1 - t));
    }
  }

  render(): void {
    this.pipeline.render();
  }
}
