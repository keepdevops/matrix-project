import React, { useState, useEffect } from 'react';
import ModelConverterRow from './ModelConverterRow';
import { fetchModels, invalidateModelsCache } from '../api/swarmApi';

export default function ModelConverter({ models: modelsProp, onConversionDone, standalone }) {
  const [models, setModels]     = useState(modelsProp || []);
  const [loading, setLoading]   = useState(standalone && !modelsProp);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    if (!standalone) return;
    setLoading(true);
    setFetchError('');
    fetchModels()
      .then(m => { setModels(m); setLoading(false); })
      .catch(() => {
        setLoading(false);
        setFetchError('Failed to load models — is the coordinator running?');
      });
  }, [standalone]);

  const handleDone = () => {
    invalidateModelsCache();
    fetchModels().then(setModels).catch(err => console.error('ModelConverter: failed to refresh models after conversion:', err));
    if (onConversionDone) onConversionDone();
  };

  const ggufModels = models.filter(m => m.backend === 'llama' || m.path?.endsWith?.('.gguf'));

  if (standalone) {
    return (
      <div>
        <h2 style={{ fontFamily: 'monospace', color: '#00ff41', fontSize: '1rem',
                     textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16 }}>
          GGUF → MLX Converter
        </h2>
        <p style={{ fontSize: '0.8rem', color: '#666', marginBottom: 16 }}>
          Select a GGUF model, confirm its HuggingFace repo ID, and convert to MLX quantized format.
          Weights are downloaded from HuggingFace and saved to the local MLX model directory.
        </p>
        {loading && <p style={{ color: '#555', fontSize: '0.8rem' }}>Scanning models…</p>}
        {fetchError && <p style={{ color: 'var(--brew-error, #e55)', fontSize: '0.8rem' }}>{fetchError}</p>}
        {!loading && ggufModels.length === 0 && (
          <p style={{ color: '#555', fontSize: '0.8rem' }}>No GGUF models found in model directory.</p>
        )}
        {ggufModels.map(m => (
          <ModelConverterRow key={m.path || m.name} model={m} onDone={handleDone} />
        ))}
      </div>
    );
  }

  if (ggufModels.length === 0) return null;
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid #1a1a1a', paddingTop: 8 }}>
      {ggufModels.map(m => (
        <ModelConverterRow key={m.path || m.name} model={m} onDone={handleDone} />
      ))}
    </div>
  );
}
