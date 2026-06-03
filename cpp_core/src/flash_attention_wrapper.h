#pragma once
// MS-68 Phase B stub — Metal flash-attn spike behind flag (Phase 2).

#include <string>

namespace model_mem {

#ifndef MATRIX_FLASH_ATTENTION_ENABLED
#define MATRIX_FLASH_ATTENTION_ENABLED 0
#endif

struct FlashAttnConfig {
    bool enabled = false;
    int  head_dim = 128;
};

class FlashAttentionWrapper {
public:
    explicit FlashAttentionWrapper(FlashAttnConfig cfg = {});
    bool available() const;
    bool forward_stub(const std::string& label) const;

private:
    FlashAttnConfig cfg_;
};

}  // namespace model_mem
