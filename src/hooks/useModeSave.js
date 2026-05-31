import { useCallback, useState } from 'react';
import { setModeAgents } from '../api/swarmApi';

export function useModeSave({ setSelected, setExplicit, setPipelineOrder, setUsePipelineOrder }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [staleAgents, setStaleAgents] = useState([]);
  const [savedAt, setSavedAt] = useState(null);

  const save = useCallback(async (activeTab, selected, {
    maxSelect, synthesizer, variantPolicy, pipelinePreset,
    synthesisPolicy, classifierPolicy, usePipelineOrder, pipelineOrder, stageContextChars,
  } = {}) => {
    if (!activeTab) return;
    setBusy(true); setError(null); setStaleAgents([]);
    try {
      const opts = {};
      const parsed = parseInt(maxSelect, 10);
      if (activeTab === 'router' && Number.isInteger(parsed) && parsed >= 1) opts.maxSelect = parsed;
      if (activeTab === 'pipeline' || activeTab === 'cascade') opts.synthesizer = synthesizer || '';
      if (activeTab === 'flat')     opts.variant_policy    = variantPolicy;
      if (activeTab === 'pipeline') opts.preset            = pipelinePreset;
      if (activeTab === 'cascade')  opts.synthesis_policy  = synthesisPolicy;
      if (activeTab === 'router')   opts.classifier_policy = classifierPolicy;
      if (activeTab === 'pipeline' && usePipelineOrder) {
        opts.order = pipelineOrder?.length ? pipelineOrder : null;
      }
      if (activeTab === 'pipeline' && stageContextChars !== '') {
        const scc = parseInt(stageContextChars, 10);
        if (Number.isInteger(scc) && scc > 0) opts.stage_context_chars = scc;
      }
      const res = await setModeAgents(activeTab, selected, opts);
      const savedAgents = Array.isArray(res?.agents) ? res.agents : [];
      setSelected(savedAgents);
      setExplicit(savedAgents.length > 0);
      if (activeTab === 'pipeline' && usePipelineOrder && res
          && Object.prototype.hasOwnProperty.call(res, 'order')) {
        if (res.order === null || res.order === undefined) {
          setPipelineOrder([]); setUsePipelineOrder(false);
        } else if (Array.isArray(res.order)) {
          setPipelineOrder(res.order);
          setUsePipelineOrder(res.order.length > 0);
        }
      }
      setSavedAt(Date.now());
      const unknown = Array.isArray(res?.unknown) ? res.unknown : [];
      setStaleAgents(unknown);
      const skipped = [];
      if (unknown.length) skipped.push(`agents: ${unknown.join(', ')}`);
      if (res?.unknown_order?.length) skipped.push(`order: ${res.unknown_order.join(', ')}`);
      setError(skipped.length ? `Skipped (not deployed) — ${skipped.join('; ')}` : null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [setSelected, setExplicit, setPipelineOrder, setUsePipelineOrder]);

  const clearOverride = useCallback(async (activeTab) => {
    setBusy(true); setError(null); setStaleAgents([]);
    try {
      const extra = activeTab === 'pipeline' ? { order: null } : {};
      const res = await setModeAgents(activeTab, [], extra);
      const savedAgents = Array.isArray(res?.agents) ? res.agents : [];
      setSelected(savedAgents);
      setExplicit(savedAgents.length > 0);
      if (activeTab === 'pipeline') { setPipelineOrder([]); setUsePipelineOrder(false); }
      setSavedAt(Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [setSelected, setExplicit, setPipelineOrder, setUsePipelineOrder]);

  return { busy, error, staleAgents, savedAt, save, clearOverride };
}
