#pragma once

#include "engine/GraphBuilder.h"
#include "plugins/PluginSlot.h"

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include <map>
#include <memory>
#include <mutex>
#include <set>

namespace mad
{

struct FailedPlugin
{
    juce::String format, fileOrIdentifier, reason;
};

/** Runs `<engine> --scan-plugin <format> <fileOrIdentifier>` with a timeout and parses the
    {"plugins":[…]} reply. Returns false (with `reason`) on crash, timeout or bad output. */
bool scanOutOfProcess (const juce::String& format, const juce::String& fileOrIdentifier, int timeoutMs,
                       juce::OwnedArray<juce::PluginDescription>& results, juce::String& reason);

/** Plugin hosting for the live engine: known-plugin cache (<data-dir>/plugins.json),
    out-of-process scans, asynchronous instance creation, parameters, editors and states. */
class PluginHost final : public PluginProvider
{
public:
    explicit PluginHost (juce::File dataDirectory);
    ~PluginHost() override;

    // PluginProvider
    std::shared_ptr<PluginSlot> slotFor (const juce::String& key, const PluginRef& ref, bool isInstrument) override;
    void retainOnly (const std::set<juce::String>& keys) override;

    /** Rate/block size for new instances; re-prepares loaded ones. */
    void setProcessingSetup (double sampleRate, int blockSize);

    juce::StringArray formatNames() const;
    std::string pathsJson() const;
    std::string listJson() const;
    /** Search paths by format name; the key "" applies to every format. Formats without an entry (or
        with an empty list) use their default locations. */
    using ScanPaths = std::map<juce::String, juce::StringArray>;
    void scan (const juce::StringArray& formats, const ScanPaths& paths, bool rescanAll);
    bool isScanning() const noexcept { return scanning.load(); }

    std::shared_ptr<PluginSlot> find (const juce::String& key) const;
    std::vector<std::shared_ptr<PluginSlot>> allSlots() const;

    std::string paramsJson (const juce::String& key, juce::String& error) const;
    bool setParam (const juce::String& key, int index, float value, juce::String& error);
    bool openEditor (const juce::String& key, const juce::String& title, juce::String& error);
    void closeEditor (const juce::String& key, bool notify);
    std::string statesJson (const juce::var& requestId);

    /** ~30x per second: plugin.paramChanged events. */
    void pollParameterChanges();

    /** True while any slot is still being created. */
    bool anyLoading() const;

    /** Looks a description up in the known list (uid first, then format + file + name). */
    bool findDescription (const PluginRef& ref, juce::PluginDescription& out) const;

    juce::AudioPluginFormatManager& formatManager() noexcept { return formats; }

private:
    class Window;
    class ScanThread;

    void startLoading (std::shared_ptr<PluginSlot> slot);
    void createInstance (std::shared_ptr<PluginSlot> slot, const juce::PluginDescription& desc);
    void finishLoading (const std::shared_ptr<PluginSlot>& slot, std::unique_ptr<juce::AudioPluginInstance> instance,
                        const juce::String& error);
    void fail (const std::shared_ptr<PluginSlot>& slot, const juce::String& message);
    void loadCache();
    void saveCache() const;
    void mergeScanResults (const juce::String& format, const std::vector<juce::String>& scannedFiles,
                           juce::OwnedArray<juce::PluginDescription>& found, std::vector<FailedPlugin>& failedNow);

    juce::File dataDir;
    juce::AudioPluginFormatManager formats;
    std::vector<juce::PluginDescription> known;
    std::vector<FailedPlugin> failed;
    std::map<juce::String, std::shared_ptr<PluginSlot>> slots;
    std::set<PluginSlot*> loading;
    std::map<juce::String, std::unique_ptr<Window>> windows;
    double sampleRate = 48000.0;
    int blockSize = 512;
    std::atomic<bool> scanning { false };
    std::unique_ptr<ScanThread> scanThread;
    std::shared_ptr<bool> alive = std::make_shared<bool> (true);
};

/** Instruments/effects for command-line renders: created synchronously from the description
    cache or an in-process scan of the plugin file. Call from a non-message thread. */
class SyncPluginProvider final : public PluginProvider
{
public:
    SyncPluginProvider (juce::File dataDirectory, double sampleRate, int blockSize);
    ~SyncPluginProvider() override;

    std::shared_ptr<PluginSlot> slotFor (const juce::String& key, const PluginRef& ref, bool isInstrument) override;

    std::vector<juce::String> errors;

private:
    juce::AudioPluginFormatManager formats;
    std::vector<juce::PluginDescription> known;
    double rate;
    int block;
    std::map<juce::String, std::shared_ptr<PluginSlot>> slots;
};

/** Configures buses, restores state and prepares a freshly created instance. */
void configureInstance (juce::AudioPluginInstance& instance, bool isInstrument, const PluginRef& ref, double sampleRate,
                        int blockSize);

} // namespace mad
