#pragma once

#include <juce_core/juce_core.h>

#include <atomic>
#include <functional>
#include <vector>

namespace mad
{

/** Drives the audio callback in real time without hardware (CI, headless machines): one
    block every blockSize / sampleRate seconds, with silent (or test-tone) inputs. */
class NullDevice : private juce::Thread
{
public:
    using Callback = std::function<void (const float* const* inputs, int numInputs, float* const* outputs, int numOutputs, int numSamples)>;

    static constexpr int numInputs = 2;
    static constexpr int numOutputs = 2;

    NullDevice();
    ~NullDevice() override;

    void start (double sampleRate, int blockSize, Callback callback);
    void stop();
    bool isRunning() const noexcept { return isThreadRunning(); }

    /** Test aid: feed a sine of this frequency (amplitude 0.25) to both inputs (0 = silence). */
    void setInputTone (double hz) noexcept { toneHz.store (hz); }

    double getSampleRate() const noexcept { return rate; }
    int getBlockSize() const noexcept { return block; }

private:
    void run() override;

    double rate = 48000.0;
    int block = 512;
    Callback cb;
    std::atomic<double> toneHz { 0.0 };
    double tonePhase = 0.0;
    std::vector<float> in0, in1, out0, out1;
};

} // namespace mad
