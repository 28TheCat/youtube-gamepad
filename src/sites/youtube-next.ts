import { createWatchDataService, type WatchDataService } from './youtube-watch-data';
import { createYouTubeHeaders, requestYouTube } from './youtube-request';
import { commandRoots, continuationToken, parseYouTubePage } from './youtube-parser';
import { browseItem, parsedCards } from './youtube-search';
import { parseWatchLink } from '../shared/watch-link';
import { PAGE_WATCH_NEXT } from '../bridge/page-protocol';
import type { RecommendationSnapshot } from '../../types/ports';

export interface WatchNextSnapshot {
  route: string;
  recommendations: RecommendationSnapshot[];
  queue: RecommendationSnapshot[];
  loading: boolean;
  failed: boolean;
  playlistTitle?: string;
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
  return { recommendations: records(recommendationRoots, false), queue: records(queueRoots, true),
    playlistTitle: label(watch?.playlist?.title),
    recommendationContinuation: continuationToken(recommendationRoots), queueContinuation: continuationToken(queueRoots) };
}

// Runs in MAIN. Credentials and continuation tokens stay in this service.
export function createWatchNextService(sharedData?: WatchDataService) {
  const dataService = sharedData || createWatchDataService();
  let state: WatchNextSnapshot = { route: '', recommendations: [], queue: [], loading: false, failed: false };
  let tokens: { recommendationContinuation?: string; queueContinuation?: string } = {};
  let pending: AbortController | undefined, retryAt = 0, retryAppend = false, destroyed = false;
  const cache = new Map<string, { state: WatchNextSnapshot; tokens: typeof tokens; at: number }>();
  const route = () => location.pathname + location.search;
  function cancel() { pending?.abort(); pending = undefined; }
  function syncRoute() {
    dataService.routeChanged();
    if (state.route === route()) return;
    if (!state.failed && (state.queue.length || state.recommendations.length)) {
      cache.delete(state.route);
      cache.set(state.route, { state: { ...state, loading: false }, tokens: { ...tokens }, at: Date.now() });
      if (cache.size > 10) cache.delete(cache.keys().next().value!);
    }
    cancel(); tokens = {}; retryAt = 0;
    state = { route: route(), recommendations: [], queue: [], loading: false, failed: false };
    const saved = cache.get(state.route);
    if (saved && Date.now() - saved.at < 120000) { state = { ...saved.state }; tokens = { ...saved.tokens }; retryAt = Infinity; }
  }
  async function request(append: boolean) {
    const target = parseWatchLink(state.route);
    if (!target || pending || destroyed) return;
    const kind = append && tokens.queueContinuation ? 'queue' : 'recommendations';
    const continuation = append ? (kind === 'queue' ? tokens.queueContinuation : tokens.recommendationContinuation) : undefined;
    if (append && !continuation) return;
    const config = (key: string) => (window as any).ytcfg?.get?.(key);
    const context = config('INNERTUBE_CONTEXT');
    if (!context?.client) { retryAt = Date.now() + 1000; return; }
    const controller = new AbortController(), captured = state;
    pending = controller; captured.loading = true; captured.failed = false;
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const headers = await createYouTubeHeaders(context);
      const init = { method: 'POST', credentials: 'same-origin', headers,
        body: JSON.stringify({ context, ...(continuation ? { continuation } : target.watchEndpoint) }), signal: controller.signal } as const;
      const data = await (append ? requestYouTube('next', init) : dataService.read(init));
      if (destroyed || captured !== state || captured.route !== route() || controller.signal.aborted) return;
      const parsed = parseWatchNext(data, target.videoId, append ? kind : undefined, target.watchEndpoint.playlistId);
      if (!append) {
        captured.recommendations = parsed.recommendations; captured.queue = parsed.queue;
        captured.playlistTitle = parsed.playlistTitle;
        tokens = parsed;
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
    if (!destroyed && location.pathname === '/watch' && Date.now() >= retryAt && !pending) void request(state.failed && retryAppend);
    return { ...state };
  }
  function more() {
    syncRoute();
    if (destroyed || location.pathname !== '/watch') return false;
    if (pending) return true;
    if (state.failed || retryAt !== Infinity) { if (Date.now() >= retryAt) void request(state.failed && retryAppend); return true; }
    if (!tokens.queueContinuation && !tokens.recommendationContinuation) return false;
    void request(true); return true;
  }
  return { read, more, routeChanged: syncRoute, destroy() { destroyed = true; cancel(); cache.clear(); if (!sharedData) dataService.destroy(); } };
}
