import { CONSTRAINTS, type ConstraintId, type Difficulty } from './constraints';

export type LevelKind = 'small' | 'big' | 'boss';

/** Everything the sim needs to know about a level. Built by run/levels.ts. */
export interface LevelSpec {
  /** 0-based sector (Balatro "ante"). */
  sector: number;
  /** 0..2 within the sector. */
  index: number;
  kind: LevelKind;
  name: string;
  /** Score to reach before the timer ends. */
  quota: number;
  /** Seconds. */
  duration: number;
  /** Base money reward on clear. */
  reward: number;
  constraint: ConstraintId | null;
}

export function difficultyFor(spec: LevelSpec): Difficulty {
  const s = spec.sector;
  const d: Difficulty = {
    hpMul: 1 + 0.5 * s,
    bulletSpeed: 1 + 0.07 * s,
    fireRate: 1 + 0.12 * s,
    valueMul: 1 + 0.35 * s,
    budgetMul: 1 + 0.2 * s,
  };
  if (spec.kind === 'big') {
    d.hpMul *= 1.1;
    d.budgetMul *= 1.25;
  } else if (spec.kind === 'boss') {
    d.budgetMul *= 0.55;
  }
  if (spec.constraint) CONSTRAINTS[spec.constraint].tune?.(d);
  return d;
}
