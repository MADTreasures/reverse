#include "engine/Effects.h"

#include "dsp/ImpulseResponse.h"
#include "plugins/PluginSlot.h"

#include <algorithm>
#include <cmath>

namespace mad
{
namespace
{
constexpr double pi = 3.14159265358979323846;
constexpr double effectTau = 0.015; // effects.ts smooth(): setTargetAtTime(v, now, 0.015)

inline int chunkEnd (const BlockContext& ctx, int c) noexcept { return std::min (ctx.numSamples, (c + 1) * chunkSize); }

/** effects.ts DryWet.setMix(): equal-power crossfade. */
inline void setMix (dsp::OnePole& dry, dsp::OnePole& wet, double mix) noexcept
{
    const double m = std::clamp (mix, 0.0, 1.0);
    dry.setTarget (std::cos (m * pi / 2.0));
    wet.setTarget (std::sin (m * pi / 2.0));
}

juce::ThreadPool& workerPool()
{
    static juce::ThreadPool pool (juce::ThreadPoolOptions{}.withThreadName ("mad-dsp-worker").withNumberOfThreads (1));
    return pool;
}
} // namespace

Effect::Effect (juce::String effectType) : type (std::move (effectType)), spec (findEffectSpec (type))
{
    if (spec != nullptr)
    {
        params = std::vector<AutoParam> (spec->params.size());
        for (size_t i = 0; i < spec->params.size(); ++i)
            params[i].setBase (spec->params[i].def);
    }
}

//==============================================================================
namespace
{
class EqEffect final : public Effect
{
public:
    EqEffect() : Effect ("eq") {}

    void prepare (double rate, int, bool) override
    {
        sampleRate = rate;
        for (auto& s : sm)
            s.prepare (rate, effectTau);
    }

    void process (const BlockContext& ctx, float* left, float* right) noexcept override
    {
        for (int c = 0; c < ctx.numChunks; ++c)
        {
            for (int k = 0; k < 7; ++k)
                sm[(size_t) k].setTarget (param (k, ctx, c));

            std::array<double, 7> v {};
            bool changed = false;
            for (size_t k = 0; k < 7; ++k)
            {
                v[k] = sm[k].current();
                changed = changed || dsp::differs (v[k], last[k]);
            }
            if (changed)
            {
                last = v;
                low = dsp::makeBiquad (dsp::BiquadType::lowshelf, sampleRate, v[1], 1.0, v[0]);
                mid = dsp::makeBiquad (dsp::BiquadType::peaking, sampleRate, v[3], v[4], v[2]);
                high = dsp::makeBiquad (dsp::BiquadType::highshelf, sampleRate, v[6], 1.0, v[5]);
            }

            const int c0 = c * chunkSize, c1 = chunkEnd (ctx, c);
            for (int i = c0; i < c1; ++i)
            {
                left[i] = highL.process (high, midL.process (mid, lowL.process (low, left[i])));
                right[i] = highR.process (high, midR.process (mid, lowR.process (low, right[i])));
            }
            for (auto& s : sm)
                s.skip (c1 - c0);
        }
        for (auto* b : { &lowL, &lowR, &midL, &midR, &highL, &highR })
            b->flushDenormals();
    }

private:
    double sampleRate = 48000.0;
    std::array<dsp::OnePole, 7> sm;
    std::array<double, 7> last { -1, -1, -1, -1, -1, -1, -1 };
    dsp::BiquadCoeffs low, mid, high;
    dsp::BiquadState lowL, lowR, midL, midR, highL, highR;
};

//==============================================================================
class FilterEffect final : public Effect
{
public:
    FilterEffect() : Effect ("filter") {}

    void prepare (double rate, int, bool) override
    {
        sampleRate = rate;
        for (auto* s : { &cutoff, &resonance, &lfoRate, &lfoGain })
            s->prepare (rate, effectTau);
        lfoRate.reset (440.0); // OscillatorNode default frequency, smoothed to lfoRate
        phase = 0.0;
    }

