#pragma once

#include <cstdint>
#include <vector>

namespace mad::dsp
{

enum class Wave
{
    sine,
    triangle,
    sawtooth,
    square,
    noise
};

Wave waveFromIndex (int index) noexcept;

/** Chromium normalises its band-limited OscillatorNode tables to a peak of 1, which scales
    the Gibbs-overshooting saw and square by ~0.848 (computed from the 2047-partial tables). */
double chromeWaveScale (Wave wave, double sampleRate) noexcept;

/** Band-limited oscillator (PolyBLEP for steps, PolyBLAMP for the triangle's corners).
    Phase 0 matches Web Audio's start phase: sine/saw/triangle start at 0 rising, square at +1. */
class BlepOscillator
{
public:
    void reset (double startPhase = 0.0) noexcept { phase = startPhase; }

    /** Returns the sample at the current phase, then advances by `increment` (cycles/sample). */
    float next (Wave wave, double increment) noexcept;

    double getPhase() const noexcept { return phase; }

private:
    double phase = 0.0;
};

/** The synth's 2 s looping noise buffer (synth.ts noiseBuffer(): LCG seed 1234567). */
const std::vector<float>& noiseBuffer (double sampleRate);

} // namespace mad::dsp
