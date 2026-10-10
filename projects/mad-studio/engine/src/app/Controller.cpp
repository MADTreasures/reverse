#include "app/Controller.h"

#include "core/Json.h"
#include "core/Log.h"
#include "plugins/PluginScan.h"

#include <cmath>

namespace mad
{
namespace
{
constexpr int protocolVersion = 1;

/** Adds "requestId" to a reply object that was serialised without it. */
std::string withRequestId (std::string json, const juce::var& requestId)
{
    if (requestId.isVoid() || requestId.isUndefined() || json.size() < 2 || json.back() != '}')
        return json;
    json::Writer w;
    w.var (requestId);
    json.pop_back();
    json += ",\"requestId\":" + w.str() + "}";
    return json;
}

void sendReply (std::string json, const juce::var& requestId) { protocol::writeLine (withRequestId (std::move (json), requestId)); }

juce::StringArray stringArray (const juce::var& v)
{
    juce::StringArray out;
    if (const auto* arr = v.getArray())
        for (const auto& s : *arr)
            if (s.isString())
                out.add (s.toString());
    return out;
}

/** `plugins.scan` paths: an array (all formats) or an object keyed by format, like `plugins.paths`. */
PluginHost::ScanPaths scanPaths (const juce::var& v)
{
    PluginHost::ScanPaths out;
    if (v.isArray())
        out[juce::String()] = stringArray (v);
    else if (const auto* obj = v.getDynamicObject())
        for (const auto& prop : obj->getProperties())
            out[prop.name.toString()] = stringArray (prop.value);
    return out;
}
} // namespace

//==============================================================================
class Controller::RenderJob final : public juce::Thread, public PluginProvider
{
public:
    RenderJob (Controller& c, RenderRequest r, juce::var id)
        : juce::Thread ("mad-render"), owner (c), request (std::move (r)), requestId (std::move (id))
    {
        waitingSince = juce::Time::getMillisecondCounterHiRes();
    }

    ~RenderJob() override
    {
        cancel.store (true);
        stopThread (30000);
        // Normally finishRender() hands the plugins back; this covers shutdown mid-render.
        for (auto& [key, slot] : borrowed)
            slot->unlockExclusive();
    }

    std::shared_ptr<PluginSlot> slotFor (const juce::String& key, const PluginRef&, bool) override
    {
        const auto it = borrowed.find (key);
        return it != borrowed.end() ? it->second : nullptr;
    }

    void run() override
    {
        const auto id = requestId;
        result = renderOffline (request, owner.samples, owner.ids, this, [id] (double fraction)
        {
            json::Writer w;
            w.beginObject().field ("type", "render.progress");
            w.key ("requestId");
            w.var (id);
            w.field ("fraction", fraction).endObject();
            protocol::writeLine (w.str());
        }, &cancel);
        finished.store (true);
    }

    Controller& owner;
    RenderRequest request;
    juce::var requestId;
    std::map<juce::String, std::shared_ptr<PluginSlot>> borrowed;
    std::atomic<bool> finished { false }, cancel { false };
    bool running = false;
    double waitingSince = 0.0;
    RenderResult result;
};

//==============================================================================
Controller::Controller (const CommandLine& a) : args (a)
{
    dataDir = args.dataDir.isNotEmpty()
                  ? juce::File::getCurrentWorkingDirectory().getChildFile (args.dataDir)
                  : juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory).getChildFile ("MAD Engine");
    dataDir.createDirectory();

    plugins = std::make_unique<PluginHost> (dataDir);
    builder = std::make_unique<GraphBuilder> (engine, samples, ids, plugins.get(), false);

    device.onDeviceChanged = [this]
    {
        juce::MessageManager::callAsync ([this]
        {
            if (! quitting)
                openDevice (deviceRequest);
        });
    };
}

Controller::~Controller()
{
    quitting = true;
    cadence.stop();
    cancelPendingUpdate();
    render.reset();
    device.close();
    recorder.finishAllNow();
    engine.snapshots.publish (nullptr);
    engine.snapshots.collectAllWhileConsumerStopped();
    builder.reset();
    plugins.reset();
    collectSampleGarbage();
}

