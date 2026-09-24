import type { GameRenderer } from '../render/GameRenderer';

/**
 * Diagnostic overlay (`?fps`): frame rate, average and worst frame time over the last half
 * second, plus what the renderer is doing about it (tier, canvas size, dynamic resolution).
 * Returns the per-frame hook to call with each frame's duration.
 */
export function fpsMeter(gr: GameRenderer): (frameMs: number) => void {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:99;padding:4px 8px;font:12px/1.4 ui-monospace,monospace;color:#cfe;background:#000a;border-radius:4px;pointer-events:none;white-space:pre';
  document.body.appendChild(el);
  let frames = 0;
  let sum = 0;
  let worst = 0;
  let since = performance.now();
  return (ms) => {
    frames++;
    sum += ms;
    worst = Math.max(worst, ms);
    const now = performance.now();
    if (now - since < 500) return;
    const canvas = gr.renderer.domElement;
    el.textContent =
      `${Math.round((frames * 1000) / (now - since))} fps  ${(sum / frames).toFixed(1)} ms  worst ${worst.toFixed(1)}\n` +
      `${gr.quality.tier} ${gr.isWebGPU ? 'WebGPU' : 'WebGL2'}  ${canvas.width}×${canvas.height}  res ${gr.resolutionScale.toFixed(2)}`;
    frames = 0;
    sum = 0;
    worst = 0;
    since = now;
  };
}
