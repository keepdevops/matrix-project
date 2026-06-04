#ifdef MATRIX_MLX_EMBED
// MS-68: in-process MLX generation for model_mem::ModelRegistry (interpreter
// lifecycle, serialized GPU lane, PyIter_Next streaming; from MS-161). 2c′-B
// delegates prompt-cache session management to model_registry_prompt_cache.cpp.

#include "model_registry.h"
#include "model_registry_prompt_cache.h"
#include "model_idle_policy.h"   // #297: pure idle-eviction predicate
#include "rss_generator.h"

#include <Python.h>

#include <atomic>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace model_mem {
namespace {

// ── Interpreter lifecycle ─────────────────────────────────────────────────────
// Init once, then release the GIL so httplib worker threads can PyGILState_Ensure.
bool        g_init = false;
std::mutex  g_init_mu;
std::mutex  g_lane_mu;   // serializes ALL generation (one GPU — MS-160)

// MS-68 2c′: per-session prompt-cache reuse config (default OFF).
std::atomic<bool> g_pc_enabled{false};
std::atomic<int>  g_pc_min_ctx{1024};
std::atomic<bool> g_pc_quantized{false};
std::atomic<int>  g_pc_idle_secs{600};

// #297: resident-model idle eviction window (seconds). evict_idle() reclaims
// models unused longer than this. Triggered opportunistically from the MLX
// routes (see coordinator_routes_mlx.cpp).
std::atomic<int>  g_model_idle_secs{600};

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
    PyEval_SaveThread();   // never use the main thread for Python again
    g_init = true;
}

// Run code, return str(result_var). MUST hold the GIL.
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

}  // namespace

void ModelRegistry::note_generation(const std::string& model_id,
                                    const std::string& quant,
                                    const std::string& agent_name) {
    const ModelKey key{model_id, quant.empty() ? "default" : quant};
    bool first_load = false;
    {
        std::lock_guard<std::mutex> lk(mu_);
        auto& e = entries_[key];
        first_load = (e.gen_calls == 0);
        e.agents_seen.insert(agent_name);
        e.gen_calls += 1;
        e.last_used = std::chrono::steady_clock::now();
    }
    if (first_load) {
        rss_generator::publish(rss_generator::Category::History,
            "MLX model loaded: " + model_id,
            "quant=" + (quant.empty() ? "default" : quant)
            + " agent=" + agent_name);
    }
}

GenResult ModelRegistry::generate(const Agent& agent, const std::string& prompt,
                                  int max_tokens) {
    GenResult r;
    const std::string model_path = agent.model;
    if (model_path.empty()) { r.error = "agent has no model path"; return r; }

    std::lock_guard<std::mutex> lane(g_lane_mu);
    try {
        ensure_interp();
        PyGILState_STATE gil = PyGILState_Ensure();

        std::ostringstream code;
        code << "import time as _t, mlx_lm as _mlxlm\n"
             << "globals().setdefault('__mlx_reg__', {})\n"
             << "_p = '" << esc(model_path) << "'\n"
             << "if _p not in __mlx_reg__:\n"
             << "    __mlx_reg__[_p] = _mlxlm.load(_p)\n"
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
            r.n_tokens = std::stoi(meta.substr(0, comma));
            const double ms = std::stod(meta.substr(comma + 1));
            r.tok_s = ms > 0 ? r.n_tokens / (ms / 1000.0) : 0.0;
        }
        r.ok = !r.text.empty();
        if (!r.ok) r.error = "empty generation (see stderr)";
    } catch (const std::exception& e) {
        r.error = e.what();
    }

    note_generation(model_path, agent.quant, agent.name);
    return r;
}

// build_stream_setup() moved to model_registry_prompt_cache.cpp (MS-68 2c′-B).

