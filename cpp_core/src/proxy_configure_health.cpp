#include "proxy_configure_health.h"

#include "httplib.h"

#include <chrono>
#include <set>
#include <thread>

// Definition of the global progress tracker declared in the header.
ConfigureProgress g_configure_progress;

std::vector<int> proxy_configure_wait_for_health(
    const std::map<int, PortGroup>& pgs,
    int timeout_secs)
{
    auto deadline = std::chrono::steady_clock::now()
                    + std::chrono::seconds(timeout_secs);
    auto model_basename = [](const std::string& path) -> std::string {
        auto sl = path.rfind('/');
        return sl == std::string::npos ? path : path.substr(sl + 1);
    };

    // Ports that have already passed health — skip re-checking them.
    std::set<int> ready;

    auto check_remaining = [&]() -> std::vector<int> {
        std::vector<int> failed;
        for (const auto& [port, g] : pgs) {
            if (ready.count(port)) continue;
            try {
                httplib::Client cli("127.0.0.1", port);
                cli.set_connection_timeout(5);
                cli.set_read_timeout(30);

                bool ok = false;
                if (g.backend == "mlx" || g.backend == "docker"
                    || g.backend == "vllm" || g.backend == "docker-vllm") {
                    auto r = cli.Get("/v1/models");
                    ok = r && r->status == 200;
                } else {
                    // llama: require /health + correct model in /v1/models
                    auto hr = cli.Get("/health");
                    if (!hr || hr->status != 200) { failed.push_back(port); continue; }
                    auto mr = cli.Get("/v1/models");
                    if (!mr || mr->status != 200) { failed.push_back(port); continue; }
                    const std::string expected = model_basename(g.model);
                    if (!expected.empty() && mr->body.find(expected) == std::string::npos) {
                        std::cerr << "[Health] port " << port
                                  << ": wrong model (expected " << expected << "); stale process?\n";
                        failed.push_back(port);
                        continue;
                    }
                    ok = true;
                }

                if (ok) {
                    // Smoke-decode: /health can pass while GPU is exhausted and
                    // /completion returns 500 "Compute error."
                    if (g.backend == "llama") {
                        json probe = {{"prompt", "hi"}, {"n_predict", 1}, {"stream", false}};
                        auto cr = cli.Post("/completion", probe.dump(), "application/json");
                        if (!cr || cr->status != 200
                            || cr->body.find("Compute error") != std::string::npos) {
                            std::cerr << "[Health] port " << port
                                      << ": completion probe failed (GPU memory or stale slots?)\n";
                            failed.push_back(port);
                            continue;
                        }
                    }
                    ready.insert(port);
                    g_configure_progress.set(port, "ready");
                } else {
                    failed.push_back(port);
                }
            } catch (...) { failed.push_back(port); }
        }
        return failed;
    };

    while (std::chrono::steady_clock::now() < deadline) {
        auto failed = check_remaining();
        if (failed.empty()) return {};
        std::this_thread::sleep_for(std::chrono::seconds(2));
    }

    // Final check — mark anything still not ready as error.
    auto final_failed = check_remaining();
    for (int port : final_failed)
        g_configure_progress.set(port, "error");
    return final_failed;
}

std::string proxy_configure_check_docker_model_runner(const std::string& model) {
    if (model.empty())
        return "docker agent requires a non-empty model field"
               "\n  (e.g. ai/meta-llama-3.2-3b-instruct:Q8_0-F32)";

    httplib::Client cli("127.0.0.1", PROXY_CONFIGURE_DOCKER_PORT);
    cli.set_connection_timeout(3);
    cli.set_read_timeout(3);
    auto r = cli.Get("/v1/models");
    if (!r || r->status != 200)
        return "Docker Model Runner is not running on port "
             + std::to_string(PROXY_CONFIGURE_DOCKER_PORT)
             + ".\n  Start it with: docker model run " + model
             + "\n  Then relaunch the swarm.";

    const std::string& body = r->body;
    if (body.find(model) != std::string::npos) return "";

    std::string loaded;
    try {
        json j = json::parse(body);
        if (j.contains("data") && j["data"].is_array()) {
            for (const auto& m : j["data"]) {
                if (m.contains("id") && m["id"].is_string()) {
                    if (!loaded.empty()) loaded += ", ";
                    loaded += m["id"].get<std::string>();
                }
            }
        }
    } catch (...) {}

    return "Model '" + model + "' is not loaded in Docker Model Runner."
         + "\n  Run: docker model run " + model
         + (loaded.empty() ? "" : "\n  Currently loaded: " + loaded);
}
