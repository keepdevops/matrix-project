"""Tests for scripts/gguf_to_mlx.py — 0% coverage before this file.

Covers _emit() output format, argument parsing, HF_TOKEN env var handling,
mlx_lm import failure, successful convert(), and exception handling during
conversion.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import gguf_to_mlx  # noqa: E402


# ---------------------------------------------------------------------------
# _emit
# ---------------------------------------------------------------------------

def test_emit_writes_valid_json(capsys):
    gguf_to_mlx._emit({"status": "running", "pct": 0})
    out = capsys.readouterr().out.strip()
    parsed = json.loads(out)
    assert parsed["status"] == "running"
    assert parsed["pct"] == 0


def test_emit_preserves_all_keys(capsys):
    payload = {"status": "done", "step": "done", "pct": 100, "output": "/tmp/model"}
    gguf_to_mlx._emit(payload)
    out = json.loads(capsys.readouterr().out.strip())
    assert out == payload


# ---------------------------------------------------------------------------
# argument parsing via main()
# ---------------------------------------------------------------------------

def _base_argv():
    return ["--hf-repo", "org/model", "--output", "/tmp/out"]


def test_main_emits_running_on_start(capsys):
    with patch.dict(sys.modules, {"mlx_lm": MagicMock()}), \
         patch("sys.argv", ["gguf_to_mlx"] + _base_argv()):
        gguf_to_mlx.main()

    lines = [json.loads(l) for l in capsys.readouterr().out.strip().splitlines()]
    assert lines[0]["status"] == "running"
    assert lines[0]["hf_repo"] == "org/model"


def test_main_emits_done_on_success(capsys):
    with patch.dict(sys.modules, {"mlx_lm": MagicMock()}), \
         patch("sys.argv", ["gguf_to_mlx"] + _base_argv()):
        gguf_to_mlx.main()

    lines = [json.loads(l) for l in capsys.readouterr().out.strip().splitlines()]
    assert lines[-1]["status"] == "done"
    assert lines[-1]["pct"] == 100


def test_main_default_q_bits_is_4(capsys):
    with patch.dict(sys.modules, {"mlx_lm": MagicMock()}), \
         patch("sys.argv", ["gguf_to_mlx"] + _base_argv()):
        gguf_to_mlx.main()

    lines = [json.loads(l) for l in capsys.readouterr().out.strip().splitlines()]
    assert lines[0]["q_bits"] == 4


def test_main_accepts_q_bits_8(capsys):
    with patch.dict(sys.modules, {"mlx_lm": MagicMock()}), \
         patch("sys.argv", ["gguf_to_mlx"] + _base_argv() + ["--q-bits", "8"]):
        gguf_to_mlx.main()

    lines = [json.loads(l) for l in capsys.readouterr().out.strip().splitlines()]
    assert lines[0]["q_bits"] == 8


def test_main_exits_1_when_mlx_lm_missing(capsys):
    real_import = __builtins__["__import__"] if isinstance(__builtins__, dict) else __import__

    def fake_import(name, *args, **kwargs):
        if name == "mlx_lm":
            raise ImportError("No module named 'mlx_lm'")
        return real_import(name, *args, **kwargs)

    with patch("builtins.__import__", side_effect=fake_import), \
         patch("sys.argv", ["gguf_to_mlx"] + _base_argv()):
        with pytest.raises(SystemExit) as exc_info:
            gguf_to_mlx.main()

    assert exc_info.value.code == 1
    out = capsys.readouterr().out
    assert any(json.loads(l)["status"] == "error" for l in out.strip().splitlines())


def test_main_exits_1_on_convert_exception(capsys):
    fake_mlx = MagicMock()
    fake_mlx.convert.side_effect = RuntimeError("out of memory")

    with patch.dict(sys.modules, {"mlx_lm": fake_mlx}), \
         patch("sys.argv", ["gguf_to_mlx"] + _base_argv()):
        with pytest.raises(SystemExit) as exc_info:
            gguf_to_mlx.main()

    assert exc_info.value.code == 1
    out = capsys.readouterr().out
    error_lines = [json.loads(l) for l in out.strip().splitlines()
                   if json.loads(l)["status"] == "error"]
    assert error_lines
    assert "out of memory" in error_lines[0]["error"]


def test_main_hf_token_arg_propagates_to_convert(capsys):
    # When --hf-token is given, main() must succeed (token accepted, no crash).
    fake_mlx = MagicMock()
    with patch.dict(sys.modules, {"mlx_lm": fake_mlx}), \
         patch("sys.argv", ["gguf_to_mlx"] + _base_argv() + ["--hf-token", "tok123"]):
        gguf_to_mlx.main()

    lines = [json.loads(l) for l in capsys.readouterr().out.strip().splitlines()]
    assert lines[-1]["status"] == "done"
    fake_mlx.convert.assert_called_once()


def test_main_hf_token_from_env_passes_through(capsys):
    # When HF_TOKEN is already in the environment, main() should complete normally.
    fake_mlx = MagicMock()
    with patch.dict(sys.modules, {"mlx_lm": fake_mlx}), \
         patch.dict(os.environ, {"HF_TOKEN": "envtok"}), \
         patch("sys.argv", ["gguf_to_mlx"] + _base_argv()):
        gguf_to_mlx.main()

    lines = [json.loads(l) for l in capsys.readouterr().out.strip().splitlines()]
    assert lines[-1]["status"] == "done"


def test_main_convert_called_with_correct_args(capsys):
    fake_mlx = MagicMock()
    with patch.dict(sys.modules, {"mlx_lm": fake_mlx}), \
         patch("sys.argv", ["gguf_to_mlx", "--hf-repo", "myorg/mymodel",
                            "--output", "/models/out", "--q-bits", "8"]):
        gguf_to_mlx.main()

    fake_mlx.convert.assert_called_once_with(
        hf_path="myorg/mymodel",
        mlx_path="/models/out",
        quantize=True,
        q_bits=8,
    )
