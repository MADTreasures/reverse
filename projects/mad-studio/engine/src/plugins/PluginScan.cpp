#include "plugins/PluginScan.h"

#include "core/Log.h"
#include "core/Protocol.h"

namespace mad
{

void addHostedFormats (juce::AudioPluginFormatManager& manager)
{
    juce::addDefaultFormatsToManager (manager);
}

void writeDescription (json::Writer& w, const juce::PluginDescription& d)
{
    w.beginObject()
        .field ("uid", d.createIdentifierString())
        .field ("name", d.name)
        .field ("vendor", d.manufacturerName)
        .field ("format", d.pluginFormatName)
        .field ("category", d.category)
        .field ("version", d.version)
        .field ("fileOrIdentifier", d.fileOrIdentifier)
        .field ("isInstrument", d.isInstrument)
        .field ("numInputs", d.numInputChannels)
        .field ("numOutputs", d.numOutputChannels)
        .field ("descriptiveName", d.descriptiveName)
        .field ("uniqueId", d.uniqueId)
        .field ("deprecatedUid", d.deprecatedUid)
        .field ("lastFileModTime", (int64_t) d.lastFileModTime.toMilliseconds())
        .field ("lastInfoUpdateTime", (int64_t) d.lastInfoUpdateTime.toMilliseconds())
        .field ("hasSharedContainer", d.hasSharedContainer)
        .endObject();
}

bool readDescription (const juce::var& v, juce::PluginDescription& d)
{
    if (! v.isObject())
        return false;
    d.name = json::string (v, "name");
    d.descriptiveName = json::string (v, "descriptiveName", d.name);
    d.pluginFormatName = json::string (v, "format");
    d.category = json::string (v, "category");
    d.manufacturerName = json::string (v, "vendor");
    d.version = json::string (v, "version");
    d.fileOrIdentifier = json::string (v, "fileOrIdentifier");
    d.isInstrument = json::boolean (v, "isInstrument", false);
    d.numInputChannels = json::integer (v, "numInputs", 0);
    d.numOutputChannels = json::integer (v, "numOutputs", 2);
    d.uniqueId = json::integer (v, "uniqueId", 0);
    d.deprecatedUid = json::integer (v, "deprecatedUid", 0);
    d.lastFileModTime = juce::Time ((int64_t) json::number (v, "lastFileModTime", 0.0));
    d.lastInfoUpdateTime = juce::Time ((int64_t) json::number (v, "lastInfoUpdateTime", 0.0));
    d.hasSharedContainer = json::boolean (v, "hasSharedContainer", false);
    return d.name.isNotEmpty() && d.pluginFormatName.isNotEmpty() && d.fileOrIdentifier.isNotEmpty();
}

//==============================================================================
PluginScanJob::PluginScanJob (juce::String format, juce::String fileOrIdentifier, std::function<void (int)> onDone)
    : juce::Thread ("mad-plugin-scan"), formatName (std::move (format)), target (std::move (fileOrIdentifier)), done (std::move (onDone))
{
    addHostedFormats (formats);
}

PluginScanJob::~PluginScanJob() { stopThread (5000); }

void PluginScanJob::start()
{
    // VST3/LV2 are scanned on the message thread (as JUCE's own scanner does); AudioUnits
    // need an unblocked message thread, so they are scanned from a worker.
    if (formatName == "AudioUnit")
        startThread();
    else
        juce::MessageManager::callAsync ([this] { scan(); });
}

void PluginScanJob::run() { scan(); }

void PluginScanJob::scan()
{
    juce::AudioPluginFormat* format = nullptr;
    for (auto* f : formats.getFormats())
        if (f->getName() == formatName)
            format = f;

    int code = 0;
    json::Writer w;
    w.beginObject();
    if (format == nullptr)
    {
        w.field ("error", "unknown plugin format " + formatName);
        code = 2;
    }
    w.key ("plugins").beginArray();
    if (format != nullptr)
    {
        juce::OwnedArray<juce::PluginDescription> found;
        format->findAllTypesForFile (found, target);
        for (auto* d : found)
            writeDescription (w, *d);
    }
    w.endArray().endObject();
    protocol::writeLine (w.str());

    auto callback = done;
    juce::MessageManager::callAsync ([callback, code] { if (callback) callback (code); });
}

} // namespace mad
