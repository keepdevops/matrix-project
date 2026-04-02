export const AGENT_COLORS = {
  architect:  '#FFB000',
  specialist: '#648FFF',
  scout:      '#DC267F',
  programmer: '#00ff41',
  synthesis:  '#FE6100',
  reviewer:   '#785EF0',
  tester:     '#00B4D8',
  security:   '#FF4C4C',
  devops:     '#06D6A0',
  documenter: '#FFD166',
  optimizer:  '#EF476F',
  debugger:   '#118AB2',
  database:   '#A8DADC',
  frontend:   '#F77F00',
  api:        '#4CC9F0',
  foreman:    '#C77DFF',
};

export const getAgentColor = name => AGENT_COLORS[name] || '#888888';
