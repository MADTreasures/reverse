#pragma once

#include <algorithm>
#include <cmath>

namespace mad::dsp
{

inline constexpr double halfPi = 1.57079632679489661923;

struct PanGains
{
    float left = 1.0f, right = 1.0f;
};

/** StereoPannerNode, mono input: x = (pan + 1) / 2, L = M cos(x pi/2), R = M sin(x pi/2). */
inline PanGains monoPanGains (double pan) noexcept
{
    const double x = (std::clamp (pan, -1.0, 1.0) + 1.0) * 0.5;
    return { (float) std::cos (x * halfPi), (float) std::sin (x * halfPi) };
}

/** StereoPannerNode gains for stereo input (applied by stereoPan()). */
inline PanGains stereoPanGains (double pan) noexcept
{
    const double p = std::clamp (pan, -1.0, 1.0);
    const double x = p <= 0.0 ? p + 1.0 : p;
    return { (float) std::cos (x * halfPi), (float) std::sin (x * halfPi) };
}

/** StereoPannerNode, stereo input:
    pan <= 0: L = inL + inR gainL, R = inR gainR;  pan > 0: L = inL gainL, R = inR + inL gainR. */
inline void stereoPan (double pan, PanGains g, float inL, float inR, float& outL, float& outR) noexcept
{
    if (pan <= 0.0)
    {
        outL = inL + inR * g.left;
        outR = inR * g.right;
    }
    else
    {
        outL = inL * g.left;
        outR = inR + inL * g.right;
    }
}

} // namespace mad::dsp