void Controller::start()
{
    deviceRequest.forceNull = args.nullAudio;
    deviceRequest.sampleRate = args.sampleRate;
    deviceRequest.bufferSize = args.bufferSize;
    device.setNullInputTone (args.nullInputTone);
    openDevice (deviceRequest);

    protocol::startStdinReader ([this] (protocol::Incoming&& in)
    {
        {
            const std::lock_guard<std::mutex> lock (queueMutex);
            queue.push_back (std::move (in));
        }
        triggerAsyncUpdate();
    });

    cadence.start (30);
}

void Controller::prepareForDevice (double sampleRate, int blockSize)
{
    // Runs while no audio callback is active.
    engine.prepare (sampleRate, blockSize);
    plugins->setProcessingSetup (sampleRate, blockSize);
    builder->rebuildAll();
    engine.snapshots.collectAllWhileConsumerStopped();
}

void Controller::openDevice (const DeviceController::Request& request)
{
    if (session != nullptr)
    {
        EngineCommand stop;
        stop.type = EngineCommand::Type::stop;
        engine.post (stop);
    }
    const auto warning = device.open (request, [this] (double sr, int block) { prepareForDevice (sr, block); });
    if (warning.isNotEmpty() && ! device.info().isNull)
        protocol::sendLog ("audio device: " + warning);

    const auto info = device.info();
    if (! juce::approximatelyEqual (info.sampleRate, readySampleRate))
        sendReady();
}

void Controller::sendReady()
{
    const auto info = device.info();
    readySampleRate = info.sampleRate;
    json::Writer w;
    w.beginObject()
        .field ("type", "ready")
        .field ("protocol", protocolVersion)
        .field ("version", MAD_ENGINE_VERSION)
        .field ("sampleRate", info.sampleRate)
        .field ("bufferSize", info.bufferSize);
    w.key ("device").beginObject()
        .field ("type", info.type)
        .field ("output", info.output)
        .field ("input", info.input)
        .field ("null", info.isNull)
        .endObject();
    w.key ("formats").beginArray();
    for (const auto& f : plugins->formatNames())
        w.value (f);
    w.endArray().endObject();
    protocol::writeLine (w.str());
}

//==============================================================================
void Controller::handleAsyncUpdate()
{
    std::deque<protocol::Incoming> items;
    {
        const std::lock_guard<std::mutex> lock (queueMutex);
        items.swap (queue);
    }

    for (size_t i = 0; i < items.size(); ++i)
    {
        const auto& in = items[i];
        // Coalesce runs of whole-state messages: only the newest one matters.
        if (i + 1 < items.size() && in.parseError.isEmpty() && in.type == items[i + 1].type
            && (in.type == "project.sync" || in.type == "timeline.set" || in.type == "automation.set"))
            continue;
        dispatch (in);
        if (quitting)
            return;
    }
}

void Controller::dispatch (const protocol::Incoming& in)
{
    if (in.endOfInput)
    {
        quitting = true;
        if (onQuit)
            onQuit();
        return;
    }
    if (in.parseError.isNotEmpty())
    {
        protocol::sendError ("invalid JSON: " + in.parseError);
        return;
    }
    const auto requestId = json::get (in.message, "requestId");
    if (in.type.isEmpty())
    {
        protocol::sendError ("message without a \"type\"", {}, requestId);
        return;
    }
    try
    {
        handle (in.type, in.message, requestId);
    }
    catch (const std::exception& e)
    {
        protocol::sendError (juce::String ("internal error: ") + e.what(), in.type, requestId);
    }
}

