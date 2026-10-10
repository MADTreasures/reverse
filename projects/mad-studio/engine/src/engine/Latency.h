#pragma once

// Plugin delay compensation (PDC), like FL Studio's automatic PDC: plugins that report latency
// delay their audio, so every other signal path is delayed by the difference and everything
// meets in time at the mixer track inputs and at the master input.

#include <cstdint>
#include <vector>

namespace mad
{

/** Upper bound for every latency and compensation delay (samples). */
inline constexpr int maxCompensation = 1 << 19;

struct LatencyInput
{
    struct Channel
    {
        int track = 0;   // mixer track the channel feeds (0 = master)
        int latency = 0; // latency of its instrument (plugin report + manual offset)
    };
    struct Route
    {
        int to = 0;             // target track
        bool sidechain = false; // feeds the target's sidechain input (aligned like its mix)

        bool operator== (const Route& o) const { return to == o.to && sidechain == o.sidechain; }
    };
    struct Track
    {
        std::vector<int> effects; // latency of each enabled insert, in chain order
        int offset = 0;           // manual offset: > 0 delays this track, < 0 delays all others
        /** False: the default send to the master; true: exactly `routes`. */
        bool routed = false;
        std::vector<Route> routes;

        /** The sends of track `index` (the master sends nowhere). */
        std::vector<Route> sends (int index) const
        {
            if (index <= 0)
                return {};
            return routed ? routes : std::vector<Route> { Route {} };
        }
    };

    bool automatic = true; // false: only the manual offsets apply
    std::vector<Channel> channels;
    std::vector<Track> tracks; // index 0 = master

    bool operator== (const LatencyInput& o) const
    {
        if (automatic != o.automatic || channels.size() != o.channels.size() || tracks.size() != o.tracks.size())
            return false;
        for (size_t i = 0; i < channels.size(); ++i)
            if (channels[i].track != o.channels[i].track || channels[i].latency != o.channels[i].latency)
                return false;
        for (size_t i = 0; i < tracks.size(); ++i)
            if (tracks[i].effects != o.tracks[i].effects || tracks[i].offset != o.tracks[i].offset
                || tracks[i].sends ((int) i) != o.tracks[i].sends ((int) i))
                return false;
        return true;
    }
    bool operator!= (const LatencyInput& o) const { return ! (*this == o); }
};

struct LatencyPlan
{
    std::vector<int> channelDelay; // delay of each channel before its track bus
    std::vector<int> trackDelay;   // delay of each track's send to the master (master and unrouted: 0)
    std::vector<std::vector<int>> routeDelay; // delay of each send of each track (Track::sends order)
    std::vector<int> trackInput;   // latency of the aligned signal entering each track
    std::vector<int> trackLatency; // latency each track has detected (inputs + inserts)
    int masterInput = 0;           // latency of the aligned signal entering the master
    int total = 0;                 // how far the output lags behind the transport

    /** Latency of the audio reaching insert `effect` of `track` (effect == number of inserts:
        the fader), i.e. how much later than the transport its automation must be applied. */
    int automationOffset (const LatencyInput& in, int track, int effect) const;

    bool operator== (const LatencyPlan& o) const
    {
        return channelDelay == o.channelDelay && trackDelay == o.trackDelay && routeDelay == o.routeDelay && trackInput == o.trackInput
               && trackLatency == o.trackLatency && masterInput == o.masterInput && total == o.total;
    }
    bool operator!= (const LatencyPlan& o) const { return ! (*this == o); }
};

/** Computes the compensation delays along the mixer routing: every track input waits for its
    slowest channel or send, the sends of faster tracks are delayed. Pure function (unit-tested in
    the self-test). */
LatencyPlan planCompensation (const LatencyInput& in);

//==============================================================================
/** A fixed delay for compensation (1 or 2 channels). Allocated on the message thread,
    processed on the audio thread; the delay amount may change between blocks. */
class CompensationDelay
{
public:
    CompensationDelay (int numChannels, int maxDelay);

    int capacity() const noexcept { return maxDelay; }

    /** Delays `n` samples in place by `delay` (<= capacity()). */
    void process (float* const* channels, int n, int delay) noexcept;

    /** True when every sample still inside the delay is silent (nothing left to play). */
    bool isQuiet (int delay) const noexcept { return quietRun > (int64_t) delay; }

private:
    const int numChannels, maxDelay;
    int mask = 0, write = 0;
    int64_t quietRun = 0;
    std::vector<float> buffer; // channel-interleaved ring
};

} // namespace mad
