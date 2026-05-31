import React, { useState } from 'react';
import useRagHealth from '../hooks/useRagHealth';
import RagControlsPanel from '../components/RagControlsPanel';
import RagSources from '../components/RagSources';

export default function BrewRagTab({
  useRag, onUseRagChange, activeAgents, loading, online, lastMeta, onOpenRagAdmin,
}) {
  const ragHealth = useRagHealth(true);
  const [ragTopK, setRagTopK] = useState(() => {
    const raw = parseInt(typeof window !== 'undefined' && localStorage.getItem('rag.top_k'), 10);
    return Number.isFinite(raw) && raw >= 1 && raw <= 20 ? raw : 3;
  });
  const [ragMinScore, setRagMinScore] = useState(() => {
    const raw = parseFloat(typeof window !== 'undefined' && localStorage.getItem('rag.min_score'));
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1.0;
  });
  const [selectedRagAgents, setSelectedRagAgents] = useState([]);

  return (
    <div className="brew-rag-panel">
      <RagControlsPanel
        useRag={useRag}
        onUseRagChange={onUseRagChange}
        ragHealth={ragHealth}
        ragTopK={ragTopK}
        setRagTopK={setRagTopK}
        ragMinScore={ragMinScore}
        setRagMinScore={setRagMinScore}
        selectedRagAgents={selectedRagAgents}
        setSelectedRagAgents={setSelectedRagAgents}
        activeAgents={activeAgents}
        loading={loading}
        disabled={!online}
      />
      <button type="button" className="brew-rag-admin-link" onClick={onOpenRagAdmin}>
        Manage RAG documents →
      </button>
      {lastMeta?.rag ? (
        <>
          <div className="brew-brewcast-section-title" style={{ marginTop: '0.75rem' }}>Last Retrieved Sources</div>
          <RagSources rag={lastMeta.rag} />
        </>
      ) : (
        <div className="brew-chat-empty" style={{ marginTop: '1rem' }}>
          <span className="brew-chat-empty-icon">🔍</span>
          <span>No RAG sources yet — run a prompt with RAG enabled</span>
        </div>
      )}
    </div>
  );
}
