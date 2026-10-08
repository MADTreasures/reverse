#include "plugins/PluginHost.h"

#include "core/Json.h"
#include "core/Log.h"
#include "core/Protocol.h"
#include "plugins/PluginScan.h"

#include <thread>

namespace mad
{
namespace
{
void sendPluginError (const juce::String& key, const juce::String& message)
{
    json::Writer w;
    w.beginObject().field ("type", "plugin.error").field ("key", key).field ("message", message).endObject();
    protocol::writeLine (w.str());
}

bool hasDisplay()
{
   #if JUCE_LINUX || JUCE_BSD
    const char* display = std::getenv ("DISPLAY");
    const char* wayland = std::getenv ("WAYLAND_DISPLAY");
    if ((display == nullptr || *display == 0) && (wayland == nullptr || *wayland == 0))
        return false;
   #endif
    return juce::Desktop::getInstance().getDisplays().getPrimaryDisplay() != nullptr;
}
} // namespace

//==============================================================================
bool scanOutOfProcess (const juce::String& format, const juce::String& fileOrIdentifier, int timeoutMs,
                       juce::OwnedArray<juce::PluginDescription>& results, juce::String& reason)
{
    const auto exe = juce::File::getSpecialLocation (juce::File::currentExecutableFile);
    juce::ChildProcess child;
    if (! child.start (juce::StringArray { exe.getFullPathName(), "--scan-plugin", format, fileOrIdentifier },
                       juce::ChildProcess::wantStdOut))
    {
        reason = "could not start the scanner process";
        return false;
    }

    std::string output;
    std::atomic<bool> finished { false };
    std::thread reader ([&]
    {
        output = child.readAllProcessOutput().toStdString();
        finished.store (true);
    });

    const auto deadline = juce::Time::getMillisecondCounter() + (juce::uint32) timeoutMs;
    while (! finished.load() && juce::Time::getMillisecondCounter() < deadline)
        juce::Thread::sleep (10);

    bool timedOut = false;
    if (! finished.load())
    {
        timedOut = true;
        child.kill();
    }
    reader.join();
    child.waitForProcessToFinish (2000);

    if (timedOut)
    {
        reason = "timeout";
        return false;
    }

    // The reply is the last JSON line on stdout.
    juce::var reply;
    juce::StringArray lines;
    lines.addLines (juce::String::fromUTF8 (output.data(), (int) output.size()));
    for (int i = lines.size(); --i >= 0;)
    {
        juce::String error;
        reply = json::parse (lines[i].trim(), error);
        if (reply.isObject())
            break;
    }
    if (! reply.isObject() || ! json::get (reply, "plugins").isArray())
    {
        reason = "crashed";
        return false;
    }
    if (json::has (reply, "error"))
    {
        reason = json::string (reply, "error");
        return false;
    }
    for (const auto& d : *json::get (reply, "plugins").getArray())
    {
        auto desc = std::make_unique<juce::PluginDescription>();
        if (readDescription (d, *desc))
            results.add (desc.release());
    }
    if (results.isEmpty())
    {
        reason = "no plugins found";
        return false;
    }
    return true;
}

void configureInstance (juce::AudioPluginInstance& instance, bool isInstrument, const PluginRef& ref, double sampleRate,
                        int blockSize)
{
    auto layout = instance.getBusesLayout();
    if (! layout.outputBuses.isEmpty())
        layout.outputBuses.getReference (0) = juce::AudioChannelSet::stereo();
    if (! layout.inputBuses.isEmpty() && ! isInstrument)
        layout.inputBuses.getReference (0) = juce::AudioChannelSet::stereo();
    if (instance.checkBusesLayoutSupported (layout))
        instance.setBusesLayout (layout);

    if (ref.hasState)
    {
        juce::MemoryBlock state;
        if (state.fromBase64Encoding (ref.state) && state.getSize() > 0)
            instance.setStateInformation (state.getData(), (int) state.getSize());
    }

    instance.setRateAndBufferSizeDetails (sampleRate, blockSize);
    instance.prepareToPlay (sampleRate, blockSize);
}

//==============================================================================
class PluginHost::Window final : public juce::DocumentWindow
{
public:
    Window (const juce::String& title, juce::AudioProcessorEditor* editor, std::function<void()> onClose)
        : juce::DocumentWindow (title, juce::Colours::darkgrey, juce::DocumentWindow::closeButton | juce::DocumentWindow::minimiseButton),
          closed (std::move (onClose))
    {
        setUsingNativeTitleBar (true);
        setContentOwned (editor, true);
        setResizable (editor->isResizable(), false);
        centreWithSize (std::max (120, getWidth()), std::max (60, getHeight()));
        // The engine is a background process: keep plugin windows above the app window.
        setAlwaysOnTop (true);
        setVisible (true);
        toFront (true);
       #if JUCE_MAC
        juce::Process::makeForegroundProcess();
       #endif
    }

