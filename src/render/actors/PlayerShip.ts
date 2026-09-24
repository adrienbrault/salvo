import {
  abs,
  dot,
  float,
  mix,
  mx_noise_float,
  normalView,
  positionLocal,
  positionViewDirection,
  pow,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import type { ChassisDef } from '../../content/chassis';
import { MIRROR } from '../../sim/weapons';
import type { World } from '../../sim/world';
import { playerParts } from './models';

const GHOSTS = 5;

/**
 * The player's fighter: glossy clear-coated hull, HDR trims, procedural engine plumes,
 * a hitbox core that is always readable, plus weapon-specific visuals
 * (Mirror shield, Grazer charge halo, Ram dash ghosts).
 */
export class PlayerShip {
  readonly group = new Group();
  private readonly model = new Group();
  private readonly thrust = uniform(1);
  private readonly shieldPulse = uniform(0);
  private readonly shieldOn = uniform(0);
  private readonly chargeU = uniform(0);
  private readonly accent = uniform(new Vector3(0.3, 0.9, 1));
  private readonly shield: Mesh;
  private readonly halo: Mesh;
  private readonly hitCore: Mesh;
  readonly ghosts: Mesh[] = [];
  private readonly ghostPos: { x: number; y: number; a: number }[] = [];
  private bank = 0;
  private ghostT = 0;
  private readonly hullMat: MeshPhysicalNodeMaterial;

  /** One persistent ship: `setChassis` only swaps colors, so no shader ever recompiles. */
  constructor() {
    const parts = playerParts();

    const hullMat = new MeshPhysicalNodeMaterial({
      color: new Color(0x3a7bff),
      metalness: 0.55,
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    });
    const rim = pow(float(1).sub(abs(dot(normalView, positionViewDirection))), 3);
    hullMat.emissiveNode = this.accent.mul(rim.mul(0.9));
    this.hullMat = hullMat;

    const trimMat = new MeshBasicNodeMaterial();
    trimMat.colorNode = this.accent.mul(5);

    const canopyMat = new MeshPhysicalNodeMaterial({
      color: new Color(0x0a1224),
      metalness: 0.1,
      roughness: 0.05,
      clearcoat: 1,
    });
    canopyMat.emissiveNode = this.accent.mul(rim.mul(2.2).add(0.15));

    const hull = new Mesh(parts.hull, hullMat);
    const trim = new Mesh(parts.trim, trimMat);
    const canopy = new Mesh(parts.canopy, canopyMat);
    hull.castShadow = true;
    this.model.add(hull, trim, canopy);

    // Engine plumes: additive cones with scrolling noise; length follows thrust.
    const plumeMat = new MeshBasicNodeMaterial();
    plumeMat.transparent = true;
    plumeMat.depthWrite = false;
    plumeMat.blending = AdditiveBlending;
    plumeMat.fog = false;
    plumeMat.side = DoubleSide;
    const v = uv().y; // 1 at the nozzle, 0 at the tip
    const n = mx_noise_float(vec3(positionLocal.x.mul(3), positionLocal.y.mul(1.5).add(time.mul(18)), 0))
      .mul(0.5)
      .add(0.5);
    const hot = pow(v, 1.5);
    const col = mix(this.accent.mul(3), vec3(1, 1, 1).mul(6), pow(v, 4));
    plumeMat.colorNode = vec4(col.mul(hot.mul(n.mul(0.6).add(0.6)).mul(this.thrust)), 1);
    for (const x of [-1.55, 1.55]) {
      const plume = new Mesh(new ConeGeometry(0.5, 4.2, 14, 1, true), plumeMat);
      plume.rotation.z = Math.PI;
      plume.position.set(x, -5.9, 0.1);
      plume.userData.plume = true;
      this.model.add(plume);
    }

    // Hitbox core: the one thing that must always be readable in a bullet hell.
    const coreMat = new MeshBasicNodeMaterial();
    coreMat.colorNode = vec3(1, 1, 1).mul(8);
    this.hitCore = new Mesh(new SphereGeometry(1, 12, 8), coreMat);
    this.hitCore.position.z = 1.2;
    this.hitCore.renderOrder = 20;

    // Miroir shield: fresnel bubble with a travelling hex-ish interference pattern.
    const shieldMat = new MeshBasicNodeMaterial();
    shieldMat.transparent = true;
    shieldMat.depthWrite = false;
    shieldMat.blending = AdditiveBlending;
    shieldMat.fog = false;
    const fres = pow(float(1).sub(abs(dot(normalView, positionViewDirection))), 2.2);
    const bands = mx_noise_float(positionLocal.mul(0.9).add(vec3(0, 0, time.mul(0.8))))
      .mul(0.5)
      .add(0.5);
    const shieldCol = this.accent
      .mul(fres.mul(2.5).add(bands.mul(0.25)).add(this.shieldPulse.mul(2)))
      .mul(this.shieldOn);
    shieldMat.colorNode = vec4(shieldCol, 1);
    this.shield = new Mesh(new SphereGeometry(MIRROR.shieldRadius, 40, 24), shieldMat);
    this.shield.visible = false;

    // Grazer charge halo (also shows the graze radius faintly for everyone).
    const haloMat = new MeshBasicNodeMaterial();
    haloMat.transparent = true;
    haloMat.depthWrite = false;
    haloMat.blending = AdditiveBlending;
    haloMat.fog = false;
    const r = uv().x;
    const ring = smoothstep(0, 0.5, r).mul(smoothstep(1, 0.5, r));
    haloMat.colorNode = vec4(this.accent.mul(ring.mul(this.chargeU.mul(2.5).add(0.08))), 1);
    this.halo = new Mesh(new RingGeometry(0.85, 1, 64, 1), haloMat);
    this.halo.position.z = -0.4;

    // Dash ghosts (Ram).
    const ghostMat = new MeshBasicNodeMaterial();
    ghostMat.transparent = true;
    ghostMat.depthWrite = false;
    ghostMat.blending = AdditiveBlending;
    ghostMat.fog = false;
    ghostMat.colorNode = vec4(this.accent.mul(0.9), 1);
    for (let i = 0; i < GHOSTS; i++) {
      const g = new Mesh(parts.hull, ghostMat);
      g.visible = false;
      this.ghosts.push(g);
      this.ghostPos.push({ x: 0, y: 0, a: 0 });
    }

    this.group.add(this.model, this.hitCore, this.shield, this.halo);
  }

  setChassis(ch: ChassisDef): void {
    this.hullMat.color.set(ch.color);
    const a = new Color(ch.accent);
    this.accent.value.set(a.r, a.g, a.b);
  }

  /** Ghosts live in world space, so they must be added to the scene separately. */
  addGhostsTo(parent: Group | { add: (o: Mesh) => void }): void {
    for (const g of this.ghosts) parent.add(g);
  }

  update(world: World, alpha: number, t: number, dt: number): void {
    const p = world.player;
    const x = p.px + (p.x - p.px) * alpha;
    const y = p.py + (p.y - p.py) * alpha;
    this.group.position.set(x, y, 0);
    this.group.visible = p.alive || world.phase === 'intro';

    const targetBank = Math.max(-0.75, Math.min(0.75, -p.vx * 0.009));
    this.bank += (targetBank - this.bank) * Math.min(1, dt * 10);
    this.model.rotation.set(0.25 + Math.max(-0.2, Math.min(0.2, p.vy * 0.002)), this.bank, 0);
    const blink = p.invuln > 0 && p.dashT <= 0 && Math.floor(t * 18) % 2 === 0;
    this.model.visible = !blink;
    this.thrust.value = 0.8 + Math.max(0, p.vy) * 0.01 + (p.dashT > 0 ? 1.5 : 0);

    const hitR = world.stats.hitRadius;
    this.hitCore.scale.setScalar(hitR * (0.9 + Math.sin(t * 12) * 0.1));

    // Shield
    this.shieldOn.value += ((p.shield ? 1 : 0) - this.shieldOn.value) * Math.min(1, dt * 14);
    this.shield.visible = this.shieldOn.value > 0.01;
    this.shieldPulse.value = Math.max(0, this.shieldPulse.value - dt * 4);
    this.shield.rotation.z = t * 0.6;

    // Halo = graze radius, brightened by Grazer charge.
    const graze = world.stats.grazeRadius;
    this.halo.scale.setScalar(graze);
    this.chargeU.value = world.weapon.id === 'grazer' ? p.charge : 0;
    this.halo.rotation.z = t;

    // Dash ghosts
    this.ghostT -= dt;
    if (p.dashT > 0 && this.ghostT <= 0) {
      this.ghostT = 0.03;
      const g = this.ghostPos.pop()!;
      g.x = x;
      g.y = y;
      g.a = 1;
      this.ghostPos.unshift(g);
    }
    for (let i = 0; i < GHOSTS; i++) {
      const gp = this.ghostPos[i]!;
      gp.a = Math.max(0, gp.a - dt * 4);
      const mesh = this.ghosts[i]!;
      mesh.visible = gp.a > 0.02;
      mesh.position.set(gp.x, gp.y, -0.2);
      mesh.scale.setScalar(0.9 + gp.a * 0.15);
      mesh.rotation.x = 0.25;
    }
  }

  pulseShield(): void {
    this.shieldPulse.value = Math.min(1.5, this.shieldPulse.value + 0.35);
  }
}
