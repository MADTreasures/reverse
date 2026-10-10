#include "engine/Latency.h"

#include <algorithm>
#include <cmath>

namespace mad
{
namespace
{
int clampLatency (int v) noexcept { return std::clamp (v, 0, maxCompensation); }

int sumOf (const std::vector<int>& values) noexcept
{
    int64_t sum = 0;
    for (const int v : values)
        sum += clampLatency (v);
    return (int) std::min<int64_t> (sum, maxCompensation);
}
} // namespace

LatencyPlan planCompensation (const LatencyInput& in)
{
    LatencyPlan p;
    const int numTracks = (int) in.tracks.size();
    p.channelDelay.assign (in.channels.size(), 0);
    p.trackDelay.assign ((size_t) numTracks, 0);
    p.routeDelay.assign ((size_t) numTracks, {});
    p.trackInput.assign ((size_t) numTracks, 0);
    p.trackLatency.assign ((size_t) numTracks, 0);
    if (numTracks == 0)
        return p;

    const auto trackOf = [numTracks] (const LatencyInput::Channel& c) { return std::clamp (c.track, 0, numTracks - 1); };
    const auto latencyOf = [&in] (int v) { return in.automatic ? clampLatency (v) : 0; };
    const auto valid = [numTracks] (const LatencyInput::Route& r) { return r.to >= 0 && r.to < numTracks; };

    // Processing order (routing.ts processingOrder): senders before their targets, the master last.
    std::vector<int> incoming ((size_t) numTracks, 0), order;
    std::vector<bool> done ((size_t) numTracks, false);
    for (int t = 1; t < numTracks; ++t)
        for (const auto& r : in.tracks[(size_t) t].sends (t))
            if (valid (r))
                ++incoming[(size_t) r.to];
    for (int k = 0; k < numTracks; ++k)
    {
        int next = -1;
        for (int t = 1; t < numTracks && next < 0; ++t)
            if (! done[(size_t) t] && incoming[(size_t) t] == 0)
                next = t;
        if (next < 0)
            break;
        done[(size_t) next] = true;
        order.push_back (next);
        for (const auto& r : in.tracks[(size_t) next].sends (next))
            if (valid (r))
                --incoming[(size_t) r.to];
    }
    for (int t = 1; t < numTracks; ++t)
        if (! done[(size_t) t])
            order.push_back (t);

    // Every track input is aligned to its slowest channel ...
    std::vector<int64_t> input ((size_t) numTracks, 0);
    for (const auto& c : in.channels)
    {
        auto& v = input[(size_t) trackOf (c)];
        v = std::max<int64_t> (v, latencyOf (c.latency));
    }
    // ... and to its slowest send. A manual offset shifts a track against the others (> 0: its sends
    // are delayed more, < 0: the other inputs of its targets wait for it).
    std::vector<int64_t> out ((size_t) numTracks, 0);
    for (const int t : order)
    {
        const auto& track = in.tracks[(size_t) t];
        input[(size_t) t] = std::clamp<int64_t> (input[(size_t) t], 0, maxCompensation);
        const int effects = in.automatic ? sumOf (track.effects) : 0;
        p.trackLatency[(size_t) t] = (int) std::min<int64_t> (maxCompensation, input[(size_t) t] + effects);
        out[(size_t) t] = (int64_t) p.trackLatency[(size_t) t] - std::clamp (track.offset, -maxCompensation, maxCompensation);
        for (const auto& r : track.sends (t))
            if (valid (r))
                input[(size_t) r.to] = std::max (input[(size_t) r.to], out[(size_t) t]);
    }
    for (int t = 0; t < numTracks; ++t)
        p.trackInput[(size_t) t] = (int) std::clamp<int64_t> (input[(size_t) t], 0, maxCompensation);
    p.masterInput = p.trackInput[0];

    for (size_t i = 0; i < in.channels.size(); ++i)
    {
        const auto& c = in.channels[i];
        p.channelDelay[i] = std::clamp (p.trackInput[(size_t) trackOf (c)] - latencyOf (c.latency), 0, maxCompensation);
    }
    for (int t = 1; t < numTracks; ++t)
    {
        for (const auto& r : in.tracks[(size_t) t].sends (t))
        {
            const int delay = valid (r) ? (int) std::clamp<int64_t> (p.trackInput[(size_t) r.to] - out[(size_t) t], 0, maxCompensation) : 0;
            p.routeDelay[(size_t) t].push_back (delay);
            if (r.to == 0 && ! r.sidechain)
                p.trackDelay[(size_t) t] = delay;
        }
    }

    const int masterEffects = in.automatic ? sumOf (in.tracks[0].effects) : 0;
    p.trackLatency[0] = std::min (maxCompensation, p.masterInput + masterEffects);
    p.total = p.trackLatency[0];
    return p;
}

int LatencyPlan::automationOffset (const LatencyInput& in, int track, int effect) const
{
    if (! in.automatic || track < 0 || track >= (int) trackInput.size() || track >= (int) in.tracks.size())
        return 0;
    int64_t offset = trackInput[(size_t) track];
    const auto& effects = in.tracks[(size_t) track].effects;
    for (int i = 0; i < effect && i < (int) effects.size(); ++i)
        offset += clampLatency (effects[(size_t) i]);
    return (int) std::min<int64_t> (offset, maxCompensation);
}

//==============================================================================
CompensationDelay::CompensationDelay (int channels, int maxDelaySamples)
    : numChannels (std::clamp (channels, 1, 2)), maxDelay (std::clamp (maxDelaySamples, 0, maxCompensation))
{
    int size = 1;
    while (size <= maxDelay)
        size <<= 1;
    mask = size - 1;
    buffer.assign ((size_t) size * (size_t) numChannels, 0.0f);
}

void CompensationDelay::process (float* const* channels, int n, int delay) noexcept
{
    delay = std::clamp (delay, 0, maxDelay);
    bool silent = true;
    for (int i = 0; i < n; ++i)
    {
        const auto w = (size_t) write * (size_t) numChannels;
        const auto r = (size_t) ((write - delay) & mask) * (size_t) numChannels;
        for (int c = 0; c < numChannels; ++c)
        {
            float* x = channels[c];
            const float in = x[i];
            silent = silent && std::abs (in) <= 1.0e-20f;
            buffer[w + (size_t) c] = in;
            x[i] = buffer[r + (size_t) c];
        }
        write = (write + 1) & mask;
    }
    quietRun = silent ? quietRun + n : 0;
}

} // namespace mad
