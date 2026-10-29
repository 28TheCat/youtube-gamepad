import { sidebarHref, sidebarSnapshot, type SidebarSnapshot, type SidebarEntry } from '../shared/sidebar-data';
import { createYouTubeHeaders, requestYouTube } from './youtube-request';

// Guide endpoints are parsed in MAIN. Only display data and validated links
// cross the bridge; neither DOM guide renderers nor arbitrary commands are used.
export function createSidebarService() {
  let destroyed = false, controller = new AbortController(), identity = '';
  let cached: SidebarSnapshot | undefined, loadedAt = 0, pending: Promise<SidebarSnapshot> | undefined;
  const config = (key: string) => (window as any).ytcfg?.get?.(key);
  async function read(): Promise<SidebarSnapshot> {
    if (destroyed) throw Error('Sidebar service destroyed');
    const context = config('INNERTUBE_CONTEXT');
    const sid = document.cookie.split(/;\s*/).find(value => value.startsWith('SAPISID='))?.slice(8)
      || document.cookie.split(/;\s*/).find(value => value.startsWith('__Secure-3PAPISID='))?.slice(18) || '';
    const key = JSON.stringify([sid, config('LOGGED_IN'), config('SESSION_INDEX'), config('DELEGATED_SESSION_ID'), context?.user,
      context?.client?.hl, context?.client?.gl, context?.client?.visitorData]);
    if (identity !== key) {
      controller.abort(); controller = new AbortController(); identity = key; cached = undefined; pending = undefined; loadedAt = 0;
    }
    if (!context?.client) throw Error('YouTube context unavailable');
    if (pending) return pending;
    if (cached && Date.now() - loadedAt < 60000) return structuredClone(cached);
    const signal = controller.signal;
    const task = (async () => {
      const headers = await createYouTubeHeaders(context, sid);
      if (destroyed || signal.aborted || key !== identity) throw Error('Sidebar request cancelled');
      const data = await requestYouTube('guide', { method: 'POST', credentials: 'same-origin', headers,
        body: JSON.stringify({ context }), signal });
      if (destroyed || signal.aborted || key !== identity) throw Error('Sidebar request cancelled');
      if (!Array.isArray(data.items)) throw Error('Sidebar guide unavailable');
      // Keep the guide's section tree. Flattening or starting with default links
      // loses account-specific playlists, regional sections and signed-out state.
      const result: SidebarSnapshot = { sections: [], subscriptions: [], subscribedChannelIds: [] };
      const text = (value: any): string => {
        const label = typeof value === 'string' ? value : typeof value?.simpleText === 'string' ? value.simpleText :
          Array.isArray(value?.runs) ? value.runs.slice(0, 100).map((run: any) => typeof run?.text === 'string' ? run.text : '').join('') : '';
        return label.trim().slice(0, 200);
      };
      const icons: Record<string, string> = { WHAT_TO_WATCH: 'home', SUBSCRIPTIONS: 'subscriptions', ACCOUNT_BOX: 'person',
        WATCH_HISTORY: 'history', PLAYLISTS: 'playlists', WATCH_LATER: 'later', LIKES: 'like', MY_VIDEOS: 'videos',
        CREATOR_STUDIO: 'videos', LIVE: 'live', SETTINGS: 'settings', SEARCH: 'search' };
      const ids: Record<string, string> = { '/': 'home', '/feed/subscriptions': 'subscriptions', '/feed/history': 'history',
        '/feed/playlists': 'playlists', '/playlist?list=WL': 'later', '/playlist?list=LL': 'liked' };
      let budget = 2000, sequence = 0;
      const subscribed = new Set<string>();
      function entry(raw: any, subscriptions: boolean): SidebarEntry | undefined {
        if (!raw || typeof raw !== 'object') return;
        const endpoint = raw.navigationEndpoint || raw.serviceEndpoint;
        const browseId = endpoint?.browseEndpoint?.browseId;
        const playlistId = endpoint?.watchEndpoint?.playlistId;
        const fallback = endpoint?.signInEndpoint ? '/signin' : typeof browseId === 'string' && /^UC[\w-]+$/.test(browseId) ? `/channel/${browseId}` :
          typeof playlistId === 'string' && /^[\w-]+$/.test(playlistId) ? `/playlist?list=${playlistId}` : undefined;
        const href = sidebarHref(endpoint?.commandMetadata?.webCommandMetadata?.url || endpoint?.urlEndpoint?.url || fallback);
        const label = text(raw.formattedTitle || raw.title);
        if (!href || !label) return;
        const channel = subscriptions && typeof browseId === 'string' && /^UC[\w-]{1,100}$/.test(browseId) ? browseId : undefined;
        const badges = Array.isArray(raw.badges) ? raw.badges : [raw.badges];
        const status = { isLive: badges.some((badge: any) => badge?.liveBroadcasting === true || !!badge?.liveBroadcastingBadgeRenderer),
          hasNewContent: raw.presentationStyle === 'GUIDE_ENTRY_PRESENTATION_STYLE_NEW_CONTENT' ||
            badges.some((badge: any) => badge?.newContent === true || !!badge?.newContentBadgeRenderer) };
        const avatar = raw.thumbnail?.thumbnails?.[0]?.url;
        if (channel && !subscribed.has(channel)) {
          subscribed.add(channel);
          result.subscribedChannelIds!.push(channel);
          result.subscriptions!.push({ id: channel, label, href: `/channel/${channel}/videos`, avatar, ...status });
        }
        return { id: channel ? `subscription:${channel}` : ids[href] ||
          (raw.icon?.iconType === 'MY_VIDEOS' || raw.icon?.iconType === 'CREATOR_STUDIO' ? 'videos' : `guide:${sequence++}`),
          label, href, icon: icons[raw.icon?.iconType] || 'explore', ...(avatar ? { avatar } : {}), ...status };
      }
      function entries(items: any[], subscriptions = false, depth = 0): SidebarEntry[] {
        if (depth > 8 || !Array.isArray(items)) return [];
        const result: SidebarEntry[] = [], seen = new Set<string>();
        for (const item of items) {
          if (--budget < 0) break;
          const signIn = item?.guideSigninPromoRenderer?.signInButton?.buttonRenderer;
          const raw = item?.guideEntryRenderer || item?.guideDownloadsEntryRenderer?.entryRenderer?.guideEntryRenderer ||
            (signIn ? { ...signIn, formattedTitle: signIn.text, icon: { iconType: 'ACCOUNT_BOX' } } : undefined);
          if (raw) {
            const value = entry(raw, subscriptions);
            if (value && !seen.has(value.href)) { seen.add(value.href); result.push(value); }
            continue;
          }
          const group = item?.guideCollapsibleSectionEntryRenderer || item?.guideCollapsibleEntryRenderer;
          if (!group) continue;
          const headerRaw = group.headerEntry?.guideEntryRenderer;
          const header = entry(headerRaw, subscriptions);
          const children = entries(group.sectionItems || group.expandableItems, subscriptions, depth + 1);
          if (!children.length) continue;
          const label = header?.label || text(headerRaw?.formattedTitle || headerRaw?.title) ||
            text(group.expanderItem?.guideEntryRenderer?.formattedTitle || group.expanderItem?.guideEntryRenderer?.title) || text(group.formattedTitle);
          // A missing expander in a response fixture is simply an inline group.
          if (!label) { for (const child of children) if (!seen.has(child.href)) { seen.add(child.href); result.push(child); } continue; }
          result.push({ id: `group:${sequence++}`, label, href: header?.href || '', icon: header?.icon || 'more',
            children, expanded: !!group.headerEntry });
        }
        return result;
      }
      for (const [index, item] of data.items.slice(0, 40).entries()) {
        const section = item?.guideSectionRenderer || item?.guideSubscriptionsSectionRenderer ||
          (item?.guideSigninPromoRenderer ? { items: [item] } : undefined);
        if (!section) continue;
        const subscriptions = !!item.guideSubscriptionsSectionRenderer;
        const children = entries(section.items, subscriptions);
        if (!children.length) continue;
        result.sections.push({ id: subscriptions ? 'subscriptions' : `section:${index}`,
          label: subscriptions ? 'Subscribed channels' : text(section.formattedTitle || section.title), entries: children });
      }
      const snapshot = sidebarSnapshot(result)!;
      if (destroyed || signal.aborted || key !== identity) throw Error('Sidebar request cancelled');
      cached = snapshot; loadedAt = Date.now(); return structuredClone(snapshot);
    })();
    pending = task;
    try { return await task; } finally { if (pending === task) pending = undefined; }
  }
  return { read, destroy() { destroyed = true; controller.abort(); cached = undefined; pending = undefined; } };
}
