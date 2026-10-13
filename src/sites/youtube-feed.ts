import { categoryIdentity, type CategoryItem } from '../shared/browse-categories';
import type { BrowseItem } from './youtube-browse';

type Node = Record<string, any>;
export interface FeedResult { items: BrowseItem[]; continuation?: string }
export interface FeedCategory extends CategoryItem { selected: boolean }
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
export function parseFeed(raw: unknown): FeedResult {
  const items = new Map<string, BrowseItem>();
  let continuation: string | undefined;
  walkFeed(raw, node => {
    const token = node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || node.nextContinuationData?.continuation;
    if (typeof token === 'string') continuation = token;
    const video = node.videoRenderer || node.gridVideoRenderer || node.compactVideoRenderer;
    const lockup = node.lockupViewModel;
    const id = video?.videoId || (lockup?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' ? lockup.contentId : undefined);
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id)) return;
    const metadata = lockup?.metadata?.lockupMetadataViewModel;
    const title = text(video?.title || metadata?.title).slice(0, 2000);
    if (!title) return;
    const fallback = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
    const images = video?.thumbnail?.thumbnails || lockup?.contentImage?.thumbnailViewModel?.image?.sources;
    const candidate = images?.at(-1)?.url;
    let thumbnail = fallback;
    try { const url = new URL(candidate); if (url.protocol === 'https:') thumbnail = url.href; } catch { /* Use video thumbnail. */ }
    items.set(`video:${id}`, { id: `video:${id}`, href: `/watch?v=${encodeURIComponent(id)}`, title,
      channel: text(video?.ownerText || video?.shortBylineText || metadata?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text).slice(0, 2000),
      thumbnail, thumbnailFallback: fallback });
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
  const initialRoute = location.pathname + location.search;
  function categories(): FeedCategory[] {
    const currentRoute = location.pathname + location.search;
    if (route !== currentRoute) { route = currentRoute; endpoints.clear(); cancel(); }
    const result = new Map<string, FeedCategory>();
    const add = (chip: any) => {
      const label = text(chip?.text).trim().slice(0, 80);
      const endpoint = feedEndpoint(chip?.navigationEndpoint) ||
        (categoryIdentity(label) === 'all' && location.pathname === '/' ? { path: 'browse' as const, body: { browseId: 'FEwhat_to_watch' } } : undefined);
      if (!label || !endpoint) return;
      const id = categoryIdentity(label);
      endpoints.set(id, endpoint); result.set(id, { id, label, selected: chip.isSelected === true });
    };
    const win = window as any;
    const page = document.querySelector('ytd-page-manager') as any;
    const browse = document.querySelector('ytd-page-manager ytd-browse:not([hidden]),ytd-page-manager ytd-search:not([hidden])') as any;
    walkFeed(browse?.data || page?.data || (currentRoute === initialRoute ? win.ytInitialData : undefined), node => { if (node.chipCloudChipRenderer) add(node.chipCloudChipRenderer); });
    for (const chip of document.querySelectorAll('yt-chip-cloud-chip-renderer')) {
      if (chip.closest('#ytg-browse-grid,[hidden],[aria-hidden="true"]')) continue;
      add((chip as any).data || (chip as any).__data?.data);
    }
    return [...result.values()];
  }
  function cancel() { for (const controller of requests) controller.abort(); requests.clear(); }
  async function request(category: string, page?: string) {
    categories();
    restorePages();
    const savedPage = page ? pages.get(page) : undefined;
    const requestRoute = route;
    const endpoint = page ? (savedPage?.route === requestRoute ? savedPage : undefined) : endpoints.get(category);
    if (!endpoint) throw new Error('Category unavailable');
    const win = window as any;
    const context = win.ytcfg?.get?.('INNERTUBE_CONTEXT');
    if (!context?.client) throw new Error('YouTube context unavailable');
    const controller = new AbortController(); requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const config = (key: string) => win.ytcfg?.get?.(key);
      const sid = document.cookie.split('; ').find(value => value.startsWith('SAPISID='))?.slice(8)
        || document.cookie.split('; ').find(value => value.startsWith('__Secure-3PAPISID='))?.slice(18);
      if (sid) {
        const timestamp = Math.floor(Date.now() / 1000);
        const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${timestamp} ${sid} ${location.origin}`));
        headers.Authorization = `SAPISIDHASH ${timestamp}_${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
      }
      headers['X-Youtube-Client-Name'] = String(config('INNERTUBE_CONTEXT_CLIENT_NAME') || 1);
      headers['X-Youtube-Client-Version'] = String(context.client.clientVersion);
      if (config('SESSION_INDEX') != null) headers['X-Goog-AuthUser'] = String(config('SESSION_INDEX'));
      if (typeof config('DELEGATED_SESSION_ID') === 'string') headers['X-Goog-PageId'] = config('DELEGATED_SESSION_ID');
      const response = await fetch(`/youtubei/v1/${endpoint.path}`, { method: 'POST', credentials: 'same-origin',
        headers, body: JSON.stringify({ context, ...endpoint.body }), signal: controller.signal });
      if (!response.ok) throw new Error('YouTube request failed');
      const data = await response.json();
      if (data.error) throw new Error('YouTube request failed');
      const parsed = parseFeed(data);
      let nextPage: string | undefined;
      if (parsed.continuation) {
        nextPage = `${++sequence}`;
        pages.set(nextPage, { path: endpoint.path, body: { continuation: parsed.continuation }, route: requestRoute });
        if (pages.size > 200) pages.delete(pages.keys().next().value!);
        savePages();
      }
      return { items: parsed.items, nextPage };
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  return { categories, request, cancel };
}
