#include "tests/SelfTest.h"

#include "dsp/Biquad.h"
#include "dsp/Compressor.h"
#include "dsp/Envelope.h"
#include "dsp/ImpulseResponse.h"
#include "dsp/Oscillator.h"
#include "dsp/Panner.h"
#include "dsp/Smoother.h"
#include "dsp/WaveShaper.h"
#include "engine/AudioEngine.h"
#include "engine/GraphBuilder.h"
#include "engine/Renderer.h"
#include "engine/Sequencer.h"
#include "engine/Wav.h"
#include "tests/ReferenceData.h"

#include <cmath>
#include <complex>
#include <cstdio>
#include <cstring>
#include <functional>
#include <string>
#include <vector>

namespace mad
{
namespace
{
//==============================================================================
struct Suite
{
    int passed = 0, failed = 0;
    std::string current;

    void check (bool ok, const std::string& what)
    {
        if (ok)
        {
            ++passed;
            return;
        }
        ++failed;
        std::printf ("  FAIL [%s] %s\n", current.c_str(), what.c_str());
    }

    void near (double actual, double expected, double tolerance, const std::string& what)
    {
        const bool ok = std::isfinite (actual) && std::abs (actual - expected) <= tolerance;
        if (! ok)
        {
            char buf[256];
            std::snprintf (buf, sizeof (buf), "%s: got %.12g, expected %.12g (tol %.3g)", what.c_str(), actual, expected, tolerance);
            check (false, buf);
            return;
        }
        ++passed;
    }

