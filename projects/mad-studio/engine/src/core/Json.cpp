#include "core/Json.h"

#include <cmath>
#include <cstdio>

namespace mad::json
{

const juce::var& get (const juce::var& obj, const juce::Identifier& key)
{
    static const juce::var none;
    if (auto* o = obj.getDynamicObject())
    {
        if (auto* p = o->getProperties().getVarPointer (key))
            return *p;
    }
    return none;
}

bool has (const juce::var& obj, const juce::Identifier& key)
{
    if (auto* o = obj.getDynamicObject())
        return o->hasProperty (key);
    return false;
}

double number (const juce::var& v, double fallback)
{
    if (v.isInt() || v.isInt64() || v.isDouble())
    {
        const auto d = static_cast<double> (v);
        return std::isfinite (d) ? d : fallback;
    }
    if (v.isBool())
        return static_cast<bool> (v) ? 1.0 : 0.0;
    return fallback;
}

double number (const juce::var& obj, const juce::Identifier& key, double fallback)
{
    return number (get (obj, key), fallback);
}

int integer (const juce::var& obj, const juce::Identifier& key, int fallback)
{
    const auto d = number (get (obj, key), (double) fallback);
    if (d > 2147483647.0 || d < -2147483648.0)
        return fallback;
    return (int) std::lround (d);
}

bool boolean (const juce::var& obj, const juce::Identifier& key, bool fallback)
{
    const auto& v = get (obj, key);
    if (v.isBool())
        return static_cast<bool> (v);
    if (v.isInt() || v.isInt64() || v.isDouble())
        return std::abs (static_cast<double> (v)) > 0.0;
    return fallback;
}

juce::String string (const juce::var& obj, const juce::Identifier& key, const juce::String& fallback)
{
    const auto& v = get (obj, key);
    return v.isString() ? v.toString() : fallback;
}

juce::var parse (const juce::String& text, juce::String& error)
{
    juce::var result;
    const auto r = juce::JSON::parse (text, result);
    if (r.failed())
    {
        error = r.getErrorMessage();
        return {};
    }
    error = {};
    return result;
}

//==============================================================================
void appendEscaped (std::string& out, std::string_view s)
{
    out.push_back ('"');
    for (const char c : s)
    {
        const auto u = static_cast<unsigned char> (c);
        switch (c)
        {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            default:
                if (u < 0x20)
                {
                    char buf[8];
                    std::snprintf (buf, sizeof (buf), "\\u%04x", (unsigned) u);
                    out += buf;
                }
                else
                {
                    out.push_back (c);
                }
        }
    }
    out.push_back ('"');
}

void Writer::beforeValue()
{
    if (pendingKey)
    {
        pendingKey = false;
        return;
    }
    if (! hasItems.empty())
    {
        if (hasItems.back())
            text.push_back (',');
        hasItems.back() = true;
    }
}

Writer& Writer::beginObject()
{
    beforeValue();
    text.push_back ('{');
    hasItems.push_back (false);
    return *this;
}

Writer& Writer::endObject()
{
    text.push_back ('}');
    if (! hasItems.empty())
        hasItems.pop_back();
    return *this;
}

Writer& Writer::beginArray()
{
    beforeValue();
    text.push_back ('[');
    hasItems.push_back (false);
    return *this;
}

Writer& Writer::endArray()
{
    text.push_back (']');
    if (! hasItems.empty())
        hasItems.pop_back();
    return *this;
}

Writer& Writer::key (std::string_view name)
{
    if (! hasItems.empty())
    {
        if (hasItems.back())
            text.push_back (',');
        hasItems.back() = true;
    }
    appendEscaped (text, name);
    text.push_back (':');
    pendingKey = true;
    return *this;
}

Writer& Writer::value (std::string_view s)
{
    beforeValue();
    appendEscaped (text, s);
    return *this;
}

Writer& Writer::value (double v, int significantDigits)
{
    beforeValue();
    if (! std::isfinite (v))
    {
        text.push_back ('0');
        return *this;
    }
    if (std::abs (v) < 1.0e15 && juce::exactlyEqual (std::floor (v), v))
    {
        char buf[32];
        std::snprintf (buf, sizeof (buf), "%lld", (long long) v);
        text += buf;
        return *this;
    }
    char buf[40];
    std::snprintf (buf, sizeof (buf), "%.*g", significantDigits, v);
    text += buf;
    return *this;
}

Writer& Writer::value (bool b)
{
    beforeValue();
    text += b ? "true" : "false";
    return *this;
}

Writer& Writer::integer (int64_t v)
{
    beforeValue();
    text += std::to_string (v);
    return *this;
}

Writer& Writer::null()
{
    beforeValue();
    text += "null";
    return *this;
}

Writer& Writer::raw (std::string_view json)
{
    beforeValue();
    text += json;
    return *this;
}

Writer& Writer::var (const juce::var& v)
{
    if (auto* obj = v.getDynamicObject())
    {
        beginObject();
        for (const auto& p : obj->getProperties())
        {
            key (p.name.toString().toRawUTF8());
            var (p.value);
        }
        return endObject();
    }
    if (auto* arr = v.getArray())
    {
        beginArray();
        for (const auto& item : *arr)
            var (item);
        return endArray();
    }
    if (v.isString())
        return value (v.toString());
    if (v.isBool())
        return value (static_cast<bool> (v));
    if (v.isInt() || v.isInt64())
        return integer ((int64_t) static_cast<juce::int64> (v));
    if (v.isDouble())
        return value (static_cast<double> (v), 15);
    return null();
}

} // namespace mad::json
