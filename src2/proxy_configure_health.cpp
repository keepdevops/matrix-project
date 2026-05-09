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
    auto check = [&]() -> std::vector<int> {
        std::vector<int> failed;
        for (const auto& [port, g] : pgs) {
            const char* path = (g.backend == "mlx" || g.backend == "docker"
                            || g.backend == "vllm" || g.backend == "docker-vllm")
                           ? "/v1/models"
                           : "/health";
            try {
                httplib::Client cli("127.0.0.1", port);
                cli.set_connection_timeout(5);
                cli.set_read_timeout(30);
                auto r = cli.Get(path);
                if (!r || r->status != 200) failed.push_back(port);
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
