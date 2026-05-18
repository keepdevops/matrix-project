#include "mode.h"
#include "router_plan_parse.h"
#include "../agent_client.h"
#include "../agent_health.h"
#include "../agent_stream.h"
#include "../httplib.h"
#include "../kv_router.h"
#include "../mode_module.h"
#include "../pressure.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <future>
#include <iostream>
#include <mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

using json = nlohmann::json;

namespace {

bool is_mlx_agent(const Agent& a) {
    return a.engine == "mlx" || a.backend == "mlx";
}

// TTL cache for port liveness — avoids a blocking HTTP round-trip per agent
// on every dispatch. Cache entries expire after READY_TTL_SECS seconds so a
// newly-dead port is detected within one TTL window.
static constexpr int READY_TTL_SECS = 30;
struct PortReadyCache {
    struct Entry { bool ok; std::chrono::steady_clock::time_point expiry; };
    std::unordered_map<int, Entry> m;
    std::mutex mu;

    bool get(int port, bool& out) {
        std::lock_guard<std::mutex> lk(mu);
        auto it = m.find(port);
        if (it == m.end() || std::chrono::steady_clock::now() > it->second.expiry)
            return false;
        out = it->second.ok;
        return true;
    }
    void set(int port, bool ok) {
        std::lock_guard<std::mutex> lk(mu);
        m[port] = {ok, std::chrono::steady_clock::now()
                       + std::chrono::seconds(READY_TTL_SECS)};
    }
};
static PortReadyCache g_ready_cache;

bool endpoint_ready(const Agent& a) {
    bool cached = false;
    if (g_ready_cache.get(a.port, cached)) return cached;

    const bool openai_backend = a.engine == "mlx" || a.backend == "mlx"
        || a.backend == "vllm" || a.backend == "docker-vllm"
        || a.backend == "docker";
    const char* path = openai_backend ? "/v1/models" : "/health";
    bool ok = false;
    try {
        httplib::Client cli("127.0.0.1", a.port);
        cli.set_connection_timeout(1);
        cli.set_read_timeout(1);
        ok = static_cast<bool>(cli.Get(path));
    } catch (...) {}
    g_ready_cache.set(a.port, ok);
    return ok;
}


// Choose the classifier: prefer any agent tagged "planning" (e.g. foreman, architect),
// otherwise fall back to the first active agent.
std::string choose_classifier(const std::vector<Agent>& agents) {
    for (const auto& a : agents)
        for (const auto& t : a.tags)
            if (t == "planning") return a.name;
    return agents.empty() ? std::string() : agents.front().name;
}

json run_router(const ModeContext& ctx) {
    const auto& cfg = ctx.mode_config;
    json meta = mode_module::module_meta("router", cfg);
    const std::string classifier_policy = mode_module::option_string(
        cfg, "classifier_policy", "standard");
    meta["classifier_policy"] = classifier_policy;
    // Check all agents in parallel to avoid N×1s sequential HTTP round-trips.
    const size_t n = ctx.agents.size();
    std::vector<std::future<bool>> ready_futures;
    ready_futures.reserve(n);
    for (const auto& a : ctx.agents)
        ready_futures.push_back(std::async(std::launch::async,
            [&a]() { return endpoint_ready(a); }));

    std::vector<Agent> reachable_agents;
    json excluded_unreachable = json::array();
    reachable_agents.reserve(n);
    for (size_t i = 0; i < n; ++i) {
        if (ready_futures[i].get()) {
            reachable_agents.push_back(ctx.agents[i]);
        } else {
            excluded_unreachable.push_back(ctx.agents[i].name);
            agent_health::record(ctx.agents[i].name, false);
            std::cerr << "🔌 [router] excluding unreachable agent '" << ctx.agents[i].name
                      << "' on port " << ctx.agents[i].port << std::endl;
        }
    }
    if (!excluded_unreachable.empty()) {
        meta["excluded_unreachable"] = excluded_unreachable;
    }
    if (reachable_agents.empty()) {
        meta["error"] = "no reachable agents";
        return json{
            {"mode", "router"},
            {"agents", json::object()},
            {"final", nullptr},
            {"meta", meta}
        };
    }
    // Work with a mutable local copy so SET_TOKENS directives from the
    // foreman can adjust per-agent budgets for this request only.
    std::vector<Agent>& agents = reachable_agents;

    std::unordered_map<std::string, const Agent*> by_name;
    for (const auto& a : agents) by_name[a.name] = &a;

    // Quality pass: skip classifier, re-run the prior target agent directly.
    if (ctx.quality_pass) {
        json agent_outputs = json::object();
        const std::string& target = ctx.quality_pass_target;
        if (by_name.count(target)) {
            std::cout << "🧭 [router] quality_pass: skipping classifier, re-running '"
                      << target << "'" << std::endl;
            const Agent* agent = by_name[target];
            agent_outputs[target] = call_agent(*agent, ctx.prompt_for(target));
        } else {
            std::cerr << "⚠️  [router] quality_pass target '" << target
                      << "' not reachable — no agents called" << std::endl;
        }
        meta["quality_pass_target"] = target;
        meta["selected"] = json::array({target});
        return json{
            {"mode", "router"},
            {"agents", agent_outputs},
            {"final", nullptr},
            {"meta", meta}
        };
    }

    std::string classifier_name = cfg.value("classifier", std::string(""));
    const std::string configured_classifier = classifier_name;
    int max_select = cfg.value("max_select", 3);
    std::vector<std::string> fallback = cfg.contains("fallback")
        ? router_plan::as_string_vec(cfg["fallback"]) : std::vector<std::string>{};

    bool fallback_classifier_used = false;
    if (classifier_name.empty() || by_name.find(classifier_name) == by_name.end()) {
        classifier_name = choose_classifier(agents);
        fallback_classifier_used = true;
    }

    std::vector<std::string> choices = cfg.contains("choices")
        ? router_plan::as_string_vec(cfg["choices"]) : std::vector<std::string>{};
    if (choices.empty()) {
        for (const auto& a : agents) {
            if (a.name != classifier_name) choices.push_back(a.name);
        }
    } else {
        // Prune configured choices to agents that are actually active in the
        // swarm. Without this, the classifier is offered dead names (e.g.
        // architect/reviewer in a 7-agent swarm) and returns a SELECTED line
        // that filters down to nothing, forcing a silent fallback.
        std::vector<std::string> active_choices;
        for (const auto& n : choices) {
            if (by_name.count(n)) active_choices.push_back(n);
        }
        choices.swap(active_choices);
    }
std::unordered_set<std::string> choice_set(choices.begin(), choices.end());

    if (classifier_name.empty() || by_name.find(classifier_name) == by_name.end()) {
        std::cerr << "❌ [router] no active agents available for classifier" << std::endl;
        meta["error"] = "classifier not available";
        meta["classifier"] = classifier_name;
        return json{
            {"mode", "router"},
            {"agents", json::object()},
            {"final", nullptr},
            {"meta", meta}
        };
    }

    if (fallback.empty()) {
        for (const auto& a : agents) {
            if (a.name == classifier_name) continue;
            fallback.push_back(a.name);
            if ((int)fallback.size() >= max_select) break;
        }
    }

    std::cout << "🧭 [router] classifier=" << classifier_name
              << " choices=" << choices.size()
              << " max_select=" << max_select << std::endl;

    // Build a classifier prompt that overrides the agent's normal role and
    // forces a strict SELECTED-line response. Without this, the classifier
    // just answers the user's prompt literally (e.g. asked to "list sorts",
    // it lists sort algorithms instead of picking agents).

    // Build agent list with descriptions so the classifier can reason about roles.
    std::string choices_csv;
    std::string choices_annotated;
    for (size_t i = 0; i < choices.size(); ++i) {
        if (i) choices_csv += ", ";
        choices_csv += choices[i];
        const auto it = by_name.find(choices[i]);
        const std::string desc = (it != by_name.end() && !it->second->description.empty())
            ? it->second->description : "";
        choices_annotated += "  " + choices[i];
        if (!desc.empty()) choices_annotated += " — " + desc;
        choices_annotated += "\n";
    }
    const std::string classifier_system =
        "You are a routing classifier. Your ONLY job is to choose which "
        "specialist agents should handle a user request and optionally adjust "
        "their token budgets for this request.\n\n"
        "Respond with ONLY the following lines (in order) and nothing else:\n"
        "  [optional] SET_TOKENS: <agent> max_tokens=<n>   — raise budget for large tasks\n"
        "  SELECTED: <agent1>, <agent2>, ...\n\n"
        "Rules:\n"
        "- Emit SET_TOKENS lines BEFORE the SELECTED line.\n"
        "- Only emit SET_TOKENS when the task clearly requires more output than the "
        "default budget (e.g. large codegen needs max_tokens=4096, deep analysis "
        "needs max_tokens=3000). Default is 2048. Never lower below 512.\n"
        "- Pick between 1 and " + std::to_string(max_select) + " agents from the "
        "allowed list. Use only names from the allowed list.\n"
        "- No prose, no explanations, no other lines.\n"
        + mode_module::router_policy_instruction(classifier_policy);
    // Pressure-aware classifier hint: list current load per allowed agent so
    // the foreman can avoid hammering already-busy roles. Best-effort — if the
    // pressure snapshot fails or returns nothing, we just skip the banner.
    std::string load_banner;
    try {
        nlohmann::json snap = snapshot_pressure(agents);
        std::map<std::string, int> agent_pct; // name -> 0..100
        for (const auto& entry : snap) {
            if (!entry.is_object()) continue;
            double usage = entry.value("usage", 0.0);
            int pct = (int)std::round(usage * 100.0);
            if (entry.contains("names") && entry["names"].is_array()) {
                for (const auto& n : entry["names"]) {
                    if (n.is_string()) agent_pct[n.get<std::string>()] = pct;
                }
            }
        }
        std::string load_csv;
        for (const auto& name : choices) {
            auto it = agent_pct.find(name);
            int pct = (it != agent_pct.end()) ? it->second : 0;
            if (!load_csv.empty()) load_csv += ", ";
            load_csv += name + " " + std::to_string(pct) + "%";
        }
        if (!load_csv.empty()) {
            load_banner = "Current load: " + load_csv +
                          ". Prefer less-loaded agents when multiple fit the task.\n\n";
            std::cout << "📊 [router] load hint sent to classifier: "
                      << load_csv << std::endl;
            meta["load_hint"] = load_csv;
        }
    } catch (...) { /* skip banner on error */ }

    const std::string classifier_user =
        "Allowed agents:\n" + choices_annotated + "\n"
        + load_banner +
        "User request:\n" + ctx.user_prompt + "\n\n"
        "Respond with the SELECTED line only.";
    // Stream the classifier so selected agents can be dispatched the moment
    // the SELECTED line appears in the stream — overlapping the classifier's
    // tail tokens with actual agent inference. on_chunk fires synchronously
    // from stream_agent's receive loop, so raw/agents/by_name are safe to
    // mutate here (no concurrent on_chunk calls). Futures are launched async.
    std::string raw;
    bool agents_launched = false;
    bool fallback_used   = false;
    json affinity_meta   = json::object();
    std::vector<std::string> selected;
    std::vector<std::future<std::pair<std::string, std::string>>> agent_futures;

    // Helper: apply SET_TOKENS + parse SELECTED + launch futures.
    // Called from on_chunk the moment a complete SELECTED line is buffered.
    auto apply_directives_and_dispatch = [&]() {
        auto directives = router_plan::parse_set_tokens_directives(raw);
        if (!directives.empty()) {
            int n = router_plan::apply_token_directives(agents, directives);
            json token_adjustments = json::array();
            for (const auto& d : directives) {
                json entry = {{"agent", d.agent}};
                if (d.max_tokens > 0)        entry["max_tokens"]        = d.max_tokens;
                if (d.read_timeout_secs > 0) entry["read_timeout_secs"] = d.read_timeout_secs;
                token_adjustments.push_back(entry);
                std::cout << "🔧 [router] foreman SET_TOKENS: " << d.agent;
                if (d.max_tokens > 0) std::cout << " max_tokens=" << d.max_tokens;
                if (d.read_timeout_secs > 0) std::cout << " read_timeout_secs=" << d.read_timeout_secs;
                std::cout << std::endl;
            }
            if (n > 0) {
                meta["token_adjustments"] = token_adjustments;
                by_name.clear();
                for (const auto& a : agents) by_name[a.name] = &a;
            }
        }

        std::vector<std::string> parsed =
            router_plan::extract_names_from_plan(raw, choice_set);
        if (parsed.size() > 1) {
            for (const auto& n : parsed)
                affinity_meta[n] = (uint64_t)kv_router::affinity(n, ctx.user_prompt);
            kv_router::rank_by_affinity(parsed, ctx.user_prompt, /*min_bytes=*/64);
        }

        std::unordered_set<std::string> seen;
        for (const auto& name : parsed) {
            if (!choice_set.count(name) || !by_name.count(name)) continue;
            if (seen.insert(name).second) selected.push_back(name);
            if ((int)selected.size() >= max_select) break;
        }

        for (const auto& name : selected) {
            Agent agent_copy = *by_name[name]; // copy — by_name may change on retry
            std::string prompt = ctx.prompt_for(name);
            agent_futures.push_back(std::async(std::launch::async,
                [agent_copy, prompt]() mutable {
                    return std::make_pair(agent_copy.name, call_agent(agent_copy, prompt));
                }));
        }
    };

    // on_chunk: accumulate and trigger dispatch as soon as SELECTED line ends.
    auto on_chunk = [&](const std::string& delta) {
        raw += delta;
        if (agents_launched) return;
        if (raw.find("SELECTED:") == std::string::npos) return;
        // Wait for newline so the full comma list is present before parsing.
        if (raw.find('\n', raw.find("SELECTED:")) == std::string::npos) return;
        agents_launched = true;
        apply_directives_and_dispatch();
        if (!selected.empty())
            std::cout << "⚡ [router] early dispatch " << agent_futures.size()
                      << " agent(s) while classifier finishes" << std::endl;
    };

    agent_stream::stream_agent(*by_name[classifier_name],
                               classifier_system, classifier_user,
                               on_chunk, /*cancel=*/nullptr);

    // Classifier done. If on_chunk never saw a SELECTED line (e.g. MLX
    // one-shot delivery or model ignored the instruction), run the full parse
    // now on the complete raw response — same logic as before this change.
    if (!agents_launched) {
        agents_launched = true; // suppress double-dispatch
        apply_directives_and_dispatch();
    }

    // If parse produced nothing, fall back to the configured fallback list.
    if (selected.empty()) {
        fallback_used = true;
        std::cerr << "⚠️  [router] no valid selection; using fallback" << std::endl;
        if (fallback.size() > 1)
            kv_router::rank_by_affinity(fallback, ctx.user_prompt, /*min_bytes=*/64);
        std::unordered_set<std::string> seen;
        for (const auto& name : fallback) {
            if (!by_name.count(name)) continue;
            if (seen.insert(name).second) selected.push_back(name);
            if ((int)selected.size() >= max_select) break;
        }
        if (selected.empty()) {
            for (const auto& a : agents) {
                if (a.name == classifier_name) continue;
                if (seen.insert(a.name).second) selected.push_back(a.name);
                if ((int)selected.size() >= max_select) break;
            }
        }
        // Fallback agents weren't launched by early dispatch — start them now.
        for (const auto& name : selected) {
            Agent agent_copy = *by_name[name];
            std::string prompt = ctx.prompt_for(name);
            agent_futures.push_back(std::async(std::launch::async,
                [agent_copy, prompt]() mutable {
                    return std::make_pair(agent_copy.name, call_agent(agent_copy, prompt));
                }));
        }
    }

    std::cout << "🧭 [router] selected=[";
    for (size_t i = 0; i < selected.size(); ++i)
        std::cout << (i ? ", " : "") << selected[i];
    std::cout << "] fallback=" << (fallback_used ? "yes" : "no") << std::endl;

    json agent_outputs = json::object();
    if (!agent_futures.empty()) {
        for (auto& fut : agent_futures) {
            auto pr = fut.get();
            agent_outputs[pr.first] = pr.second;
        }
    } else {
        std::cerr << "❌ [router] no agents selected and no valid fallback" << std::endl;
        meta["error"] = "no agents selected and fallback empty/invalid";
    }

    meta["classifier"] = classifier_name;
    if (!configured_classifier.empty()) meta["configured_classifier"] = configured_classifier;
    meta["selected"] = selected;
    meta["classifier_raw"] = raw;
    meta["fallback_used"] = fallback_used;
    meta["fallback_classifier_used"] = fallback_classifier_used;
    if (!affinity_meta.empty()) meta["kv_affinity"] = affinity_meta;

    return json{
        {"mode", "router"},
        {"agents", agent_outputs},
        {"final", nullptr},
        {"meta", meta}
    };
}

struct Register {
    Register() {
        modes::register_mode({
            "router",
            "Classifier agent picks a subset; prompt is broadcast to those agents only.",
            run_router
        });
    }
} _reg;

} // namespace
