// #143 forward-port: proxy_configure port-grouping key (ports_assign::assign_key).
// Pins the rule that the same llama GGUF shares one port group regardless of the
// (UI-only) server_group label — preventing duplicate ~18GB loads / Metal OOM.

#include "proxy_configure_ports_assign.h"

#include <cassert>
#include <iostream>

int main() {
    using ports_assign::assign_key;
    const std::string M1 = "/models/gemma-26b-Q4.gguf";
    const std::string M2 = "/models/llama-8b-Q4.gguf";

    // THE FIX: same llama model, different server_group → SAME key (one group).
    assert(assign_key("llama", M1, "groupA", 0) == assign_key("llama", M1, "groupB", 0));
    assert(assign_key("llama", M1, "", 0)       == assign_key("llama", M1, "anything", 0));

    // Different llama models → different keys (still separate groups).
    assert(assign_key("llama", M1, "g", 0) != assign_key("llama", M2, "g", 0));

    // Non-llama backends unchanged:
    assert(assign_key("docker", M1, "g", 0) == "docker:shared");
    assert(assign_key("mlx", M1, "g", 8083) == "mlx:8083");          // keyed by fixed port
    assert(assign_key("vllm", M1, "g", 9000) == "vllm:9000");
    // vllm with no fixed port falls through to backend:model:sg (server_group kept).
    assert(assign_key("vllm", M1, "gA", 0) != assign_key("vllm", M1, "gB", 0));

    std::cout << "✅ test_port_assign: all assertions passed\n";
    return 0;
}
