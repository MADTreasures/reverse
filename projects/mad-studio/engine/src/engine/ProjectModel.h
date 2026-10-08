#pragma once

#include "engine/Params.h"

#include <juce_core/juce_core.h>

#include <array>
#include <vector>

namespace mad
{

/** Plugin instance data carried in the project (channel `plugin` / effect slot `plugin`). */
struct PluginRef
{
    juce::String uid, name, vendor, format, fileOrIdentifier;
    bool isInstrument = false;
    juce::String state; // base64, empty when null
    bool hasState = false;
    int latencyOffset = 0; // samples added to the reported latency (for plugins that misreport it)

    bool sameDescription (const PluginRef& o) const
    {
        return uid == o.uid && format == o.format && fileOrIdentifier == o.fileOrIdentifier && name == o.name;
    }
};

enum class ChannelKind
{
    synth,
    sampler,
    plugin
};

struct ChannelModel
{
    juce::String id;
    ChannelKind kind = ChannelKind::synth;
    float volume = 0.8f, pan = 0.0f;
    bool muted = false;
    int mixerTrack = 0;
    std::array<float, synth::numParams> synthParams {};
    std::array<float, sampler::numParams> samplerParams {};
    juce::String sampleId;
    PluginRef plugin;
};

struct EffectModel
{
    juce::String id, type;
    bool enabled = true;
    std::vector<float> params; // in EffectSpec order (defaults filled in)
    PluginRef plugin;          // type == "plugin"
};

struct InputRoute
{
    int channels = 0; // 0 none, 1 mono, 2 stereo
    int first = 0;    // first device input channel (0-based)

    bool operator== (const InputRoute& o) const { return channels == o.channels && first == o.first; }
};

struct MixerTrackModel
{
    juce::String id, name;
    float volume = 0.8f, pan = 0.0f;
    bool muted = false, solo = false, armed = false;
    InputRoute input;
    std::vector<EffectModel> effects;
    float latencyOffsetMs = 0.0f; // manual PDC offset: > 0 delays this track, < 0 all others
};

struct ProjectModel
{
    double bpm = 130.0, swing = 0.0;
    int beatsPerBar = 4;
    bool pdc = true;           // automatic plugin delay compensation
    bool pdcAutomation = true; // compensate automation (lanes behind latent plugins are read earlier)
    std::vector<ChannelModel> channels;
    std::vector<MixerTrackModel> mixer;

    /** True if mixer track `index` is audible (master is never soloed out). */
    bool trackAudible (size_t index) const;
};

/** Parses the project JSON of project.sync (unknown fields are ignored, missing ones get
    the app's defaults). Never throws. */
ProjectModel parseProject (const juce::var& json);

/** Parses SynthParams JSON (preview.synth) into the flat parameter array. */
std::array<float, synth::numParams> parseSynthParams (const juce::var& json);

PluginRef parsePluginRef (const juce::var& json);

/** "stereo:N" / "mono:N" / null. */
InputRoute parseInputRoute (const juce::var& v);

} // namespace mad
