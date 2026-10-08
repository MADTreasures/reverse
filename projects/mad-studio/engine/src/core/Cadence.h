#pragma once

#include <functional>
#include <memory>

namespace mad
{

/** Calls a function on the message thread at a fixed rate (the status and meter updates).

    juce::Timer sleeps on an ordinary thread, and macOS defers such wake-ups ("timer coalescing")
    when it runs the process at a lowered priority: on hosted CI runners a 30 Hz juce::Timer
    fires only 7 to 15 times per second. On macOS the ticks therefore come from a strict dispatch
    timer, which the system does not coalesce, and are posted to the message thread; elsewhere
    this is a juce::Timer. While the message thread is busy, ticks are dropped instead of queued. */
class Cadence
{
public:
    explicit Cadence (std::function<void()> callback);
    ~Cadence();

    /** Message thread only. */
    void start (int hz);
    /** Message thread only. No callback runs after this returns. */
    void stop();

private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};

} // namespace mad
