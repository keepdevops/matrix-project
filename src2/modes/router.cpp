#include "mode.h"
#include "../agent_client.h"

#include <future>
#include <iostream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

using json = nlohmann::json;

namespace {

std::vector<std::string> as_string_vec(const json& j) {
    std::vector<std::string> out;
    if (!j.is_array()) return out;
    for (const auto& x : j) {
        if (x.is_string()) out.push_back(x.get<std::string>());
    }
    return out;
}

// Extract a JSON array from the classifier's raw text. Accepts a bare array or
// one fenced inside markdown. Returns empty vector + sets parse_ok=false on
// failure. Any parse failure is caller's cue to use fallback.
std::vector<std::string> parse_classifier_reply(const std::string& raw, bool& parse_ok) {
    parse_ok = false;
    auto lb = raw.find('[');
    auto rb = raw.rfind(']');
    if (lb == std::string::npos || rb == std::string::npos || rb <= lb) {
        return {};
    }
    std::string slice = raw.substr(lb, rb - lb + 1);
    try {
        json arr = json::parse(slice);
        auto names = as_string_vec(arr);
        parse_ok = true;
        return names;
    } catch (const std::exception& e) {
        std::cerr << "❌ [router] classifier JSON parse failed: " << e.what() << std::endl;
        return {};
    }
}

std::string build_classifier_system(const std::vector<std::string>& choices,
                                    int max_select) {
    std::string list = "[";
    for (size_t i = 0; i < choices.size(); ++i) {
        if (i) list += ", ";
        list += "\"" + choices[i] + "\"";
    }
    list += "]";
    std::string out;
    out.reserve(list.size() + 320);
    out += "You are a routing classifier. Your ONLY job is to choose between 1 and ";
    out += std::to_string(max_select);
    out += " agent names from this exact list: ";
    out += list;
    out += ".\nReply with ONLY a JSON array of names from that list. No prose. No markdown. No explanation. No code fences.\n";
    out += "Example valid reply: [\"programmer\"]\n";
    out += "Example valid reply: [\"architect\",\"reviewer\"]";
    return out;
}

std::string build_classifier_user(const std::string& user_prompt) {
    return "User request:\n<<<\n" + user_prompt + "\n>>>";
}

json run_router(const ModeContext& ctx) {
    const auto& cfg = ctx.mode_config;
    json meta = json::object();

    std::unordered_map<std::string, const Agent*> by_name;
    for (const auto& a : ctx.agents) by_name[a.name] = &a;

    std::string classifier_name = cfg.value("classifier", std::string(""));
    int max_select = cfg.value("max_select", 3);
    std::vector<std::string> fallback = cfg.contains("fallback")
        ? as_string_vec(cfg["fallback"]) : std::vector<std::string>{};

    std::vector<std::string> choices = cfg.contains("choices")
        ? as_string_vec(cfg["choices"]) : std::vector<std::string>{};
    if (choices.empty()) {
        for (const auto& a : ctx.agents) {
            if (a.name != classifier_name) choices.push_back(a.name);
        }
    }
    std::unordered_set<std::string> choice_set(choices.begin(), choices.end());

    if (classifier_name.empty() || by_name.find(classifier_name) == by_name.end()) {
        std::cerr << "❌ [router] classifier '" << classifier_name
                  << "' not found among active agents" << std::endl;
        meta["error"] = "classifier not available";
        meta["classifier"] = classifier_name;
        return json{
            {"mode", "router"},
            {"agents", json::object()},
            {"final", nullptr},
            {"meta", meta}
        };
    }

    std::cout << "🧭 [router] classifier=" << classifier_name
              << " choices=" << choices.size()
              << " max_select=" << max_select << std::endl;

    const std::string classifier_system = build_classifier_system(choices, max_select);
    const std::string classifier_user = build_classifier_user(ctx.user_prompt);
    const std::string raw = call_agent_with_system(
        *by_name[classifier_name], classifier_system, classifier_user);

    bool parse_ok = false;
    std::vector<std::string> parsed = parse_classifier_reply(raw, parse_ok);

    std::vector<std::string> selected;
    std::unordered_set<std::string> seen;
    for (const auto& name : parsed) {
        if (!choice_set.count(name)) continue;
        if (by_name.find(name) == by_name.end()) continue;
        if (seen.insert(name).second) selected.push_back(name);
        if ((int)selected.size() >= max_select) break;
    }

    bool fallback_used = false;
    if (selected.empty()) {
        fallback_used = true;
        std::cerr << "⚠️  [router] no valid selection; using fallback" << std::endl;
        for (const auto& name : fallback) {
            if (by_name.find(name) == by_name.end()) continue;
            if (seen.insert(name).second) selected.push_back(name);
            if ((int)selected.size() >= max_select) break;
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
    meta["selected"] = selected;
    meta["classifier_raw"] = raw;
    meta["fallback_used"] = fallback_used;
    meta["parse_ok"] = parse_ok;

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
