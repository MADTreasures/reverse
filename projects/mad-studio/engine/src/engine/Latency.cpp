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
    p.trackInput.assign ((size_t) numTracks, 0);
    p.trackLatency.assign ((size_t) numTracks, 0);
    if (numTracks == 0)
        return p;

    const auto trackOf = [numTracks] (const LatencyInput::Channel& c) { return std::clamp (c.track, 0, numTracks - 1); };
    const auto latencyOf = [&in] (int v) { return in.automatic ? clampLatency (v) : 0; };

    // Every track input is aligned to its slowest channel.
    for (const auto& c : in.channels)
    {
        auto& input = p.trackInput[(size_t) trackOf (c)];
        input = std::max (input, latencyOf (c.latency));
    }

    // The tracks meet at the master input (channels routed to the master meet them there too);
    // a manual offset shifts a track against the others.
    int64_t master = p.trackInput[0];
    std::vector<int64_t> align ((size_t) numTracks, 0);
    for (int t = 1; t < numTracks; ++t)
    {
        const auto& track = in.tracks[(size_t) t];
        const int effects = in.automatic ? sumOf (track.effects) : 0;
        p.trackLatency[(size_t) t] = std::min (maxCompensation, p.trackInput[(size_t) t] + effects);
        align[(size_t) t] = (int64_t) p.trackLatency[(size_t) t] - std::clamp (track.offset, -maxCompensation, maxCompensation);
        master = std::max (master, align[(size_t) t]);
    }
    master = std::clamp<int64_t> (master, 0, maxCompensation);
    p.masterInput = (int) master;
    p.trackInput[0] = p.masterInput;

    for (size_t i = 0; i < in.channels.size(); ++i)
    {
        const auto& c = in.channels[i];
        p.channelDelay[i] = std::clamp (p.trackInput[(size_t) trackOf (c)] - latencyOf (c.latency), 0, maxCompensation);
    }
    for (int t = 1; t < numTracks; ++t)
        p.trackDelay[(size_t) t] = (int) std::clamp<int64_t> (master - align[(size_t) t], 0, maxCompensation);

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
