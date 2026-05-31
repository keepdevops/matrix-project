/**
 * codeExtractor tests.
 *
 * Covers:
 * - normalizeLanguage: known aliases, unknown passthrough, null/undefined
 * - detectLanguage: JSON, HTML, Python, Java, CSS, SQL, PHP, plain text, invalid JSON fallback
 * - extractCodeBlock: Markdown fences, tool-call JSON, plain text fallback, null input
 * - parseMarkdownCodeBlock: alias normalization applied
 */
import {
  normalizeLanguage,
  detectLanguage,
  extractCodeBlock,
  extractAllCodeBlocks,
  extractPartialFence,
  parseFenceInfo,
  extractFilenameFromComments,
  formatFencesOnlyMarkdown,
  hasExtractableCode,
  MIN_CODE_CHARS,
  parseMarkdownCodeBlock,
} from './codeExtractor';

// ---------------------------------------------------------------------------
// normalizeLanguage
// ---------------------------------------------------------------------------

test.each([
  ['ts',         'javascript'],
  ['typescript', 'javascript'],
  ['js',         'javascript'],
  ['node',       'javascript'],
  ['py',         'python'],
  ['python3',    'python'],
  ['sh',         'bash'],
  ['zsh',        'bash'],
  ['c++',        'cpp'],
  ['cc',         'cpp'],
  ['hpp',        'cpp'],
  ['yml',        'yaml'],
  ['rb',         'ruby'],
  ['rs',         'rust'],
  ['md',         'markdown'],
  ['golang',     'go'],
])('normalizeLanguage: %s → %s', (input, expected) => {
  expect(normalizeLanguage(input)).toBe(expected);
});

test('normalizeLanguage: already-canonical key passes through', () => {
  expect(normalizeLanguage('python')).toBe('python');
  expect(normalizeLanguage('javascript')).toBe('javascript');
  expect(normalizeLanguage('go')).toBe('go');
});

test('normalizeLanguage: unknown string passes through lowercased', () => {
  expect(normalizeLanguage('COBOL')).toBe('cobol');
  expect(normalizeLanguage('elixir')).toBe('elixir');
});

test('normalizeLanguage: null → text', () => {
  expect(normalizeLanguage(null)).toBe('text');
});

test('normalizeLanguage: undefined → text', () => {
  expect(normalizeLanguage(undefined)).toBe('text');
});

test('normalizeLanguage: empty string → text', () => {
  expect(normalizeLanguage('')).toBe('text');
});

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------

test('detectLanguage: null → text', () => {
  expect(detectLanguage(null)).toBe('text');
});

test('detectLanguage: empty string → text', () => {
  expect(detectLanguage('')).toBe('text');
});

test('detectLanguage: valid JSON object → json', () => {
  expect(detectLanguage('{"key": "value"}')).toBe('json');
});

test('detectLanguage: valid JSON array → json', () => {
  expect(detectLanguage('[1, 2, 3]')).toBe('json');
});

test('detectLanguage: invalid JSON starting with { → falls through to text', () => {
  expect(detectLanguage('{not valid json')).toBe('text');
});

test('detectLanguage: HTML tag → html', () => {
  expect(detectLanguage('<div>hello</div>')).toBe('html');
  expect(detectLanguage('<html><head></head></html>')).toBe('html');
  expect(detectLanguage('<script>alert(1)</script>')).toBe('html');
});

test('detectLanguage: Python def → python', () => {
  expect(detectLanguage('def foo(x):\n  return x')).toBe('python');
});

test('detectLanguage: Python import → python', () => {
  expect(detectLanguage('import os\nprint(os.getcwd())')).toBe('python');
});

test('detectLanguage: Python __name__ guard → python', () => {
  expect(detectLanguage('if __name__ == "__main__":\n  main()')).toBe('python');
});

test('detectLanguage: Java public class → java', () => {
  expect(detectLanguage('public class Foo { }')).toBe('java');
});

test('detectLanguage: Java import java. pattern → java', () => {
  // Must not start with "import " (which matches Python regex first)
  expect(detectLanguage('public class X {\n  import java.util.List;\n}')).toBe('java');
});

test('detectLanguage: CSS selector + property → css', () => {
  expect(detectLanguage('.foo { color: red; }')).toBe('css');
});

test('detectLanguage: SQL SELECT → sql', () => {
  expect(detectLanguage('SELECT id FROM users WHERE active = 1')).toBe('sql');
});

test('detectLanguage: SQL INSERT → sql', () => {
  expect(detectLanguage('INSERT INTO users (name) VALUES ("Alice")')).toBe('sql');
});

test('detectLanguage: PHP opening tag → php', () => {
  expect(detectLanguage('<?php echo "hello"; ?>')).toBe('php');
});

test('detectLanguage: plain prose → text', () => {
  expect(detectLanguage('Hello world, this is just a sentence.')).toBe('text');
});

// ---------------------------------------------------------------------------
// extractCodeBlock
// ---------------------------------------------------------------------------

test('extractCodeBlock: null → { code: "", language: "text" }', () => {
  expect(extractCodeBlock(null)).toEqual({ code: '', language: 'text' });
});

test('extractCodeBlock: empty string → { code: "", language: "text" }', () => {
  expect(extractCodeBlock('')).toEqual({ code: '', language: 'text' });
});

