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
  const input = '```\nsome code\n```';
  expect(extractCodeBlock(input)).toEqual({ language: 'text', code: 'some code' });
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

test('extractCodeBlock: invalid JSON starting with { falls through to detect', () => {
  const input = '{not valid';
  const result = extractCodeBlock(input);
  expect(result.language).toBe('text');
  expect(result.code).toBe(input.trim());
});

test('extractCodeBlock: plain Python code uses detectLanguage', () => {
  const input = 'def greet():\n  return "hello"';
  expect(extractCodeBlock(input)).toEqual({ language: 'python', code: input.trim() });
});

test('extractCodeBlock: plain text falls back to text', () => {
  const input = 'just some prose here';
  expect(extractCodeBlock(input)).toEqual({ language: 'text', code: input.trim() });
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
