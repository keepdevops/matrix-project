import React from 'react';
import '../styles/DeployProgress.css';

const STEPS = ['VALIDATING', 'LAUNCHING', 'CHECKING', 'ONLINE'];

function stepIndex(statusMsg) {
  const m = statusMsg?.toLowerCase() || '';
  if (m.includes('starting') || m.includes('launching')) return 1;
  if (m.includes('checking') || m.includes('waiting')) return 2;
  return 0;
}

export function DeployProgress({ status, statusMsg, logTail }) {
  if (status !== 'deploying' && status !== 'error') return null;

  const isError = status === 'error';
  const step = isError ? -1 : stepIndex(statusMsg);

  return (
    <div className={`deploy-progress${isError ? ' deploy-progress--error' : ''}`}>
      {!isError && (
        <>
          <div className="deploy-progress-bar-track">
            <div className="deploy-progress-bar-fill" />
          </div>
          <div className="deploy-steps">
            {STEPS.map((label, i) => (
              <span
                key={label}
                className={`deploy-step${i === step ? ' deploy-step--active' : i < step ? ' deploy-step--done' : ''}`}
              >
                {label}
              </span>
            ))}
          </div>
        </>
      )}
      {statusMsg && (
        <div className={`deploy-status-msg${isError ? ' deploy-status-msg--error' : ''}`}>
          {statusMsg}
        </div>
      )}
      {isError && logTail && logTail.length > 0 && (
        <details className="deploy-log-details">
          <summary className="deploy-log-summary">
            Recent server logs (agent_logs/*.log)
          </summary>
          {logTail.map(({ port, lines }) => (
            <div key={port} className="deploy-log-block">
              <div className="deploy-log-port">:{port}.log</div>
              <pre className="deploy-log-pre">{lines.join('\n') || '(empty)'}</pre>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

export default DeployProgress;
