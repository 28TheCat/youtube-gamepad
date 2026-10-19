export type YouTubeFailure = 'cancelled' | 'timeout' | 'network' | 'http' | 'response';
export class YouTubeRequestError extends Error {
  constructor(public readonly kind: YouTubeFailure, public readonly status?: number) {
    super(`YouTube request ${kind}`);
    this.name = 'YouTubeRequestError';
  }
}

// Shared by MAIN-world services; credentials never cross the page bridge.
// Account/sidebar callers pass their captured SID to retain identity checks.
export async function createYouTubeHeaders(context: { client: { clientVersion?: unknown } }, sessionId?: string): Promise<Record<string, string>> {
  const config = (key: string) => (window as any).ytcfg?.get?.(key);
  const headers: Record<string, string> = { 'Content-Type': 'application/json',
    'X-Youtube-Client-Name': String(config('INNERTUBE_CONTEXT_CLIENT_NAME') || 1),
    'X-Youtube-Client-Version': String(context.client.clientVersion) };
  const cookies = document.cookie.split(/;\s*/);
  const sid = sessionId ?? (cookies.find(value => value.startsWith('SAPISID='))?.slice(8) ||
    cookies.find(value => value.startsWith('__Secure-3PAPISID='))?.slice(18));
  if (sid) {
    const timestamp = Math.floor(Date.now() / 1000);
    const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${timestamp} ${sid} ${location.origin}`));
    headers.Authorization = `SAPISIDHASH ${timestamp}_${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  if (config('SESSION_INDEX') != null) headers['X-Goog-AuthUser'] = String(config('SESSION_INDEX'));
  if (typeof config('DELEGATED_SESSION_ID') === 'string') headers['X-Goog-PageId'] = config('DELEGATED_SESSION_ID');
  return headers;
}

// Only read-only adapter endpoints may use bounded automatic retries.
export async function requestYouTube(path: string, init: RequestInit, timeoutMs = 20000): Promise<Record<string, any>> {
  if (!['guide', 'browse', 'search', 'next', 'player', 'playlist/get_add_to_playlist', 'navigation/resolve_url', 'account/accounts_list'].includes(path))
    throw new YouTubeRequestError('response');
  const controller = new AbortController();
  let timedOut = false;
  const cancelled = () => controller.abort();
  init.signal?.addEventListener('abort', cancelled, { once: true });
  if (init.signal?.aborted) cancelled();
  let rejectAbort: (reason: Error) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => rejectAbort(new YouTubeRequestError(timedOut ? 'timeout' : 'cancelled'));
  controller.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    if (controller.signal.aborted) throw new YouTubeRequestError('cancelled');
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await Promise.race([fetch(`/youtubei/v1/${path}`, {
          ...init, signal: controller.signal
        }), interrupted]);
        if (!response.ok) throw new YouTubeRequestError('http', response.status);
        let raw: unknown;
        try { raw = await Promise.race([response.json(), interrupted]); }
        catch (error) {
          if (controller.signal.aborted) throw error;
          throw new YouTubeRequestError('response');
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || 'error' in raw || !Object.keys(raw).length)
          throw new YouTubeRequestError('response');
        if (!(path === 'guide' && Array.isArray((raw as Record<string, unknown>).items)) &&
          !(path === 'player' && ('videoDetails' in raw || 'playabilityStatus' in raw)) &&
          !(path === 'account/accounts_list' && 'actions' in raw) &&
          !(path === 'playlist/get_add_to_playlist' && 'actions' in raw) &&
          !['contents', 'continuationContents', 'endpoint', 'onResponseReceivedActions',
          'onResponseReceivedEndpoints', 'onResponseReceivedCommands', 'frameworkUpdates', 'alerts']
          .some(key => key in raw) && !Object.keys(raw).some(key => /(?:Renderer|ViewModel)$/.test(key)))
          throw new YouTubeRequestError('response');
        return raw as Record<string, any>;
      } catch (error) {
        if (controller.signal.aborted) throw new YouTubeRequestError(timedOut ? 'timeout' : 'cancelled');
        const failure = error instanceof YouTubeRequestError ? error : new YouTubeRequestError('network');
        if (attempt || !(failure.kind === 'network' ||
          (failure.kind === 'http' && [502, 503, 504].includes(failure.status || 0)))) throw failure;
        // Yield before retrying; cancellation also interrupts the backoff.
        let delay: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([new Promise<void>(resolve => { delay = setTimeout(resolve, 250); }), interrupted]); }
        finally { clearTimeout(delay); }
      }
    }
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', cancelled);
    controller.signal.removeEventListener('abort', abort);
  }
}
