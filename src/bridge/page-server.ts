import type { YouTubePlayer, DisposerHost } from '../../types/core';
import { PAGE_REQUEST, PAGE_RESPONSE, PAGE_HISTORY, parsePageMessage, videoDetails } from './page-protocol';
import { createYouTubeFeedService } from '../sites/youtube-feed';

export function startPageServer() {
  const key = Symbol.for('yt-gamepad.page.dispose');
  const host = window as unknown as DisposerHost;
  host[key]?.();
  let destroyed = false;
  let serving = false;
  const cleanups: (() => void)[] = [];
  const feed = createYouTubeFeedService();
  cleanups.push(feed.cancel);
  const receive = (event: Event) => {
    if (destroyed || serving) return;
    const request = parsePageMessage((event as CustomEvent).detail);
    if (!request || typeof request.id !== 'string' || request.id.length > 100 ||
        !['ping', 'readVideoDetails', 'showControls', 'hideControls', 'readBrowseCategories', 'requestBrowse', 'cancelBrowse'].includes(request.operation as string)) return;
    const reply = (ok: boolean, value?: unknown) => {
      if (!destroyed) document.dispatchEvent(new CustomEvent(PAGE_RESPONSE, { detail: JSON.stringify({ version: 1,
        id: request.id, operation: request.operation, ok, value }) }));
    };
    if (request.operation === 'readBrowseCategories') { try { reply(true, feed.categories()); } catch { reply(false); } return; }
    if (request.operation === 'cancelBrowse') { feed.cancel(); reply(true); return; }
    if (request.operation === 'requestBrowse') {
      if (typeof request.category !== 'string' || request.category.length > 100 ||
        (request.page !== undefined && (typeof request.page !== 'string' || request.page.length > 100))) return;
      void feed.request(request.category, request.page as string | undefined).then(value => reply(true, value), () => reply(false));
      return;
    }
    serving = true;
    let value: unknown, ok = true;
    try {
      const player = request.operation === 'ping' ? null : document.querySelector<YouTubePlayer>('#movie_player');
      switch (request.operation) {
        case 'ping': value = true; break;
        case 'readVideoDetails': value = videoDetails(player?.getPlayerResponse?.()?.videoDetails); break;
        case 'showControls': player?.showControls?.(); break;
        case 'hideControls': player?.hideControls?.(); break;
      }
    } catch { ok = false; }
    try {
      document.dispatchEvent(new CustomEvent(PAGE_RESPONSE, { detail: JSON.stringify({ version: 1,
        id: request.id, operation: request.operation, ok, value }) }));
    } finally { serving = false; }
  };
  document.addEventListener(PAGE_REQUEST, receive);
  cleanups.push(() => document.removeEventListener(PAGE_REQUEST, receive));
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    const wrapped = function(this: History, ...args: Parameters<History['pushState']>) {
      const before = location.pathname + location.search;
      const result = original.apply(this, args);
      if (!destroyed) document.dispatchEvent(new CustomEvent(PAGE_HISTORY, { detail: JSON.stringify({ version: 1,
        method, route: location.pathname + location.search, changed: before !== location.pathname + location.search }) }));
      return result;
    };
    history[method] = wrapped;
    cleanups.push(() => { if (history[method] === wrapped) history[method] = original; });
  }
  function dispose() {
    if (destroyed) return;
    destroyed = true;
    for (const cleanup of cleanups.reverse()) cleanup();
    if (host[key] === dispose) delete host[key];
  }
  const pagehide = (event: PageTransitionEvent) => { if (!event.persisted) dispose(); };
  window.addEventListener('pagehide', pagehide);
  cleanups.push(() => window.removeEventListener('pagehide', pagehide));
  host[key] = dispose;
  return dispose;
}
