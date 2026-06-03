#include "model_registry.h"
#include "paged_kv_cache.h"
#include "flash_attention_wrapper.h"

#include <cassert>
#include <iostream>

int main() {
    auto& reg = model_mem::ModelRegistry::instance();
    assert(reg.acquire("mlx-community/Llama-3.2-3B", "4bit"));
    assert(reg.acquire("mlx-community/Llama-3.2-3B", "4bit"));
    assert(reg.resident_count() == 1);
    auto snap = reg.snapshot();
    assert(snap["resident_count"].get<int>() == 1);
    assert(snap["models"].is_array() && snap["models"].size() == 1);
    reg.release("mlx-community/Llama-3.2-3B", "4bit");
    assert(reg.resident_count() == 1);
    reg.release("mlx-community/Llama-3.2-3B", "4bit");
    assert(reg.resident_count() == 0);

    model_mem::PagedKVCache kv(128);
    assert(kv.allocate_pages(4));
    assert(kv.page_count() == 4);
    kv.reset();
    assert(kv.page_count() == 0);

    model_mem::FlashAttentionWrapper fa({true, 128});
    assert(!fa.available());
    assert(!fa.forward_stub("probe"));

    std::cout << "test_model_registry: OK\n";
    return 0;
}
