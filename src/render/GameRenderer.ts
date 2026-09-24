import { DynamicLighting } from 'three/addons/lighting/DynamicLighting.js';
import { fog, max, mix, positionView, positionWorld, smoothstep, uniform } from 'three/tsl';
import {
  AgXToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  type Node,
  PCFShadowMap,
  Scene,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { CHASSIS, type ChassisDef } from '../content/chassis';
import type { Bullet, BulletStyle, FxEvent } from '../sim/types';
import type { World } from '../sim/world';
import { EnemyLayer } from './actors/Enemies';
import { PlayerShip } from './actors/PlayerShip';
import { BulletLayer } from './Bullets';
import { CameraRig, type Insets } from './CameraRig';
import { BIOMES } from './env/biomes';
import { generateHullTextures, type HullTextureSet } from './env/HullTextures';
import { Sea } from './env/Sea';
import { SpaceEnvironment } from './env/SpaceEnvironment';
import { TRENCH, Trench } from './env/Trench';
import { FixedClusteredLighting } from './FixedClusteredLighting';
import { FxDirector } from './fx/FxDirector';
import { LightPool } from './fx/Lights';
import { Particles } from './fx/Particles';
import { Post } from './Post';
import { hueColor } from './palette';
import { autoTier, DynamicResolution, pixelRatioFor, type Quality, TIERS, type Tier } from './quality';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  forceWebGL?: boolean;
  tier?: Tier | 'auto';
  /** Called as boot moves through its slow steps (shown on the loading screen). */
  onStage?: (stage: string) => void;
}

/** Key light ("sun"): low, from the upper left, so shadows run long across the deck. */
const KEY_POS = new Vector3(-130, 100, 70);
const KEY_TARGET = new Vector3(0, 20, -10);

/**
 * Owns the three.js renderer and every visual subsystem. The app calls `frame()` once per
 * animation frame with the current world (or null in menus) and the interpolation alpha.
 */
export class GameRenderer {
  readonly renderer: WebGPURenderer;
  readonly scene = new Scene();
  readonly rig = new CameraRig();
  readonly quality: Quality;
  readonly isWebGPU: boolean;
  readonly post: Post;
  readonly fx: FxDirector;
  private readonly sea: Sea;
  private readonly trench: Trench;
  private readonly fogColor = uniform(new Color(BIOMES[0]!.fog));
  private readonly hazeColor = uniform(new Color(BIOMES[0]!.fog));
  private readonly hazeAmount = uniform(0.18);
  private readonly hazeBottom = uniform(-38);
  private readonly fogNear = uniform(300);
  private readonly fogFar = uniform(800);
  private readonly env: SpaceEnvironment;
  private envBiome = '';
  private readonly hemi = new HemisphereLight(0x4a6cff, 0x05060a, 0.15);
  private readonly enemies: EnemyLayer;
  private readonly bullets: BulletLayer;
  private readonly shots: BulletLayer;
  private readonly particles: Particles;
  private readonly lights: LightPool;
  private readonly key: DirectionalLight;
  private readonly dynRes: DynamicResolution;
  private readonly ship: PlayerShip;
  private shipOn = false;
  private readonly shipLight = new Color(0x6fd8ff);
  private width = 1;
  private height = 1;
  private insets: Insets = { top: 0, bottom: 0 };
  private t = 0;

  private constructor(renderer: WebGPURenderer, quality: Quality, isWebGPU: boolean, hull: HullTextureSet) {
    this.renderer = renderer;
    this.quality = quality;
    this.isWebGPU = isWebGPU;
    const scene = this.scene;

    renderer.toneMapping = AgXToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = quality.shadows;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.lighting = quality.clustered
      ? new FixedClusteredLighting(quality.lights)
      : new DynamicLighting({ maxPointLights: quality.lights });

    scene.background = new Color(BIOMES[0]!.fog);
    // Range fog for the far end of the trench, plus a haze that thickens toward the floor
    // (or swallows the canyon, over the void).
    const range = smoothstep(this.fogNear, this.fogFar, positionView.z.negate());
    const depth = smoothstep(TRENCH.hullZ, this.hazeBottom, positionWorld.z).mul(this.hazeAmount);
    (scene as Scene & { fogNode: Node }).fogNode = fog(
      mix(this.hazeColor, this.fogColor, range),
      max(range, depth),
    );
    this.env = new SpaceEnvironment(renderer, KEY_POS.clone().sub(KEY_TARGET));
    scene.environmentIntensity = 1;

    scene.add(this.hemi);
    this.key = new DirectionalLight(BIOMES[0]!.key, 1.5);
    this.key.position.copy(KEY_POS);
    this.key.target.position.copy(KEY_TARGET);
    if (quality.shadows) {
      this.key.castShadow = true;
      const sc = this.key.shadow.camera;
      sc.left = -190;
      sc.right = 190;
      sc.top = 190;
      sc.bottom = -190;
      sc.near = 10;
      sc.far = 400;
      this.key.shadow.mapSize.set(2048, 2048);
      this.key.shadow.bias = -0.0005;
    }
    scene.add(this.key, this.key.target);

    this.sea = new Sea(renderer, scene, {
      simSize: quality.seaSim,
      reflectionScale: quality.reflectionScale,
      noise: hull.macro,
    });
    this.trench = new Trench(scene, hull, {
      lamps: quality.envLamps,
      shadows: quality.shadows,
      parallax: quality.tier === 'ultra' || quality.tier === 'high',
      scorch: (xy) => this.sea.scorchAt(xy),
    });
    this.enemies = new EnemyLayer(scene);
    this.bullets = new BulletLayer(3000, 1, true);
    this.shots = new BulletLayer(800, 0.4);
    scene.add(this.bullets.mesh, this.shots.mesh);
    this.particles = new Particles(renderer, scene, quality.particles, quality.motes);
    this.lights = new LightPool(scene, quality.lights);
    this.post = new Post(renderer, scene, this.rig.camera, {
      resolutionScale: quality.resolutionScale,
      bloom: quality.bloom,
      chromatic: quality.chromatic,
      grain: quality.grain,
      smaa: quality.smaa,
      ao: quality.ao,
    });
    this.ship = new PlayerShip();
    scene.add(this.ship.group);
    this.ship.addGhostsTo(scene);
    this.ship.group.visible = false;
    this.dynRes = new DynamicResolution(quality.minResolutionScale);
    this.fx = new FxDirector(
      this.rig,
      this.post,
      this.particles,
      this.lights,
      this.sea,
      this.trench,
      this.ship,
      () => ({ w: this.width, h: this.height }),
    );
    this.setTheme(0);
  }

