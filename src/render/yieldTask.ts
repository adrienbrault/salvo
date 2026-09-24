let channel: MessageChannel | null = null;
const waiting: (() => void)[] = [];

/**
 * Yields to the event loop, so long boot work leaves the page alive (the loading screen
 * repaints, input is handled). A message rather than a timer: timers in a background tab are
 * throttled to one a second or slower, which would stall boot for minutes if the player
 * switches tabs while it loads. One channel, held for good: a throwaway MessageChannel can be
 * garbage collected before its message is delivered, and boot then waits forever.
 */
export function yieldTask(): Promise<void> {
  if (!channel) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => waiting.shift()?.();
  }
  const ch = channel;
  return new Promise<void>((r) => {
    waiting.push(r);
    ch.port2.postMessage(0);
  });
}
