import { useEffect, useRef, useState } from 'react';
import { ts } from './terminalLayoutChrome';
import { buildCommandHandlers } from './useTerminalCommands';

export function useTerminalInput({
  responses, finalAnswer, error, pendingPrompt,
  activeAgents, history, kvReadings, useRag,
  onModeChange, onSetTheme, onSetLayout, onUseRagChange,
  onToggleConfig, onOpenCachePanel, onFollowUp, onClearSession, onSubmit,
}) {
  const [input, setInput] = useState('');
  const [cmdHistory, setCmdHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [lines, setLines] = useState([
    { kind: 'system', time: ts(), text: 'Swarm Matrix terminal. Type :help for commands.' },
  ]);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const prevResponses = useRef({});

  useEffect(() => {
    const newLines = [];
    Object.entries(responses).forEach(([agent, text]) => {
      if (text && text !== prevResponses.current[agent])
        newLines.push({ kind: 'agent', time: ts(), agent, text });
    });
    prevResponses.current = { ...responses };
    if (newLines.length) setLines(l => [...l, ...newLines]);
  }, [responses]);

  useEffect(() => {
    if (finalAnswer) setLines(l => [...l, { kind: 'final', time: ts(), text: finalAnswer }]);
  }, [finalAnswer]);
  useEffect(() => {
    if (error) setLines(l => [...l, { kind: 'error', time: ts(), text: error }]);
  }, [error]);
  useEffect(() => {
    if (pendingPrompt) setLines(l => [...l, { kind: 'prompt', time: ts(), text: pendingPrompt }]);
  }, [pendingPrompt]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const sysLine = (text) => setLines(l => [...l, { kind: 'system', time: ts(), text }]);

  const { handleEnter: dispatchCmd } = buildCommandHandlers({
    activeAgents, history, kvReadings, useRag,
    onModeChange, onSetTheme, onSetLayout, onUseRagChange,
    onToggleConfig, onOpenCachePanel, onFollowUp, onClearSession, onSubmit,
    sysLine, setLines,
  });

  const handleEnter = async () => {
    const cmd = input.trim();
    if (!cmd) return;
    setCmdHistory(h => [cmd, ...h.slice(0, 49)]);
    setHistIdx(-1);
    setInput('');
    await dispatchCmd(cmd);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEnter(); }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = Math.min(histIdx + 1, cmdHistory.length - 1);
      setHistIdx(idx);
      setInput(cmdHistory[idx] ?? '');
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const idx = Math.max(histIdx - 1, -1);
      setHistIdx(idx);
      setInput(idx === -1 ? '' : cmdHistory[idx]);
    }
  };

  return { input, setInput, lines, bottomRef, inputRef, handleEnter, handleKeyDown };
}
