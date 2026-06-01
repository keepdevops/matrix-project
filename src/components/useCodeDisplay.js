import { useState, useRef, useEffect } from 'react';
import { normalizeLanguage } from '../utils/codeExtractor';

export function useCodeDisplay({ initialCode, code: controlledCode, language: rawLanguage, isStreaming, autoScroll, onAutoScrollChange }) {
  const [isEditable, setIsEditable] = useState(false);
  const [editedCode, setEditedCode] = useState(controlledCode ?? initialCode ?? '');
  const [copyFeedback, setCopyFeedback] = useState('COPY');
  const fileInputRef = useRef(null);
  const copyTimerRef = useRef(null);
  const editorWrapRef = useRef(null);

  const language = normalizeLanguage(rawLanguage);
  const incoming = controlledCode !== undefined ? controlledCode : initialCode;

  useEffect(() => {
    if (isEditable) return;
    setEditedCode(incoming ?? '');
  }, [incoming, isEditable]);

  useEffect(() => {
    if (isStreaming) setIsEditable(false);
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming || !autoScroll) return;
    const scroller = editorWrapRef.current?.querySelector('.cm-scroller');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [editedCode, isStreaming, autoScroll]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editedCode);
      setCopyFeedback('COPIED!');
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyFeedback('COPY'), 2000);
    } catch (err) {
      console.error('[CodeDisplay] clipboard write failed:', err);
      setCopyFeedback('FAILED');
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyFeedback('COPY'), 2000);
    }
  };

  const handleSave = () => {
    const extensionMap = { python: 'py', javascript: 'js', cpp: 'cpp', rust: 'rs', json: 'json' };
    const ext = extensionMap[language] || 'txt';
    const blob = new Blob([editedCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `swarm_export_${Date.now()}.${ext}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleFileOpen = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setEditedCode(event.target.result);
      setIsEditable(true);
    };
    reader.onerror = () => {
      console.error('[CodeDisplay] FileReader failed to read:', file.name);
    };
    reader.readAsText(file);
  };

  const toggleAutoScroll = () => onAutoScrollChange?.(!autoScroll);

  return {
    language, isEditable, setIsEditable, editedCode, setEditedCode,
    copyFeedback, fileInputRef, editorWrapRef,
    handleCopy, handleSave, handleFileOpen, toggleAutoScroll,
  };
}
