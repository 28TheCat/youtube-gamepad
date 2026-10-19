let shortIntent = '', pendingShortIntent = '', intentLoaded = false;
const intentKey = 'ytg-shorts-intent-v1';
export function prepareShortsIntent(id: string) { pendingShortIntent = /^[\w-]{1,100}$/.test(id) ? id : ''; }
export function rememberShortsIntent(id: string) {
  if (!/^[\w-]{1,100}$/.test(id)) return;
  shortIntent = id; intentLoaded = true;
  if (pendingShortIntent === id) pendingShortIntent = '';
  try { sessionStorage.setItem(intentKey, id); } catch { /* Session-only mode. */ }
}
export function isShortsPlaybackRoute() {
  const search = location.search || '';
  const id = /(?:^\?|&)v=([\w-]{1,100})(?:&|$)/.exec(search)?.[1];
  if (location.pathname === '/watch' && id) {
    if (pendingShortIntent === id) { rememberShortsIntent(id); return true; }
    if (/(?:^\?|&)ytg_shorts=1(?:&|$)/.test(search)) {
      if (shortIntent !== id) { shortIntent = id; try { sessionStorage.setItem(intentKey, id); } catch { /* Session-only mode. */ } }
      intentLoaded = true; return true;
    }
    // YouTube normalizes watch URLs and can remove our query marker at startup.
    if (!intentLoaded) { intentLoaded = true; try { shortIntent = sessionStorage.getItem(intentKey) || ''; } catch { /* Session-only mode. */ } }
    if (shortIntent === id) return true;
  }
  if (shortIntent) { shortIntent = ''; try { sessionStorage.removeItem(intentKey); } catch { /* Storage is optional. */ } }
  pendingShortIntent = '';
  return location.pathname.startsWith('/shorts/');
}

export const shortsPlayerHref = (id: string) => `/watch?v=${encodeURIComponent(id)}&ytg_shorts=1`;
export const shortsQueueKey = 'ytg-shorts-queue-v1';
export interface ShortsQueue { ids: string[]; returnTo: string }
export function readShortsQueue(): ShortsQueue {
  try {
    const raw = sessionStorage.getItem(shortsQueueKey);
    if (!raw || raw.length > 30000) return { ids: [], returnTo: '/' };
    const value = JSON.parse(raw);
    const ids = Array.isArray(value.ids) ? value.ids.slice(0, 200).filter((id: unknown): id is string =>
      typeof id === 'string' && /^[\w-]{1,100}$/.test(id)) : [];
    const target = new URL(typeof value.returnTo === 'string' && /^\/(?!\/)/.test(value.returnTo) && value.returnTo.length <= 4096 ? value.returnTo : '/', location.origin);
    const returnTo = target.origin === location.origin && !target.username && !target.password &&
      target.pathname !== '/watch' && !target.pathname.startsWith('/shorts/')
      ? target.pathname + target.search : '/';
    return { ids: [...new Set<string>(ids)], returnTo };
  } catch { return { ids: [], returnTo: '/' }; }
}
