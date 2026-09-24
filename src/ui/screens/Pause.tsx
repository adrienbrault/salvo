import { useEffect, useState } from 'preact/hooks';
import { game } from '../game';
import { ui } from '../store';

/** Two-step destructive button (the viewer has no confirm dialogs). */
export function ConfirmButton({
  label,
  confirm,
  onConfirm,
}: {
  label: string;
  confirm: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      class={armed ? 'btn danger' : 'btn ghost'}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
    >
      {armed ? confirm : label}
    </button>
  );
}

export function Pause() {
  const g = game();
  const h = ui.hud.value;
  return (
    <div class="screen pause">
      <div class="panel pause-panel">
        <h2>Paused</h2>
        <p class="muted">{h.levelName}</p>
        <button type="button" class="btn go big" onClick={() => g.togglePause(false)}>
          Resume
        </button>
        <button type="button" class="btn" onClick={() => (ui.modal.value = 'build')}>
          Your ship
        </button>
        <button type="button" class="btn" onClick={() => (ui.modal.value = 'settings')}>
          Settings
        </button>
        <button type="button" class="btn ghost" onClick={() => g.toTitle()}>
          Main menu <small class="btn-note">(level lost, run kept)</small>
        </button>
        <ConfirmButton label="Abandon run" confirm="Tap again to abandon" onConfirm={() => g.abandon()} />
      </div>
      <p class="controls-hint">
        Drag a finger to steer, hold a second finger for the action. Keyboard: arrows or WASD / ZQSD, Space =
        action, Shift = precision, Esc = pause.
      </p>
    </div>
  );
}
