---
paths:
  - "src/ui/**"
  - "src/app/**"
---

# UI rules

The UI is a Preact DOM overlay in `#ui` above the WebGPU canvas. Player-facing copy is English.

## State and routing

- `src/ui/store.ts` signals are the only UI state. `Game` (src/app/Game.ts) writes `screen`, `paused`, `run` (+ `bumpRun()`), `hud` (30 Hz), `report`, `tally`, `relicPulse`, `hasSave`, and calls `toast()`. Screens write only `modal` and `settings`.
- `ui.run` is mutated in place: a component that reads the run also reads `ui.runVersion.value`.
- Only the `Hud` leaf reads `ui.hud`; keep it out of `App` and screens so they do not re-render at 30 Hz.
- Screens call controller actions through `game()` (src/ui/game.ts, bound in main.tsx). A new screen is a `Screen` value plus a case in `App.tsx`'s `ScreenView`, entered via a `Game` method that calls `go()` (it toggles gameplay input and music).
- Settings persist and apply through the `effect` in main.tsx (`saveSettings`, audio, input, camera shake). `quality`/`forceWebGL` apply on reload.

## HUD layout contract

- `insetsFor` in main.tsx and `hud.css` must agree: aspect ≥ 11/10 puts the HUD in side columns (insets 14px), otherwise a top band (`HUD_TOP`) and bottom band (`HUD_BOTTOM`), both plus safe areas. Change the constants and the CSS together.
- main.tsx publishes the field's on-screen bounds as `--field-l/r/t/b` on `#ui`; hug the field with them instead of guessing.
- Gameplay input listens on `#stage`, the HUD's ancestor. HUD elements stay `pointer-events: none`; an interactive HUD control gets `pointer-events: auto` and `onPointerDown={(e) => e.stopPropagation()}` so it never fires the weapon.

## Mobile and feel

- Touch targets are ≥ 44px; every hover effect has a tap equivalent (select-then-act panels, arrow buttons beside drag reorder). Gate hover-only polish with `@media (hover: hover)`.
- Use safe-area vars (`--safe-*`) for anything pinned to an edge. Scrollable screens set `touch-action: pan-y` (the stage is `touch-action: none`).
- Clipped shapes use `clip-path: var(--chamfer)` (size via `--cut`); outlines and outer shadows are clipped, so focus rings are inset box-shadows and glows go on an unclipped parent (`filter: drop-shadow`).
- Replay a CSS animation by changing a `key` (relic pulses, card shake). Numbers roll with `Counter`, which writes text imperatively.
- Motion that is decorative gets a `prefers-reduced-motion` override in its stylesheet.

## Text

- Item descriptions use markup `{m:}` +Mult, `{b:}` Shards, `{x:}` ×Mult, `{$:}` money, `{k:}` keyword, `{g:}` gauge, parsed by `markup.ts` (tested) and rendered by `components/Rich.tsx`.
- Format numbers with `format.ts` (`fmt`, `fmtMult`, `fmtTime`, `fmtMoney`: English separators, B/M suffixes).
- Browser checks: the hidden Chrome window needs `?rafshim`; `?tier=low` boots faster; `window.salvo.ui` lets you set screens and HUD state from the console.
