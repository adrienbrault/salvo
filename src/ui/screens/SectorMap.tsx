import { getItem } from '../../content/registry';
import { levelSpecFor, sectorName } from '../../run/levels';
import { LEVELS_PER_SECTOR, type RunState, SECTORS } from '../../run/state';
import { CONSTRAINTS } from '../../sim/constraints';
import { computeStats } from '../../sim/stats';
import { HpPips } from '../components/Pips';
import { fmt } from '../format';
import { game } from '../game';
import { ui } from '../store';

/** The sector's three levels, the boss constraint, and the launch button. */
export function SectorMap() {
  void ui.runVersion.value;
  const run = ui.run.value;
  if (!run) return null;
  const g = game();
  const specs = [];
  for (let i = 0; i < LEVELS_PER_SECTOR; i++) specs.push(levelSpecFor(run, run.sector, i));
  const current = specs[run.level]!;
  return (
    <div class="screen map">
      <header class="screen-head map-head">
        <SectorPips run={run} />
        <h2 class="sector-title">{sectorName(run.sector)}</h2>
        <p class="muted">
          {run.sector < SECTORS
            ? `Sector ${run.sector + 1} of ${SECTORS}`
            : `Endless — sector ${run.sector + 1}`}
        </p>
      </header>
      <ol class="route">
        {specs.map((spec) => {
          const state = spec.index < run.level ? 'done' : spec.index === run.level ? 'current' : 'next';
          const c = spec.constraint ? CONSTRAINTS[spec.constraint] : null;
          return (
            <li key={spec.index} class={`node ${state} k-${spec.kind}`}>
              <span class="node-num">
                {run.sector + 1}-{spec.index + 1}
              </span>
              <div class="node-body">
                <p class="node-name">{spec.name}</p>
                <p class="node-quota">
                  Quota <b>{fmt(spec.quota)}</b>
                </p>
                <p class="node-meta">
                  {spec.duration}s — reward <span class="mk-money">${spec.reward}</span>
                </p>
                {c && (
                  <div class="node-constraint">
                    <span class="constraint-chip">
                      <b>{c.glyph}</b>
                      {c.name}
                    </span>
                    <p>{c.desc}</p>
                  </div>
                )}
              </div>
              <span class="node-state">
                {state === 'done' ? 'Cleared' : state === 'current' ? 'Next' : ''}
              </span>
            </li>
          );
        })}
      </ol>
      <RunStrip run={run} />
      <footer class="screen-foot map-foot">
        <button type="button" class="btn go big launch" onClick={() => g.startLevel()}>
          Launch {current.name}
        </button>
        <div class="btn-row">
          <button type="button" class="btn ghost small" onClick={() => (ui.modal.value = 'build')}>
            Ship
          </button>
          <button type="button" class="btn ghost small" onClick={() => (ui.modal.value = 'settings')}>
            Settings
          </button>
          <button type="button" class="btn ghost small" onClick={() => g.toTitle()}>
            Main menu
          </button>
        </div>
      </footer>
    </div>
  );
}

function SectorPips({ run }: { run: RunState }) {
  const pips = [];
  for (let s = 0; s < SECTORS; s++) {
    const cls = s < run.sector ? 'done' : s === run.sector ? 'current' : '';
    pips.push(
      <li key={s} class={cls} title={sectorName(s)}>
        {s + 1}
      </li>,
    );
  }
  return (
    <ol class="sector-pips" aria-label="Sector progress">
      {pips}
    </ol>
  );
}

/** HP, money and relics at a glance. */
export function RunStrip({ run }: { run: RunState }) {
  return (
    <div class="run-strip">
      <HpPips hp={run.hp} max={computeStats(run).maxHp} />
      <span class="run-relics">
        {run.loadout.relics.map((r) => {
          const def = getItem(r.id);
          return (
            <span key={r.uid} class="mini-relic" style={{ '--c': def.color }} title={def.name}>
              {def.glyph}
            </span>
          );
        })}
      </span>
      <span class="money run-money">${run.money}</span>
    </div>
  );
}
