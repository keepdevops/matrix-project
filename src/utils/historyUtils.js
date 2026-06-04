/**
 * MS-70: Normalize history entries so _meta (tes, token_budget) is always
 * present. Server-side entries carry _meta from dispatch_write_history; this
 * function gracefully handles older entries that predate the C++ change.
 */

/**
 * Enrich a single history entry with meta from a live dispatch response when
 * the server-stored entry predates _meta persistence (session-scoped fallback).
 *
 * @param {Object} entry   — raw history entry from GET /api/history
 * @param {Object} [meta]  — envelope meta from the most recent dispatch, keyed by _run_id
 * @returns {Object} entry (mutated in-place for perf; caller may clone if needed)
 */
export function enrichEntry(entry, metaByRunId = {}) {
  if (entry._meta) return entry;
  const m = entry._run_id ? metaByRunId[entry._run_id] : undefined;
  if (m) entry._meta = m;
  return entry;
}

/**
 * Enrich an array of history entries from a run-id → meta lookup map.
 * Returns the same array reference; entries are mutated in-place.
 */
export function enrichHistory(entries, metaByRunId = {}) {
  for (const e of entries) enrichEntry(e, metaByRunId);
  return entries;
}

/**
 * Extract the fields relevant to TES/token display from a dispatch meta object.
 */
export function extractMetaSummary(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const tb = meta.token_budget;
  const tes = typeof meta.tes === 'number' ? meta.tes : null;
  return {
    tes,
    consumed:  tb?.consumed  ?? null,
    budget:    tb?.budget    ?? null,
    remaining: tb?.remaining ?? null,
    overrun:   tb?.overrun   ?? false,
  };
}
