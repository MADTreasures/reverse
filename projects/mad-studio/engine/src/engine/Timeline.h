#pragma once

#include "engine/Params.h"

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

/** A slide note's pitch movement of a sounding note (timeline.ts PitchBend). */
struct TimelineBend
{
    double at = 0.0, length = 0.0; // ticks after the note start, ticks the glide takes
    float to = 0.0f;               // semitones relative to the note's key
};

/** Audio clip instance properties of a timeline event (model/clips.ts; ticks for the fades). */
struct TimelineClip
{
    int32_t sample = -1; // index into Timeline::samples, -1: the channel's own sample
    float gain = 1.0f;
    double fadeIn = 0.0, fadeOut = 0.0;
    float fadeInTension = 0.0f, fadeOutTension = 0.0f;
};

struct TimelineEvent
{
    double tick = 0.0, length = 0.0;
    uint32_t channel = 0;
    int key = 60;
    float velocity = 0.8f;
    double sampleOffset = 0.0; // ticks into the sample (audio clips)
    bool audioClip = false;
    NoteProps props;
    uint32_t bendFirst = 0, bendCount = 0; // into Timeline::bends
    TimelineClip clip;
};

/** Compiled note events from timeline.set (sorted by tick). */
struct Timeline
{
    bool songMode = false;
    double loopStart = 0.0, loopEnd = 384.0;
    std::vector<TimelineEvent> events;
    std::vector<TimelineBend> bends;
    /** Sample variants the audio clips play (TimelineClip::sample). */
    std::vector<juce::String> samples;

    /** Index of the first event with tick >= t. */
    size_t firstAtOrAfter (double t) const noexcept;
};

Timeline parseTimeline (const juce::var& json, ChannelIds& ids);
/** The note properties of a timeline event's JSON. */
void parseNoteProps (const juce::var& event, NoteProps& props);

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
