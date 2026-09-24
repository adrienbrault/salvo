---
paths:
  - "src/render/**"
---

# Rendering rules

Read `docs/rendering.md` before a structural change here (new material, object type, biome, post pass or quality setting).

- No pipeline compiles during play: a new kind of object goes into `GameRenderer.showGameplay`, so it compiles behind the menus; runtime changes are uniforms, geometry, instance counts and visibility.
- Gameplay reads first: the environment stays darker and less saturated than bullets, the ship and enemies. Magenta (`DANGER`) is enemy bullets' alone: no enemy, effect or biome light wears it.
- Inside |x| < 50 the environment stays below z ≈ −2.
- Additive/unlit materials: `fog = false`. Hull meshes: `layers.enable(AO_LAYER)`.
- New `HullBuilder` primitives get a `checkFrame` test; biome geometry stays within the vertex budget in `biomes.test.ts`.
- A visual change is done when the visual-check skill shows it on WebGPU and on `?webgl`, both with a clean console.
