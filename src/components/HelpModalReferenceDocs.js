import React from 'react';

export default function HelpModalReferenceDocs() {
  return (
    <>
      <div className="help-section">
        <h3>Streaming SSE</h3>
        <p><code>POST /api/architect/stream {`{prompt, session_id?}`}</code> dispatches under the active mode and emits Server-Sent Events as work progresses:</p>
        <dl>
          <dt>session</dt>
          <dd><code>{`{ session_id }`}</code> fires before the first token; the UI uses this to wire follow-up BROADCASTs to the same conversation thread.</dd>
          <dt>token / agent_done</dt>
          <dd>One <code>token</code> event per delta from each agent; one <code>agent_done</code> per agent on completion.</dd>
          <dt>stage (pipeline)</dt>
          <dd><code>{`{ step, total, agent }`}</code> fires at the start of each pipeline stage so the UI can show progress.</dd>
          <dt>selected (router)</dt>
          <dd><code>{`{ classifier, agents }`}</code> fires once after classification, before the chosen agents start streaming.</dd>
          <dt>synthesis_start (cascade / pipeline)</dt>
          <dd>Fires when the synthesizer kicks in to reduce responses. Subsequent <code>token</code> events for that agent are the consolidated final answer.</dd>
          <dt>metrics + done</dt>
          <dd>A final <code>metrics</code> event carries per-agent timings; <code>done</code> with payload <code>[DONE]</code> closes the stream.</dd>
        </dl>
      </div>

      <div className="help-section">
        <h3>Conversation Threads</h3>
        <dl>
          <dt>Multi-turn sessions</dt>
          <dd>After the first BROADCAST the UI auto-continues the session on subsequent sends. The <strong>ConversationThread</strong> panel (collapsible) shows the full turn history. Sessions are identified by <code>session_id</code> and persisted across reloads. Click CLEAR KV to reset session state and start fresh.</dd>
        </dl>
      </div>

      <div className="help-section">
        <h3>UI Layouts</h3>
        <dl>
          <dt>Layout switcher</dt>
          <dd>Select a layout from the header switcher or append <code>?layout=&lt;name&gt;</code> to the URL. Primary layout: <strong>brewlatte</strong> (rose-gold configure + runtime). Alternates: <strong>classic</strong> (legacy Matrix grid), <strong>dashboard</strong>, <strong>terminal</strong>, <strong>minimal</strong>, <strong>sidebar</strong>. <code>?layout=default</code> resolves to Brewlatte. The layout persists in the URL across reloads.</dd>
        </dl>
      </div>

      <div className="help-section">
        <h3>Launch</h3>
        <code className="help-code">python3 scripts/brewctl check && python3 scripts/brewctl launch</code>
        <p>Check verifies ports, binaries, and models. Launch starts the proxy (:3002), React UI (:3000), and MLX coordinator (:3003) if MLX agents are configured. Use <code>python3 scripts/brewctl shutdown</code> to stop. Build the C++ binaries once with <code>bash scripts/build_cpp_binaries.sh</code>.</p>
      </div>

      <div className="help-section">
        <h3>Documentation</h3>
        <dl>
          <dt><a href="https://github.com/keepdevops/matrix-project/blob/main/docs/SETUP.md" target="_blank" rel="noreferrer">docs/SETUP.md</a></dt>
          <dd>Prerequisites, C++ build, model paths, first-run walkthrough, troubleshooting.</dd>
          <dt><a href="https://github.com/keepdevops/matrix-project/blob/main/docs/HELP.md" target="_blank" rel="noreferrer">docs/HELP.md</a></dt>
          <dd>Quick-reference: UI controls, modes, agent roles, common issues, keyboard shortcuts.</dd>
          <dt><a href="https://github.com/keepdevops/matrix-project/blob/main/docs/USER_MANUAL.md" target="_blank" rel="noreferrer">docs/USER_MANUAL.md</a></dt>
          <dd>End-to-end guide: swarm configuration, orchestration modes, conversation threads, presets, RAG, layouts, metrics, and best practices.</dd>
          <dt><a href="https://github.com/keepdevops/matrix-project/blob/main/docs/CAPABILITIES.md" target="_blank" rel="noreferrer">docs/CAPABILITIES.md</a></dt>
          <dd>Full API reference: every endpoint, SSE events, env vars, circuit breaker, MLX coordinator, session management, and RAG internals.</dd>
        </dl>
      </div>
    </>
  );
}
