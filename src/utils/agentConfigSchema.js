const RULES = [
  { key: 'name',              type: 'string',  required: true                        },
  { key: 'model',             type: 'string'                                         },
  { key: 'system_prompt',     type: 'string'                                         },
  { key: 'description',       type: 'string'                                         },
  { key: 'max_tokens',        type: 'int',     min: 64,    max: 131072               },
  { key: 'context',           type: 'int',     min: 512,   max: 262144               },
  { key: 'read_timeout_secs', type: 'int',     min: 30,    max: 7200                 },
  { key: 'gpu_layers',        type: 'int',     min: 0,     max: 999                  },
  { key: 'max_concurrency',   type: 'int',     min: 1,     max: 64                   },
  { key: 'max_input_tokens',  type: 'int',     min: 0                                },
  { key: 'max_output_tokens', type: 'int',     min: 0                                },
];

export function validateAgentConfig(data) {
  const errors = [];
  for (const rule of RULES) {
    const val = data[rule.key];
    if (val === undefined || val === null) {
      if (rule.required) errors.push(`${rule.key}: required`);
      continue;
    }
    if (rule.type === 'string') {
      if (typeof val !== 'string') errors.push(`${rule.key}: must be a string`);
    } else if (rule.type === 'int') {
      const n = Number(val);
      if (!Number.isInteger(n)) { errors.push(`${rule.key}: must be an integer`); continue; }
      if (rule.min !== undefined && n < rule.min) errors.push(`${rule.key}: min ${rule.min}`);
      if (rule.max !== undefined && n > rule.max) errors.push(`${rule.key}: max ${rule.max}`);
    }
  }
  if (errors.length > 0) throw new Error(`Invalid agent config: ${errors.join('; ')}`);
  return data;
}
