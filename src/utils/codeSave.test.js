import { buildCodeExport, buildZipBlob, collectCodeFiles } from './codeSave';

describe('codeSave', () => {
  const agents = [{ name: 'programmer' }, { name: 'frontend' }];
  const py = '```python\ndef a():\n  return 1\n```';
  const js = '```javascript\nfunction b() { return 2; }\n```';

  it('collectCodeFiles gathers blocks from multiple agents', () => {
    const files = collectCodeFiles(agents, { programmer: py, frontend: js });
    expect(files).toHaveLength(2);
    expect(files[0].agent).toBe('programmer');
  });

  it('buildCodeExport returns single txt for one block', () => {
    const result = buildCodeExport([{ name: 'programmer' }], { programmer: py });
    expect(result.ok).toBe(true);
    expect(result.format).toBe('txt');
    expect(result.fileCount).toBe(1);
  });

  it('buildCodeExport returns zip for multiple blocks', () => {
    const result = buildCodeExport(agents, { programmer: py, frontend: js });
    expect(result.ok).toBe(true);
    expect(result.format).toBe('zip');
    expect(result.fileCount).toBe(2);
    expect(result.blob.type).toBe('application/zip');
  });

  it('buildZipBlob returns non-empty zip blob', () => {
    const blob = buildZipBlob([{ name: 'a.py', content: 'print(1)\n' }]);
    expect(blob.type).toBe('application/zip');
    expect(blob.size).toBeGreaterThan(30);
  });

  it('buildCodeExport fails when no code', () => {
    const result = buildCodeExport(agents, { programmer: 'no fences here' });
    expect(result.ok).toBe(false);
  });
});
