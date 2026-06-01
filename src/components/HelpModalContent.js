import React from 'react';
import { getAgentColor } from '../utils/agentColors';
import HelpModalReference from './HelpModalReference';

export const AGENT_DESCRIPTIONS = {
  architect:   'System design, ASCII UML, component diagrams',
  foreman:     'Structured planning, step ordering, role assignment',
  programmer:  'Complete production-ready code (large context, 4096 tokens)',
  specialist:  'C++/Go, performance, memory management, concurrency',
  security:    'OWASP top 10, vulnerabilities, secure coding alternatives',
  api:         'REST/GraphQL design, OpenAPI specs, versioning strategies',
  database:    'Schemas, queries, indexing, SQL/NoSQL, caching layers',
  frontend:    'React components, CSS, accessibility, UX patterns',
  reviewer:    'Bugs, code smells, anti-patterns, best practices',
  tester:      'Unit tests, integration tests, edge cases, coverage',
  optimizer:   'CPU/memory/IO bottlenecks, algorithmic improvements',
  debugger:    'Root cause analysis, error propagation, targeted fixes',
  devops:      'CI/CD pipelines, containers, infrastructure-as-code',
  scout:       'Codebase analysis, patterns, module boundaries',
  synthesis:   'Execution roadmap, risk analysis, step-by-step planning',
  documenter:  'API docs, READMEs, inline comments, user guides',
};

