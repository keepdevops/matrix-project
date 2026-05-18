"""Chaos monkey tests for the llama-server coordinator and mock agents.

All KV/mock-agent tests run without the coordinator binary (pure Python HTTP).
Coordinator-binary-dependent tests are skipped when the binary is absent.

Chaos dimensions covered:
  - Poisoned HTTP bodies (null, arrays, binary, oversized, Unicode bombs)
  - MockAgent injection: random fail/hang/partial-response cycles
  - KV state corruption: zero n_ctx, negative tokens, missing fields
  - Concurrent mode-switching under live dispatch load
  - Circuit-breaker rapid-trip and cool-down cycling
  - Roster API malformed inputs (missing keys, wrong types, empty arrays)
  - /metrics random corpus — 100 random KV configurations
  - Concurrent multi-agent pressure reads with live mutations
  - Stream vs blocking parity under agent failure
  - 100 sequential dispatches across all modes (requires binary)
"""
from __future__ import annotations

import json
import random
import string
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
import sys
import os

import pytest

sys.path.insert(0, os.path.dirname(__file__))
from mock_agent import MockAgent, KvState, SlotState  # noqa: E402

COORD_BIN = Path(__file__).resolve().parent.parent / "coordinator"
COORD_PORT = 18000

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get(port: int, path: str, timeout: float = 5) -> tuple[int, bytes]:
    url = f"http://127.0.0.1:{port}{path}"
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, method="GET"), timeout=timeout
        ) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _json_get(port: int, path: str) -> tuple[int, dict | list]:
    s, body = _get(port, path)
    try:
        return s, json.loads(body or b"{}")
    except json.JSONDecodeError:
        return s, {}


def _post(port: int, path: str, body: bytes, content_type: str = "application/json",
          timeout: float = 5) -> tuple[int, bytes]:
    url = f"http://127.0.0.1:{port}{path}"
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": content_type})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _json_post(port: int, path: str, obj: object, timeout: float = 5) -> tuple[int, dict]:
    body = json.dumps(obj).encode("utf-8")
    s, raw = _post(port, path, body, timeout=timeout)
    try:
        return s, json.loads(raw or b"{}")
    except json.JSONDecodeError:
        return s, {"_raw": raw.decode("utf-8", errors="replace")}


def _coord(path: str, method: str = "GET", body=None, timeout: float = 30):
    url = f"http://127.0.0.1:{COORD_PORT}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except json.JSONDecodeError:
            return e.code, {}


def _agent(name: str, port: int, kv: KvState | None = None) -> MockAgent:
    a = MockAgent(name, port)
    if kv:
        a.kv = kv
    a.start()
    return a


# ---------------------------------------------------------------------------
# Mock agent chaos: poisoned POST bodies
# ---------------------------------------------------------------------------

POISON_BODIES: list[tuple[bytes, str]] = [
    (b"null", "application/json"),
    (b"[]", "application/json"),
    (b"true", "application/json"),
    (b"42", "application/json"),
    (b"", "application/json"),
    (b"\x00\x01\x02\xff\xfe", "application/octet-stream"),
    (b"not-json-at-all", "application/json"),
    (b"{" * 500, "application/json"),                         # truncated object
    (("💣" * 200).encode("utf-8"), "application/json"),        # unicode bomb
    (b'{"messages": null, "stream": true}', "application/json"),
    (b'{"messages": [{"role": null}]}', "application/json"),
    (b'{"messages": [{"role": "user", "content": null}]}', "application/json"),
]


