#ifdef MATRIX_MLX_EMBED
// MS-152: CPython-embedded mlx_lm.generate spike.
// MS-153: warm/cold/steady-state benchmark + RSS measurement.

#include "mlx_embed_generate.h"

// Python.h must be first when embedding CPython
#include <Python.h>

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <mach/mach.h>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace mlx_embed {

namespace {

std::string resolve_python_home(const std::string& explicit_home) {
    if (!explicit_home.empty()) return explicit_home;
    const char* env = std::getenv("MLX_ENV_PREFIX");
    if (env && env[0]) return env;
    const char* home = std::getenv("HOME");
    return home ? std::string(home) + "/miniforge3/envs/mlx-env" : "";
}

bool g_py_initialized = false;

void ensure_interpreter(const std::string& python_home) {
    if (g_py_initialized) return;
    if (python_home.empty())
        throw std::runtime_error("Cannot locate Python home for mlx-env");

    PyConfig config;
    PyConfig_InitPythonConfig(&config);

    wchar_t* whome = Py_DecodeLocale(python_home.c_str(), nullptr);
    if (!whome) throw std::runtime_error("Py_DecodeLocale failed for PYTHONHOME");
    PyConfig_SetString(&config, &config.home, whome);
    PyMem_RawFree(whome);

    PyStatus status = Py_InitializeFromConfig(&config);
    PyConfig_Clear(&config);
    if (PyStatus_Exception(status))
        throw std::runtime_error(std::string("Py_InitializeFromConfig: ")
                                 + (status.err_msg ? status.err_msg : "?"));
    g_py_initialized = true;
}

std::string run_and_read(const char* code, const char* result_var) {
    PyObject* main_mod  = PyImport_AddModule("__main__");
    PyObject* main_dict = PyModule_GetDict(main_mod);

    PyObject* ret = PyRun_String(code, Py_file_input, main_dict, main_dict);
    if (!ret) { PyErr_Print(); return ""; }
    Py_DECREF(ret);

    PyObject* val = PyDict_GetItemString(main_dict, result_var);
    if (!val) return "";
    PyObject* str_val = PyObject_Str(val);
    if (!str_val) return "";
    const char* s = PyUnicode_AsUTF8(str_val);
    std::string out = s ? s : "";
    Py_DECREF(str_val);
    return out;
}

std::string py_escape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 4);
    for (char c : s) {
        if      (c == '\\') out += "\\\\";
        else if (c == '\'') out += "\\'";
        else if (c == '\n') out += "\\n";
        else                out += c;
    }
    return out;
}

} // namespace

GenerateResult generate_via_python(const std::string& model_path,
                                   const std::string& prompt,
                                   int max_tokens,
                                   const std::string& python_home) {
    GenerateResult res;
    try {
        ensure_interpreter(resolve_python_home(python_home));

        // Run benchmark in Python; results written to __mlx_result__ (JSON string).
        std::ostringstream code;
        code << "import time as _t, json as _j\n"
             << "from mlx_lm import load as _load, generate as _gen\n"
             << "_t0 = _t.perf_counter()\n"
             << "_model, _tok = _load('" << py_escape(model_path) << "')\n"
             << "_load_ms = (_t.perf_counter() - _t0) * 1000\n"
             << "_t1 = _t.perf_counter()\n"
             << "_out = _gen(_model, _tok, prompt='"
             << py_escape(prompt) << "', max_tokens=" << max_tokens
             << ", verbose=False)\n"
             << "_elapsed_ms = (_t.perf_counter() - _t1) * 1000\n"
             << "_n = len(_tok.encode(_out))\n"
             << "_tok_s = _n / (_elapsed_ms / 1000.0) if _elapsed_ms > 0 else 0\n"
             << "__mlx_result__ = _j.dumps({"
             << "'n_tokens': _n, 'load_ms': _load_ms, "
             << "'elapsed_ms': _elapsed_ms, 'tok_s': _tok_s, 'output': _out"
             << "})\n";

        const std::string raw = run_and_read(code.str().c_str(), "__mlx_result__");
        if (raw.empty()) {
            res.error = "Python code produced no result (see stderr for traceback)";
            return res;
        }

        // Parse the JSON result back via Python to avoid a C++ JSON dependency.
        std::string eval_code =
            "import json as _jj\n"
            "__pd__ = _jj.loads('" + py_escape(raw) + "')\n"
            "__pd_n__   = str(__pd__['n_tokens'])\n"
            "__pd_lms__ = str(__pd__['load_ms'])\n"
            "__pd_ems__ = str(__pd__['elapsed_ms'])\n"
            "__pd_ts__  = str(__pd__['tok_s'])\n"
            "__pd_out__ = __pd__['output']\n";

        run_and_read(eval_code.c_str(), "__pd_n__");
        res.n_tokens   = std::stoi(run_and_read("pass", "__pd_n__"));
        res.load_ms    = std::stod(run_and_read("pass", "__pd_lms__"));
        res.elapsed_ms = std::stod(run_and_read("pass", "__pd_ems__"));
        res.tok_s      = std::stod(run_and_read("pass", "__pd_ts__"));
        res.output     = run_and_read("pass", "__pd_out__");
        res.ok = true;
    } catch (const std::exception& e) {
        res.error = e.what();
    }
    return res;
}

