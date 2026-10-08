#pragma once

#include <juce_core/juce_core.h>

#include <atomic>
#include <map>
#include <memory>
#include <mutex>
#include <vector>

namespace mad
{

/** Decoded PCM of one sample (deinterleaved float). Voices "pin" it while playing; the
    memory is only released once no voice references it. */
struct SampleData
{
    juce::String id;
    int numChannels = 1;
    int64_t numFrames = 0;
    double sampleRate = 48000.0;
    std::vector<float> channels[2];

    mutable std::atomic<int> pins { 0 };

    const float* channel (int c) const noexcept { return channels[c < numChannels ? c : 0].data(); }
    double durationSeconds() const noexcept { return sampleRate > 0.0 ? (double) numFrames / sampleRate : 0.0; }
};

using SamplePtr = std::shared_ptr<const SampleData>;

/** Creates a SamplePtr whose deleter defers the delete while voices still pin it. */
SamplePtr makeSamplePtr (std::unique_ptr<SampleData> data);

/** Frees samples whose last reference went away while they were still pinned.
    Call periodically (any thread). */
void collectSampleGarbage();

//==============================================================================
/** Samples by id (thread-safe; normally used from the message thread). */
class SampleStore
{
public:
    /** Reads raw interleaved little-endian float32 PCM (samples.loadRaw). */
    juce::Result loadRaw (const juce::String& id, const juce::File& file, double sampleRate, int numChannels,
                          int64_t numFrames);

    /** Adds already decoded data (tests, render jobs). */
    void add (std::unique_ptr<SampleData> data);

    void unload (const juce::String& id);

    /** The sample, or its reversed copy (created and cached on demand). */
    SamplePtr get (const juce::String& id, bool reversed = false);

    /** Bumped whenever a sample is added, replaced or removed. */
    uint64_t revision() const noexcept { return rev.load(); }

    std::vector<juce::String> ids() const;

private:
    mutable std::mutex mutex;
    std::map<juce::String, SamplePtr> forward, reversedCache;
    std::atomic<uint64_t> rev { 1 };
};

} // namespace mad
