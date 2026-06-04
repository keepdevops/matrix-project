// #291 regression test: build_stream_setup must NEVER pass kv_bits to
// make_prompt_cache (it has no such kwarg — the bug threw TypeError and produced
// 0 tokens). 4-bit KV must be requested on the stream_generate() call instead.
//
// Pure codegen — no Python, no MLX. Validates the generated Python *source*.

#include "model_registry_prompt_cache_codegen.h"

#include <cassert>
#include <iostream>
#include <string>

using model_mem::build_stream_setup;

static bool contains(const std::string& hay, const std::string& needle) {
    return hay.find(needle) != std::string::npos;
}

int main() {
    const std::string model = "mlx-community/Llama-3.2-3B";
    const std::string prompt = "hello";
    const std::string sid = "sess-1";

    // 1. Quantized cache path: make_prompt_cache stays PLAIN; kv_bits goes on the
    //    generation call. This is the core #291 guard.
    {
        std::string code = build_stream_setup(model, prompt, /*max_tokens=*/64,
            /*use_cache=*/true, sid, /*min_ctx=*/8, /*quantized=*/true,
            /*idle_secs=*/600);
        assert(contains(code, "make_prompt_cache(_m)"));
        // The bug: kv_bits passed to make_prompt_cache. Must never happen.
        assert(!contains(code, "make_prompt_cache(_m,"));
        assert(!contains(code, "make_prompt_cache(_m ,"));
        // kv_bits must ride on stream_generate, paired with quantized_kv_start.
        assert(contains(code, "kv_bits=4, quantized_kv_start=0"));
        assert(contains(code, "stream_generate"));
        const auto gen = code.find("stream_generate");
        assert(code.find("kv_bits=4", gen) != std::string::npos);
    }

    // 2. Non-quantized cache path: no kv_bits anywhere; cache still plain.
    {
        std::string code = build_stream_setup(model, prompt, 64, true, sid, 8,
            /*quantized=*/false, 600);
        assert(contains(code, "make_prompt_cache(_m)"));
        assert(!contains(code, "kv_bits"));
        assert(!contains(code, "quantized_kv_start"));
    }

    // 3. Cache-off path: stateless, no prompt_cache / kv_bits at all.
    {
        std::string code = build_stream_setup(model, prompt, 64,
            /*use_cache=*/false, sid, 8, /*quantized=*/true, 600);
        assert(!contains(code, "make_prompt_cache"));
        assert(!contains(code, "prompt_cache="));
        assert(!contains(code, "kv_bits"));
        assert(contains(code, "stream_generate"));
    }

    // 4. Single-quote in prompt is escaped (no broken Python literal).
    {
        std::string code = build_stream_setup(model, "it's a test", 64, true,
            sid, 8, false, 600);
        assert(contains(code, "it\\'s a test"));
    }

    std::cout << "\xE2\x9C\x85 test_prompt_cache_codegen: all assertions passed\n";
    return 0;
}
