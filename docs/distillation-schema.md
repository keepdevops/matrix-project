# Matrix Swarm Distillation Export Schema

## Format
JSONL — one JSON object per line. Each line is a complete `RlTrajectory` record.

## Endpoints
- `GET /api/export/rl-trajectories?session_id=&min_quality=0.5` — download
- `POST /api/export/push` body: `{ target_url, session_id?, min_quality? }` — push to distillation app
- `POST /api/webhook/trajectory` — receives single-record JSON on quality threshold crossing

## Fields

| Field | Type | Description |
|---|---|---|
| `session_id` | string | Coordinator session identifier |
| `run_id` | string | Unique run identifier (correlates with history) |
| `mode` | string | Active swarm mode: `flat`, `cascade`, `pipeline`, `router` |
| `prompt` | string | User prompt text |
| `timestamp_ms` | int | Unix epoch milliseconds |
| `tokens_consumed` | int | Total tokens used in this run |
| `budget` | int | Session token budget (0 = unlimited) |
| `tes` | float | Token Efficiency Score 0–1 (density+fidelity+importance+RAG) |
| `gate_triggered` | bool | Whether the summarization gate compressed the prompt |
| `fidelity_ratio` | float | Compression fidelity 0–1 (1.0 = no compression) |
| `kv_auto_cleared` | bool | Whether KV cache was auto-cleared this run |
| `kv_pressure_before` | float | KV fill ratio 0–1 at dispatch start |
| `kv_pressure_after` | float | KV fill ratio 0–1 after dispatch |
| `rag_hit_rate` | float | RAG hits / top_k (0 if RAG not used) |
| `rag_hits` | array | Retrieved chunks: `[{source_path, chunk_idx, distance, relevance?, content}]` |
| `contracts` | array | Per-agent contract state: `[{agent, allocation, used, overrun, delegations_used}]` |
| `any_overrun` | bool | Whether any agent exceeded its token allocation |
| `annotation_rating` | int | User feedback: `1` = thumbs up, `-1` = thumbs down, `0` = none |
| `annotation_comment` | string | Optional user comment |
| `quality_score` | float | Computed quality 0–1 (TES×0.35 + fidelity×0.20 + importance×0.20 + RAG×0.10 ± annotation) |
| `importance_scores` | object | Per-agent symbolic importance: `{ agent_name: float }` |
| `agent_outputs` | object | Per-agent response text: `{ agent_name: string }` |
| `supervisor_decisions` | array | Supervisor policy: `[{agent, action, reason, confidence}]` (omitted when supervisor disabled) |

## quality_score formula
```
quality = tes * 0.35
        + fidelity_ratio * 0.20
        + avg(importance_scores.values()) * 0.20
        + rag_hit_rate * 0.10
        + annotation_bonus        # +0.15 if rating=1, -0.20 if rating=-1
        - overrun_penalty         # -0.10 if any_overrun
```
Returns `-1` when insufficient data (no tokens consumed).

## Filtering
Use `?min_quality=N` (0–1) to export only high-quality records. Records with
`quality_score == -1` (unscored) are always included unless explicitly excluded.

## Example record
```json
{"session_id":"sess-abc123","run_id":"run-xyz","mode":"cascade",
 "prompt":"Explain gradient descent","timestamp_ms":1748823600000,
 "tokens_consumed":1842,"budget":5000,"tes":0.71,
 "gate_triggered":false,"fidelity_ratio":1.0,
 "kv_auto_cleared":false,"kv_pressure_before":0.45,"kv_pressure_after":0.48,
 "rag_hit_rate":0.8,"rag_hits":[{"source_path":"ml_notes.txt","distance":0.12}],
 "contracts":[{"agent":"coder","allocation":2000,"used":921,"overrun":false}],
 "any_overrun":false,"annotation_rating":1,"annotation_comment":"great",
 "quality_score":0.84,
 "importance_scores":{"coder":0.72,"reviewer":0.61},
 "agent_outputs":{"coder":"Gradient descent is...","reviewer":"Good explanation..."}}
```
