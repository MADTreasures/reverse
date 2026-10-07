import { useCallback, useEffect, useRef, useState } from 'react';

type FrameCallback = (time: number) => void;

const callbacks = new Set<FrameCallback>();
let running = false;

function frame(time: number): void {
  for (const cb of callbacks) cb(time);
  if (callbacks.size > 0) requestAnimationFrame(frame);
  else running = false;
}

/** Registers a callback on the shared requestAnimationFrame loop. */
export function onFrame(cb: FrameCallback): () => void {
  callbacks.add(cb);
  if (!running) {
    running = true;
    requestAnimationFrame(frame);
  }
  return () => {
    callbacks.delete(cb);
  };
}

/** React hook: runs `cb` every animation frame while mounted (latest closure). */
export function useFrame(cb: FrameCallback, enabled = true): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!enabled) return;
    return onFrame((t) => ref.current(t));
  }, [enabled]);
}

/** Sizes a canvas for the device pixel ratio; returns the 2D context scaled to CSS pixels. */
export function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Observes an element's content size; the callback ref re-attaches when the element (re)mounts. */
export function useElementSize<T extends HTMLElement>(): [(el: T | null) => void, { width: number; height: number }] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      const width = Math.floor(r.width);
      const height = Math.floor(r.height);
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    ro.observe(el);
    observer.current = ro;
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, size];
}
