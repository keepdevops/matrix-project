import React, { useCallback, useMemo } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  addEdge, applyNodeChanges, applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEditor } from '../EditorContext';
import { deriveMode, makeFlowId } from '../persistence/flowConfigs';
import AgentNode from './AgentNode';
import './FlowEditor.css';

const NODE_TYPES = { agentNode: AgentNode };

const AGENT_ROLES = ['architect', 'programmer', 'reviewer', 'foreman', 'custom'];

export default function FlowEditor() {
  const { state, dispatch } = useEditor();
  const { flowNodes, flowEdges } = state;

  const derivedMode = useMemo(
    () => deriveMode(flowNodes, flowEdges),
    [flowNodes, flowEdges]
  );

  const onNodesChange = useCallback(
    (changes) => dispatch({ type: 'SET_FLOW_NODES', nodes: applyNodeChanges(changes, flowNodes) }),
    [flowNodes, dispatch]
  );

  const onEdgesChange = useCallback(
    (changes) => dispatch({ type: 'SET_FLOW_EDGES', edges: applyEdgeChanges(changes, flowEdges) }),
    [flowEdges, dispatch]
  );

  const onConnect = useCallback(
    (connection) => dispatch({ type: 'SET_FLOW_EDGES', edges: addEdge({ ...connection, animated: true }, flowEdges) }),
    [flowEdges, dispatch]
  );

  const addNode = (role) => {
    const existing = flowNodes.filter(n => n.data.role === role);
    const id = existing.length ? `${role}-${existing.length + 1}` : role;
    dispatch({
      type: 'SET_FLOW_NODES',
      nodes: [...flowNodes, {
        id,
        type: 'agentNode',
        position: { x: 100 + flowNodes.length * 140, y: 200 },
        data: { role: role === 'custom' ? 'agent' : role },
      }],
    });
  };

  const clearEdges = () => dispatch({ type: 'SET_FLOW_EDGES', edges: [] });

  const autoChain = () => {
    const edges = flowNodes.slice(0, -1).map((n, i) => ({
      id: `e${i}`,
      source: n.id,
      target: flowNodes[i + 1].id,
      animated: true,
    }));
    dispatch({ type: 'SET_FLOW_EDGES', edges });
  };

  return (
    <div className="flow-root">
      <div className="flow-toolbar">
        <span className="flow-toolbar-label">Add node:</span>
        {AGENT_ROLES.map(role => (
          <button key={role} className="editor-btn" onClick={() => addNode(role)}>
            + {role}
          </button>
        ))}
        <span className="flow-toolbar-spacer" />
        <button className="editor-btn" onClick={autoChain} title="Connect all nodes in sequence">⇢ Chain</button>
        <button className="editor-btn" onClick={clearEdges}>✕ Edges</button>
        <span className="flow-derived" title="Derived coordinator mode">
          mode: {derivedMode}
        </span>
      </div>

      <div className="flow-canvas">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={NODE_TYPES}
          fitView
          deleteKeyCode="Delete"
          style={{ background: '#0a0a0a' }}
        >
          <Background color="#1a2a1a" gap={40} />
          <Controls style={{ background: '#111', border: '1px solid #2a2a2a' }} />
          <MiniMap
            nodeColor={() => '#00cc33'}
            maskColor="rgba(0,0,0,0.7)"
            style={{ background: '#111', border: '1px solid #2a2a2a' }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
