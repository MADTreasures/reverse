#include "engine/Params.h"

namespace mad
{
namespace synth
{
int indexForPath (const juce::String& path)
{
    static const std::pair<const char*, int> fixed[] = {
        { "gain", gain },
        { "filter.enabled", filterEnabled },
        { "filter.type", filterType },
        { "filter.cutoff", cutoff },
        { "filter.resonance", resonance },
        { "filter.envAmount", envAmount },
        { "filter.keyTrack", keyTrack },
        { "ampEnv.attack", ampAttack },
        { "ampEnv.decay", ampDecay },
        { "ampEnv.sustain", ampSustain },
        { "ampEnv.release", ampRelease },
        { "filterEnv.attack", filterAttack },
        { "filterEnv.decay", filterDecay },
        { "filterEnv.sustain", filterSustain },
        { "filterEnv.release", filterRelease },
        { "lfo.target", lfoTarget },
        { "lfo.rate", lfoRate },
        { "lfo.depth", lfoDepth },
    };
    for (const auto& [name, index] : fixed)
        if (path == name)
            return index;

    if (path.startsWith ("osc."))
    {
        const auto rest = path.substring (4);
        const int dot = rest.indexOfChar ('.');
        if (dot <= 0)
            return -1;
        const int o = rest.substring (0, dot).getIntValue();
        if (o < 0 || o > 2 || ! rest.substring (0, dot).containsOnly ("0123456789"))
            return -1;
        static const char* fields[] = { "wave", "level", "coarse", "fine", "unison", "detune", "pan" };
        const auto field = rest.substring (dot + 1);
        for (int f = 0; f < (int) oscStride; ++f)
            if (field == fields[f])
                return osc (o, (OscField) f);
    }
    return -1;
}

float defaultValue (int index)
{
    // presets.ts defaultSynthParams()
    switch (index)
    {
        case gain:          return 0.5f;
        case filterEnabled: return 1.0f;
        case filterType:    return 0.0f;
        case cutoff:        return 3200.0f;
        case resonance:     return 1.0f;
        case envAmount:     return 0.25f;
        case keyTrack:      return 0.3f;
        case ampAttack:     return 0.005f;
        case ampDecay:      return 0.3f;
        case ampSustain:    return 0.75f;
        case ampRelease:    return 0.25f;
        case filterAttack:  return 0.005f;
        case filterDecay:   return 0.5f;
        case filterSustain: return 0.35f;
        case filterRelease: return 0.3f;
        case lfoTarget:     return 0.0f;
        case lfoRate:       return 5.0f;
        case lfoDepth:      return 0.2f;
        default: break;
    }
    if (index >= oscBase && index < numParams)
    {
        const int o = (index - oscBase) / oscStride;
        const int f = (index - oscBase) % oscStride;
        switch (f)
        {
            case wave:   return o == 0 ? 2.0f : (o == 1 ? 3.0f : 0.0f);
            case level:  return o == 0 ? 0.7f : (o == 1 ? 0.35f : 0.0f);
            case coarse: return o == 1 ? -12.0f : 0.0f;
            case unison: return 1.0f;
            default:     return 0.0f;
        }
    }
    return 0.0f;
}
} // namespace synth

namespace sampler
{
int indexForPath (const juce::String& path)
{
    static const std::pair<const char*, int> names[] = {
        { "gain", gain },
        { "rootKey", rootKey },
        { "fine", fine },
        { "keyTrack", keyTrack },
        { "reverse", reverse },
        { "oneShot", oneShot },
        { "loop", loop },
        { "start", start },
        { "ampEnv.attack", ampAttack },
        { "ampEnv.decay", ampDecay },
        { "ampEnv.sustain", ampSustain },
        { "ampEnv.release", ampRelease },
        { "chokeGroup", chokeGroup },
        { "cutSelf", cutSelf },
    };
    for (const auto& [name, index] : names)
        if (path == name)
            return index;
    return -1;
}

float defaultValue (int index)
{
    // defaults.ts defaultSamplerParams()
    switch (index)
    {
        case gain:       return 0.8f;
        case rootKey:    return 60.0f;
        case keyTrack:   return 1.0f;
        case oneShot:    return 1.0f;
        case ampAttack:  return 0.001f;
        case ampDecay:   return 0.3f;
        case ampSustain: return 1.0f;
        case ampRelease: return 0.08f;
        default:         return 0.0f;
    }
}
} // namespace sampler

//==============================================================================
int EffectSpec::indexOf (const juce::String& key) const
{
    for (size_t i = 0; i < params.size(); ++i)
        if (key == params[i].key)
            return (int) i;
    return -1;
}

const EffectSpec* findEffectSpec (const juce::String& type)
{
    static const std::vector<EffectSpec> specs {
        { "eq", { { "lowGain", -18, 18, 0 }, { "lowFreq", 30, 1000, 120 }, { "midGain", -18, 18, 0 },
                  { "midFreq", 150, 8000, 1000 }, { "midQ", 0.2f, 8, 0.9f }, { "highGain", -18, 18, 0 },
                  { "highFreq", 1500, 16000, 6000 } } },
        { "filter", { { "mode", 0, 3, 0 }, { "cutoff", 20, 20000, 4000 }, { "resonance", 0.1f, 18, 1 },
                      { "lfoRate", 0.05f, 20, 1 }, { "lfoDepth", 0, 1, 0 } } },
        { "compressor", { { "threshold", -60, 0, -18 }, { "ratio", 1, 20, 4 }, { "attack", 0.0005f, 0.3f, 0.01f },
                          { "release", 0.02f, 1.5f, 0.2f }, { "knee", 0, 30, 6 }, { "makeup", 0, 24, 0 } } },
        { "distortion", { { "drive", 0, 1, 0.4f }, { "tone", 500, 16000, 8000 }, { "output", -24, 6, -3 },
                          { "mix", 0, 1, 1 } } },
        { "chorus", { { "rate", 0.05f, 8, 0.8f }, { "depth", 0, 1, 0.5f }, { "delay", 2, 30, 12 }, { "mix", 0, 1, 0.5f } } },
        { "delay", { { "time", 0, 10, 5 }, { "feedback", 0, 0.95f, 0.4f }, { "tone", 500, 16000, 5000 },
                     { "pingPong", 0, 1, 1 }, { "mix", 0, 1, 0.3f } } },
        { "reverb", { { "decay", 0.3f, 10, 2.2f }, { "predelay", 0, 0.2f, 0.02f }, { "damping", 0, 1, 0.5f },
                      { "lowCut", 20, 1000, 150 }, { "mix", 0, 1, 0.25f } } },
        { "limiter", { { "gain", 0, 18, 0 }, { "ceiling", -12, 0, -0.5f }, { "release", 0.01f, 1, 0.1f } } },
    };
    for (const auto& s : specs)
        if (type == s.type)
            return &s;
    return nullptr;
}

} // namespace mad
