#include "io/DeviceManager.h"

#include "core/Json.h"
#include "core/Log.h"
#include "engine/AudioEngine.h"

namespace mad
{

DeviceController::DeviceController (AudioEngine& e) : engine (e) {}

DeviceController::~DeviceController()
{
    close();
    if (initialised)
    {
        manager.removeChangeListener (this);
        manager.closeAudioDevice();
    }
}

void DeviceController::close()
{
    if (callbackAdded)
    {
        manager.removeAudioCallback (this);
        callbackAdded = false;
    }
    nullDevice.stop();
}

void DeviceController::startNull (double sampleRate, int blockSize, const std::function<void (double, int)>& prepare)
{
    const double rate = sampleRate >= 8000.0 && sampleRate <= 384000.0 ? sampleRate : 48000.0;
    const int block = blockSize >= 16 && blockSize <= 8192 ? blockSize : 512;
    preparedRate = rate;
    preparedBlock = block;
    usingNull = true;
    prepare (rate, std::min (block, maxBlockSize));
    nullDevice.start (rate, block, [this] (const float* const* in, int numIn, float* const* out, int numOut, int n)
    {
        engine.process (in, numIn, out, numOut, n);
    });
}

juce::String DeviceController::open (const Request& request, const std::function<void (double, int)>& prepare)
{
    close();

    if (! request.forceNull && request.type != "Null")
    {
        juce::String error;
        if (! initialised)
        {
            initialised = true;
            manager.addChangeListener (this);
            error = manager.initialise (8, 2, nullptr, true);
        }

        if (request.type.isNotEmpty() && request.type != manager.getCurrentAudioDeviceType())
            manager.setCurrentAudioDeviceType (request.type, true);

        auto setup = manager.getAudioDeviceSetup();
        if (request.output.isNotEmpty())
            setup.outputDeviceName = request.output;
        if (request.input.isNotEmpty())
            setup.inputDeviceName = request.input == "none" ? juce::String() : request.input;
        // ASIO drivers are one device for inputs and outputs.
        if (auto* type = manager.getCurrentDeviceTypeObject(); type != nullptr && ! type->hasSeparateInputsAndOutputs()
                                                                && setup.inputDeviceName.isNotEmpty())
            setup.inputDeviceName = setup.outputDeviceName;
        if (request.sampleRate > 0.0)
            setup.sampleRate = request.sampleRate;
        if (request.bufferSize > 0)
            setup.bufferSize = request.bufferSize;
        setup.useDefaultInputChannels = false;
        setup.inputChannels.clear();
        setup.inputChannels.setRange (0, 8, true);
        setup.useDefaultOutputChannels = false;
        setup.outputChannels.clear();
        setup.outputChannels.setRange (0, 2, true);
        const auto setupError = manager.setAudioDeviceSetup (setup, true);
        if (setupError.isNotEmpty())
            error = setupError;

        if (startCurrentDevice (prepare))
            return error;

        if (error.isEmpty())
            error = "no audio device available";
        logMessage ("audio device: " + error + " - using the null device");
        startNull (request.sampleRate, request.bufferSize, prepare);
        return error;
    }

    startNull (request.sampleRate, request.bufferSize, prepare);
    return {};
}

bool DeviceController::startCurrentDevice (const std::function<void (double, int)>& prepare)
{
    auto* device = manager.getCurrentAudioDevice();
    if (device == nullptr || ! device->isOpen())
        return false;
    preparedRate = device->getCurrentSampleRate();
    preparedBlock = device->getCurrentBufferSizeSamples();
    usingNull = false;
    prepare (preparedRate, std::clamp (preparedBlock, 16, maxBlockSize));
    manager.addAudioCallback (this);
    callbackAdded = true;
    return true;
}

bool DeviceController::showControlPanel (const std::function<void (double, int)>& prepare)
{
    auto* device = usingNull ? nullptr : manager.getCurrentAudioDevice();
    if (device == nullptr || ! device->hasControlPanel())
        return false;
    if (device->showControlPanel())
    {
        // The driver changed its settings (buffer size, rate): reopen it with them.
        close();
        manager.closeAudioDevice();
        manager.restartLastAudioDevice();
        if (! startCurrentDevice (prepare))
        {
            logMessage ("audio device: could not restart after its control panel - using the null device");
            startNull (preparedRate, preparedBlock, prepare);
        }
    }
    return true;
}

void DeviceController::audioDeviceIOCallbackWithContext (const float* const* inputs, int numInputs, float* const* outputs,
                                                         int numOutputs, int numSamples,
                                                         const juce::AudioIODeviceCallbackContext&)
{
    engine.process (inputs, numInputs, outputs, numOutputs, numSamples);
}

void DeviceController::audioDeviceError (const juce::String& message)
{
    logMessage ("audio device error: " + message);
}

void DeviceController::changeListenerCallback (juce::ChangeBroadcaster*)
{
    if (usingNull || ! callbackAdded)
        return;
    auto* device = manager.getCurrentAudioDevice();
    const bool lost = device == nullptr || ! device->isOpen();
    const bool changed = ! lost && (juce::approximatelyEqual (device->getCurrentSampleRate(), preparedRate) == false
                                    || device->getCurrentBufferSizeSamples() > maxBlockSize);
    if ((lost || changed) && onDeviceChanged)
        onDeviceChanged();
}

DeviceController::Info DeviceController::info() const
{
    Info i;
    if (usingNull)
    {
        i.type = "Null";
        i.output = "Null Output";
        i.input = "Null Input";
        i.sampleRate = preparedRate > 0.0 ? preparedRate : 48000.0;
        i.bufferSize = preparedBlock > 0 ? preparedBlock : 512;
        i.inputChannels = { "Null In 1", "Null In 2" };
        i.outputChannels = { "Null Out 1", "Null Out 2" };
        i.isNull = true;
        return i;
    }

    auto& m = const_cast<juce::AudioDeviceManager&> (manager);
    const auto setup = m.getAudioDeviceSetup();
    i.type = m.getCurrentAudioDeviceType();
    i.output = setup.outputDeviceName;
    i.input = setup.inputDeviceName;
    if (auto* device = m.getCurrentAudioDevice())
    {
        i.sampleRate = device->getCurrentSampleRate();
        i.bufferSize = device->getCurrentBufferSizeSamples();
        const auto active = device->getActiveInputChannels();
        const auto names = device->getInputChannelNames();
        for (int c = 0; c < names.size(); ++c)
            if (active[c])
                i.inputChannels.add (names[c]);
        const auto activeOut = device->getActiveOutputChannels();
        const auto outNames = device->getOutputChannelNames();
        for (int c = 0; c < outNames.size(); ++c)
            if (activeOut[c])
                i.outputChannels.add (outNames[c]);
        i.inputLatency = device->getInputLatencyInSamples();
        i.outputLatency = device->getOutputLatencyInSamples();
    }
    i.isNull = false;
    return i;
}

std::string DeviceController::devicesJson() const
{
    auto& m = const_cast<juce::AudioDeviceManager&> (manager);
    json::Writer w;
    w.beginObject().field ("type", "audio.devices");

    w.key ("types").beginArray();
    for (auto* type : m.getAvailableDeviceTypes())
    {
        w.beginObject().field ("name", type->getTypeName()).field ("separateInputs", type->hasSeparateInputsAndOutputs());
        w.key ("outputs").beginArray();
        for (const auto& n : type->getDeviceNames (false))
            w.value (n);
        w.endArray().key ("inputs").beginArray();
        for (const auto& n : type->getDeviceNames (true))
            w.value (n);
        w.endArray().endObject();
    }
    w.beginObject().field ("name", "Null").field ("separateInputs", true);
    w.key ("outputs").beginArray().value ("Null Output").endArray();
    w.key ("inputs").beginArray().value ("Null Input").endArray();
    w.endObject();
    w.endArray();

    const auto i = info();
    w.key ("current").beginObject()
        .field ("type", i.type)
        .field ("output", i.output)
        .field ("input", i.input)
        .field ("sampleRate", i.sampleRate)
        .field ("bufferSize", i.bufferSize);
    w.key ("inputChannels").beginArray();
    for (const auto& n : i.inputChannels)
        w.value (n);
    w.endArray().key ("outputChannels").beginArray();
    for (const auto& n : i.outputChannels)
        w.value (n);
    w.endArray()
        .field ("inputLatency", i.inputLatency)
        .field ("outputLatency", i.outputLatency)
        .field ("null", i.isNull)
        .field ("hasControlPanel", ! usingNull && m.getCurrentAudioDevice() != nullptr && m.getCurrentAudioDevice()->hasControlPanel())
        .endObject();

    juce::Array<double> rates { 44100.0, 48000.0, 88200.0, 96000.0 };
    juce::Array<int> sizes { 64, 128, 256, 512, 1024, 2048 };
    if (! usingNull)
    {
        if (auto* device = m.getCurrentAudioDevice())
        {
            rates = device->getAvailableSampleRates();
            sizes = device->getAvailableBufferSizes();
        }
    }
    w.key ("sampleRates").beginArray();
    for (const auto r : rates)
        w.value (r);
    w.endArray().key ("bufferSizes").beginArray();
    for (const auto s : sizes)
        w.value (s);
    w.endArray();

    w.endObject();
    return w.take();
}

} // namespace mad
