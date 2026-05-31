import React from 'react';
import { RAM_TOTAL_GB, RAM_WARN_GB } from '../components/SwarmConfig.risk';

function colorFor(bandId) {
  if (bandId === 'high') return 'var(--kv-crit, #ff4136)';
  if (bandId === 'medium') return 'var(--kv-warn, #ffae00)';
  return 'var(--kv-ok, #00ff41)';
}

/** System RAM estimate badge — distinct from KvPressureGauge (KV slots). */
export default function MemoryPressureBadge({ pressure }) {
  if (!pressure || pressure.bandId === 'low') return null;

  const { bandId, estimatedRamGb, band, ramSource } = pressure;
  const ramKind = ramSource === 'host' ? 'System RAM' : 'RAM estimate';
  const title = [
    `${ramKind} ~${estimatedRamGb.toFixed(1)}GB / ${RAM_TOTAL_GB}GB`,
    band?.hint,
    ...(pressure.actions || []),
  ].filter(Boolean).join(' · ');

  return (
    <span
      className={`mem-pressure-badge mem-pressure-${bandId}`}
      title={title}
      role="status"
      aria-live="polite"
    >
      RAM {band?.label ?? bandId.toUpperCase()} ~{estimatedRamGb.toFixed(0)}GB
      {bandId !== 'low' && ` (warn ${RAM_WARN_GB}GB)`}
    </span>
  );
}

export { colorFor as memoryPressureColor };
