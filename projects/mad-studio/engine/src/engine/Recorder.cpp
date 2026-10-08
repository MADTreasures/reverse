#include "engine/Recorder.h"

#include "core/Json.h"
#include "core/Log.h"

#include <algorithm>
#include <cmath>

namespace mad
{
namespace
{
constexpr int fifoSeconds = 30;
} // namespace

juce::String takeFileName (const juce::String& trackName, const juce::Time& when)
{
    auto name = trackName.trim();
    if (name.isEmpty())
        name = "Track";
    name = name.replaceCharacters ("/\\:*?\"<>|", "_________").removeCharacters ("\r\n\t");
    return name + "_" + when.formatted ("%Y%m%d-%H%M%S") + ".wav";
}

//==============================================================================
RecordTake::RecordTake (int track, InputRoute route, juce::File f, double rate, int bitDepth, int64_t skipFrames)
    : trackIndex (track),
      numChannels (route.channels == 2 ? 2 : 1),
      firstInput (route.first),
      file (std::move (f)),
      sampleRate (rate),
      fifo ((int) std::ceil (rate * fifoSeconds)),
      toSkip (std::max<int64_t> (0, skipFrames)),
      bits (bitDepth)
{
    storage.assign ((size_t) fifo.getTotalSize() * (size_t) numChannels, 0.0f);
}

void RecordTake::push (const float* const* inputs, int numInputs, int offset, int n) noexcept
{
    const int frames = n - offset;
    if (frames <= 0)
        return;

    const float* a = (inputs != nullptr && firstInput < numInputs) ? inputs[firstInput] : nullptr;
    const float* b = (numChannels == 2 && inputs != nullptr && firstInput + 1 < numInputs) ? inputs[firstInput + 1] : nullptr;

    int start1, size1, start2, size2;
    fifo.prepareToWrite (frames, start1, size1, start2, size2);
    const auto put = [&] (int dest, int count, int src)
    {
        for (int i = 0; i < count; ++i)
        {
            const int s = offset + src + i;
            float* d = storage.data() + (size_t) (dest + i) * (size_t) numChannels;
            d[0] = a != nullptr ? a[s] : 0.0f;
            if (numChannels == 2)
                d[1] = b != nullptr ? b[s] : 0.0f;
        }
    };
    put (start1, size1, 0);
    put (start2, size2, size1);
    fifo.finishedWrite (size1 + size2);
    if (size1 + size2 < frames)
        droppedFrames.fetch_add (frames - size1 - size2);
}

bool RecordTake::openFile (int bitDepth)
{
    bits = bitDepth;
    opened = writer.open (file, sampleRate, numChannels, bits);
    return opened;
}

void RecordTake::drain()
{
    for (;;)
    {
        const int ready = fifo.getNumReady();
        if (ready <= 0)
            return;
        int start1, size1, start2, size2;
        fifo.prepareToRead (ready, start1, size1, start2, size2);
        const auto take = [&] (int start, int count)
        {
            int skip = (int) std::min<int64_t> (toSkip, count);
            toSkip -= skip;
            const int keep = count - skip;
            if (keep > 0 && opened)
                writer.writeInterleaved (storage.data() + (size_t) (start + skip) * (size_t) numChannels, keep);
        };
        take (start1, size1);
        take (start2, size2);
        fifo.finishedRead (size1 + size2);
    }
}

void RecordTake::close()
{
    drain();
    writer.close();
}

//==============================================================================
void RecordSession::begin (double tick, int offsetInBlock) noexcept
{
    startTick.store (tick);
    firstOffset = std::max (0, offsetInBlock);
    recording.store (true);
}

void RecordSession::capture (const float* const* inputs, int numInputs, int n) noexcept
{
    if (! recording.load (std::memory_order_relaxed))
        return;
    for (auto& t : takes)
        t->push (inputs, numInputs, std::min (firstOffset, n), n);
    firstOffset = 0;
}

void RecordSession::end() noexcept
{
    recording.store (false);
    captureEnded.store (true);
}

//==============================================================================
Recorder::Recorder() : juce::Thread ("mad-record-writer")
{
    startThread (juce::Thread::Priority::high);
}

Recorder::~Recorder()
{
    finishAllNow();
    stopThread (4000);
}

std::shared_ptr<RecordSession> Recorder::createSession (const ProjectModel& project, double sampleRate, int latencySamples,
                                                        juce::String& error)
{
    auto session = std::make_shared<RecordSession>();
    auto folder = config.folder;
    if (folder == juce::File())
        folder = juce::File::getSpecialLocation (juce::File::userMusicDirectory).getChildFile ("MAD Studio").getChildFile ("Recorded");
    if (! folder.createDirectory())
    {
        error = "cannot create the recording folder " + folder.getFullPathName();
        return nullptr;
    }

    const auto now = juce::Time::getCurrentTime();
    const int64_t skip = config.latencyCompensation ? std::max (0, latencySamples) : 0;
    for (size_t i = 0; i < project.mixer.size(); ++i)
    {
        const auto& track = project.mixer[i];
        if (! track.armed || track.input.channels == 0)
            continue;
        auto file = folder.getChildFile (takeFileName (track.name, now));
        for (int n = 2; file.exists(); ++n)
            file = folder.getChildFile (takeFileName (track.name, now).upToLastOccurrenceOf (".wav", false, false) + "_"
                                        + juce::String (n) + ".wav");
        auto take = std::make_unique<RecordTake> ((int) i, track.input, file, sampleRate, config.bitDepth, skip);
        if (! take->openFile (config.bitDepth))
        {
            error = "cannot write " + file.getFullPathName();
            continue;
        }
        session->takes.push_back (std::move (take));
    }

    if (session->takes.empty())
        return nullptr;

    const std::lock_guard<std::mutex> lock (mutex);
    sessions.push_back ({ session, nullptr, false });
    return session;
}

void Recorder::finish (std::shared_ptr<RecordSession> session, std::function<void (std::string)> done)
{
    {
        const std::lock_guard<std::mutex> lock (mutex);
        for (auto& p : sessions)
        {
            if (p.session == session)
            {
                p.done = std::move (done);
                p.finishing = true;
            }
        }
    }
    notify();
}

void Recorder::finishAllNow()
{
    std::vector<Pending> local;
    {
        const std::lock_guard<std::mutex> lock (mutex);
        local.swap (sessions);
    }
    for (auto& p : local)
        for (auto& t : p.session->takes)
            t->close();
}

void Recorder::run()
{
    while (! threadShouldExit())
    {
        std::vector<Pending> finished;
        std::vector<std::shared_ptr<RecordSession>> active;
        {
            const std::lock_guard<std::mutex> lock (mutex);
            for (size_t i = 0; i < sessions.size();)
            {
                if (sessions[i].finishing)
                {
                    finished.push_back (std::move (sessions[i]));
                    sessions.erase (sessions.begin() + (long) i);
                }
                else
                {
                    active.push_back (sessions[i].session);
                    ++i;
                }
            }
        }

        for (auto& s : active)
            for (auto& t : s->takes)
                t->drain();

        for (auto& p : finished)
        {
            json::Writer w;
            w.beginObject().field ("type", "record.done").key ("takes").beginArray();
            for (auto& t : p.session->takes)
            {
                t->close();
                if (t->frames() <= 0)
                {
                    t->file.deleteFile();
                    continue;
                }
                w.beginObject()
                    .field ("trackIndex", t->trackIndex)
                    .field ("path", t->file.getFullPathName())
                    .field ("startTick", p.session->startTick.load())
                    .field ("sampleRate", t->sampleRate)
                    .field ("channels", t->numChannels)
                    .field ("frames", (int64_t) t->frames());
                if (t->dropped() > 0)
                    w.field ("droppedFrames", (int64_t) t->dropped());
                w.endObject();
            }
            w.endArray().endObject();
            if (p.done)
                p.done (w.take());
        }

        wait (20);
    }
}

} // namespace mad
