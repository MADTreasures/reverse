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
            tl.events.push_back (ev);
        }
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
