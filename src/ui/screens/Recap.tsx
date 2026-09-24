import type { JSX } from 'preact';
import { getItem } from '../../content/registry';
import { KILL_TYPE_LABEL, KILL_TYPES } from '../../sim/types';
import { Counter } from '../components/Counter';
import { fmt, fmtMoney } from '../format';
import { game } from '../game';
import { ui } from '../store';

/** Rows reveal one after another; counters start rolling as their row lands. */
const STEP = 0.16;

export function Recap() {
  const report = ui.report.value;
  const tally = ui.tally.value;
  const run = ui.run.value;
  if (!report || !tally || !run) return null;
  const won = report.won;
  let t = 0.5;
  const next = () => {
    t += STEP;
    return t;
  };
  const d = (s: number) => ({ '--d': `${s}s` });

  const kills: JSX.Element[] = [];
  for (const kt of KILL_TYPES) {
    const n = tally.killsByType[kt];
    if (n === 0) continue;
    const at = next();
    kills.push(
      <li key={kt} class="recap-line" style={d(at)}>
        <span>{KILL_TYPE_LABEL[kt]}</span>
        <span class="muted">
          {n} {n === 1 ? 'kill' : 'kills'}
        </span>
        <b class="mk-b">
          <Counter from={0} value={tally.scoreByType[kt]} delay={at} duration={0.6} />
        </b>
      </li>,
    );
  }

  const triggers: JSX.Element[] = [];
  run.loadout.relics.forEach((inst, slot) => {
    const n = tally.triggers[slot] ?? 0;
    if (n === 0) return;
    const def = getItem(inst.id);
    triggers.push(
      <li key={inst.uid} class="mini-relic" style={{ '--c': def.color }} title={def.name}>
        {def.glyph}
        <small>×{n}</small>
      </li>,
    );
  });
  const trigAt = triggers.length ? next() : t;

  const reward = report.reward;
  const moneyRows: [string, number][] = reward
    ? [
        ['Reward', reward.base],
        ['Time left', reward.timeBonus],
        ['Interest', reward.interest],
      ]
    : [];
  const moneyAt = moneyRows.map(() => next());
  const totalAt = next();

  const title = won ? 'Quota reached' : report.lostReason === 'death' ? 'Hull destroyed' : 'Time’s up';
  const label = report.outcome === 'shop' ? 'Shop' : report.outcome === 'runWon' ? 'Continue' : 'See summary';

  return (
    <div class="screen recap">
      <div class={won ? 'panel recap-panel won' : 'panel recap-panel lost'}>
        <p class="recap-level">{ui.hud.value.levelName}</p>
        <h2 class="recap-title">{title}</h2>
        <div class="recap-score">
          <Counter from={0} value={report.score} duration={1} delay={0.25} class="recap-score-val" />
          <span class="recap-quota">/ {fmt(report.quota)}</span>
        </div>

        {kills.length > 0 && <ul class="recap-list">{kills}</ul>}
        <p class="recap-facts recap-line" style={d(next())}>
          <span>
            Best kill <b>{fmt(tally.bestKill)}</b>
          </span>
          <span>
            Grazes <b>{tally.grazes}</b>
          </span>
          <span>{tally.damageTaken === 0 ? 'No damage taken' : `Hit ${tally.damageTaken}×`}</span>
        </p>
        {triggers.length > 0 && (
          <div class="recap-relics recap-line" style={d(trigAt)}>
            <span class="muted">Triggers</span>
            <ul>{triggers}</ul>
          </div>
        )}

        {reward && (
          <ul class="recap-list recap-money">
            {moneyRows.map(([name, v], i) => (
              <li key={name} class={v > 0 ? 'recap-line' : 'recap-line zero'} style={d(moneyAt[i]!)}>
                <span>{name}</span>
                <b class="mk-money">
                  +<Counter from={0} value={v} format={fmtMoney} delay={moneyAt[i]} duration={0.3} />
                </b>
              </li>
            ))}
            <li class="recap-line recap-total" style={d(totalAt)}>
              <span>
                Balance{' '}
                {tally.moneyEarned > 0 && <small>(incl. ${tally.moneyEarned} picked up in flight)</small>}
              </span>
              <b class="money">
                <Counter
                  from={run.money - reward.total}
                  value={run.money}
                  format={fmtMoney}
                  delay={totalAt}
                  duration={0.7}
                />
              </b>
            </li>
          </ul>
        )}
        {report.sectorCleared && (
          <p class="recap-sector recap-line" style={d(next())}>
            Sector cleared: +1 HP repaired
          </p>
        )}

        <button
          type="button"
          class={won ? 'btn go big recap-next' : 'btn big recap-next'}
          style={d(next())}
          onClick={() => game().afterRecap()}
        >
          {label}
        </button>
      </div>
    </div>
  );
}