void Controller::handle (const juce::String& type, const juce::var& msg, const juce::var& requestId)
{
    const auto post = [this] (const EngineCommand& c)
    {
        if (! engine.post (c))
            logMessage ("engine command queue full");
    };
    const auto fail = [&] (const juce::String& message) { protocol::sendError (message, type, requestId); };
    // Transport commands may carry the client's sequence number; status messages echo the last one
    // the audio thread applied, so the client can tell which state a status describes.
    const auto transportSeq = [&msg] { return (uint32_t) std::max (0, json::integer (msg, "seq", 0)); };

    // ---- project state ------------------------------------------------------------------
    if (type == "project.sync")
    {
        const auto project = json::get (msg, "project");
        if (! project.isObject())
            return fail ("project.sync needs a \"project\" object");
        builder->setProject (parseProject (project));
        return;
    }
    if (type == "timeline.set")
    {
        builder->setTimeline (std::make_shared<Timeline> (parseTimeline (msg, ids)));
        return;
    }
    if (type == "automation.set")
    {
        builder->setAutomation (std::make_shared<AutomationData> (parseAutomation (msg)));
        return;
    }
    if (type == "samples.loadRaw")
    {
        const auto id = json::string (msg, "id");
        const auto path = json::string (msg, "path");
        if (id.isEmpty() || path.isEmpty())
            return fail ("samples.loadRaw needs id and path");
        const auto result = samples.loadRaw (id, juce::File (path), json::number (msg, "sampleRate", 48000.0),
                                             json::integer (msg, "channels", 1),
                                             (int64_t) json::number (msg, "frames", 0.0));
        if (result.failed())
            return fail (result.getErrorMessage());
        builder->refresh();
        json::Writer w;
        w.beginObject().field ("type", "samples.loaded").field ("id", id).endObject();
        sendReply (w.take(), requestId);
        return;
    }
    if (type == "samples.unload")
    {
        samples.unload (json::string (msg, "id"));
        builder->refresh();
        return;
    }

    // ---- transport --------------------------------------------------------------------------
    if (type == "transport.play")
    {
        if (render != nullptr)
        {
            // Refused: the transport stays stopped, under this command's sequence number.
            EngineCommand c;
            c.type = EngineCommand::Type::stop;
            c.seq = transportSeq();
            post (c);
            return fail ("an offline render is running");
        }
        EngineCommand c;
        c.type = EngineCommand::Type::play;
        c.seq = transportSeq();
        c.tick = std::max (0.0, json::number (msg, "fromTick", 0.0));
        c.countIn = std::max (0.0, json::number (msg, "countInTicks", 0.0));
        if (json::boolean (msg, "record", false))
        {
            const auto info = device.info();
            juce::String error;
            // The player hears the music `totalLatency` late (plugin delay compensation) and plays
            // along to that, so takes move back by it too, like the device latencies.
            auto next = recorder.createSession (builder->project(), info.sampleRate,
                                                info.inputLatency + info.outputLatency + builder->totalLatency(), error);
            if (next == nullptr)
                protocol::sendError (error.isNotEmpty() ? error : juce::String ("no armed mixer track has an input"), type, requestId);
            else
            {
                if (session != nullptr && session != next)
                    recorder.finish (session, [] (std::string line) { protocol::writeLine (line); });
                session = next;
            }
            c.session = session.get();
        }
        post (c);
        return;
    }
    if (type == "transport.stop")
    {
        EngineCommand c;
        c.type = EngineCommand::Type::stop;
        c.seq = transportSeq();
        post (c);
        return;
    }
    if (type == "transport.seek")
    {
        EngineCommand c;
        c.type = EngineCommand::Type::seek;
        c.seq = transportSeq();
        c.tick = std::max (0.0, json::number (msg, "tick", 0.0));
        post (c);
        return;
    }
    if (type == "transport.settings")
    {
        if (json::has (msg, "metronome"))
            engine.metronomeEnabled.store (json::boolean (msg, "metronome", false));
        return;
    }

    // ---- live input / previews -----------------------------------------------------------------
    if (type == "live.noteOn")
    {
        EngineCommand c;
        c.type = EngineCommand::Type::noteOn;
        c.handle = json::integer (msg, "handle", 0);
        c.channel = ids.uidFor (json::string (msg, "channelId"));
        c.key = std::clamp (json::integer (msg, "key", 60), 0, 127);
        c.velocity = (float) std::clamp (json::number (msg, "velocity", 0.8), 0.0, 1.0);
        // Portamento of live notes (channel settings: Porta), computed by the renderer.
        c.glideFrom = (float) std::clamp (json::number (msg, "glideFrom", 0.0), -128.0, 128.0);
        c.glideTime = (float) std::clamp (json::number (msg, "glideTime", 0.1), 0.0, 60.0);
        if (c.handle == 0)
            return fail ("live.noteOn needs a non-zero handle");
        post (c);
        return;
    }
    if (type == "live.noteOff")
    {
        EngineCommand c;
        c.type = EngineCommand::Type::noteOff;
        c.handle = json::integer (msg, "handle", 0);
        post (c);
        return;
    }
    if (type == "live.allNotesOff")
    {
        EngineCommand c;
        c.type = EngineCommand::Type::allNotesOff;
        post (c);
        return;
    }
    if (type == "preview.sample")
    {
        auto sample = samples.get (json::string (msg, "id"));
        if (sample == nullptr)
            return fail ("unknown sample " + json::string (msg, "id"));
        sample->pins.fetch_add (1);
        EngineCommand c;
        c.type = EngineCommand::Type::previewSample;
        c.sample = sample.get();
        if (! engine.post (c))
            sample->pins.fetch_sub (1);
        return;
    }
    if (type == "preview.synth")
    {
        const auto params = parseSynthParams (json::get (msg, "synth"));
        auto& synth = engine.previewSynthInstrument();
        for (size_t i = 0; i < params.size(); ++i)
            synth.params[i].setBase (params[i]);
        EngineCommand c;
        c.type = EngineCommand::Type::previewSynth;
        if (const auto* keys = json::get (msg, "keys").getArray())
            for (const auto& k : *keys)
                if (c.numKeys < (int) c.keys.size())
                    c.keys[(size_t) c.numKeys++] = (uint8_t) std::clamp ((int) json::number (k, 60.0), 0, 127);
        if (c.numKeys == 0)
            c.keys[(size_t) c.numKeys++] = 60;
        c.duration = std::clamp (json::number (msg, "duration", 0.6), 0.01, 30.0);
        post (c);
        return;
    }
    if (type == "preview.stop")
    {
        EngineCommand c;
        c.type = EngineCommand::Type::previewStop;
        post (c);
        return;
    }

    // ---- audio device ------------------------------------------------------------------------
    if (type == "audio.getDevices")
    {
        sendReply (device.devicesJson(), requestId);
        return;
    }
    if (type == "audio.setDevice")
    {
        if (render != nullptr)
            return fail ("an offline render is running");
        DeviceController::Request r = deviceRequest;
        if (json::has (msg, "type"))
            r.type = json::string (msg, "type");
        if (json::has (msg, "output"))
            r.output = json::string (msg, "output");
        if (json::has (msg, "input"))
            r.input = json::get (msg, "input").isString() ? json::string (msg, "input") : juce::String ("none");
        if (json::has (msg, "sampleRate"))
            r.sampleRate = json::number (msg, "sampleRate", 0.0);
        if (json::has (msg, "bufferSize"))
            r.bufferSize = json::integer (msg, "bufferSize", 0);
        r.forceNull = args.nullAudio || r.type == "Null"; // --null-audio never opens real hardware
        deviceRequest = r;
        openDevice (r);
        sendReply (device.devicesJson(), requestId);
        return;
    }

    if (type == "audio.showControlPanel")
    {
        if (render != nullptr)
            return fail ("an offline render is running");
        if (session != nullptr)
        {
            EngineCommand stop;
            stop.type = EngineCommand::Type::stop;
            engine.post (stop);
        }
        if (! device.showControlPanel ([this] (double sr, int block) { prepareForDevice (sr, block); }))
            return fail ("the audio device has no control panel");
        if (! juce::approximatelyEqual (device.info().sampleRate, readySampleRate))
            sendReady();
        sendReply (device.devicesJson(), requestId);
        return;
    }

    // ---- recording ---------------------------------------------------------------------------
    if (type == "record.config")
    {
        Recorder::Config c = recorder.getConfig();
        if (json::has (msg, "folder"))
            c.folder = juce::File::getCurrentWorkingDirectory().getChildFile (json::string (msg, "folder"));
        if (json::has (msg, "monitoring"))
        {
            const auto m = json::string (msg, "monitoring", "armed");
            c.monitoring = (m == "off" || m == "on") ? m : juce::String ("armed");
        }
        c.latencyCompensation = json::boolean (msg, "latencyCompensation", c.latencyCompensation);
        const int bits = json::integer (msg, "bitDepth", c.bitDepth);
        c.bitDepth = (bits == 16 || bits == 24 || bits == 32) ? bits : 24;
        c.configured = true;
        recorder.configure (c);
        builder->setMonitoring (c.monitoring);
        return;
    }

    // ---- offline render ----------------------------------------------------------------------
    if (type == "render.start")
    {
        startRender (msg, requestId);
        return;
    }

    // ---- plugins -----------------------------------------------------------------------------
    if (type == "plugins.getPaths")
    {
        sendReply (plugins->pathsJson(), requestId);
        return;
    }
    if (type == "plugins.scan")
    {
        if (plugins->isScanning())
            return fail ("a plugin scan is already running");
        plugins->scan (stringArray (json::get (msg, "formats")), scanPaths (json::get (msg, "paths")),
                       json::boolean (msg, "rescanAll", false));
        return;
    }
    if (type == "plugins.getList")
    {
        sendReply (plugins->listJson(), requestId);
        return;
    }
    if (type == "plugin.getParams")
    {
        juce::String error;
        auto reply = plugins->paramsJson (json::string (msg, "key"), error);
        if (reply.empty())
            return fail (error);
        sendReply (std::move (reply), requestId);
        return;
    }
    if (type == "plugin.setParam")
    {
        juce::String error;
        if (! plugins->setParam (json::string (msg, "key"), json::integer (msg, "index", -1),
                                 (float) json::number (msg, "value", 0.0), error))
            fail (error);
        return;
    }
    if (type == "plugin.openEditor")
    {
        juce::String error;
        if (! plugins->openEditor (json::string (msg, "key"), json::string (msg, "title"), error))
            fail (error);
        return;
    }
    if (type == "plugin.closeEditor")
    {
        plugins->closeEditor (json::string (msg, "key"), true);
        return;
    }
    if (type == "plugins.getStates")
    {
        protocol::writeLine (plugins->statesJson (requestId));
        return;
    }

    // ---- misc --------------------------------------------------------------------------------
    if (type == "ping")
    {
        json::Writer w;
        w.beginObject().field ("type", "pong").endObject();
        sendReply (w.take(), requestId);
        return;
    }
    if (type == "quit")
    {
        quitting = true;
        if (onQuit)
            onQuit();
        return;
    }

    protocol::sendError ("unknown command " + type, type, requestId);
}

