#include "engine/Timeline.h"

#include "core/Json.h"

#include <algorithm>
#include <cmath>

namespace mad
{

uint32_t ChannelIds::uidFor (const juce::String& id)
{
    const std::lock_guard<std::mutex> lock (mutex);
    auto it = ids.find (id);
    if (it != ids.end())
        return it->second;
    const auto uid = next++;
    ids.emplace (id, uid);
    return uid;
}

size_t Timeline::firstAtOrAfter (double t) const noexcept
{
    const auto it = std::lower_bound (events.begin(), events.end(), t,
                                      [] (const TimelineEvent& e, double v) { return e.tick < v; });
    return (size_t) std::distance (events.begin(), it);
}

void parseNoteProps (const juce::var& e, NoteProps& p)
{
    p.release = (float) std::clamp (json::number (e, "release", 0.5), 0.0, 1.0);
    p.pan = (float) std::clamp (json::number (e, "pan", 0.0), -1.0, 1.0);
    p.fine = (float) std::clamp (json::number (e, "fine", 0.0), -1200.0, 1200.0);
    p.modX = (float) std::clamp (json::number (e, "modX", 0.5), 0.0, 1.0);
    p.modY = (float) std::clamp (json::number (e, "modY", 0.5), 0.0, 1.0);
    p.color = std::clamp (json::integer (e, "color", 0), 0, 15);
    p.glideFrom = (float) std::clamp (json::number (e, "glideFrom", 0.0), -128.0, 128.0);
    p.glideTime = (float) std::clamp (json::number (e, "glideTime", 0.0), 0.0, 60.0);
}

Timeline parseTimeline (const juce::var& v, ChannelIds& ids)
{
    Timeline tl;
    tl.songMode = json::string (v, "mode", "pattern") == "song";
    tl.loopStart = std::max (0.0, json::number (v, "loopStart", 0.0));
    tl.loopEnd = json::number (v, "loopEnd", tl.loopStart + 384.0);
    if (! (tl.loopEnd - tl.loopStart >= 1.0))
        tl.loopEnd = tl.loopStart + 384.0;

    if (const auto* events = json::get (v, "events").getArray())
    {
        tl.events.reserve ((size_t) events->size());
        for (const auto& e : *events)
        {
            const auto channelId = json::string (e, "channelId");
            if (channelId.isEmpty())
                continue;
            TimelineEvent ev;
            ev.tick = json::number (e, "tick", -1.0);
            if (ev.tick < 0.0)
                continue;
            ev.length = std::max (0.0, json::number (e, "length", 24.0));
            ev.channel = ids.uidFor (channelId);
            ev.key = std::clamp (json::integer (e, "key", 60), 0, 127);
            ev.velocity = (float) std::clamp (json::number (e, "velocity", 0.8), 0.0, 1.0);
            ev.sampleOffset = std::max (0.0, json::number (e, "sampleOffset", 0.0));
            ev.audioClip = json::boolean (e, "audioClip", false);
            if (ev.audioClip)
            {
                const auto sample = json::string (e, "sample");
                if (sample.isNotEmpty())
                {
                    auto it = std::find (tl.samples.begin(), tl.samples.end(), sample);
                    if (it == tl.samples.end())
                        it = tl.samples.insert (tl.samples.end(), sample);
                    ev.clip.sample = (int32_t) std::distance (tl.samples.begin(), it);
                }
                ev.clip.gain = (float) std::clamp (json::number (e, "clipGain", 1.0), 0.0, 64.0);
                ev.clip.fadeIn = std::clamp (json::number (e, "fadeIn", 0.0), 0.0, ev.length);
                ev.clip.fadeOut = std::clamp (json::number (e, "fadeOut", 0.0), 0.0, ev.length - ev.clip.fadeIn);
                ev.clip.fadeInTension = (float) std::clamp (json::number (e, "fadeInTension", 0.0), -1.0, 1.0);
                ev.clip.fadeOutTension = (float) std::clamp (json::number (e, "fadeOutTension", 0.0), -1.0, 1.0);
            }
            parseNoteProps (e, ev.props);
            if (const auto* bends = json::get (e, "bends").getArray())
            {
                ev.bendFirst = (uint32_t) tl.bends.size();
                for (const auto& b : *bends)
                {
                    TimelineBend bend;
                    bend.at = std::max (0.0, json::number (b, "at", 0.0));
                    bend.length = std::max (0.0, json::number (b, "length", 0.0));
                    bend.to = (float) std::clamp (json::number (b, "to", 0.0), -128.0, 128.0);
                    tl.bends.push_back (bend);
                }
                ev.bendCount = (uint32_t) tl.bends.size() - ev.bendFirst;
            }
            tl.events.push_back (ev);
        }
    }
    if (const auto* signatures = json::get (v, "signatures").getArray())
    {
        for (const auto& sv : *signatures)
        {
            TimeSignature sig;
            sig.tick = std::max (0.0, json::number (sv, "tick", 0.0));
            sig.numerator = std::clamp (json::integer (sv, "numerator", 4), 1, 16);
            const int den = json::integer (sv, "denominator", 4);
            sig.denominator = den == 2 || den == 8 || den == 16 ? den : 4;
            if (! tl.signatures.empty() && sig.tick <= tl.signatures.back().tick)
                continue; // sorted, one per tick
            tl.signatures.push_back (sig);
        }
        if (! tl.signatures.empty() && tl.signatures.front().tick > 0.0)
            tl.signatures.clear(); // must start at tick 0
    }
    // Events are documented as sorted; keep the renderer's order for equal ticks.
    std::stable_sort (tl.events.begin(), tl.events.end(),
                      [] (const TimelineEvent& a, const TimelineEvent& b) { return a.tick < b.tick; });
    return tl;
}

//==============================================================================
bool AutomationLane::evaluate (double tick, double& value) const noexcept
{
    if (points.empty() || tick < points.front().first)
        return false;

    const auto it = std::upper_bound (points.begin(), points.end(), tick,
                                      [] (double t, const std::pair<double, double>& p) { return t < p.first; });
    if (it == points.end())
    {
        value = points.back().second; // hold after the last point
        return true;
    }
    const auto& b = *it;
    const auto& a = *(it - 1);
    const double span = b.first - a.first;
    value = span > 0.0 ? a.second + (b.second - a.second) * ((tick - a.first) / span) : b.second;
    return true;
}

AutomationData parseAutomation (const juce::var& v)
{
    AutomationData data;
    if (const auto* lanes = json::get (v, "lanes").getArray())
    {
        for (const auto& l : *lanes)
        {
            AutomationLane lane;
            lane.target = json::string (l, "target");
            if (lane.target.isEmpty())
                continue;
            if (const auto* points = json::get (l, "points").getArray())
            {
                for (const auto& p : *points)
                {
                    const auto* pair = p.getArray();
                    if (pair == nullptr || pair->size() < 2)
                        continue;
                    const double t = json::number ((*pair)[0], -1.0);
                    const double y = json::number ((*pair)[1], std::nan (""));
                    if (t >= 0.0 && std::isfinite (y))
                        lane.points.emplace_back (t, y);
                }
            }
            std::stable_sort (lane.points.begin(), lane.points.end(),
                              [] (const auto& a, const auto& b) { return a.first < b.first; });
            if (! lane.points.empty())
                data.lanes.push_back (std::move (lane));
        }
    }
    return data;
}

} // namespace mad
