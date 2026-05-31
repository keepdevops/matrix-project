#pragma once

#include "../agent.h"
#include "../json.hpp"
#include "mode.h"

#include <string>
#include <unordered_map>
#include <vector>

namespace router_classifier {

std::string choose_classifier(const std::vector<Agent>& agents);

struct ClassifierPrompt {
    std::string system;
    std::string user;
    std::string load_csv;
};

ClassifierPrompt build_classifier_prompt(
    const std::vector<std::string>& choices,
    const std::unordered_map<std::string, const Agent*>& by_name,
    const std::vector<Agent>& agents,
    const std::string& user_prompt,
    int max_select,
    const std::string& classifier_policy);

}  // namespace router_classifier
