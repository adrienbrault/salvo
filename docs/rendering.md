# Rendering

three.js r186 `WebGPURenderer` with TSL node materials. WebGPU is the target; the WebGL2 backend (`?webgl`, and every browser without WebGPU) is a first-class fallback — a visual change is done when both render it with a clean console.

## Pipeline stability

A pipeline compile stalls a frame for 50–500 ms, so none happens during play: gameplay only changes uniforms, geometry, instance counts and visibility, and every pipeline is compiled ahead by a `FrameCompiler` (`precompile.ts`).

- Boot compiles what the title screen draws (the loading bar follows it); what only play draws compiles on title and menu frames, and a level waits for `gameplayReady`. Both render unculled frames, so a wider screen or a later stretch of trench needs nothing new.
- A capture frame renders every pass for real, minus the draws whose pipelines don't exist yet; each of those is then built with the state it had in the frame (the pass's context, the lights, an override material's nodes) and its pipeline compiled asynchronously. `renderer.compileAsync` sees none of the passes' context and compiles pipelines the post chain never uses.
- Lights come from the fixed `LightPool` (point lights are never added or removed; requests compete for the pool each frame).
- Variation is data: biome palettes, floor modes, haze and sky are uniforms; biome surfaces are texture-layer indices (`aInfo.x`, remapped per biome), never new materials.
- A new kind of object goes into `GameRenderer.showGameplay`, which puts one of everything play draws on screen for the capture frames. Sharing a warmed object's material and flags is not enough for an `InstancedMesh`: three names its matrix buffer after the mesh, so each one compiles pipelines of its own (`Trench.prewarm` shows the asteroid field, absent from the first biome).
- The space environment re-bakes into the same PMREM target, so `scene.environment` keeps its identity across biomes.
- Shader code never depends on the canvas size, so resizes, rotations and dynamic resolution only reallocate render targets. Clustered lighting uses a fixed tile grid (`FixedClusteredLighting.ts`): three's own sizes the grid from the drawing buffer and bakes it into every lit shader, so each resize recompiled ~40 pipelines.

## Look and readability

- Gameplay reads first: bullets, the ship's hitbox and enemies stay the brightest, most saturated things on screen. Floors and walls stay dark; emissive environment detail is thin (lines, dots, windows), never large bright areas behind the field.
- Three things must never be confused, so each has one look: enemy bullets are the only magenta things on screen (`DANGER`, whoever fired them): a bright ring at the hitbox's edge round a white core, with a dark rim that premultiplied blending in `Bullets.ts` cuts out of whatever is behind. Enemies are solid, lit ships in any other hue, whose glow parts and hit flash stay well below bullet brightness (a mine is spikes round a small glowing heart). Effects and scenery (fire, embers, sparks on the deck) stay dimmer than both.
- The floor never mirrors gameplay (`Sea.unreflected`), and under the field it reflects nothing: ghost bullets and ships read as more things to dodge. Reflections stay along the banks.
- HDR colour: palette entries are sRGB hex (`palette.ts`); anything meant to bloom goes above 1. AgX tone mapping, then SMAA, then grain (see the header of `Post.ts` for the chain).
- Additive and unlit materials set `fog = false` — the custom fog node would tint them.
- Hull meshes enable `AO_LAYER`: GTAO runs on a half-resolution pre-pass of that layer only, so bullets and emissives never get darkened.
- Every added cost gets a switch in `quality.ts`; tiers are picked automatically (WebGPU desktop → ultra, WebGPU phone → high, WebGL → medium/low). The frame is fill-rate bound — every pass costs per pixel — so each tier caps the drawing buffer (`maxPixels`, lowering the pixel ratio on large high-DPI screens), and dynamic resolution scales the whole canvas pixel ratio (scene and post together) under load.

## World conventions

z is up; the gameplay plane is z = 0 and sim units are world units; +y is up the field and the world scrolls toward −y at `SCROLL_SPEED`. The camera looks down with a forward tilt and fits the 9:16 field to any aspect ratio (`CameraRig.fit`).