// ── MS-153: warm/cold benchmark + RSS ─────────────────────────────────────────

double current_rss_mb() {
    mach_task_basic_info info;
    mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
    kern_return_t kr = task_info(mach_task_self(), MACH_TASK_BASIC_INFO,
                                 reinterpret_cast<task_info_t>(&info), &count);
    if (kr != KERN_SUCCESS) return 0.0;
    return static_cast<double>(info.resident_size) / (1024.0 * 1024.0);
}

double BenchResult::steady_state() const {
    if (iter_tok_s.size() < 2) return cold();
    // Median of the warm tail (drop iteration 0 — it pays cold-cache cost).
    std::vector<double> warm(iter_tok_s.begin() + 1, iter_tok_s.end());
    std::sort(warm.begin(), warm.end());
    const size_t n = warm.size();
    return (n % 2) ? warm[n / 2] : (warm[n / 2 - 1] + warm[n / 2]) / 2.0;
}

BenchResult benchmark_via_python(const std::string& model_path,
                                 const std::string& prompt,
                                 int max_tokens,
                                 int iterations,
                                 const std::string& python_home) {
    BenchResult res;
    if (iterations < 1) iterations = 1;
    try {
        ensure_interpreter(resolve_python_home(python_home));

        // Load once, then loop generate() N times in the same interpreter so
        // the model + Metal kernels stay warm across iterations.
        std::ostringstream code;
        code << "import time as _t, json as _j, resource as _r\n"
             << "from mlx_lm import load as _load, generate as _gen\n"
             << "_t0 = _t.perf_counter()\n"
             << "_model, _tok = _load('" << py_escape(model_path) << "')\n"
             << "_load_ms = (_t.perf_counter() - _t0) * 1000\n"
             << "_iters = []\n_rss = []\n_first = None\n_last = None\n"
             << "for _i in range(" << iterations << "):\n"
             << "    _s = _t.perf_counter()\n"
             << "    _o = _gen(_model, _tok, prompt='" << py_escape(prompt)
             << "', max_tokens=" << max_tokens << ", verbose=False)\n"
             << "    _e = (_t.perf_counter() - _s) * 1000\n"
             << "    _n = len(_tok.encode(_o))\n"
             << "    _iters.append(_n / (_e/1000.0) if _e > 0 else 0)\n"
             // MS-161 Phase A: peak RSS (bytes on macOS) per iteration — leak signal
             << "    _rss.append(_r.getrusage(_r.RUSAGE_SELF).ru_maxrss)\n"
             // keep only first + last output (bounded memory; determinism check)
             << "    _first = _o if _first is None else _first\n"
             << "    _last = _o\n"
             << "_step = max(1, len(_rss)//12)\n"
             << "__mlx_result__ = _j.dumps({"
             << "'load_ms': _load_ms, "
             << "'iter_tok_s': ','.join('%.4f' % x for x in _iters), "
             << "'rss_series': ','.join(str(x) for x in _rss[::_step]), "
             << "'rss_first': _rss[0], 'rss_last': _rss[-1], "
             << "'n_tokens': len(_tok.encode(_last)), "
             << "'deterministic': (_last == _first), "
             << "'output': _last})\n";

        const std::string raw = run_and_read(code.str().c_str(), "__mlx_result__");
        if (raw.empty()) {
            res.error = "Python benchmark produced no result (see stderr for traceback)";
            return res;
        }

        std::string eval_code =
            "import json as _jj\n"
            "__bd__ = _jj.loads('" + py_escape(raw) + "')\n"
            "__bd_lms__ = str(__bd__['load_ms'])\n"
            "__bd_its__ = __bd__['iter_tok_s']\n"
            "__bd_n__   = str(__bd__['n_tokens'])\n"
            "__bd_det__ = '1' if __bd__['deterministic'] else '0'\n"
            "__bd_rf__ = str(__bd__['rss_first'])\n"
            "__bd_rl__ = str(__bd__['rss_last'])\n"
            "__bd_out__ = __bd__['output']\n";
        run_and_read(eval_code.c_str(), "__bd_lms__");

        res.load_ms       = std::stod(run_and_read("pass", "__bd_lms__"));
        res.n_tokens      = std::stoi(run_and_read("pass", "__bd_n__"));
        res.deterministic = run_and_read("pass", "__bd_det__") == "1";
        // ru_maxrss is bytes on macOS — convert to MB
        res.rss_first_mb  = std::stod(run_and_read("pass", "__bd_rf__")) / 1e6;
        res.rss_last_mb   = std::stod(run_and_read("pass", "__bd_rl__")) / 1e6;
        res.output        = run_and_read("pass", "__bd_out__");

        // Parse the comma-separated per-iteration tok/s list.
        const std::string its = run_and_read("pass", "__bd_its__");
        std::stringstream ss(its);
        std::string tok;
        while (std::getline(ss, tok, ',')) {
            if (!tok.empty()) res.iter_tok_s.push_back(std::stod(tok));
        }

        res.rss_mb = current_rss_mb();  // measured with model resident
        res.ok = !res.iter_tok_s.empty();
        if (!res.ok) res.error = "no iterations recorded";
    } catch (const std::exception& e) {
        res.error = e.what();
    }
    return res;
}

