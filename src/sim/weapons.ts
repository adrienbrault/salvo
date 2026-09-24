import type { WeaponId } from '../content/types';
import type { Bullet } from './types';
import type { World } from './world';

/**
 * A weapon defines what the single action button does and how the ship deals damage.
 * Each one pushes a different play style (see docs/design.md).
 */
export interface WeaponImpl {
  readonly id: WeaponId;
  init(w: World): void;
  update(w: World, dt: number): void;
  /** Called for every graze (after relic hooks). */
  onGraze?(w: World, b: Bullet): void;
  /** Movement speed factor this frame. */
  speedFactor?(w: World): number;
}

const UP = Math.PI / 2;

// ── Blaster (Falcon): auto-fire + Salvo ──────────────────────────────────────
export const BLASTER = {
  interval: 0.085,
  speed: 250,
  damage: 1,
  salvoCount: 13,
  salvoSpread: 1.9,
  salvoDamage: 1.6,
  salvoCooldown: 2.2,
} as const;

const blaster: WeaponImpl = {
  id: 'blaster',
  init(w) {
    w.player.cooldownMax = BLASTER.salvoCooldown;
    w.player.cooldown = 0;
  },
  update(w, dt) {
    const p = w.player;
    p.cooldown = Math.max(0, p.cooldown - dt * w.stats.actionRecharge);
    if (p.disabled || !p.alive) return;
    p.fireT -= dt;
    if (p.fireT <= 0) {
      p.fireT = Math.max(p.fireT + BLASTER.interval / w.stats.rateMul, 0);
      const dmg = BLASTER.damage * w.stats.damageMul;
      for (const ox of [-1.9, 1.9]) {
        w.fireShot(p.x + ox, p.y + 3.5, UP, BLASTER.speed, {
          damage: dmg,
          style: 'bolt',
          hue: 'cyan',
          killType: 'tir',
        });
      }
      w.muzzleFlip = !w.muzzleFlip;
      if (w.muzzleFlip) w.fx.push({ t: 'muzzle', x: p.x, y: p.y + 4, hue: 'cyan' });
    }
    if (w.actionPressed && p.cooldown <= 0) {
      p.cooldown = p.cooldownMax;
      const dmg = BLASTER.salvoDamage * w.stats.damageMul;
      const n = BLASTER.salvoCount;
      for (let i = 0; i < n; i++) {
        const a = UP - BLASTER.salvoSpread / 2 + (BLASTER.salvoSpread * i) / (n - 1);
        w.fireShot(p.x, p.y + 3, a, BLASTER.speed * 0.85, {
          damage: dmg,
          style: 'bolt',
          hue: 'blue',
          killType: 'tir',
        });
      }
      w.fx.push({ t: 'salvo', x: p.x, y: p.y });
      w.emitAction();
    }
  },
};

// ── Grazer (Firefly): grazes charge a Wave + spawn homing sparks ─────────────
export const GRAZER = {
  passiveCharge: 0.025,
  grazeCharge: 0.06,
  sparkDamage: 1.5,
  sparkSpeed: 150,
  sparkHoming: 7,
  minCharge: 0.15,
  waveBaseR: 14,
  waveBonusR: 46,
  waveBaseDmg: 6,
  waveBonusDmg: 34,
} as const;

const grazer: WeaponImpl = {
  id: 'grazer',
  init(w) {
    w.player.charge = 0.35;
  },
  update(w, dt) {
    const p = w.player;
    p.charge = Math.min(1, p.charge + GRAZER.passiveCharge * dt * w.stats.rateMul);
    if (p.disabled || !p.alive) return;
    if (w.actionPressed && p.charge >= GRAZER.minCharge) {
      const c = p.charge;
      p.charge = 0;
      const maxR = GRAZER.waveBaseR + GRAZER.waveBonusR * c;
      w.spawnWave(
        p.x,
        p.y,
        maxR,
        (GRAZER.waveBaseDmg + GRAZER.waveBonusDmg * c) * w.stats.damageMul,
        'onde',
        {
          cancels: true,
          hue: 'gold',
          speed: 190,
        },
      );
      w.emitAction();
    }
  },
  onGraze(w, b) {
    const p = w.player;
    p.charge = Math.min(1, p.charge + GRAZER.grazeCharge * w.stats.rateMul);
    if (p.disabled) return;
    const a = Math.atan2(b.y - p.y, b.x - p.x) + Math.PI;
    w.fireShot(p.x, p.y, a, GRAZER.sparkSpeed, {
      damage: GRAZER.sparkDamage * w.stats.damageMul,
      style: 'spark',
      hue: 'gold',
      killType: 'onde',
      homing: GRAZER.sparkHoming,
      life: 2.5,
    });
  },
};

