#pragma once

#include "core/Json.h"

#include <juce_audio_processors/juce_audio_processors.h>

#include <memory>

namespace mad
{

/** Adds the plugin formats this build hosts (VST3; AudioUnit on macOS; LV2 on Linux). */
void addHostedFormats (juce::AudioPluginFormatManager& manager);

/** Protocol PluginDescription: uid, name, vendor, format, category, version, fileOrIdentifier,
    isInstrument, numInputs, numOutputs, plus the fields needed to recreate the description
    (descriptiveName, uniqueId, deprecatedUid, lastFileModTime, lastInfoUpdateTime, hasSharedContainer). */
void writeDescription (json::Writer& w, const juce::PluginDescription& d);
bool readDescription (const juce::var& v, juce::PluginDescription& d);

/** `--scan-plugin <format> <fileOrIdentifier>`: prints {"plugins":[…]} on the protocol stdout
    and exits. Must run with a message loop (AudioUnits are created asynchronously). */
class PluginScanJob : private juce::Thread
{
public:
    PluginScanJob (juce::String format, juce::String fileOrIdentifier, std::function<void (int exitCode)> onDone);
    ~PluginScanJob() override;

    void start();

private:
    void run() override;
    void scan();

    juce::String formatName, target;
    std::function<void (int)> done;
    juce::AudioPluginFormatManager formats;
};

} // namespace mad
