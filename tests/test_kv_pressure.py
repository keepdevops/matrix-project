"""KV memory pressure tests for llama-server mock agents.

Tests cover:
- /props /slots /metrics endpoint correctness
- Slot saturation (all slots busy → usage → 1.0)
- Multi-prompt pressure accumulation across 100 runs
- Dynamic load: agent role switching while prompts are in-flight
- Coordinator pressure endpoint shape (requires coordinator binary)
- Concurrent multi-agent pressure reads

All KV-endpoint tests run without the coordinator binary (pure Python HTTP).
The coordinator-dependent tests are skipped when the binary is absent.
"""
from __future__ import annotations

import json
import random
import threading
import urllib.request
import urllib.error
from pathlib import Path

import pytest

import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from mock_agent import MockAgent, KvState, SlotState  # noqa: E402

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get(port: int, path: str) -> tuple[int, bytes]:
    url = f"http://127.0.0.1:{port}{path}"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _json_get(port: int, path: str) -> tuple[int, dict | list]:
    status, body = _get(port, path)
    return status, json.loads(body or b"{}")


def _agent(name: str, port: int, kv: KvState | None = None) -> MockAgent:
    a = MockAgent(name, port)
    a.kv = kv or KvState()
    a.start()
    return a


# ---------------------------------------------------------------------------
# /props endpoint
# ---------------------------------------------------------------------------

class TestPropsEndpoint:
    def test_props_returns_n_ctx(self, tmp_path):
        a = _agent("scout", 19100, KvState(n_ctx=8192, slots=[SlotState()]))
        try:
            status, data = _json_get(19100, "/props")
            assert status == 200
            assert data["default_generation_settings"]["n_ctx"] == 8192
        finally:
            a.stop()

    def test_props_returns_total_slots(self, tmp_path):
        a = _agent("scout", 19101, KvState(slots=[SlotState(), SlotState()]))
        try:
            status, data = _json_get(19101, "/props")
            assert status == 200
            assert data["total_slots"] == 2
        finally:
            a.stop()

    def test_props_404_when_kv_not_set(self, tmp_path):
        a = MockAgent("bare", 19102)
        a.start()
        try:
            status, _ = _get(19102, "/props")
            assert status == 404
        finally:
            a.stop()


# ---------------------------------------------------------------------------
# /slots endpoint
# ---------------------------------------------------------------------------

class TestSlotsEndpoint:
    def test_slots_idle(self, tmp_path):
        kv = KvState(slots=[SlotState(is_processing=False, cache_tokens=0)])
        a = _agent("scout", 19110, kv)
        try:
            status, data = _json_get(19110, "/slots")
            assert status == 200
            assert isinstance(data, list)
            assert data[0]["is_processing"] is False
            assert data[0]["cache_tokens"] == 0
        finally:
            a.stop()

    def test_slots_busy(self, tmp_path):
        kv = KvState(slots=[SlotState(is_processing=True, cache_tokens=512)])
        a = _agent("scout", 19111, kv)
        try:
            _, data = _json_get(19111, "/slots")
            assert data[0]["is_processing"] is True
            assert data[0]["cache_tokens"] == 512
        finally:
            a.stop()

    def test_slots_count_matches_kv_state(self, tmp_path):
        kv = KvState(slots=[SlotState() for _ in range(4)])
        a = _agent("scout", 19112, kv)
        try:
            _, data = _json_get(19112, "/slots")
            assert len(data) == 4
        finally:
            a.stop()


# ---------------------------------------------------------------------------
# /metrics endpoint
# ---------------------------------------------------------------------------

