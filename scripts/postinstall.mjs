#!/usr/bin/env node
// Downloads the platform-matched binary tarball from the GitHub Release
// matching this package's version and extracts it into dist/.
//
// Skipped when:
//   - MATRIX_SKIP_POSTINSTALL=1
//   - running on an unsupported platform (we warn and exit 0 so install
//     itself does not fail; the CLI will refuse to run later)
//   - dist/bin/proxy already exists (idempotent re-installs)

import { createWriteStream, existsSync, mkdirSync, chmodSync, readFileSync, createReadStream, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

if (process.env.MATRIX_SKIP_POSTINSTALL === '1') {
  console.log('[matrix postinstall] skipped (MATRIX_SKIP_POSTINSTALL=1)');
  process.exit(0);
}

const SUPPORTED = { darwin: ['arm64', 'x64'], linux: ['arm64', 'x64'] };
const { platform, arch } = process;
if (!SUPPORTED[platform]?.includes(arch)) {
  console.warn(
    `[matrix postinstall] Unsupported platform ${platform}-${arch}. ` +
    `Skipping binary download. The CLI will refuse to run.`
  );
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));

const target = `${platform}-${arch}`;
const distBin = join(pkgRoot, 'dist', 'bin');
const proxyPath = join(distBin, 'proxy');
const coordPath = join(distBin, 'coordinator');

if (existsSync(proxyPath) && existsSync(coordPath)) {
  console.log('[matrix postinstall] binaries already present, skipping');
  process.exit(0);
}

const repo = (pkg.repository?.url || '')
  .replace(/^git\+/, '').replace(/\.git$/, '')
  .replace(/^https:\/\/github\.com\//, '');
if (!repo) {
  console.error('[matrix postinstall] package.json must set repository.url to a GitHub URL');
  process.exit(1);
}

const tag = `v${pkg.version}`;
const tarName = `matrix-${target}.tar.gz`;
const base = `https://github.com/${repo}/releases/download/${tag}`;
const tarUrl = `${base}/${tarName}`;
const shaUrl = `${tarUrl}.sha256`;

mkdirSync(distBin, { recursive: true });
const tmpTar = join(pkgRoot, 'dist', tarName);
const tmpSha = `${tmpTar}.sha256`;

const cleanup = () => {
  for (const f of [tmpTar, tmpSha]) {
    try { if (existsSync(f)) unlinkSync(f); } catch {}
  }
};

try {
  console.log(`[matrix postinstall] downloading ${tarUrl}`);
  await downloadWithRetry(tarUrl, tmpTar);
  await downloadWithRetry(shaUrl, tmpSha);
  await verifySha(tmpTar, tmpSha);

  console.log('[matrix postinstall] extracting');
  const r = spawnSync('tar', ['-xzf', tmpTar, '-C', join(pkgRoot, 'dist'), '--strip-components=1'], {
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error('[matrix postinstall] tar extraction failed');
    cleanup();
    process.exit(1);
  }

  cleanup();

  for (const p of [proxyPath, coordPath]) {
    if (!existsSync(p)) {
      console.error(`[matrix postinstall] expected binary missing after extract: ${p}`);
      process.exit(1);
    }
    chmodSync(p, 0o755);
  }

  console.log(`[matrix postinstall] installed binaries for ${target}`);
} catch (err) {
  cleanup();
  console.error(`[matrix postinstall] failed: ${err.message}`);
  if (err.message.includes('HTTP 404')) {
    console.error(
      `[matrix postinstall] Release ${tag} not found on GitHub.\n` +
      `  Check https://github.com/${repo}/releases for available versions.\n` +
      `  Set MATRIX_SKIP_POSTINSTALL=1 to skip this step.`
    );
  }
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function downloadWithRetry(url, dest, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await download(url, dest);
      return;
    } catch (err) {
      const isLast = i === attempts;
      // Don't retry 404 — the release asset simply doesn't exist.
      if (err.message.includes('HTTP 404') || isLast) throw err;
      const delay = i * 2000;
      console.warn(`[matrix postinstall] attempt ${i} failed (${err.message}), retrying in ${delay / 1000}s…`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function download(url, dest, redirects = 5) {
  const { get } = await import('node:https');
  await new Promise((res, rej) => {
    const req = get(url, { headers: { 'User-Agent': `matrix-postinstall/${pkg.version}` } }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        if (redirects <= 0) return rej(new Error('too many redirects'));
        resp.resume();
        return download(resp.headers.location, dest, redirects - 1).then(res, rej);
      }
      if (resp.statusCode !== 200) {
        resp.resume();
        return rej(new Error(`HTTP ${resp.statusCode} fetching ${url}`));
      }

      const total = parseInt(resp.headers['content-length'] || '0', 10);
      let received = 0;
      let lastPct = -1;

      resp.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && pct % 10 === 0) {
            process.stdout.write(`\r[matrix postinstall] ${pct}% (${(received / 1024 / 1024).toFixed(1)} MB)`);
            lastPct = pct;
          }
        }
      });
      resp.on('end', () => { if (total > 0) process.stdout.write('\n'); });

      pipeline(resp, createWriteStream(dest)).then(res, rej);
    });
    req.on('error', rej);
  });
}

async function verifySha(file, shaFile) {
  const expected = readFileSync(shaFile, 'utf8').trim().split(/\s+/)[0];
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  const actual = hash.digest('hex');
  if (actual !== expected) {
    throw new Error(`sha256 mismatch\n  expected ${expected}\n  actual   ${actual}`);
  }
}
