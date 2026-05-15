// BLAKE2b unkeyed hash, variable output length 1..64 bytes.
// Reference: RFC 7693 (Appendix A) — straightforward, unoptimised.
// Vendored to avoid a libsodium/libb2 dependency. The rag_embed unit test
// asserts byte-equality against Python hashlib.blake2b for fixed fixtures.

#include "blake2b.h"

#include <stdint.h>
#include <string.h>

static const uint64_t BLAKE2B_IV[8] = {
    0x6a09e667f3bcc908ULL, 0xbb67ae8584caa73bULL,
    0x3c6ef372fe94f82bULL, 0xa54ff53a5f1d36f1ULL,
    0x510e527fade682d1ULL, 0x9b05688c2b3e6c1fULL,
    0x1f83d9abfb41bd6bULL, 0x5be0cd19137e2179ULL
};

static const uint8_t BLAKE2B_SIGMA[12][16] = {
    { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14,15 },
    {14,10, 4, 8, 9,15,13, 6, 1,12, 0, 2,11, 7, 5, 3 },
    {11, 8,12, 0, 5, 2,15,13,10,14, 3, 6, 7, 1, 9, 4 },
    { 7, 9, 3, 1,13,12,11,14, 2, 6, 5,10, 4, 0,15, 8 },
    { 9, 0, 5, 7, 2, 4,10,15,14, 1,11,12, 6, 8, 3,13 },
    { 2,12, 6,10, 0,11, 8, 3, 4,13, 7, 5,15,14, 1, 9 },
    {12, 5, 1,15,14,13, 4,10, 0, 7, 6, 3, 9, 2, 8,11 },
    {13,11, 7,14,12, 1, 3, 9, 5, 0,15, 4, 8, 6, 2,10 },
    { 6,15,14, 9,11, 3, 0, 8,12, 2,13, 7, 1, 4,10, 5 },
    {10, 2, 8, 4, 7, 6, 1, 5,15,11, 9,14, 3,12,13, 0 },
    { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14,15 },
    {14,10, 4, 8, 9,15,13, 6, 1,12, 0, 2,11, 7, 5, 3 }
};

static uint64_t rotr64(uint64_t x, unsigned n) {
    return (x >> n) | (x << (64 - n));
}

#define G(r, i, a, b, c, d)                                  \
    do {                                                     \
        a = a + b + m[BLAKE2B_SIGMA[r][2*i+0]];              \
        d = rotr64(d ^ a, 32);                               \
        c = c + d;                                           \
        b = rotr64(b ^ c, 24);                               \
        a = a + b + m[BLAKE2B_SIGMA[r][2*i+1]];              \
        d = rotr64(d ^ a, 16);                               \
        c = c + d;                                           \
        b = rotr64(b ^ c, 63);                               \
    } while (0)

typedef struct {
    uint64_t h[8];
    uint64_t t[2];
    uint8_t  buf[128];
    size_t   buf_len;
    size_t   out_len;
} blake2b_ctx;

static uint64_t load64_le(const uint8_t* p) {
    return ((uint64_t)p[0])       | ((uint64_t)p[1] << 8)  |
           ((uint64_t)p[2] << 16) | ((uint64_t)p[3] << 24) |
           ((uint64_t)p[4] << 32) | ((uint64_t)p[5] << 40) |
           ((uint64_t)p[6] << 48) | ((uint64_t)p[7] << 56);
}

static void store_le(uint8_t* p, uint64_t v) {
    for (int i = 0; i < 8; ++i) p[i] = (uint8_t)(v >> (8*i));
}

static void blake2b_compress(blake2b_ctx* ctx, int last) {
    uint64_t v[16];
    uint64_t m[16];
    for (int i = 0; i < 8; ++i) {
        v[i]   = ctx->h[i];
        v[i+8] = BLAKE2B_IV[i];
    }
    v[12] ^= ctx->t[0];
    v[13] ^= ctx->t[1];
    if (last) v[14] = ~v[14];

    for (int i = 0; i < 16; ++i) m[i] = load64_le(ctx->buf + 8*i);

    for (int r = 0; r < 12; ++r) {
        G(r, 0, v[ 0], v[ 4], v[ 8], v[12]);
        G(r, 1, v[ 1], v[ 5], v[ 9], v[13]);
        G(r, 2, v[ 2], v[ 6], v[10], v[14]);
        G(r, 3, v[ 3], v[ 7], v[11], v[15]);
        G(r, 4, v[ 0], v[ 5], v[10], v[15]);
        G(r, 5, v[ 1], v[ 6], v[11], v[12]);
        G(r, 6, v[ 2], v[ 7], v[ 8], v[13]);
        G(r, 7, v[ 3], v[ 4], v[ 9], v[14]);
    }
    for (int i = 0; i < 8; ++i) ctx->h[i] ^= v[i] ^ v[i+8];
}

static int blake2b_init(blake2b_ctx* ctx, size_t out_len) {
    if (out_len == 0 || out_len > 64) return -1;
    memset(ctx, 0, sizeof(*ctx));
    for (int i = 0; i < 8; ++i) ctx->h[i] = BLAKE2B_IV[i];
    // Parameter block, unkeyed: digest_len | (key_len=0 << 8) | (fanout=1 << 16) | (depth=1 << 24)
    ctx->h[0] ^= 0x01010000ULL ^ (uint64_t)out_len;
    ctx->out_len = out_len;
    return 0;
}

static void blake2b_update(blake2b_ctx* ctx, const uint8_t* in, size_t in_len) {
    while (in_len > 0) {
        if (ctx->buf_len == 128) {
            ctx->t[0] += 128;
            if (ctx->t[0] < 128) ctx->t[1]++;
            blake2b_compress(ctx, 0);
            ctx->buf_len = 0;
        }
        size_t take = 128 - ctx->buf_len;
        if (take > in_len) take = in_len;
        memcpy(ctx->buf + ctx->buf_len, in, take);
        ctx->buf_len += take;
        in     += take;
        in_len -= take;
    }
}

static void blake2b_final(blake2b_ctx* ctx, uint8_t* out) {
    ctx->t[0] += ctx->buf_len;
    if (ctx->t[0] < ctx->buf_len) ctx->t[1]++;
    memset(ctx->buf + ctx->buf_len, 0, 128 - ctx->buf_len);
    blake2b_compress(ctx, 1);
    uint8_t full[64];
    for (int i = 0; i < 8; ++i) store_le(full + 8*i, ctx->h[i]);
    memcpy(out, full, ctx->out_len);
}

int matrix_blake2b(void* out, size_t out_len,
                   const void* in, size_t in_len) {
    if (out == NULL || out_len == 0 || out_len > 64) return -1;
    if (in == NULL && in_len != 0) return -1;
    blake2b_ctx ctx;
    if (blake2b_init(&ctx, out_len) != 0) return -1;
    if (in_len) blake2b_update(&ctx, (const uint8_t*)in, in_len);
    blake2b_final(&ctx, (uint8_t*)out);
    return 0;
}
