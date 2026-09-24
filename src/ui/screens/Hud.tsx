import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { getItem, resolveRelicDef } from '../../content/registry';
import { KIND_NAME, levelSpecFor, sectorName } from '../../run/levels';
import { RELIC_SLOTS } from '../../run/state';
import { CONSTRAINTS } from '../../sim/constraints';
import { GRAZER } from '../../sim/weapons';
import { Counter } from '../components/Counter';
import { HpPips } from '../components/Pips';
import { fmt, fmtMoney, fmtMult, fmtTime } from '../format';
import { game } from '../game';
import { type HudState, ui } from '../store';

const ACTION_LABEL: Record<string, string> = {
  blaster: 'Salvo',
  grazer: 'Wave',
  mirror: 'Shield',
  ram: 'Dash',
};

/** In-level overlay. Everything is pointer-transparent except the pause button. */
export function Hud() {
  const h = ui.hud.value;
  return (
    <div class={h.blackout ? 'hud blackout' : 'hud'}>
      <div class="hud-left">
        <div class="hud-main">
          <p class="hud-level">
            Sector {h.sector + 1} — {sectorName(h.sector)}
            <b>{levelName(h)}</b>
          </p>
          <Score score={h.score} quota={h.quota} />
          <Mult gauge={h.gauge} />
          <div class={h.phase === 'play' && h.timeLeft <= 10 ? 'hud-timer warn' : 'hud-timer'}>
            <b class="timer-val">{fmtTime(h.timeLeft)}</b>
            <small>s</small>
          </div>
        </div>
        <div class="hud-status">
          <HpPips hp={h.hp} max={h.maxHp} class="hud-hp" key={h.hp} />
          <span class="hud-money">
            <Counter value={h.money} format={fmtMoney} punch />
          </span>
        </div>
      </div>
      <div class="hud-right">
        <button
          type="button"
          class="hud-pause"
          aria-label="Pause"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => game().togglePause(true)}
        >
          <span />
        </button>
        <Relics />
        <Action h={h} />
      </div>
      {h.bossHp !== null && <BossBar hp={h.bossHp} constraint={h.constraint} />}
      {h.bossHp === null && h.constraint && <ConstraintBadge id={h.constraint} class="hud-constraint" />}
      <Banner h={h} />
      {h.blackout && <div class="hud-static" />}
    </div>
  );
}

const levelName = (h: HudState): string => {
  const run = ui.run.value;
  return run ? levelSpecFor(run, h.sector, h.levelIndex).name : '';
};

function Score({ score, quota }: { score: number; quota: number }) {
  const p = Math.min(1, score / Math.max(1, quota));
  return (
    <div class={p >= 1 ? 'hud-score full' : 'hud-score'}>
      <div class="score-line">
        <Counter value={score} class="score-val" duration={0.25} />
        <span class="score-quota">/ {fmt(quota)}</span>
      </div>
      <div class="quota-bar">
        <i class="quota-fill" style={{ transform: `scaleX(${p})` }} />
      </div>
    </div>
  );
}

function Mult({ gauge }: { gauge: number }) {
  // Remember drops (hit) to flash the chip; mutable refs keep this render-only.
  const prev = useRef(gauge);
  const drops = useRef(0);
  if (gauge < prev.current - 0.05) drops.current++;
  prev.current = gauge;
  const heat = Math.min(1, Math.max(0, (gauge - 1) / 5));
  return (
    <div class="hud-mult" style={{ '--heat': heat.toFixed(3) }}>
      <span class={drops.current ? 'mult-val hit' : 'mult-val'} key={drops.current}>
        <small>×</small>
        {fmtMult(gauge)}
      </span>
    </div>
  );
}

