#include "session_store_continuation.h"

#include <chrono>
#include <sstream>

using json = nlohmann::json;

namespace {

long long epoch_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
}

std::string json_string(const json& j, const std::string& key) {
    return j.contains(key) && j[key].is_string() ? j[key].get<std::string>() : std::string{};
}

bool include_name(const json& policy, const std::string& name) {
    if (!policy.contains("include") || !policy["include"].is_array()) return true;
    for (const auto& item : policy["include"]) {
        if (item.is_string() && item.get<std::string>() == name) return true;
    }
    return false;
}

std::string trim_block(const std::string& s, size_t max_chars) {
    if (s.size() <= max_chars) return s;
    if (max_chars < 256) return s.substr(0, max_chars);
    const size_t head = max_chars * 2 / 3;
    const size_t tail = max_chars - head;
    return s.substr(0, head)
        + "\n\n[...compacted: omitted "
        + std::to_string(s.size() - max_chars)
        + " chars...]\n\n"
        + s.substr(s.size() - tail);
}

std::string first_lines(const std::string& s, size_t max_lines, size_t max_chars) {
    std::string out;
    size_t lines = 0;
    for (char c : s) {
        if (out.size() >= max_chars) break;
        out.push_back(c);
        if (c == '\n' && ++lines >= max_lines) break;
    }
    if (s.size() > out.size()) out += "\n[...compacted...]";
    return out;
}

void append_section(std::ostringstream& os,
                    const std::string& title,
                    const std::string& body) {
    if (body.empty()) return;
    os << "\n\n## " << title << "\n" << body;
}

const json* latest_run_for_session(const json& sessions, const std::string& session_id) {
    if (!sessions.is_object() || !sessions.contains(session_id)) return nullptr;
    const json& sess = sessions[session_id];
    if (!sess.contains("runs") || !sess["runs"].is_array() || sess["runs"].empty()) return nullptr;
    return &sess["runs"].back();
}

std::string first_prompt_for_session(const json& sessions, const std::string& session_id) {
    if (!sessions.is_object() || !sessions.contains(session_id)) return {};
    const json& runs = sessions[session_id].value("runs", json::array());
    if (!runs.is_array() || runs.empty()) return {};
    return json_string(runs.front(), "prompt");
}

}  // namespace

SessionContinuation session_build_continuation_impl(
    const json& sessions,
    const std::string& session_id,
    const std::string& followup,
    const json& context_policy) {
    SessionContinuation out;
    const json* prev = latest_run_for_session(sessions, session_id);
    if (!prev) {
        out.prompt = followup;
        out.compaction = {{"used", false}, {"reason", "session_not_found"}};
        return out;
    }

    const size_t max_context_chars = context_policy.value("max_context_chars", 24000);
    const std::string target_agent = context_policy.value("target_agent", std::string("programmer"));
    const bool include_final = include_name(context_policy, "final");
    const bool include_original = include_name(context_policy, "original_prompt");
    const bool include_target = include_name(context_policy, target_agent);
    bool compacted = false;

    const std::string original = first_prompt_for_session(sessions, session_id);
    std::ostringstream os;
    os << "You are continuing an existing Matrix Swarm session. "
       << "Use the prior context below, then answer the new follow-up. "
       << "Do not restart from scratch unless the follow-up asks you to.\n";

    if (include_original) {
        const size_t budget = max_context_chars / 5;
        compacted = compacted || original.size() > budget;
        append_section(os, "Original user request", trim_block(original, budget));
    }

    if (include_final) {
        const std::string final = json_string(*prev, "final");
        const size_t budget = max_context_chars / 4;
        compacted = compacted || final.size() > budget;
        append_section(os, "Previous final answer", trim_block(final, budget));
    }

    if (prev->contains("agents") && (*prev)["agents"].is_object()) {
        const json& agents = (*prev)["agents"];
        if (include_target && agents.contains(target_agent) && agents[target_agent].is_string()) {
            const std::string target = agents[target_agent].get<std::string>();
            const size_t budget = max_context_chars / 2;
            compacted = compacted || target.size() > budget;
            append_section(os, "Previous " + target_agent + " answer", trim_block(target, budget));
        }

        std::ostringstream summary;
        for (auto it = agents.begin(); it != agents.end(); ++it) {
            if (it.key() == target_agent) continue;
            if (!it.value().is_string()) continue;
            compacted = compacted || it.value().get<std::string>().size() > 900;
            summary << "- " << it.key() << ": "
                    << first_lines(it.value().get<std::string>(), 3, 900) << "\n";
        }
        append_section(os, "Other previous agent notes", summary.str());
    }

    append_section(os, "User follow-up", followup);
    os << "\n\nContinue from the previous answer. Add concrete detail and preserve useful prior work.";

    std::string built = os.str();
    if (built.size() > max_context_chars) {
        compacted = true;
        const size_t followup_budget = std::min<size_t>(followup.size(), max_context_chars / 4);
        built = trim_block(built, max_context_chars - followup_budget)
            + "\n\n## User follow-up\n"
            + trim_block(followup, followup_budget);
    }

    out.prompt = built;
    out.compaction = {
        {"used", compacted},
        {"max_context_chars", max_context_chars},
        {"original_chars", original.size()},
        {"built_chars", built.size()},
        {"target_agent", target_agent}
    };
    return out;
}
