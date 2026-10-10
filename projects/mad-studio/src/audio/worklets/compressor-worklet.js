/**
 * Dynamics compressor with a sidechain input, for the mixer's "Sidechain to this track" links. The
 * algorithm is the native engine's port of Chromium's DynamicsCompressorKernel
 * (engine/src/dsp/Compressor.cpp): 6 ms look-ahead, soft knee, adaptive release and automatic makeup
 * gain. Input 0 is the audio, input 1 the sidechain key the detector listens to. Without a sidechain,
 * the app uses the browser's own DynamicsCompressorNode, which runs the same algorithm.
 */
const PI_OVER_TWO = Math.PI / 2;
const PRE_DELAY_SECONDS = 0.006;
const RELEASE_ZONE_1 = 0.09;
const RELEASE_ZONE_2 = 0.16;
const RELEASE_ZONE_3 = 0.42;
const RELEASE_ZONE_4 = 0.98;
const SPACING_DB = 5;
const DIVISION_FRAMES = 32;
const MAX_PRE_DELAY_FRAMES = 1024;
const MAX_PRE_DELAY_MASK = MAX_PRE_DELAY_FRAMES - 1;

const linearToDecibels = (x) => 20 * Math.log10(x);
const decibelsToLinear = (db) => Math.pow(10, 0.05 * db);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const silence = new Float32Array(128);