//==============================================================================
void Controller::startRender (const juce::var& msg, const juce::var& requestId)
{
    const auto fail = [&] (const juce::String& message) { protocol::sendError (message, "render.start", requestId); };
    if (render != nullptr)
        return fail ("a render is already running");
    const auto path = json::string (msg, "path");
    if (path.isEmpty())
        return fail ("render.start needs a path");

    RenderRequest r;
    const auto info = device.info();
    r.sampleRate = json::number (msg, "sampleRate", info.sampleRate);
    if (! (r.sampleRate >= 8000.0 && r.sampleRate <= 384000.0))
        return fail ("invalid sampleRate");
    const int bits = json::integer (msg, "bitDepth", 24);
    r.bitDepth = (bits == 16 || bits == 24 || bits == 32) ? bits : 24;
    r.format = json::string (msg, "format", "wav").toLowerCase();
    if (r.format != "wav" && r.format != "flac" && r.format != "ogg")
        return fail ("unknown format " + r.format + " (wav, flac or ogg)");
    r.oggKbps = std::clamp (json::integer (msg, "kbps", 192), 32, 500);
    r.startTick = std::max (0.0, json::number (msg, "startTick", 0.0));
    r.endTick = json::number (msg, "endTick", -1.0);
    r.tailSeconds = std::clamp (json::number (msg, "tailSeconds", 2.0), 0.0, 60.0);
    r.output = juce::File::getCurrentWorkingDirectory().getChildFile (path);
    // Optional overrides; otherwise the current live state.
    r.project = json::get (msg, "project").isObject() ? parseProject (json::get (msg, "project")) : builder->project();
    r.timeline = json::get (msg, "timeline").isObject() ? std::make_shared<Timeline> (parseTimeline (json::get (msg, "timeline"), ids))
                                                        : builder->timeline();
    r.automation = json::get (msg, "automation").isObject()
                       ? std::make_shared<AutomationData> (parseAutomation (json::get (msg, "automation")))
                       : builder->automation();

    // Live playback stops while rendering.
    EngineCommand stop;
    stop.type = EngineCommand::Type::stop;
    engine.post (stop);

    render = std::make_unique<RenderJob> (*this, std::move (r), requestId);
    beginPendingRender();
}

