#include "path_expand.h"

#include <cstdlib>

namespace coordinator_config {

namespace {

const char* kEnvKey = "MATRIX_MODEL_DIR";
const std::string kLegacyPrefix = "/Users/Shared/llama/models/";

std::string strip_trailing_slash(std::string s) {
    while (s.size() > 1 && s.back() == '/') s.pop_back();
    return s;
}

bool replace_token(std::string& s, const std::string& token, const std::string& val) {
    auto pos = s.find(token);
    if (pos == std::string::npos) return false;
    s.replace(pos, token.size(), val);
    return true;
}

}  // namespace

std::string expand_model_path(const std::string& path) {
    const char* env = std::getenv(kEnvKey);
    if (!env || !*env) {
        // No override available — return as-is. ${MATRIX_MODEL_DIR} tokens stay
        // in place; downstream validation will surface the bad path loudly.
        return path;
    }
    std::string model_dir = strip_trailing_slash(env);
    std::string out = path;

    // 1. Token substitution. Do all occurrences (the typical case has one).
    while (replace_token(out, "${MATRIX_MODEL_DIR}", model_dir)) {}
    while (replace_token(out, "$MATRIX_MODEL_DIR", model_dir)) {}

    // 2. Legacy prefix rewrite when env differs from the default.
    if (model_dir != strip_trailing_slash(kLegacyPrefix)
        && out.rfind(kLegacyPrefix, 0) == 0) {
        out = model_dir + "/" + out.substr(kLegacyPrefix.size());
    }
    return out;
}

}  // namespace coordinator_config
