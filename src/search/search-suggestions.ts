import { Innertube, type Context } from 'youtubei.js/web';
import { createYouTubeSession } from '../sites/youtube-session';

/** YouTube.js builds and parses completion requests; transport stays same-origin. */
export async function requestSearchSuggestions(query: string, signal: AbortSignal): Promise<string[]> {
  if (query.length > 256) return [];
  signal.throwIfAborted();
  // Completion only reads hl/gl; no player or account tokens are required.
  const context = { client: { hl: document.documentElement.lang || 'en', gl: 'US' }, user: {} } as Context;
  const session = createYouTubeSession(context, async input => {
    const requested = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (requested.origin !== 'https://suggestqueries-clients6.youtube.com' || requested.pathname !== '/complete/search')
      throw new Error('Invalid suggestion endpoint');
    const url = new URL(requested.pathname + requested.search, location.origin);
    const response = await fetch(url, { credentials: 'same-origin', signal });
    if (!response.ok) throw new Error('Suggestions unavailable');
    const raw = await response.text();
    if (raw.length > 100000) throw new Error('Suggestion response too large');
    // Normalize the library's JSONP envelope without executing response scripts.
    const value = raw.trim().replace(/;$/, '');
    return new Response(value.startsWith('window.google.ac.h(') ? value : `window.google.ac.h(${value})`);
  });
  const result = await new Innertube(session).getSearchSuggestions(query);
  signal.throwIfAborted();
  return [...new Set(result.slice(0, 30).filter((value): value is string =>
    typeof value === 'string' && !!value.trim() && value.length <= 256).map(value => value.trim()))].slice(0, 8);
}
