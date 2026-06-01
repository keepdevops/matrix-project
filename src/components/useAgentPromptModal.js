import { useState, useEffect } from 'react';
import { setAgentSystemPrompt, setAgentDescription } from '../api/swarmApi';

export function useAgentPromptModal({ agent, onClose, onSaved }) {
  const [text, setText] = useState(agent?.system_prompt || '');
  const [desc, setDesc] = useState(agent?.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setText(agent?.system_prompt || '');
    setDesc(agent?.description || '');
    setError(null);
  }, [agent]);

  const promptDirty = text !== (agent?.system_prompt || '');
  const descDirty   = desc !== (agent?.description || '');
  const dirty = promptDirty || descDirty;

  const save = async () => {
    setBusy(true); setError(null);
    // Track partial success: description may save even if prompt fails.
    const patch = {};
    try {
      if (descDirty) {
        const r = await setAgentDescription(agent.name, desc);
        patch.description = (r && typeof r.description === 'string') ? r.description : desc;
      }
      if (promptDirty) {
        const r = await setAgentSystemPrompt(agent.name, text);
        patch.system_prompt = (r && typeof r.system_prompt === 'string') ? r.system_prompt : text;
      }
      if (onSaved && Object.keys(patch).length) onSaved(patch);
      onClose();
    } catch (e) {
      if (onSaved && Object.keys(patch).length) onSaved(patch);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return { text, setText, desc, setDesc, busy, error, dirty, promptDirty, descDirty, save };
}
