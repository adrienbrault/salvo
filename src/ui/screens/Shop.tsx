import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { getItem, resolveRelicDef } from '../../content/registry';
import { type ItemInstance, sellValue } from '../../content/types';
import { levelSpecFor } from '../../run/levels';
import { type BuyError, canBuy, rerollCost } from '../../run/shop';
import { RELIC_SLOTS, type RunState, type ShopOffer } from '../../run/state';
import { CONSTRAINTS } from '../../sim/constraints';
import { computeEconomy, computeStats } from '../../sim/stats';
import { KILL_TYPE_LABEL } from '../../sim/types';
import { Counter } from '../components/Counter';
import { ItemCard, SoldCard } from '../components/ItemCard';
import { ItemDetail } from '../components/ItemDetail';
import { HpPips } from '../components/Pips';
import { fmt, fmtMoney } from '../format';
import { game } from '../game';
import { ui } from '../store';

type Area = 'offers' | 'workshop';
type EquipSlot = 'weapon' | 'engine' | 'core';
type Sel =
  | { area: Area; index: number }
  | { area: 'relics'; index: number }
  | { area: 'equip'; slot: EquipSlot };

const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'engine', 'core'];

function buyError(err: BuyError, run: RunState, offer: ShopOffer): string {
  switch (err) {
    case 'money':
      return `You’re $${offer.price - run.money} short.`;
    case 'slots':
      return 'All 5 relic slots are full: sell one first.';
    case 'full-hp':
      return 'Your hull is already intact.';
    case 'sold':
      return 'Already sold.';
  }
}

/** What a Blueprint in `slot` currently copies. */
function copyNote(relics: readonly ItemInstance[], slot: number): string | null {
  if (relics[slot]?.id !== 'blueprint') return null;
  const target = resolveRelicDef(relics, slot);
  return target ? `Currently copies: ${target.name}.` : 'Nothing to copy: put a relic to its right.';
}

