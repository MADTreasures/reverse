#pragma once

#include <juce_core/juce_core.h>

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace mad::json
{

/** Property of an object, or a void var when `obj` is not an object or lacks the key. */
const juce::var& get (const juce::var& obj, const juce::Identifier& key);

bool has (const juce::var& obj, const juce::Identifier& key);

/** Finite number (bools count as 0/1); otherwise `fallback`. */
double number (const juce::var& v, double fallback);
double number (const juce::var& obj, const juce::Identifier& key, double fallback);
int integer (const juce::var& obj, const juce::Identifier& key, int fallback);
bool boolean (const juce::var& obj, const juce::Identifier& key, bool fallback);
juce::String string (const juce::var& obj, const juce::Identifier& key, const juce::String& fallback = {});

/** Parses one line of JSON; returns a void var on failure and fills `error`. */
juce::var parse (const juce::String& text, juce::String& error);

//==============================================================================
/** Small streaming JSON writer producing compact UTF-8 text. */
class Writer
{
public:
    Writer& beginObject();
    Writer& endObject();
    Writer& beginArray();
    Writer& endArray();

    /** Starts a member of the current object; the next value call writes its value. */
    Writer& key (std::string_view name);

    Writer& value (std::string_view text);
    Writer& value (const juce::String& s) { return value (std::string_view (s.toRawUTF8())); }
    Writer& value (const char* s) { return value (std::string_view (s)); }
    Writer& value (double number, int significantDigits = 7);
    Writer& value (float number, int significantDigits = 7) { return value ((double) number, significantDigits); }
    Writer& value (int number) { return integer (number); }
    Writer& value (int64_t number) { return integer (number); }
    Writer& value (bool b);
    Writer& integer (int64_t number);
    Writer& null();

    /** Writes a pre-serialised JSON value verbatim. */
    Writer& raw (std::string_view json);

    /** Writes a juce::var (objects, arrays, strings, numbers, bools). */
    Writer& var (const juce::var& v);

    template <typename T>
    Writer& field (std::string_view name, const T& v)
    {
        key (name);
        return value (v);
    }

    Writer& field (std::string_view name, double v, int significantDigits)
    {
        key (name);
        return value (v, significantDigits);
    }

    const std::string& str() const noexcept { return text; }
    std::string take() { return std::move (text); }

private:
    void beforeValue();

    std::string text;
    std::vector<bool> hasItems;
    bool pendingKey = false;
};

void appendEscaped (std::string& out, std::string_view text);

} // namespace mad::json
