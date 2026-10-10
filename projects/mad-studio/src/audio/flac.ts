/**
 * FLAC encoder for the export (both engines; the native engine can also write FLAC itself). Fixed
 * block size, one subframe per channel (constant, fixed predictor of order 0–4 or verbatim, whichever
 * is smallest), Rice-coded residuals with partitions and escape codes. Lossless: decoding gives back
 * exactly the quantized samples (16 bit with the same TPDF dither as the WAV export, or 24 bit).
 */

const BLOCK_SIZE = 4096;
const MAX_PARTITION_ORDER = 6;

export class BitWriter {
  private buf = new Uint8Array(1 << 16);
  private pos = 0;
  private acc = 0;
  private nbits = 0;

  private ensure(extra: number): void {
    if (this.pos + extra < this.buf.length) return;
    let size = this.buf.length * 2;
    while (size <= this.pos + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }

  /** Writes the low `bits` bits of a non-negative `value` (bits <= 32). */
  write(value: number, bits: number): void {
    this.ensure(8);
    while (bits > 0) {
      const take = Math.min(bits, 24);
      bits -= take;
      const chunk = Math.floor(value / 2 ** bits) % 2 ** take;
      this.acc = this.acc * 2 ** take + chunk;
      this.nbits += take;
      while (this.nbits >= 8) {
        this.nbits -= 8;
        this.buf[this.pos++] = Math.floor(this.acc / 2 ** this.nbits) & 0xff;
      }
      this.acc %= 2 ** this.nbits;
    }
  }

  /** Two's complement in `bits` bits. */
  writeSigned(value: number, bits: number): void {
    this.write(value < 0 ? value + 2 ** bits : value, bits);
  }

  /** `q` zero bits followed by a one. */
  writeUnary(q: number): void {
    while (q >= 24) {
      this.write(0, 24);
      q -= 24;
    }
    this.write(1, q + 1);
  }

  alignZero(): void {
    if (this.nbits > 0) this.write(0, 8 - this.nbits);
  }

  get bytePosition(): number {
    return this.pos;
  }

  bytes(from: number, to = this.pos): Uint8Array {
    return this.buf.subarray(from, to);
  }

  finish(): Uint8Array {
    this.alignZero();
    return this.buf.slice(0, this.pos);
  }
}

const CRC8 = new Uint8Array(256);
const CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  CRC8[i] = c;
  let d = i << 8;
  for (let k = 0; k < 8; k++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff;
  CRC16[i] = d;
}

export function crc8(data: Uint8Array): number {
  let c = 0;
  for (const b of data) c = CRC8[c ^ b];
  return c;
}

export function crc16(data: Uint8Array): number {
  let c = 0;
  for (const b of data) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ b];
  return c;
}

/** FLAC's UTF-8-like coding of the frame number (up to 36 bits). */
export function writeFrameNumber(w: BitWriter, n: number): void {
  if (n < 0x80) {
    w.write(n, 8);
    return;
  }
  let cont = 1; // continuation bytes; the first byte carries 6 - cont payload bits
  while (n >= 2 ** (5 * cont + 6)) cont++;
  const prefix = (0xff << (7 - cont)) & 0xff;
  w.write(prefix | Math.floor(n / 2 ** (6 * cont)), 8);
  for (let i = cont - 1; i >= 0; i--) w.write(0x80 | (Math.floor(n / 2 ** (6 * i)) & 0x3f), 8);
}

/** Bits a signed value needs in two's complement. */
function signedBits(maxAbs: number): number {
  let bits = 1;
  while (2 ** (bits - 1) <= maxAbs) bits++;
  return bits;
}

interface PartitionPlan {
  params: number[]; // Rice parameter per partition, 15 = escape
  escapeBits: number[];
  cost: number;
}

/** Best Rice coding of `residual` (starting at `order`) for a partition order. */
function planPartitions(residual: Int32Array, order: number, n: number, porder: number): PartitionPlan | null {
  const parts = 1 << porder;
  const size = n >> porder;
  if (size <= order || size << porder !== n) return null;
  const params: number[] = [];
  const escapeBits: number[] = [];
  let cost = 0;
  for (let p = 0; p < parts; p++) {
    const start = p === 0 ? order : p * size;
    const end = (p + 1) * size;
    const count = end - start;
    let sum = 0;
    let maxAbs = 0;
    for (let i = start; i < end; i++) {
      const r = residual[i];
      sum += r >= 0 ? 2 * r : -2 * r - 1;
      maxAbs = Math.max(maxAbs, Math.abs(r));
    }
    const mean = count > 0 ? sum / count : 0;
    let guess = mean > 1 ? Math.floor(Math.log2(mean)) : 0;
    guess = Math.min(14, Math.max(0, guess));
    let best = Infinity;
    let bestK = 0;
    for (let k = Math.max(0, guess - 1); k <= Math.min(14, guess + 1); k++) {
      let bits = 4 + count * (k + 1);
      for (let i = start; i < end; i++) {
        const r = residual[i];
        const u = r >= 0 ? 2 * r : -2 * r - 1;
        bits += Math.floor(u / 2 ** k);
      }
      if (bits < best) {
        best = bits;
        bestK = k;
      }
    }
    const escBits = maxAbs === 0 ? 0 : signedBits(maxAbs);
    const escCost = 4 + 5 + count * escBits;
    if (escCost < best) {
      params.push(15);
      escapeBits.push(escBits);
      cost += escCost;
    } else {
      params.push(bestK);
      escapeBits.push(0);
      cost += best;
    }
  }
  return { params, escapeBits, cost };
}

