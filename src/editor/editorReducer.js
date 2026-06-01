import { makeId } from './persistence/customLayouts';
import { makeFlowId } from './persistence/flowConfigs';
import { GRID_TEMPLATES } from './grid/GridTemplates';

export const DEFAULT_FLOW_NODES = [
  { id: 'architect',  type: 'agentNode', position: { x: 80,  y: 160 }, data: { role: 'architect'  } },
  { id: 'programmer', type: 'agentNode', position: { x: 280, y: 160 }, data: { role: 'programmer' } },
  { id: 'reviewer',   type: 'agentNode', position: { x: 480, y: 160 }, data: { role: 'reviewer'   } },
  { id: 'foreman',    type: 'agentNode', position: { x: 680, y: 160 }, data: { role: 'foreman'    } },
];

export const initialState = {
  mode: 'grid',
  layoutName: 'My Layout',
  layoutId: makeId(),
  activeTemplate: 'sidebar',
  slots: {},
  freePanels: [],
  flowId: makeFlowId(),
  flowNodes: DEFAULT_FLOW_NODES,
  flowEdges: [],
};

export function reducer(state, action) {
  switch (action.type) {
    case 'SET_MODE':
      return { ...state, mode: action.mode };
    case 'SET_NAME':
      return { ...state, layoutName: action.name };
    case 'SET_TEMPLATE': {
      const tpl = GRID_TEMPLATES[action.key];
      const slots = {};
      tpl.areas.flat().filter(s => s !== '.').forEach(s => { slots[s] = null; });
      return { ...state, activeTemplate: action.key, slots };
    }
    case 'SET_SLOT':
      return { ...state, slots: { ...state.slots, [action.slot]: action.panel } };
    case 'CLEAR_SLOT':
      return { ...state, slots: { ...state.slots, [action.slot]: null } };
    case 'ADD_FREE_PANEL': {
      const exists = state.freePanels.find(p => p.panel === action.panel);
      if (exists) return state;
      return {
        ...state,
        freePanels: [...state.freePanels, {
          id: makeId(), panel: action.panel,
          x: 40 + state.freePanels.length * 20,
          y: 40 + state.freePanels.length * 20,
          w: 420, h: 280, z: state.freePanels.length + 1,
        }],
      };
    }
    case 'MOVE_FREE_PANEL':
      return { ...state, freePanels: state.freePanels.map(p => p.id === action.id ? { ...p, x: action.x, y: action.y } : p) };
    case 'RESIZE_FREE_PANEL':
      return { ...state, freePanels: state.freePanels.map(p => p.id === action.id ? { ...p, w: Math.max(120, action.w), h: Math.max(80, action.h) } : p) };
    case 'BRING_FORWARD':
      return { ...state, freePanels: state.freePanels.map(p => p.id === action.id ? { ...p, z: p.z + 1 } : p) };
    case 'SEND_BACK':
      return { ...state, freePanels: state.freePanels.map(p => p.id === action.id ? { ...p, z: Math.max(1, p.z - 1) } : p) };
    case 'REMOVE_FREE_PANEL':
      return { ...state, freePanels: state.freePanels.filter(p => p.id !== action.id) };
    case 'SET_FLOW_NODES':
      return { ...state, flowNodes: action.nodes };
    case 'SET_FLOW_EDGES':
      return { ...state, flowEdges: action.edges };
    default:
      return state;
  }
}