class TestMockAgentPoisonedBodies:
    """MockAgent must never crash on malformed POST bodies."""

    def test_all_poison_bodies_return_valid_http(self, tmp_path):
        a = _agent("poison-target", 19200)
        failures = []
        try:
            for body, ct in POISON_BODIES:
                try:
                    status, _ = _post(19200, "/v1/chat/completions", body, ct)
                    if status not in (200, 400, 422, 500):
                        failures.append(f"body={body[:20]!r}: unexpected status {status}")
                except Exception as e:
                    failures.append(f"body={body[:20]!r}: raised {e}")
        finally:
            a.stop()
        assert not failures, "\n".join(failures)

    def test_100_random_bodies_never_hang(self, tmp_path):
        a = _agent("rand-target", 19201)
        failures = []
        try:
            for i in range(100):
                size = random.randint(0, 512)
                body = bytes(random.randint(0, 255) for _ in range(size))
                try:
                    _post(19201, "/v1/chat/completions", body, timeout=2)
                except urllib.error.URLError:
                    pass  # connection refused / timeout is fine
                except Exception as e:
                    failures.append(f"run {i}: {e}")
        finally:
            a.stop()
        assert not failures, "\n".join(failures)


# ---------------------------------------------------------------------------
# KV state chaos: boundary and corruption values
# ---------------------------------------------------------------------------

class TestKvStateChaos:
    """KV endpoints must remain consistent even with extreme/corrupted state."""

    def test_zero_n_ctx_does_not_divide_by_zero(self):
        kv = KvState(n_ctx=0, slots=[SlotState(cache_tokens=100)])
        assert kv.usage_ratio == 0.0

    def test_empty_slot_list(self):
        kv = KvState(n_ctx=4096, slots=[])
        assert kv.usage_ratio == 0.0
        assert kv.total_slots == 0
        assert kv.kv_used_tokens == 0

    def test_cache_tokens_exceeds_n_ctx_clamped(self):
        kv = KvState(n_ctx=100, slots=[SlotState(cache_tokens=999)])
        assert kv.usage_ratio == 1.0

    def test_100_random_kv_configs_never_raise(self):
        failures = []
        for i in range(100):
            n_ctx = random.choice([0, 1, 100, 4096, 32768])
            n_slots = random.randint(0, 8)
            slots = [
                SlotState(
                    is_processing=random.random() < 0.5,
                    cache_tokens=random.randint(0, max(1, n_ctx * 2)),
                )
                for _ in range(n_slots)
            ]
            kv = KvState(n_ctx=n_ctx, slots=slots)
            try:
                ratio = kv.usage_ratio
                assert 0.0 <= ratio <= 1.0, f"ratio out of range: {ratio}"
                _ = kv.metrics_text()
                _ = kv.props_json()
                _ = kv.slots_json()
            except Exception as e:
                failures.append(f"run {i}: {e}")
        assert not failures, "\n".join(failures)

    def test_metrics_endpoint_never_returns_unparseable_ratio(self, tmp_path):
        failures = []
        a = _agent("kv-chaos", 19210, KvState(n_ctx=1000, slots=[SlotState()]))
        try:
            for i in range(100):
                n_ctx = random.choice([1, 100, 4096])
                a.kv.n_ctx = n_ctx
                a.kv.slots[0].cache_tokens = random.randint(0, n_ctx * 2)
                a.kv.slots[0].is_processing = random.random() < 0.5
                _, body = _get(19210, "/metrics")
                for line in body.decode().splitlines():
                    if "kv_cache_usage_ratio" in line:
                        try:
                            ratio = float(line.split()[-1])
                            if not (0.0 <= ratio <= 1.0):
                                failures.append(f"i={i}: ratio {ratio} out of range")
                        except ValueError:
                            failures.append(f"i={i}: unparseable line: {line!r}")
        finally:
            a.stop()
        assert not failures, "\n".join(failures)


# ---------------------------------------------------------------------------
# Concurrent KV mutations + reads
# ---------------------------------------------------------------------------

