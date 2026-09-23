import { fmt } from './Popups';
import { ui } from './store';

/** Temporary shell (replaced by the full UI). */
export function App() {
  const err = ui.bootError.value;
  if (err) return <div class="boot-error">Erreur de rendu : {err}</div>;
  const h = ui.hud.value;
  return (
    <div class="dev-hud">
      {ui.backend.value.api} · {ui.backend.value.tier} — {fmt(h.score)} / {fmt(h.quota)} — ×
      {h.gauge.toFixed(2)} — {h.timeLeft.toFixed(1)}s — PV {h.hp}
    </div>
  );
}
