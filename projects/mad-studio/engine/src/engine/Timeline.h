#pragma once

#include <juce_core/juce_core.h>

#include <cstdint>
#include <map>
#include <mutex>
#include <vector>

namespace mad
{

/** Maps channel id strings to small integers used on the audio thread (thread-safe). */
class ChannelIds
{
public:
    uint32_t uidFor (const juce::String& id);

private:
    std::mutex mutex;
    std::map<juce::String, uint32_t> ids;
    uint32_t next = 1;
};

struct TimelineEvent
{
    double tick = 0.0, length = 0.0;
    uint32_t channel = 0;
    int key = 60;
    float velocity = 0.8f;
    double sampleOffset = 0.0; // ticks into the sample (audio clips)
    bool audioClip = false;
};

/** Compiled note events from timeline.set (sorted by tick). */
struct Timeline
{
    bool songMode = false;
    double loopStart = 0.0, loopEnd = 384.0;
    std::vector<TimelineEvent> events;

    /** Index of the first event with tick >= t. */
    size_t firstAtOrAfter (double t) const noexcept;
};

Timeline parseTimeline (const juce::var& json, ChannelIds& ids);

//==============================================================================
/** One compiled automation lane: piecewise linear points in absolute song ticks. */
struct AutomationLane
{
    juce::String target;
    std::vector<std::pair<double, double>> points; // sorted by tick

    /** Value at `tick`; false before the first point (no override). */
    bool evaluate (double tick, double& value) const noexcept;
};

struct AutomationData
{
    std::vector<AutomationLane> lanes;
};

AutomationData parseAutomation (const juce::var& json);

} // namespace mad
