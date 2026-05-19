import React, { lazy } from 'react';

export const PANEL_META = {
  ConversationThread:   { label: 'Conversation',    color: '#00cc33' },
  AgentGrid:            { label: 'Agent Grid',       color: '#009922' },
  FinalAnswerPanel:     { label: 'Final Answer',     color: '#00ff41' },
  PromptInput:          { label: 'Prompt Input',     color: '#44bb66' },
  MetricsStrip:         { label: 'Metrics',          color: '#007711' },
  PipelineStageOutputs: { label: 'Stage Outputs',    color: '#005511' },
  SwarmConfig:          { label: 'Config',           color: '#336633' },
  RagSources:           { label: 'RAG Sources',      color: '#224422' },
  PressureCluster:      { label: 'KV Pressure',      color: '#113311' },
  CompareVariantsPanel: { label: 'Compare Variants', color: '#445544' },
};

export const PANEL_NAMES = Object.keys(PANEL_META);

export const PANEL_COMPONENTS = {
  ConversationThread:   lazy(() => import('../../components/ConversationThread')),
  AgentGrid:            lazy(() => import('../../components/AgentGrid')),
  FinalAnswerPanel:     lazy(() => import('../../components/FinalAnswerPanel')),
  PromptInput:          lazy(() => import('../../components/PromptInput')),
  MetricsStrip:         lazy(() => import('../../components/MetricsStrip')),
  PipelineStageOutputs: lazy(() => import('../../components/PipelineStageOutputs')),
  SwarmConfig:          lazy(() => import('../../components/SwarmConfig')),
  RagSources:           lazy(() => import('../../components/RagSources')),
  PressureCluster:      lazy(() => import('../../components/PressureCluster')),
  CompareVariantsPanel: lazy(() => import('../../components/CompareVariantsPanel')),
};

export function PanelSlot({ name, appProps, style = {} }) {
  const Comp = PANEL_COMPONENTS[name];
  if (!Comp) return <div style={{ color: '#f55', padding: 8 }}>Unknown panel: {name}</div>;
  return (
    <React.Suspense fallback={<div style={{ color: '#666', padding: 8 }}>…</div>}>
      <Comp {...(appProps || {})} style={style} />
    </React.Suspense>
  );
}
