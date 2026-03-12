import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { readdirSync, writeFileSync, readFileSync, mkdirSync, openSync } from 'fs';
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = '/Users/Shared/llama/models';
const LLAMA_BIN = '/Users/Shared/llama/llama-server';
const ACTIVE_CONFIG = '/tmp/matrix-active-config.json';

const app = express();
app.use(cors());
app.use(express.json());

// ── GET /api/models ──────────────────────────────────────────────────────────
app.get('/api/models', (req, res) => {
    try {
        const files = readdirSync(MODEL_DIR)
            .filter(f => f.endsWith('.gguf'))
            .sort()
            .map(f => ({ name: path.basename(f, '.gguf'), path: path.join(MODEL_DIR, f) }));
        res.json(files);
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
app.post('/api/configure', async (req, res) => {
    const { agents } = req.body || {};
    if (!agents?.length) return res.status(400).json({ error: 'agents array required' });

    try {
        // Group agents by model → assign ports dynamically (8080, 8081, ...)
        const modelToPort = {};
        let nextPort = 8080;
        const portGroups = {};

        for (const agent of agents) {
            if (!modelToPort[agent.model]) modelToPort[agent.model] = nextPort++;
            agent.port = modelToPort[agent.model];
            const p = agent.port;
            if (!portGroups[p]) {
                portGroups[p] = { model: agent.model, context: agent.context, gpu_layers: agent.gpu_layers, names: [] };
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

        // Stop existing services (kill any llama-server variant on swarm ports)
        try { execSync(`pkill -f llama-server`); } catch {}
        try { execSync(`pkill -f "${path.join(__dirname, 'coordinator')}"`); } catch {}
        // Force-free the ports in case of lingering sockets
        try { execSync(`lsof -ti:8080,8081,8082,8083,8084 | xargs kill -9`); } catch {}
        await sleep(5000); // give old servers time to release ports/VRAM

        mkdirSync('/tmp/matrix-slots', { recursive: true });
        mkdirSync(path.join(__dirname, 'logs'), { recursive: true });

        // Start one llama-server per unique model
        for (const [port, g] of Object.entries(portGroups)) {
            const logFile = path.join(__dirname, 'logs', `${port}.log`);
            const out = openSync(logFile, 'a');
            spawn(LLAMA_BIN, [
                '-m', g.model,
                '-c', String(g.context),
                '--port', port,
                '--n-gpu-layers', String(g.gpu_layers),
                '--parallel', String(g.names.length),
                '--slot-save-path', '/tmp/matrix-slots',
            ], { detached: true, stdio: ['ignore', out, out] }).unref();
            console.log(`[Configure] port ${port} | parallel=${g.names.length} | [${g.names.join(', ')}] → logs/${port}.log`);
        }

        // Wait for all servers to be healthy (up to 120s — loading 4 large models can take time)
        const ports = Object.keys(portGroups).map(Number);
        if (!await waitForHealth(ports, 120)) {
            return res.status(503).json({ error: 'Servers failed to become healthy within 120s' });
        }

        // Start coordinator
        const coordLog = path.join(__dirname, 'logs', 'coordinator.log');
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

async function waitForHealth(ports, timeoutSecs) {
    const deadline = Date.now() + timeoutSecs * 1000;
    while (Date.now() < deadline) {
        const results = await Promise.all(
            ports.map(p => fetch(`http://127.0.0.1:${p}/health`).then(r => r.ok).catch(() => false))
        );
        if (results.every(Boolean)) return true;
        await sleep(2000);
    }
    return false;
}

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
