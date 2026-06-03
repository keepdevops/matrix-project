#ifdef MATRIX_MLX_EMBED
// MS-161 Phase B: in-process MLX model registry + serialized GPU lane.

#include "mlx_model_registry.h"

#include <Python.h>

#include <chrono>
#include <cstdlib>
#include <map>
#include <mutex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>

namespace mlx_inproc {
namespace {

// ── Interpreter lifecycle ─────────────────────────────────────────────────────
// Self-contained (this TU never co-links with mlx_embed_generate's generate
// path in one binary — the coordinator calls only the registry). Init once,
// then release the GIL so httplib worker threads can PyGILState_Ensure.
bool        g_init = false;
std::mutex  g_init_mu;

std::string resolve_home() {
    const char* env = std::getenv("MLX_ENV_PREFIX");
    if (env && env[0]) return env;
    const char* home = std::getenv("HOME");
    return home ? std::string(home) + "/miniforge3/envs/mlx-env" : "";
}

void ensure_interp() {
    std::lock_guard<std::mutex> lk(g_init_mu);
    if (g_init) return;
    const std::string home = resolve_home();
    if (home.empty()) throw std::runtime_error("MLX_ENV_PREFIX unset and no HOME");

    PyConfig config;
    PyConfig_InitPythonConfig(&config);
    wchar_t* whome = Py_DecodeLocale(home.c_str(), nullptr);
    if (!whome) throw std::runtime_error("Py_DecodeLocale failed");
    PyConfig_SetString(&config, &config.home, whome);
    PyMem_RawFree(whome);
    PyStatus st = Py_InitializeFromConfig(&config);
    PyConfig_Clear(&config);
    if (PyStatus_Exception(st))
        throw std::runtime_error(std::string("Py init: ")
                                 + (st.err_msg ? st.err_msg : "?"));
    // Release the GIL held by this (initializing) thread so worker threads can
    // acquire it via PyGILState_Ensure. We never use the main thread for Python
    // again — all access is lane-serialized through PyGILState.
    PyEval_SaveThread();
    g_init = true;
}

// Run code, return str(result_var). MUST hold the GIL (PyGILState_Ensure).
std::string py_run_read(const char* code, const char* result_var) {
    PyObject* m = PyImport_AddModule("__main__");
    PyObject* d = PyModule_GetDict(m);
    PyObject* ret = PyRun_String(code, Py_file_input, d, d);
    if (!ret) { PyErr_Print(); return ""; }
    Py_DECREF(ret);
    PyObject* v = PyDict_GetItemString(d, result_var);
    if (!v) return "";
    PyObject* sv = PyObject_Str(v);
    if (!sv) return "";
    const char* s = PyUnicode_AsUTF8(sv);
    std::string out = s ? s : "";
    Py_DECREF(sv);
    return out;
}

std::string esc(const std::string& s) {
    std::string o; o.reserve(s.size() + 8);
    for (char c : s) {
        if      (c == '\\') o += "\\\\";
        else if (c == '\'') o += "\\'";
        else if (c == '\n') o += "\\n";
        else                o += c;
    }
    return o;
}

// ── Registry state (C++ side metadata; models live resident in Python) ────────
struct ModelMeta {
    std::set<std::string> agents_seen;
    long                  calls = 0;
    std::chrono::steady_clock::time_point last_used = std::chrono::steady_clock::now();
};

std::mutex                        g_lane_mu;   // serializes ALL generation (one GPU)
std::mutex                        g_meta_mu;   // guards the metadata map
std::map<std::string, ModelMeta>  g_meta;

}  // namespace

GenResult MlxModelRegistry::generate(const Agent& agent,
                                     const std::string& prompt,
                                     int max_tokens) {
    GenResult r;
    const std::string model_path = agent.model;
    if (model_path.empty()) { r.error = "agent has no model path"; return r; }

    // The lane: one in-flight generation per process (MS-160 — no concurrency
    // benefit on a single GPU, and concurrent submission OOMs).
    std::lock_guard<std::mutex> lane(g_lane_mu);
    try {
        ensure_interp();
        PyGILState_STATE gil = PyGILState_Ensure();

        std::ostringstream code;
        code << "import time as _t, mlx_lm as _mlxlm\n"
             << "globals().setdefault('__mlx_reg__', {})\n"
             << "_p = '" << esc(model_path) << "'\n"
             << "if _p not in __mlx_reg__:\n"
             << "    __mlx_reg__[_p] = _mlxlm.load(_p)\n"   // load-once, resident
             << "_m, _tk = __mlx_reg__[_p]\n"
             << "_s = _t.perf_counter()\n"
             << "_o = _mlxlm.generate(_m, _tk, prompt='" << esc(prompt)
             << "', max_tokens=" << max_tokens << ", verbose=False)\n"
             << "_e = (_t.perf_counter() - _s) * 1000\n"
             << "_n = len(_tk.encode(_o))\n"
             << "__reg_out__ = _o\n"
             << "__reg_meta__ = '%d,%f' % (_n, _e)\n";

        r.text = py_run_read(code.str().c_str(), "__reg_out__");
        const std::string meta = py_run_read("pass", "__reg_meta__");
        PyGILState_Release(gil);

        const auto comma = meta.find(',');
        if (comma != std::string::npos) {
            r.n_tokens   = std::stoi(meta.substr(0, comma));
            const double ms = std::stod(meta.substr(comma + 1));
            r.tok_s = ms > 0 ? r.n_tokens / (ms / 1000.0) : 0.0;
        }
        r.ok = !r.text.empty();
        if (!r.ok) r.error = "empty generation (see stderr)";
    } catch (const std::exception& e) {
        r.error = e.what();
    }

    {
        std::lock_guard<std::mutex> mlk(g_meta_mu);
        auto& mm = g_meta[model_path];
        mm.agents_seen.insert(agent.name);
        mm.calls += 1;
        mm.last_used = std::chrono::steady_clock::now();
    }
    return r;
}

int MlxModelRegistry::evict_idle(int max_idle_secs) {
    std::vector<std::string> stale;
    {
        std::lock_guard<std::mutex> mlk(g_meta_mu);
        const auto now = std::chrono::steady_clock::now();
        for (auto& [path, mm] : g_meta) {
            const double idle = std::chrono::duration<double>(now - mm.last_used).count();
            if (idle > max_idle_secs) stale.push_back(path);
        }
    }
    if (stale.empty()) return 0;

    std::lock_guard<std::mutex> lane(g_lane_mu);   // touch Python under the lane
    ensure_interp();
    PyGILState_STATE gil = PyGILState_Ensure();
    for (const auto& path : stale) {
        std::ostringstream code;
        code << "globals().setdefault('__mlx_reg__', {}).pop('" << esc(path) << "', None)\n"
             << "__reg_evicted__ = '1'\n";
        py_run_read(code.str().c_str(), "__reg_evicted__");
    }
    PyGILState_Release(gil);

    std::lock_guard<std::mutex> mlk(g_meta_mu);
    for (const auto& path : stale) g_meta.erase(path);
    return static_cast<int>(stale.size());
}

int MlxModelRegistry::resident_count() const {
    std::lock_guard<std::mutex> mlk(g_meta_mu);
    return static_cast<int>(g_meta.size());
}

nlohmann::json MlxModelRegistry::snapshot() const {
    std::lock_guard<std::mutex> mlk(g_meta_mu);
    nlohmann::json arr = nlohmann::json::array();
    const auto now = std::chrono::steady_clock::now();
    for (const auto& [path, mm] : g_meta) {
        arr.push_back({
            {"model",       path},
            {"agents_seen", static_cast<int>(mm.agents_seen.size())},
            {"calls",       mm.calls},
            {"idle_secs",   static_cast<int>(
                std::chrono::duration<double>(now - mm.last_used).count())},
        });
    }
    return arr;
}

MlxModelRegistry& mlx_models() {
    static MlxModelRegistry reg;
    return reg;
}

}  // namespace mlx_inproc

#endif  // MATRIX_MLX_EMBED
