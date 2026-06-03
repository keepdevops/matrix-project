#include "model_registry.h"

namespace model_mem {

ModelRegistry& ModelRegistry::instance() {
    static ModelRegistry reg;
    return reg;
}

bool ModelRegistry::acquire(const std::string& model_id, const std::string& quant) {
    if (model_id.empty()) return false;
    const ModelKey key{model_id, quant.empty() ? "default" : quant};
    std::lock_guard<std::mutex> lk(mu_);
    auto& e = entries_[key];
    ++e.ref_count;
    ++e.acquire_calls;
    return true;
}

void ModelRegistry::release(const std::string& model_id, const std::string& quant) {
    const ModelKey key{model_id, quant.empty() ? "default" : quant};
    std::lock_guard<std::mutex> lk(mu_);
    auto it = entries_.find(key);
    if (it == entries_.end()) return;
    if (it->second.ref_count > 0) --it->second.ref_count;
    // Drop only when nothing holds it AND no in-process model is resident
    // (gen_calls>0 ⇒ a loaded MLX model lives under this key; eviction owns it).
    if (it->second.ref_count == 0 && it->second.gen_calls == 0)
        entries_.erase(it);
}

int ModelRegistry::resident_count() const {
    std::lock_guard<std::mutex> lk(mu_);
    return static_cast<int>(entries_.size());
}

nlohmann::json ModelRegistry::snapshot() const {
    std::lock_guard<std::mutex> lk(mu_);
    nlohmann::json rows = nlohmann::json::array();
#ifdef MATRIX_MLX_EMBED
    const auto now = std::chrono::steady_clock::now();
#endif
    for (const auto& [k, e] : entries_) {
        nlohmann::json row = {
            {"model_id",      k.model_id},
            {"quant",         k.quant},
            {"ref_count",     e.ref_count},
            {"acquire_calls", e.acquire_calls},
            {"gen_calls",     e.gen_calls},
        };
#ifdef MATRIX_MLX_EMBED
        row["agents_seen"] = static_cast<int>(e.agents_seen.size());
        row["idle_secs"]   = static_cast<int>(
            std::chrono::duration<double>(now - e.last_used).count());
#endif
        rows.push_back(std::move(row));
    }
    return {{"resident_count", entries_.size()}, {"models", rows}};
}

}  // namespace model_mem
