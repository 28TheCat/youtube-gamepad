export interface BrowseItem {
  readonly id: string;
  readonly title: string;
  readonly channel: string;
  readonly thumbnail: string;
  readonly thumbnailFallback?: string;
  readonly href: string;
}
export interface BrowseSnapshot {
  readonly route: string;
  readonly items: readonly BrowseItem[];
  readonly canLoadMore: boolean;
}
const cards = 'ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer,ytd-grid-video-renderer,yt-lockup-view-model';

export function browseIdentity(raw: string, origin = 'https://www.youtube.com') {
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return null;
    const video = url.pathname === '/watch' ? url.searchParams.get('v') :
      url.pathname.startsWith('/shorts/') ? url.pathname.split('/')[2] : null;
    if (!video || !/^[\w-]+$/.test(video)) return null;
    return { id: `${url.pathname.startsWith('/shorts/') ? 'short' : 'video'}:${video}`,
      href: url.pathname + url.search };
  } catch { return null; }
}

// Native renderers and continuation remain YouTube-owned. Return data only.
export function createYouTubeBrowseAdapter(doc = document) {
  const sources = new Map<string, HTMLAnchorElement>();
  function read(): BrowseSnapshot {
    sources.clear();
    const items: BrowseItem[] = [];
    const page = doc.querySelector('ytd-page-manager');
    for (const card of page?.querySelectorAll<HTMLElement>(cards) || []) {
      if (card.closest('[hidden],[aria-hidden="true"]')) continue;
      const anchor = card.querySelector<HTMLAnchorElement>('a#thumbnail[href],a#video-title[href],a#video-title-link[href],a[href^="/watch?"],a[href^="/shorts/"]');
      const identity = browseIdentity(anchor?.getAttribute('href') || '');
      if (!anchor || !identity || sources.has(identity.id)) continue;
      const title = (card.querySelector('#video-title,#video-title-link,h3')?.textContent ||
        anchor.getAttribute('title') || anchor.getAttribute('aria-label') || anchor.textContent || '').trim();
      if (!title) continue;
      const image = card.querySelector<HTMLImageElement>('a#thumbnail img,yt-thumbnail-view-model img,ytd-thumbnail img,.yt-lockup-view-model__content-image img') || card.querySelector<HTMLImageElement>('img');
      // Hidden native cards may never enter YouTube's lazy-loading viewport.
      const thumbnailFallback = `https://i.ytimg.com/vi/${encodeURIComponent(identity.id.split(':')[1])}/hqdefault.jpg`;
      let thumbnail = thumbnailFallback;
      const candidates = [image?.getAttribute('data-thumb'), image?.getAttribute('data-src'),
        image?.currentSrc, image?.getAttribute('src'),
        ...(image?.getAttribute('srcset') || '').split(',').reverse().map(value => value.trim().split(/\s+/)[0])];
      for (const candidate of candidates) {
        if (!candidate?.trim()) continue;
        try {
          const url = new URL(candidate, 'https://www.youtube.com');
          if (url.protocol !== 'https:' || url.pathname === '/') continue;
          thumbnail = url.href;
          break;
        } catch { /* Try the next lazy-loading source. */ }
      }
      sources.set(identity.id, anchor);
      items.push({ ...identity, title, thumbnail, thumbnailFallback,
        channel: card.querySelector('#channel-name,#byline-container,.yt-content-metadata-view-model__metadata-row')?.textContent?.trim() || '' });
    }
    return { route: location.pathname + location.search, items,
      canLoadMore: !!page?.querySelector('ytd-continuation-item-renderer:not([hidden])') };
  }
  function loadMore() {
    const sentinel = doc.querySelector<HTMLElement>('ytd-page-manager ytd-continuation-item-renderer:not([hidden])');
    if (!sentinel) return false;
    sentinel.scrollIntoView({ block: 'end', behavior: 'instant' });
    sentinel.querySelector<HTMLElement>('button')?.click();
    return true;
  }
  function open(id: string) {
    const anchor = sources.get(id);
    if (!anchor?.isConnected || browseIdentity(anchor.getAttribute('href') || '')?.id !== id) return false;
    anchor.click();
    return true;
  }
  return { read, loadMore, open };
}
