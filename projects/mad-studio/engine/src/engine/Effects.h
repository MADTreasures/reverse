#pragma once

#include "core/Realtime.h"
#include "dsp/Biquad.h"
#include "dsp/Compressor.h"
#include "dsp/DelayLine.h"
#include "dsp/Smoother.h"
#include "dsp/WaveShaper.h"
#include "engine/Params.h"

#include <juce_dsp/juce_dsp.h>

#include <memory>
#include <vector>

namespace mad
{

class PluginSlot;

/** A mixer insert effect processing stereo audio in place. */
class Effect
{
public:
    explicit Effect (juce::String effectType);
    virtual ~Effect() = default;

    const juce::String type;
    const EffectSpec* const spec;

    /** Parameters in EffectSpec order (empty for plugin effects). */
    std::vector<AutoParam> params;

    /** Audio thread: the track's sidechain input for this block (null when nothing is sent to it). */
    const float* sidechainLeft = nullptr;
    const float* sidechainRight = nullptr;

    /** Message/render thread, before the effect is published. `offline` renders must be
        deterministic (no background rebuilds). */
    virtual void prepare (double sampleRate, int maxBlock, bool offline) = 0;

    /** Audio thread. */
    virtual void process (const BlockContext& ctx, float* left, float* right) noexcept = 0;

    /** Message thread, ~30x per second (background work such as reverb IR rebuilds). */
    virtual void service() {}

protected:
    /** Value of parameter `i` in chunk `c`, clamped to the model's range (EFFECT_SPECS), so
        out-of-range project or automation values cannot destabilise the DSP. */
    float param (int i, const BlockContext& ctx, int c) const noexcept
    {
        if (i >= (int) params.size())
            return 0.0f;
        const auto& range = spec->params[(size_t) i];
        return std::clamp (params[(size_t) i].value (ctx, c), range.min, range.max);
    }

    /** The project value of parameter `i`, clamped like param(). */
    float baseParam (int i) const noexcept
    {
        if (i >= (int) params.size())
            return 0.0f;
        const auto& range = spec->params[(size_t) i];
        return std::clamp (params[(size_t) i].getBase(), range.min, range.max);
    }
};

std::unique_ptr<Effect> createInternalEffect (const juce::String& type);

//==============================================================================
/** A hosted plugin effect (stereo in/out). */
class PluginEffect final : public Effect
{
public:
    PluginEffect (std::shared_ptr<PluginSlot> slot, bool exclusive);
    ~PluginEffect() override;

    void prepare (double sampleRate, int maxBlock, bool offline) override;
    void process (const BlockContext& ctx, float* left, float* right) noexcept override;

    PluginSlot& getSlot() const noexcept { return *slot; }

private:
    std::shared_ptr<PluginSlot> slot;
    const bool exclusive;
    juce::AudioBuffer<float> buffer;
    juce::MidiBuffer midi;
};

//==============================================================================
/** Reverb: predelay -> convolver (makeImpulseResponse, ConvolverNode normalisation) ->
    highpass(lowCut); exposed for tests and the IR rebuild service. */
class ReverbEffect final : public Effect
{
public:
    ReverbEffect();
    ~ReverbEffect() override;

    void prepare (double sampleRate, int maxBlock, bool offline) override;
    void process (const BlockContext& ctx, float* left, float* right) noexcept override;
    void service() override;

    /** Builds the normalised stereo IR for the rounded decay/damping. */
    static std::unique_ptr<juce::AudioBuffer<float>> buildImpulse (double sampleRate, double decay, double damping);

private:
    void installImpulse (std::unique_ptr<juce::AudioBuffer<float>> ir) noexcept;

    double sampleRate = 48000.0;
    int maxBlockSize = 512;
    bool offlineMode = false;
    juce::dsp::Convolution convolution { juce::dsp::Convolution::NonUniform { 2048 } };
    dsp::DelayLine preL, preR;
    dsp::OnePole predelay, lowCut, dry, wet;
    dsp::BiquadState hpL, hpR;
    dsp::BiquadCoeffs hpCoeffs;
    double hpFreq = -1.0;
    std::vector<float> wetL, wetR;

    // IR rebuild: the audio thread publishes the wanted (rounded) values, the message thread
    // debounces and builds on a worker, the audio thread installs the result.
    struct IrState
    {
        std::atomic<juce::AudioBuffer<float>*> mailbox { nullptr };
        std::atomic<bool> building { false };
        ~IrState() { delete mailbox.load(); }
    };
    std::shared_ptr<IrState> irState = std::make_shared<IrState>();
    std::atomic<int> wantedKey { -1 };
    int builtKey = -1, pendingKey = -1;
    double pendingSince = 0.0;
    SpscFifo<juce::AudioBuffer<float>*, 16> returned;
};

} // namespace mad
