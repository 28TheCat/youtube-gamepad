import { safeHomeFilterData } from '../shared/home-filter';
import { PAGE_REQUEST, PAGE_RESPONSE } from './page-protocol';
import { parseWatchLink, parseShortLink } from '../shared/watch-link';
import type { FeedCategory } from '../sites/youtube-feed';
import type { BrowseItem } from '../shared/browse-data';
import { playlistColor } from '../shared/playlist-colors';

export function createFeedClient() {
  let sequence = 0;
  const session = crypto.randomUUID();
  const pending = new Map<string, { operation: string; complete: (message?: Record<string, any>) => void }>();
  const receive = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (typeof detail !== 'string' || detail.length > 2000000) return;
    try {
      const value = JSON.parse(detail);
      if (value?.version === 1 && typeof value.id === 'string') pending.get(value.id)?.complete(value);
    } catch { /* Ignore malformed page responses. */ }
  };
  document.addEventListener(PAGE_RESPONSE, receive);
  function dispatch(operation: string, fields: object = {}, callback?: (value?: Record<string, any>) => void) {
    const id = `${session}:${++sequence}`;
    if (callback) pending.set(id, { operation, complete: message => {
      if (message && message.operation !== operation) return;
      pending.delete(id); callback(message);
    } });
    document.dispatchEvent(new CustomEvent(PAGE_REQUEST, { detail: JSON.stringify({ version: 1, id, operation, ...fields }) }));
    return id;
  }
  function categories(): FeedCategory[] {
    let result: FeedCategory[] = [];
    const id = dispatch('readBrowseCategories', {}, message => {
      if (message?.ok && Array.isArray(message.value)) result = message.value.slice(0, 100).filter((item: any) =>
        item && typeof item === 'object' && typeof item.id === 'string' && item.id.length <= 100 &&
        typeof item.label === 'string' && item.label.length <= 80)
        .map((item: any) => ({ id: item.id, label: item.label, selected: item.selected === true,
          ...(item.localize === true ? { localize: true } : {}) }));
    });
    pending.delete(id);
    return result;
  }
  function cancel() {
    dispatch('cancelBrowse');
    for (const request of [...pending.values()]) if (request.operation === 'requestBrowse') request.complete();
  }
  function openVideo(href: string): boolean {
    let opened = false;
    const id = dispatch('openBrowseVideo', { href }, message => { opened = message?.ok === true && message.value === true; });
    pending.delete(id);
    return opened;
  }
  function request(category: string, page?: string): Promise<{ items: BrowseItem[]; nextPage?: string }> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const id = dispatch('requestBrowse', { category, page }, message => {
        clearTimeout(timer);
        if (!message?.ok || !Array.isArray(message.value?.items)) { reject(new Error('无法加载分类视频，请重试。')); return; }
        const items: BrowseItem[] = message.value.items.slice(0, 500).filter((item: any) => {
          if (!item || typeof item !== 'object') return false;
          const target = parseWatchLink(item.href) || parseShortLink(item.href);
          if (!target || item.id !== target.id || item.href !== target.href || typeof item.title !== 'string' ||
            typeof item.channel !== 'string') return false;
          try { return new URL(item.thumbnail).protocol === 'https:'; } catch { return false; }
        }).map((item: BrowseItem) => {
          let channelAvatar: string | undefined;
          try { if (typeof item.channelAvatar === 'string' && item.channelAvatar.length <= 4096 &&
            new URL(item.channelAvatar).protocol === 'https:') channelAvatar = item.channelAvatar; } catch { /* No avatar. */ }
          const filterData = safeHomeFilterData(item.filterData);
          return { ...(filterData ? { filterData } : {}), id: item.id, title: item.title.slice(0, 2000), channel: item.channel.slice(0, 2000),
          ...(channelAvatar ? { channelAvatar } : {}),
          ...(['verified', 'artist'].includes(item.channelBadge || '') ? { channelBadge: item.channelBadge } : {}),
          ...(typeof item.viewCount === 'string' ? { viewCount: item.viewCount.slice(0, 200) } : {}),
          ...(typeof item.publishedTime === 'string' ? { publishedTime: item.publishedTime.slice(0, 200) } : {}),
          ...(typeof item.duration === 'string' ? { duration: item.duration.slice(0, 40) } : {}),
          ...(typeof item.watchedPercent === 'number' && Number.isFinite(item.watchedPercent) && item.watchedPercent > 0
            ? { watchedPercent: Math.min(100, item.watchedPercent) } : {}),
          href: item.href, thumbnail: item.thumbnail, thumbnailFallback: `https://i.ytimg.com/vi/${(parseWatchLink(item.href) || parseShortLink(item.href))!.videoId}/hqdefault.jpg`,
          ...(item.isPlaylist === true ? { isPlaylist: true,
            stackColorLight: playlistColor(item.stackColorLight), stackColorDark: playlistColor(item.stackColorDark) } : {}) };
        });
        if (message.value.items.length && !items.length) {
          reject(new Error('Invalid YouTube video response')); return;
        }
        resolve({ items, nextPage: typeof message.value.nextPage === 'string' ? message.value.nextPage.slice(0, 100) : undefined });
      });
      if (pending.has(id)) timer = setTimeout(() => { pending.get(id)?.complete(); }, 22000);
    });
  }
  return { categories, request, cancel, openVideo, destroy() { cancel(); document.removeEventListener(PAGE_RESPONSE, receive); } };
}
