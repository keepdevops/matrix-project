import React, { useState } from 'react';
import Button from './Button';
import { startVllmServers, fetchLogs } from '../api/swarmApi';

const VLLM_PORTS = [8080, 8081, 8082, 8083];

export default function VllmPanel() {
  const [vllmStatus, setVllmStatus] = useState('idle');
  const [vllmMsg, setVllmMsg] = useState('');
  const [logTail, setLogTail] = useState(null);

  const handleStart = async () => {
    setVllmStatus('starting');
    setVllmMsg('Launching 4 vLLM servers via Docker Model Runner...');
    setLogTail(null);
    try {
      await startVllmServers();
      setVllmStatus('ready');
      setVllmMsg('');
    } catch (e) {
      setVllmStatus('error');
      setVllmMsg(e.message);
      fetchLogs(VLLM_PORTS)
        .then(({ logs }) => setLogTail(logs))
        .catch(() => setLogTail([]));
    }
  };

  return (
    <div className="vllm-panel">
      <div className="vllm-panel-title">vLLM INFERENCE SERVERS</div>

      <div className="vllm-mem-preview">
        Ports: 8080 · 8081 · 8082 · 8083
        <br />
        <span className="vllm-mem-detail">
          Qwen2.5-14B · Llama-3.2-3B · DeepSeek-Coder-V2 · Phi-4-mini
        </span>
      </div>

      {vllmStatus === 'starting' && (
        <div className="vllm-status-starting">{vllmMsg}</div>
      )}
      {vllmStatus === 'ready' && (
        <div className="vllm-status-ready">
          SERVERS READY — 8080 8081 8082 8083
        </div>
      )}
      {vllmStatus === 'error' && (
        <>
          <div className="vllm-status-error">{vllmMsg}</div>
          {logTail?.length > 0 && (
            <div className="swarm-config-logs">
              <div className="swarm-config-logs-title">
                Recent logs (agent_logs/*.log)
              </div>
              {logTail.map(({ port, lines }) => (
                <div key={port} className="swarm-config-log-block">
                  <div className="swarm-config-log-port">:{port}.log</div>
                  <pre className="swarm-config-log-pre">
                    {lines.join('\n') || '(empty)'}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Button
        variant="outline-primary"
        size="md"
        className={`vllm-start-btn${vllmStatus === 'starting' ? ' starting' : ''}${vllmStatus === 'ready' ? ' ready' : ''}`}
        onClick={handleStart}
        disabled={vllmStatus === 'starting' || vllmStatus === 'ready'}
      >
        {vllmStatus === 'starting' ? 'STARTING...'
          : vllmStatus === 'ready' ? 'SERVERS READY'
          : 'START VLLM SERVERS'}
      </Button>
    </div>
  );
}
