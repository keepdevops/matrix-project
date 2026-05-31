export {
  MIN_CODE_CHARS,
  LANGUAGE_ALIASES,
  normalizeLanguage,
  detectLanguage,
} from './codeExtractorDetect';

export {
  parseFenceInfo,
  extractFilenameFromComments,
  extractAllCodeBlocks,
  hasExtractableCode,
  extractPartialFence,
  formatFencesOnlyMarkdown,
  parseMarkdownCodeBlock,
  extractCodeBlock,
} from './codeExtractorFence';

const HISTORY_CODE_AGENTS = new Set(['programmer', 'frontend']);

/** Agents whose coordinator history is normalized to fenced code only (B). */
export const CODE_HISTORY_AGENTS = HISTORY_CODE_AGENTS;
