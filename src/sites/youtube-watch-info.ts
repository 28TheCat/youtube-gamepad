import { createWatchDataService, type WatchDataService } from './youtube-watch-data';
import { Innertube, Parser, YTNodes } from 'youtubei.js/web';
import { createYouTubeSession } from './youtube-session';
import type { YouTubeVideoDetails } from '../../types/core';
import { parseWatchLink, parseShortLink } from '../shared/watch-link';
import { createYouTubeHeaders, requestYouTube, mutateYouTube } from './youtube-request';
import { PAGE_WATCH_INFO } from '../bridge/page-protocol';
import './youtube-parser';
import { channelBadge } from './youtube-channel-badge';

export interface SavedPlaylist { key: string; title: string; selected: boolean }
export interface WatchInfoSnapshot {
  route: string; details?: YouTubeVideoDetails; avatar: string;
  channelBadge?: 'verified' | 'artist';
  notificationPreference?: import('../../types/ports').NotificationPreference;
  subscribed: boolean; liked: boolean; disliked: boolean;
  canLike: boolean; canSubscribe: boolean; canSave: boolean;
  loading: boolean; failed: boolean; working: boolean;
}
type Node = Record<string, any>;
type VideoInfo = Awaited<ReturnType<Innertube['getInfo']>>;
const empty = (route: string): WatchInfoSnapshot => ({ route, avatar: '', subscribed: false, liked: false,
  disliked: false, canLike: false, canSubscribe: false, canSave: false, loading: false, failed: false, working: false });
Parser.setParserErrorHandler(() => {});

