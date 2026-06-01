#pragma once
#include "json.hpp"
#include <algorithm>
#include <string>

namespace pipeline_stage {

// Compacts prev_output to fit within stage_context_chars, recording the
// compaction event in stage_compaction. Returns the (possibly truncated) text.
inline std::string compact_context(
    const std::string& prev_output,
    const std::string& prev_agent,
    int stage_context_chars,
    int step,
    nlohmann::json& stage_compaction) {
    if (stage_context_chars <= 0 || prev_agent.empty()) return prev_output;
    if ((int)prev_output.size() <= stage_context_chars) return prev_output;
    const size_t half = static_cast<size_t>(stage_context_chars) / 2;
    stage_compaction.push_back({
        {"before_step", step},
        {"source_agent", prev_agent},
        {"original_chars", (int)prev_output.size()},
        {"kept_chars", (int)(half * 2 + 60)}
    });
    return prev_output.substr(0, half)
        + "\n\n[... previous stage output compacted ...]\n\n"
        + prev_output.substr(prev_output.size() - half);
}

}  // namespace pipeline_stage
