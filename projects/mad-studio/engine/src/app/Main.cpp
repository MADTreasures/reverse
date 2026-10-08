// MAD Engine entry point.
//
// Lightweight modes (--version, --self-test) run without the JUCE application; everything that
// needs a message loop (stdio protocol, plugin scans, renders with plugins, device listing)
// runs inside a JUCEApplication so plugin editors and AudioUnits work.

#include "app/CommandLine.h"
#include "app/Controller.h"
#include "core/Json.h"
#include "core/Log.h"
#include "core/Protocol.h"
#include "engine/Renderer.h"
#include "plugins/PluginHost.h"
#include "plugins/PluginScan.h"
#include "tests/SelfTest.h"

#include <juce_gui_basics/juce_gui_basics.h>

#include <cstdio>
#include <thread>

namespace mad
{
namespace
{
CommandLine gArgs;

void printVersion()
{
    json::Writer w;
    w.beginObject()
        .field ("name", "mad-engine")
        .field ("version", MAD_ENGINE_VERSION)
        .field ("protocol", 1)
        .field ("juce", MAD_JUCE_VERSION_STRING)
        .endObject();
    protocol::writeLine (w.str());
}

void listDevices()
{
    juce::AudioDeviceManager manager;
    json::Writer w;
    w.beginObject().key ("types").beginArray();
    for (auto* type : manager.getAvailableDeviceTypes())
    {
        type->scanForDevices();
        w.beginObject().field ("name", type->getTypeName());
        w.key ("outputs").beginArray();
        for (const auto& n : type->getDeviceNames (false))
            w.value (n);
        w.endArray().key ("inputs").beginArray();
        for (const auto& n : type->getDeviceNames (true))
            w.value (n);
        w.endArray();
        const auto outputs = type->getDeviceNames (false);
        const auto inputs = type->getDeviceNames (true);
        const int defOut = type->getDefaultDeviceIndex (false);
        const int defIn = type->getDefaultDeviceIndex (true);
        w.field ("defaultOutput", juce::isPositiveAndBelow (defOut, outputs.size()) ? outputs[defOut] : juce::String());
        w.field ("defaultInput", juce::isPositiveAndBelow (defIn, inputs.size()) ? inputs[defIn] : juce::String());
        w.endObject();
    }
    w.beginObject().field ("name", "Null");
    w.key ("outputs").beginArray().value ("Null Output").endArray();
    w.key ("inputs").beginArray().value ("Null Input").endArray();
    w.field ("defaultOutput", "Null Output").field ("defaultInput", "Null Input").endObject();
    w.endArray().endObject();
    protocol::writeLine (w.str());
}

/** --render <job.json> --out <file.wav>. Runs on a worker thread (plugins are created through
    the message thread). Returns the process exit code. */
int runRenderJob (const CommandLine& args, std::shared_ptr<PluginProvider>& keepProvider)
{
    const juce::File jobFile = juce::File::getCurrentWorkingDirectory().getChildFile (args.renderJob);
    juce::String error;
    const auto job = json::parse (jobFile.loadFileAsString(), error);
    if (! job.isObject())
    {
        protocol::sendError ("cannot read render job " + jobFile.getFullPathName() + (error.isNotEmpty() ? ": " + error : juce::String()));
        return 1;
    }

    SampleStore samples;
    ChannelIds ids;
    if (const auto* list = json::get (job, "samples").getArray())
    {
        for (const auto& s : *list)
        {
            const auto file = jobFile.getParentDirectory().getChildFile (json::string (s, "path"));
            const auto result = samples.loadRaw (json::string (s, "id"), file, json::number (s, "sampleRate", 48000.0),
                                                 json::integer (s, "channels", 1), (int64_t) json::number (s, "frames", 0.0));
            if (result.failed())
            {
                protocol::sendError ("sample " + json::string (s, "id") + ": " + result.getErrorMessage());
                return 1;
            }
        }
    }

    RenderRequest r;
    r.project = parseProject (json::get (job, "project"));
    r.timeline = std::make_shared<Timeline> (parseTimeline (json::get (job, "timeline"), ids));
    r.automation = std::make_shared<AutomationData> (parseAutomation (json::get (job, "automation")));
    r.sampleRate = args.renderSampleRate > 0.0 ? args.renderSampleRate : json::number (job, "sampleRate", 48000.0);
    r.bitDepth = args.renderBitDepth > 0 ? args.renderBitDepth : json::integer (job, "bitDepth", 24);
    r.startTick = json::number (job, "startTick", 0.0);
    r.endTick = json::number (job, "endTick", -1.0);
    r.tailSeconds = json::number (job, "tailSeconds", 2.0);
    r.output = juce::File::getCurrentWorkingDirectory().getChildFile (args.renderOut);
    r.blockSize = 512;

    juce::File dataDir = args.dataDir.isNotEmpty() ? juce::File::getCurrentWorkingDirectory().getChildFile (args.dataDir)
                                                    : juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory).getChildFile ("MAD Engine");
    auto provider = std::make_shared<SyncPluginProvider> (dataDir, r.sampleRate, r.blockSize);
    keepProvider = provider;

