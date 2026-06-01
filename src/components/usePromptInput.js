import { useState, useEffect, useRef } from 'react';
import useRagHealth from '../hooks/useRagHealth';
import { useModeParams } from './ModeParamControls';
import { usePromptInputRag } from './usePromptInputRag';

/** State, effects, and submit handlers for PromptInput. */
export function usePromptInput({
  onSubmit,
  loading = false,
  disabled = false,
  externalPrompt,
  externalTemperature,
  onPromptConsumed,
  activeAgents = [],
  activeMode,
  useRag = false,
}) {
  const ragHealth = useRagHealth(true);
  const [prompt, setPrompt] = useState('');
  const { buildModeOpts, ...modeParamFields } = useModeParams();
  const [temperature, setTemperature] = useState(0.2);
  const {
    ragTopK, setRagTopK, ragMinScore, setRagMinScore,
    selectedRagAgents, setSelectedRagAgents,
  } = usePromptInputRag();

  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [prompt]);

  const onPromptConsumedRef = useRef(onPromptConsumed);
  useEffect(() => { onPromptConsumedRef.current = onPromptConsumed; }, [onPromptConsumed]);

  useEffect(() => {
    if (externalPrompt !== undefined && externalPrompt !== null) {
      setPrompt(externalPrompt);
      onPromptConsumedRef.current?.();
    }
  }, [externalPrompt]);

  useEffect(() => {
    if (externalTemperature !== undefined && externalTemperature !== null) {
      setTemperature(externalTemperature);
    }
  }, [externalTemperature]);

  const submitPrompt = (opts = {}) => {
    if (prompt.trim() && !loading && !disabled) {
      const ragOpts = useRag
        ? { ragTopK, ragMinScore, ...(selectedRagAgents.length > 0 ? { ragAgents: selectedRagAgents } : {}) }
        : {};
      const modeOpts = buildModeOpts(activeMode, activeAgents);
      onSubmit(prompt.trim(), temperature, { ...ragOpts, ...modeOpts, ...opts });
    }
  };

  const handleSubmit = (e) => { e.preventDefault(); submitPrompt(); };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitPrompt(); }
  };

  return {
    ragHealth, prompt, setPrompt, temperature, setTemperature,
    ragTopK, setRagTopK, ragMinScore, setRagMinScore,
    selectedRagAgents, setSelectedRagAgents,
    textareaRef, modeParamFields, handleSubmit, handleKeyDown, submitPrompt,
  };
}
