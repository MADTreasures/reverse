#pragma once

#include "dsp/Panner.h"
#include "dsp/Smoother.h"
#include "engine/Effects.h"
#include "engine/Instruments.h"
#include "engine/Latency.h"
#include "engine/ProjectModel.h"
#include "engine/Timeline.h"

#include <atomic>
#include <memory>
#include <vector>

namespace mad
{

/** Peak of |x| over (at least) the last 1024 samples, like an AnalyserNode with fftSize 1024. */
class PeakWindow
{
public:
    void push (const float* data, int n) noexcept;
    float peak() const noexcept;
    void reset() noexcept;

private:
    static constexpr int slots = 32; // 32 x 32 samples
    std::array<float, slots> chunkPeaks {};
    int position = 0, fill = 0;
    float current = 0.0f;
};

//==============================================================================
/** Instrument + channel volume (volumeToGain), pan (mono/stereo law) and mute. */
class ChannelNode
{
public:
    ChannelNode (uint32_t uid, juce::String id, ChannelKind kind, std::unique_ptr<Instrument> instrument);

    const uint32_t uid;
    const juce::String id;
    const ChannelKind kind;
    const std::unique_ptr<Instrument> instrument;

    AutoParam volume { 0.8f }, pan { 0.0f };
    std::atomic<bool> muted { false };
    /** Absolute sample time of the most recent note (activity LEDs). */
    std::atomic<int64_t> lastTrigger { std::numeric_limits<int64_t>::min() };

    /** Message thread, before publishing. */
    void prepare (double sampleRate, int maxBlock);

    /** Audio thread: renders the instrument and adds the strip output to the bus, delayed by
        `delaySamples` for plugin delay compensation when `delay` is set. */
    void process (const BlockContext& ctx, float* busL, float* busR, CompensationDelay* delay = nullptr,
                  int delaySamples = 0) noexcept;

private:
    dsp::OnePole volumeGain, panValue, muteGain;
    std::vector<float> bufL, bufR;
};

//==============================================================================
/** Mixer track: input bus -> effects -> pan (stereo law) -> fader -> mute -> meters. */
class MixerTrackNode
{
public:
    explicit MixerTrackNode (int index);

    const int index;
    AutoParam volume { 0.8f }, pan { 0.0f };
    /** 0 when muted or soloed out, else 1 (smoothed on the audio thread). */
    std::atomic<float> audible { 1.0f };
    /** Recording/monitoring input routing. */
    std::atomic<int> inputChannels { 0 }, inputFirst { 0 };
    std::atomic<bool> monitor { false };

    std::vector<float> busL, busR;
    /** Sidechain input (sends marked "sidechain"); only cleared and used when something feeds it. */
    std::vector<float> sidechainL, sidechainR;

    void prepare (double sampleRate, int maxBlock);
    void clearBus (int n, bool sidechain = false) noexcept;
    void addInput (const float* const* inputs, int numInputs, int n) noexcept;
    void process (const BlockContext& ctx, const std::vector<Effect*>& chain, bool sidechain = false) noexcept;

    float peakLeft() const noexcept { return peakL.peak(); }
    float peakRight() const noexcept { return peakR.peak(); }

private:
    dsp::OnePole panValue, faderGain, muteGain;
    PeakWindow peakL, peakR;
};

//==============================================================================
/** A mixer send: level (knob position, volumeToGain) with smoothing that survives graph rebuilds. */
class RouteNode
{
public:
    AutoParam level { 0.8f };

    void prepare (double sampleRate);

    /** Adds `src` × the send gain to `dest` (both stereo, n samples). */
    void addTo (const BlockContext& ctx, const float* srcL, const float* srcR, float* destL, float* destR) noexcept;

private:
    dsp::OnePole gain;
    bool prepared = false;
};

//==============================================================================
/** Automation lanes bound to the parameters of one graph. */
struct AutomationBinding
{
    struct Entry
    {
        const AutomationLane* lane = nullptr;
        AutoParam* param = nullptr;
        PluginSlot* plugin = nullptr;
        int pluginParam = -1;
        /** Plugin delay compensation: the audio reaching this parameter lags the transport by
            this many samples, so the lane is read that much earlier. */
        double offsetSamples = 0.0;
        // audio-thread scratch
        AutoParam::OverrideState state;
        float lastPluginValue = -1.0f;
    };

    std::shared_ptr<const AutomationData> data;
    std::vector<Entry> entries;
};

/** Everything the audio thread needs for one version of the project. Immutable once
    published (except audio-thread scratch inside the nodes). */
struct GraphSnapshot
{
    struct ChannelEntry
    {
        ChannelNode* node = nullptr;
        int track = 0;
        CompensationDelay* delay = nullptr; // plugin delay compensation before the track bus
        int delaySamples = 0;
    };
    struct RouteEntry
    {
        int to = 0;
        bool sidechain = false;
        RouteNode* node = nullptr;
        CompensationDelay* delay = nullptr; // plugin delay compensation of this send
        int delaySamples = 0;
    };
    struct TrackEntry
    {
        MixerTrackNode* node = nullptr;
        std::vector<Effect*> chain;
        std::vector<RouteEntry> routes; // sends (the master has none)
        bool sidechainFed = false;      // something sends sidechain audio to this track
    };

    std::vector<ChannelEntry> channels;
    std::vector<TrackEntry> tracks; // index 0 = master
    /** Track indices in processing order (senders before targets, the master last). */
    std::vector<int> order;
    std::shared_ptr<const Timeline> timeline;
    std::unique_ptr<AutomationBinding> automation;
    /** How far the output lags behind the transport (plugin delay compensation); the
        metronome is delayed by it to stay in time with the music. */
    int latency = 0;
    CompensationDelay* clickDelay = nullptr;

    /** Owns the nodes, effects, samples and plugin slots referenced above. */
    std::vector<std::shared_ptr<void>> keepAlive;

    ChannelNode* findChannel (uint32_t uid) const noexcept
    {
        for (const auto& c : channels)
            if (c.node->uid == uid)
                return c.node;
        return nullptr;
    }
};

} // namespace mad
