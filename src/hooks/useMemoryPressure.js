import { useMemo } from 'react';
import { assessMemoryPressure } from '../utils/memoryPressure';

/** MS-24-5/phase-2: runtime RAM from host API + roster/mode fallback. */
export function useMemoryPressure({ online, activeAgents, activeMode, kvReadings, hostMemory }) {
  return useMemo(() => {
    if (!online || !activeAgents?.length) return null;
    return assessMemoryPressure({ activeAgents, activeMode, kvReadings, hostMemory });
  }, [online, activeAgents, activeMode, kvReadings, hostMemory]);
}