  static async create(o: RendererOptions): Promise<GameRenderer> {
    const t0 = performance.now();
    const stage = (s: string) => {
      console.info(`[boot] ${s} +${Math.round(performance.now() - t0)} ms`);
      o.onStage?.(s);
    };
    stage('Starting the GPU…');
    const renderer = new WebGPURenderer({
      canvas: o.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      forceWebGL: o.forceWebGL ?? false,
    });
    await renderer.init();
    const backend = renderer.backend as { isWebGPUBackend?: boolean };
    const isWebGPU = backend.isWebGPUBackend === true;
    const tier = !o.tier || o.tier === 'auto' ? autoTier(isWebGPU) : o.tier;
    const q = { ...TIERS[tier] };
    if (!isWebGPU) {
      q.clustered = false;
      q.lights = Math.min(q.lights, 16);
    }
    renderer.setPixelRatio(
      pixelRatioFor(q, window.innerWidth, window.innerHeight, window.devicePixelRatio || 1),
    );
    stage(`Loading fonts… (${isWebGPU ? 'WebGPU' : 'WebGL 2'}, ${tier})`);
    // Stencils on the hull use the UI font: make sure it is loaded before painting.
    await document.fonts?.load('700 32px "Chakra Petch"').catch(() => undefined);
    const hull = await generateHullTextures(q.hullTexture, Math.min(8, renderer.getMaxAnisotropy()), (i, n) =>
      stage(`Painting textures ${i + 1}/${n}…`),
    );
    stage('Compiling shaders…');
    const gr = new GameRenderer(renderer, q, isWebGPU, hull);
    await gr.warmup();
    stage('Ready');
    return gr;
  }

  resize(width: number, height: number, insets: Insets): void {
    this.width = width;
    this.height = height;
    this.insets = insets;
    this.renderer.setSize(width, height, false);
    this.applyPixelRatio();
    this.rig.fit(width, height, insets);
    // Fog starts just beyond the play plane, whatever distance the camera had to back off to.
    const d = this.rig.camera.position.length();
    this.fogNear.value = d + 40;
    this.fogFar.value = d + 520;
  }

