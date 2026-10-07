/**
 * Steady tick source for the scheduler. A Worker keeps ticking when the window
 * is in the background (browsers throttle main-thread timers there).
 */
export class Ticker {
  private worker: Worker | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly onTick: () => void,
    private readonly periodMs = 20,
  ) {}

  start(): void {
    this.stop();
    try {
      const code = `let id=null;onmessage=e=>{if(e.data==='start'){clearInterval(id);id=setInterval(()=>postMessage(0),${this.periodMs});}else{clearInterval(id);id=null;}};`;
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      this.worker.onmessage = () => this.onTick();
      this.worker.postMessage('start');
    } catch {
      this.worker = null;
      this.interval = setInterval(this.onTick, this.periodMs);
    }
  }

  stop(): void {
    if (this.worker) {
      this.worker.postMessage('stop');
      this.worker.terminate();
      this.worker = null;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
