import React from 'react';
import HistorySearch from './HistorySearch';
import DiffView from './DiffView';
import Button from './Button';
import { useHistoryDiff } from '../hooks/useHistoryDiff';

function SlotPicker({ label, entry, onSelect }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: '0.72rem', opacity: 0.55, marginBottom: '0.25rem' }}>{label}</div>
      {entry
        ? <div style={{ fontSize: '0.78rem', padding: '0.25rem 0.4rem',
                        background: 'var(--bg-secondary, #111)', borderRadius: 3,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={entry.prompt}>
            {entry.prompt?.slice(0, 60) || '(no prompt)'}
          </div>
        : <HistorySearch onSelect={onSelect} />
      }
    </div>
  );
}

export default function HistoryDiffPanel() {
  const { entryA, setEntryA, entryB, setEntryB, diff, loading, error, clear } = useHistoryDiff();

  const finalA = diff?.a?.final ?? entryA?._final ?? '';
  const finalB = diff?.b?.final ?? entryB?._final ?? '';

  return (
    <div style={{ padding: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>RESPONSE DIFF</span>
        {(entryA || entryB) && (
          <Button variant="ghost" size="xs" onClick={clear}>Clear</Button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <SlotPicker label="Entry A" entry={entryA} onSelect={setEntryA} />
        <SlotPicker label="Entry B" entry={entryB} onSelect={setEntryB} />
      </div>

      {loading && <div style={{ opacity: 0.5, fontSize: '0.78rem' }}>Loading diff…</div>}
      {error   && <div style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.78rem' }}>{error}</div>}

      {diff && (
        <DiffView
          textA={finalA} textB={finalB}
          labelA={`A · ${diff.a.run_id?.slice(0, 8) || ''}`}
          labelB={`B · ${diff.b.run_id?.slice(0, 8) || ''}`}
        />
      )}
    </div>
  );
}
