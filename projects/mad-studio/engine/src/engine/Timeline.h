#pragma once

#include "engine/Params.h"

#include <juce_core/juce_core.h>

#include <cmath>
#include <cstdint>
#include <limits>
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

/** A time signature from `tick` on (markers.ts Signature). */
struct TimeSignature
{
    double tick = 0.0;
    int numerator = 4, denominator = 4;
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
    /** Time signature map for the metronome (empty: the project's beats per bar). */
    std::vector<TimeSignature> signatures;

    /** Index of the first event with tick >= t. */
    size_t firstAtOrAfter (double t) const noexcept;
};

Timeline parseTimeline (const juce::var& json, ChannelIds& ids);

/** markers.ts beatsIn(): calls fn(tick, accent) for every beat of the signature map in [from, to). */
template <typename Fn>
void forEachBeat (const std::vector<TimeSignature>& map, double from, double to, Fn&& fn)
{
    if (map.empty())
        return;
    size_t i = 0;
    while (i + 1 < map.size() && map[i + 1].tick <= from)
        ++i;
    for (; i < map.size(); ++i)
    {
        const auto& sig = map[i];
        if (sig.tick >= to)
            break;
        const double end = i + 1 < map.size() ? map[i + 1].tick : std::numeric_limits<double>::infinity();
        const double beat = ppq * 4.0 / (double) sig.denominator;
        for (auto k = (int64_t) std::max (0.0, std::ceil ((from - sig.tick) / beat - 1.0e-9));; ++k)
        {
            const double tick = sig.tick + (double) k * beat;
            if (tick >= std::min (end, to) - 1.0e-9)
                break;
            fn (tick, k % sig.numerator == 0);
        }
    }
}
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
