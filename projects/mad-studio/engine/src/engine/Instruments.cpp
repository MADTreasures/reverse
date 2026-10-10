#include "engine/Instruments.h"

#include "plugins/PluginSlot.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace mad
{
namespace
{
constexpr double twoPi = 6.28318530717958647692;
constexpr double inf = std::numeric_limits<double>::infinity();

inline int frameIndex (double absoluteTime, int64_t blockStart) noexcept
{
    // First frame at or after the given absolute time, relative to the block.
    const double rel = std::ceil (absoluteTime - 1.0e-9) - (double) blockStart;
    if (rel <= 0.0)
        return 0;
    return rel >= (double) maxBlockSize * 4.0 ? maxBlockSize * 4 : (int) rel;
}

inline void clear (float* d, int n) noexcept { std::fill (d, d + n, 0.0f); }

dsp::EnvelopeParams envelopeFrom (const std::array<AutoParam, synth::numParams>& p, int first, const BlockContext& ctx, int chunk)
{
    return { p[(size_t) first].value (ctx, chunk), p[(size_t) first + 1].value (ctx, chunk),
             p[(size_t) first + 2].value (ctx, chunk), p[(size_t) first + 3].value (ctx, chunk) };
}
} // namespace

//==============================================================================
SynthInstrument::SynthInstrument()
{
    for (int i = 0; i < synth::numParams; ++i)
        params[(size_t) i].setBase (synth::defaultValue (i));
}

void SynthInstrument::prepare (double rate, int maxBlock)
{
    sampleRate = rate;
    for (auto* s : { &lfoRate, &lfoPitchGain, &lfoFilterGain, &lfoAmpGain, &outputGain })
        s->prepare (rate, 0.01);
    // An OscillatorNode starts at its default 440 Hz and is smoothed to the LFO rate
    // (synth.ts update()); emulating that keeps the LFO phase identical to the browser.
    lfoRate.reset (440.0);
    lfoPhase = 0.0;
    for (auto* b : { &lfoBuffer, &ampGainBuffer, &outBuffer, &monoBuffer, &stereoL, &stereoR, &pannedL, &pannedR })
        b->assign ((size_t) maxBlock, 0.0f);
    anyPanned = false;
    noise = &dsp::noiseBuffer (rate);
    for (auto& v : voices)
        v.active = false;
}

bool SynthInstrument::isIdle() const noexcept
{
    for (const auto& v : voices)
        if (v.active)
            return false;
    return true;
}

bool SynthInstrument::pannedOutput (const float*& left, const float*& right) const noexcept
{
    left = pannedL.data();
    right = pannedR.data();
    return anyPanned;
}

int SynthInstrument::activeVoiceCount() const noexcept
{
    int n = 0;
    for (const auto& v : voices)
        n += v.active ? 1 : 0;
    return n;
}

void SynthInstrument::handleEvent (const NoteEvent& e, const BlockContext& ctx)
{
    if (e.kind == NoteEvent::Kind::noteOn)
    {
        startVoice (e, ctx);
        return;
    }

    // Live note-off (voice.ts Voice.release): only open voices are released.
    for (auto& v : voices)
    {
        if (! v.active || v.handle != e.handle || e.handle == 0 || v.endTime < inf)
            continue;
        const double rel = std::max (0.0, (e.time - v.startTime) / sampleRate);
        const double end = v.amp.releaseAt (rel);
        v.filterEnv.releaseAt (rel);
        v.endTime = v.startTime + std::max (rel, end) * sampleRate;
        v.stopTime = v.endTime + 0.005 * sampleRate;
        v.handle = 0;
    }
}

void SynthInstrument::kill (Voice& v, double atTime) noexcept
{
    // voice.ts Voice.kill(): fade from the held value, silent 18 ms later, sources stop +5 ms.
    if (! v.active || atTime >= v.endTime || v.killed)
        return;
    const double t = std::max (atTime, v.startTime);
    const double end = v.amp.killAt ((t - v.startTime) / sampleRate);
    v.endTime = v.startTime + end * sampleRate;
    v.stopTime = v.endTime + 0.005 * sampleRate;
    v.killed = true;
}

void SynthInstrument::killAll (const BlockContext& ctx, int offset)
{
    const double at = (double) (ctx.blockStart + offset);
    for (auto& v : voices)
        kill (v, at);
}

void SynthInstrument::enforcePolyphony (double atTime) noexcept
{
    // voice.ts enforcePolyphony(): alive = not ended and endTime > at; kill the oldest.
    const int limit = voiceLimit.load (std::memory_order_relaxed);
    const int most = limit > 0 ? std::min (limit, maxVoices) : maxVoices;
    int alive = 0;
    for (const auto& v : voices)
        alive += (v.active && v.endTime > atTime) ? 1 : 0;

    while (alive > most)
    {
        Voice* oldest = nullptr;
        for (auto& v : voices)
            if (v.active && v.endTime > atTime && ! v.killed && (oldest == nullptr || v.serial < oldest->serial))
                oldest = &v;
        if (oldest == nullptr)
            break;
        kill (*oldest, atTime);
        --alive;
    }
}

void SynthInstrument::startVoice (const NoteEvent& e, const BlockContext& ctx)
{
    const int c = ctx.chunkOf (e.offset);
    const auto P = [&] (int i) { return (double) params[(size_t) i].value (ctx, c); };

    Voice* v = nullptr;
    for (auto& candidate : voices)
        if (! candidate.active)
        {
            v = &candidate;
            break;
        }
    if (v == nullptr)
    {
        // Pool exhausted (only with many fading voices): reuse the oldest.
        v = &voices[0];
        for (auto& candidate : voices)
            if (candidate.serial < v->serial)
                v = &candidate;
    }

    v->numSubs = 0;
    v->subStereo = false;
    const double noteFine = e.props.fine;
    for (int o = 0; o < 3; ++o)
    {
        const double level = P (synth::osc (o, synth::level));
        if (level <= 0.0001)
            continue;
        const int count = std::clamp ((int) std::lround (P (synth::osc (o, synth::unison))), 1, 7);
        const auto wave = dsp::waveFromIndex ((int) std::lround (P (synth::osc (o, synth::wave))));
        const double coarse = P (synth::osc (o, synth::coarse));
        const double fine = P (synth::osc (o, synth::fine));
        const double detune = P (synth::osc (o, synth::detune));
        const double oscPan = P (synth::osc (o, synth::pan));
        const double hz = midiToHz ((double) e.key + coarse);

        for (int u = 0; u < count && v->numSubs < maxSubs; ++u)
        {
            auto& s = v->subs[(size_t) v->numSubs++];
            const double spread = count > 1 ? ((double) u / (double) (count - 1)) * 2.0 - 1.0 : 0.0;
            const double pan = std::clamp (oscPan + spread * 0.6, -1.0, 1.0);
            s.wave = wave;
            s.level = (float) (level / std::sqrt ((double) count));
            s.scale = (float) dsp::chromeWaveScale (wave, sampleRate);
            s.panned = std::abs (pan) > 0.001;
            s.gains = dsp::monoPanGains (pan);
            v->subStereo = v->subStereo || s.panned;
            // Slightly staggered starts decorrelate unison phases (synth.ts: u * 0.7 ms).
            s.startTime = e.time + (double) u * 0.0007 * sampleRate;
            s.started = false;
            s.osc.reset (0.0);
            s.increment = hz * std::exp2 ((fine + spread * detune + noteFine) / 1200.0) / sampleRate;
            s.noisePos = std::fmod ((double) u * 0.37 + (double) e.key * 0.013, 1.9) * sampleRate;
        }
    }
    if (v->numSubs == 0)
        return;

    const int lfoTarget = (int) std::lround (P (synth::lfoTarget));
    const double depth = P (synth::lfoDepth);
    v->filterOn = P (synth::filterEnabled) >= 0.5;
    v->filterType = dsp::biquadTypeFromIndex (std::clamp ((int) std::lround (P (synth::filterType)), 0, 3));
    v->filterL.reset();
    v->filterR.reset();
    v->linkPitch = lfoTarget == 1;
    v->linkFilter = v->filterOn && lfoTarget == 2;
    v->tremolo = lfoTarget == 3 && depth > 0.0;
    v->tremBase = (float) (1.0 - std::min (1.0, depth) * 0.5);

    // Note properties.
    v->pitch.build (e);
    v->modX = notes::modXFactor (e.props.modX);
    v->modY = e.props.modY;
    const double notePan = std::clamp ((double) e.props.pan, -1.0, 1.0);
    v->notePanned = std::abs (notePan) > notes::panEpsilon;
    v->notePan = notePan;
    v->noteGains = v->subStereo ? dsp::stereoPanGains (notePan) : dsp::monoPanGains (notePan);
    v->stereo = v->subStereo && ! v->notePanned; // panned voices go to the panned output

    v->active = true;
    v->killed = false;
    v->serial = nextSerial++;
    v->key = e.key;
    v->handle = e.lengthSeconds < 0.0 ? e.handle : 0;
    v->startTime = e.time;

    const double firstSampleTime = ((double) (ctx.blockStart + e.offset) - e.time) / sampleRate;
    const double peak = std::clamp ((double) e.velocity, 0.0, 1.0);
    const double relScale = notes::releaseScale (e.props.release);
    auto ampEnv = envelopeFrom (params, synth::ampAttack, ctx, c);
    auto filterEnvParams = envelopeFrom (params, synth::filterAttack, ctx, c);
    ampEnv.release *= relScale;
    filterEnvParams.release *= relScale;
    v->amp.start (ampEnv, 0.0, peak, sampleRate, firstSampleTime);
    v->filterEnv.start (filterEnvParams, 0.0, 1.0, sampleRate, firstSampleTime);

    if (e.lengthSeconds >= 0.0)
    {
        const double end = v->amp.releaseAt (e.lengthSeconds);
        v->filterEnv.releaseAt (e.lengthSeconds);
        v->endTime = e.time + end * sampleRate;
        v->stopTime = v->endTime + 0.01 * sampleRate;
    }
    else
    {
        v->endTime = v->stopTime = inf;
    }

    enforcePolyphony (e.time);
}

void SynthInstrument::renderVoice (Voice& v, const BlockContext& ctx, float* mono, float* left, float* right, float* pannedLeft,
                                   float* pannedRight) noexcept
{
    const int n = ctx.numSamples;
    const int first = frameIndex (v.startTime, ctx.blockStart);
    const int last = v.stopTime < inf ? std::min (n, frameIndex (v.stopTime, ctx.blockStart)) : n;
    const double sr = sampleRate;
    const auto& noiseData = *noise;
    const auto noiseLen = (double) noiseData.size();

    for (int c = first / chunkSize; c * chunkSize < last; ++c)
    {
        const int c0 = std::max (first, c * chunkSize);
        const int c1 = std::min (last, (c + 1) * chunkSize);
        if (c0 >= c1)
            continue;

        double pitchMul = v.linkPitch ? std::exp2 ((double) chunkLfoPitch[(size_t) c] / 1200.0) : 1.0;
        if (v.pitch.active())
        {
            // Portamento / slide notes (synth.ts: a ConstantSourceNode on every oscillator's detune).
            const double centreTime = ((double) (ctx.blockStart + (c0 + c1) / 2) - v.startTime) / sr;
            pitchMul *= std::exp2 (v.pitch.at (centreTime) / 12.0);
        }

        if (v.filterOn)
        {
            const double centre = (double) (ctx.blockStart + (c0 + c1) / 2) - v.startTime;
            const double envCents = (double) params[synth::envAmount].value (ctx, c) * 7200.0
                                    * v.filterEnv.curveValue (centre / sr);
            const double lfoCents = v.linkFilter ? (double) chunkLfoFilter[(size_t) c] : 0.0;
            const double keyTrack = std::exp2 (((double) v.key - 60.0) / 12.0 * (double) params[synth::keyTrack].value (ctx, c));
            const double f0 = std::clamp ((double) params[synth::cutoff].value (ctx, c) * keyTrack * v.modX, 20.0, 20000.0);
            v.coeffs = dsp::makeBiquad (v.filterType, sr, f0, notes::resonance (params[synth::resonance].value (ctx, c), v.modY),
                                        0.0, envCents + lfoCents);
        }

        for (int i = c0; i < c1; ++i)
        {
            const double frameTime = (double) (ctx.blockStart + i);
            float m = 0.0f, l = 0.0f, r = 0.0f;

            for (int k = 0; k < v.numSubs; ++k)
            {
                auto& s = v.subs[(size_t) k];
                if (frameTime < s.startTime)
                    continue;
                if (! s.started)
                {
                    s.started = true;
                    const double late = frameTime - s.startTime; // sub-sample start offset
                    s.osc.reset (std::fmod (late * s.increment, 1.0));
                    s.noisePos += late;
                }

                float x;
                if (s.wave == dsp::Wave::noise)
                {
                    double pos = s.noisePos;
                    if (pos >= noiseLen)
                        pos = std::fmod (pos, noiseLen);
                    const auto i0 = (size_t) pos;
                    const auto i1 = (i0 + 1) % noiseData.size();
                    const double frac = pos - (double) i0;
                    x = (float) (noiseData[i0] + (noiseData[i1] - noiseData[i0]) * frac);
                    s.noisePos = pos + 1.0;
                }
                else
                {
                    x = s.osc.next (s.wave, s.increment * pitchMul) * s.scale;
                }
                x *= s.level;
                if (s.panned)
                {
                    l += x * s.gains.left;
                    r += x * s.gains.right;
                }
                else
                {
                    m += x;
                }
            }

            const float env = v.amp.next() * (v.tremolo ? v.tremBase + ampGainBuffer[(size_t) i] : 1.0f);
            if (v.subStereo)
            {
                l += m; // mono parts are up-mixed without attenuation
                r += m;
                if (v.filterOn)
                {
                    l = v.filterL.process (v.coeffs, l);
                    r = v.filterR.process (v.coeffs, r);
                }
                if (v.notePanned)
                {
                    float pl, pr;
                    dsp::stereoPan (v.notePan, v.noteGains, l * env, r * env, pl, pr);
                    pannedLeft[i] += pl;
                    pannedRight[i] += pr;
                }
                else
                {
                    left[i] += l * env;
                    right[i] += r * env;
                }
            }
            else
            {
                if (v.filterOn)
                    m = v.filterL.process (v.coeffs, m);
                if (v.notePanned)
                {
                    const float x = m * env;
                    pannedLeft[i] += x * v.noteGains.left;
                    pannedRight[i] += x * v.noteGains.right;
                }
                else
                {
                    mono[i] += m * env;
                }
            }
        }
    }

    v.filterL.flushDenormals();
    v.filterR.flushDenormals();
    if (v.stopTime < inf && v.stopTime <= (double) (ctx.blockStart + n))
        v.active = false;
}

bool SynthInstrument::render (const BlockContext& ctx, float* left, float* right)
{
    const int n = ctx.numSamples;
    const bool idle = isIdle();

    // Instrument-wide LFO (free running sine) and the smoothed live parameters.
    for (int c = 0; c < ctx.numChunks; ++c)
    {
        const int c0 = c * chunkSize;
        const int c1 = std::min (n, c0 + chunkSize);
        const double depth = std::clamp ((double) params[synth::lfoDepth].value (ctx, c), 0.0, 1.0);
        const int target = (int) std::lround (params[synth::lfoTarget].value (ctx, c));
        lfoRate.setTarget (std::max (0.01, (double) params[synth::lfoRate].value (ctx, c)));
        lfoPitchGain.setTarget (target == 1 ? depth * 200.0 : 0.0);
        lfoFilterGain.setTarget (target == 2 ? depth * 3600.0 : 0.0);
        lfoAmpGain.setTarget (target == 3 ? depth * 0.5 : 0.0);
        outputGain.setTarget (params[synth::gain].value (ctx, c));

        if (idle)
        {
            lfoPhase += lfoRate.advanceSum (c1 - c0) / sampleRate;
            lfoPhase -= std::floor (lfoPhase);
            for (auto* s : { &lfoPitchGain, &lfoFilterGain, &lfoAmpGain, &outputGain })
                s->skip (c1 - c0);
            continue;
        }

        const int centre = c0 + (c1 - c0) / 2;
        for (int i = c0; i < c1; ++i)
        {
            const double f = lfoRate.next();
            const auto lfo = (float) std::sin (twoPi * lfoPhase);
            lfoPhase += f / sampleRate;
            lfoPhase -= std::floor (lfoPhase);
            lfoBuffer[(size_t) i] = lfo;
            ampGainBuffer[(size_t) i] = lfo * lfoAmpGain.next();
            const float pitchGain = lfoPitchGain.next();
            const float filterGain = lfoFilterGain.next();
            if (i == centre)
            {
                chunkLfoPitch[(size_t) c] = lfo * pitchGain;
                chunkLfoFilter[(size_t) c] = lfo * filterGain;
            }
            outBuffer[(size_t) i] = outputGain.next();
        }
    }

    clear (left, n);
    anyPanned = false;
    if (idle)
        return false;

    float* mono = monoBuffer.data();
    float* sl = stereoL.data();
    float* sr = stereoR.data();
    float* pl = pannedL.data();
    float* pr = pannedR.data();
    clear (mono, n);

    bool anyStereo = false;
    for (auto& v : voices)
    {
        anyStereo = anyStereo || (v.active && v.stereo);
        anyPanned = anyPanned || (v.active && v.notePanned);
    }
    if (anyStereo)
    {
        clear (sl, n);
        clear (sr, n);
    }
    if (anyPanned)
    {
        clear (pl, n);
        clear (pr, n);
    }

    for (auto& v : voices)
        if (v.active)
            renderVoice (v, ctx, mono, sl, sr, pl, pr);

    const float* g = outBuffer.data();
    if (anyPanned)
    {
        for (int i = 0; i < n; ++i)
        {
            pl[i] *= g[i];
            pr[i] *= g[i];
        }
    }
    if (anyStereo)
    {
        for (int i = 0; i < n; ++i)
        {
            left[i] = (mono[i] + sl[i]) * g[i];
            right[i] = (mono[i] + sr[i]) * g[i];
        }
    }
    else
    {
        for (int i = 0; i < n; ++i)
            left[i] = mono[i] * g[i];
    }
    return anyStereo;
}

//==============================================================================
SamplerInstrument::SamplerInstrument (uint32_t channelUid) : uid (channelUid)
{
    for (int i = 0; i < sampler::numParams; ++i)
        params[(size_t) i].setBase (sampler::defaultValue (i));
}

SamplerInstrument::~SamplerInstrument()
{
    for (auto& v : voices)
        if (v.active)
            finish (v);
}

void SamplerInstrument::prepare (double rate, int maxBlock)
{
    sampleRate = rate;
    outputGain.prepare (rate, 0.01);
    for (auto* b : { &outBuffer, &pannedL, &pannedR })
        b->assign ((size_t) maxBlock, 0.0f);
    anyPanned = false;
}

bool SamplerInstrument::pannedOutput (const float*& left, const float*& right) const noexcept
{
    left = pannedL.data();
    right = pannedR.data();
    return anyPanned;
}

bool SamplerInstrument::isIdle() const noexcept
{
    for (const auto& v : voices)
        if (v.active)
            return false;
    return true;
}

void SamplerInstrument::finish (Voice& v) noexcept
{
    if (v.sample != nullptr)
        v.sample->pins.fetch_sub (1);
    v.sample = nullptr;
    v.active = false;
}

void SamplerInstrument::kill (Voice& v, double atTime) noexcept
{
    if (! v.active || atTime >= v.endTime || v.killed)
        return;
    const double t = std::max (atTime, v.startTime);
    const double end = v.env.killAt ((t - v.startTime) / sampleRate);
    v.endTime = v.startTime + end * sampleRate;
    v.stopTime = v.endTime + 0.005 * sampleRate;
    v.killed = true;
}

void SamplerInstrument::killAll (const BlockContext& ctx, int offset)
{
    const double at = (double) (ctx.blockStart + offset);
    for (auto& v : voices)
        kill (v, at);
}

const SampleData* SamplerInstrument::sampleFor (const NoteEvent& e, bool reverse) const noexcept
{
    if (e.sampleOverride)
        return reverse ? e.sampleReversed : e.sample;
    return reverse ? reversed.load() : forward.load();
}

void SamplerInstrument::collectChokes (const NoteEvent& e, const BlockContext& ctx, ChokeList& out) const noexcept
{
    if (e.kind != NoteEvent::Kind::noteOn)
        return;
    const int c = ctx.chunkOf (e.offset);
    const auto* sample = sampleFor (e, params[sampler::reverse].value (ctx, c) >= 0.5f);
    if (sample == nullptr || sample->numFrames <= 0)
        return;
    const double duration = sample->durationSeconds();
    const double startSec = std::clamp ((double) params[sampler::start].value (ctx, c), 0.0, 0.999) * duration;
    if (startSec + std::max (0.0, e.clipOffsetSeconds) >= duration)
        return;

    const int group = (int) std::lround (params[sampler::chokeGroup].value (ctx, c));
    if (group > 0)
        out.add (group, e.time);
    if (params[sampler::cutSelf].value (ctx, c) >= 0.5f)
        out.add (-(int) uid, e.time);
}

void SamplerInstrument::applyChokes (const ChokeList& chokes, const BlockContext&)
{
    for (int i = 0; i < chokes.size; ++i)
    {
        const auto& req = chokes.items[(size_t) i];
        for (auto& v : voices)
        {
            if (! v.active || v.startTime >= req.time)
                continue;
            const bool match = req.group > 0 ? v.chokeGroup == req.group : (v.cutSelf && -req.group == (int) uid);
            if (match)
                kill (v, req.time);
        }
    }
}

void SamplerInstrument::handleEvent (const NoteEvent& e, const BlockContext& ctx)
{
    if (e.kind == NoteEvent::Kind::noteOff)
    {
        for (auto& v : voices)
        {
            if (! v.active || v.handle != e.handle || e.handle == 0)
                continue;
            v.handle = 0;
            // One-shots play out. (sampler.ts never releases gated non-looping live notes because
            // their end time is already the sample's natural end; releasing them is intended.)
            if (! v.gated || v.killed || v.env.isReleased())
                continue;
            const double rel = std::max (0.0, (e.time - v.startTime) / sampleRate);
            const double envEnd = v.env.releaseAt (rel);
            const double end = std::min (v.naturalEnd, v.startTime + envEnd * sampleRate);
            v.endTime = std::max (e.time, end);
            v.stopTime = v.endTime + 0.005 * sampleRate;
        }
        return;
    }

    const int c = ctx.chunkOf (e.offset);
    const auto P = [&] (int i) { return (double) params[(size_t) i].value (ctx, c); };
    const auto* sample = sampleFor (e, P (sampler::reverse) >= 0.5);
    if (sample == nullptr || sample->numFrames <= 0)
        return;

    const double rate = (P (sampler::keyTrack) >= 0.5 ? std::pow (2.0, ((double) e.key - P (sampler::rootKey)) / 12.0) : 1.0)
                        * std::pow (2.0, P (sampler::fine) / 1200.0);
    const double duration = sample->durationSeconds();
    const double startSec = std::clamp (P (sampler::start), 0.0, 0.999) * duration;
    const double offsetSec = startSec + std::max (0.0, e.clipOffsetSeconds);
    if (offsetSec >= duration || ! (rate > 0.0))
        return;
    // Note fine pitch and the pitch curve detune the playback (sampler.ts: src.detune); the end is
    // estimated at the lowest pitch reached so a bent note is never cut short.
    notes::PitchCurve curve;
    curve.build (e);
    const double fineRate = rate * std::exp2 ((double) e.props.fine / 1200.0);
    const double slowest = fineRate * std::exp2 (curve.minimum() / 12.0);

    Voice* v = nullptr;
    for (auto& candidate : voices)
        if (! candidate.active)
        {
            v = &candidate;
            break;
        }
    if (v == nullptr)
    {
        v = &voices[0];
        for (auto& candidate : voices)
            if (candidate.serial < v->serial)
                v = &candidate;
        finish (*v);
    }

    const bool loop = P (sampler::loop) >= 0.5;
    const bool gated = P (sampler::oneShot) < 0.5 || loop || e.audioClip;
    const double peak = std::clamp ((double) e.velocity, 0.0, 1.0);
    const dsp::EnvelopeParams env { P (sampler::ampAttack), P (sampler::ampDecay), P (sampler::ampSustain),
                                    P (sampler::ampRelease) * notes::releaseScale (e.props.release) };
    const double firstSampleTime = ((double) (ctx.blockStart + e.offset) - e.time) / sampleRate;
    const double naturalRel = loop ? inf : (duration - offsetSec) / slowest;

    double endRel = naturalRel;
    if (gated)
    {
        v->env.start (env, 0.0, peak, sampleRate, firstSampleTime);
        if (e.lengthSeconds >= 0.0)
            endRel = std::min (naturalRel, v->env.releaseAt (e.lengthSeconds));
    }
    else
    {
        // setValueAtTime(0, t); linearRampToValueAtTime(peak, t + max(attack, 1 ms)); then hold.
        v->env.start ({ env.attack, 1.0, 1.0, 0.004 }, 0.0, peak, sampleRate, firstSampleTime, 0.001);
    }

    sample->pins.fetch_add (1);
    v->active = true;
    v->killed = false;
    v->serial = nextSerial++;
    v->key = e.key;
    v->handle = e.lengthSeconds < 0.0 ? e.handle : 0;
    v->sample = sample;
    v->gated = gated;
    v->loop = loop;
    v->startTime = e.time;
    v->naturalEnd = e.time + naturalRel * sampleRate;
    v->endTime = e.time + endRel * sampleRate;
    v->stopTime = endRel < inf ? v->endTime + 0.01 * sampleRate : inf;
    const double startRate = fineRate * std::exp2 (curve.at (0.0) / 12.0);
    v->readPos = offsetSec * sample->sampleRate + firstSampleTime * startRate * sample->sampleRate;
    v->baseIncrement = fineRate * sample->sampleRate / sampleRate;
    v->increment = startRate * sample->sampleRate / sampleRate;
    v->pitch = curve;
    const double notePan = std::clamp ((double) e.props.pan, -1.0, 1.0);
    v->notePanned = std::abs (notePan) > notes::panEpsilon;
    v->notePan = notePan;
    v->noteGains = sample->numChannels > 1 ? dsp::stereoPanGains (notePan) : dsp::monoPanGains (notePan);
    v->loopStart = startSec * sample->sampleRate;
    v->loopEnd = (double) sample->numFrames;
    v->clip = e.clip;
    v->clipDuration = std::max (0.0, e.lengthSeconds);
    v->chokeGroup = std::max (0, (int) std::lround (P (sampler::chokeGroup)));
    v->cutSelf = P (sampler::cutSelf) >= 0.5;

    // voice.ts enforcePolyphony(voices, 32 or the channel's limit, t).
    const int limit = voiceLimit.load (std::memory_order_relaxed);
    const int most = limit > 0 ? std::min (limit, maxVoices) : maxVoices;
    int alive = 0;
    for (const auto& x : voices)
        alive += (x.active && x.endTime > e.time) ? 1 : 0;
    while (alive > most)
    {
        Voice* oldest = nullptr;
        for (auto& x : voices)
            if (x.active && x.endTime > e.time && ! x.killed && (oldest == nullptr || x.serial < oldest->serial))
                oldest = &x;
        if (oldest == nullptr)
            break;
        kill (*oldest, e.time);
        --alive;
    }
}

bool SamplerInstrument::render (const BlockContext& ctx, float* left, float* right)
{
    const int n = ctx.numSamples;
    for (int c = 0; c < ctx.numChunks; ++c)
    {
        outputGain.setTarget (params[sampler::gain].value (ctx, c));
        const int c0 = c * chunkSize;
        const int c1 = std::min (n, c0 + chunkSize);
        for (int i = c0; i < c1; ++i)
            outBuffer[(size_t) i] = outputGain.next();
    }

    clear (left, n);
    bool stereo = false;
    anyPanned = false;
    for (const auto& v : voices)
    {
        if (! v.active || v.sample == nullptr)
            continue;
        if (v.notePanned)
            anyPanned = true;
        else
            stereo = stereo || v.sample->numChannels > 1;
    }
    if (stereo)
        clear (right, n);
    float* pl = pannedL.data();
    float* pr = pannedR.data();
    if (anyPanned)
    {
        clear (pl, n);
        clear (pr, n);
    }

    for (auto& v : voices)
    {
        if (! v.active)
            continue;
        const auto& s = *v.sample;
        const double frames = (double) s.numFrames;
        const float* d0 = s.channel (0);
        const float* d1 = s.channel (1);
        const bool twoChannels = s.numChannels > 1;
        const int first = frameIndex (v.startTime, ctx.blockStart);
        const int last = v.stopTime < inf ? std::min (n, frameIndex (v.stopTime, ctx.blockStart)) : n;
        bool ended = false;

        for (int i = first; i < last; ++i)
        {
            if (v.pitch.active() && (i == first || i % chunkSize == 0))
            {
                // A k-rate detune (AudioBufferSourceNode): the pitch is updated once per chunk.
                const double t = ((double) (ctx.blockStart + i) - v.startTime) / sampleRate;
                v.increment = v.baseIncrement * std::exp2 (v.pitch.at (t) / 12.0);
            }
            if (v.readPos >= frames)
            {
                if (! v.loop)
                {
                    ended = true;
                    break;
                }
                const double span = v.loopEnd - v.loopStart;
                v.readPos = span > 0.0 ? v.loopStart + std::fmod (v.readPos - v.loopStart, span) : v.loopStart;
            }
            const auto i0 = (int64_t) v.readPos;
            const double frac = v.readPos - (double) i0;
            int64_t i1 = i0 + 1;
            if (i1 >= s.numFrames)
                i1 = v.loop ? (int64_t) v.loopStart : i0;
            float env = v.env.next();
            if (v.clip.active)
                env *= notes::clipEnvelopeAt (v.clip, ((double) (ctx.blockStart + i) - v.startTime) / sampleRate, v.clipDuration);
            const float a = (float) (d0[i0] + (d0[i1] - d0[i0]) * frac);
            if (twoChannels)
            {
                const float b = (float) (d1[i0] + (d1[i1] - d1[i0]) * frac);
                if (v.notePanned)
                {
                    float a2, b2;
                    dsp::stereoPan (v.notePan, v.noteGains, a * env, b * env, a2, b2);
                    pl[i] += a2;
                    pr[i] += b2;
                }
                else
                {
                    left[i] += a * env;
                    right[i] += b * env;
                }
            }
            else if (v.notePanned)
            {
                const float x = a * env;
                pl[i] += x * v.noteGains.left;
                pr[i] += x * v.noteGains.right;
            }
            else if (stereo)
            {
                left[i] += a * env;
                right[i] += a * env;
            }
            else
            {
                left[i] += a * env;
            }
            v.readPos += v.increment;
            if (v.loop && v.readPos >= v.loopEnd)
            {
                const double span = v.loopEnd - v.loopStart;
                v.readPos = span > 0.0 ? v.readPos - span : v.loopStart;
            }
        }

        if (ended || (v.stopTime < inf && v.stopTime <= (double) (ctx.blockStart + n)))
            finish (v);
    }

    const float* g = outBuffer.data();
    for (int i = 0; i < n; ++i)
        left[i] *= g[i];
    if (stereo)
        for (int i = 0; i < n; ++i)
            right[i] *= g[i];
    if (anyPanned)
    {
        for (int i = 0; i < n; ++i)
        {
            pl[i] *= g[i];
            pr[i] *= g[i];
        }
    }
    return stereo;
}

//==============================================================================
PluginInstrument::PluginInstrument (std::shared_ptr<PluginSlot> s, bool isExclusive) : slot (std::move (s)), exclusive (isExclusive) {}

PluginInstrument::~PluginInstrument() = default;

void PluginInstrument::prepare (double rate, int maxBlock)
{
    sampleRate = rate;
    // A juce::AudioBuffer referring to existing channels only avoids a heap allocation
    // for fewer than 32 channels (its preallocated pointer space), so stay below that.
    buffer.setSize (30, maxBlock);
    midi.ensureSize (16384);
}

void PluginInstrument::handleEvent (const NoteEvent& e, const BlockContext& ctx)
{
    juce::ignoreUnused (ctx);
    const int offset = std::clamp (e.offset, 0, std::max (0, ctx.numSamples - 1));
    if (e.kind == NoteEvent::Kind::noteOn)
    {
        // Note colour groups appear to the plugin as MIDI channels (FL Studio); the note release is
        // the note-off velocity.
        const int key = std::clamp (e.key, 0, 127);
        const int channel = std::clamp (e.props.color, 0, 15) + 1;
        midi.addEvent (juce::MidiMessage::noteOn (channel, key, juce::jlimit (0.0f, 1.0f, e.velocity)), offset);
        auto& held = heldCount[(size_t) channel - 1][(size_t) key];
        held = (uint8_t) std::min (255, held + 1);
        if (e.lengthSeconds >= 0.0)
        {
            if (numPendingOffs < (int) pendingOffs.size())
                pendingOffs[(size_t) numPendingOffs++] = { e.time + e.lengthSeconds * sampleRate, key, channel,
                                                           juce::jlimit (0.0f, 1.0f, e.props.release) };
        }
        else if (numLiveNotes < (int) liveNotes.size())
        {
            liveNotes[(size_t) numLiveNotes++] = { e.handle, key };
        }
        return;
    }

    for (int i = 0; i < numLiveNotes; ++i)
    {
        if (liveNotes[(size_t) i].handle != e.handle)
            continue;
        const int key = liveNotes[(size_t) i].key;
        midi.addEvent (juce::MidiMessage::noteOff (1, key, 0.5f), offset);
        if (heldCount[0][(size_t) key] > 0)
            --heldCount[0][(size_t) key];
        liveNotes[(size_t) i] = liveNotes[(size_t) --numLiveNotes];
        break;
    }
}

void PluginInstrument::killAll (const BlockContext& ctx, int offset)
{
    juce::ignoreUnused (ctx);
    sendAllNotesOff = true;
    allNotesOffOffset = offset;
}

bool PluginInstrument::render (const BlockContext& ctx, float* left, float* right)
{
    const int n = ctx.numSamples;
    const double blockEnd = (double) (ctx.blockStart + n);

    // Note-offs from event lengths that fall into this block.
    for (int i = 0; i < numPendingOffs;)
    {
        auto& p = pendingOffs[(size_t) i];
        if (p.time < blockEnd)
        {
            const int offset = std::clamp ((int) std::ceil (p.time - (double) ctx.blockStart), 0, n - 1);
            midi.addEvent (juce::MidiMessage::noteOff (p.channel, p.key, p.velocity), offset);
            auto& held = heldCount[(size_t) p.channel - 1][(size_t) p.key];
            if (held > 0)
                --held;
            pendingOffs[(size_t) i] = pendingOffs[(size_t) --numPendingOffs];
        }
        else
        {
            ++i;
        }
    }

    if (sendAllNotesOff)
    {
        const int offset = std::clamp (allNotesOffOffset, 0, n - 1);
        for (int channel = 1; channel <= 16; ++channel)
        {
            auto& held = heldCount[(size_t) channel - 1];
            bool any = false;
            for (int key = 0; key < 128; ++key)
                for (; held[(size_t) key] > 0; --held[(size_t) key], any = true)
                    midi.addEvent (juce::MidiMessage::noteOff (channel, key), offset);
            if (any || channel == 1)
                midi.addEvent (juce::MidiMessage::allNotesOff (channel), offset);
        }
        numPendingOffs = 0;
        numLiveNotes = 0;
        sendAllNotesOff = false;
    }

    auto* plugin = exclusive ? slot->exclusiveInstance() : slot->acquire();
    if (plugin == nullptr)
    {
        clear (left, n);
        clear (right, n);
        midi.clear();
        return true;
    }
    const auto releaseSlot = [this] { if (! exclusive) slot->release(); };

    const int numIn = plugin->getTotalNumInputChannels();
    const int numOut = plugin->getTotalNumOutputChannels();
    const int channels = std::max ({ numIn, numOut, 2 });
    if (channels > buffer.getNumChannels() || n > buffer.getNumSamples())
    {
        releaseSlot();
        clear (left, n);
        clear (right, n);
        midi.clear();
        return true;
    }

    juce::AudioBuffer<float> view (buffer.getArrayOfWritePointers(), channels, n);
    view.clear();
    plugin->processBlock (view, midi);
    releaseSlot();
    midi.clear();

    const auto copyOut = [&] (int ch, float* dest)
    {
        const float* src = view.getReadPointer (ch);
        for (int i = 0; i < n; ++i)
            dest[i] = std::isfinite (src[i]) ? src[i] : 0.0f;
    };
    if (numOut >= 2)
    {
        copyOut (0, left);
        copyOut (1, right);
        return true;
    }
    if (numOut == 1)
    {
        copyOut (0, left);
        return false;
    }
    clear (left, n);
    clear (right, n);
    return true;
}

} // namespace mad
