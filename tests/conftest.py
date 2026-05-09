"""Pytest fixtures for coordinator integration tests.

The `matrix` fixture spins up:
  - 4 mock agents on ports 18080-18083 (architect, programmer, reviewer, foreman)
  - One coordinator process on port 18000 wired to those agents

Fixture is `function`-scoped so each test gets a clean coordinator + fresh
mock-agent state. Slower than `session`-scope but eliminates cross-test
contamination (e.g. circuit-breaker state leaking)."""
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(__file__))
from mock_agent import MockAgent  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parent.parent
COORD_BIN = PROJECT_ROOT / 'coordinator'
COORD_PORT = 18000

DEFAULT_AGENTS = [
    {'name': 'architect',  'port': 18080},
    {'name': 'programmer', 'port': 18081},
    {'name': 'reviewer',   'port': 18082},
    {'name': 'foreman',    'port': 18083},
]


def _agent_entry(a: dict) -> dict:
    return {
        'name': a['name'],
        'port': a['port'],
        'read_timeout_secs': 5,
        'max_tokens': 256,
        'system_prompt': f"You are {a['name']}.",
        'engine': 'llama',
        'backend': 'llama',
        'model': '',
        'draft_model': '',
        'draft_max': 0,
    }


def _swarm_config(agent_specs: list) -> dict:
    return {
        'agents': [_agent_entry(a) for a in agent_specs],
        'coordinator': {
            'default_mode': 'flat',
            'modes': {},
            'port': COORD_PORT,
        },
    }


def _wait_port(port: int, timeout: float = 5.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.2)
            try:
                s.connect(('127.0.0.1', port))
                return True
            except OSError:
                time.sleep(0.05)
    return False


def _http(method: str, path: str, body=None) -> tuple[int, dict]:
    url = f'http://127.0.0.1:{COORD_PORT}{path}'
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read() or b'{}')
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body or b'{}')
        except json.JSONDecodeError:
            return e.code, {'_raw': body.decode('utf-8', errors='replace')}


class MatrixHarness:
    """Convenience wrapper handed to tests."""
    def __init__(self, mocks: dict[str, MockAgent], proc: subprocess.Popen):
        self.mocks = mocks
        self.proc = proc

    def get(self, path):    return _http('GET', path)
    def post(self, path, body=None):  return _http('POST', path, body)
    def put(self, path, body=None):   return _http('PUT', path, body)
    def delete(self, path):  return _http('DELETE', path)

    def set_mode(self, mode: str):
        s, _ = self.post('/api/modes/active', {'mode': mode})
        assert s == 200, f"set_mode({mode}) returned {s}"

    def set_roster(self, mode: str, agents: list[str], **opts):
        body = {'agents': agents}
        body.update(opts)
        s, j = self.put(f'/api/modes/{mode}/agents', body)
        assert s == 200, f"set_roster failed: {j}"
        return j

    def dispatch(self, prompt: str):
        s, j = self.post('/api/architect', {'prompt': prompt})
        assert s == 200, f"dispatch returned {s}: {j}"
        return j


@pytest.fixture
def matrix(tmp_path, monkeypatch):
    if not COORD_BIN.exists():
        pytest.skip(f"coordinator binary not found at {COORD_BIN}; run `npm run build:bin`")

    # Build mock agents.
    mocks = {a['name']: MockAgent(a['name'], a['port']) for a in DEFAULT_AGENTS}
    for m in mocks.values():
        m.start()

    # Synthesize a coordinator config that points at the mocks.
    config = _swarm_config(DEFAULT_AGENTS)
    cfg_path = tmp_path / 'test-config.json'
    cfg_path.write_text(json.dumps(config, indent=2))

    env = os.environ.copy()
    env['MATRIX_COORDINATOR_PORT'] = str(COORD_PORT)
    env.pop('MATRIX_SOURCE_CONFIG', None)  # don't pollute the dev source
    log_path = tmp_path / 'coordinator.log'
    log_fp = open(log_path, 'wb')
    proc = subprocess.Popen(
        [str(COORD_BIN), '--config', str(cfg_path)],
        env=env, stdout=log_fp, stderr=subprocess.STDOUT,
        preexec_fn=os.setsid,  # so we can kill the whole group
    )
    if not _wait_port(COORD_PORT, timeout=8):
        log_fp.close()
        proc.kill()
        log_text = log_path.read_text(errors='replace')
        for m in mocks.values(): m.stop()
        pytest.fail(f"coordinator didn't bind {COORD_PORT}\n--- log ---\n{log_text}")

    harness = MatrixHarness(mocks, proc)
    try:
        yield harness
    finally:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            proc.wait(timeout=3)
        except Exception:
            try: proc.kill()
            except Exception: pass
        log_fp.close()
        for m in mocks.values():
            m.stop()


@pytest.fixture
def matrix_subset_with_source(tmp_path):
    """Active config lists one agent; MATRIX_SOURCE_CONFIG points at full roster.

    Exercises metadata PUTs for agents present in the project file but not in
    the deployed in-memory subset (regression for 'unknown agent')."""
    if not COORD_BIN.exists():
        pytest.skip(f"coordinator binary not found at {COORD_BIN}; run `npm run build:bin`")

    mocks = {a['name']: MockAgent(a['name'], a['port']) for a in DEFAULT_AGENTS}
    for m in mocks.values():
        m.start()

    source_path = tmp_path / 'swarm-source.json'
    active_path = tmp_path / 'matrix-active.json'
    source_path.write_text(json.dumps(_swarm_config(DEFAULT_AGENTS), indent=2))
    active_path.write_text(json.dumps(_swarm_config([DEFAULT_AGENTS[0]]), indent=2))

    env = os.environ.copy()
    env['MATRIX_COORDINATOR_PORT'] = str(COORD_PORT)
    env['MATRIX_SOURCE_CONFIG'] = str(source_path)

    log_path = tmp_path / 'coordinator-subset.log'
    log_fp = open(log_path, 'wb')
    proc = subprocess.Popen(
        [str(COORD_BIN), '--config', str(active_path)],
        env=env, stdout=log_fp, stderr=subprocess.STDOUT,
        preexec_fn=os.setsid,
    )
    if not _wait_port(COORD_PORT, timeout=8):
        log_fp.close()
        proc.kill()
        log_text = log_path.read_text(errors='replace')
        for m in mocks.values():
            m.stop()
        pytest.fail(f"coordinator didn't bind {COORD_PORT}\n--- log ---\n{log_text}")

    harness = MatrixHarness(mocks, proc)
    try:
        yield harness
    finally:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        log_fp.close()
        for m in mocks.values():
            m.stop()
