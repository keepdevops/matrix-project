// test_validate.cpp — exercises every rule in proxy_validate.h
// Build: c++ -std=c++17 -O0 -o test_validate test_validate.cpp proxy_validate.cpp -I.
// Run:   ./test_validate
//
// Uses real model files on disk as fixtures (no network required).
// docker backend tests are skipped if Docker Model Runner is not running.

#include "proxy_validate.h"
#include <iostream>
#include <fstream>
#include <cstring>
#include <sys/stat.h>
#include <unistd.h>

// ── test harness ──────────────────────────────────────────────────────────────

static int g_pass = 0, g_fail = 0;

static void check(const std::string& label,
                  bool expect_ok,
                  const std::string& result,
                  const std::string& expect_fragment = "") {
    bool ok = expect_ok ? result.empty() : !result.empty();
    if (!expect_fragment.empty() && !expect_ok)
        ok = ok && (result.find(expect_fragment) != std::string::npos);

    if (ok) {
        std::cout << "  PASS  " << label << "\n";
        ++g_pass;
    } else {
        std::cout << "  FAIL  " << label << "\n";
        if (!result.empty()) std::cout << "        got: " << result.substr(0, 120) << "\n";
        ++g_fail;
    }
}

// ── temp file helpers ─────────────────────────────────────────────────────────

static std::string tmp_dir() {
    char t[] = "/tmp/validate_test_XXXXXX";
    return mkdtemp(t) ? std::string(t) : "";
}

static void write_file(const std::string& path, const std::string& content) {
    std::ofstream f(path, std::ios::binary);
    f << content;
}

static void mkdir_p(const std::string& path) {
    mkdir(path.c_str(), 0755);
}

// Make a minimal valid MLX/vLLM directory under base_dir/name.
static std::string make_model_dir(const std::string& base,
                                   bool with_config   = true,
                                   bool with_weights  = true,
                                   bool with_tokenizer = true) {
    std::string d = base + "/model";
    mkdir_p(d);
    if (with_config)
        write_file(d + "/config.json",
            "{\"model_type\":\"llama\",\"max_position_embeddings\":8192}");
    if (with_weights)
        write_file(d + "/model.safetensors", "fake-weights");
    if (with_tokenizer) {
        write_file(d + "/tokenizer.json", "{}");
        write_file(d + "/tokenizer_config.json", "{}");
    }
    return d;
}

// ── fixtures ──────────────────────────────────────────────────────────────────

static const char* GOOD_GGUF  = "/Users/Shared/llama/models/gemma-2-2b-it-Q4_K_M.gguf";
static const char* FLUX_GGUF  = "/Users/Shared/llama/models/models/flux/flux1-schnell-Q4_0.gguf";
static const char* BAD_MAGIC  = "/Users/Shared/llama/models/models/gemma-2-2b.gguf";
static const char* GOOD_MLX   = "/Users/Shared/llama/models/Meta-Llama-3.1-8B-Instruct-4bit";
static const char* EMPTY_MLX  = "/Users/Shared/llama/models/granite-3.1-8b-instruct-4bit";
// Real python interpreter that has mlx_lm (adjust if your env differs)
static const char* MLX_PYTHON =
    "/Users/caribou/miniforge3/envs/mlx-env/bin/python3";
static const char* BAD_PYTHON = "/nonexistent/python3";

// ── llama rules ───────────────────────────────────────────────────────────────

