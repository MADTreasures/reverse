#include "engine/AudioEngine.h"

#include "engine/Recorder.h"
#include "plugins/PluginSlot.h"

#include <juce_audio_basics/juce_audio_basics.h>

#include <algorithm>
#include <cmath>

namespace mad
{
namespace
{
constexpr double twoPi = 6.28318530717958647692;
} // namespace

//==============================================================================
/** Receives the sequencer's output for one block. */
class AudioEngine::Dispatcher final : public Sequencer::Sink
{
public:
    Dispatcher (AudioEngine& e, GraphSnapshot* s, const BlockContext& c) : engine (e), snap (s), ctx (c) {}

    void chunkStarted (int c, double songTick) override
    {
        if (snap == nullptr || snap->automation == nullptr)
            return;
        // Plugin delay compensation: a parameter behind latent plugins hears the music late, so
        // its lane is read that much earlier ("compensate automations"). Lanes without latency
        // go first: the tempo lane sets the tempo that converts the offsets to ticks.
        bool compensated = false;
        for (auto& entry : snap->automation->entries)
        {
            if (entry.offsetSamples > 0.0)
                compensated = true;
            else
                apply (entry, c, songTick);
        }
        if (! compensated)
            return;

        const double ticksPerSample = std::clamp ((double) engine.bpm.value (ctx, c), 10.0, 522.0) * ppq / (60.0 * ctx.sampleRate);
        const auto* tl = snap->timeline.get();
        const bool loops = tl != nullptr && ! engine.sequencer.bounded() && tl->loopEnd > tl->loopStart && songTick >= tl->loopStart;
        for (auto& entry : snap->automation->entries)
        {
            if (entry.offsetSamples <= 0.0)
                continue;
            double tick = songTick - entry.offsetSamples * ticksPerSample;
            if (songTick >= 0.0)
            {
                // Right after a loop wrap, that audio still comes from the end of the loop.
                if (loops && tick < tl->loopStart)
                    tick = tl->loopEnd - std::fmod (tl->loopStart - tick, tl->loopEnd - tl->loopStart);
                tick = std::max (0.0, tick);
            }
            apply (entry, c, songTick >= 0.0 ? tick : -1.0);
        }
    }

    /** Applies a lane read at `tick` (< 0: not playing in song mode) to chunk `c`. */
    void apply (AutomationBinding::Entry& entry, int c, double tick) noexcept
    {
        double v = 0.0;
        if (entry.param != nullptr)
        {
            if (tick >= 0.0)
            {
                entry.state.active = entry.lane->evaluate (tick, v);
                if (entry.state.active)
                    entry.state.value = (float) v;
            }
            entry.param->setChunk (c, entry.state);
        }
        else if (entry.plugin != nullptr && c == 0 && tick >= 0.0 && entry.lane->evaluate (tick, v))
        {
            if (differs ((float) v, entry.lastPluginValue))
            {
                entry.plugin->setParameterFromAudioThread (entry.pluginParam, (float) v);
                entry.lastPluginValue = (float) v;
            }
        }
    }

    void noteEvent (const TimelineEvent& ev, const TimelineBend* bends, double time, double secondsPerTick) override
    {
        NoteEvent e;
        e.kind = NoteEvent::Kind::noteOn;
        e.time = time;
        e.channel = ev.channel;
        e.key = ev.key;
        e.velocity = ev.velocity;
        e.lengthSeconds = ev.length * secondsPerTick;
        e.audioClip = ev.audioClip;
        e.clipOffsetSeconds = ev.audioClip ? ev.sampleOffset * secondsPerTick : 0.0;
        e.props = ev.props;
        // Slide bends in seconds at the tempo the note starts with (graph.ts trigger(): pitchCurve(…, spt)).
        e.numBends = bends != nullptr ? (int) std::min<uint32_t> (ev.bendCount, (uint32_t) maxNoteBends) : 0;
        for (int i = 0; i < e.numBends; ++i)
            e.bends[(size_t) i] = { (float) (bends[i].at * secondsPerTick), (float) (bends[i].length * secondsPerTick), bends[i].to };
        engine.addEvent (e);
    }

