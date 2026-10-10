/**
 * AudioWorklet processors of the mixer (the sidechain compressor). They are loaded into every
 * context before its graph is built; without them (old browsers) the effects fall back to the
 * browser's built-in nodes.
 */
import compressorUrl from './worklets/compressor-worklet.js?url';

const ready = new WeakSet<BaseAudioContext>();
const loading = new WeakMap<BaseAudioContext, Promise<void>>();

/** Loads the processors into `ctx` once; never rejects. */
export function loadWorklets(ctx: BaseAudioContext): Promise<void> {
  let p = loading.get(ctx);
  if (!p) {
    p = ctx.audioWorklet
      ? ctx.audioWorklet.addModule(compressorUrl).then(
          () => void ready.add(ctx),
          (e: unknown) => console.warn('MAD Studio: sidechain compressor unavailable', e),
        )
      : Promise.resolve();
    loading.set(ctx, p);
  }
  return p;
}

export function workletsReady(ctx: BaseAudioContext): boolean {
  return ready.has(ctx);
}
