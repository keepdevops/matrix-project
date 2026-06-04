import { API_BASE } from './base';

const CATEGORIES = ['history', 'config', 'token-regulation'];

/**
 * Fetch one RSS 2.0 feed from the coordinator and parse <item> elements.
 * Returns [] when RSS is disabled or the coordinator is unreachable.
 */
export async function fetchRssFeed(category) {
  if (!CATEGORIES.includes(category)) {
    throw new Error(`Unknown RSS category: ${category}`);
  }
  let text;
  try {
    const res = await fetch(`${API_BASE}/rss/${category}`);
    if (!res.ok) return [];
    text = await res.text();
  } catch {
    return [];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return [];

  return Array.from(doc.querySelectorAll('item')).map(item => ({
    title:       item.querySelector('title')?.textContent       ?? '',
    description: item.querySelector('description')?.textContent ?? '',
    pubDate:     item.querySelector('pubDate')?.textContent     ?? '',
    link:        item.querySelector('link')?.textContent        ?? '',
  }));
}