// ── MS-160: concurrency efficiency ────────────────────────────────────────────

namespace {
double percentile(std::vector<double> v, double pct) {
    if (v.empty()) return 0.0;
    std::sort(v.begin(), v.end());
    const double rank = (pct / 100.0) * (v.size() - 1);
    const size_t lo = static_cast<size_t>(rank);
    const size_t hi = std::min(lo + 1, v.size() - 1);
    return v[lo] + (rank - lo) * (v[hi] - v[lo]);
}
}  // namespace

double ConcurrencyResult::per_stream_p50() const { return percentile(per_stream_tok_s, 50); }
double ConcurrencyResult::per_stream_p95() const { return percentile(per_stream_tok_s, 95); }

ConcurrencyResult concurrency_benchmark(const std::string& model_path,
                                        const std::string& prompt,
                                        int max_tokens,
                                        int n_threads,
                                        const std::string& python_home) {
    ConcurrencyResult res;
    if (n_threads < 1) n_threads = 1;
    res.n_threads = n_threads;
    try {
        ensure_interpreter(resolve_python_home(python_home));

        // Load model once + warm Metal kernels (main thread holds the GIL here).
        std::ostringstream load;
        load << "import time as _t\n"
             << "from mlx_lm import load as _load, generate as _gen\n"
             << "_t0 = _t.perf_counter()\n"
             << "_model, _tok = _load('" << py_escape(model_path) << "')\n"
             << "_load_ms = (_t.perf_counter() - _t0) * 1000\n"
             << "_ = _gen(_model, _tok, prompt='" << py_escape(prompt)
             << "', max_tokens=8, verbose=False)\n";
        run_and_read(load.str().c_str(), "_load_ms");
        res.load_ms = std::stod(run_and_read("pass", "_load_ms"));

        // Release the main-thread GIL so worker threads can each acquire it.
        PyThreadState* main_save = PyEval_SaveThread();

        std::vector<double> tok_s(n_threads, 0.0);
        std::vector<int>    ntok(n_threads, 0);

        auto worker = [&](int idx) {
            PyGILState_STATE gil = PyGILState_Ensure();
            // Per-thread var names: PyRun_String calls interleave whenever
            // generate() yields the GIL during Metal compute, so shared names
            // would race. Result packed as "ntokens,elapsed_ms".
            std::ostringstream code;
            code << "import time as _tt\n"
                 << "_s" << idx << " = _tt.perf_counter()\n"
                 << "_o" << idx << " = _gen(_model, _tok, prompt='"
                 << py_escape(prompt) << "', max_tokens=" << max_tokens
                 << ", verbose=False)\n"
                 << "_e" << idx << " = (_tt.perf_counter() - _s" << idx << ") * 1000\n"
                 << "_n" << idx << " = len(_tok.encode(_o" << idx << "))\n"
                 << "_r" << idx << " = '%d,%f' % (_n" << idx << ", _e" << idx << ")\n";
            const std::string key = "_r" + std::to_string(idx);
            const std::string r = run_and_read(code.str().c_str(), key.c_str());
            PyGILState_Release(gil);

            const auto comma = r.find(',');
            if (comma != std::string::npos) {
                const int    n   = std::stoi(r.substr(0, comma));
                const double ems = std::stod(r.substr(comma + 1));
                ntok[idx]  = n;
                tok_s[idx] = ems > 0 ? n / (ems / 1000.0) : 0.0;
            }
        };

        const auto wall0 = std::chrono::steady_clock::now();
        std::vector<std::thread> threads;
        threads.reserve(n_threads);
        for (int i = 0; i < n_threads; ++i) threads.emplace_back(worker, i);
        for (auto& th : threads) th.join();
        const auto wall1 = std::chrono::steady_clock::now();

        PyEval_RestoreThread(main_save);  // main thread reacquires the GIL

        res.wall_ms = std::chrono::duration<double, std::milli>(wall1 - wall0).count();
        res.per_stream_tok_s = tok_s;
        for (double x : tok_s) res.aggregate_tok_s += x;
        res.n_tokens = ntok.empty() ? 0 : ntok[0];
        res.rss_mb   = current_rss_mb();
        res.ok = std::all_of(tok_s.begin(), tok_s.end(), [](double x){ return x > 0; });
        if (!res.ok) res.error = "one or more streams produced no tokens";
    } catch (const std::exception& e) {
        res.error = e.what();
    }
    return res;
}

} // namespace mlx_embed

#endif // MATRIX_MLX_EMBED
