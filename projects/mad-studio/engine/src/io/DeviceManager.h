#pragma once

#include "io/NullDevice.h"

#include <juce_audio_devices/juce_audio_devices.h>

#include <functional>
#include <memory>

namespace mad
{

class AudioEngine;

/** Owns the audio device (JUCE AudioDeviceManager: 2 outputs, up to 8 inputs) and falls back
    to the null device when nothing can be opened. */
class DeviceController : private juce::AudioIODeviceCallback, private juce::ChangeListener
{
public:
    struct Request
    {
        juce::String type, output, input;
        double sampleRate = 0.0;
        int bufferSize = 0;
        bool forceNull = false;
    };

    struct Info
    {
        juce::String type, output, input;
        double sampleRate = 48000.0;
        int bufferSize = 512;
        juce::StringArray inputChannels, outputChannels;
        int inputLatency = 0, outputLatency = 0;
        bool isNull = true;
    };

    explicit DeviceController (AudioEngine& engine);
    ~DeviceController() override;

    /** Opens the device (or the null device). `prepare(sampleRate, blockSize)` runs while no
        audio callback is active, before processing starts. Returns a warning/error text. */
    juce::String open (const Request& request, const std::function<void (double, int)>& prepare);

    /** Stops all audio callbacks. */
    void close();

    Info info() const;

    /** The audio.devices message (protocol JSON line). */
    std::string devicesJson() const;

    /** Shows the driver's own settings panel (ASIO; FL Studio's "Show ASIO panel"). Blocks until
        the panel closes and restarts the device if the driver changed its settings, calling
        `prepare` like open(). False if the current device has no panel. */
    bool showControlPanel (const std::function<void (double, int)>& prepare);

    /** Called on the message thread when the device stopped or changed by itself. */
    std::function<void()> onDeviceChanged;

    void setNullInputTone (double hz) { nullDevice.setInputTone (hz); }

private:
    void audioDeviceIOCallbackWithContext (const float* const* inputs, int numInputs, float* const* outputs,
                                           int numOutputs, int numSamples,
                                           const juce::AudioIODeviceCallbackContext& context) override;
    void audioDeviceAboutToStart (juce::AudioIODevice*) override {}
    void audioDeviceStopped() override {}
    void audioDeviceError (const juce::String& message) override;
    void changeListenerCallback (juce::ChangeBroadcaster*) override;

    void startNull (double sampleRate, int blockSize, const std::function<void (double, int)>& prepare);
    bool startCurrentDevice (const std::function<void (double, int)>& prepare);

    AudioEngine& engine;
    juce::AudioDeviceManager manager;
    NullDevice nullDevice;
    bool initialised = false, usingNull = true, callbackAdded = false;
    double preparedRate = 0.0;
    int preparedBlock = 0;
    std::atomic<bool> processing { false };
};

} // namespace mad