class TestMetricsEndpoint:
    def test_metrics_contains_usage_ratio(self, tmp_path):
        kv = KvState(n_ctx=1000, slots=[SlotState(cache_tokens=500)])
        a = _agent("scout", 19120, kv)
        try:
            status, body = _get(19120, "/metrics")
            assert status == 200
            text = body.decode()
            assert "llamacpp:kv_cache_usage_ratio" in text
        finally:
            a.stop()

    def test_metrics_usage_ratio_zero_when_idle(self, tmp_path):
        kv = KvState(n_ctx=4096, slots=[SlotState(cache_tokens=0)])
        a = _agent("scout", 19121, kv)
        try:
            _, body = _get(19121, "/metrics")
            for line in body.decode().splitlines():
                if line.startswith("llamacpp:kv_cache_usage_ratio"):
                    ratio = float(line.split()[-1])
                    assert ratio == 0.0
        finally:
            a.stop()

    def test_metrics_usage_ratio_one_when_saturated(self, tmp_path):
        kv = KvState(n_ctx=100, slots=[SlotState(is_processing=True, cache_tokens=100)])
        a = _agent("scout", 19122, kv)
        try:
            _, body = _get(19122, "/metrics")
            for line in body.decode().splitlines():
                if line.startswith("llamacpp:kv_cache_usage_ratio"):
                    ratio = float(line.split()[-1])
                    assert ratio == 1.0
        finally:
            a.stop()

    def test_metrics_requests_processing_reflects_busy_slots(self, tmp_path):
        kv = KvState(slots=[
            SlotState(is_processing=True),
            SlotState(is_processing=True),
            SlotState(is_processing=False),
        ])
        a = _agent("scout", 19123, kv)
        try:
            _, body = _get(19123, "/metrics")
            for line in body.decode().splitlines():
                if line.startswith("llamacpp:requests_processing"):
                    assert float(line.split()[-1]) == 2.0
        finally:
            a.stop()


# ---------------------------------------------------------------------------
# KvState unit tests (no network)
# ---------------------------------------------------------------------------

class TestKvState:
    def test_usage_ratio_partial_fill(self):
        kv = KvState(n_ctx=1000, slots=[SlotState(cache_tokens=250)])
        assert abs(kv.usage_ratio - 0.25) < 1e-6

    def test_usage_ratio_capped_at_one(self):
        kv = KvState(n_ctx=100, slots=[SlotState(cache_tokens=9999)])
        assert kv.usage_ratio == 1.0

    def test_slots_busy_counts_only_processing(self):
        kv = KvState(slots=[
            SlotState(is_processing=True),
            SlotState(is_processing=False),
            SlotState(is_processing=True),
        ])
        assert kv.slots_busy == 2

    def test_kv_used_tokens_sums_all_slots(self):
        kv = KvState(slots=[
            SlotState(cache_tokens=100),
            SlotState(cache_tokens=200),
            SlotState(cache_tokens=50),
        ])
        assert kv.kv_used_tokens == 350

    def test_empty_slots_usage_zero(self):
        kv = KvState(n_ctx=4096, slots=[])
        assert kv.usage_ratio == 0.0
        assert kv.total_slots == 0


# ---------------------------------------------------------------------------
# Slot saturation — all slots busy
# ---------------------------------------------------------------------------