/** FIXED predictor residual of the given order (warm-up samples stay as they are). */
function fixedResidual(x: Int32Array, order: number, out: Int32Array): void {
  const n = x.length;
  for (let i = 0; i < Math.min(order, n); i++) out[i] = x[i];
  for (let i = order; i < n; i++) {
    switch (order) {
      case 0:
        out[i] = x[i];
        break;
      case 1:
        out[i] = x[i] - x[i - 1];
        break;
      case 2:
        out[i] = x[i] - 2 * x[i - 1] + x[i - 2];
        break;
      case 3:
        out[i] = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3];
        break;
      default:
        out[i] = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
    }
  }
}

function writeSubframe(w: BitWriter, x: Int32Array, bps: number): void {
  const n = x.length;
  if (x.every((v) => v === x[0])) {
    w.write(0, 1);
    w.write(0b000000, 6);
    w.write(0, 1);
    w.writeSigned(x[0], bps);
    return;
  }
  let best: { order: number; plan: PartitionPlan; porder: number; residual: Int32Array } | null = null;
  let bestCost = n * bps; // verbatim
  const residual = new Int32Array(n);
  for (let order = 0; order <= 4 && order < n; order++) {
    fixedResidual(x, order, residual);
    for (let porder = 0; porder <= MAX_PARTITION_ORDER; porder++) {
      const plan = planPartitions(residual, order, n, porder);
      if (!plan) continue;
      const cost = order * bps + 6 + plan.cost;
      if (cost < bestCost) {
        bestCost = cost;
        best = { order, plan, porder, residual: residual.slice() };
      }
    }
  }
  w.write(0, 1);
  if (!best) {
    w.write(0b000001, 6);
    w.write(0, 1);
    for (let i = 0; i < n; i++) w.writeSigned(x[i], bps);
    return;
  }
  const { order, plan, porder, residual: r } = best;
  w.write(0b001000 | order, 6);
  w.write(0, 1);
  for (let i = 0; i < order; i++) w.writeSigned(x[i], bps);
  w.write(0, 2); // Rice, 4-bit parameters
  w.write(porder, 4);
  const size = n >> porder;
  for (let p = 0; p < plan.params.length; p++) {
    const start = p === 0 ? order : p * size;
    const end = (p + 1) * size;
    const k = plan.params[p];
    w.write(k, 4);
    if (k === 15) {
      const bits = plan.escapeBits[p];
      w.write(bits, 5);
      if (bits > 0) for (let i = start; i < end; i++) w.writeSigned(r[i], bits);
      continue;
    }
    for (let i = start; i < end; i++) {
      const v = r[i];
      const u = v >= 0 ? 2 * v : -2 * v - 1;
      w.writeUnary(Math.floor(u / 2 ** k));
      if (k > 0) w.write(u % 2 ** k, k);
    }
  }
}

/** Quantizes like the WAV export: 16 bit with TPDF dither, 24 bit rounded. */
export function quantize(channels: Float32Array[], bitDepth: 16 | 24): Int32Array[] {
  let seed = 22222;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const frames = channels[0]?.length ?? 0;
  const out = channels.map(() => new Int32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels.length; c++) {
      const x = channels[c][i];
      const s = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
      if (bitDepth === 16) {
        const dither = (rand() - rand()) / 32768;
        out[c][i] = Math.round(Math.max(-1, Math.min(1, s + dither)) * 32767);
      } else {
        out[c][i] = Math.round(s * 8388607);
      }
    }
  }
  return out;
}

/** Encodes integer samples (one array per channel, 1..8 channels) as a FLAC stream. */
export function encodeFlacSamples(samples: Int32Array[], sampleRate: number, bitDepth: 16 | 24): Uint8Array {
  const channels = samples.length;
  const total = samples[0]?.length ?? 0;
  const w = new BitWriter();
  for (const ch of 'fLaC') w.write(ch.charCodeAt(0), 8);
  // STREAMINFO (the last metadata block).
  w.write(1, 1);
  w.write(0, 7);
  w.write(34, 24);
  const block = Math.max(16, Math.min(BLOCK_SIZE, total || 16));
  w.write(block, 16);
  w.write(block, 16);
  w.write(0, 24); // min frame size: unknown
  w.write(0, 24); // max frame size: unknown
  w.write(sampleRate, 20);
  w.write(channels - 1, 3);
  w.write(bitDepth - 1, 5);
  w.write(Math.floor(total / 2 ** 32), 4);
  w.write(total % 2 ** 32, 32);
  for (let i = 0; i < 4; i++) w.write(0, 32); // MD5: not computed

  for (let frame = 0, start = 0; start < total; frame++, start += BLOCK_SIZE) {
    const n = Math.min(BLOCK_SIZE, total - start);
    const begin = w.bytePosition;
    w.write(0x3ffe, 14);
    w.write(0, 1);
    w.write(0, 1); // fixed block size
    w.write(0b0111, 4); // block size - 1 follows as 16 bits
    w.write(0b0000, 4); // sample rate from STREAMINFO
    w.write(channels - 1, 4); // independent channels
    w.write(bitDepth === 16 ? 0b100 : 0b110, 3);
    w.write(0, 1);
    writeFrameNumber(w, frame);
    w.write(n - 1, 16);
    w.write(crc8(w.bytes(begin)), 8);
    for (let c = 0; c < channels; c++) writeSubframe(w, samples[c].subarray(start, start + n), bitDepth);
    w.alignZero();
    w.write(crc16(w.bytes(begin)), 16);
  }
  return w.finish();
}

/** Float channels → FLAC (16 or 24 bit). */
export function encodeFlac(channels: Float32Array[], sampleRate: number, bitDepth: 16 | 24): Uint8Array {
  return encodeFlacSamples(quantize(channels, bitDepth), sampleRate, bitDepth);
}
