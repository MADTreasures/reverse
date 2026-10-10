#pragma once

#include "dsp/Biquad.h"
#include "dsp/Envelope.h"
#include "dsp/Oscillator.h"
#include "dsp/Panner.h"
#include "dsp/Smoother.h"
#include "engine/NoteShaping.h"
#include "engine/Params.h"
#include "engine/Samples.h"

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <memory>
#include <vector>

namespace mad
{

class PluginSlot;

/** Choke requests of one block: voices of `group` that started before `time` are killed. */
struct ChokeRequest
{
    int group = 0;            // > 0: choke group; < 0: -(channel uid) for cutSelf
    double time = 0.0;        // absolute samples
};

struct ChokeList
{
    std::array<ChokeRequest, 256> items {};
    int size = 0;

    void add (int group, double time) noexcept
    {
        if (size < (int) items.size())
            items[(size_t) size++] = { group, time };
    }
};

//==============================================================================
class Instrument
{
public:
    virtual ~Instrument() = default;

    /** Message thread, before the instrument is first published. */
    virtual void prepare (double sampleRate, int maxBlock) = 0;

    /** Audio thread: a note event for this block (voices start at e.offset). */
    virtual void handleEvent (const NoteEvent& e, const BlockContext& ctx) = 0;

    /** Audio thread: renders the block into left/right (overwriting). Returns true when the
        output is stereo; mono output is written to `left` only. */
    virtual bool render (const BlockContext& ctx, float* left, float* right) = 0;

    /** Audio thread: fades out everything from `offset` (transport stop/seek, panic). */
    virtual void killAll (const BlockContext& ctx, int offset) = 0;

    /** Audio thread: applies this block's choke requests (samplers only). */
    virtual void applyChokes (const ChokeList&, const BlockContext&) {}

    /** Audio thread: true when rendering would only produce silence. */
    virtual bool isIdle() const noexcept = 0;

    /** Audio thread, after render(): the stereo output of voices with a note pan, if any. They
        are kept apart from the main output so the channel pans the other voices unchanged
        (graph.ts ChannelStrip: the instrument's pannedOutput gets its own stereo pan stage). */
    virtual bool pannedOutput (const float*& left, const float*& right) const noexcept
    {
        juce::ignoreUnused (left, right);
        return false;
    }
};

//==============================================================================
/** synth.ts: three oscillators with unison, filter with envelope, LFO, 24 voices. */
class SynthInstrument final : public Instrument
{
public:
    SynthInstrument();

    std::array<AutoParam, synth::numParams> params;

    void prepare (double sampleRate, int maxBlock) override;
    void handleEvent (const NoteEvent& e, const BlockContext& ctx) override;
    bool render (const BlockContext& ctx, float* left, float* right) override;
    void killAll (const BlockContext& ctx, int offset) override;
    bool isIdle() const noexcept override;
    bool pannedOutput (const float*& left, const float*& right) const noexcept override;

    int activeVoiceCount() const noexcept;

private:
    static constexpr int maxVoices = 24;
    static constexpr int poolSize = 64;
    static constexpr int maxSubs = 21;

    struct Sub
    {
        dsp::Wave wave = dsp::Wave::sine;
        double increment = 0.0; // cycles per sample before the pitch LFO
        float level = 0.0f, scale = 1.0f;
        bool panned = false;
        dsp::PanGains gains;
        double startTime = 0.0; // absolute samples
        dsp::BlepOscillator osc;
        double noisePos = 0.0;
        bool started = false;
    };

    struct Voice
    {
        bool active = false;
        uint64_t serial = 0;
        int key = 60;
        int32_t handle = 0;
        double startTime = 0.0, stopTime = 0.0, endTime = 0.0;
        bool killed = false;
        bool subStereo = false; // panned oscillators make the voice signal stereo
        bool stereo = false;    // the voice's output is stereo (subStereo or note pan)
        int numSubs = 0;
        std::array<Sub, maxSubs> subs;
        bool filterOn = false;
        dsp::BiquadType filterType = dsp::BiquadType::lowpass;
        dsp::BiquadState filterL, filterR;
        dsp::BiquadCoeffs coeffs;
        dsp::EnvelopeGenerator amp, filterEnv;
        bool linkPitch = false, linkFilter = false, tremolo = false;
        float tremBase = 1.0f;
        // Note properties (synth.ts trigger(): note pan after the amp, Mod X/Y on the filter).
        notes::PitchCurve pitch;
        double modX = 1.0;
        float modY = 0.5f;
        bool notePanned = false;
        double notePan = 0.0;
        dsp::PanGains noteGains;
    };

    void startVoice (const NoteEvent& e, const BlockContext& ctx);
    void kill (Voice& v, double atTime) noexcept;
    void enforcePolyphony (double atTime) noexcept;
    void renderVoice (Voice& v, const BlockContext& ctx, float* mono, float* left, float* right, float* pannedLeft,
                      float* pannedRight) noexcept;

