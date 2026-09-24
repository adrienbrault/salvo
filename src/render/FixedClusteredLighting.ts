import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import ClusteredLightsNode from 'three/addons/tsl/lighting/ClusteredLightsNode.js';
import { clamp, Fn, float, int, log, min, positionView, screenUV, vec2 } from 'three/tsl';
import type { Light, Node, UniformNode } from 'three/webgpu';

/** Screen tiles of the cluster grid, fixed whatever the canvas size or aspect. */
const GRID_X = 48;
const GRID_Y = 48;

/** The internals of three's `ClusteredLightsNode` (r186) that this subclass reaches into. */
interface Internals {
  create(width: number, height: number): void;
  _bufferSize: unknown;
  _screenClusterIndex: Node;
  _cameraNear: UniformNode<'float', number>;
  _cameraFar: UniformNode<'float', number>;
}

/**
 * three's clustered lights size their grid from the drawing buffer (32-px tiles) and bake the
 * tile counts into every lit shader, so each canvas resize (window, rotation, pixel ratio)
 * rebuilt ~40 pipelines: seconds of freeze. And a fragment found its tile in render-target
 * pixels while the grid was laid out over the canvas, so any pass rendered at another size (a
 * resolution-scaled scene pass, the sea's reflection) looked up the wrong tiles.
 *
 * Here the grid is a fixed number of tiles, laid out over whatever target is being rendered: a
 * fragment finds its tile from `screenUV`. Shaders never depend on the size again.
 */
class FixedClusteredLightsNode extends ClusteredLightsNode {
  updateProgram(): void {
    const self = this as unknown as Internals;
    if (self._bufferSize === null) this.create(GRID_X * this.tileSize, GRID_Y * this.tileSize);
  }

  create(width: number, height: number): void {
    const self = this as unknown as Internals;
    (ClusteredLightsNode.prototype as unknown as Internals).create.call(this, width, height);
    const nz = this.zSlices;
    // three's cluster index, with the screen tile taken from screenUV instead of pixels.
    self._screenClusterIndex = Fn(() => {
      const tile = min(screenUV.mul(vec2(GRID_X, GRID_Y)).floor(), vec2(GRID_X - 1, GRID_Y - 1));
      const invLogFarOverNear = float(1).div(log(self._cameraFar.div(self._cameraNear)));
      const slice = log(positionView.z.negate().div(self._cameraNear)).mul(invLogFarOverNear).mul(nz);
      const z = clamp(slice.floor(), 0, nz - 1);
      return int(tile.x)
        .add(int(tile.y).mul(GRID_X))
        .add(int(z).mul(GRID_X * GRID_Y));
    })().toVar();
  }
}

/** `ClusteredLighting` on a fixed cluster grid: see `FixedClusteredLightsNode`. */
export class FixedClusteredLighting extends ClusteredLighting {
  override createNode(lights: Light[] = []): ClusteredLightsNode {
    return new FixedClusteredLightsNode(
      this.maxLights,
      this.tileSize,
      this.zSlices,
      this.maxLightsPerCluster,
    ).setLights(lights) as ClusteredLightsNode;
  }
}
