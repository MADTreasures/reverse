#pragma once

#include "engine/ProjectModel.h"
#include "engine/Wav.h"

#include <juce_core/juce_core.h>

#include <atomic>
#include <functional>
#include <memory>
#include <mutex>
#include <vector>

namespace mad
{

/** One armed track's take: the audio thread pushes raw input frames into a lock-free FIFO, the
    writer thread drains it into a WAV file. */
class RecordTake
{
public:
    RecordTake (int trackIndex, InputRoute route, juce::File file, double sampleRate, int bitDepth, int64_t skipFrames);

    const int trackIndex;
    const int numChannels;
    const int firstInput;
    const juce::File file;
    const double sampleRate;

    /** Audio thread. */
    void push (const float* const* inputs, int numInputs, int offset, int n) noexcept;

    /** Writer thread. */
    bool openFile (int bitDepth);
    void drain();
    void close();

    int64_t frames() const noexcept { return writer.framesWritten(); }
    int64_t dropped() const noexcept { return droppedFrames.load(); }
    bool fileOk() const noexcept { return opened; }

private:
    juce::AbstractFifo fifo;
    std::vector<float> storage; // interleaved
    WavWriter writer;
    int64_t toSkip;
    int bits;
    bool opened = false;
    std::atomic<int64_t> droppedFrames { 0 };
    std::vector<float> chunk;
};

/** The takes of one recording pass. */
class RecordSession
{
public:
    std::vector<std::unique_ptr<RecordTake>> takes;
    std::atomic<bool> recording { false }, captureEnded { false };
    std::atomic<double> startTick { 0.0 };

    // Audio thread.
    void begin (double tick, int offsetInBlock) noexcept;
    void capture (const float* const* inputs, int numInputs, int n) noexcept;
    void end() noexcept;

private:
    int firstOffset = 0;
};

/** Creates sessions and runs the background writer thread. */
class Recorder : private juce::Thread
{
public:
    struct Config
    {
        juce::File folder;
        juce::String monitoring = "armed"; // off | armed | on
        bool latencyCompensation = true;
        int bitDepth = 24;
        bool configured = false;
    };

    Recorder();
    ~Recorder() override;

    void configure (const Config& c) { config = c; }
    const Config& getConfig() const noexcept { return config; }

    /** Message thread: one take per armed mixer track with an input. Returns null when nothing
        is armed (error explains why when it is non-empty). */
    std::shared_ptr<RecordSession> createSession (const ProjectModel& project, double sampleRate, int latencySamples,
                                                  juce::String& error);

    /** Message thread, after the audio thread released the session: drains, closes the files
        and calls `done` (on the writer thread) with the record.done JSON line. */
    void finish (std::shared_ptr<RecordSession> session, std::function<void (std::string)> done);

    /** Blocks until all sessions are finished (shutdown). */
    void finishAllNow();

private:
    void run() override;

    struct Pending
    {
        std::shared_ptr<RecordSession> session;
        std::function<void (std::string)> done;
        bool finishing = false;
    };

    Config config;
    std::mutex mutex;
    std::vector<Pending> sessions;
};

/** "<name>_<yyyyMMdd-HHmmss>.wav" with characters that file systems reject replaced. */
juce::String takeFileName (const juce::String& trackName, const juce::Time& when);

} // namespace mad
