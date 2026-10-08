#include "core/Cadence.h"

#include <juce_events/juce_events.h>

#include <atomic>

#if JUCE_MAC
 #include <dispatch/dispatch.h>
#endif

namespace mad
{

#if JUCE_MAC

struct Cadence::Impl
{
    /** Shared with the posted messages, which can still arrive after stop(). */
    struct State : std::enable_shared_from_this<State>
    {
        std::function<void()> callback;
        std::atomic<bool> running { false };
        std::atomic<bool> posted { false };
    };

    explicit Impl (std::function<void()> callback) : state (std::make_shared<State>())
    {
        state->callback = std::move (callback);
    }

    ~Impl() { stop(); }

    void start (int hz)
    {
        stop();
        queue = dispatch_queue_create ("io.github.madtreasures.engine.cadence", DISPATCH_QUEUE_SERIAL);
        timer = dispatch_source_create (DISPATCH_SOURCE_TYPE_TIMER, 0, DISPATCH_TIMER_STRICT, queue);
        const auto interval = (uint64_t) (1.0e9 / juce::jmax (1, hz));
        dispatch_source_set_timer (timer, dispatch_time (DISPATCH_TIME_NOW, (int64_t) interval), interval, 0);
        dispatch_set_context (timer, state.get());
        dispatch_source_set_event_handler_f (timer, &Impl::tick);
        state->running = true;
        dispatch_resume (timer);
    }

    void stop()
    {
        state->running = false;
        if (timer == nullptr)
            return;
        dispatch_source_cancel (timer);
        // Cancelling prevents further ticks; this waits for one that is being handled right now.
        dispatch_sync_f (queue, nullptr, [] (void*) {});
        dispatch_release (timer);
        dispatch_release (queue);
        timer = nullptr;
        queue = nullptr;
    }

    static void tick (void* context)
    {
        auto* s = static_cast<State*> (context);
        if (! s->running.load() || s->posted.exchange (true))
            return;

        const bool sent = juce::MessageManager::callAsync ([keep = s->shared_from_this()]
        {
            keep->posted = false;
            if (keep->running.load())
                keep->callback();
        });
        if (! sent)
            s->posted = false;
    }

    std::shared_ptr<State> state;
    dispatch_queue_t queue = nullptr;
    dispatch_source_t timer = nullptr;
};

#else

struct Cadence::Impl final : private juce::Timer
{
    explicit Impl (std::function<void()> cb) : callback (std::move (cb)) {}
    ~Impl() override { stopTimer(); }

    void start (int hz) { startTimerHz (hz); }
    void stop() { stopTimer(); }

private:
    void timerCallback() override { callback(); }

    std::function<void()> callback;
};

#endif

Cadence::Cadence (std::function<void()> callback) : impl (std::make_unique<Impl> (std::move (callback))) {}

Cadence::~Cadence() = default;

void Cadence::start (int hz) { impl->start (hz); }

void Cadence::stop() { impl->stop(); }

} // namespace mad
