/** requestAnimationFrame driver; hands real frame time to the game (clamped). */
export class Loop {
  private last = 0;
  private running = false;

  constructor(private readonly tick: (dt: number, frameMs: number) => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    const ms = now - this.last;
    this.last = now;
    // Clamp long frames (tab switch, debugger) so the sim never spirals.
    this.tick(Math.min(ms, 100) / 1000, ms);
    requestAnimationFrame(this.frame);
  };
}
