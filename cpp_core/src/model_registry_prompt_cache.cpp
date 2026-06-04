#ifdef MATRIX_MLX_EMBED
// MS-68 2c′-B: prompt-cache session management.

#include "model_registry_prompt_cache.h"
#include "model_registry_prompt_cache_codegen.h"  // build_stream_setup (pure)
#include "rss_generator.h"

#include <Python.h>
#include <atomic>

namespace model_mem {
namespace {

std::atomic<int> g_sess_count{0};

}  // namespace

// build_stream_setup() lives in model_registry_prompt_cache_codegen.cpp — it is
// pure string codegen (no Python), kept apart so it can be unit-tested without
// embedding CPython (see #291 regression test).

int evict_prompt_cache_sessions(int idle_secs) {
    const std::string code =
        "import time as _t\n"
        "globals().setdefault('__mlx_sess__', {})\n"
        "globals().setdefault('__mlx_sess_ts__', {})\n"
        "_before = _t.monotonic() - " + std::to_string(idle_secs) + "\n"
        "_evicted = [k for k,ts in list(__mlx_sess_ts__.items()) if ts < _before]\n"
        "for _ek in _evicted:\n"
        "    __mlx_sess__.pop(_ek, None); del __mlx_sess_ts__[_ek]\n"
        "__reg_evicted_sess__ = len(_evicted)\n"
        "__reg_sess_remaining__ = len(__mlx_sess__)\n";

    PyObject* m = PyImport_AddModule("__main__");
    PyObject* d = PyModule_GetDict(m);
    PyObject* r = PyRun_String(code.c_str(), Py_file_input, d, d);
    if (!r) { PyErr_Print(); return 0; }
    Py_DECREF(r);

    int evicted = 0, remaining = 0;
    PyObject* ev = PyDict_GetItemString(d, "__reg_evicted_sess__");
    if (ev) evicted = static_cast<int>(PyLong_AsLong(ev));
    PyObject* rm = PyDict_GetItemString(d, "__reg_sess_remaining__");
    if (rm) remaining = static_cast<int>(PyLong_AsLong(rm));

    g_sess_count.store(remaining);
    if (evicted > 0) {
        rss_generator::publish(rss_generator::Category::TokenRegulation,
            "Prompt-cache sessions evicted: " + std::to_string(evicted),
            "remaining=" + std::to_string(remaining)
            + " idle_secs=" + std::to_string(idle_secs));
    }
    return evicted;
}

int prompt_cache_session_count() {
    return g_sess_count.load();
}

void set_session_count(int n) {
    g_sess_count.store(n);
}

}  // namespace model_mem
#endif  // MATRIX_MLX_EMBED
