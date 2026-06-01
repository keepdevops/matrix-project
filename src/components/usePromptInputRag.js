import { useState, useEffect } from 'react';

export function usePromptInputRag() {
  const [ragTopK, setRagTopK] = useState(() => {
    const raw = parseInt(
      typeof window !== 'undefined' && localStorage.getItem('rag.top_k'),
      10,
    );
    return Number.isFinite(raw) && raw >= 1 && raw <= 20 ? raw : 3;
  });
  const [selectedRagAgents, setSelectedRagAgents] = useState([]);
  const [ragMinScore, setRagMinScore] = useState(() => {
    const raw = parseFloat(
      typeof window !== 'undefined' && localStorage.getItem('rag.min_score'),
    );
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1.0;
  });

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem('rag.top_k', String(ragTopK));
        localStorage.setItem('rag.min_score', String(ragMinScore));
      } catch (err) {
        console.error('[rag] persist params failed:', err);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [ragTopK, ragMinScore]);

  return { ragTopK, setRagTopK, ragMinScore, setRagMinScore, selectedRagAgents, setSelectedRagAgents };
}
