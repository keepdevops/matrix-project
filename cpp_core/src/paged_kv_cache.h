#pragma once
// MS-68 Phase B stub — paged KV interface; real Metal backing in Phase 2.

#include <cstddef>
#include <cstdint>
#include <string>

namespace model_mem {

#ifndef MATRIX_PAGED_KV_ENABLED
#define MATRIX_PAGED_KV_ENABLED 0
#endif

class PagedKVCache {
public:
    explicit PagedKVCache(std::size_t page_tokens = 256);
    bool   allocate_pages(std::size_t num_pages);
    void   reset();
    std::size_t page_count() const;
    std::size_t bytes_reserved() const;

private:
    std::size_t page_tokens_;
    std::size_t pages_ = 0;
};

}  // namespace model_mem
