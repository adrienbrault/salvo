import { getItem, resolveRelicDef } from '../content/registry';
import type { HookCtx, ItemDef, ItemInstance, LevelEndInfo } from '../content/types';
import type { RunState } from '../run/state';
import {
  DEATH_OUTRO,
  DESPAWN_MARGIN,
  FIELD,
  GAUGE_KEEP_ON_HIT,
  GAUGE_PER_KILL,
  HIT_CLEAR_RADIUS,
  HIT_INVULN,
  LEVEL_INTRO,
  LEVEL_OUTRO,
  PLAYER_BOUNDS,
  PLAYER_SPAWN,
} from './constants';
import { CONSTRAINTS, type ConstraintDef, type Difficulty } from './constraints';
import { Director } from './director';
import { ARCHETYPES, onEnemyDeath } from './enemies';
import { difficultyFor, type LevelSpec } from './level';
import { clamp, turnToward } from './math';
import { Pool } from './pool';
import type { Rng } from './rng';
import { computeStats } from './stats';
import type {
  Bullet,
  BulletStyle,
  Enemy,
  EnemyKind,
  FxEvent,
  Hue,
  InputFrame,
  KillInfo,
  KillType,
  Player,
  PlayerStats,
  ScoreCalc,
  Wave,
} from './types';
import { emptyInput } from './types';
import { MIRROR, mirrorAbsorb, RAM, WEAPONS, type WeaponImpl } from './weapons';

export type WorldPhase = 'intro' | 'play' | 'outro' | 'done';

interface HookEntry {
  def: ItemDef;
  ctx: HookCtx;
}

export interface FriendlyShotOpts {
  damage: number;
  style: BulletStyle;
  hue: Hue;
  killType: KillType;
  homing?: number;
  life?: number;
  radius?: number;
}

export interface EnemyShotOpts {
  style?: BulletStyle;
  hue?: Hue;
  radius?: number;
  accel?: number;
  maxSpeed?: number;
  spin?: number;
  life?: number;
}

/** Per-level recap data (shown after each level). */
export interface LevelTally {
  kills: number;
  killsByType: Record<KillType, number>;
  scoreByType: Record<KillType, number>;
  bestKill: number;
  grazes: number;
  damageTaken: number;
  triggers: number[];
  moneyEarned: number;
}

const newBullet = (): Bullet => ({
  x: 0,
  y: 0,
  px: 0,
  py: 0,
  vx: 0,
  vy: 0,
  radius: 1,
  damage: 1,
  friendly: false,
  style: 'orb',
  hue: 'pink',
  age: 0,
  life: Number.POSITIVE_INFINITY,
  accel: 0,
  maxSpeed: 999,
  spin: 0,
  homing: 0,
  pierce: 0,
  bounces: 0,
  killType: 'tir',
  grazed: false,
  lastHitId: -1,
  reflected: false,
});

const newEnemy = (): Enemy => ({
  id: 0,
  kind: 'dart',
  x: 0,
  y: 0,
  px: 0,
  py: 0,
  vx: 0,
  vy: 0,
  radius: 1,
  hp: 1,
  maxHp: 1,
  value: 0,
  heavy: false,
  boss: false,
  age: 0,
  flash: 0,
  hue: 'pink',
  rot: -Math.PI / 2,
  a: 0,
  b: 0,
  c: 0,
  d: 0,
  fireT: 0,
  state: 0,
  stateT: 0,
  dashHit: -1,
  dead: false,
});

const zeroByType = (): Record<KillType, number> => ({ tir: 0, impact: 0, renvoi: 0, onde: 0, reaction: 0 });

/**
 * One level of play. Deterministic given (run, spec, rng seed, input sequence).
 * Call `step(input)` at a fixed DT; read state for rendering; drain `fx` after each frame.
 */
export class World {
  readonly run: RunState;
  readonly spec: LevelSpec;
  readonly rng: Rng;
  readonly diff: Difficulty;
  readonly constraint: ConstraintDef | null;
  stats: PlayerStats;
  weapon: WeaponImpl;

