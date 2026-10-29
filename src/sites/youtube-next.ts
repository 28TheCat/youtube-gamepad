import { createWatchDataService, type WatchDataService } from './youtube-watch-data';
import { createYouTubeHeaders, requestYouTube } from './youtube-request';
import { createYouTubeSession } from './youtube-session';
import { commandRoots, continuationToken, parseYouTubePage, walkParsed } from './youtube-parser';
import { browseItem, parsedCards } from './youtube-search';
import { parseWatchLink } from '../shared/watch-link';
import { PAGE_WATCH_NEXT } from '../bridge/page-protocol';
import type { YTNodes } from 'youtubei.js/web';
import type { RecommendationSnapshot } from '../../types/ports';

export interface WatchNextSnapshot {
  filters?: { key: string; label: string; selected: boolean }[];
  route: string;
  recommendations: RecommendationSnapshot[];
  queue: RecommendationSnapshot[];
  loading: boolean;
  failed: boolean;
  playlistTitle?: string;
  playlistTotal?: number;
}
type Node = Record<string, any>;
// Scope the library's parsed response before converting presentation fields.
export function parseWatchNext(raw: Node, currentVideo: string, continuationKind?: 'queue' | 'recommendations', playlistId?: string) {
  const page = parseYouTubePage(raw);
  const main: any = page.contents?.is_array ? undefined : page.contents?.item();
  const watch = main?.type === 'TwoColumnWatchNextResults' ? main : undefined;
  const continuation = page.continuation_contents;
  const commands = commandRoots(page);
  const queueContinuationPage = continuation?.type === 'playlistPanelContinuation';
  const queueRoots = [watch?.playlist, ...(queueContinuationPage ? [continuation] : []),
    ...(continuationKind === 'queue' ? commands : [])];
  const recommendationRoots = [watch?.secondary_results, ...(!queueContinuationPage ? [continuation] : []),
    ...(continuationKind !== 'queue' ? commands : [])];
  const label = (value: any) => {
    const text = value == null ? '' : String(value);
    return text === 'N/A' || text === '[object Object]' ? '' : text.slice(0, 2000);
  };
  function records(roots: unknown, queue: boolean): RecommendationSnapshot[] {
    const items: RecommendationSnapshot[] = [], seen = new Set<string>();
    for (const card of parsedCards(roots)) {
      if (queue && card.type !== 'PlaylistPanelVideo') continue;
      const item = browseItem(card, queue ? watch?.playlist?.id || playlistId : undefined);
      const target = item && parseWatchLink(item.href);
      if (!item || !target || !queue && target.videoId === currentVideo) continue;
      const key = queue ? 'queue:' + target.href : target.watchEndpoint.playlistId ? target.id : target.videoId;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ key, href: target.href, label: item.title, channel: item.channel, thumbnail: item.thumbnail,
        ...(item.channelBadge ? { channelBadge: item.channelBadge } : {}),
        thumbnailFallback: item.thumbnailFallback!, duration: item.duration || label(card.duration?.text),
        ...(item.watchedPercent !== undefined ? { watchedPercent: item.watchedPercent } : {}),
        viewCount: item.viewCount || label(card.view_count),
        metadata: [item.viewCount, item.publishedTime].filter(Boolean).join(' · ') || label(card.view_count),
        ...(item.isPlaylist ? { isPlaylist: true } : {}), ...(queue ? { queue: true, selected: card.selected === true } : {}) });
      if (items.length >= 120) break;
    }
    return items;
  }
  const chips: InstanceType<typeof YTNodes.ChipCloudChip>[] = [];
  walkParsed(watch?.secondary_results, node => { if (node.type === 'ChipCloudChip') { if (chips.length < 40 && node.text?.trim()) chips.push(node); return false; } }, true);
  // YouTube.js does not expose this scalar playlist metadata yet.
  const total = raw.contents?.twoColumnWatchNextResults?.playlist?.playlist?.totalVideos;
  const playlistTotal = !watch?.playlist?.is_infinite && Number.isSafeInteger(total) && total > 0 ? total as number : undefined;
  return { chips, recommendations: records(recommendationRoots, false), queue: records(queueRoots, true), playlistTotal,
    playlistTitle: label(watch?.playlist?.title),
    recommendationContinuation: continuationToken(recommendationRoots), queueContinuation: continuationToken(queueRoots) };
}

