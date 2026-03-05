import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';

// Language Pack Imports
import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { sql } from '@codemirror/lang-sql';
import { php } from '@codemirror/lang-php';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';

/**
 * langMap moved to module scope to avoid re-creation on every render.
 * Maps normalized language keys to their CodeMirror extension functions.
 */
const langMap = {
  cpp, 'c++': cpp,
  python, py: python,
  javascript, js: javascript,
  rust, rs: rust,
  go,
  java,
  json,
  html,
  css,
  sql,
  php,
  markdown, md: markdown,
  xml
};

const SwarmEditor = ({ 
  code = '', 
  language = 'text', 
  editable = false, 
  onChange, 
  height = '400px' 
}) => {

  // Memoize extensions so the editor doesn't flicker/reset unless language changes
  const extensions = useMemo(() => {
    const langFunc = langMap[language.toLowerCase()];
    // If language is found, execute it; otherwise return empty array (plain text)
    return langFunc ? [langFunc()] : [];
  }, [language]);

  return (
    <div className="matrix-editor-wrapper" style={{ border: '1px solid #333', borderRadius: '4px' }}>
      <CodeMirror
        value={code}
        height={height}
        theme={vscodeDark}
        extensions={extensions}
        readOnly={!editable}
        // Only attach onChange if we are in editable mode
        onChange={editable ? onChange : undefined}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: editable, // Only highlight line when user is editing
          syntaxHighlighting: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: editable
        }}
        style={{ fontSize: '14px', textAlign: 'left' }}
      />
    </div>
  );
};

export default SwarmEditor;
