import type { Audio } from '../audio/Audio';
import { getChassis } from '../content/chassis';
import { getItem } from '../content/registry';
import type { InputController } from '../input/Input';
import type { GameRenderer } from '../render/GameRenderer';
import { sectorName } from '../run/levels';
import { applyLevelResult, continueEndless, createRun, currentSpec, levelRng } from '../run/run';
import { moveRelic, buy as shopBuy, reroll as shopReroll, sellRelic as shopSell } from '../run/shop';
import type { RunState } from '../run/state';
import { DT } from '../sim/constants';
import { randomSeed } from '../sim/rng';
import type { FxEvent } from '../sim/types';
import { World } from '../sim/world';
import type { Popups } from '../ui/Popups';
import { bumpRun, type HudState, type Screen, toast, ui } from '../ui/store';
import { purchaseMessage } from '../ui/upgrades';
import {
  browserStore,
  clearRun,
  type KeyValueStore,
  loadRecords,
  loadRun,
  type Records,
  saveRecords,
  saveRun,
} from './save';

/**
 * Application controller: owns the run and the current level, steps the simulation at a
 * fixed rate, and fans simulation events out to renderer, audio, popups and UI.
 */
export class Game {
  run: RunState | null = null;
  world: World | null = null;
  private acc = 0;
  private hitStop = 0;
  private hudT = 0;
  private startQueued = false;
  private readonly store: KeyValueStore | null = browserStore();
  records: Records;

  constructor(
    private readonly gr: GameRenderer,
    private readonly input: InputController,
    private readonly audio: Audio | null,
    private readonly popups: Popups,
  ) {
    this.records = loadRecords(this.store);
    ui.hasSave.value = loadRun(this.store) !== null;
    input.onPause = () => this.togglePause();
  }

  private go(screen: Screen): void {
    ui.screen.value = screen;
    const inLevel = screen === 'level';
    this.input.enabled = inLevel;
    if (!inLevel) this.input.reset();
    document.body.classList.toggle('in-level', inLevel);
    this.audio?.music.setIntensity(inLevel ? 1 : 0, inLevel && this.world?.spec.kind === 'boss');
  }

  // ── Run flow ──────────────────────────────────────────────────────────────

  chooseChassis(): void {
    this.go('chassis');
  }

  newRun(chassisId: string, seed = randomSeed()): void {
    this.run = createRun(seed, chassisId);
    this.records.runs++;
    saveRecords(this.store, this.records);
    this.publishRun();
    this.gr.setChassis(getChassis(chassisId));
    this.gr.setTheme(this.run.sector, this.run.seed);
    this.go('map');
  }

  continueSaved(): boolean {
    const run = loadRun(this.store);
    if (!run) return false;
    this.run = run;
    this.publishRun();
    this.gr.setChassis(getChassis(run.chassis));
    this.gr.setTheme(run.sector, run.seed);
    this.go(run.shop ? 'shop' : 'map');
    return true;
  }

  startLevel(): void {
    const run = this.run;
    if (!run) return;
    // Gameplay shaders compile behind the menus; a quick player waits for the last of them.
    if (!this.gr.gameplayCompiled) {
      if (!this.startQueued) {
        this.startQueued = true;
        toast('Compiling shaders…');
        void this.gr.gameplayReady.then(() => {
          this.startQueued = false;
          this.startLevel();
        });
      }
      return;
    }
    run.shop = null;
    this.world = new World(run, currentSpec(run), levelRng(run));
    this.acc = 0;
    this.hitStop = 0;
    this.popups.clear();
    this.gr.setChassis(getChassis(run.chassis));
    this.gr.setTheme(run.sector, run.seed);
    ui.paused.value = false;
    ui.relicPulse.value = [0, 0, 0, 0, 0];
    this.publishRun();
    this.go('level');
    this.audio?.play('start');
    this.pushHud(true);
  }

  private endLevel(): void {
    const run = this.run;
    const w = this.world;
    if (!run || !w) return;
    const report = applyLevelResult(run, w);
    ui.report.value = report;
    ui.tally.value = { ...w.tally, triggers: [...w.tally.triggers] };
    this.records.bestLevelScore = Math.max(this.records.bestLevelScore, w.score);
    this.records.bestKill = Math.max(this.records.bestKill, w.tally.bestKill);
    this.records.bestSector = Math.max(this.records.bestSector, run.sector);
    if (report.outcome === 'runLost') {
      clearRun(this.store);
      ui.hasSave.value = false;
    } else if (report.outcome === 'runWon') {
      this.records.wins++;
      clearRun(this.store);
      ui.hasSave.value = false;
    } else {
      saveRun(this.store, run);
      ui.hasSave.value = true;
    }
    saveRecords(this.store, this.records);
    this.publishRun();
    // A new sector gets a new trench: rebuild it behind the recap, not when the next level starts.
    if (report.sectorCleared) this.gr.setTheme(run.sector, run.seed);
    this.go('recap');
  }

  /** From the level recap. */
  afterRecap(): void {
    const r = ui.report.value;
    this.world = null;
    if (!r || !this.run) this.go('title');
    else if (r.outcome === 'runLost') this.go('over');
    else if (r.outcome === 'runWon') this.go('victory');
    else this.go('shop');
  }

  leaveShop(): void {
    if (!this.run) return;
    this.run.shop = null;
    saveRun(this.store, this.run);
    this.publishRun();
    this.go('map');
  }

  endless(): void {
    if (!this.run) return;
    continueEndless(this.run);
    this.publishRun();
    this.go('shop');
  }

