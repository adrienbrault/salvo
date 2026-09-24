---
name: visual-check
description: Verify SALVO visually in Chrome — rendering, environment, effects, UI screens — on WebGPU and the WebGL2 fallback, and capture screenshots. Use after any visual change or when asked to show the game.
---

# Visual check

Background, flags and debug recipes: `docs/browser-testing.md`.

1. **Server.** `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173` answers 200; otherwise start `bun run dev` in the background (binding a port may need the sandbox lifted). If other agents are editing the tree, use a snapshot server instead (see the doc). Done when the page URL answers 200.
2. **Boot.** Open a new tab on `http://localhost:5173/?rafshim` (add `&tier=…` to test a tier). Poll `typeof window.salvo` every ~10 s until it is `object` (a hidden window takes up to ~40 s). Done when `salvo.gr` exists.
3. **Reach the state.** Drive it with the `salvo` handle (jump to a sector, preview a biome, open a screen). Hide `#ui` for environment shots; keep it for UI checks. Done when the thing you changed is on screen.
4. **Capture.** Take a screenshot; read console messages with the pattern `rror|Uncaught|WARN|THREE`. Done when you have the screenshot and have read every error line.
5. **Fallback.** Repeat steps 2–4 with `&webgl` added. Done when `salvo.gr.isWebGPU` is `false` and the change still renders.
6. **Share.** When the user wants to see it, take the screenshots with `save_to_disk`, copy them under descriptive names, and send them with SendUserFile.

The check passes when both backends show the change with zero console errors; report anything else as a finding, with the screenshot.
