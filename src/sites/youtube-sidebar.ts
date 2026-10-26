import { Innertube, Session, YTNodes } from 'youtubei.js/web';
import { defaultSidebar, sidebarHref, sidebarSnapshot, type SidebarSnapshot, type SidebarEntry } from '../shared/sidebar-data';
import { resolveExplorePage } from '../shared/explore-pages';
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
    const key = JSON.stringify([sid, config('LOGGED_IN'), config('SESSION_INDEX'), config('DELEGATED_SESSION_ID'), context?.user]);
    if (identity !== key) {
      controller.abort(); controller = new AbortController(); identity = key; cached = undefined; pending = undefined; loadedAt = 0;
    }
    if (!context?.client) throw Error('YouTube context unavailable');
    if (pending) return pending;
    if (cached && Date.now() - loadedAt < 60000) return structuredClone(cached);
    const signal = controller.signal;
    const session = new Session(structuredClone({ ...context, user: context.user || {} }), '', 'v1', 0,
      undefined, undefined, undefined, async () => { throw Error('Unexpected sidebar request'); });
    session.actions.execute = (async (endpoint: string) => {
      if (endpoint.replace(/^\//, '') !== 'guide') throw Error('Unexpected sidebar endpoint');
      const headers = await createYouTubeHeaders(context, sid);
      if (destroyed || signal.aborted || key !== identity) throw Error('Sidebar request cancelled');
      const data = await requestYouTube('guide', { method: 'POST', credentials: 'same-origin', headers,
        body: JSON.stringify({ context }), signal });
      if (destroyed || signal.aborted || key !== identity) throw Error('Sidebar request cancelled');
      if (!Array.isArray(data.items)) throw Error('Sidebar guide unavailable');
      return { success: true, status_code: 200, data };
    }) as typeof session.actions.execute;
    const task = (async () => {
      const guide = await new Innertube(session).getGuide();
      const result = defaultSidebar(), explore: SidebarEntry[] = [], seen = new Set<string>();
      const exploreIcons = new Set(['TRENDING', 'MUSIC', 'MOVIES', 'LIVE', 'GAMING', 'NEWS', 'SPORTS', 'SHOPPING', 'PODCASTS', 'FASHION', 'FASHION_BEAUTY', 'LEARNING', 'COURSES']);
      let budget = 1000;
      function flatten(items: readonly any[], depth = 0): InstanceType<typeof YTNodes.GuideEntry>[] {
        if (depth > 8 || budget <= 0) return [];
        const entries: InstanceType<typeof YTNodes.GuideEntry>[] = [];
        for (const item of items) {
          if (--budget < 0) break;
          if (item.is(YTNodes.GuideEntry)) entries.push(item);
          else if (item.is(YTNodes.GuideCollapsibleEntry)) entries.push(...flatten(item.expandable_items, depth + 1));
          else if (item.is(YTNodes.GuideCollapsibleSectionEntry)) entries.push(...flatten(item.section_items, depth + 1));
        }
        return entries;
      }
      for (const section of guide.contents || []) {
        if (section.type === YTNodes.GuideSubscriptionsSection.type) continue;
        const entries = flatten(section.items);
        const exploreSection = entries.some(entry => {
          const href = sidebarHref(entry.endpoint.metadata.url || entry.endpoint.payload.url);
          return !!href && (!!resolveExplorePage(href) || exploreIcons.has(entry.icon_type || ''));
        });
        for (const entry of entries) {
          const endpoint = entry.endpoint;
          const href = sidebarHref(endpoint.metadata.url || endpoint.payload.url);
          if (!href) continue;
          const personal = result.personal.find(item => item.href === href || item.id === 'videos' &&
            ['MY_VIDEOS', 'CREATOR_STUDIO'].includes(entry.icon_type || '') && href.startsWith('https://studio.youtube.com/'));
          if (personal) { personal.href = href; continue; }
          if (href.startsWith('https:') || !entry.title.toString().trim() || seen.has(href) ||
            !(exploreSection && href !== '/' && href !== '/feed/subscriptions')) continue;
          seen.add(href);
          explore.push({ id: `explore:${explore.length}`, label: entry.title.toString().slice(0, 200), href, icon: 'explore' });
        }
      }
      if (explore.length) result.explore = explore;
      const snapshot = sidebarSnapshot(result)!;
      if (destroyed || signal.aborted || key !== identity) throw Error('Sidebar request cancelled');
      cached = snapshot; loadedAt = Date.now(); return structuredClone(snapshot);
    })();
    pending = task;
    try { return await task; } finally { if (pending === task) pending = undefined; }
  }
  return { read, destroy() { destroyed = true; controller.abort(); cached = undefined; pending = undefined; } };
}
