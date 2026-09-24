import { effect } from '@preact/signals';
import { render } from 'preact';
import { Vector2 } from 'three/webgpu';
import { fpsMeter } from './app/fpsMeter';
import { Game } from './app/Game';
import { Loop } from './app/Loop';
import { installRafShim } from './app/rafShim';
import { browserStore, loadSettings, saveSettings } from './app/save';
import { provideSchedulerYield } from './app/schedulerYield';
import { Audio } from './audio/Audio';
import { InputController } from './input/Input';
import { GameRenderer } from './render/GameRenderer';
import type { Tier } from './render/quality';
import { FIELD } from './sim/constants';
import { App } from './ui/App';
import { bindGame } from './ui/game';
import { Popups } from './ui/Popups';
import { ui } from './ui/store';

declare global {
  interface Window {
    salvo?: { game: Game; gr: GameRenderer; ui: typeof ui };
  }
}

/**
 * HUD layout contract with `src/ui/styles/hud.css`: at aspect ≥ 11/10 the HUD sits in side
 * columns beside the field, otherwise in a top band (HUD_TOP) and a bottom band (HUD_BOTTOM).
 */
const WIDE_ASPECT = 1.1;
const HUD_TOP = 62;
const HUD_BOTTOM = 92;

/** Safe-area insets in CSS px (`env()` is only observable through layout). */
function safeArea(): { top: number; bottom: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const r = { top: Number.parseFloat(cs.paddingTop) || 0, bottom: Number.parseFloat(cs.paddingBottom) || 0 };
  probe.remove();
  return r;
}

/** Space the HUD needs above/below the playfield, in CSS px. */
function insetsFor(w: number, h: number): { top: number; bottom: number } {
  const safe = safeArea();
  if (w / h >= WIDE_ASPECT) return { top: 14 + safe.top, bottom: 14 + safe.bottom };
  return { top: HUD_TOP + safe.top, bottom: HUD_BOTTOM + safe.bottom };
}

/** Publishes the playfield's on-screen bounds as CSS variables so the HUD can hug it. */
function publishField(gr: GameRenderer, el: HTMLElement): void {
  const p = new Vector2();
  // The near (bottom) edge is the widest on screen because of the camera tilt.
  gr.rig.worldToScreen(-FIELD.halfW, -FIELD.halfH, 0, p);
  el.style.setProperty('--field-l', `${Math.round(p.x)}px`);
  el.style.setProperty('--field-b', `${Math.round(p.y)}px`);
  gr.rig.worldToScreen(FIELD.halfW, -FIELD.halfH, 0, p);
  el.style.setProperty('--field-r', `${Math.round(p.x)}px`);
  gr.rig.worldToScreen(0, FIELD.halfH, 0, p);
  el.style.setProperty('--field-t', `${Math.round(p.y)}px`);
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  if (params.has('rafshim')) installRafShim();
  const stage = document.getElementById('stage')!;
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui')!;
  const appRoot = document.createElement('div');
  appRoot.id = 'app';
  uiRoot.appendChild(appRoot);

  const store = browserStore();
  const settings = loadSettings(store);
  ui.settings.value = settings;
  const tierParam = params.get('tier') as Tier | null;

  render(<App />, appRoot);

  const removeYield = provideSchedulerYield();
  let gr: GameRenderer;
  try {
    gr = await GameRenderer.create({
      canvas,
      forceWebGL: settings.forceWebGL || params.has('webgl'),
      tier: tierParam ?? settings.quality,
      onStage: (s) => {
        ui.bootStage.value = s;
      },
      onProgress: (f) => {
        ui.bootProgress.value = f;
      },
    });
  } catch (err) {
    console.error(err);
    ui.bootError.value = err instanceof Error ? err.message : String(err);
    removeYield();
    return;
  }
  // Gameplay shaders keep compiling behind the menus, with the same yield.
  void gr.gameplayReady.finally(removeYield);
  ui.backend.value = { api: gr.isWebGPU ? 'WebGPU' : 'WebGL 2', tier: gr.quality.tier };

  let game: Game | null = null;
  const input = new InputController(stage, gr.rig, () => game?.world?.player ?? null, {
    touchSensitivity: settings.touchSensitivity,
  });
  let audio: Audio | null = null;
  try {
    audio = new Audio();
    audio.setVolume(settings.volume, settings.music);
  } catch (err) {
    console.warn('Audio unavailable', err);
  }
  const popups = new Popups(uiRoot);
  game = new Game(gr, input, audio, popups);
  bindGame(game);
  window.salvo = { game, gr, ui };

  effect(() => {
    const s = ui.settings.value;
    audio?.setVolume(s.volume, s.music);
    input.setSensitivity(s.touchSensitivity);
    gr.rig.shakeScale = s.shake;
    saveSettings(store, s);
  });
  // Leaving the app mid-level (tab switch, phone call) pauses instead of resuming blind.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game?.togglePause(true);
  });

  const onResize = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    gr.resize(w, h, insetsFor(w, h));
    publishField(gr, uiRoot);
  };
  new ResizeObserver(onResize).observe(stage);
  onResize();

  const unlock = () => {
    audio?.unlock();
    audio?.music.start();
  };
  // A touch only counts as a user gesture on release (pointerup/touchend): iOS Safari keeps
  // audio locked after a touch pointerdown.
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
    window.addEventListener(type, unlock);
  }

  const meter = params.has('fps') ? fpsMeter(gr) : null;
  new Loop((dt, ms) => {
    game!.tick(dt, ms);
    meter?.(ms);
  }).start();

  const quick = params.get('quick');
  if (quick) {
    game.newRun(quick, params.get('seed') ?? undefined);
    await gr.gameplayReady;
    game.startLevel();
  } else {
    game.toTitle();
  }
}

void boot();
