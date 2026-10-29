import { homeFilterDefaults, normalizeHomeFilter, homeFilterActive } from '../shared/home-filter';
import { createPageClient } from '../bridge/page-client';
import { createApp, nextTick, reactive, watch } from 'vue';
import { ui } from './ui-api';
import type { Pinia } from 'pinia';
import type { BrowseDependencies } from '../../types/ports';
import type { BrowseSnapshot } from '../shared/browse-data';
import { useBrowseStore } from '../app/browse-store';
import BrowsePage from './BrowsePage.vue';
import { createBrowseFeedController } from '../app/browse-feed-controller';
import { readBrowseReturn, saveBrowseReturn } from '../app/browse-history';
import css from './browse-grid.css?inline';
import { createFeedClient } from '../bridge/feed-client';
import { mountSearchBar } from '../search/mount-search-bar';
import { browseHostId, pageActiveElement } from '../shared/page-dom';
import themeCss from './theme.css?inline';
import { mountBrowseMode } from './browse-mode';
import { shortsQueueKey } from '../shared/shorts-route';
import { isInnerTubeBrowseRoute, isNativeFlowRoute } from '../shared/explore-pages';
import modeCss from './browse-mode.css?inline';
import accountCss from './account-page.css?inline';
import playlistCss from './playlist-card.css?inline';
import shortsCss from './shorts-card.css?inline';
import { YTGamepadControllerStyle } from '../input/controller-style';

import { videoGridDefaults, normalizeVideoGrid } from '../shared/video-grid';
import type { ApplicationChannel } from '../../types/ports';