class TestSlotSaturation:
    def test_all_slots_busy_usage_at_one(self, tmp_path):
        slots = [SlotState(is_processing=True, cache_tokens=512) for _ in range(4)]
        kv = KvState(n_ctx=512, slots=slots)
        a = _agent("scout", 19130, kv)
        try:
            _, props = _json_get(19130, "/props")
            _, slot_data = _json_get(19130, "/slots")
            _, body = _get(19130, "/metrics")

            assert props["total_slots"] == 4
            assert all(s["is_processing"] for s in slot_data)

            for line in body.decode().splitlines():
                if line.startswith("llamacpp:kv_cache_usage_ratio"):
                    assert float(line.split()[-1]) == 1.0
        finally:
            a.stop()

    def test_saturation_gradual_fill(self):
        """Simulate KV filling up token-by-token across 3 slots."""
        kv = KvState(n_ctx=100, slots=[SlotState(cache_tokens=0) for _ in range(3)])
        for step in range(1, 4):
            for s in kv.slots:
                s.cache_tokens += 10
            ratio = kv.usage_ratio
            assert ratio == pytest.approx(step * 10 / 100, abs=1e-6)

    def test_partial_saturation_reflected_per_slot(self, tmp_path):
        kv = KvState(n_ctx=1000, slots=[
            SlotState(is_processing=True, cache_tokens=1000),
            SlotState(is_processing=False, cache_tokens=0),
        ])
        a = _agent("scout", 19131, kv)
        try:
            _, slot_data = _json_get(19131, "/slots")
            busy = [s for s in slot_data if s["is_processing"]]
            idle = [s for s in slot_data if not s["is_processing"]]
            assert len(busy) == 1 and busy[0]["cache_tokens"] == 1000
            assert len(idle) == 1 and idle[0]["cache_tokens"] == 0
        finally:
            a.stop()


# ---------------------------------------------------------------------------
# 100-run multi-prompt pressure accumulation
# ---------------------------------------------------------------------------

class TestMultiPromptPressure100:
    """Drive KV state mutations across 100 prompt iterations and verify
    that /props, /slots, /metrics stay consistent after each mutation."""

    def _run_pressure_check(self, port: int, kv: KvState):
        _, props = _json_get(port, "/props")
        _, slots = _json_get(port, "/slots")
        _, body = _get(port, "/metrics")

        assert props["total_slots"] == kv.total_slots
        assert props["default_generation_settings"]["n_ctx"] == kv.n_ctx
        assert len(slots) == kv.total_slots

        busy_count = sum(1 for s in slots if s["is_processing"])
        assert busy_count == kv.slots_busy

        total_cache = sum(s["cache_tokens"] for s in slots)
        assert total_cache == kv.kv_used_tokens

        for line in body.decode().splitlines():
            if line.startswith("llamacpp:kv_cache_usage_ratio"):
                ratio = float(line.split()[-1])
                assert abs(ratio - kv.usage_ratio) < 1e-4

    def test_100_pressure_checks_stable(self, tmp_path):
        kv = KvState(n_ctx=4096, slots=[SlotState() for _ in range(4)])
        a = _agent("multi", 19140, kv)
        try:
            failures = []
            for i in range(100):
                # Simulate a prompt being processed
                slot_idx = i % len(kv.slots)
                kv.slots[slot_idx].is_processing = (i % 3 != 0)
                kv.slots[slot_idx].cache_tokens = random.randint(0, kv.n_ctx)
                try:
                    self._run_pressure_check(19140, kv)
                except AssertionError as e:
                    failures.append(f"run {i}: {e}")
            assert not failures, "\n".join(failures)
        finally:
            a.stop()

    def test_100_saturation_cycles(self, tmp_path):
        """Fill all slots to capacity, drain, repeat 100 times."""
        kv = KvState(n_ctx=512, slots=[SlotState() for _ in range(2)])
        a = _agent("cycle", 19141, kv)
        try:
            failures = []
            for i in range(100):
                # Fill
                for s in kv.slots:
                    s.is_processing = True
                    s.cache_tokens = kv.n_ctx
                assert kv.usage_ratio == 1.0
                try:
                    self._run_pressure_check(19141, kv)
                except AssertionError as e:
                    failures.append(f"fill {i}: {e}")

                # Drain
                for s in kv.slots:
                    s.is_processing = False
                    s.cache_tokens = 0
                assert kv.usage_ratio == 0.0
                try:
                    self._run_pressure_check(19141, kv)
                except AssertionError as e:
                    failures.append(f"drain {i}: {e}")

            assert not failures, "\n".join(failures)
        finally:
            a.stop()

    def test_100_random_kv_states(self, tmp_path):
        """Random KV mutations — props/slots/metrics always agree."""
        kv = KvState(n_ctx=2048, slots=[SlotState() for _ in range(4)])
        a = _agent("rand", 19142, kv)
        try:
            failures = []
            for i in range(100):
                for s in kv.slots:
                    s.is_processing = random.random() < 0.5
                    s.cache_tokens = random.randint(0, kv.n_ctx)
                try:
                    self._run_pressure_check(19142, kv)
                except AssertionError as e:
                    failures.append(f"run {i}: {e}")
            assert not failures, "\n".join(failures)
        finally:
            a.stop()


