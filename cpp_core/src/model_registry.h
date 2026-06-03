#pragma once
// MS-68 Phase B: central (model_id, quant) registry — extends MS-161 MlxModelRegistry later.

#include "json.hpp"
#include <map>
#include <mutex>
#include <string>
#include <utility>

namespace model_mem {

struct ModelKey {
    std::string model_id;
    std::string quant;
    bool operator<(const ModelKey& o) const {
        return model_id < o.model_id
            || (model_id == o.model_id && quant < o.quant);
    }
};

struct ModelEntry {
    int ref_count = 0;
    int acquire_calls = 0;
};

class ModelRegistry {
public:
    static ModelRegistry& instance();

    bool acquire(const std::string& model_id, const std::string& quant);
    void release(const std::string& model_id, const std::string& quant);
    int  resident_count() const;
    nlohmann::json snapshot() const;

private:
    ModelRegistry() = default;
    mutable std::mutex mu_;
    std::map<ModelKey, ModelEntry> entries_;
};

}  // namespace model_mem
