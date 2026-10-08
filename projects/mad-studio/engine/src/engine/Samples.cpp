#include "engine/Samples.h"

#include <cmath>
#include <cstring>

namespace mad
{
namespace
{
std::mutex graveyardMutex;
std::vector<SampleData*> graveyard;

void retire (const SampleData* data)
{
    auto* d = const_cast<SampleData*> (data);
    if (d->pins.load() == 0)
    {
        delete d;
        return;
    }
    const std::lock_guard<std::mutex> lock (graveyardMutex);
    graveyard.push_back (d);
}
} // namespace

SamplePtr makeSamplePtr (std::unique_ptr<SampleData> data)
{
    return SamplePtr (data.release(), [] (const SampleData* d) { retire (d); });
}

void collectSampleGarbage()
{
    std::vector<SampleData*> freeNow;
    {
        const std::lock_guard<std::mutex> lock (graveyardMutex);
        for (size_t i = 0; i < graveyard.size();)
        {
            if (graveyard[i]->pins.load() == 0)
            {
                freeNow.push_back (graveyard[i]);
                graveyard[i] = graveyard.back();
                graveyard.pop_back();
            }
            else
            {
                ++i;
            }
        }
    }
    for (auto* d : freeNow)
        delete d;
}

//==============================================================================
juce::Result SampleStore::loadRaw (const juce::String& id, const juce::File& file, double sampleRate, int numChannels,
                                   int64_t numFrames)
{
    if (id.isEmpty())
        return juce::Result::fail ("missing sample id");
    if (! (sampleRate >= 1000.0 && sampleRate <= 768000.0))
        return juce::Result::fail ("invalid sampleRate");
    if (numChannels < 1 || numChannels > 2)
        return juce::Result::fail ("only mono and stereo samples are supported");

    juce::FileInputStream in (file);
    if (! in.openedOk())
        return juce::Result::fail ("cannot open " + file.getFullPathName());

    const auto bytes = (int64_t) in.getTotalLength();
    const int64_t frameBytes = 4 * (int64_t) numChannels;
    int64_t frames = numFrames > 0 ? numFrames : bytes / frameBytes;
    frames = std::min (frames, bytes / frameBytes);
    if (frames <= 0)
        return juce::Result::fail ("sample file is empty");

    auto data = std::make_unique<SampleData>();
    data->id = id;
    data->numChannels = numChannels;
    data->numFrames = frames;
    data->sampleRate = sampleRate;
    for (int c = 0; c < numChannels; ++c)
        data->channels[c].resize ((size_t) frames);

    std::vector<char> chunk (1 << 20);
    int64_t frame = 0;
    while (frame < frames)
    {
        const auto want = (int) std::min<int64_t> ((int64_t) chunk.size() / frameBytes, frames - frame);
        const int got = in.read (chunk.data(), want * (int) frameBytes);
        const int gotFrames = got / (int) frameBytes;
        if (gotFrames <= 0)
            break;
        for (int i = 0; i < gotFrames; ++i)
        {
            for (int c = 0; c < numChannels; ++c)
            {
                uint32_t bits = 0;
                const auto* p = reinterpret_cast<const unsigned char*> (chunk.data()) + ((size_t) i * (size_t) frameBytes + (size_t) c * 4);
                bits = (uint32_t) p[0] | ((uint32_t) p[1] << 8) | ((uint32_t) p[2] << 16) | ((uint32_t) p[3] << 24);
                float v;
                std::memcpy (&v, &bits, sizeof (v));
                data->channels[c][(size_t) (frame + i)] = std::isfinite (v) ? v : 0.0f;
            }
        }
        frame += gotFrames;
    }
    if (frame < frames)
        return juce::Result::fail ("sample file is shorter than expected");

    add (std::move (data));
    return juce::Result::ok();
}

void SampleStore::add (std::unique_ptr<SampleData> data)
{
    const auto id = data->id;
    auto ptr = makeSamplePtr (std::move (data));
    {
        const std::lock_guard<std::mutex> lock (mutex);
        forward[id] = std::move (ptr);
        reversedCache.erase (id);
    }
    rev.fetch_add (1);
}

void SampleStore::unload (const juce::String& id)
{
    {
        const std::lock_guard<std::mutex> lock (mutex);
        forward.erase (id);
        reversedCache.erase (id);
    }
    rev.fetch_add (1);
}

SamplePtr SampleStore::get (const juce::String& id, bool reversed)
{
    const std::lock_guard<std::mutex> lock (mutex);
    const auto it = forward.find (id);
    if (it == forward.end())
        return nullptr;
    if (! reversed)
        return it->second;

    auto& cached = reversedCache[id];
    if (cached == nullptr)
    {
        const auto& src = *it->second;
        auto copy = std::make_unique<SampleData>();
        copy->id = src.id;
        copy->numChannels = src.numChannels;
        copy->numFrames = src.numFrames;
        copy->sampleRate = src.sampleRate;
        for (int c = 0; c < src.numChannels; ++c)
            copy->channels[c].assign (src.channels[c].rbegin(), src.channels[c].rend());
        cached = makeSamplePtr (std::move (copy));
    }
    return cached;
}

std::vector<juce::String> SampleStore::ids() const
{
    const std::lock_guard<std::mutex> lock (mutex);
    std::vector<juce::String> out;
    for (const auto& [id, _] : forward)
        out.push_back (id);
    return out;
}

} // namespace mad
