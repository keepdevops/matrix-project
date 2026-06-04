#include "coordinator_setup.h"
#include "coordinator_setup_wire.h"
#include "backend_router.h"
#include "rss_generator.h"
#ifdef MATRIX_MLX_INPROC
#include "model_registry.h"   // MS-68 2c′: configure_prompt_cache
#endif
#include "config/coordinator_config_validate.h"
#include "config/http_url_parse.h"
#include "config/swarm_config_dir_load.h"
#include "config/swarm_config_resolve.h"

#include "httplib.h"
#include "json.hpp"

#include <cstdlib>
#include <fstream>
#include <iostream>

bool coordinator_load_config(const std::string& config_path, nlohmann::json& config) {
    const char* cfg_svc = std::getenv("MATRIX_SWARM_CONFIG_SERVICE");
    if (cfg_svc && cfg_svc[0]) {
        std::string host;
        int port = 0;
        if (!matrix_http::parse_http_host_port(std::string(cfg_svc), host, port)) {
            std::cerr << "❌ MATRIX_SWARM_CONFIG_SERVICE must be http://host:port\n";
            return false;
        }
        httplib::Client cli(host, port);
        cli.set_connection_timeout(5);
        cli.set_read_timeout(60);
        auto res = cli.Get("/api/v1/config");
        if (!res || res->status != 200) {
            std::cerr << "❌ MATRIX_SWARM_CONFIG_SERVICE GET /api/v1/config failed\n";
            return false;
        }
        try { config = nlohmann::json::parse(res->body); }
        catch (...) { std::cerr << "❌ config JSON parse failed\n"; return false; }
        std::cout << "✅ Loaded swarm config from MATRIX_SWARM_CONFIG_SERVICE\n";
        return true;
    }
    if (coordinator_config::is_directory_path(config_path)) {
        if (!coordinator_config::load_swarm_config_from_dir(config_path, config)) {
            std::cerr << "❌ failed to load swarm config from directory "
                      << config_path << std::endl;
            return false;
        }
        std::cout << "📂 Loaded swarm config from directory " << config_path
                  << " (" << config["agents"].size() << " agents)" << std::endl;
        return true;
    }
    std::string resolved = config_path;
    if (!swarm_config_resolve::open_config_path(config_path, resolved)) return false;
    std::ifstream config_file(resolved);
    if (!config_file.is_open()) {
        std::cerr << "❌ Could not open " << resolved << std::endl;
        return false;
    }
    try {
        config = nlohmann::json::parse(config_file);
    } catch (const std::exception& e) {
        std::cerr << "❌ JSON parse failed (" << resolved << "): " << e.what() << std::endl;
        return false;
    }
    if (resolved != config_path)
        std::cout << "📄 Loaded swarm config from " << resolved << std::endl;
    return true;
}

void coordinator_set_state_paths(CoordinatorState& state, const std::string& config_path) {
    if (coordinator_config::is_directory_path(config_path)) {
        state.history_path  = "history.json";
        state.sessions_path = "sessions.json";
    } else {
        const std::string dir = config_path.substr(0, config_path.rfind('/') + 1);
        state.history_path  = dir + "history.json";
        state.sessions_path = dir + "sessions.json";
        if (state.history_path  == "history.json")  state.history_path  = "history.json";
        if (state.sessions_path == "sessions.json") state.sessions_path = "sessions.json";
    }
}

void coordinator_wire_agents(CoordinatorState& state, const nlohmann::json& config) {
    setup_wire::wire_agents(state, config);
}

void coordinator_apply_coordinator_section(CoordinatorState& state, const nlohmann::json& config) {
    setup_wire::apply_coordinator_section(state, config);
    if (config.contains("coordinator")) {
        const auto& coord = config["coordinator"];
        state.token_budget_hierarchy = load_budget_hierarchy(coord);
        state.context_gate_config  = context_gate::load(coord);
        state.kv_auto_clear_config = kv_auto_clear::load(coord);
        if (coord.contains("reject_on_overrun") && coord["reject_on_overrun"].is_boolean())
            state.reject_on_overrun = coord["reject_on_overrun"].get<bool>();
        if (coord.contains("templates") && coord["templates"].is_object())
            state.templates = coord["templates"];
        if (coord.contains("supervisor") && coord["supervisor"].is_object())
            state.supervisor_enabled = coord["supervisor"].value("enabled", false);
        if (coord.contains("distillation") && coord["distillation"].is_object()) {
            const auto& d = coord["distillation"];
            state.distillation_push_url          = d.value("push_url", "");
            state.distillation_quality_threshold = d.value("quality_threshold", 0.6);
        }
        if (coord.contains("rss") && coord["rss"].is_object()) {
            const auto& rss = coord["rss"];
            const bool on = rss.value("enabled", false);
            const int cap = rss.value("max_items", 50);
            rss_generator::configure(on, cap > 0 ? static_cast<std::size_t>(cap) : 50);
            if (on)
                std::cout << "📡 RSS feeds enabled (max_items=" << cap << ")\n";
        }
#ifdef MATRIX_MLX_INPROC
        // MS-68 2c′-B: in-process session prompt-cache reuse (default OFF).
        if (coord.contains("prompt_cache") && coord["prompt_cache"].is_object()) {
            const auto& pc = coord["prompt_cache"];
            const bool on  = pc.value("enabled", false);
            const int  mc  = pc.value("min_ctx_tokens", 1024);
            const bool qkv = pc.value("quantized", false);
            const int  isc = pc.value("idle_secs", 600);
            model_mem::configure_prompt_cache(on, mc, qkv, isc);
            if (on)
                std::cout << "🧠 prompt-cache reuse enabled (min_ctx=" << mc
                          << " quantized=" << (qkv ? "yes" : "no")
                          << " idle_secs=" << isc << ")\n";
        }
        // #297: resident-model idle eviction window (default 600s).
        if (coord.contains("model_idle_secs") && coord["model_idle_secs"].is_number_integer()) {
            const int mis = coord["model_idle_secs"].get<int>();
            model_mem::configure_model_idle(mis);
            std::cout << "♻️  model idle-eviction window: " << mis << "s\n";
        }
#endif
        // MS-171: unified-memory pre-flight guard for MLX routes.
        state.mlx_memory_guard_config = mlx_mem_guard::load(coord);
        if (state.mlx_memory_guard_config.enabled)
            std::cout << "\xf0\x9f\x9b\xa1\xef\xb8\x8f  MLX memory guard enabled (min_free_gb="
                      << state.mlx_memory_guard_config.min_free_gb << ")\n";
    }
    backend_router::configure_from_startup(config);
}
