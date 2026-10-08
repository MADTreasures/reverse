#pragma once

#include "core/Realtime.h"
#include "engine/Graph.h"
#include "engine/Sequencer.h"

#include <array>
#include <atomic>
#include <memory>
#include <vector>

namespace mad
{

class RecordSession;

/** Message thread -> audio thread command (trivially copyable). */
struct EngineCommand
{
    enum class Type : uint8_t
    {
        play,
        stop,
        seek,
        noteOn,
        noteOff,
        allNotesOff,
        previewSample,
        previewSynth,
        previewStop
    };

    Type type = Type::stop;
    double tick = 0.0, countIn = 0.0;
    RecordSession* session = nullptr; // play with recording (kept alive by the controller)
    uint32_t channel = 0;
    int key = 60;
    float velocity = 0.8f;
    int32_t handle = 0;
    const SampleData* sample = nullptr; // previewSample, pinned by the sender
    std::array<uint8_t, 16> keys {};
    int numKeys = 0;
    double duration = 0.6;
};

/** Audio thread -> message thread notification. */
struct EngineNotification
{
    enum class Type : uint8_t
    {
        recordingStarted,
        recordingStopped,
        endReached
    };

    Type type = Type::endReached;
    RecordSession* session = nullptr;
    double tick = 0.0;
};

/** Meter values published once per block. */
struct MeterFrame
{
    int numTracks = 0;
    std::array<std::array<float, 2>, maxMixerTracks> peaks {};
    std::array<float, 256> waveform {};
    uint64_t serial = 0;
};

/** Transport position published once per block. */
struct PositionInfo
{
    int64_t sample = 0;     // sample clock at the end of the block
    double tick = 0.0;      // song tick at the end of the block (negative during count-in)
    double ticksPerSample = 0.0;
    int state = 0;          // 0 stopped, 1 count-in, 2 playing
    double loopStart = 0.0, loopEnd = 0.0;
    double nextStart = 0.0;
};

/** Renders a GraphSnapshot. The live engine is driven by the audio device (or the null
    device); offline renders create their own instance and call process() directly. */
class AudioEngine
{
public:
    explicit AudioEngine (bool offline);
    ~AudioEngine();

    /** Must not run concurrently with process(). */
    void prepare (double sampleRate, int maxBlockSize);

    double getSampleRate() const noexcept { return sampleRate; }
    int getMaxBlockSize() const noexcept { return maxBlock; }
    bool isOffline() const noexcept { return offline; }

    /** Audio thread (or render thread). */
    void process (const float* const* inputs, int numInputs, float* const* outputs, int numOutputs, int numSamples) noexcept;

    // ---- message thread ------------------------------------------------------------------
    SnapshotPublisher<GraphSnapshot> snapshots;

    bool post (const EngineCommand& command) noexcept { return commands.push (command); }
    bool popNotification (EngineNotification& n) noexcept { return notifications.pop (n); }
    bool readMeters (MeterFrame& out) noexcept { return meters.read (out); }
    PositionInfo readPosition() const noexcept;

    float cpuLoad() const noexcept { return cpu.load (std::memory_order_relaxed); }
    int64_t sampleClock() const noexcept { return clock.load (std::memory_order_relaxed); }

    /** Transport-level automatable values (proj:bpm, proj:swing). */
    AutoParam bpm { 130.0f }, swing { 0.0f };
    std::atomic<int> beatsPerBar { 4 };
    std::atomic<bool> metronomeEnabled { false };

    /** Instrument used by preview.synth (parameters set by the controller before posting). */
    SynthInstrument& previewSynthInstrument() noexcept { return *previewSynth; }

    /** Offline renders: play straight through [startTick, endTick). */
    void setBounded (double endTick) noexcept { sequencer.setBounded (true, endTick); }
    bool endReached() const noexcept { return reachedEnd.load(); }
    double transportTick() const noexcept { return sequencer.position(); }

private:
    class Dispatcher;
    void processBlock (const float* const* inputs, int numInputs, float* const* outputs, int numOutputs, int n) noexcept;
    void handleCommands (GraphSnapshot* snap, const BlockContext& ctx) noexcept;
    void killEverything (GraphSnapshot* snap, const BlockContext& ctx) noexcept;
    void renderPreviews (const BlockContext& ctx, float* left, float* right) noexcept;
    void renderClicks (const BlockContext& ctx, float* out) noexcept;
    void publishMeters (GraphSnapshot* snap, const float* masterL, int n) noexcept;
    void addEvent (const NoteEvent& e) noexcept;

    const bool offline;
    double sampleRate = 48000.0;
    int maxBlock = 512;
    uint64_t blockCounter = 0;
    std::atomic<int64_t> clock { 0 };
    std::atomic<float> cpu { 0.0f };
    std::atomic<bool> reachedEnd { false };

    SpscFifo<EngineCommand, 1024> commands;
    SpscFifo<EngineNotification, 64> notifications;
    TripleBuffer<MeterFrame> meters;

    // Position seqlock.
    mutable std::atomic<uint32_t> positionSeq { 0 };
    PositionInfo position;

    Sequencer sequencer;

    // Events pending dispatch (swing pushes some past the current block).
    static constexpr int maxPending = 4096;
    std::vector<NoteEvent> pending, due;
    ChokeList chokes;

    // Live note handles -> channel.
    struct LiveHandle
    {
        int32_t handle = 0;
        uint32_t channel = 0;
    };
    std::array<LiveHandle, 256> liveHandles {};

    // Recording session currently attached to the transport.
    RecordSession* session = nullptr;
    bool sessionRecording = false;

    // Previews.
    std::unique_ptr<SynthInstrument> previewSynth;
    struct SamplePreview
    {
        const SampleData* sample = nullptr;
        double position = 0.0, increment = 1.0;
        int64_t remaining = 0;
    };
    std::array<SamplePreview, 4> samplePreviews {};
    std::vector<float> previewL, previewR;

    // Metronome.
    struct Click
    {
        bool active = false;
        double startTime = 0.0;
        bool accent = false;
    };
    std::array<Click, 16> clicks {};
    std::vector<float> clickBuffer;

    std::array<float, 256> waveRing {};
    int wavePos = 0;
};

} // namespace mad
