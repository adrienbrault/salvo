import { signal } from '@preact/signals';
import type { LevelReport } from '../run/run';
import type { RunState } from '../run/state';
import type { LevelTally } from '../sim/world';

export type Screen = 'boot' | 'title' | 'chassis' | 'map' | 'level' | 'recap' | 'shop' | 'over' | 'victory';

export interface HudState {
  score: number;
  quota: number;
  timeLeft: number;
  duration: number;
  gauge: number;
  hp: number;
  maxHp: number;
  money: number;
  phase: 'intro' | 'play' | 'outro' | 'done';
  levelName: string;
  sector: number;
  levelIndex: number;
  bossHp: number | null;
  weapon: string;
  /** 0..1 readiness of the action (cooldown, charge, energy). */
  action: number;
  charges: number;
  maxCharges: number;
  stored: number;
  blackout: boolean;
  constraint: string | null;
}

export const emptyHud = (): HudState => ({
  score: 0,
  quota: 1,
  timeLeft: 0,
  duration: 1,
  gauge: 1,
  hp: 3,
  maxHp: 3,
  money: 0,
  phase: 'intro',
  levelName: '',
  sector: 0,
  levelIndex: 0,
  bossHp: null,
  weapon: 'blaster',
  action: 1,
  charges: 0,
  maxCharges: 0,
  stored: 0,
  blackout: false,
  constraint: null,
});

export interface Settings {
  volume: number;
  music: number;
  quality: 'auto' | 'ultra' | 'high' | 'medium' | 'low';
  forceWebGL: boolean;
  touchSensitivity: number;
  shake: number;
  vibration: boolean;
}

export const defaultSettings = (): Settings => ({
  volume: 0.7,
  music: 0.5,
  quality: 'auto',
  forceWebGL: false,
  touchSensitivity: 1.15,
  shake: 1,
  vibration: true,
});

/** Global UI state. The run object is mutated in place; bump `runVersion` to re-render. */
export const ui = {
  screen: signal<Screen>('boot'),
  paused: signal(false),
  run: signal<RunState | null>(null),
  runVersion: signal(0),
  hud: signal<HudState>(emptyHud()),
  report: signal<LevelReport | null>(null),
  tally: signal<LevelTally | null>(null),
  /** Increments per relic slot when it triggers (drives the HUD jiggle). */
  relicPulse: signal<number[]>([0, 0, 0, 0, 0]),
  settings: signal<Settings>(defaultSettings()),
  backend: signal<{ api: string; tier: string }>({ api: '', tier: '' }),
  hasSave: signal(false),
  toast: signal<{ id: number; text: string } | null>(null),
  bootError: signal<string | null>(null),
};

let toastId = 0;
export function toast(text: string): void {
  ui.toast.value = { id: ++toastId, text };
}

export const bumpRun = (): void => {
  ui.runVersion.value++;
};
