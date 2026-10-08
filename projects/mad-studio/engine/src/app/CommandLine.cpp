#include "app/CommandLine.h"

namespace mad
{

const char* usageText()
{
    return "MAD Engine - native audio engine for MAD Studio\n"
           "\n"
           "  mad-engine [--stdio] --data-dir <dir> [--null-audio] [--null-input-tone <Hz>]\n"
           "             [--sample-rate N] [--buffer-size N]      JSON-lines protocol on stdin/stdout\n"
           "  mad-engine --version                               version as JSON\n"
           "  mad-engine --list-devices                          audio devices as JSON\n"
           "  mad-engine --self-test                             run the unit tests (exit code 0/1)\n"
           "  mad-engine --scan-plugin <format> <fileOrId>       scan one plugin, print {\"plugins\":[...]}\n"
           "  mad-engine --render <job.json> --out <file.wav> [--sample-rate N] [--bit-depth 16|24|32]\n"
           "             [--data-dir <dir>]                       offline render\n";
}

CommandLine parseCommandLine (int argc, char* argv[])
{
    CommandLine c;
    juce::StringArray args;
    for (int i = 1; i < argc; ++i)
        args.add (juce::String::fromUTF8 (argv[i]));

    const auto value = [&] (int& i, const char* name) -> juce::String
    {
        if (i + 1 >= args.size())
        {
            c.error = juce::String ("missing value for ") + name;
            return {};
        }
        return args[++i];
    };

    for (int i = 0; i < args.size() && c.error.isEmpty(); ++i)
    {
        const auto& a = args[i];
        if (a == "--stdio")
            c.mode = CommandLine::Mode::stdio;
        else if (a == "--data-dir")
            c.dataDir = value (i, "--data-dir");
        else if (a == "--version")
            c.mode = CommandLine::Mode::version;
        else if (a == "--list-devices")
            c.mode = CommandLine::Mode::listDevices;
        else if (a == "--self-test")
            c.mode = CommandLine::Mode::selfTest;
        else if (a == "--help" || a == "-h")
            c.mode = CommandLine::Mode::help;
        else if (a == "--scan-plugin")
        {
            c.mode = CommandLine::Mode::scanPlugin;
            c.scanFormat = value (i, "--scan-plugin");
            if (c.error.isEmpty())
                c.scanTarget = value (i, "--scan-plugin");
        }
        else if (a == "--render")
        {
            c.mode = CommandLine::Mode::render;
            c.renderJob = value (i, "--render");
        }
        else if (a == "--out")
            c.renderOut = value (i, "--out");
        else if (a == "--sample-rate")
        {
            const auto v = value (i, "--sample-rate").getDoubleValue();
            c.renderSampleRate = v;
            c.sampleRate = v;
        }
        else if (a == "--bit-depth")
            c.renderBitDepth = value (i, "--bit-depth").getIntValue();
        else if (a == "--buffer-size")
            c.bufferSize = value (i, "--buffer-size").getIntValue();
        else if (a == "--null-audio")
            c.nullAudio = true;
        else if (a == "--null-input-tone")
            c.nullInputTone = value (i, "--null-input-tone").getDoubleValue();
        else if (a.startsWith ("-psn_"))
            continue; // macOS launch-services process serial number
        else if (a == "-NSDocumentRevisionsDebugMode")
            ++i;
        else
            c.error = "unknown argument: " + a;
    }

    if (c.error.isEmpty() && c.mode == CommandLine::Mode::render && c.renderOut.isEmpty())
        c.error = "--render needs --out <file.wav>";
    if (c.error.isEmpty() && c.renderBitDepth != 0 && c.renderBitDepth != 16 && c.renderBitDepth != 24 && c.renderBitDepth != 32)
        c.error = "--bit-depth must be 16, 24 or 32";
    return c;
}

} // namespace mad
