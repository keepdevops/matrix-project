import React from 'react';
import { Handle, Position } from '@xyflow/react';

const ROLE_PORTS = {
  architect:  18080,
  programmer: 18081,
  reviewer:   18082,
  foreman:    18083,
};

export default function AgentNode({ data, selected }) {
  const port = ROLE_PORTS[data.role] || '';
  return (
    <div className={`agent-node${selected ? ' agent-node--selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="agent-node-role">Agent</div>
      <div className="agent-node-name">{data.role}</div>
      {port && <div className="agent-node-port">:{port}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
