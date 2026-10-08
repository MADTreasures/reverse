#include "engine/ProjectModel.h"

#include "core/Json.h"

namespace mad
{
namespace
{
float num (const juce::var& obj, const char* key, float fallback)
{
    return (float) json::number (obj, key, (double) fallback);
}

int waveIndex (const juce::String& w)
{
    if (w == "triangle") return 1;
    if (w == "sawtooth") return 2;
    if (w == "square")   return 3;
    if (w == "noise")    return 4;
    return 0;
}

int filterTypeIndex (const juce::String& t)
{
    if (t == "highpass") return 1;
    if (t == "bandpass") return 2;
    if (t == "notch")    return 3;
    return 0;
}

int lfoTargetIndex (const juce::String& t)
{
    if (t == "pitch")  return 1;
    if (t == "filter") return 2;
    if (t == "amp")    return 3;
    return 0;
}

void parseEnvelope (const juce::var& env, float* out, const float* defaults)
{
    out[0] = num (env, "attack", defaults[0]);
    out[1] = num (env, "decay", defaults[1]);
    out[2] = num (env, "sustain", defaults[2]);
    out[3] = num (env, "release", defaults[3]);
}

std::array<float, sampler::numParams> parseSampler (const juce::var& s, juce::String& sampleId)
{
    std::array<float, sampler::numParams> p {};
    for (int i = 0; i < sampler::numParams; ++i)
        p[(size_t) i] = sampler::defaultValue (i);

    sampleId = json::string (s, "sampleId");
    p[sampler::gain] = num (s, "gain", p[sampler::gain]);
    p[sampler::rootKey] = num (s, "rootKey", p[sampler::rootKey]);
    p[sampler::fine] = num (s, "fine", p[sampler::fine]);
    p[sampler::keyTrack] = json::boolean (s, "keyTrack", true) ? 1.0f : 0.0f;
    p[sampler::reverse] = json::boolean (s, "reverse", false) ? 1.0f : 0.0f;
    p[sampler::oneShot] = json::boolean (s, "oneShot", true) ? 1.0f : 0.0f;
    p[sampler::loop] = json::boolean (s, "loop", false) ? 1.0f : 0.0f;
    p[sampler::start] = num (s, "start", 0.0f);
    p[sampler::chokeGroup] = num (s, "chokeGroup", 0.0f);
    p[sampler::cutSelf] = json::boolean (s, "cutSelf", false) ? 1.0f : 0.0f;
    const float envDefaults[] = { 0.001f, 0.3f, 1.0f, 0.08f };
    parseEnvelope (json::get (s, "ampEnv"), p.data() + sampler::ampAttack, envDefaults);
    return p;
}
} // namespace

std::array<float, synth::numParams> parseSynthParams (const juce::var& s)
{
    std::array<float, synth::numParams> p {};
    for (int i = 0; i < synth::numParams; ++i)
        p[(size_t) i] = synth::defaultValue (i);

    p[synth::gain] = num (s, "gain", p[synth::gain]);

    const auto filter = json::get (s, "filter");
    p[synth::filterEnabled] = json::boolean (filter, "enabled", true) ? 1.0f : 0.0f;
    p[synth::filterType] = (float) filterTypeIndex (json::string (filter, "type", "lowpass"));
    p[synth::cutoff] = num (filter, "cutoff", p[synth::cutoff]);
    p[synth::resonance] = num (filter, "resonance", p[synth::resonance]);
    p[synth::envAmount] = num (filter, "envAmount", p[synth::envAmount]);
    p[synth::keyTrack] = num (filter, "keyTrack", p[synth::keyTrack]);

    const float ampDefaults[] = { 0.005f, 0.3f, 0.75f, 0.25f };
    const float filterDefaults[] = { 0.005f, 0.5f, 0.35f, 0.3f };
    parseEnvelope (json::get (s, "ampEnv"), p.data() + synth::ampAttack, ampDefaults);
    parseEnvelope (json::get (s, "filterEnv"), p.data() + synth::filterAttack, filterDefaults);

    const auto lfo = json::get (s, "lfo");
    p[synth::lfoTarget] = (float) lfoTargetIndex (json::string (lfo, "target", "off"));
    p[synth::lfoRate] = num (lfo, "rate", p[synth::lfoRate]);
    p[synth::lfoDepth] = num (lfo, "depth", p[synth::lfoDepth]);

    const auto oscs = json::get (s, "osc");
    for (int o = 0; o < 3; ++o)
    {
        const juce::var osc = oscs.isArray() && o < oscs.size() ? oscs[o] : juce::var();
        const auto at = [o] (synth::OscField f) { return (size_t) synth::osc (o, f); };
        if (osc.isObject())
            p[at (synth::wave)] = (float) waveIndex (json::string (osc, "wave", "sawtooth"));
        p[at (synth::level)] = num (osc, "level", osc.isObject() ? 0.0f : p[at (synth::level)]);
        p[at (synth::coarse)] = num (osc, "coarse", osc.isObject() ? 0.0f : p[at (synth::coarse)]);
        p[at (synth::fine)] = num (osc, "fine", 0.0f);
        p[at (synth::unison)] = num (osc, "unison", 1.0f);
        p[at (synth::detune)] = num (osc, "detune", 0.0f);
        p[at (synth::pan)] = num (osc, "pan", 0.0f);
    }
    return p;
}

PluginRef parsePluginRef (const juce::var& v)
{
    PluginRef r;
    r.uid = json::string (v, "uid");
    r.name = json::string (v, "name");
    r.vendor = json::string (v, "vendor");
    r.format = json::string (v, "format");
    r.fileOrIdentifier = json::string (v, "fileOrIdentifier");
    r.isInstrument = json::boolean (v, "isInstrument", false);
    const auto state = json::get (v, "state");
    r.hasState = state.isString() && state.toString().isNotEmpty();
    r.state = r.hasState ? state.toString() : juce::String();
    r.latencyOffset = std::clamp (json::integer (v, "latencyOffset", 0), -(1 << 19), 1 << 19);
    return r;
}

InputRoute parseInputRoute (const juce::var& v)
{
    InputRoute r;
    if (! v.isString())
        return r;
    const auto s = v.toString().trim();
    const auto parseIndex = [] (const juce::String& n) { return n.containsOnly ("0123456789") && n.isNotEmpty() ? n.getIntValue() : -1; };
    if (s.startsWith ("stereo:"))
    {
        const int i = parseIndex (s.fromFirstOccurrenceOf (":", false, false));
        if (i >= 0)
            r = { 2, i };
    }
    else if (s.startsWith ("mono:"))
    {
        const int i = parseIndex (s.fromFirstOccurrenceOf (":", false, false));
        if (i >= 0)
            r = { 1, i };
    }
    return r;
}

bool ProjectModel::trackAudible (size_t index) const
{
    if (index == 0)
        return true;
    bool anySolo = false;
    for (size_t i = 1; i < mixer.size(); ++i)
        anySolo = anySolo || mixer[i].solo;
    return ! anySolo || (index < mixer.size() && mixer[index].solo);
}

ProjectModel parseProject (const juce::var& json)
{
    ProjectModel m;
    m.bpm = std::clamp (json::number (json, "bpm", 130.0), 10.0, 522.0);
    m.beatsPerBar = std::clamp (json::integer (json, "beatsPerBar", 4), 1, 64);
    m.swing = std::clamp (json::number (json, "swing", 0.0), 0.0, 1.0);
    m.pdc = json::boolean (json, "pdc", true);

    if (const auto* channels = json::get (json, "channels").getArray())
    {
        for (const auto& c : *channels)
        {
            const auto kind = json::string (c, "kind");
            ChannelModel ch;
            ch.id = json::string (c, "id");
            if (ch.id.isEmpty())
                continue;
            if (kind == "synth")
                ch.kind = ChannelKind::synth;
            else if (kind == "sampler")
                ch.kind = ChannelKind::sampler;
            else if (kind == "plugin")
                ch.kind = ChannelKind::plugin;
            else
                continue; // automation channels and unknown kinds produce no audio

            ch.volume = num (c, "volume", 0.8f);
            ch.pan = num (c, "pan", 0.0f);
            ch.muted = json::boolean (c, "muted", false);
            ch.mixerTrack = json::integer (c, "mixerTrack", 0);
            switch (ch.kind)
            {
                case ChannelKind::synth:   ch.synthParams = parseSynthParams (json::get (c, "synth")); break;
                case ChannelKind::sampler: ch.samplerParams = parseSampler (json::get (c, "sampler"), ch.sampleId); break;
                case ChannelKind::plugin:  ch.plugin = parsePluginRef (json::get (c, "plugin")); ch.plugin.isInstrument = true; break;
            }
            m.channels.push_back (std::move (ch));
        }
    }

    if (const auto* mixer = json::get (json, "mixer").getArray())
    {
        for (const auto& t : *mixer)
        {
            MixerTrackModel tr;
            tr.id = json::string (t, "id");
            tr.name = json::string (t, "name", m.mixer.empty() ? "Master" : "Insert " + juce::String ((int) m.mixer.size()));
            tr.volume = num (t, "volume", 0.8f);
            tr.pan = num (t, "pan", 0.0f);
            tr.muted = json::boolean (t, "muted", false);
            tr.solo = json::boolean (t, "solo", false);
            tr.armed = json::boolean (t, "armed", false);
            tr.input = parseInputRoute (json::get (t, "input"));
            tr.latencyOffsetMs = (float) std::clamp (json::number (t, "latencyOffset", 0.0), -1000.0, 1000.0);

            if (const auto* effects = json::get (t, "effects").getArray())
            {
                for (const auto& e : *effects)
                {
                    EffectModel fx;
                    fx.id = json::string (e, "id");
                    fx.type = json::string (e, "type");
                    fx.enabled = json::boolean (e, "enabled", true);
                    if (fx.id.isEmpty())
                        continue;
                    if (fx.type == "plugin")
                    {
                        fx.plugin = parsePluginRef (json::get (e, "plugin"));
                    }
                    else if (const auto* spec = findEffectSpec (fx.type))
                    {
                        const auto params = json::get (e, "params");
                        for (const auto& ps : spec->params)
                            fx.params.push_back (num (params, ps.key, ps.def));
                    }
                    else
                    {
                        continue;
                    }
                    tr.effects.push_back (std::move (fx));
                }
            }
            m.mixer.push_back (std::move (tr));
            if ((int) m.mixer.size() >= maxMixerTracks)
                break;
        }
    }

    if (m.mixer.empty())
    {
        MixerTrackModel master;
        master.id = "mx_master";
        master.name = "Master";
        m.mixer.push_back (master);
    }
    return m;
}

} // namespace mad
