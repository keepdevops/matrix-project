import { useState, useEffect, useCallback } from 'react';
import { fetchModes, fetchModeAgents, fetchAgents } from '../api/swarmApi';
import { useModeHealth } from '../hooks/useModeHealth';
import { useModeSave } from '../hooks/useModeSave';

export function useModeRosterPanel() {
  const [modes, setModes]               = useState([]);
  const [activeTab, setActiveTab]       = useState(null);
  const [available, setAvailable]       = useState([]);
  const [selected, setSelected]         = useState([]);
  const [explicit, setExplicit]         = useState(false);
  const [maxSelect, setMaxSelect]       = useState('');
  const [synthesizer, setSynthesizer]   = useState('');
  const [variantPolicy, setVariantPolicy]     = useState('standard');
  const [pipelinePreset, setPipelinePreset]   = useState('');
  const [synthesisPolicy, setSynthesisPolicy] = useState('summary');
  const [classifierPolicy, setClassifierPolicy] = useState('standard');
  const [pipelineOrder, setPipelineOrder]       = useState([]);
  const [usePipelineOrder, setUsePipelineOrder] = useState(false);
  const [stageContextChars, setStageContextChars] = useState('');
  const [loadError, setLoadError] = useState('');

  const { tripped } = useModeHealth();
  const { busy, error, staleAgents, savedAt, save, clearOverride } = useModeSave({
    setSelected, setExplicit, setPipelineOrder, setUsePipelineOrder,
  });

  const loadModes = useCallback(async () => {
    setLoadError('');
    try {
      const [m, a] = await Promise.all([fetchModes(), fetchAgents()]);
      setModes(m);
      setAvailable((a || []).map(x => x.name));
      setActiveTab(prev => prev || (m.find(x => x.active) || m[0])?.name || null);
    } catch (e) {
      console.error('[ModeRosterPanel] loadModes failed:', e);
      setLoadError('Failed to load modes — is the coordinator running?');
    }
  }, []);

  useEffect(() => { loadModes(); }, [loadModes]);

  useEffect(() => {
    const onChange = (e) => {
      loadModes();
      if (e?.detail?.mode) setActiveTab(e.detail.mode);
    };
    window.addEventListener('mode-roster-changed', onChange);
    return () => window.removeEventListener('mode-roster-changed', onChange);
  }, [loadModes]);

  useEffect(() => {
    if (!activeTab) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchModeAgents(activeTab);
        if (cancelled) return;
        setSelected(data.explicit ? (data.agents || []) : []);
        setExplicit(!!data.explicit);
        if (data.available) setAvailable(data.available);
        setMaxSelect(Number.isInteger(data.max_select) ? String(data.max_select) : '');
        setSynthesizer(typeof data.synthesizer === 'string' ? data.synthesizer : '');
        setVariantPolicy(typeof data.variant_policy === 'string' ? data.variant_policy : 'standard');
        setPipelinePreset(typeof data.preset === 'string' ? data.preset : '');
        setSynthesisPolicy(typeof data.synthesis_policy === 'string' ? data.synthesis_policy : 'summary');
        setClassifierPolicy(typeof data.classifier_policy === 'string' ? data.classifier_policy : 'standard');
        const ord = Array.isArray(data.order) ? data.order : [];
        setPipelineOrder(ord);
        setUsePipelineOrder(ord.length > 0);
      } catch (e) {
        if (!cancelled) { setSelected([]); setExplicit(false); }
        console.error('ModeRosterPanel: fetchModeAgents failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab]);

  const isPipeline = activeTab === 'pipeline';
  const addAgent  = name => setSelected(prev => (isPipeline || !prev.includes(name)) ? [...prev, name] : prev);
  const removeAt  = index => setSelected(prev => prev.filter((_, i) => i !== index));
  const moveAgent = (index, dir) => setSelected(prev => {
    const j = index + dir;
    if (j < 0 || j >= prev.length) return prev;
    const next = prev.slice();
    [next[index], next[j]] = [next[j], next[index]];
    return next;
  });

  const handleSave = () => save(activeTab, selected, {
    maxSelect, synthesizer, variantPolicy, pipelinePreset,
    synthesisPolicy, classifierPolicy, usePipelineOrder, pipelineOrder, stageContextChars,
  });

  return {
    modes, activeTab, setActiveTab, available, selected, explicit, setExplicit,
    maxSelect, synthesizer, setSynthesizer, variantPolicy, setVariantPolicy,
    pipelinePreset, setPipelinePreset, synthesisPolicy, setSynthesisPolicy,
    classifierPolicy, setClassifierPolicy, pipelineOrder, setPipelineOrder,
    usePipelineOrder, setUsePipelineOrder, stageContextChars, setStageContextChars,
    loadError, tripped, busy, error, staleAgents, savedAt, clearOverride,
    isPipeline, addAgent, removeAt, moveAgent, handleSave,
  };
}
