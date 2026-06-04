// MS-71/73 runtime test: token_ledger accounting + overrun gate. The grep-tests
// only checked that callers *mention* token_ledger::add / token_budget_exceeded;
// here the accounting and the overrun decision actually execute, so a broken
// budget cap (the class behind #291/#297/#302) is caught.

#include "token_ledger.h"

#include <cassert>
#include <iostream>

int main() {
    using namespace token_ledger;

    // ── Entry pure logic: remaining() / overrun() ───────────────────────────
    {
        Entry unlimited;  // budget 0 = unlimited
        assert(unlimited.remaining() == -1);
        assert(!unlimited.overrun());

        Entry e; e.budget = 100; e.consumed = 70;
        assert(e.remaining() == 30);
        assert(!e.overrun());

        e.consumed = 100;                  // boundary: consumed == budget
        assert(e.overrun());
        assert(e.remaining() == 0);

        e.consumed = 130;                  // over: remaining clamps at 0
        assert(e.overrun());
        assert(e.remaining() == 0);
    }

    // ── Stateful accounting: set_budget → add → get/overrun ─────────────────
    const std::string sid = "tl-test-session";
    reset(sid);                            // clean slate
    set_budget(sid, 100);
    assert(get(sid).budget == 100);
    assert(get(sid).consumed == 0);

    add(sid, 40, 30);                      // 70 consumed
    assert(get(sid).consumed == 70);
    assert(get(sid).remaining() == 30);
    assert(!get(sid).overrun());

    // Backend that didn't report counts (-1) must not corrupt the total.
    add(sid, -1, 10);                      // only the +10 counts → 80
    assert(get(sid).consumed == 80);

    add(sid, 15, 20);                      // 115 → over budget
    assert(get(sid).overrun());
    assert(get(sid).remaining() == 0);

    // Snapshot reflects the overrun gate (the token_budget_exceeded source).
    const auto snap = snapshot(sid);
    assert(snap.value("overrun", false) == true);
    assert(snap.value("budget", 0) == 100);
    assert(snap.value("consumed", 0) == 115);

    // reset clears the entry.
    reset(sid);
    assert(get(sid).budget == 0 && get(sid).consumed == 0);

    std::cout << "\xE2\x9C\x85 test_token_ledger: all assertions passed\n";
    return 0;
}