  readonly player: Player;
  readonly enemies = new Pool<Enemy>(newEnemy);
  /** Enemy bullets. */
  readonly bullets = new Pool<Bullet>(newBullet);
  /** Friendly projectiles. */
  readonly shots = new Pool<Bullet>(newBullet);
  readonly waves: Wave[] = [];
  readonly fx: FxEvent[] = [];
  readonly tally: LevelTally;

  phase: WorldPhase = 'intro';
  result: 'won' | 'lost' | null = null;
  lostReason: 'time' | 'death' | null = null;
  /** Seconds since level start. */
  time = 0;
  phaseT = 0;
  timeLeft: number;
  score = 0;
  /** Level Mult gauge: every kill's base Mult. */
  gauge = 1;
  boss: Enemy | null = null;
  input: InputFrame = emptyInput();
  actionPressed = false;
  actionReleased = false;
  /** Enemy & enemy-bullet time scale (Chronostase). */
  enemyTimeScale = 1;
  slowT = 0;
  muzzleFlip = false;

  private prevAction = false;
  private nextId = 1;
  private readonly director: Director;
  private hooks: HookEntry[] = [];
  private timeWarned = false;
  private blackoutOn = false;

  constructor(run: RunState, spec: LevelSpec, rng: Rng) {
    this.run = run;
    this.spec = spec;
    this.rng = rng;
    this.diff = difficultyFor(spec);
    this.constraint = spec.constraint ? CONSTRAINTS[spec.constraint] : null;
    this.timeLeft = spec.duration;
    this.director = new Director(this, rng.fork('director'));
    this.tally = {
      kills: 0,
      killsByType: zeroByType(),
      scoreByType: zeroByType(),
      bestKill: 0,
      grazes: 0,
      damageTaken: 0,
      triggers: [],
      moneyEarned: 0,
    };

    this.player = {
      x: PLAYER_SPAWN.x,
      y: PLAYER_SPAWN.y,
      px: PLAYER_SPAWN.x,
      py: PLAYER_SPAWN.y,
      vx: 0,
      vy: 0,
      hp: run.hp,
      invuln: 0,
      alive: true,
      still: 0,
      fireT: 0,
      cooldown: 0,
      cooldownMax: 1,
      charge: 0,
      stored: 0,
      shield: false,
      dashT: 0,
      dashDx: 0,
      dashDy: 1,
      dashId: 0,
      charges: 0,
      maxCharges: 0,
      chargeT: 0,
      disabled: false,
    };

    // Level-start hooks may mutate the loadout (Dague rituelle), so stats/hooks are built after.
    this.stats = computeStats(run);
    this.weapon = this.resolveWeapon();
    this.rebuildHooks();
    for (const h of this.hooks) h.def.onLevelStart?.(h.ctx);
    this.refreshLoadout();
    this.player.hp = Math.min(run.hp, this.stats.maxHp);
    this.weapon.init(this);
  }

  // ── Loadout & hooks ─────────────────────────────────────────────────────────

  /** Recompute stats + hook table after the loadout changed. */
  refreshLoadout(): void {
    this.stats = computeStats(this.run);
    this.weapon = this.resolveWeapon();
    this.rebuildHooks();
    this.player.hp = Math.min(this.player.hp, this.stats.maxHp);
  }

  private resolveWeapon(): WeaponImpl {
    const def = getItem(this.run.loadout.weapon.id);
    return WEAPONS[def.weapon ?? 'blaster'];
  }

  private makeCtx(inst: ItemInstance, slot: number): HookCtx {
    const world = this;
    return {
      world,
      inst,
      slot,
      trigger(label) {
        if (slot >= 0) {
          world.tally.triggers[slot] = (world.tally.triggers[slot] ?? 0) + 1;
          world.fx.push(label === undefined ? { t: 'relic', slot } : { t: 'relic', slot, label });
        }
      },
      addGauge(amount) {
        world.addGauge(amount);
      },
      addMoney(amount) {
        world.addMoney(amount, world.player.x, world.player.y);
      },
    };
  }

  private rebuildHooks(): void {
    const lo = this.run.loadout;
    const entries: HookEntry[] = [];
    for (const inst of [lo.weapon, lo.engine, lo.core]) {
      entries.push({ def: getItem(inst.id), ctx: this.makeCtx(inst, -1) });
    }
    lo.relics.forEach((inst, slot) => {
      const def = resolveRelicDef(lo.relics, slot);
      if (def) entries.push({ def, ctx: this.makeCtx(inst, slot) });
    });
    this.hooks = entries;
  }

