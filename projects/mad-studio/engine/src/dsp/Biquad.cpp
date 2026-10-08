#include "dsp/Biquad.h"

#include <algorithm>
#include <cmath>

namespace mad::dsp
{
namespace
{
constexpr double pi = 3.14159265358979323846;

BiquadCoeffs normalise (double b0, double b1, double b2, double a0, double a1, double a2) noexcept
{
    const double inv = 1.0 / a0;
    return { b0 * inv, b1 * inv, b2 * inv, a1 * inv, a2 * inv };
}

BiquadCoeffs constant (double gain) noexcept { return { gain, 0.0, 0.0, 0.0, 0.0 }; }

// The following mirror Chromium's Biquad::Set*Params (third_party/blink/.../biquad.cc),
// including their special cases at frequency 0 / nyquist and Q = 0.

BiquadCoeffs lowpass (double cutoff, double resonanceDb) noexcept
{
    cutoff = std::clamp (cutoff, 0.0, 1.0);
    if (cutoff >= 1.0)
        return constant (1.0);
    if (cutoff <= 0.0)
        return constant (0.0);

    const double g = std::pow (10.0, -0.05 * resonanceDb);
    const double w0 = pi * cutoff;
    const double cosw = std::cos (w0);
    const double alpha = 0.5 * std::sin (w0) * g;
    const double b1 = 1.0 - cosw;
    const double b0 = 0.5 * b1;
    return normalise (b0, b1, b0, 1.0 + alpha, -2.0 * cosw, 1.0 - alpha);
}

BiquadCoeffs highpass (double cutoff, double resonanceDb) noexcept
{
    cutoff = std::clamp (cutoff, 0.0, 1.0);
    if (cutoff >= 1.0)
        return constant (0.0);
    if (cutoff <= 0.0)
        return constant (1.0);

    const double g = std::pow (10.0, -0.05 * resonanceDb);
    const double w0 = pi * cutoff;
    const double cosw = std::cos (w0);
    const double alpha = 0.5 * std::sin (w0) * g;
    const double b1 = -1.0 - cosw;
    const double b0 = -0.5 * b1;
    return normalise (b0, b1, b0, 1.0 + alpha, -2.0 * cosw, 1.0 - alpha);
}

BiquadCoeffs bandpass (double frequency, double q) noexcept
{
    frequency = std::max (0.0, frequency);
    q = std::max (0.0, q);
    if (frequency > 0.0 && frequency < 1.0)
    {
        if (q <= 0.0)
            return constant (1.0);
        const double w0 = pi * frequency;
        const double alpha = std::sin (w0) / (2.0 * q);
        const double k = std::cos (w0);
        return normalise (alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * k, 1.0 - alpha);
    }
    return constant (0.0);
}

BiquadCoeffs notch (double frequency, double q) noexcept
{
    frequency = std::clamp (frequency, 0.0, 1.0);
    q = std::max (0.0, q);
    if (frequency > 0.0 && frequency < 1.0)
    {
        if (q <= 0.0)
            return constant (0.0);
        const double w0 = pi * frequency;
        const double alpha = std::sin (w0) / (2.0 * q);
        const double k = std::cos (w0);
        return normalise (1.0, -2.0 * k, 1.0, 1.0 + alpha, -2.0 * k, 1.0 - alpha);
    }
    return constant (1.0);
}

BiquadCoeffs peaking (double frequency, double q, double gainDb) noexcept
{
    frequency = std::clamp (frequency, 0.0, 1.0);
    q = std::max (0.0, q);
    const double a = std::pow (10.0, gainDb / 40.0);
    if (frequency > 0.0 && frequency < 1.0)
    {
        if (q <= 0.0)
            return constant (a * a);
        const double w0 = pi * frequency;
        const double alpha = std::sin (w0) / (2.0 * q);
        const double k = std::cos (w0);
        return normalise (1.0 + alpha * a, -2.0 * k, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * k, 1.0 - alpha / a);
    }
    return constant (1.0);
}

BiquadCoeffs lowshelf (double frequency, double gainDb) noexcept
{
    frequency = std::clamp (frequency, 0.0, 1.0);
    const double a = std::pow (10.0, gainDb / 40.0);
    if (frequency >= 1.0)
        return constant (a * a);
    if (frequency <= 0.0)
        return constant (1.0);

    const double w0 = pi * frequency;
    const double s = 1.0;
    const double alpha = 0.5 * std::sin (w0) * std::sqrt ((a + 1.0 / a) * (1.0 / s - 1.0) + 2.0);
    const double k = std::cos (w0);
    const double k2 = 2.0 * std::sqrt (a) * alpha;
    const double ap = a + 1.0, am = a - 1.0;
    return normalise (a * (ap - am * k + k2), 2.0 * a * (am - ap * k), a * (ap - am * k - k2),
                      ap + am * k + k2, -2.0 * (am + ap * k), ap + am * k - k2);
}

BiquadCoeffs highshelf (double frequency, double gainDb) noexcept
{
    frequency = std::clamp (frequency, 0.0, 1.0);
    const double a = std::pow (10.0, gainDb / 40.0);
    if (frequency >= 1.0)
        return constant (1.0);
    if (frequency <= 0.0)
        return constant (a * a);

    const double w0 = pi * frequency;
    const double s = 1.0;
    const double alpha = 0.5 * std::sin (w0) * std::sqrt ((a + 1.0 / a) * (1.0 / s - 1.0) + 2.0);
    const double k = std::cos (w0);
    const double k2 = 2.0 * std::sqrt (a) * alpha;
    const double ap = a + 1.0, am = a - 1.0;
    return normalise (a * (ap + am * k + k2), -2.0 * a * (am + ap * k), a * (ap + am * k - k2),
                      ap - am * k + k2, 2.0 * (am - ap * k), ap - am * k - k2);
}
} // namespace

BiquadCoeffs makeBiquad (BiquadType type, double sampleRate, double frequency, double q, double gainDb,
                         double detuneCents) noexcept
{
    const double nyquist = 0.5 * sampleRate;
    // AudioParam nominal range of `frequency` is [0, nyquist]; detune is applied afterwards.
    double normalised = std::clamp (frequency, 0.0, nyquist) / nyquist;
    if (detuneCents < 0.0 || detuneCents > 0.0)
        normalised *= std::exp2 (std::clamp (detuneCents, -153600.0, 153600.0) / 1200.0);
    if (! std::isfinite (normalised))
        normalised = 1.0;
    if (! std::isfinite (q))
        q = 1.0;
    if (! std::isfinite (gainDb))
        gainDb = 0.0;

    switch (type)
    {
        case BiquadType::lowpass:   return lowpass (normalised, q);
        case BiquadType::highpass:  return highpass (normalised, q);
        case BiquadType::bandpass:  return bandpass (normalised, q);
        case BiquadType::notch:     return notch (normalised, q);
        case BiquadType::peaking:   return peaking (normalised, q, gainDb);
        case BiquadType::lowshelf:  return lowshelf (normalised, gainDb);
        case BiquadType::highshelf: return highshelf (normalised, gainDb);
    }
    return constant (1.0);
}

BiquadType biquadTypeFromIndex (int index) noexcept
{
    switch (index)
    {
        case 1:  return BiquadType::highpass;
        case 2:  return BiquadType::bandpass;
        case 3:  return BiquadType::notch;
        case 4:  return BiquadType::peaking;
        case 5:  return BiquadType::lowshelf;
        case 6:  return BiquadType::highshelf;
        default: return BiquadType::lowpass;
    }
}

} // namespace mad::dsp
