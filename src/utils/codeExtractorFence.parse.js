import {
  MIN_CODE_CHARS,
  normalizeLanguage,
  detectLanguage,
  isLikelyCode,
} from './codeExtractorDetect';

const FENCE_RE = /```([^\n]*)\n([\s\S]*?)```/g;

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
      id: `block-${blocks.length}`, language, filename, content,
      score: calculateBlockScore(content, language, requestedLanguage),
    });
  }
  if (blocks.length === 0 && isLikelyCode(input)) {
    blocks.push({
      id: 'fallback', language: normalizeLanguage(detectLanguage(input)),
      filename: null, content: input.trim(), score: 0.5,
    });
  }
  return blocks.sort((a, b) => b.score - a.score);
}

export function hasExtractableCode(input) {
  if (!input) return false;
  return extractAllCodeBlocks(input).some((b) => b.content.trim().length >= MIN_CODE_CHARS);
}

export { FENCE_RE };
