import { getItem } from '../../content/registry';
import { levelSpecFor, sectorName } from '../../run/levels';
import { LEVELS_PER_SECTOR, type RunState, SECTORS } from '../../run/state';
import { CONSTRAINTS } from '../../sim/constraints';
import { computeStats } from '../../sim/stats';
import { type HoverBind, HoverDetail, useHover } from '../components/HoverDetail';
import { copyNote, ItemDetail } from '../components/ItemDetail';
import { HpPips } from '../components/Pips';
import { fmt } from '../format';
import { game } from '../game';
import { ABOVE } from '../place';
import { ui } from '../store';

/** The sector's three levels, the boss constraint, and the launch button. */
export function SectorMap() {
  void ui.runVersion.value;
  const run = ui.run.value;
  const hover = useHover<number>();
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
      <RunStrip run={run} hover={(i) => hover.bind(i, `relic-${i}`, ABOVE)} />
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
      <HoverDetail at={hover.at}>{hover.at && relicDetail(run, hover.at.target)}</HoverDetail>
    </div>
  );
}

function relicDetail(run: RunState, slot: number) {
  const inst = run.loadout.relics[slot];
  return inst && <ItemDetail def={getItem(inst.id)} inst={inst} note={copyNote(run.loadout.relics, slot)} />;
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

/** HP, money and relics at a glance. A relic shows its detail on hover; the row opens the ship. */
export function RunStrip({ run, hover }: { run: RunState; hover(slot: number): HoverBind }) {
  const relics = run.loadout.relics;
  return (
    <div class="run-strip">
      <HpPips hp={run.hp} max={computeStats(run).maxHp} />
      {relics.length > 0 ? (
        <button
          type="button"
          class="run-relics"
          aria-label={`Your ship: ${relics.map((r) => getItem(r.id).name).join(', ')}`}
          onClick={() => (ui.modal.value = 'build')}
        >
          {relics.map((r, i) => {
            const def = getItem(r.id);
            return (
              <span key={r.uid} class="mini-relic" style={{ '--c': def.color }} {...hover(i)}>
                {def.glyph}
              </span>
            );
          })}
        </button>
      ) : (
        <span />
      )}
      <span class="money run-money">${run.money}</span>
    </div>
  );
}
