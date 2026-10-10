#pragma once

#include <juce_core/juce_core.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <limits>
#include <vector>

namespace mad
{

inline constexpr double ppq = 96.0;
/** Automation and parameter updates happen at least every chunkSize samples. */
inline constexpr int chunkSize = 32;
inline constexpr int maxBlockSize = 2048;
inline constexpr int maxChunks = maxBlockSize / chunkSize;
inline constexpr int maxMixerTracks = 128;

inline double volumeToGain (double position) noexcept
{
    const double p = std::max (0.0, position);
    return (p / 0.8) * (p / 0.8);
}

inline double midiToHz (double key) noexcept { return 440.0 * std::pow (2.0, (key - 69.0) / 12.0); }
inline double dbToGain (double db) noexcept { return std::pow (10.0, db / 20.0); }

inline bool differs (float a, float b) noexcept { return a < b || b < a; }

//==============================================================================
/** Information shared by every processor for one engine block. */
struct BlockContext
{
    double sampleRate = 48000.0;
    int numSamples = 0;
    int numChunks = 0;
    int64_t blockStart = 0; // absolute sample time of sample 0
    uint64_t blockIndex = 1;
    std::array<double, maxChunks> bpm {}; // effective tempo of each chunk

    int chunkOf (int offset) const noexcept { return std::clamp (offset / chunkSize, 0, std::max (0, numChunks - 1)); }
};

//==============================================================================
/** A project value the audio thread reads. The message thread sets the base value from
    project.sync; automation (song mode) overrides it per chunk. An override stays in effect
    after the transport stops until the base value changes (or the lane disappears). */
class AutoParam
{
public:
    explicit AutoParam (float initial = 0.0f) noexcept : base (initial) {}

    // ---- message thread ----------------------------------------------------------------
    /** Sets the project value; a changed value cancels a persisted automation override. */
    void setBase (float v) noexcept
    {
        if (! std::isfinite (v))
            return;
        if (differs (base.load (std::memory_order_relaxed), v))
        {
            base.store (v, std::memory_order_relaxed);
            resetRequests.fetch_add (1, std::memory_order_release);
        }
    }

    /** Cancels a persisted override (the automation lane was removed). */
    void requestOverrideReset() noexcept { resetRequests.fetch_add (1, std::memory_order_release); }

    float getBase() const noexcept { return base.load (std::memory_order_relaxed); }

    // ---- audio thread --------------------------------------------------------------------
    float value (const BlockContext& ctx, int chunk) const noexcept
    {
        if (automatedBlock == ctx.blockIndex)
            return chunkValues[(size_t) chunk];
        return overrideOrBase();
    }

    /** Value outside block processing (e.g. while handling a command). */
    float overrideOrBase() const noexcept
    {
        if (overrideActive)
        {
            const auto r = resetRequests.load (std::memory_order_acquire);
            if (r == seenResets)
                return overrideValue;
            seenResets = r;
            overrideActive = false;
        }
        return base.load (std::memory_order_relaxed);
    }

    // Automation writer (AutomationRunner) ---------------------------------------------
    struct OverrideState
    {
        bool active = false;
        float value = 0.0f;
    };

    OverrideState beginAutomation (const BlockContext& ctx) noexcept
    {
        overrideOrBase(); // applies pending resets
        automatedBlock = ctx.blockIndex;
        return { overrideActive, overrideValue };
    }

    void setChunk (int chunk, const OverrideState& s) noexcept
    {
        chunkValues[(size_t) chunk] = s.active ? s.value : base.load (std::memory_order_relaxed);
    }

