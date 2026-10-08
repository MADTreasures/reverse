#pragma once

#include <juce_core/juce_core.h>

#include <functional>
#include <memory>
#include <string>
#include <string_view>

namespace mad::protocol
{

/** Moves the real stdout to a private descriptor used only for protocol lines and points
    file descriptor 1 at stderr, so stray printf() output from plugins cannot corrupt the
    JSON stream. Call once at startup, before any other thread runs. */
void initialiseOutput();

/** Writes one JSON line atomically (thread-safe). Returns false once the pipe is closed. */
bool writeLine (std::string_view json);

void sendError (const juce::String& message, const juce::String& requestType = {}, const juce::var& requestId = {});
void sendLog (const juce::String& message);

//==============================================================================
/** One line received on stdin. */
struct Incoming
{
    juce::var message;       // parsed JSON (void when parsing failed)
    juce::String type;       // message["type"] if it is a string
    juce::String parseError; // non-empty when the line was not valid JSON
    bool endOfInput = false; // stdin was closed
};

/** Reads newline-delimited JSON from stdin on its own thread. Every parsed line is handed to
    `sink` on that thread; the sink must be thread-safe (it normally queues and wakes the
    message thread). The thread runs until the process exits. */
void startStdinReader (std::function<void (Incoming&&)> sink);

} // namespace mad::protocol
