import { createAccountService } from '../sites/youtube-account';
import { createSidebarService } from '../sites/youtube-sidebar';
import { sidebarSnapshot } from '../shared/sidebar-data';
import { createWatchDataService } from '../sites/youtube-watch-data';
import type { YouTubePlayer, DisposerHost } from '../../types/core';
import { PAGE_REQUEST, PAGE_RESPONSE, PAGE_HISTORY, parsePageMessage, videoDetails, watchInfoSnapshot, accountSnapshot } from './page-protocol';
import { createYouTubeFeedService } from '../sites/youtube-feed';
import { parseWatchLink, parseShortLink } from '../shared/watch-link';
import { createWatchNextService } from '../sites/youtube-next';
import { createCommentsService } from '../sites/youtube-comments';
import { sidebarBrowseEndpoint } from '../shared/explore-pages';
import { createWatchInfoService } from '../sites/youtube-watch-info';

export function startPageServer() {
  const key = Symbol.for('yt-gamepad.page.dispose');
  const host = window as unknown as DisposerHost;
  host[key]?.();
  let destroyed = false;
  let serving = false;
  const cleanups: (() => void)[] = [];
  const account = createAccountService();
  const sidebar = createSidebarService();
  cleanups.push(sidebar.destroy);
  cleanups.push(account.destroy);
  const feed = createYouTubeFeedService();
  const watchData = createWatchDataService();
  const next = createWatchNextService(watchData);
  const comments = createCommentsService();
  const watchInfo = createWatchInfoService(watchData);
  cleanups.push(watchData.destroy);
  cleanups.push(watchInfo.destroy);
  cleanups.push(comments.destroy);
  cleanups.push(next.destroy);
  cleanups.push(feed.cancel);
  const receive = (event: Event) => {
    if (destroyed || serving) return;
    const request = parsePageMessage((event as CustomEvent).detail);
    if (!request || typeof request.id !== 'string' || request.id.length > 100 ||
        !['readSidebar', 'readAccount', 'ping', 'readPlayerVideoId', 'readVideoDetails', 'readWatchInfo', 'watchAction', 'watchPlaylists', 'watchPlaylistToggle', 'showControls', 'hideControls', 'readBrowseCategories', 'requestBrowse', 'cancelBrowse', 'openBrowseVideo', 'openBrowseRoute', 'readWatchNext', 'moreWatchNext', 'readComments', 'moreComments', 'commentReplies'].includes(request.operation as string)) return;
    const reply = (ok: boolean, value?: unknown) => {
      if (!destroyed) document.dispatchEvent(new CustomEvent(PAGE_RESPONSE, { detail: JSON.stringify({ version: 1,
        id: request.id, operation: request.operation, ok, value }) }));
    };
    if (request.operation === 'readSidebar') {
      void sidebar.read().then(value => reply(true, sidebarSnapshot(value)), () => reply(false)); return;
    }
    if (request.operation === 'readAccount') {
      void account.read(request.refresh === true).then(value => reply(true, accountSnapshot(value)), () => reply(false)); return;
    }
    if (request.operation === 'readWatchInfo') { reply(true, watchInfoSnapshot(watchInfo.read())); return; }
    if (request.operation === 'readVideoDetails') { reply(true, videoDetails(watchInfo.read().details)); return; }
    if (request.operation === 'watchAction') {
      if (!['like', 'dislike', 'subscribe'].includes(request.action as string)) return;
      void watchInfo.act(request.action as 'like' | 'dislike' | 'subscribe').then(value => reply(true, value), () => reply(false)); return;
    }
    if (request.operation === 'watchPlaylists') {
      void watchInfo.listPlaylists().then(value => reply(true, value), () => reply(false)); return;
    }
    if (request.operation === 'watchPlaylistToggle') {
      if (typeof request.key !== 'string' || !/^\d{1,3}$/.test(request.key)) return;
      void watchInfo.togglePlaylist(request.key).then(value => reply(true, value), () => reply(false)); return;
    }
    if (request.operation === 'readWatchNext') { try { reply(true, next.read()); } catch { reply(false); } return; }
    if (request.operation === 'moreWatchNext') { try { reply(true, next.more()); } catch { reply(false); } return; }
    if (request.operation === 'readComments') { try { reply(true, comments.read()); } catch { reply(false); } return; }
    if (request.operation === 'moreComments') { reply(true, comments.more(request.start === true)); return; }
    if (request.operation === 'commentReplies') {
      if (typeof request.key !== 'string' || request.key.length > 200) return;
      reply(true, comments.replies(request.key)); return;
    }
    if (request.operation === 'openBrowseRoute') {
      try {
        const endpoint = sidebarBrowseEndpoint(request.href);
        const app = document.querySelector('ytd-app') as (HTMLElement & { navigate_?: (endpoint: object) => void }) | null;
        if (!endpoint || typeof app?.navigate_ !== 'function') { reply(false); return; }
        app.navigate_(endpoint); reply(true, true);
      } catch { reply(false); }
      return;
    }
    if (request.operation === 'openBrowseVideo') {
      const short = parseShortLink(request.href);
      if (short && short.href === request.href) {
        try {
          // Use the normal native media pipeline with a dedicated Shorts surface.
          location.assign(`/watch?v=${encodeURIComponent(short.videoId)}&ytg_shorts=1`);
          reply(true, true);
        } catch { reply(false); }
        return;
      }
      const target = parseWatchLink(request.href);
      if (!target || target.href !== request.href) { reply(false); return; }
      const app = document.querySelector('ytd-app') as (HTMLElement & { navigate_?: (endpoint: object) => void }) | null;
      try {
        if (typeof app?.navigate_ !== 'function') { reply(false); return; }
        app.navigate_({ commandMetadata: { webCommandMetadata: { url: request.href, webPageType: 'WEB_PAGE_TYPE_WATCH' } },
          watchEndpoint: target.watchEndpoint });
        reply(true, true);
      } catch { reply(false); }
      return;
    }
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
        case 'readPlayerVideoId': {
          // Playback readiness must not wait for the metadata API. Return only
          // the native player's identity, including its old ID during SPA reuse.
          let id: unknown;
          try { id = player?.getVideoData?.()?.video_id; } catch { /* Try the response API. */ }
          if (typeof id !== 'string' || !/^[\w-]{1,200}$/.test(id)) {
            try { id = player?.getPlayerResponse?.()?.videoDetails?.videoId; } catch { id = undefined; }
          }
          value = typeof id === 'string' && /^[\w-]{1,200}$/.test(id) ? id : undefined;
          break;
        }
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
      if (before !== location.pathname + location.search) { next.routeChanged(); comments.routeChanged(); watchInfo.routeChanged(); }
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
  window.addEventListener('popstate', next.routeChanged);
  window.addEventListener('popstate', comments.routeChanged);
  window.addEventListener('popstate', watchInfo.routeChanged);
  cleanups.push(() => window.removeEventListener('popstate', watchInfo.routeChanged));
  cleanups.push(() => window.removeEventListener('popstate', comments.routeChanged));
  cleanups.push(() => window.removeEventListener('popstate', next.routeChanged));
  window.addEventListener('pagehide', pagehide);
  cleanups.push(() => window.removeEventListener('pagehide', pagehide));
  host[key] = dispose;
  return dispose;
}
