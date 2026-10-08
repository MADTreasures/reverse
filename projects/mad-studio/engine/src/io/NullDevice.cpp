#include "io/NullDevice.h"

#include <chrono>
#include <cmath>
#include <thread>

namespace mad
{

NullDevice::NullDevice() : juce::Thread ("mad-null-audio") {}

NullDevice::~NullDevice() { stop(); }

void NullDevice::start (double sampleRate, int blockSize, Callback callback)
{
    stop();
    rate = sampleRate;
    block = blockSize;
    cb = std::move (callback);
    for (auto* v : { &in0, &in1, &out0, &out1 })
        v->assign ((size_t) block, 0.0f);
    startThread (juce::Thread::Priority::highest);
}

void NullDevice::stop()
{
    // Wait for the current block however long it takes (slow machines, sanitizer builds): JUCE
    // would otherwise kill the thread mid-block and leave plugin slots locked.
    stopThread (-1);
}

void NullDevice::run()
{
    using clock = std::chrono::steady_clock;
    const auto period = std::chrono::duration_cast<clock::duration> (std::chrono::duration<double> ((double) block / rate));
    auto next = clock::now();

    const float* inputs[] = { in0.data(), in1.data() };
    float* outputs[] = { out0.data(), out1.data() };

    while (! threadShouldExit())
    {
        const double hz = toneHz.load (std::memory_order_relaxed);
        if (hz > 0.0)
        {
            for (int i = 0; i < block; ++i)
            {
                const auto v = (float) (0.25 * std::sin (2.0 * 3.14159265358979323846 * tonePhase));
                in0[(size_t) i] = in1[(size_t) i] = v;
                tonePhase += hz / rate;
                tonePhase -= std::floor (tonePhase);
            }
        }
        else
        {
            std::fill (in0.begin(), in0.end(), 0.0f);
            std::fill (in1.begin(), in1.end(), 0.0f);
        }

        if (cb)
            cb (inputs, numInputs, outputs, numOutputs, block);

        next += period;
        const auto now = clock::now();
        if (now - next > std::chrono::milliseconds (200))
            next = now; // fell far behind (debugger, suspended VM): do not try to catch up
        std::this_thread::sleep_until (next);
    }
}

} // namespace mad
