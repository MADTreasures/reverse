#include "engine/Graph.h"

#include <algorithm>
#include <cmath>

namespace mad
{

void PeakWindow::push (const float* data, int n) noexcept
{
    for (int i = 0; i < n; ++i)
    {
        const float a = std::abs (data[i]);
        if (a > current)
            current = a;
        if (++fill == chunkSize)
        {
            chunkPeaks[(size_t) position] = current;
            position = (position + 1) % slots;
            current = 0.0f;
            fill = 0;
        }
    }
}

float PeakWindow::peak() const noexcept
{
    float p = current;
    for (const float v : chunkPeaks)
        p = std::max (p, v);
    return p;
}

void PeakWindow::reset() noexcept
{
    chunkPeaks.fill (0.0f);
    current = 0.0f;
    fill = 0;
}

//==============================================================================
ChannelNode::ChannelNode (uint32_t u, juce::String channelId, ChannelKind k, std::unique_ptr<Instrument> inst)
    : uid (u), id (std::move (channelId)), kind (k), instrument (std::move (inst))
{
}

void ChannelNode::prepare (double sampleRate, int maxBlock)
{
    instrument->prepare (sampleRate, maxBlock);
    for (auto* s : { &volumeGain, &panValue, &muteGain })
        s->prepare (sampleRate, 0.01);
    bufL.assign ((size_t) maxBlock, 0.0f);
    bufR.assign ((size_t) maxBlock, 0.0f);
}

void ChannelNode::process (const BlockContext& ctx, float* busL, float* busR, CompensationDelay* delay,
                           int delaySamples) noexcept
{
    const int n = ctx.numSamples;
    const bool delayed = delay != nullptr && delaySamples > 0;
    const bool idle = instrument->isIdle();
    const bool stereo = instrument->render (ctx, bufL.data(), bufR.data());
    const float* pannedL = nullptr;
    const float* pannedR = nullptr;
    const bool panned = instrument->pannedOutput (pannedL, pannedR);
    const float muteTarget = muted.load (std::memory_order_relaxed) ? 0.0f : 1.0f;
    float* stripL = bufL.data();
    float* stripR = bufR.data();
    const auto addStrip = [&]
    {
        if (delayed)
        {
            float* channels[] = { stripL, stripR };
            delay->process (channels, n, delaySamples);
        }
        for (int i = 0; i < n; ++i)
        {
            busL[i] += stripL[i];
            busR[i] += stripR[i];
        }
    };

    if (idle)
    {
        for (int c = 0; c < ctx.numChunks; ++c)
        {
            const int len = std::min (n, (c + 1) * chunkSize) - c * chunkSize;
            volumeGain.setTarget (volumeToGain (volume.value (ctx, c)));
            panValue.setTarget (pan.value (ctx, c));
            muteGain.setTarget (muteTarget);
            for (auto* s : { &volumeGain, &panValue, &muteGain })
                s->skip (len);
        }
        // A compensation delay still holding the end of the last note plays it out.
        if (delayed && ! delay->isQuiet (delaySamples))
        {
            std::fill (stripL, stripL + n, 0.0f);
            std::fill (stripR, stripR + n, 0.0f);
            addStrip();
        }
        return;
    }

    // The strip output replaces the instrument output in place, then goes to the bus.
    const float* inL = bufL.data();
    const float* inR = bufR.data();
    double lastPan = panValue.current() + 10.0;
    dsp::PanGains gains, pannedGains;

    for (int c = 0; c < ctx.numChunks; ++c)
    {
        const int c0 = c * chunkSize, c1 = std::min (n, c0 + chunkSize);
        volumeGain.setTarget (volumeToGain (volume.value (ctx, c)));
        panValue.setTarget (pan.value (ctx, c));
        muteGain.setTarget (muteTarget);

        for (int i = c0; i < c1; ++i)
        {
            const float g = volumeGain.next() * muteGain.next();
            const double p = panValue.next();
            if (dsp::differs (p, lastPan))
            {
                gains = stereo ? dsp::stereoPanGains (p) : dsp::monoPanGains (p);
                pannedGains = dsp::stereoPanGains (p);
                lastPan = p;
            }
            if (stereo)
            {
                float l, r;
                dsp::stereoPan (p, gains, inL[i] * g, inR[i] * g, l, r);
                stripL[i] = l;
                stripR[i] = r;
            }
            else
            {
                const float m = inL[i] * g;
                stripL[i] = m * gains.left;
                stripR[i] = m * gains.right;
            }
            if (panned)
            {
                // Voices with a note pan: always stereo, panned with the stereo law.
                float l, r;
                dsp::stereoPan (p, pannedGains, pannedL[i] * g, pannedR[i] * g, l, r);
                stripL[i] += l;
                stripR[i] += r;
            }
        }
    }
    addStrip();
}

//==============================================================================
MixerTrackNode::MixerTrackNode (int i) : index (i) {}

void MixerTrackNode::prepare (double sampleRate, int maxBlock)
{
    for (auto* s : { &panValue, &faderGain, &muteGain })
        s->prepare (sampleRate, 0.01);
    busL.assign ((size_t) maxBlock, 0.0f);
    busR.assign ((size_t) maxBlock, 0.0f);
    sidechainL.assign ((size_t) maxBlock, 0.0f);
    sidechainR.assign ((size_t) maxBlock, 0.0f);
    peakL.reset();
    peakR.reset();
}

void MixerTrackNode::clearBus (int n, bool sidechain) noexcept
{
    std::fill (busL.begin(), busL.begin() + n, 0.0f);
    std::fill (busR.begin(), busR.begin() + n, 0.0f);
    if (sidechain)
    {
        std::fill (sidechainL.begin(), sidechainL.begin() + n, 0.0f);
        std::fill (sidechainR.begin(), sidechainR.begin() + n, 0.0f);
    }
}

void MixerTrackNode::addInput (const float* const* inputs, int numInputs, int n) noexcept
{
    const int channels = inputChannels.load (std::memory_order_relaxed);
    const int first = inputFirst.load (std::memory_order_relaxed);
    if (channels == 0 || first < 0 || first >= numInputs || inputs == nullptr)
        return;
    const float* a = inputs[first];
    const float* b = channels == 2 && first + 1 < numInputs ? inputs[first + 1] : a;
    if (a == nullptr || b == nullptr)
        return;
    // Mono inputs are up-mixed L = R = M (Web Audio speaker up-mix).
    for (int i = 0; i < n; ++i)
    {
        busL[(size_t) i] += a[i];
        busR[(size_t) i] += b[i];
    }
}

void MixerTrackNode::process (const BlockContext& ctx, const std::vector<Effect*>& chain, bool sidechain) noexcept
{
    const int n = ctx.numSamples;
    float* l = busL.data();
    float* r = busR.data();

    for (auto* fx : chain)
    {
        fx->sidechainLeft = sidechain ? sidechainL.data() : nullptr;
        fx->sidechainRight = sidechain ? sidechainR.data() : nullptr;
        fx->process (ctx, l, r);
    }

    const float muteTarget = audible.load (std::memory_order_relaxed);
    double lastPan = panValue.current() + 10.0;
    dsp::PanGains gains;

    for (int c = 0; c < ctx.numChunks; ++c)
    {
        const int c0 = c * chunkSize, c1 = std::min (n, c0 + chunkSize);
        panValue.setTarget (pan.value (ctx, c));
        faderGain.setTarget (volumeToGain (volume.value (ctx, c)));
        muteGain.setTarget (muteTarget);
        for (int i = c0; i < c1; ++i)
        {
            const double p = panValue.next();
            if (dsp::differs (p, lastPan))
            {
                gains = dsp::stereoPanGains (p);
                lastPan = p;
            }
            float ol, or_;
            dsp::stereoPan (p, gains, l[i], r[i], ol, or_);
            const float g = faderGain.next() * muteGain.next();
            ol *= g;
            or_ *= g;
            l[i] = std::isfinite (ol) ? ol : 0.0f;
            r[i] = std::isfinite (or_) ? or_ : 0.0f;
        }
    }

    peakL.push (l, n);
    peakR.push (r, n);
}

//==============================================================================
void RouteNode::prepare (double sampleRate)
{
    if (prepared)
        return;
    gain.prepare (sampleRate, 0.01);
    gain.reset (volumeToGain (level.getBase()));
    prepared = true;
}

void RouteNode::addTo (const BlockContext& ctx, const float* srcL, const float* srcR, float* destL, float* destR) noexcept
{
    const int n = ctx.numSamples;
    for (int c = 0; c < ctx.numChunks; ++c)
    {
        const int c0 = c * chunkSize, c1 = std::min (n, c0 + chunkSize);
        gain.setTarget (volumeToGain (level.value (ctx, c)));
        for (int i = c0; i < c1; ++i)
        {
            const float g = gain.next();
            destL[i] += srcL[i] * g;
            destR[i] += srcR[i] * g;
        }
    }
}

} // namespace mad
