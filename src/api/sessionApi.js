import { API_BASE } from './base';

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

export function exportSessionMd(sessionId) {
  const url = `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/export.md`;
  triggerDownload(url, `session-${sessionId.slice(0, 12)}.md`);
}

export function exportSessionJson(sessionId) {
  const url = `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/export.json`;
  triggerDownload(url, `session-${sessionId.slice(0, 12)}.json`);
}
