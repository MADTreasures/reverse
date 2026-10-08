#pragma once

#include <array>
#include <cstdint>
#include <vector>

namespace mad::dsp
{

/** effects.ts makeImpulseResponse(): stereo decaying noise that darkens over time
    (same LCG, one-pole colouring filter and -60 dB at `decay`). */
std::array<std::vector<float>, 2> makeImpulseResponse (double sampleRate, double decay, double damping,
                                                       uint32_t seed = 1);

/** ConvolverNode normalisation (normalize = true), Chromium Reverb::CalculateNormalizationScale:
    10^(-58/20) * (44100 / sampleRate) / max(rms over both channels, 0.000125). */
double convolverNormalisationScale (const std::vector<float>& left, const std::vector<float>& right,
                                    double sampleRate);

} // namespace mad::dsp
