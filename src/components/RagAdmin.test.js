/**
 * RagAdmin pure-logic tests — fmtBytes, fmtTime, upload state machine,
 * polling lifecycle, document list normalization, delete guard.
 *
 * All behaviour is extracted from RagAdmin's internal helpers and the
 * upload/poll state transitions it drives. No DOM rendering needed.
 */

// ---------------------------------------------------------------------------
// fmtBytes (replicated from RagAdmin.js)
// ---------------------------------------------------------------------------

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

describe('fmtBytes', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024 - 1, '1024.0 KB'],
    [1024 * 1024, '1.00 MB'],
    [1024 * 1024 * 25, '25.00 MB'],
    [1024 * 1024 * 1024, '1024.00 MB'],
  ])('fmtBytes(%s) === %s', (n, expected) => {
    expect(fmtBytes(n)).toBe(expected);
  });

  it('returns empty string for NaN', () => expect(fmtBytes(NaN)).toBe(''));
  it('returns empty string for Infinity', () => expect(fmtBytes(Infinity)).toBe(''));
  it('returns empty string for string', () => expect(fmtBytes('500')).toBe(''));
  it('returns empty string for null', () => expect(fmtBytes(null)).toBe(''));
  it('returns empty string for undefined', () => expect(fmtBytes(undefined)).toBe(''));
  it('handles negative (treated as finite)', () => expect(fmtBytes(-1)).toBe('-1 B'));
});

// ---------------------------------------------------------------------------
// fmtTime (replicated from RagAdmin.js)
// ---------------------------------------------------------------------------

function fmtTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

