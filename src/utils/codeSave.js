import { extractAllCodeBlocks, MIN_CODE_CHARS } from './codeExtractor';

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
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
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

// CRC32 (IEEE) for ZIP store entries
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n) {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
}

function u32(n) {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}

function concat(chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  chunks.forEach((c) => { out.set(c, off); off += c.length; });
  return out;
}

/** UTF-8 bytes — works in browser and Jest/jsdom. */
function utf8Bytes(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  // eslint-disable-next-line global-require
  const { TextEncoder: NodeTextEncoder } = require('util');
  return new NodeTextEncoder().encode(str);
}

/** Build a store-only ZIP blob (no compression). */
export function buildZipBlob(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach(({ name, content }) => {
    const nameBytes = utf8Bytes(name);
    const data = utf8Bytes(content);
    const crc = crc32(data);
    const localHeader = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0),
      u16(0), u16(0), u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0), nameBytes,
    ]);
    localParts.push(localHeader, data);

    const centralHeader = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0),
      u16(0), u16(0), u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset), nameBytes,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  });

  const centralStart = offset;
  const centralBlob = concat(centralParts);
  offset += centralBlob.length;
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralBlob.length), u32(centralStart), u16(0),
  ]);

  return new Blob([...localParts, centralBlob, end], { type: 'application/zip' });
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
  const normalized = files.map((f) => ({
    ...f,
    name: uniqueName(used, f.name),
  }));

  if (normalized.length === 1) {
    const blob = new Blob([normalized[0].content], { type: 'text/plain' });
    return {
      ok: true,
      fileCount: 1,
      format: 'txt',
      blob,
      filename: normalized[0].name,
    };
  }

  return {
    ok: true,
    fileCount: normalized.length,
    format: 'zip',
    blob: buildZipBlob(normalized),
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
