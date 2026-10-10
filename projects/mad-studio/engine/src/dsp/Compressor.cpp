#include "dsp/Compressor.h"

#include <cmath>

namespace mad::dsp
{
namespace
{
constexpr float piOverTwo = 1.57079632679489661923f;

// Chromium audio_utilities.
inline float linearToDecibels (float linear) noexcept { return 20.0f * std::log10 (linear); }
inline float decibelsToLinear (float db) noexcept { return std::pow (10.0f, 0.05f * db); }

// DynamicsCompressor::InitializeParameters() defaults that the node does not expose.
constexpr float preDelaySeconds = 0.006f;
constexpr float releaseZone1 = 0.09f, releaseZone2 = 0.16f, releaseZone3 = 0.42f, releaseZone4 = 0.98f;
constexpr float spacingDb = 5.0f;
} // namespace

void DynamicsCompressor::prepare (double rate)
{
    sampleRate = (float) rate;
    reset();
}

void DynamicsCompressor::reset()
{
    detectorAverage = 0.0f;
    compressorGain = 1.0f;
    for (auto& b : preDelay)
        std::fill (b.begin(), b.end(), 0.0f);
    lastPreDelayFrames = 256;
    preDelayReadIndex = 0;
    preDelayWriteIndex = 256;
    maxAttackCompressionDiffDb = -1.0f;
    divisionRemaining = 0;
}

void DynamicsCompressor::setPreDelayTime (float seconds) noexcept
{
    auto frames = (int) (seconds * sampleRate);
    if (frames > maxPreDelayFrames - 1)
        frames = maxPreDelayFrames - 1;
    if (lastPreDelayFrames != frames)
    {
        lastPreDelayFrames = frames;
        for (auto& b : preDelay)
            std::fill (b.begin(), b.end(), 0.0f);
        preDelayReadIndex = 0;
        preDelayWriteIndex = frames;
    }
}

float DynamicsCompressor::kneeCurve (float x, float kk) const noexcept
{
    if (x < linearThreshold)
        return x;
    return linearThreshold + (1.0f - std::exp (-kk * (x - linearThreshold))) / kk;
}

float DynamicsCompressor::saturate (float x, float kk) const noexcept
{
    if (x < kneeThreshold)
        return kneeCurve (x, kk);
    const float xDb = linearToDecibels (x);
    const float yDb = ykneeThresholdDb + slope * (xDb - kneeThresholdDb);
    return decibelsToLinear (yDb);
}

float DynamicsCompressor::slopeAt (float x, float kk) const noexcept
{
    if (x < linearThreshold)
        return 1.0f;
    const float x2 = x * 1.001f;
    const float xDb = linearToDecibels (x);
    const float x2Db = linearToDecibels (x2);
    const float yDb = linearToDecibels (kneeCurve (x, kk));
    const float y2Db = linearToDecibels (kneeCurve (x2, kk));
    return (y2Db - yDb) / (x2Db - xDb);
}

float DynamicsCompressor::kAtSlope (float desiredSlope) const noexcept
{
    const float xDb = dbThresholdCached + dbKneeCached;
    const float x = decibelsToLinear (xDb);
    float minK = 0.1f, maxK = 10000.0f, kk = 5.0f;
    for (int i = 0; i < 15; ++i)
    {
        const float s = slopeAt (x, kk);
        if (s < desiredSlope)
            maxK = kk;
        else
            minK = kk;
        kk = std::sqrt (minK * maxK);
    }
    return kk;
}

float DynamicsCompressor::updateStaticCurveParameters (float dbThreshold, float dbKnee, float ratio) noexcept
{
    const auto differs = [] (float a, float b) { return a < b || b < a; };
    if (differs (dbThreshold, dbThresholdCached) || differs (dbKnee, dbKneeCached) || differs (ratio, ratioCached))
    {
        dbThresholdCached = dbThreshold;
        linearThreshold = decibelsToLinear (dbThreshold);
        dbKneeCached = dbKnee;
        ratioCached = ratio;
        slope = 1.0f / ratio;
        const float kk = kAtSlope (1.0f / ratio);
        kneeThresholdDb = dbThreshold + dbKnee;
        kneeThreshold = decibelsToLinear (kneeThresholdDb);
        ykneeThresholdDb = linearToDecibels (kneeCurve (kneeThreshold, kk));
        kneeK = kk;
    }
    return kneeK;
}

void DynamicsCompressor::beginDivision (const Params& p) noexcept
{
    // AudioParam nominal ranges of DynamicsCompressorNode.
    const float threshold = std::clamp (p.threshold, -100.0f, 0.0f);
    const float knee = std::clamp (p.knee, 0.0f, 40.0f);
    const float ratio = std::clamp (p.ratio, 1.0f, 20.0f);
    const float attackTime = std::max (0.001f, std::clamp (p.attack, 0.0f, 1.0f));
    const float releaseTime = std::clamp (p.release, 0.0f, 1.0f);

    k = updateStaticCurveParameters (threshold, knee, ratio);

    // Makeup gain with Chromium's empirical/perceptual tuning.
    const float fullRangeGain = saturate (1.0f, k);
    const float fullRangeMakeupGain = std::pow (1.0f / fullRangeGain, 0.6f);
    masterLinearGain = decibelsToLinear (0.0f) * fullRangeMakeupGain;

    const float attackFrames = attackTime * sampleRate;
    const float releaseFrames = sampleRate * releaseTime;
    satReleaseFrames = 0.0025f * sampleRate;

    const float y1 = releaseFrames * releaseZone1;
    const float y2 = releaseFrames * releaseZone2;
    const float y3 = releaseFrames * releaseZone3;
    const float y4 = releaseFrames * releaseZone4;
    const float kA = 0.9999999999999998f * y1 + 1.8432219684323923e-16f * y2 - 1.9373394351676423e-16f * y3 + 8.824516011816245e-18f * y4;
    const float kB = -1.5788320352845888f * y1 + 2.3305837032074286f * y2 - 0.9141194204840429f * y3 + 0.1623677525612032f * y4;
    const float kC = 0.5334142869106424f * y1 - 1.272736789213631f * y2 + 0.9258856042207512f * y3 - 0.18656310191776226f * y4;
    const float kD = 0.08783463138207234f * y1 - 0.1694162967925622f * y2 + 0.08588057951595272f * y3 - 0.00429891410546283f * y4;
    const float kE = -0.042416883008123074f * y1 + 0.1115693827987602f * y2 - 0.09764676325265872f * y3 + 0.028494263462021576f * y4;

    setPreDelayTime (preDelaySeconds);

    if (std::isnan (detectorAverage) || std::isinf (detectorAverage))
        detectorAverage = 1.0f;

    const float desiredGain = detectorAverage;
    scaledDesiredGain = std::asin (desiredGain) / piOverTwo;

    const bool isReleasing = scaledDesiredGain > compressorGain;
    float compressionDiffDb = linearToDecibels (compressorGain / scaledDesiredGain);

    if (isReleasing)
    {
        maxAttackCompressionDiffDb = -1.0f;
        if (std::isnan (compressionDiffDb) || std::isinf (compressionDiffDb))
            compressionDiffDb = -1.0f;

        float x = std::clamp (compressionDiffDb, -12.0f, 0.0f);
        x = 0.25f * (x + 12.0f);
        const float x2 = x * x;
        const float x3 = x2 * x;
        const float x4 = x2 * x2;
        const float adaptiveReleaseFrames = kA + kB * x + kC * x2 + kD * x3 + kE * x4;
        const float dbPerFrame = spacingDb / adaptiveReleaseFrames;
        envelopeRate = decibelsToLinear (dbPerFrame);
    }
    else
    {
        if (std::isnan (compressionDiffDb) || std::isinf (compressionDiffDb))
            compressionDiffDb = 1.0f;

        const auto uninitialised = ! (maxAttackCompressionDiffDb < -1.0f || maxAttackCompressionDiffDb > -1.0f);
        if (uninitialised || maxAttackCompressionDiffDb < compressionDiffDb)
            maxAttackCompressionDiffDb = compressionDiffDb;

        const float effAttenDiffDb = std::max (0.5f, maxAttackCompressionDiffDb);
        const float x = 0.25f / effAttenDiffDb;
        envelopeRate = 1.0f - std::pow (x, 1.0f / attackFrames);
    }
}

void DynamicsCompressor::processFrames (float* left, float* right, int n, const float* keyLeft, const float* keyRight) noexcept
{
    float* const delayL = preDelay[0].data();
    float* const delayR = preDelay[1].data();
    int readIndex = preDelayReadIndex;
    int writeIndex = preDelayWriteIndex;
    float detector = detectorAverage;
    float gain = compressorGain;

    for (int i = 0; i < n; ++i)
    {
        const float inL = left[i], inR = right[i];
        delayL[writeIndex] = inL;
        delayR[writeIndex] = inR;
        const float absInput = keyLeft != nullptr && keyRight != nullptr ? std::max (std::abs (keyLeft[i]), std::abs (keyRight[i]))
                                                                         : std::max (std::abs (inL), std::abs (inR));

        const float shapedInput = saturate (absInput, k);
        const float attenuation = absInput <= 0.0001f ? 1.0f : shapedInput / absInput;
        float attenuationDb = -linearToDecibels (attenuation);
        attenuationDb = std::max (2.0f, attenuationDb);
        const float dbPerFrame = attenuationDb / satReleaseFrames;
        const float satReleaseRate = decibelsToLinear (dbPerFrame) - 1.0f;
        const bool isRelease = attenuation > detector;
        const float rate = isRelease ? satReleaseRate : 1.0f;
        detector += (attenuation - detector) * rate;
        detector = std::min (1.0f, detector);
        if (std::isnan (detector) || std::isinf (detector))
            detector = 1.0f;

        if (envelopeRate < 1.0f)
        {
            gain += (scaledDesiredGain - gain) * envelopeRate;
        }
        else
        {
            gain *= envelopeRate;
            gain = std::min (1.0f, gain);
        }

        const float postWarpCompressorGain = std::sin (piOverTwo * gain);
        const float totalGain = masterLinearGain * postWarpCompressorGain;

        left[i] = delayL[readIndex] * totalGain;
        right[i] = delayR[readIndex] * totalGain;

        readIndex = (readIndex + 1) & maxPreDelayMask;
        writeIndex = (writeIndex + 1) & maxPreDelayMask;
    }

    preDelayReadIndex = readIndex;
    preDelayWriteIndex = writeIndex;
    detectorAverage = std::abs (detector) < 1.0e-30f ? 0.0f : detector;
    compressorGain = std::abs (gain) < 1.0e-30f ? 0.0f : gain;
}

} // namespace mad::dsp