void Controller::beginPendingRender()
{
    if (render == nullptr || render->running)
        return;
    // Plugins that are still loading would render silent: wait for them (at most 30 s).
    if (plugins->anyLoading() && juce::Time::getMillisecondCounterHiRes() - render->waitingSince < 30000.0)
        return;

    const auto& project = render->request.project;
    std::vector<std::pair<juce::String, PluginRef>> keys;
    for (const auto& ch : project.channels)
        if (ch.kind == ChannelKind::plugin)
            keys.emplace_back ("ch:" + ch.id, ch.plugin);
    for (const auto& t : project.mixer)
        for (const auto& fx : t.effects)
            if (fx.type == "plugin")
                keys.emplace_back ("fx:" + fx.id, fx.plugin);

    const int block = 512;
    for (const auto& [key, ref] : keys)
    {
        auto slot = plugins->find (key);
        if (slot == nullptr || slot->get() == nullptr || ! slot->ref.sameDescription (ref))
            continue;
        slot->lockExclusive();
        slot->prepareExclusive (render->request.sampleRate, block, true);
        render->borrowed[key] = slot;
    }
    render->request.blockSize = block;
    render->running = true;
    render->startThread();
}

void Controller::finishRender()
{
    if (render == nullptr || ! render->finished.load())
        return;
    render->stopThread (1000);

    for (auto& [key, slot] : render->borrowed)
    {
        slot->prepareExclusive (engine.getSampleRate(), engine.getMaxBlockSize(), false);
        slot->unlockExclusive();
    }
    render->borrowed.clear();

    const auto& r = render->result;
    if (r.ok)
    {
        json::Writer w;
        w.beginObject().field ("type", "render.done");
        w.key ("requestId");
        w.var (render->requestId);
        w.field ("path", render->request.output.getFullPathName())
            .field ("peak", r.peak)
            .field ("seconds", r.seconds)
            .field ("frames", (int64_t) r.frames)
            .field ("sampleRate", render->request.sampleRate)
            .field ("renderTime", r.elapsed)
            .endObject();
        protocol::writeLine (w.str());
    }
    else
    {
        protocol::sendError ("render failed: " + r.error, "render.start", render->requestId);
    }
    render.reset();
}

