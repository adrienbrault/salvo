import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { DynamicLighting } from 'three/addons/lighting/DynamicLighting.js';
import { fog, max, mix, positionView, positionWorld, smoothstep, uniform } from 'three/tsl';
import {
  AgXToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  type Node,
  PCFShadowMap,
  PMREMGenerator,
  Scene,
  WebGPURenderer,
} from 'three/webgpu';
import { CHASSIS, type ChassisDef } from '../content/chassis';
import type { Bullet, BulletStyle, FxEvent } from '../sim/types';
import type { World } from '../sim/world';
import { EnemyLayer } from './actors/Enemies';
import { PlayerShip } from './actors/PlayerShip';
import { BulletLayer } from './Bullets';
import { CameraRig, type Insets } from './CameraRig';
import { generateHullTextures, type HullTextureSet } from './env/HullTextures';
import { Sea } from './env/Sea';
import { TRENCH, Trench } from './env/Trench';
import { FxDirector } from './fx/FxDirector';
import { LightPool } from './fx/Lights';
import { Particles } from './fx/Particles';
import { Post } from './Post';
import { FLOOR_Z, hueColor } from './palette';
import { autoTier, DynamicResolution, type Quality, TIERS, type Tier } from './quality';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  forceWebGL?: boolean;
  tier?: Tier | 'auto';
}

/** Sector color themes: accent lights, fog, key light and hull paint (albedo multiplier). */
const THEMES = [
  { accent: 0x2a6cff, fog: 0x03060f, key: 0x9fc4ff, hull: [0.95, 1, 1.1] },
  { accent: 0x19d3c5, fog: 0x020a0c, key: 0xaef5ff, hull: [0.9, 1.05, 1] },
  { accent: 0xff3d6e, fog: 0x0d0307, key: 0xffb3c6, hull: [1.15, 0.9, 0.88] },
  { accent: 0xffa31a, fog: 0x0c0703, key: 0xffd9a0, hull: [1.12, 1, 0.8] },
] as const;

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
  private readonly fogColor = uniform(new Color(THEMES[0].fog));
  private readonly hazeColor = uniform(new Color(THEMES[0].fog));
  private readonly fogNear = uniform(300);
  private readonly fogFar = uniform(800);
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
      ? new ClusteredLighting(quality.lights)
      : new DynamicLighting({ maxPointLights: quality.lights });

    scene.background = new Color(THEMES[0].fog);
    // Range fog for the far end of the trench, plus a haze that thickens toward the river.
    const range = smoothstep(this.fogNear, this.fogFar, positionView.z.negate());
    const depth = smoothstep(TRENCH.hullZ, FLOOR_Z - 4, positionWorld.z).mul(0.18);
    (scene as Scene & { fogNode: Node }).fogNode = fog(
      mix(this.hazeColor, this.fogColor, range),
      max(range, depth),
    );
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;

    scene.add(new HemisphereLight(0x4a6cff, 0x05060a, 0.22));
    this.key = new DirectionalLight(THEMES[0].key, 2.2);
    // Low sun from the upper left: long shadows across the deck and down into the trench.
    this.key.position.set(-130, 100, 70);
    this.key.target.position.set(0, 20, -10);
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
    });
    this.trench = new Trench(scene, hull, { lamps: quality.envLamps, shadows: quality.shadows });
    this.enemies = new EnemyLayer(scene);
    this.bullets = new BulletLayer(3000);
    this.shots = new BulletLayer(800, 0.4);
    scene.add(this.bullets.mesh, this.shots.mesh);
    this.particles = new Particles(renderer, scene, quality.particles, quality.motes);
    this.lights = new LightPool(scene, quality.lights);
    this.post = new Post(renderer, scene, this.rig.camera, {
      resolutionScale: quality.resolutionScale,
      bloom: quality.bloom,
      chromatic: quality.chromatic,
      grain: quality.grain,
    });
    this.ship = new PlayerShip();
    scene.add(this.ship.group);
    this.ship.addGhostsTo(scene);
    this.ship.group.visible = false;
    this.dynRes = new DynamicResolution(quality.resolutionScale, quality.minResolutionScale);
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    // Stencils on the hull use the UI font: make sure it is loaded before painting.
    await document.fonts?.load('700 32px "Chakra Petch"').catch(() => undefined);
    const hull = generateHullTextures(q.hullTexture, Math.min(8, renderer.getMaxAnisotropy()));
    const gr = new GameRenderer(renderer, q, isWebGPU, hull);
    await gr.warmup();
    return gr;
  }

  resize(width: number, height: number, insets: Insets): void {
    this.width = width;
    this.height = height;
    this.insets = insets;
    this.renderer.setSize(width, height, false);
    this.rig.fit(width, height, insets);
    // Fog starts just beyond the play plane, whatever distance the camera had to back off to.
    const d = this.rig.camera.position.length();
    this.fogNear.value = d + 40;
    this.fogFar.value = d + 520;
  }

  get size(): { w: number; h: number; insets: Insets } {
    return { w: this.width, h: this.height, insets: this.insets };
  }

  setTheme(sector: number): void {
    const th = THEMES[sector % THEMES.length]!;
    const accent = new Color(th.accent);
    this.trench.setTheme(accent, new Color(...th.hull));
    this.particles.setTheme(accent);
    (this.scene.background as Color).setHex(th.fog);
    this.fogColor.value.setHex(th.fog);
    this.hazeColor.value.setHex(th.fog).lerp(accent, 0.07);
    this.key.color.setHex(th.key);
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

    const changed = this.dynRes.sample(frameMs);
    if (changed !== null) this.post.setResolutionScale(changed);

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
