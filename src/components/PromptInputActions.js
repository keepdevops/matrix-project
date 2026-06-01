import React from 'react';
import Button from './Button';

export default function PromptInputActions({
  backend, onBackendChange, loading, disabled, prompt,
  canContinue, onQualityPass, temperature,
  submitLabel, submitLoadingLabel, qualityPassLabel,
}) {
  return (
    <>
      <div
        className="backend-toggle"
        title="llama — parallel llama-server fleet  |  mlx — serialized MLX specialist"
      >
        <Button
          type="button"
          variant={backend === 'llama' ? 'outline-accent' : 'ghost'}
          size="xs"
          onClick={() => onBackendChange?.('llama')}
          disabled={loading || disabled}
          style={{ borderRadius: 'var(--btn-radius) 0 0 var(--btn-radius)', fontWeight: backend === 'llama' ? 600 : 400 }}
        >llama</Button>
        <Button
          type="button"
          variant={backend === 'mlx' ? 'outline-accent' : 'ghost'}
          size="xs"
          onClick={() => onBackendChange?.('mlx')}
          disabled={loading || disabled}
          style={{ borderRadius: '0 var(--btn-radius) var(--btn-radius) 0', borderLeft: 'none', fontWeight: backend === 'mlx' ? 600 : 400 }}
        >mlx</Button>
      </div>
      <Button variant="primary" size="md" type="submit" disabled={loading || disabled || !prompt.trim()}>
        {loading ? submitLoadingLabel : submitLabel}
      </Button>
      <Button
        variant="outline-accent"
        size="md"
        type="button"
        disabled={loading || disabled || !canContinue}
        onClick={() => onQualityPass?.(temperature)}
        title={canContinue ? 'Review and correct the previous output in this session' : `Run a ${submitLabel.toLowerCase()} first to start a session`}
      >
        {qualityPassLabel}
      </Button>
    </>
  );
}