    // Instantiate the project's plugins up front so failures are reported before rendering.
    for (const auto& ch : r.project.channels)
        if (ch.kind == ChannelKind::plugin)
            provider->slotFor ("ch:" + ch.id, ch.plugin, true);
    for (const auto& t : r.project.mixer)
        for (const auto& fx : t.effects)
            if (fx.type == "plugin")
                provider->slotFor ("fx:" + fx.id, fx.plugin, false);
    for (const auto& e : provider->errors)
        logMessage ("plugin: " + e);

    int lastPercent = -1;
    const auto result = renderOffline (r, samples, ids, provider.get(), [&lastPercent] (double fraction)
    {
        const int percent = (int) std::floor (fraction * 100.0);
        if (percent / 10 != lastPercent / 10)
            logMessage ("render " + juce::String (percent) + "%");
        lastPercent = percent;
    });

    if (! result.ok)
    {
        protocol::sendError ("render failed: " + result.error, "render");
        return 1;
    }

    json::Writer w;
    w.beginObject()
        .field ("type", "render.done")
        .field ("path", r.output.getFullPathName())
        .field ("peak", result.peak)
        .field ("seconds", result.seconds)
        .field ("frames", (int64_t) result.frames)
        .field ("sampleRate", r.sampleRate)
        .field ("renderTime", result.elapsed);
    if (! provider->errors.empty())
    {
        w.key ("warnings").beginArray();
        for (const auto& e : provider->errors)
            w.value (e);
        w.endArray();
    }
    w.endObject();
    protocol::writeLine (w.str());
    return 0;
}

//==============================================================================
class EngineApplication final : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override { return "MAD Engine"; }
    const juce::String getApplicationVersion() override { return MAD_ENGINE_VERSION; }
    bool moreThanOneInstanceAllowed() override { return true; }
    void anotherInstanceStarted (const juce::String&) override {}
    void systemRequestedQuit() override { quit(); }

    void initialise (const juce::String&) override
    {
        switch (gArgs.mode)
        {
            case CommandLine::Mode::stdio:
                // The engine is a windowless agent app: without this macOS puts it into App Nap and
                // throttles its message-thread timers (status and meter messages, plugin loading).
                keepAwake = std::make_unique<juce::ScopedLowPowerModeDisabler>();
                controller = std::make_unique<Controller> (gArgs);
                controller->onQuit = [] { juce::MessageManager::callAsync ([] { quit(); }); };
                controller->start();
                break;

            case CommandLine::Mode::scanPlugin:
                scanJob = std::make_unique<PluginScanJob> (gArgs.scanFormat, gArgs.scanTarget, [this] (int code)
                {
                    setApplicationReturnValue (code);
                    quit();
                });
                scanJob->start();
                break;

            case CommandLine::Mode::render:
                keepAwake = std::make_unique<juce::ScopedLowPowerModeDisabler>();
                worker = std::thread ([this]
                {
                    const int code = runRenderJob (gArgs, renderProvider);
                    juce::MessageManager::callAsync ([this, code]
                    {
                        setApplicationReturnValue (code);
                        quit();
                    });
                });
                break;

            case CommandLine::Mode::listDevices:
                listDevices();
                juce::MessageManager::callAsync ([] { quit(); });
                break;

            case CommandLine::Mode::version:
            case CommandLine::Mode::selfTest:
            case CommandLine::Mode::help:
                juce::MessageManager::callAsync ([] { quit(); });
                break;
        }
    }

    void shutdown() override
    {
        controller.reset();
        scanJob.reset();
        if (worker.joinable())
            worker.join();
        renderProvider.reset();
        keepAwake.reset();
    }

private:
    std::unique_ptr<juce::ScopedLowPowerModeDisabler> keepAwake;
    std::unique_ptr<Controller> controller;
    std::unique_ptr<PluginScanJob> scanJob;
    std::thread worker;
    std::shared_ptr<PluginProvider> renderProvider;
};

juce::JUCEApplicationBase* createApplication() { return new EngineApplication(); }
} // namespace
} // namespace mad

int main (int argc, char* argv[])
{
    using mad::CommandLine;
    mad::gArgs = mad::parseCommandLine (argc, argv);

    if (mad::gArgs.mode == CommandLine::Mode::help)
    {
        std::fputs (mad::usageText(), stdout);
        return 0;
    }
    if (mad::gArgs.error.isNotEmpty())
    {
        std::fprintf (stderr, "mad-engine: %s\n\n%s", mad::gArgs.error.toRawUTF8(), mad::usageText());
        return 2;
    }
    if (mad::gArgs.mode == CommandLine::Mode::selfTest)
    {
        const juce::ScopedJuceInitialiser_GUI init;
        return mad::runSelfTests() ? 0 : 1;
    }

    // Protocol output only on the real stdout; everything else (plugins, JUCE) goes to stderr.
    mad::protocol::initialiseOutput();

    if (mad::gArgs.mode == CommandLine::Mode::version)
    {
        mad::printVersion();
        return 0;
    }

    juce::JUCEApplicationBase::createInstance = &mad::createApplication;
    return juce::JUCEApplicationBase::main (argc, (const char**) argv);
}