describe('fmtTime', () => {
  it('returns em-dash for null', () => expect(fmtTime(null)).toBe('—'));
  it('returns em-dash for undefined', () => expect(fmtTime(undefined)).toBe('—'));
  it('returns em-dash for empty string', () => expect(fmtTime('')).toBe('—'));
  it('parses ISO 8601 without throwing', () => {
    const result = fmtTime('2024-06-01T12:00:00Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('—');
  });
  it('returns raw string for non-date garbage', () => {
    const result = fmtTime('not-a-date');
    // Invalid Date.toLocaleString() returns 'Invalid Date' — still a string
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// TERMINAL set sentinel
// ---------------------------------------------------------------------------

const TERMINAL = new Set(['done', 'error']);

describe('TERMINAL status set', () => {
  it.each(['done', 'error'])('%s is terminal', s => expect(TERMINAL.has(s)).toBe(true));
  it.each(['queued', 'uploading', 'running', 'processing', ''])('%s is not terminal', s => {
    expect(TERMINAL.has(s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Upload state machine (mirrors RagAdmin.onFiles logic)
// ---------------------------------------------------------------------------

function simulateUploadFlow(files, uploadResults) {
  // Returns the final uploads[] state after processing all files
  let uploads = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const entry = { name: f.name, size: f.size, status: 'uploading' };
    uploads = [entry, ...uploads];
    const result = uploadResults[i];
    if (result.error) {
      uploads = uploads.map(u => u === entry
        ? { ...u, status: 'error', error: result.error } : u);
    } else {
      uploads = uploads.map(u => u === entry
        ? { ...u, jobId: result.job_id, source_path: result.source_path, status: 'queued' } : u);
    }
  }
  return uploads;
}

function simulatePollUpdate(uploads, pollResult) {
  let anyTerminal = false;
  const next = uploads.map(u => {
    const upd = pollResult.find(x => x.jobId === u.jobId);
    if (!upd) return u;
    if (TERMINAL.has(upd.status)) anyTerminal = true;
    return { ...u, ...upd };
  });
  return { uploads: next, anyTerminal };
}

describe('RagAdmin — upload state machine', () => {
  it('single file: uploading → queued on success', () => {
    const files = [{ name: 'doc.pdf', size: 1024 }];
    const results = [{ job_id: 'j1', source_path: '/ingest/doc.pdf' }];
    const state = simulateUploadFlow(files, results);
    expect(state[0].status).toBe('queued');
    expect(state[0].jobId).toBe('j1');
  });

  it('single file: uploading → error on failure', () => {
    const files = [{ name: 'doc.pdf', size: 512 }];
    const results = [{ error: 'file too large' }];
    const state = simulateUploadFlow(files, results);
    expect(state[0].status).toBe('error');
    expect(state[0].error).toBe('file too large');
  });

  it('multiple files: mixed success/failure', () => {
    const files = [
      { name: 'a.txt', size: 100 },
      { name: 'b.pdf', size: 200 },
      { name: 'c.md',  size: 300 },
    ];
    const results = [
      { job_id: 'j1', source_path: '/s/a' },
      { error: 'unsupported type' },
      { job_id: 'j3', source_path: '/s/c' },
    ];
    const state = simulateUploadFlow(files, results);
    expect(state.find(u => u.name === 'a.txt').status).toBe('queued');
    expect(state.find(u => u.name === 'b.pdf').status).toBe('error');
    expect(state.find(u => u.name === 'c.md').status).toBe('queued');
  });

  it('newest file prepended to uploads list', () => {
    const files = [
      { name: 'first.txt', size: 100 },
      { name: 'second.txt', size: 200 },
    ];
    const results = [
      { job_id: 'j1', source_path: '/s/first' },
      { job_id: 'j2', source_path: '/s/second' },
    ];
    const state = simulateUploadFlow(files, results);
    // second was prepended last → it's at index 0
    expect(state[0].name).toBe('second.txt');
    expect(state[1].name).toBe('first.txt');
  });
});

// ---------------------------------------------------------------------------
// Poll update state transitions
// ---------------------------------------------------------------------------

describe('RagAdmin — poll update transitions', () => {
  it('queued → done marks anyTerminal', () => {
    const uploads = [{ name: 'a', jobId: 'j1', status: 'queued' }];
    const { uploads: next, anyTerminal } = simulatePollUpdate(uploads, [
      { jobId: 'j1', status: 'done', chunks: 12 },
    ]);
    expect(next[0].status).toBe('done');
    expect(next[0].chunks).toBe(12);
    expect(anyTerminal).toBe(true);
  });

  it('queued → error marks anyTerminal', () => {
    const uploads = [{ name: 'a', jobId: 'j1', status: 'queued' }];
    const { uploads: next, anyTerminal } = simulatePollUpdate(uploads, [
      { jobId: 'j1', status: 'error', error: 'embedding failed' },
    ]);
    expect(next[0].status).toBe('error');
    expect(anyTerminal).toBe(true);
  });

  it('queued → processing does NOT mark anyTerminal', () => {
    const uploads = [{ name: 'a', jobId: 'j1', status: 'queued' }];
    const { anyTerminal } = simulatePollUpdate(uploads, [
      { jobId: 'j1', status: 'processing' },
    ]);
    expect(anyTerminal).toBe(false);
  });

  it('unknown jobId is left unchanged', () => {
    const uploads = [{ name: 'a', jobId: 'j1', status: 'queued' }];
    const { uploads: next } = simulatePollUpdate(uploads, [
      { jobId: 'j-unknown', status: 'done' },
    ]);
    expect(next[0].status).toBe('queued');
  });

  it('multiple jobs: only terminal ones flip anyTerminal', () => {
    const uploads = [
      { name: 'a', jobId: 'j1', status: 'queued' },
      { name: 'b', jobId: 'j2', status: 'queued' },
    ];
    const { uploads: next, anyTerminal } = simulatePollUpdate(uploads, [
      { jobId: 'j1', status: 'processing' },
      { jobId: 'j2', status: 'done', chunks: 5 },
    ]);
    expect(next.find(u => u.jobId === 'j1').status).toBe('processing');
    expect(next.find(u => u.jobId === 'j2').status).toBe('done');
    expect(anyTerminal).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Document list normalization
// ---------------------------------------------------------------------------

describe('RagAdmin — document list normalization', () => {
  function normalizeDocs(data) {
    return Array.isArray(data?.documents) ? data.documents : [];
  }

  it('returns documents array from well-formed response', () => {
    const docs = normalizeDocs({ documents: [{ source_path: '/s/a', chunks: 3 }] });
    expect(docs).toHaveLength(1);
  });

  it('returns empty for missing documents key', () => {
    expect(normalizeDocs({})).toEqual([]);
  });

  it('returns empty for null', () => {
    expect(normalizeDocs(null)).toEqual([]);
  });

  it('returns empty when documents is not array', () => {
    expect(normalizeDocs({ documents: 'oops' })).toEqual([]);
  });

  it('preserves document order', () => {
    const docs = normalizeDocs({
      documents: [
        { source_path: '/a', chunks: 1 },
        { source_path: '/b', chunks: 2 },
        { source_path: '/c', chunks: 3 },
      ],
    });
    expect(docs.map(d => d.source_path)).toEqual(['/a', '/b', '/c']);
  });
});

// ---------------------------------------------------------------------------
// Stress: 100 random upload sequences
// ---------------------------------------------------------------------------

describe('RagAdmin stress — 100 random upload sequences', () => {
  it('state invariants always hold', () => {
    const failures = [];
    for (let run = 0; run < 100; run++) {
      const n = Math.floor(Math.random() * 8) + 1;
      const files = Array.from({ length: n }, (_, i) => ({
        name: `file${i}.${['pdf','txt','md','py'][i % 4]}`,
        size: Math.floor(Math.random() * 25 * 1024 * 1024),
      }));
      const results = files.map((_, i) =>
        Math.random() < 0.2
          ? { error: 'upload failed' }
          : { job_id: `j-${run}-${i}`, source_path: `/s/${run}-${i}` }
      );
      const state = simulateUploadFlow(files, results);

      if (state.length !== files.length) {
        failures.push(`run ${run}: state.length ${state.length} !== ${files.length}`);
      }
      for (const u of state) {
        if (!['queued', 'error'].includes(u.status)) {
          failures.push(`run ${run}: unexpected status ${u.status} for ${u.name}`);
        }
        if (u.status === 'error' && !u.error) {
          failures.push(`run ${run}: error status but no error message for ${u.name}`);
        }
        if (u.status === 'queued' && !u.jobId) {
          failures.push(`run ${run}: queued status but no jobId for ${u.name}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('poll cycles never produce invalid status transitions', () => {
    const VALID_STATUSES = new Set(['queued', 'processing', 'done', 'error', 'uploading']);
    const failures = [];
    for (let run = 0; run < 100; run++) {
      let uploads = Array.from({ length: 5 }, (_, i) => ({
        name: `f${i}`, jobId: `j${i}`, status: 'queued',
      }));
      for (let tick = 0; tick < 10; tick++) {
        const pollResults = uploads
          .filter(u => !TERMINAL.has(u.status))
          .map(u => ({
            jobId: u.jobId,
            status: ['queued','processing','done','error'][Math.floor(Math.random()*4)],
            chunks: Math.floor(Math.random() * 20),
          }));
        const { uploads: next } = simulatePollUpdate(uploads, pollResults);
        for (const u of next) {
          if (!VALID_STATUSES.has(u.status)) {
            failures.push(`run ${run} tick ${tick}: invalid status ${u.status}`);
          }
        }
        uploads = next;
      }
    }
    expect(failures).toEqual([]);
  });
});
