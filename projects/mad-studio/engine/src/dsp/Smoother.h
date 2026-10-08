#pragma once

#include <cmath>

namespace mad::dsp
{

/** Exact floating point inequality without tripping -Wfloat-equal. */
inline bool differs (double a, double b) noexcept { return a < b || b < a; }

/** Web Audio AudioParam.setTargetAtTime(v, now, tau) as a per-sample one-pole:
    y += (target - y) * (1 - exp(-1 / (tau * sampleRate))). */
class OnePole
{
public:
    void prepare (double sampleRate, double tauSeconds) noexcept
    {
        coeff = 1.0 - std::exp (-1.0 / (tauSeconds * sampleRate));
        keep = 1.0 - coeff;
    }

    /** Jumps to `v` without smoothing. */
    void reset (double v) noexcept
    {
        y = target = v;
        settledFlag = true;
    }

    void setTarget (double t) noexcept
    {
        if (! initialised)
        {
            initialised = true;
            reset (t);
            return;
        }
        if (differs (t, target))
        {
            target = t;
            settledFlag = false;
        }
    }

    float next() noexcept
    {
        if (settledFlag)
            return (float) y;
        y += (target - y) * coeff;
        if (std::abs (target - y) <= 1.0e-7 * (1.0 + std::abs (target)))
        {
            y = target;
            settledFlag = true;
        }
        return (float) y;
    }

    /** Advances n samples at once (exact closed form). */
    void skip (int n) noexcept
    {
        if (settledFlag || n <= 0)
            return;
        y = target + (y - target) * std::pow (keep, (double) n);
        if (std::abs (target - y) <= 1.0e-7 * (1.0 + std::abs (target)))
        {
            y = target;
            settledFlag = true;
        }
    }

    double current() const noexcept { return y; }
    double getTarget() const noexcept { return target; }
    bool settled() const noexcept { return settledFlag; }

private:
    double coeff = 1.0, keep = 0.0;
    double y = 0.0, target = 0.0;
    bool settledFlag = true, initialised = false;
};

} // namespace mad::dsp
