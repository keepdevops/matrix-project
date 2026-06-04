#pragma once
// #297: resident-model idle-eviction decision — PURE policy, no Python/MLX.
//
// Extracted from ModelRegistry::evict_idle() so the decision semantics can be
// unit-tested without embedding CPython. evict_idle()'s remaining work (popping
// the resident dict, publishing the RSS event) needs the GIL; this predicate is
// the part that decides *whether* an entry is reclaimable.
//
// Note: this guards the eviction *semantics*, not the wiring. The original #297
// bug was that evict_idle() was never *called* from the request path — that is an
// integration concern (live coordinator), not unit-testable here.

namespace model_mem {

// A resident model is reclaimable iff it has actually generated at least once
// (gen_calls > 0 — models only acquired for accounting are not in-process and
// have nothing to free) AND it has been idle strictly longer than the window.
inline bool model_idle_evictable(long gen_calls, double idle_secs,
                                 int max_idle_secs) {
    return gen_calls > 0 && idle_secs > static_cast<double>(max_idle_secs);
}

}  // namespace model_mem
