import React, { useEffect } from 'react';
import AgentMarkdown from '../components/AgentMarkdown';
import CodeOutputPanel from '../components/CodeOutputPanel';

export default function BrewAgentPopout({
  name, model, meta, response, error, code, loading = false, onClose,
}) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const sourceText = response || (code ? '```\n' + code + '\n```' : '');
  const showCodeLayout = Boolean(sourceText || loading);

  return (
    <div className="brew-modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        className="brew-modal-card brew-modal-card--agent-popout"
        role="dialog"
        aria-modal="true"
        aria-label={`Agent response — ${name}`}
      >
        <div className="brew-modal-header">
          <div className="brew-agent-popout-heading">
            <span className="brew-modal-title-plain brew-agent-popout-name">
              {name.toUpperCase()}
            </span>
            {model && <span className="brew-agent-popout-model">{model}</span>}
            {meta && <span className="brew-agent-card-meta brew-agent-popout-meta">{meta}</span>}
          </div>
          <button className="brew-modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={`brew-agent-popout-body${showCodeLayout ? ' brew-agent-popout-body--code' : ''}`}>
          {error ? (
            <div className="brew-agent-response brew-agent-response--error">
              <span className="brew-agent-response-error-icon">✕</span>
              {error}
            </div>
          ) : (
            <>
              {response && (
                <div className="brew-agent-popout-prose">
                  <AgentMarkdown text={response} />
                </div>
              )}
              {(sourceText || loading) && (
                <CodeOutputPanel
                  sourceText={sourceText}
                  loading={loading}
                  sectionClassName="brew-agent-popout-code"
                  frameClassName="brew-agent-popout-code-frame"
                  editorHeight="min(56vh, 560px)"
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
