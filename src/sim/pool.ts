/**
 * Allocation-free entity pool. Active entities are kept contiguous in `items`
 * (swap-remove on release) so renderers can iterate them directly.
 */
export class Pool<T> {
  readonly items: T[] = [];
  private readonly free: T[] = [];

  constructor(private readonly create: () => T) {}

  get size(): number {
    return this.items.length;
  }

  /** Returns a recycled (dirty) or new object; the caller must initialise every field. */
  spawn(): T {
    const it = this.free.pop() ?? this.create();
    this.items.push(it);
    return it;
  }

  /** Release the entity at index `i`. Iterate backwards when releasing during a loop. */
  releaseAt(i: number): void {
    const items = this.items;
    const last = items.length - 1;
    const it = items[i]!;
    if (i !== last) items[i] = items[last]!;
    items.pop();
    this.free.push(it);
  }

  clear(): void {
    for (const it of this.items) this.free.push(it);
    this.items.length = 0;
  }
}
