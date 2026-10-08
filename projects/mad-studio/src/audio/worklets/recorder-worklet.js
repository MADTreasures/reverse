/**
 * Captures the input of an AudioWorkletNode between a start frame and stop, and posts the audio to
 * the main thread in chunks. Runs on the audio rendering thread.
 */
class MadRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.startFrame = Infinity;
    this.stopFrame = Infinity;
    this.channels = 2;
    this.chunk = 8192;
    this.buffers = null;
    this.fill = 0;
    this.done = false;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.cmd === 'start') {
        this.startFrame = Math.round(m.at * sampleRate);
        this.channels = m.channels;
        this.buffers = Array.from({ length: this.channels }, () => new Float32Array(this.chunk));
        this.fill = 0;
      } else if (m.cmd === 'stop') {
        this.stopFrame = currentFrame;
      }
    };
  }

  flush() {
    if (!this.buffers || this.fill === 0) return;
    const out = this.buffers.map((b) => b.slice(0, this.fill));
    this.port.postMessage({ type: 'data', channels: out }, out.map((b) => b.buffer));
    this.fill = 0;
  }

  process(inputs) {
    if (this.done) return false;
    const input = inputs[0];
    const frames = 128;
    const frameEnd = currentFrame + frames;
    if (this.buffers && frameEnd > this.startFrame && currentFrame < this.stopFrame) {
      const from = Math.max(0, this.startFrame - currentFrame);
      const to = Math.min(frames, this.stopFrame - currentFrame);
      for (let i = from; i < to; i++) {
        for (let c = 0; c < this.channels; c++) {
          const src = input && input.length ? input[Math.min(c, input.length - 1)] : null;
          this.buffers[c][this.fill] = src ? src[i] : 0;
        }
        this.fill++;
        if (this.fill === this.chunk) this.flush();
      }
    }
    if (currentFrame >= this.stopFrame) {
      this.flush();
      this.port.postMessage({ type: 'done' });
      this.done = true;
      return false;
    }
    return true;
  }
}

registerProcessor('mad-recorder', MadRecorder);
