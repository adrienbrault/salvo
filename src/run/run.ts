import { getChassis } from '../content/chassis';
import { getItem } from '../content/registry';
import { CONSTRAINT_IDS, CONSTRAINTS, type ConstraintId } from '../sim/constraints';
import { Rng } from '../sim/rng';
import { computeEconomy, computeStats } from '../sim/stats';
import type { World } from '../sim/world';
import { levelSpecFor } from './levels';
import { generateShop } from './shop';
import { LEVELS_PER_SECTOR, newInstance, type RunState, SECTORS } from './state';

export const START_MONEY = 4;
/** HP repaired when a sector (boss) is cleared. */
export const SECTOR_HEAL = 1;
export const MAX_TIME_BONUS = 5;

export function createRun(seed: string, chassisId: string): RunState {
  const ch = getChassis(chassisId);
  const rng = new Rng(seed).fork('constraints');
  const constraints: ConstraintId[] = [];
  for (let s = 0; s < SECTORS + 8; s++) {
    const pool = CONSTRAINT_IDS.filter((id) => CONSTRAINTS[id].minSector <= s && id !== constraints[s - 1]);
    constraints.push(rng.pick(pool));
  }
  const uid = { nextUid: 1 };
  const run: RunState = {
    v: 1,
    seed,
    chassis: ch.id,
    sector: 0,
    level: 0,
    money: START_MONEY,
    hp: 0,
    loadout: {
      weapon: newInstance(uid, ch.weapon, getItem(ch.weapon).price),
      engine: newInstance(uid, ch.engine, getItem(ch.engine).price),
      core: newInstance(uid, ch.core, getItem(ch.core).price),
      relics: [],
    },
    calibrations: { tir: 0, impact: 0, renvoi: 0, onde: 0, reaction: 0 },
    modules: { damage: 0, rate: 0, hull: 0 },
    constraints,
    nextUid: uid.nextUid,
    stats: {
      kills: 0,
      bestKill: 0,
      totalScore: 0,
      levelsCleared: 0,
      damageTaken: 0,
      moneyEarned: 0,
      grazes: 0,
    },
    shop: null,
    shopVisits: 0,
    endless: false,
  };
  run.hp = computeStats(run).maxHp;
  return run;
}

export const currentSpec = (run: RunState) => levelSpecFor(run);

/** Deterministic RNG for the current level (same seed ⇒ same waves). */
export const levelRng = (run: RunState): Rng => new Rng(run.seed).fork(`level-${run.sector}-${run.level}`);

export interface Reward {
  base: number;
  timeBonus: number;
  interest: number;
  total: number;
}

export function computeReward(run: RunState, timeLeft: number, baseReward: number): Reward {
  const eco = computeEconomy(run);
  const base = Math.max(0, baseReward + eco.levelRewardDelta);
  const timeBonus = Math.min(MAX_TIME_BONUS, Math.floor(timeLeft / eco.timeBonusPer));
  const interest = Math.min(eco.interestCap, Math.floor(Math.max(0, run.money) / eco.interestStep));
  return { base, timeBonus, interest, total: base + timeBonus + interest };
}

export type LevelOutcome = 'shop' | 'runWon' | 'runLost';

export interface LevelReport {
  won: boolean;
  lostReason: 'time' | 'death' | null;
  score: number;
  quota: number;
  reward: Reward | null;
  outcome: LevelOutcome;
  sectorCleared: boolean;
}

/**
 * Commits a finished level into the run: HP, stats, relic end hooks, rewards, progression, next shop.
 * Call exactly once, when `world.phase === 'done'`.
 */
export function applyLevelResult(run: RunState, world: World): LevelReport {
  const spec = world.spec;
  const won = world.result === 'won';
  world.emitLevelEnd();
  run.hp = Math.max(0, world.player.hp);
  run.stats.totalScore += world.score;
  run.stats.bestKill = Math.max(run.stats.bestKill, world.tally.bestKill);
  run.stats.moneyEarned += world.tally.moneyEarned;

  if (!won) {
    return {
      won,
      lostReason: world.lostReason,
      score: world.score,
      quota: spec.quota,
      reward: null,
      outcome: 'runLost',
      sectorCleared: false,
    };
  }

  run.stats.levelsCleared++;
  const reward = computeReward(run, world.timeLeft, spec.reward);
  run.money += reward.total;
  run.stats.moneyEarned += reward.total;

  let sectorCleared = false;
  run.level++;
  if (run.level >= LEVELS_PER_SECTOR) {
    run.level = 0;
    run.sector++;
    sectorCleared = true;
    run.hp = Math.min(computeStats(run).maxHp, run.hp + SECTOR_HEAL);
  }

  const outcome: LevelOutcome = run.sector >= SECTORS && !run.endless ? 'runWon' : 'shop';
  if (outcome === 'shop') {
    run.shopVisits++;
    run.shop = generateShop(run);
  }
  return { won, lostReason: null, score: world.score, quota: spec.quota, reward, outcome, sectorCleared };
}

/** After the victory screen, keep playing with ever-growing quotas. */
export function continueEndless(run: RunState): void {
  run.endless = true;
  run.shopVisits++;
  run.shop = generateShop(run);
}