GenResult ModelRegistry::generate_stream(const Agent& agent, const std::string& prompt,
                                         int max_tokens, const OnToken& on_token,
                                         const std::string& session_id) {
    GenResult r;
    const std::string model_path = agent.model;
    if (model_path.empty()) { r.error = "agent has no model path"; return r; }
    const bool use_cache = g_pc_enabled.load() && !session_id.empty();

    std::lock_guard<std::mutex> lane(g_lane_mu);
    try {
        ensure_interp();
        PyGILState_STATE gil = PyGILState_Ensure();

        const std::string code = build_stream_setup(
            model_path, prompt, max_tokens, use_cache, session_id,
            g_pc_min_ctx.load(), g_pc_quantized.load(), g_pc_idle_secs.load());

        PyObject* main_mod  = PyImport_AddModule("__main__");
        PyObject* main_dict = PyModule_GetDict(main_mod);
        PyObject* ret = PyRun_String(code.c_str(), Py_file_input, main_dict, main_dict);
        if (!ret) { PyErr_Print(); PyGILState_Release(gil); r.error = "stream setup failed"; return r; }
        Py_DECREF(ret);

        // Sync the C++ session counter to the true live size (#291: absolute,
        // not a delta — opportunistic eviction can't make it drift).
        if (use_cache) {
            PyObject* sz = PyDict_GetItemString(main_dict, "__reg_sess_size__");
            if (sz) set_session_count(static_cast<int>(PyLong_AsLong(sz)));
        }

        PyObject* gen = PyDict_GetItemString(main_dict, "__reg_stream__");  // borrowed
        if (!gen) { PyGILState_Release(gil); r.error = "generator not created"; return r; }
        Py_INCREF(gen);

        std::string assembled;
        int n_tok = 0;     // non-empty text chunks (client-visible)
        int n_steps = 0;   // total generated tokens (cache bookkeeping)
        PyObject* item = nullptr;
        while ((item = PyIter_Next(gen)) != nullptr) {
            ++n_steps;
            PyObject* tattr = PyObject_GetAttrString(item, "text");
            if (tattr) {
                const char* tc = PyUnicode_AsUTF8(tattr);
                if (tc && tc[0]) {
                    const std::string delta(tc);
                    assembled += delta;
                    ++n_tok;
                    on_token(delta);
                }
                Py_DECREF(tattr);
            }
            Py_DECREF(item);
        }
        Py_DECREF(gen);
        if (PyErr_Occurred()) { PyErr_Print(); }
        PyDict_DelItemString(main_dict, "__reg_stream__");

        // 2c′: drop generated tokens so the cache holds exactly the prompt KV.
        if (use_cache) {
            std::ostringstream fin;
            fin << "if __mlx_sess__.get('" << esc(session_id) << "') is not None and "
                << n_steps << " > 0:\n"
                << "    from mlx_lm.models.cache import trim_prompt_cache, can_trim_prompt_cache\n"
                << "    _c = __mlx_sess__['" << esc(session_id) << "'][0]\n"
                << "    if can_trim_prompt_cache(_c): trim_prompt_cache(_c, " << n_steps << ")\n";
            PyObject* fr = PyRun_String(fin.str().c_str(), Py_file_input, main_dict, main_dict);
            if (!fr) PyErr_Print(); else Py_DECREF(fr);
        }
        PyGILState_Release(gil);

        r.text     = assembled;
        r.n_tokens = n_tok;
        r.ok       = !assembled.empty();
        if (!r.ok && r.error.empty()) r.error = "empty stream (see stderr)";
    } catch (const std::exception& e) {
        r.error = e.what();
    }

    note_generation(model_path, agent.quant, agent.name);
    return r;
}

void configure_prompt_cache(bool enabled, int min_ctx_tokens,
                            bool quantized, int idle_secs) {
    g_pc_enabled.store(enabled);
    g_pc_min_ctx.store(min_ctx_tokens > 0 ? min_ctx_tokens : 1024);
    g_pc_quantized.store(quantized);
    g_pc_idle_secs.store(idle_secs > 0 ? idle_secs : 600);
}

void configure_model_idle(int idle_secs) {
    g_model_idle_secs.store(idle_secs > 0 ? idle_secs : 600);
}

int model_idle_secs() { return g_model_idle_secs.load(); }

int ModelRegistry::evict_idle(int max_idle_secs) {
    std::vector<ModelKey> stale;
    {
        std::lock_guard<std::mutex> lk(mu_);
        const auto now = std::chrono::steady_clock::now();
        for (auto& [key, e] : entries_) {
            const double idle = std::chrono::duration<double>(now - e.last_used).count();
            if (model_idle_evictable(e.gen_calls, idle, max_idle_secs))
                stale.push_back(key);
        }
    }
    if (stale.empty() && !g_pc_enabled.load()) return 0;

    std::lock_guard<std::mutex> lane(g_lane_mu);
    ensure_interp();
    PyGILState_STATE gil = PyGILState_Ensure();
    for (const auto& key : stale) {
        std::ostringstream code;
        code << "globals().setdefault('__mlx_reg__', {}).pop('"
             << esc(key.model_id) << "', None)\n"
             << "__reg_evicted__ = '1'\n";
        py_run_read(code.str().c_str(), "__reg_evicted__");
    }
    // MS-68 2c′-B: also evict idle prompt-cache sessions.
    if (g_pc_enabled.load())
        evict_prompt_cache_sessions(g_pc_idle_secs.load());
    PyGILState_Release(gil);

    {
        std::lock_guard<std::mutex> lk(mu_);
        for (const auto& key : stale) entries_.erase(key);
    }
    for (const auto& key : stale) {
        rss_generator::publish(rss_generator::Category::History,
            "MLX model evicted: " + key.model_id,
            "quant=" + key.quant + " reason=idle");
    }
    return static_cast<int>(stale.size());
}

}  // namespace model_mem

#endif  // MATRIX_MLX_EMBED