// Current video/channel and playlist endpoints are service-owned. The bridge
// accepts fixed actions and opaque playlist keys, never arbitrary API payloads.
export function createWatchInfoService(sharedData?: WatchDataService) {
  const dataService = sharedData || createWatchDataService();
  let state = empty(''), destroyed = false, api: Innertube | undefined;
  let pending: Promise<void> | undefined, retryAt = 0, controller = new AbortController();
  let channelId = '';
  let nextResponse: Node | undefined;
  const playlists = new Map<string, { value: SavedPlaylist; node: InstanceType<typeof YTNodes.PlaylistAddToOption> }>();
  const route = () => location.pathname + location.search;
  const notify = () => { if (!destroyed) document.dispatchEvent(new Event(PAGE_WATCH_INFO)); };
  function syncRoute() {
    dataService.routeChanged();
    if (state.route === route()) return;
    controller.abort(); controller = new AbortController(); pending = undefined; api = undefined;
    retryAt = 0; channelId = ''; nextResponse = undefined; playlists.clear(); state = empty(route());
  }
  function client() {
    if (api) return api;
    const config = (key: string) => (window as any).ytcfg?.get?.(key);
    const context = config('INNERTUBE_CONTEXT');
    if (!context?.client) throw Error('YouTube context unavailable');
    const captured = state, signal = controller.signal;
    const session = createYouTubeSession(context, async () => { throw Error('Unexpected watch parser request'); });
    session.logged_in = config('LOGGED_IN') === true || /(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=/.test(document.cookie);
    session.actions.execute = (async (endpoint: string, args: Node = {}) => {
      const path = endpoint.replace(/^\//, '');
      const readOnly = ['player', 'next', 'playlist/get_add_to_playlist'].includes(path);
      if (!readOnly && !['like/like', 'like/dislike', 'like/removelike', 'subscription/subscribe',
        'subscription/unsubscribe', 'notification/modify_channel_preference', 'browse/edit_playlist'].includes(path)) throw Error('Unexpected watch API endpoint');
      if (destroyed || captured !== state || signal.aborted || captured.route !== route()) throw Error('Watch request cancelled');
      const headers = await createYouTubeHeaders(context);
      const body: Node = {};
      for (const key of ['videoId', 'videoIds', 'target', 'channelIds', 'playlistId', 'params', 'actions'])
        if (args[key] !== undefined) body[key] = args[key];
      if (path.startsWith('like/') && typeof body.target === 'string') body.target = { videoId: body.target };
      const init = { method: 'POST', credentials: 'same-origin' as const, headers,
        body: JSON.stringify({ context, ...body }), signal };
      let raw: Node;
      if (readOnly) raw = await (path === 'next' ? dataService.read(init) : requestYouTube(path, init));
      else raw = await mutateYouTube(path, init);
      if (destroyed || captured !== state || signal.aborted || captured.route !== route()) throw Error('Watch request cancelled');
      if (path === 'next') nextResponse = raw;
      return args.parse ? Parser.parseResponse(raw) : { success: true, status_code: 200, data: raw };
    }) as typeof session.actions.execute;
    return api = new Innertube(session);
  }
  function load(): Promise<void> {
    syncRoute();
    const target = parseWatchLink(state.route) || parseShortLink(state.route);
    if (destroyed || !target || state.details || Date.now() < retryAt) return Promise.resolve();
    if (pending) return pending;
    const captured = state;
    captured.loading = true;
    pending = (async () => {
      try {
        let info: { basic_info: Partial<VideoInfo['basic_info']>; secondary_info?: VideoInfo['secondary_info'] };
        try {
          info = await client().getInfo(target.videoId);
          if (info.basic_info.id !== target.videoId) throw Error('Video details unavailable');
        }
        catch {
          // The native player may be playable even when a separate player API
          // request is rejected. Channel actions only need the authenticated next response.
          const next = await client().actions.execute('/next', { videoId: target.videoId, parse: true });
          const secondary = next.contents_memo?.getType(YTNodes.VideoSecondaryInfo)?.[0];
          const primary = next.contents_memo?.getType(YTNodes.VideoPrimaryInfo)?.[0];
          const owner = secondary?.owner?.author;
          const button = secondary?.subscribe_button;
          const channel = button?.is(YTNodes.SubscribeButton) ? button.channel_id : owner?.id;
          const responseId = next.current_video_endpoint?.payload?.videoId;
          if (!channel || !/^UC[\w-]+$/.test(channel) || responseId && responseId !== target.videoId) throw Error('Channel information unavailable');
          info = { basic_info: { id: target.videoId, channel_id: channel, title: primary?.title?.toString() || '',
            author: owner?.name || '', short_description: secondary?.description?.toString() || '',
            view_count: undefined, is_live: undefined, is_liked: undefined, is_disliked: undefined, allow_ratings: undefined }, secondary_info: secondary };
        }
        if (captured !== state || destroyed) return;
        const basic = info.basic_info;
        if (basic.id !== target.videoId) throw Error('Mismatched video details');
        channelId = basic.channel_id || '';
        captured.details = { videoId: basic.id, title: basic.title, author: basic.author,
          channelId, shortDescription: basic.short_description, viewCount: String(basic.view_count ?? ''), isLive: basic.is_live };
        const secondary = info.secondary_info;
        captured.channelBadge = channelBadge(secondary?.owner?.author, secondary?.owner?.attributed_title);
        const subscribe = secondary?.subscribe_button;
        const subscriptionEntity = nextResponse?.frameworkUpdates?.entityBatchUpdate?.mutations?.find((entry: Node) =>
          entry.payload?.subscriptionStateEntity?.channelId === channelId &&
          typeof entry.payload.subscriptionStateEntity.subscribed === 'boolean')?.payload.subscriptionStateEntity;
        const subscribed = subscribe?.is(YTNodes.SubscribeButton) ? subscribe.subscribed : subscriptionEntity?.subscribed;
        captured.subscribed = subscribed === true;
        const preferenceId = Number(subscribe?.is(YTNodes.SubscribeButton) ? subscribe.notification_preference_button?.current_state_id : undefined);
        captured.notificationPreference = preferenceId === 2 ? 'ALL' : preferenceId === 1 ? 'PERSONALIZED' : preferenceId === 3 ? 'NONE' : undefined;
        captured.canSubscribe = !!channelId && typeof subscribed === 'boolean' && client().session.logged_in;
        const liked = basic.is_liked, disliked = basic.is_disliked;
        captured.liked = liked === true; captured.disliked = disliked === true;
        captured.canLike = basic.allow_ratings !== false && typeof liked === 'boolean' &&
          typeof disliked === 'boolean' && client().session.logged_in;
        captured.canSave = client().session.logged_in;
        const avatar = secondary?.owner?.author.thumbnails?.[0]?.url;
        try { if (avatar && new URL(avatar).protocol === 'https:') captured.avatar = avatar; } catch { /* No avatar. */ }
        captured.failed = false;
      } catch {
        if (captured === state) { captured.failed = true; retryAt = Date.now() + 5000; }
      } finally {
        if (captured === state) { captured.loading = false; pending = undefined; notify(); }
      }
    })();
    return pending;
  }
  async function exclusive<T>(run: () => Promise<T>, fallback: T): Promise<T> {
    syncRoute();
    const expected = state;
    await load();
    if (destroyed || expected !== state || expected.route !== route() || !state.details || state.working || !client().session.logged_in) return fallback;
    const captured = state;
    captured.working = true; notify();
    try { return await run(); }
    catch { return fallback; }
    finally { if (captured === state) { captured.working = false; notify(); } }
  }
  async function act(action: 'like' | 'dislike' | 'subscribe' | 'unsubscribe' | 'notificationsAll' | 'notificationsPersonalized' | 'notificationsNone') {
    return exclusive(async () => {
      const current = state, id = state.details!.videoId!;
      const interaction = client().interact;
      if (action.startsWith('notifications')) {
        if (!state.canSubscribe || !state.subscribed) return false;
        const preference = action === 'notificationsAll' ? 'ALL' : action === 'notificationsPersonalized' ? 'PERSONALIZED' : 'NONE';
        await interaction.setNotificationPreferences(channelId, preference);
        current.notificationPreference = preference;
      } else if (action === 'subscribe' || action === 'unsubscribe') {
        if (!state.canSubscribe) return false;
        const subscribed = action === 'subscribe';
        if (state.subscribed === subscribed) return true;
        await (subscribed ? interaction.subscribe(channelId) : interaction.unsubscribe(channelId));
        current.subscribed = subscribed;
        current.notificationPreference = undefined;
      } else {
        if (!state.canLike) return false;
        const removing = action === 'like' ? state.liked : state.disliked;
        if (removing) await interaction.removeRating(id);
        else if (action === 'like') await interaction.like(id);
        else await interaction.dislike(id);
        current.liked = !removing && action === 'like'; current.disliked = !removing && action === 'dislike';
      }
      return true;
    }, false);
  }
  async function listPlaylists() {
    return exclusive(async () => {
      const response = await client().actions.execute('/playlist/get_add_to_playlist', { videoIds: [state.details!.videoId], parse: true });
      const options = [
        ...response.contents_memo?.getType(YTNodes.PlaylistAddToOption) || [],
        ...response.actions_memo?.getType(YTNodes.PlaylistAddToOption) || []
      ];
      playlists.clear();
      for (const [index, node] of options.slice(0, 100).entries()) {
        if (!node.playlist_id || !node.title.toString()) continue;
        const key = String(index);
        playlists.set(key, { node, value: { key, title: node.title.toString().slice(0, 200), selected: node.contains_selected_videos === 'ALL' } });
      }
      return [...playlists.values()].map(item => ({ ...item.value }));
    }, undefined as SavedPlaylist[] | undefined);
  }
  async function togglePlaylist(key: string) {
    return exclusive(async () => {
      const option = playlists.get(key);
      if (!option) return false;
      const endpoint = option.value.selected ? option.node.remove_from_playlist_service_endpoint : option.node.add_to_playlist_service_endpoint;
      const command = endpoint.command;
      const path = command?.is(YTNodes.PlaylistEditEndpoint) ? command.getApiPath() : endpoint.metadata.api_url?.replace(/^\//, '');
      if (path !== 'browse/edit_playlist') return false;
      await endpoint.call(client().actions);
      option.value.selected = !option.value.selected;
      return true;
    }, false);
  }
  return { read() { syncRoute(); void load(); return { ...state }; }, act, listPlaylists, togglePlaylist,
    routeChanged: syncRoute,
    destroy() { destroyed = true; controller.abort(); playlists.clear(); api = undefined; if (!sharedData) dataService.destroy(); } };
}
