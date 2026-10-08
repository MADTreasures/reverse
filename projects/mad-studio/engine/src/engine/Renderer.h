#pragma once

#include "engine/GraphBuilder.h"

#include <atomic>
#include <functional>

namespace mad
{

struct RenderRequest
{
    ProjectModel project;
    std::shared_ptr<const Timeline> timeline;
    std::shared_ptr<const AutomationData> automation;
    double sampleRate = 48000.0;
    int bitDepth = 24;
    double startTick = 0.0, endTick = -1.0; // endTick < 0: timeline loop end
    double tailSeconds = 2.0;
    int blockSize = 512;
    juce::File output;
};

struct RenderResult
{
    bool ok = false;
    juce::String error;
    double peak = 0.0;
    double seconds = 0.0;
    int64_t frames = 0;
    double elapsed = 0.0;
};

/** Renders song mode from startTick to endTick plus a tail into a WAV file, faster than real
    time, on the calling thread. Plugins come from `plugins` (borrowed live instances or
    synchronously created ones) and must be prepared for request.sampleRate/blockSize. */
RenderResult renderOffline (const RenderRequest& request, SampleStore& samples, ChannelIds& ids, PluginProvider* plugins,
                            const std::function<void (double fraction)>& progress, const std::atomic<bool>* cancel = nullptr);

/** Same, but returns the audio instead of writing a file (tests). */
RenderResult renderOfflineToBuffers (const RenderRequest& request, SampleStore& samples, ChannelIds& ids,
                                     PluginProvider* plugins, std::vector<float>& left, std::vector<float>& right);

} // namespace mad
