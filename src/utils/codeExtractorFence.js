import { normalizeLanguage, detectLanguage, isLikelyCode } from './codeExtractorDetect';
import { FENCE_RE, parseFenceInfo, extractAllCodeBlocks } from './codeExtractorFence.parse';
// Direct re-exports — webpack HMR loses import-then-re-export patterns
export { parseFenceInfo, extractFilenameFromComments, extractAllCodeBlocks, hasExtractableCode } from './codeExtractorFence.parse';

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
  const nl    = after.indexOf('\n');
  const info  = nl === -1 ? after.trim() : after.slice(0, nl).trim();
  const content = nl === -1 ? '' : after.slice(nl + 1);
  const { lang, filename } = parseFenceInfo(info);
  return { language: normalizeLanguage(lang || 'text'), filename, content };
}

export function formatFencesOnlyMarkdown(raw) {
  const blocks = [];
  FENCE_RE.lastIndex = 0;
  let match;
  while ((match = FENCE_RE.exec(raw)) !== null) {
    const { lang } = parseFenceInfo(match[1]);
    const content = match[2].trim();
    if (content.length < 10) continue;
    const tag = lang ? normalizeLanguage(lang) : 'text';
    blocks.push('```' + tag + '\n' + content + '\n```');
  }
  if (blocks.length === 0) return raw;
  return blocks.join('\n\n');
}

export const parseMarkdownCodeBlock = (langString, content) => ({
  language: normalizeLanguage(langString),
  code: content.trim(),
});

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
  if (blocks.length > 0) return { language: blocks[0].language, code: blocks[0].content };
  if (input.includes('```')) return { code: '', language: 'text' };
  if (isLikelyCode(input)) return { language: detectLanguage(input), code: input.trim() };
  return { code: '', language: 'text' };
};
