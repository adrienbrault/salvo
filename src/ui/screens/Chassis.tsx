import { useState } from 'preact/hooks';
import { CHASSIS, type ChassisDef } from '../../content/chassis';
import { getItem } from '../../content/registry';
import { describe, KIND_LABEL } from '../../content/types';
import { useHover } from '../components/HoverDetail';
import { Rich } from '../components/Rich';
import { game } from '../game';

/** Starting ship pick (Balatro decks). Hovering a chassis previews its parts below. */
export function Chassis() {
  const [pick, setPick] = useState<ChassisDef>(CHASSIS[0]!);
  const hover = useHover<ChassisDef>();
  const shown = hover.at?.target ?? pick;
  const g = game();
  return (
    <div class="screen chassis">
      <header class="screen-head">
        <h2>Choose your chassis</h2>
        <p class="muted">It sets your starting weapon, engine and core.</p>
      </header>
      <div class="chassis-list">
        {CHASSIS.map((ch, i) => {
          const weapon = getItem(ch.weapon);
          return (
            <button
              type="button"
              key={ch.id}
              class={pick.id === ch.id ? 'chassis-card selected' : 'chassis-card'}
              style={{ '--c': ch.color, '--a': ch.accent, '--delay': `${i * 70}ms` }}
              aria-pressed={pick.id === ch.id}
              {...hover.bind(ch, ch.id)}
              onClick={() => setPick(ch)}
            >
              <span class="ch-glyph">{weapon.glyph}</span>
              <span class="ch-body">
                <span class="ch-name">{ch.name}</span>
                <span class="ch-tag">{ch.tagline}</span>
              </span>
            </button>
          );
        })}
      </div>
      <section class="chassis-detail panel" style={{ '--c': shown.accent }} key={pick.id}>
        {[shown.weapon, shown.engine, shown.core].map((id) => {
          const def = getItem(id);
          return (
            <div class="ch-part" key={id}>
              <span class="ch-part-glyph" style={{ color: def.color }}>
                {def.glyph}
              </span>
              <div>
                <p class="ch-part-name">
                  {def.name} <small>{KIND_LABEL[def.kind]}</small>
                </p>
                <p class="ch-part-desc">
                  <Rich text={describe(def)} />
                </p>
              </div>
            </div>
          );
        })}
      </section>
      <footer class="screen-foot">
        <button type="button" class="btn ghost" onClick={() => g.toTitle()}>
          Back
        </button>
        <button type="button" class="btn go big" onClick={() => g.newRun(pick.id)}>
          Launch with {pick.name}
        </button>
      </footer>
    </div>
  );
}
