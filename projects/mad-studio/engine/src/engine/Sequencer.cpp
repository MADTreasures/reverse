#include "engine/Sequencer.h"

#include <algorithm>
#include <cmath>

namespace mad
{

double swingOffsetTicks (double tick, double swing) noexcept
{
    if (swing <= 0.0)
        return 0.0;
    // scheduler.ts: tick % (TICKS_PER_STEP * 2) === TICKS_PER_STEP (exact for integer ticks)
    const double m = std::fmod (tick, 48.0);
    return (m >= 24.0 && m <= 24.0) ? swing * 24.0 * 0.5 : 0.0;
}

void Sequencer::play (double fromTick, double countInTicks) noexcept
{
    startTick = std::max (0.0, fromTick);
    pendingStart = true;
    pendingRelocate = false;
    if (countInTicks > 0.0)
    {
        current = State::countIn;
        countTick = -countInTicks;
    }
    else
    {
        current = State::playing;
    }
}

void Sequencer::stop() noexcept
{
    current = State::stopped;
    pendingStart = false;
    pendingRelocate = false;
}

void Sequencer::seek (double t) noexcept
{
    if (current == State::playing && ! pendingStart)
    {
        pendingRelocate = true;
        relocateTo = std::max (0.0, t);
    }
    else
    {
        startTick = std::max (0.0, t);
    }
}

void Sequencer::relocateCursor (const Timeline* tl, double t) noexcept
{
    cursorTimeline = tl;
    cursor = tl != nullptr ? tl->firstAtOrAfter (t) : 0;
}

void Sequencer::process (BlockContext& ctx, const Timeline* tl, const AutoParam& bpmParam, const AutoParam& swingParam,
                         int beatsPerBar, bool metronome, Sink& sink) noexcept
{
    const int n = ctx.numSamples;
    const double loopStart = tl != nullptr ? tl->loopStart : 0.0;
    const double loopEnd = tl != nullptr ? tl->loopEnd : 384.0;
    const int bpb = std::max (1, beatsPerBar);

    if (tl != cursorTimeline)
        relocateCursor (tl, tick);

    const auto clampIntoLoop = [&] (double t)
    {
        if (! isBounded && tl != nullptr && (t >= loopEnd || t < loopStart))
            return loopStart;
        return t;
    };

    if (pendingStart)
    {
        pendingStart = false;
        startTick = clampIntoLoop (startTick);
        tick = startTick;
        relocateCursor (tl, tick);
        if (current == State::playing)
            sink.playbackStarted (0, tick);
    }
    if (pendingRelocate)
    {
        pendingRelocate = false;
        tick = clampIntoLoop (relocateTo);
        relocateCursor (tl, tick);
    }

    for (int c = 0; c < ctx.numChunks; ++c)
    {
        const int c0 = c * chunkSize;
        const int c1 = std::min (n, c0 + chunkSize);
        const bool songPlaying = current == State::playing && tl != nullptr && tl->songMode;
        sink.chunkStarted (c, songPlaying ? tick : -1.0);

        const double bpm = std::clamp ((double) bpmParam.value (ctx, c), 10.0, 522.0);
        ctx.bpm[(size_t) c] = bpm;
        const double tps = bpm * ppq / (60.0 * rate);
        const double secondsPerTick = 60.0 / (bpm * ppq);
        lastTicksPerSample = tps;
        const double swing = std::clamp ((double) swingParam.value (ctx, c), 0.0, 1.0);

        double pos = (double) c0;
        for (int guard = 0; pos < (double) c1 && guard < 64; ++guard)
        {
            if (current == State::stopped)
                break;

            if (current == State::countIn)
            {
                const double segSamples = std::min ((double) c1 - pos, -countTick / tps);
                const double t0 = countTick, t1 = countTick + segSamples * tps;
                for (double b = std::ceil (t0 / ppq) * ppq; b < t1 - 1.0e-9 && b < -1.0e-9; b += ppq)
                {
                    const auto beat = (int64_t) std::llround (b / ppq);
                    const bool accent = ((beat % bpb) + bpb) % bpb == 0;
                    sink.click ((double) ctx.blockStart + pos + (b - t0) / tps, accent);
                }
                countTick = t1;
                pos += segSamples;
                if (countTick >= -1.0e-7)
                {
                    countTick = 0.0;
                    current = State::playing;
                    tick = startTick;
                    relocateCursor (tl, tick);
                    sink.playbackStarted (std::min (n - 1, (int) std::ceil (pos - 1.0e-9)), tick);
                }
                continue;
            }

            // Playing.
            if (! isBounded && (tick >= loopEnd || tick < loopStart))
            {
                tick = loopStart;
                relocateCursor (tl, tick);
            }
            const double segEndTick = isBounded ? boundEnd : loopEnd;
            const double segSamples = std::max (0.0, std::min ((double) c1 - pos, (segEndTick - tick) / tps));
            const double t0 = tick, t1 = tick + segSamples * tps;
            const bool reachesEnd = (segEndTick - tick) / tps <= (double) c1 - pos + 1.0e-9;

            if (tl != nullptr)
            {
                const auto& events = tl->events;
                while (cursor < events.size() && (events[cursor].tick < t1 || (reachesEnd && events[cursor].tick < segEndTick)))
                {
                    const auto& ev = events[cursor++];
                    if (ev.tick < t0 - 1.0e-9)
                        continue;
                    const double evTick = ev.tick + swingOffsetTicks (ev.tick, swing);
                    const double at = (double) ctx.blockStart + pos + (evTick - t0) / tps;
                    const TimelineBend* bends = ev.bendCount > 0 && ev.bendFirst + ev.bendCount <= tl->bends.size()
                                                    ? tl->bends.data() + ev.bendFirst
                                                    : nullptr;
                    sink.noteEvent (ev, bends, at, secondsPerTick);
                }
            }
            if (metronome)
            {
                for (double b = std::ceil (t0 / ppq - 1.0e-9) * ppq; b < t1 - 1.0e-9; b += ppq)
                {
                    const auto beat = (int64_t) std::llround (b / ppq);
                    sink.click ((double) ctx.blockStart + pos + (b - t0) / tps, beat % bpb == 0);
                }
            }

            tick = t1;
            pos += segSamples;
            if (reachesEnd)
            {
                if (isBounded)
                {
                    tick = segEndTick;
                    current = State::stopped;
                    sink.endReached (std::min (n, (int) std::ceil (pos - 1.0e-9)));
                    break;
                }
                tick = loopStart;
                relocateCursor (tl, tick);
            }
        }
    }
}

} // namespace mad