  abandon(): void {
    this.run = null;
    this.world = null;
    clearRun(this.store);
    ui.hasSave.value = false;
    ui.run.value = null;
    ui.paused.value = false;
    this.gr.setChassis(null);
    this.go('title');
  }

  toTitle(): void {
    this.world = null;
    ui.paused.value = false;
    this.gr.setChassis(null);
    this.go('title');
  }

  togglePause(force?: boolean): void {
    if (ui.screen.value !== 'level') return;
    const next = force ?? !ui.paused.value;
    ui.paused.value = next;
    this.input.enabled = !next;
    if (next) this.input.reset();
  }

  // ── Shop actions ──────────────────────────────────────────────────────────

  buy(area: 'offers' | 'workshop', index: number): void {
    const run = this.run;
    if (!run) return;
    const id = run.shop?.[area][index]?.id;
    const res = shopBuy(run, area, index);
    if (!res.ok) {
      this.audio?.play('error');
      const msg =
        res.error === 'money'
          ? 'Not enough money'
          : res.error === 'slots'
            ? 'Relic slots full — sell one first'
            : res.error === 'full-hp'
              ? 'Hull already intact'
              : 'Already sold';
      toast(msg);
      return;
    }
    this.audio?.play('buy');
    if (id) toast(purchaseMessage(run, getItem(id), res));
    if (res.replaced) this.gr.setChassis(getChassis(run.chassis));
    saveRun(this.store, run);
    this.publishRun();
  }

  reroll(): void {
    if (!this.run) return;
    if (shopReroll(this.run)) {
      this.audio?.play('reroll');
      saveRun(this.store, this.run);
    } else {
      this.audio?.play('error');
      toast('Not enough money');
    }
    this.publishRun();
  }

  sell(index: number): void {
    if (!this.run) return;
    const v = shopSell(this.run, index);
    if (v > 0) {
      this.audio?.play('coin');
      saveRun(this.store, this.run);
    }
    this.publishRun();
  }

  move(from: number, to: number): void {
    if (!this.run) return;
    moveRelic(this.run, from, to);
    this.audio?.play('click');
    saveRun(this.store, this.run);
    this.publishRun();
  }

  private publishRun(): void {
    ui.run.value = this.run;
    bumpRun();
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  tick(dt: number, frameMs: number): void {
    const w = this.world;
    const screen = ui.screen.value;
    let alpha = 1;
    if (w && (screen === 'level' || screen === 'recap')) {
      if (screen === 'level' && !ui.paused.value) {
        if (this.hitStop > 0) {
          this.hitStop -= dt;
        } else {
          this.acc += dt * this.gr.fx.slowMo;
          let steps = 0;
          while (this.acc >= DT && steps < 5) {
            w.step(this.input.frame(), DT);
            this.acc -= DT;
            steps++;
          }
          if (steps === 5) this.acc = 0;
        }
        alpha = this.acc / DT;
        this.dispatchFx(w.fx, w);
        w.fx.length = 0;
        this.hudT -= dt;
        if (this.hudT <= 0) {
          this.hudT = 1 / 30;
          this.pushHud(false);
        }
        if (w.phase === 'done') this.endLevel();
      }
      this.gr.frame(w, alpha, ui.paused.value ? 0 : dt, frameMs);
    } else {
      this.gr.frame(null, 1, dt, frameMs);
    }
  }

  private dispatchFx(events: FxEvent[], w: World): void {
    if (events.length === 0) return;
    this.gr.handleFx(events, w);
    this.audio?.handle(events);
    this.popups.handle(events, this.gr.rig);
    let pulses: number[] | null = null;
    for (const e of events) {
      if (e.t === 'relic' && e.slot >= 0) {
        pulses ??= [...ui.relicPulse.value];
        pulses[e.slot] = (pulses[e.slot] ?? 0) + 1;
      } else if (e.t === 'playerHit' && ui.settings.value.vibration) {
        navigator.vibrate?.(60);
      } else if (e.t === 'blackout' && e.on) {
        toast('Radio Silence!');
      }
    }
    if (pulses) ui.relicPulse.value = pulses;
    if (this.gr.fx.hitStop > 0) {
      this.hitStop = Math.max(this.hitStop, this.gr.fx.hitStop);
      this.gr.fx.hitStop = 0;
    }
    const heat = w.gauge >= 4 || w.spec.kind === 'boss';
    this.audio?.music.setIntensity(heat ? 2 : 1, w.spec.kind === 'boss');
  }

  private pushHud(_force: boolean): void {
    const w = this.world;
    const run = this.run;
    if (!w || !run) return;
    const p = w.player;
    let action = 1;
    if (w.weapon.id === 'blaster') action = 1 - p.cooldown / Math.max(0.01, p.cooldownMax);
    else if (w.weapon.id === 'grazer' || w.weapon.id === 'mirror') action = p.charge;
    else if (w.weapon.id === 'ram') action = p.charges / Math.max(1, p.maxCharges);
    const hud: HudState = {
      score: w.score,
      quota: w.spec.quota,
      timeLeft: w.timeLeft,
      duration: w.spec.duration,
      gauge: w.gauge,
      hp: p.hp,
      maxHp: w.stats.maxHp,
      money: run.money,
      phase: w.phase,
      levelName: `${sectorName(w.spec.sector)} · ${w.spec.name}`,
      sector: w.spec.sector,
      levelIndex: w.spec.index,
      bossHp: w.boss ? w.boss.hp / w.boss.maxHp : null,
      weapon: w.weapon.id,
      action,
      charges: p.charges,
      maxCharges: p.maxCharges,
      stored: p.stored,
      blackout: p.disabled,
      constraint: w.constraint?.id ?? null,
    };
    ui.hud.value = hud;
  }
}
