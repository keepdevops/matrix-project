// #302 regression test: agent_stream::sse::capture_last_json_data must keep the
// last JSON `data:` frame (timings/usage) and never let a trailing `data: [DONE]`
// frame clobber it — the bug that made MS-72 streaming token accounting a no-op.

#include "agent_stream_sse.h"

#include <cassert>
#include <iostream>
#include <string>

using agent_stream::sse::capture_last_json_data;

int main() {
    // 1. Standard llama stream: content → timings frame → separate [DONE] frame.
    {
        std::string ld;
        capture_last_json_data("data: {\"content\":\" x\",\"stop\":false}\n\n", ld);
        capture_last_json_data(
            "data: {\"stop\":true,\"timings\":{\"tokens_evaluated\":12,\"tokens_predicted\":8}}\n\n", ld);
        capture_last_json_data("data: [DONE]\n\n", ld);  // must NOT clobber timings
        assert(ld.find("timings") != std::string::npos);
        assert(ld.find("[DONE]") == std::string::npos);
    }
    // 2. OpenAI-style usage frame then [DONE], both in one chunk.
    {
        std::string ld;
        capture_last_json_data(
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":7}}\ndata: [DONE]\n", ld);
        assert(ld.find("usage") != std::string::npos);
        assert(ld.find("[DONE]") == std::string::npos);
    }
    // 3. [DONE]-only chunk leaves last_data empty (→ caller falls back to estimate).
    {
        std::string ld;
        capture_last_json_data("data: [DONE]\n\n", ld);
        assert(ld.empty());
    }
    // 4. Multiple JSON frames in one chunk → keep the last.
    {
        std::string ld;
        capture_last_json_data("data: {\"a\":1}\n\ndata: {\"b\":2}\n\n", ld);
        assert(ld == "{\"b\":2}");
    }
    // 5. CRLF line endings handled.
    {
        std::string ld;
        capture_last_json_data("data: {\"timings\":{\"tokens_predicted\":3}}\r\ndata: [DONE]\r\n", ld);
        assert(ld.find("timings") != std::string::npos && ld.find("[DONE]") == std::string::npos);
    }

    std::cout << "\xE2\x9C\x85 test_sse_usage_capture: all assertions passed\n";
    return 0;
}
