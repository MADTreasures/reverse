#pragma once

#include <juce_core/juce_core.h>

#include <cstdio>
#include <mutex>

namespace mad
{

/** Free-form diagnostics go to stderr (stdout is reserved for the JSON protocol). */
inline void logMessage (const juce::String& message)
{
    static std::mutex mutex;
    const std::lock_guard<std::mutex> lock (mutex);
    const auto text = "[mad-engine] " + message + "\n";
    std::fputs (text.toRawUTF8(), stderr);
    std::fflush (stderr);
}

} // namespace mad
