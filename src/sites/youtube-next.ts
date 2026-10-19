import { createWatchDataService, type WatchDataService } from './youtube-watch-data';
import { createYouTubeHeaders, requestYouTube } from './youtube-request';
import { parseFeed } from './youtube-feed';
import { parseWatchLink } from '../shared/watch-link';
import { PAGE_WATCH_NEXT } from '../bridge/page-protocol';
import { parseYouTubeJsNextCard } from './youtube-next-parser';
import type { RecommendationSnapshot } from '../../types/ports';

export interface WatchNextSnapshot {
  route: string;
  recommendations: RecommendationSnapshot[];
  queue: RecommendationSnapshot[];
  loading: boolean;
  failed: boolean;
}
type Node = Record<string, any>;
const label = (value: any): string => typeof value === 'string' ? value : value?.simpleText || value?.runs?.map((run: any) => run.text || '').join('') || value?.content || '';

// Only traverse the recommendation column and playlist, never comments or ads.
export function parseWatchNext(raw: Node, currentVideo: string, continuationKind?: 'queue' | 'recommendations', playlistId?: string) {
  const secondary = raw.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults;
  const playlist = raw.contents?.twoColumnWatchNextResults?.playlist?.playlist;
  const batches: any[] = [];
  for (const action of [...(raw.onResponseReceivedEndpoints || []), ...(raw.onResponseReceivedActions || [])]) {
    if (action.appendContinuationItemsAction) batches.push(action.appendContinuationItemsAction.continuationItems);
    if (action.reloadContinuationItemsCommand) batches.push(action.reloadContinuationItemsCommand.continuationItems);
  }
  const queueBatch = raw.continuationContents?.playlistPanelContinuation;
  const recommendationBatch = raw.continuationContents?.itemSectionContinuation;
  let recommendationContinuation: string | undefined, queueContinuation: string | undefined;
  const parse = (source: any, queue: boolean) => {
    const records: RecommendationSnapshot[] = [];
    const seen = new Set<string>();
    let remaining = 30000;
    function walk(value: any, depth = 0) {
      if (!value || typeof value !== 'object' || depth > 35 || --remaining < 0) return;
      if (Array.isArray(value)) { for (const entry of value) walk(entry, depth + 1); return; }
      if (Object.keys(value).some(key => /adSlotRenderer|promoted.*Renderer|displayAdRenderer|adPlacements/i.test(key))) return;
      visit(value);
      for (const entry of Object.values(value)) walk(entry, depth + 1);
    }
    function visit(node: Node) {
      const token = node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || node.nextContinuationData?.continuation;
      if (typeof token === 'string') { if (queue) queueContinuation = token; else recommendationContinuation = token; }
      const video = queue ? node.playlistPanelVideoRenderer : node.compactVideoRenderer || node.videoRenderer;
      const lockup = !queue && node.lockupViewModel;
      const collection = !queue && (node.compactRadioRenderer || node.compactPlaylistRenderer);
      if (!video && !lockup && !collection) return;
      const parsed = parseFeed(video ? { compactVideoRenderer: video } : lockup ? { lockupViewModel: lockup } : node).items[0];
      if (!parsed) return;
      let target = parseWatchLink(parsed.href);
      if (queue && target && (playlist?.playlistId || playlistId) && !target.watchEndpoint.playlistId) {
        const url = new URL(target.href, 'https://www.youtube.com');
        url.searchParams.set('list', playlist?.playlistId || playlistId);
        if (Number.isInteger(video.navigationEndpoint?.watchEndpoint?.index)) url.searchParams.set('index', String(video.navigationEndpoint.watchEndpoint.index + 1));
        target = parseWatchLink(url.href);
      }
      if (!target || (!queue && target.videoId === currentVideo)) return;
      const key = queue ? `queue:${target.href}` : target.watchEndpoint.playlistId ? target.id : target.videoId;
      if (seen.has(key)) return;
      seen.add(key);
      const normalized = parseYouTubeJsNextCard(node, queue);
      records.push({ key, href: target.href, label: normalized?.title || parsed.title, channel: normalized?.channel || parsed.channel,
        thumbnail: normalized?.thumbnail || parsed.thumbnail, thumbnailFallback: parsed.thumbnailFallback!,
        duration: normalized?.duration || label(video?.lengthText), metadata: normalized?.metadata || label(video?.viewCountText),
        ...(parsed.isPlaylist ? { isPlaylist: true } : {}),
        ...(queue ? { queue: true, selected: video.selected === true } : {}) });
    }
    walk(source);
    return records.slice(0, 120);
  };
  const queueItems = parse(playlist || queueBatch || (continuationKind === 'queue' ? batches : []), true);
  const recommendations = parse(secondary || recommendationBatch || (continuationKind !== 'queue' ? batches : []), false);
  return { recommendations, queue: queueItems, recommendationContinuation, queueContinuation };
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
