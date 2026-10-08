/** Generic bounded undo/redo stack. Entries are opaque; `sizeOf` lets the stack cap memory. Pure, unit tested. */

export interface HistoryOptions<T> {
  maxEntries: number;
  maxBytes: number;
  sizeOf: (entry: T) => number;
  /** Called for entries that fall off either end (to release memory or GPU resources). */
  onDrop?: (entry: T) => void;
}

export class HistoryStack<T> {
  private past: T[] = [];
  private future: T[] = [];
  private bytes = 0;

  constructor(private opts: HistoryOptions<T>) {}

  /** Changes the maximum number of steps (drops the oldest ones if needed). */
  setMaxEntries(n: number): void {
    this.opts = { ...this.opts, maxEntries: Math.max(1, Math.round(n)) };
    while (this.past.length > 1 && this.past.length > this.opts.maxEntries) this.drop(this.past.shift()!);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoCount(): number {
    return this.past.length;
  }

  get redoCount(): number {
    return this.future.length;
  }

  get totalBytes(): number {
    return this.bytes;
  }

  /** Last undoable entry, without removing it. */
  peek(): T | undefined {
    return this.past[this.past.length - 1];
  }

  push(entry: T): void {
    for (const e of this.future) this.drop(e);
    this.future = [];
    this.past.push(entry);
    this.bytes += this.opts.sizeOf(entry);
    // Always keep the newest entry, even if it alone exceeds the byte budget.
    while (this.past.length > 1 && (this.past.length > this.opts.maxEntries || this.bytes > this.opts.maxBytes)) {
      this.drop(this.past.shift()!);
    }
  }

  /** Returns the entry to revert, moving it to the redo side. */
  undo(): T | undefined {
    const e = this.past.pop();
    if (e !== undefined) this.future.push(e);
    return e;
  }

  /** Returns the entry to re-apply, moving it back to the undo side. */
  redo(): T | undefined {
    const e = this.future.pop();
    if (e !== undefined) this.past.push(e);
    return e;
  }

  clear(): void {
    for (const e of [...this.past, ...this.future]) this.drop(e);
    this.past = [];
    this.future = [];
  }

  /** All entries still held (both directions). */
  entries(): T[] {
    return [...this.past, ...this.future];
  }

  private drop(e: T): void {
    this.bytes -= this.opts.sizeOf(e);
    this.opts.onDrop?.(e);
  }
}
