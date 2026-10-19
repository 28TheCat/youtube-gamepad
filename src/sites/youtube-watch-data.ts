import { parseWatchLink, parseShortLink } from '../shared/watch-link';
import { requestYouTube, YouTubeRequestError } from './youtube-request';

// One page-owned initial response. Continuations and comments bypass this store.
export function createWatchDataService() {
  let currentRoute = '', destroyed = false;
  let entry: { key: string; controller: AbortController; promise: Promise<Record<string, any>> } | undefined;
  const route = () => location.pathname + location.search;
  function clear() { entry?.controller.abort(); entry = undefined; }
  function routeChanged() {
    if (currentRoute === route()) return;
    clear(); currentRoute = route();
  }
  async function read(init: RequestInit): Promise<Record<string, any>> {
    routeChanged();
    const watch = parseWatchLink(currentRoute), target = watch || parseShortLink(currentRoute);
    if (destroyed || !target || init.signal?.aborted) throw new YouTubeRequestError('cancelled');
    const { context } = JSON.parse(String(init.body));
    const headers = init.headers as Record<string, string>;
    const body = JSON.stringify({ context, ...(watch?.watchEndpoint || { videoId: target.videoId }) });
    const key = JSON.stringify([currentRoute, body, headers['X-Goog-AuthUser'], headers['X-Goog-PageId'], !!headers.Authorization]);
    if (entry?.key !== key) {
      clear();
      const controller = new AbortController();
      const next = { key, controller, promise: requestYouTube('next', { ...init, body, signal: controller.signal }) };
      entry = next;
      // Failed responses must not poison subsequent retries or erase a newer entry.
      void next.promise.catch(() => { if (entry === next) entry = undefined; });
    }
    const response = entry.promise;
    // A consumer may leave independently; only the owner cancels the transport.
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (done: (value: any) => void, value: unknown) => {
        if (settled) return;
        settled = true; init.signal?.removeEventListener('abort', cancel); done(value);
      };
      const cancel = () => finish(reject, new YouTubeRequestError('cancelled'));
      init.signal?.addEventListener('abort', cancel, { once: true });
      if (init.signal?.aborted) cancel();
      response.then(value => finish(resolve, value), error => finish(reject, error));
    });
  }
  return { read, routeChanged, destroy() { destroyed = true; clear(); } };
}

export type WatchDataService = ReturnType<typeof createWatchDataService>;
