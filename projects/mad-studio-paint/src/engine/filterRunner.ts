/**
 * Computes filters for a dialog: in a worker when the platform allows (the dialog stays
 * responsive), else on the main thread. Only the newest request matters: older ones still
 * running are answered with null once a newer one was made.
 */
import { runFilter, type FilterContext, type FilterId, type FilterValues, type Img, type Rect } from '../paint/filters';
import type { FilterRequest, FilterResponse } from './filterWorker';

export interface FilterJob {
  id: FilterId;
  values: FilterValues;
  rect: Rect;
  ctx: FilterContext;
}

export class FilterRunner {
  private worker: Worker | null = null;
  private token = 0;
  private running: { token: number; job: FilterJob; resolve: (img: Img | null) => void } | null = null;
  private queued: { token: number; job: FilterJob; resolve: (img: Img | null) => void } | null = null;

  constructor(private readonly source: Img) {
    try {
      const worker = new Worker(new URL('./filterWorker.ts', import.meta.url), { type: 'module' });
      const copy = source.data.slice().buffer as ArrayBuffer;
      worker.postMessage({ type: 'source', buffer: copy, width: source.width, height: source.height } satisfies FilterRequest, [copy]);
      worker.onmessage = (e: MessageEvent<FilterResponse>) => this.finished(e.data);
      // A worker that cannot start (or fails) hands its work back to the main thread.
      worker.onerror = (e) => {
        e.preventDefault();
        this.dropWorker();
      };
      this.worker = worker;
    } catch {
      this.worker = null;
    }
  }

  /** Resolves with the filtered pixels of `job.rect`, or null if a newer request replaced it. */
  run(job: FilterJob): Promise<Img | null> {
    return new Promise((resolve) => {
      const entry = { token: ++this.token, job, resolve };
      if (this.queued) this.queued.resolve(null);
      this.queued = entry;
      if (!this.running) this.next();
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.queued?.resolve(null);
    this.running?.resolve(null);
    this.queued = this.running = null;
  }

  private next(): void {
    const entry = this.queued;
    this.queued = null;
    this.running = entry;
    if (!entry) return;
    const { job } = entry;
    if (this.worker) {
      this.worker.postMessage({ type: 'run', token: entry.token, id: job.id, values: job.values, rect: job.rect, ctx: job.ctx } satisfies FilterRequest);
      return;
    }
    // Main thread: let the dialog paint first.
    setTimeout(() => {
      if (this.running !== entry) return;
      let img: Img | null = null;
      try {
        img = runFilter(job.id, this.source, job.values, job.rect, job.ctx);
      } catch {
        img = null;
      }
      this.complete(entry, img);
    }, 0);
  }

  private finished(r: FilterResponse): void {
    const entry = this.running;
    if (!entry || entry.token !== r.token) return;
    if (!r.buffer) {
      // The worker could not compute it: do it here.
      this.dropWorker();
      return;
    }
    this.complete(entry, { data: new Uint8ClampedArray(r.buffer), width: entry.job.rect.w, height: entry.job.rect.h });
  }

  private complete(entry: { token: number; resolve: (img: Img | null) => void }, img: Img | null): void {
    this.running = null;
    // Superseded while it ran: the newer request is what counts.
    entry.resolve(this.queued ? null : img);
    this.next();
  }

  private dropWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    const entry = this.running;
    if (entry) {
      // Run it again on the main thread.
      this.running = null;
      if (!this.queued) this.queued = entry;
      else entry.resolve(null);
      this.next();
    }
  }
}
