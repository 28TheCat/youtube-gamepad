import { createYouTubeHeaders, requestYouTube } from './youtube-request';
import { categoryIdentity, type CategoryItem } from '../shared/browse-categories';
import { parseWatchLink, parseShortLink } from '../shared/watch-link';
import { resolveExplorePage, isInnerTubeBrowseRoute } from '../shared/explore-pages';
import type { BrowseItem } from '../shared/browse-data';
import { playlistColor } from '../shared/playlist-colors';
import { parseYouTubeJsBrowse } from './youtube-search';
import { channelEndpoint, parseChannelPage, type ChannelChoice } from './youtube-channel';

type Node = Record<string, any>;
export interface FeedResult { items: BrowseItem[]; continuation?: string }
export interface FeedCategory extends CategoryItem { selected: boolean; localize?: boolean }
export function walkFeed(raw: unknown, visit: (node: Node) => void) {
  let remaining = 30000;
  const walk = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 35 || --remaining < 0) return;
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return; }
    visit(value as Node);
    for (const item of Object.values(value)) walk(item, depth + 1);
  };
  walk(raw, 0);
}
const text = (value: any): string => typeof value === 'string' ? value : value?.simpleText ||
  value?.runs?.map((run: any) => run.text || '').join('') || value?.content || '';
