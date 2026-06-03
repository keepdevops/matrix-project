# Backend Routing (Option 4 — Cycle 1)

Pluggable inference backends and an opt-in smart router for sequential modes on Apple Silicon.

## Backends

| ID | C++ name | Transport |
|----|----------|-----------|
| `llama_metal` | `BackendId::LlamaMetal` | HTTP → `llama-server` (Metal GPU layers) |
| `python_mlx` | `BackendId::PythonMlx` | HTTP → `mlx_lm.server` |

Implementation: `cpp_core/src/inference_backend.{h,cpp}`

## Router

- **Default:** off — behavior identical to pre-routing (engine field only).
- **Enable:** `MATRIX_BACKEND_ROUTING=1` or `coordinator.backend_routing.enabled: true`
- **Scope:** pipeline, cascade, router modes only (flat broadcast unchanged).
- **Priority bias:** `LLAMA_METAL_PRIORITY=high` or `coordinator.backend_routing.llama_metal_priority`

Per-agent override in swarm-config:

```json
{
  "name": "programmer",
  "engine": "llama",
  "inference_backend": "auto"
}
```

Values: `auto`, `llama_metal`, `python_mlx`, or omit for legacy.

## Observability

- Dispatch envelope: `meta.routing.<agent>.{backend, reason, fallback}`
- MetricsStrip shows backend id per agent row (tooltip = reason)
- `brewctl agents` — lists configured `inference_backend` from coordinator

## Tests

```bash
bash scripts/build_cpp_binaries.sh
./test_backend_registry && ./test_backend_selection && ./test_backend_router && ./test_routing_decision_log
~/miniforge3/envs/mlx-env/bin/python -m pytest tests/mlx_coordinator/test_mlx_backend_wrapper.py -q
```