    void process (const BlockContext& ctx, float* left, float* right) noexcept override
    {
        for (int c = 0; c < ctx.numChunks; ++c)
        {
            const int c0 = c * chunkSize, c1 = chunkEnd (ctx, c), len = c1 - c0;
            const int mode = (int) std::lround (param (0, ctx, c));
            const auto filterType = mode == 1 ? dsp::BiquadType::highpass
                                  : mode == 2 ? dsp::BiquadType::bandpass
                                  : mode == 3 ? dsp::BiquadType::notch
                                              : dsp::BiquadType::lowpass;
            cutoff.setTarget (param (1, ctx, c));
            resonance.setTarget (param (2, ctx, c));
            lfoRate.setTarget (param (3, ctx, c));
            lfoGain.setTarget ((double) param (4, ctx, c) * 2400.0);

            // Free-running sine LFO modulating detune; evaluated at the chunk centre.
            const double centrePhase = phase + lfoRate.current() * (double) len * 0.5 / sampleRate;
            const double detune = std::sin (2.0 * pi * centrePhase) * lfoGain.current();
            phase += lfoRate.advanceSum (len) / sampleRate;
            phase -= std::floor (phase);

            const auto coeffs = dsp::makeBiquad (filterType, sampleRate, cutoff.current(), resonance.current(), 0.0, detune);
            for (int i = c0; i < c1; ++i)
            {
                left[i] = stateL.process (coeffs, left[i]);
                right[i] = stateR.process (coeffs, right[i]);
            }
            for (auto* s : { &cutoff, &resonance, &lfoGain })
                s->skip (len);
        }
        stateL.flushDenormals();
        stateR.flushDenormals();
    }

private:
    double sampleRate = 48000.0, phase = 0.0;
    dsp::OnePole cutoff, resonance, lfoRate, lfoGain;
    dsp::BiquadState stateL, stateR;
};

//==============================================================================
class CompressorEffect final : public Effect
{
public:
    CompressorEffect() : Effect ("compressor") {}

    void prepare (double rate, int maxBlock, bool) override
    {
        compressor.prepare (rate);
        for (auto& s : sm)
            s.prepare (rate, effectTau);
        makeup.prepare (rate, effectTau);
        gainBuffer.assign ((size_t) maxBlock, 1.0f);
    }

    void process (const BlockContext& ctx, float* left, float* right) noexcept override
    {
        // k-rate compressor parameters, sampled per chunk; a-rate makeup gain per sample.
        for (int c = 0; c < ctx.numChunks; ++c)
        {
            const int c0 = c * chunkSize, c1 = chunkEnd (ctx, c);
            for (int k = 0; k < 5; ++k)
                sm[(size_t) k].setTarget (param (k, ctx, c));
            chunkParams[(size_t) c] = { (float) sm[0].current(), (float) sm[4].current(), (float) sm[1].current(),
                                        (float) sm[2].current(), (float) sm[3].current() };
            for (auto& s : sm)
                s.skip (c1 - c0);
            makeup.setTarget (dbToGain (param (5, ctx, c)));
            for (int i = c0; i < c1; ++i)
                gainBuffer[(size_t) i] = makeup.next();
        }

        compressor.process (left, right, ctx.numSamples,
                            [&] (int offset) -> const dsp::DynamicsCompressor::Params& {
                                return chunkParams[(size_t) ctx.chunkOf (offset)];
                            });

        for (int i = 0; i < ctx.numSamples; ++i)
        {
            left[i] *= gainBuffer[(size_t) i];
            right[i] *= gainBuffer[(size_t) i];
        }
    }

private:
    dsp::DynamicsCompressor compressor;
    std::array<dsp::OnePole, 5> sm; // threshold, ratio, attack, release, knee
    dsp::OnePole makeup;
    std::array<dsp::DynamicsCompressor::Params, maxChunks> chunkParams {};
    std::vector<float> gainBuffer;
};

//==============================================================================
class DistortionEffect final : public Effect
{
public:
    DistortionEffect() : Effect ("distortion") {}

