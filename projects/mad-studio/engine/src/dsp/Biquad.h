#pragma once

namespace mad::dsp
{

enum class BiquadType
{
    lowpass,
    highpass,
    bandpass,
    notch,
    peaking,
    lowshelf,
    highshelf
};

/** Normalised coefficients (a0 = 1). */
struct BiquadCoeffs
{
    double b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0;
};

/** BiquadFilterNode coefficients exactly as Chromium computes them (Audio EQ Cookbook with
    Web Audio conventions): computed frequency = frequency * 2^(detune / 1200), frequency is
    clamped to [0, nyquist] first; lowpass/highpass take Q in dB; shelves use S = 1. */
BiquadCoeffs makeBiquad (BiquadType type, double sampleRate, double frequency, double q, double gainDb,
                         double detuneCents = 0.0) noexcept;

/** Direct form I with double precision state (as Chromium's Biquad::Process). */
class BiquadState
{
public:
    float process (const BiquadCoeffs& c, float input) noexcept
    {
        const double x = input;
        const double y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        return (float) y;
    }

    void reset() noexcept { x1 = x2 = y1 = y2 = 0.0; }

    /** Flushes denormal-range state; call once per block. */
    void flushDenormals() noexcept
    {
        constexpr double tiny = 1.0e-30;
        if (x1 < tiny && x1 > -tiny) x1 = 0.0;
        if (x2 < tiny && x2 > -tiny) x2 = 0.0;
        if (y1 < tiny && y1 > -tiny) y1 = 0.0;
        if (y2 < tiny && y2 > -tiny) y2 = 0.0;
    }

private:
    double x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0;
};

/** 0 lowpass, 1 highpass, 2 bandpass, 3 notch, 4 peaking, 5 lowshelf, 6 highshelf. */
BiquadType biquadTypeFromIndex (int filterTypeIndex) noexcept;

} // namespace mad::dsp
