import { useState } from 'react';
import { setAgentSystemPrompt, setAgentTokens } from '../api/swarmApi';

export default function useBrewEditRoleModal({ role, roleModels, onClose, onSaved }) {
  const [tab, setTab] = useState('Basic');
  const [name, setName]         = useState(role.name);
  const [prompt, setPrompt]     = useState(role.system_prompt || '');
  const [model, setModel]       = useState(roleModels[role.name] || '');
  const [context, setContext]   = useState(role.context ?? 0);
  const [temp, setTemp]         = useState(role.temperature ?? 0.7);
  const [minP, setMinP]         = useState(role.min_p ?? 0.0);
  const [topP, setTopP]         = useState(role.top_p ?? 0.92);
  const [topK, setTopK]         = useState(role.top_k ?? 50);
  const [maxTok, setMaxTok]     = useState(role.max_tokens ?? 8192);
  const [maxTokOn, setMaxTokOn] = useState(Boolean(role.max_tokens));
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);
  const [perms, setPerms] = useState({
    webSearch:     role.permissions?.webSearch     ?? false,
    codeExec:      role.permissions?.codeExec      ?? false,
    dalleImage:    role.permissions?.dalleImage    ?? false,
    functionCall:  role.permissions?.functionCall  ?? false,
    memoryAccess:  role.permissions?.memoryAccess  ?? false,
    chainOfThought: role.permissions?.chainOfThought ?? false,
  });
  const togglePerm = key => setPerms(p => ({ ...p, [key]: !p[key] }));

  const handleSave = async () => {
    const agentName = role.name;
    if (name.trim() !== agentName) {
      setError('Renaming agents is not supported — keep the original role name.');
      return;
    }
    setBusy(true);
    setError(null);
    const patch = { name: agentName, model };
    try {
      const promptDirty = prompt !== (role.system_prompt || '');
      if (promptDirty) {
        const r = await setAgentSystemPrompt(agentName, prompt);
        patch.system_prompt = (r && typeof r.system_prompt === 'string') ? r.system_prompt : prompt;
      }
      const ctxVal = parseInt(context, 10);
      const tokVal = maxTokOn ? parseInt(maxTok, 10) : null;
      const ctxDirty = ctxVal !== (role.context ?? 0);
      const tokDirty = (tokVal ?? null) !== (role.max_tokens ?? null);
      if (ctxDirty || tokDirty) {
        const body = {};
        if (ctxDirty) body.context = ctxVal;
        if (tokDirty && Number.isFinite(tokVal)) body.max_tokens = tokVal;
        const r = await setAgentTokens(agentName, body);
        if (Number.isFinite(r?.context)) patch.context = r.context;
        if (Number.isFinite(r?.max_tokens)) patch.max_tokens = r.max_tokens;
        else if (!maxTokOn) patch.max_tokens = null;
      }
      patch.temperature = parseFloat(temp);
      patch.min_p       = parseFloat(minP);
      patch.top_p       = parseFloat(topP);
      patch.top_k       = parseInt(topK, 10);
      patch.permissions = { ...perms };
      onSaved(patch);
      onClose();
    } catch (e) {
      if (Object.keys(patch).length > 1) onSaved(patch);
      setError(e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return {
    tab, setTab, name, setName, prompt, setPrompt, model, setModel,
    context, setContext, temp, setTemp, minP, setMinP,
    topP, setTopP, topK, setTopK,
    maxTok, setMaxTok, maxTokOn, setMaxTokOn, perms, togglePerm,
    busy, error, handleSave,
  };
}
