#include "engine/Renderer.h"

#include "engine/Wav.h"

#include <juce_audio_formats/juce_audio_formats.h>

#include <cmath>

namespace mad
{
namespace
{
template <typename Sink>
RenderResult runRender (const RenderRequest& request, SampleStore& samples, ChannelIds& ids, PluginProvider* plugins,
                        const std::function<void (double)>& progress, const std::atomic<bool>* cancel, Sink&& sink)
{
    RenderResult result;
    const auto started = juce::Time::getMillisecondCounterHiRes();
    const double rate = request.sampleRate;
    const int block = std::clamp (request.blockSize, 32, maxBlockSize);

    AudioEngine engine (true);
    engine.prepare (rate, block);

    // Song mode: automation applies, no looping.
    auto timeline = std::make_shared<Timeline> (request.timeline != nullptr ? *request.timeline : Timeline());
    timeline->songMode = true;
    const double endTick = request.endTick >= 0.0 ? request.endTick : timeline->loopEnd;
    const double startTick = std::max (0.0, request.startTick);
    if (! (endTick > startTick))
    {
        result.error = "endTick must be greater than startTick";
        return result;
    }
    timeline->loopStart = 0.0;
    timeline->loopEnd = std::max (endTick + 1.0, timeline->loopEnd);

    {
        GraphBuilder builder (engine, samples, ids, plugins, true);
        builder.setTimeline (timeline);
        builder.setAutomation (request.automation);
        builder.setProject (request.project);

        engine.setBounded (endTick);
        EngineCommand play;
        play.type = EngineCommand::Type::play;
        play.tick = startTick;
        engine.post (play);

        // Plugin delay compensation delays the output: drop that much from the start and
        // render that much longer, so the file starts exactly at startTick.
        const int latency = builder.totalLatency();
        const double bpm = std::clamp (request.project.bpm, 10.0, 522.0);
        const double estimate = std::max (1.0, (endTick - startTick) * 60.0 / (bpm * ppq) * rate + request.tailSeconds * rate + latency);
        const auto tailFrames = (int64_t) std::ceil (std::max (0.0, request.tailSeconds) * rate);
        int64_t engineFrames = 0; // frames the engine has produced
        int64_t endFrame = -1;    // engine frame at which the output ends, once the end tick has been reached

        std::vector<float> left ((size_t) block), right ((size_t) block);
        float* outs[] = { left.data(), right.data() };
        double lastProgress = -1.0;

        for (;;)
        {
            if (cancel != nullptr && cancel->load())
            {
                result.error = "cancelled";
                return result;
            }

            engine.process (nullptr, 0, outs, 2, block);
            if (endFrame < 0 && engine.endReached())
                endFrame = engineFrames + engine.endOffset() + tailFrames + latency;

            // Output: the engine frames from `latency` up to `endFrame`.
            const int64_t from = std::max<int64_t> (engineFrames, latency);
            const int64_t to = endFrame >= 0 ? std::min<int64_t> (engineFrames + block, endFrame) : engineFrames + block;
            if (to > from)
            {
                const int first = (int) (from - engineFrames), frames = (int) (to - from);
                for (int i = first; i < first + frames; ++i)
                    result.peak = std::max (result.peak, (double) std::max (std::abs (left[(size_t) i]), std::abs (right[(size_t) i])));
                if (! sink (left.data() + first, right.data() + first, frames))
                {
                    result.error = "cannot write the output file";
                    return result;
                }
                result.frames += frames;
            }
            engineFrames += block;
            engine.snapshots.collectGarbage();

            const double fraction = std::min (0.99, (double) engineFrames / estimate);
            if (progress && fraction - lastProgress >= 0.01)
            {
                lastProgress = fraction;
                progress (fraction);
            }
            if (endFrame >= 0 && engineFrames >= endFrame)
                break;
            if (result.frames > (int64_t) (rate * 3600.0 * 4.0))
            {
                result.error = "render exceeded 4 hours";
                return result;
            }
        }
    }

    result.ok = true;
    result.seconds = (double) result.frames / rate;
    result.elapsed = (juce::Time::getMillisecondCounterHiRes() - started) * 0.001;
    if (progress)
        progress (1.0);
    return result;
}
} // namespace

namespace
{
/** FLAC or Ogg Vorbis through JUCE's audio formats. */
RenderResult renderCompressed (const RenderRequest& request, SampleStore& samples, ChannelIds& ids, PluginProvider* plugins,
                               const std::function<void (double)>& progress, const std::atomic<bool>* cancel)
{
    RenderResult failed;
    request.output.getParentDirectory().createDirectory();
    request.output.deleteFile();
    std::unique_ptr<juce::OutputStream> stream = std::make_unique<juce::FileOutputStream> (request.output);
    if (! static_cast<juce::FileOutputStream*> (stream.get())->openedOk())
    {
        failed.error = "cannot create " + request.output.getFullPathName();
        return failed;
    }
    std::unique_ptr<juce::AudioFormat> format;
    auto options = juce::AudioFormatWriterOptions {}.withSampleRate (request.sampleRate).withNumChannels (2);
    if (request.format == "flac")
    {
        format = std::make_unique<juce::FlacAudioFormat>();
        options = options.withBitsPerSample (request.bitDepth == 16 ? 16 : 24).withQualityOptionIndex (5);
    }
    else
    {
        format = std::make_unique<juce::OggVorbisAudioFormat>();
        // The nominal bit rate closest to the request ("64 kbps" … "500 kbps").
        const auto qualities = format->getQualityOptions();
        int best = 0;
        for (int i = 1; i < qualities.size(); ++i)
            if (std::abs (qualities[i].getIntValue() - request.oggKbps) < std::abs (qualities[best].getIntValue() - request.oggKbps))
                best = i;
        options = options.withBitsPerSample (32).withQualityOptionIndex (best);
    }
    auto writer = format->createWriterFor (stream, options);
    if (writer == nullptr)
    {
        failed.error = "cannot encode " + request.format + " at " + juce::String (request.sampleRate) + " Hz";
        return failed;
    }
    auto result = runRender (request, samples, ids, plugins, progress, cancel, [&writer] (const float* l, const float* r, int n)
    {
        const float* channels[] = { l, r };
        return writer->writeFromFloatArrays (channels, 2, n);
    });
    writer.reset(); // finishes the stream
    if (! result.ok)
        request.output.deleteFile();
    return result;
}
} // namespace

RenderResult renderOffline (const RenderRequest& request, SampleStore& samples, ChannelIds& ids, PluginProvider* plugins,
                            const std::function<void (double)>& progress, const std::atomic<bool>* cancel)
{
    if (request.format == "flac" || request.format == "ogg")
        return renderCompressed (request, samples, ids, plugins, progress, cancel);
    WavWriter writer;
    request.output.getParentDirectory().createDirectory();
    if (! writer.open (request.output, request.sampleRate, 2, request.bitDepth))
    {
        RenderResult r;
        r.error = "cannot create " + request.output.getFullPathName();
        return r;
    }
    auto result = runRender (request, samples, ids, plugins, progress, cancel, [&writer] (const float* l, const float* r, int n)
    {
        const float* channels[] = { l, r };
        return writer.write (channels, n);
    });
    if (! writer.close() && result.ok)
    {
        result.ok = false;
        result.error = "cannot finish " + request.output.getFullPathName();
    }
    if (! result.ok)
        request.output.deleteFile();
    return result;
}

RenderResult renderOfflineToBuffers (const RenderRequest& request, SampleStore& samples, ChannelIds& ids,
                                     PluginProvider* plugins, std::vector<float>& left, std::vector<float>& right)
{
    left.clear();
    right.clear();
    return runRender (request, samples, ids, plugins, {}, nullptr, [&] (const float* l, const float* r, int n)
    {
        left.insert (left.end(), l, l + n);
        right.insert (right.end(), r, r + n);
        return true;
    });
}

} // namespace mad
