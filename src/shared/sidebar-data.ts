import { safeImageUrl } from './image-url';

export interface SidebarEntry { id: string; label: string; href: string; icon: string;
  avatar?: string; isLive?: boolean; hasNewContent?: boolean; children?: SidebarEntry[]; expanded?: boolean }
export interface SidebarSection { id: string; label?: string; entries: SidebarEntry[] }
export interface SubscribedChannel { id: string; label: string; href: string; avatar?: string; isLive?: boolean; hasNewContent?: boolean }
export interface SidebarSnapshot { sections: SidebarSection[]; subscribedChannelIds?: string[]; subscriptions?: SubscribedChannel[] }
export function sidebarHref(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw || raw.length > 2048) return;
  try {
    const url = new URL(raw, 'https://www.youtube.com');
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return;
    if (['studio.youtube.com', 'music.youtube.com', 'tv.youtube.com', 'kids.youtube.com', 'www.youtubekids.com'].includes(url.hostname) && !url.port) return url.href;
    if (url.origin !== 'https://www.youtube.com' || url.pathname.startsWith('//')) return;
    return url.pathname + url.search;
  } catch { return; }
}

export function sidebarSnapshot(raw: unknown): SidebarSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as SidebarSnapshot;
  if (!Array.isArray(value.sections)) return;
  const icons = new Set(['home', 'subscriptions', 'person', 'history', 'playlists', 'later', 'like', 'videos', 'explore', 'settings', 'live', 'search', 'more']);
  let budget = 2000;
  const entries = (items: SidebarEntry[], depth = 0): SidebarEntry[] => depth > 8 ? [] : items.slice(0, 1000).flatMap(item => {
    if (--budget < 0 || !item || typeof item !== 'object') return [];
    const href = sidebarHref(item?.href);
    const children = Array.isArray(item.children) ? entries(item.children, depth + 1) : undefined;
    if ((!href && !children?.length) || typeof item.id !== 'string' || item.id.length > 100 ||
      typeof item.label !== 'string' || !item.label.trim() || !icons.has(item.icon)) return [];
    const avatar = safeImageUrl(item.avatar);
    return [{ id: item.id, label: item.label.slice(0, 200), href: href || '', icon: item.icon,
      ...(children ? { children, expanded: item.expanded === true } : {}), ...(avatar ? { avatar } : {}),
      ...(typeof item.isLive === 'boolean' ? { isLive: item.isLive } : {}),
      ...(typeof item.hasNewContent === 'boolean' ? { hasNewContent: item.hasNewContent } : {}) }];
  });
  const ids = Array.isArray(value.subscribedChannelIds) ? [...new Set(value.subscribedChannelIds.filter(id => typeof id === 'string' && /^UC[\w-]{1,100}$/.test(id)))].slice(0, 1000) : [];
  const seen = new Set<string>();
  const subscriptions = Array.isArray(value.subscriptions) ? value.subscriptions.slice(0, 1000).flatMap(item => {
    if (!item || typeof item.id !== 'string' || !/^UC[\w-]{1,100}$/.test(item.id) || seen.has(item.id) ||
      typeof item.label !== 'string' || !item.label.trim()) return [];
    seen.add(item.id);
    const avatar = safeImageUrl(item.avatar);
    return [{ id: item.id, label: item.label.slice(0, 200), href: `/channel/${item.id}/videos`, ...(avatar ? { avatar } : {}),
      ...(typeof item.isLive === 'boolean' ? { isLive: item.isLive } : {}),
      ...(typeof item.hasNewContent === 'boolean' ? { hasNewContent: item.hasNewContent } : {}) }];
  }) : [];
  const sections = value.sections.slice(0, 40).flatMap(section => {
    if (!section || typeof section.id !== 'string' || !/^[\w:-]{1,100}$/.test(section.id) || !Array.isArray(section.entries)) return [];
    return [{ id: section.id, ...(typeof section.label === 'string' ? { label: section.label.slice(0, 200) } : {}), entries: entries(section.entries) }];
  });
  return { sections, ...(ids.length ? { subscribedChannelIds: ids } : {}),
    ...(subscriptions.length ? { subscriptions } : {}) };
}
