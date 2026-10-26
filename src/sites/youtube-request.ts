import { Session } from 'youtubei.js/web';
import type { Context } from 'youtubei.js/web';

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

const readEndpoints = ['guide', 'browse', 'search', 'next', 'player', 'playlist/get_add_to_playlist',
  'navigation/resolve_url', 'account/accounts_list', 'comment/perform_comment_action'];
const writeEndpoints = ['like/like', 'like/dislike', 'like/removelike', 'subscription/subscribe',
  'subscription/unsubscribe', 'notification/modify_channel_preference', 'browse/edit_playlist'];

// YouTube.js owns endpoint execution, context and payload normalization. The
// injected fetch only binds it to the page identity and our cancellation policy.
async function executeYouTube(path: string, init: RequestInit, signal: AbortSignal) {
  const { context = { client: { clientName: 'WEB' }, user: {} }, ...args } = JSON.parse(String(init.body || '{}'));
  const session = new Session(structuredClone({ ...context, user: context.user || {} }) as Context,
    '', 'v1', 0, undefined, undefined, undefined, async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.origin !== 'https://www.youtube.com' || url.pathname !== `/youtubei/v1/${path}`)
        throw new YouTubeRequestError('response');
      const headers = Object.fromEntries(new Headers(options?.headers).entries());
      // Keep captured account headers; never export cookies to the library.
      new Headers(init.headers).forEach((value, key) => { headers[key] = value; });
      const response = await fetch(url.pathname, { ...options, method: 'POST', headers, credentials: 'same-origin', signal });
      if (!response.ok) throw new YouTubeRequestError('http', response.status);
      return response;
    });
  // Page authentication is already captured in init.headers. Avoid the library's
  // separate cookie/OAuth login flow and account cache.
  const result = await session.actions.execute(`/${path}`, { ...(args as Record<string, unknown>), parse: false, skip_auth_check: true });
  return result.data;
}

// Only read-only adapter endpoints may use bounded automatic retries.
export async function requestYouTube(path: string, init: RequestInit, timeoutMs = 20000): Promise<Record<string, any>> {
  return request(path, init, timeoutMs, false);
}

export async function mutateYouTube(path: string, init: RequestInit): Promise<Record<string, any>> {
  return request(path, init, 20000, true);
}

async function request(path: string, init: RequestInit, timeoutMs: number, mutation: boolean): Promise<Record<string, any>> {
  if (!(mutation ? writeEndpoints : readEndpoints).includes(path))
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
        let raw: unknown;
        try { raw = await Promise.race([executeYouTube(path, init, controller.signal), interrupted]); }
        catch (error) {
          if (controller.signal.aborted) throw error;
          if (error instanceof SyntaxError) throw new YouTubeRequestError('response');
          throw error;
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || 'error' in raw || !Object.keys(raw).length)
          throw new YouTubeRequestError('response');
        if (mutation) {
          if ((raw as Record<string, unknown>).success === false) throw new YouTubeRequestError('response');
          return raw as Record<string, any>;
        }
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
        if (mutation || attempt || !(failure.kind === 'network' ||
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