static void test_llama() {
    std::cout << "\n[llama]\n";
    std::string tmp = tmp_dir();

    // Rule 1: file existence
    check("R1 pass — good GGUF exists",          true,  validate_model_exists(GOOD_GGUF));
    check("R1 fail — nonexistent path",           false, validate_model_exists("/no/such/file.gguf"), "not found");
    check("R1 fail — empty path",                 false, validate_model_exists(""), "empty");

    // Rule 2: GGUF magic bytes
    check("R2 pass — valid GGUF magic",           true,  validate_gguf_magic(GOOD_GGUF));
    check("R2 fail — 'Acce' magic (safetensors)", false, validate_gguf_magic(BAD_MAGIC), "Acce");

    // Create a tiny fake GGUF with wrong magic
    std::string fake_bad = tmp + "/bad.gguf";
    write_file(fake_bad, "NOPE-not-gguf");
    check("R2 fail — garbage magic",              false, validate_gguf_magic(fake_bad), "Not a valid GGUF");

    // Rule 3: architecture field
    check("R3 pass — text model has architecture", true, validate_gguf_architecture(GOOD_GGUF));
    check("R3 fail — flux has empty architecture", false, validate_gguf_architecture(FLUX_GGUF), "missing");

    // Combined
    check("combined pass — good GGUF",             true,  validate_llama_model(GOOD_GGUF));
    check("combined fail — bad magic",             false,  validate_llama_model(BAD_MAGIC), "Not a valid GGUF");
    check("combined fail — flux diffusion model",  false,  validate_llama_model(FLUX_GGUF), "architecture");
    check("combined fail — missing file",          false,  validate_llama_model("/no/model.gguf"), "not found");
}

// ── MLX rules ─────────────────────────────────────────────────────────────────

static void test_mlx() {
    std::cout << "\n[mlx]\n";
    std::string tmp = tmp_dir();

    // Rule 1: interpreter
    check("R1 pass — valid interpreter",          true,  validate_mlx_python(MLX_PYTHON));
    check("R1 fail — bad interpreter path",       false, validate_mlx_python(BAD_PYTHON), "not found");
    check("R1 fail — empty interpreter",          false, validate_mlx_python(""), "empty");

    // Rule 2: HF IDs rejected (air-gapped)
    check("R2 fail — HF ID rejected",             false,
          validate_mlx_model("mlx-community/Meta-Llama-3.1-8B-Instruct-4bit", MLX_PYTHON),
          "air-gapped");
    // "models/foo" contains '/' so code classifies it as an HF ID and rejects it as air-gapped
    check("R2 fail — HF-style relative path",     false,
          validate_mlx_model("models/foo", MLX_PYTHON), "air-gapped");
    // A bare name with no '/' hits the "must be absolute" branch
    check("R2 fail — bare name (no slash)",       false,
          validate_mlx_model("localmodel", MLX_PYTHON), "absolute");

    // Rule 2: directory exists
    check("R2 fail — nonexistent dir",            false,
          validate_mlx_model("/no/such/dir", MLX_PYTHON), "not found");

    // Rule 3: required files
    check("R3 fail — empty dir (granite)",        false,
          validate_mlx_model(EMPTY_MLX, MLX_PYTHON), "missing");

    std::string no_cfg = tmp + "/no_cfg"; mkdir_p(no_cfg);
    write_file(no_cfg + "/model.safetensors", "x");
    write_file(no_cfg + "/tokenizer.json", "{}");
    write_file(no_cfg + "/tokenizer_config.json", "{}");
    check("R3 fail — missing config.json",        false,
          validate_mlx_model(no_cfg, MLX_PYTHON), "config.json");

    std::string no_wt = tmp + "/no_weights"; mkdir_p(no_wt);
    write_file(no_wt + "/config.json", "{\"model_type\":\"llama\"}");
    write_file(no_wt + "/tokenizer.json", "{}");
    write_file(no_wt + "/tokenizer_config.json", "{}");
    check("R3 fail — missing weights",            false,
          validate_mlx_model(no_wt, MLX_PYTHON), "model.safetensors");

    // Rule 4: config.json validity
    std::string bad_cfg = tmp + "/bad_cfg"; mkdir_p(bad_cfg);
    write_file(bad_cfg + "/config.json", "{\"not_a_model\":true}");
    write_file(bad_cfg + "/model.safetensors", "x");
    write_file(bad_cfg + "/tokenizer.json", "{}");
    write_file(bad_cfg + "/tokenizer_config.json", "{}");
    check("R4 fail — config missing model_type",  false,
          validate_mlx_model(bad_cfg, MLX_PYTHON), "model_type");

    // Full pass
    check("combined pass — good MLX dir",         true,
          validate_mlx_model(GOOD_MLX, MLX_PYTHON));
}

// ── vLLM rules ────────────────────────────────────────────────────────────────

