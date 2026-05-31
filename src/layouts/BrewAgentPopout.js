import React, { useEffect } from 'react';
import AgentMarkdown from '../components/AgentMarkdown';
import CodeDisplay from '../components/CodeDisplay';

export default function BrewAgentPopout({ name, model, meta, response, error, code, language, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="brew-modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        className="brew-modal-card brew-modal-card--wide"
        role="dialog"
        aria-modal="true"
        aria-label={`Agent response — ${name}`}
        style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="brew-modal-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <span className="brew-modal-title-plain" style={{ fontWeight: 700, letterSpacing: '0.06em' }}>
              {name.toUpperCase()}
            </span>
            {model && (
              <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>{model}</span>
            )}
            {meta && (
              <span className="brew-agent-card-meta" style={{ fontSize: '0.72rem' }}>{meta}</span>
            )}
          </div>
          <button className="brew-modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="brew-modal-body" style={{ overflowY: 'auto', padding: '1rem 1.5rem', flex: '1 1 0' }}>
          {error ? (
            <div className="brew-agent-response brew-agent-response--error">
              <span className="brew-agent-response-error-icon">✕</span>
              {error}
            </div>
          ) : (
            <>
              <AgentMarkdown text={response} />
              {code && code.trim().length >= 10 && (
                <div className="brew-code-output-section" style={{ marginTop: '1rem' }}>
                  <div className="brew-code-output-header">
                    <span className="brew-section-title">CODE OUTPUT</span>
                  </div>
                  <div className="brew-code-output-frame">
                    <CodeDisplay initialCode={code} language={language} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