class MadCompressor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    // DynamicsCompressorNode defaults and nominal ranges.
    return [
      { name: 'threshold', defaultValue: -24, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      { name: 'knee', defaultValue: 30, minValue: 0, maxValue: 40, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 12, minValue: 1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 0.003, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.25, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === 'dispose') this.alive = false;
    };
    this.preDelay = [new Float32Array(MAX_PRE_DELAY_FRAMES), new Float32Array(MAX_PRE_DELAY_FRAMES)];
    this.preDelayReadIndex = 0;
    this.preDelayWriteIndex = 256;
    this.lastPreDelayFrames = 256;
    this.detectorAverage = 0;
    this.compressorGain = 1;
    this.maxAttackCompressionDiffDb = -1;
    // Static curve cache (-1 = uninitialised, like Chromium).
    this.ratioCached = -1;
    this.slope = -1;
    this.linearThreshold = -1;
    this.dbThresholdCached = -1;
    this.dbKneeCached = -1;
    this.kneeThreshold = -1;
    this.kneeThresholdDb = -1;
    this.ykneeThresholdDb = -1;
    this.kneeK = -1;
    // Per-division state.
    this.k = 5;
    this.masterLinearGain = 1;
    this.envelopeRate = 1;
    this.scaledDesiredGain = 1;
    this.satReleaseFrames = 120;
  }

  setPreDelayTime(seconds) {
    let frames = Math.trunc(seconds * sampleRate);
    if (frames > MAX_PRE_DELAY_FRAMES - 1) frames = MAX_PRE_DELAY_FRAMES - 1;
    if (this.lastPreDelayFrames !== frames) {
      this.lastPreDelayFrames = frames;
      this.preDelay[0].fill(0);
      this.preDelay[1].fill(0);
      this.preDelayReadIndex = 0;
      this.preDelayWriteIndex = frames;
    }
  }

  kneeCurve(x, k) {
    if (x < this.linearThreshold) return x;
    return this.linearThreshold + (1 - Math.exp(-k * (x - this.linearThreshold))) / k;
  }

  saturate(x, k) {
    if (x < this.kneeThreshold) return this.kneeCurve(x, k);
    const xDb = linearToDecibels(x);
    const yDb = this.ykneeThresholdDb + this.slope * (xDb - this.kneeThresholdDb);
    return decibelsToLinear(yDb);
  }

  slopeAt(x, k) {
    if (x < this.linearThreshold) return 1;
    const x2 = x * 1.001;
    const xDb = linearToDecibels(x);
    const x2Db = linearToDecibels(x2);
    const yDb = linearToDecibels(this.kneeCurve(x, k));
    const y2Db = linearToDecibels(this.kneeCurve(x2, k));
    return (y2Db - yDb) / (x2Db - xDb);
  }

  kAtSlope(desiredSlope) {
    const xDb = this.dbThresholdCached + this.dbKneeCached;
    const x = decibelsToLinear(xDb);
    let minK = 0.1;
    let maxK = 10000;
    let k = 5;
    for (let i = 0; i < 15; i++) {
      const s = this.slopeAt(x, k);
      if (s < desiredSlope) maxK = k;
      else minK = k;
      k = Math.sqrt(minK * maxK);
    }
    return k;
  }

  updateStaticCurveParameters(dbThreshold, dbKnee, ratio) {
    if (dbThreshold !== this.dbThresholdCached || dbKnee !== this.dbKneeCached || ratio !== this.ratioCached) {
      this.dbThresholdCached = dbThreshold;
      this.linearThreshold = decibelsToLinear(dbThreshold);
      this.dbKneeCached = dbKnee;
      this.ratioCached = ratio;
      this.slope = 1 / ratio;
      const k = this.kAtSlope(1 / ratio);
      this.kneeThresholdDb = dbThreshold + dbKnee;
      this.kneeThreshold = decibelsToLinear(this.kneeThresholdDb);
      this.ykneeThresholdDb = linearToDecibels(this.kneeCurve(this.kneeThreshold, k));
      this.kneeK = k;
    }
    return this.kneeK;
  }

  beginDivision(threshold, knee, ratio, attack, release) {
    threshold = clamp(threshold, -100, 0);
    knee = clamp(knee, 0, 40);
    ratio = clamp(ratio, 1, 20);
    const attackTime = Math.max(0.001, clamp(attack, 0, 1));
    const releaseTime = clamp(release, 0, 1);

    const k = (this.k = this.updateStaticCurveParameters(threshold, knee, ratio));

    // Makeup gain with Chromium's empirical/perceptual tuning.
    const fullRangeGain = this.saturate(1, k);
    this.masterLinearGain = Math.pow(1 / fullRangeGain, 0.6);

    const attackFrames = attackTime * sampleRate;
    const releaseFrames = sampleRate * releaseTime;
    this.satReleaseFrames = 0.0025 * sampleRate;

    const y1 = releaseFrames * RELEASE_ZONE_1;
    const y2 = releaseFrames * RELEASE_ZONE_2;
    const y3 = releaseFrames * RELEASE_ZONE_3;
    const y4 = releaseFrames * RELEASE_ZONE_4;
    const kA = 0.9999999999999998 * y1 + 1.8432219684323923e-16 * y2 - 1.9373394351676423e-16 * y3 + 8.824516011816245e-18 * y4;
    const kB = -1.5788320352845888 * y1 + 2.3305837032074286 * y2 - 0.9141194204840429 * y3 + 0.1623677525612032 * y4;
    const kC = 0.5334142869106424 * y1 - 1.272736789213631 * y2 + 0.9258856042207512 * y3 - 0.18656310191776226 * y4;
    const kD = 0.08783463138207234 * y1 - 0.1694162967925622 * y2 + 0.08588057951595272 * y3 - 0.00429891410546283 * y4;
    const kE = -0.042416883008123074 * y1 + 0.1115693827987602 * y2 - 0.09764676325265872 * y3 + 0.028494263462021576 * y4;

    this.setPreDelayTime(PRE_DELAY_SECONDS);

    if (!Number.isFinite(this.detectorAverage)) this.detectorAverage = 1;

    const desiredGain = this.detectorAverage;
    this.scaledDesiredGain = Math.asin(desiredGain) / PI_OVER_TWO;

    const isReleasing = this.scaledDesiredGain > this.compressorGain;
    let compressionDiffDb = linearToDecibels(this.compressorGain / this.scaledDesiredGain);

    if (isReleasing) {
      this.maxAttackCompressionDiffDb = -1;
      if (!Number.isFinite(compressionDiffDb)) compressionDiffDb = -1;
      let x = clamp(compressionDiffDb, -12, 0);
      x = 0.25 * (x + 12);
      const x2 = x * x;
      const x3 = x2 * x;
      const x4 = x2 * x2;
      const adaptiveReleaseFrames = kA + kB * x + kC * x2 + kD * x3 + kE * x4;
      const dbPerFrame = SPACING_DB / adaptiveReleaseFrames;
      this.envelopeRate = decibelsToLinear(dbPerFrame);
    } else {
      if (!Number.isFinite(compressionDiffDb)) compressionDiffDb = 1;
      if (this.maxAttackCompressionDiffDb === -1 || this.maxAttackCompressionDiffDb < compressionDiffDb) this.maxAttackCompressionDiffDb = compressionDiffDb;
      const effAttenDiffDb = Math.max(0.5, this.maxAttackCompressionDiffDb);
      const x = 0.25 / effAttenDiffDb;
      this.envelopeRate = 1 - Math.pow(x, 1 / attackFrames);
    }
  }

  processFrames(inL, inR, keyL, keyR, outL, outR, offset, n) {
    const delayL = this.preDelay[0];
    const delayR = this.preDelay[1];
    let readIndex = this.preDelayReadIndex;
    let writeIndex = this.preDelayWriteIndex;
    let detector = this.detectorAverage;
    let gain = this.compressorGain;
    const k = this.k;

    for (let j = offset; j < offset + n; j++) {
      delayL[writeIndex] = inL[j];
      delayR[writeIndex] = inR[j];
      const absInput = Math.max(Math.abs(keyL[j]), Math.abs(keyR[j]));

      const shapedInput = this.saturate(absInput, k);
      const attenuation = absInput <= 0.0001 ? 1 : shapedInput / absInput;
      let attenuationDb = -linearToDecibels(attenuation);
      attenuationDb = Math.max(2, attenuationDb);
      const dbPerFrame = attenuationDb / this.satReleaseFrames;
      const satReleaseRate = decibelsToLinear(dbPerFrame) - 1;
      const isRelease = attenuation > detector;
      const rate = isRelease ? satReleaseRate : 1;
      detector += (attenuation - detector) * rate;
      detector = Math.min(1, detector);
      if (!Number.isFinite(detector)) detector = 1;

      if (this.envelopeRate < 1) {
        gain += (this.scaledDesiredGain - gain) * this.envelopeRate;
      } else {
        gain *= this.envelopeRate;
        gain = Math.min(1, gain);
      }

      const postWarpCompressorGain = Math.sin(PI_OVER_TWO * gain);
      const totalGain = this.masterLinearGain * postWarpCompressorGain;

      outL[j] = delayL[readIndex] * totalGain;
      outR[j] = delayR[readIndex] * totalGain;

      readIndex = (readIndex + 1) & MAX_PRE_DELAY_MASK;
      writeIndex = (writeIndex + 1) & MAX_PRE_DELAY_MASK;
    }

    this.preDelayReadIndex = readIndex;
    this.preDelayWriteIndex = writeIndex;
    this.detectorAverage = Math.abs(detector) < 1e-30 ? 0 : detector;
    this.compressorGain = Math.abs(gain) < 1e-30 ? 0 : gain;
  }

  process(inputs, outputs, parameters) {
    if (!this.alive) return false;
    const out = outputs[0];
    const frames = out[0].length;
    const main = inputs[0] ?? [];
    const key = inputs[1] ?? [];
    // Missing channels are silent; a mono input is heard on both sides (Web Audio up-mix).
    const inL = main[0] ?? silence;
    const inR = main[1] ?? inL;
    const keyL = key[0] ?? silence;
    const keyR = key[1] ?? keyL;
    const outL = out[0];
    const outR = out[1] ?? out[0];
    const threshold = parameters.threshold[0];
    const knee = parameters.knee[0];
    const ratio = parameters.ratio[0];
    const attack = parameters.attack[0];
    const release = parameters.release[0];
    for (let offset = 0; offset < frames; offset += DIVISION_FRAMES) {
      this.beginDivision(threshold, knee, ratio, attack, release);
      this.processFrames(inL, inR, keyL, keyR, outL, outR, offset, Math.min(DIVISION_FRAMES, frames - offset));
    }
    return true;
  }
}

registerProcessor('mad-compressor', MadCompressor);
