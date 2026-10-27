import { requestShortsInfo } from './youtube-request';

export interface ShortsRecommendations { ids: string[]; hasMore: boolean }

/** MAIN owns the recommendation continuation; only bounded video IDs leave it. */
export function createShortsService() {
  let info: Awaited<ReturnType<typeof requestShortsInfo>> | undefined;
  let controller: AbortController | undefined, destroyed = false;
  let pending: Promise<ShortsRecommendations> | undefined;
  const known = new Set<string>();
  async function read(videoId: string, reset = false): Promise<ShortsRecommendations> {
    if (destroyed || !/^[\w-]{1,100}$/.test(videoId)) throw new Error('Invalid Shorts request');
    if (reset || !known.has(videoId)) { controller?.abort(); controller = undefined; info = undefined; pending = undefined; known.clear(); known.add(videoId); }
    if (pending) return pending;
    const current = controller ||= new AbortController();
    const request = (async () => {
      const result = info ? info.wn_has_continuation ? await info.getWatchNextContinuation() : undefined : await requestShortsInfo(videoId, current.signal);
      if (destroyed || current.signal.aborted || controller !== current) throw new Error('Cancelled Shorts request');
      if (!result) return { ids: [], hasMore: false };
      info = result;
      const ids: string[] = [];
      for (const endpoint of (result.watch_next_feed || []).slice(0, 100)) {
        const id = endpoint.payload?.videoId;
        if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id) || known.has(id)) continue;
        known.add(id); ids.push(id);
      }
      while (known.size > 500) known.delete(known.values().next().value!);
      return { ids, hasMore: result.wn_has_continuation };
    })();
    pending = request;
    try { return await request; } finally { if (pending === request) pending = undefined; }
  }
  return { read, destroy() { destroyed = true; controller?.abort(); known.clear(); info = undefined; pending = undefined; } };
}
