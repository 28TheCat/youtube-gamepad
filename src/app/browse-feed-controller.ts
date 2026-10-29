import { createHomeFilter, homeFilterDefaults, homeFilterActive, type HomeFilterSettings } from '../shared/home-filter';
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
  getFilters?: () => HomeFilterSettings;
  getSubscriptions?: () => ReadonlySet<string>;
}

// Owns category requests and bounded route/category caches; the surface owns DOM and focus.
export function createBrowseFeedController({ store, feed, getRoute, isVisible, isRestoring,
  changed, loadingChanged, afterRender, canResetFocus, resetFocus, restoreState, unavailable, getFilters = () => homeFilterDefaults, getSubscriptions = () => new Set<string>() }: BrowseFeedDependencies) {
  let feedActive = false, feedVersion = 0, nextPage: string | undefined;
  let feedSnapshot: BrowseSnapshot | undefined;
  let autoPagesUsed = 0;
  let memoSource: BrowseSnapshot | undefined, memoKey = '', memoSnapshot: BrowseSnapshot | undefined;
  const filtering = (route: string) => (route === '/' || route.startsWith('/?')) && homeFilterActive(getFilters());
  function visibleSnapshot(source = feedSnapshot) {
    if (!source || !filtering(source.route)) return source;
    const settings = getFilters(), subscriptions = getSubscriptions();
    const key = JSON.stringify([settings, [...subscriptions].sort(), autoPagesUsed]);
    if (source === memoSource && key === memoKey) return memoSnapshot;
    const items = source.items.filter(createHomeFilter(settings, subscriptions));
    memoSource = source; memoKey = key;
    return memoSnapshot = { ...source, items, filteredCount: source.items.length - items.length,
      autoLoadBlocked: !!nextPage && autoPagesUsed >= settings.homeAutoPages };
  }
  function refilter() {
    autoPagesUsed = 0; memoSource = undefined;
    changed();
  }
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
  async function changeCategory(id: string, append = false, manual = false, force = false) {
    if (disposed || !isVisible() || !store.categories.some(item => item.id === id) ||
      (append && !manual && visibleSnapshot()?.autoLoadBlocked) ||
      (append && (id !== store.category || store.loading || !nextPage || feedSnapshot?.route !== getRoute()))) return;
    // A second activation must not abort an in-flight request or reload visible videos.
    if (!force && !append && feedActive && id === store.category && feedSnapshot?.route === getRoute() &&
      !store.error && (store.loading || feedSnapshot.items.length > 0)) return;
    const page = append ? nextPage : undefined;
    if (!append || manual) autoPagesUsed = 0;
    if (!append) { cacheFeed(); feed.cancel(); }
    const version = ++feedVersion;
    const route = getRoute();
    const preserveView = !append && (force || store.refreshFailed) && feedSnapshot?.route === route && !!feedSnapshot.items.length;
    const previousSnapshot = feedSnapshot, previousPage = nextPage;
    store.refreshing = !!preserveView; store.refreshFailed = false;
    feedActive = true; store.category = id; store.loading = true; store.error = '';
    loadingChanged(true);
    // Channel tab/sort switches refresh their controls and opaque endpoints
    // together. SPA back restoration still uses the saved full return state.
    const channelRoute = /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)/.test(route);
    const restoring = isRestoring();
    const cached = !force && !preserveView && !append && (!channelRoute || restoring) ? feeds.get(feedKey(route, id)) : undefined;
    if (cached && (restoring || Date.now() - cached.loadedAt < cacheLifetime)) {
      nextPage = cached.nextPage; feedSnapshot = cached.snapshot; loadedAt = cached.loadedAt; store.loading = false;
      store.refreshing = false;
      loadingChanged(false);
      cacheFeed();
      changed();
      await afterRender();
      if (!restoring && isCurrent(version, route) && canResetFocus()) resetFocus();
      return;
    }
    if (!append && !preserveView) {
      nextPage = undefined;
      feedSnapshot = { route, items: [], canLoadMore: false };
      changed();
    }
    try {
      let cursor = page, extra = append && !manual;
      const visited = new Set<string>();
      const items = new Map((append ? feedSnapshot?.items || [] : []).map(item => [item.id, item]));
      for (;;) {
        const activeFilter = filtering(route), settings = getFilters();
        if (extra && activeFilter && autoPagesUsed >= settings.homeAutoPages) break;
        if (extra && activeFilter) autoPagesUsed++;
        if (cursor) visited.add(cursor);
        const result = await feed.request(id, cursor);
        if (!isCurrent(version, route)) return;
        nextPage = result.nextPage && !visited.has(result.nextPage) ? result.nextPage : undefined;
        const accept = filtering(route) ? createHomeFilter(getFilters(), getSubscriptions()) : undefined;
        let added = 0;
        for (const item of result.items) {
          if (!items.has(item.id) && (!accept || accept(item))) added++;
          items.set(item.id, item);
        }
        feedSnapshot = { route, items: [...items.values()], canLoadMore: !!nextPage };
        if (!accept || added > 0 || !nextPage) break;
        cursor = nextPage; extra = true;
      }
      loadedAt = Date.now();
      store.loading = false;
      store.refreshing = false;
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
        if (preserveView) { feedSnapshot = previousSnapshot; nextPage = previousPage; }
        store.refreshing = false; store.refreshFailed = !!preserveView;
        store.loading = false; store.error = '无法加载分类视频，请重试。'; loadingChanged(false);
        if (!append && !feedSnapshot?.items.length) unavailable?.();
        changed();
      }
    }
  }
  function reset(preserveView = false) {
    cacheFeed();
    ++feedVersion;
    if (feedActive || store.loading) feed.cancel();
    feedActive = false; feedSnapshot = undefined; nextPage = undefined; autoPagesUsed = 0; memoSource = undefined;
    store.refreshing = false; store.refreshFailed = false;
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
        const visible = visibleSnapshot(saved.snapshot)!;
        store.apply(visible);
        if (saved.activeItemId) {
          const position = saved.snapshot.items.findIndex(item => item.id === saved.activeItemId);
          const candidates = [saved.snapshot.items[position], ...saved.snapshot.items.slice(position + 1), ...saved.snapshot.items.slice(0, position).reverse()];
          const visibleIds = new Set(visible.items.map(item => item.id));
          const survivor = candidates.find(item => item && visibleIds.has(item.id));
          if (survivor) store.select(survivor.id);
        }
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
  function refreshHome() {
    if (disposed) return;
    // Explicit Home activation starts a new recommendation batch.
    for (const key of feeds.keys()) {
      if (/^\/(?:\?|$)/.test(JSON.parse(key)[0])) feeds.delete(key);
    }
    if (!isVisible() || !/^\/(?:\?|$)/.test(getRoute()) || store.loading) return;
    const id = store.categories.find(item => item.id === 'all')?.id || store.categories[0]?.id;
    if (id) return changeCategory(id, false, false, true);
  }
  return { refreshHome, changeCategory, reset, initialize, refreshCategories, destroy, captureReturnState, refilter,
    get active() { return feedActive; },
    get snapshot() { return visibleSnapshot(); } };
}
