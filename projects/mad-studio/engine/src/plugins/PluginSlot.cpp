#include "plugins/PluginSlot.h"

namespace mad
{

PluginSlot::PluginSlot (juce::String k, PluginRef r, bool instrument)
    : key (std::move (k)), ref (std::move (r)), isInstrument (instrument)
{
}

PluginSlot::~PluginSlot()
{
    ready.store (nullptr);
    if (owned != nullptr)
    {
        lock.lock();
        owned->removeListener (this);
        owned->releaseResources();
        owned.reset();
        lock.unlock();
    }
}

void PluginSlot::setInstance (std::unique_ptr<juce::AudioPluginInstance> instance, double sampleRate, int blockSize)
{
    lock.lock();
    ready.store (nullptr);
    if (owned != nullptr)
    {
        owned->removeListener (this);
        owned->releaseResources();
    }
    owned = std::move (instance);
    rate = sampleRate;
    block = blockSize;
    if (owned != nullptr)
    {
        numIn.store (owned->getTotalNumInputChannels());
        numOut.store (owned->getTotalNumOutputChannels());
        owned->addListener (this);
        ready.store (owned.get());
    }
    lock.unlock();
}

juce::AudioPluginInstance* PluginSlot::acquire() noexcept
{
    auto* p = ready.load (std::memory_order_acquire);
    if (p == nullptr || ! lock.tryLock())
        return nullptr;
    p = ready.load (std::memory_order_acquire);
    if (p == nullptr)
        lock.unlock();
    return p;
}

void PluginSlot::release() noexcept { lock.unlock(); }

void PluginSlot::reprepare (double sampleRate, int blockSize)
{
    lock.lock();
    if (owned != nullptr && (sampleRate < rate || sampleRate > rate || blockSize != block))
    {
        owned->releaseResources();
        owned->setRateAndBufferSizeDetails (sampleRate, blockSize);
        owned->prepareToPlay (sampleRate, blockSize);
        numIn.store (owned->getTotalNumInputChannels());
        numOut.store (owned->getTotalNumOutputChannels());
    }
    rate = sampleRate;
    block = blockSize;
    lock.unlock();
}

void PluginSlot::prepareExclusive (double sampleRate, int blockSize, bool nonRealtime)
{
    if (owned != nullptr)
    {
        owned->releaseResources();
        owned->setNonRealtime (nonRealtime);
        owned->setRateAndBufferSizeDetails (sampleRate, blockSize);
        owned->prepareToPlay (sampleRate, blockSize);
        owned->reset();
        numIn.store (owned->getTotalNumInputChannels());
        numOut.store (owned->getTotalNumOutputChannels());
    }
    rate = sampleRate;
    block = blockSize;
}

void PluginSlot::setParameterFromAudioThread (int index, float value) noexcept
{
    auto* p = ready.load (std::memory_order_acquire);
    if (p == nullptr)
        return;
    const auto& params = p->getParameters();
    if (index >= 0 && index < params.size())
        params.getUnchecked (index)->setValue (juce::jlimit (0.0f, 1.0f, value));
}

void PluginSlot::audioProcessorParameterChanged (juce::AudioProcessor*, int parameterIndex, float newValue)
{
    changedIndex.store (parameterIndex);
    changedValue.store (newValue);
    changeCount.fetch_add (1, std::memory_order_release);
}

bool PluginSlot::takeChangedParameter (int& index, float& value) noexcept
{
    const auto c = changeCount.load (std::memory_order_acquire);
    if (c == seenChangeCount)
        return false;
    seenChangeCount = c;
    index = changedIndex.load();
    value = changedValue.load();
    return index >= 0;
}

} // namespace mad
