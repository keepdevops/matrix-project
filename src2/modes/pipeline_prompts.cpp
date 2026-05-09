#include "pipeline_prompts.h"

std::string build_pipeline_staged_user_prompt(const std::string& user_prompt,
        const std::string& prev_agent,
        const std::string& prev_output) {
    std::string out;
    out.reserve(user_prompt.size() + prev_output.size() + 160);
    out += "Original user request:\n<<<\n";
    out += user_prompt;
    out += "\n>>>\n\nPrevious step (";
    out += prev_agent;
    out += ") produced:\n<<<\n";
    out += prev_output;
    out += "\n>>>\n\nContinue the pipeline.";
    return out;
}
