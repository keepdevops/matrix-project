#include "code_fence_normalize.h"

#include <cassert>
#include <iostream>
#include <string>

static void test_no_fence_unchanged() {
    const std::string raw = "Just an explanation without code.";
    assert(code_fence::normalize_for_history(raw) == raw);
}

static void test_strip_prose_wrap_fence() {
    const std::string raw =
        "Here is the solution:\n\n```python\nprint(\"ok\")\n```\n\nHope this helps.";
    const std::string out = code_fence::normalize_for_history(raw);
    assert(out.find("Here is") == std::string::npos);
    assert(out.find("```python") != std::string::npos);
    assert(out.find("print(\"ok\")") != std::string::npos);
}

static void test_multiple_fences_kept() {
    const std::string raw =
        "Intro\n```py\nvalue = 10\n```\nmid\n```js\nconst y = 2;\n```";
    const std::string out = code_fence::normalize_for_history(raw);
    assert(out.find("Intro") == std::string::npos);
    assert(out.find("value = 10") != std::string::npos);
    assert(out.find("const y = 2") != std::string::npos);
}

static void test_agents_entry_skips_metadata() {
    nlohmann::json entry = {
        {"prompt", "build fib"},
        {"programmer", "text\n```python\nprint(\"ok\")\n```\n"},
        {"architect", "plan only"},
    };
    code_fence::normalize_agents_in_entry(entry);
    assert(entry["prompt"].get<std::string>() == "build fib");
    assert(entry["architect"].get<std::string>() == "plan only");
    const std::string p = entry["programmer"].get<std::string>();
    assert(p.find("text\n") == std::string::npos || p.find("```python") != std::string::npos);
}

int main() {
    test_no_fence_unchanged();
    test_strip_prose_wrap_fence();
    test_multiple_fences_kept();
    test_agents_entry_skips_metadata();
    std::cout << "code_fence_normalize_test: ok\n";
    return 0;
}