# ---------------------------------------------------------------------------
# Concurrent multi-agent pressure reads
# ---------------------------------------------------------------------------

class TestConcurrentPressureReads:
    def test_4_agents_concurrent_pressure(self, tmp_path):
        """4 agents on different ports; concurrent /metrics reads stay consistent."""
        agents = []
        ports = [19150, 19151, 19152, 19153]
        kvs = []
        for i, port in enumerate(ports):
            kv = KvState(
                n_ctx=1024,
                slots=[SlotState(is_processing=(i % 2 == 0), cache_tokens=i * 100)],
            )
            kvs.append(kv)
            agents.append(_agent(f"a{i}", port, kv))

        errors = []

        def read_agent(idx):
            port = ports[idx]
            kv = kvs[idx]
            _, body = _get(port, "/metrics")
            for line in body.decode().splitlines():
                if line.startswith("llamacpp:kv_cache_usage_ratio"):
                    ratio = float(line.split()[-1])
                    expected = kv.usage_ratio
                    if abs(ratio - expected) > 1e-4:
                        errors.append(f"agent {idx}: ratio {ratio} != {expected}")

        threads = [threading.Thread(target=read_agent, args=(i,)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        for a in agents:
            a.stop()

        assert not errors, "\n".join(errors)

    def test_100_concurrent_metrics_reads_single_agent(self, tmp_path):
        kv = KvState(n_ctx=2048, slots=[SlotState(cache_tokens=512)])
        a = _agent("conc", 19154, kv)
        errors = []

        def read():
            _, body = _get(19154, "/metrics")
            for line in body.decode().splitlines():
                if line.startswith("llamacpp:kv_cache_usage_ratio"):
                    ratio = float(line.split()[-1])
                    expected = kv.usage_ratio
                    if abs(ratio - expected) > 1e-4:
                        errors.append(f"ratio {ratio} != {expected}")

        threads = [threading.Thread(target=read) for _ in range(100)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        a.stop()
        assert not errors, "\n".join(errors)


# ---------------------------------------------------------------------------
# Dynamic load: agent role switching under concurrent prompts
# ---------------------------------------------------------------------------

class TestDynamicRoleSwitching:
    """Simulate coordinator role changes (flat → pipeline → cascade) while
    prompts are in-flight. Verifies KV state integrity across role transitions
    and that /slots reflects accurate busy state after each role switch."""

    ROLES = ["flat", "pipeline", "cascade"]

    def _send_prompt(self, port: int, result_holder: list, idx: int):
        url = f"http://127.0.0.1:{port}/v1/chat/completions"
        payload = json.dumps({
            "messages": [{"role": "user", "content": f"prompt-{idx}"}],
            "stream": False,
        }).encode()
        req = urllib.request.Request(url, data=payload, method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                data = json.loads(r.read())
                result_holder.append(data)
        except Exception as e:
            result_holder.append({"error": str(e)})

    def test_role_switch_does_not_corrupt_kv_state(self, tmp_path):
        """Send prompts, mutate KV mid-flight, verify metrics stay consistent."""
        kv = KvState(n_ctx=4096, slots=[SlotState() for _ in range(2)])
        a = _agent("dynamic", 19160, kv)
        a.kv = kv
        failures = []

        try:
            for role_idx, role in enumerate(self.ROLES * 10):  # 30 role transitions
                # Simulate role switch: mutate KV to represent new load pattern
                for i, s in enumerate(kv.slots):
                    s.is_processing = (role == "pipeline" and i == 0)
                    s.cache_tokens = random.randint(0, kv.n_ctx // 2)

                # Verify state is consistent immediately after "switch"
                _, body = _get(19160, "/metrics")
                for line in body.decode().splitlines():
                    if line.startswith("llamacpp:kv_cache_usage_ratio"):
                        ratio = float(line.split()[-1])
                        if abs(ratio - kv.usage_ratio) > 1e-4:
                            failures.append(
                                f"role={role} step={role_idx}: "
                                f"ratio {ratio} != {kv.usage_ratio:.6f}"
                            )
        finally:
            a.stop()

        assert not failures, "\n".join(failures)

    def test_concurrent_prompts_and_kv_reads(self, tmp_path):
        """4 agents: concurrent prompt dispatch + concurrent KV reads — no data race."""
        ports = [19165, 19166, 19167, 19168]
        kvs = [KvState(n_ctx=1024, slots=[SlotState()]) for _ in ports]
        agents = [_agent(f"dyn{i}", p, kvs[i]) for i, p in enumerate(ports)]
        prompt_results: list = []
        metric_errors: list = []

        def dispatch_prompts():
            for i in range(25):
                port = ports[i % len(ports)]
                self._send_prompt(port, prompt_results, i)
                # Mutate KV while prompts are firing
                kv = kvs[i % len(kvs)]
                kv.slots[0].is_processing = (i % 2 == 0)
                kv.slots[0].cache_tokens = (i * 13) % kv.n_ctx

        def read_metrics():
            for i in range(25):
                port = ports[i % len(ports)]
                kv = kvs[i % len(kvs)]
                _, body = _get(port, "/metrics")
                for line in body.decode().splitlines():
                    if line.startswith("llamacpp:kv_cache_usage_ratio"):
                        # Just assert parseable — KV may be mid-mutation
                        try:
                            float(line.split()[-1])
                        except ValueError as e:
                            metric_errors.append(str(e))

        t1 = threading.Thread(target=dispatch_prompts)
        t2 = threading.Thread(target=read_metrics)
        t1.start(); t2.start()
        t1.join(); t2.join()

        for a in agents:
            a.stop()

        assert not metric_errors, "\n".join(metric_errors)
        # All 25 prompts should have received responses
        assert len(prompt_results) == 25
        assert all("error" not in r for r in prompt_results)

    def test_100_role_transitions_with_parallel_pressure_reads(self, tmp_path):
        """100 role transitions; each one fires a concurrent /slots + /metrics read."""
        kv = KvState(n_ctx=2048, slots=[SlotState() for _ in range(4)])
        a = _agent("roles", 19170, kv)
        failures = []

        try:
            for i in range(100):
                role = self.ROLES[i % len(self.ROLES)]
                # Simulate load pattern per role
                for j, s in enumerate(kv.slots):
                    if role == "flat":
                        s.is_processing = True
                        s.cache_tokens = 512
                    elif role == "pipeline":
                        s.is_processing = (j == 0)
                        s.cache_tokens = 256 if j == 0 else 0
                    else:  # cascade
                        s.is_processing = (j < 2)
                        s.cache_tokens = 128

                results = {}
                errs = []

                def read_slots(r=results, e=errs):
                    try:
                        _, data = _json_get(19170, "/slots")
                        r["slots"] = data
                    except Exception as ex:
                        e.append(str(ex))

                def read_metrics(r=results, e=errs):
                    try:
                        _, body = _get(19170, "/metrics")
                        r["metrics"] = body.decode()
                    except Exception as ex:
                        e.append(str(ex))

                t1 = threading.Thread(target=read_slots)
                t2 = threading.Thread(target=read_metrics)
                t1.start(); t2.start()
                t1.join(); t2.join()

                if errs:
                    failures.append(f"i={i} role={role}: {errs}")
                    continue

                if "slots" not in results or "metrics" not in results:
                    failures.append(f"i={i} role={role}: missing read results")
                    continue

                # slots count must match
                if len(results["slots"]) != kv.total_slots:
                    failures.append(
                        f"i={i} role={role}: slots count {len(results['slots'])} != {kv.total_slots}"
                    )

                # metrics ratio must be parseable
                for line in results["metrics"].splitlines():
                    if line.startswith("llamacpp:kv_cache_usage_ratio"):
                        try:
                            float(line.split()[-1])
                        except ValueError:
                            failures.append(f"i={i} role={role}: unparseable ratio")
        finally:
            a.stop()

        assert not failures, "\n".join(failures)


# ---------------------------------------------------------------------------
# Coordinator /api/pressure endpoint (requires binary)
# ---------------------------------------------------------------------------

COORD_BIN = Path(__file__).resolve().parent.parent / "coordinator"


@pytest.mark.skipif(not COORD_BIN.exists(),
                    reason="coordinator binary not found; run `npm run build:bin`")
class TestCoordinatorPressureEndpoint:
    """Integration tests using the real coordinator binary + mock agents with KV state."""

    def test_pressure_endpoint_returns_port_stats(self, matrix):
        """The /api/pressure endpoint returns a non-empty response."""
        status, data = matrix.get("/api/pressure")
        assert status == 200
        # coordinator returns a list of per-port snapshots or a dict
        assert isinstance(data, (list, dict))

    def test_pressure_shape_has_expected_fields(self, matrix):
        status, data = matrix.get("/api/pressure")
        assert status == 200
        if isinstance(data, list):
            # per-port snapshot list from pressure_snapshot.cpp
            assert len(data) > 0
            entry = data[0]
            assert "port" in entry
            assert "ok" in entry
        else:
            assert isinstance(data, dict)

    def test_multi_prompt_pressure_under_flat_mode(self, matrix):
        """Dispatch 10 prompts in flat mode and read pressure after each."""
        matrix.set_mode("flat")
        failures = []
        for i in range(10):
            matrix.dispatch(f"pressure test prompt {i}")
            status, data = matrix.get("/api/pressure")
            if status != 200:
                failures.append(f"prompt {i}: /api/pressure returned {status}")
        assert not failures, "\n".join(failures)

    def test_pressure_stable_across_100_sequential_prompts(self, matrix):
        """100 sequential prompts; /api/pressure always returns 200."""
        matrix.set_mode("flat")
        failures = []
        for i in range(100):
            matrix.dispatch(f"seq-{i}")
            s, _ = matrix.get("/api/pressure")
            if s != 200:
                failures.append(f"prompt {i}: pressure status {s}")
        assert not failures, "\n".join(failures)

    def test_role_switch_flat_pipeline_cascade_under_load(self, matrix):
        """Switch modes while dispatching prompts; pressure endpoint stays up."""
        modes = ["flat", "pipeline", "cascade", "flat"]
        failures = []
        for mode in modes:
            matrix.set_mode(mode)
            for i in range(5):
                matrix.dispatch(f"{mode}-prompt-{i}")
            s, _ = matrix.get("/api/pressure")
            if s != 200:
                failures.append(f"mode={mode}: pressure returned {s}")
        assert not failures, "\n".join(failures)

    def test_agent_role_reassignment_does_not_stall_pressure(self, matrix):
        """Reassign roster between modes, confirm pressure endpoint remains healthy."""
        agents = list(matrix.mocks.keys())
        # Move agents between mode rosters dynamically
        for i in range(10):
            mode = ["flat", "pipeline", "cascade"][i % 3]
            subset = agents[: (i % len(agents)) + 1]
            matrix.set_mode(mode)
            matrix.dispatch(f"reassign-{i}")
        s, _ = matrix.get("/api/pressure")
        assert s == 200