    void closeButtonPressed() override
    {
        if (closed)
            closed();
    }

private:
    std::function<void()> closed;
};

//==============================================================================
class PluginHost::ScanThread final : public juce::Thread
{
public:
    struct Job
    {
        juce::String format;
        std::vector<juce::String> files;
    };

    ScanThread (std::vector<Job> j, std::weak_ptr<bool> token, PluginHost& h)
        : juce::Thread ("mad-plugin-scanner"), jobs (std::move (j)), alive (std::move (token)), host (h)
    {
    }

    ~ScanThread() override { stopThread (35000); }

    void run() override
    {
        int total = 0;
        for (const auto& job : jobs)
            total += (int) job.files.size();

        int index = 0;
        for (const auto& job : jobs)
        {
            auto found = std::make_shared<juce::OwnedArray<juce::PluginDescription>>();
            auto failures = std::make_shared<std::vector<FailedPlugin>>();
            for (const auto& file : job.files)
            {
                if (threadShouldExit())
                    return;
                json::Writer w;
                w.beginObject()
                    .field ("type", "plugins.scanProgress")
                    .field ("format", job.format)
                    .field ("name", juce::File::isAbsolutePath (file) ? juce::File (file).getFileName() : file)
                    .field ("index", index++)
                    .field ("total", total)
                    .endObject();
                protocol::writeLine (w.str());

                juce::OwnedArray<juce::PluginDescription> results;
                juce::String reason;
                if (scanOutOfProcess (job.format, file, 30000, results, reason))
                {
                    for (auto* d : results)
                        found->add (new juce::PluginDescription (*d));
                }
                else
                {
                    failures->push_back ({ job.format, file, reason });
                }
            }

            auto token = alive;
            auto* h = &host;
            const auto format = job.format;
            const auto files = job.files;
            juce::MessageManager::callAsync ([token, h, format, files, found, failures]
            {
                if (token.lock() != nullptr)
                    h->mergeScanResults (format, files, *found, *failures);
            });
        }

        auto token = alive;
        auto* h = &host;
        juce::MessageManager::callAsync ([token, h]
        {
            if (token.lock() == nullptr)
                return;
            h->scanning.store (false);
            h->saveCache();
            protocol::writeLine (h->listJson());
        });
    }

private:
    std::vector<Job> jobs;
    std::weak_ptr<bool> alive;
    PluginHost& host;
};

//==============================================================================
PluginHost::PluginHost (juce::File directory) : dataDir (std::move (directory))
{
    addHostedFormats (formats);
    loadCache();
}

PluginHost::~PluginHost()
{
    *alive = false;
    alive.reset();
    scanThread.reset();
    windows.clear();
    slots.clear();
}

juce::StringArray PluginHost::formatNames() const
{
    juce::StringArray names;
    for (auto* f : formats.getFormats())
        names.add (f->getName());
    return names;
}

void PluginHost::loadCache()
{
    const auto file = dataDir.getChildFile ("plugins.json");
    if (! file.existsAsFile())
        return;
    juce::String error;
    const auto v = json::parse (file.loadFileAsString(), error);
    if (const auto* list = json::get (v, "plugins").getArray())
    {
        for (const auto& d : *list)
        {
            juce::PluginDescription desc;
            if (readDescription (d, desc))
                known.push_back (desc);
        }
    }
    if (const auto* list = json::get (v, "failed").getArray())
        for (const auto& f : *list)
            failed.push_back ({ json::string (f, "format"), json::string (f, "fileOrIdentifier"), json::string (f, "reason") });
}

void PluginHost::saveCache() const
{
    if (dataDir == juce::File())
        return;
    dataDir.createDirectory();
    json::Writer w;
    w.beginObject().field ("version", 1).key ("plugins").beginArray();
    for (const auto& d : known)
        writeDescription (w, d);
    w.endArray().key ("failed").beginArray();
    for (const auto& f : failed)
        w.beginObject().field ("format", f.format).field ("fileOrIdentifier", f.fileOrIdentifier).field ("reason", f.reason).endObject();
    w.endArray().endObject();
    dataDir.getChildFile ("plugins.json").replaceWithText (juce::String::fromUTF8 (w.str().c_str()));
}

std::string PluginHost::listJson() const
{
    json::Writer w;
    w.beginObject().field ("type", "plugins.list").key ("plugins").beginArray();
    for (const auto& d : known)
        writeDescription (w, d);
    w.endArray().key ("failed").beginArray();
    for (const auto& f : failed)
        w.beginObject().field ("format", f.format).field ("fileOrIdentifier", f.fileOrIdentifier).field ("reason", f.reason).endObject();
    w.endArray().endObject();
    return w.take();
}

std::string PluginHost::pathsJson() const
{
    json::Writer w;
    w.beginObject().field ("type", "plugins.paths").key ("paths").beginObject();
    for (auto* f : formats.getFormats())
    {
        w.key (f->getName().toRawUTF8()).beginArray();
        if (f->canScanForPlugins() && f->getName() != "AudioUnit")
        {
            const auto paths = f->getDefaultLocationsToSearch();
            for (int i = 0; i < paths.getNumPaths(); ++i)
                w.value (paths.getRawString (i));
        }
        w.endArray();
    }
    w.endObject().endObject();
    return w.take();
}

void PluginHost::scan (const juce::StringArray& wanted, const juce::StringArray& paths, bool rescanAll)
{
    if (scanning.load())
        return;

    std::vector<ScanThread::Job> jobs;
    for (auto* f : formats.getFormats())
    {
        if (! wanted.isEmpty() && ! wanted.contains (f->getName()))
            continue;
        if (! f->canScanForPlugins())
            continue;

        juce::FileSearchPath searchPath;
        if (paths.isEmpty())
            searchPath = f->getDefaultLocationsToSearch();
        else
            for (const auto& p : paths)
                searchPath.add (juce::File (p));

        ScanThread::Job job;
        job.format = f->getName();
        for (const auto& file : f->searchPathsForPlugins (searchPath, true, true))
        {
            if (! rescanAll)
            {
                bool skip = false;
                for (const auto& d : known)
                    if (d.pluginFormatName == job.format && d.fileOrIdentifier == file && ! f->pluginNeedsRescanning (d))
                        skip = true;
                for (const auto& fp : failed)
                    if (fp.format == job.format && fp.fileOrIdentifier == file)
                        skip = true;
                if (skip)
                    continue;
            }
            job.files.push_back (file);
        }
        jobs.push_back (std::move (job));
    }

    scanning.store (true);
    scanThread = std::make_unique<ScanThread> (std::move (jobs), alive, *this);
    scanThread->startThread();
}

void PluginHost::mergeScanResults (const juce::String& format, const std::vector<juce::String>& scannedFiles,
                                   juce::OwnedArray<juce::PluginDescription>& found, std::vector<FailedPlugin>& failedNow)
{
    const auto wasScanned = [&] (const juce::String& fmt, const juce::String& file)
    {
        return fmt == format && std::find (scannedFiles.begin(), scannedFiles.end(), file) != scannedFiles.end();
    };
    known.erase (std::remove_if (known.begin(), known.end(),
                                 [&] (const juce::PluginDescription& d) { return wasScanned (d.pluginFormatName, d.fileOrIdentifier); }),
                 known.end());
    failed.erase (std::remove_if (failed.begin(), failed.end(),
                                  [&] (const FailedPlugin& f) { return wasScanned (f.format, f.fileOrIdentifier); }),
                  failed.end());
    for (auto* d : found)
    {
        const auto uid = d->createIdentifierString();
        known.erase (std::remove_if (known.begin(), known.end(),
                                     [&] (const juce::PluginDescription& k) { return k.createIdentifierString() == uid; }),
                     known.end());
        known.push_back (*d);
    }
    for (auto& f : failedNow)
        failed.push_back (f);
}

bool PluginHost::findDescription (const PluginRef& ref, juce::PluginDescription& out) const
{
    if (ref.uid.isNotEmpty())
        for (const auto& d : known)
            if (d.createIdentifierString() == ref.uid)
            {
                out = d;
                return true;
            }
    for (const auto& d : known)
        if (d.pluginFormatName == ref.format && d.fileOrIdentifier == ref.fileOrIdentifier && (ref.name.isEmpty() || d.name == ref.name))
        {
            out = d;
            return true;
        }
    return false;
}

std::shared_ptr<PluginSlot> PluginHost::find (const juce::String& key) const
{
    const auto it = slots.find (key);
    return it != slots.end() ? it->second : nullptr;
}

std::vector<std::shared_ptr<PluginSlot>> PluginHost::allSlots() const
{
    std::vector<std::shared_ptr<PluginSlot>> out;
    for (const auto& [k, s] : slots)
        out.push_back (s);
    return out;
}

bool PluginHost::anyLoading() const { return ! loading.empty(); }

std::shared_ptr<PluginSlot> PluginHost::slotFor (const juce::String& key, const PluginRef& ref, bool isInstrument)
{
    if (auto it = slots.find (key); it != slots.end())
    {
        if (it->second->ref.sameDescription (ref) && it->second->isInstrument == isInstrument)
            return it->second;
        closeEditor (key, true);
        loading.erase (it->second.get());
        slots.erase (it);
    }

    auto slot = std::make_shared<PluginSlot> (key, ref, isInstrument);
    slots[key] = slot;
    startLoading (slot);
    return slot;
}

void PluginHost::retainOnly (const std::set<juce::String>& keys)
{
    for (auto it = slots.begin(); it != slots.end();)
    {
        if (keys.count (it->first) == 0)
        {
            closeEditor (it->first, true);
            loading.erase (it->second.get());
            it = slots.erase (it);
        }
        else
        {
            ++it;
        }
    }
}

void PluginHost::fail (const std::shared_ptr<PluginSlot>& slot, const juce::String& message)
{
    loading.erase (slot.get());
    slot->failed = true;
    slot->error = message;
    sendPluginError (slot->key, message);
}

void PluginHost::startLoading (std::shared_ptr<PluginSlot> slot)
{
    loading.insert (slot.get());
    juce::PluginDescription desc;
    if (findDescription (slot->ref, desc))
    {
        createInstance (slot, desc);
        return;
    }

    if (slot->ref.fileOrIdentifier.isEmpty() || slot->ref.format.isEmpty())
    {
        fail (slot, "plugin '" + slot->ref.name + "' is not in the plugin list (scan first)");
        return;
    }

    // Unknown plugin: scan its file out of process, then create it.
    std::weak_ptr<PluginSlot> weak = slot;
    std::weak_ptr<bool> token = alive;
    const auto ref = slot->ref;
    std::thread ([this, weak, token, ref]
    {
        auto results = std::make_shared<juce::OwnedArray<juce::PluginDescription>>();
        auto reason = std::make_shared<juce::String>();
        const bool ok = scanOutOfProcess (ref.format, ref.fileOrIdentifier, 30000, *results, *reason);
        juce::MessageManager::callAsync ([this, weak, token, ok, results, reason, ref]
        {
            if (token.lock() == nullptr)
                return;
            auto s = weak.lock();
            if (s == nullptr || slots.count (s->key) == 0 || slots[s->key] != s)
                return;
            if (! ok)
            {
                fail (s, "could not load '" + ref.name + "': " + *reason);
                return;
            }
            mergeScanResults (ref.format, { ref.fileOrIdentifier }, *results, *std::make_unique<std::vector<FailedPlugin>>());
            saveCache();
            juce::PluginDescription d;
            if (findDescription (ref, d))
                createInstance (s, d);
            else if (! results->isEmpty())
                createInstance (s, *results->getFirst());
            else
                fail (s, "plugin '" + ref.name + "' not found in " + ref.fileOrIdentifier);
        });
    }).detach();
}

void PluginHost::createInstance (std::shared_ptr<PluginSlot> slot, const juce::PluginDescription& desc)
{
    std::weak_ptr<PluginSlot> weak = slot;
    std::weak_ptr<bool> token = alive;
    formats.createPluginInstanceAsync (desc, sampleRate, blockSize,
        [this, weak, token] (std::unique_ptr<juce::AudioPluginInstance> instance, const juce::String& error)
        {
            if (token.lock() == nullptr)
                return;
            auto s = weak.lock();
            if (s == nullptr || slots.count (s->key) == 0 || slots[s->key] != s)
                return; // dropped meanwhile; the instance is deleted here, on the message thread
            finishLoading (s, std::move (instance), error);
        });
}

void PluginHost::finishLoading (const std::shared_ptr<PluginSlot>& slot, std::unique_ptr<juce::AudioPluginInstance> instance,
                                const juce::String& error)
{
    if (instance == nullptr)
    {
        fail (slot, error.isNotEmpty() ? error : juce::String ("could not create the plugin"));
        return;
    }

    configureInstance (*instance, slot->isInstrument, slot->ref, sampleRate, blockSize);
    slot->appliedState = slot->ref.hasState ? slot->ref.state : juce::String();
    const auto name = instance->getName();
    const int latency = instance->getLatencySamples();
    const bool editor = instance->hasEditor();
    const int numParams = instance->getParameters().size();
    slot->setInstance (std::move (instance), sampleRate, blockSize);
    loading.erase (slot.get());

    json::Writer w;
    w.beginObject()
        .field ("type", "plugin.loaded")
        .field ("key", slot->key)
        .field ("name", name)
        .field ("latency", latency)
        .field ("hasEditor", editor)
        .field ("numParams", numParams)
        .field ("numInputs", slot->numInputChannels())
        .field ("numOutputs", slot->numOutputChannels())
        .endObject();
    protocol::writeLine (w.str());
}

void PluginHost::setProcessingSetup (double rate, int block)
{
    sampleRate = rate;
    blockSize = block;
    for (auto& [key, slot] : slots)
        slot->reprepare (rate, block);
}

std::string PluginHost::paramsJson (const juce::String& key, juce::String& error) const
{
    auto slot = find (key);
    auto* p = slot != nullptr ? slot->get() : nullptr;
    if (p == nullptr)
    {
        error = "no loaded plugin '" + key + "'";
        return {};
    }
    json::Writer w;
    w.beginObject().field ("type", "plugin.params").field ("key", key).key ("params").beginArray();
    const auto& params = p->getParameters();
    for (int i = 0; i < params.size(); ++i)
    {
        auto* param = params.getUnchecked (i);
        w.beginObject()
            .field ("index", i)
            .field ("name", param->getName (128))
            .field ("label", param->getLabel())
            .field ("value", param->getValue())
            .field ("text", param->getCurrentValueAsText())
            .field ("steps", param->getNumSteps())
            .field ("automatable", param->isAutomatable())
            .endObject();
    }
    w.endArray().endObject();
    return w.take();
}

bool PluginHost::setParam (const juce::String& key, int index, float value, juce::String& error)
{
    auto slot = find (key);
    auto* p = slot != nullptr ? slot->get() : nullptr;
    if (p == nullptr)
    {
        error = "no loaded plugin '" + key + "'";
        return false;
    }
    const auto& params = p->getParameters();
    if (index < 0 || index >= params.size())
    {
        error = "parameter index out of range";
        return false;
    }
    params.getUnchecked (index)->setValue (juce::jlimit (0.0f, 1.0f, value));
    return true;
}

bool PluginHost::openEditor (const juce::String& key, const juce::String& title, juce::String& error)
{
    auto slot = find (key);
    auto* p = slot != nullptr ? slot->get() : nullptr;
    if (p == nullptr)
    {
        error = "no loaded plugin '" + key + "'";
        return false;
    }
    if (auto it = windows.find (key); it != windows.end())
    {
        it->second->toFront (true);
        return true;
    }
    if (! hasDisplay())
    {
        error = "no display available for plugin windows";
        return false;
    }

    juce::AudioProcessorEditor* editor = p->hasEditor() ? p->createEditorAndMakeActive() : nullptr;
    if (editor == nullptr)
        editor = new juce::GenericAudioProcessorEditor (*p);

    windows[key] = std::make_unique<Window> (title.isNotEmpty() ? title : p->getName(), editor,
                                             [this, key] { closeEditor (key, true); });
    return true;
}

void PluginHost::closeEditor (const juce::String& key, bool notify)
{
    auto it = windows.find (key);
    if (it == windows.end())
        return;
    auto window = std::move (it->second);
    windows.erase (it);
    window.reset();
    if (notify)
    {
        json::Writer w;
        w.beginObject().field ("type", "plugin.editorClosed").field ("key", key).endObject();
        protocol::writeLine (w.str());
    }
}

std::string PluginHost::statesJson (const juce::var& requestId)
{
    json::Writer w;
    w.beginObject().field ("type", "plugins.states");
    if (! requestId.isVoid())
    {
        w.key ("requestId");
        w.var (requestId);
    }
    w.key ("states").beginObject();
    for (auto& [key, slot] : slots)
    {
        if (auto* p = slot->get())
        {
            juce::MemoryBlock state;
            p->getStateInformation (state);
            const auto base64 = state.toBase64Encoding();
            slot->appliedState = base64;
            w.field (key.toRawUTF8(), base64);
        }
    }
    w.endObject().endObject();
    return w.take();
}

void PluginHost::pollParameterChanges()
{
    for (auto& [key, slot] : slots)
    {
        int index = -1;
        float value = 0.0f;
        if (! slot->takeChangedParameter (index, value))
            continue;
        auto* p = slot->get();
        if (p == nullptr || index < 0 || index >= p->getParameters().size())
            continue;
        json::Writer w;
        w.beginObject()
            .field ("type", "plugin.paramChanged")
            .field ("key", key)
            .field ("index", index)
            .field ("value", value)
            .field ("text", p->getParameters().getUnchecked (index)->getCurrentValueAsText())
            .endObject();
        protocol::writeLine (w.str());
    }
}

//==============================================================================
SyncPluginProvider::SyncPluginProvider (juce::File dataDirectory, double sampleRate, int blockSize)
    : rate (sampleRate), block (blockSize)
{
    addHostedFormats (formats);
    const auto file = dataDirectory.getChildFile ("plugins.json");
    if (file.existsAsFile())
    {
        juce::String error;
        const auto v = json::parse (file.loadFileAsString(), error);
        if (const auto* list = json::get (v, "plugins").getArray())
            for (const auto& d : *list)
            {
                juce::PluginDescription desc;
                if (readDescription (d, desc))
                    known.push_back (desc);
            }
    }
}

SyncPluginProvider::~SyncPluginProvider() = default;

std::shared_ptr<PluginSlot> SyncPluginProvider::slotFor (const juce::String& key, const PluginRef& ref, bool isInstrument)
{
    if (auto it = slots.find (key); it != slots.end())
        return it->second;

    auto slot = std::make_shared<PluginSlot> (key, ref, isInstrument);
    slots[key] = slot;

    juce::PluginDescription desc;
    bool found = false;
    for (const auto& d : known)
        if (d.createIdentifierString() == ref.uid
            || (d.pluginFormatName == ref.format && d.fileOrIdentifier == ref.fileOrIdentifier && d.name == ref.name))
        {
            desc = d;
            found = true;
            break;
        }
    if (! found)
    {
        for (auto* f : formats.getFormats())
        {
            if (f->getName() != ref.format)
                continue;
            juce::OwnedArray<juce::PluginDescription> results;
            f->findAllTypesForFile (results, ref.fileOrIdentifier);
            for (auto* d : results)
                if (! found && (ref.name.isEmpty() || d->name == ref.name || d->createIdentifierString() == ref.uid))
                {
                    desc = *d;
                    found = true;
                }
        }
    }
    if (! found)
    {
        errors.push_back (key + ": plugin '" + ref.name + "' not found");
        return slot;
    }

    juce::String error;
    auto instance = formats.createPluginInstance (desc, rate, block, error);
    if (instance == nullptr)
    {
        errors.push_back (key + ": " + error);
        return slot;
    }
    configureInstance (*instance, isInstrument, ref, rate, block);
    slot->setInstance (std::move (instance), rate, block);
    return slot;
}

} // namespace mad