    void click (double time, bool accent) override
    {
        for (auto& c : engine.clicks)
        {
            if (! c.active)
            {
                c = { true, time, accent };
                return;
            }
        }
    }

    void playbackStarted (int offset, double tick) override
    {
        if (engine.session != nullptr && ! engine.sessionRecording)
        {
            engine.sessionRecording = true;
            engine.session->begin (tick, offset);
            engine.notifications.push ({ EngineNotification::Type::recordingStarted, engine.session, tick });
        }
    }

    void endReached (int offset) override
    {
        engine.reachedEndOffset.store (offset);
        engine.reachedEnd.store (true);
        engine.notifications.push ({ EngineNotification::Type::endReached, nullptr, 0.0 });
    }

private:
    AudioEngine& engine;
    GraphSnapshot* snap;
    const BlockContext& ctx;
};

//==============================================================================
AudioEngine::AudioEngine (bool isOffline) : offline (isOffline)
{
    previewSynth = std::make_unique<SynthInstrument>();
}

AudioEngine::~AudioEngine()
{
    for (auto& p : samplePreviews)
        if (p.sample != nullptr)
            p.sample->pins.fetch_sub (1);
}

void AudioEngine::prepare (double rate, int blockSize)
{
    sampleRate = rate;
    maxBlock = std::clamp (blockSize, 16, mad::maxBlockSize);
    sequencer.prepare (rate);
    pending.clear();
    pending.reserve ((size_t) maxPending);
    due.clear();
    due.reserve ((size_t) maxPending);
    previewSynth->prepare (rate, maxBlock);
    previewL.assign ((size_t) maxBlock, 0.0f);
    previewR.assign ((size_t) maxBlock, 0.0f);
    clickBuffer.assign ((size_t) maxBlock, 0.0f);
    routeL.assign ((size_t) maxBlock, 0.0f);
    routeR.assign ((size_t) maxBlock, 0.0f);
    for (auto& c : clicks)
        c.active = false;
}

PositionInfo AudioEngine::readPosition() noexcept
{
    positions.read (lastPosition); // keeps the previous frame when nothing new was published
    return lastPosition;
}

void AudioEngine::addEvent (const NoteEvent& e) noexcept
{
    if ((int) pending.size() < maxPending)
        pending.push_back (e);
}

void AudioEngine::process (const float* const* inputs, int numInputs, float* const* outputs, int numOutputs,
                           int numSamples) noexcept
{
    juce::ScopedNoDenormals noDenormals;
    const auto start = juce::Time::getHighResolutionTicks();

    constexpr int maxChannels = 64;
    const float* in[maxChannels] {};
    float* out[maxChannels] {};
    numInputs = std::clamp (numInputs, 0, maxChannels);
    numOutputs = std::clamp (numOutputs, 0, maxChannels);

    int done = 0;
    while (done < numSamples)
    {
        const int n = std::min (maxBlock, numSamples - done);
        for (int c = 0; c < numInputs; ++c)
            in[c] = inputs != nullptr && inputs[c] != nullptr ? inputs[c] + done : nullptr;
        for (int c = 0; c < numOutputs; ++c)
            out[c] = outputs[c] != nullptr ? outputs[c] + done : nullptr;
        processBlock (in, numInputs, out, numOutputs, n);
        done += n;
    }

    if (! offline && numSamples > 0)
    {
        const double elapsed = juce::Time::highResolutionTicksToSeconds (juce::Time::getHighResolutionTicks() - start);
        const double budget = (double) numSamples / sampleRate;
        const float load = (float) std::clamp (elapsed / budget, 0.0, 1.0);
        const float prev = cpu.load (std::memory_order_relaxed);
        cpu.store (prev + (load - prev) * 0.1f, std::memory_order_relaxed);
    }
}

void AudioEngine::killEverything (GraphSnapshot* snap, const BlockContext& ctx) noexcept
{
    pending.clear();
    if (snap != nullptr)
        for (const auto& c : snap->channels)
            c.node->instrument->killAll (ctx, 0);
}

void AudioEngine::handleCommands (GraphSnapshot* snap, const BlockContext& ctx) noexcept
{
    EngineCommand cmd;
    while (commands.pop (cmd))
    {
        const bool transportCommand = cmd.type == EngineCommand::Type::play || cmd.type == EngineCommand::Type::stop
                                      || cmd.type == EngineCommand::Type::seek;
        if (transportCommand && cmd.seq != 0)
            transportSeq = cmd.seq;

        switch (cmd.type)
        {
            case EngineCommand::Type::play:
                if (sequencer.state() != Sequencer::State::stopped)
                    killEverything (snap, ctx);
                reachedEnd.store (false);
                if (session != nullptr && session != cmd.session)
                {
                    if (sessionRecording)
                        session->end();
                    notifications.push ({ EngineNotification::Type::recordingStopped, session, sequencer.position() });
                }
                session = cmd.session;
                sessionRecording = false;
                sequencer.play (cmd.tick, cmd.countIn);
                break;

            case EngineCommand::Type::stop:
                sequencer.stop();
                killEverything (snap, ctx);
                if (session != nullptr)
                {
                    if (sessionRecording)
                        session->end();
                    notifications.push ({ EngineNotification::Type::recordingStopped, session, sequencer.position() });
                    session = nullptr;
                    sessionRecording = false;
                }
                break;

            case EngineCommand::Type::seek:
                if (sequencer.state() == Sequencer::State::playing)
                    killEverything (snap, ctx);
                sequencer.seek (cmd.tick);
                break;

            case EngineCommand::Type::noteOn:
            {
                NoteEvent e;
                e.kind = NoteEvent::Kind::noteOn;
                e.time = (double) ctx.blockStart;
                e.channel = cmd.channel;
                e.key = cmd.key;
                e.velocity = cmd.velocity;
                e.lengthSeconds = -1.0;
                e.handle = cmd.handle;
                e.props.glideFrom = cmd.glideFrom;
                e.props.glideTime = cmd.glideTime;
                for (auto& h : liveHandles)
                {
                    if (h.handle == 0)
                    {
                        h = { cmd.handle, cmd.channel };
                        break;
                    }
                }
                if ((int) due.size() < maxPending)
                    due.push_back (e);
                break;
            }

            case EngineCommand::Type::noteOff:
                for (auto& h : liveHandles)
                {
                    if (h.handle != cmd.handle || cmd.handle == 0)
                        continue;
                    NoteEvent e;
                    e.kind = NoteEvent::Kind::noteOff;
                    e.time = (double) ctx.blockStart;
                    e.channel = h.channel;
                    e.handle = cmd.handle;
                    if ((int) due.size() < maxPending)
                        due.push_back (e);
                    h = {};
                }
                break;

            case EngineCommand::Type::allNotesOff:
                killEverything (snap, ctx);
                for (auto& h : liveHandles)
                    h = {};
                previewSynth->killAll (ctx, 0);
                for (auto& p : samplePreviews)
                    p.remaining = std::min<int64_t> (p.remaining, 0);
                break;

            case EngineCommand::Type::previewSample:
            {
                SamplePreview* slot = nullptr;
                for (auto& p : samplePreviews)
                    if (p.sample == nullptr)
                    {
                        slot = &p;
                        break;
                    }
                if (slot == nullptr)
                {
                    // Replace the oldest preview.
                    slot = &samplePreviews[0];
                    for (auto& p : samplePreviews)
                        if (p.remaining < slot->remaining)
                            slot = &p;
                    if (slot->sample != nullptr)
                        slot->sample->pins.fetch_sub (1);
                }
                slot->sample = cmd.sample;
                slot->position = 0.0;
                slot->increment = cmd.sample->sampleRate / sampleRate;
                slot->remaining = (int64_t) std::ceil (std::min (cmd.sample->durationSeconds(), 6.0) * sampleRate);
                break;
            }

            case EngineCommand::Type::previewSynth:
                previewSynth->killAll (ctx, 0);
                for (int k = 0; k < cmd.numKeys; ++k)
                {
                    // engine.ts previewPreset(): velocity 0.8, starting 10 ms from now.
                    NoteEvent e;
                    e.kind = NoteEvent::Kind::noteOn;
                    e.time = (double) ctx.blockStart + 0.01 * sampleRate;
                    e.channel = 0; // the preview synth
                    e.key = cmd.keys[(size_t) k];
                    e.velocity = 0.8f;
                    e.lengthSeconds = cmd.duration;
                    addEvent (e);
                }
                break;

            case EngineCommand::Type::previewStop:
                previewSynth->killAll (ctx, 0);
                for (auto& p : samplePreviews)
                    p.remaining = std::min<int64_t> (p.remaining, 0);
                break;
        }
    }
}

void AudioEngine::renderPreviews (const BlockContext& ctx, float* left, float* right) noexcept
{
    const int n = ctx.numSamples;
    float* pl = previewL.data();
    float* pr = previewR.data();
    const bool synthIdle = previewSynth->isIdle();
    const bool stereo = previewSynth->render (ctx, pl, pr);
    if (! synthIdle)
    {
        // Mono preview output is up-mixed at the master input (L = R = M).
        for (int i = 0; i < n; ++i)
        {
            left[i] += pl[i];
            right[i] += stereo ? pr[i] : pl[i];
        }
    }

    for (auto& p : samplePreviews)
    {
        if (p.sample == nullptr)
            continue;
        const auto& s = *p.sample;
        const float* d0 = s.channel (0);
        const float* d1 = s.channel (1);
        int i = 0;
        for (; i < n && p.remaining > 0; ++i, --p.remaining)
        {
            const auto i0 = (int64_t) p.position;
            if (i0 >= s.numFrames)
            {
                p.remaining = 0;
                break;
            }
            const auto i1 = std::min (i0 + 1, s.numFrames - 1);
            const double frac = p.position - (double) i0;
            const auto a = (float) (d0[i0] + (d0[i1] - d0[i0]) * frac) * 0.8f;
            const auto b = s.numChannels > 1 ? (float) (d1[i0] + (d1[i1] - d1[i0]) * frac) * 0.8f : a;
            left[i] += a;
            right[i] += b;
            p.position += p.increment;
        }
        if (p.remaining <= 0)
        {
            s.pins.fetch_sub (1);
            p.sample = nullptr;
        }
    }
}

void AudioEngine::renderClicks (const BlockContext& ctx, float* out) noexcept
{
    const int n = ctx.numSamples;
    std::fill (out, out + n, 0.0f);
    for (auto& c : clicks)
    {
        if (! c.active)
            continue;
        const double freq = c.accent ? 1760.0 : 1175.0;
        const double amp = c.accent ? 0.6 : 0.4;
        const int first = std::max (0, (int) std::ceil (c.startTime - (double) ctx.blockStart - 1.0e-9));
        for (int i = first; i < n; ++i)
        {
            const double t = ((double) (ctx.blockStart + i) - c.startTime) / sampleRate;
            if (t >= 0.08)
            {
                c.active = false;
                break;
            }
            // graph.ts metronomeClick(): 0 -> amp in 1 ms, hold, then tau 12 ms from +2 ms.
            const double env = t < 0.001 ? amp * (t / 0.001) : (t < 0.002 ? amp : amp * std::exp (-(t - 0.002) / 0.012));
            out[i] += (float) (std::sin (twoPi * freq * t) * env);
        }
        if (c.active && ((double) (ctx.blockStart + n) - c.startTime) / sampleRate >= 0.08)
            c.active = false;
    }
}

void AudioEngine::publishMeters (GraphSnapshot* snap, const float* masterL, int n) noexcept
{
    for (int i = 0; i < n; ++i)
    {
        waveRing[(size_t) wavePos] = masterL[i];
        wavePos = (wavePos + 1) % (int) waveRing.size();
    }

    auto& frame = meters.writeBuffer();
    frame.numTracks = snap != nullptr ? (int) std::min (snap->tracks.size(), (size_t) maxMixerTracks) : 0;
    for (int t = 0; t < frame.numTracks; ++t)
    {
        const auto* node = snap->tracks[(size_t) t].node;
        frame.peaks[(size_t) t] = { node->peakLeft(), node->peakRight() };
    }
    for (size_t i = 0; i < waveRing.size(); ++i)
        frame.waveform[i] = waveRing[(i + (size_t) wavePos) % waveRing.size()];
    frame.serial = blockCounter;
    meters.publish();
}

void AudioEngine::processBlock (const float* const* inputs, int numInputs, float* const* outputs, int numOutputs,
                                int n) noexcept
{
    GraphSnapshot* snap = snapshots.acquire();

    BlockContext ctx;
    ctx.sampleRate = sampleRate;
    ctx.numSamples = n;
    ctx.numChunks = (n + chunkSize - 1) / chunkSize;
    ctx.blockStart = clock.load (std::memory_order_relaxed);
    ctx.blockIndex = ++blockCounter;
    for (int c = 0; c < ctx.numChunks; ++c)
        ctx.bpm[(size_t) c] = std::clamp ((double) bpm.overrideOrBase(), 10.0, 522.0);

    due.clear();
    chokes.size = 0;
    handleCommands (snap, ctx);

    // Automation + sequencer.
    AutomationBinding* automation = snap != nullptr ? snap->automation.get() : nullptr;
    if (automation != nullptr)
        for (auto& entry : automation->entries)
            if (entry.param != nullptr)
                entry.state = entry.param->beginAutomation (ctx);

    {
        Dispatcher dispatcher (*this, snap, ctx);
        sequencer.process (ctx, snap != nullptr ? snap->timeline.get() : nullptr, bpm, swing,
                           beatsPerBar.load (std::memory_order_relaxed),
                           metronomeEnabled.load (std::memory_order_relaxed), dispatcher);
    }

    if (automation != nullptr)
        for (auto& entry : automation->entries)
            if (entry.param != nullptr)
                entry.param->endAutomation (entry.state);

    // Events due in this block, in time order (insertion sort keeps equal times in order).
    const double blockEnd = (double) (ctx.blockStart + n);
    for (size_t i = 0; i < pending.size();)
    {
        if (pending[i].time < blockEnd - 1.0e-9 || pending[i].time < (double) ctx.blockStart)
        {
            if ((int) due.size() < maxPending)
                due.push_back (pending[i]);
            pending[i] = pending.back();
            pending.pop_back();
        }
        else
        {
            ++i;
        }
    }
    for (size_t i = 1; i < due.size(); ++i)
    {
        const NoteEvent e = due[i];
        size_t j = i;
        for (; j > 0 && due[j - 1].time > e.time; --j)
            due[j] = due[j - 1];
        due[j] = e;
    }
    for (auto& e : due)
        e.offset = std::clamp ((int) std::ceil (e.time - (double) ctx.blockStart - 1.0e-9), 0, n - 1);

    // Dispatch: choke requests first (they apply to every sampler), then the notes.
    if (snap != nullptr)
    {
        for (const auto& e : due)
        {
            if (e.kind != NoteEvent::Kind::noteOn)
                continue;
            auto* node = snap->findChannel (e.channel);
            if (node != nullptr && node->kind == ChannelKind::sampler && (e.handle != 0 || ! node->muted.load()))
                static_cast<SamplerInstrument*> (node->instrument.get())->collectChokes (e, ctx, chokes);
        }
        for (const auto& e : due)
        {
            if (e.channel == 0)
            {
                previewSynth->handleEvent (e, ctx);
                continue;
            }
            auto* node = snap->findChannel (e.channel);
            if (node == nullptr)
                continue;
            if (e.kind == NoteEvent::Kind::noteOn)
            {
                // graph.ts trigger(): sequenced notes on muted channels are not played.
                if (e.handle == 0 && node->muted.load (std::memory_order_relaxed))
                    continue;
                node->lastTrigger.store ((int64_t) e.time, std::memory_order_relaxed);
            }
            node->instrument->handleEvent (e, ctx);
        }
        if (chokes.size > 0)
            for (const auto& c : snap->channels)
                if (c.node->kind == ChannelKind::sampler)
                    c.node->instrument->applyChokes (chokes, ctx);
    }
    else
    {
        for (const auto& e : due)
            if (e.channel == 0)
                previewSynth->handleEvent (e, ctx);
    }

    // Render: channels -> tracks -> master -> device.
    float* outL = numOutputs > 0 ? outputs[0] : nullptr;
    float* outR = numOutputs > 1 ? outputs[1] : nullptr;

    if (snap == nullptr || snap->tracks.empty())
    {
        renderPreviews (ctx, previewL.data(), previewR.data()); // keep previews consistent
        for (int c = 0; c < numOutputs; ++c)
            if (outputs[c] != nullptr)
                std::fill (outputs[c], outputs[c] + n, 0.0f);
    }
    else
    {
        for (const auto& t : snap->tracks)
            t.node->clearBus (n, t.sidechainFed);

        for (const auto& t : snap->tracks)
            if (t.node->monitor.load (std::memory_order_relaxed))
                t.node->addInput (inputs, numInputs, n);

        if (session != nullptr && sessionRecording)
            session->capture (inputs, numInputs, n);

        for (const auto& c : snap->channels)
        {
            auto* track = snap->tracks[(size_t) c.track].node;
            c.node->process (ctx, track->busL.data(), track->busR.data(), c.delay, c.delaySamples);
        }

        auto* master = snap->tracks[0].node;
        renderPreviews (ctx, master->busL.data(), master->busR.data());

        // Tracks in routing order (senders before their targets, the master last); every send adds
        // the track's output to the target's input or sidechain bus, delayed for plugin delay
        // compensation where the paths into the target differ in latency.
        for (const int index : snap->order)
        {
            auto& entry = snap->tracks[(size_t) index];
            entry.node->process (ctx, entry.chain, entry.sidechainFed);
            for (const auto& route : entry.routes)
            {
                auto* target = snap->tracks[(size_t) route.to].node;
                const float* srcL = entry.node->busL.data();
                const float* srcR = entry.node->busR.data();
                if (route.delay != nullptr && route.delaySamples > 0)
                {
                    std::copy (srcL, srcL + n, routeL.begin());
                    std::copy (srcR, srcR + n, routeR.begin());
                    float* bus[] = { routeL.data(), routeR.data() };
                    route.delay->process (bus, n, route.delaySamples);
                    srcL = routeL.data();
                    srcR = routeR.data();
                }
                float* destL = route.sidechain ? target->sidechainL.data() : target->busL.data();
                float* destR = route.sidechain ? target->sidechainR.data() : target->busR.data();
                route.node->addTo (ctx, srcL, srcR, destL, destR);
            }
        }

        renderClicks (ctx, clickBuffer.data());
        if (snap->clickDelay != nullptr && snap->latency > 0)
        {
            float* click[] = { clickBuffer.data() };
            snap->clickDelay->process (click, n, snap->latency);
        }
        const float* ml = master->busL.data();
        const float* mr = master->busR.data();
        const float* ck = clickBuffer.data();
        if (outL != nullptr)
            for (int i = 0; i < n; ++i)
                outL[i] = ml[i] + ck[i] * 0.5f;
        if (outR != nullptr)
            for (int i = 0; i < n; ++i)
                outR[i] = mr[i] + ck[i] * 0.5f;
        for (int c = 2; c < numOutputs; ++c)
            if (outputs[c] != nullptr)
                std::fill (outputs[c], outputs[c] + n, 0.0f);

        publishMeters (snap, ml, n);
    }

    clock.store (ctx.blockStart + n, std::memory_order_relaxed);

    // Transport position for status messages (every field is rewritten for each frame).
    auto& position = positions.writeBuffer();
    position.sample = ctx.blockStart + n;
    position.state = sequencer.state() == Sequencer::State::playing ? 2 : (sequencer.state() == Sequencer::State::countIn ? 1 : 0);
    position.tick = position.state == 0 ? sequencer.nextStartTick() : sequencer.position();
    position.ticksPerSample = sequencer.ticksPerSample();
    const auto* tl = snap != nullptr ? snap->timeline.get() : nullptr;
    position.loopStart = tl != nullptr ? tl->loopStart : 0.0;
    position.loopEnd = tl != nullptr ? tl->loopEnd : 0.0;
    position.nextStart = sequencer.nextStartTick();
    position.seq = transportSeq;
    position.latency = snap != nullptr ? snap->latency : 0;
    positions.publish();

    snapshots.release();
}

} // namespace mad
