#include "dsp/Oscillator.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>

namespace mad::dsp
{
namespace
{
constexpr double twoPi = 6.28318530717958647692;

/** PolyBLEP residual for an upward step of 2 at phase 0. */
inline double polyBlep (double t, double dt) noexcept
{
    if (t < dt)
    {
        const double x = t / dt;
        return x + x - x * x - 1.0;
    }
    if (t > 1.0 - dt)
    {
        const double x = (t - 1.0) / dt;
        return x * x + x + x + 1.0;
    }
    return 0.0;
}

/** PolyBLAMP residual (in samples) for a unit per-sample slope increase at x = 0. */
inline double polyBlamp (double x) noexcept
{
    const double a = 1.0 - std::abs (x);
    return a > 0.0 ? a * a * a / 6.0 : 0.0;
}

/** Signed phase distance from `corner`, wrapped into [-0.5, 0.5). */
inline double phaseDistance (double t, double corner) noexcept
{
    double d = t - corner;
    if (d >= 0.5)
        d -= 1.0;
    else if (d < -0.5)
        d += 1.0;
    return d;
}
} // namespace

Wave waveFromIndex (int index) noexcept
{
    switch (index)
    {
        case 1:  return Wave::triangle;
        case 2:  return Wave::sawtooth;
        case 3:  return Wave::square;
        case 4:  return Wave::noise;
        default: return Wave::sine;
    }
}

double chromeWaveScale (Wave wave, double sampleRate) noexcept
{
    // 1 / max|x| of Chromium's range-0 PeriodicWave table (partials 1..size/2-1), see
    // PeriodicWaveImpl::CreateBandLimitedTables(); the table size depends on the rate.
    const int table = sampleRate <= 24000.0 ? 0 : (sampleRate <= 88200.0 ? 1 : 2);
    switch (wave)
    {
        case Wave::sawtooth:
        {
            constexpr double s[] = { 0.848894256, 0.848542450, 0.848278825 };
            return s[table];
        }
        case Wave::square:
        {
            constexpr double s[] = { 0.848190764, 0.848190936, 0.848190989 };
            return s[table];
        }
        case Wave::triangle:
        {
            constexpr double s[] = { 1.000395942, 1.000197932, 1.000049476 };
            return s[table];
        }
        case Wave::sine:
        case Wave::noise:
            return 1.0;
    }
    return 1.0;
}

float BlepOscillator::next (Wave wave, double increment) noexcept
{
    const double t = phase;
    const double dt = std::min (std::abs (increment), 0.5);
    double out = 0.0;

    switch (wave)
    {
        case Wave::sine:
            out = std::sin (twoPi * t);
            break;

        case Wave::sawtooth:
        {
            // Rising ramp through 0 at phase 0, jump from +1 to -1 at phase 0.5.
            double p = t + 0.5;
            if (p >= 1.0)
                p -= 1.0;
            out = 2.0 * p - 1.0;
            if (dt > 0.0)
                out -= polyBlep (p, dt);
            break;
        }

        case Wave::square:
        {
            out = t < 0.5 ? 1.0 : -1.0;
            if (dt > 0.0)
            {
                double p = t + 0.5;
                if (p >= 1.0)
                    p -= 1.0;
                out += polyBlep (t, dt) - polyBlep (p, dt);
            }
            break;
        }

        case Wave::triangle:
        {
            if (t < 0.25)
                out = 4.0 * t;
            else if (t < 0.75)
                out = 2.0 - 4.0 * t;
            else
                out = 4.0 * t - 4.0;

            if (dt > 0.0)
            {
                const double d1 = phaseDistance (t, 0.25) / dt;
                const double d2 = phaseDistance (t, 0.75) / dt;
                out += dt * (-8.0 * polyBlamp (d1) + 8.0 * polyBlamp (d2));
            }
            break;
        }

        case Wave::noise:
            break;
    }

    phase += increment;
    phase -= std::floor (phase);
    return (float) out;
}

const std::vector<float>& noiseBuffer (double sampleRate)
{
    static std::mutex mutex;
    static std::map<int64_t, std::unique_ptr<std::vector<float>>> cache;

    const std::lock_guard<std::mutex> lock (mutex);
    const auto key = (int64_t) std::llround (sampleRate * 1000.0);
    auto& slot = cache[key];
    if (slot == nullptr)
    {
        const auto length = (size_t) std::max (1.0, std::floor (sampleRate * 2.0));
        slot = std::make_unique<std::vector<float>> (length);
        uint32_t seed = 1234567u;
        for (size_t i = 0; i < length; ++i)
        {
            seed = seed * 1664525u + 1013904223u;
            (*slot)[i] = (float) (((double) seed / 4294967296.0) * 2.0 - 1.0);
        }
    }
    return *slot;
}

} // namespace mad::dsp
