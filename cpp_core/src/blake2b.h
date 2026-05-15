#pragma once
// BLAKE2b unkeyed hash, variable output length 1..64 bytes.
// Reference: RFC 7693. Vendored solely so rag_embed can match Python's
// hashlib.blake2b(digest_size=16) byte-for-byte without adding a system dep.

#ifdef __cplusplus
#include <cstddef>
#include <cstdint>
#else
#include <stddef.h>
#include <stdint.h>
#endif

#ifdef __cplusplus
extern "C" {
#endif

// One-shot BLAKE2b. out_len in [1,64], out must hold out_len bytes.
// Returns 0 on success, -1 on bad arguments.
int matrix_blake2b(void* out, size_t out_len,
                   const void* in, size_t in_len);

#ifdef __cplusplus
}
#endif
