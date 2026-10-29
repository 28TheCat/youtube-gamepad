import { explorePages } from './explore-pages';

export interface SidebarEntry { id: string; label: string; href: string; icon: string }
export interface SubscribedChannel { id: string; label: string; href: string; avatar?: string; isLive?: boolean; hasNewContent?: boolean }
export interface SidebarSnapshot { subscribedChannelIds?: string[]; subscriptions?: SubscribedChannel[]; personal: SidebarEntry[]; explore: SidebarEntry[] }
export const personalSidebar: readonly SidebarEntry[] = [
  { id: 'history', label: '历史记录', href: '/feed/history', icon: 'history' },
  { id: 'playlists', label: '播放列表', href: '/feed/playlists', icon: 'playlists' },
  { id: 'later', label: '稍后观看', href: '/playlist?list=WL', icon: 'later' },
  { id: 'liked', label: '赞过的视频', href: '/playlist?list=LL', icon: 'like' },
  { id: 'videos', label: '我的视频', href: 'https://studio.youtube.com/', icon: 'videos' }
];
export function defaultSidebar(): SidebarSnapshot {
  return { personal: personalSidebar.map(item => ({ ...item })),
    explore: explorePages.map(page => ({ id: `explore:${page.id}`, label: page.label, href: page.href, icon: 'explore' })) };
}

export function sidebarHref(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw || raw.length > 2048) return;
  try {
    const url = new URL(raw, 'https://www.youtube.com');
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return;
    if (url.origin === 'https://studio.youtube.com' && !url.search) return url.href;
    if (url.origin !== 'https://www.youtube.com') return;
    if (url.pathname === '/playlist') {
      if (!/^\?list=[\w-]+$/.test(url.search)) return;
    } else if (url.search || !/^(?:\/|\/feed\/[a-z_]+|\/channel\/UC[\w-]+|\/gaming|\/podcasts)$/.test(url.pathname)) return;
    return url.pathname + url.search;
  } catch { return; }
}

export function sidebarSnapshot(raw: unknown): SidebarSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as SidebarSnapshot;
  if (!Array.isArray(value.personal) || !Array.isArray(value.explore)) return;
  const icons = new Set(['history', 'playlists', 'later', 'like', 'videos', 'explore']);
  const entries = (items: SidebarEntry[]) => items.slice(0, 40).flatMap(item => {
    const href = sidebarHref(item?.href);
    if (!href || typeof item.id !== 'string' || item.id.length > 100 ||
      typeof item.label !== 'string' || !item.label.trim() || !icons.has(item.icon)) return [];
    return [{ id: item.id, label: item.label.slice(0, 200), href, icon: item.icon }];
  });
  const ids = Array.isArray(value.subscribedChannelIds) ? [...new Set(value.subscribedChannelIds.filter(id => typeof id === 'string' && /^UC[\w-]{1,100}$/.test(id)))].slice(0, 1000) : [];
  const seen = new Set<string>();
  const subscriptions = Array.isArray(value.subscriptions) ? value.subscriptions.slice(0, 1000).flatMap(item => {
    if (!item || typeof item.id !== 'string' || !/^UC[\w-]{1,100}$/.test(item.id) || seen.has(item.id) ||
      typeof item.label !== 'string' || !item.label.trim()) return [];
    seen.add(item.id);
    let avatar: string | undefined;
    try {
      if (typeof item.avatar === 'string' && item.avatar.length <= 4096) {
        const url = new URL(item.avatar);
        if (url.protocol === 'https:' && !url.username && !url.password) avatar = url.href;
      }
    } catch { /* Keep the channel's initial when no valid avatar is available. */ }
    return [{ id: item.id, label: item.label.slice(0, 200), href: `/channel/${item.id}/videos`, ...(avatar ? { avatar } : {}),
      ...(typeof item.isLive === 'boolean' ? { isLive: item.isLive } : {}),
      ...(typeof item.hasNewContent === 'boolean' ? { hasNewContent: item.hasNewContent } : {}) }];
  }) : [];
  return { personal: entries(value.personal), explore: entries(value.explore), ...(ids.length ? { subscribedChannelIds: ids } : {}),
    ...(subscriptions.length ? { subscriptions } : {}) };
}