    double sampleRate = 48000.0;
    std::array<Voice, poolSize> voices;
    uint64_t nextSerial = 1;
    const std::vector<float>* noise = nullptr;

    // Instrument-wide LFO and live gains.
    double lfoPhase = 0.0;
    dsp::OnePole lfoRate, lfoPitchGain, lfoFilterGain, lfoAmpGain, outputGain;
    std::vector<float> lfoBuffer, ampGainBuffer, outBuffer, monoBuffer, stereoL, stereoR, pannedL, pannedR;
    bool anyPanned = false;
    std::array<float, maxChunks> chunkLfoPitch {}, chunkLfoFilter {};
};

//==============================================================================
/** sampler.ts: pitch-shifting sample player, one-shot/gated, loop, reverse, chokes, 32 voices. */
class SamplerInstrument final : public Instrument
{
public:
    explicit SamplerInstrument (uint32_t channelUid);

    std::array<AutoParam, sampler::numParams> params;

    /** Set by the graph builder; the published snapshot keeps the samples alive. */
    std::atomic<const SampleData*> forward { nullptr }, reversed { nullptr };

    void prepare (double sampleRate, int maxBlock) override;
    void handleEvent (const NoteEvent& e, const BlockContext& ctx) override;
    bool render (const BlockContext& ctx, float* left, float* right) override;
    void killAll (const BlockContext& ctx, int offset) override;
    void applyChokes (const ChokeList& chokes, const BlockContext& ctx) override;
    bool isIdle() const noexcept override;
    bool pannedOutput (const float*& left, const float*& right) const noexcept override;

    /** Called by the engine before events are dispatched: choke requests this note causes. */
    void collectChokes (const NoteEvent& e, const BlockContext& ctx, ChokeList& out) const noexcept;

    ~SamplerInstrument() override;

private:
    static constexpr int maxVoices = 32;
    static constexpr int poolSize = 64;

    struct Voice
    {
        bool active = false;
        uint64_t serial = 0;
        int key = 60;
        int32_t handle = 0;
        const SampleData* sample = nullptr;
        double startTime = 0.0, stopTime = 0.0, endTime = 0.0, naturalEnd = 0.0;
        bool killed = false, gated = false, loop = false;
        double readPos = 0.0, increment = 1.0, loopStart = 0.0, loopEnd = 0.0;
        dsp::EnvelopeGenerator env;
        int chokeGroup = 0;
        bool cutSelf = false;
        // Note properties (sampler.ts trigger(): detune curve, note pan after the amp).
        notes::PitchCurve pitch;
        double baseIncrement = 1.0;
        bool notePanned = false;
        double notePan = 0.0;
        dsp::PanGains noteGains;
    };

    void kill (Voice& v, double atTime) noexcept;
    void finish (Voice& v) noexcept;

    const uint32_t uid;
    double sampleRate = 48000.0;
    std::array<Voice, poolSize> voices;
    uint64_t nextSerial = 1;
    dsp::OnePole outputGain;
    std::vector<float> outBuffer, pannedL, pannedR;
    bool anyPanned = false;
};

//==============================================================================
/** A hosted plugin instrument: MIDI with sample offsets, first two outputs. */
class PluginInstrument final : public Instrument
{
public:
    /** `exclusive`: the caller owns the slot for the whole render (no try-lock). */
    PluginInstrument (std::shared_ptr<PluginSlot> slot, bool exclusive);
    ~PluginInstrument() override;

    void prepare (double sampleRate, int maxBlock) override;
    void handleEvent (const NoteEvent& e, const BlockContext& ctx) override;
    bool render (const BlockContext& ctx, float* left, float* right) override;
    void killAll (const BlockContext& ctx, int offset) override;
    bool isIdle() const noexcept override { return false; }

    PluginSlot& getSlot() const noexcept { return *slot; }

private:
    struct PendingOff
    {
        double time = 0.0;
        int key = 0;
        int channel = 1;        // MIDI channel 1..16 (note colour group + 1)
        float velocity = 0.5f;  // note-off velocity (note release)
    };
    struct LiveNote
    {
        int32_t handle = 0;
        int key = 0;
    };

    std::shared_ptr<PluginSlot> slot;
    const bool exclusive;
    double sampleRate = 48000.0;
    juce::AudioBuffer<float> buffer;
    juce::MidiBuffer midi;
    std::array<PendingOff, 512> pendingOffs {};
    int numPendingOffs = 0;
    std::array<LiveNote, 128> liveNotes {};
    int numLiveNotes = 0;
    std::array<std::array<uint8_t, 128>, 16> heldCount {}; // [MIDI channel - 1][key]
    bool sendAllNotesOff = false;
    int allNotesOffOffset = 0;
};

} // namespace mad
