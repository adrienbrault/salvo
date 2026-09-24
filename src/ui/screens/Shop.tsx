import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getItem, resolveRelicDef } from '../../content/registry';
import { type ItemDef, type ItemInstance, sellValue } from '../../content/types';
import { levelSpecFor } from '../../run/levels';
import { type BuyError, canBuy, rerollCost } from '../../run/shop';
import { RELIC_SLOTS, type RunState, type ShopOffer } from '../../run/state';
import { CONSTRAINTS } from '../../sim/constraints';
import { computeEconomy, computeStats } from '../../sim/stats';
import { Counter } from '../components/Counter';
import { type HoverBind, HoverDetail, useHover } from '../components/HoverDetail';
import { ItemCard, SoldCard } from '../components/ItemCard';
import { copyNote, ItemDetail } from '../components/ItemDetail';
import { HpPips } from '../components/Pips';
import { Rich } from '../components/Rich';
import { fmt, fmtMoney } from '../format';
import { game } from '../game';
import { ABOVE, type Side } from '../place';
import { ui } from '../store';
import { ownedUpgrades, upgradeNote } from '../upgrades';

type Area = 'offers' | 'workshop';
type EquipSlot = 'weapon' | 'engine' | 'core';
type Sel =
  | { area: Area; index: number }
  | { area: 'relics'; index: number }
  | { area: 'equip'; slot: EquipSlot }
  /** A calibration or module already bought, by its workshop item id. */
  | { area: 'upgrade'; id: string };

const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'engine', 'core'];

function keyOf(s: Sel): string {
  if (s.area === 'equip') return `equip-${s.slot}`;
  if (s.area === 'upgrade') return `upgrade-${s.id}`;
  return `${s.area}-${s.index}`;
}

/** Where a bought item now lives, to flash it: a relic tile, a loadout slot, an upgrade chip, the hull. */
function homeKey(def: ItemDef, run: RunState): string {
  if (def.kind === 'relic') return `relic-${run.loadout.relics.at(-1)?.uid}`;
  if (def.kind === 'weapon' || def.kind === 'engine' || def.kind === 'core') return `equip-${def.kind}`;
  if (def.id === 'repair') return 'hp';
  return `upgrade-${def.id}`;
}

const rich = (text: string | null) => text && <Rich text={text} />;

/** What the detail panel and the hover detail both show for a target. */
interface Detail {
  def: ItemDef;
  inst?: ItemInstance;
  note: ComponentChildren;
  /** What the panel's buttons say, for the hover detail that has none. */
  foot: ComponentChildren;
}

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

