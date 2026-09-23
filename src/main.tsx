import { render } from 'preact';
import { Game } from './app/Game';
import { Loop } from './app/Loop';
import { browserStore, loadSettings } from './app/save';
import { Audio } from './audio/Audio';
import { InputController } from './input/Input';
import { GameRenderer } from './render/GameRenderer';
import type { Tier } from './render/quality';
import { App } from './ui/App';
import { Popups } from './ui/Popups';
import { ui } from './ui/store';

declare global {
  interface Window {
    salvo?: { game: Game; gr: GameRenderer };
  }
}

/** Space the HUD needs above/below the playfield, in CSS px. */
function insetsFor(w: number, h: number): { top: number; bottom: number } {
  const portrait = h > w;
  return portrait ? { top: 74, bottom: 18 } : { top: 64, bottom: 12 };
}

async function boot(): Promise<void> {
  const stage = document.getElementById('stage')!;
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui')!;
  const appRoot = document.createElement('div');
  appRoot.id = 'app';
  uiRoot.appendChild(appRoot);

  const store = browserStore();
  const settings = loadSettings(store);
  ui.settings.value = settings;
  const params = new URLSearchParams(location.search);
  const tierParam = params.get('tier') as Tier | null;

  render(<App />, appRoot);

  let gr: GameRenderer;
  try {
    gr = await GameRenderer.create({
      canvas,
      forceWebGL: settings.forceWebGL || params.has('webgl'),
      tier: tierParam ?? settings.quality,
    });
  } catch (err) {
    console.error(err);
    ui.bootError.value = err instanceof Error ? err.message : String(err);
    return;
  }
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
  window.salvo = { game, gr };

  const onResize = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    gr.resize(w, h, insetsFor(w, h));
  };
  new ResizeObserver(onResize).observe(stage);
  onResize();

  const unlock = () => {
    audio?.unlock();
    audio?.music.start();
  };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });

  new Loop((dt, ms) => game!.tick(dt, ms)).start();

  const quick = params.get('quick');
  if (quick) {
    game.newRun(quick, params.get('seed') ?? undefined);
    game.startLevel();
  } else {
    game.toTitle();
  }
}

void boot();
