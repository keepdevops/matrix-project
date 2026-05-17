#!/usr/bin/env python3
"""Convert a HuggingFace model to MLX quantized format.

GGUF is used only as a model identity hint — the actual weights are
downloaded from HuggingFace and quantized by mlx_lm.convert.

Usage:
  python3 gguf_to_mlx.py --hf-repo <org/name> --output <dir> [--q-bits 4]
"""
import argparse
import json
import os
import sys
import traceback


def _emit(obj: dict):
    print(json.dumps(obj), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hf-repo", required=True,
                        help="HuggingFace repo ID, e.g. mistralai/Codestral-22B-v0.1")
    parser.add_argument("--output", required=True,
                        help="Output directory for MLX weights")
    parser.add_argument("--q-bits", type=int, default=4, choices=[4, 8],
                        help="Quantization bits (default: 4)")
    parser.add_argument("--hf-token", default="",
                        help="HuggingFace API token for gated/private models")
    args = parser.parse_args()

    # Set token in environment so huggingface_hub picks it up automatically.
    token = args.hf_token or os.environ.get("HF_TOKEN", "")
    if token:
        os.environ["HF_TOKEN"] = token

    _emit({"status": "running", "step": "starting", "pct": 0,
           "hf_repo": args.hf_repo, "output": args.output, "q_bits": args.q_bits})

    try:
        from mlx_lm import convert
    except ImportError as e:
        _emit({"status": "error", "error": f"mlx_lm not available: {e}"})
        sys.exit(1)

    try:
        _emit({"status": "running", "step": "downloading_and_converting", "pct": 5})
        convert(
            hf_path=args.hf_repo,
            mlx_path=args.output,
            quantize=True,
            q_bits=args.q_bits,
        )
        _emit({"status": "done", "step": "done", "pct": 100, "output": args.output})
    except Exception as e:
        _emit({"status": "error", "error": str(e), "detail": traceback.format_exc()})
        sys.exit(1)


if __name__ == "__main__":
    main()