function Relics() {
  void ui.runVersion.value;
  const run = ui.run.value;
  const pulses = ui.relicPulse.value;
  const relics = run?.loadout.relics ?? [];
  const slots = [];
  for (let i = 0; i < RELIC_SLOTS; i++) {
    const inst = relics[i];
    if (!inst) {
      slots.push(<span key={`empty-${i}`} class="rslot empty" />);
      continue;
    }
    const def = getItem(inst.id);
    const copied = def.id === 'blueprint' ? resolveRelicDef(relics, i) : null;
    const n = pulses[i] ?? 0;
    slots.push(
      <span key={inst.uid} class="rslot" style={{ '--c': def.color }}>
        <span class={n ? 'rslot-tile go' : 'rslot-tile'} key={n}>
          <span class="rslot-glyph">{def.glyph}</span>
          {copied && <span class="rslot-copy">{copied.glyph}</span>}
        </span>
        <span class="rslot-name">{def.name}</span>
      </span>,
    );
  }
  return <div class="hud-relics">{slots}</div>;
}

function Action({ h }: { h: HudState }) {
  const label = h.blackout ? 'Radio Silence' : (ACTION_LABEL[h.weapon] ?? 'Action');
  let body: ComponentChildren;
  let ready: boolean;
  if (h.weapon === 'ram') {
    ready = h.charges > 0;
    const pips = [];
    for (let i = 0; i < h.maxCharges; i++) pips.push(<i key={i} class={i < h.charges ? 'pip on' : 'pip'} />);
    body = <span class="action-pips">{pips}</span>;
  } else {
    ready = h.action >= (h.weapon === 'grazer' ? GRAZER.minCharge : 0.999);
    body = (
      <span class="action-bar">
        <i class="action-fill" style={{ transform: `scaleX(${Math.min(1, Math.max(0, h.action))})` }} />
        {h.weapon === 'grazer' && <b class="action-min" style={{ left: `${GRAZER.minCharge * 100}%` }} />}
      </span>
    );
  }
  const cls = ['hud-action', `w-${h.weapon}`];
  if (h.blackout) cls.push('off');
  else if (ready) cls.push('ready');
  return (
    <div class={cls.join(' ')}>
      <span class="action-label">{label}</span>
      {body}
      {h.weapon === 'mirror' && h.stored > 0 && <span class="action-stored">↺ {h.stored}</span>}
    </div>
  );
}

function ConstraintBadge({ id, class: cls }: { id: NonNullable<HudState['constraint']>; class?: string }) {
  const c = CONSTRAINTS[id];
  return (
    <span class={cls ? `constraint-chip ${cls}` : 'constraint-chip'} title={c.desc}>
      <b>{c.glyph}</b>
      {c.name}
    </span>
  );
}

function BossBar({ hp, constraint }: { hp: number; constraint: HudState['constraint'] }) {
  return (
    <div class="hud-boss">
      <div class="boss-label">
        <span>{KIND_NAME.boss}</span>
        {constraint && <ConstraintBadge id={constraint} />}
      </div>
      <div class="boss-bar">
        <i class="boss-fill" style={{ transform: `scaleX(${Math.max(0, hp)})` }} />
      </div>
    </div>
  );
}

/** Level intro card and outcome stamp, centered on the field. */
function Banner({ h }: { h: HudState }) {
  if (h.phase === 'intro') {
    const c = h.constraint ? CONSTRAINTS[h.constraint] : null;
    return (
      <div class="hud-banner intro" key="intro">
        <p class="banner-sector">
          Sector {h.sector + 1} — {sectorName(h.sector)}
        </p>
        <h2>{levelName(h)}</h2>
        <p class="banner-quota">
          Quota <b>{fmt(h.quota)}</b> in {Math.round(h.duration)}s
        </p>
        <p class="banner-ready">Ready</p>
        {c && (
          <p class="banner-constraint">
            <b>{c.glyph}</b> {c.name}: {c.desc}
          </p>
        )}
      </div>
    );
  }
  if (h.phase === 'outro' || h.phase === 'done') {
    const won = h.score >= h.quota;
    const text = won ? 'Quota reached' : h.hp <= 0 ? 'Hull destroyed' : 'Time’s up';
    return (
      <div class={won ? 'hud-banner stamp won' : 'hud-banner stamp lost'} key="outro">
        <h2>{text}</h2>
      </div>
    );
  }
  return null;
}
