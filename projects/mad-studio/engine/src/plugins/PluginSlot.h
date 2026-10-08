#pragma once

#include "core/Realtime.h"
#include "engine/ProjectModel.h"

#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <memory>

namespace mad
{

/** Owns one hosted plugin instance (keyed "ch:<channelId>" or "fx:<slotId>").

    The audio thread processes through acquire()/release() (a try-lock: when the instance is
    busy elsewhere, e.g. borrowed by an offline render, the caller outputs silence). Must be
    destroyed on the message thread. */
class PluginSlot : private juce::AudioProcessorListener
{
public:
    PluginSlot (juce::String key, PluginRef ref, bool isInstrument);
    ~PluginSlot() override;

    const juce::String key;
    const PluginRef ref;
    const bool isInstrument;

    /** Message thread: installs a prepared instance. */
    void setInstance (std::unique_ptr<juce::AudioPluginInstance> instance, double sampleRate, int blockSize);

    /** Message thread: the instance (null while loading or after a failure). */
    juce::AudioPluginInstance* get() const noexcept { return owned.get(); }

    /** Audio thread: the instance to process, or nullptr (then output silence). */
    juce::AudioPluginInstance* acquire() noexcept;
    void release() noexcept;

    /** Render thread while this thread holds the slot exclusively (lockExclusive()) or the
        slot is never shared (command-line renders). */
    juce::AudioPluginInstance* exclusiveInstance() const noexcept { return ready.load (std::memory_order_acquire); }

    /** Exclusive owner only: prepares without taking the lock. */
    void prepareExclusive (double sampleRate, int blockSize, bool nonRealtime);

    /** Exclusive use outside the realtime callback (offline render, re-prepare). Spins until
        the audio thread has finished its current block. */
    void lockExclusive() noexcept { lock.lock(); }
    void unlockExclusive() noexcept { lock.unlock(); }

    /** Message/render thread: prepares for a new rate or block size (takes the lock). */
    void reprepare (double sampleRate, int blockSize);

    double preparedSampleRate() const noexcept { return rate; }
    int preparedBlockSize() const noexcept { return block; }
    int numInputChannels() const noexcept { return numIn.load(); }
    int numOutputChannels() const noexcept { return numOut.load(); }

    /** Audio thread: automation of a normalised parameter. */
    void setParameterFromAudioThread (int index, float value) noexcept;

    /** Message thread: the parameter most recently changed by the plugin itself (editor,
        host-visible changes); false if nothing changed since the last call. */
    bool takeChangedParameter (int& index, float& value) noexcept;

    juce::String error;      // message thread
    bool failed = false;     // message thread
    juce::String appliedState; // last state we loaded or reported (message thread)

private:
    void audioProcessorParameterChanged (juce::AudioProcessor*, int parameterIndex, float newValue) override;
    void audioProcessorChanged (juce::AudioProcessor*, const ChangeDetails&) override {}

    std::unique_ptr<juce::AudioPluginInstance> owned;
    std::atomic<juce::AudioPluginInstance*> ready { nullptr };
    SpinTryLock lock;
    double rate = 0.0;
    int block = 0;
    std::atomic<int> numIn { 0 }, numOut { 0 };

    std::atomic<int> changedIndex { -1 };
    std::atomic<float> changedValue { 0.0f };
    std::atomic<uint32_t> changeCount { 0 };
    uint32_t seenChangeCount = 0;
};

} // namespace mad
