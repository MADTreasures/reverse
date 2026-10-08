#include "dsp/WaveShaper.h"

#include <cmath>

namespace mad::dsp
{

void WaveShaper::prepare (double sampleRate, int maxBlockSize, int oversampleLog2, size_t curveSize)
{
    juce::ignoreUnused (sampleRate);
    curve.assign (curveSize, 0.0f);
    oversampler.reset();
    if (oversampleLog2 > 0)
    {
        oversampler = std::make_unique<juce::dsp::Oversampling<float>> (
            2, (size_t) oversampleLog2, juce::dsp::Oversampling<float>::filterHalfBandFIREquiripple, true, true);
        oversampler->initProcessing ((size_t) maxBlockSize);
    }
}

void WaveShaper::reset() noexcept
{
    if (oversampler != nullptr)
        oversampler->reset();
}

int WaveShaper::latencySamples() const noexcept
{
    return oversampler != nullptr ? (int) std::lround (oversampler->getLatencyInSamples()) : 0;
}

float WaveShaper::lookup (const float* c, size_t size, float input) noexcept
{
    if (size == 0)
        return input;
    // Chromium WaveShaperDSPKernel::WaveShaperCurveValue().
    const double virtualIndex = 0.5 * ((double) input + 1.0) * (double) (size - 1);
    if (! (virtualIndex >= 0.0))
        return c[0];
    if (virtualIndex >= (double) (size - 1))
        return c[size - 1];
    const auto index = (size_t) virtualIndex;
    const double frac = virtualIndex - (double) index;
    return (float) ((1.0 - frac) * c[index] + frac * c[index + 1]);
}

void WaveShaper::process (float* left, float* right, int numSamples) noexcept
{
    const float* c = curve.data();
    const size_t size = curve.size();
    if (oversampler == nullptr)
    {
        for (int i = 0; i < numSamples; ++i)
        {
            left[i] = lookup (c, size, left[i]);
            right[i] = lookup (c, size, right[i]);
        }
        return;
    }

    float* channels[] = { left, right };
    juce::dsp::AudioBlock<float> block (channels, 2, (size_t) numSamples);
    auto up = oversampler->processSamplesUp (block);
    for (size_t ch = 0; ch < up.getNumChannels(); ++ch)
    {
        float* d = up.getChannelPointer (ch);
        for (size_t i = 0; i < up.getNumSamples(); ++i)
            d[i] = lookup (c, size, d[i]);
    }
    oversampler->processSamplesDown (block);
}

void fillDriveCurve (std::vector<float>& curve, double drive)
{
    const double k = 1.0 + drive * 40.0;
    const auto n = curve.size();
    const double norm = std::tanh (k);
    for (size_t i = 0; i < n; ++i)
    {
        const double x = ((double) i / (double) (n - 1)) * 2.0 - 1.0;
        curve[i] = (float) (std::tanh (k * x) / norm);
    }
}

void fillClipperCurve (std::vector<float>& curve, double ceiling)
{
    const auto n = curve.size();
    const double knee = ceiling * 0.85;
    for (size_t i = 0; i < n; ++i)
    {
        const double x = ((double) i / (double) (n - 1)) * 4.0 - 2.0;
        const double a = std::abs (x);
        const double y = a <= knee ? a : knee + (ceiling - knee) * std::tanh ((a - knee) / (ceiling - knee));
        const double sign = x > 0.0 ? 1.0 : (x < 0.0 ? -1.0 : 0.0);
        curve[i] = (float) (sign * y);
    }
}

} // namespace mad::dsp