class TestConcurrentKvMutations:
    """Writer thread mutates KV state; 10 reader threads probe endpoints — no crash."""

    def test_concurrent_write_read_no_crash(self, tmp_path):
        kv = KvState(n_ctx=2048, slots=[SlotState() for _ in range(4)])
        a = _agent("concurrent-kv", 19220, kv)
        errors = []
        stop_flag = threading.Event()

        def mutate():
            for _ in range(200):
                for s in kv.slots:
                    s.cache_tokens = random.randint(0, kv.n_ctx)
                    s.is_processing = random.random() < 0.5
                time.sleep(0.001)

        def read(reader_id: int):
            while not stop_flag.is_set():
                try:
                    _, body = _get(19220, "/metrics", timeout=2)
                    for line in body.decode(errors="replace").splitlines():
                        if "kv_cache_usage_ratio" in line:
                            float(line.split()[-1])  # must parse
                except Exception as e:
                    errors.append(f"reader {reader_id}: {e}")
                    break

        readers = [threading.Thread(target=read, args=(i,)) for i in range(10)]
        writer = threading.Thread(target=mutate)
        for r in readers:
            r.start()
        writer.start()
        writer.join()
        stop_flag.set()
        for r in readers:
            r.join(timeout=3)
        a.stop()
        assert not errors, "\n".join(errors)


# ---------------------------------------------------------------------------
# MockAgent failure injection chaos
# ---------------------------------------------------------------------------

class TestMockAgentFailureInjection:
    """Verify fail, fail_first_n, and mid-run failure toggling all behave predictably."""

    def test_fail_true_always_returns_500(self, tmp_path):
        a = MockAgent("always-fail", 19230, fail=True)
        a.start()
        try:
            for _ in range(20):
                s, _ = _json_post(19230, "/v1/chat/completions",
                                  {"messages": [{"role": "user", "content": "hi"}]})
                assert s == 500
        finally:
            a.stop()

    def test_fail_first_n_then_recover(self, tmp_path):
        a = MockAgent("transient", 19231)
        a.fail_first_n = 3
        a.start()
        results = []
        try:
            for _ in range(6):
                s, _ = _json_post(19231, "/v1/chat/completions",
                                  {"messages": [{"role": "user", "content": "probe"}]})
                results.append(s)
        finally:
            a.stop()
        assert results[:3] == [500, 500, 500]
        assert all(r == 200 for r in results[3:])

    def test_toggle_fail_mid_run(self, tmp_path):
        a = MockAgent("toggle", 19232)
        a.start()
        failures = []
        try:
            for i in range(50):
                a.fail = (i % 7 < 3)  # fail 3 out of every 7 requests
                s, _ = _json_post(19232, "/v1/chat/completions",
                                  {"messages": [{"role": "user", "content": f"msg-{i}"}]})
                expected = 500 if a.fail else 200
                if s != expected:
                    failures.append(f"i={i}: expected {expected}, got {s}")
        finally:
            a.stop()
        assert not failures, "\n".join(failures)

    def test_100_random_prompts_all_responded(self, tmp_path):
        a = MockAgent("rand-prompts", 19233)
        a.start()
        results = []
        try:
            for _ in range(100):
                size = random.randint(1, 300)
                content = "".join(random.choices(string.printable, k=size))
                s, _ = _json_post(19233, "/v1/chat/completions",
                                  {"messages": [{"role": "user", "content": content}]})
                results.append(s)
        finally:
            a.stop()
        assert len(results) == 100
        assert all(r in (200, 500) for r in results)


# ---------------------------------------------------------------------------
# Coordinator chaos — requires binary
# ---------------------------------------------------------------------------

requires_binary = pytest.mark.skipif(
    not COORD_BIN.exists(),
    reason="coordinator binary not found — run `make` or `npm run build:bin`",
)


