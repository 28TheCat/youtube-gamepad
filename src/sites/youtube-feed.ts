import { createRequestScope } from './request-scope';
import { createYouTubeHeaders, requestYouTube } from './youtube-request';
import { categoryIdentity, type CategoryItem } from '../shared/browse-categories';
import { listEndpoint, parseYouTubePage } from './youtube-parser';
import { resolveExplorePage, isInnerTubeBrowseRoute } from '../shared/explore-pages';
import type { BrowseItem } from '../shared/browse-data';
import { browsePage, parseYouTubeJsBrowse, playlistDirectoryItems } from './youtube-search';
import { parseChannelPage, type ChannelChoice } from './youtube-channel';
import { Innertube, Mixins, YT, YTNodes } from 'youtubei.js/web';
import { createYouTubeSession } from './youtube-session';

type Node = Record<string, any>;
interface FeedResult { items: BrowseItem[]; continuation?: string; channelHeader?: import('../shared/browse-data').ChannelHeader }
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
  const requests = createRequestScope();
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
    const personalFeed = location.pathname === '/feed/subscriptions' ? { browseId: 'FEsubscriptions', label: 'Subscribed channels' } :
      location.pathname === '/feed/playlists' ? { browseId: 'FEplaylist_aggregation', label: 'Playlists' } :
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
          result.set(choice.id, { id: choice.id, label: choice.label, selected: choice.selected });
        }
        return [...result.values()];
      }
      for (const chip of responseCategories) add(chip);
      if ([...result.values()].some(item => item.id !== 'all' && item.selected)) result.get('all')!.selected = false;
      return [...result.values()];
    }
    return [];
  }
  function cancel() { requests.cancel(); }
  async function request(category: string, page?: string) {
    categories();
    restorePages();
    const savedPage = page ? pages.get(page) : undefined;
    const requestRoute = route;
    const endpoint = page ? (savedPage?.route === requestRoute ? savedPage : undefined) : endpoints.get(category);
    if (!endpoint) throw new Error('Category unavailable');
    function channelResult(parsed: ReturnType<typeof parseChannelPage>) {
      if (!page) {
        const previous = channelPages.get(requestRoute) || [];
        const retained = !parsed.choices.length && category.startsWith('channel:sort:') ? previous :
          previous.filter(item => item.id.startsWith('channel:tab:'));
        channelPages.set(requestRoute, [...new Map([...retained, ...parsed.choices].map(item => [item.id, item])).values()]);
        if (channelPages.size > 30) channelPages.delete(channelPages.keys().next().value!);
      }
      return result(parsed);
    }
    function result(parsed: FeedResult) {
      let nextPage: string | undefined;
      if (parsed.continuation && parsed.continuation !== savedPage?.body.continuation) {
        nextPage = `${++sequence}`;
        pages.set(nextPage, { path: endpoint!.path, body: { continuation: parsed.continuation }, route: requestRoute });
        if (pages.size > 200) pages.delete(pages.keys().next().value!);
        savePages();
      }
      return { items: parsed.items, nextPage, ...(parsed.channelHeader ? { channelHeader: parsed.channelHeader } : {}) };
    }
    const win = window as any;
    const context = win.ytcfg?.get?.('INNERTUBE_CONTEXT');
    if (!context?.client) throw new Error('YouTube context unavailable');
    const request = requests.begin(20000);
    try {
      const headers = await createYouTubeHeaders(context);
      async function send(path: string, body: Node): Promise<any> {
        if (!request.current || requestRoute !== location.pathname + location.search)
          throw new Error('YouTube request cancelled');
        const data = await requestYouTube(path, { method: 'POST', credentials: 'same-origin',
          headers, body: JSON.stringify({ context, ...body }), signal: request.signal });
        if (!request.current || requestRoute !== location.pathname + location.search)
          throw new Error('YouTube request cancelled');
        return data;
      }
      const channelRequest = channelFeed() && !resolveExplorePage(requestRoute);
      function createClient() {
        const session = createYouTubeSession(context, async (input, options) => {
          const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
          const path = url.pathname.replace('/youtubei/v1/', '');
          const allowed = channelRequest ? ['browse', 'navigation/resolve_url'] : [endpoint!.path];
          if (url.origin !== 'https://www.youtube.com' || !allowed.includes(path))
            throw new Error('Invalid feed endpoint');
          const body = JSON.parse(String(options?.body || '{}'));
          // Preserve the server's tab/sort params while getChannel owns the read.
          if (channelRequest && path === 'browse' && body.browseId === endpoint!.body.browseId) Object.assign(body, endpoint!.body);
          if (path === 'search' && !page && typeof endpoint!.body.params === 'string') body.params = endpoint!.body.params;
          let data = await send(path, body);
          // Channel requires a two-column shell; both layouts contain the same tabs.
          if (channelRequest && data.contents?.singleColumnBrowseResultsRenderer) {
            data.contents = { ...data.contents, twoColumnBrowseResultsRenderer: data.contents.singleColumnBrowseResultsRenderer };
            delete data.contents.singleColumnBrowseResultsRenderer;
          }
          if (path === 'browse' && !['contents', 'continuationContents', 'onResponseReceivedActions',
            'onResponseReceivedCommands', 'onResponseReceivedEndpoints'].some(key => key in data)) data = { contents: data };
          // The transport already decoded JSON. Hand it to the library directly,
          // avoiding a second serialization that traverses unselected tab cards.
          const response = new Response(null, { headers: { 'Content-Type': 'application/json' } });
          response.json = async () => data;
          return response;
        });
        const execute = session.actions.execute.bind(session.actions);
        session.actions.execute = ((path: Parameters<typeof execute>[0], args: Node = {}) =>
          execute(path, { ...args, skip_auth_check: true } as any)) as typeof session.actions.execute;
        return { session, client: new Innertube(session) };
      }
      if (channelRequest) {
        const { session, client } = createClient();
        if (!page && !endpoint.body.browseId) {
          const resolved = await client.resolveURL(new URL(requestRoute, location.origin).href);
          const target = listEndpoint(resolved);
          if (target?.path !== 'browse' || !target.body.browseId) throw new Error('Channel unavailable');
          endpoint.body = target.body;
        }
        // Partial sort responses have no Channel shell. Execute their validated
        // server endpoint through the public API rather than constructing one.
        let parsedPage;
        if (page) {
          const cursor = parseYouTubePage({ contents: [{ continuationItemRenderer: {
            continuationEndpoint: { continuationCommand: {
              token: endpoint.body.continuation, request: 'CONTINUATION_REQUEST_TYPE_BROWSE'
            } }
          } }] });
          parsedPage = (await new YT.ChannelListContinuation(session.actions, cursor, true).getContinuation()).page;
        } else if (category.startsWith('channel:sort:')) {
          parsedPage = await client.call(new YTNodes.NavigationEndpoint({ browseEndpoint: endpoint.body }), { parse: true });
        } else parsedPage = (await client.getChannel(endpoint.body.browseId)).page;
        return channelResult(parseChannelPage({}, context, parsedPage));
      }
      const home = location.pathname === '/' && category === 'all' && !endpoint.body.params;
      const subscriptions = location.pathname === '/feed/subscriptions' && category === 'all';
      const historyFeed = location.pathname === '/feed/history' && category === 'all';
      const searchFeed = location.pathname === '/results' && endpoint.path === 'search';
      const directory = location.pathname === '/feed/playlists';
      const playlistFeed = directory || location.pathname === '/playlist';
      if (playlistFeed || (!page && (searchFeed || home || subscriptions || historyFeed))) {
        const { session, client } = createClient();
        let listing;
        if (page) {
          // Restore a library cursor from the saved opaque token. Each request
          // gets fresh actions so cancelled requests cannot poison later pages.
          const cursor = parseYouTubePage({ contents: [{ continuationItemRenderer: {
            continuationEndpoint: { continuationCommand: {
              token: endpoint.body.continuation, request: 'CONTINUATION_REQUEST_TYPE_BROWSE'
            } }
          } }] });
          const previous = directory ? new Mixins.Feed(session.actions, cursor, true) : new YT.Playlist(session.actions, cursor, true);
          listing = await previous.getContinuation();
        } else {
          listing = searchFeed ? await client.search(endpoint.body.query) : home ? await client.getHomeFeed() : subscriptions ? await client.getSubscriptionsFeed() : historyFeed ? await client.getHistory() : directory ? await client.getPlaylists() : await client.getPlaylist(new URLSearchParams(location.search).get('list')!);
        }
        const parsed = browsePage(listing.page);
        if ((searchFeed || home || subscriptions || historyFeed) && parsed.chips.length) responseCategories = parsed.chips;
        return result({ ...parsed, items: directory ? playlistDirectoryItems(listing.page) : parsed.items });
      }
      const data = await send(endpoint.path, endpoint.body);
      if (channelFeed()) {
        // Parse API data once for cards, sibling tab endpoints and filters.
        return channelResult(parseChannelPage(data, context));
      }
      const parsed = parseYouTubeJsBrowse(data);
      if (request.current && requestRoute === route && requestRoute === location.pathname + location.search && !page && parsed.chips.length)
        responseCategories = parsed.chips;
      return result(parsed);
    } finally { request.finish(); }
  }
  return { categories, request, cancel };
}