export default function HelpModalContent({ agents = [] }) {
  const roleRows = agents.length > 0
    ? agents.map(a => [a.name, AGENT_DESCRIPTIONS[a.name] || ''])
    : Object.entries(AGENT_DESCRIPTIONS);

  return (
    <div className="help-body">

      <div className="help-section">
        <h3>Quick Start</h3>
        <div className="help-steps">
          <div className="help-step"><span className="help-step-n">1</span><span>Run <code>python3 scripts/brewctl check</code> for a pre-flight check, then <code>python3 scripts/brewctl launch</code> to start the proxy, UI, and MLX coordinator. Shut down with <code>python3 scripts/brewctl shutdown</code></span></div>
          <div className="help-step"><span className="help-step-n">2</span><span>Open <strong>CONFIGURE</strong> → choose inference engine (LLAMA / MLX / vLLM) — panel shows <strong>Using: &lt;engine&gt;</strong> and SERVER LAYOUT lists the engine — select agents and models → click <strong>LAUNCH SWARM</strong></span></div>
          <div className="help-step"><span className="help-step-n">3</span><span>Wait for the status indicator to turn <span className="status-online" style={{display:'inline',border:'none',padding:0}}>● ONLINE</span> (header may show the engine in use, e.g. MLX)</span></div>
          <div className="help-step"><span className="help-step-n">4</span><span>Pick an orchestration <strong>MODE</strong> (flat / pipeline / cascade / router) from the header dropdown</span></div>
          <div className="help-step"><span className="help-step-n">5</span><span>Type a prompt and press <strong>BREW</strong> (Brewlate) or <strong>BROADCAST</strong> (classic) — or <code>Cmd+Enter</code></span></div>
          <div className="help-step"><span className="help-step-n">6</span><span>Read agent cards — code from the <em>programmer</em> agent appears in <strong>CODE OUTPUT</strong> below; click <strong>⤢</strong> on any card for a full-screen CodeMirror editor</span></div>
        </div>
      </div>

      <div className="help-section">
        <h3>Header Controls</h3>
        <dl>
          <dt>ONLINE / OFFLINE</dt>
          <dd>Coordinator status. When ONLINE, the header shows which inference engine(s) are in use (e.g. MLX). OFFLINE (red, blinking) means the backend is unreachable — open CONFIGURE and deploy a swarm first. The UI polls every 10 s and updates automatically.</dd>
          <dt>MODE: FLAT / PIPELINE / CASCADE / ROUTER</dt>
          <dd>Orchestration strategy. <strong>flat</strong> broadcasts to every active agent in parallel (no reducer). <strong>pipeline</strong> chains agents sequentially — each receives the previous agent's output; an optional <em>synthesizer</em> agent runs last and consolidates all stage outputs into one final answer. <strong>cascade</strong> is mixture-of-agents: parallel broadcast plus a synthesizer that reduces every response into one consolidated answer. <strong>router</strong> uses a classifier agent (foreman by default) to pick up to <em>max_select</em> agents from the per-mode roster, with a live load hint built from KV pressure. Switch any time; the active mode is persisted.</dd>
          <dt>CONFIGURE</dt>
          <dd>Opens the swarm panel. Choose inference engine (LLAMA / MLX / vLLM); the panel shows <strong>Using: &lt;engine&gt;</strong> and SERVER LAYOUT includes the engine name. Select agents, optionally override models per agent, click <strong>✏️</strong> next to any agent to edit its system prompt live, then click LAUNCH SWARM. The proxy starts one model server per unique model, groups same-model agents together, then boots the coordinator. Takes up to 120 s on first load.</dd>
          <dt>PER-MODE ROSTER</dt>
          <dd>Inside CONFIGURE. Tabs for pipeline / cascade / router control who participates (flat mode ignores this — it always broadcasts to <strong>every</strong> deployed agent). Pipeline order matters — use ↑/↓ to reorder. Pipeline + cascade get a <em>synthesizer</em> dropdown (an agent that consolidates outputs into one final answer). Router gets a <em>max responders</em> input. Empty roster ⇒ non-flat modes use the full deployed swarm. A red <strong>🔴 circuit breaker</strong> banner shows here when an agent has tripped.</dd>
          <dt>PRESETS</dt>
          <dd>Save the active mode's current settings (mode + roster + synthesizer + max_select) under a name like <em>design-review</em> or <em>router-fast</em>. <strong>Apply</strong> swaps modes and loads the bundle in one click; ✕ deletes. Survives restart and (with <code>MATRIX_SOURCE_CONFIG</code> set) UI redeploy.</dd>
          <dt>CLEAR KV</dt>
          <dd>Clears state on all agents: erases the KV cache on llama-server agents, restarts MLX servers, and resets conversation session state. Use before every new major prompt and whenever agents seem stuck or produce repetitive output.</dd>
          <dt>HISTORY (N)</dt>
          <dd>Shows your last 10 broadcasts (terminal mode shows the 5 most recent via <code>:history</code>). Click any entry to reload the prompt and all agent responses exactly as they were. N shows the total number of entries stored.</dd>
          <dt>?</dt>
          <dd>This help modal. Click outside or press ✕ to close.</dd>
        </dl>
      </div>

      <div className="help-section">
        <h3>Submitting a Prompt</h3>
        <dl>
          <dt>Prompt box</dt>
          <dd>The prompt is dispatched according to the active <strong>MODE</strong>. In <em>flat</em> every <strong>deployed</strong> agent receives the same prompt in parallel and responses are independent. In <em>pipeline</em> the prompt flows through the agents in order, each consuming the previous output. In <em>router</em> a classifier agent first selects which agents to engage.</dd>
          <dt>Temperature</dt>
          <dd>Default is <code>0.20</code>. For engineering swarms stay in the <code>0.10–0.25</code> range — higher values cause agents to hallucinate roles, invent classes, or contradict each other across 10+ parallel responses. Use <code>0.40–0.70</code> only for architecture brainstorming or open-ended exploration.</dd>
          <dt>BREW / BROADCAST / Cmd+Enter</dt>
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
          {roleRows.map(([name, desc]) => (
            <div key={name} className="help-role-row">
              <span className="help-role-name" style={{color: getAgentColor(name)}}>{name}</span>
              <span className="help-role-desc">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <HelpModalReference />

    </div>
  );
}
