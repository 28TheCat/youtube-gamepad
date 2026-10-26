import type { useBrowseStore } from './browse-store';
import type { createFeedClient } from '../bridge/feed-client';
import type { BrowseSnapshot } from '../shared/browse-data';
import type { FeedCategory } from '../sites/youtube-feed';
import { isInnerTubeBrowseRoute } from '../shared/explore-pages';

export interface BrowseReturnState {
  categories: FeedCategory[];
  category: string;
  snapshot: BrowseSnapshot;
  nextPage?: string;
  activeItemId: string | null;
  scrollTop: number;
}

interface BrowseFeedDependencies {
  store: ReturnType<typeof useBrowseStore>;
  feed: Pick<ReturnType<typeof createFeedClient>, 'categories' | 'request' | 'cancel'>;
  getRoute: () => string;
  isVisible: () => boolean;
  isRestoring: () => boolean;
  changed: () => void;
  loadingChanged: (loading: boolean) => void;
  afterRender: () => Promise<unknown>;
  canResetFocus: () => boolean;
  resetFocus: () => void;
  restoreState?: () => BrowseReturnState | undefined;
  unavailable?: () => void;
}

// Owns category requests and bounded route/category caches; the surface owns DOM and focus.
export function createBrowseFeedController({ store, feed, getRoute, isVisible, isRestoring,
  changed, loadingChanged, afterRender, canResetFocus, resetFocus, restoreState, unavailable }: BrowseFeedDependencies) {
  let feedActive = false, feedVersion = 0, nextPage: string | undefined;
  let feedSnapshot: BrowseSnapshot | undefined;
  let disposed = false;
  const isCurrent = (version: number, route: string) =>
    !disposed && version === feedVersion && isVisible() && route === getRoute();
  // Keep loaded pages for SPA back navigation, including continuation items.
  // Category IDs alone are not unique across routes.
  const feeds = new Map<string, { snapshot: BrowseSnapshot; nextPage?: string; loadedAt: number }>();
  const cacheLifetime = 2 * 60 * 1000;
  let loadedAt = 0;
  const routeCategories = new Map<string, string>();
  const feedKey = (route: string, category: string) => JSON.stringify([route, category]);
  function cacheFeed() {
    if (!feedActive || !feedSnapshot?.items.length || store.loading || store.error) return;
    const route = feedSnapshot.route;
    routeCategories.set(route, store.category);
    const key = feedKey(route, store.category);
    feeds.delete(key);
    feeds.set(key, { snapshot: feedSnapshot, nextPage, loadedAt });
    if (feeds.size > 30) feeds.delete(feeds.keys().next().value!);
    if (routeCategories.size > 30) routeCategories.delete(routeCategories.keys().next().value!);
  }
  async function changeCategory(id: string, append = false) {
    if (disposed || !isVisible() || !store.categories.some(item => item.id === id) ||
      (append && (id !== store.category || store.loading || !nextPage || feedSnapshot?.route !== getRoute()))) return;
    // A second activation must not abort an in-flight request or reload visible videos.
    if (!append && feedActive && id === store.category && feedSnapshot?.route === getRoute() &&
      !store.error && (store.loading || feedSnapshot.items.length > 0)) return;
    const page = append ? nextPage : undefined;
    if (!append) { cacheFeed(); feed.cancel(); }
    const version = ++feedVersion;
    const route = getRoute();
    feedActive = true; store.category = id; store.loading = true; store.error = '';
    loadingChanged(true);
    // Channel tab/sort switches refresh their controls and opaque endpoints
    // together. SPA back restoration still uses the saved full return state.
    const channelRoute = /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)/.test(route);
    const restoring = isRestoring();
    const cached = !append && (!channelRoute || restoring) ? feeds.get(feedKey(route, id)) : undefined;
    if (cached && (restoring || Date.now() - cached.loadedAt < cacheLifetime)) {
      nextPage = cached.nextPage; feedSnapshot = cached.snapshot; loadedAt = cached.loadedAt; store.loading = false;
      loadingChanged(false);
      cacheFeed();
      changed();
      await afterRender();
      if (!restoring && isCurrent(version, route) && canResetFocus()) resetFocus();
      return;
    }
    if (!append) {
      nextPage = undefined;
      feedSnapshot = { route, items: [], canLoadMore: false };
      changed();
    }
    try {
      const result = await feed.request(id, page);
      if (!isCurrent(version, route)) return;
      nextPage = result.nextPage;
      const items = new Map((append ? feedSnapshot?.items || [] : []).map(item => [item.id, item]));
      for (const item of result.items) items.set(item.id, item);
      feedSnapshot = { route, items: [...items.values()], canLoadMore: !!nextPage };
      loadedAt = Date.now();
      store.loading = false;
      loadingChanged(false);
      refreshCategories();
      cacheFeed();
      changed();
      if (!append) {
        await afterRender();
        if (isCurrent(version, route) && canResetFocus()) resetFocus();
      }
    } catch {
      if (isCurrent(version, route)) {
        store.loading = false; store.error = '无法加载分类视频，请重试。'; loadingChanged(false);
        if (!append && !feedSnapshot?.items.length) unavailable?.();
      }
    }
  }
  function reset(preserveView = false) {
    cacheFeed();
    ++feedVersion;
    if (feedActive || store.loading) feed.cancel();
    feedActive = false; feedSnapshot = undefined; nextPage = undefined;
    if (preserveView) return;
    if (store.categories.length) store.categories = [];
    store.category = ''; store.loading = false; store.error = '';
    loadingChanged(false);
  }
  function refreshCategories() {
    // Lists can start with only the synthetic All category. Discover response
    // filters without restarting the current feed.
    if (!disposed && isVisible() && isInnerTubeBrowseRoute(getRoute()) && store.categories.length) {
      const categories = feed.categories();
      if (categories.length && categories.some(item => item.id === store.category) &&
        JSON.stringify(categories) !== JSON.stringify(store.categories)) store.categories = categories;
    }
  }
  function initialize() {
    if (disposed || !isVisible()) return false;
    if (!store.categories.length) {
      const saved = restoreState?.();
      if (saved && saved.snapshot.route === getRoute()) {
        store.categories = saved.categories; store.category = saved.category;
        feedActive = true; feedSnapshot = saved.snapshot; nextPage = saved.nextPage; loadedAt = Date.now();
        store.loading = false; store.error = ''; loadingChanged(false);
        store.apply(saved.snapshot);
        if (saved.activeItemId) store.select(saved.activeItemId);
        cacheFeed();
        return true;
      }
      const categories = feed.categories();
      if (categories.length) {
        store.categories = categories;
        const remembered = isRestoring() ? routeCategories.get(getRoute()) : undefined;
        store.category = categories.find(item => item.id === remembered)?.id || categories.find(item => item.selected)?.id || categories[0].id;
        feedActive = true; store.loading = false;
        feedSnapshot = { route: getRoute(), items: [], canLoadMore: false };
        const category = store.category;
        const version = feedVersion, route = getRoute();
        void afterRender().then(() => {
          if (isCurrent(version, route) && store.category === category)
            void changeCategory(category);
        });
      }
    }
    return store.categories.length > 0;
  }
  function destroy() {
    if (disposed) return;
    disposed = true;
    reset();
    feeds.clear(); routeCategories.clear();
  }
  function captureReturnState(scrollTop: number): BrowseReturnState | undefined {
    if (!feedActive || !feedSnapshot?.items.length || feedSnapshot.route !== getRoute()) return;
    return { categories: store.categories, category: store.category, snapshot: feedSnapshot,
      nextPage, activeItemId: store.activeItemId, scrollTop };
  }
  return { changeCategory, reset, initialize, refreshCategories, destroy, captureReturnState,
    get active() { return feedActive; },
    get snapshot() { return feedSnapshot; } };
}
