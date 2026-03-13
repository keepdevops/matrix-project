import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { readdirSync, writeFileSync, readFileSync, mkdirSync, openSync, statSync, existsSync } from 'fs';
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = '/Users/Shared/llama/models';
const LLAMA_BIN = '/Users/Shared/llama/llama-server';
const ACTIVE_CONFIG = '/tmp/matrix-active-config.json';

// A model is MLX if its path is a directory (not a .gguf file)
const isMLXModel = (modelPath) => !modelPath.endsWith('.gguf');

const app = express();
app.use(cors());

// ── GET /api/models ──────────────────────────────────────────────────────────
app.get('/api/models', (req, res) => {
    try {
        const entries = readdirSync(MODEL_DIR).sort();

        const gguf = entries
            .filter(f => f.endsWith('.gguf'))
            .map(f => ({ name: path.basename(f, '.gguf'), path: path.join(MODEL_DIR, f), backend: 'llama' }));

        const mlx = entries
            .filter(name => {
                const p = path.join(MODEL_DIR, name);
                return statSync(p).isDirectory() && existsSync(path.join(p, 'config.json'));
            })
            .map(name => ({ name, path: path.join(MODEL_DIR, name), backend: 'mlx' }));

        res.json([...gguf, ...mlx]);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── GET /api/swarm-config ────────────────────────────────────────────────────
app.get('/api/swarm-config', (req, res) => {
    try {
        const config = JSON.parse(readFileSync(path.join(__dirname, 'swarm-config.json'), 'utf8'));
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/configure ──────────────────────────────────────────────────────
// Accepts an agents array, groups same-model agents onto shared llama-server
// instances with --parallel N, starts everything, waits for health.
app.post('/api/configure', express.json(), async (req, res) => {
    const { agents } = req.body || {};
    if (!agents?.length) return res.status(400).json({ error: 'agents array required' });

    try {
        // Group agents by model → assign ports dynamically (8080, 8081, ...)
        const modelToPort = {};
        let nextPort = 8080;
        const portGroups = {};

        for (const agent of agents) {
            const backend = agent.backend || (agent.model.endsWith('.gguf') ? 'llama' : 'mlx');
            const key = `${backend}:${agent.model}`;
            if (!modelToPort[key]) modelToPort[key] = nextPort++;
            agent.port = modelToPort[key];
            const p = agent.port;
            if (!portGroups[p]) {
                portGroups[p] = { model: agent.model, context: agent.context, gpu_layers: agent.gpu_layers, names: [], backend };
            } else {
                portGroups[p].context = Math.max(portGroups[p].context, agent.context);
            }
            portGroups[p].names.push(agent.name);
        }

        // Write active config
        const base = JSON.parse(readFileSync(path.join(__dirname, 'swarm-config.json'), 'utf8'));
        writeFileSync(ACTIVE_CONFIG, JSON.stringify(
            { agents, coordinator: base.coordinator, ui: base.ui }, null, 2
        ));

        // Stop existing services
        try { execSync(`pkill -f llama-server`); } catch {}
        try { execSync(`pkill -f "llama_cpp.server"`); } catch {}
        try { execSync(`pkill -f "mlx_lm.server"`); } catch {}
        try { execSync(`pkill -f "${path.join(__dirname, 'coordinator')}"`); } catch {}
        // Force-free the ports in case of lingering sockets
        try { execSync(`lsof -ti:8080,8081,8082,8083,8084 | xargs kill -9`); } catch {}
        await sleep(5000); // give old servers time to release ports/VRAM

        mkdirSync('/tmp/matrix-slots', { recursive: true });
        const logsDir = path.join(__dirname, 'logs');
        const agentLogsDir = path.join(__dirname, 'agent_logs');
        mkdirSync(logsDir, { recursive: true });
        mkdirSync(agentLogsDir, { recursive: true });

        // Start one server per unique model (write to agent_logs/ so "check agent_logs" has server output)
        let mlxStarted = 0;
        for (const [port, g] of Object.entries(portGroups)) {
            const logFile = path.join(agentLogsDir, `${port}.log`);
            const out = openSync(logFile, 'a');
            if (g.backend === 'mlx') {
                // Stagger MLX server starts so they don't all load at once (GPU/memory contention)
                if (mlxStarted > 0) await sleep(5000);
                mlxStarted++;
                const modelArg = path.isAbsolute(g.model) ? g.model : path.join(MODEL_DIR, path.basename(g.model));
                spawn('python3', [
                    '-m', 'mlx_lm.server',
                    '--model', modelArg,
                    '--port', String(port),
                    '--host', '127.0.0.1',
                ], { detached: true, stdio: ['ignore', out, out] }).unref();
                console.log(`[Configure] MLX port ${port} | model=${path.basename(modelArg)} | [${g.names.join(', ')}] → agent_logs/${port}.log`);
            } else {
                spawn(LLAMA_BIN, [
                    '-m', g.model,
                    '-c', String(g.context),
                    '--port', port,
                    '--n-gpu-layers', String(g.gpu_layers),
                    '--parallel', String(g.names.length),
                    '--slot-save-path', '/tmp/matrix-slots',
                ], { detached: true, stdio: ['ignore', out, out] }).unref();
                console.log(`[Configure] LLAMA port ${port} | parallel=${g.names.length} | [${g.names.join(', ')}] → agent_logs/${port}.log`);
            }
        }

        // Wait for all servers to be healthy (up to 240s — loading multiple models can take 1–3 min)
        const ports = Object.keys(portGroups).map(Number);
        const portToBackend = {};
        for (const [p, g] of Object.entries(portGroups)) portToBackend[Number(p)] = g.backend;
        const healthResult = await waitForHealth(ports, 240, portToBackend);
        if (!healthResult.ok) {
            const failed = healthResult.failedPorts || ports;
            const failedList = failed.join(', ');
            console.error('[Configure] Health timeout. Ports not ready:', failedList);
            return res.status(503).json({
                error: `Servers failed to become healthy within 4 minutes. Check CONFIGURE panel or project agent_logs/ — especially agent_logs/${failed[0] || '8080'}.log. Ports not ready: ${failedList}. MLX can take 1–2 min per model on first load.`,
                failedPorts: failed,
            });
        }

        // Start coordinator
        const coordLog = path.join(agentLogsDir, 'coordinator.log');
        const coordOut = openSync(coordLog, 'a');
        spawn(
            path.join(__dirname, 'coordinator'),
            ['--config', ACTIVE_CONFIG],
            { detached: true, stdio: ['ignore', coordOut, coordOut], cwd: __dirname }
        ).unref();
        await sleep(1500);

        const servers = Object.entries(portGroups).map(([port, g]) => ({
            port: Number(port),
            model: path.basename(g.model, '.gguf'),
            agents: g.names,
            parallel: g.names.length,
        }));

        console.log('[Configure] Swarm online:', servers.map(s => `${s.port}(${s.agents.join('+')})`).join(' '));
        res.json({ status: 'ok', servers });

    } catch (e) {
        console.error('[Configure] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForHealth(ports, timeoutSecs, portToBackend = {}) {
    const deadline = Date.now() + timeoutSecs * 1000;
    while (Date.now() < deadline) {
        const results = await Promise.all(
            ports.map(async p => {
                const backend = portToBackend[p] || 'llama';
                const url = backend === 'mlx'
                    ? `http://127.0.0.1:${p}/v1/models`
                    : `http://127.0.0.1:${p}/health`;
                try {
                    const ok = (await fetch(url)).ok;
                    return { port: p, ok };
                } catch {
                    return { port: p, ok: false };
                }
            })
        );
        const failedPorts = results.filter(r => !r.ok).map(r => r.port);
        if (failedPorts.length === 0) return { ok: true };
        await sleep(2000);
    }
    // Final check to report which ports never came up
    const final = await Promise.all(
        ports.map(async p => {
            const backend = portToBackend[p] || 'llama';
            const url = backend === 'mlx'
                ? `http://127.0.0.1:${p}/v1/models`
                : `http://127.0.0.1:${p}/health`;
            try {
                return { port: p, ok: (await fetch(url)).ok };
            } catch {
                return { port: p, ok: false };
            }
        })
    );
    return { ok: false, failedPorts: final.filter(r => !r.ok).map(r => r.port) };
}

// ── GET /api/logs ───────────────────────────────────────────────────────────
// Return last N lines of agent_logs/<port>.log (or logs/<port>.log fallback)
const LOG_TAIL_LINES = 80;
const AGENT_LOGS_DIR = path.join(__dirname, 'agent_logs');
const LEGACY_LOGS_DIR = path.join(__dirname, 'logs');
const SAFE_PORT = /^[0-9]+$/;

function getLogPath(port) {
    const inAgent = path.join(AGENT_LOGS_DIR, `${port}.log`);
    const inLegacy = path.join(LEGACY_LOGS_DIR, `${port}.log`);
    if (existsSync(inAgent)) return inAgent;
    return inLegacy;
}

app.get('/api/logs', (req, res) => {
    const raw = req.query.ports || req.query.port || '';
    const ports = [...new Set(String(raw).split(',').map(p => p.trim()).filter(p => SAFE_PORT.test(p)))].slice(0, 10);
    if (ports.length === 0) return res.status(400).json({ error: 'Query param ports required (e.g. ?ports=8080,8081)' });

    const logs = [];
    for (const port of ports) {
        const logPath = getLogPath(port);
        const dirName = path.basename(path.dirname(logPath));
        try {
            if (!existsSync(logPath)) {
                logs.push({ port: Number(port), lines: [`(file not found: ${dirName}/${port}.log)`] });
                continue;
            }
            const content = readFileSync(logPath, 'utf8');
            const lines = content.split('\n').filter(Boolean);
            const tail = lines.slice(-LOG_TAIL_LINES);
            logs.push({ port: Number(port), lines: tail });
        } catch (e) {
            logs.push({ port: Number(port), lines: [`(read error: ${e.message})`] });
        }
    }
    res.json({ logs });
});

// ── All other requests → coordinator ────────────────────────────────────────
app.use('/', createProxyMiddleware({
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
    on: {
        error: (err, req, res) => {
            res.status(503).json({ error: 'Coordinator offline. Deploy a swarm configuration first.' });
        },
        proxyRes: (proxyRes, req) => {
            console.log(`[Proxy] ${req.method} ${req.url} -> ${proxyRes.statusCode}`);
        },
    },
}));

app.listen(3002, '0.0.0.0', () => {
    console.log('🚀 Matrix Proxy active on http://localhost:3002');
});
