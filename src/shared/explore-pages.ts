export interface ExplorePageDefinition {
  id: string;
  label: string;
  description: string;
  href: string;
  browseId: string;
  aliases?: readonly string[];
}

// One destination definition drives navigation, the dedicated page and its feed.
export const explorePages: readonly ExplorePageDefinition[] = [
  { id: 'music', label: 'Music', description: 'Discover music and performances.',
    href: '/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ', browseId: 'UC-9-kyTW8ZkZNDHQJ6FgpwQ', aliases: ['/feed/music', '/music'] },
  { id: 'movies', label: 'Movies', description: 'Explore movies and shows available in your region.',
    href: '/feed/storefront', browseId: 'FEstorefront', aliases: ['/movies'] },
  { id: 'live', label: 'Live', description: 'Discover live streams and broadcasts.',
    href: '/channel/UC4R8DWoMoI7CAwX8_LjQHig', browseId: 'UC4R8DWoMoI7CAwX8_LjQHig', aliases: ['/live', '/feed/live'] },
  { id: 'gaming', label: 'Gaming', description: 'Discover gaming videos and creators.',
    href: '/gaming', browseId: 'FEgaming' },
  { id: 'news', label: 'News', description: 'Explore news and current events.',
    href: '/channel/UCYfdidRxbB8Qhf0Nx7ioOYw', browseId: 'UCYfdidRxbB8Qhf0Nx7ioOYw', aliases: ['/feed/news'] },
  { id: 'sports', label: 'Sports', description: 'Discover sports and highlights.',
    href: '/channel/UCEgdi0XIXXZ-qJOFPf4JSKw', browseId: 'UCEgdi0XIXXZ-qJOFPf4JSKw', aliases: ['/feed/sports'] }
];

export function resolveExplorePage(route: string): ExplorePageDefinition | undefined {
  try {
    const url = new URL(route, 'https://www.youtube.com');
    if (url.origin !== 'https://www.youtube.com') return;
    const path = url.pathname.replace(/\/$/, '') || '/';
    return explorePages.find(page => page.href === path || page.aliases?.includes(path));
  } catch { return; }
}

/** Search input stays in our UI; results are loaded by the existing API feed. */
export function searchHref(query: unknown): string | undefined {
  if (typeof query !== 'string' || !query.trim() || query.trim().length > 256) return;
  return `/results?${new URLSearchParams({ search_query: query.trim() })}`;
}

/** Canonical destinations that can use YouTube's SPA router. */
export function sidebarBrowseEndpoint(href: unknown) {
  if (typeof href !== 'string' || !href.startsWith('/')) return;
  const url = new URL(href, 'https://www.youtube.com');
  if (url.origin !== 'https://www.youtube.com' || url.pathname + url.search !== href || url.hash) return;
  const query = url.searchParams.get('search_query');
  if (url.pathname === '/results' && searchHref(query) === href) return {
    commandMetadata: { webCommandMetadata: { url: href, webPageType: 'WEB_PAGE_TYPE_SEARCH' } },
    searchEndpoint: { query: query!.trim() }
  };
  const routes: Record<string, string> = { '/': 'FEwhat_to_watch', '/feed/subscriptions': 'FEsubscriptions',
    '/feed/history': 'FEhistory', '/feed/playlists': 'FEplaylist_aggregation' };
  const playlist = url.pathname === '/playlist' && /^\?list=[\w-]+$/.test(url.search) ? url.searchParams.get('list') : undefined;
  const channel = !url.search ? url.pathname.match(/^\/channel\/(UC[\w-]+)(?:\/videos)?$/)?.[1] : undefined;
  const browseId = routes[href] || channel || (playlist ? `VL${playlist}` : !url.search ? resolveExplorePage(href)?.browseId : undefined);
  if (browseId) return { commandMetadata: { webCommandMetadata: { url: href, webPageType: 'WEB_PAGE_TYPE_BROWSE' } },
    browseEndpoint: { browseId } };
}

// Lists owned by InnerTube; no native card renderer is required to start them.
export function isInnerTubeBrowseRoute(route: string): boolean {
  try {
    const url = new URL(route, 'https://www.youtube.com');
    if (url.origin !== 'https://www.youtube.com') return false;
    return !!resolveExplorePage(route) || ['/', '/results', '/feed/subscriptions', '/feed/history'].includes(url.pathname) ||
      (url.pathname === '/playlist' && /^[\w-]+$/.test(url.searchParams.get('list') || '')) ||
      /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)(?:\/[^/]+)?\/?$/.test(url.pathname);
  } catch { return false; }
}