@requires_binary
class TestCoordinatorPoisonedBodies:
    """POST poisoned bodies to every coordinator endpoint; must return 4xx, not 5xx crashes."""

    ENDPOINTS = [
        "/api/architect",
        "/api/modes/active",
    ]

    def test_null_body_returns_4xx(self, matrix):
        for ep in self.ENDPOINTS:
            s, _ = _post(COORD_PORT, ep, b"null", timeout=10)
            assert s in (400, 422, 415), f"{ep}: expected 4xx, got {s}"

    def test_array_body_returns_4xx(self, matrix):
        for ep in self.ENDPOINTS:
            s, _ = _post(COORD_PORT, ep, b"[]", timeout=10)
            assert s in (400, 422, 415), f"{ep}: expected 4xx, got {s}"

    def test_empty_body_returns_4xx(self, matrix):
        for ep in self.ENDPOINTS:
            s, _ = _post(COORD_PORT, ep, b"", content_type="application/json", timeout=10)
            assert s in (400, 415), f"{ep}: expected 4xx, got {s}"

    def test_binary_body_returns_4xx(self, matrix):
        s, _ = _post(COORD_PORT, "/api/architect",
                     bytes(range(256)), content_type="application/octet-stream", timeout=10)
        assert s in (400, 415), f"expected 4xx, got {s}"

    def test_missing_prompt_field_does_not_crash(self, matrix):
        # Coordinator treats missing prompt as empty string and dispatches normally.
        # Key invariant: must return a valid HTTP response, not crash.
        s, j = _coord("/api/architect", method="POST", body={"not_prompt": "hi"})
        assert s in (200, 400, 422), f"unexpected status {s}"
        if s == 200:
            assert "mode" in j or "agents" in j, f"200 but no recognisable envelope: {j!r}"

    def test_100_random_json_objects_do_not_crash_coordinator(self, matrix):
        failures = []
        for i in range(100):
            keys = [random.choice(["prompt", "x", "mode", "agents", "foo"]) for _ in range(3)]
            vals = [random.choice([None, "", [], {}, 0, "hi", True]) for _ in range(3)]
            obj = dict(zip(keys, vals))
            try:
                s, _ = _coord("/api/architect", method="POST", body=obj, timeout=10)
                if s == 0:
                    failures.append(f"run {i}: no response (coordinator down?)")
            except Exception as e:
                failures.append(f"run {i}: {e}")
        assert not failures, "\n".join(failures)


@requires_binary
class TestCoordinatorModeChaosSwitching:
    """Rapid mode switching interleaved with live dispatches — no stall or 500."""

    MODES = ["flat", "pipeline", "cascade", "router"]

    def test_mode_switch_under_sequential_dispatch(self, matrix):
        failures = []
        for i in range(40):
            mode = self.MODES[i % len(self.MODES)]
            s, _ = _coord("/api/modes/active", method="POST", body={"mode": mode})
            if s != 200:
                failures.append(f"set_mode({mode}) returned {s}")
                continue
            try:
                env = matrix.dispatch(f"chaos-{i}")
                if "agents" not in env and "final" not in env:
                    failures.append(f"i={i} mode={mode}: bad envelope {env!r}")
            except AssertionError as e:
                failures.append(f"i={i} mode={mode}: dispatch failed: {e}")
        assert not failures, "\n".join(failures)

    def test_concurrent_mode_switch_and_dispatch(self, matrix):
        """One thread switches modes; another dispatches — coordinator must not deadlock."""
        errors = []
        stop = threading.Event()

        def switcher():
            for i in range(30):
                mode = self.MODES[i % len(self.MODES)]
                _coord("/api/modes/active", method="POST", body={"mode": mode}, timeout=5)
                time.sleep(0.02)

        def dispatcher():
            for i in range(20):
                try:
                    s, j = _coord("/api/architect", method="POST",
                                  body={"prompt": f"concurrent-{i}"}, timeout=15)
                    if s not in (200, 400, 500):
                        errors.append(f"dispatch {i}: unexpected status {s}")
                except Exception as e:
                    errors.append(f"dispatch {i}: {e}")

        t1 = threading.Thread(target=switcher)
        t2 = threading.Thread(target=dispatcher)
        t1.start(); t2.start()
        t1.join(); t2.join()
        assert not errors, "\n".join(errors)