    void prepare (double rate, int maxBlock, bool) override
    {
        sampleRate = rate;
        shaper.prepare (rate, maxBlock, 2, 2048); // oversample '4x'
        for (auto* s : { &tone, &level, &dry, &wet })
            s->prepare (rate, effectTau);
        wetL.assign ((size_t) maxBlock, 0.0f);
        wetR.assign ((size_t) maxBlock, 0.0f);
        lastDrive = -1.0;
    }

    void process (const BlockContext& ctx, float* left, float* right) noexcept override
    {
        const int n = ctx.numSamples;
        const double drive = std::round ((double) param (0, ctx, 0) * 100.0) / 100.0;
        if (dsp::differs (drive, lastDrive))
        {
            dsp::fillDriveCurve (shaper.curveData(), drive);
            lastDrive = drive;
        }

        std::copy (left, left + n, wetL.begin());
        std::copy (right, right + n, wetR.begin());
        shaper.process (wetL.data(), wetR.data(), n);

        for (int c = 0; c < ctx.numChunks; ++c)
        {
            const int c0 = c * chunkSize, c1 = chunkEnd (ctx, c);
            tone.setTarget (param (1, ctx, c));
            level.setTarget (dbToGain (param (2, ctx, c)));
            setMix (dry, wet, param (3, ctx, c));
            if (dsp::differs (tone.current(), toneFreq))
            {
                toneFreq = tone.current();
                toneCoeffs = dsp::makeBiquad (dsp::BiquadType::lowpass, sampleRate, toneFreq, 1.0, 0.0);
            }
            for (int i = c0; i < c1; ++i)
            {
                const float d = dry.next(), w = wet.next(), g = level.next();
                const float tl = toneL.process (toneCoeffs, wetL[(size_t) i]);
                const float tr = toneR.process (toneCoeffs, wetR[(size_t) i]);
                left[i] = (left[i] * d + tl * w) * g;
                right[i] = (right[i] * d + tr * w) * g;
            }
            tone.skip (c1 - c0);
        }
        toneL.flushDenormals();
        toneR.flushDenormals();
    }

private:
    double sampleRate = 48000.0, lastDrive = -1.0, toneFreq = -1.0;
    dsp::WaveShaper shaper;
    dsp::OnePole tone, level, dry, wet;
    dsp::BiquadCoeffs toneCoeffs;
    dsp::BiquadState toneL, toneR;
    std::vector<float> wetL, wetR;
};

//==============================================================================
class ChorusEffect final : public Effect
{
public:
    ChorusEffect() : Effect ("chorus") {}

    void prepare (double rate, int, bool) override
    {
        sampleRate = rate;
        delayL.prepare ((int) std::ceil (0.1 * rate) + 4);
        delayR.prepare ((int) std::ceil (0.1 * rate) + 4);
        for (auto* s : { &base, &rate_, &depth, &dry, &wet })
            s->prepare (rate, effectTau);
        rate_.reset (440.0); // OscillatorNode default frequency, smoothed to the chorus rate
        phase = 0.0;
    }

    void process (const BlockContext& ctx, float* left, float* right) noexcept override
    {
        for (int c = 0; c < ctx.numChunks; ++c)
        {
            const int c0 = c * chunkSize, c1 = chunkEnd (ctx, c);
            const double baseTarget = (double) param (2, ctx, c) / 1000.0;
            base.setTarget (baseTarget);
            rate_.setTarget (param (0, ctx, c));
            depth.setTarget ((double) param (1, ctx, c) * std::min (baseTarget * 0.9, 0.006));
            setMix (dry, wet, param (3, ctx, c));

            for (int i = c0; i < c1; ++i)
            {
                const double b = base.next();
                const double f = rate_.next();
                const double lfo = std::sin (2.0 * pi * phase);
                phase += f / sampleRate;
                phase -= std::floor (phase);
                const double dep = depth.next();
                const double dl = std::clamp (b + lfo * dep, 0.0, 0.1) * sampleRate;
                const double dr = std::clamp (b - lfo * dep, 0.0, 0.1) * sampleRate;
                const float yl = delayL.process (left[i], dl);
                const float yr = delayR.process (right[i], dr);
                const float d = dry.next(), w = wet.next();
                left[i] = left[i] * d + yl * w;
                right[i] = right[i] * d + yr * w;
            }
        }
    }

private:
    double sampleRate = 48000.0, phase = 0.0;
    dsp::DelayLine delayL, delayR;
    dsp::OnePole base, rate_, depth, dry, wet;
};

//==============================================================================
class DelayEffect final : public Effect
{
public:
    DelayEffect() : Effect ("delay") {}