export function Shop() {
  void ui.runVersion.value;
  const run = ui.run.value;
  const [sel, setSel] = useState<Sel | null>(null);
  const [shake, setShake] = useState({ key: '', n: 0 });
  const [flash, setFlash] = useState({ key: '', n: 0 });
  const hover = useHover<Sel>();
  const shop = run?.shop;
  // Bring what was just bought into view (phones scroll the shop).
  useEffect(() => {
    if (flash.n === 0) return;
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .querySelector('.shop .flash')
      ?.parentElement?.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  }, [flash.n]);
  if (!run || !shop) return null;
  const g = game();

  const eco = computeEconomy(run);
  const interest = Math.min(eco.interestCap, Math.floor(Math.max(0, run.money) / eco.interestStep));
  const cost = rerollCost(run);
  const next = levelSpecFor(run);
  const bossId = run.constraints[run.sector];
  const boss = bossId ? CONSTRAINTS[bossId] : null;
  const maxHp = computeStats(run).maxHp;

  const selKey = sel ? keyOf(sel) : null;
  const toggle = (next: Sel) => setSel((cur) => (cur && keyOf(cur) === keyOf(next) ? null : next));

  /** The one description of a target, shared by the panel and the hover detail. */
  const detailOf = (t: Sel): Detail | null => {
    if (t.area === 'equip') {
      const inst = run.loadout[t.slot];
      return { def: getItem(inst.id), inst, note: null, foot: null };
    }
    if (t.area === 'upgrade') {
      const def = getItem(t.id);
      return { def, note: rich(upgradeNote(run, def)), foot: null };
    }
    if (t.area === 'offers' || t.area === 'workshop') {
      const o = shop[t.area][t.index];
      if (!o?.id) return null;
      const def = getItem(o.id);
      const err = canBuy(run, o);
      let note: ComponentChildren = rich(upgradeNote(run, def));
      if (def.kind === 'weapon' || def.kind === 'engine' || def.kind === 'core') {
        const old = run.loadout[def.kind];
        note = `Replaces ${getItem(old.id).name} (sold back for $${sellValue(old)}).`;
      }
      return { def, note, foot: err && <span class="detail-warn">{buyError(err, run, o)}</span> };
    }
    if (t.area === 'relics') {
      const inst = run.loadout.relics[t.index];
      if (!inst) return null;
      return {
        def: getItem(inst.id),
        inst,
        note: copyNote(run.loadout.relics, t.index),
        foot: (
          <>
            Sells for <span class="mk-money">${sellValue(inst)}</span> · drag to reorder
          </>
        ),
      };
    }
    return null;
  };

  const bindHover = (t: Sel, sides?: readonly Side[]): HoverBind => hover.bind(t, keyOf(t), sides);
  // The selected item is already in the panel: no second copy beside it.
  const hovered = hover.at && hover.at.key !== selKey ? detailOf(hover.at.target) : null;

  const buy = (area: Area, index: number) => {
    const offer = shop[area][index];
    if (!offer?.id) return;
    const def = getItem(offer.id);
    const err = canBuy(run, offer);
    g.buy(area, index);
    if (err) {
      setShake((s) => ({ key: `${area}-${index}`, n: s.n + 1 }));
      return;
    }
    setSel(null);
    setFlash((f) => ({ key: homeKey(def, run), n: f.n + 1 }));
  };
  // A brief highlight inside the element with this key, replayed per purchase by its `key`.
  const flashOn = (key: string) => flash.key === key && <i class="flash" key={flash.n} aria-hidden="true" />;
  const upgrades = ownedUpgrades(run);

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
          selected={selKey === k}
          shake={shake.key === k ? shake.n : 0}
          delay={i * 90}
          hover={bindHover({ area, index: i })}
          onSelect={() => toggle({ area, index: i })}
        />,
      );
    }
    return out;
  };

  const d = sel && detailOf(sel);
  let detail: JSX.Element | null = null;
  if (sel && d && (sel.area === 'offers' || sel.area === 'workshop')) {
    const o = shop[sel.area][sel.index]!;
    const err = canBuy(run, o);
    const { area, index } = sel;
    detail = (
      <ItemDetail def={d.def} note={d.note} onClose={() => setSel(null)}>
        {err && <p class="detail-warn">{buyError(err, run, o)}</p>}
        <button type="button" class={err ? 'btn buy off' : 'btn buy'} onClick={() => buy(area, index)}>
          Buy <b>${o.price}</b>
        </button>
      </ItemDetail>
    );
  } else if (sel?.area === 'relics' && d?.inst) {
    const relics = run.loadout.relics;
    const i = sel.index;
    const inst = d.inst;
    const move = (to: number) => {
      g.move(i, to);
      setSel({ area: 'relics', index: to });
    };
    detail = (
      <ItemDetail def={d.def} inst={inst} note={d.note} onClose={() => setSel(null)}>
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
  } else if (d) {
    detail = <ItemDetail def={d.def} inst={d.inst} note={d.note} onClose={() => setSel(null)} />;
  }

  return (
    <div class={detail ? 'screen shop has-detail' : 'screen shop'}>
      <header class="shop-head">
        <div>
          <h2>Shop</h2>
          <HpPips
            hp={run.hp}
            max={maxHp}
            class={flash.key === 'hp' ? 'bumped' : ''}
            key={`${run.hp}/${maxHp}-${flash.key === 'hp' ? flash.n : 0}`}
          />
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
            hover={(i) => bindHover({ area: 'relics', index: i }, ABOVE)}
            flash={flashOn}
            onGrab={hover.hide}
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
                  {...bindHover({ area: 'equip', slot }, ABOVE)}
                  onClick={() => toggle({ area: 'equip', slot })}
                >
                  {flashOn(`equip-${slot}`)}
                  <span class="equip-glyph">{def.glyph}</span>
                  <span class="equip-name">{def.name}</span>
                </button>
              );
            })}
          </div>
          {upgrades.length > 0 && (
            <div class="upgrade-row">
              <span class="upgrade-label">Upgrades</span>
              {upgrades.map((u) => {
                const def = getItem(u.id);
                const t: Sel = { area: 'upgrade', id: u.id };
                const on = selKey === keyOf(t);
                return (
                  <button
                    type="button"
                    key={u.id}
                    class={on ? 'upgrade-chip selected' : 'upgrade-chip'}
                    style={{ '--c': def.color }}
                    aria-pressed={on}
                    aria-label={`${u.label} ${u.value}`}
                    {...bindHover(t, ABOVE)}
                    onClick={() => toggle(t)}
                  >
                    {flashOn(keyOf(t))}
                    <span class="upgrade-glyph">{def.glyph}</span>
                    {u.label}
                    <b>{u.value}</b>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <aside class="shop-side">
        <div class="shop-detail" key={sel ? JSON.stringify(sel) : 'none'}>
          {detail ?? (
            <p class="shop-empty">
              <span class="on-touch">Tap a card to read what it does.</span>
              <span class="on-hover">
                Point at anything to read it. Click a card to buy it, or a relic to move or sell it.
              </span>
            </p>
          )}
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
      <HoverDetail at={hover.at}>
        {hovered && (
          <ItemDetail def={hovered.def} inst={hovered.inst} note={hovered.note} foot={hovered.foot} />
        )}
      </HoverDetail>
    </div>
  );
}

interface TrayProps {
  run: RunState;
  selected: number;
  hover(i: number): HoverBind;
  /** The purchase highlight for the element with this key (`relic-<uid>`), if any. */
  flash(key: string): JSX.Element | false;
  /** A press may start a drag: the hover detail gets out of the way. */
  onGrab(): void;
  onSelect(i: number): void;
  onMove(from: number, to: number): void;
}

/** Owned relics: tap to inspect, drag to reorder (mouse or touch). */
function RelicTray({ run, selected, hover, flash, onGrab, onSelect, onMove }: TrayProps) {
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
    const h = hover(i);
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
        onPointerEnter={h.onPointerEnter}
        onPointerLeave={h.onPointerLeave}
        onFocus={h.onFocus}
        onBlur={h.onBlur}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          onGrab();
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
          {flash(`relic-${inst.uid}`)}
          <span class="tray-glyph">{def.glyph}</span>
          {copied && <span class="rslot-copy">{copied.glyph}</span>}
        </span>
        <span class="tray-name">{def.name}</span>
      </button>,
    );
  }
  return <div class="tray">{slots}</div>;
}
