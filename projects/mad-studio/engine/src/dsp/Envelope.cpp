#include "dsp/Envelope.h"

#include <algorithm>
#include <cmath>

namespace mad::dsp
{

double envelopeValue (const EnvelopeParams& env, double base, double peak, double x) noexcept
{
    const double a = std::max (env.attack, minAttack);
    if (x <= 0.0)
        return base;
    if (x < a)
        return base + (peak - base) * (x / a);
    const double sustain = base + (peak - base) * env.sustain;
    const double tau = std::max (env.decay, 0.001) / 4.0;
    return sustain + (peak - sustain) * std::exp (-(x - a) / tau);
}

void EnvelopeGenerator::start (const EnvelopeParams& p, double baseValue, double peakValue, double sampleRate,
                               double firstSampleTime, double minimumAttack) noexcept
{
    params = p;
    base = baseValue;
    peak = peakValue;
    attack = std::max (p.attack, minimumAttack);
    sustainLevel = base + (peak - base) * p.sustain;
    decayTau = std::max (p.decay, 0.001) / 4.0;
    relTau = std::max (p.release, minRelease) / 5.0;
    dt = 1.0 / sampleRate;
    decayFactor = std::exp (-dt / decayTau);
    releaseFactor = std::exp (-dt / relTau);
    killFactor = std::exp (-dt / killTau);
    now = firstSampleTime;
    relTime = infinity;
    killT = infinity;
    stage = Stage::attack;
    value = base;
}

double EnvelopeGenerator::releaseAt (double t) noexcept
{
    if (relTime < infinity)
        return relTime + 1.2 * std::max (params.release, minRelease);
    relTime = std::max (0.0, t);
    // scheduleRelease() starts from envelopeValue(duration) (also for notes shorter than the attack).
    relValue = envelopeValue (params, base, peak, relTime);
    return relTime + 1.2 * std::max (params.release, minRelease);
}

double EnvelopeGenerator::killAt (double t) noexcept
{
    if (killT < infinity && t >= killT)
        return killT + killLength;
    killT = std::max (0.0, t);
    killValue = curveValue (killT);
    return killT + killLength;
}

double EnvelopeGenerator::curveValue (double t) const noexcept
{
    if (t >= relTime)
        return base + (relValue - base) * std::exp (-(t - relTime) / relTau);
    if (t <= 0.0)
        return base;
    if (t < attack)
        return base + (peak - base) * (t / attack);
    return sustainLevel + (peak - sustainLevel) * std::exp (-(t - attack) / decayTau);
}

float EnvelopeGenerator::next() noexcept
{
    const double t = now;
    now += dt;

    if (t >= killT)
    {
        if (stage != Stage::kill)
        {
            stage = Stage::kill;
            value = base + (killValue - base) * std::exp (-(t - killT) / killTau);
        }
        else
        {
            value = base + (value - base) * killFactor;
        }
        return (float) value;
    }

    if (t >= relTime)
    {
        if (stage != Stage::release)
        {
            stage = Stage::release;
            value = base + (relValue - base) * std::exp (-(t - relTime) / relTau);
        }
        else
        {
            value = base + (value - base) * releaseFactor;
        }
        return (float) value;
    }

    if (t < attack)
    {
        stage = Stage::attack;
        value = t <= 0.0 ? base : base + (peak - base) * (t / attack);
        return (float) value;
    }

    if (stage != Stage::decay)
    {
        stage = Stage::decay;
        value = sustainLevel + (peak - sustainLevel) * std::exp (-(t - attack) / decayTau);
    }
    else
    {
        value = sustainLevel + (value - sustainLevel) * decayFactor;
    }
    return (float) value;
}

} // namespace mad::dsp
