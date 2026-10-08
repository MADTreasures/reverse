#pragma once

#include <limits>

namespace mad::dsp
{

struct EnvelopeParams
{
    double attack = 0.005, decay = 0.3, sustain = 0.6, release = 0.25;
};

inline constexpr double minAttack = 0.0015;  // envelope.ts MIN_ATTACK
inline constexpr double minRelease = 0.004;  // envelope.ts MIN_RELEASE
inline constexpr double killTau = 0.003;     // fadeOut(time = 0.012) -> setTargetAtTime(base, at, 0.012 / 4)
inline constexpr double killLength = 0.018;  // fadeOut returns at + 0.012 * 1.5
inline constexpr double infinity = std::numeric_limits<double>::infinity();

/** envelope.ts envelopeValue(): linear attack, exponential decay towards sustain. */
double envelopeValue (const EnvelopeParams& env, double base, double peak, double x) noexcept;

/** Sample-by-sample rendering of the AudioParam automation that envelope.ts schedules:
    scheduleEnvelope (attack ramp, setTargetAtTime decay, release at note end), releaseEnvelope
    (live note-off) and fadeOut (kill: tau 3 ms towards 0, silent 18 ms later).
    All times are seconds relative to the note start. */
class EnvelopeGenerator
{
public:
    /** `firstSampleTime`: note-relative time of the first sample next() will produce.
        `minimumAttack` is 1.5 ms for scheduleEnvelope(); the one-shot sampler uses 1 ms. */
    void start (const EnvelopeParams& p, double base, double peak, double sampleRate, double firstSampleTime,
                double minimumAttack = minAttack) noexcept;

    /** Schedules the release at `releaseTime` (note length for sequenced notes, "now" for
        live note-offs). Returns the time the release has decayed (release + 1.2 r). */
    double releaseAt (double releaseTime) noexcept;

    /** Cancel-and-hold at `time`, then fade to silence (tau 3 ms). Returns the end time. */
    double killAt (double time) noexcept;

    /** Value for the current sample, then advances one sample. */
    float next() noexcept;

    /** Analytic value of the scheduled curve at `t` (ignoring a later kill). */
    double curveValue (double t) const noexcept;

    double time() const noexcept { return now; }
    double releaseTime() const noexcept { return relTime; }
    double killTime() const noexcept { return killT; }
    bool isReleased() const noexcept { return relTime < infinity; }
    bool isKilled() const noexcept { return killT < infinity; }

private:
    enum class Stage
    {
        attack,
        decay,
        release,
        kill
    };

    EnvelopeParams params;
    double base = 0.0, peak = 1.0, sustainLevel = 0.0;
    double attack = minAttack, decayTau = 0.001, relTau = minRelease / 5.0;
    double decayFactor = 0.0, releaseFactor = 0.0, killFactor = 0.0;
    double dt = 1.0 / 48000.0, now = 0.0;
    double relTime = infinity, relValue = 0.0;
    double killT = infinity, killValue = 0.0;
    double value = 0.0;
    Stage stage = Stage::attack;
};

} // namespace mad::dsp
