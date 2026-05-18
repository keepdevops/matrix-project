#include "synthesis_budget.h"

#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

namespace synthesis_budget {

size_t effective_max_prompt_chars(const Agent* synthesizer) {
    if (const char* e = std::getenv("MATRIX_SYNTHESIS_MAX_PROMPT_TOKENS")) {
        try {
            unsigned v = static_cast<unsigned>(std::stoul(e));
            if (v >= 256 && v <= 262144) return static_cast<size_t>(v) * 4;
        } catch (...) {}
    }
    if (synthesizer && synthesizer->context_window >= 512) {
        unsigned ctx = static_cast<unsigned>(synthesizer->context_window);
        unsigned mt = static_cast<unsigned>(std::max(1, synthesizer->max_tokens));
        const unsigned reserve = 768u;
        if (ctx <= mt + reserve + 64u) return 256u * 4u;
        unsigned avail = ctx - mt - reserve;
        avail = std::max(256u, std::min(avail, 262144u));
        return static_cast<size_t>(avail) * 4u;
    }
    return static_cast<size_t>(1400u) * 4u;
}

namespace {

std::string truncate_note(const std::string& s, size_t max_chars) {
    if (s.size() <= max_chars) return s;
    if (max_chars <= 80) return s.substr(0, max_chars);
    return s.substr(0, max_chars - 1) + "\n\n[…truncated for synthesizer context budget]";
}

/** prefix + each (header[i]+body[i]) + footer must fit in max_total bytes. */
std::string assemble_fit(const std::string& prefix,
    const std::vector<std::string>& headers,
    std::vector<std::string>& bodies,
    const std::string& footer,
    size_t max_total) {
    auto total_len = [&]() {
        size_t t = prefix.size() + footer.size();
        for (size_t i = 0; i < bodies.size(); ++i) t += headers[i].size() + bodies[i].size();
        return t;
    };

    if (bodies.size() != headers.size()) return prefix + footer;

    size_t overhead = prefix.size() + footer.size();
    for (const auto& h : headers) overhead += h.size();

    if (max_total <= overhead + 16) {
        std::cerr << "⚠️  [synthesis] context budget smaller than fixed overhead; aggressive trim"
                  << std::endl;
        std::string p = truncate_note(prefix, max_total / 3);
        std::string out = p;
        for (size_t i = 0; i < bodies.size(); ++i) {
            out += headers[i];
            out += truncate_note(bodies[i], 256);
        }
        out += footer;
        return truncate_note(out, max_total);
    }

    if (total_len() <= max_total) return [&]() {
            std::string out;
            out.reserve(max_total);
            out += prefix;
            for (size_t i = 0; i < bodies.size(); ++i) {
                out += headers[i];
                out += bodies[i];
            }
            out += footer;
            return out;
        }();

    size_t room = max_total - overhead;

    // Single-pass proportional trim: compute each body's fair share of the
    // available room, then truncate in one shot. Bodies smaller than their
    // share are left untouched; excess bytes from short bodies are distributed
    // to longer ones via a second pass over the remainder.
    {
        size_t n = bodies.size();
        if (n == 0) n = 1;
        size_t total_body = 0;
        for (const auto& b : bodies) total_body += b.size();

        if (total_body > room) {
            // Proportional allocation: each body gets room * (its_size / total).
            // Use two passes to reclaim slack from bodies already under their quota.
            std::vector<size_t> alloc(bodies.size());
            size_t claimed = 0;
            for (size_t i = 0; i < bodies.size(); ++i) {
                alloc[i] = (room * bodies[i].size()) / total_body;
                alloc[i] = std::max<size_t>(alloc[i], 128);
                claimed += std::min(bodies[i].size(), alloc[i]);
            }
            // Second pass: redistribute leftover room to bodies still over quota.
            size_t slack = room > claimed ? room - claimed : 0;
            if (slack > 0) {
                for (size_t i = 0; i < bodies.size() && slack > 0; ++i) {
                    if (bodies[i].size() > alloc[i]) {
                        size_t extra = std::min(slack, bodies[i].size() - alloc[i]);
                        alloc[i] += extra;
                        slack -= extra;
                    }
                }
            }
            for (size_t i = 0; i < bodies.size(); ++i) {
                if (bodies[i].size() > alloc[i])
                    bodies[i] = truncate_note(bodies[i], alloc[i]);
            }
        }
    }

    std::string out;
    out.reserve(std::min(max_total, total_len()));
    out += prefix;
    for (size_t i = 0; i < bodies.size(); ++i) {
        out += headers[i];
        out += bodies[i];
    }
    out += footer;
    if (out.size() > max_total) out = truncate_note(out, max_total);

    std::cerr << "⚠️  [synthesis] reduced synthesizer prompt to fit "
              << (max_total / 4) << " approximate tokens (set MATRIX_SYNTHESIS_MAX_PROMPT_TOKENS "
              << "or raise per-agent context / deploy)" << std::endl;
    return out;
}

}  // namespace

std::string build_pipeline_synthesis_prompt(
    const std::string& user_prompt,
    const std::vector<std::pair<std::string, std::string>>& stages_in_order,
    const Agent* synthesizer) {
    const std::string footer =
        "\n\nProduce ONE consolidated answer that integrates the "
        "above contributions. Resolve contradictions, drop redundancy, "
        "and keep only the strongest material. Do not enumerate the "
        "stages — write the final answer directly.";
    std::string prefix = "Original user request:\n<<<\n";
    prefix += user_prompt;
    prefix += "\n>>>\n\nThe following agents produced staged outputs:\n";

    std::vector<std::string> headers;
    std::vector<std::string> bodies;
    int n = 0;
    for (const auto& pr : stages_in_order) {
        ++n;
        std::string hdr = "\n--- Stage ";
        hdr += std::to_string(n);
        hdr += " (";
        hdr += pr.first;
        hdr += ") ---\n";
        headers.push_back(hdr);
        bodies.push_back(pr.second);
    }
    return assemble_fit(prefix, headers, bodies, footer,
                        effective_max_prompt_chars(synthesizer));
}

std::string build_cascade_synthesis_prompt(
    const std::string& user_prompt,
    const std::vector<std::pair<std::string, std::string>>& responses_in_order,
    const Agent* synthesizer) {
    const std::string footer =
        "\n\nProduce ONE consolidated answer that integrates the "
        "above contributions. Resolve contradictions, drop redundancy, "
        "and keep only the strongest material. Do not enumerate the "
        "responders — write the final answer directly.";
    std::string prefix = "Original user request:\n<<<\n";
    prefix += user_prompt;
    prefix += "\n>>>\n\nThe following agents responded in parallel:\n";

    std::vector<std::string> headers;
    std::vector<std::string> bodies;
    int n = 0;
    for (const auto& pr : responses_in_order) {
        ++n;
        std::string hdr = "\n--- Response ";
        hdr += std::to_string(n);
        hdr += " (";
        hdr += pr.first;
        hdr += ") ---\n";
        headers.push_back(hdr);
        bodies.push_back(pr.second);
    }
    return assemble_fit(prefix, headers, bodies, footer,
                        effective_max_prompt_chars(synthesizer));
}

std::string build_stream_synthesis_prompt(
    const std::string& user_prompt,
    const std::vector<std::pair<std::string, std::string>>& contributors_in_order,
    const Agent* synthesizer) {
    const std::string footer =
        "\n\nProduce ONE consolidated answer that integrates the "
        "above contributions. Resolve contradictions, drop redundancy. "
        "Write the final answer directly.";
    std::string prefix = "Original user request:\n<<<\n";
    prefix += user_prompt;
    prefix += "\n>>>\n\nThe following agents contributed:\n";

    std::vector<std::string> headers;
    std::vector<std::string> bodies;
    int n = 0;
    for (const auto& pr : contributors_in_order) {
        ++n;
        std::string hdr = "\n--- " + std::to_string(n) + " (" + pr.first + ") ---\n";
        headers.push_back(hdr);
        bodies.push_back(pr.second);
    }
    return assemble_fit(prefix, headers, bodies, footer,
                        effective_max_prompt_chars(synthesizer));
}

}  // namespace synthesis_budget
