import { createYouTubeHeaders, requestYouTube } from './youtube-request';
import { categoryIdentity, type CategoryItem } from '../shared/browse-categories';
import { listEndpoint } from './youtube-parser';
import { resolveExplorePage, isInnerTubeBrowseRoute } from '../shared/explore-pages';
import type { BrowseItem } from '../shared/browse-data';
import { parseYouTubeJsBrowse } from './youtube-search';
import { channelEndpoint, parseChannelPage, type ChannelChoice } from './youtube-channel';

type Node = Record<string, any>;
export interface FeedResult { items: BrowseItem[]; continuation?: string }
export interface FeedCategory extends CategoryItem { selected: boolean; localize?: boolean }
// Runs in MAIN. Session context and endpoint tokens never cross into Vue.
export function createYouTubeFeedService() {
  const endpoints = new Map<string, ReturnType<typeof listEndpoint>>();
  const pages = new Map<string, { path: 'browse' | 'search'; body: Node; route: string }>();
  let route = '', sequence = 0;
  const historyKey = 'ytGamepadBrowsePages';
  function restorePages() {
    if (typeof history === 'undefined') return;
    const saved = history.state?.[historyKey];
    if (!Array.isArray(saved)) return;
    for (const entry of saved.slice(-200)) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [id, value] = entry;
      if (typeof id !== 'string' || !/^\d+$/.test(id) || !value || value.route !== route ||
        !['browse', 'search'].includes(value.path) || typeof value.body?.continuation !== 'string') continue;
      pages.set(id, { path: value.path, body: { continuation: value.body.continuation }, route });
      sequence = Math.max(sequence, Number(id));
    }
  }
  function savePages() {
    if (typeof history === 'undefined') return;
    try {
      history.replaceState({ ...history.state, [historyKey]: [...pages].filter(([, value]) => value.route === route).slice(-200) }, '');
    } catch { /* Browsing still works if the browser cannot save history state. */ }
  }
  const requests = new Set<AbortController>();
  let responseCategories: Node[] = [];
  const categoryPages = new Map<string, Node[]>();
  const channelPages = new Map<string, ChannelChoice[]>();
  const independentFeed = () => isInnerTubeBrowseRoute(location.pathname + location.search);
  const channelFeed = () => /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)/.test(location.pathname);
  function categories(): FeedCategory[] {
    const currentRoute = location.pathname + location.search;
    if (route !== currentRoute) {
      if (responseCategories.length) categoryPages.set(route, responseCategories);
      if (categoryPages.size > 30) categoryPages.delete(categoryPages.keys().next().value!);
      route = currentRoute; endpoints.clear(); responseCategories = categoryPages.get(route) || []; cancel();
    }
    const result = new Map<string, FeedCategory>();
    const explorePage = resolveExplorePage(currentRoute);
    // Personal feeds often have no filter chips. Give them the same request,
    // pagination and return-state lifecycle as the home feed.
    const personalFeed = location.pathname === '/feed/subscriptions' ? { browseId: 'FEsubscriptions', label: '订阅' } :
      location.pathname === '/feed/history' ? { browseId: 'FEhistory', label: '历史记录' } :
      location.pathname === '/playlist' && /^[\w-]+$/.test(new URLSearchParams(location.search).get('list') || '') ?
        { browseId: `VL${new URLSearchParams(location.search).get('list')}`, label:
          new URLSearchParams(location.search).get('list') === 'WL' ? '稍后观看' : 'All' } : undefined;
    const add = (chip: any) => {
      const label = String(chip?.text || '').trim().slice(0, 80);
      const endpoint = listEndpoint(chip?.endpoint) ||
        (categoryIdentity(label) === 'all' && location.pathname === '/' ? { path: 'browse' as const, body: { browseId: 'FEwhat_to_watch' } } : undefined);
      if (!label || !endpoint) return;
      const id = categoryIdentity(label);
      endpoints.set(id, endpoint); result.set(id, { id, label, selected: chip.is_selected === true });
    };
    // API-owned lists never wait for native renderers or inspect page data.
    if (independentFeed()) {
      if (!(window as any).ytcfg?.get?.('INNERTUBE_CONTEXT')?.client) return [];
      const params = new URLSearchParams(location.search);
      const query = params.get('search_query');
      if (location.pathname === '/results' && !query) return [];
      endpoints.set('all', personalFeed || explorePage ? { path: 'browse', body: { browseId: personalFeed?.browseId || explorePage!.browseId } } : channelFeed() ?
        endpoints.get('all') || { path: 'browse', body: {} } : location.pathname === '/' ?
        { path: 'browse', body: { browseId: 'FEwhat_to_watch' } } :
        { path: 'search', body: { query, ...(params.get('sp') ? { params: params.get('sp') } : {}) } });
      result.set('all', { id: 'all', label: personalFeed?.label || 'All', selected: true, localize: true });
      if (channelFeed()) {
        for (const choice of channelPages.get(route) || []) {
          endpoints.set(choice.id, { path: 'browse', body: choice.body });
          result.set(choice.id, { id: choice.id, label: choice.label, selected: false });
        }
        return [...result.values()];
      }
      for (const chip of responseCategories) add(chip);
      if ([...result.values()].some(item => item.id !== 'all' && item.selected)) result.get('all')!.selected = false;
      return [...result.values()];
    }
    return [];
  }
  function cancel() { for (const controller of requests) controller.abort(); requests.clear(); }
  async function request(category: string, page?: string) {
    categories();
    restorePages();
    const savedPage = page ? pages.get(page) : undefined;
    const requestRoute = route;
    const endpoint = page ? (savedPage?.route === requestRoute ? savedPage : undefined) : endpoints.get(category);
    if (!endpoint) throw new Error('Category unavailable');
    function result(parsed: FeedResult) {
      let nextPage: string | undefined;
      if (parsed.continuation && parsed.continuation !== savedPage?.body.continuation) {
        nextPage = `${++sequence}`;
        pages.set(nextPage, { path: endpoint!.path, body: { continuation: parsed.continuation }, route: requestRoute });
        if (pages.size > 200) pages.delete(pages.keys().next().value!);
        savePages();
      }
      return { items: parsed.items, nextPage };
    }
    const win = window as any;
    const context = win.ytcfg?.get?.('INNERTUBE_CONTEXT');
    if (!context?.client) throw new Error('YouTube context unavailable');
    const controller = new AbortController(); requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const headers = await createYouTubeHeaders(context);
      async function send(path: string, body: Node): Promise<any> {
        if (controller.signal.aborted || requestRoute !== location.pathname + location.search)
          throw new Error('YouTube request cancelled');
        const data = await requestYouTube(path, { method: 'POST', credentials: 'same-origin',
          headers, body: JSON.stringify({ context, ...body }), signal: controller.signal });
        if (controller.signal.aborted || requestRoute !== location.pathname + location.search)
          throw new Error('YouTube request cancelled');
        return data;
      }
      // YouTube resolves handles and channel tab params; do not hardcode them.
      if (channelFeed() && !endpoint.body.browseId && !endpoint.body.continuation) {
        const resolved = await send('navigation/resolve_url', { url: new URL(requestRoute, location.origin).href });
        const target = channelEndpoint(resolved);
        if (!target) throw new Error('Channel unavailable');
        endpoint.body = target;
      }
      const data = await send(endpoint.path, endpoint.body);
      if (channelFeed()) {
        // Parse API data once for cards, sibling tab endpoints and filters.
        const parsed = parseChannelPage(data, context);
        if (!page) {
          const previous = channelPages.get(requestRoute) || [];
          const retained = !parsed.choices.length && category.startsWith('channel:sort:') ? previous :
            previous.filter(item => item.id.startsWith('channel:tab:'));
          channelPages.set(requestRoute, [...new Map([...retained, ...parsed.choices].map(item => [item.id, item])).values()]);
          if (channelPages.size > 30) channelPages.delete(channelPages.keys().next().value!);
        }
        return result(parsed);
      }
      const parsed = parseYouTubeJsBrowse(data);
      if (!controller.signal.aborted && requestRoute === route && requestRoute === location.pathname + location.search && !page && parsed.chips.length)
        responseCategories = parsed.chips;
      return result(parsed);
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  return { categories, request, cancel };
}
