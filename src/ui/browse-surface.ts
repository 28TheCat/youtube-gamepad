import { createApp, nextTick, reactive } from 'vue';
import type { Pinia } from 'pinia';
import type { BrowseDependencies } from '../../types/ports';
import { createYouTubeBrowseAdapter } from '../sites/youtube-browse';
import { useBrowseStore } from '../app/browse-store';
import BrowsePage from './BrowsePage.vue';
import { createBrowseFeedController } from '../app/browse-feed-controller';
import { readBrowseReturn, saveBrowseReturn } from '../app/browse-history';
import { createNativeBrowsePager } from '../app/browse-native-pager';
import css from './browse-grid.css?inline';
import { createFeedClient } from '../bridge/feed-client';
import { mountSearchBar } from '../search/mount-search-bar';

import { videoGridDefaults, normalizeVideoGrid } from '../shared/video-grid';
import type { ApplicationChannel } from '../../types/ports';

export function mountBrowseSurface(pinia: Pinia, { runtime, core, isMenuOpen }: BrowseDependencies, channel?: ApplicationChannel) {
  const lifecycle = runtime.scope('browse-surface');
  lifecycle.cleanup(mountSearchBar({ runtime, core }));
  const gridSettings = reactive({ ...videoGridDefaults });
  function receive(data: import("../../types/ports").ApplicationMessage) {
    if (data?.source === 'yt-gamepad-settings' && data.values && typeof data.values === 'object')
      Object.assign(gridSettings, normalizeVideoGrid({ ...data.values }));
  }
  if (channel) lifecycle.cleanup(channel.subscribe(receive));
  else lifecycle.listen(window, 'message', e => { if (e.source === window && e.origin === location.origin) receive(e.data); });
  const adapter = createYouTubeBrowseAdapter();
  const store = useBrowseStore(pinia);
  const feed = createFeedClient();
  lifecycle.cleanup(feed.destroy);
  let returnView: ReturnType<typeof readBrowseReturn>;
  let historyReturn = readBrowseReturn(history, location.pathname + location.search);
  const feedController = createBrowseFeedController({
    store, feed,
    getRoute: () => location.pathname + location.search,
    isVisible: () => !lifecycle.destroyed && !host.hidden,
    isRestoring: () => core.restoring,
    restoreState: () => {
      returnView = historyReturn;
      historyReturn = undefined;
      return returnView;
    },
    stopBatch,
    changed: sync,
    loadingChanged: loading => { host.dataset.feedLoading = String(loading); },
    afterRender: () => nextTick(),
    canResetFocus: () => !sidebarHasFocus() && !categoryHasFocus() && !headerHasFocus() && !isMenuOpen() && !core.hasTemporaryLayer && !core.restoring,
    resetFocus: () => core.resetContentFocus()
  });
  function resetFeed() {
    feedController.reset();
    if (document.documentElement.classList.contains('ytg-api-categories'))
      document.documentElement.classList.remove('ytg-api-categories');
  }
  const host = document.createElement('div');
  host.id = 'ytg-browse-grid'; host.hidden = true;
  const style = document.createElement('style'); style.textContent = css;
  const mount = document.createElement('div'); mount.style.height = '100%';
  host.append(style, mount); document.documentElement.append(host);
  let timer: number | undefined, pendingRoute = false, focusWanted = false;
  let lastSignature = '', revision = 0;
  const nativePager = createNativeBrowsePager({
    read: adapter.read, loadMore: adapter.loadMore,
    canLoad: () => !host.hidden && !pendingRoute && !lifecycle.destroyed,
    now: Date.now,
    timeout: (callback, delay) => lifecycle.timeout(callback, delay),
    clearTimeout: id => lifecycle.clearTimeout(id)
  });
  function stopBatch() { nativePager.stop(); }
  const sidebarHasFocus = () => Boolean(document.activeElement?.closest('#ytg-browse-sidebar') || core.current?.closest('#ytg-browse-sidebar'));
  const categoryHasFocus = () => Boolean(document.activeElement?.closest('#ytg-browse-categories') || core.current?.closest('#ytg-browse-categories'));
  const headerHasFocus = () => Boolean(document.activeElement?.closest('#ytg-browse-top') || core.current?.closest('#ytg-browse-top'));
  const ownsFocus = () => !sidebarHasFocus() && !categoryHasFocus() && !headerHasFocus() && !isMenuOpen() && !core.hasTemporaryLayer && !core.restoring &&
    (host.contains(document.activeElement) || focusWanted);
  const more = () => {
    if (feedController.active) { void feedController.changeCategory(store.category, true); return; }
    nativePager.more(store.snapshot);
  };
  const app = createApp(BrowsePage, { gridSettings, ownsFocus, more, refreshNavigation: () => core.refresh(), changeCategory: (id: string) => { void feedController.changeCategory(id); }, open: (id: string) => {
    if (!isMenuOpen() && !core.hasTemporaryLayer) {
      if (feedController.active) {
        const item = store.snapshot.items.find(item => item.id === id);
        if (item) {
          store.select(id);
          const saved = feedController.captureReturnState(host.querySelector('[data-ytg-browse-grid]')?.scrollTop || 0);
          if (saved) saveBrowseReturn(history, saved);
          location.assign(item.href);
        }
      } else adapter.open(id);
    }
  } });
  app.use(pinia); app.mount(mount);
  const headerSelector = '#ytg-browse-top';
  const measuredHeaders = new Set<HTMLElement>();
  const headerResize = new ResizeObserver(() => schedule());
  lifecycle.cleanup(() => { headerResize.disconnect(); measuredHeaders.clear(); });
  function sync() {
    if (lifecycle.destroyed) return;
    const enabled = document.documentElement.classList.contains('ytg-browse');
    const started = enabled && host.hidden;
    // Hide immediately at takeover, before any data or Vue nextTick readiness.
    host.hidden = !enabled;
    if (document.documentElement.classList.contains('ytg-custom-browse') !== enabled)
      document.documentElement.classList.toggle('ytg-custom-browse', enabled);
    if (!enabled) { stopBatch(); resetFeed(); pendingRoute = false; focusWanted = false; return; }
    if (!pendingRoute && feedController.initialize() && !document.documentElement.classList.contains('ytg-api-categories'))
      document.documentElement.classList.add('ytg-api-categories');
    let top = 80, mastheadBottom = 80;
    host.dataset.feedLoading = String(store.loading);
    const headers = new Set(document.querySelectorAll<HTMLElement>(headerSelector));
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
    if (store.categories.length) top = Math.max(top, mastheadBottom + 64);
    host.style.setProperty('--ytg-browse-top', `${top}px`);
    const next = pendingRoute ? { route: location.pathname + location.search, items: [], canLoadMore: false } :
      feedController.active && feedController.snapshot ? feedController.snapshot : adapter.read();
    const signature = JSON.stringify(next);
    if (signature === lastSignature && !started) return;
    lastSignature = signature;
    focusWanted = !sidebarHasFocus() && (host.contains(document.activeElement) || host.contains(core.current) ||
      (started && document.documentElement.classList.contains('ytg-gamepad-input') && !isMenuOpen()));
    const firstItems = !store.snapshot.items.length && !!next.items.length;
    store.apply(next);
    // Fill the initial browse view with up to three native continuation pages.
    if (!feedController.active && (started || firstItems) && next.items.length > 0 && next.items.length < 60 && next.canLoadMore) more();
    const currentRevision = ++revision;
    void nextTick().then(() => {
      if (lifecycle.destroyed || host.hidden || currentRevision !== revision) return;
      core.refresh();
      if (returnView) {
        const saved = returnView; returnView = undefined;
        if (!sidebarHasFocus() && !isMenuOpen() && !core.hasTemporaryLayer && !core.restoring) {
          const node = Array.from(host.querySelectorAll<HTMLAnchorElement>('[data-browse-id]'))
            .find(item => item.dataset.browseId === saved.activeItemId);
          if (node) core.focus(node);
        }
        const grid = host.querySelector('[data-ytg-browse-grid]');
        if (grid) grid.scrollTop = saved.scrollTop;
        focusWanted = false;
        return;
      }
      if (ownsFocus()) {
        const node = Array.from(host.querySelectorAll<HTMLAnchorElement>('[data-browse-id]'))
          .find(item => item.dataset.browseId === store.activeItemId);
        if (node) core.focus(node);
      }
      focusWanted = false;
    });
  }
  function schedule() { lifecycle.clearTimeout(timer); timer = lifecycle.timeout(sync, 100); }
  const source = lifecycle.observer(records => {
    // Mode changes hide/reveal native cards in the observer turn, without debounce.
    if (records.some(record => record.target === document.documentElement && record.type === 'attributes')) {
      sync(); return;
    }
    if (records.some(record => !host.contains(record.target) &&
      (record.target === document.documentElement || (record.target as Element).closest?.('ytd-page-manager,ytd-masthead,#masthead-container')))) schedule();
  });
  source.observe(document.documentElement, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'hidden', 'href', 'src', 'srcset', 'data-src', 'data-thumb', 'aria-hidden', 'data-ytg-native'] });
  lifecycle.listen(document, 'yt-navigate-start', () => { stopBatch(); resetFeed(); pendingRoute = true; lastSignature = ''; sync(); });
  lifecycle.listen(document, 'yt-navigate-finish', () => { pendingRoute = false; sync(); });
  const restoreAfterInterruptedNavigation = () => { pendingRoute = false; sync(); };
  lifecycle.listen(document, 'yt-navigate-cancel', restoreAfterInterruptedNavigation);
  lifecycle.listen(document, 'yt-navigate-error', restoreAfterInterruptedNavigation);
  lifecycle.listen(document, 'yt-page-data-updated', schedule);
  lifecycle.listen(window, 'resize', schedule);
  lifecycle.listen(document, 'fullscreenchange', schedule);
  if (window.visualViewport) lifecycle.listen(window.visualViewport, 'resize', schedule);
  lifecycle.listen(window, 'popstate', schedule);
  lifecycle.cleanup(() => {
    stopBatch();
    resetFeed();
    feedController.destroy();
    app.unmount(); host.remove(); document.documentElement.classList.remove('ytg-custom-browse');
  });
  sync();
  return lifecycle.destroy;
}
