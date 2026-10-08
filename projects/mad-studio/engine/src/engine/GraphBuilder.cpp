#include "engine/GraphBuilder.h"

#include "plugins/PluginSlot.h"

#include <algorithm>

namespace mad
{
namespace
{
juce::String pointerKey (const void* p) { return juce::String::toHexString ((juce::pointer_sized_int) p); }
} // namespace

GraphBuilder::GraphBuilder (AudioEngine& e, SampleStore& s, ChannelIds& i, PluginProvider* p, bool isOffline)
    : engine (e), samples (s), ids (i), plugins (p), offline (isOffline)
{
}

void GraphBuilder::setMonitoring (const juce::String& mode)
{
    monitoring = mode;
    for (size_t i = 0; i < tracks.size() && i < model.mixer.size(); ++i)
    {
        const auto& t = model.mixer[i];
        const bool monitor = ! offline && t.input.channels > 0 && (mode == "on" || (mode == "armed" && t.armed));
        tracks[i]->monitor.store (monitor);
    }
}

bool GraphBuilder::resolveSamples (ChannelEntry& entry, const ChannelModel& ch)
{
    auto* sampler = static_cast<SamplerInstrument*> (entry.node->instrument.get());
    auto fwd = ch.sampleId.isNotEmpty() ? samples.get (ch.sampleId, false) : nullptr;
    const bool wantReverse = ch.samplerParams[sampler::reverse] >= 0.5f;
    auto rev = (wantReverse && fwd != nullptr) ? samples.get (ch.sampleId, true) : nullptr;
    const bool changed = fwd != entry.forward || rev != entry.reversed;
    entry.forward = std::move (fwd);
    entry.reversed = std::move (rev);
    sampler->forward.store (entry.forward.get());
    sampler->reversed.store (entry.reversed.get());
    return changed;
}

bool GraphBuilder::updateChannels()
{
    const double rate = engine.getSampleRate();
    const int block = engine.getMaxBlockSize();
    bool structural = false;
    std::set<juce::String> seen;

    for (const auto& ch : model.channels)
    {
        seen.insert (ch.id);
        auto it = channels.find (ch.id);
        const bool recreate = it == channels.end() || it->second.kind != ch.kind
                              || (ch.kind == ChannelKind::plugin && ! it->second.plugin.sameDescription (ch.plugin));
        if (recreate)
        {
            ChannelEntry entry;
            entry.kind = ch.kind;
            const auto uid = ids.uidFor (ch.id);
            std::unique_ptr<Instrument> instrument;
            switch (ch.kind)
            {
                case ChannelKind::synth:
                    instrument = std::make_unique<SynthInstrument>();
                    break;
                case ChannelKind::sampler:
                    instrument = std::make_unique<SamplerInstrument> (uid);
                    break;
                case ChannelKind::plugin:
                    entry.plugin = ch.plugin;
                    entry.slot = plugins != nullptr ? plugins->slotFor ("ch:" + ch.id, ch.plugin, true) : nullptr;
                    if (entry.slot == nullptr)
                        entry.slot = std::make_shared<PluginSlot> ("ch:" + ch.id, ch.plugin, true);
                    instrument = std::make_unique<PluginInstrument> (entry.slot, offline);
                    break;
            }
            entry.node = std::make_shared<ChannelNode> (uid, ch.id, ch.kind, std::move (instrument));
            entry.node->prepare (rate, block);
            channels[ch.id] = std::move (entry);
            it = channels.find (ch.id);
            structural = true;
        }

        auto& entry = it->second;
        auto& node = *entry.node;
        node.volume.setBase (ch.volume);
        node.pan.setBase (ch.pan);
        node.muted.store (ch.muted);
        switch (ch.kind)
        {
            case ChannelKind::synth:
            {
                auto* s = static_cast<SynthInstrument*> (node.instrument.get());
                for (size_t i = 0; i < ch.synthParams.size(); ++i)
                    s->params[i].setBase (ch.synthParams[i]);
                break;
            }
            case ChannelKind::sampler:
            {
                auto* s = static_cast<SamplerInstrument*> (node.instrument.get());
                for (size_t i = 0; i < ch.samplerParams.size(); ++i)
                    s->params[i].setBase (ch.samplerParams[i]);
                structural = resolveSamples (entry, ch) || structural;
                break;
            }
            case ChannelKind::plugin:
                break;
        }
    }

    for (auto it = channels.begin(); it != channels.end();)
    {
        if (seen.count (it->first) == 0)
        {
            it = channels.erase (it);
            structural = true;
        }
        else
        {
            ++it;
        }
    }
    return structural;
}

bool GraphBuilder::updateMixer()
{
    const double rate = engine.getSampleRate();
    const int block = engine.getMaxBlockSize();
    bool structural = false;

    if (tracks.size() != model.mixer.size())
    {
        structural = true;
        while (tracks.size() > model.mixer.size())
            tracks.pop_back();
        while (tracks.size() < model.mixer.size())
        {
            auto node = std::make_shared<MixerTrackNode> ((int) tracks.size());
            node->prepare (rate, block);
            tracks.push_back (std::move (node));
        }
    }

    std::set<juce::String> seenEffects;
    for (size_t i = 0; i < model.mixer.size(); ++i)
    {
        const auto& t = model.mixer[i];
        auto& node = *tracks[i];
        node.volume.setBase (t.volume);
        node.pan.setBase (t.pan);
        node.audible.store (t.muted || ! model.trackAudible (i) ? 0.0f : 1.0f);
        node.inputChannels.store (offline ? 0 : t.input.channels);
        node.inputFirst.store (t.input.first);
        node.monitor.store (! offline && t.input.channels > 0
                            && (monitoring == "on" || (monitoring == "armed" && t.armed)));

        for (const auto& fx : t.effects)
        {
            seenEffects.insert (fx.id);
            auto it = effects.find (fx.id);
            const bool recreate = it == effects.end() || it->second.type != fx.type
                                  || (fx.type == "plugin" && ! it->second.plugin.sameDescription (fx.plugin));
            if (recreate)
            {
                EffectEntry entry;
                entry.type = fx.type;
                if (fx.type == "plugin")
                {
                    entry.plugin = fx.plugin;
                    entry.slot = plugins != nullptr ? plugins->slotFor ("fx:" + fx.id, fx.plugin, false) : nullptr;
                    if (entry.slot == nullptr)
                        entry.slot = std::make_shared<PluginSlot> ("fx:" + fx.id, fx.plugin, false);
                    entry.effect = std::make_shared<PluginEffect> (entry.slot, offline);
                }
                else
                {
                    entry.effect = createInternalEffect (fx.type);
                }
                if (entry.effect == nullptr)
                    continue;
                // Parameter bases before prepare() so effects can initialise from them (reverb IR).
                for (size_t p = 0; p < fx.params.size() && p < entry.effect->params.size(); ++p)
                    entry.effect->params[p].setBase (fx.params[p]);
                entry.effect->prepare (rate, block, offline);
                effects[fx.id] = std::move (entry);
                it = effects.find (fx.id);
                structural = true;
            }
            auto& effect = *it->second.effect;
            for (size_t p = 0; p < fx.params.size() && p < effect.params.size(); ++p)
                effect.params[p].setBase (fx.params[p]);
        }
    }

    for (auto it = effects.begin(); it != effects.end();)
    {
        if (seenEffects.count (it->first) == 0)
        {
            it = effects.erase (it);
            structural = true;
        }
        else
        {
            ++it;
        }
    }
    return structural;
}

void GraphBuilder::setProject (const ProjectModel& next)
{
    model = next;
    engine.bpm.setBase ((float) model.bpm);
    engine.swing.setBase ((float) model.swing);
    engine.beatsPerBar.store (model.beatsPerBar);

    bool structural = updateChannels();
    structural = updateMixer() || structural;
    sampleRevision = samples.revision();

    if (plugins != nullptr)
    {
        std::set<juce::String> keys;
        for (const auto& [id, entry] : channels)
            if (entry.kind == ChannelKind::plugin)
                keys.insert ("ch:" + id);
        for (const auto& [id, entry] : effects)
            if (entry.type == "plugin")
                keys.insert ("fx:" + id);
        plugins->retainOnly (keys);
    }

    juce::ignoreUnused (structural);
    publish(); // publish() skips the swap when the structure is unchanged
}

void GraphBuilder::setTimeline (std::shared_ptr<const Timeline> tl)
{
    currentTimeline = std::move (tl);
    structure = {}; // force a new snapshot
    publish();
}

void GraphBuilder::setAutomation (std::shared_ptr<const AutomationData> automation)
{
    resetRemovedLanes (currentAutomation.get(), automation.get());
    currentAutomation = std::move (automation);
    structure = {};
    publish();
}

void GraphBuilder::refresh()
{
    bool changed = false;
    if (samples.revision() != sampleRevision)
    {
        sampleRevision = samples.revision();
        for (const auto& ch : model.channels)
        {
            auto it = channels.find (ch.id);
            if (it != channels.end() && ch.kind == ChannelKind::sampler)
                changed = resolveSamples (it->second, ch) || changed;
        }
    }
    juce::ignoreUnused (changed);
    publish();
}

void GraphBuilder::rebuildAll()
{
    channels.clear();
    tracks.clear();
    effects.clear();
    structure = {};
    setProject (model);
}

void GraphBuilder::serviceEffects()
{
    for (auto& [id, entry] : effects)
        entry.effect->service();
}

ChannelNode* GraphBuilder::findChannel (const juce::String& id) const
{
    const auto it = channels.find (id);
    return it != channels.end() ? it->second.node.get() : nullptr;
}

std::vector<std::pair<juce::String, ChannelNode*>> GraphBuilder::channelNodes() const
{
    std::vector<std::pair<juce::String, ChannelNode*>> out;
    for (const auto& [id, entry] : channels)
        out.emplace_back (id, entry.node.get());
    return out;
}

void GraphBuilder::publish()
{
    // Structure signature: anything the audio thread holds pointers to or iterates over.
    juce::String key;
    key << (int) tracks.size() << "|" << pointerKey (currentTimeline.get()) << "|" << pointerKey (currentAutomation.get()) << "|";
    for (const auto& ch : model.channels)
    {
        const auto it = channels.find (ch.id);
        if (it == channels.end())
            continue;
        key << pointerKey (it->second.node.get()) << ":" << ch.mixerTrack << ":" << pointerKey (it->second.forward.get())
            << ":" << pointerKey (it->second.reversed.get()) << ";";
    }
    for (size_t i = 0; i < model.mixer.size(); ++i)
    {
        key << "#";
        for (const auto& fx : model.mixer[i].effects)
        {
            const auto it = effects.find (fx.id);
            if (fx.enabled && it != effects.end())
                key << pointerKey (it->second.effect.get()) << ",";
        }
    }
    if (key == structure && engine.snapshots.latest() != nullptr)
        return;
    structure = key;

    auto snap = std::make_unique<GraphSnapshot>();
    const int numTracks = (int) tracks.size();
    for (const auto& ch : model.channels)
    {
        const auto it = channels.find (ch.id);
        if (it == channels.end() || numTracks == 0)
            continue;
        snap->channels.push_back ({ it->second.node.get(), std::clamp (ch.mixerTrack, 0, numTracks - 1) });
        snap->keepAlive.push_back (it->second.node);
        if (it->second.forward != nullptr)
            snap->keepAlive.push_back (std::const_pointer_cast<SampleData> (it->second.forward));
        if (it->second.reversed != nullptr)
            snap->keepAlive.push_back (std::const_pointer_cast<SampleData> (it->second.reversed));
        if (it->second.slot != nullptr)
            snap->keepAlive.push_back (it->second.slot);
    }
    for (size_t i = 0; i < tracks.size(); ++i)
    {
        GraphSnapshot::TrackEntry entry;
        entry.node = tracks[i].get();
        snap->keepAlive.push_back (tracks[i]);
        if (i < model.mixer.size())
        {
            for (const auto& fx : model.mixer[i].effects)
            {
                const auto it = effects.find (fx.id);
                if (! fx.enabled || it == effects.end())
                    continue;
                entry.chain.push_back (it->second.effect.get());
                snap->keepAlive.push_back (it->second.effect);
                if (it->second.slot != nullptr)
                    snap->keepAlive.push_back (it->second.slot);
            }
        }
        snap->tracks.push_back (std::move (entry));
    }
    snap->timeline = currentTimeline;
    snap->automation = bindAutomation();
    engine.snapshots.publish (std::move (snap));
}

AutoParam* GraphBuilder::resolveParam (const juce::String& target) const
{
    juce::StringArray parts;
    parts.addTokens (target, ":", "");
    if (parts.size() < 2)
        return nullptr;

    const auto& kind = parts[0];
    if (kind == "proj")
    {
        if (parts[1] == "bpm")
            return &engine.bpm;
        if (parts[1] == "swing")
            return &engine.swing;
        return nullptr;
    }
    if (parts.size() < 3)
        return nullptr;

    if (kind == "ch")
    {
        const auto it = channels.find (parts[1]);
        if (it == channels.end())
            return nullptr;
        auto& node = *it->second.node;
        const auto path = parts.joinIntoString (":", 2);
        if (path == "volume")
            return &node.volume;
        if (path == "pan")
            return &node.pan;
        if (path.startsWith ("synth.") && node.kind == ChannelKind::synth)
        {
            const int i = synth::indexForPath (path.substring (6));
            return i >= 0 ? &static_cast<SynthInstrument*> (node.instrument.get())->params[(size_t) i] : nullptr;
        }
        if (path.startsWith ("sampler.") && node.kind == ChannelKind::sampler)
        {
            const int i = sampler::indexForPath (path.substring (8));
            return i >= 0 ? &static_cast<SamplerInstrument*> (node.instrument.get())->params[(size_t) i] : nullptr;
        }
        return nullptr;
    }
    if (kind == "mx")
    {
        if (! parts[1].containsOnly ("0123456789") || parts[1].isEmpty())
            return nullptr;
        const int index = parts[1].getIntValue();
        if (index < 0 || index >= (int) tracks.size())
            return nullptr;
        if (parts[2] == "volume")
            return &tracks[(size_t) index]->volume;
        if (parts[2] == "pan")
            return &tracks[(size_t) index]->pan;
        return nullptr;
    }
    if (kind == "fx")
    {
        const auto it = effects.find (parts[1]);
        if (it == effects.end() || it->second.effect->spec == nullptr)
            return nullptr;
        const int i = it->second.effect->spec->indexOf (parts.joinIntoString (":", 2));
        return i >= 0 ? &it->second.effect->params[(size_t) i] : nullptr;
    }
    return nullptr;
}

std::unique_ptr<AutomationBinding> GraphBuilder::bindAutomation() const
{
    if (currentAutomation == nullptr || currentAutomation->lanes.empty())
        return nullptr;

    auto binding = std::make_unique<AutomationBinding>();
    binding->data = currentAutomation;
    for (const auto& lane : currentAutomation->lanes)
    {
        AutomationBinding::Entry entry;
        entry.lane = &lane;
        if (lane.target.startsWith ("plug:"))
        {
            // plug:<instanceKey>:<paramIndex>, instanceKey = ch:<channelId> | fx:<slotId>
            const auto rest = lane.target.substring (5);
            const auto key = rest.upToLastOccurrenceOf (":", false, false);
            const auto indexText = rest.fromLastOccurrenceOf (":", false, false);
            if (! indexText.containsOnly ("0123456789") || indexText.isEmpty())
                continue;
            PluginSlot* slot = nullptr;
            if (key.startsWith ("ch:"))
            {
                const auto it = channels.find (key.substring (3));
                if (it != channels.end())
                    slot = it->second.slot.get();
            }
            else if (key.startsWith ("fx:"))
            {
                const auto it = effects.find (key.substring (3));
                if (it != effects.end())
                    slot = it->second.slot.get();
            }
            if (slot == nullptr)
                continue;
            entry.plugin = slot;
            entry.pluginParam = indexText.getIntValue();
        }
        else
        {
            entry.param = resolveParam (lane.target);
            if (entry.param == nullptr)
                continue;
        }
        binding->entries.push_back (entry);
    }
    return binding;
}

void GraphBuilder::resetRemovedLanes (const AutomationData* previous, const AutomationData* next)
{
    if (previous == nullptr)
        return;
    std::set<juce::String> kept;
    if (next != nullptr)
        for (const auto& l : next->lanes)
            kept.insert (l.target);
    for (const auto& l : previous->lanes)
        if (kept.count (l.target) == 0)
            if (auto* p = resolveParam (l.target))
                p->requestOverrideReset();
}

} // namespace mad
