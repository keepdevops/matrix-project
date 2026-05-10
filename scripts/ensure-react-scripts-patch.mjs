#!/usr/bin/env node
/**
 * CRA 5 calls devServer.close(); webpack-dev-server v5 removed it.
 * patches/react-scripts+5.0.1.patch fixes this — but patch-package can abort
 * when the webpackDevServer.config.js hunk is already applied, leaving start.js
 * unpatched. We try patch-package first, then rewrite start.js (exact + regex).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const startJs = join(root, 'node_modules/react-scripts/scripts/start.js');

function normalizeLf(s) {
  return s.replace(/\r\n/g, '\n');
}

/** Exact CRA 5.0.1 block (LF). */
const STOCK_SHUTDOWN = `    ['SIGINT', 'SIGTERM'].forEach(function (sig) {
      process.on(sig, function () {
        devServer.close();
        process.exit();
      });
    });

    if (process.env.CI !== 'true') {
      // Gracefully exit when stdin ends
      process.stdin.on('end', function () {
        devServer.close();
        process.exit();
      });
    }`;

const FIXED_SHUTDOWN = `    // webpack-dev-server v5 removed \`close()\`; use \`stopCallback\` (CRA still calls close).
    function shutdownDevServer() {
      if (typeof devServer.stopCallback === 'function') {
        devServer.stopCallback(function () {
          process.exit();
        });
      } else if (typeof devServer.close === 'function') {
        devServer.close();
        process.exit();
      } else {
        process.exit();
      }
    }

    ['SIGINT', 'SIGTERM'].forEach(function (sig) {
      process.on(sig, shutdownDevServer);
    });

    if (process.env.CI !== 'true') {
      // Gracefully exit when stdin ends
      process.stdin.on('end', shutdownDevServer);
    }`;

/** Insert before SIGINT forEach — spacing-tolerant CRA layouts. */
const FN_ONLY = `    // webpack-dev-server v5 removed \`close()\`; use \`stopCallback\` (CRA still calls close).
    function shutdownDevServer() {
      if (typeof devServer.stopCallback === 'function') {
        devServer.stopCallback(function () {
          process.exit();
        });
      } else if (typeof devServer.close === 'function') {
        devServer.close();
        process.exit();
      } else {
        process.exit();
      }
    }

`;

function applyStartJsInline() {
  if (!existsSync(startJs)) return false;
  const raw = readFileSync(startJs, 'utf8');
  const src = normalizeLf(raw);
  if (src.includes('function shutdownDevServer')) {
    if (src !== raw) writeFileSync(startJs, src, 'utf8');
    return true;
  }

  let out = src;

  // 1) Exact match (LF)
  if (out.includes(STOCK_SHUTDOWN)) {
    out = out.replace(STOCK_SHUTDOWN, FIXED_SHUTDOWN);
    writeFileSync(startJs, out, 'utf8');
    console.log('[matrix] Applied inline react-scripts start.js shutdown fix (exact match).');
    return true;
  }

  // 2) Regex path: CRLF/spacing drift or minor CRA differences
  const needsFix =
    /process\.on\(\s*sig\s*,\s*function\s*\(\s*\)\s*\{[^}]*devServer\.close\s*\(\s*\)/.test(
      out
    );
  if (!needsFix) {
    console.error(
      '[matrix] react-scripts/scripts/start.js has no recognizable broken SIGINT shutdown; cannot auto-fix.'
    );
    return false;
  }

  out = out.replace(
    /(openBrowser\(urls\.localUrlForBrowser\);\s*\n\s*\}\);\s*\n)(\s*\[\s*['"]SIGINT['"]\s*,\s*['"]SIGTERM['"]\s*\]\.forEach)/,
    (_, a, b) => `${a}${FN_ONLY}${b}`
  );

  out = out.replace(
    /process\.on\(\s*sig\s*,\s*function\s*\(\s*\)\s*\{\s*devServer\.close\s*\(\s*\)\s*;\s*process\.exit\s*\(\s*\)\s*;\s*\}\s*\)/,
    'process.on(sig, shutdownDevServer)'
  );

  out = out.replace(
    /process\.stdin\.on\(\s*['"]end['"]\s*,\s*function\s*\(\s*\)\s*\{\s*devServer\.close\s*\(\s*\)\s*;\s*process\.exit\s*\(\s*\)\s*;\s*\}\s*\)/,
    "process.stdin.on('end', shutdownDevServer)"
  );

  if (!out.includes('function shutdownDevServer')) {
    console.error('[matrix] Regex auto-fix failed (could not insert shutdownDevServer).');
    return false;
  }
  if (/process\.on\(\s*sig\s*,\s*function\s*\(\s*\)\s*\{[^}]*devServer\.close/.test(out)) {
    console.error('[matrix] Regex auto-fix incomplete (SIGINT handler still calls devServer.close).');
    return false;
  }

  writeFileSync(startJs, out, 'utf8');
  console.log('[matrix] Applied inline react-scripts start.js shutdown fix (regex fallback).');
  return true;
}

function runPatchPackage() {
  const patchPkg = join(root, 'node_modules/.bin/patch-package');
  if (!existsSync(patchPkg)) {
    console.error('[matrix] patch-package missing; run: npm install');
    return false;
  }
  console.log('[matrix] Running patch-package...');
  const r = spawnSync(patchPkg, [], { cwd: root, stdio: 'inherit' });
  return (r.status ?? 1) === 0;
}

if (!existsSync(startJs)) process.exit(0);

let src = readFileSync(startJs, 'utf8');
if (src.includes('function shutdownDevServer')) process.exit(0);

runPatchPackage();

src = readFileSync(startJs, 'utf8');
if (src.includes('function shutdownDevServer')) process.exit(0);

if (!applyStartJsInline()) process.exit(1);
process.exit(0);
