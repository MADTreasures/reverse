#pragma once

#include "engine/AudioEngine.h"
#include "engine/ProjectModel.h"
#include "engine/Samples.h"
#include "engine/Timeline.h"

#include <map>
#include <memory>
#include <set>

namespace mad
{

class PluginSlot;

/** Supplies plugin instances to a graph (live host, borrowed live instances, or synchronous
    creation for command-line renders). */
class PluginProvider
{
public:
    virtual ~PluginProvider() = default;

    /** The slot for `key` ("ch:<id>" / "fx:<slotId>"); may still be loading. Null if unavailable. */
    virtual std::shared_ptr<PluginSlot> slotFor (const juce::String& key, const PluginRef& ref, bool isInstrument) = 0;

    /** Called after each project update with every key the project still uses. */
    virtual void retainOnly (const std::set<juce::String>& keys) { juce::ignoreUnused (keys); }
};

/** Mirrors a ProjectModel as engine nodes. Parameter changes go straight to the nodes'
    atomics; structural changes publish a new GraphSnapshot reusing unchanged nodes (so voices
    and effect tails keep running). Not thread-safe: use from one thread. */
class GraphBuilder
{
public:
    GraphBuilder (AudioEngine& engine, SampleStore& samples, ChannelIds& ids, PluginProvider* plugins, bool offline);

    void setProject (const ProjectModel& model);
    void setTimeline (std::shared_ptr<const Timeline> timeline);
    void setAutomation (std::shared_ptr<const AutomationData> automation);
    void setMonitoring (const juce::String& mode);

    /** Re-resolves samples/plugins and publishes when anything changed. */
    void refresh();

    /** Recreates every node (after the engine was prepared for a new sample rate). */
    void rebuildAll();

    /** Message thread: background work of effects (reverb IR rebuilds). */
    void serviceEffects();

    const ProjectModel& project() const noexcept { return model; }
    ChannelNode* findChannel (const juce::String& id) const;
    std::vector<std::pair<juce::String, ChannelNode*>> channelNodes() const;
    std::shared_ptr<const Timeline> timeline() const noexcept { return currentTimeline; }
    std::shared_ptr<const AutomationData> automation() const noexcept { return currentAutomation; }

private:
    struct ChannelEntry
    {
        std::shared_ptr<ChannelNode> node;
        ChannelKind kind = ChannelKind::synth;
        PluginRef plugin;
        std::shared_ptr<PluginSlot> slot;
        SamplePtr forward, reversed;
    };

    struct EffectEntry
    {
        std::shared_ptr<Effect> effect;
        juce::String type;
        PluginRef plugin;
        std::shared_ptr<PluginSlot> slot;
    };

    bool updateChannels();
    bool updateMixer();
    bool resolveSamples (ChannelEntry& entry, const ChannelModel& ch);
    void publish();
    std::unique_ptr<AutomationBinding> bindAutomation() const;
    AutoParam* resolveParam (const juce::String& target) const;
    void resetRemovedLanes (const AutomationData* previous, const AutomationData* next);

    AudioEngine& engine;
    SampleStore& samples;
    ChannelIds& ids;
    PluginProvider* plugins;
    const bool offline;

    ProjectModel model;
    juce::String monitoring = "armed";
    std::map<juce::String, ChannelEntry> channels;
    std::vector<std::shared_ptr<MixerTrackNode>> tracks;
    std::map<juce::String, EffectEntry> effects;
    std::shared_ptr<const Timeline> currentTimeline;
    std::shared_ptr<const AutomationData> currentAutomation;
    juce::String structure;
    uint64_t sampleRevision = 0;
};

} // namespace mad
