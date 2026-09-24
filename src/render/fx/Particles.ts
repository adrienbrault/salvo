import { curlNoise } from 'three/addons/tsl/math/curlNoise.js';
import {
  atan,
  cos,
  exp,
  Fn,
  float,
  hash,
  If,
  instancedArray,
  instanceIndex,
  Loop,
  max,
  min,
  mix,
  sin,
  smoothstep,
  time,
  uint,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import {
  AdditiveBlending,
  type Color,
  type ComputeNode,
  type Scene,
  Sprite,
  SpriteNodeMaterial,
  Vector4,
  type WebGPURenderer,
} from 'three/webgpu';
import { FLOOR_Z, SCROLL_SPEED } from '../palette';

export type ParticleKind = 'spark' | 'ember' | 'debris' | 'flame';
const MOTE = 3;
const KIND_ID: Record<ParticleKind, number> = { spark: 0, ember: 1, debris: 2, flame: 4 };
const FLAME = KIND_ID.flame;

const MAX_EMIT = 32;
const MAX_SHOCKS = 8;

export interface EmitSpec {
  x: number;
  y: number;
  z?: number;
  count: number;
  speed: [number, number];
  life: number;
  size: number;
  color: Color;
  intensity?: number;
  kind?: ParticleKind;
  /** Direction (radians, sim convention) and spread; default omnidirectional. */
  dir?: number;
  spread?: number;
  /** 0 = flat in the play plane, 1 = full sphere. */
  zBias?: number;
}

/**
 * GPU particles (compute): explosion sparks that fall and bounce on the sea, embers, glowing
 * debris, flames licking up from wreckage, plus a permanent field of "motes" drifting between the sea and the battle that the
 * ship and every shockwave push around.
 *
 * Spawning happens inside the single update kernel (each particle checks whether its index is
 * in this frame's ring-buffer window), so every thread only writes its own element — which keeps
 * the kernel compatible with the WebGL2 transform-feedback fallback.
 */
export class Particles {
  readonly sprite: Sprite;
  private readonly kernel: ComputeNode;
  private readonly spawnBase = uniform(0, 'uint');
  private readonly spawnTotal = uniform(0, 'uint');
  private readonly frameSeed = uniform(0);
  private readonly dt = uniform(0);
  private readonly player = uniform(new Vector4());
  private readonly theme = uniform(new Vector4(0.2, 0.45, 1, 1));
  private readonly eA: Vector4[] = [];
  private readonly eB: Vector4[] = [];
  private readonly eC: Vector4[] = [];
  private readonly eD: Vector4[] = [];
  private readonly shockData: Vector4[] = [];
  private readonly shocks: { x: number; y: number; age: number; strength: number }[] = [];
  private pending: EmitSpec[] = [];
  private cursor = 0;
  private frame = 0;
  private readonly ringSize: number;

  constructor(
    private readonly renderer: WebGPURenderer,
    scene: Scene,
    readonly capacity: number,
    readonly motes: number,
  ) {
    this.ringSize = capacity - motes;
    for (let i = 0; i < MAX_EMIT; i++) {
      this.eA.push(new Vector4());
      this.eB.push(new Vector4());
      this.eC.push(new Vector4());
      this.eD.push(new Vector4());
    }
    for (let i = 0; i < MAX_SHOCKS; i++) this.shockData.push(new Vector4());

    const pos = instancedArray(capacity, 'vec4'); // xyz, life
    const vel = instancedArray(capacity, 'vec4'); // xyz, maxLife
    const col = instancedArray(capacity, 'vec4'); // rgb, kind*8 + size

    const eA = uniformArray<'vec4'>(this.eA, 'vec4'); // x, y, z, count
    const eB = uniformArray<'vec4'>(this.eB, 'vec4'); // speedMin, speedMax, life, size
    const eC = uniformArray<'vec4'>(this.eC, 'vec4'); // r, g, b, kind
    const eD = uniformArray<'vec4'>(this.eD, 'vec4'); // dir, spread, zBias, -
    const shockArr = uniformArray<'vec4'>(this.shockData, 'vec4'); // x, y, radius, strength
    const spawnBase = this.spawnBase;
    const spawnTotal = this.spawnTotal;
    const seed = this.frameSeed;
    const dt = this.dt;
    const player = this.player;
    const MOTES = uint(motes);
    const RING = uint(this.ringSize);
    const floorZ = float(FLOOR_Z);

    this.kernel = Fn(() => {
      const i = instanceIndex;
      const p = pos.element(i);
      const v = vel.element(i);
      const c = col.element(i);
      const rnd = (n: number) =>
        hash(
          float(i)
            .mul(7.13)
            .add(seed.mul(131.7))
            .add(n * 17.31),
        );

      If(i.lessThan(MOTES), () => {
        // ── Motes: permanent, drift with the scroll, react to the ship & shocks ──
        If(p.w.lessThanEqual(0), () => {
          p.assign(
            vec4(
              rnd(1).sub(0.5).mul(200),
              rnd(2).mul(280).sub(110),
              mix(floorZ.add(2), float(-3), rnd(3)),
              1,
            ),
          );
          v.assign(vec4(0, 0, 0, 1));
          c.assign(vec4(0, 0, 0, float(MOTE * 8).add(rnd(4).mul(0.5).add(0.35))));
        });
        // Divergence-free flow so motes swirl instead of clumping into filaments.
        const curl = curlNoise(vec3(p.xy.mul(0.018), time.mul(0.06)));
        const flow = vec3(curl.x, curl.y, 0).mul(3.5);
        const vel3 = v.xyz.add(flow.sub(v.xyz).mul(dt.mul(0.8))).toVar();
        // Ship repulsion (only affects motes near the play plane).
        const toP = p.xy.sub(player.xy);
        const dP = max(toP.length(), 0.001);
        const near = smoothstep(18, 0, dP).mul(smoothstep(-26, -2, p.z));
        vel3.addAssign(vec3(toP.div(dP).mul(near.mul(160).mul(dt)), 0));
        Loop(MAX_SHOCKS, ({ i: k }) => {
          const s = shockArr.element(k);
          const toS = p.xy.sub(s.xy);
          const dS = max(toS.length(), 0.001);
          const ring = exp(dS.sub(s.z).div(7).pow(2).negate());
          vel3.addAssign(vec3(toS.div(dS).mul(ring.mul(s.w).mul(dt)), ring.mul(s.w).mul(dt).mul(0.15)));
        });
        vel3.mulAssign(float(1).sub(dt.mul(1.4)));
        const np = p.xyz
          .add(vel3.mul(dt))
          .sub(vec3(0, float(SCROLL_SPEED).mul(dt), 0))
          .toVar();
        If(np.y.lessThan(-120), () => {
          np.y.addAssign(280);
          np.x.assign(rnd(5).sub(0.5).mul(200));
        });
        np.z.assign(np.z.clamp(floorZ.add(1), -1));
        p.assign(vec4(np, 1));
        v.assign(vec4(vel3, 1));
      }).Else(() => {
        const rel = i.add(RING).sub(MOTES).sub(spawnBase).mod(RING);
        If(rel.lessThan(spawnTotal), () => {
          // ── Spawn: find the emitter owning this slot ──
          const sel = uint(0).toVar();
          const acc = uint(0).toVar();
          const found = uint(0).toVar();
          Loop(MAX_EMIT, ({ i: k }) => {
            const cnt = uint(eA.element(k).w);
            If(found.equal(0).and(rel.lessThan(acc.add(cnt))), () => {
              found.assign(1);
              sel.assign(k);
            });
            acc.addAssign(cnt);
          });
          const a = eA.element(sel);
          const b = eB.element(sel);
          const cc = eC.element(sel);
          const d = eD.element(sel);
          const ang = d.x.add(rnd(11).sub(0.5).mul(d.y));
          const elev = rnd(12).sub(0.5).mul(Math.PI).mul(d.z);
          const dir = vec3(cos(ang).mul(cos(elev)), sin(ang).mul(cos(elev)), sin(elev));
          const speed = mix(b.x, b.y, rnd(13).pow(2));
          const life = b.z.mul(rnd(14).mul(0.8).add(0.6));
          p.assign(vec4(a.xyz.add(dir.mul(rnd(15).mul(0.8))), life));
          v.assign(vec4(dir.mul(speed), life));
          const tint = rnd(16).mul(0.5).add(0.75);
          c.assign(vec4(cc.xyz.mul(tint), cc.w.mul(8).add(b.w.mul(rnd(17).mul(0.6).add(0.7)))));
        }).ElseIf(p.w.greaterThan(0), () => {
          // ── Simulate ──
          const kind = c.w.div(8).floor();
          const isSpark = kind.equal(0);
          const isFlame = kind.equal(FLAME);
          const drag = isSpark.select(2.6, isFlame.select(1.8, 1.1));
          // Flames rise; everything else falls.
          const grav = kind.equal(1).select(-6, kind.equal(2).select(-90, isFlame.select(24, -55)));
          const vv = v.xyz.toVar();
          vv.mulAssign(float(1).sub(dt.mul(drag)).max(0));
          vv.z.addAssign(grav.mul(dt));
          const toP = p.xy.sub(player.xy);
          const dP = max(toP.length(), 0.001);
          vv.addAssign(vec3(toP.div(dP).mul(smoothstep(10, 0, dP).mul(90).mul(dt)), 0));
          Loop(MAX_SHOCKS, ({ i: k }) => {
            const s = shockArr.element(k);
            const toS = p.xy.sub(s.xy);
            const dS = max(toS.length(), 0.001);
            const ring = exp(dS.sub(s.z).div(6).pow(2).negate());
            vv.addAssign(vec3(toS.div(dS).mul(ring.mul(s.w).mul(dt)), 0));
          });
          const np = p.xyz.add(vv.mul(dt)).toVar();
          // Down in the environment particles scroll with it; up in the play plane, only partly.
          const ground = isFlame.or(np.z.lessThan(-8)).select(1, 0.3);
          np.y.subAssign(float(SCROLL_SPEED).mul(dt).mul(ground));
          If(np.z.lessThan(floorZ), () => {
            np.z.assign(floorZ);
            vv.z.assign(vv.z.abs().mul(0.38));
            vv.x.mulAssign(0.7);
            vv.y.mulAssign(0.7);
          });
          p.assign(vec4(np, p.w.sub(dt)));
          v.assign(vec4(vv, v.w));
        });
      });
    })().compute(capacity);

    // ── Rendering ──
    const mat = new SpriteNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    mat.fog = false;
    const pAttr = pos.toAttribute();
    const vAttr = vel.toAttribute();
    const cAttr = col.toAttribute();
    const kind = cAttr.w.div(8).floor();
    const size = cAttr.w.sub(kind.mul(8));
    const lifeT = pAttr.w.div(max(vAttr.w, 0.001)).clamp(0, 1);
    const isMote = kind.equal(MOTE);
    const isFlame = kind.equal(FLAME);
    const speedXY = vAttr.xy.length();
    const stretch = kind.equal(0).select(min(float(1).add(speedXY.mul(0.035)), 5), float(1));
    const alive = isMote.or(pAttr.w.greaterThan(0));
    const fade = isMote.select(
      float(0.12).add(min(speedXY.mul(0.035), 1.2)),
      smoothstep(0, 0.3, lifeT).mul(
        kind
          .equal(1)
          .or(isFlame)
          .select(sin(lifeT.mul(Math.PI)), float(1)),
      ),
    );
    const moteCol = vec3(this.theme.x, this.theme.y, this.theme.z).mul(0.6).add(0.1);
    // Flames cool from yellow-white to deep red as they rise, and billow out.
    const flameCol = cAttr.xyz.mul(mix(vec3(0.55, 0.16, 0.06), vec3(1.3, 1, 0.75), lifeT));
    const baseCol = isMote.select(moteCol, isFlame.select(flameCol, cAttr.xyz));
    mat.positionNode = pAttr.xyz;
    mat.rotationNode = atan(vAttr.y, vAttr.x);
    const s = alive.select(size, float(0)).mul(isFlame.select(mix(2, 0.8, lifeT), float(1)));
    mat.scaleNode = vec2(s.mul(stretch), s);
    const r = uv().sub(0.5).length().mul(2);
    const shape = smoothstep(1, 0, r).pow(1.6);
    mat.colorNode = vec4(baseCol.mul(fade).mul(shape), 1);

    this.sprite = new Sprite(mat);
    this.sprite.count = capacity;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 12;
    scene.add(this.sprite);
  }

  emit(spec: EmitSpec): void {
    if (this.pending.length < MAX_EMIT) this.pending.push(spec);
  }

  /** World-space push ring that expands from (x, y). */
  shock(x: number, y: number, strength: number): void {
    if (this.shocks.length >= MAX_SHOCKS) this.shocks.shift();
    this.shocks.push({ x, y, age: 0, strength });
  }

  setTheme(color: Color): void {
    this.theme.value.set(color.r, color.g, color.b, 1);
  }

  update(dt: number, playerX: number, playerY: number): void {
    this.frame++;
    let total = 0;
    for (let k = 0; k < MAX_EMIT; k++) {
      const e = this.pending[k];
      if (!e) {
        this.eA[k]!.set(0, 0, 0, 0);
        continue;
      }
      const count = Math.min(e.count, this.ringSize - total);
      total += count;
      const intensity = e.intensity ?? 1;
      this.eA[k]!.set(e.x, e.y, e.z ?? 0, count);
      this.eB[k]!.set(e.speed[0], e.speed[1], e.life, Math.min(7.9, e.size));
      this.eC[k]!.set(
        e.color.r * intensity,
        e.color.g * intensity,
        e.color.b * intensity,
        KIND_ID[e.kind ?? 'spark'],
      );
      this.eD[k]!.set(e.dir ?? 0, e.spread ?? Math.PI * 2, e.zBias ?? 0.35, 0);
    }
    this.pending = [];
    this.spawnBase.value = this.cursor;
    this.spawnTotal.value = total;
    this.cursor = (this.cursor + total) % this.ringSize;
    this.frameSeed.value = (this.frame * 0.618) % 97;
    this.dt.value = Math.min(dt, 1 / 20);
    this.player.value.set(playerX, playerY, 0, 0);

    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i]!;
      s.age += dt;
      if (s.age > 0.9) this.shocks.splice(i, 1);
    }
    for (let i = 0; i < MAX_SHOCKS; i++) {
      const s = this.shocks[i];
      if (s) this.shockData[i]!.set(s.x, s.y, s.age * 70, s.strength * (1 - s.age / 0.9));
      else this.shockData[i]!.set(0, 0, 0, 0);
    }
    this.renderer.compute(this.kernel);
  }
}
