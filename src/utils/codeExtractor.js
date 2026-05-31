/**
 * Normalizes language names and aliases for CodeMirror compatibility.
 */
export const LANGUAGE_ALIASES = {
  'c++': 'cpp', 'cc': 'cpp', 'h': 'cpp', 'hpp': 'cpp', 'ino': 'cpp',
  'py': 'python', 'python3': 'python',
  'js': 'javascript', 'node': 'javascript',
  'ts': 'javascript',
  'typescript': 'javascript',
  'cs': 'csharp',
  'golang': 'go',
  'rs': 'rust',
  'md': 'markdown',
  'yml': 'yaml',
  'rb': 'ruby',
  'sh': 'bash', 'shell': 'bash', 'zsh': 'bash',
};

/** Minimum extracted code length for SAVE CODE and CODE badges (MS-24). */
export const MIN_CODE_CHARS = 10;

const FENCE_RE = /```([^\n]*)\n([\s\S]*?)```/g;

const HISTORY_CODE_AGENTS = new Set(['programmer', 'frontend']);

/**
 * Agents whose coordinator history is normalized to fenced code only (B).
 */
export const CODE_HISTORY_AGENTS = HISTORY_CODE_AGENTS;

/**
 * Maps a raw string to a supported CodeMirror language key.
 */
export const normalizeLanguage = (lang) => {
  const lower = lang?.toLowerCase().trim() || 'text';
  return LANGUAGE_ALIASES[lower] || lower;
};

/**
 * Parse ```info line: "python filename=src/foo.py"
 */
export function parseFenceInfo(info) {
  const trimmed = (info || '').trim();
  if (!trimmed) return { lang: '', filename: null };
  let lang = '';
  let filename = null;
  for (const part of trimmed.split(/\s+/)) {
    if (part.startsWith('filename=')) filename = part.slice(9).trim();
    else if (!lang) lang = part;
  }
  return { lang, filename };
}

/**
 * // filename=path or # filename=path inside block body
 */
export function extractFilenameFromComments(code) {
  if (!code) return null;
  const m = code.match(/^\s*(?:\/\/|#)\s*filename[=:]\s*(\S+)/m);
  return m ? m[1] : null;
}

function calculateBlockScore(content, language, requestedLanguage) {
  let score = Math.min(content.length / 1000, 3);
  if (requestedLanguage && language === normalizeLanguage(requestedLanguage)) score += 2;
  if (content.includes('filename=')) score += 0.5;
  return Math.min(score, 5);
}

function isLikelyCode(text) {
  if (!text || !text.trim()) return false;
  const lang = detectLanguage(text);
  return lang !== 'text';
}

/**
 * All complete markdown fences in document order (best-first via score sort).
 */
export function extractAllCodeBlocks(input, requestedLanguage = null) {
  if (!input) return [];

  const blocks = [];
  FENCE_RE.lastIndex = 0;
  let match;
  while ((match = FENCE_RE.exec(input)) !== null) {
    const { lang, filename: infoFilename } = parseFenceInfo(match[1]);
    const content = match[2].trim();
    if (content.length < MIN_CODE_CHARS) continue;
    const language = normalizeLanguage(lang || 'text');
    const filename = infoFilename || extractFilenameFromComments(content);
    blocks.push({
      id: `block-${blocks.length}`,
      language,
      filename,
      content,
      score: calculateBlockScore(content, language, requestedLanguage),
    });
  }

  if (blocks.length === 0 && isLikelyCode(input)) {
    blocks.push({
      id: 'fallback',
      language: normalizeLanguage(detectLanguage(input)),
      filename: null,
      content: input.trim(),
      score: 0.5,
    });
  }

  return blocks.sort((a, b) => b.score - a.score);
}

/**
 * Open trailing fence while streaming (odd ``` count).
 */
export function extractPartialFence(text) {
  if (!text) return null;

  const indices = [];
  let pos = 0;
  while (pos < text.length) {
    const i = text.indexOf('```', pos);
    if (i === -1) break;
    indices.push(i);
    pos = i + 3;
  }
  if (indices.length === 0 || indices.length % 2 === 0) return null;

  const start = indices[indices.length - 1];
  const after = text.slice(start + 3);
  const nl = after.indexOf('\n');
  const info = nl === -1 ? after.trim() : after.slice(0, nl).trim();
  const content = nl === -1 ? '' : after.slice(nl + 1);
  const { lang, filename } = parseFenceInfo(info);

  return {
    language: normalizeLanguage(lang || 'text'),
    filename,
    content,
  };
}

/**
 * Heuristic-based language detection for code blocks without fences.
 */
export const detectLanguage = (text) => {
  if (!text) return 'text';

  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch (e) {
      // fall through
    }
  }

  if (/<(html|div|body|head|script|xml|svg)/i.test(trimmed)) return 'html';
  if (/^import\s+[\w.]+|def\s+\w+\(.*\):|if\s+__name__\s*==/.test(trimmed)) return 'python';
  if (/(public\s+class|import\s+java|namespace\s+[\w.]+)/.test(trimmed)) return 'java';
  if (/[a-z-]+\s*:\s*[^;]+;/.test(trimmed) && /[.#][a-z0-9-_]+\s*\{/i.test(trimmed)) return 'css';
  if (/SELECT\s+.*\s+FROM|INSERT\s+INTO|UPDATE\s+.*\s+SET/i.test(trimmed)) return 'sql';
  if (/<\?php|namespace\s+[^;]+;|use\s+[^;]+;/.test(trimmed)) return 'php';

  return 'text';
};

/**
 * Best single block (backward compatible with pre–MS-24 callers).
 */
export const extractCodeBlock = (input) => {
  if (!input) return { code: '', language: 'text' };

  const trimmed = input.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.parameters?.content) {
        return {
          language: normalizeLanguage(parsed.parameters.language || 'text'),
          code: parsed.parameters.content.trim(),
        };
      }
    } catch (e) {
      // fall through
    }
  }

  const blocks = extractAllCodeBlocks(input);
  if (blocks.length > 0) {
    const best = blocks[0];
    return { language: best.language, code: best.content };
  }

  if (input.includes('```')) {
    return { code: '', language: 'text' };
  }

  if (isLikelyCode(input)) {
    return {
      language: detectLanguage(input),
      code: input.trim(),
    };
  }

  return { code: '', language: 'text' };
};

/**
 * Strip prose outside fences; re-wrap all complete fences (for parity with C++ history norm).
 */
export function formatFencesOnlyMarkdown(raw) {
  const blocks = [];
  FENCE_RE.lastIndex = 0;
  let match;
  while ((match = FENCE_RE.exec(raw)) !== null) {
    const { lang } = parseFenceInfo(match[1]);
    const content = match[2].trim();
    if (content.length < MIN_CODE_CHARS) continue;
    const tag = lang ? normalizeLanguage(lang) : 'text';
    blocks.push('```' + tag + '\n' + content + '\n```');
  }
  if (blocks.length === 0) return raw;
  return blocks.join('\n\n');
}

export const parseMarkdownCodeBlock = (langString, content) => {
  return {
    language: normalizeLanguage(langString),
    code: content.trim(),
  };
};
