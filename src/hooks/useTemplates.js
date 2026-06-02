import { useState, useEffect, useCallback } from 'react';
import { fetchTemplates, saveTemplate, deleteTemplate, renderTemplate } from '../api/templatesApi';

export function useTemplates() {
  const [templates, setTemplates] = useState({});
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const reload = useCallback(() => {
    fetchTemplates().then(setTemplates).catch(e => setError(e.message));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const save = async (name, data) => {
    setLoading(true); setError(null);
    try { await saveTemplate(name, data); reload(); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const remove = async (name) => {
    setLoading(true); setError(null);
    try { await deleteTemplate(name); reload(); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const render = async (name, variables) => {
    try { return await renderTemplate(name, variables); }
    catch (e) { setError(e.message); return null; }
  };

  return { templates, save, remove, render, loading, error, reload };
}
