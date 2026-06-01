import { extractAllCodeBlocks, MIN_CODE_CHARS } from './codeExtractor';
import { buildZipBlob as _buildZipBlob } from './codeSave.zip';
export { buildZipBlob } from './codeSave.zip';

const EXT_BY_LANG = {
  python: 'py', javascript: 'js', typescript: 'ts', cpp: 'cpp', rust: 'rs',
  go: 'go', java: 'java', sql: 'sql', bash: 'sh', shell: 'sh', html: 'html',
  css: 'css', json: 'json', markdown: 'md', yaml: 'yml', php: 'php', xml: 'xml',
};

function extForBlock(block, agentName, index) {
  if (block.filename) {
    const base = block.filename.split('/').pop();
    if (base) return base;
  }
  const ext = EXT_BY_LANG[block.language] || 'txt';
  return `${agentName || 'code'}-${index + 1}.${ext}`;
}

function uniqueName(used, name) {
  if (!used.has(name)) { used.add(name); return name; }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext  = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  while (used.has(`${stem}-${n}${ext}`)) n += 1;
  const next = `${stem}-${n}${ext}`;
  used.add(next);
  return next;
}

/** Collect exportable code files from agent responses. */
export function collectCodeFiles(activeAgents, responses) {
  const files = [];
  const roster = Array.isArray(activeAgents) ? activeAgents : [];
  roster.forEach(({ name }) => {
    const resp = responses[name];
    if (!resp) return;
    const blocks = extractAllCodeBlocks(resp).filter(
      (b) => b.content.trim().length >= MIN_CODE_CHARS,
    );
    blocks.forEach((block, i) => {
      files.push({
        name: extForBlock(block, name, i),
        content: block.content,
        agent: name,
        language: block.language,
      });
    });
  });
  return files;
}

/**
 * @returns {{ ok: boolean, fileCount: number, format: 'zip'|'txt'|null, blob?: Blob, filename?: string, message?: string }}
 */
export function buildCodeExport(activeAgents, responses) {
  const files = collectCodeFiles(activeAgents, responses);
  if (!files.length) {
    return { ok: false, fileCount: 0, format: null, message: 'No fenced code blocks to save' };
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const used = new Set();
  const normalized = files.map((f) => ({ ...f, name: uniqueName(used, f.name) }));

  if (normalized.length === 1) {
    return {
      ok: true, fileCount: 1, format: 'txt',
      blob: new Blob([normalized[0].content], { type: 'text/plain' }),
      filename: normalized[0].name,
    };
  }

  return {
    ok: true,
    fileCount: normalized.length,
    format: 'zip',
    blob: _buildZipBlob(normalized),
    filename: `swarm-matrix-${stamp}.zip`,
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
