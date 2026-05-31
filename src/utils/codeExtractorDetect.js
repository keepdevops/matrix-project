/** Minimum extracted code length for SAVE CODE and CODE badges (MS-24). */
export const MIN_CODE_CHARS = 10;

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

export const normalizeLanguage = (lang) => {
  const lower = lang?.toLowerCase().trim() || 'text';
  return LANGUAGE_ALIASES[lower] || lower;
};

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

export function isLikelyCode(text) {
  if (!text || !text.trim()) return false;
  return detectLanguage(text) !== 'text';
}