  emitAction(): void {
    for (const h of this.hooks) h.def.onAction?.(h.ctx);
  }

  /** Called by the app when the level ends (after `done`). */
  emitLevelEnd(): void {
    const info: LevelEndInfo = {
      won: this.result === 'won',
      damageTaken: this.tally.damageTaken,
      timeLeft: Math.max(0, this.timeLeft),
    };
    for (const h of this.hooks) h.def.onLevelEnd?.(h.ctx, info);
  }

  // ── Mutators used by weapons, enemies and items ─────────────────────────────

  addGauge(amount: number): void {
    const mul = this.stats.gaugeGainMul * (this.constraint?.gaugeMul ?? 1);
    this.gauge = Math.max(1, this.gauge + amount * mul);
  }

  addMoney(amount: number, x: number, y: number): void {
    if (amount === 0) return;
    this.run.money += amount;
    this.tally.moneyEarned += amount;
    this.fx.push({ t: 'money', amount, x, y });
  }

  heal(amount: number): void {
    const p = this.player;
    const before = p.hp;
    p.hp = Math.min(this.stats.maxHp, p.hp + amount);
    if (p.hp > before) this.fx.push({ t: 'heal', x: p.x, y: p.y });
  }

  spawnEnemy(kind: EnemyKind, x: number, y: number, init: Partial<Enemy> = {}): Enemy {
    const arch = ARCHETYPES[kind];
    const e = this.enemies.spawn();
    const hp = arch.hp * this.diff.hpMul;
    e.id = this.nextId++;
    e.kind = kind;
    e.x = e.px = x;
    e.y = e.py = y;
    e.vx = 0;
    e.vy = 0;
    e.radius = arch.radius;
    e.hp = e.maxHp = hp;
    e.value = Math.round(arch.value * this.diff.valueMul);
    e.heavy = arch.heavy;
    e.boss = kind === 'boss';
    e.age = 0;
    e.flash = 0;
    e.hue = arch.hue;
    e.rot = -Math.PI / 2;
    e.a = 0;
    e.b = 0;
    e.c = 0;
    e.d = 0;
    e.fireT = 0.6 + this.rng.next() * 0.8;
    e.state = 0;
    e.stateT = 0;
    e.dashHit = -1;
    e.dead = false;
    Object.assign(e, init);
    if (e.boss) {
      this.boss = e;
      this.fx.push({ t: 'bossSpawn', x, y });
    }
    return e;
  }

  fireEnemy(x: number, y: number, angle: number, speed: number, o: EnemyShotOpts = {}): void {
    const b = this.bullets.spawn();
    b.x = b.px = x;
    b.y = b.py = y;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.radius = o.radius ?? (o.style === 'needle' ? 1.05 : 1.3);
    b.damage = 1;
    b.friendly = false;
    b.style = o.style ?? 'orb';
    b.hue = o.hue ?? 'pink';
    b.age = 0;
    b.life = o.life ?? Number.POSITIVE_INFINITY;
    b.accel = o.accel ?? 0;
    b.maxSpeed = o.maxSpeed ?? 999;
    b.spin = o.spin ?? 0;
    b.homing = 0;
    b.pierce = 0;
    b.bounces = 0;
    b.killType = 'tir';
    b.grazed = false;
    b.lastHitId = -1;
    b.reflected = false;
  }

  fireShot(x: number, y: number, angle: number, speed: number, o: FriendlyShotOpts): Bullet {
    const b = this.shots.spawn();
    b.x = b.px = x;
    b.y = b.py = y;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.radius = o.radius ?? 1.4;
    b.damage = o.damage;
    b.friendly = true;
    b.style = o.style;
    b.hue = o.hue;
    b.age = 0;
    b.life = o.life ?? 3;
    b.accel = 0;
    b.maxSpeed = 999;
    b.spin = 0;
    b.homing = o.homing ?? 0;
    b.pierce = this.stats.pierce;
    b.bounces = this.stats.bounces;
    b.killType = o.killType;
    b.grazed = false;
    b.lastHitId = -1;
    b.reflected = o.style === 'reflect';
    return b;
  }

