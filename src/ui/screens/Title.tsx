import { game } from '../game';
import { ui } from '../store';

/** Shown while the renderer paints the hull textures and compiles the title's pipelines. */
export function Boot() {
  const progress = ui.bootProgress.value;
  return (
    <div class="screen boot">
      <h1 class="logo">SALVO</h1>
      <div
        class="boot-bar"
        role="progressbar"
        aria-label="Loading"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <i style={{ transform: `scaleX(${progress})` }} />
      </div>
      <p class="boot-text">{ui.bootStage.value}</p>
    </div>
  );
}

export function BootError({ message }: { message: string }) {
  const retry = () => {
    const params = new URLSearchParams(location.search);
    params.set('webgl', '');
    location.search = params.toString();
  };
  return (
    <div class="screen boot">
      <h1 class="logo">SALVO</h1>
      <div class="panel boot-error-panel">
        <h2>The 3D renderer couldn’t start</h2>
        <p>{message}</p>
        <p class="muted">Try WebGL compatibility mode, or a recent browser (Chrome, Edge, Safari 18+).</p>
        <button type="button" class="btn go" onClick={retry}>
          Restart in WebGL
        </button>
      </div>
    </div>
  );
}

export function Title() {
  const g = game();
  const hasSave = ui.hasSave.value;
  const be = ui.backend.value;
  return (
    <div class="screen title">
      <div class="title-logo">
        <h1 class="logo">SALVO</h1>
        <p class="tagline">
          <span class="mk-b">Shards</span> × <span class="mk-m">Mult</span> — every purchase changes how you
          play.
        </p>
      </div>
      <nav class="title-menu">
        {hasSave && (
          <button type="button" class="btn go big" onClick={() => g.continueSaved()}>
            Continue run
          </button>
        )}
        <button type="button" class={hasSave ? 'btn big' : 'btn go big'} onClick={() => g.chooseChassis()}>
          New run
        </button>
        <div class="btn-row">
          <button type="button" class="btn ghost" onClick={() => (ui.modal.value = 'settings')}>
            Settings
          </button>
          <button type="button" class="btn ghost" onClick={() => (ui.modal.value = 'records')}>
            Records
          </button>
        </div>
      </nav>
      <p class="title-foot">
        {be.api} · {be.tier} quality
      </p>
    </div>
  );
}