  private applyPixelRatio(): void {
    const base = pixelRatioFor(this.quality, this.width, this.height, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(base * this.dynRes.scale);
  }

  /** Dynamic resolution's current factor on the canvas pixel ratio (1 = the tier's full size). */
  get resolutionScale(): number {
    return this.dynRes.scale;
  }

  get size(): { w: number; h: number; insets: Insets } {
    return { w: this.width, h: this.height, insets: this.insets };
  }

  /**
   * Switch to a sector's biome. `seed` (the run seed) reseeds its procedural layout, so every
   * run flies over a different trench; the same seed always rebuilds the same one.
   */
  setTheme(sector: number, seed = ''): void {
    const def = BIOMES[sector % BIOMES.length]!;
    const accent = new Color(def.accent);
    // Endless sectors reuse the four biomes: key by sector so each still gets its own trench.
    this.trench.setBiome(def, `${seed}/${sector}`);
    this.sea.setFloor(def.floor, new Color(def.glow));
    this.particles.setTheme(accent);
    (this.scene.background as Color).setHex(def.fog);
    this.fogColor.value.setHex(def.fog);
    this.hazeColor.value.setHex(def.fog).lerp(new Color(def.haze.color), def.haze.mix);
    this.hazeAmount.value = def.haze.amount;
    this.hazeBottom.value = def.haze.bottom;
    this.key.color.setHex(def.key);
    this.key.intensity = def.keyIntensity;
    this.hemi.color.setHex(def.key).lerp(accent, 0.5);
    if (this.envBiome !== def.id) {
      this.envBiome = def.id;
      this.scene.environment = this.env.render(new Color(...def.sky));
    }
  }

  /**
   * Compile every pipeline up front (all enemy kinds, bullet styles, boss, ship, post, compute)
   * so nothing stalls the first time it appears in play.
   */
  private async warmup(): Promise<void> {
    this.setChassis(CHASSIS[0]!);
    this.ship.group.visible = true;
    this.enemies.warm(true);
    const fake = WARM_BULLETS;
    this.bullets.update(fake, WARM_VIEW);
    this.shots.update(fake, WARM_VIEW);
    this.rig.fit(400, 700);
    await this.renderer.compileAsync(this.scene, this.rig.camera);
    this.particles.update(1 / 60, 0, 0);
    this.sea.update(1 / 60);
    this.post.update(1 / 60, 400, 700);
    this.post.render();
    this.enemies.warm(false);
    this.bullets.update([], WARM_VIEW);
    this.shots.update([], WARM_VIEW);
    this.setChassis(null);
  }

  setChassis(ch: ChassisDef | null): void {
    this.shipOn = !!ch;
    if (ch) {
      this.shipLight.set(ch.accent);
      this.ship.setChassis(ch);
    }
  }

  handleFx(events: readonly FxEvent[], world: World | null): void {
    this.fx.handle(events, world);
  }

  frame(world: World | null, alpha: number, dt: number, frameMs: number): void {
    this.t += dt;
    const t = this.t;
    const p = world?.player;
    const px = p ? p.px + (p.x - p.px) * alpha : 0;
    const py = p ? p.py + (p.y - p.py) * alpha : -50;

    this.rig.update(dt, world ? px : Math.sin(t * 0.2) * 20);
    this.sea.update(dt);
    this.trench.update(dt, t, this.lights, p?.alive ? { x: px, y: py } : null);
    this.trench.setEnergy(world?.gauge ?? 1);
    this.trench.setAlert(world?.spec.kind === 'boss');

    if (world) {
      this.enemies.update(world, alpha, t);
      if (this.shipOn) this.ship.update(world, alpha, t, dt);
      const fog = world.constraint?.fogRadius ?? 0;
      const view = { alpha, fogRadius: fog, playerX: px, playerY: py, z: 0.6 };
      this.bullets.update(world.bullets.items, view);
      this.shots.update(world.shots.items, { ...view, fogRadius: 0, z: 0.3 });

      // Engines light the sea; wake ripples trail behind the ship.
      if (p?.alive) {
        this.lights.add(px, py - 4, -4, this.shipLight, 1800, 70);
        this.sea.drop(px, py - 3, 2.2, 0.035 + Math.min(0.05, Math.hypot(p.vx, p.vy) * 0.0006));
      }
      // A sample of bullets light the sea from above: bullet hell becomes a light show.
      const items = world.bullets.items;
      const budget = Math.max(0, this.quality.lights - 24);
      const stride = Math.max(1, Math.ceil(items.length / Math.max(1, budget)));
      for (let i = 0; i < items.length; i += stride) {
        const b = items[i]!;
        this.lights.add(b.x, b.y, 0, hueColor(b.hue), 520, 56);
      }
      for (const e of world.enemies.items) {
        if (e.heavy) this.lights.add(e.x, e.y, 3, hueColor(e.hue), 1500, 60);
      }
      this.fx.setLowHp(p?.hp === 1 && p.alive, t);
      this.fx.update(dt, world.gauge);
    } else {
      this.enemies.update(EMPTY_WORLD, 0, t);
      this.fx.update(dt, 1);
    }
    this.ship.group.visible = this.shipOn && !!world && (world.player.alive || world.phase === 'intro');

    this.particles.update(dt, world ? px : 999, world ? py : 999);
    this.lights.update(dt);
    this.post.update(dt, this.width, this.height);

    if (this.dynRes.sample(frameMs) !== null) this.applyPixelRatio();

    this.post.render();
  }
}

const WARM_STYLES: BulletStyle[] = ['orb', 'bigOrb', 'needle', 'bolt', 'spark', 'reflect'];
const WARM_BULLETS = WARM_STYLES.map(
  (style, i) =>
    ({
      x: -30 + i * 10,
      y: 0,
      px: -30 + i * 10,
      py: 0,
      vx: 0,
      vy: 1,
      radius: 1.2,
      style,
      hue: 'pink',
      age: 1,
    }) as Bullet,
);
const WARM_VIEW = { alpha: 1, fogRadius: 0, playerX: 0, playerY: 0, z: 0.5 };

/** Minimal stand-in so menus can reuse the same update paths. */
const EMPTY_WORLD = { enemies: { items: [] } } as unknown as World;
