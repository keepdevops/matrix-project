export const AGENT_COLORS = {
  architect:  'var(--agent-architect)',
  specialist: 'var(--agent-specialist)',
  scout:      'var(--agent-scout)',
  programmer: 'var(--agent-programmer)',
  synthesis:  'var(--agent-synthesis)',
  reviewer:   'var(--agent-reviewer)',
  tester:     'var(--agent-tester)',
  security:   'var(--agent-security)',
  devops:     'var(--agent-devops)',
  documenter: 'var(--agent-documenter)',
  optimizer:  'var(--agent-optimizer)',
  debugger:   'var(--agent-debugger)',
  database:   'var(--agent-database)',
  frontend:   'var(--agent-frontend)',
  api:        'var(--agent-api)',
  foreman:    'var(--agent-foreman)',
};

export const getAgentColor = name => AGENT_COLORS[name] || 'var(--agent-unknown)';