//==============================================================================
void Controller::handleNotifications()
{
    EngineNotification n;
    while (engine.popNotification (n))
    {
        if (n.type == EngineNotification::Type::recordingStopped && n.session != nullptr)
        {
            if (session != nullptr && session.get() == n.session)
            {
                recorder.finish (session, [] (std::string line) { protocol::writeLine (line); });
                session.reset();
            }
        }
    }
}

void Controller::sendStatus()
{
    const auto pos = engine.readPosition();
    const auto info = device.info();
    // What is heard lags the transport by the device and by plugin delay compensation.
    const double latency = (double) info.outputLatency + (info.isNull ? 0.0 : (double) info.bufferSize) + (double) pos.latency;

    double tick = pos.tick;
    if (pos.state != 0)
    {
        tick -= latency * pos.ticksPerSample;
        if (pos.state == 2 && tick < pos.loopStart && pos.loopEnd > pos.loopStart && pos.tick >= pos.loopStart)
            tick += pos.loopEnd - pos.loopStart;
    }

    json::Writer w;
    w.beginObject()
        .field ("type", "status")
        .field ("playing", pos.state != 0)
        .field ("state", pos.state == 2 ? "playing" : (pos.state == 1 ? "countIn" : "stopped"))
        .field ("tick", tick, 9)
        .field ("cpu", engine.cpuLoad(), 3)
        .field ("seq", (int64_t) pos.seq);
    w.key ("activity").beginObject();
    const double sr = engine.getSampleRate();
    const auto now = engine.sampleClock();
    for (const auto& [id, node] : builder->channelNodes())
    {
        const auto last = node->lastTrigger.load (std::memory_order_relaxed);
        if (last == std::numeric_limits<int64_t>::min())
            continue;
        const double age = (double) (now - last) / sr;
        if (age >= 0.0 && age < 0.2)
            w.field (id.toRawUTF8(), age, 3);
    }
    w.endObject().endObject();
    protocol::writeLine (w.str());
}

