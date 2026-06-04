import { validateAgentConfig } from './agentConfigSchema';

test('passes a valid agent config', () => {
  expect(() => validateAgentConfig({
    name: 'worker', max_tokens: 4096, context: 8192,
    max_input_tokens: 2048, max_output_tokens: 512,
  })).not.toThrow();
});

test('throws when name is missing', () => {
  expect(() => validateAgentConfig({ max_tokens: 512 })).toThrow('name: required');
});

test('throws when max_tokens is below minimum', () => {
  expect(() => validateAgentConfig({ name: 'a', max_tokens: 10 })).toThrow('min 64');
});

test('throws when max_output_tokens is negative', () => {
  expect(() => validateAgentConfig({ name: 'a', max_output_tokens: -1 })).toThrow('min 0');
});

test('allows max_input_tokens = 0 (no cap)', () => {
  expect(() => validateAgentConfig({ name: 'a', max_input_tokens: 0, max_output_tokens: 0 })).not.toThrow();
});
