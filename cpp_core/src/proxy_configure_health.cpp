#include "proxy_configure_health.h"

#include "httplib.h"
#include "json.hpp"

#include <chrono>
#include <thread>

using json = nlohmann::json;

std::vector<int> proxy_configure_wait_for_health(
    const std::map<int, PortGroup>& pgs,
    int timeout_secs)
{
    auto deadline = std::chrono::steady_clock::now()
                    + std::chrono::seconds(timeout_secs);
    // Extract the bare filename from a model path (after last '/').
    auto model_basename = [](const std::string& path) -> std::string {
        auto sl = path.rfind('/');
        return sl == std::string::npos ? path : path.substr(sl + 1);
    };

    auto check = [&]() -> std::vector<int> {
        std::vector<int> failed;
        for (const auto& [port, g] : pgs) {
            try {
                httplib::Client cli("127.0.0.1", port);
                cli.set_connection_timeout(5);
                cli.set_read_timeout(30);

                if (g.backend == "mlx" || g.backend == "docker"
                    || g.backend == "vllm" || g.backend == "docker-vllm") {
                    auto r = cli.Get("/v1/models");
                    if (!r || r->status != 200) { failed.push_back(port); continue; }
                } else {
                    // llama backend: require /health AND confirm the correct
                    // model is loaded via /v1/models — prevents a stale process
                    // with a different model from passing the health check.
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
                }
            } catch (...) { failed.push_back(port); }
        }
        return failed;
    };
    while (std::chrono::steady_clock::now() < deadline) {
        if (check().empty()) return {};
        std::this_thread::sleep_for(std::chrono::seconds(2));
    }
    return check();
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
