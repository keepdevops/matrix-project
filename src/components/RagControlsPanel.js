import React from 'react';
import RagAgentPicker from './RagAgentPicker';

export default function RagControlsPanel({
  useRag, onUseRagChange, ragHealth,
  ragTopK, setRagTopK, ragMinScore, setRagMinScore,
  ragRerank, setRagRerank,
  selectedRagAgents, setSelectedRagAgents, activeAgents,
  loading, disabled,
}) {
  const ragDown = !ragHealth.loading && !ragHealth.ok;
  const badgeColor = ragHealth.loading ? '#888' : ragHealth.ok ? '#3fb950' : '#f85149';
  const badgeTitle = ragHealth.loading
    ? 'Checking pgvector…'
    : ragHealth.ok
      ? `pgvector ok (embedder: ${ragHealth.embedder || 'unknown'})`
      : `pgvector unavailable${ragHealth.error ? `: ${ragHealth.error}` : ''}`;

  return (
    <>
      <label
        className="rag-toggle"
        title={ragDown
          ? badgeTitle
          : 'Prepend retrieved pgvector chunks to the prompt (requires rag.enabled in coordinator config)'}
      >
        <span
          aria-label={badgeTitle}
          title={badgeTitle}
          style={{
            display: 'inline-block',
            width: '0.6rem',
            height: '0.6rem',
            borderRadius: '50%',
            backgroundColor: badgeColor,
            marginRight: '0.35rem',
            verticalAlign: 'middle',
          }}
        />
        <input
          type="checkbox"
          checked={useRag}
          onChange={(e) => onUseRagChange?.(e.target.checked)}
          disabled={loading || disabled || ragDown}
        />
        {' '}Use RAG context
      </label>
      {useRag && (
        <details className="rag-options" style={{ marginLeft: '0.5rem' }}>
          <summary style={{ cursor: 'pointer', userSelect: 'none', opacity: 0.8 }}>
            RAG options
          </summary>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.85rem' }}>
              top_k{' '}
              <input
                type="number" min={1} max={20} step={1}
                value={ragTopK}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) setRagTopK(Math.max(1, Math.min(20, n)));
                }}
                disabled={loading || disabled}
                style={{ width: '4rem' }}
              />
            </label>
            <label style={{ fontSize: '0.85rem' }}>
              min_score{' '}
              <input
                type="number" min={0} max={1} step={0.05}
                value={ragMinScore}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (Number.isFinite(n)) setRagMinScore(Math.max(0, Math.min(1, n)));
                }}
                disabled={loading || disabled}
                style={{ width: '5rem' }}
                title="Maximum cosine distance to accept (lower = stricter match)"
              />
            </label>
            <label style={{ fontSize: '0.85rem' }}
                   title="Re-rank chunks by combined cosine + term-overlap score">
              <input
                type="checkbox"
                checked={!!ragRerank}
                onChange={(e) => setRagRerank?.(e.target.checked)}
                disabled={loading || disabled}
              />
              {' '}Re-rank
            </label>
          </div>
          <RagAgentPicker
            activeAgents={activeAgents}
            selectedRagAgents={selectedRagAgents}
            setSelectedRagAgents={setSelectedRagAgents}
            loading={loading} disabled={disabled}
          />
        </details>
      )}
    </>
  );
}