// ── Mirror (Prism): hold to shield & absorb, release to send everything back ─
export const MIRROR = {
  shieldRadius: 7.5,
  drain: 0.38,
  absorbCost: 0.018,
  regen: 0.3,
  maxStored: 60,
  /** Each absorbed bullet comes back as this many homing shots. */
  shotsPerBullet: 2,
  shotDamage: 2.2,
  shotSpeed: 185,
  shotHoming: 6,
  slow: 0.62,
} as const;

function mirrorRelease(w: World): void {
  const p = w.player;
  p.shield = false;
  const absorbed = p.stored;
  if (absorbed <= 0) return;
  p.stored = 0;
  const n = Math.min(90, absorbed * MIRROR.shotsPerBullet);
  const spread = Math.min(2.2, 0.35 + n * 0.06);
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? UP : UP - spread / 2 + (spread * i) / (n - 1);
    w.fireShot(p.x, p.y + 2, a, MIRROR.shotSpeed, {
      damage: MIRROR.shotDamage * w.stats.damageMul,
      style: 'reflect',
      hue: 'white',
      killType: 'renvoi',
      homing: MIRROR.shotHoming,
      life: 3,
    });
  }
  w.fx.push({ t: 'release', x: p.x, y: p.y, count: absorbed });
  w.emitAction();
}

const mirror: WeaponImpl = {
  id: 'mirror',
  init(w) {
    w.player.charge = 1;
    w.player.stored = 0;
  },
  update(w, dt) {
    const p = w.player;
    const want = w.input.action && !p.disabled && p.alive && p.charge > 0.02;
    if (want) {
      p.shield = true;
      p.charge -= MIRROR.drain * dt;
      if (p.charge <= 0) {
        p.charge = 0;
        mirrorRelease(w);
      }
    } else {
      if (p.shield) mirrorRelease(w);
      p.charge = Math.min(1, p.charge + MIRROR.regen * dt * w.stats.actionRecharge * w.stats.rateMul);
    }
  },
  speedFactor(w) {
    return w.player.shield ? MIRROR.slow : 1;
  },
};

/** Called by the world when a bullet touches the raised shield. */
export function mirrorAbsorb(w: World): void {
  const p = w.player;
  p.stored = Math.min(MIRROR.maxStored, p.stored + 1);
  p.charge = Math.max(0, p.charge - MIRROR.absorbCost);
  w.fx.push({ t: 'absorb', x: p.x, y: p.y });
}

// ── Ram (Bull): dash through everything ──────────────────────────────────────
export const RAM = {
  duration: 0.19,
  speed: 330,
  recharge: 0.9,
  charges: 2,
  damage: 14,
  radius: 5.2,
  afterInvuln: 0.12,
} as const;

const ram: WeaponImpl = {
  id: 'ram',
  init(w) {
    const p = w.player;
    p.maxCharges = RAM.charges;
    p.charges = RAM.charges;
    p.chargeT = 0;
  },
  update(w, dt) {
    const p = w.player;
    if (p.charges < p.maxCharges) {
      p.chargeT += dt * w.stats.actionRecharge * w.stats.rateMul;
      if (p.chargeT >= RAM.recharge) {
        p.chargeT = 0;
        p.charges++;
      }
    }
    if (p.dashT > 0) {
      p.dashT -= dt;
      if (p.dashT <= 0) p.invuln = Math.max(p.invuln, RAM.afterInvuln);
    }
    if (p.disabled || !p.alive) return;
    if (w.actionPressed && p.charges > 0 && p.dashT <= 0) {
      let dx = p.vx;
      let dy = p.vy;
      const len = Math.hypot(dx, dy);
      if (len < 8) {
        dx = 0;
        dy = 1;
      } else {
        dx /= len;
        dy /= len;
      }
      p.dashDx = dx;
      p.dashDy = dy;
      p.dashT = RAM.duration;
      p.dashId++;
      p.charges--;
      w.fx.push({ t: 'dash', x: p.x, y: p.y, dx, dy });
      w.emitAction();
    }
  },
};

export const WEAPONS: Record<WeaponId, WeaponImpl> = { blaster, grazer, mirror, ram };