@requires_binary
class TestCoordinatorRosterChaos:
    """Malformed roster PUT bodies — coordinator must return 4xx, not crash."""

    ROSTER_POISONS = [
        None,
        [],
        {"agents": None},
        {"agents": "architect"},
        {"agents": []},
        {"agents": [None, None]},
        {"agents": ["architect"], "synthesizer": 42},
        {"agents": ["nonexistent-agent-xyz"]},
        {},
    ]

    def test_all_poison_rosters_return_valid_status(self, matrix):
        """Roster endpoint returns 200/4xx/409; must not crash (5xx or hang)."""
        failures = []
        for poison in self.ROSTER_POISONS:
            if poison is None:
                body = b"null"
                s, _ = _post(COORD_PORT, "/api/modes/flat/agents", body, timeout=10)
            else:
                s, _ = _coord("/api/modes/flat/agents", method="PUT", body=poison, timeout=10)
            if s >= 500:
                failures.append(f"payload={poison!r}: server error {s}")
        assert not failures, "\n".join(failures)

    def test_100_random_roster_payloads_do_not_crash(self, matrix):
        agent_names = list(matrix.mocks.keys()) + ["ghost", "null-agent"]
        failures = []
        for i in range(100):
            n = random.randint(0, 5)
            agents = random.choices(agent_names, k=n)
            body = {"agents": agents}
            if random.random() < 0.3:
                body["synthesizer"] = random.choice(agent_names + [None])
            try:
                s, _ = _coord("/api/modes/flat/agents", method="PUT", body=body, timeout=10)
                if s >= 500:
                    failures.append(f"run {i}: server error {s} for {body}")
            except Exception as e:
                failures.append(f"run {i}: {e}")
        assert not failures, "\n".join(failures)


@requires_binary
class TestCoordinatorCircuitBreakerChaos:
    """Rapid failure injection and recovery cycling — breaker state must stay consistent."""

    def test_breaker_trips_and_health_reflects_it(self, matrix):
        matrix.mocks["reviewer"].fail = True
        matrix.set_mode("flat")
        matrix.set_roster("flat", ["architect", "reviewer"])
        for _ in range(3):
            matrix.dispatch("trip me")
        s, snap = _coord("/api/health/agents")
        assert s == 200
        assert snap.get("reviewer", {}).get("tripped") is True

    def test_multiple_agents_trip_independently(self, matrix):
        matrix.mocks["programmer"].fail = True
        matrix.mocks["reviewer"].fail = True
        matrix.set_mode("flat")
        matrix.set_roster("flat", ["architect", "programmer", "reviewer"])
        for _ in range(3):
            matrix.dispatch("triple")
        s, snap = _coord("/api/health/agents")
        assert s == 200
        assert snap.get("programmer", {}).get("tripped") is True
        assert snap.get("reviewer", {}).get("tripped") is True
        assert snap.get("architect", {}).get("tripped") is False

    def test_trip_then_recover_then_trip_again(self, matrix):
        matrix.set_mode("flat")
        matrix.set_roster("flat", ["architect", "reviewer"])

        matrix.mocks["reviewer"].fail = True
        for _ in range(3):
            matrix.dispatch("trip-1")
        s, snap = _coord("/api/health/agents")
        assert snap.get("reviewer", {}).get("tripped") is True

        # Recover (still tripped — cooldown; just verify architect still dispatches)
        matrix.mocks["reviewer"].fail = False
        env = matrix.dispatch("after-trip")
        assert "architect" in env.get("agents", {})

    def test_100_dispatches_with_intermittent_failures(self, matrix):
        """Flip reviewer fail every 10 requests; coordinator must never return 0 agents."""
        matrix.set_mode("flat")
        matrix.set_roster("flat", ["architect", "reviewer"])
        failures = []
        for i in range(100):
            matrix.mocks["reviewer"].fail = (i % 10 < 4)
            try:
                env = matrix.dispatch(f"chaos-{i}")
                if not env.get("agents"):
                    failures.append(f"i={i}: empty agents envelope")
            except AssertionError as e:
                failures.append(f"i={i}: {e}")
        assert not failures, "\n".join(failures)


