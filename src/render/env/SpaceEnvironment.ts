import {
  abs,
  dot,
  max,
  mx_fractal_noise_float,
  normalize,
  positionLocal,
  pow,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl';
import {
  BackSide,
  Color,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  PMREMGenerator,
  type RenderTarget,
  Scene,
  SphereGeometry,
  type Texture,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';

/**
 * Procedural image-based lighting for the battle: a near-black sky with a nebula band (tinted
 * per biome), a low warm sun aligned with the key light and a few long panel lights. Metal
 * surfaces then reflect a believable space scene (gradients, a sun glint, strip highlights)
 * instead of a neutral grey studio. World up is +z; the camera looks toward +y.
 *
 * `render()` re-bakes into the same render target, so materials keep their environment
 * texture (and pipelines) across biome changes.
 */
export class SpaceEnvironment {
  private readonly scene = new Scene();
  private readonly nebulaColor = uniform(new Color(0.16, 0.06, 0.24));
  private readonly pmrem: PMREMGenerator;
  private target: RenderTarget | null = null;

  constructor(renderer: WebGPURenderer, sunDirection: Vector3) {
    this.pmrem = new PMREMGenerator(renderer);
    this.buildSky(sunDirection);
  }

  render(nebula: Color): Texture {
    this.nebulaColor.value.copy(nebula);
    this.target = this.pmrem.fromScene(this.scene, 0.02, 0.1, 100, { renderTarget: this.target });
    return this.target.texture;
  }

  private buildSky(sunDirection: Vector3): void {
    const scene = this.scene;
    const sun = vec3(...sunDirection.clone().normalize().toArray());

    const sky = new MeshBasicNodeMaterial({ side: BackSide });
    const d = normalize(positionLocal);
    const up = d.z;
    const base = vec3(0.002, 0.003, 0.007).add(vec3(0.02, 0.032, 0.06).mul(smoothstep(-0.2, 1, up)));
    const neb = pow(mx_fractal_noise_float(d.mul(2.2), 4).mul(0.5).add(0.5), 3);
    const band = smoothstep(0.55, 0, abs(up.sub(0.45)));
    const nebula = this.nebulaColor.mul(neb.mul(band));
    const s = max(dot(d, sun), 0);
    const sunGlow = vec3(1, 0.78, 0.55).mul(pow(s, 900).mul(80).add(pow(s, 10).mul(0.5)));
    // Below the horizon: the dark hull, faintly lit.
    const below = smoothstep(0.05, -0.25, up);
    sky.colorNode = base
      .add(nebula)
      .add(sunGlow)
      .mul(below.oneMinus())
      .add(vec3(0.004, 0.006, 0.01).mul(below));
    scene.add(new Mesh(new SphereGeometry(100, 64, 32), sky));

    // Long panel lights hanging over the trench (what the decks' reflections pick up).
    const panel = (w: number, h: number, pos: Vector3, color: [number, number, number]) => {
      const m = new MeshBasicNodeMaterial();
      m.colorNode = vec3(...color);
      const q = new Mesh(new PlaneGeometry(w, h), m);
      q.position.copy(pos);
      q.lookAt(0, 0, 0);
      scene.add(q);
    };
    panel(90, 3, new Vector3(0, 55, 70), [1.6, 1.8, 2.2]);
    panel(70, 2, new Vector3(-30, 30, 85), [0.5, 0.9, 2.4]);
    panel(4, 60, new Vector3(60, 10, 60), [2.2, 1.4, 0.8]);
  }
}
