#include "flash_attention_wrapper.h"

namespace model_mem {

FlashAttentionWrapper::FlashAttentionWrapper(FlashAttnConfig cfg) : cfg_(cfg) {}

bool FlashAttentionWrapper::available() const {
#if MATRIX_FLASH_ATTENTION_ENABLED
    return cfg_.enabled;
#else
    return false;
#endif
}

bool FlashAttentionWrapper::forward_stub(const std::string& label) const {
    (void)label;
    return available();
}

}  // namespace model_mem
