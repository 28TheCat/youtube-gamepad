import { createAccountService } from '../sites/youtube-account';
import { createNotificationService, notificationSnapshot } from '../sites/youtube-notifications';
import { createSidebarService } from '../sites/youtube-sidebar';
import { sidebarSnapshot } from '../shared/sidebar-data';
import { createWatchDataService } from '../sites/youtube-watch-data';
import type { YouTubePlayer, DisposerHost } from '../../types/core';
import { PAGE_REQUEST, PAGE_RESPONSE, PAGE_HISTORY, parsePageMessage, videoDetails, watchInfoSnapshot, accountSnapshot, playbackQualities } from './page-protocol';
import { createYouTubeFeedService } from '../sites/youtube-feed';
import { parseWatchLink, parseShortLink, parsePlaylistLink } from '../shared/watch-link';
import { createWatchNextService } from '../sites/youtube-next';
import { createCommentsService } from '../sites/youtube-comments';
import { commentLanguage } from '../shared/comment-language';
import { sidebarBrowseEndpoint } from '../shared/explore-pages';
import { createWatchInfoService } from '../sites/youtube-watch-info';
import { createShortsService } from '../sites/youtube-shorts';

export function startPageServer() {
  const key = Symbol.for('yt-gamepad.page.dispose');
  const host = window as unknown as DisposerHost;
  host[key]?.();
  let destroyed = false;
  let serving = false;
  const cleanups: (() => void)[] = [];
  const account = createAccountService();
  const notifications = createNotificationService();
  cleanups.push(notifications.destroy);
  const sidebar = createSidebarService();
  cleanups.push(sidebar.destroy);
  cleanups.push(account.destroy);
  const feed = createYouTubeFeedService();
  const watchData = createWatchDataService();
  const next = createWatchNextService(watchData);
  const comments = createCommentsService();
  const shorts = createShortsService();
  cleanups.push(shorts.destroy);
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
        !['readNotifications', 'shortsRecommendations', 'playShorts', 'readShortsSettings', 'shortsSetting', 'readSidebar', 'readAccount', 'ping', 'readPlayerVideoId', 'readVideoDetails', 'readWatchInfo', 'watchAction', 'watchPlaylists', 'watchPlaylistToggle', 'showControls', 'hideControls', 'readBrowseCategories', 'requestBrowse', 'cancelBrowse', 'openBrowseVideo', 'openBrowseRoute', 'readWatchNext', 'moreWatchNext', 'readComments', 'moreComments', 'commentReplies', 'commentTranslate', 'commentPost', 'commentSort'].includes(request.operation as string)) return;
    const reply = (ok: boolean, value?: unknown) => {
      if (!destroyed) document.dispatchEvent(new CustomEvent(PAGE_RESPONSE, { detail: JSON.stringify({ version: 1,
        id: request.id, operation: request.operation, ok, value }) }));
    };
    if (request.operation === 'shortsRecommendations' || request.operation === 'playShorts') {
      if (!parseShortLink(location.pathname) || typeof request.videoId !== 'string' || !/^[\w-]{1,100}$/.test(request.videoId)) { reply(false); return; }
      if (request.operation === 'shortsRecommendations') {
        void shorts.read(request.videoId, request.refresh === true).then(value => reply(true, value), () => reply(false)); return;
      }
      try {
        const player = document.querySelector<YouTubePlayer>('[data-ytg-shorts-media],ytd-shorts #shorts-player,ytd-shorts .html5-video-player');
        if (typeof player?.loadVideoById !== 'function') { reply(false); return; }
        player.loadVideoById(request.videoId);
        history.replaceState(history.state, '', `/shorts/${encodeURIComponent(request.videoId)}`);
        reply(true, true);
      } catch { reply(false); }
      return;
    }
    if (request.operation === 'readShortsSettings' || request.operation === 'shortsSetting') {
      try {
        const target = parseShortLink(location.pathname);
        const reel = document.querySelector('ytd-reel-video-renderer[is-active],ytd-reel-video-renderer[active]');
        const player = reel?.querySelector<YouTubePlayer>('.html5-video-player,#shorts-player');
        const videoId = player?.getVideoData?.()?.video_id || player?.getPlayerResponse?.()?.videoDetails?.videoId;
        if (!target || !player || videoId !== target.videoId) { reply(false); return; }
        const available = player.getAvailableQualityLevels?.() || [];
        const qualities = playbackQualities.filter(value => available.includes(value) && value !== 'auto');
        if (qualities.length && (player.setPlaybackQualityRange || player.setPlaybackQuality)) qualities.unshift('auto');
        else qualities.length = 0;
        const captionButton = player.querySelector<HTMLButtonElement>('.ytp-subtitles-button');
        const tracks = player.getOption?.('captions', 'tracklist');
        const nativeCaptions = !!captionButton && !captionButton.disabled && captionButton.getAttribute('aria-disabled') !== 'true' && getComputedStyle(captionButton).display !== 'none';
        const captionsAvailable = !!player.toggleSubtitles && Array.isArray(tracks) && tracks.length > 0 || nativeCaptions;
        if (request.operation === 'readShortsSettings') {
          reply(true, { videoId, qualities, quality: player.getPlaybackQuality?.() || '', captionsAvailable,
            captionsEnabled: player.isSubtitlesOn ? player.isSubtitlesOn() === true : captionButton?.getAttribute('aria-pressed') === 'true' }); return;
        }
        if (request.videoId !== videoId) { reply(false); return; }
        if (request.action === 'captions' && captionsAvailable) {
          if (player.toggleSubtitles) player.toggleSubtitles(); else captionButton!.click();
          reply(true, true); return;
        }
        if (request.action === 'quality' && typeof request.quality === 'string' && qualities.includes(request.quality as typeof playbackQualities[number])) {
          if (player.setPlaybackQualityRange) player.setPlaybackQualityRange(request.quality);
          else player.setPlaybackQuality?.(request.quality);
          reply(true, true); return;
        }
        reply(false);
      } catch { reply(false); }
      return;
    }
    if (request.operation === 'readSidebar') {
      void sidebar.read().then(value => reply(true, sidebarSnapshot(value)), () => reply(false)); return;
    }
    if (request.operation === 'readAccount') {
      void account.read(request.refresh === true).then(value => reply(true, accountSnapshot(value)), () => reply(false)); return;
    }
    if (request.operation === 'readNotifications') {
      if (!['count', 'list', 'more'].includes(request.mode as string)) { reply(false); return; }
      void notifications.read(request.mode as 'count' | 'list' | 'more').then(value => reply(true, notificationSnapshot(value)), () => reply(false)); return;
    }
    if (request.operation === 'readWatchInfo') { reply(true, watchInfoSnapshot(watchInfo.read())); return; }
    if (request.operation === 'readVideoDetails') { reply(true, videoDetails(watchInfo.read().details)); return; }
    if (request.operation === 'watchAction') {
      if (!['like', 'dislike', 'subscribe', 'unsubscribe', 'notificationsAll', 'notificationsPersonalized', 'notificationsNone'].includes(request.action as string)) return;
      void watchInfo.act(request.action as 'like' | 'dislike' | 'subscribe' | 'unsubscribe' | 'notificationsAll' | 'notificationsPersonalized' | 'notificationsNone').then(value => reply(true, value), () => reply(false)); return;
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
    if (request.operation === 'commentPost') {
      if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 4000 ||
          request.key !== undefined && (typeof request.key !== 'string' || !request.key || request.key.length > 200)) { reply(false); return; }
      void comments.post(request.text, request.key as string | undefined).then(value => reply(true, value), () => reply(false)); return;
    }
    if (request.operation === 'commentSort') {
      if (request.sort !== 'TOP_COMMENTS' && request.sort !== 'NEWEST_FIRST') { reply(false); return; }
      reply(true, comments.changeSort(request.sort)); return;
    }
    if (request.operation === 'commentTranslate') {
      if (typeof request.key !== 'string' || !request.key || request.key.length > 200 || !commentLanguage(request.language)) return;
      reply(true, comments.translate(request.key, request.language as string)); return;
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
      const playlist = parsePlaylistLink(request.href);
      if (playlist && playlist.href === request.href) {
        try {
          const app = document.querySelector('ytd-app') as (HTMLElement & { navigate_?: (endpoint: object) => void }) | null;
          const endpoint = sidebarBrowseEndpoint(playlist.href);
          if (!endpoint || typeof app?.navigate_ !== 'function') { reply(false); return; }
          app.navigate_(endpoint); reply(true, true);
        } catch { reply(false); }
        return;
      }
      const short = parseShortLink(request.href);
      if (short && short.href === request.href) {
        try {
          const app = document.querySelector('ytd-app') as (HTMLElement & { navigate_?: (endpoint: object) => void }) | null;
          if (typeof app?.navigate_ === 'function') {
            app.navigate_({ commandMetadata: { webCommandMetadata: { url: short.href, webPageType: 'WEB_PAGE_TYPE_SHORTS' } },
              reelWatchEndpoint: { videoId: short.videoId } });
            reply(true, true); return;
          }
          if (location.pathname.startsWith('/shorts/')) { reply(false); return; }
          // Shorts must start the native reel pipeline, including from our feed.
          location.assign(short.href);
          reply(true, true);
        } catch {
          if (location.pathname.startsWith('/shorts/')) { reply(false); return; }
          try { location.assign(short.href); reply(true, true); } catch { reply(false); }
        }
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
      const player = request.operation === 'ping' ? null : document.querySelector<YouTubePlayer>(
        request.operation === 'readPlayerVideoId' && location.pathname.startsWith('/shorts/')
          ? '[data-ytg-shorts-media],ytd-reel-video-renderer[is-active] .html5-video-player,ytd-reel-video-renderer[active] .html5-video-player,ytd-shorts #shorts-player'
          : '#movie_player');
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
