#include "mode.h"
#include "../agent_client.h"
#include "../kv_router.h"
#include "../pressure.h"

#include <algorithm>
#include <cctype>
#include <future>
#include <iostream>
#include <regex>
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

bool is_mlx_centric_run(const std::vector<Agent>& agents) {
    int mlx = 0;
    int other = 0;
    for (const auto& a : agents) {
        if (is_mlx_agent(a)) ++mlx;
        else ++other;
    }
    return mlx > 0 && mlx >= other;
}

std::vector<std::string> mlx_first_agents(const std::vector<Agent>& agents,
                                          const std::string& exclude = "") {
    std::vector<std::string> mlx;
    std::vector<std::string> other;
    for (const auto& a : agents) {
        if (!exclude.empty() && a.name == exclude) continue;
        if (is_mlx_agent(a)) mlx.push_back(a.name);
        else other.push_back(a.name);
    }
    mlx.insert(mlx.end(), other.begin(), other.end());
    return mlx;
}

std::vector<std::string> mlx_priority_targets(const std::vector<Agent>& agents,
                                              const std::string& exclude = "") {
    std::vector<std::string> active;
    active.reserve(agents.size());
    for (const auto& a : agents) {
        if (!exclude.empty() && a.name == exclude) continue;
        active.push_back(a.name);
    }
    std::vector<std::string> out;
    std::vector<std::string> preferred = {
        "foreman", "api", "documenter", "scout",
        "mlx-coder", "architect", "programmer", "tester", "devops"
    };
    for (const auto& p : preferred) {
        for (const auto& n : active) {
            if (n == p) { out.push_back(n); break; }
        }
    }
    // Append any active names not already present.
    std::unordered_set<std::string> seen(out.begin(), out.end());
    for (const auto& n : active) if (!seen.count(n)) out.push_back(n);
    return out;
}

std::vector<std::string> mlx_strict_fallback_order(const std::vector<Agent>& agents,
                                                   const std::string& exclude = "") {
    std::vector<std::string> active;
    active.reserve(agents.size());
    for (const auto& a : agents) {
        if (!exclude.empty() && a.name == exclude) continue;
        active.push_back(a.name);
    }
    // Tier-1: MLX-support/coordinator roles.
    const std::vector<std::string> tier1 = {
        "foreman", "api", "documenter", "scout", "mlx-coder", "tester", "devops"
    };
    // Tier-2: coding/heavy roles, only after tier1 is exhausted.
    const std::vector<std::string> tier2 = {
        "architect", "programmer", "reviewer", "security", "optimizer",
        "specialist", "database", "frontend", "synthesis"
    };
    std::vector<std::string> out;
    out.reserve(active.size());
    auto append_if_active = [&](const std::vector<std::string>& tier) {
        for (const auto& p : tier) {
            for (const auto& n : active) {
                if (n == p) { out.push_back(n); break; }
            }
        }
    };
    append_if_active(tier1);
    append_if_active(tier2);
    // Append any active names not already present.
    std::unordered_set<std::string> seen(out.begin(), out.end());
    for (const auto& n : active) if (!seen.count(n)) out.push_back(n);
    return out;
}

bool contains_any(const std::vector<std::string>& xs, const std::unordered_set<std::string>& set) {
    for (const auto& x : xs) if (set.count(x)) return true;
    return false;
}

std::string choose_classifier(const std::vector<Agent>& agents, bool mlx_centric) {
    auto has = [&](const std::string& n) {
        for (const auto& a : agents) if (a.name == n) return true;
        return false;
    };
    if (mlx_centric) {
        if (has("mlx-coder")) return "mlx-coder";
        if (has("foreman")) return "foreman";
    } else {
        if (has("foreman")) return "foreman";
    }
    return agents.empty() ? std::string() : agents.front().name;
}

std::vector<std::string> as_string_vec(const json& j) {
    std::vector<std::string> out;
    if (!j.is_array()) return out;
    for (const auto& x : j) {
        if (x.is_string()) out.push_back(x.get<std::string>());
    }
    return out;
}

