#pragma once

#include <juce_dsp/juce_dsp.h>

#include <memory>
#include <vector>

namespace mad::dsp
{

/** WaveShaperNode: curve lookup with linear interpolation, clamped to the curve ends
    (index = (N - 1) / 2 * (x + 1)), optionally oversampled 2x or 4x. Stereo, in place. */
class WaveShaper
{
public:
    /** oversampleLog2: 0 = none, 1 = 2x, 2 = 4x. Allocates (call off the audio thread). */
    void prepare (double sampleRate, int maxBlockSize, int oversampleLog2, size_t curveSize);

    /** Mutable curve storage of the size given to prepare(); fill it, then call curveChanged(). */
    std::vector<float>& curveData() noexcept { return curve; }

    void process (float* left, float* right, int numSamples) noexcept;
    void reset() noexcept;

    static float lookup (const float* curve, size_t size, float x) noexcept;

    int latencySamples() const noexcept;

private:
    std::vector<float> curve;
    std::unique_ptr<juce::dsp::Oversampling<float>> oversampler;
};

/** effects.ts driveCurve(): tanh(k x) / tanh(k), k = 1 + drive * 40, 2048 points. */
void fillDriveCurve (std::vector<float>& curve, double drive);

/** effects.ts clipperCurve(): 4096 points over input +-2, linear to 0.85 * ceiling, then tanh
    saturation to `ceiling` (linear gain). */
void fillClipperCurve (std::vector<float>& curve, double ceiling);

} // namespace mad::dsp
