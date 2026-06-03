"""Tests for the multi-instance guard introduced in PR #50.

Covers _already_running() (PID-file check), run_launch() early-exit on a
live instance, PID-file reset on a clean launch, and the stale-port cleanup
helpers in _proc.py.

No real processes are launched — all subprocess and os.kill calls are patched.

Patch-target note: lsof_pids_on_port and kill_pids are imported INSIDE
run_launch() via `from ._proc import …`, so they must be patched at their
origin module (orchestration.lifecycle._proc.*), not on the launch module.
"""
from __future__ import annotations

import signal
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from orchestration.lifecycle._proc import kill_pids, lsof_pids_on_port, _pid_alive
from orchestration.lifecycle.launch import _already_running, run_launch


# ---------------------------------------------------------------------------
# _already_running — PID file parsing + liveness checks
# ---------------------------------------------------------------------------

def test_already_running_no_file(tmp_path):
    assert _already_running(tmp_path / "matrix.pids") == []


def test_already_running_empty_file(tmp_path):
    pid_file = tmp_path / "matrix.pids"
    pid_file.write_text("")
    assert _already_running(pid_file) == []


def test_already_running_skips_non_digit_lines(tmp_path):
    pid_file = tmp_path / "matrix.pids"
    pid_file.write_text("# comment\n\nnotanumber\n")
    with patch("os.kill"):  # no digits → os.kill never called
        result = _already_running(pid_file)
    assert result == []


def test_already_running_dead_pid_excluded(tmp_path):
    pid_file = tmp_path / "matrix.pids"
    pid_file.write_text("99999\n")
    with patch("os.kill", side_effect=ProcessLookupError):
        result = _already_running(pid_file)
    assert result == []


def test_already_running_live_pid_included(tmp_path):
    pid_file = tmp_path / "matrix.pids"
    pid_file.write_text("1234\n")
    with patch("os.kill", return_value=None):  # signal 0 succeeds → alive
        result = _already_running(pid_file)
    assert result == [1234]


def test_already_running_permission_error_counts_as_live(tmp_path):
    # PermissionError means the process exists but is owned by another user.
    pid_file = tmp_path / "matrix.pids"
    pid_file.write_text("5678\n")
    with patch("os.kill", side_effect=PermissionError):
        result = _already_running(pid_file)
    assert result == [5678]


def test_already_running_mixed_pids(tmp_path):
    pid_file = tmp_path / "matrix.pids"
    pid_file.write_text("111\n222\n333\n")

    def kill_side_effect(pid, sig):
        if pid == 222:
            raise ProcessLookupError

    with patch("os.kill", side_effect=kill_side_effect):
        result = _already_running(pid_file)
    assert result == [111, 333]


def test_already_running_ignores_whitespace_in_lines(tmp_path):
    pid_file = tmp_path / "matrix.pids"
    pid_file.write_text("  4242  \n")
    with patch("os.kill", return_value=None):
        result = _already_running(pid_file)
    assert result == [4242]


# ---------------------------------------------------------------------------
# run_launch — early-exit when an instance is already running
# ---------------------------------------------------------------------------

def test_run_launch_aborts_when_instance_already_running(tmp_path):
    pid_file = tmp_path / "logs" / "matrix.pids"
    pid_file.parent.mkdir(parents=True)
    pid_file.write_text("1234\n")

    with patch("orchestration.lifecycle.launch.REPO", tmp_path), \
         patch("orchestration.lifecycle.launch._source_env_file", return_value={}), \
         patch("os.kill", return_value=None):  # pid 1234 is alive
        rc = run_launch()

    assert rc == 1


def test_run_launch_prints_fatal_message_on_double_launch(tmp_path, capsys):
    pid_file = tmp_path / "logs" / "matrix.pids"
    pid_file.parent.mkdir(parents=True)
    pid_file.write_text("7777\n")

    with patch("orchestration.lifecycle.launch.REPO", tmp_path), \
         patch("orchestration.lifecycle.launch._source_env_file", return_value={}), \
         patch("os.kill", return_value=None):
        run_launch()

    out = capsys.readouterr().out
    assert "FATAL" in out
    assert "7777" in out
    assert "shutdown" in out.lower()


