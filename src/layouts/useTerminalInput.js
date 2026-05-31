import { useEffect, useRef, useState } from 'react';
import { ts } from './terminalLayoutChrome';

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
      if (text && text !== prevResponses.current[agent]) {
        newLines.push({ kind: 'agent', time: ts(), agent, text });
      }
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

  const BUILT_IN_CMDS = {
    ':help': () => sysLine(
      'Commands: :help  :clear  :mode <name>  :agents  :history  :rag  :config  :cache  :kv  :theme <name>  :layout <name>  — or type a prompt to submit'
    ),
    ':clear': () => setLines([{ kind: 'system', time: ts(), text: 'Terminal cleared.' }]),
    ':agents': () => sysLine(
      activeAgents.length
        ? activeAgents.map(a => `${a.name}(${a.backend})`).join('  ')
        : 'No agents online.'
    ),
    ':history': () => {
      if (!history.length) { sysLine('No history.'); return; }
      history.slice(-5).forEach(e => sysLine(`${e.timestamp ? new Date(e.timestamp).toLocaleString() : '?'}  ${e.prompt?.slice(0, 80)}`));
    },
    ':rag': () => { onUseRagChange(!useRag); sysLine(`RAG ${!useRag ? 'enabled' : 'disabled'}.`); },
    ':config': () => { onToggleConfig(); sysLine('Config panel toggled in header.'); },
    ':cache': () => { onOpenCachePanel(); sysLine('Cache panel opened.'); },
    ':kv': () => {
      if (!kvReadings?.length) { sysLine('No KV readings.'); return; }
      kvReadings.forEach(r => sysLine(`port:${r.port}  usage:${(r.usage * 100).toFixed(1)}%  slots:${r.slots_busy}/${r.total_slots}`));
    },
  };

  const handleEnter = async () => {
    const cmd = input.trim();
    if (!cmd) return;
    setCmdHistory(h => [cmd, ...h.slice(0, 49)]);
    setHistIdx(-1);
    setInput('');

    if (BUILT_IN_CMDS[cmd]) { BUILT_IN_CMDS[cmd](); return; }

    if (cmd.startsWith(':mode ')) {
      onModeChange(cmd.slice(6).trim());
      sysLine(`Mode set to ${cmd.slice(6).trim()}.`);
      return;
    }
    if (cmd.startsWith(':theme ')) {
      onSetTheme(cmd.slice(7).trim());
      return;
    }
    if (cmd.startsWith(':layout ')) {
      onSetLayout(cmd.slice(8).trim());
      return;
    }
    if (cmd.startsWith(':follow ')) {
      await onFollowUp(cmd.slice(8).trim(), null);
      return;
    }
    if (cmd === ':session clear') { onClearSession(); sysLine('Session cleared.'); return; }

    if (cmd.startsWith(':')) { sysLine(`Unknown command: ${cmd}. Type :help`); return; }

    await onSubmit(cmd, 0.2, {});
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
