type SchedulerHost = { scheduler?: { yield?: () => Promise<void> } };

/**
 * three compiles pipelines one object at a time and yields between them with
 * `scheduler.yield()`, or with requestAnimationFrame where that is missing (Safari) — and
 * Safari did not deliver those frames while booting, so it never got past "Compiling
 * shaders…". Where it is missing, this provides a `scheduler.yield()` that yields through a
 * message instead, until the returned function removes it. requestAnimationFrame itself is
 * left alone: three's own frame loop runs on it.
 */
export function provideSchedulerYield(): () => void {
  const host = globalThis as SchedulerHost;
  if (typeof host.scheduler?.yield === 'function') return () => {};
  const previous = host.scheduler;
  const channel = new MessageChannel();
  const waiting: (() => void)[] = [];
  channel.port1.onmessage = () => waiting.shift()?.();
  host.scheduler = {
    ...previous,
    yield: () =>
      new Promise<void>((resolve) => {
        waiting.push(resolve);
        channel.port2.postMessage(0);
      }),
  };
  return () => {
    host.scheduler = previous;
    channel.port1.close();
  };
}
