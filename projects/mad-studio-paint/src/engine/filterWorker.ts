/**
 * Runs Filter menu filters off the main thread: the dialog sends the layer once, then the settings
 * of every preview; each result comes back as the pixels of the changed rectangle.
 */
import { runFilter, type FilterContext, type FilterId, type FilterValues, type Img, type Rect } from '../paint/filters';

export type FilterRequest =
  | { type: 'source'; buffer: ArrayBuffer; width: number; height: number }
  | { type: 'run'; token: number; id: FilterId; values: FilterValues; rect: Rect; ctx: FilterContext };

export interface FilterResponse {
  token: number;
  buffer: ArrayBuffer | null;
  error?: string;
}

let source: Img | null = null;
const port = self as unknown as Worker;

port.onmessage = (e: MessageEvent<FilterRequest>) => {
  const m = e.data;
  if (m.type === 'source') {
    source = { data: new Uint8ClampedArray(m.buffer), width: m.width, height: m.height };
    return;
  }
  if (!source) {
    port.postMessage({ token: m.token, buffer: null, error: 'no layer' } satisfies FilterResponse);
    return;
  }
  try {
    const out = runFilter(m.id, source, m.values, m.rect, m.ctx);
    const buffer = out.data.buffer as ArrayBuffer;
    port.postMessage({ token: m.token, buffer } satisfies FilterResponse, [buffer]);
  } catch (err) {
    port.postMessage({ token: m.token, buffer: null, error: String(err) } satisfies FilterResponse);
  }
};