// Parse "SELECTED: a, b, c" line if present. Returns ordered, deduped names
// drawn from `choice_set`. Case-insensitive on names; tolerant of whitespace
// and surrounding markdown (e.g. "**SELECTED:** a, b").
std::vector<std::string> parse_selected_line(
    const std::string& raw,
    const std::unordered_set<std::string>& choice_set) {
    std::vector<std::string> out;
    std::regex line_re(R"((?:^|\n)[^\n]*\bSELECTED\s*:\s*([^\n]+))",
                       std::regex::icase);
    std::smatch m;
    if (!std::regex_search(raw, m, line_re)) return out;

    std::string list = m[1].str();
    std::unordered_set<std::string> choice_lower;
    std::unordered_map<std::string, std::string> lower_to_canonical;
    for (const auto& n : choice_set) {
        std::string l = n;
        std::transform(l.begin(), l.end(), l.begin(),
                       [](unsigned char c) { return std::tolower(c); });
        choice_lower.insert(l);
        lower_to_canonical[l] = n;
    }

    std::unordered_set<std::string> seen;
    std::regex tok_re(R"([A-Za-z][A-Za-z0-9_-]*)");
    auto begin = std::sregex_iterator(list.begin(), list.end(), tok_re);
    auto end = std::sregex_iterator();
    for (auto it = begin; it != end; ++it) {
        std::string tok = it->str();
        std::transform(tok.begin(), tok.end(), tok.begin(),
                       [](unsigned char c) { return std::tolower(c); });
        if (!choice_lower.count(tok)) continue;
        if (seen.insert(tok).second) out.push_back(lower_to_canonical[tok]);
    }
    return out;
}

// Fallback: ordered, deduped agent names mentioned anywhere in `raw`, drawn
// from `choice_set`. Word-boundary match avoids substring false positives
// (e.g. "programmer" inside "reprogrammer").
std::vector<std::string> extract_names_from_plan(
    const std::string& raw,
    const std::unordered_set<std::string>& choice_set) {
    auto selected = parse_selected_line(raw, choice_set);
    if (!selected.empty()) return selected;

    std::string lower = raw;
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return std::tolower(c); });

    std::vector<std::pair<size_t, std::string>> hits;
    hits.reserve(choice_set.size());
    for (const auto& name : choice_set) {
        std::string pat = name;
        std::transform(pat.begin(), pat.end(), pat.begin(),
                       [](unsigned char c) { return std::tolower(c); });
        try {
            std::regex re("\\b" + pat + "\\b");
            std::smatch m;
            if (std::regex_search(lower, m, re)) {
                hits.emplace_back((size_t)m.position(0), name);
            }
        } catch (const std::exception& e) {
            std::cerr << "⚠️  [router] regex error for '" << name << "': "
                      << e.what() << std::endl;
        }
    }
    std::sort(hits.begin(), hits.end(),
              [](const auto& a, const auto& b) { return a.first < b.first; });

    std::vector<std::string> out;
    out.reserve(hits.size());
    for (const auto& h : hits) out.push_back(h.second);
    return out;
}