  spawnWave(
    x: number,
    y: number,
    maxR: number,
    damage: number,
    killType: KillType,
    o: { cancels?: boolean; hue?: Hue; speed?: number } = {},
  ): void {
    this.waves.push({
      id: this.nextId++,
      x,
      y,
      r: 0,
      maxR,
      speed: o.speed ?? 160,
      damage,
      killType,
      cancels: o.cancels ?? false,
      hue: o.hue ?? 'gold',
      hit: new Set(),
    });
    this.fx.push({ t: 'wave', x, y, maxR, hue: o.hue ?? 'gold' });
  }

  cancelEnemyBullets(cx?: number, cy?: number, radius?: number): number {
    const items = this.bullets.items;
    const r2 = radius !== undefined ? radius * radius : Number.POSITIVE_INFINITY;
    let n = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      const b = items[i]!;
      if (cx !== undefined && cy !== undefined) {
        const dx = b.x - cx;
        const dy = b.y - cy;
        if (dx * dx + dy * dy > r2) continue;
      }
      this.fx.push({ t: 'cancel', x: b.x, y: b.y, hue: b.hue });
      this.bullets.releaseAt(i);
      n++;
    }
    return n;
  }

  /** Applies damage; returns true if the enemy died. */
  damageEnemy(e: Enemy, amount: number, killType: KillType): boolean {
    if (e.dead || this.phase === 'outro' || this.phase === 'done') return false;
    e.hp -= amount;
    e.flash = 0.09;
    if (e.hp <= 0) {
      this.killEnemy(e, killType);
      return true;
    }
    return false;
  }

  // ── Main step ───────────────────────────────────────────────────────────────

  step(input: InputFrame, dt: number): void {
    this.input = input;
    this.actionPressed = input.action && !this.prevAction;
    this.actionReleased = !input.action && this.prevAction;
    this.prevAction = input.action;

    this.time += dt;
    this.phaseT += dt;
    this.updatePhase(dt);

    // Chronostase slow-down
    if (this.slowT > 0) {
      this.slowT -= dt;
      this.enemyTimeScale = 0.45;
    } else {
      this.enemyTimeScale = Math.min(1, this.enemyTimeScale + dt * 3);
    }
    const edt = dt * this.enemyTimeScale;

    this.updateBlackout();
    this.updatePlayer(dt);
    if (this.player.alive) this.weapon.update(this, dt);
    this.updateEnemies(edt);
    this.updateShots(dt);
    this.updateEnemyBullets(edt);
    this.updateWaves(dt);
    this.collidePlayer();
    this.removeDead();

    if (this.phase === 'play') {
      for (const h of this.hooks) h.def.onTick?.(h.ctx, dt);
    }
    this.director.update(edt, this.phase === 'play');
  }

  private updatePhase(dt: number): void {
    if (this.phase === 'intro') {
      if (this.phaseT >= LEVEL_INTRO) this.setPhase('play');
      if (this.spec.kind === 'boss' && !this.boss && this.phaseT >= LEVEL_INTRO * 0.5) {
        this.spawnEnemy('boss', 0, FIELD.halfH + 16, {});
      }
    } else if (this.phase === 'play') {
      this.timeLeft -= dt;
      if (!this.timeWarned && this.timeLeft <= 10) {
        this.timeWarned = true;
        this.fx.push({ t: 'timeWarning' });
      }
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.finish('lost', 'time');
      }
    } else if (this.phase === 'outro') {
      const len = this.result === 'won' ? LEVEL_OUTRO : DEATH_OUTRO;
      if (this.phaseT >= len) this.setPhase('done');
    }
  }

  private setPhase(p: WorldPhase): void {
    this.phase = p;
    this.phaseT = 0;
  }

  private finish(result: 'won' | 'lost', reason: 'time' | 'death' | null): void {
    if (this.result) return;
    this.result = result;
    this.lostReason = reason;
    this.setPhase('outro');
    if (result === 'won') {
      this.fx.push({ t: 'quota' });
      // Screen clear: everything explodes (no score), bullets vanish.
      for (const e of this.enemies.items) {
        if (e.dead) continue;
        e.dead = true;
        this.fx.push({ t: 'explode', x: e.x, y: e.y, size: e.radius, hue: e.hue, kind: e.kind });
      }
      this.cancelEnemyBullets();
    }
  }

  private updateBlackout(): void {
    const bo = this.constraint?.blackout;
    const on = !!bo && this.phase === 'play' && this.phaseT % bo.period > bo.period - bo.duration;
    if (on !== this.blackoutOn) {
      this.blackoutOn = on;
      this.fx.push({ t: 'blackout', on });
    }
    this.player.disabled = on;
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    p.px = p.x;
    p.py = p.y;
    if (p.invuln > 0) p.invuln -= dt;
    if (!p.alive) return;

    const inp = this.input;
    let speed = this.stats.speed * (this.weapon.speedFactor?.(this) ?? 1);
    if (inp.precise) speed *= 0.45;
    let vx = 0;
    let vy = 0;

    if (p.dashT > 0) {
      vx = p.dashDx * RAM.speed;
      vy = p.dashDy * RAM.speed;
    } else if (inp.hasTarget) {
      const dx = inp.tx - p.x;
      const dy = inp.ty - p.y;
      const d = Math.hypot(dx, dy);
      // Pointer control: close the gap quickly, capped by ship speed.
      const want = Math.min(speed, d / dt, d * 14);
      if (d > 1e-4) {
        vx = (dx / d) * want;
        vy = (dy / d) * want;
      }
    } else {
      const len = Math.hypot(inp.dx, inp.dy);
      if (len > 0) {
        vx = (inp.dx / Math.max(1, len)) * speed;
        vy = (inp.dy / Math.max(1, len)) * speed;
      }
    }

    p.x = clamp(p.x + vx * dt, PLAYER_BOUNDS.minX, PLAYER_BOUNDS.maxX);
    p.y = clamp(p.y + vy * dt, PLAYER_BOUNDS.minY, PLAYER_BOUNDS.maxY);
    p.vx = (p.x - p.px) / dt;
    p.vy = (p.y - p.py) / dt;
    if (Math.hypot(p.vx, p.vy) < 6) p.still += dt;
    else p.still = 0;
  }

  private updateEnemies(dt: number): void {
    const items = this.enemies.items;
    for (let i = 0; i < items.length; i++) {
      const e = items[i]!;
      e.px = e.x;
      e.py = e.y;
      if (e.dead) continue;
      e.age += dt;
      if (e.flash > 0) e.flash -= dt;
      ARCHETYPES[e.kind].update(e, this, dt);
      const out =
        e.y < -FIELD.halfH - DESPAWN_MARGIN ||
        e.y > FIELD.halfH + DESPAWN_MARGIN * 3 ||
        Math.abs(e.x) > FIELD.halfW + DESPAWN_MARGIN;
      if (out && e.age > 1) e.dead = true; // escaped, no score
    }
  }

  private nearestEnemy(x: number, y: number): Enemy | null {
    let best: Enemy | null = null;
    let bd = Number.POSITIVE_INFINITY;
    for (const e of this.enemies.items) {
      if (e.dead || e.y > FIELD.halfH + 2) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private updateShots(dt: number): void {
    const items = this.shots.items;
    const enemies = this.enemies.items;
    const armored = this.constraint?.armoredFront;
    const mirrorChance = this.constraint?.mirrorChance ?? 0;
    for (let i = items.length - 1; i >= 0; i--) {
      const b = items[i]!;
      b.px = b.x;
      b.py = b.y;
      b.age += dt;
      if (b.homing > 0 && b.age > 0.08) {
        const t = this.nearestEnemy(b.x, b.y);
        if (t) {
          const speed = Math.hypot(b.vx, b.vy);
          const a = turnToward(Math.atan2(b.vy, b.vx), Math.atan2(t.y - b.y, t.x - b.x), b.homing * dt);
          b.vx = Math.cos(a) * speed;
          b.vy = Math.sin(a) * speed;
        }
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.bounces > 0 && Math.abs(b.x) > FIELD.halfW) {
        b.x = Math.sign(b.x) * FIELD.halfW;
        b.vx = -b.vx;
        b.bounces--;
      }
      if (
        b.age > b.life ||
        b.y > FIELD.halfH + DESPAWN_MARGIN ||
        b.y < -FIELD.halfH - DESPAWN_MARGIN ||
        Math.abs(b.x) > FIELD.halfW + DESPAWN_MARGIN
      ) {
        this.shots.releaseAt(i);
        continue;
      }
      let consumed = false;
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j]!;
        if (e.dead || e.id === b.lastHitId || e.y > FIELD.halfH + 4) continue;
        const rr = e.radius + b.radius;
        const dx = e.x - b.x;
        const dy = e.y - b.y;
        if (dx * dx + dy * dy > rr * rr) continue;
        let dmg = b.damage;
        let deflected = false;
        if (armored !== undefined && b.vy > 0 && Math.abs(b.vx) < b.vy * 0.5) {
          dmg *= armored;
          deflected = true;
        }
        this.fx.push({ t: 'hit', x: b.x, y: b.y, hue: b.hue, deflected });
        if (mirrorChance > 0 && this.rng.next() < mirrorChance) {
          this.fireEnemy(
            b.x,
            b.y,
            Math.atan2(this.player.y - b.y, this.player.x - b.x),
            55 * this.diff.bulletSpeed,
            {
              hue: 'white',
              style: 'needle',
            },
          );
        }
        this.damageEnemy(e, dmg, b.killType);
        if (b.pierce > 0) {
          b.pierce--;
          b.lastHitId = e.id;
        } else {
          consumed = true;
          break;
        }
      }
      if (consumed) this.shots.releaseAt(i);
    }
  }

  private updateEnemyBullets(dt: number): void {
    const items = this.bullets.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const b = items[i]!;
      b.px = b.x;
      b.py = b.y;
      b.age += dt;
      if (b.accel !== 0 || b.spin !== 0) {
        let speed = Math.hypot(b.vx, b.vy);
        let a = Math.atan2(b.vy, b.vx);
        speed = clamp(speed + b.accel * dt, 0, b.maxSpeed);
        a += b.spin * dt;
        b.vx = Math.cos(a) * speed;
        b.vy = Math.sin(a) * speed;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (
        b.age > b.life ||
        b.y < -FIELD.halfH - DESPAWN_MARGIN ||
        b.y > FIELD.halfH + DESPAWN_MARGIN * 2 ||
        Math.abs(b.x) > FIELD.halfW + DESPAWN_MARGIN
      ) {
        this.bullets.releaseAt(i);
      }
    }
  }

  private updateWaves(dt: number): void {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wv = this.waves[i]!;
      wv.r = Math.min(wv.maxR, wv.r + wv.speed * dt);
      const r = wv.r;
      for (const e of this.enemies.items) {
        if (e.dead || wv.hit.has(e.id)) continue;
        const rr = r + e.radius;
        if ((e.x - wv.x) ** 2 + (e.y - wv.y) ** 2 <= rr * rr) {
          wv.hit.add(e.id);
          this.fx.push({ t: 'hit', x: e.x, y: e.y, hue: wv.hue, deflected: false });
          this.damageEnemy(e, wv.damage, wv.killType);
        }
      }
      if (wv.cancels) this.cancelEnemyBullets(wv.x, wv.y, r);
      if (wv.r >= wv.maxR) this.waves.splice(i, 1);
    }
  }

  private collidePlayer(): void {
    const p = this.player;
    if (!p.alive || this.phase === 'done') return;
    const hitR = this.stats.hitRadius;
    const grazeR = this.stats.grazeRadius;
    const dashing = p.dashT > 0;
    const items = this.bullets.items;

    for (let i = items.length - 1; i >= 0; i--) {
      const b = items[i]!;
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (dashing && d2 <= (RAM.radius + b.radius) ** 2) {
        this.fx.push({ t: 'cancel', x: b.x, y: b.y, hue: b.hue });
        this.bullets.releaseAt(i);
        continue;
      }
      if (p.shield && d2 <= (MIRROR.shieldRadius + b.radius) ** 2) {
        mirrorAbsorb(this);
        this.bullets.releaseAt(i);
        continue;
      }
      if (d2 <= (hitR + b.radius) ** 2) {
        if (p.invuln <= 0 && !dashing) {
          this.bullets.releaseAt(i);
          // hurtPlayer cancels nearby bullets (mutates this pool): stop iterating it.
          this.hurtPlayer();
          if (!p.alive) return;
          break;
        }
        continue;
      }
      if (!b.grazed && d2 <= (grazeR + b.radius) ** 2 && this.phase === 'play') {
        b.grazed = true;
        const gap = Math.sqrt(d2) - hitR - b.radius;
        const close = gap < 3;
        this.tally.grazes++;
        this.run.stats.grazes++;
        this.fx.push({ t: 'graze', x: b.x, y: b.y, close });
        const info = { x: b.x, y: b.y, gap, close };
        for (const h of this.hooks) h.def.onGraze?.(h.ctx, info);
        this.weapon.onGraze?.(this, b);
      }
    }

    // Enemy contact
    for (const e of this.enemies.items) {
      if (e.dead) continue;
      const reach = (dashing ? RAM.radius : hitR) + e.radius;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      if (dashing) {
        if (e.dashHit !== p.dashId) {
          e.dashHit = p.dashId;
          this.fx.push({ t: 'hit', x: e.x, y: e.y, hue: 'white', deflected: false });
          this.damageEnemy(e, RAM.damage * this.stats.damageMul, 'impact');
        }
      } else if (p.invuln <= 0) {
        if (!e.boss) this.damageEnemy(e, 6 * this.stats.damageMul, 'impact');
        this.hurtPlayer();
        if (!p.alive) return;
      }
    }
  }

  hurtPlayer(): void {
    const p = this.player;
    if (!p.alive || p.invuln > 0 || this.phase === 'outro' || this.phase === 'done') return;
    p.hp -= 1;
    p.invuln = HIT_INVULN;
    this.tally.damageTaken++;
    this.run.stats.damageTaken++;
    this.gauge = 1 + (this.gauge - 1) * GAUGE_KEEP_ON_HIT;
    this.fx.push({ t: 'playerHit', x: p.x, y: p.y, hpLeft: p.hp });
    this.cancelEnemyBullets(p.x, p.y, HIT_CLEAR_RADIUS);
    for (const h of this.hooks) h.def.onHit?.(h.ctx);
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      p.shield = false;
      this.fx.push({ t: 'playerDeath', x: p.x, y: p.y });
      this.finish('lost', 'death');
    }
  }

  private killEnemy(e: Enemy, killType: KillType): void {
    e.dead = true;
    const p = this.player;
    this.tally.kills++;
    this.run.stats.kills++;
    this.tally.killsByType[killType]++;
    const lvl = this.run.calibrations[killType] ?? 0;
    const info: KillInfo = {
      enemy: e,
      killType,
      dist: Math.hypot(e.x - p.x, e.y - p.y),
      duringDash: p.dashT > 0,
      killIndex: this.tally.kills,
    };
    const calc: ScoreCalc = { base: e.value + lvl * 15, mult: this.gauge + lvl, repeats: 1 };
    for (const h of this.hooks) h.def.onKill?.(h.ctx, info, calc);
    const total = Math.max(0, Math.round(calc.base * calc.mult)) * calc.repeats;
    this.score += total;
    this.tally.scoreByType[killType] += total;
    this.tally.bestKill = Math.max(this.tally.bestKill, total);
    this.addGauge(GAUGE_PER_KILL);

    this.fx.push({ t: 'explode', x: e.x, y: e.y, size: e.radius, hue: e.hue, kind: e.kind });
    this.fx.push({
      t: 'score',
      x: e.x,
      y: e.y,
      base: calc.base,
      mult: calc.mult,
      total,
      repeats: calc.repeats,
    });

    onEnemyDeath(e, this);
    if (this.stats.chainExplosions) {
      this.spawnWave(e.x, e.y, 10 + e.radius * 1.4, Math.max(3, e.maxHp * 0.45), 'reaction', {
        hue: 'orange',
        speed: 110,
      });
    }
    if (e === this.boss) this.boss = null;
    if (this.score >= this.spec.quota && this.phase === 'play') this.finish('won', null);
  }

  private removeDead(): void {
    const items = this.enemies.items;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i]!.dead) {
        if (items[i] === this.boss) this.boss = null;
        this.enemies.releaseAt(i);
      }
    }
  }
}
