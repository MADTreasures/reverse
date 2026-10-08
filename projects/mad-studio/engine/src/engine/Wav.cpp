#include "engine/Wav.h"

#include <cmath>
#include <cstring>

namespace mad
{
namespace
{
void putU16 (char* p, uint32_t v) noexcept
{
    p[0] = (char) (v & 0xff);
    p[1] = (char) ((v >> 8) & 0xff);
}

void putU32 (char* p, uint32_t v) noexcept
{
    for (int i = 0; i < 4; ++i)
        p[i] = (char) ((v >> (8 * i)) & 0xff);
}

uint32_t getU32 (const unsigned char* p) noexcept
{
    return (uint32_t) p[0] | ((uint32_t) p[1] << 8) | ((uint32_t) p[2] << 16) | ((uint32_t) p[3] << 24);
}

uint32_t getU16 (const unsigned char* p) noexcept { return (uint32_t) p[0] | ((uint32_t) p[1] << 8); }

/** JavaScript Math.round(): rounds half towards +infinity. */
inline double jsRound (double x) noexcept { return std::floor (x + 0.5); }
} // namespace

WavWriter::~WavWriter() { close(); }

bool WavWriter::open (const juce::File& file, double sampleRate, int numChannels, int bitDepth)
{
    file.deleteFile();
    auto stream = std::make_unique<juce::FileOutputStream> (file, 1 << 16);
    if (! stream->openedOk())
        return false;
    return open (std::move (stream), sampleRate, numChannels, bitDepth);
}

bool WavWriter::open (std::unique_ptr<juce::OutputStream> stream, double sampleRate, int numChannels, int bitDepth)
{
    close();
    if (bitDepth != 16 && bitDepth != 24 && bitDepth != 32)
        bitDepth = 24;
    out = std::move (stream);
    channels = std::max (1, numChannels);
    bits = bitDepth;
    bytesPerSample = bits / 8;
    rate = (uint32_t) std::lround (sampleRate);
    frames = 0;
    seed = 22222;
    return writeHeader (0);
}

bool WavWriter::writeHeader (uint32_t dataBytes)
{
    char h[44];
    std::memcpy (h, "RIFF", 4);
    putU32 (h + 4, 36 + dataBytes);
    std::memcpy (h + 8, "WAVE", 4);
    std::memcpy (h + 12, "fmt ", 4);
    putU32 (h + 16, 16);
    putU16 (h + 20, bits == 32 ? 3u : 1u);
    putU16 (h + 22, (uint32_t) channels);
    putU32 (h + 24, rate);
    putU32 (h + 28, rate * (uint32_t) (channels * bytesPerSample));
    putU16 (h + 32, (uint32_t) (channels * bytesPerSample));
    putU16 (h + 34, (uint32_t) bits);
    std::memcpy (h + 36, "data", 4);
    putU32 (h + 40, dataBytes);
    return out->write (h, sizeof (h));
}

void WavWriter::encodeSample (float x, char*& p) noexcept
{
    const double s = std::isfinite (x) ? std::max (-1.0, std::min (1.0, (double) x)) : 0.0;
    if (bits == 16)
    {
        const auto rand = [this]
        {
            seed = seed * 1664525u + 1013904223u;
            return (double) seed / 4294967296.0;
        };
        const double r1 = rand();
        const double r2 = rand();
        const double dither = (r1 - r2) / 32768.0;
        const auto v = (int32_t) jsRound (std::max (-1.0, std::min (1.0, s + dither)) * 32767.0);
        putU16 (p, (uint32_t) (v & 0xffff));
        p += 2;
    }
    else if (bits == 24)
    {
        const auto v = (int32_t) jsRound (s * 8388607.0);
        p[0] = (char) (v & 0xff);
        p[1] = (char) ((v >> 8) & 0xff);
        p[2] = (char) ((v >> 16) & 0xff);
        p += 3;
    }
    else
    {
        const auto f = (float) s;
        uint32_t u;
        std::memcpy (&u, &f, sizeof (u));
        putU32 (p, u);
        p += 4;
    }
}

bool WavWriter::flushScratch (size_t bytes) { return out->write (scratch.data(), bytes); }

bool WavWriter::write (const float* const* data, int numFrames)
{
    if (out == nullptr || numFrames <= 0)
        return out != nullptr;
    scratch.resize ((size_t) numFrames * (size_t) channels * (size_t) bytesPerSample);
    char* p = scratch.data();
    for (int i = 0; i < numFrames; ++i)
        for (int c = 0; c < channels; ++c)
            encodeSample (data[c][i], p);
    frames += numFrames;
    return flushScratch ((size_t) (p - scratch.data()));
}

bool WavWriter::writeInterleaved (const float* data, int numFrames)
{
    if (out == nullptr || numFrames <= 0)
        return out != nullptr;
    scratch.resize ((size_t) numFrames * (size_t) channels * (size_t) bytesPerSample);
    char* p = scratch.data();
    const auto total = (size_t) numFrames * (size_t) channels;
    for (size_t i = 0; i < total; ++i)
        encodeSample (data[i], p);
    frames += numFrames;
    return flushScratch ((size_t) (p - scratch.data()));
}

bool WavWriter::close()
{
    if (out == nullptr)
        return true;
    const auto dataBytes = (uint64_t) frames * (uint64_t) channels * (uint64_t) bytesPerSample;
    bool ok = true;
    out->flush();
    if (out->setPosition (0))
        ok = writeHeader ((uint32_t) std::min<uint64_t> (dataBytes, 0xffffffffu - 36u));
    else
        ok = false;
    out->flush();
    out.reset();
    return ok;
}

juce::MemoryBlock encodeWav (const std::vector<std::vector<float>>& channels, double sampleRate, int bitDepth)
{
    juce::MemoryBlock block;
    {
        WavWriter w;
        w.open (std::make_unique<juce::MemoryOutputStream> (block, false), sampleRate, (int) channels.size(), bitDepth);
        std::vector<const float*> ptrs;
        for (const auto& c : channels)
            ptrs.push_back (c.data());
        w.write (ptrs.data(), channels.empty() ? 0 : (int) channels[0].size());
        w.close();
    }
    return block;
}

//==============================================================================
bool readWav (const void* data, size_t size, WavData& out, juce::String& error)
{
    const auto* p = static_cast<const unsigned char*> (data);
    if (size < 12 || std::memcmp (p, "RIFF", 4) != 0 || std::memcmp (p + 8, "WAVE", 4) != 0)
    {
        error = "not a RIFF/WAVE file";
        return false;
    }

    int format = 0, channels = 0, bits = 0;
    uint32_t rate = 0;
    const unsigned char* pcm = nullptr;
    size_t pcmBytes = 0;
    size_t pos = 12;
    while (pos + 8 <= size)
    {
        const auto chunkSize = (size_t) getU32 (p + pos + 4);
        const unsigned char* body = p + pos + 8;
        const size_t available = std::min (chunkSize, size - (pos + 8));
        if (std::memcmp (p + pos, "fmt ", 4) == 0 && available >= 16)
        {
            format = (int) getU16 (body);
            channels = (int) getU16 (body + 2);
            rate = getU32 (body + 4);
            bits = (int) getU16 (body + 14);
            if (format == 0xfffe && available >= 26)
                format = (int) getU16 (body + 24);
        }
        else if (std::memcmp (p + pos, "data", 4) == 0)
        {
            pcm = body;
            pcmBytes = available;
        }
        pos += 8 + chunkSize + (chunkSize & 1);
    }

    if (pcm == nullptr || channels <= 0 || rate == 0)
    {
        error = "missing fmt or data chunk";
        return false;
    }
    const bool isFloat = format == 3;
    if (! ((format == 1 && (bits == 16 || bits == 24)) || (isFloat && bits == 32)))
    {
        error = "unsupported WAV encoding";
        return false;
    }

    const int bytesPerSample = bits / 8;
    const size_t frames = pcmBytes / (size_t) (bytesPerSample * channels);
    out.sampleRate = rate;
    out.numChannels = channels;
    out.bitDepth = bits;
    out.isFloat = isFloat;
    out.channels.assign ((size_t) channels, std::vector<float> (frames));
    for (size_t i = 0; i < frames; ++i)
    {
        for (int c = 0; c < channels; ++c)
        {
            const unsigned char* s = pcm + (i * (size_t) channels + (size_t) c) * (size_t) bytesPerSample;
            float v;
            if (bits == 16)
            {
                v = (float) (int16_t) getU16 (s) / 32768.0f;
            }
            else if (bits == 24)
            {
                int32_t x = (int32_t) ((uint32_t) s[0] | ((uint32_t) s[1] << 8) | ((uint32_t) s[2] << 16));
                if ((x & 0x800000) != 0)
                    x -= 0x1000000;
                v = (float) x / 8388608.0f;
            }
            else
            {
                const uint32_t u = getU32 (s);
                std::memcpy (&v, &u, sizeof (v));
            }
            out.channels[(size_t) c][i] = v;
        }
    }
    return true;
}

bool readWav (const juce::File& file, WavData& out, juce::String& error)
{
    juce::MemoryBlock block;
    if (! file.loadFileAsData (block))
    {
        error = "cannot read " + file.getFullPathName();
        return false;
    }
    return readWav (block.getData(), block.getSize(), out, error);
}

} // namespace mad
