import React from 'react';
import Button from './Button';
import AgentPromptModal from './AgentPromptModal';
import SwarmAgentSelector from './SwarmAgentSelector';
import ServerLayoutPreview from './ServerLayoutPreview';
import { useDeploy } from './SwarmConfig.deploy';
import { useSwarmConfigState } from './useSwarmConfigState';

export default function SwarmConfig({ onDeployed }) {
  const { status, statusMsg, logTail, agentStatuses, deploy, reset } = useDeploy({ onDeployed });
  const state = useSwarmConfigState({ reset });

  if (state.loadError) {
    return (
      <div className="swarm-config">
        <div className="swarm-config-offline">
          <div className="swarm-offline-title">CONFIG UNAVAILABLE</div>
          <div className="swarm-offline-msg">
            Could not load swarm configuration. Start the proxy, then click Retry.
          </div>
          <code className="swarm-offline-cmd">bash scripts/launch_matrix.sh</code>
          <div className="swarm-offline-detail">{state.loadError}</div>
          <Button
            variant="outline-primary"
            size="md"
            style={{ marginTop: '1rem' }}
            onClick={state.retryLoad}
          >
            RETRY
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="swarm-config">
      <div className="swarm-config-columns">
        <SwarmAgentSelector
          roles={state.roles}
          models={state.models}
          selected={state.selected}
          roleModels={state.roleModels}
          engine={state.engine}
          hasEngineModels={state.hasEngineModels}
          activeProfile={state.activeProfile}
          agentStatuses={agentStatuses}
          onEngineChange={state.handleEngineChange}
          onToggleRole={state.toggleRole}
          onSetModel={state.setModel}
          onApplyProfile={state.applyProfile}
          onEditAgent={state.setEditingAgent}
          onRolesChange={state.setRoles}
        />
        <ServerLayoutPreview
          layout={state.layout}
          engine={state.engine}
          riskEstimate={state.riskEstimate}
          isMixedBackends={state.isMixedBackends}
          activeBackends={state.activeBackends}
          selected={state.selected}
          status={status}
          statusMsg={statusMsg}
          logTail={logTail}
          onDeploy={() => deploy({
            roles: state.roles,
            selected: state.selected,
            roleModels: state.roleModels,
            models: state.models,
            engine: state.engine,
            riskEstimate: state.riskEstimate,
            layout: state.layout,
          })}
          canDeploy={state.canDeploy}
        />
      </div>

      {state.editingAgent && (
        <AgentPromptModal
          agent={state.editingAgent}
          defaultPrompt={state.editingAgent.system_prompt}
          onClose={() => state.setEditingAgent(null)}
          onSaved={state.handleAgentSaved}
        />
      )}
    </div>
  );
}
