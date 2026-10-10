#pragma once

#include "engine/Params.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace mad::notes
{

// model/notes.ts: the note properties' effect on the built-in instruments.
inline constexpr double modXOctaves = 4.0;    // MOD_X_OCTAVES
inline constexpr double modYRange = 4.0;      // MOD_Y_RANGE
inline constexpr double maxResonance = 24.0;  // MAX_NOTE_RESONANCE
inline constexpr double panEpsilon = 0.001;   // voice.ts NOTE_PAN_EPSILON

inline double modXFactor (float modX) noexcept { return std::exp2 (((double) modX - 0.5) * 2.0 * modXOctaves); }

inline double resonance (double res, float modY) noexcept
{
    if (! (modY < 0.5f || modY > 0.5f))
        return res;
    return std::min (maxResonance, res * std::pow (modYRange, ((double) modY - 0.5) * 2.0));
}

inline double releaseScale (float release) noexcept { return std::exp2 (((double) release - 0.5) * 2.0); }

/** notes.ts pitchCurve(): portamento glide, then slide bends; piecewise linear in semitones over
    seconds after the note start, holding the last value. */
class PitchCurve
{
public:
    static constexpr int maxPoints = 2 + 2 * maxNoteBends;

    void build (const NoteEvent& e) noexcept
    {
        size = 0;
        const double from = e.props.glideFrom;
        const double time = e.props.glideTime;
        const bool glide = (from < 0.0 || from > 0.0) && time > 0.0;
        if (! glide && e.numBends <= 0)
            return;
        push (0.0, glide ? from : 0.0);
        if (glide)
            push (time, 0.0);
        for (int i = 0; i < std::min (e.numBends, maxNoteBends); ++i)
        {
            const auto& b = e.bends[(size_t) i];
            const double ts = std::max (0.0, (double) b.start);
            const double te = ts + std::max (0.0, (double) b.duration);
            const double v0 = at (ts);
            while (size > 0 && t[(size_t) size - 1] >= ts)
                --size; // a new bend takes over from wherever the pitch is at its start
            push (ts, v0);
            push (te, b.to);
        }
    }

    bool active() const noexcept { return size > 0; }

    /** Semitones at `seconds` after the note start. */
    double at (double seconds) const noexcept
    {
        if (size == 0)
            return 0.0;
        if (seconds <= t[0])
            return v[0];
        for (int i = 1; i < size; ++i)
        {
            if (seconds < t[(size_t) i])
            {
                const double t0 = t[(size_t) i - 1], v0 = v[(size_t) i - 1];
                return v0 + (v[(size_t) i] - v0) * (seconds - t0) / (t[(size_t) i] - t0);
            }
        }
        return v[(size_t) size - 1];
    }

    double minimum() const noexcept
    {
        double m = size > 0 ? v[0] : 0.0;
        for (int i = 1; i < size; ++i)
            m = std::min (m, v[(size_t) i]);
        return m;
    }

private:
    void push (double time, double value) noexcept
    {
        if (size < maxPoints)
        {
            t[(size_t) size] = time;
            v[(size_t) size] = value;
            ++size;
        }
    }

    std::array<double, maxPoints> t {}, v {};
    int size = 0;
};

} // namespace mad::notes