// Runs in MAIN. Credentials and continuation tokens stay in this service.
export function createWatchNextService(sharedData?: WatchDataService) {
  const dataService = sharedData || createWatchDataService();
  let state: WatchNextSnapshot = { route: '', recommendations: [], queue: [], loading: false, failed: false };
  let tokens: { recommendationContinuation?: string; queueContinuation?: string } = {};
  let pending: AbortController | undefined, retryAt = 0, retryAppend = false, destroyed = false;
  let filterEndpoints = new Map<string, InstanceType<typeof YTNodes.ChipCloudChip>>();
  let filterPages = new Map<string, { items: RecommendationSnapshot[]; token?: string }>();
  const selectedFilter = () => state.filters?.find(item => item.selected)?.key;
  let retryKind: 'queue' | 'recommendations' | undefined, retryFilter: string | undefined;
  const cache = new Map<string, { state: WatchNextSnapshot; tokens: typeof tokens; endpoints: typeof filterEndpoints; pages: typeof filterPages; at: number }>();
  const route = () => location.pathname + location.search;
  function cancel() { pending?.abort(); pending = undefined; }
  function syncRoute() {
    dataService.routeChanged();
    if (state.route === route()) return;
    if (!state.failed && (state.queue.length || state.recommendations.length)) {
      cache.delete(state.route);
      cache.set(state.route, { state: { ...state, loading: false }, tokens: { ...tokens }, endpoints: new Map(filterEndpoints), pages: new Map(filterPages), at: Date.now() });
      if (cache.size > 10) cache.delete(cache.keys().next().value!);
    }
    cancel(); tokens = {}; retryAt = 0; filterEndpoints = new Map(); filterPages = new Map(); retryFilter = undefined; retryKind = undefined;
    state = { route: route(), recommendations: [], queue: [], loading: false, failed: false };
    const saved = cache.get(state.route);
    if (saved && Date.now() - saved.at < 120000) { state = { ...saved.state }; tokens = { ...saved.tokens }; filterEndpoints = new Map(saved.endpoints); filterPages = new Map(saved.pages); retryAt = Infinity; }
  }
  async function request(append: boolean, requestedKind?: 'queue' | 'recommendations', filterKey?: string) {
    const target = parseWatchLink(state.route);
    if (!target || pending || destroyed) return;
    const kind = requestedKind || (append && tokens.queueContinuation ? 'queue' : 'recommendations');
    const continuation = append ? (kind === 'queue' ? tokens.queueContinuation : tokens.recommendationContinuation) : undefined;
    if (append && !continuation) return;
    const config = (key: string) => (window as any).ytcfg?.get?.(key);
    const context = config('INNERTUBE_CONTEXT');
    if (!context?.client) { retryAt = Date.now() + 1000; return; }
    const controller = new AbortController(), captured = state;
    retryKind = requestedKind; retryFilter = filterKey;
    pending = controller; captured.loading = true; captured.failed = false;
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const headers = await createYouTubeHeaders(context);
      const init = { method: 'POST', credentials: 'same-origin', headers,
        body: JSON.stringify({ context, ...(continuation ? { continuation } : target.watchEndpoint) }), signal: controller.signal } as const;
      let data: Node;
      if (filterKey) {
        const chip = filterEndpoints.get(filterKey);
        if (!chip?.endpoint) throw Error('Recommendation filter unavailable');
        const session = createYouTubeSession(context, async () => { throw Error('Unexpected filter request'); });
        session.actions.execute = (async (endpoint: string, args: Node) => {
          if (endpoint.replace(/^\//, '') !== 'next') throw Error('Unexpected recommendation endpoint');
          if (controller.signal.aborted || captured !== state) throw Error('Filter cancelled');
          const { parse, ...body } = args;
          const data = await requestYouTube('next', { ...init, body: JSON.stringify({ ...body, context }) });
          return { success: true, status_code: 200, data };
        }) as typeof session.actions.execute;
        data = (await chip.endpoint.call(session.actions, { parse: false })).data;
      } else data = await (append ? requestYouTube('next', init) : dataService.read(init));
      if (destroyed || captured !== state || captured.route !== route() || controller.signal.aborted) return;
      const parsed = parseWatchNext(data, target.videoId, append ? kind : undefined, target.watchEndpoint.playlistId);
      if (!append) {
        captured.recommendations = parsed.recommendations;
        if (!filterKey) {
          captured.queue = parsed.queue;
          filterEndpoints.clear(); filterPages.clear();
          captured.filters = parsed.chips.map((chip, index) => {
            const key = `filter:${index}`; filterEndpoints.set(key, chip);
            return { key, label: String(chip.text).slice(0, 200), selected: chip.is_selected === true };
          });
          captured.playlistTitle = parsed.playlistTitle;
          captured.playlistTotal = parsed.playlistTotal;
          tokens = { recommendationContinuation: parsed.recommendationContinuation, queueContinuation: parsed.queueContinuation };
        } else tokens.recommendationContinuation = parsed.recommendationContinuation;
        if (captured.queue.length >= 120) tokens.queueContinuation = undefined;
        if (captured.recommendations.length >= 120) tokens.recommendationContinuation = undefined;
      } else {
        const items = kind === 'queue' ? parsed.queue : parsed.recommendations;
        const combined = new Map(captured[kind].map(item => [item.key, item]));
        for (const item of items) combined.set(item.key, item);
        captured[kind] = [...combined.values()].slice(0, 120);
        const tokenKey = kind === 'queue' ? 'queueContinuation' : 'recommendationContinuation';
        tokens[tokenKey] = parsed[tokenKey] === continuation || captured[kind].length >= 120 ? undefined : parsed[tokenKey];
      }
      const filter = captured.filters?.find(item => item.selected)?.key;
      if (filter && kind === 'recommendations') filterPages.set(filter, {
        items: [...captured.recommendations], token: tokens.recommendationContinuation
      });
      retryAt = Infinity;
    } catch {
      if (captured === state && captured.route === route() && !destroyed) { captured.failed = true; retryAppend = append; retryAt = Date.now() + 5000; }
    } finally {
      clearTimeout(timer);
      if (pending === controller) { pending = undefined; captured.loading = false; }
      if (!destroyed && captured === state && captured.route === route()) document.dispatchEvent?.(new Event(PAGE_WATCH_NEXT));
    }
  }
  function read() {
    syncRoute();
    if (!destroyed && location.pathname === '/watch' && Date.now() >= retryAt && !pending) void request(state.failed && retryAppend, retryKind, retryFilter);
    return { ...state };
  }
  function more(kind?: 'queue' | 'recommendations') {
    syncRoute();
    if (destroyed || location.pathname !== '/watch') return false;
    if (pending) return true;
    if (state.failed || retryAt !== Infinity) { if (Date.now() >= retryAt) void request(state.failed && retryAppend, retryKind, retryFilter); return true; }
    if (kind ? !tokens[kind === 'queue' ? 'queueContinuation' : 'recommendationContinuation'] : !tokens.queueContinuation && !tokens.recommendationContinuation) return false;
    void request(true, kind); return true;
  }
  function selectFilter(key: string) {
    syncRoute();
    if (destroyed || !filterEndpoints.has(key) || key === selectedFilter() && !state.failed && !state.loading) return false;
    const previous = selectedFilter();
    if (previous && !state.loading && !state.failed) filterPages.set(previous, { items: [...state.recommendations], token: tokens.recommendationContinuation });
    cancel();
    state = { ...state, recommendations: [], loading: false, failed: false,
      filters: state.filters?.map(item => ({ ...item, selected: item.key === key })) };
    const saved = filterPages.get(key);
    tokens.recommendationContinuation = saved?.token;
    retryAt = Infinity; retryFilter = key; retryKind = 'recommendations'; retryAppend = false;
    if (saved) state.recommendations = [...saved.items];
    else void request(false, 'recommendations', key);
    document.dispatchEvent?.(new Event(PAGE_WATCH_NEXT));
    return true;
  }
  return { read, more, selectFilter, routeChanged: syncRoute, destroy() { destroyed = true; cancel(); cache.clear(); if (!sharedData) dataService.destroy(); } };
}