void Controller::sendMeters()
{
    MeterFrame frame;
    if (! engine.readMeters (frame))
        return;

    bool silent = true;
    for (int t = 0; t < frame.numTracks && silent; ++t)
        silent = frame.peaks[(size_t) t][0] < 1.0e-6f && frame.peaks[(size_t) t][1] < 1.0e-6f;
    const bool playing = engine.readPosition().state != 0;
    // Pause meter traffic while stopped and silent (after one all-zero frame).
    if (silent && metersWereSilent && ! playing)
        return;
    metersWereSilent = silent;

    json::Writer w;
    w.beginObject().field ("type", "meters").key ("peaks").beginArray();
    for (int t = 0; t < frame.numTracks; ++t)
        w.beginArray().value (frame.peaks[(size_t) t][0], 4).value (frame.peaks[(size_t) t][1], 4).endArray();
    w.endArray().key ("waveform").beginArray();
    for (const float v : frame.waveform)
        w.value (std::abs (v) < 1.0e-6f ? 0.0f : v, 4);
    w.endArray().endObject();
    protocol::writeLine (w.str());
}

void Controller::sendLatencyIfChanged()
{
    const auto& plan = builder->latencyPlan();
    json::Writer w;
    w.beginObject()
        .field ("type", "latency")
        .field ("automatic", builder->project().pdc)
        .field ("automations", builder->project().pdc && builder->project().pdcAutomation)
        .field ("total", plan.total)
        .field ("sampleRate", engine.getSampleRate());
    const auto& input = builder->latencyPlanInput();
    w.key ("tracks").beginArray();
    for (size_t i = 0; i < plan.trackLatency.size(); ++i)
    {
        w.beginObject().field ("latency", plan.trackLatency[i]).field ("delay", plan.trackDelay[i]);
        // Every send with its compensation delay, unless the track only feeds the master.
        const auto sends = i > 0 && i < input.tracks.size() ? input.tracks[i].sends ((int) i) : std::vector<LatencyInput::Route> {};
        const bool masterOnly = sends.size() == 1 && sends[0].to == 0 && ! sends[0].sidechain;
        if (i > 0 && i < plan.routeDelay.size() && ! masterOnly)
        {
            w.key ("sends").beginArray();
            for (size_t r = 0; r < sends.size() && r < plan.routeDelay[i].size(); ++r)
                w.beginObject().field ("to", sends[r].to).field ("delay", plan.routeDelay[i][r]).endObject();
            w.endArray();
        }
        w.endObject();
    }
    w.endArray();
    w.key ("plugins").beginObject();
    for (const auto& p : builder->pluginLatencies())
    {
        w.key (p.key.toStdString()).beginObject().field ("reported", p.reported).field ("offset", p.offset).endObject();
    }
    w.endObject().endObject();
    auto report = w.take();
    if (report == lastLatencyReport)
        return;
    lastLatencyReport = report;
    protocol::writeLine (report);
}

void Controller::tick()
{
    if (quitting)
        return;
    ++timerTicks;
    handleNotifications();

    const bool playing = engine.readPosition().state != 0;
    if (playing || timerTicks % 8 == 0)
        sendStatus();
    sendMeters();

    plugins->pollParameterChanges();
    builder->serviceEffects();
    // A render prepares the plugins it borrows for its own sample rate; their latency there
    // is not the live one.
    if (render == nullptr || ! render->running)
    {
        builder->checkLatency();
        sendLatencyIfChanged();
    }
    engine.snapshots.collectGarbage();
    collectSampleGarbage();

    if (render != nullptr)
    {
        if (! render->running)
            beginPendingRender();
        else
            finishRender();
    }
}

} // namespace mad
