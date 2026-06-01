import { ts } from './terminalLayoutChrome';

export function buildCommandHandlers({
  activeAgents, history, kvReadings, useRag,
  onModeChange, onSetTheme, onSetLayout, onUseRagChange,
  onToggleConfig, onOpenCachePanel, onFollowUp, onClearSession, onSubmit,
  sysLine, setLines,
}) {
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
      history.slice(-5).forEach(e =>
        sysLine(`${e.timestamp ? new Date(e.timestamp).toLocaleString() : '?'}  ${e.prompt?.slice(0, 80)}`)
      );
    },
    ':rag': () => { onUseRagChange(!useRag); sysLine(`RAG ${!useRag ? 'enabled' : 'disabled'}.`); },
    ':config': () => { onToggleConfig(); sysLine('Config panel toggled in header.'); },
    ':cache': () => { onOpenCachePanel(); sysLine('Cache panel opened.'); },
    ':kv': () => {
      if (!kvReadings?.length) { sysLine('No KV readings.'); return; }
      kvReadings.forEach(r =>
        sysLine(`port:${r.port}  usage:${(r.usage * 100).toFixed(1)}%  slots:${r.slots_busy}/${r.total_slots}`)
      );
    },
  };

  const handleEnter = async (cmd) => {
    if (BUILT_IN_CMDS[cmd]) { BUILT_IN_CMDS[cmd](); return; }
    if (cmd.startsWith(':mode '))   { onModeChange(cmd.slice(6).trim()); sysLine(`Mode set to ${cmd.slice(6).trim()}.`); return; }
    if (cmd.startsWith(':theme '))  { onSetTheme(cmd.slice(7).trim()); return; }
    if (cmd.startsWith(':layout ')) { onSetLayout(cmd.slice(8).trim()); return; }
    if (cmd.startsWith(':follow ')) { await onFollowUp(cmd.slice(8).trim(), null); return; }
    if (cmd === ':session clear')   { onClearSession(); sysLine('Session cleared.'); return; }
    if (cmd.startsWith(':'))        { sysLine(`Unknown command: ${cmd}. Type :help`); return; }
    await onSubmit(cmd, 0.2, {});
  };

  return { handleEnter };
}
