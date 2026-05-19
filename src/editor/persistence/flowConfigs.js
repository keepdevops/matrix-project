const KEY = 'smx-flow-configs';

export function loadFlowConfigs() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch (err) {
    console.error('flowConfigs: load failed', err);
    return [];
  }
}

export function saveFlowConfig(def) {
  try {
    const all = loadFlowConfigs().filter(f => f.id !== def.id);
    all.push({ ...def, updatedAt: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch (err) {
    console.error('flowConfigs: save failed', err);
    return false;
  }
}

export function deleteFlowConfig(id) {
  try {
    const all = loadFlowConfigs().filter(f => f.id !== id);
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch (err) {
    console.error('flowConfigs: delete failed', err);
    return false;
  }
}

/**
 * Derive mode name from edge topology.
 * Linear chain covering all nodes → pipeline
 * No edges → flat
 * Otherwise → cascade
 */
export function deriveMode(nodes, edges) {
  if (!edges || edges.length === 0) return 'flat';
  const nodeIds = new Set(nodes.map(n => n.id));
  const inDeg  = {};
  const outDeg = {};
  nodeIds.forEach(id => { inDeg[id] = 0; outDeg[id] = 0; });
  edges.forEach(e => {
    if (nodeIds.has(e.source)) outDeg[e.source] = (outDeg[e.source] || 0) + 1;
    if (nodeIds.has(e.target)) inDeg[e.target]  = (inDeg[e.target]  || 0) + 1;
  });
  const isLinear = [...nodeIds].every(id => inDeg[id] <= 1 && outDeg[id] <= 1);
  return isLinear ? 'pipeline' : 'cascade';
}

export function makeFlowId() {
  return `flow-${Math.random().toString(36).slice(2, 10)}`;
}
