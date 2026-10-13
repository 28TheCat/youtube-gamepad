import { PAGE_REQUEST, PAGE_RESPONSE } from './page-protocol';
import type { FeedCategory } from '../sites/youtube-feed';
import type { BrowseItem } from '../sites/youtube-browse';

export function createFeedClient() {
  let sequence = 0;
  const session = crypto.randomUUID();
  const pending = new Map<string, (message?: Record<string, any>) => void>();
  const receive = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (typeof detail !== 'string' || detail.length > 2000000) return;
    try {
      const value = JSON.parse(detail);
      if (value?.version === 1 && typeof value.id === 'string') pending.get(value.id)?.(value);
    } catch { /* Ignore malformed page responses. */ }
  };
  document.addEventListener(PAGE_RESPONSE, receive);
  function dispatch(operation: string, fields: object = {}, callback?: (value?: Record<string, any>) => void) {
    const id = `${session}:${++sequence}`;
    if (callback) pending.set(id, message => {
      if (message && message.operation !== operation) return;
      pending.delete(id); callback(message);
    });
    document.dispatchEvent(new CustomEvent(PAGE_REQUEST, { detail: JSON.stringify({ version: 1, id, operation, ...fields }) }));
    return id;
  }
  function categories(): FeedCategory[] {
    let result: FeedCategory[] = [];
    const id = dispatch('readBrowseCategories', {}, message => {
      if (message?.ok && Array.isArray(message.value)) result = message.value.slice(0, 100).filter((item: any) =>
        item && typeof item === 'object' && typeof item.id === 'string' && item.id.length <= 100 &&
        typeof item.label === 'string' && item.label.length <= 80)
        .map((item: any) => ({ id: item.id, label: item.label, selected: item.selected === true }));
    });
    pending.delete(id);
    return result;
  }
  function cancel() {
    dispatch('cancelBrowse');
    for (const complete of [...pending.values()]) complete();
  }
  function request(category: string, page?: string): Promise<{ items: BrowseItem[]; nextPage?: string }> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const id = dispatch('requestBrowse', { category, page }, message => {
        clearTimeout(timer);
        if (!message?.ok || !Array.isArray(message.value?.items)) { reject(new Error('无法加载分类视频，请重试。')); return; }
        const items: BrowseItem[] = message.value.items.slice(0, 500).filter((item: any) => {
          if (typeof item.id !== 'string' || !/^video:[\w-]{1,100}$/.test(item.id) || typeof item.title !== 'string' ||
            typeof item.channel !== 'string' || typeof item.href !== 'string' || item.href !== `/watch?v=${item.id.slice(6)}`) return false;
          try { return new URL(item.thumbnail).protocol === 'https:'; } catch { return false; }
        }).map((item: BrowseItem) => ({ id: item.id, title: item.title.slice(0, 2000), channel: item.channel.slice(0, 2000),
          href: item.href, thumbnail: item.thumbnail, thumbnailFallback: `https://i.ytimg.com/vi/${item.id.slice(6)}/hqdefault.jpg` }));
        resolve({ items, nextPage: typeof message.value.nextPage === 'string' ? message.value.nextPage.slice(0, 100) : undefined });
      });
      if (pending.has(id)) timer = setTimeout(() => { pending.get(id)?.(); }, 22000);
    });
  }
  return { categories, request, cancel, destroy() { cancel(); document.removeEventListener(PAGE_RESPONSE, receive); } };
}