export function mountBrowseSurface(pinia: Pinia, { runtime, core, isMenuOpen, prepareVideo }: BrowseDependencies, channel?: ApplicationChannel, mountChrome?: (node: HTMLElement) => void) {
  const lifecycle = runtime.scope('browse-surface');
  const browseMode = mountBrowseMode(runtime, core);
  lifecycle.cleanup(browseMode.destroy);
  const gridSettings = reactive({ ...videoGridDefaults });
  let filters = { ...homeFilterDefaults }, subscriptions = new Set<string>(), subscriptionVersion = 0;
  const pageAccess = createPageClient(); lifecycle.cleanup(() => pageAccess.destroy?.());
  async function readSubscriptions() {
    const version = ++subscriptionVersion;
    if (!filters.homeExemptSubscribed || !homeFilterActive(filters)) return;
    const guide = await pageAccess.readSidebar?.();
    if (lifecycle.destroyed || version !== subscriptionVersion) return;
    const next = new Set(guide?.subscribedChannelIds || []);
    if (next.size !== subscriptions.size || [...next].some(id => !subscriptions.has(id))) { subscriptions = next; feedController.refilter(); }
  }
  function receive(data: import("../../types/ports").ApplicationMessage) {
    if (data?.source === 'yt-gamepad-settings' && data.values && typeof data.values === 'object') {
      Object.assign(gridSettings, normalizeVideoGrid({ ...data.values }));
      const next = normalizeHomeFilter(data.values);
      if (JSON.stringify(next) !== JSON.stringify(filters)) { filters = next; feedController.refilter(); void readSubscriptions(); }
    }
  }
  if (channel) lifecycle.cleanup(channel.subscribe(receive));
  else lifecycle.listen(window, 'message', e => { if (e.source === window && e.origin === location.origin) receive(e.data); });
  const independentFeed = () => isInnerTubeBrowseRoute(location.pathname + location.search);
  const store = useBrowseStore(pinia);
  const feed = createFeedClient();
  lifecycle.cleanup(feed.destroy);
  let freshHomeNavigation = false;
  let returnView: ReturnType<typeof readBrowseReturn>;
  const returnViews = new Map<string, NonNullable<typeof returnView>>();
  const feedController = createBrowseFeedController({
    store, feed, getFilters: () => filters, getSubscriptions: () => subscriptions,
    unavailable: () => { /* The grid renders request errors with its retry action. */ },
    getRoute: () => location.pathname + location.search,
    isVisible: () => !lifecycle.destroyed && document.documentElement.classList.contains('ytg-browse'),
    isRestoring: () => core.restoring,
    restoreState: () => {
      const route = location.pathname + location.search;
      if (freshHomeNavigation && location.pathname === '/') { freshHomeNavigation = false; returnView = undefined; return; }
      returnView = readBrowseReturn(history, route) || returnViews.get(route);
      return returnView;
    },
    changed: publishFeed,
    loadingChanged: loading => { host.dataset.feedLoading = String(loading); },
    afterRender: () => nextTick(),
    canResetFocus: () => !sidebarHasFocus() && !categoryHasFocus() && !headerHasFocus() && !isMenuOpen() && !core.hasTemporaryLayer && !core.restoring,
    resetFocus: () => core.resetContentFocus()
  });
  function resetFeed(preserveView = false) {
    feedController.reset(preserveView);
    if (!preserveView && document.documentElement.classList.contains('ytg-api-categories'))
      document.documentElement.classList.remove('ytg-api-categories');
  }
  const host = document.createElement('div');
  host.id = 'ytg-browse-grid'; host.hidden = true;
  const shell = document.createElement('div');
  shell.id = browseHostId; shell.hidden = true;
  const shadow = shell.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  // Page-level mode/theme selectors must cross the boundary explicitly.
  const insideShadow = (text: string) => text.replaceAll(':root', ':host').replace(/html((?:\.[\w-]+|\[[^\]]+\]|:not\([^)]*\))*)/g, ':host-context(html$1)');
  style.textContent = `:host{all:initial;display:block;position:fixed;inset:0;width:100%;height:100dvh;min-width:0;z-index:2100;background:var(--ytg-client-background);font:var(--ytg-font-body)/var(--ytg-line-body) var(--ytg-font-family);color:var(--ytg-text)}:host([hidden]){display:none!important}*,*::before,*::after{box-sizing:border-box}button,input{font:inherit} ${insideShadow(themeCss)} ${insideShadow(css)} ${modeCss}`;
  const mount = document.createElement('div'); mount.style.height = '100%';
  style.textContent += accountCss + insideShadow(playlistCss) + insideShadow(shortsCss);
  if (YTGamepadControllerStyle) {
    style.textContent += YTGamepadControllerStyle.css;
    lifecycle.cleanup(YTGamepadControllerStyle.register(shadow));
  }
  host.append(mount); shadow.append(style, host); if (mountChrome) mountChrome(shell); else document.documentElement.append(shell);
  let retryTimer: number | undefined, pendingRoute = false, focusWanted = false;
  let browseVisible = false, headerVisible = false, layoutPending = false;
  let revision = 0;
  let emptySnapshot: BrowseSnapshot = { route: '', items: [], canLoadMore: false };
  let lastSnapshot: BrowseSnapshot | undefined;
  const sidebarHasFocus = () => Boolean(pageActiveElement()?.closest('#ytg-browse-sidebar,#ytg-subscription-channels') || core.current?.closest('#ytg-browse-sidebar,#ytg-subscription-channels'));
  const categoryHasFocus = () => Boolean(pageActiveElement()?.closest('#ytg-browse-categories') || core.current?.closest('#ytg-browse-categories'));
  const headerHasFocus = () => Boolean(pageActiveElement()?.closest('#ytg-browse-top') || core.current?.closest('#ytg-browse-top'));
  const ownsFocus = () => !sidebarHasFocus() && !categoryHasFocus() && !headerHasFocus() && !isMenuOpen() && !core.hasTemporaryLayer && !core.restoring &&
    (host.contains(pageActiveElement()) || focusWanted);
  const more = (manual = false) => {
    if (feedController.active) { void feedController.changeCategory(store.category, true, manual); return; }
  };
  const openSettings = () => {
    if (ui.openPanel('settings')) return;
    if (channel) channel.publish({ source: 'yt-gamepad-show-settings' });
    else window.postMessage({ source: 'yt-gamepad-show-settings' }, location.origin);
  };
  for (const [id, selector] of [['search', '#ytg-client-search input'], ['content', '[data-browse-id]'],
    ['categories', '#ytg-browse-categories [data-ytg-category]'], ['sidebar', '#ytg-browse-sidebar a']] as const) {
    lifecycle.cleanup(ui.registerFocus(id, () => {
      if (lifecycle.destroyed || pendingRoute || isMenuOpen() || core.hasTemporaryLayer || ui.state.openPanels.length) return false;
      const target = host.querySelector<HTMLElement>(selector);
      if (!target || !target.isConnected || !target.getClientRects().length) return false;
      core.refresh(); core.focus(target); return pageActiveElement() === target;
    }));
  }
  const refreshHome = () => {
    if (pendingRoute) return;
    freshHomeNavigation = location.pathname !== '/';
    for (const route of returnViews.keys()) if (/^\/(?:\?|$)/.test(route)) returnViews.delete(route);
    if (location.pathname === '/') {
      const grid = host.querySelector('[data-ytg-browse-grid]');
      if (grid) grid.scrollTop = 0;
    }
    void feedController.refreshHome();
  };
  const shellState = reactive({ unsupported: '', unavailable: false });
  const retryFeed = () => {
    shellState.unavailable = false; store.error = '';
    if (feedController.active) void feedController.changeCategory(store.category);
    else { awaitingRoute = ''; initializeFeed(); publishFeed(true); }
  };
  const app = createApp(BrowsePage, { shellState, retryFeed, openOriginal: () => { void browseMode.change('youtube'); }, refreshHome, browseMode, gridSettings, ownsFocus, more, openSettings, focusAccount: (node: HTMLElement) => core.focus(node), refreshNavigation: () => core.refresh(), changeCategory: (id: string) => { if (!pendingRoute) void feedController.changeCategory(id); }, open: (id: string) => {
    if (!pendingRoute && !isMenuOpen() && !core.hasTemporaryLayer) {
      if (feedController.active) {
        const item = store.snapshot.items.find(item => item.id === id);
        if (item) {
          if (item.id.startsWith('short:')) {
            try {
              sessionStorage.setItem(shortsQueueKey, JSON.stringify({
                ids: store.snapshot.items.filter(card => card.id.startsWith('short:')).slice(0, 200).map(card => card.id.slice(6)),
                currentId: item.id.slice(6),
                returnTo: location.pathname + location.search
              }));
            } catch { /* Playback remains available without a saved queue. */ }
          }
          store.select(id);
          const saved = feedController.captureReturnState(host.querySelector('[data-ytg-browse-grid]')?.scrollTop || 0);
          if (saved) { returnViews.set(saved.snapshot.route, saved); saveBrowseReturn(history, saved); }
          // Shorts keep YouTube's native player and do not enter the watch takeover.
          if (!item.href.startsWith('/playlist?') && !item.id.startsWith('short:') && prepareVideo && !prepareVideo(item.href)) return;
          if (!feed.openVideo(item.href)) location.assign(item.href);
        }
      }
    }
  } });
  app.use(pinia); app.mount(mount);
  lifecycle.cleanup(mountSearchBar({ runtime, core }, shadow));
  // Observers outside a shadow root cannot see its mutations.
  document.dispatchEvent(new Event('ytg-browse-mounted'));
  const headerSelector = '#ytg-browse-top';
  const measuredHeaders = new Set<HTMLElement>();
  let awaitingRoute = '', awaitingSince = 0;
  const headerResize = new ResizeObserver(scheduleLayout);
  lifecycle.cleanup(() => { headerResize.disconnect(); measuredHeaders.clear(); });
  // Page classes only control visibility. Selection/theme class changes must
  // not initialize the feed, measure its header or restore focus.
  function syncVisibility() {
    if (lifecycle.destroyed) return;
    const enabled = document.documentElement.classList.contains('ytg-browse');
    const root = document.documentElement;
    const windowedWatch = root.dataset.ytgPlaybackLayout === 'windowed' &&
      (root.classList.contains('ytg-watch-layout') || root.classList.contains('ytg-player-primed'));
    const headerEnabled = (windowedWatch || root.classList.contains('ytg-theater') && (!root.hasAttribute('data-ytg-native') || root.dataset.ytgAdaptation === 'fallback') &&
      root.getAttribute('data-ytg-browse-mode') !== 'loading' && !root.classList.contains('ytg-watch-layout')) &&
      !root.classList.contains('ytg-shorts-player') &&
      !document.fullscreenElement && !location.pathname.startsWith('/shorts/');
    const started = enabled && !browseVisible;
    if (enabled === browseVisible && headerEnabled === headerVisible) return;
    const stopped = !enabled && browseVisible;
    browseVisible = enabled; headerVisible = headerEnabled;
    // Hide immediately at takeover, before any data or Vue nextTick readiness.
    host.hidden = !headerEnabled;
    shell.hidden = !headerEnabled;
    shell.toggleAttribute('data-header-only', !enabled);
    if (root.classList.contains('ytg-browse-header') !== headerEnabled)
      root.classList.toggle('ytg-browse-header', headerEnabled);
    if (document.documentElement.classList.contains('ytg-custom-browse') !== enabled)
      document.documentElement.classList.toggle('ytg-custom-browse', enabled);
    if (!enabled) {
      awaitingRoute = ''; lifecycle.clearTimeout(retryTimer); retryTimer = undefined;
      if (stopped) { ++revision; resetFeed(); }
      pendingRoute = false; focusWanted = false; return;
    }
    // Keep the mounted list and category bar until the destination is known.
    // Clearing them on navigate-start produces an empty frame on every click.
    if (pendingRoute) return;
    if (started) { initializeFeed(); publishFeed(true); }
    scheduleLayout();
  }
  // Only route/visibility changes and a bounded late-session retry initialize
  // data. A feed response publishes its snapshot without re-entering here.
  function initializeFeed() {
    if (lifecycle.destroyed || !browseVisible || pendingRoute) return;
    lifecycle.clearTimeout(retryTimer); retryTimer = undefined;
    if (!independentFeed()) { shellState.unsupported = location.pathname + location.search; return; }
    shellState.unsupported = '';
    if (feedController.initialize()) {
      shellState.unavailable = false;
      awaitingRoute = '';
      if (!document.documentElement.classList.contains('ytg-api-categories')) document.documentElement.classList.add('ytg-api-categories');
    } else if (independentFeed()) {
      const route = location.pathname + location.search;
      if (awaitingRoute !== route) { awaitingRoute = route; awaitingSince = Date.now(); }
      if (Date.now() - awaitingSince >= 8000) { shellState.unavailable = true; store.loading = false; return; }
      // ytcfg can appear without a DOM mutation or a YouTube page event.
      // Retry only while the visible API feed has not been initialized.
      retryTimer = lifecycle.timeout(() => { retryTimer = undefined; initializeFeed(); publishFeed(); }, 100);
    }
  }
  function measureLayout() {
    if (lifecycle.destroyed || !browseVisible || !headerVisible || pendingRoute) return;
    let top = 56, mastheadBottom = 56;
    const headers = new Set(shadow.querySelectorAll<HTMLElement>(headerSelector));
    for (const bar of measuredHeaders) if (!headers.has(bar)) { headerResize.unobserve(bar); measuredHeaders.delete(bar); }
    for (const bar of headers) {
      if (!measuredHeaders.has(bar)) { measuredHeaders.add(bar); headerResize.observe(bar); }
      if (!bar.closest('[hidden],[aria-hidden="true"]')) {
        const bounds = bar.getBoundingClientRect();
        if (bounds.height && bounds.bottom > 0 && bounds.bottom < innerHeight / 2) {
          top = Math.max(top, bounds.bottom);
          if (bar.matches('#ytg-browse-top')) mastheadBottom = Math.max(mastheadBottom, bounds.bottom);
        }
      }
    }
    // API categories sit above the grid even before the native chip bar mounts.
    const categoryHeight = parseFloat(getComputedStyle(host).getPropertyValue('--ytg-client-categories')) || 56;
    if (store.categories.length) top = Math.max(top, mastheadBottom + categoryHeight);
    const value = `${top}px`;
    if (host.style.getPropertyValue('--ytg-browse-top') !== value) host.style.setProperty('--ytg-browse-top', value);
  }
  function scheduleLayout() {
    if (lifecycle.destroyed || !browseVisible || !headerVisible || layoutPending) return;
    layoutPending = true;
    lifecycle.frame(() => { layoutPending = false; measureLayout(); });
  }
  // List updates own rendering/navigation. Resize and page-class notifications
  // never enter this path, so they cannot refocus the selected video.
  function publishFeed(started = false) {
    if (lifecycle.destroyed || !browseVisible || pendingRoute) return;
    const route = location.pathname + location.search;
    if (emptySnapshot.route !== route) emptySnapshot = { route, items: [], canLoadMore: false };
    const next = feedController.snapshot || emptySnapshot;
    if (next === lastSnapshot && !started) return;
    lastSnapshot = next;
    focusWanted = !sidebarHasFocus() && (host.contains(pageActiveElement()) || host.contains(core.current) ||
      (started && document.documentElement.classList.contains('ytg-gamepad-input') && !isMenuOpen()));
    store.apply(next);
    const currentRevision = ++revision;
    void nextTick().then(() => restorePresentation(currentRevision));
  }
  async function restorePresentation(currentRevision: number) {
    if (lifecycle.destroyed || !document.documentElement.classList.contains('ytg-browse') || currentRevision !== revision) return;
    const preferredId = store.activeItemId, wantedFocus = ownsFocus();
    core.refresh();
    if (returnView) {
      const saved = returnView; returnView = undefined;
      const grid = host.querySelector('[data-ytg-browse-grid]');
      if (grid) {
        const detail = { scrollTop: saved.scrollTop, ready: undefined as Promise<void> | undefined };
        grid.dispatchEvent(new CustomEvent('ytg-browse-restore', { detail }));
        if (detail.ready) await detail.ready; else grid.scrollTop = saved.scrollTop;
      }
      if (lifecycle.destroyed || currentRevision !== revision) return;
      if (!sidebarHasFocus() && !isMenuOpen() && !core.hasTemporaryLayer && !core.restoring) {
        const node = Array.from(host.querySelectorAll<HTMLAnchorElement>('[data-browse-id]'))
          .find(item => item.dataset.browseId === (store.snapshot.items.some(video => video.id === saved.activeItemId) ? saved.activeItemId : preferredId));
        if (node) core.focus(node);
      }
      focusWanted = false;
      return;
    }
    if (wantedFocus && !isMenuOpen() && !core.hasTemporaryLayer && !core.restoring) {
      const node = Array.from(host.querySelectorAll<HTMLAnchorElement>('[data-browse-id]'))
        .find(item => item.dataset.browseId === preferredId);
      if (node) core.focus(node);
      else { const fallback = host.querySelector<HTMLElement>('[data-browse-more],#ytg-browse-categories button'); if (fallback) core.focus(fallback); }
    }
    focusWanted = false;
  }
  // Category presence changes the grid inset; card selection and pagination
  // do not. Observe Vue state directly rather than rediscovering it from DOM.
  lifecycle.cleanup(watch(() => store.categories.length > 0, scheduleLayout, { flush: 'post' }));
  lifecycle.cleanup(watch(gridSettings, scheduleLayout, { deep: true, flush: 'post' }));
  const source = lifecycle.observer(() => syncVisibility());
  source.observe(document.documentElement,
    { attributes: true, attributeFilter: ['class', 'data-ytg-native', 'data-ytg-browse-mode', 'data-ytg-playback-layout'] });
  let browseSaveTimer: number | undefined;
  const rememberBrowse = () => {
    if (!browseVisible || pendingRoute || core.restoring) return;
    const saved = feedController.captureReturnState(host.querySelector('[data-ytg-browse-grid]')?.scrollTop || 0);
    if (saved) {
      returnViews.set(saved.snapshot.route, saved);
      lifecycle.clearTimeout(browseSaveTimer);
      browseSaveTimer = lifecycle.timeout(() => {
        if (saved.snapshot.route === location.pathname + location.search) saveBrowseReturn(history, saved);
      }, 120);
    }
  };
  lifecycle.listen(window, 'pagehide', () => {
    const saved = feedController.captureReturnState(host.querySelector('[data-ytg-browse-grid]')?.scrollTop || 0);
    if (saved) saveBrowseReturn(history, saved);
  });
  lifecycle.listen(shadow, 'scroll', rememberBrowse, true);
  lifecycle.listen(shadow, 'focusin', () => { lifecycle.frame(rememberBrowse); });
  lifecycle.listen(document, 'yt-navigate-start', () => {
    const saved = feedController.captureReturnState(host.querySelector('[data-ytg-browse-grid]')?.scrollTop || 0);
    if (saved) {
      returnViews.set(saved.snapshot.route, saved);
      saveBrowseReturn(history, saved);
      if (returnViews.size > 30) returnViews.delete(returnViews.keys().next().value!);
    }
    ++revision; pendingRoute = true;
    lifecycle.clearTimeout(retryTimer); retryTimer = undefined;
    resetFeed(true); syncVisibility();
  });
  const finishNavigation = () => {
    if (pendingRoute || (feedController.snapshot && feedController.snapshot.route !== location.pathname + location.search)) resetFeed();
    shellState.unsupported = ''; shellState.unavailable = false;
    pendingRoute = false; syncVisibility(); initializeFeed(); publishFeed(); scheduleLayout();
  };
  lifecycle.listen(document, 'yt-navigate-finish', () => { finishNavigation(); void readSubscriptions(); });
  lifecycle.listen(document, 'yt-page-data-updated', () => { void readSubscriptions(); });
  lifecycle.listen(document, 'yt-navigate-cancel', finishNavigation);
  lifecycle.listen(document, 'yt-navigate-error', finishNavigation);
  lifecycle.listen(document, 'click', ((event: MouseEvent) => {
    const exit = event.composedPath().find(node => node instanceof HTMLElement && node.hasAttribute('data-ytg-exit-shell')) as HTMLElement | undefined;
    if (exit && exit.getRootNode() === document.getElementById('ytg-fallback-notice')?.shadowRoot) {
      if (event.isTrusted) { event.preventDefault(); void browseMode.change('youtube'); }
      return;
    }
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.defaultPrevented ||
        browseMode.state.mode !== 'gamepad' || !document.documentElement.classList.contains('ytg-theater')) return;
    const link = event.composedPath().find(node => node instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
    if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
    let url: URL;
    try { url = new URL(link.href, location.origin); } catch { return; }
    if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol) ||
        url.pathname === location.pathname && url.search === location.search && url.hash) return;
    const href = url.pathname + url.search;
    if (isNativeFlowRoute(href)) return;
    event.preventDefault(); event.stopPropagation();
    if (href === '/' && location.pathname === '/') { refreshHome(); return; }
    if (href === location.pathname + location.search) return;
    if (url.pathname === '/watch' || url.pathname.startsWith('/shorts/')) {
      if (url.pathname === '/watch' && prepareVideo && !prepareVideo(href)) return;
      if (!feed.openVideo(href)) location.assign(href);
      return;
    }
    if (isInnerTubeBrowseRoute(href) && pageAccess.openBrowseRoute?.(href)) return;
    // Keep unsupported destinations and router failures inside the mounted shell.
    document.documentElement.dataset.ytgVirtualRoute = 'true';
    if (location.pathname === '/watch' || location.pathname.startsWith('/shorts/')) {
      // Browsing must not leave an invisible native video playing in the old document.
      document.querySelectorAll<HTMLVideoElement>('video').forEach(video => video.pause());
    }
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState(null, '', href);
    document.dispatchEvent(new Event('yt-navigate-finish'));
  }) as EventListener, true);
  lifecycle.listen(window, 'resize', scheduleLayout);
  lifecycle.listen(document, 'fullscreenchange', syncVisibility);
  if (window.visualViewport) lifecycle.listen(window.visualViewport, 'resize', scheduleLayout);
  lifecycle.listen(window, 'popstate', finishNavigation);
  lifecycle.cleanup(() => {
    resetFeed();
    feedController.destroy();
    app.unmount(); shell.remove(); document.documentElement.classList.remove('ytg-custom-browse', 'ytg-browse-header');
  });
  syncVisibility();
  return lifecycle.destroy;
}