def test_run_launch_resets_pid_file_on_clean_start(tmp_path):
    # Simulate stale (dead) PIDs left from a previous run.
    logs = tmp_path / "logs"
    logs.mkdir()
    pid_file = logs / "matrix.pids"
    pid_file.write_text("0\n")  # stale PID → ProcessLookupError

    proxy = tmp_path / "proxy"
    proxy.write_text("#!/bin/sh\n")
    proxy.chmod(0o755)

    with patch("orchestration.lifecycle.launch.REPO", tmp_path), \
         patch("orchestration.lifecycle.launch._source_env_file", return_value={}), \
         patch("orchestration.lifecycle.launch._spawn", return_value=1111), \
         patch("orchestration.lifecycle._proc.lsof_pids_on_port", return_value=[]), \
         patch("orchestration.lifecycle._proc.kill_pids", return_value=[]), \
         patch("orchestration.lifecycle.launch.shutil.which", return_value="/usr/bin/npm"), \
         patch("os.kill", side_effect=ProcessLookupError):
        run_launch()

    contents = pid_file.read_text()
    assert "0" not in contents   # old stale entry wiped
    assert "1111" in contents    # fresh pid written


def test_run_launch_writes_all_pids(tmp_path):
    # MS-144: mlx-coordinator removed from launch path; only proxy + UI spawned.
    logs = tmp_path / "logs"
    logs.mkdir()
    proxy = tmp_path / "proxy"
    proxy.write_text("#!/bin/sh\n")
    proxy.chmod(0o755)

    spawn_results = iter([2001, 2002])

    with patch("orchestration.lifecycle.launch.REPO", tmp_path), \
         patch("orchestration.lifecycle.launch._source_env_file", return_value={}), \
         patch("orchestration.lifecycle.launch._spawn", side_effect=spawn_results), \
         patch("orchestration.lifecycle._proc.lsof_pids_on_port", return_value=[]), \
         patch("orchestration.lifecycle._proc.kill_pids", return_value=[]), \
         patch("orchestration.lifecycle.launch.shutil.which", return_value="/usr/bin/npm"), \
         patch("os.kill", side_effect=ProcessLookupError):
        run_launch()

    lines = (logs / "matrix.pids").read_text().splitlines()
    assert set(lines) == {"2001", "2002"}


# ---------------------------------------------------------------------------
# Stale-port cleanup via lsof_pids_on_port + kill_pids
# ---------------------------------------------------------------------------

def test_run_launch_kills_stale_proxy_before_starting(tmp_path):
    logs = tmp_path / "logs"
    logs.mkdir()
    proxy = tmp_path / "proxy"
    proxy.write_text("#!/bin/sh\n")
    proxy.chmod(0o755)

    killed = []

    def fake_kill_pids(pids, **kw):
        killed.extend(pids)
        return []

    # port 3002 has a stale process; port 3003 is clean
    lsof_results = [[5555], []]

    with patch("orchestration.lifecycle.launch.REPO", tmp_path), \
         patch("orchestration.lifecycle.launch._source_env_file", return_value={}), \
         patch("orchestration.lifecycle.launch._spawn", return_value=3001), \
         patch("orchestration.lifecycle._proc.lsof_pids_on_port", side_effect=lsof_results), \
         patch("orchestration.lifecycle._proc.kill_pids", side_effect=fake_kill_pids), \
         patch("orchestration.lifecycle.launch.shutil.which", return_value="/usr/bin/npm"), \
         patch("orchestration.lifecycle.launch.time.sleep", return_value=None), \
         patch("os.kill", side_effect=ProcessLookupError):
        run_launch()

    assert 5555 in killed


def test_run_launch_kills_stale_mlx_coordinator_before_starting(tmp_path):
    logs = tmp_path / "logs"
    logs.mkdir()
    proxy = tmp_path / "proxy"
    proxy.write_text("#!/bin/sh\n")
    proxy.chmod(0o755)

    killed = []

    def fake_kill_pids(pids, **kw):
        killed.extend(pids)
        return []

    # port 3002 is clean; port 3003 has a stale MLX coordinator
    lsof_results = [[], [6666]]

    with patch("orchestration.lifecycle.launch.REPO", tmp_path), \
         patch("orchestration.lifecycle.launch._source_env_file", return_value={}), \
         patch("orchestration.lifecycle.launch._spawn", return_value=3002), \
         patch("orchestration.lifecycle._proc.lsof_pids_on_port", side_effect=lsof_results), \
         patch("orchestration.lifecycle._proc.kill_pids", side_effect=fake_kill_pids), \
         patch("orchestration.lifecycle.launch.shutil.which", return_value="/usr/bin/npm"), \
         patch("orchestration.lifecycle.launch.time.sleep", return_value=None), \
         patch("os.kill", side_effect=ProcessLookupError):
        run_launch()

    assert 6666 in killed


