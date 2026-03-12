import React, { useEffect, useState } from 'react';
import './App.css';
import { useSwarm } from './hooks/useSwarm';
import { clearCache, fetchAgents } from './api/swarmApi';
import PromptInput from './components/PromptInput';
import AgentResponse from './components/AgentResponse';
import CodeDisplay from './components/CodeDisplay';
import SwarmConfig from './components/SwarmConfig';
import { extractCodeBlock } from './utils/codeExtractor';

const AGENT_COLORS = {
  architect:  '#FFB000',
  specialist: '#648FFF',
  scout:      '#DC267F',
  programmer: '#00ff41',
  synthesis:  '#FE6100',
  reviewer:   '#785EF0',
  tester:     '#00B4D8',
  security:   '#FF4C4C',
  devops:     '#06D6A0',
  documenter: '#FFD166',
  optimizer:  '#EF476F',
  debugger:   '#118AB2',
  database:   '#A8DADC',
  frontend:   '#F77F00',
  api:        '#4CC9F0',
  foreman:    '#C77DFF',
};
const getAgentColor = name => AGENT_COLORS[name] || '#888888';

const METADATA_KEYS = new Set(['prompt', 'temperature', 'timestamp']);

function App() {
  const {
    responses,
    loading,
    error,
    history,
    online,
    submit,
    loadHistory,
    checkStatus,
    setResponses,
  } = useSwarm();

  const [activeAgents, setActiveAgents] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [deployPending, setDeployPending] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [selectedTemperature, setSelectedTemperature] = useState(null);
  const [cacheStatus, setCacheStatus] = useState('idle');

  const refreshAgents = () =>
    fetchAgents().then(setActiveAgents).catch(() => {});

  useEffect(() => {
    checkStatus();
    loadHistory();
    refreshAgents();
    const interval = setInterval(() => {
      checkStatus();
      if (online) refreshAgents();
    }, 10000);
    return () => clearInterval(interval);
  }, [checkStatus, loadHistory]); // eslint-disable-line

  // Auto-show config panel when offline with no agents (suppress while deploy is pending)
  const showConfigPanel = showConfig || (!online && !deployPending && activeAgents.length === 0);

  const handleDeployed = () => {
    setShowConfig(false);
    setDeployPending(true);
    // Poll until coordinator is online, then clear the pending flag
    const pollId = setInterval(async () => {
      const isOnline = await checkStatus();
      if (isOnline) {
        clearInterval(pollId);
        setDeployPending(false);
        refreshAgents();
        loadHistory();
      }
    }, 2000);
    // Safety: stop polling after 90s regardless
    setTimeout(() => { clearInterval(pollId); setDeployPending(false); }, 90000);
  };

  const handleHistorySelect = entry => {
    const resps = {};
    Object.keys(entry).forEach(k => {
      if (!METADATA_KEYS.has(k)) resps[k] = entry[k] || null;
    });
    setResponses(resps);
    setSelectedPrompt(entry.prompt || '');
    setSelectedTemperature(entry.temperature ?? 0.7);
    setShowHistory(false);
  };

  const handleClearCache = async () => {
    setCacheStatus('clearing');
    try {
      await clearCache();
      setCacheStatus('cleared');
    } catch {
      setCacheStatus('failed');
    } finally {
      setTimeout(() => setCacheStatus('idle'), 2000);
    }
  };

  const handleSaveCode = () => {
    const sections = [];
    activeAgents.forEach(({ name }) => {
      const resp = responses[name];
      if (!resp) return;
      const { code, language } = extractCodeBlock(resp);
      if (!code || code.trim().length < 10) return;
      sections.push(`// === ${name.toUpperCase()} (${language}) ===\n\n${code}`);
    });
    if (!sections.length) return;
    const separator = '\n\n// ────────────────────────────────────────────\n\n';
    const blob = new Blob([sections.join(separator)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `matrix-swarm-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSubmit = async (prompt, temperature) => {
    try {
      await submit(prompt, temperature);
      loadHistory();
    } catch (err) {
      console.error('Submission failed:', err);
    }
  };

  return (
    <div className="matrix-container">
      <header>
        <h1>MATRIX SWARM v1.0</h1>
        <div className="header-controls">
          <span className={`status-indicator ${online ? 'status-online' : 'status-offline'}`}>
            {online ? 'ONLINE' : 'OFFLINE'}
          </span>
          <button
            className={`cache-button cache-button--${cacheStatus}`}
            onClick={handleClearCache}
            disabled={cacheStatus === 'clearing' || !online}
          >
            {cacheStatus === 'clearing' ? 'CLEARING...'
              : cacheStatus === 'cleared' ? 'CLEARED'
              : cacheStatus === 'failed'  ? 'FAILED'
              : 'CLEAR KV'}
          </button>
          <button
            className={`configure-button ${showConfigPanel ? 'active' : ''}`}
            onClick={() => setShowConfig(v => !v)}
          >
            CONFIGURE
          </button>
          <button
            className="history-button"
            onClick={() => setShowHistory(!showHistory)}
          >
            HISTORY ({history.length})
          </button>
          <button
            className="help-button"
            onClick={() => setShowHelp(true)}
          >
            ?
          </button>
        </div>
      </header>

      {showConfigPanel && (
        <SwarmConfig onDeployed={handleDeployed} />
      )}

      {showHistory && history.length > 0 && (
        <div className="history-dropdown">
          {history.slice(-10).reverse().map((entry, index) => (
            <div key={index} className="history-item" onClick={() => handleHistorySelect(entry)}>
              <span className="history-prompt">
                {entry.prompt?.substring(0, 50)}
                {entry.prompt?.length > 50 ? '...' : ''}
              </span>
              <span className="history-time">
                {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {!showConfigPanel && (
        <>
          <PromptInput
            onSubmit={handleSubmit}
            loading={loading}
            disabled={!online}
            externalPrompt={selectedPrompt}
            externalTemperature={selectedTemperature}
          />

          {error && (
            <div className="error-banner">ERROR: {error}</div>
          )}

          <div className="agents-grid">
            {activeAgents.map(({ name, port }) => (
              <AgentResponse
                key={name}
                name={name.toUpperCase()}
                port={String(port)}
                response={responses[name] || null}
                color={getAgentColor(name)}
                loading={loading}
              />
            ))}
          </div>

          {responses.programmer && (() => {
            const { code, language } = extractCodeBlock(responses.programmer);
            const hasAnyCode = activeAgents.some(({ name }) => {
              const r = responses[name];
              if (!r) return false;
              const { code: c } = extractCodeBlock(r);
              return c && c.trim().length >= 10;
            });
            return (
              <div className="code-output-section">
                <div className="code-output-header">
                  <h2 className="section-title">CODE OUTPUT</h2>
                  {hasAnyCode && (
                    <button className="save-code-btn" onClick={handleSaveCode}>
                      SAVE CODE
                    </button>
                  )}
                </div>
                <div className="editor-frame">
                  <CodeDisplay initialCode={code} language={language} />
                </div>
              </div>
            );
          })()}
        </>
      )}

      {showHelp && (
        <div className="help-overlay" onClick={() => setShowHelp(false)}>
          <div className="help-modal" onClick={e => e.stopPropagation()}>
            <div className="help-header">
              <span>MATRIX SWARM — HELP</span>
              <button className="help-close" onClick={() => setShowHelp(false)}>✕</button>
            </div>
            <div className="help-body">

              <div className="help-section">
                <h3>Quick Start</h3>
                <div className="help-steps">
                  <div className="help-step"><span className="help-step-n">1</span><span>Run <code>bash scripts/launch_matrix.sh</code> — choose Docker or Bare Metal</span></div>
                  <div className="help-step"><span className="help-step-n">2</span><span>Open <strong>CONFIGURE</strong> → pick engine → select agents → click <strong>LAUNCH SWARM</strong></span></div>
                  <div className="help-step"><span className="help-step-n">3</span><span>Wait for the status indicator to turn <span style={{color:'#648FFF'}}>ONLINE</span></span></div>
                  <div className="help-step"><span className="help-step-n">4</span><span>Type a prompt and press <strong>BROADCAST</strong> or <code>Cmd+Enter</code></span></div>
                  <div className="help-step"><span className="help-step-n">5</span><span>Read agent cards — code from the <em>programmer</em> agent appears in <strong>CODE OUTPUT</strong> below</span></div>
                </div>
              </div>

              <div className="help-section">
                <h3>Header Controls</h3>
                <dl>
                  <dt>ONLINE / OFFLINE</dt>
                  <dd>Coordinator status. OFFLINE (red, blinking) means the backend is unreachable — open CONFIGURE and deploy a swarm first. The UI polls every 10 s and updates automatically.</dd>
                  <dt>CONFIGURE</dt>
                  <dd>Opens the swarm panel. Select engine (LLAMA / LLAMA.PY / MLX), choose agents, optionally override models per agent, then click LAUNCH SWARM. The proxy starts one model server per unique model, groups same-model agents together, then boots the coordinator. Takes up to 120 s on first load.</dd>
                  <dt>CLEAR KV</dt>
                  <dd>Erases the KV cache on all llama-server agents — useful when agents seem stuck, produce repetitive output, or after switching to a completely different task. Has no effect on MLX agents.</dd>
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
                  <dd>All active agents receive the exact same prompt at the same time. Be specific — concrete prompts produce better results than vague ones.</dd>
                  <dt>Temperature</dt>
                  <dd>Default is <code>0.20</code>. For engineering swarms stay in the <code>0.10–0.25</code> range — higher values cause agents to hallucinate roles, invent classes, or contradict each other across 10+ parallel responses. Use <code>0.40–0.70</code> only for architecture brainstorming or open-ended exploration.</dd>
                  <dt>BROADCAST / Cmd+Enter</dt>
                  <dd>Dispatches to all agents in parallel via the C++ coordinator. Agent cards update as each response arrives — faster models appear first.</dd>
                </dl>
              </div>

              <div className="help-section">
                <h3>Reading Results</h3>
                <dl>
                  <dt>Agent cards</dt>
                  <dd>Each card is independently scrollable. Cards are colour-coded by role. A spinning indicator means that agent is still processing.</dd>
                  <dt>CODE OUTPUT</dt>
                  <dd>The <em>programmer</em> agent's first code block is auto-extracted and shown in a syntax-highlighted CodeMirror editor below the grid. Supports C++, Go, Python, JavaScript, Rust, SQL, and more. Use the copy button in the toolbar to grab the code.</dd>
                  <dt>Cross-referencing</dt>
                  <dd><em>architect</em> gives the structure, <em>programmer</em> implements it, <em>reviewer</em> and <em>security</em> flag problems, <em>tester</em> covers edge cases, <em>synthesis</em> ties it into a plan. Read them together for a complete picture of any problem.</dd>
                </dl>
              </div>

              <div className="help-section">
                <h3>Agent Roles</h3>
                <div className="help-roles">
                  {[
                    ['architect','System design, ASCII UML, component diagrams'],
                    ['specialist','C++/Go, performance, memory management, concurrency'],
                    ['scout','Codebase analysis, patterns, module boundaries'],
                    ['programmer','Complete production-ready code (large context, 4096 tokens)'],
                    ['synthesis','Execution roadmap, risk analysis, step-by-step planning'],
                    ['reviewer','Bugs, code smells, anti-patterns, best practices'],
                    ['tester','Unit tests, integration tests, edge cases, coverage'],
                    ['security','OWASP top 10, vulnerabilities, secure coding alternatives'],
                    ['devops','CI/CD pipelines, containers, infrastructure-as-code'],
                    ['documenter','API docs, READMEs, inline comments, user guides'],
                    ['optimizer','CPU/memory/IO bottlenecks, algorithmic improvements'],
                    ['debugger','Root cause analysis, error propagation, targeted fixes'],
                    ['database','Schemas, queries, indexing, SQL/NoSQL, caching layers'],
                    ['frontend','React components, CSS, accessibility, UX patterns'],
                    ['api','REST/GraphQL design, OpenAPI specs, versioning strategies'],
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
                  <dt>LLAMA.PY</dt>
                  <dd>llama-cpp-python server. Same <code>.gguf</code> files as LLAMA; no C++ build required. <code>pip install llama-cpp-python[server]</code>; on Mac use Metal: <code>CMAKE_ARGS="-DGGML_METAL=on" pip install llama-cpp-python</code>. One process per model; CLEAR KV has no effect.</dd>
                  <dt>MLX (mlx-lm)</dt>
                  <dd>Apple Silicon native (Metal). Uses <code>mlx_lm.server</code>; loads model <strong>directories</strong> (not single files). Often faster per-token on M1/M2/M3. Requests queue per server. CLEAR KV has no effect.</dd>
                </dl>
                <p>All use <code>/Users/Shared/llama/models/</code>: <code>.gguf</code> for LLAMA and LLAMA.PY; directories with <code>config.json</code> for MLX. The engine button shows how many models of that type are installed.</p>
                <h4>MLX (mlx-lm) setup</h4>
                <ul style={{ marginTop: '0.5em', paddingLeft: '1.2em' }}>
                  <li><strong>Install:</strong> <code>pip install mlx-lm</code></li>
                  <li><strong>Model format:</strong> Each MLX model is a <strong>directory</strong> under <code>/Users/Shared/llama/models/</code> containing <code>config.json</code>, <code>tokenizer.json</code>, and <code>*.safetensors</code>.</li>
                  <li><strong>Get models:</strong> Use <code>./scripts/convert_models.sh mlx &lt;hf_repo&gt;</code> to convert a HuggingFace model to MLX 4-bit (e.g. <code>HuggingFaceTB/SmolLM2-360M-Instruct</code>). Or download pre-converted 4-bit models from the <code>mlx-community</code> org on HuggingFace into that folder.</li>
                  <li><strong>First load:</strong> MLX servers can take 30–90 s to load; the proxy waits up to 120 s. If LAUNCH SWARM times out, check <code>logs/&lt;port&gt;.log</code> and ensure enough free RAM.</li>
                </ul>
              </div>

              <div className="help-section">
                <h3>How the Coordinator Works</h3>
                <p>The coordinator is a compiled C++ HTTP server (<code>./coordinator</code>) running on port 8000. It is spawned by the proxy after all model servers pass their health checks, and it is the only process that talks directly to the model servers.</p>
                <dl>
                  <dt>Startup</dt>
                  <dd>Reads <code>/tmp/matrix-active-config.json</code> to load the active agent list (name, port, timeout, max tokens, system prompt). Also loads <code>history.json</code> into memory so history survives restarts.</dd>
                  <dt>Broadcast — POST /api/architect</dt>
                  <dd>Receives <code>{'{'}"prompt", "temperature"{'}'}</code>. Launches one <code>std::async</code> thread per agent simultaneously. Each thread POSTs to <code>/v1/chat/completions</code> on its agent's port with a two-message conversation: the agent's system prompt, then the user prompt. The coordinator blocks until every thread completes, collects all responses, writes the entry to <code>history.json</code> under a mutex, then returns the full response map to the UI.</dd>
                  <dt>Per-agent limits</dt>
                  <dd>Most agents: 60 s read timeout, 1024 max tokens. The <em>programmer</em> agent: 300 s timeout, 4096 max tokens. Connection timeout is 5 s for all agents.</dd>
                  <dt>Error isolation</dt>
                  <dd>If one agent times out or its server is unreachable, that card shows an error message. All other agents' responses are returned normally — a single failure never blocks the whole swarm.</dd>
                  <dt>Temperature</dt>
                  <dd>Temperature is accepted in the broadcast request and saved to history, but it is not forwarded to the model servers. Each model server uses its own default sampling settings.</dd>
                  <dt>Clear KV — POST /api/clear-cache</dt>
                  <dd>Groups agents by port to find unique server instances. Fires <code>POST /slots/N?action=erase</code> in parallel for each slot on each llama-server port (slot 0 through N−1, where N is the number of agents sharing that port). MLX servers do not implement this endpoint — those requests fail silently.</dd>
                  <dt>Other endpoints</dt>
                  <dd><code>GET /api/health</code> — liveness check used by the UI status indicator. <code>GET /api/agents</code> — returns the active agent list (name + port) used to render the agent grid. <code>GET /api/history</code> — returns the full history array.</dd>
                </dl>
              </div>

              <div className="help-section">
                <h3>Tips</h3>
                <dl>
                  <dt>Keep temp 0.10–0.25 for coding</dt>
                  <dd>Higher temperatures cause agents to contradict each other or hallucinate new classes across a 10+ agent swarm. Lock it low, especially for continuation prompts.</dd>
                  <dt>CLEAR KV before every new major prompt</dt>
                  <dd>First prompt fills KV with context. A second prompt without clearing can leave half the agents seeing contradictory instructions. Routine: CLEAR KV → 5–7 agents → low temp → focused prompt.</dd>
                  <dt>5–7 agents is the sweet spot for coding</dt>
                  <dd>Default is architect + programmer + specialist + reviewer + synthesis. Add tester or debugger for a quality pass. Running 12–15 agents risks VRAM exhaustion and KV token budget overflow — only do that for high-level exploration.</dd>
                  <dt>Use foreman for continuation</dt>
                  <dd>After a major output, run the <em>foreman</em> agent alone with "summarise what was built and list the next 3 tasks". Use its output as the next broadcast prompt to keep all agents aligned.</dd>
                  <dt>SAVE CODE after each successful round</dt>
                  <dd>The SAVE CODE button below the agent grid exports all code blocks from every agent into a single timestamped file. Use it before clearing KV or refreshing — code is not persisted otherwise.</dd>
                </dl>
              </div>

              <div className="help-section">
                <h3>Launch</h3>
                <code className="help-code">bash scripts/launch_matrix.sh</code>
                <p>Starts the proxy and UI. All swarm configuration is done from the browser — no further terminal interaction required. See <strong>USER_MANUAL.md</strong> in the project root for full documentation and flow diagrams.</p>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