    void prepare (double rate, int, bool) override
    {
        sampleRate = rate;
        delayL.prepare ((int) std::ceil (5.0 * rate) + 8);
        delayR.prepare ((int) std::ceil (5.0 * rate) + 8);
        for (auto* s : { &time, &tone, &inLL, &inRL, &inRR, &fbLL, &fbRR, &fbLR, &fbRL, &dry, &wet })
            s->prepare (rate, effectTau);
    }

    void process (const BlockContext& ctx, float* left, float* right) noexcept override
    {
        for (int c = 0; c < ctx.numChunks; ++c)
        {
            const int c0 = c * chunkSize, c1 = chunkEnd (ctx, c);
            const int division = (int) std::lround (param (0, ctx, c));
            const double beats = division >= 0 && division < (int) delayDivisionBeats.size()
                                     ? delayDivisionBeats[(size_t) division]
                                     : 0.75;
            const double seconds = std::min (4.9, (beats * 60.0) / std::max (ctx.bpm[(size_t) c], 1.0));
            const double fb = std::clamp ((double) param (1, ctx, c), 0.0, 0.95);
            const bool ping = param (3, ctx, c) >= 0.5f;
            time.setTarget (seconds);
            tone.setTarget (param (2, ctx, c));
            inLL.setTarget (ping ? 0.5 : 1.0);
            inRL.setTarget (ping ? 0.5 : 0.0);
            inRR.setTarget (ping ? 0.0 : 1.0);
            fbLL.setTarget (ping ? 0.0 : fb);
            fbRR.setTarget (ping ? 0.0 : fb);
            fbLR.setTarget (ping ? fb : 0.0);
            fbRL.setTarget (ping ? fb : 0.0);
            setMix (dry, wet, param (4, ctx, c));

            if (dsp::differs (tone.current(), toneFreq))
            {
                toneFreq = tone.current();
                toneCoeffs = dsp::makeBiquad (dsp::BiquadType::lowpass, sampleRate, toneFreq, 1.0, 0.0);
            }

            for (int i = c0; i < c1; ++i)
            {
                // A DelayNode inside a cycle delays by at least one render quantum (128 frames).
                const double d = std::max (128.0, time.next() * sampleRate);
                const float tl = toneL.process (toneCoeffs, delayL.read (d));
                const float tr = toneR.process (toneCoeffs, delayR.read (d));
                const float xl = left[i], xr = right[i];
                delayL.write (inLL.next() * xl + inRL.next() * xr + fbLL.next() * tl + fbRL.next() * tr);
                delayR.write (inRR.next() * xr + fbRR.next() * tr + fbLR.next() * tl);
                const float dg = dry.next(), wg = wet.next();
                left[i] = xl * dg + tl * wg;
                right[i] = xr * dg + tr * wg;
            }
            tone.skip (c1 - c0);
        }
        toneL.flushDenormals();
        toneR.flushDenormals();
    }

private:
    double sampleRate = 48000.0, toneFreq = -1.0;
    dsp::DelayLine delayL, delayR;
    dsp::OnePole time, tone, inLL, inRL, inRR, fbLL, fbRR, fbLR, fbRL, dry, wet;
    dsp::BiquadCoeffs toneCoeffs;
    dsp::BiquadState toneL, toneR;
};

//==============================================================================
class LimiterEffect final : public Effect
{
public:
    LimiterEffect() : Effect ("limiter") {}

