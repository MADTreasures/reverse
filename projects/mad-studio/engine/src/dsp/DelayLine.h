#pragma once

#include <algorithm>
#include <cmath>
#include <vector>

namespace mad::dsp
{

/** Circular delay with linear interpolation (Web Audio DelayNode semantics). */
class DelayLine
{
public:
    /** Allocates room for `maxDelaySamples` (message thread / prepare only). */
    void prepare (int maxDelaySamples)
    {
        int size = 1;
        while (size < maxDelaySamples + 4)
            size <<= 1;
        buffer.assign ((size_t) size, 0.0f);
        mask = size - 1;
        writeIndex = 0;
        maxDelay = (double) maxDelaySamples;
    }

    void clear() noexcept
    {
        std::fill (buffer.begin(), buffer.end(), 0.0f);
        writeIndex = 0;
    }

    /** DelayNode: writes x, then reads `delaySamples` back (0 returns x itself). */
    float process (float x, double delaySamples) noexcept
    {
        buffer[(size_t) writeIndex] = x;
        const float y = readAt (writeIndex, delaySamples);
        writeIndex = (writeIndex + 1) & mask;
        return y;
    }

    /** Feedback use: reads the sample written `delaySamples` (>= 1) ago without writing. */
    float read (double delaySamples) const noexcept
    {
        return readAt (writeIndex, std::max (1.0, delaySamples));
    }

    /** Feedback use: appends one sample (call after read()). */
    void write (float x) noexcept
    {
        buffer[(size_t) writeIndex] = x;
        writeIndex = (writeIndex + 1) & mask;
    }

    double maximumDelay() const noexcept { return maxDelay; }

private:
    float readAt (int index, double delaySamples) const noexcept
    {
        const double d = std::clamp (delaySamples, 0.0, maxDelay);
        double pos = (double) index - d;
        if (pos < 0.0)
            pos += (double) (mask + 1);
        const int i1 = (int) pos;
        const int i2 = (i1 + 1) & mask;
        const double frac = pos - (double) i1;
        const double a = buffer[(size_t) (i1 & mask)];
        const double b = buffer[(size_t) i2];
        return (float) (a + (b - a) * frac);
    }

    std::vector<float> buffer = std::vector<float> (4, 0.0f);
    int mask = 3, writeIndex = 0;
    double maxDelay = 0.0;
};

} // namespace mad::dsp
