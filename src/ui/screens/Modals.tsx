import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { getItem } from '../../content/registry';
import { CALIBRATION_BONUS, KILL_TYPE_SOURCE } from '../../content/upgrades';
import { computeStats, MODULE_EFFECT } from '../../sim/stats';
import { KILL_TYPE_LABEL, KILL_TYPES } from '../../sim/types';
import { copyNote, ItemDetail } from '../components/ItemDetail';
import { fmt } from '../format';
import { game } from '../game';
import { type Modal, type Settings, ui } from '../store';

const TITLE: Record<Modal, string> = {
  settings: 'Settings',
  records: 'Records',
  build: 'Your ship',
};

const close = () => {
  ui.modal.value = null;
};

/** Settings / records / build overview, above whatever screen is showing. Esc closes. */
export function Modals() {
  const m = ui.modal.value;
  useEffect(() => {
    if (!m) return;
    // Capture phase: runs before the game's Esc = pause binding, which must not fire here.
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [m]);
  if (!m) return null;
  return (
    <div class="modal-layer">
      <button type="button" class="modal-scrim" aria-label="Close" onClick={close} />
      <div class={`panel modal modal-${m}`} role="dialog" aria-modal="true" aria-label={TITLE[m]}>
        <header class="modal-head">
          <h2>{TITLE[m]}</h2>
          <button type="button" class="icon-btn" aria-label="Close" onClick={close}>
            ✕
          </button>
        </header>
        <div class="modal-body">
          {m === 'settings' && <SettingsPanel />}
          {m === 'records' && <Records />}
          {m === 'build' && <Build />}
        </div>
      </div>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

/** Graphics options as the renderer was created with (they only apply on restart). */
let bootGfx: Pick<Settings, 'quality' | 'forceWebGL'> | null = null;

const QUALITY: [Settings['quality'], string][] = [
  ['auto', 'Auto'],
  ['ultra', 'Ultra'],
  ['high', 'High'],
  ['medium', 'Medium'],
  ['low', 'Low'],
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

function SettingsPanel() {
  const s = ui.settings.value;
  bootGfx ??= { quality: s.quality, forceWebGL: s.forceWebGL };
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    ui.settings.value = { ...ui.settings.value, [k]: v };
  };
  const restart = s.quality !== bootGfx.quality || s.forceWebGL !== bootGfx.forceWebGL;
  const be = ui.backend.value;
  return (
    <div class="settings">
      <Slider
        label="Sound effects"
        value={s.volume}
        min={0}
        max={1}
        step={0.05}
        show={pct}
        set={(v) => set('volume', v)}
      />
      <Slider
        label="Music"
        value={s.music}
        min={0}
        max={1}
        step={0.05}
        show={pct}
        set={(v) => set('music', v)}
      />
      <Slider
        label="Screen shake"
        value={s.shake}
        min={0}
        max={1.5}
        step={0.1}
        show={pct}
        set={(v) => set('shake', v)}
      />
      <Slider
        label="Touch sensitivity"
        value={s.touchSensitivity}
        min={0.6}
        max={2}
        step={0.05}
        show={(v) => `×${v.toFixed(2)}`}
        set={(v) => set('touchSensitivity', v)}
      />
      <Toggle label="Vibration" on={s.vibration} set={(v) => set('vibration', v)} />
      <div class="field">
        <span class="field-label">Graphics quality</span>
        <div class="seg">
          {QUALITY.map(([q, name]) => (
            <button
              type="button"
              key={q}
              aria-pressed={s.quality === q}
              class={s.quality === q ? 'on' : ''}
              onClick={() => set('quality', q)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <Toggle label="Force WebGL (compatibility)" on={s.forceWebGL} set={(v) => set('forceWebGL', v)} />
      <p class="muted settings-backend">
        Current renderer: {be.api} · {be.tier}
      </p>
      {restart && (
        <div class="settings-restart">
          <p>Quality and WebGL changes apply after a restart.</p>
          <button type="button" class="btn go small" onClick={() => location.reload()}>
            Restart
          </button>
        </div>
      )}
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  show(v: number): string;
  set(v: number): void;
}

function Slider({ label, value, min, max, step, show, set }: SliderProps) {
  return (
    <label class="field">
      <span class="field-label">
        {label}
        <output>{show(value)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--p': `${((value - min) / (max - min)) * 100}%` }}
        onInput={(e) => set(Number(e.currentTarget.value))}
      />
    </label>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set(v: boolean): void }) {
  return (
    <button type="button" role="switch" aria-checked={on} class="field toggle" onClick={() => set(!on)}>
      <span class="field-label">{label}</span>
      <span class={on ? 'switch on' : 'switch'} />
    </button>
  );
}

// ── Records ──────────────────────────────────────────────────────────────────

function Records() {
  const r = game().records;
  if (r.runs === 0) return <p class="muted">No runs yet. Your records will show up here.</p>;
  const rows: [string, string][] = [
    ['Runs', fmt(r.runs)],
    ['Wins', fmt(r.wins)],
    ['Best sector', String(r.bestSector + 1)],
    ['Best level score', fmt(r.bestLevelScore)],
    ['Best kill', fmt(r.bestKill)],
  ];
  return (
    <dl class="stats-grid">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Build overview ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="build-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Build() {
  void ui.runVersion.value;
  const run = ui.run.value;
  if (!run) return <p class="muted">No run in progress.</p>;
  const lo = run.loadout;
  const stats = computeStats(run);
  const calibrated = KILL_TYPES.filter((kt) => run.calibrations[kt] > 0);
  return (
    <div class="build">
      <Section title="Equipment">
        {[lo.weapon, lo.engine, lo.core].map((inst) => (
          <ItemDetail key={inst.uid} def={getItem(inst.id)} inst={inst} />
        ))}
      </Section>
      <Section title={`Relics ${lo.relics.length}/5, left to right`}>
        {lo.relics.length === 0 && (
          <p class="muted">No relics yet. The shop offers some after every level.</p>
        )}
        {lo.relics.map((inst, i) => (
          <ItemDetail key={inst.uid} def={getItem(inst.id)} inst={inst} note={copyNote(lo.relics, i)} />
        ))}
      </Section>
      <Section title="Calibrations">
        {calibrated.length === 0 ? (
          <p class="muted">None yet. Workshop calibrations boost one kill source.</p>
        ) : (
          <ul class="calib-list">
            {calibrated.map((kt) => {
              const n = run.calibrations[kt];
              return (
                <li key={kt}>
                  <span>
                    {KILL_TYPE_LABEL[kt]} <small class="calib-lvl">lv {n}</small>
                  </span>
                  <span>
                    <span class="mk-b">+{n * CALIBRATION_BONUS.base} Shards</span>{' '}
                    <span class="mk-m">+{n * CALIBRATION_BONUS.mult} Mult</span>
                  </span>
                  <small class="calib-src">{KILL_TYPE_SOURCE[kt]}</small>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title="Hull & modules">
        <ul class="calib-list">
          <li>
            <span>HP</span>
            <span>
              {run.hp}/{stats.maxHp}
            </span>
          </li>
          <li>
            <span>Damage</span>
            <span>+{Math.round(run.modules.damage * MODULE_EFFECT.damage * 100)}%</span>
          </li>
          <li>
            <span>Fire rate</span>
            <span>+{Math.round(run.modules.rate * MODULE_EFFECT.rate * 100)}%</span>
          </li>
        </ul>
      </Section>
    </div>
  );
}
