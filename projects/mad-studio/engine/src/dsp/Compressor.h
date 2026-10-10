#pragma once

#include <algorithm>
#include <array>
#include <vector>

namespace mad::dsp
{

/** Port of Chromium's DynamicsCompressorKernel (the DynamicsCompressorNode algorithm):
    6 ms look-ahead, detector on max(|L|, |R|), soft knee, adaptive release and the automatic
    makeup gain (1 / curve(1))^0.6. Parameters are read once per 32-frame division, which this
    class keeps aligned across calls so any block size gives the same result. */
class DynamicsCompressor
{
public:
    struct Params
    {
        float threshold = -24.0f; // dB
        float knee = 30.0f;       // dB
        float ratio = 12.0f;
        float attack = 0.003f;    // s
        float release = 0.25f;    // s
    };

    void prepare (double sampleRate);
    void reset();

    /** Processes stereo audio in place. `paramsForDivision` is called at the start of every
        32-frame division with the frame offset inside this call. With `keyLeft`/`keyRight` the
        detector listens to that signal instead (sidechain). */
    template <typename ParamSource>
    void process (float* left, float* right, int numSamples, ParamSource&& paramsForDivision, const float* keyLeft = nullptr,
                  const float* keyRight = nullptr) noexcept
    {
        int i = 0;
        while (i < numSamples)
        {
            if (divisionRemaining == 0)
            {
                beginDivision (paramsForDivision (i));
                divisionRemaining = divisionFrames;
            }
            const int n = std::min (divisionRemaining, numSamples - i);
            processFrames (left + i, right + i, n, keyLeft != nullptr ? keyLeft + i : nullptr, keyRight != nullptr ? keyRight + i : nullptr);
            divisionRemaining -= n;
            i += n;
        }
    }

    /** Linear makeup gain applied for the current static curve (for tests). */
    float currentMakeupGain() const noexcept { return masterLinearGain; }

private:
    static constexpr int divisionFrames = 32;
    static constexpr int maxPreDelayFrames = 1024;
    static constexpr int maxPreDelayMask = maxPreDelayFrames - 1;

    void beginDivision (const Params& p) noexcept;
    void processFrames (float* left, float* right, int n, const float* keyLeft, const float* keyRight) noexcept;
    void setPreDelayTime (float seconds) noexcept;

    float kneeCurve (float x, float k) const noexcept;
    float saturate (float x, float k) const noexcept;
    float slopeAt (float x, float k) const noexcept;
    float kAtSlope (float desiredSlope) const noexcept;
    float updateStaticCurveParameters (float dbThreshold, float dbKnee, float ratio) noexcept;

    float sampleRate = 48000.0f;
    std::array<std::vector<float>, 2> preDelay { std::vector<float> (maxPreDelayFrames, 0.0f),
                                                 std::vector<float> (maxPreDelayFrames, 0.0f) };
    int preDelayReadIndex = 0, preDelayWriteIndex = 256, lastPreDelayFrames = 256;

    float detectorAverage = 0.0f, compressorGain = 1.0f, maxAttackCompressionDiffDb = -1.0f;

    // Static curve cache (kUninitializedValue = -1 in Chromium).
    float ratioCached = -1.0f, slope = -1.0f, linearThreshold = -1.0f, dbThresholdCached = -1.0f;
    float dbKneeCached = -1.0f, kneeThreshold = -1.0f, kneeThresholdDb = -1.0f, ykneeThresholdDb = -1.0f, kneeK = -1.0f;

    // Per-division state.
    int divisionRemaining = 0;
    float k = 5.0f, masterLinearGain = 1.0f, envelopeRate = 1.0f, scaledDesiredGain = 1.0f, satReleaseFrames = 120.0f;
};

} // namespace mad::dsp