    void prepare (double rate, int maxBlock, bool) override
    {
        compressor.prepare (rate);
        shaper.prepare (rate, maxBlock, 1, 4096); // oversample '2x'
        for (auto* s : { &inputGain, &threshold, &release })
            s->prepare (rate, effectTau);
        lastCeiling = 1.0e9;
    }

    void process (const BlockContext& ctx, float* left, float* right) noexcept override
    {
        const int n = ctx.numSamples;
        const double ceilingDb = std::round ((double) param (1, ctx, 0) * 100.0) / 100.0;
        if (dsp::differs (ceilingDb, lastCeiling))
        {
            dsp::fillClipperCurve (shaper.curveData(), dbToGain (ceilingDb));
            lastCeiling = ceilingDb;
        }

        for (int c = 0; c < ctx.numChunks; ++c)
        {
            const int c0 = c * chunkSize, c1 = chunkEnd (ctx, c);
            inputGain.setTarget (dbToGain (param (0, ctx, c)));
            threshold.setTarget ((double) param (1, ctx, c) - 3.0);
            release.setTarget (param (2, ctx, c));
            chunkParams[(size_t) c] = { (float) threshold.current(), 0.0f, 20.0f, 0.001f, (float) release.current() };
            threshold.skip (c1 - c0);
            release.skip (c1 - c0);
            for (int i = c0; i < c1; ++i)
            {
                const float g = inputGain.next();
                left[i] *= g;
                right[i] *= g;
            }
        }

        compressor.process (left, right, n, [&] (int offset) -> const dsp::DynamicsCompressor::Params& {
            return chunkParams[(size_t) ctx.chunkOf (offset)];
        });

        // pre-gain 0.5 maps +-2 onto the shaper's +-1 domain; the curve covers +-2.
        for (int i = 0; i < n; ++i)
        {
            left[i] *= 0.5f;
            right[i] *= 0.5f;
        }
        shaper.process (left, right, n);
    }

private:
    dsp::DynamicsCompressor compressor;
    dsp::WaveShaper shaper;
    dsp::OnePole inputGain, threshold, release;
    std::array<dsp::DynamicsCompressor::Params, maxChunks> chunkParams {};
    double lastCeiling = 1.0e9;
};
} // namespace

//==============================================================================
ReverbEffect::ReverbEffect() : Effect ("reverb") {}

ReverbEffect::~ReverbEffect()
{
    juce::AudioBuffer<float>* b = nullptr;
    while (returned.pop (b))
        delete b;
}

std::unique_ptr<juce::AudioBuffer<float>> ReverbEffect::buildImpulse (double rate, double decay, double damping)
{
    auto ir = dsp::makeImpulseResponse (rate, decay, damping, 1);
    const double scale = dsp::convolverNormalisationScale (ir[0], ir[1], rate);
    auto buffer = std::make_unique<juce::AudioBuffer<float>> (2, (int) ir[0].size());
    for (int ch = 0; ch < 2; ++ch)
    {
        float* d = buffer->getWritePointer (ch);
        const auto& src = ir[(size_t) ch];
        for (size_t i = 0; i < src.size(); ++i)
            d[i] = (float) ((double) src[i] * scale);
    }
    return buffer;
}

namespace
{
int irKey (double decay, double damping)
{
    const auto d = (int) std::lround (std::clamp (decay, 0.01, 100.0) * 100.0);
    const auto m = (int) std::lround (std::clamp (damping, 0.0, 1.0) * 100.0);
    return d * 128 + m;
}
double keyDecay (int key) { return (double) (key / 128) / 100.0; }
double keyDamping (int key) { return (double) (key % 128) / 100.0; }
} // namespace

void ReverbEffect::prepare (double rate, int maxBlock, bool offline)
{
    sampleRate = rate;
    maxBlockSize = maxBlock;
    offlineMode = offline;
    preL.prepare ((int) std::ceil (1.0 * rate) + 4);
    preR.prepare ((int) std::ceil (1.0 * rate) + 4);
    for (auto* s : { &predelay, &lowCut, &dry, &wet })
        s->prepare (rate, effectTau);
    wetL.assign ((size_t) maxBlock, 0.0f);
    wetR.assign ((size_t) maxBlock, 0.0f);

    // First IR immediately (effects.ts builds the first one synchronously as well).
    const int key = irKey (std::round (baseParam (0) * 100.0) / 100.0, std::round (baseParam (2) * 100.0) / 100.0);
    auto ir = buildImpulse (rate, keyDecay (key), keyDamping (key));
    convolution.loadImpulseResponse (std::move (*ir), rate, juce::dsp::Convolution::Stereo::yes,
                                     juce::dsp::Convolution::Trim::no, juce::dsp::Convolution::Normalise::no);
    convolution.prepare ({ rate, (juce::uint32) maxBlock, 2 });
    builtKey = key;
    pendingKey = key;
    wantedKey.store (key);
}

void ReverbEffect::installImpulse (std::unique_ptr<juce::AudioBuffer<float>> ir) noexcept
{
    convolution.loadImpulseResponse (std::move (*ir), sampleRate, juce::dsp::Convolution::Stereo::yes,
                                     juce::dsp::Convolution::Trim::no, juce::dsp::Convolution::Normalise::no);
}

void ReverbEffect::service()
{
    juce::AudioBuffer<float>* done = nullptr;
    while (returned.pop (done))
        delete done;

    const int key = wantedKey.load();
    const double now = juce::Time::getMillisecondCounterHiRes() * 0.001;
    if (key < 0 || key == builtKey)
    {
        pendingKey = builtKey;
        return;
    }
    if (key != pendingKey)
    {
        pendingKey = key;
        pendingSince = now;
        return;
    }
    // Debounce knob drags like effects.ts (120 ms).
    if (now - pendingSince < 0.12 || irState->building.load())
        return;

    builtKey = key;
    irState->building.store (true);
    auto state = irState;
    const double rate = sampleRate;
    workerPool().addJob ([state, rate, key]
    {
        auto ir = buildImpulse (rate, keyDecay (key), keyDamping (key));
        delete state->mailbox.exchange (ir.release());
        state->building.store (false);
    });
}

void ReverbEffect::process (const BlockContext& ctx, float* left, float* right) noexcept
{
    const int n = ctx.numSamples;

    const double decay = std::round ((double) param (0, ctx, 0) * 100.0) / 100.0;
    const double damping = std::round ((double) param (2, ctx, 0) * 100.0) / 100.0;
    const int key = irKey (decay, damping);
    wantedKey.store (key);
    if (offlineMode && key != builtKey)
    {
        // Offline renders rebuild synchronously so the result is deterministic.
        builtKey = key;
        installImpulse (buildImpulse (sampleRate, keyDecay (key), keyDamping (key)));
        convolution.prepare ({ sampleRate, (juce::uint32) maxBlockSize, 2 });
    }
    else if (auto* ir = irState->mailbox.exchange (nullptr))
    {
        convolution.loadImpulseResponse (std::move (*ir), sampleRate, juce::dsp::Convolution::Stereo::yes,
                                         juce::dsp::Convolution::Trim::no, juce::dsp::Convolution::Normalise::no);
        if (! returned.push (ir))
            juce::ignoreUnused (ir); // leak a moved-from buffer rather than free on the audio thread
    }

    // wet = predelay -> convolver -> highpass(lowCut, Q 1).
    for (int c = 0; c < ctx.numChunks; ++c)
    {
        const int c0 = c * chunkSize, c1 = chunkEnd (ctx, c);
        predelay.setTarget (param (1, ctx, c));
        for (int i = c0; i < c1; ++i)
        {
            const double d = std::clamp (predelay.next() * sampleRate, 0.0, sampleRate);
            wetL[(size_t) i] = preL.process (left[i], d);
            wetR[(size_t) i] = preR.process (right[i], d);
        }
    }

    float* channels[] = { wetL.data(), wetR.data() };
    juce::dsp::AudioBlock<float> block (channels, 2, (size_t) n);
    convolution.process (juce::dsp::ProcessContextReplacing<float> (block));

    for (int c = 0; c < ctx.numChunks; ++c)
    {
        const int c0 = c * chunkSize, c1 = chunkEnd (ctx, c);
        lowCut.setTarget (param (3, ctx, c));
        setMix (dry, wet, param (4, ctx, c));
        if (dsp::differs (lowCut.current(), hpFreq))
        {
            hpFreq = lowCut.current();
            hpCoeffs = dsp::makeBiquad (dsp::BiquadType::highpass, sampleRate, hpFreq, 1.0, 0.0);
        }
        for (int i = c0; i < c1; ++i)
        {
            const float wl = hpL.process (hpCoeffs, wetL[(size_t) i]);
            const float wr = hpR.process (hpCoeffs, wetR[(size_t) i]);
            const float dg = dry.next(), wg = wet.next();
            left[i] = left[i] * dg + wl * wg;
            right[i] = right[i] * dg + wr * wg;
        }
        lowCut.skip (c1 - c0);
    }
    hpL.flushDenormals();
    hpR.flushDenormals();
}

//==============================================================================
PluginEffect::PluginEffect (std::shared_ptr<PluginSlot> s, bool isExclusive)
    : Effect ("plugin"), slot (std::move (s)), exclusive (isExclusive)
{
}

PluginEffect::~PluginEffect() = default;

void PluginEffect::prepare (double, int maxBlock, bool)
{
    // A juce::AudioBuffer referring to existing channels only avoids a heap allocation
    // for fewer than 32 channels (its preallocated pointer space), so stay below that.
    buffer.setSize (30, maxBlock);
    midi.ensureSize (256);
}

void PluginEffect::process (const BlockContext& ctx, float* left, float* right) noexcept
{
    const int n = ctx.numSamples;
    auto* plugin = exclusive ? slot->exclusiveInstance() : slot->acquire();
    if (plugin == nullptr)
        return; // still loading / borrowed: pass audio through
    const auto releaseSlot = [this] { if (! exclusive) slot->release(); };

    const int numIn = plugin->getTotalNumInputChannels();
    const int numOut = plugin->getTotalNumOutputChannels();
    const int channels = std::max ({ numIn, numOut, 2 });
    if (channels > buffer.getNumChannels() || n > buffer.getNumSamples())
    {
        releaseSlot();
        return;
    }

    juce::AudioBuffer<float> view (buffer.getArrayOfWritePointers(), channels, n);
    view.clear();
    if (numIn == 1)
    {
        float* d = view.getWritePointer (0);
        for (int i = 0; i < n; ++i)
            d[i] = 0.5f * (left[i] + right[i]);
    }
    else if (numIn >= 2)
    {
        view.copyFrom (0, 0, left, n);
        view.copyFrom (1, 0, right, n);
    }

    plugin->processBlock (view, midi);
    releaseSlot();
    midi.clear();

    const auto safe = [] (float v) { return std::isfinite (v) ? v : 0.0f; };
    if (numOut >= 2)
    {
        const float* l = view.getReadPointer (0);
        const float* r = view.getReadPointer (1);
        for (int i = 0; i < n; ++i)
        {
            left[i] = safe (l[i]);
            right[i] = safe (r[i]);
        }
    }
    else if (numOut == 1)
    {
        const float* m = view.getReadPointer (0);
        for (int i = 0; i < n; ++i)
            left[i] = right[i] = safe (m[i]);
    }
}

//==============================================================================
std::unique_ptr<Effect> createInternalEffect (const juce::String& type)
{
    if (type == "eq")         return std::make_unique<EqEffect>();
    if (type == "filter")     return std::make_unique<FilterEffect>();
    if (type == "compressor") return std::make_unique<CompressorEffect>();
    if (type == "distortion") return std::make_unique<DistortionEffect>();
    if (type == "chorus")     return std::make_unique<ChorusEffect>();
    if (type == "delay")      return std::make_unique<DelayEffect>();
    if (type == "reverb")     return std::make_unique<ReverbEffect>();
    if (type == "limiter")    return std::make_unique<LimiterEffect>();
    return nullptr;
}

} // namespace mad
