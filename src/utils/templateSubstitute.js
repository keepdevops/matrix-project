const VAR_RE = /\{\{(\w+)\}\}/g;

export function extractVariables(text) {
  const found = new Set();
  for (const m of (text || '').matchAll(VAR_RE)) found.add(m[1]);
  return [...found];
}

export function substitute(text, variables) {
  return (text || '').replace(VAR_RE, (_, key) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : `{{${key}}}`
  );
}
