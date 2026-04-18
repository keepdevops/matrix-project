import React from 'react';
import { getAgentColor } from '../utils/agentColors';

function HelpModal({ onClose }) {
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={e => e.stopPropagation()}>
        <div className="help-header">
          <span>Swarm Matrix — help</span>
          <button className="help-close" onClick={onClose}>✕</button>
        </div>
        <div className="help-body">

          <div className="help-section">
            <h3>Quick Start</h3>
            <div className="help-steps">
              <div className="help-step"><span className="help-step-n">1</span><span>Run <code>bash scripts/launch_matrix.sh</code> (Docker or Bare Metal) or <code>./scripts/run_matrix_pixi.sh</code> (pixi: installs env, builds coordinator, then launch)</span></div>
              <div className="help-step"><span className="help-step-n">2</span><span>Open <strong>CONFIGURE</strong> → choose inference engine (LLAMA / MLX) — panel shows <strong>Using: &lt;engine&gt;</strong> and SERVER LAYOUT lists the engine — select agents and models → click <strong>LAUNCH SWARM</strong></span></div>
              <div className="help-step"><span className="help-step-n">3</span><span>Wait for the status indicator to turn <span style={{color:'#648FFF'}}>ONLINE</span> (header may show the engine in use, e.g. MLX)</span></div>
              <div className="help-step"><span className="help-step-n">4</span><span>Type a prompt and press <strong>BROADCAST</strong> or <code>Cmd+Enter</code></span></div>
              <div className="help-step"><span className="help-step-n">5</span><span>Read agent cards — code from the <em>programmer</em> agent appears in <strong>CODE OUTPUT</strong> below</span></div>
            </div>
          </div>

          <div className="help-section">
            <h3>Header Controls</h3>
            <dl>
              <dt>ONLINE / OFFLINE</dt>
              <dd>Coordinator status. When ONLINE, the header shows which inference engine(s) are in use (e.g. MLX). OFFLINE (red, blinking) means the backend is unreachable — open CONFIGURE and deploy a swarm first. The UI polls every 10 s and updates automatically.</dd>
              <dt>CONFIGURE</dt>
              <dd>Opens the swarm panel. Choose inference engine (LLAMA / MLX); the panel shows <strong>Using: &lt;engine&gt;</strong> and SERVER LAYOUT includes the engine name. Select agents, optionally override models per agent, then click LAUNCH SWARM. The proxy starts one model server per unique model, groups same-model agents together, then boots the coordinator. Takes up to 120 s on first load.</dd>
              <dt>CLEAR KV</dt>
              <dd>Clears state on all agents: erases the KV cache on llama-server agents and restarts MLX servers to clear conversation history. Useful when agents seem stuck, produce repetitive output, or after switching to a completely different task.</dd>
              <dt>HISTORY (N)</dt>
              <dd>Shows your last 10 broadcasts. Click any entry to reload the prompt and all agent responses exactly as they were. N shows the total number of entries stored.</dd>
              <dt>?</dt>
              <dd>This help modal. Click outside or press ✕ to close.</dd>
            </dl>
          </div>

          <div className="help-section">
            <h3>Submitting a Prompt</h3>
            <dl>
              <dt>Prompt box</dt>
              <dd>Every selected agent receives the <strong>same</strong> user prompt in parallel. There is no sequential “pipeline” — responses are independent unless you design that in the prompt.</dd>
              <dt>Temperature</dt>
              <dd>Default is <code>0.20</code>. For engineering swarms stay in the <code>0.10–0.25</code> range — higher values cause agents to hallucinate roles, invent classes, or contradict each other across 10+ parallel responses. Use <code>0.40–0.70</code> only for architecture brainstorming or open-ended exploration.</dd>
              <dt>BROADCAST / Cmd+Enter</dt>
              <dd>Sends one broadcast to the coordinator; all active agents run at once and return when done.</dd>
            </dl>
          </div>

          <div className="help-section">
            <h3>Reading Results</h3>
            <dl>
              <dt>Agent cards</dt>
              <dd>Cards are shown in a grid, colour-coded by role. A spinning indicator means that agent is still processing. Click the expand icon (⤢) on any completed card to open the full response in a CodeMirror editor with syntax highlighting, edit mode, copy, and save options.</dd>
              <dt>Expand to editor</dt>
              <dd>Each completed agent response has an expand button (⤢) in the top-right corner. Click it to pop out the response into a full-screen modal editor. The editor auto-detects language for syntax highlighting, supports editing, copying to clipboard, and exporting to file.</dd>
              <dt>CODE OUTPUT</dt>
              <dd>The <em>programmer</em> agent's first code block is auto-extracted and shown in a syntax-highlighted CodeMirror editor below the grid. Supports C++, Go, Python, JavaScript, Rust, SQL, and more.</dd>
              <dt>Cross-referencing</dt>
              <dd>Use multiple roles together — e.g. <em>architect</em> for structure, <em>programmer</em> for code, <em>reviewer</em> / <em>security</em> for critique — in one broadcast and compare answers. Expand any card to compare full responses side-by-side in separate editor windows.</dd>
            </dl>
          </div>

          <div className="help-section">
            <h3>Agent Roles</h3>
            <div className="help-roles">
              {[
                ['architect','System design, ASCII UML, component diagrams'],
                ['foreman','Structured planning, step ordering, role assignment'],
                ['programmer','Complete production-ready code (large context, 4096 tokens)'],
                ['specialist','C++/Go, performance, memory management, concurrency'],
                ['security','OWASP top 10, vulnerabilities, secure coding alternatives'],
                ['api','REST/GraphQL design, OpenAPI specs, versioning strategies'],
                ['database','Schemas, queries, indexing, SQL/NoSQL, caching layers'],
                ['frontend','React components, CSS, accessibility, UX patterns'],
                ['reviewer','Bugs, code smells, anti-patterns, best practices'],
                ['tester','Unit tests, integration tests, edge cases, coverage'],
                ['optimizer','CPU/memory/IO bottlenecks, algorithmic improvements'],
                ['debugger','Root cause analysis, error propagation, targeted fixes'],
                ['devops','CI/CD pipelines, containers, infrastructure-as-code'],
                ['scout','Codebase analysis, patterns, module boundaries'],
                ['synthesis','Execution roadmap, risk analysis, step-by-step planning'],
                ['documenter','API docs, READMEs, inline comments, user guides'],
              ].map(([name, desc]) => (
                <div key={name} className="help-role-row">
                  <span className="help-role-name" style={{color: getAgentColor(name)}}>{name}</span>
                  <span className="help-role-desc">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="help-section">
            <h3>Inference Engines</h3>
            <dl>
              <dt>LLAMA</dt>
              <dd>llama-server (C++ from llama.cpp). Loads <code>.gguf</code> files. Uses <code>--parallel N</code> so same-model agents run in parallel in one process. CLEAR KV works. Best for many agents on the same model.</dd>
              <dt>MLX (mlx-lm)</dt>
              <dd>Apple Silicon native (Metal). Uses <code>mlx_lm.server</code>; loads model <strong>directories</strong> (not single files). Often faster per-token on M1/M2/M3. Requests queue per server. CLEAR KV restarts servers.</dd>
              <dt>Mixed Swarms (LLAMA + MLX)</dt>
              <dd>Select standard agents (architect, programmer, etc.) together with <strong>mlx-coder</strong> to run a hybrid swarm. LLAMA agents run in parallel on their ports; mlx-coder runs on its dedicated MLX server. Useful to compare coding output across both inference engines or get Apple Silicon performance for the coding specialist role.</dd>
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
              <dt>SAVE CODE after each successful round</dt>
              <dd>The SAVE CODE button below the agent grid exports all code blocks from every agent into a single timestamped file.</dd>
              <dt>Try mlx-coder for Apple Silicon</dt>
              <dd>If running on M1/M2/M3, select standard agents plus <strong>mlx-coder</strong> to benchmark Metal-optimized inference. MLX often produces code faster per-token on Apple Silicon; compare outputs across both engines in one broadcast.</dd>
            </dl>
          </div>

          <div className="help-section">
            <h3>Launch</h3>
            <code className="help-code">bash scripts/launch_matrix.sh</code>
            <p>Starts the proxy and UI (choose Docker or Bare Metal). Alternatively with pixi: <code>./scripts/run_matrix_pixi.sh</code>. All swarm configuration is done from the browser. See <strong>USER_MANUAL.md</strong> and <strong>SETUP_MODELS.md</strong> for full documentation.</p>
          </div>

        </div>
      </div>
    </div>
  );
}

export default HelpModal;
