/**
 * Normalizes language names and aliases for CodeMirror compatibility.
 */
export const LANGUAGE_ALIASES = {
  'c++': 'cpp', 'cc': 'cpp', 'h': 'cpp', 'hpp': 'cpp', 'ino': 'cpp',
  'py': 'python', 'python3': 'python',
  'js': 'javascript', 'node': 'javascript',
  'ts': 'javascript', 'typescript': 'javascript',
  'golang': 'go',
  'rs': 'rust',
  'md': 'markdown',
  'yml': 'yaml',
  'rb': 'ruby',
  'sh': 'bash',
  'zsh': 'bash'
};

/**
 * Maps a raw string to a supported CodeMirror language key.
 */
export const normalizeLanguage = (lang) => {
  const lower = lang?.toLowerCase().trim() || 'text';
  return LANGUAGE_ALIASES[lower] || lower;
};

/**
 * Heuristic-based language detection for code blocks without fences.
 */
export const detectLanguage = (text) => {
  if (!text) return 'text';

  // 1. JSON Detection (Strict check for objects or arrays)
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch (e) {
      // Not valid JSON, continue to other checks
    }
  }

  // 2. HTML/XML Detection
  if (/<(html|div|body|head|script|xml|svg)/i.test(trimmed)) return 'html';

  // 3. Python Detection (Keywords and structure)
  if (/^import\s+[\w.]+|def\s+\w+\(.*\):|if\s+__name__\s*==/.test(trimmed)) return 'python';

  // 4. Java/C# Detection
  if (/(public\s+class|import\s+java|namespace\s+[\w.]+)/.test(trimmed)) return 'java';

  // 5. CSS Detection
  if (/[a-z-]+\s*:\s*[^;]+;/.test(trimmed) && /[.#][a-z0-9-_]+\s*\{/i.test(trimmed)) return 'css';
  // 6. SQL Detection
  if (/SELECT\s+.*\s+FROM|INSERT\s+INTO|UPDATE\s+.*\s+SET/i.test(trimmed)) return 'sql';

  // 7. PHP Detection
  if (/<\?php|namespace\s+[^;]+;|use\s+[^;]+;/.test(trimmed)) return 'php';

  // Default to text (plain) to avoid incorrect syntax highlighting
  return 'text';
};

/**
 * Extracts code and language from a string (Markdown or raw).
 */
export const extractCodeBlock = (input) => {
  if (!input) return { code: '', language: 'text' };

  // Handle Markdown code fences: ```javascript ... ```
  const match = input.match(/```(\w+)?\s*([\s\S]*?)\s*```/);

  if (match) {
    return {
      language: normalizeLanguage(match[1] || 'text'),
      code: match[2].trim()
    };
  }

  // Handle tool-call JSON: {"name": "create_file", "parameters": {"content": "...", "language": "..."}}
  const trimmed = input.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.parameters?.content) {
        return {
          language: normalizeLanguage(parsed.parameters.language || 'text'),
          code: parsed.parameters.content.trim()
        };
      }
    } catch (e) {
      // Not valid JSON, fall through
    }
  }

  // Fallback: If no fences, detect the language based on content
  return {
    language: detectLanguage(input),
    code: input.trim()
  };
};

/**
 * Specific parser for Markdown blocks to ensure normalization is applied.
 */
export const parseMarkdownCodeBlock = (langString, content) => {
  return {
    language: normalizeLanguage(langString),
    code: content.trim()
  };
};