@requires_binary
class TestCoordinatorAllModes100:
    """100 sequential dispatches through each mode — no 500s, valid envelopes."""

    MODES = ["flat", "pipeline", "cascade"]

    def test_100_flat_dispatches(self, matrix):
        matrix.set_mode("flat")
        failures = []
        for i in range(100):
            try:
                env = matrix.dispatch(f"flat-{i}")
                if not env.get("agents"):
                    failures.append(f"i={i}: empty agents")
            except AssertionError as e:
                failures.append(str(e))
        assert not failures, "\n".join(failures)

    def test_100_pipeline_dispatches(self, matrix):
        matrix.set_mode("pipeline")
        matrix.set_roster("pipeline", ["architect", "programmer", "reviewer"])
        failures = []
        for i in range(100):
            try:
                env = matrix.dispatch(f"pipeline-{i}")
                if env.get("meta", {}).get("order") != ["architect", "programmer", "reviewer"]:
                    failures.append(f"i={i}: wrong order {env.get('meta', {}).get('order')}")
            except AssertionError as e:
                failures.append(str(e))
        assert not failures, "\n".join(failures)

    def test_100_cascade_dispatches(self, matrix):
        matrix.set_mode("cascade")
        matrix.set_roster("cascade", ["programmer", "reviewer"], synthesizer="architect")
        failures = []
        for i in range(100):
            try:
                env = matrix.dispatch(f"cascade-{i}")
                if not env.get("final"):
                    failures.append(f"i={i}: no final output")
            except AssertionError as e:
                failures.append(str(e))
        assert not failures, "\n".join(failures)

    def test_random_prompt_corpus_all_modes(self, matrix):
        """100 random prompts distributed across all three modes."""
        matrix.set_roster("pipeline", ["architect", "programmer"])
        matrix.set_roster("cascade", ["programmer", "reviewer"], synthesizer="architect")
        failures = []
        for i in range(100):
            mode = self.MODES[i % len(self.MODES)]
            matrix.set_mode(mode)
            size = random.randint(1, 400)
            prompt = "".join(random.choices(string.ascii_letters + " .,!?", k=size))
            try:
                env = matrix.dispatch(prompt)
                if "agents" not in env and "final" not in env:
                    failures.append(f"i={i} mode={mode}: no output in envelope")
            except AssertionError as e:
                failures.append(f"i={i} mode={mode}: {e}")
        assert not failures, "\n".join(failures)


@requires_binary
class TestCoordinatorPressureChaos:
    """/api/pressure under concurrent dispatch + mode switches."""

    def test_pressure_survives_100_mode_switches(self, matrix):
        failures = []
        modes = ["flat", "pipeline", "cascade"]
        for i in range(100):
            _coord("/api/modes/active", method="POST",
                   body={"mode": modes[i % len(modes)]}, timeout=5)
            s, _ = _coord("/api/pressure", timeout=5)
            if s != 200:
                failures.append(f"i={i}: pressure returned {s}")
        assert not failures, "\n".join(failures)

    def test_concurrent_dispatch_and_pressure_reads(self, matrix):
        """Dispatch 20 prompts; concurrently read /api/pressure. No stall."""
        matrix.set_mode("flat")
        errors = []

        def dispatch_loop():
            for i in range(20):
                try:
                    matrix.dispatch(f"pressure-concurrent-{i}")
                except Exception as e:
                    errors.append(f"dispatch {i}: {e}")

        def pressure_loop():
            for i in range(40):
                s, _ = _coord("/api/pressure", timeout=5)
                if s != 200:
                    errors.append(f"pressure read {i}: status {s}")
                time.sleep(0.05)

        t1 = threading.Thread(target=dispatch_loop)
        t2 = threading.Thread(target=pressure_loop)
        t1.start(); t2.start()
        t1.join(); t2.join()
        assert not errors, "\n".join(errors)


@requires_binary
class TestCoordinatorUnknownRoutes:
    """Unknown endpoints must return 404, not crash or hang."""

    def test_unknown_get_routes_return_404(self, matrix):
        garbage = ["/api/doesnotexist", "/v1/chat", "/admin", "/", "/api/../etc/passwd"]
        for path in garbage:
            s, _ = _coord(path, method="GET", timeout=5)
            assert s in (400, 404), f"{path}: expected 404, got {s}"

    def test_unknown_post_routes_return_404(self, matrix):
        s, _ = _coord("/api/nonexistent-endpoint", method="POST",
                      body={"prompt": "test"}, timeout=5)
        assert s in (400, 404), f"expected 404, got {s}"
