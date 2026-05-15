#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';

const SUPPORTED = { darwin: ['arm64'], linux: ['arm64', 'x64'] };
const { platform, arch } = process;
if (!SUPPORTED[platform]?.includes(arch)) {
  console.error(
    `[matrix] Unsupported platform: ${platform}-${arch}. ` +
    `Supported: macOS (arm64) and Linux (x64, arm64).`
  );
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const dist = join(pkgRoot, 'dist');
const binDir = join(dist, 'bin');
const proxyBin = join(binDir, 'proxy');
const coordBin = join(binDir, 'coordinator');
const webDir = join(dist, 'web');

for (const p of [proxyBin, coordBin]) {
  if (!existsSync(p)) {
    console.error(
      `[matrix] Missing binary: ${p}\n` +
      `Try reinstalling: npm i -g @keepdevops/matrix`
    );
    process.exit(1);
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { printHelp(); process.exit(0); }

const proxyPort = Number(args.port ?? process.env.MATRIX_PROXY_PORT ?? 3002);
const coordPort = Number(
  args['coordinator-port'] ?? process.env.MATRIX_COORDINATOR_PORT ?? 8000
);
const uiPort = Number(args['ui-port'] ?? process.env.MATRIX_UI_PORT ?? 3000);

const configPath = resolveConfig(args, pkgRoot);
console.log(`[matrix] config:      ${configPath}`);

// Stage a runtime working dir so binaries find swarm-config.json next to themselves.
const runDir = join(homedir(), '.matrix', 'run');
const slotsDir = join(homedir(), '.matrix', 'slots');
mkdirSync(runDir, { recursive: true });
mkdirSync(join(runDir, 'logs'), { recursive: true });
mkdirSync(slotsDir, { recursive: true });
copyFileSync(configPath, join(runDir, 'swarm-config.json'));

const env = {
  ...process.env,
  MATRIX_PROXY_PORT: String(proxyPort),
  MATRIX_COORDINATOR_PORT: String(coordPort),
  MATRIX_ACTIVE_CONFIG: join(runDir, 'matrix-active-config.json'),
  MATRIX_SLOTS_DIR: slotsDir,
};

console.log(`[matrix] coordinator: http://127.0.0.1:${coordPort}`);
const coordinator = spawn(coordBin, ['--config', join(runDir, 'swarm-config.json')], {
  cwd: runDir, env, stdio: 'inherit',
});

console.log(`[matrix] proxy:       http://127.0.0.1:${proxyPort}`);
const proxy = spawn(proxyBin, [], { cwd: runDir, env, stdio: 'inherit' });

const ui = startUiServer(webDir, uiPort);
console.log(`[matrix] UI:          http://localhost:${uiPort}`);

const shutdown = (sig) => {
  console.log(`\n[matrix] received ${sig}, shutting down`);
  for (const c of [coordinator, proxy]) { try { c.kill('SIGTERM'); } catch {} }
  try { ui.close(); } catch {}
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

for (const [name, child] of [['coordinator', coordinator], ['proxy', proxy]]) {
  child.on('exit', (code) => {
    console.error(`[matrix] ${name} exited with code ${code}`);
    shutdown(`${name}-exit`);
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { out.help = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    }
  }
  return out;
}

function resolveConfig(args, pkgRoot) {
  const candidates = [
    args.config,
    args.profile && join(pkgRoot, 'dist/config', `${args.profile}.json`),
    join(process.cwd(), 'matrix.config.json'),
    join(homedir(), '.matrix', 'config.json'),
    join(pkgRoot, 'dist/config/default.json'),
  ].filter(Boolean);

  for (const c of candidates) {
    if (existsSync(c)) return resolve(c);
  }
  console.error('[matrix] no config found and no bundled default');
  process.exit(1);
}

function startUiServer(root, port) {
  const mime = {
    '.html': 'text/html', '.js': 'application/javascript',
    '.css': 'text/css',   '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png',
    '.ico': 'image/x-icon', '.map': 'application/json',
  };
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const safe = url.replace(/\.\./g, '');
    let file = join(root, safe === '/' ? 'index.html' : safe);
    if (!existsSync(file)) file = join(root, 'index.html'); // SPA fallback
    try {
      const body = readFileSync(file);
      const ext = file.slice(file.lastIndexOf('.'));
      res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
      res.end(body);
    } catch (err) {
      console.error('[matrix] ui server error serving', file, err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });
  server.listen(port);
  return server;
}

function printHelp() {
  console.log(`matrix — run the Matrix UI + proxy + coordinator stack

Usage:
  matrix [options]

Options:
  --port <n>              Proxy port (default 3002, env MATRIX_PROXY_PORT)
  --coordinator-port <n>  Coordinator port (default 8000)
  --ui-port <n>           UI HTTP port (default 3000)
  --profile <name>        Bundled config: default | 16gb | 32gb | 8agents
  --config <path>         Path to a custom swarm-config.json
  -h, --help              Show this help

Config resolution order:
  --config  >  --profile  >  ./matrix.config.json
            >  ~/.matrix/config.json  >  bundled default
`);
}