json run_router(const ModeContext& ctx) {
    const auto& cfg = ctx.mode_config;
    json meta = json::object();
    const bool mlx_centric = is_mlx_centric_run(ctx.agents);

    std::unordered_map<std::string, const Agent*> by_name;
    for (const auto& a : ctx.agents) by_name[a.name] = &a;

    std::string classifier_name = cfg.value("classifier", std::string(""));
    const std::string configured_classifier = classifier_name;
    int max_select = cfg.value("max_select", 3);
    std::vector<std::string> fallback = cfg.contains("fallback")
        ? as_string_vec(cfg["fallback"]) : std::vector<std::string>{};

    bool fallback_classifier_used = false;
    bool mlx_classifier_override_used = false;
    if (mlx_centric && by_name.find("mlx-coder") != by_name.end()
        && classifier_name != "mlx-coder") {
        classifier_name = "mlx-coder";
        mlx_classifier_override_used = true;
        std::cerr << "⚠️  [router] MLX-centric run: overriding classifier to 'mlx-coder'"
                  << (configured_classifier.empty() ? "" : " (from config '" + configured_classifier + "')")
                  << std::endl;
    }
    if (classifier_name.empty() || by_name.find(classifier_name) == by_name.end()) {
        classifier_name = choose_classifier(ctx.agents, mlx_centric);
        fallback_classifier_used = true;
    }

    std::vector<std::string> choices = cfg.contains("choices")
        ? as_string_vec(cfg["choices"]) : std::vector<std::string>{};
    if (choices.empty()) {
        for (const auto& a : ctx.agents) {
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
    if (mlx_centric && !choices.empty()) {
        // Reorder with strict MLX-centric priority (tier1 before architect/programmer).
        std::vector<std::string> preferred = mlx_strict_fallback_order(ctx.agents, classifier_name);
        std::unordered_set<std::string> allowed(choices.begin(), choices.end());
        std::vector<std::string> reordered;
        for (const auto& n : preferred) if (allowed.count(n)) reordered.push_back(n);
        if (!reordered.empty()) choices = reordered;
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

    if (mlx_centric) {
        // Strict MLX policy: ignore configured fallback and enforce tiered MLX-priority.
        fallback.clear();
        const auto candidates = mlx_strict_fallback_order(ctx.agents, classifier_name);
        for (const auto& n : candidates) {
            fallback.push_back(n);
            if ((int)fallback.size() >= max_select) break;
        }
    } else if (fallback.empty()) {
        // Non-MLX: keep existing behavior.
        for (const auto& a : ctx.agents) {
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
    std::string choices_csv;
    for (size_t i = 0; i < choices.size(); ++i) {
        if (i) choices_csv += ", ";
        choices_csv += choices[i];
    }
    const std::string classifier_system =
        "You are a routing classifier. Your ONLY job is to choose which "
        "specialist agents should handle a user request. Do NOT answer the "
        "request itself. Respond with exactly one line in this format and "
        "nothing else:\n"
        "SELECTED: <agent1>, <agent2>, ...\n"
        "Pick between 1 and " + std::to_string(max_select) + " agents from the "
        "allowed list. Use only names from the allowed list, separated by "
        "commas. No prose, no explanations, no other lines.";
    // Pressure-aware classifier hint: list current load per allowed agent so
    // the foreman can avoid hammering already-busy roles. Best-effort — if the
    // pressure snapshot fails or returns nothing, we just skip the banner.
    std::string load_banner;
    try {
        nlohmann::json snap = snapshot_pressure(ctx.agents);
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
        "Allowed agents: " + choices_csv + "\n\n"
        + load_banner +
        "User request:\n" + ctx.user_prompt + "\n\n"
        "Respond with the SELECTED line only.";
    const std::string raw = call_agent_with_system(
        *by_name[classifier_name], classifier_system, classifier_user);

    std::vector<std::string> parsed = extract_names_from_plan(raw, choice_set);

    // KV-affinity bias: when the classifier returns more candidates than we
    // can use (or the order doesn't match warm KV caches), reorder so agents
    // with the longest prefix overlap come first. Threshold avoids reordering
    // on trivial overlaps (boilerplate role headers etc.). MLX-centric runs
    // already get a hard reorder later, so this only really affects llama.
    json affinity_meta = json::object();
    if (parsed.size() > 1) {
        for (const auto& n : parsed) {
            affinity_meta[n] = (uint64_t)kv_router::affinity(n, ctx.user_prompt);
        }
        kv_router::rank_by_affinity(parsed, ctx.user_prompt, /*min_bytes=*/64);
    }
    if (fallback.size() > 1) {
        kv_router::rank_by_affinity(fallback, ctx.user_prompt, /*min_bytes=*/64);
    }

    std::vector<std::string> selected;
    std::unordered_set<std::string> seen;
    for (const auto& name : parsed) {
        if (!choice_set.count(name)) continue;
        if (by_name.find(name) == by_name.end()) continue;
        if (seen.insert(name).second) selected.push_back(name);
        if ((int)selected.size() >= max_select) break;
    }

    bool fallback_used = false;
    const std::unordered_set<std::string> mlx_prioritized = {"foreman", "api", "documenter", "scout", "mlx-coder"};
    if (mlx_centric && !selected.empty() && !contains_any(selected, mlx_prioritized)) {
        // If classifier chose only late coding roles, bias toward MLX-centric defaults.
        fallback_used = true;
        selected.clear();
        seen.clear();
        std::cerr << "⚠️  [router] MLX-centric run: classifier selection not mlx-priority; using fallback" << std::endl;
    }
    if (selected.empty()) {
        fallback_used = true;
        std::cerr << "⚠️  [router] no valid selection; using fallback" << std::endl;
        for (const auto& name : fallback) {
            if (by_name.find(name) == by_name.end()) continue;
            if (seen.insert(name).second) selected.push_back(name);
            if ((int)selected.size() >= max_select) break;
        }
        if (selected.empty()) {
            // Final safety net: pick first active non-classifier agents.
            const auto final_candidates = mlx_centric
                ? mlx_strict_fallback_order(ctx.agents, classifier_name)
                : mlx_first_agents(ctx.agents, classifier_name);
            for (const auto& n : final_candidates) {
                if (seen.insert(n).second) selected.push_back(n);
                if ((int)selected.size() >= max_select) break;
            }
        }
    }

    std::cout << "🧭 [router] selected=[";
    for (size_t i = 0; i < selected.size(); ++i) {
        std::cout << (i ? ", " : "") << selected[i];
    }
    std::cout << "] fallback=" << (fallback_used ? "yes" : "no") << std::endl;

    json agent_outputs = json::object();
    if (!selected.empty()) {
        std::vector<std::future<std::pair<std::string, std::string>>> futures;
        for (const auto& name : selected) {
            const Agent* agent = by_name[name];
            const std::string& prompt = ctx.user_prompt;
            futures.push_back(std::async(std::launch::async, [prompt, agent]() {
                return std::make_pair(agent->name, call_agent(*agent, prompt));
            }));
        }
        for (auto& fut : futures) {
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
    meta["mlx_classifier_override_used"] = mlx_classifier_override_used;
    meta["mlx_centric"] = mlx_centric;
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
