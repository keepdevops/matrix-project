import { useCallback } from 'react';

export function useAppCallbacks({ showToast }) {
  const onModeWarning = useCallback((warnings) => {
    showToast(warnings[0], 'warn');
  }, [showToast]);

  const onMemoryPressureWarning = useCallback((pressure) => {
    const msg = pressure.warnings[0] || 'Elevated memory pressure';
    const hint = pressure.suggestFlatMode
      ? ' — try flat mode or SAFE profile'
      : pressure.suggestSafeProfile ? ' — try SAFE profile in CONFIGURE' : '';
    showToast(`${msg}${hint}`, 'warn');
  }, [showToast]);

  const onSaveCodeToast = showToast;

  return { onModeWarning, onMemoryPressureWarning, onSaveCodeToast };
}
