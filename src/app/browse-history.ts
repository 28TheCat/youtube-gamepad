import type { BrowseReturnState } from './browse-feed-controller';

const key = 'ytGamepadBrowseReturn';

// Keep the snapshot on its own history entry, so repeated visits to one route
// cannot overwrite each other's category, loaded pages or selected card.
export function saveBrowseReturn(history: Pick<History, 'state' | 'replaceState'>, state: BrowseReturnState) {
  try {
    // Vue state contains proxies, which History's structured clone rejects.
    const snapshot = JSON.parse(JSON.stringify({ version: 1, ...state }));
    history.replaceState({ ...history.state, [key]: snapshot }, '');
  } catch { /* A browser storage limit must not prevent opening the video. */ }
}

export function readBrowseReturn(history: Pick<History, 'state'>, route: string): BrowseReturnState | undefined {
  const value = history.state?.[key];
  if (!value || value.version !== 1 || value.snapshot?.route !== route ||
    !Array.isArray(value.categories) || !value.categories.length ||
    !value.categories.every((item: any) => item && typeof item.id === 'string' && typeof item.label === 'string') ||
    !value.categories.some((item: any) => item.id === value.category) ||
    !Array.isArray(value.snapshot.items) || !value.snapshot.items.length ||
    !value.snapshot.items.every((item: any) => item && ['id', 'title', 'channel', 'thumbnail', 'href'].every(field => typeof item[field] === 'string') && /^\/(watch\?|shorts\/|playlist\?)/.test(item.href)) ||
    typeof value.snapshot.canLoadMore !== 'boolean' ||
    (value.nextPage !== undefined && typeof value.nextPage !== 'string') ||
    (value.activeItemId !== null && typeof value.activeItemId !== 'string') ||
    !Number.isFinite(value.scrollTop) || value.scrollTop < 0) return;
  return value;
}


export interface WatchReturnState {
  route: string;
  target: { region: string; itemKey?: string; index: number };
  tab: number;
  panel?: 'description' | 'comments' | 'playlists' | 'subscription';
  scrollTop: number;
}
const watchKey = 'ytGamepadWatchReturn';
export function saveWatchReturn(history: Pick<History, 'state' | 'replaceState'>, state: WatchReturnState) {
  try { history.replaceState({ ...history.state, [watchKey]: JSON.parse(JSON.stringify(state)) }, ''); } catch { /* Navigation remains available when history storage is full. */ }
}
export function readWatchReturn(history: Pick<History, 'state'>, route: string): WatchReturnState | undefined {
  const value = history.state?.[watchKey];
  if (!value || value.route !== route || !['player', 'metadata', 'controls', 'progress', 'tabs', 'filters', 'recommendations', 'panel'].includes(value.target?.region) ||
      !Number.isInteger(value.target.index) || value.target.index < 0 ||
      (value.target.itemKey !== undefined && typeof value.target.itemKey !== 'string') ||
      (value.panel !== undefined && !['description', 'comments', 'playlists', 'subscription'].includes(value.panel)) ||
      !Number.isInteger(value.tab) || value.tab < 0 || !Number.isFinite(value.scrollTop) || value.scrollTop < 0) return;
  return value;
}