test('extractCodeBlock: Markdown fence with language', () => {
  const input = '```python\nprint("hi")\n```';
  expect(extractCodeBlock(input)).toEqual({ language: 'python', code: 'print("hi")' });
});

test('extractCodeBlock: Markdown fence with alias normalizes language', () => {
  const input = '```ts\nconst x = 1;\n```';
  expect(extractCodeBlock(input)).toEqual({ language: 'javascript', code: 'const x = 1;' });
});

test('extractCodeBlock: Markdown fence without language → text', () => {
  const input = '```\nten chars!\n```';
  expect(extractCodeBlock(input)).toEqual({ language: 'text', code: 'ten chars!' });
});

test('extractCodeBlock: tool-call JSON with parameters.content', () => {
  const input = JSON.stringify({
    name: 'create_file',
    parameters: { content: 'fn main() {}', language: 'rust' },
  });
  expect(extractCodeBlock(input)).toEqual({ language: 'rust', code: 'fn main() {}' });
});

test('extractCodeBlock: tool-call JSON without parameters.content falls through', () => {
  const input = JSON.stringify({ name: 'noop', parameters: {} });
  const result = extractCodeBlock(input);
  expect(result.code).toBeDefined();
  // falls through to detectLanguage — valid JSON → 'json'
  expect(result.language).toBe('json');
});

test('extractCodeBlock: invalid JSON starting with { → empty code', () => {
  const input = '{not valid';
  const result = extractCodeBlock(input);
  expect(result).toEqual({ language: 'text', code: '' });
});

test('extractCodeBlock: plain Python code uses detectLanguage', () => {
  const input = 'def greet():\n  return "hello"';
  expect(extractCodeBlock(input)).toEqual({ language: 'python', code: input.trim() });
});

test('extractCodeBlock: plain prose without fences → empty code', () => {
  const input = 'just some prose here';
  expect(extractCodeBlock(input)).toEqual({ language: 'text', code: '' });
});

// ---------------------------------------------------------------------------
// parseMarkdownCodeBlock
// ---------------------------------------------------------------------------

test('parseMarkdownCodeBlock: normalizes alias and trims content', () => {
  expect(parseMarkdownCodeBlock('ts', '  const x = 1;  ')).toEqual({
    language: 'javascript',
    code: 'const x = 1;',
  });
});

test('parseMarkdownCodeBlock: unknown lang passes through lowercased', () => {
  expect(parseMarkdownCodeBlock('elixir', 'IO.puts "hi"')).toEqual({
    language: 'elixir',
    code: 'IO.puts "hi"',
  });
});

test('parseMarkdownCodeBlock: null lang → text', () => {
  expect(parseMarkdownCodeBlock(null, 'code')).toEqual({
    language: 'text',
    code: 'code',
  });
});

// ---------------------------------------------------------------------------
// MS-24: extractAllCodeBlocks, extractPartialFence
// ---------------------------------------------------------------------------

test('parseFenceInfo: language and filename=', () => {
  expect(parseFenceInfo('python filename=src/a.py')).toEqual({
    lang: 'python',
    filename: 'src/a.py',
  });
});

test('extractFilenameFromComments: // and # forms', () => {
  expect(extractFilenameFromComments('// filename=lib/foo.py\nx=1')).toBe('lib/foo.py');
  expect(extractFilenameFromComments('# filename: main.rs\nfn main() {}')).toBe('main.rs');
});

test('extractAllCodeBlocks: multiple fences sorted by score with requestedLanguage', () => {
  const input = [
    'Intro',
    '```text\nshort\n```',
    '```python\ndef run():\n  return 42\n```',
  ].join('\n');
  const blocks = extractAllCodeBlocks(input, 'python');
  expect(blocks.length).toBeGreaterThanOrEqual(1);
  expect(blocks[0].language).toBe('python');
  expect(blocks[0].content).toContain('def run');
});

test('extractAllCodeBlocks: skips blocks under MIN_CODE_CHARS', () => {
  const tiny = 'x'.repeat(MIN_CODE_CHARS - 1);
  const input = '```py\n' + tiny + '\n```';
  expect(extractAllCodeBlocks(input)).toHaveLength(0);
});

test('extractAllCodeBlocks: filename on fence info line', () => {
  const input = '```python filename=app/main.py\nprint("ok")\n```';
  const blocks = extractAllCodeBlocks(input);
  expect(blocks[0].filename).toBe('app/main.py');
});

test('extractPartialFence: open trailing fence', () => {
  const input = 'Explain:\n```python\nprint("partial';
  const partial = extractPartialFence(input);
  expect(partial).not.toBeNull();
  expect(partial.language).toBe('python');
  expect(partial.content).toContain('print');
});

test('extractPartialFence: closed fences returns null', () => {
  const input = '```py\nx=1\n```';
  expect(extractPartialFence(input)).toBeNull();
});

test('formatFencesOnlyMarkdown: strips prose', () => {
  const raw = 'Note:\n```js\nconst a=1;\n```\nDone.';
  expect(formatFencesOnlyMarkdown(raw)).not.toContain('Note:');
  expect(formatFencesOnlyMarkdown(raw)).toContain('const a=1');
});

test('hasExtractableCode: true when fence meets MIN_CODE_CHARS', () => {
  expect(hasExtractableCode('```python\nprint("hi")\n```')).toBe(true);
  expect(hasExtractableCode('no code')).toBe(false);
});
