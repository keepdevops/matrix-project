import { useState } from 'react';
import { setAgentTokens } from '../api/swarmApi';
import {
  MIN_MAX_TOKENS, MAX_MAX_TOKENS,
  MIN_CONTEXT, MAX_CONTEXT,
  MIN_TIMEOUT, MAX_TIMEOUT,
  MIN_GPU_LAYERS, MAX_GPU_LAYERS,
  MIN_CONCURRENCY, MAX_CONCURRENCY,
  MIN_MAX_INPUT_TOKENS, MAX_MAX_INPUT_TOKENS,
  MIN_MAX_OUTPUT_TOKENS, MAX_MAX_OUTPUT_TOKENS,
} from './TokenBudgetGrid';

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

export function useTokenBudgetSave({ onRolesChange }) {
  const [drafts, setDrafts]   = useState({});
  const [busy, setBusy]       = useState({});
  const [errors, setErrors]   = useState({});
  const [notices, setNotices] = useState({});

  const setDraft = (name, key, value) => {
    setDrafts(prev => ({ ...prev, [name]: { ...(prev[name] || {}), [key]: value } }));
  };

  const isDirty = (role) => {
    const d = drafts[role.name];
    if (!d) return false;
    const {
      max_tokens: dm, context: dc, read_timeout_secs: dt,
      gpu_layers: dg, max_concurrency: dmc,
      max_input_tokens: dmit, max_output_tokens: dmot,
    } = d;
    return (
      (dm   !== undefined && dm   !== '' && Number(dm)   !== role.max_tokens) ||
      (dc   !== undefined && dc   !== '' && Number(dc)   !== role.context) ||
      (dt   !== undefined && dt   !== '' && Number(dt)   !== role.read_timeout_secs) ||
      (dg   !== undefined && dg   !== '' && Number(dg)   !== role.gpu_layers) ||
      (dmc  !== undefined && dmc  !== '' && Number(dmc)  !== role.max_concurrency) ||
      (dmit !== undefined && dmit !== '' && Number(dmit) !== (role.max_input_tokens ?? 0)) ||
      (dmot !== undefined && dmot !== '' && Number(dmot) !== (role.max_output_tokens ?? 0))
    );
  };

  const saveOne = async (role) => {
    const d = drafts[role.name] || {};
    const patch = {};
    if (d.max_tokens !== undefined && d.max_tokens !== '')
      patch.max_tokens = clamp(Number(d.max_tokens), MIN_MAX_TOKENS, MAX_MAX_TOKENS);
    if (d.context !== undefined && d.context !== '')
      patch.context = clamp(Number(d.context), MIN_CONTEXT, MAX_CONTEXT);
    if (d.read_timeout_secs !== undefined && d.read_timeout_secs !== '')
      patch.read_timeout_secs = clamp(Number(d.read_timeout_secs), MIN_TIMEOUT, MAX_TIMEOUT);
    if (d.gpu_layers !== undefined && d.gpu_layers !== '')
      patch.gpu_layers = clamp(Number(d.gpu_layers), MIN_GPU_LAYERS, MAX_GPU_LAYERS);
    if (d.max_concurrency !== undefined && d.max_concurrency !== '' && role.max_concurrency !== undefined)
      patch.max_concurrency = clamp(Number(d.max_concurrency), MIN_CONCURRENCY, MAX_CONCURRENCY);
    if (d.max_input_tokens !== undefined && d.max_input_tokens !== '')
      patch.max_input_tokens = clamp(Number(d.max_input_tokens), MIN_MAX_INPUT_TOKENS, MAX_MAX_INPUT_TOKENS);
    if (d.max_output_tokens !== undefined && d.max_output_tokens !== '')
      patch.max_output_tokens = clamp(Number(d.max_output_tokens), MIN_MAX_OUTPUT_TOKENS, MAX_MAX_OUTPUT_TOKENS);
    if (Object.keys(patch).length === 0) return;

    setBusy(prev => ({ ...prev, [role.name]: true }));
    setErrors(prev => ({ ...prev, [role.name]: '' }));
    setNotices(prev => ({ ...prev, [role.name]: '' }));
    try {
      const resp = await setAgentTokens(role.name, patch);
      const applied = { ...patch };
      if (Number.isFinite(resp?.read_timeout_secs)) applied.read_timeout_secs = resp.read_timeout_secs;
      if (resp?.read_timeout_auto_bumped) {
        setNotices(prev => ({
          ...prev,
          [role.name]: `read_timeout_secs auto-bumped to ${resp.read_timeout_secs}s for the new max_tokens`,
        }));
      }
      onRolesChange?.(prev => prev.map(r => r.name === role.name ? { ...r, ...applied } : r));
      setDrafts(prev => { const next = { ...prev }; delete next[role.name]; return next; });
    } catch (e) {
      setErrors(prev => ({ ...prev, [role.name]: e.message }));
    } finally {
      setBusy(prev => ({ ...prev, [role.name]: false }));
    }
  };

  const saveAll = async (dirtyRoles) => {
    for (const r of dirtyRoles) {
      // eslint-disable-next-line no-await-in-loop
      await saveOne(r);
    }
  };

  return { drafts, busy, errors, notices, setDraft, isDirty, saveOne, saveAll };
}
