/**
 * Drives requestAnimationFrame from a MessageChannel instead of the display, until the
 * returned function restores the real one. Two uses:
 *  - Boot, in browsers without `scheduler.yield()` (Safari): three waits on animation frames
 *    between pipeline compiles, and Safari did not deliver them there — boot never finished.
 *  - Testing (`?rafshim`, for the whole session): hidden or occluded windows — automated
 *    browsers — never fire requestAnimationFrame, which stalls boot and the game loop.
 *    See docs/browser-testing.md.
 */
export function installRafShim(): () => void {
  const raf = window.requestAnimationFrame;
  const caf = window.cancelAnimationFrame;
  const queue = new Map<number, FrameRequestCallback>();
  const channel = new MessageChannel();
  let nextId = 1;
  let scheduled = false;
  channel.port1.onmessage = () => {
    scheduled = false;
    const now = performance.now();
    const batch = [...queue.values()];
    queue.clear();
    for (const cb of batch) cb(now);
  };
  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    queue.set(id, cb);
    if (!scheduled) {
      scheduled = true;
      channel.port2.postMessage(0);
    }
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    queue.delete(id);
  };
  // Callbacks still queued run on the message already posted, then continue on real frames.
  return () => {
    window.requestAnimationFrame = raf;
    window.cancelAnimationFrame = caf;
  };
}
