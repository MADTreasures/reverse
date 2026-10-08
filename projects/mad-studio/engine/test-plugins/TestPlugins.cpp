// Minimal plugins with exactly predictable output, used by engine/tests/protocol-test.mjs.
//   MAD_TEST_SYNTH=0: "MAD Test Gain"  - stereo effect, output = input * gain (parameter 0..1, default 0.5)
//   MAD_TEST_SYNTH=1: "MAD Test Synth" - sine per MIDI note at the note's frequency,
//                                        amplitude velocity * 0.25, 5 ms linear attack/release

#include <juce_audio_processors/juce_audio_processors.h>

#include <algorithm>
#include <array>
#include <cmath>

namespace
{

class TestPluginBase : public juce::AudioProcessor
{
public:
    using juce::AudioProcessor::AudioProcessor;

    const juce::String getName() const override { return JucePlugin_Name; }
    double getTailLengthSeconds() const override { return 0.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return "Default"; }
    void changeProgramName (int, const juce::String&) override {}
    bool hasEditor() const override { return true; }
    juce::AudioProcessorEditor* createEditor() override { return new juce::GenericAudioProcessorEditor (*this); }
    void releaseResources() override {}
};

#if ! MAD_TEST_SYNTH

class TestGain final : public TestPluginBase
{
public:
    TestGain()
        : TestPluginBase (BusesProperties()
                              .withInput ("Input", juce::AudioChannelSet::stereo(), true)
                              .withOutput ("Output", juce::AudioChannelSet::stereo(), true))
    {
        addParameter (gain = new juce::AudioParameterFloat (juce::ParameterID { "gain", 1 }, "Gain",
                                                            juce::NormalisableRange<float> (0.0f, 1.0f), 0.5f));
    }

    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }

    bool isBusesLayoutSupported (const BusesLayout& layouts) const override
    {
        const auto out = layouts.getMainOutputChannelSet();
        return (out == juce::AudioChannelSet::mono() || out == juce::AudioChannelSet::stereo())
               && layouts.getMainInputChannelSet() == out;
    }

    void prepareToPlay (double, int) override {}

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
    {
        const float g = gain->get();
        for (int ch = 0; ch < getTotalNumOutputChannels(); ++ch)
            buffer.applyGain (ch, 0, buffer.getNumSamples(), g);
        for (int ch = getTotalNumInputChannels(); ch < getTotalNumOutputChannels(); ++ch)
            buffer.clear (ch, 0, buffer.getNumSamples());
    }

    void getStateInformation (juce::MemoryBlock& dest) override
    {
        juce::MemoryOutputStream out (dest, false);
        out.writeString ("MADTestGain");
        out.writeFloat (gain->get());
    }

    void setStateInformation (const void* data, int size) override
    {
        juce::MemoryInputStream in (data, (size_t) size, false);
        if (in.readString() == "MADTestGain")
            gain->setValueNotifyingHost (gain->convertTo0to1 (juce::jlimit (0.0f, 1.0f, in.readFloat())));
    }

private:
    juce::AudioParameterFloat* gain = nullptr;
};

#else

class TestSynth final : public TestPluginBase
{
public:
    TestSynth() : TestPluginBase (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true)) {}

    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }

    bool isBusesLayoutSupported (const BusesLayout& layouts) const override
    {
        const auto out = layouts.getMainOutputChannelSet();
        return out == juce::AudioChannelSet::mono() || out == juce::AudioChannelSet::stereo();
    }

    void prepareToPlay (double sampleRate, int) override
    {
        rate = sampleRate;
        rampStep = 1.0 / (0.005 * sampleRate);
        for (auto& v : voices)
            v = {};
    }

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) override
    {
        buffer.clear();
        const int n = buffer.getNumSamples();
        int pos = 0;
        for (const auto metadata : midi)
        {
            const int at = juce::jlimit (0, n, metadata.samplePosition);
            render (buffer, pos, at);
            pos = at;
            handle (metadata.getMessage());
        }
        render (buffer, pos, n);
    }

    void getStateInformation (juce::MemoryBlock& dest) override
    {
        juce::MemoryOutputStream out (dest, false);
        out.writeString ("MADTestSynth");
    }

    void setStateInformation (const void*, int) override {}

private:
    struct Voice
    {
        int note = -1;
        double phase = 0.0, increment = 0.0, amplitude = 0.0, ramp = 0.0;
        bool releasing = false;
    };

    void handle (const juce::MidiMessage& m)
    {
        if (m.isNoteOn())
        {
            Voice* slot = nullptr;
            for (auto& v : voices)
                if (v.note < 0)
                {
                    slot = &v;
                    break;
                }
            if (slot == nullptr)
                slot = &voices[0];
            const double hz = 440.0 * std::pow (2.0, (m.getNoteNumber() - 69) / 12.0);
            *slot = { m.getNoteNumber(), 0.0, hz / rate, m.getFloatVelocity() * 0.25, 0.0, false };
        }
        else if (m.isNoteOff())
        {
            for (auto& v : voices)
                if (v.note == m.getNoteNumber() && ! v.releasing)
                    v.releasing = true;
        }
        else if (m.isAllNotesOff() || m.isAllSoundOff())
        {
            for (auto& v : voices)
                if (v.note >= 0)
                    v.releasing = true;
        }
    }

    void render (juce::AudioBuffer<float>& buffer, int from, int to)
    {
        for (auto& v : voices)
        {
            if (v.note < 0)
                continue;
            for (int i = from; i < to; ++i)
            {
                v.ramp = v.releasing ? v.ramp - rampStep : std::min (1.0, v.ramp + rampStep);
                if (v.ramp <= 0.0 && v.releasing)
                {
                    v.note = -1;
                    break;
                }
                const auto s = (float) (std::sin (2.0 * juce::MathConstants<double>::pi * v.phase) * v.amplitude * v.ramp);
                v.phase += v.increment;
                v.phase -= std::floor (v.phase);
                for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
                    buffer.addSample (ch, i, s);
            }
        }
    }

    double rate = 48000.0, rampStep = 1.0 / 240.0;
    std::array<Voice, 16> voices {};
};

#endif

} // namespace

// Declared by the JUCE plugin client headers.
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
   #if MAD_TEST_SYNTH
    return new TestSynth();
   #else
    return new TestGain();
   #endif
}
