import { createApp, nextTick, reactive } from 'vue';
import type { Pinia } from 'pinia';
import type { BrowseDependencies } from '../../types/ports';
import { createYouTubeBrowseAdapter } from '../sites/youtube-browse';
import { useBrowseStore } from '../app/browse-store';
import BrowseGrid from './BrowseGrid.vue';
import css from './browse-grid.css?inline';
import { createFeedClient } from '../bridge/feed-client';

import { videoGridDefaults, normalizeVideoGrid } from '../shared/video-grid';
import type { ApplicationChannel } from '../../types/ports';

export function mountBrowseSurface(pinia: Pinia, { runtime, core, isMenuOpen }: BrowseDependencies, channel?: ApplicationChannel) {
  const lifecycle = runtime.scope('browse-surface');
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
  let feedActive = false, feedVersion = 0, nextPage: string | undefined;
  let feedSnapshot: import('../sites/youtube-browse').BrowseSnapshot | undefined;
  // Keep loaded pages for SPA back navigation, including continuation items.
  // Category IDs alone are not unique across routes.
  const feeds = new Map<string, { category: string; snapshot: import('../sites/youtube-browse').BrowseSnapshot; nextPage?: string }>();
  const routeCategories = new Map<string, string>();
  const feedKey = (route: string, category: string) => JSON.stringify([route, category]);
  function cacheFeed() {
    if (!feedActive || !feedSnapshot?.items.length || store.loading || store.error) return;
    const route = feedSnapshot.route;
    routeCategories.set(route, store.category);
    const key = feedKey(route, store.category);
    feeds.delete(key);
    feeds.set(key, { category: store.category, snapshot: feedSnapshot, nextPage });
    if (feeds.size > 30) feeds.delete(feeds.keys().next().value!);
    if (routeCategories.size > 30) routeCategories.delete(routeCategories.keys().next().value!);
  }
  async function changeCategory(id: string, append = false) {
    if (host.hidden || !store.categories.some(item => item.id === id) || (append && (store.loading || !nextPage))) return;
    const page = append ? nextPage : undefined;
    if (!append) { cacheFeed(); feed.cancel(); stopBatch(); }
    const version = ++feedVersion;
    const route = location.pathname + location.search;
    feedActive = true; store.category = id; store.loading = true; store.error = '';
    host.dataset.feedLoading = 'true';
    const cached = !append && core.restoring ? feeds.get(feedKey(route, id)) : undefined;
    if (cached) {
      nextPage = cached.nextPage; feedSnapshot = cached.snapshot; store.loading = false;
      sync();
      return;
    }
    if (!append) {
      nextPage = undefined;
      feedSnapshot = { route, items: [], canLoadMore: false };
      sync();
    }
    try {
      const result = await feed.request(id, page);
      if (version !== feedVersion || host.hidden || route !== location.pathname + location.search) return;
      nextPage = result.nextPage;
      const items = new Map((append ? feedSnapshot?.items || [] : []).map(item => [item.id, item]));
      for (const item of result.items) items.set(item.id, item);
      feedSnapshot = { route, items: [...items.values()], canLoadMore: !!nextPage };
      store.loading = false;
      cacheFeed();
      sync();
      if (!append) {
        await nextTick();
        if (version === feedVersion && !isMenuOpen() && !core.hasTemporaryLayer && !core.restoring) core.resetContentFocus();
      }
    } catch {
      if (version === feedVersion) { store.loading = false; store.error = '无法加载分类视频，请重试。'; host.dataset.feedLoading = 'false'; }
    }
  }
  function resetFeed() {
    cacheFeed();
    ++feedVersion;
    if (feedActive || store.loading) feed.cancel();
    feedActive = false; feedSnapshot = undefined; nextPage = undefined;
    if (store.categories.length) store.categories = [];
    store.category = ''; store.loading = false; store.error = '';
    if (document.documentElement.classList.contains('ytg-api-categories')) document.documentElement.classList.remove('ytg-api-categories');
  }
  const host = document.createElement('div');
  host.id = 'ytg-browse-grid'; host.hidden = true;
  const style = document.createElement('style'); style.textContent = css;
  const mount = document.createElement('div'); mount.style.height = '100%';
  host.append(style, mount); document.documentElement.append(host);
  let timer: number | undefined, pendingRoute = false, focusWanted = false;
  let lastSignature = '', lastMore = 0, revision = 0;
  let batchTimer: number | undefined;
  let batch: { route: string; ids: Set<string>; remaining: number; deadline: number } | undefined;
  function stopBatch() { lifecycle.clearTimeout(batchTimer); batch = undefined; }
  function continueBatch() {
    if (!batch) return;
    if (host.hidden || pendingRoute || lifecycle.destroyed || Date.now() > batch.deadline) { stopBatch(); return; }
    const next = adapter.read();
    const ids = new Set(next.items.map(item => item.id));
    if (next.route !== batch.route || [...batch.ids].some(id => !ids.has(id))) { stopBatch(); return; }
    if (ids.size > batch.ids.size) {
      if (!batch.remaining || !next.canLoadMore) { stopBatch(); return; }
      if (Date.now() - lastMore >= 1500) {
        batch.ids = ids;
        batch.remaining--;
        batch.deadline = Date.now() + 15000;
        lastMore = Date.now();
        if (!adapter.loadMore()) { stopBatch(); return; }
      }
    }
    batchTimer = lifecycle.timeout(continueBatch, 300);
  }
  const ownsFocus = () => !isMenuOpen() && !core.hasTemporaryLayer && !core.restoring &&
    (host.contains(document.activeElement) || focusWanted);
  const more = () => {
    if (feedActive) { void changeCategory(store.category, true); return; }
    if (batch || host.hidden || pendingRoute || !store.snapshot.canLoadMore || Date.now() - lastMore < 1500) return;
    batch = { route: store.snapshot.route, ids: new Set(store.snapshot.items.map(item => item.id)),
      remaining: 2, deadline: Date.now() + 15000 };
    lastMore = Date.now();
    if (!adapter.loadMore()) { stopBatch(); return; }
    batchTimer = lifecycle.timeout(continueBatch, 300);
  };
  const app = createApp(BrowseGrid, { gridSettings, ownsFocus, more, changeCategory: (id: string) => { void changeCategory(id); }, open: (id: string) => {
    if (!isMenuOpen() && !core.hasTemporaryLayer) {
      if (feedActive) {
        const item = store.snapshot.items.find(item => item.id === id);
        if (item) location.assign(item.href);
      } else adapter.open(id);
    }
  } });
  app.use(pinia); app.mount(mount);
  function sync() {
    if (lifecycle.destroyed) return;
    const enabled = document.documentElement.classList.contains('ytg-browse');
    const started = enabled && host.hidden;
    // Hide immediately at takeover, before any data or Vue nextTick readiness.
    host.hidden = !enabled;
    if (document.documentElement.classList.contains('ytg-custom-browse') !== enabled)
      document.documentElement.classList.toggle('ytg-custom-browse', enabled);
    if (!enabled) { stopBatch(); resetFeed(); pendingRoute = false; focusWanted = false; return; }
    if (!pendingRoute && !store.categories.length) {
      const categories = feed.categories();
      if (categories.length) {
        store.categories = categories;
        const remembered = core.restoring ? routeCategories.get(location.pathname + location.search) : undefined;
        store.category = categories.find(item => item.id === remembered)?.id || categories.find(item => item.selected)?.id || categories[0].id;
        document.documentElement.classList.add('ytg-api-categories');
        feedActive = true; store.loading = true;
        feedSnapshot = { route: location.pathname + location.search, items: [], canLoadMore: false };
        const category = store.category;
        void nextTick().then(() => { if (!lifecycle.destroyed && !host.hidden && store.category === category) void changeCategory(category); });
      }
    }
    let top = 56;
    host.dataset.feedLoading = String(store.loading);
    for (const bar of document.querySelectorAll<HTMLElement>('ytd-masthead,ytd-feed-filter-chip-bar-renderer,#chips-wrapper')) {
      if (!bar.closest('[hidden],[aria-hidden="true"]')) {
        const bounds = bar.getBoundingClientRect();
        if (bounds.height && bounds.bottom > 0 && bounds.bottom < innerHeight / 2) top = Math.max(top, bounds.bottom);
      }
    }
    host.style.setProperty('--ytg-browse-top', `${top + 8}px`);
    let left = 0;
    for (const guide of document.querySelectorAll<HTMLElement>('ytd-guide-renderer,ytd-mini-guide-renderer')) {
      if (guide.closest('[hidden],[aria-hidden="true"]')) continue;
      const bounds = guide.getBoundingClientRect();
      if (bounds.width && bounds.right > 0 && bounds.right < innerWidth / 2) left = Math.max(left, bounds.right);
    }
    host.style.setProperty('--ytg-browse-left', `${left}px`);
    const next = pendingRoute ? { route: location.pathname + location.search, items: [], canLoadMore: false } :
      feedActive && feedSnapshot ? feedSnapshot : adapter.read();
    const signature = JSON.stringify(next);
    if (signature === lastSignature && !started) return;
    lastSignature = signature;
    focusWanted = host.contains(document.activeElement) || host.contains(core.current) ||
      (started && document.documentElement.classList.contains('ytg-gamepad-input') && !isMenuOpen());
    const firstItems = !store.snapshot.items.length && !!next.items.length;
    store.apply(next);
    // Fill the initial browse view with up to three native continuation pages.
    if (!feedActive && (started || firstItems) && next.items.length > 0 && next.items.length < 60 && next.canLoadMore) more();
    const currentRevision = ++revision;
    void nextTick().then(() => {
      if (lifecycle.destroyed || host.hidden || currentRevision !== revision) return;
      core.refresh();
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
      (record.target === document.documentElement || (record.target as Element).closest?.('ytd-page-manager')))) schedule();
  });
  source.observe(document.documentElement, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'hidden', 'href', 'src', 'srcset', 'data-src', 'data-thumb', 'aria-hidden', 'data-ytg-native'] });
  lifecycle.listen(document, 'yt-navigate-start', () => { stopBatch(); resetFeed(); pendingRoute = true; lastSignature = ''; sync(); });
  lifecycle.listen(document, 'yt-navigate-finish', () => { pendingRoute = false; sync(); });
  lifecycle.listen(document, 'yt-page-data-updated', schedule);
  lifecycle.listen(window, 'resize', schedule);
  lifecycle.listen(window, 'popstate', schedule);
  lifecycle.cleanup(() => {
    stopBatch();
    resetFeed();
    app.unmount(); host.remove(); document.documentElement.classList.remove('ytg-custom-browse');
  });
  sync();
  return lifecycle.destroy;
}
