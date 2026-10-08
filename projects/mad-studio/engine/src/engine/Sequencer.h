#pragma once

#include "engine/Params.h"
#include "engine/Timeline.h"

#include <limits>

namespace mad
{

/** swingOffsetTicks(): every second 16th (tick % 48 == 24) is delayed by swing * 12 ticks. */
double swingOffsetTicks (double tick, double swing) noexcept;

/** Transport and event scheduling in ticks (PPQ 96) on the audio thread. */
class Sequencer
{
public:
    enum class State
    {
        stopped,
        countIn,
        playing
    };

    struct Sink
    {
        virtual ~Sink() = default;
        /** Start of chunk `c`; `songTick` >= 0 when the transport plays in song mode (evaluate
            automation there), otherwise -1. Called before the chunk's tempo is read. */
        virtual void chunkStarted (int c, double songTick) = 0;
        /** A timeline event at absolute sample time `time` (may be after this block: swing). */
        virtual void noteEvent (const TimelineEvent& ev, double time, double lengthSeconds, double clipOffsetSeconds) = 0;
        virtual void click (double time, bool accent) = 0;
        /** Playback (after a count-in) started at block offset `offset` at `tick`. */
        virtual void playbackStarted (int offset, double tick) = 0;
        /** The end tick of a bounded (offline) run was reached at `offset`. */
        virtual void endReached (int offset) = 0;
    };

    void prepare (double sampleRate) noexcept { rate = sampleRate; }

    /** Starts at fromTick (clamped into the loop on the first block), optionally after a
        count-in of `countInTicks` with clicks. */
    void play (double fromTick, double countInTicks) noexcept;
    void stop() noexcept;
    /** Relocates while playing; sets the next start position while stopped. */
    void seek (double tick) noexcept;

    /** Offline renders: play straight from startTick to endTick without looping. */
    void setBounded (bool bounded, double endTick) noexcept
    {
        isBounded = bounded;
        boundEnd = endTick;
    }
    bool bounded() const noexcept { return isBounded; }

    void process (BlockContext& ctx, const Timeline* timeline, const AutoParam& bpm, const AutoParam& swing,
                  int beatsPerBar, bool metronome, Sink& sink) noexcept;

    State state() const noexcept { return current; }
    /** Song tick at the end of the last block (or the count-in position, negative). */
    double position() const noexcept { return current == State::countIn ? countTick : tick; }
    double ticksPerSample() const noexcept { return lastTicksPerSample; }
    double nextStartTick() const noexcept { return startTick; }

private:
    void relocateCursor (const Timeline* tl, double t) noexcept;

    double rate = 48000.0;
    State current = State::stopped;
    double tick = 0.0, countTick = 0.0, startTick = 0.0;
    bool pendingStart = false, pendingRelocate = false;
    double relocateTo = 0.0;
    const Timeline* cursorTimeline = nullptr;
    size_t cursor = 0;
    bool isBounded = false;
    double boundEnd = std::numeric_limits<double>::infinity();
    double lastTicksPerSample = 0.0;
};

} // namespace mad