static void test_vllm() {
    std::cout << "\n[vllm]\n";
    std::string tmp = tmp_dir();

    // Rule 1: interpreter
    check("R1 fail — bad interpreter",            false,
          validate_vllm_model("/some/model", BAD_PYTHON, 4096), "not found");

    // Rule 2: HF IDs rejected
    check("R2 fail — HF ID rejected",             false,
          validate_vllm_model("meta-llama/Llama-3.2-3B", MLX_PYTHON, 4096), "air-gapped");

    // Rule 3: directory exists
    check("R3 fail — nonexistent dir",            false,
          validate_vllm_model("/no/dir", MLX_PYTHON, 4096), "not found");

    // Rule 4: GGUF rejected
    check("R4 fail — GGUF file given to vLLM",    false,
          validate_vllm_model(GOOD_GGUF, MLX_PYTHON, 4096), "GGUF");

    // Rule 5: required files
    std::string no_wt = tmp + "/vllm_no_weights"; mkdir_p(no_wt);
    write_file(no_wt + "/config.json", "{\"model_type\":\"llama\"}");
    write_file(no_wt + "/tokenizer.json", "{}");
    check("R5 fail — missing weights",            false,
          validate_vllm_model(no_wt, MLX_PYTHON, 4096), "weight");

    std::string no_tok = tmp + "/vllm_no_tok"; mkdir_p(no_tok);
    write_file(no_tok + "/config.json", "{\"model_type\":\"llama\"}");
    write_file(no_tok + "/model.safetensors", "x");
    check("R5 fail — missing tokenizer",          false,
          validate_vllm_model(no_tok, MLX_PYTHON, 4096), "tokenizer");

    // Rule 6: context vs max_position_embeddings
    // make_model_dir appends "/model", so we must create the parent first
    mkdir_p(tmp + "/vllm_ctx");
    std::string ctx_dir = make_model_dir(tmp + "/vllm_ctx");
    // config.json already has max_position_embeddings:8192
    check("R6 pass — context within limit",       true,
          validate_vllm_model(ctx_dir, MLX_PYTHON, 4096));
    check("R6 pass — context equals limit",       true,
          validate_vllm_model(ctx_dir, MLX_PYTHON, 8192));
    check("R6 fail — context exceeds limit",      false,
          validate_vllm_model(ctx_dir, MLX_PYTHON, 16384), "max_position_embeddings");

    // Full pass with GOOD_MLX (has config.json + safetensors + tokenizer)
    check("combined pass — good HF-format dir",   true,
          validate_vllm_model(GOOD_MLX, MLX_PYTHON, 4096));
}

// ── docker-vllm rules ─────────────────────────────────────────────────────────

static void test_docker_vllm() {
    std::cout << "\n[docker-vllm]\n";

    check("R1 fail — empty model field",          false,
          validate_docker_vllm_model(""), "non-empty");
    check("R1 pass — non-empty model ID",         true,
          validate_docker_vllm_model("meta-llama/Llama-3.2-3B-Instruct"));

    // Rule 2: docker binary — only validate if we expect docker NOT to be present.
    // On most dev machines docker IS installed, so we just check the pass case.
    // The failure case would require uninstalling docker, so we skip it here.
    bool docker_present =
        access("/usr/local/bin/docker", X_OK) == 0 ||
        access("/usr/bin/docker", X_OK) == 0 ||
        access("/opt/homebrew/bin/docker", X_OK) == 0;
    if (docker_present) {
        check("R2 pass — docker binary found",    true,
              validate_docker_vllm_model("meta-llama/Llama-3.2-3B-Instruct"));
    } else {
        check("R2 fail — docker binary missing",  false,
              validate_docker_vllm_model("meta-llama/Llama-3.2-3B-Instruct"), "docker binary");
    }
}

// ── main ──────────────────────────────────────────────────────────────────────

int main() {
    std::cout << "=== proxy_validate test suite ===\n";
    test_llama();
    test_mlx();
    test_vllm();
    test_docker_vllm();

    std::cout << "\n=== Results: " << g_pass << " passed, " << g_fail << " failed ===\n";
    return g_fail > 0 ? 1 : 0;
}
