import React, { useState, memo } from 'react';
import Button from './Button';
import ForkButton from './ForkButton';
import ResponseRating from './ResponseRating';
import QualityScoreBadge from './QualityScoreBadge';
import { bestAgentText, METADATA_KEYS } from '../utils/conversationHelpers';

function AgentExpander({ entry }) {
  const [open, setOpen] = useState(false);
  const agentKeys = Object.keys(entry).filter(k => !METADATA_KEYS.has(k) && entry[k]);
  if (!agentKeys.length) return null;
  return (
    <div className="ct-agent-expander">
      <Button variant="ghost" size="xs" className="ct-expand-btn" onClick={() => setOpen(v => !v)}>
        {open ? '▼' : '▶'} {agentKeys.length} agent{agentKeys.length !== 1 ? 's' : ''}
      </Button>
      {open && (
        <div className="ct-agent-tiles">
          {agentKeys.map(k => (
            <div key={k} className="ct-agent-tile">
              <div className="ct-agent-tile-name">{k}</div>
              <pre className="ct-agent-tile-body">{entry[k]}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const Turn = memo(function Turn({ entry, finalAnswer, onForked }) {
  const synth = entry._final || finalAnswer || null;
  const fallback = !synth ? bestAgentText(entry) : null;
  const swarmText = synth || fallback;
  const isFallback = !synth && !!fallback;

  return (
    <div className="ct-turn">
      <div className="ct-bubble ct-bubble--user">
        <span className="ct-bubble-label">YOU</span>
        <span className="ct-bubble-text">{entry.prompt}</span>
        {entry.timestamp && (
          <span className="ct-bubble-time">
            {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      <div className="ct-bubble ct-bubble--swarm">
        <span className="ct-bubble-label">
          SWARM
          {entry._orchestrate && entry._mode && (
            <span className="ct-mode-badge" title={`Python orchestrate mode: ${entry._mode}`}>
              {' · 🐍 '}{entry._mode}
            </span>
          )}
        </span>
        {swarmText
          ? <>
              {isFallback && <span className="ct-fallback-label">best agent · </span>}
              <span className="ct-bubble-text">{swarmText.length > 280 ? swarmText.slice(0, 280) + '…' : swarmText}</span>
            </>
          : <span className="ct-bubble-empty">—</span>
        }
      </div>
      <AgentExpander entry={entry} />
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.2rem' }}>
        {entry._meta?.tes != null && (
          <span className="ct-tes-badge"
                title={`Token Efficiency Score: ${entry._meta.tes.toFixed(2)} tok/ms`}>
            TES {entry._meta.tes.toFixed(2)}
          </span>
        )}
        <ForkButton runId={entry._run_id} onForked={onForked} />
        <ResponseRating runId={entry._run_id} />
        <QualityScoreBadge score={entry._meta?.quality_score} />
      </div>
    </div>
  );
}, (prev, next) =>
  prev.entry === next.entry && prev.finalAnswer === next.finalAnswer
  && prev.onForked === next.onForked
);

export function PendingTurn({ prompt }) {
  return (
    <div className="ct-turn ct-turn--pending">
      <div className="ct-bubble ct-bubble--user">
        <span className="ct-bubble-label">YOU</span>
        <span className="ct-bubble-text">{prompt}</span>
      </div>
      <div className="ct-bubble ct-bubble--swarm">
        <span className="ct-bubble-label">SWARM</span>
        <span className="ct-thinking">thinking…</span>
      </div>
    </div>
  );
}
