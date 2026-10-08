#pragma once

#include <juce_core/juce_core.h>

namespace mad
{

struct CommandLine
{
    enum class Mode
    {
        stdio,
        version,
        listDevices,
        selfTest,
        scanPlugin,
        render,
        help
    };

    Mode mode = Mode::stdio;
    juce::String dataDir;
    // --scan-plugin
    juce::String scanFormat, scanTarget;
    // --render
    juce::String renderJob, renderOut;
    double renderSampleRate = 0.0;
    int renderBitDepth = 0;
    // stdio extras
    bool nullAudio = false;
    double nullInputTone = 0.0;
    double sampleRate = 0.0;
    int bufferSize = 0;

    juce::String error;
};

CommandLine parseCommandLine (int argc, char* argv[]);

const char* usageText();

} // namespace mad
