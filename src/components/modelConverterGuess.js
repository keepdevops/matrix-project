export const ORG_PREFIXES = [
  [/^meta-llama/i,   'meta-llama'],
  [/^llama/i,        'meta-llama'],
  [/^codestral/i,    'mistralai'],
  [/^mistral/i,      'mistralai'],
  [/^mixtral/i,      'mistralai'],
  [/^gemma/i,        'google'],
  [/^phi-/i,         'microsoft'],
  [/^phi\d/i,        'microsoft'],
  [/^qwen/i,         'Qwen'],
  [/^deepseek/i,     'deepseek-ai'],
];

export function guessHfRepo(filename) {
  const base = filename.replace(/\.gguf$/i, '').replace(/(-[Qq]\d[^-]*|-IQ\d[^-]*)(_[A-Z0-9]+)*$/, '');
  for (const [re, org] of ORG_PREFIXES) {
    if (re.test(base)) return `${org}/${base}`;
  }
  return base;
}

export function guessOutputName(filename) {
  const base = filename.replace(/\.gguf$/i, '').replace(/(-[Qq]\d[^-]*|-IQ\d[^-]*)(_[A-Z0-9]+)*$/, '');
  return base;
}
