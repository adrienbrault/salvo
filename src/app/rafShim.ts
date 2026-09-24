/**
 * Testing aid (`?rafshim`): hidden or occluded windows — automated browsers — never fire
 * requestAnimationFrame, which stalls boot (three's WebGL backend polls pipeline compiles
 * with it) and the game loop. This drives frames from a MessageChannel instead, which runs
 * unthrottled while the page is hidden. See docs/browser-testing.md.
 */
export function installRafShim(): void {
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
}
