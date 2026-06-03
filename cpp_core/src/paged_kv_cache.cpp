#include "paged_kv_cache.h"

namespace model_mem {

PagedKVCache::PagedKVCache(std::size_t page_tokens) : page_tokens_(page_tokens) {}

bool PagedKVCache::allocate_pages(std::size_t num_pages) {
#if MATRIX_PAGED_KV_ENABLED
    (void)num_pages;
    return false;  // Phase 2
#else
    pages_ = num_pages;
    return true;
#endif
}

void PagedKVCache::reset() { pages_ = 0; }

std::size_t PagedKVCache::page_count() const { return pages_; }

std::size_t PagedKVCache::bytes_reserved() const {
    return pages_ * page_tokens_ * sizeof(std::uint32_t);
}

}  // namespace model_mem
