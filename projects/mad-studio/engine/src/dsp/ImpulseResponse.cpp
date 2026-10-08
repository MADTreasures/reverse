#include "dsp/ImpulseResponse.h"

#include <algorithm>
#include <cmath>

namespace mad::dsp
{

std::array<std::vector<float>, 2> makeImpulseResponse (double sampleRate, double decay, double damping, uint32_t seed)
{
    // Keep the exact operation order of the TypeScript version so the output is identical.
    const auto length = (size_t) std::max (1.0, std::floor (sampleRate * std::min (12.0, decay * 1.15)));
    std::array<std::vector<float>, 2> channels { std::vector<float> (length), std::vector<float> (length) };

    uint32_t s = seed;
    const auto rand = [&s]
    {
        s = s * 1664525u + 1013904223u;
        return ((double) s / 4294967296.0) * 2.0 - 1.0;
    };

    constexpr double pi = 3.14159265358979323846;
    const double startCut = 18000.0;
    const double endCut = startCut * (1.0 - damping) + 700.0 * damping;

    for (auto& data : channels)
    {
        double y = 0.0;
        for (size_t i = 0; i < length; ++i)
        {
            const double t = (double) i / sampleRate;
            const double progress = (double) i / (double) length;
            const double fc = startCut * std::pow (endCut / startCut, progress);
            const double a = 1.0 - std::exp ((-2.0 * pi * fc) / sampleRate);
            y += a * (rand() - y);
            data[i] = (float) (y * std::exp ((-6.9 * t) / decay));
        }
    }
    return channels;
}

double convolverNormalisationScale (const std::vector<float>& left, const std::vector<float>& right, double sampleRate)
{
    double power = 0.0;
    size_t count = 0;
    for (const auto* ch : { &left, &right })
    {
        for (const float v : *ch)
            power += (double) v * (double) v;
        count += ch->size();
    }
    power = count > 0 ? std::sqrt (power / (double) count) : 0.0;
    if (! std::isfinite (power) || power < 0.000125)
        power = 0.000125;

    double scale = 1.0 / power;
    scale *= std::pow (10.0, -58.0 / 20.0);
    if (sampleRate > 0.0)
        scale *= 44100.0 / sampleRate;
    return scale;
}

} // namespace mad::dsp
