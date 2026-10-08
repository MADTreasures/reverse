#pragma once

#include "app/CommandLine.h"
#include "core/Cadence.h"
#include "core/Protocol.h"
#include "engine/AudioEngine.h"
#include "engine/GraphBuilder.h"
#include "engine/Recorder.h"
#include "engine/Renderer.h"
#include "engine/Samples.h"
#include "io/DeviceManager.h"
#include "plugins/PluginHost.h"

#include <juce_events/juce_events.h>

#include <deque>
#include <functional>
#include <memory>
#include <mutex>

namespace mad
{

/** The --stdio mode: owns the live engine, device, plugins and recorder, and executes the
    protocol commands on the message thread. */
class Controller : private juce::AsyncUpdater
{
public:
    explicit Controller (const CommandLine& args);
    ~Controller() override;

    /** Opens the audio device, sends `ready` and starts reading stdin. */
    void start();

    /** Called when stdin is closed or `quit` arrives. */
    std::function<void()> onQuit;

private:
    class RenderJob;

    void handleAsyncUpdate() override;
    void tick();
    void dispatch (const protocol::Incoming& in);
    void handle (const juce::String& type, const juce::var& msg, const juce::var& requestId);

    void openDevice (const DeviceController::Request& request);
    void prepareForDevice (double sampleRate, int blockSize);
    void sendReady();
    void sendStatus();
    void sendMeters();
    void handleNotifications();
    void startRender (const juce::var& msg, const juce::var& requestId);
    void beginPendingRender();
    void finishRender();

    CommandLine args;
    juce::File dataDir;

    AudioEngine engine { false };
    SampleStore samples;
    ChannelIds ids;
    std::unique_ptr<PluginHost> plugins;
    std::unique_ptr<GraphBuilder> builder;
    DeviceController device { engine };
    Recorder recorder;
    std::shared_ptr<RecordSession> session;

    std::mutex queueMutex;
    std::deque<protocol::Incoming> queue;

    DeviceController::Request deviceRequest;
    double readySampleRate = 0.0;
    int timerTicks = 0;
    bool metersWereSilent = false;
    bool quitting = false;

    std::unique_ptr<RenderJob> render;

    // Status and meter updates, 30 per second.
    Cadence cadence { [this] { tick(); } };
};

} // namespace mad