    void endAutomation (const OverrideState& s) noexcept
    {
        overrideActive = s.active;
        overrideValue = s.value;
        seenResets = resetRequests.load (std::memory_order_acquire);
    }

private:
    std::atomic<float> base;
    std::atomic<uint32_t> resetRequests { 0 };
    mutable uint32_t seenResets = 0;
    mutable bool overrideActive = false;
    float overrideValue = 0.0f;
    uint64_t automatedBlock = 0;
    std::array<float, maxChunks> chunkValues {};
};

//==============================================================================
/** Note properties of a sequenced note (model/notes.ts; the defaults have no effect). */
struct NoteProps
{
    float release = 0.5f, pan = 0.0f, fine = 0.0f, modX = 0.5f, modY = 0.5f;
    int color = 0;            // colour group 0..15 (plugins: MIDI channel color + 1)
    float glideFrom = 0.0f;   // portamento: semitones away from the key at the start
    float glideTime = 0.1f;   // seconds (notes.ts DEFAULT_GLIDE_TIME)
};

/** A slide note's pitch movement, converted to seconds after the note start. */
struct NoteBend
{
    float start = 0.0f, duration = 0.0f;
    float to = 0.0f; // semitones relative to the key
};

inline constexpr int maxNoteBends = 8;

/** A note event for one channel inside the current block. */
struct SampleData;

/** Audio clip instance (model/clips.ts): clip gain and fades in seconds. */
struct ClipShape
{
    bool active = false;
    float gain = 1.0f;
    double fadeIn = 0.0, fadeOut = 0.0;
    float fadeInTension = 0.0f, fadeOutTension = 0.0f;
};

struct NoteEvent
{
    enum class Kind : uint8_t
    {
        noteOn,
        noteOff, // live note-off for `handle`
    };

    Kind kind = Kind::noteOn;
    int offset = 0;          // first sample of the block at or after the event time
    double time = 0.0;       // exact absolute event time in samples (fractional)
    uint32_t channel = 0;    // channel uid
    int key = 60;
    float velocity = 0.8f;
    double lengthSeconds = -1.0; // < 0: open (live) note
    double clipOffsetSeconds = 0.0;
    bool audioClip = false;
    int32_t handle = 0;      // live notes
    NoteProps props;
    int numBends = 0;
    std::array<NoteBend, maxNoteBends> bends {};
    /** Audio clips: a sample variant instead of the channel's sample (and its reversed copy, when
        the channel plays reversed), plus the clip's gain and fades. */
    bool sampleOverride = false;
    const SampleData* sample = nullptr;
    const SampleData* sampleReversed = nullptr;
    ClipShape clip;
};

//==============================================================================
// Parameter tables (paths as used by automation targets "ch:<id>:synth.<path>" etc.)

namespace synth
{
enum Param : int
{
    gain,
    filterEnabled,
    filterType,
    cutoff,
    resonance,
    envAmount,
    keyTrack,
    ampAttack, ampDecay, ampSustain, ampRelease,
    filterAttack, filterDecay, filterSustain, filterRelease,
    lfoTarget,
    lfoRate,
    lfoDepth,
    oscBase,
    oscStride = 7, // wave, level, coarse, fine, unison, detune, pan
    numParams = oscBase + 3 * oscStride
};

enum OscField : int
{
    wave, level, coarse, fine, unison, detune, pan
};

inline constexpr int osc (int index, OscField field) noexcept
{
    return (int) oscBase + index * (int) oscStride + (int) field;
}

/** "gain", "filter.cutoff", "osc.1.level", … → parameter index (or -1). */
int indexForPath (const juce::String& path);
float defaultValue (int index);
} // namespace synth

namespace sampler
{
enum Param : int
{
    gain,
    rootKey,
    fine,
    keyTrack,
    reverse,
    oneShot,
    loop,
    start,
    ampAttack, ampDecay, ampSustain, ampRelease,
    chokeGroup,
    cutSelf,
    numParams
};

int indexForPath (const juce::String& path);
float defaultValue (int index);
} // namespace sampler

//==============================================================================
/** model/effects.ts EFFECT_SPECS (keys and defaults; values are used unclamped like the TS). */
struct EffectParamSpec
{
    const char* key;
    float min, max, def;
};

struct EffectSpec
{
    const char* type;
    std::vector<EffectParamSpec> params;

    int indexOf (const juce::String& key) const;
};

const EffectSpec* findEffectSpec (const juce::String& type);

/** DELAY_DIVISION_BEATS. */
inline constexpr std::array<double, 11> delayDivisionBeats { 0.125, 0.25, 0.375, 1.0 / 3.0, 0.5, 0.75, 2.0 / 3.0,
                                                             1.0, 1.5, 2.0, 4.0 };

} // namespace mad
