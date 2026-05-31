"""Integration tests for POST /api/history/entry (C++ coordinator route)."""


def test_history_entry_persists_orchestrate_run(matrix):
    status, body = matrix.post("/api/history/entry", {
        "prompt": "design a queue",
        "result": "use a ring buffer",
        "mode": "map_reduce",
        "session_id": "sess-orch-1",
        "temperature": 0.3,
    })
    assert status == 200
    assert body.get("ok") is True


def test_history_entry_requires_prompt(matrix):
    status, _ = matrix.post("/api/history/entry", {
        "result": "orphan result",
        "mode": "flat",
    })
    assert status == 400
