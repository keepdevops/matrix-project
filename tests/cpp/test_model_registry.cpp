#include "model_registry.h"
#include "model_idle_policy.h"

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

    // #297: idle-eviction decision semantics (the predicate evict_idle() uses).
    using model_mem::model_idle_evictable;
    // A model that has generated and sat idle past the window → reclaimable.
    assert(model_idle_evictable(/*gen_calls=*/3, /*idle=*/120.0, /*max=*/60));
    // Generated but still within the window → keep.
    assert(!model_idle_evictable(3, 30.0, 60));
    // Never generated (accounting-only acquire) → never reclaim, however idle.
    assert(!model_idle_evictable(0, 9999.0, 60));
    // Boundary is strict (idle == max is not yet stale).
    assert(!model_idle_evictable(1, 60.0, 60));
    assert(model_idle_evictable(1, 60.0001, 60));

    std::cout << "test_model_registry: OK\n";
    return 0;
}