# ---------------------------------------------------------------------------
# _proc helpers
# ---------------------------------------------------------------------------

def test_pid_alive_true_when_signal_succeeds():
    with patch("os.kill", return_value=None):
        assert _pid_alive(1234) is True


def test_pid_alive_false_when_process_lookup_error():
    with patch("os.kill", side_effect=ProcessLookupError):
        assert _pid_alive(1234) is False


def test_pid_alive_true_on_permission_error():
    # PermissionError → process exists but not ours; still counts as alive.
    with patch("os.kill", side_effect=PermissionError):
        assert _pid_alive(1234) is True


def test_kill_pids_empty_list_returns_empty():
    assert kill_pids([]) == []


def test_kill_pids_sigterm_then_sigkill_on_survivor():
    os_kill_calls = []

    def fake_os_kill(pid, sig):
        os_kill_calls.append((pid, sig))

    def fake_pid_alive(pid):
        # Alive until SIGKILL has been issued; dead after.
        sigkill_sent = any(s == signal.SIGKILL for _, s in os_kill_calls)
        return not sigkill_sent

    with patch("orchestration.lifecycle._proc.os.kill", side_effect=fake_os_kill), \
         patch("orchestration.lifecycle._proc._pid_alive", side_effect=fake_pid_alive), \
         patch("orchestration.lifecycle._proc.time.sleep", return_value=None):
        survivors = kill_pids([4242], term_wait=0.01)

    sent_sigs = [sig for _, sig in os_kill_calls if _ == 4242]
    assert signal.SIGTERM in sent_sigs
    assert signal.SIGKILL in sent_sigs
    assert survivors == []


def test_kill_pids_no_sigkill_when_term_sufficient():
    os_kill_calls = []

    def fake_os_kill(pid, sig):
        os_kill_calls.append(sig)

    # Process dies immediately after SIGTERM.
    with patch("orchestration.lifecycle._proc.os.kill", side_effect=fake_os_kill), \
         patch("orchestration.lifecycle._proc._pid_alive", return_value=False), \
         patch("orchestration.lifecycle._proc.time.sleep", return_value=None):
        survivors = kill_pids([9898], term_wait=0.01)

    assert signal.SIGKILL not in os_kill_calls
    assert survivors == []


def test_lsof_pids_on_port_parses_output():
    fake = MagicMock()
    fake.stdout = "1234\n5678\n"
    with patch("subprocess.run", return_value=fake):
        result = lsof_pids_on_port(3002)
    assert result == [1234, 5678]


def test_lsof_pids_on_port_empty_when_nothing_bound():
    fake = MagicMock()
    fake.stdout = ""
    with patch("subprocess.run", return_value=fake):
        result = lsof_pids_on_port(3002)
    assert result == []


def test_lsof_pids_on_port_returns_empty_when_lsof_missing():
    with patch("subprocess.run", side_effect=FileNotFoundError):
        result = lsof_pids_on_port(3002)
    assert result == []


# ---------------------------------------------------------------------------
# Idempotency — second launch after clean shutdown is allowed
# ---------------------------------------------------------------------------

def test_second_launch_allowed_after_dead_pids(tmp_path):
    """A re-launch is permitted once all previously recorded PIDs are dead."""
    logs = tmp_path / "logs"
    logs.mkdir()
    pid_file = logs / "matrix.pids"
    pid_file.write_text("8888\n")  # left from a previous run

    proxy = tmp_path / "proxy"
    proxy.write_text("#!/bin/sh\n")
    proxy.chmod(0o755)

    with patch("orchestration.lifecycle.launch.REPO", tmp_path), \
         patch("orchestration.lifecycle.launch._source_env_file", return_value={}), \
         patch("orchestration.lifecycle.launch._spawn", return_value=9001), \
         patch("orchestration.lifecycle._proc.lsof_pids_on_port", return_value=[]), \
         patch("orchestration.lifecycle._proc.kill_pids", return_value=[]), \
         patch("orchestration.lifecycle.launch.shutil.which", return_value="/usr/bin/npm"), \
         patch("os.kill", side_effect=ProcessLookupError):  # 8888 is dead
        rc = run_launch()

    assert rc == 0
