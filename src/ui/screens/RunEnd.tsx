import { getChassis } from '../../content/chassis';
import type { RunState } from '../../run/state';
import { Counter } from '../components/Counter';
import { fmt, fmtMoney } from '../format';
import { game } from '../game';
import { ui } from '../store';

function Stats({ run }: { run: RunState }) {
  const s = run.stats;
  const rows: [string, number, (n: number) => string][] = [
    ['Total score', s.totalScore, fmt],
    ['Levels cleared', s.levelsCleared, fmt],
    ['Kills', s.kills, fmt],
    ['Best kill', s.bestKill, fmt],
    ['Money earned', s.moneyEarned, fmtMoney],
    ['Damage taken', s.damageTaken, fmt],
  ];
  return (
    <dl class="stats-grid">
      {rows.map(([label, v, f], i) => (
        <div key={label} style={{ '--d': `${0.3 + i * 0.1}s` }}>
          <dt>{label}</dt>
          <dd>
            <Counter from={0} value={v} format={f} delay={0.3 + i * 0.1} duration={0.8} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function GameOver() {
  const run = ui.run.value;
  const report = ui.report.value;
  const g = game();
  const cause = report?.lostReason === 'death' ? 'Hull destroyed' : 'Time’s up';
  return (
    <div class="screen runend over">
      <header class="runend-head">
        <h1>Run over</h1>
        <p class="muted">
          {cause} — {ui.hud.value.levelName}
        </p>
      </header>
      {run && <Stats run={run} />}
      {run && (
        <p class="runend-seed">
          {getChassis(run.chassis).name}, seed {run.seed}
        </p>
      )}
      <footer class="screen-foot">
        <button type="button" class="btn ghost" onClick={() => g.toTitle()}>
          Main menu
        </button>
        <button type="button" class="btn go big" onClick={() => g.chooseChassis()}>
          New run
        </button>
      </footer>
    </div>
  );
}

export function Victory() {
  const run = ui.run.value;
  const g = game();
  return (
    <div class="screen runend victory">
      <header class="runend-head">
        <h1>The Core has fallen</h1>
        <p class="muted">All four sectors cleared. Stay on and the quotas keep climbing.</p>
      </header>
      {run && <Stats run={run} />}
      <footer class="screen-foot">
        <button type="button" class="btn ghost" onClick={() => g.toTitle()}>
          Main menu
        </button>
        <button type="button" class="btn go big" onClick={() => g.endless()}>
          Endless mode
        </button>
      </footer>
    </div>
  );
}