The field occupies |x| < ~46. Inside |x| < 50 nothing rises above z ≈ −2 (it would occlude play): bridges, gantries and pipe crossings pass below; tall structures (towers, cranes, cooling towers) stand beyond |x| ≈ 60, and crane jibs clamp their reach.

## The environment (`src/render/env`)

- **Trench** — a pool of prebuilt segments (`SEG` = 64 units long) recycled as they scroll. `Trench.setBiome(def, key)` rebuilds the pool only when the key (run seed + sector) changes; the rebuild costs ~100–300 ms of JS, so the game triggers it behind the recap/shop, not at level start.
- **Biome** — a `BiomeDef` in `biomes.ts`: palette, floor mode (`metal` | `lava` | `cloud` | `void`), haze, sky tint, asteroid count, layer remap, and `plan(rng)` returning the per-trench config plus the per-segment `layout`.
- **Seams** — anything crossing a segment boundary is identical at y = 0 and y = `SEG`. Per-trench features (conduits, pipes, the conveyor, rock noise) are decided once in `plan()`; per-segment variation fades out at the ends (rock `bumps`); `RockNoise` waves fit a whole number of periods per segment.
- **Kit** — `SegmentBuilder` primitives on top of `HullBuilder`; all hull pieces of a segment merge into one mesh. Beacons (`Beacons.ts`, kinds red/accent/strobe/lamp/flow), volumetric cones (additive, merged), lamps (fed to the light pool only with `quality.envLamps`) and animated props (`spin`, `turret`) are the other channels.
- **HullBuilder** — `du` is the viewer's right and `dv` the viewer's up for every face, normal = du × dv; UVs are world-aligned (`tile` = world units per repeat) so neighbours tile seamlessly; tangents are explicit. Every new primitive gets a `checkFrame` test (`geometry.testing.ts`): wrong winding culls faces, wrong tangents light relief from the wrong side.
- **Textures** — painted at boot into texture arrays (`HullTextures.ts`, one layer per surface type; ORM alpha holds height for parallax). The emissive mask's channels are light classes: R warm (windows flicker; magma throbs and never switches off), G accent (energy flow), B alert (blinks, flares during the boss). A new layer means bumping `LAYER_COUNT` and adding its painter; boot time grows with each layer.
- **Budget** — `biomes.test.ts` caps a segment at 90k vertices; ten segments stay resident.

Recipe for a new biome: add a `BiomeDef` (reuse the kit; new looks come from layout, layer remaps and uniforms), extend `biomes.test.ts` if it introduces new geometry, then check it on both backends (see `docs/browser-testing.md`).

## Destruction

Visual only — the sim never knows. `FxDirector` turns explosions into `Trench.damage(x, y, radius, power)`, and the damage lands on each structure when the shockwave ring reaches it (`RING_SPEED`), so a boss kill levels the deck outward from the blast.

- **Breakables** — layouts wrap structures in `SegmentBuilder.breakable(opts, parts)`: far-deck cells (one part standing on its base: topple, slump or sink) and trench crossings (`crossing()`: two halves hinged at the walls). Explosive ones (`opts.explosive`) detonate a moment later and can chain. Falls never head toward the play field (`breakables.test.ts` poses every vertex to check it).
- **No extra draw calls** — breakable geometry stays in its segment's one mesh; every vertex carries `aPart`, a row of the `PartTable` float texture (rotation, pivot and drop, broken flag and heat) that the hull, beacon and cone materials read in the vertex shader. Row 0 never moves; each pool segment owns `MAX_PARTS` rows. Breaking is a small texture upload.
- **Trains and asteroids** — a wrecked train brakes and its cars go up one after the other; asteroids shatter and a fresh one comes round on wrap.
- **Scorch** — the sea simulation's B/A channels hold char and heat, advected in whole texels so marks stay crisp; `Sea.scorchAt` lets the hull read them, so terraces and bridges under a blast burn too. The simulation runs over the void floor as well.
- **Fire** — `Trench.fires` (recomputed every frame from broken parts and wrecked cars) feeds flame particles and flickering lights, kept below bullet brightness.
