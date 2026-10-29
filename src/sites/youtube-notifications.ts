import { createRequestScope } from './request-scope';
import { Innertube, YTNodes } from 'youtubei.js/web';
import { createYouTubeSession } from './youtube-session';
import { createYouTubeHeaders, requestYouTube } from './youtube-request';

export interface NotificationItem { id: string; text: string; time: string; avatar: string; thumbnail: string; href: string; read: boolean }
export interface NotificationSnapshot { signedIn: boolean; count: number | null; items: NotificationItem[]; hasMore: boolean }

export function notificationSnapshot(raw: unknown): NotificationSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return;
  const data = raw as NotificationSnapshot;
  if (typeof data.signedIn !== 'boolean' || !Array.isArray(data.items)) return;
  const image = (value: unknown) => { try { const url = new URL(String(value)); return url.protocol === 'https:' && url.href.length <= 4096 ? url.href : ''; } catch { return ''; } };
  const href = (value: unknown) => { try { if (typeof value !== 'string' || !value.trim() || value.length > 4096) return ''; const url = new URL(value, 'https://www.youtube.com'); return url.origin === 'https://www.youtube.com' && !url.username && !url.password ? url.pathname + url.search + url.hash : ''; } catch { return ''; } };
  return { signedIn: data.signedIn, count: Number.isInteger(data.count) && data.count! >= 0 ? Math.min(data.count!, 100000) : null,
    hasMore: data.hasMore === true, items: data.items.slice(0, 100).flatMap(item => {
      if (!item || typeof item.id !== 'string' || typeof item.text !== 'string') return [];
      return [{ id: item.id.slice(0, 200), text: item.text.slice(0, 1000), time: typeof item.time === 'string' ? item.time.slice(0, 100) : '',
        avatar: image(item.avatar), thumbnail: image(item.thumbnail), href: href(item.href), read: item.read === true }];
    }) };
}

export function createNotificationService() {
  const requests = createRequestScope();
  let identity = '', cursor: Awaited<ReturnType<Innertube['getNotifications']>> | undefined, items: NotificationItem[] = [], count: number | null = null;
  let destroyed = false;
  const config = (key: string) => (window as any).ytcfg?.get?.(key);
  async function read(mode: 'count' | 'list' | 'more'): Promise<NotificationSnapshot> {
    const sid = document.cookie.split(/;\s*/).find(value => value.startsWith('SAPISID='))?.slice(8) || document.cookie.split(/;\s*/).find(value => value.startsWith('__Secure-3PAPISID='))?.slice(18) || '';
    const signedIn = config('LOGGED_IN') === true || config('LOGGED_IN') !== false && !!sid;
    const context = config('INNERTUBE_CONTEXT');
    const key = JSON.stringify([sid, signedIn, config('SESSION_INDEX'), config('DELEGATED_SESSION_ID'), context?.user]);
    if (key !== identity) { requests.cancel(); identity = key; cursor = undefined; items = []; count = null; }
    if (!signedIn) return { signedIn: false, count: null, items: [], hasMore: false };
    if (destroyed || !context?.client || requests.pending) throw Error('Notifications unavailable');
    const request = requests.begin();
    const signal = request.signal;
    const session = createYouTubeSession(context, async () => { throw Error('Unexpected notification request'); });
    session.logged_in = true;
    session.actions.execute = (async (endpoint: string, args: Record<string, any> = {}) => {
      const path = endpoint.replace(/^\//, '');
      if (!['notification/get_unseen_count', 'notification/get_notification_menu'].includes(path)) throw Error('Unexpected notification endpoint');
      const headers = await createYouTubeHeaders(context, sid);
      const { parse, skip_auth_check, ...body } = args;
      const raw = await requestYouTube(path, { headers, body: JSON.stringify({ context, ...body }), signal });
      if (!request.current || identity !== key) throw Error('Notification request cancelled');
      return { success: true, status_code: 200, data: raw };
    }) as typeof session.actions.execute;
    const client = new Innertube(session);
    try {
      if (mode === 'count') count = await client.getUnseenNotificationsCount();
      else {
        if (mode === 'more' && !cursor) throw Error('No notification continuation');
        const page = mode === 'more' ? await cursor!.getContinuation() : await client.getNotifications();
        if (!request.current || identity !== key) throw Error('Notification request cancelled');
        const mapped = page.contents.map((item, index) => ({ id: item.notification_id || String(index), text: item.short_message?.toString() || '', time: item.sent_time?.toString() || '',
          avatar: item.thumbnails?.[0]?.url || '', thumbnail: item.video_thumbnails?.[0]?.url || '', href: item.endpoint?.toURL() || item.endpoint?.metadata?.url || '', read: item.read === true }));
        const unique = new Map((mode === 'more' ? [...items, ...mapped] : mapped).map(item => [item.id, item]));
        items = notificationSnapshot({ signedIn: true, count, items: [...unique.values()], hasMore: false })!.items;
        cursor = items.length < 100 && !!page.page.actions_memo?.getType(YTNodes.ContinuationItem).length ? page : undefined;
      }
      return { signedIn: true, count, items, hasMore: !!cursor };
    } finally { request.finish(); }
  }
  return { read, destroy() { destroyed = true; requests.destroy(); cursor = undefined; items = []; } };
}
