/**
 * Resolved API base URL. Set at build time via REACT_APP_API_BASE.
 *   - Dev default: http://localhost:3002/api
 *   - Same-origin (nginx): /api
 */

function normalizeApiBase() {
  const raw = process.env.REACT_APP_API_BASE;
  if (raw === undefined || raw === '') {
    return 'http://localhost:3002/api';
  }
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  }
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

export const API_BASE = normalizeApiBase();
