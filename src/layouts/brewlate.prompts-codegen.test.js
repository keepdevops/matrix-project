/**
 * Prompt submit + code generation wiring (Brewlatte vs classic).
 */
const fs = require('fs');
const path = require('path');
const { extractCodeBlock } = require('../utils/codeExtractor');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('Prompts and code generation', () => {
  const brew = read('layouts/BrewlateLayout.js');
  const classic = read('layouts/DefaultLayout.js');
  const prompt = read('components/PromptInput.js');
  const stream = read('api/streamApi.js');
  const submitHandlers = read('hooks/useSubmitHandlers.js');

  it('both layouts wire PromptInput → onSubmit with temperature', () => {
    expect(brew).toMatch(/<PromptInput/);
    expect(brew).toMatch(/onSubmit=\{onSubmit\}/);
    expect(classic).toMatch(/<PromptInput/);
    expect(classic).toMatch(/onSubmit=\{onSubmit\}/);
    expect(prompt).toMatch(/onSubmit\(prompt\.trim\(\), temperature/);
    expect(prompt).toMatch(/placeholder=.*prompt/i);
  });

  it('Brewlatte uses BREW labels; classic uses BROADCAST', () => {
    expect(brew).toMatch(/submitLabel="BREW"/);
    expect(classic).not.toMatch(/submitLabel="BREW"/);
    expect(classic).toMatch(/<PromptInput/);
  });

  it('streaming path targets /api/architect/stream', () => {
    expect(stream).toMatch(/architect\/stream/);
    expect(stream).toMatch(/onToken/);
    expect(stream).toMatch(/eventName === 'token'/);
    expect(stream).toMatch(/eventName === 'metrics'/);
  });

  it('handleSaveCode aggregates fenced code from agents', () => {
    expect(submitHandlers).toMatch(/buildCodeExport/);
    expect(submitHandlers).toMatch(/handleSaveCode/);
    expect(brew).toMatch(/onSaveCode=\{onSaveCode\}/);
    expect(brew).toMatch(/BrewCodeResultsPanel/);
    expect(classic).toMatch(/onSaveCode=\{onSaveCode\}/);
  });

  it('programmer-style model output parses to python for CodeMirror', () => {
    const sample = [
      'Implement fibonacci:\n',
      '```python\n',
      'def fib(n):\n',
      '    a, b = 0, 1\n',
      '    for _ in range(n):\n',
      '        a, b = b, a + b\n',
      '    return a\n',
      '```\n',
    ].join('');
    const { code, language } = extractCodeBlock(sample);
    expect(language).toBe('python');
    expect(code).toContain('def fib');
    expect(code.length).toBeGreaterThanOrEqual(10);
  });

  it('quality pass and follow-up hooks exist for iterative codegen', () => {
    expect(brew).toMatch(/onQualityPass=\{onQualityPass\}/);
    expect(brew).toMatch(/onFollowUp=\{onFollowUp\}/);
    expect(submitHandlers).toMatch(/handleQualityPass/);
    expect(submitHandlers).toMatch(/qualityPass:\s*true/);
  });
});
