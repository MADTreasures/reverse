#include "core/Protocol.h"

#include "core/Json.h"

#include <atomic>
#include <cerrno>
#include <csignal>
#include <cstdio>
#include <mutex>
#include <thread>

#if JUCE_WINDOWS
 #include <fcntl.h>
 #include <io.h>
#else
 #include <unistd.h>
#endif

namespace mad::protocol
{
namespace
{
std::mutex outputMutex;
int outputFd = 1;
std::atomic<bool> outputClosed { false };

int rawWrite (int fd, const char* data, size_t size)
{
   #if JUCE_WINDOWS
    return _write (fd, data, (unsigned int) size);
   #else
    return (int) ::write (fd, data, size);
   #endif
}

int rawRead (char* data, size_t size)
{
   #if JUCE_WINDOWS
    return _read (0, data, (unsigned int) size);
   #else
    return (int) ::read (0, data, size);
   #endif
}
} // namespace

void initialiseOutput()
{
    std::fflush (stdout);
   #if JUCE_WINDOWS
    _setmode (_fileno (stdin), _O_BINARY);
    _setmode (_fileno (stdout), _O_BINARY);
    const int fd = _dup (_fileno (stdout));
    if (fd >= 0)
    {
        _dup2 (_fileno (stderr), _fileno (stdout));
        outputFd = fd;
    }
   #else
    std::signal (SIGPIPE, SIG_IGN);
    const int fd = ::dup (STDOUT_FILENO);
    if (fd >= 0)
    {
        ::dup2 (STDERR_FILENO, STDOUT_FILENO);
        outputFd = fd;
    }
   #endif
}

bool writeLine (std::string_view json)
{
    if (outputClosed.load())
        return false;

    const std::lock_guard<std::mutex> lock (outputMutex);
    std::string line;
    line.reserve (json.size() + 1);
    line.append (json);
    line.push_back ('\n');

    size_t done = 0;
    while (done < line.size())
    {
        const int n = rawWrite (outputFd, line.data() + done, line.size() - done);
        if (n > 0)
        {
            done += (size_t) n;
            continue;
        }
        if (n < 0 && errno == EINTR)
            continue;
        outputClosed.store (true);
        return false;
    }
    return true;
}

void sendError (const juce::String& message, const juce::String& requestType, const juce::var& requestId)
{
    json::Writer w;
    w.beginObject().field ("type", "error").field ("message", message);
    if (requestType.isNotEmpty())
        w.field ("request", requestType);
    if (! requestId.isVoid() && ! requestId.isUndefined())
    {
        w.key ("requestId");
        w.var (requestId);
    }
    w.endObject();
    writeLine (w.str());
}

void sendLog (const juce::String& message)
{
    json::Writer w;
    w.beginObject().field ("type", "log").field ("message", message).endObject();
    writeLine (w.str());
}

//==============================================================================
void startStdinReader (std::function<void (Incoming&&)> handler)
{
    std::thread ([sink = std::move (handler)]
    {
        std::string pending;
        char buffer[65536];

        const auto deliver = [&sink] (std::string& line)
        {
            if (! line.empty() && line.back() == '\r')
                line.pop_back();

            bool blank = true;
            for (const char c : line)
                if (c != ' ' && c != '\t')
                {
                    blank = false;
                    break;
                }
            if (blank)
                return;

            Incoming in;
            juce::String error;
            in.message = json::parse (juce::String::fromUTF8 (line.data(), (int) line.size()), error);
            if (error.isNotEmpty() || ! in.message.isObject())
                in.parseError = error.isNotEmpty() ? error : juce::String ("expected a JSON object");
            else
                in.type = json::string (in.message, "type");
            sink (std::move (in));
        };

        for (;;)
        {
            const int n = rawRead (buffer, sizeof (buffer));
            if (n < 0 && errno == EINTR)
                continue;
            if (n <= 0)
                break;

            size_t start = 0;
            for (size_t i = 0; i < (size_t) n; ++i)
            {
                if (buffer[i] == '\n')
                {
                    pending.append (buffer + start, i - start);
                    deliver (pending);
                    pending.clear();
                    start = i + 1;
                }
            }
            pending.append (buffer + start, (size_t) n - start);
        }

        if (! pending.empty())
            deliver (pending);

        Incoming eof;
        eof.endOfInput = true;
        sink (std::move (eof));
    }).detach();
}

} // namespace mad::protocol