function playbackLink(endpoint: any, videoId?: string, playlistId?: string) {
  const command = endpoint?.watchEndpoint || endpoint?.watchPlaylistEndpoint;
  const raw = endpoint?.commandMetadata?.webCommandMetadata?.url;
  let url: URL;
  try {
    url = new URL(typeof raw === 'string' ? raw : '/watch', 'https://www.youtube.com');
    if (url.origin !== 'https://www.youtube.com' || url.pathname !== '/watch') return null;
  } catch { return null; }
  if (!url.searchParams.has('v') && (command?.videoId || videoId)) url.searchParams.set('v', command?.videoId || videoId);
  if (!url.searchParams.has('list') && (command?.playlistId || playlistId)) url.searchParams.set('list', command?.playlistId || playlistId);
  if (!url.searchParams.has('index') && Number.isInteger(command?.index) && command.index >= 0)
    url.searchParams.set('index', String(command.index + 1));
  if (command?.startRadio === true) url.searchParams.set('start_radio', '1');
  if (typeof command?.params === 'string') url.searchParams.set('params', command.params);
  return parseWatchLink(url.href);
}
export function parseFeed(raw: unknown): FeedResult {
  const items = new Map<string, BrowseItem>();
  let continuation: string | undefined;
  walkFeed(raw, node => {
    const token = node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || node.nextContinuationData?.continuation;
    if (typeof token === 'string') continuation = token;
    const short = node.reelItemRenderer || node.shortsLockupViewModel;
    if (short) {
      const command = short.onTap?.innertubeCommand || short.navigationEndpoint;
      const videoId = command?.reelWatchEndpoint?.videoId || short.videoId;
      const target = parseShortLink(command?.commandMetadata?.webCommandMetadata?.url ||
        (typeof videoId === 'string' ? `/shorts/${videoId}` : ''));
      const title = text(short.headline || short.overlayMetadata?.primaryText || short.title).slice(0, 2000);
      if (!target || !title) return;
      const fallback = `https://i.ytimg.com/vi/${target.videoId}/hqdefault.jpg`;
      const images = short.thumbnail?.thumbnails || short.thumbnail?.sources;
      let thumbnail = fallback;
      try { const url = new URL(images?.at(-1)?.url); if (url.protocol === 'https:') thumbnail = url.href; } catch { /* Use video thumbnail. */ }
      items.set(target.id, { id: target.id, href: target.href, title,
        channel: text(short.shortBylineText || short.ownerText).slice(0, 2000), thumbnail, thumbnailFallback: fallback });
      return;
    }
    const video = node.videoRenderer || node.gridVideoRenderer || node.compactVideoRenderer || node.playlistVideoRenderer || node.movieRenderer;
    const collection = node.radioRenderer || node.playlistRenderer || node.compactRadioRenderer || node.compactPlaylistRenderer;
    const lockup = node.lockupViewModel;
    if (video?.isPlayable === false) return;
    if (!video && !collection && !['LOCKUP_CONTENT_TYPE_VIDEO', 'LOCKUP_CONTENT_TYPE_PLAYLIST'].includes(lockup?.contentType)) return;
    const endpoint = video?.navigationEndpoint || collection?.navigationEndpoint ||
      lockup?.rendererContext?.commandContext?.onTap?.innertubeCommand;
    const target = playbackLink(endpoint,
      video?.videoId || collection?.videoId || collection?.videos?.[0]?.childVideoRenderer?.videoId ||
        (lockup?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' ? lockup.contentId : undefined),
      collection?.playlistId || (lockup?.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST' ? lockup.contentId : undefined));
    if (!target) return;
    const id = target.videoId;
    const metadata = lockup?.metadata?.lockupMetadataViewModel;
    const title = text(video?.title || collection?.title || metadata?.title).slice(0, 2000);
    if (!title) return;
    const fallback = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
    const images = video?.thumbnail?.thumbnails || collection?.thumbnail?.thumbnails || collection?.thumbnails?.[0]?.thumbnails ||
      lockup?.contentImage?.thumbnailViewModel?.image?.sources ||
      lockup?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources;
    const candidate = images?.at(-1)?.url;
    let thumbnail = fallback;
    try { const url = new URL(candidate); if (url.protocol === 'https:') thumbnail = url.href; } catch { /* Use video thumbnail. */ }
    items.set(target.id, { id: target.id, href: target.href, title,
      channel: text(video?.ownerText || video?.shortBylineText || collection?.shortBylineText || metadata?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text).slice(0, 2000),
      thumbnail, thumbnailFallback: fallback,
      ...(collection || lockup?.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST' ? {
        isPlaylist: true,
        stackColorLight: playlistColor(lockup?.contentImage?.collectionThumbnailViewModel?.stackColor?.lightTheme),
        stackColorDark: playlistColor(lockup?.contentImage?.collectionThumbnailViewModel?.stackColor?.darkTheme)
      } : {}) });
  });
  return { items: [...items.values()], continuation };
}
export function feedEndpoint(raw: any): { path: 'browse' | 'search'; body: Node } | undefined {
  if (raw?.browseEndpoint && typeof raw.browseEndpoint.browseId === 'string')
    return { path: 'browse', body: { browseId: raw.browseEndpoint.browseId, ...(typeof raw.browseEndpoint.params === 'string' ? { params: raw.browseEndpoint.params } : {}) } };
  if (raw?.searchEndpoint && typeof raw.searchEndpoint.query === 'string')
    return { path: 'search', body: { query: raw.searchEndpoint.query, ...(typeof raw.searchEndpoint.params === 'string' ? { params: raw.searchEndpoint.params } : {}) } };
  if (typeof raw?.continuationCommand?.token === 'string')
    return { path: raw.commandMetadata?.webCommandMetadata?.apiUrl?.endsWith('/search') ? 'search' : 'browse', body: { continuation: raw.continuationCommand.token } };
}
// Runs in MAIN. Session context and endpoint tokens never cross into Vue.
export function createYouTubeFeedService() {
  const endpoints = new Map<string, ReturnType<typeof feedEndpoint>>();
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
  function selectedTab(data: any) {
    const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || data?.contents?.singleColumnBrowseResultsRenderer?.tabs;
    return tabs?.map((entry: any) => entry.tabRenderer).find((tab: any) => tab?.selected);
  }
  function feedData(data: any) { return selectedTab(data)?.content || data; }
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
      const label = text(chip?.text).trim().slice(0, 80);
      const endpoint = feedEndpoint(chip?.navigationEndpoint) ||
        (categoryIdentity(label) === 'all' && location.pathname === '/' ? { path: 'browse' as const, body: { browseId: 'FEwhat_to_watch' } } : undefined);
      if (!label || !endpoint) return;
      const id = categoryIdentity(label);
      endpoints.set(id, endpoint); result.set(id, { id, label, selected: chip.isSelected === true });
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
    const librarySearch = endpoint.path === 'search' && location.pathname === '/results';
    const libraryBrowse = endpoint.path === 'browse' && (location.pathname === '/' ||
      ['/feed/subscriptions', '/feed/history'].includes(location.pathname) ||
      (location.pathname === '/playlist' && new URLSearchParams(location.search).get('list') === 'WL'));
    const parseBrowse = (raw: Node) => librarySearch || libraryBrowse ? parseYouTubeJsBrowse(feedData(raw)) : parseFeed(feedData(raw));
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
        const parsed = parseChannelPage(data, context, raw => parseFeed(feedData(raw)));
        if (!page) {
          const previous = channelPages.get(requestRoute) || [];
          const retained = !parsed.choices.length && category.startsWith('channel:sort:') ? previous :
            previous.filter(item => item.id.startsWith('channel:tab:'));
          channelPages.set(requestRoute, [...new Map([...retained, ...parsed.choices].map(item => [item.id, item])).values()]);
          if (channelPages.size > 30) channelPages.delete(channelPages.keys().next().value!);
        }
        return result(parsed);
      }
      if (!controller.signal.aborted && requestRoute === route && requestRoute === location.pathname + location.search && !page) {
        const chips: Node[] = [];
        walkFeed(data, node => { if (node.chipCloudChipRenderer) chips.push(node.chipCloudChipRenderer); });
        if (chips.length) responseCategories = chips;
      }
      return result(parseBrowse(data));
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  return { categories, request, cancel };
}
