#pragma once

#include <juce_core/juce_core.h>

#include <cstdint>
#include <memory>
#include <vector>

namespace mad
{

/** Streaming RIFF/WAVE writer with the same encoding as wav.ts encodeWav(): 16-bit integer PCM
    with TPDF dither (LCG seed 22222), 24-bit integer PCM, 32-bit IEEE float; samples clamped
    to [-1, 1], non-finite samples written as 0. The header sizes are patched on close(). */
class WavWriter
{
public:
    ~WavWriter();

    bool open (const juce::File& file, double sampleRate, int numChannels, int bitDepth);
    bool open (std::unique_ptr<juce::OutputStream> stream, double sampleRate, int numChannels, int bitDepth);

    /** Non-interleaved input, `numChannels` pointers. */
    bool write (const float* const* channels, int numFrames);
    /** Interleaved input. */
    bool writeInterleaved (const float* data, int numFrames);

    bool close();

    int64_t framesWritten() const noexcept { return frames; }
    bool isOpen() const noexcept { return out != nullptr; }

private:
    bool writeHeader (uint32_t dataBytes);
    void encodeSample (float x, char*& p) noexcept;
    bool flushScratch (size_t bytes);

    std::unique_ptr<juce::OutputStream> out;
    int channels = 2, bits = 24, bytesPerSample = 3;
    uint32_t rate = 48000;
    int64_t frames = 0;
    uint32_t seed = 22222;
    std::vector<char> scratch;
};

/** Encodes a whole buffer (tests). */
juce::MemoryBlock encodeWav (const std::vector<std::vector<float>>& channels, double sampleRate, int bitDepth);

struct WavData
{
    double sampleRate = 0.0;
    int numChannels = 0, bitDepth = 0;
    bool isFloat = false;
    std::vector<std::vector<float>> channels;
};

/** Reads 16/24-bit PCM and 32-bit float WAV files (fmt/data chunks, any order). */
bool readWav (const juce::File& file, WavData& out, juce::String& error);
bool readWav (const void* data, size_t size, WavData& out, juce::String& error);

} // namespace mad
