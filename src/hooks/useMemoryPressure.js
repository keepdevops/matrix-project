import { useMemo } from 'react';
import { assessMemoryPressure } from '../utils/memoryPressure';

/** MS-24-5: runtime system-RAM pressure from deployed roster + mode manifest. */
export function useMemoryPressure({ online, activeAgents, activeMode, kvReadings }) {
  return useMemo(() => {
    if (!online || !activeAgents?.length) return null;
    return assessMemoryPressure({ activeAgents, activeMode, kvReadings });
  }, [online, activeAgents, activeMode, kvReadings]);
}
