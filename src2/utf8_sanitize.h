#pragma once

#include <cstdint>
#include <string>

/// Replace ill-formed UTF-8 bytes with U+FFFD so nlohmann::json can parse bodies
/// from llama.cpp / MLX that occasionally embed bad sequences in message strings.
inline std::string sanitize_invalid_utf8(const std::string& in) {
    static const char repl[] = "\xEF\xBF\xBD";
    std::string out;
    out.reserve(in.size());
    const size_t n = in.size();
    for (size_t i = 0; i < n;) {
        const unsigned char c = static_cast<unsigned char>(in[i]);
        if (c < 0x80u) {
            out.push_back(static_cast<char>(c));
            ++i;
            continue;
        }
        int len = 0;
        uint32_t cp = 0;
        if ((c & 0xE0u) == 0xC0u) {
            len = 2;
            cp = c & 0x1Fu;
        } else if ((c & 0xF0u) == 0xE0u) {
            len = 3;
            cp = c & 0x0Fu;
        } else if ((c & 0xF8u) == 0xF0u) {
            len = 4;
            cp = c & 0x07u;
        } else {
            out.append(repl, 3);
            ++i;
            continue;
        }
        if (i + static_cast<size_t>(len) > n) {
            out.append(repl, 3);
            ++i;
            continue;
        }
        bool bad = false;
        for (int j = 1; j < len; ++j) {
            const unsigned char d = static_cast<unsigned char>(in[i + static_cast<size_t>(j)]);
            if ((d & 0xC0u) != 0x80u) {
                bad = true;
                break;
            }
            cp = (cp << 6) | (d & 0x3Fu);
        }
        if (bad) {
            out.append(repl, 3);
            ++i;
            continue;
        }
        if (len == 2 && cp < 0x80u) {
            out.append(repl, 3);
            ++i;
            continue;
        }
        if (len == 3 && cp < 0x800u) {
            out.append(repl, 3);
            ++i;
            continue;
        }
        if (len == 4 && cp < 0x10000u) {
            out.append(repl, 3);
            ++i;
            continue;
        }
        if (cp >= 0xD800u && cp <= 0xDFFF) {
            out.append(repl, 3);
            ++i;
            continue;
        }
        if (cp > 0x10FFFFu) {
            out.append(repl, 3);
            ++i;
            continue;
        }
        for (int j = 0; j < len; ++j) out.push_back(in[i + static_cast<size_t>(j)]);
        i += static_cast<size_t>(len);
    }
    return out;
}

/// Return the largest prefix length <= max_bytes that does not split a UTF-8
/// continuation sequence. Callers should sanitize first if the input may be
/// ill-formed.
inline size_t utf8_safe_prefix_len(const std::string& s, size_t max_bytes) {
    if (max_bytes >= s.size()) return s.size();
    size_t end = max_bytes;
    while (end > 0) {
        const unsigned char c = static_cast<unsigned char>(s[end]);
        if ((c & 0xC0u) != 0x80u) break;
        --end;
    }
    return end == 0 ? max_bytes : end;
}
