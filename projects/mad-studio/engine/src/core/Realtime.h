#pragma once

// Lock-free building blocks shared by the message thread and the audio thread.

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

namespace mad
{

//==============================================================================
/** Single-producer / single-consumer FIFO with a fixed, power-of-two capacity.
    T should be trivially copyable so push/pop never allocate. */
template <typename T, size_t Capacity>
class SpscFifo
{
    static_assert ((Capacity & (Capacity - 1)) == 0, "capacity must be a power of two");

public:
    bool push (const T& item) noexcept
    {
        const auto w = writePos.load (std::memory_order_relaxed);
        if (w - readPos.load (std::memory_order_acquire) >= Capacity)
            return false;

        items[w & (Capacity - 1)] = item;
        writePos.store (w + 1, std::memory_order_release);
        return true;
    }

    bool pop (T& item) noexcept
    {
        const auto r = readPos.load (std::memory_order_relaxed);
        if (r == writePos.load (std::memory_order_acquire))
            return false;

        item = items[r & (Capacity - 1)];
        readPos.store (r + 1, std::memory_order_release);
        return true;
    }

private:
    std::array<T, Capacity> items {};
    std::atomic<size_t> writePos { 0 }, readPos { 0 };
};

//==============================================================================
/** Publishes immutable snapshots from one producer thread to one consumer (the audio thread).

    The consumer calls acquire() at the start of a cycle and release() at the end; it never
    owns or frees anything. Replaced snapshots are kept until the consumer has finished at
    least one full cycle after the swap and are then deleted by collectGarbage() on the
    producer thread. */
template <typename T>
class SnapshotPublisher
{
public:
    SnapshotPublisher() = default;
    SnapshotPublisher (const SnapshotPublisher&) = delete;
    SnapshotPublisher& operator= (const SnapshotPublisher&) = delete;

    ~SnapshotPublisher()
    {
        delete current.load();
        for (auto& r : retired)
            delete r.ptr;
    }

    /** Producer: installs a new snapshot (may be null). */
    void publish (std::unique_ptr<T> next)
    {
        T* old = current.exchange (next.release());
        if (old != nullptr)
            retired.push_back ({ old, epoch.load() });
        collectGarbage();
    }

    /** Producer: deletes snapshots the consumer can no longer be using. */
    void collectGarbage()
    {
        const auto now = epoch.load();
        for (size_t i = 0; i < retired.size();)
        {
            if (now > retired[i].epoch)
            {
                delete retired[i].ptr;
                retired[i] = retired.back();
                retired.pop_back();
            }
            else
            {
                ++i;
            }
        }
    }

    /** Producer: deletes every retired snapshot. Only call while the consumer is stopped. */
    void collectAllWhileConsumerStopped()
    {
        for (auto& r : retired)
            delete r.ptr;
        retired.clear();
    }

    /** Producer: the snapshot most recently published. */
    T* latest() const noexcept { return current.load(); }

    /** Consumer: the snapshot to use for this cycle. */
    T* acquire() const noexcept { return current.load(); }

    /** Consumer: marks the end of a cycle. */
    void release() noexcept { epoch.fetch_add (1); }

private:
    struct Retired
    {
        T* ptr;
        uint64_t epoch;
    };

    std::atomic<T*> current { nullptr };
    std::atomic<uint64_t> epoch { 0 };
    std::vector<Retired> retired;
};

//==============================================================================
/** Lock-free triple buffer: one writer publishes whole frames, one reader takes the newest. */
template <typename T>
class TripleBuffer
{
public:
    T& writeBuffer() noexcept { return buffers[(size_t) writeIndex]; }

    void publish() noexcept
    {
        writeIndex = middle.exchange (writeIndex | freshBit) & indexMask;
    }

    /** Copies the newest frame into `out`; returns false if nothing new was published. */
    bool read (T& out) noexcept
    {
        if ((middle.load() & freshBit) == 0)
            return false;

        readIndex = middle.exchange (readIndex) & indexMask;
        out = buffers[(size_t) readIndex];
        return true;
    }

private:
    static constexpr int freshBit = 4, indexMask = 3;
    std::array<T, 3> buffers {};
    int writeIndex = 0, readIndex = 1;
    std::atomic<int> middle { 2 };
};

//==============================================================================
/** A spin lock whose owner may change threads (lock on one thread, unlock on another).
    The audio thread only ever uses tryLock(). */
class SpinTryLock
{
public:
    bool tryLock() noexcept { return ! flag.exchange (true, std::memory_order_acquire); }

    void lock() noexcept
    {
        while (! tryLock())
            std::this_thread::yield();
    }

    void unlock() noexcept { flag.store (false, std::memory_order_release); }

private:
    std::atomic<bool> flag { false };
};

} // namespace mad
