#ifdef MATRIX_MLX_EMBED
// MS-68 2c′-B: prompt-cache session management.

#include "model_registry_prompt_cache.h"

#include <Python.h>
#include <atomic>
#include <sstream>

namespace model_mem {
namespace {

std::atomic<int> g_sess_count{0};

// Shared esc() — duplicated from embed.cpp to avoid a shared header dependency.
std::string pc_esc(const std::string& s) {
    std::string o; o.reserve(s.size() + 8);
    for (char c : s) {
        if      (c == '\\') o += "\\\\";
        else if (c == '\'') o += "\\'";
        else if (c == '\n') o += "\\n";
        else                o += c;
    }
    return o;
}

}  // namespace

std::string build_stream_setup(const std::string& model_path,
                               const std::string& prompt, int max_tokens,
                               bool use_cache, const std::string& session_id,
                               int min_ctx, bool quantized, int idle_secs) {
    std::ostringstream c;
    c << "import mlx_lm as _mlxlm\n"
      << "globals().setdefault('__mlx_reg__', {})\n"
      << "_p = '" << pc_esc(model_path) << "'\n"
      << "if _p not in __mlx_reg__:\n"
      << "    __mlx_reg__[_p] = _mlxlm.load(_p)\n"
      << "_m, _tk = __mlx_reg__[_p]\n";

    if (!use_cache) {
        c << "__reg_persist__ = 0; __reg_sess_delta__ = 0\n"
          << "__reg_stream__ = _mlxlm.stream_generate(_m, _tk, prompt='"
          << pc_esc(prompt) << "', max_tokens=" << max_tokens << ")\n";
        return c.str();
    }

    // Session prompt-cache path with LRU eviction and optional QuantizedKVCache.
    const std::string make_cache = quantized
        ? "make_prompt_cache(_m, kv_bits=4)"
        : "make_prompt_cache(_m)";

    c << "import sys as _sys, time as _t\n"
      << "from mlx_lm.models.cache import (make_prompt_cache, trim_prompt_cache,"
         " can_trim_prompt_cache)\n"
      << "globals().setdefault('__mlx_sess__', {})\n"
      << "globals().setdefault('__mlx_sess_ts__', {})\n"
      // Opportunistic eviction of idle sessions.
      << "_evict_before = _t.monotonic() - " << idle_secs << "\n"
      << "for _ek in list(__mlx_sess_ts__):\n"
      << "    if __mlx_sess_ts__[_ek] < _evict_before:\n"
      << "        __mlx_sess__.pop(_ek, None); del __mlx_sess_ts__[_ek]\n"
      << "_sid = '" << pc_esc(session_id) << "'\n"
      << "_full = list(_tk.encode('" << pc_esc(prompt) << "'))\n"
      << "__reg_sess_delta__ = 0\n"
      << "if len(_full) < " << min_ctx << ":\n"
      << "    __mlx_sess__.pop(_sid, None); __mlx_sess_ts__.pop(_sid, None)\n"
      << "    _cache = " << make_cache << "; _feed = _full; __reg_persist__ = 0\n"
      << "else:\n"
      << "    _ent = __mlx_sess__.get(_sid)\n"
      << "    if _ent is None:\n"
      << "        _cache = " << make_cache << "; _feed = _full; _lcp = 0\n"
      << "        __reg_sess_delta__ = 1\n"  // new session created
      << "    else:\n"
      << "        _cache, _cached = _ent\n"
      << "        _lcp = 0; _nn = min(len(_cached), len(_full))\n"
      << "        while _lcp < _nn and _cached[_lcp] == _full[_lcp]: _lcp += 1\n"
      << "        _tr = len(_cached) - _lcp\n"
      << "        if _tr > 0 and can_trim_prompt_cache(_cache):"
         " trim_prompt_cache(_cache, _tr)\n"
      << "        _feed = _full[_lcp:]\n"
      << "    if not _feed:\n"
      << "        if can_trim_prompt_cache(_cache): trim_prompt_cache(_cache, 1)\n"
      << "        _feed = _full[-1:]\n"
      << "    __mlx_sess__[_sid] = [_cache, _full]\n"
      << "    __mlx_sess_ts__[_sid] = _t.monotonic()\n"
      << "    __reg_persist__ = 1\n"
      << "    print('matrix pc sid=%s ctx=%d delta=%d' % (_sid, len(_full),"
         " len(_feed)), file=_sys.stderr)\n"
      << "__reg_stream__ = _mlxlm.stream_generate(_m, _tk, prompt=_feed,"
         " max_tokens=" << max_tokens << ", prompt_cache=_cache)\n";
    return c.str();
}

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
    return evicted;
}

int prompt_cache_session_count() {
    return g_sess_count.load();
}

void update_session_count(int delta) {
    g_sess_count.fetch_add(delta);
}

}  // namespace model_mem
#endif  // MATRIX_MLX_EMBED
