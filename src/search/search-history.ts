import { readLocalStorage, writeLocalStorage } from './local-storage';

export const SEARCH_HISTORY_CHANGED = 'ytg-search-history-changed';

// Page storage may contain arbitrary values. Never render it as markup.
function sanitizeSearches(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.slice(0, 20)
    .filter((item): item is string => typeof item === 'string' && item.length <= 256)
    .map(item => item.trim()).filter(Boolean))].slice(0, 5) : [];
}
export function readSearchHistory(): string[] {
  try {
    const raw = readLocalStorage('ytg-recent-searches');
    return raw && raw.length <= 8192 ? sanitizeSearches(JSON.parse(raw)) : [];
  } catch { return []; }
}
export function rememberSearch(query: string): string[] {
  if (!query.trim() || query.trim().length > 256) return readSearchHistory();
  const recent = sanitizeSearches([query.trim(), ...readSearchHistory().filter(item => item !== query.trim())]);
  writeLocalStorage('ytg-recent-searches', JSON.stringify(recent));
  document.dispatchEvent(new Event(SEARCH_HISTORY_CHANGED));
  return recent;
}
