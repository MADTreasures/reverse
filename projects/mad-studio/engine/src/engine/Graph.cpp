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

void ChannelNode::process (const BlockContext& ctx, float* busL, float* busR) noexcept
{
    const int n = ctx.numSamples;
    const bool idle = instrument->isIdle();
    const bool stereo = instrument->render (ctx, bufL.data(), bufR.data());
    const float muteTarget = muted.load (std::memory_order_relaxed) ? 0.0f : 1.0f;

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
        return;
    }

    const float* inL = bufL.data();
    const float* inR = bufR.data();
    double lastPan = panValue.current() + 10.0;
    dsp::PanGains gains;

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
                lastPan = p;
            }
            if (stereo)
            {
                float l, r;
                dsp::stereoPan (p, gains, inL[i] * g, inR[i] * g, l, r);
                busL[i] += l;
                busR[i] += r;
            }
            else
            {
                const float m = inL[i] * g;
                busL[i] += m * gains.left;
                busR[i] += m * gains.right;
            }
        }
    }
}

//==============================================================================
MixerTrackNode::MixerTrackNode (int i) : index (i) {}

void MixerTrackNode::prepare (double sampleRate, int maxBlock)
{
    for (auto* s : { &panValue, &faderGain, &muteGain })
        s->prepare (sampleRate, 0.01);
    busL.assign ((size_t) maxBlock, 0.0f);
    busR.assign ((size_t) maxBlock, 0.0f);
    peakL.reset();
    peakR.reset();
}

void MixerTrackNode::clearBus (int n) noexcept
{
    std::fill (busL.begin(), busL.begin() + n, 0.0f);
    std::fill (busR.begin(), busR.begin() + n, 0.0f);
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

void MixerTrackNode::process (const BlockContext& ctx, const std::vector<Effect*>& chain) noexcept
{
    const int n = ctx.numSamples;
    float* l = busL.data();
    float* r = busR.data();

    for (auto* fx : chain)
        fx->process (ctx, l, r);

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

} // namespace mad
