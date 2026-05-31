import { useMemo } from 'react';
import {
  extractCodeBlock,
  extractAllCodeBlocks,
  extractPartialFence,
  MIN_CODE_CHARS,
} from '../utils/codeExtractor';

/**
 * Live vs final code extraction for CODE OUTPUT while a stream is in flight.
 */
export function useLiveCodeExtraction(sourceText, loading) {
  return useMemo(() => {
    const text = sourceText || '';

    if (loading && text) {
      const partial = extractPartialFence(text);
      if (partial?.content) {
        return {
          code: partial.content,
          language: partial.language || 'text',
          isStreaming: true,
          isPartial: true,
          hasCode: partial.content.trim().length > 0,
          hasCompleteCode: false,
        };
      }
      const blocks = extractAllCodeBlocks(text);
      if (blocks.length > 0) {
        const best = blocks[0];
        return {
          code: best.content,
          language: best.language,
          isStreaming: true,
          isPartial: false,
          hasCode: best.content.trim().length > 0,
          hasCompleteCode: best.content.trim().length >= MIN_CODE_CHARS,
        };
      }
      return {
        code: '',
        language: 'text',
        isStreaming: true,
        isPartial: false,
        hasCode: false,
        hasCompleteCode: false,
      };
    }

    if (!text) {
      return {
        code: '',
        language: 'text',
        isStreaming: Boolean(loading),
        isPartial: false,
        hasCode: false,
        hasCompleteCode: false,
      };
    }

    const { code, language } = extractCodeBlock(text);
    const hasCompleteCode = Boolean(code && code.trim().length >= MIN_CODE_CHARS);
    return {
      code: hasCompleteCode ? code : '',
      language: language || 'text',
      isStreaming: false,
      isPartial: false,
      hasCode: hasCompleteCode,
      hasCompleteCode,
    };
  }, [sourceText, loading]);
}