    void run (const char* name, const std::function<void()>& test)
    {
        current = name;
        const int before = failed;
        test();
        std::printf ("%s %s\n", failed == before ? "ok  " : "FAIL", name);
    }
};

Suite* suite = nullptr;

template <typename T, size_t N>
constexpr size_t count (const T (&)[N]) { return N; }

std::string str (const char* fmt, double a, double b = 0.0)
{
    char buf[160];
    std::snprintf (buf, sizeof (buf), fmt, a, b);
    return buf;
}

double rms (const std::vector<float>& v, size_t from, size_t to)
{
    double s = 0.0;
    to = std::min (to, v.size());
    for (size_t i = from; i < to; ++i)
        s += (double) v[i] * (double) v[i];
    return to > from ? std::sqrt (s / (double) (to - from)) : 0.0;
}

double peak (const std::vector<float>& v, size_t from, size_t to)
{
    double p = 0.0;
    to = std::min (to, v.size());
    for (size_t i = from; i < to; ++i)
        p = std::max (p, (double) std::abs (v[i]));
    return p;
}

//==============================================================================
void testEnvelopeValues()
{
    auto& s = *suite;
    const size_t nt = count (reference::envelopeTimes);
    for (size_t c = 0; c < count (reference::envelopeCases); ++c)
    {
        const auto& e = reference::envelopeCases[c];
        const dsp::EnvelopeParams p { e.attack, e.decay, e.sustain, e.release };
        for (size_t t = 0; t < nt; ++t)
            s.near (dsp::envelopeValue (p, e.base, e.peak, reference::envelopeTimes[t]), reference::envelopeValues[c * nt + t],
                    1.0e-12, str ("envelopeValue case %g t=%g", (double) c, reference::envelopeTimes[t]));
    }
}

void testEnvelopeGenerator()
{
    auto& s = *suite;
    const double sr = 48000.0;
    const dsp::EnvelopeParams p { 0.01, 0.2, 0.5, 0.1 };
    dsp::EnvelopeGenerator g;
    g.start (p, 0.0, 0.9, sr, 0.25 / sr);
    const double length = 0.3;
    const double end = g.releaseAt (length);
    s.near (end, 0.3 + 0.12, 1.0e-12, "release end = tr + 1.2 r");

    double maxErr = 0.0;
    for (int i = 0; i < (int) (0.5 * sr); ++i)
    {
        const double t = (i + 0.25) / sr;
        const double v = g.next();
        double expected;
        if (t < 0.01)
            expected = 0.9 * t / 0.01;
        else if (t < length)
            expected = dsp::envelopeValue (p, 0.0, 0.9, t);
        else
            expected = dsp::envelopeValue (p, 0.0, 0.9, length) * std::exp (-(t - length) / (0.1 / 5.0));
        maxErr = std::max (maxErr, std::abs (v - expected));
    }
    s.near (maxErr, 0.0, 2.0e-6, "per-sample ADSR matches scheduleEnvelope()");

    // Note shorter than the attack: ramp to envelopeValue(duration), then release from there.
    dsp::EnvelopeGenerator shortNote;
    shortNote.start (p, 0.0, 1.0, sr, 0.0);
    shortNote.releaseAt (0.004);
    float atRelease = 0.0f;
    for (int i = 0; i <= (int) (0.004 * sr); ++i)
        atRelease = shortNote.next();
    s.near (atRelease, 0.4, 1.0e-3, "short note releases from envelopeValue(duration)");

    // Kill: cancel-and-hold, tau 3 ms, silent 18 ms later.
    dsp::EnvelopeGenerator k;
    k.start (p, 0.0, 1.0, sr, 0.0);
    for (int i = 0; i < (int) (0.05 * sr); ++i)
        k.next();
    const double held = k.curveValue (0.05);
    const double killEnd = k.killAt (0.05);
    s.near (killEnd, 0.05 + 0.018, 1.0e-12, "kill ends 18 ms later");
    float v = 0.0f;
    for (int i = 0; i < (int) (0.003 * sr); ++i)
        v = k.next();
    s.near (v / held, std::exp (-1.0 + 1.0 / (0.003 * sr)), 2.0e-3, "kill decays with tau 3 ms");
}

void testConversions()
{
    auto& s = *suite;
    for (size_t i = 0; i < count (reference::volumePositions); ++i)
        s.near (volumeToGain (reference::volumePositions[i]), reference::volumeGains[i], 1.0e-12, "volumeToGain");
    for (size_t i = 0; i < count (reference::midiKeys); ++i)
        s.near (midiToHz (reference::midiKeys[i]), reference::midiHz[i], 1.0e-9, "midiToHz");
    for (size_t i = 0; i < count (reference::delayDivisionBeats); ++i)
        s.near (delayDivisionBeats[i], reference::delayDivisionBeats[i], 1.0e-15, "DELAY_DIVISION_BEATS");
}

void testBiquads()
{
    auto& s = *suite;
    for (const auto& c : reference::biquadCases)
    {
        const auto k = dsp::makeBiquad (dsp::biquadTypeFromIndex (c.type), 48000.0, c.frequency, c.q, c.gain);
        const auto what = str ("biquad type %g f=%g", (double) c.type, c.frequency);
        s.near (k.b0, c.b0, 1.0e-12, what + " b0");
        s.near (k.b1, c.b1, 1.0e-12, what + " b1");
        s.near (k.b2, c.b2, 1.0e-12, what + " b2");
        s.near (k.a1, c.a1, 1.0e-12, what + " a1");
        s.near (k.a2, c.a2, 1.0e-12, what + " a2");
    }

    // Detune shifts the computed frequency: 1800 Hz + 1200 cents == 3600 Hz.
    const auto a = dsp::makeBiquad (dsp::BiquadType::lowpass, 48000.0, 1800.0, 4.0, 0.0, 1200.0);
    const auto b = dsp::makeBiquad (dsp::BiquadType::lowpass, 48000.0, 3600.0, 4.0, 0.0, 0.0);
    s.near (a.b0, b.b0, 1.0e-12, "detune 1200 cents doubles the frequency");
    // Above nyquist: lowpass passes everything, highpass blocks.
    const auto lp = dsp::makeBiquad (dsp::BiquadType::lowpass, 48000.0, 20000.0, 1.0, 0.0, 7200.0);
    s.near (lp.b0, 1.0, 0.0, "lowpass at nyquist passes");
    const auto hp = dsp::makeBiquad (dsp::BiquadType::highpass, 48000.0, 30000.0, 1.0, 0.0);
    s.near (hp.b0, 0.0, 0.0, "highpass at nyquist blocks");

    // Q in dB for lowpass: resonance 6 dB gives a ~6 dB peak near the cutoff (for low f).
    const auto r = dsp::makeBiquad (dsp::BiquadType::lowpass, 48000.0, 1000.0, 6.0, 0.0);
    const double w = 2.0 * 3.14159265358979323846 * 1000.0 / 48000.0;
    const std::complex<double> z1 = std::polar (1.0, -w), z2 = std::polar (1.0, -2.0 * w);
    const auto h = (r.b0 + r.b1 * z1 + r.b2 * z2) / (1.0 + r.a1 * z1 + r.a2 * z2);
    s.near (20.0 * std::log10 (std::abs (h)), 6.0, 0.05, "lowpass Q is in dB (gain at cutoff)");
}

void testPanLaws()
{
    auto& s = *suite;
    const auto centre = dsp::monoPanGains (0.0);
    s.near (centre.left, std::cos (3.14159265358979323846 / 4.0), 1.0e-7, "mono centre L = -3 dB");
    s.near (centre.right, std::sin (3.14159265358979323846 / 4.0), 1.0e-7, "mono centre R = -3 dB");
    const auto left = dsp::monoPanGains (-1.0);
    s.near (left.left, 1.0, 1.0e-7, "mono hard left L");
    s.near (left.right, 0.0, 1.0e-7, "mono hard left R");
    const auto half = dsp::monoPanGains (0.5);
    s.near (half.left, std::cos (0.75 * 3.14159265358979323846 / 2.0), 1.0e-7, "mono pan 0.5 L");

    float l, r;
    dsp::stereoPan (0.0, dsp::stereoPanGains (0.0), 0.3f, -0.2f, l, r);
    s.near (l, 0.3, 1.0e-7, "stereo centre is unity L");
    s.near (r, -0.2, 1.0e-7, "stereo centre is unity R");
    dsp::stereoPan (-0.5, dsp::stereoPanGains (-0.5), 1.0f, 1.0f, l, r);
    s.near (l, 1.0 + std::cos (0.5 * 3.14159265358979323846 / 2.0), 1.0e-6, "stereo pan -0.5 L = inL + inR cos");
    s.near (r, std::sin (0.5 * 3.14159265358979323846 / 2.0), 1.0e-6, "stereo pan -0.5 R = inR sin");
    dsp::stereoPan (1.0, dsp::stereoPanGains (1.0), 1.0f, 0.5f, l, r);
    s.near (l, 0.0, 1.0e-6, "stereo hard right L");
    s.near (r, 1.5, 1.0e-6, "stereo hard right R = inR + inL");
}

void testImpulseResponse()
{
    auto& s = *suite;
    for (size_t c = 0; c < count (reference::impulseCases); ++c)
    {
        const auto& ref = reference::impulseCases[c];
        const auto ir = dsp::makeImpulseResponse (ref.sampleRate, ref.decay, ref.damping, 1);
        s.check ((int) ir[0].size() == ref.length && (int) ir[1].size() == ref.length, str ("IR %g length", (double) c));
        const float* headL = reference::impulseHeads[c * 3];
        const float* headR = reference::impulseHeads[c * 3 + 1];
        const float* tailL = reference::impulseHeads[c * 3 + 2];
        int mismatches = 0;
        double maxDiff = 0.0;
        for (size_t i = 0; i < 48 && i < ir[0].size(); ++i)
        {
            maxDiff = std::max ({ maxDiff, (double) std::abs (ir[0][i] - headL[i]), (double) std::abs (ir[1][i] - headR[i]) });
            mismatches += (dsp::differs (ir[0][i], headL[i]) ? 1 : 0) + (dsp::differs (ir[1][i], headR[i]) ? 1 : 0);
        }
        for (size_t i = 0; i < 8; ++i)
            maxDiff = std::max (maxDiff, (double) std::abs (ir[0][ir[0].size() - 8 + i] - tailL[i]));
        s.near (maxDiff, 0.0, 1.0e-6, str ("IR %g matches makeImpulseResponse()", (double) c));
        s.check (mismatches == 0, str ("IR %g first samples bit-identical (%g differ)", (double) c, (double) mismatches));
        s.near (dsp::convolverNormalisationScale (ir[0], ir[1], ref.sampleRate) / ref.normScale, 1.0, 1.0e-6,
                str ("IR %g ConvolverNode normalisation", (double) c));
    }
}

void testOscillators()
{
    auto& s = *suite;
    const double sr = 48000.0;
    const auto measure = [&] (dsp::Wave w, double hz)
    {
        dsp::BlepOscillator o;
        std::vector<float> v (48000);
        for (auto& x : v)
            x = o.next (w, hz / sr) * (float) dsp::chromeWaveScale (w, sr);
        return v;
    };
    s.near (rms (measure (dsp::Wave::sine, 220.0), 0, 48000), std::sqrt (0.5), 1.0e-4, "sine RMS");
    s.near (rms (measure (dsp::Wave::sawtooth, 220.0), 0, 48000), 0.848542 / std::sqrt (3.0), 4.0e-3, "saw RMS (Chromium normalised)");
    s.near (rms (measure (dsp::Wave::square, 220.0), 0, 48000), 0.848191, 4.0e-3, "square RMS (Chromium normalised)");
    s.near (rms (measure (dsp::Wave::triangle, 220.0), 0, 48000), 1.0 / std::sqrt (3.0), 3.0e-3, "triangle RMS");

    dsp::BlepOscillator saw;
    s.near (saw.next (dsp::Wave::sawtooth, 0.001), 0.0, 1.0e-9, "saw starts at 0");
    dsp::BlepOscillator tri;
    s.near (tri.next (dsp::Wave::triangle, 0.001), 0.0, 1.0e-3, "triangle starts at 0");
    const auto& noise = dsp::noiseBuffer (48000.0);
    s.check (noise.size() == 96000, "noise buffer is 2 s");
    uint32_t seed = 1234567u;
    seed = seed * 1664525u + 1013904223u;
    s.near (noise[0], ((double) seed / 4294967296.0) * 2.0 - 1.0, 1.0e-7, "noise LCG");
}

void testCompressor()
{
    auto& s = *suite;
    dsp::DynamicsCompressor c;
    c.prepare (48000.0);
    std::vector<float> l (96000, 0.01f), r (96000, 0.01f);
    const dsp::DynamicsCompressor::Params limiter { -3.5f, 0.0f, 20.0f, 0.001f, 0.1f };
    c.process (l.data(), r.data(), (int) l.size(), [&] (int) -> const dsp::DynamicsCompressor::Params& { return limiter; });
    // Makeup (1 / curve(1))^0.6 with threshold -3.5 dB, ratio 20, knee 0.
    const double expected = std::pow (1.0 / std::pow (10.0, (-3.5 + 3.5 / 20.0) / 20.0), 0.6);
    s.near (c.currentMakeupGain(), expected, 2.0e-3, "automatic makeup gain");
    // 6 ms look-ahead delay; the detector starts at 0 (Chromium resets it to 0, so the node
    // ducks briefly at startup), then a quiet signal passes with only the makeup gain.
    s.near (l[100], 0.0, 1.0e-9, "look-ahead delay (silent before 6 ms)");
    s.near (l[90000], 0.01 * expected, 2.0e-5, "below threshold: makeup only");

    // A loud signal gets compressed.
    dsp::DynamicsCompressor loud;
    loud.prepare (48000.0);
    std::vector<float> a (48000), b (48000);
    for (size_t i = 0; i < a.size(); ++i)
        a[i] = b[i] = (float) (0.9 * std::sin (2.0 * 3.14159265358979323846 * 440.0 * (double) i / 48000.0));
    const dsp::DynamicsCompressor::Params comp { -24.0f, 30.0f, 12.0f, 0.003f, 0.25f };
    loud.process (a.data(), b.data(), (int) a.size(), [&] (int) -> const dsp::DynamicsCompressor::Params& { return comp; });
    const double outPeak = peak (a, 24000, 48000);
    s.check (outPeak < 0.9 && outPeak > 0.05, str ("compression reduces a loud sine (peak %g)", outPeak));
}

void testWaveShaper()
{
    auto& s = *suite;
    std::vector<float> curve (4096);
    dsp::fillClipperCurve (curve, std::pow (10.0, -0.5 / 20.0));
    s.near (dsp::WaveShaper::lookup (curve.data(), curve.size(), 0.0f), 0.0, 1.0e-6, "clipper centre");
    s.near (dsp::WaveShaper::lookup (curve.data(), curve.size(), 0.25f), 0.5, 1.0e-3, "clipper linear below knee (x2 domain)");
    s.check (dsp::WaveShaper::lookup (curve.data(), curve.size(), 1.0f) <= (float) std::pow (10.0, -0.5 / 20.0) + 1.0e-6f, "clipper ceiling");
    s.near (dsp::WaveShaper::lookup (curve.data(), curve.size(), 5.0f), curve.back(), 0.0, "curve clamps above +1");

    std::vector<float> drive (2048);
    dsp::fillDriveCurve (drive, 0.4);
    s.near (dsp::WaveShaper::lookup (drive.data(), drive.size(), 1.0f), 1.0, 1.0e-6, "drive curve normalised");
}

void testSmoother()
{
    auto& s = *suite;
    dsp::OnePole p;
    p.prepare (48000.0, 0.01);
    p.setTarget (0.0);
    p.setTarget (1.0);
    float v = 0.0f;
    for (int i = 0; i < 480; ++i)
        v = p.next();
    s.near (v, 1.0 - std::exp (-1.0), 1.0e-4, "setTargetAtTime: 63% after tau");
}

//==============================================================================
struct CollectingSink final : Sequencer::Sink
{
    std::vector<std::pair<double, double>> events; // tick, time (samples)
    std::vector<std::pair<double, bool>> clicks;
    int startedAt = -1;
    int64_t blockStart = 0;
    void chunkStarted (int, double) override {}
    void noteEvent (const TimelineEvent& ev, double time, double, double) override { events.emplace_back (ev.tick, time); }
    void click (double time, bool accent) override { clicks.emplace_back (time, accent); }
    void playbackStarted (int offset, double) override
    {
        if (startedAt < 0)
            startedAt = (int) blockStart + offset;
    }
    void endReached (int) override {}
};

void testSequencer()
{
    auto& s = *suite;
    for (const int blockSize : { 512, 441, 137, 2048 })
    {
        const double sr = 48000.0;
        Timeline tl;
        tl.songMode = true;
        tl.loopStart = 0.0;
        tl.loopEnd = reference::schedulerLoopEnd;
        for (const auto t : reference::schedulerEventTicks)
            tl.events.push_back ({ t, 24.0, 1, 60, 1.0f, 0.0, false });

        AutoParam bpm ((float) reference::schedulerBpm), swing ((float) reference::schedulerSwing);
        Sequencer seq;
        seq.prepare (sr);
        seq.play (0.0, 0.0);
        CollectingSink sink;
        BlockContext ctx;
        ctx.sampleRate = sr;
        int64_t clock = 0;
        while ((double) clock < reference::schedulerSeconds * sr)
        {
            ctx.numSamples = blockSize;
            ctx.numChunks = (blockSize + chunkSize - 1) / chunkSize;
            ctx.blockStart = clock;
            ++ctx.blockIndex;
            sink.blockStart = clock;
            seq.process (ctx, &tl, bpm, swing, 4, false, sink);
            clock += blockSize;
        }

        std::vector<std::pair<double, double>> got;
        for (const auto& e : sink.events)
            if (e.second / sr < reference::schedulerSeconds)
                got.push_back (e);
        s.check (got.size() == count (reference::schedulerFiredTimes),
                 str ("block %g: number of events %g", (double) blockSize, (double) got.size()));
        double maxErr = 0.0;
        for (size_t i = 0; i < std::min (got.size(), count (reference::schedulerFiredTimes)); ++i)
        {
            s.check (! dsp::differs (got[i].first, reference::schedulerFiredTicks[i]), "event order");
            maxErr = std::max (maxErr, std::abs (got[i].second / sr - reference::schedulerFiredTimes[i]));
        }
        s.near (maxErr, 0.0, 1.0e-9, str ("block %g: swing + loop wrap timing vs scheduler.ts", (double) blockSize));
    }

    for (size_t si = 0; si < count (reference::swingAmounts); ++si)
        for (size_t ti = 0; ti < count (reference::swingTicks); ++ti)
            s.near (swingOffsetTicks (reference::swingTicks[ti], reference::swingAmounts[si]),
                    reference::swingOffsets[si * count (reference::swingTicks) + ti], 1.0e-12, "swingOffsetTicks");

    // Count-in: one bar at 120 BPM clicks at 0, .5, 1, 1.5 s (accent first), playback at 2 s.
    {
        Timeline tl;
        tl.loopEnd = 384.0;
        AutoParam bpm (120.0f), swing (0.0f);
        Sequencer seq;
        seq.prepare (48000.0);
        seq.play (0.0, 384.0);
        CollectingSink sink;
        BlockContext ctx;
        for (int64_t clock = 0; clock < 48000 * 3; clock += 512)
        {
            ctx.numSamples = 512;
            ctx.numChunks = 16;
            ctx.blockStart = clock;
            ++ctx.blockIndex;
            sink.blockStart = clock;
            seq.process (ctx, &tl, bpm, swing, 4, false, sink);
        }
        s.check (sink.clicks.size() == 4, str ("count-in clicks: %g", (double) sink.clicks.size()));
        for (size_t i = 0; i < sink.clicks.size() && i < 4; ++i)
        {
            s.near (sink.clicks[i].first, (double) i * 24000.0, 1.0e-6, "count-in click time");
            s.check (sink.clicks[i].second == (i == 0), "count-in accent on the bar");
        }
        s.near (sink.startedAt, 96000.0, 1.0, "playback starts after the count-in");
    }

    // Tempo change keeps continuity: 120 -> 60 BPM at tick 96 (0.5 s): tick 192 lands at 1.5 s.
    {
        Timeline tl;
        tl.loopEnd = 3840.0;
        tl.events.push_back ({ 192.0, 24.0, 1, 60, 1.0f, 0.0, false });
        AutoParam bpm (120.0f), swing (0.0f);
        Sequencer seq;
        seq.prepare (48000.0);
        seq.play (0.0, 0.0);
        CollectingSink sink;
        BlockContext ctx;
        for (int64_t clock = 0; clock < 48000 * 2; clock += 480)
        {
            if (clock == 24000)
                bpm.setBase (60.0f);
            ctx.numSamples = 480;
            ctx.numChunks = 15;
            ctx.blockStart = clock;
            ++ctx.blockIndex;
            seq.process (ctx, &tl, bpm, swing, 4, false, sink);
        }
        s.check (sink.events.size() == 1, "tempo change: one event");
        if (! sink.events.empty())
            s.near (sink.events[0].second / 48000.0, 1.5, 1.0e-6, "tempo change continuity");
    }
}

void testAutomation()
{
    auto& s = *suite;
    AutomationLane lane;
    lane.points = { { 0.0, 0.8 }, { 384.0, 0.2 }, { 768.0, 0.2 }, { 768.0, 0.9 } };
    double v = 0.0;
    s.check (! AutomationLane { "x", { { 96.0, 1.0 } } }.evaluate (95.0, v), "no override before the first point");
    s.check (lane.evaluate (192.0, v), "inside");
    s.near (v, 0.5, 1.0e-12, "linear interpolation");
    lane.evaluate (768.0, v);
    s.near (v, 0.9, 1.0e-12, "step at equal ticks takes the later point");
    lane.evaluate (5000.0, v);
    s.near (v, 0.9, 1.0e-12, "hold after the last point");

    // Override persistence rules.
    AutoParam p (0.8f);
    BlockContext ctx;
    ctx.numChunks = 2;
    ctx.blockIndex = 1;
    auto state = p.beginAutomation (ctx);
    state = { true, 0.25f };
    p.setChunk (0, state);
    p.setChunk (1, state);
    p.endAutomation (state);
    s.near (p.value (ctx, 1), 0.25, 1.0e-7, "automated chunk value");
    ctx.blockIndex = 2; // transport stopped: no automation this block
    s.near (p.value (ctx, 0), 0.25, 1.0e-7, "override persists after stop");
    p.setBase (0.8f);
    s.near (p.value (ctx, 0), 0.25, 1.0e-7, "unchanged project value keeps the override");
    p.setBase (0.6f);
    s.near (p.value (ctx, 0), 0.6, 1.0e-7, "changed project value cancels the override");
    state = p.beginAutomation (ctx);
    state = { true, 0.1f };
    p.setChunk (0, state);
    p.endAutomation (state);
    p.requestOverrideReset();
    ctx.blockIndex = 3;
    s.near (p.value (ctx, 0), 0.6, 1.0e-7, "removed lane cancels the override");
}

void testWav()
{
    auto& s = *suite;
    std::vector<std::vector<float>> sig { std::vector<float> (std::begin (reference::wavSignalL), std::end (reference::wavSignalL)),
                                          std::vector<float> (std::begin (reference::wavSignalR), std::end (reference::wavSignalR)) };
    const struct
    {
        int bits;
        const unsigned char* data;
        size_t size;
    } cases[] = { { 16, reference::wavBytes16, sizeof (reference::wavBytes16) },
                  { 24, reference::wavBytes24, sizeof (reference::wavBytes24) },
                  { 32, reference::wavBytes32, sizeof (reference::wavBytes32) } };
    for (const auto& c : cases)
    {
        const auto block = encodeWav (sig, 48000.0, c.bits);
        const bool same = block.getSize() == c.size && std::memcmp (block.getData(), c.data, c.size) == 0;
        s.check (same, str ("%g-bit WAV is byte-identical to wav.ts encodeWav()", (double) c.bits));

        WavData d;
        juce::String error;
        s.check (readWav (block.getData(), block.getSize(), d, error), "readWav: " + error.toStdString());
        s.check (d.numChannels == 2 && d.channels.size() == 2 && d.channels[0].size() == 12, "readWav shape");
        if (d.channels.size() == 2 && d.channels[0].size() == 12)
        {
            const double tol = c.bits == 16 ? 1.0e-4 : (c.bits == 24 ? 2.0e-7 : 0.0);
            double maxErr = 0.0;
            for (size_t ch = 0; ch < 2; ++ch)
                for (size_t i = 0; i < 12; ++i)
                    maxErr = std::max (maxErr, std::abs ((double) d.channels[ch][i] - std::clamp ((double) sig[ch][i], -1.0, 1.0)));
            s.near (maxErr, 0.0, tol, str ("%g-bit round trip", (double) c.bits));
        }
    }
}

//==============================================================================
/** Builds a small project directly as a model. */
ProjectModel makeProject (int inserts = 2)
{
    ProjectModel m;
    m.bpm = 120.0;
    for (int i = 0; i <= inserts; ++i)
    {
        MixerTrackModel t;
        t.id = "mx_" + juce::String (i);
        t.name = i == 0 ? "Master" : "Insert " + juce::String (i);
        m.mixer.push_back (t);
    }
    return m;
}

std::unique_ptr<SampleData> constantSample (const juce::String& id, int channels, float value, double seconds, double rate)
{
    auto d = std::make_unique<SampleData>();
    d->id = id;
    d->numChannels = channels;
    d->sampleRate = rate;
    d->numFrames = (int64_t) (seconds * rate);
    for (int c = 0; c < channels; ++c)
        d->channels[c].assign ((size_t) d->numFrames, value);
    return d;
}

void testGraphLevels()
{
    auto& s = *suite;
    SampleStore samples;
    ChannelIds ids;
    samples.add (constantSample ("dc_mono", 1, 0.5f, 2.0, 48000.0));
    samples.add (constantSample ("dc_stereo", 2, 0.5f, 2.0, 48000.0));

    const auto renderWith = [&] (ProjectModel project, std::vector<TimelineEvent> events, std::vector<float>& l, std::vector<float>& r,
                                 std::shared_ptr<AutomationData> automation = nullptr, double end = 384.0)
    {
        auto tl = std::make_shared<Timeline>();
        tl->songMode = true;
        tl->loopEnd = end;
        tl->events = std::move (events);
        RenderRequest req;
        req.project = std::move (project);
        req.timeline = tl;
        req.automation = automation;
        req.sampleRate = 48000.0;
        req.endTick = end;
        req.tailSeconds = 0.0;
        return renderOfflineToBuffers (req, samples, ids, nullptr, l, r);
    };

    const auto samplerChannel = [] (const juce::String& id, const juce::String& sample, int track)
    {
        ChannelModel ch;
        ch.id = id;
        ch.kind = ChannelKind::sampler;
        ch.mixerTrack = track;
        for (int i = 0; i < sampler::numParams; ++i)
            ch.samplerParams[(size_t) i] = sampler::defaultValue (i);
        ch.samplerParams[sampler::gain] = 1.0f;
        ch.sampleId = sample;
        return ch;
    };

    // Mono sampler: mono pan law (-3 dB) at the channel; volume 0.8 = unity.
    {
        auto p = makeProject();
        p.channels.push_back (samplerChannel ("ch_a", "dc_mono", 1));
        std::vector<float> l, r;
        const auto res = renderWith (p, { { 0.0, 96.0, ids.uidFor ("ch_a"), 60, 1.0f, 0.0, false } }, l, r);
        s.check (res.ok, "render ok");
        s.near (rms (l, 4800, 9600), 0.5 * std::cos (3.14159265358979323846 / 4.0), 1.0e-4, "mono sample: -3 dB pan law");
        s.near (rms (r, 4800, 9600), 0.5 * std::cos (3.14159265358979323846 / 4.0), 1.0e-4, "mono sample R");
    }
    // Stereo sampler: stereo law, unity at centre.
    {
        auto p = makeProject();
        p.channels.push_back (samplerChannel ("ch_b", "dc_stereo", 2));
        std::vector<float> l, r;
        renderWith (p, { { 0.0, 96.0, ids.uidFor ("ch_b"), 60, 1.0f, 0.0, false } }, l, r);
        s.near (rms (l, 4800, 9600), 0.5, 1.0e-4, "stereo sample: unity at centre");
    }
    // Volume knob 0.4 -> gain 0.25, mixer fader 1.0 -> 1.5625, mute.
    {
        auto p = makeProject();
        auto ch = samplerChannel ("ch_c", "dc_stereo", 1);
        ch.volume = 0.4f;
        p.channels.push_back (ch);
        p.mixer[1].volume = 1.0f;
        std::vector<float> l, r;
        renderWith (p, { { 0.0, 96.0, ids.uidFor ("ch_c"), 60, 1.0f, 0.0, false } }, l, r);
        s.near (rms (l, 4800, 9600), 0.5 * 0.25 * 1.5625, 1.0e-4, "volumeToGain on channel and fader");

        p.mixer[1].muted = true;
        renderWith (p, { { 0.0, 96.0, ids.uidFor ("ch_c"), 60, 1.0f, 0.0, false } }, l, r);
        s.near (rms (l, 4800, 9600), 0.0, 1.0e-6, "muted insert is silent");

        p.mixer[1].muted = false;
        p.mixer[2].solo = true;
        renderWith (p, { { 0.0, 96.0, ids.uidFor ("ch_c"), 60, 1.0f, 0.0, false } }, l, r);
        s.near (rms (l, 4800, 9600), 0.0, 1.0e-6, "insert soloed out");
    }
    // One-shot plays to the end of the sample regardless of note length; gated stops.
    {
        auto p = makeProject();
        p.channels.push_back (samplerChannel ("ch_d", "dc_stereo", 1));
        std::vector<float> l, r;
        renderWith (p, { { 0.0, 24.0, ids.uidFor ("ch_d"), 60, 1.0f, 0.0, false } }, l, r, nullptr, 768.0);
        s.near (rms (l, 40000, 44000), 0.5, 1.0e-4, "one-shot ignores the note length");

        p.channels[0].samplerParams[sampler::oneShot] = 0.0f;
        renderWith (p, { { 0.0, 24.0, ids.uidFor ("ch_d"), 60, 1.0f, 0.0, false } }, l, r, nullptr, 768.0);
        s.near (rms (l, 40000, 44000), 0.0, 1.0e-6, "gated sampler stops after the release");
    }
    // Choke group: the second hat cuts the first within ~18 ms.
    {
        auto p = makeProject();
        auto a = samplerChannel ("ch_h1", "dc_stereo", 1);
        auto b = samplerChannel ("ch_h2", "dc_stereo", 2);
        a.samplerParams[sampler::chokeGroup] = 1.0f;
        b.samplerParams[sampler::chokeGroup] = 1.0f;
        b.samplerParams[sampler::gain] = 0.0f; // only hear the choked channel
        p.channels.push_back (a);
        p.channels.push_back (b);
        std::vector<float> l, r;
        renderWith (p, { { 0.0, 24.0, ids.uidFor ("ch_h1"), 60, 1.0f, 0.0, false },
                         { 96.0, 24.0, ids.uidFor ("ch_h2"), 60, 1.0f, 0.0, false } }, l, r);
        s.near (rms (l, 12000, 23000), 0.5, 1.0e-4, "before the choke");
        s.near (rms (l, 26000, 30000), 0.0, 1.0e-5, "choke group kills the earlier voice (18 ms fade)");
    }
    // Automation: channel volume lane 0.8 -> 0 over one bar (song mode render).
    {
        auto p = makeProject();
        p.channels.push_back (samplerChannel ("ch_e", "dc_stereo", 1));
        auto automation = std::make_shared<AutomationData>();
        automation->lanes.push_back ({ "ch:ch_e:volume", { { 0.0, 0.8 }, { 192.0, 0.8 }, { 193.0, 0.0 } } });
        std::vector<float> l, r;
        renderWith (p, { { 0.0, 384.0, ids.uidFor ("ch_e"), 60, 1.0f, 0.0, false } }, l, r, automation);
        // 120 BPM: tick 192 = 1 s.
        s.near (rms (l, 12000, 46000), 0.5, 1.0e-3, "automation before the step");
        s.near (rms (l, 52000, 90000), 0.0, 1.0e-4, "automated volume reaches 0");
    }
    // Synth: one saw note, filter off, mono voice -> -3 dB law; level = 0.8/0.848 normalised saw.
    {
        auto p = makeProject();
        ChannelModel ch;
        ch.id = "ch_s";
        ch.kind = ChannelKind::synth;
        ch.mixerTrack = 1;
        for (int i = 0; i < synth::numParams; ++i)
            ch.synthParams[(size_t) i] = synth::defaultValue (i);
        ch.synthParams[synth::filterEnabled] = 0.0f;
        ch.synthParams[synth::gain] = 1.0f;
        ch.synthParams[(size_t) synth::osc (0, synth::level)] = 1.0f;
        ch.synthParams[(size_t) synth::osc (1, synth::level)] = 0.0f;
        ch.synthParams[(size_t) synth::osc (0, synth::wave)] = 0.0f; // sine
        ch.synthParams[synth::ampSustain] = 1.0f;
        p.channels.push_back (ch);
        std::vector<float> l, r;
        renderWith (p, { { 0.0, 192.0, ids.uidFor ("ch_s"), 69, 1.0f, 0.0, false } }, l, r);
        s.near (rms (l, 12000, 36000), std::sqrt (0.5) * std::cos (3.14159265358979323846 / 4.0), 2.0e-3,
                "synth sine voice level with mono pan law");
    }
    // Reverb and delay produce tails, limiter keeps the ceiling, no NaN anywhere.
    {
        auto p = makeProject();
        p.channels.push_back (samplerChannel ("ch_f", "dc_stereo", 1));
        EffectModel reverb;
        reverb.id = "fx_rev";
        reverb.type = "reverb";
        for (const auto& ps : findEffectSpec ("reverb")->params)
            reverb.params.push_back (ps.def);
        EffectModel delay;
        delay.id = "fx_del";
        delay.type = "delay";
        for (const auto& ps : findEffectSpec ("delay")->params)
            delay.params.push_back (ps.def);
        EffectModel limiter;
        limiter.id = "fx_lim";
        limiter.type = "limiter";
        for (const auto& ps : findEffectSpec ("limiter")->params)
            limiter.params.push_back (ps.def);
        limiter.params[0] = 12.0f; // +12 dB into the limiter
        p.mixer[1].effects = { reverb, delay };
        p.mixer[0].effects = { limiter };
        std::vector<float> l, r;
        renderWith (p, { { 0.0, 24.0, ids.uidFor ("ch_f"), 60, 1.0f, 0.0, false } }, l, r, nullptr, 768.0);
        bool finite = true;
        for (size_t i = 0; i < l.size(); ++i)
            finite = finite && std::isfinite (l[i]) && std::isfinite (r[i]);
        s.check (finite, "effects produce finite output");
        s.check (peak (l, 0, l.size()) <= std::pow (10.0, -0.5 / 20.0) + 0.02, str ("limiter ceiling (peak %g)", peak (l, 0, l.size())));
        s.check (rms (l, 72000, 90000) > 1.0e-4, "reverb/delay tail after the sample");
    }
}

} // namespace

bool runSelfTests()
{
    Suite s;
    suite = &s;
    std::printf ("MAD Engine self-test\n");
    s.run ("envelope values (envelope.ts)", testEnvelopeValues);
    s.run ("envelope generator", testEnvelopeGenerator);
    s.run ("volumeToGain / midiToHz / delay divisions", testConversions);
    s.run ("biquad coefficients (Web Audio)", testBiquads);
    s.run ("StereoPanner laws", testPanLaws);
    s.run ("impulse response (makeImpulseResponse)", testImpulseResponse);
    s.run ("oscillators", testOscillators);
    s.run ("dynamics compressor", testCompressor);
    s.run ("waveshaper curves", testWaveShaper);
    s.run ("parameter smoothing", testSmoother);
    s.run ("sequencer timing, swing, loop wrap, count-in", testSequencer);
    s.run ("automation interpolation and override", testAutomation);
    s.run ("WAV writing and reading", testWav);
    s.run ("graph levels, chokes, automation, effects", testGraphLevels);
    collectSampleGarbage();
    std::printf ("%d checks passed, %d failed\n", s.passed, s.failed);
    suite = nullptr;
    return s.failed == 0;
}

} // namespace mad
