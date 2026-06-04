import React from 'react';
import HelpModalReferenceDocs from './HelpModalReferenceDocs';

export default function HelpModalReference() {
  return (
    <>
      <div className="help-section">
        <h3>Inference Engines</h3>
        <dl>
          <dt>LLAMA</dt>
          <dd>llama-server (C++ from llama.cpp). Loads <code>.gguf</code> files. Uses <code>--parallel N</code> so same-model agents run in parallel in one process. CLEAR KV works. Best for many agents on the same model.</dd>
          <dt>MLX (mlx-lm)</dt>
          <dd>Apple Silicon native (Metal). Uses <code>mlx_lm.server</code>; loads model <strong>directories</strong> (not single files). Often faster per-token on M1/M2/M3. Requests queue per server. CLEAR KV restarts servers.</dd>
          <dt>vLLM</dt>
          <dd>Launches 4 vLLM servers via Docker Model Runner on ports 8080–8083 (Qwen2.5-14B, Llama-3.2-3B, DeepSeek-Coder-V2, Phi-4-mini). Use the <strong>vLLM INFERENCE SERVERS</strong> panel in CONFIGURE to start them and tail logs on failure.</dd>
          <dt>Mixed Swarms (LLAMA + MLX)</dt>
          <dd>Add an MLX-backend agent to your swarm config to run a hybrid swarm. LLAMA agents run in parallel on their ports; MLX agents serialize on their port. Useful to compare coding output across both inference engines or get Apple Silicon performance for specific roles.</dd>
        </dl>
      </div>

      <div className="help-section">
        <h3>Tips</h3>
        <dl>
          <dt>Keep temp 0.10–0.25 for coding</dt>
          <dd>Higher temperatures cause agents to contradict each other or hallucinate new classes across a 10+ agent swarm.</dd>
          <dt>CLEAR KV before every new major prompt</dt>
          <dd>First prompt fills KV with context. A second prompt without clearing can leave half the agents seeing contradictory instructions.</dd>
          <dt>5–7 agents is the sweet spot for coding</dt>
          <dd>Running large swarms (12–16 agents) risks VRAM exhaustion and KV token budget overflow — only do that for high-level exploration.</dd>
          <dt>Use cascade for best-of-N</dt>
          <dd>Run 4–6 agents in parallel and let the synthesizer pick the strongest parts of each response — best of flat (parallelism) plus a single coherent final answer.</dd>
          <dt>Save presets for recurring workflows</dt>
          <dd>Once you find a good mode + roster combination, save it as a preset. One click restores the full bundle on the next session.</dd>
          <dt>Tune foreman for router mode</dt>
          <dd>The foreman system prompt is the main lever on classification quality. Edit it live with ✏️ in CONFIGURE — changes take effect on the next dispatch.</dd>
          <dt>SAVE CODE after each successful round</dt>
          <dd>The SAVE CODE button below the agent grid exports all code blocks from every agent into a single timestamped file.</dd>
          <dt>MLX on Apple Silicon</dt>
          <dd>If running on M1/M2/M3 with an MLX model available, add an MLX agent to benchmark Metal-optimized inference. MLX often produces code faster per-token on Apple Silicon; compare outputs across both engines in one broadcast.</dd>
        </dl>
      </div>

      <div className="help-section">
        <h3>Orchestration Modes</h3>
        <dl>
          <dt>flat</dt>
          <dd>Default. Broadcast the prompt to every <strong>deployed</strong> agent in parallel (per-mode roster does not apply); no reducer. Best for cross-referencing answers from different roles on the same question.</dd>
          <dt>pipeline</dt>
          <dd>Sequential chain. Each agent receives the previous agent's output as additional context. Pairs naturally with role orderings like architect → programmer → reviewer. If you set a <em>synthesizer</em>, it runs once at the end with all stage outputs and produces the consolidated final answer (otherwise the last stage's output is final). Failed stages are recorded in <code>meta.errors[]</code> and downstream stages continue from the last good output instead of getting poisoned.</dd>
          <dt>cascade</dt>
          <dd>Mixture-of-agents. Broadcasts the prompt to every roster agent in parallel (like flat), then a designated <em>synthesizer</em> agent reduces all responses into one consolidated answer. Best of flat (parallelism) plus a single coherent final answer. Failed agents are excluded from the synthesizer's input.</dd>
          <dt>router</dt>
          <dd>A classifier agent (foreman by default) inspects the prompt and selects up to <em>max_select</em> agents from the per-mode roster. The classifier prompt is enriched with a live <code>Current load: …</code> hint built from KV-cache pressure, so the foreman can prefer less-loaded roles. Falls back to a default agent if classification fails.</dd>
        </dl>
      </div>

      <div className="help-section">
        <h3>Resilience &amp; Observability</h3>
        <dl>
          <dt>Circuit breaker</dt>
          <dd>Each agent has its own breaker. After 3 failures within a 60 s window the breaker opens, and that agent is excluded from dispatch (and streaming) for a 30 s cooldown. Then it goes half-open and the next call re-probes; success closes the breaker, failure re-opens it. Tripped agents appear in a red banner inside PER-MODE ROSTER and are listed in <code>meta.excluded_unhealthy[]</code>. Snapshot at <code>GET /api/health/agents</code>.</dd>
          <dt>Retry &amp; skip-with-warning</dt>
          <dd>One automatic retry (250 ms backoff) on transient HTTP failures (5xx / empty 200 / connect error). 4xx errors don't retry. In pipeline mode a failed stage is recorded in <code>meta.errors[]</code> and the chain continues from the last good output rather than passing the error message downstream. Cascade filters failed agents out of the synthesizer's input.</dd>
          <dt>Per-run metrics</dt>
          <dd>Every dispatch envelope carries <code>meta.timings {`{ agent: { calls, total_ms, completion_tokens } }`}</code> plus <code>meta.wall_ms</code>. The <strong>RUN METRICS</strong> strip below FINAL ANSWER renders this as a per-agent bar chart so you can see who's hot, slow, or idle. The streaming endpoint emits a final <code>metrics</code> SSE event with the same shape.</dd>
          <dt>Monitor popout</dt>
          <dd>The header <strong>Monitor</strong> shows live health: KV-cache status/size with a per-port pressure gauge, a <strong>Unified Memory</strong> gauge (works on any coordinator build — native builds report <code>unified_memory</code>, plain builds fall back to the host <code>/api/memory</code> snapshot), MLX per-port Q/W/D pressure, a <strong>Clear KV</strong> button, and opt-in <strong>RSS feeds</strong> (History / Config / Token Regulation). RSS needs <code>coordinator.rss.enabled</code>, and events are published only by the in-process MLX build (model load/evict, token regulation).</dd>
        </dl>
      </div>

      <HelpModalReferenceDocs />
    </>
  );
}
