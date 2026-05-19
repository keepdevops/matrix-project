const KEY = 'smx-custom-layouts';

export function loadCustomLayouts() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch (err) {
    console.error('customLayouts: load failed', err);
    return [];
  }
}

export function saveCustomLayout(def) {
  try {
    const all = loadCustomLayouts().filter(l => l.id !== def.id);
    all.push({ ...def, updatedAt: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch (err) {
    console.error('customLayouts: save failed', err);
    return false;
  }
}

export function deleteCustomLayout(id) {
  try {
    const all = loadCustomLayouts().filter(l => l.id !== id);
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch (err) {
    console.error('customLayouts: delete failed', err);
    return false;
  }
}

export function getCustomLayout(id) {
  return loadCustomLayouts().find(l => l.id === id) || null;
}

export function makeId() {
  return `custom-${Math.random().toString(36).slice(2, 10)}`;
}
