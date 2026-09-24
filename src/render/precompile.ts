import type { Camera, Material, Object3D, Renderer, Scene } from 'three/webgpu';

/** A scene's lights node: one per scene, pointed at the lights of whichever pass rendered last. */
type LightsNode = { getLights(): unknown[]; setLights(lights: unknown[]): void };

type RenderObject = {
  drawRange: unknown;
  group: unknown;
  lightsNode: LightsNode;
  material: Record<string, unknown>;
};

/**
 * Material properties three's `renderObject` sets for a single draw: an override material
 * (shadow map, pre-pass) takes each object's position, color and depth nodes, and a
 * double-sided transparent material draws its back faces, then its front faces.
 */
const DRAW_STATE = [
  'side',
  'positionNode',
  'colorNode',
  'depthNode',
  'alphaTest',
  'alphaMap',
  'displacementMap',
  'displacementScale',
  'displacementBias',
  'transparent',
] as const;

type Pipelines = {
  getForRender(ro: RenderObject, promises?: Promise<unknown>[] | null): void;
  isReady(ro: RenderObject): boolean;
};

type DirectDraw = (
  object: Object3D,
  material: Material,
  scene: Scene,
  camera: Camera,
  lightsNode: unknown,
  group: unknown,
  clippingContext: unknown,
  passId?: string,
) => void;

/** The internals of three's `Renderer` (r186) that `compileAsync` uses and this module mirrors. */
interface Internals {
  contextNode: unknown;
  _currentRenderContext: unknown;
  _isPreCompiling: boolean;
  _renderObjectDirect?: DirectDraw;
  _objects: { get(...key: unknown[]): RenderObject };
  _nodes: {
    nodeFrame: { update(): void };
    updateForRender(ro: RenderObject): void;
  };
  _geometries: { updateForRender(ro: RenderObject): void };
  _bindings: { updateForRender(ro: RenderObject): void };
  _pipelines: Pipelines;
}

/**
 * A draw left out of a captured frame, with the state that only held during it and that
 * shader builds read: the pass's context node and lights, the material's `DRAW_STATE`.
 */
interface Draw {
  ro: RenderObject;
  contextNode: unknown;
  lights: unknown[];
  material: unknown[];
}

/** What a captured frame left for `compileFrame`. */
interface CapturedFrame {
  /** Draws whose pipelines do not exist yet. */
  draws: Draw[];
  /** Post-processing pipelines, already compiling. */
  pipelines: Promise<unknown>[];
}

/**
 * Renders a frame (`render`: every pass, shadow map and reflection included) in which only
 * draws whose pipelines exist happen; the others are returned for `compileFrame`.
 *
 * `renderer.compileAsync` sees one scene, camera and render target, with none of the passes'
 * context (ambient occlusion, MRT), so it compiled pipelines the post chain never used; a
 * captured frame is exactly what renders. Post-processing quads always draw, since their nodes
 * render the passes (the scene, bloom, ambient occlusion…), but their pipelines compile
 * asynchronously: three skips a draw whose pipeline is not ready.
 */
function captureFrame(renderer: Renderer, render: () => void): CapturedFrame {
  const r = renderer as unknown as Internals;
  const pipes = r._pipelines;
  const draw = r._renderObjectDirect!;
  const getForRender = pipes.getForRender;
  const ownDraw = Object.hasOwn(r, '_renderObjectDirect');
  const ownGet = Object.hasOwn(pipes, 'getForRender');
  const frame: CapturedFrame = { draws: [], pipelines: [] };
  const seen = new Set<RenderObject>();
  // render() reads `this._renderObjectDirect` for every object: an own property shadows it.
  r._renderObjectDirect = function (
    object,
    material,
    scene,
    camera,
    lightsNode,
    group,
    clippingContext,
    passId,
  ) {
    const quad = (object as Object3D & { isQuadMesh?: boolean }).isQuadMesh === true;
    if (!quad) {
      const ro = r._objects.get(
        object,
        material,
        scene,
        camera,
        lightsNode,
        r._currentRenderContext,
        clippingContext,
        passId,
      );
      if (!pipes.isReady(ro)) {
        ro.drawRange = (object as Object3D & { geometry: { drawRange: unknown } }).geometry.drawRange;
        ro.group = group;
        if (!seen.has(ro)) {
          frame.draws.push({
            ro,
            contextNode: r.contextNode,
            lights: [...ro.lightsNode.getLights()],
            material: DRAW_STATE.map((k) => ro.material[k]),
          });
        }
        seen.add(ro);
        return;
      }
    }
    draw.call(this, object, material, scene, camera, lightsNode, group, clippingContext, passId);
  };
  pipes.getForRender = (ro, promises) => getForRender.call(pipes, ro, promises ?? frame.pipelines);
  // Passes render once per node frame: step it, so this frame and the next both render them.
  r._nodes.nodeFrame.update();
  try {
    render();
  } finally {
    if (ownDraw) r._renderObjectDirect = draw;
    else delete r._renderObjectDirect;
    if (ownGet) pipes.getForRender = getForRender;
    else delete (pipes as Partial<Pipelines>).getForRender;
    r._nodes.nodeFrame.update();
  }
  return frame;
}

