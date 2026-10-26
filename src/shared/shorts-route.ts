export function isShortsPlaybackRoute() {
  return /^\/shorts\/[\w-]{1,100}$/.test(location.pathname);
}

export const shortsQueueKey = 'ytg-shorts-queue-v1';
export interface ShortsQueue { ids: string[]; returnTo: string; currentId?: string }
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
    return { ids: [...new Set<string>(ids)], returnTo,
      ...(typeof value.currentId === 'string' && ids.includes(value.currentId) ? { currentId: value.currentId } : {}) };
  } catch { return { ids: [], returnTo: '/' }; }
}