export function Shop() {
  void ui.runVersion.value;
  const run = ui.run.value;
  const [sel, setSel] = useState<Sel | null>(null);
  const [shake, setShake] = useState({ key: '', n: 0 });
  const shop = run?.shop;
  if (!run || !shop) return null;
  const g = game();

  const eco = computeEconomy(run);
  const interest = Math.min(eco.interestCap, Math.floor(Math.max(0, run.money) / eco.interestStep));
  const cost = rerollCost(run);
  const next = levelSpecFor(run);
  const bossId = run.constraints[run.sector];
  const boss = bossId ? CONSTRAINTS[bossId] : null;
  const maxHp = computeStats(run).maxHp;

  const isSel = (area: Sel['area'], index: number) =>
    sel !== null && sel.area === area && 'index' in sel && sel.index === index;
  const toggle = (next: Sel) =>
    setSel((cur) => (cur && JSON.stringify(cur) === JSON.stringify(next) ? null : next));

  const buy = (area: Area, index: number) => {
    const offer = shop[area][index];
    if (!offer) return;
    const err = canBuy(run, offer);
    g.buy(area, index);
    if (err) setShake((s) => ({ key: `${area}-${index}`, n: s.n + 1 }));
    else setSel(null);
  };

  const row = (area: Area) => {
    const out: JSX.Element[] = [];
    const list = shop[area];
    for (let i = 0; i < list.length; i++) {
      const o = list[i]!;
      if (!o.id) {
        out.push(<SoldCard key={`${area}-${i}-sold`} />);
        continue;
      }
      const k = `${area}-${i}`;
      out.push(
        <ItemCard
          key={`${k}-${shop.rerolls}-${o.id}`}
          def={getItem(o.id)}
          price={o.price}
          dim={canBuy(run, o) === 'money'}
          selected={isSel(area, i)}
          shake={shake.key === k ? shake.n : 0}
          delay={i * 90}
          onSelect={() => toggle({ area, index: i })}
        />,
      );
    }
    return out;
  };

  let detail: JSX.Element | null = null;
  if (sel && (sel.area === 'offers' || sel.area === 'workshop')) {
    const o = shop[sel.area][sel.index];
    if (o?.id) {
      const def = getItem(o.id);
      const err = canBuy(run, o);
      let note: string | null = null;
      if (def.kind === 'weapon' || def.kind === 'engine' || def.kind === 'core') {
        const old = run.loadout[def.kind];
        note = `Replaces ${getItem(old.id).name} (sold back for $${sellValue(old)}).`;
      } else if (def.kind === 'calibration' && def.killType) {
        note = `Current ${KILL_TYPE_LABEL[def.killType]} level: ${run.calibrations[def.killType]}.`;
      } else if (def.id === 'repair' || def.id === 'mod_hull') {
        note = `Hull: ${run.hp}/${maxHp} HP.`;
      }
      const { area, index } = sel;
      detail = (
        <ItemDetail def={def} note={note} onClose={() => setSel(null)}>
          {err && <p class="detail-warn">{buyError(err, run, o)}</p>}
          <button type="button" class={err ? 'btn buy off' : 'btn buy'} onClick={() => buy(area, index)}>
            Buy <b>${o.price}</b>
          </button>
        </ItemDetail>
      );
    }
  } else if (sel?.area === 'relics') {
    const relics = run.loadout.relics;
    const i = sel.index;
    const inst = relics[i];
    if (inst) {
      const move = (to: number) => {
        g.move(i, to);
        setSel({ area: 'relics', index: to });
      };
      detail = (
        <ItemDetail
          def={getItem(inst.id)}
          inst={inst}
          note={copyNote(relics, i)}
          onClose={() => setSel(null)}
        >
          <button
            type="button"
            class="btn small"
            aria-label="Move left"
            disabled={i === 0}
            onClick={() => move(i - 1)}
          >
            ◀
          </button>
          <button
            type="button"
            class="btn small"
            aria-label="Move right"
            disabled={i === relics.length - 1}
            onClick={() => move(i + 1)}
          >
            ▶
          </button>
          <button
            type="button"
            class="btn danger"
            onClick={() => {
              g.sell(i);
              setSel(null);
            }}
          >
            Sell <b>+${sellValue(inst)}</b>
          </button>
        </ItemDetail>
      );
    }
  } else if (sel?.area === 'equip') {
    const inst = run.loadout[sel.slot];
    detail = <ItemDetail def={getItem(inst.id)} inst={inst} onClose={() => setSel(null)} />;
  }

  return (
    <div class={detail ? 'screen shop has-detail' : 'screen shop'}>
      <header class="shop-head">
        <div>
          <h2>Shop</h2>
          <HpPips hp={run.hp} max={maxHp} key={run.hp} />
        </div>
        <div class="shop-money money">
          <Counter value={run.money} format={fmtMoney} punch />
        </div>
      </header>

      <div class="shop-main">
        <section class="shop-row">
          <div class="row-head">
            <h3>Offers</h3>
            <button
              type="button"
              class={run.money < cost ? 'btn small reroll off' : 'btn small reroll'}
              onClick={() => {
                g.reroll();
                if (sel?.area === 'offers') setSel(null);
              }}
            >
              Reroll <b>${cost}</b>
            </button>
          </div>
          <div class="cards">{row('offers')}</div>
        </section>

        <section class="shop-row">
          <div class="row-head">
            <h3>Workshop</h3>
            <span class="hint">Applies now, takes no slot</span>
          </div>
          <div class="cards">{row('workshop')}</div>
        </section>

        <section class="shop-row">
          <div class="row-head">
            <h3>
              Relics{' '}
              <small class="row-count">
                {run.loadout.relics.length}/{RELIC_SLOTS}
              </small>
            </h3>
            <span class="hint">Trigger left to right</span>
          </div>
          <RelicTray
            run={run}
            selected={sel?.area === 'relics' ? sel.index : -1}
            onSelect={(i) => toggle({ area: 'relics', index: i })}
            onMove={(from, to) => {
              g.move(from, to);
              if (sel?.area === 'relics' && sel.index === from) setSel({ area: 'relics', index: to });
            }}
          />
          <div class="equip-row">
            {EQUIP_SLOTS.map((slot) => {
              const def = getItem(run.loadout[slot].id);
              const on = sel?.area === 'equip' && sel.slot === slot;
              return (
                <button
                  type="button"
                  key={slot}
                  class={on ? 'equip selected' : 'equip'}
                  style={{ '--c': def.color }}
                  aria-pressed={on}
                  onClick={() => toggle({ area: 'equip', slot })}
                >
                  <span class="equip-glyph">{def.glyph}</span>
                  <span class="equip-name">{def.name}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <aside class="shop-side">
        <div class="shop-detail" key={sel ? JSON.stringify(sel) : 'none'}>
          {detail ?? <p class="shop-empty">Tap a card to read what it does.</p>}
        </div>
        <div class="shop-next panel">
          <p>
            Next: <b>{next.name}</b> — quota <b class="mk-b">{fmt(next.quota)}</b> in {next.duration}s
          </p>
          {boss && (
            <>
              <p class="shop-boss">
                Sector boss:{' '}
                <span class="constraint-chip">
                  <b>{boss.glyph}</b>
                  {boss.name}
                </span>
              </p>
              <p class="muted">{boss.desc}</p>
            </>
          )}
          <p class="shop-interest">
            Interest at level end: <span class="mk-money">+${interest}</span>{' '}
            <small class="interest-rule">
              ($1 per ${eco.interestStep}, max ${eco.interestCap})
            </small>
          </p>
        </div>
      </aside>
      <button type="button" class="btn go big shop-leave" onClick={() => g.leaveShop()}>
        Continue
      </button>
    </div>
  );
}

interface TrayProps {
  run: RunState;
  selected: number;
  onSelect(i: number): void;
  onMove(from: number, to: number): void;
}

/** Owned relics: tap to inspect, drag to reorder (mouse or touch). */
function RelicTray({ run, selected, onSelect, onMove }: TrayProps) {
  const relics = run.loadout.relics;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const drag = useRef<{ from: number; id: number; x0: number; y0: number; active: boolean } | null>(null);
  const dragged = useRef(false);
  const [over, setOver] = useState<{ from: number; to: number } | null>(null);

  const targetAt = (x: number): number => {
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let j = 0; j < relics.length; j++) {
      const r = refs.current[j]?.getBoundingClientRect();
      if (!r) continue;
      const d = Math.abs(x - (r.left + r.width / 2));
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    return best;
  };

  const end = (e: JSX.TargetedPointerEvent<HTMLButtonElement>, commit: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    e.currentTarget.style.translate = '';
    setOver(null);
    if (!d.active) return;
    dragged.current = true;
    const to = targetAt(e.clientX);
    if (commit && to !== d.from) onMove(d.from, to);
  };

  const slots: JSX.Element[] = [];
  for (let i = 0; i < RELIC_SLOTS; i++) {
    const inst = relics[i];
    if (!inst) {
      slots.push(<span key={`empty-${i}`} class="tray-slot empty" />);
      continue;
    }
    const def = getItem(inst.id);
    const copied = def.id === 'blueprint' ? resolveRelicDef(relics, i) : null;
    let shift = 0;
    if (over && i !== over.from) {
      if (over.from < over.to && i > over.from && i <= over.to) shift = -1;
      else if (over.to < over.from && i >= over.to && i < over.from) shift = 1;
    }
    const cls = ['tray-slot', 'tray-relic'];
    if (selected === i) cls.push('selected');
    if (over?.from === i) cls.push('dragging');
    slots.push(
      <button
        type="button"
        key={inst.uid}
        ref={(el) => {
          refs.current[i] = el;
        }}
        class={cls.join(' ')}
        style={{ '--c': def.color, '--shift': shift }}
        aria-pressed={selected === i}
        aria-label={`${i + 1}. ${def.name}`}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          // A drag ending outside its button fires no click, so clear the swallow flag here.
          dragged.current = false;
          drag.current = { from: i, id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dx = e.clientX - d.x0;
          const dy = e.clientY - d.y0;
          if (!d.active && Math.hypot(dx, dy) < 8) return;
          d.active = true;
          e.currentTarget.style.translate = `${dx}px ${dy * 0.25}px`;
          const to = targetAt(e.clientX);
          setOver((o) => (o && o.to === to ? o : { from: d.from, to }));
        }}
        onPointerUp={(e) => end(e, true)}
        onPointerCancel={(e) => end(e, false)}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          onSelect(i);
        }}
      >
        <span class="tray-order">{i + 1}</span>
        <span class="tray-tile">
          <span class="tray-glyph">{def.glyph}</span>
          {copied && <span class="rslot-copy">{copied.glyph}</span>}
        </span>
        <span class="tray-name">{def.name}</span>
      </button>,
    );
  }
  return <div class="tray">{slots}</div>;
}
