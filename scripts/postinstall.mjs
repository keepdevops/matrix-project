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

console.log(`[matrix postinstall] downloading ${tarUrl}`);
await download(tarUrl, tmpTar);
await download(shaUrl, tmpSha);
await verifySha(tmpTar, tmpSha);

console.log('[matrix postinstall] extracting');
const r = spawnSync('tar', ['-xzf', tmpTar, '-C', join(pkgRoot, 'dist'), '--strip-components=1'], {
  stdio: 'inherit',
});
if (r.status !== 0) {
  console.error('[matrix postinstall] tar extraction failed');
  process.exit(1);
}

unlinkSync(tmpTar);
unlinkSync(tmpSha);

for (const p of [proxyPath, coordPath]) {
  if (!existsSync(p)) {
    console.error(`[matrix postinstall] expected binary missing after extract: ${p}`);
    process.exit(1);
  }
  chmodSync(p, 0o755);
}

console.log(`[matrix postinstall] installed binaries for ${target}`);

// ── helpers ──────────────────────────────────────────────────────────────────

async function download(url, dest, redirects = 5) {
  const { get } = await import('node:https');
  await new Promise((res, rej) => {
    const req = get(url, { headers: { 'User-Agent': 'matrix-postinstall' } }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        if (redirects <= 0) return rej(new Error('too many redirects'));
        resp.resume();
        return download(resp.headers.location, dest, redirects - 1).then(res, rej);
      }
      if (resp.statusCode !== 200) {
        return rej(new Error(`GET ${url} → HTTP ${resp.statusCode}`));
      }
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
    console.error(`[matrix postinstall] sha256 mismatch\n  expected ${expected}\n  actual   ${actual}`);
    process.exit(1);
  }
}
