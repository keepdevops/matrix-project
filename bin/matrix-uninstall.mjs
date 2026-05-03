#!/usr/bin/env node
// Uninstalls @keepdevops/matrix:
//   1. Stops any running matrix processes (proxy, coordinator, UI server)
//   2. Removes runtime data under ~/.matrix/ and /tmp/matrix-*
//   3. Unloads the legacy launchd agent (macOS only)
//   4. Runs: npm uninstall -g @keepdevops/matrix

import { existsSync, rmSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const args = parseArgs(process.argv.slice(2));
if (args.help) { printHelp(); process.exit(0); }

const DRY = args['dry-run'];
const YES = args.yes || args.y;
const KEEP_DATA = args['keep-data'];

// ── paths ─────────────────────────────────────────────────────────────────

const matrixHome    = join(homedir(), '.matrix');
const tmpConfig     = '/tmp/matrix-active-config.json';
const tmpSlots      = '/tmp/matrix-slots';
const launchdAgent  = join(homedir(), 'Library', 'LaunchAgents', 'com.caribou.swarm-dashboard.plist');

const PORTS = [
  { port: 3000, label: 'UI server' },
  { port: 3002, label: 'proxy' },
  { port: 8000, label: 'coordinator' },
];

const PROCESS_PATTERNS = [
  'matrix/dist/bin/proxy',
  'matrix/dist/bin/coordinator',
  'matrix-project/proxy',
  'matrix-project/coordinator',
];

// ── plan ──────────────────────────────────────────────────────────────────

console.log('\nmatrix-uninstall — what will be removed:\n');

const sections = [];

sections.push({
  title: 'Running processes',
  items: [
    ...PORTS.map(({ port, label }) => `${label} on :${port} (if running)`),
  ],
});

if (!KEEP_DATA) {
  const dataPaths = [matrixHome, tmpConfig, tmpSlots].filter(existsSync);
  if (dataPaths.length) {
    sections.push({ title: 'Runtime data', items: dataPaths });
  } else {
    sections.push({ title: 'Runtime data', items: ['(none found)'] });
  }
}

if (platform() === 'darwin' && existsSync(launchdAgent)) {
  sections.push({ title: 'launchd agent', items: [launchdAgent] });
}

sections.push({ title: 'npm package', items: ['npm uninstall -g @keepdevops/matrix'] });

for (const { title, items } of sections) {
  console.log(`  ${title}:`);
  for (const item of items) console.log(`    • ${item}`);
}

if (DRY) {
  console.log('\n[dry-run] no changes made.');
  process.exit(0);
}

if (!YES) {
  const ok = await confirm('\nProceed? [y/N] ');
  if (!ok) { console.log('Aborted.'); process.exit(0); }
}

console.log('');

// ── 1. stop processes ─────────────────────────────────────────────────────

for (const { port, label } of PORTS) {
  const pids = pidsOnPort(port);
  if (!pids.length) { log(`  (no process on :${port})`); continue; }
  process.stdout.write(`  stopping ${label} on :${port} (PID ${pids.join(', ')})… `);
  killPids(pids);
  const still = pidsOnPort(port);
  if (still.length) {
    process.stdout.write('still alive, force-killing… ');
    killPids(still, 'SIGKILL');
  }
  console.log('done');
}

for (const pattern of PROCESS_PATTERNS) {
  const r = spawnSync('pkill', ['-f', pattern], { stdio: 'pipe' });
  if (r.status === 0) log(`  killed processes matching: ${pattern}`);
}

// ── 2. runtime data ───────────────────────────────────────────────────────

if (!KEEP_DATA) {
  for (const p of [matrixHome, tmpConfig, tmpSlots]) {
    if (!existsSync(p)) continue;
    process.stdout.write(`  removing ${p}… `);
    rmSync(p, { recursive: true, force: true });
    console.log('done');
  }
} else {
  log('  skipping runtime data (--keep-data)');
}

// ── 3. launchd agent (macOS) ──────────────────────────────────────────────

if (platform() === 'darwin' && existsSync(launchdAgent)) {
  process.stdout.write(`  unloading launchd agent… `);
  spawnSync('launchctl', ['unload', launchdAgent], { stdio: 'pipe' });
  rmSync(launchdAgent, { force: true });
  console.log('done');
}

// ── 4. npm uninstall ──────────────────────────────────────────────────────

console.log('\n  running: npm uninstall -g @keepdevops/matrix');
const r = spawnSync('npm', ['uninstall', '-g', '@keepdevops/matrix'], { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('\n  npm uninstall failed (exit code ' + r.status + ')');
  console.error('  Run manually: npm uninstall -g @keepdevops/matrix');
  process.exit(r.status ?? 1);
}

console.log('\nmatrix uninstalled successfully.\n');

// ── helpers ───────────────────────────────────────────────────────────────

function pidsOnPort(port) {
  const r = spawnSync('lsof', ['-ti', `:${port}`], { stdio: 'pipe' });
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout.toString().trim().split('\n').filter(Boolean);
}

function killPids(pids, signal = 'SIGTERM') {
  spawnSync('kill', [signal === 'SIGKILL' ? '-9' : '-15', ...pids], { stdio: 'pipe' });
  if (signal === 'SIGTERM') {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) { /* spin */ }
  }
}

function log(msg) { console.log(msg); }

async function confirm(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { out.help = true; continue; }
    if (a === '-y') { out.yes = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    }
  }
  return out;
}

function printHelp() {
  console.log(`matrix-uninstall — remove @keepdevops/matrix and its runtime data

Usage:
  matrix-uninstall [options]

Options:
  --yes, -y      Skip confirmation prompts
  --keep-data    Don't remove ~/.matrix/ or /tmp/matrix-* runtime files
  --dry-run      Show what would be removed without making any changes
  -h, --help     Show this help

What is removed:
  • Running proxy, coordinator, and UI server processes
  • ~/.matrix/run/, ~/.matrix/slots/ (runtime state and logs)
  • ~/.matrix/config.json (user config, only if present)
  • /tmp/matrix-active-config.json and /tmp/matrix-slots (if present)
  • Legacy launchd agent com.caribou.swarm-dashboard (macOS, if installed)
  • The npm package itself via: npm uninstall -g @keepdevops/matrix
`);
}