/** How a `FrameCompiler` shares the main thread. */
export interface Pacing {
  /** Yields to the event loop. */
  yieldNow: () => Promise<void>;
  /** Yield once this many milliseconds of building have passed (0: after every draw). */
  sliceMs: number;
}

/**
 * Builds the nodes of a captured frame's draws one at a time and creates their pipelines
 * asynchronously, so the page keeps running while shaders compile and the GPU compiles
 * several at once. Mirrors `compileAsync`, minus its node updates: those render the passes a
 * draw depends on (ambient occlusion, reflections), which the capture frame has done, and
 * would do again for every draw.
 *
 * Each build is synchronous, with the draw's own state (see `Draw`) put back for its duration
 * and the renderer's and material's restored after it. Three's asynchronous builds yield
 * midway, and a frame rendered then changes the lights under them: a shader built with the
 * wrong ones stays wrong.
 */
async function compileFrame(
  renderer: Renderer,
  frame: CapturedFrame,
  pacing: Pacing,
  tick: () => void,
): Promise<void> {
  const r = renderer as unknown as Internals;
  const compiled: Promise<unknown>[] = frame.pipelines.map((p) => p.then(tick));
  let slice = performance.now();
  for (const { ro, contextNode, lights, material } of frame.draws) {
    const pending: Promise<unknown>[] = [];
    const outerContext = r.contextNode;
    const outerLights = ro.lightsNode.getLights();
    const outerMaterial = DRAW_STATE.map((k) => ro.material[k]);
    r.contextNode = contextNode;
    ro.lightsNode.setLights(lights);
    DRAW_STATE.forEach((k, i) => {
      ro.material[k] = material[i];
    });
    r._isPreCompiling = true;
    try {
      r._geometries.updateForRender(ro);
      r._nodes.updateForRender(ro);
      r._bindings.updateForRender(ro);
      r._pipelines.getForRender(ro, pending);
    } finally {
      r._isPreCompiling = false;
      DRAW_STATE.forEach((k, i) => {
        ro.material[k] = outerMaterial[i];
      });
      ro.lightsNode.setLights(outerLights);
      r.contextNode = outerContext;
    }
    compiled.push(Promise.all(pending).then(tick));
    if (performance.now() - slice >= pacing.sliceMs) {
      await pacing.yieldNow();
      slice = performance.now();
    }
  }
  await Promise.all(compiled);
}

/** Enough for shadow maps and reflections of reflections; a pipeline that fails stays out. */
const MAX_ROUNDS = 6;

/**
 * Compiles every pipeline a frame needs without stalling on any of them. It works in rounds:
 * render the frame with the missing draws left out (`step`), compile those in the background,
 * repeat until a frame misses nothing. Rounds are needed because some draws only appear once
 * others exist: shadow maps and reflections are rendered by the objects that receive them.
 *
 * Progress counts draws and pipelines compiled over those found so far; a new round can find
 * more, so callers keep the bar from moving back.
 */
export class FrameCompiler {
  private compiling: Promise<void> | null = null;
  private rounds = 0;
  private done = 0;
  private total = 0;
  private finish!: () => void;
  readonly finished: Promise<void> = new Promise((resolve) => {
    this.finish = resolve;
  });
  isFinished = false;

  constructor(
    private readonly renderer: Renderer,
    private readonly pacing: Pacing,
    private readonly onProgress?: (done: number, total: number) => void,
  ) {}

  /**
   * Renders a capture frame with `render`, unless the previous round is still compiling.
   * Anything drawn afterwards in the same task replaces it on screen.
   */
  step(render: () => void): void {
    if (this.isFinished || this.compiling) return;
    const frame = captureFrame(this.renderer, render);
    const found = frame.draws.length + frame.pipelines.length;
    if (found === 0 || ++this.rounds > MAX_ROUNDS) {
      this.isFinished = true;
      this.finish();
      return;
    }
    this.total += found;
    this.onProgress?.(this.done, this.total);
    const tick = () => this.onProgress?.(++this.done, this.total);
    this.compiling = compileFrame(this.renderer, frame, this.pacing, tick).finally(() => {
      this.compiling = null;
    });
  }

  /** Runs rounds back to back (at boot, when nothing else renders). */
  async run(render: () => void): Promise<void> {
    while (!this.isFinished) {
      this.step(render);
      if (this.compiling) await this.compiling;
    }
  }
}
