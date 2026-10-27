import type { YouTubeVideoDetails } from '../../types/core';
import type { WatchNextSnapshot } from '../sites/youtube-next';
import type { CommentsSnapshot } from '../sites/youtube-comments';
import { commentLanguage } from '../shared/comment-language';
import type { AccountSnapshot } from '../sites/youtube-account';
import type { WatchInfoSnapshot, SavedPlaylist } from '../sites/youtube-watch-info';
import { parseWatchLink } from '../shared/watch-link';
import type { SidebarSnapshot } from '../shared/sidebar-data';

export const PAGE_REQUEST = 'ytg-page-request-v1';
export const PAGE_RESPONSE = 'ytg-page-response-v1';
export const PAGE_HISTORY = 'ytg-page-history-v1';
export const PAGE_WATCH_NEXT = 'ytg-watch-next-updated-v1';
export const PAGE_COMMENTS = 'ytg-comments-updated-v1';
export const PAGE_WATCH_INFO = 'ytg-watch-info-updated-v1';
export type PageOperation = 'shortsRecommendations' | 'playShorts' | 'readShortsSettings' | 'shortsSetting' | 'readSidebar' | 'readAccount' | 'ping' | 'readPlayerVideoId' | 'readVideoDetails' | 'readWatchInfo' | 'watchAction' | 'watchPlaylists' | 'watchPlaylistToggle' | 'showControls' | 'hideControls' | 'readWatchNext' | 'moreWatchNext' | 'openBrowseVideo' | 'openBrowseRoute' | 'readComments' | 'moreComments' | 'commentReplies' | 'commentTranslate' | 'commentPost' | 'commentSort';
export interface PageAccess {
  shortsRecommendations?(videoId: string, reset?: boolean): Promise<{ ids: string[]; hasMore: boolean } | undefined>;
  playShorts?(videoId: string): boolean;
  readShortsSettings?(): ShortsSettings | undefined;
  shortsSetting?(videoId: string, action: 'captions' | 'quality', quality?: string): boolean;
  readSidebar?(): Promise<SidebarSnapshot | undefined>;
  readAccount?(refresh?: boolean): Promise<AccountSnapshot | undefined>;
  destroy?(): void;
  readonly available?: boolean;
  ping?(): boolean;
  readPlayerVideoId?(): string | undefined;
  readVideoDetails(): YouTubeVideoDetails | undefined;
  readWatchInfo?(): WatchInfoSnapshot | undefined;
  watchAction?(action: 'like' | 'dislike' | 'subscribe' | 'unsubscribe' | 'notificationsAll' | 'notificationsPersonalized' | 'notificationsNone'): Promise<boolean>;
  watchPlaylists?(): Promise<SavedPlaylist[] | undefined>;
  watchPlaylistToggle?(key: string): Promise<boolean>;
  showControls(): void;
  hideControls(): void;
  readWatchNext?(): WatchNextSnapshot | undefined;
  moreWatchNext?(): boolean;
  openWatchVideo?(href: string): boolean;
  openBrowseRoute?(href: string): boolean;
  readComments?(): CommentsSnapshot | undefined;
  moreComments?(start?: boolean): boolean;
  commentReplies?(key: string): boolean;
  commentTranslate?(key: string, language: string): boolean;
  commentPost?(text: string, key?: string): Promise<boolean>;
  commentSort?(sort: 'TOP_COMMENTS' | 'NEWEST_FIRST'): boolean;
}

export const playbackQualities = ['auto', 'highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'] as const;
export interface ShortsSettings { videoId: string; captionsAvailable: boolean; captionsEnabled: boolean; qualities: string[]; quality: string }
export function shortsSettingsSnapshot(raw: unknown): ShortsSettings | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as ShortsSettings;
  if (typeof value.videoId !== 'string' || !/^[\w-]{1,100}$/.test(value.videoId) || !Array.isArray(value.qualities)) return;
  const allowed = new Set<string>(playbackQualities);
  return { videoId: value.videoId, captionsAvailable: value.captionsAvailable === true, captionsEnabled: value.captionsEnabled === true,
    qualities: [...new Set(value.qualities.filter(item => typeof item === 'string' && allowed.has(item)))].slice(0, 11),
    quality: allowed.has(value.quality) ? value.quality : '' };
}

export function watchInfoSnapshot(raw: unknown): WatchInfoSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as WatchInfoSnapshot;
  if (typeof value.route !== 'string' || value.route.length > 4096) return;
  let avatar = '';
  try { if (typeof value.avatar === 'string' && value.avatar.length <= 4096 && new URL(value.avatar).protocol === 'https:') avatar = value.avatar; } catch { /* No avatar. */ }
  return { route: value.route, details: videoDetails(value.details), avatar,
    ...((value.channelBadge === 'verified' || value.channelBadge === 'artist') ? { channelBadge: value.channelBadge } : {}),
    ...(['ALL', 'PERSONALIZED', 'NONE'].includes(value.notificationPreference || '') ? { notificationPreference: value.notificationPreference } : {}),
    subscribed: value.subscribed === true, liked: value.liked === true, disliked: value.disliked === true,
    canLike: value.canLike === true, canSubscribe: value.canSubscribe === true, canSave: value.canSave === true,
    loading: value.loading === true, failed: value.failed === true, working: value.working === true };
}
export function savedPlaylists(raw: unknown): SavedPlaylist[] | undefined {
  if (!Array.isArray(raw)) return;
  return raw.slice(0, 100).flatMap(item => item && typeof item.key === 'string' && /^\d{1,3}$/.test(item.key) &&
    typeof item.title === 'string' ? [{ key: item.key, title: item.title.slice(0, 200), selected: item.selected === true }] : []);
}

export function commentsSnapshot(raw: unknown): CommentsSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as CommentsSnapshot;
  if (typeof value.route !== 'string' || value.route.length > 4096 || !Array.isArray(value.items)) return;
  let replyBudget = 200;
  const avatar = (url: unknown): { avatar?: string } => {
    try { if (typeof url === 'string' && url.length <= 4096 && new URL(url).protocol === 'https:') return { avatar: url }; }
    catch { /* Keep the author placeholder for missing or invalid images. */ }
    return {};
  };
  const translation = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return {};
    const value = raw as NonNullable<import('../../types/ports').CommentReplySnapshot['translation']>;
    const language = commentLanguage(value.language);
    if (!language) return {};
    return { translation: { language, loading: value.loading === true, failed: value.failed === true,
      ...(typeof value.text === 'string' ? { text: value.text.slice(0, 8000) } : {}) } };
  };
  const translationEntry = (value: { translationTarget?: unknown }) => {
    const target = commentLanguage(value.translationTarget);
    return target ? { translationTarget: target } : {};
  };
  const items = value.items.slice(0, 100).flatMap(item => {
    if (!item || typeof item.key !== 'string' || item.key.length > 200 || typeof item.author !== 'string' ||
      typeof item.text !== 'string' || !Array.isArray(item.replies)) return [];
    // Only export reply identity and display text; never expose library nodes or endpoints.
    const replies = item.replies.slice(0, Math.min(replyBudget, 100)).flatMap(reply =>
      reply && typeof reply.key === 'string' && reply.key.length <= 200 && typeof reply.author === 'string' &&
      typeof reply.text === 'string'
        ? [{ key: reply.key, author: reply.author.slice(0, 200), text: reply.text.slice(0, 2000), ...avatar(reply.avatar), ...translationEntry(reply), ...translation(reply.translation) }] : []);
    replyBudget -= replies.length;
    return [{ key: item.key, author: item.author.slice(0, 200), text: item.text.slice(0, 4000), ...avatar(item.avatar), ...translationEntry(item), ...translation(item.translation),
      ...(Number.isSafeInteger(item.replyCount) && item.replyCount! >= 0 ? { replyCount: item.replyCount } : {}),
      ...(item.canReply === true ? { canReply: true } : {}), hasReplies: item.hasReplies === true, repliesLabel: typeof item.repliesLabel === 'string' ? item.repliesLabel.slice(0, 100) : '', replies }];
  });
  const interaction = value.interaction;
  return { ...(interaction && typeof interaction === 'object' ? { interaction: {
    signedIn: interaction.signedIn === true, canPost: interaction.canPost === true, posting: interaction.posting === true,
    sort: interaction.sort === 'NEWEST_FIRST' ? 'NEWEST_FIRST' as const : 'TOP_COMMENTS' as const, sortAvailable: interaction.sortAvailable === true
  } } : {}), route: value.route, items, loading: value.loading === true, failed: value.failed === true, hasMore: value.hasMore === true };
}

export function watchNextSnapshot(raw: unknown): WatchNextSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as WatchNextSnapshot;
  if (typeof value.route !== 'string' || value.route.length > 4096 || !Array.isArray(value.recommendations) || !Array.isArray(value.queue)) return;
  const items = (source: WatchNextSnapshot['queue']) => source.slice(0, 120).flatMap(item => {
    const target = parseWatchLink(item?.href);
    if (!target || typeof item.key !== 'string' || item.key.length > 4200 || typeof item.label !== 'string' || typeof item.channel !== 'string') return [];
    let thumbnail = `https://i.ytimg.com/vi/${target.videoId}/hqdefault.jpg`;
    try { const url = new URL(item.thumbnail); if (url.protocol === 'https:') thumbnail = url.href; } catch { /* Use a safe video thumbnail. */ }
    return [{ key: item.key, href: target.href, label: item.label.slice(0, 2000), channel: item.channel.slice(0, 2000), thumbnail,
      ...((item.channelBadge === 'verified' || item.channelBadge === 'artist') ? { channelBadge: item.channelBadge } : {}),
      thumbnailFallback: `https://i.ytimg.com/vi/${target.videoId}/hqdefault.jpg`,
      metadata: typeof item.metadata === 'string' ? item.metadata.slice(0, 200) : '',
      viewCount: typeof item.viewCount === 'string' ? item.viewCount.slice(0, 200) : '',
      ...(typeof item.watchedPercent === 'number' && Number.isFinite(item.watchedPercent) && item.watchedPercent > 0
        ? { watchedPercent: Math.min(100, item.watchedPercent) } : {}),
      duration: typeof item.duration === 'string' ? item.duration.slice(0, 40) : '', isPlaylist: item.isPlaylist === true, queue: item.queue === true, selected: item.selected === true }];
  });
  return { route: value.route, recommendations: items(value.recommendations), queue: items(value.queue), loading: value.loading === true, failed: value.failed === true,
    ...(typeof value.playlistTitle === 'string' ? { playlistTitle: value.playlistTitle.slice(0, 2000) } : {}) };
}

// All data crossing the page boundary is untrusted, including private API output.
export function videoDetails(raw: unknown): YouTubeVideoDetails | undefined {
  if (!raw || typeof raw !== 'object') return;
  const source = raw as Record<string, unknown>;
  const result: YouTubeVideoDetails = {};
  for (const key of ['videoId', 'title', 'author', 'shortDescription', 'channelId', 'viewCount'] as const) {
    if (typeof source[key] === 'string') result[key] = source[key].slice(0, key === 'shortDescription' ? 20000 : 2000);
  }
  if (typeof source.isLive === 'boolean') result.isLive = source.isLive;
  return result;
}

export function parsePageMessage(detail: unknown): Record<string, unknown> | undefined {
  if (typeof detail !== 'string' || detail.length > 2000000) return;
  try {
    const value = JSON.parse(detail);
    if (value && typeof value === 'object' && value.version === 1) return value;
  } catch { /* Malformed page traffic is ignored. */ }
}

export function accountSnapshot(raw: unknown): AccountSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as AccountSnapshot;
  if (typeof value.signedIn !== 'boolean' || !Array.isArray(value.accounts)) return;
  return { signedIn: value.signedIn, accounts: value.signedIn ? value.accounts.slice(0, 50).flatMap(item => {
    if (!item || typeof item.key !== 'string' || !/^\d{1,2}$/.test(item.key) || typeof item.name !== 'string') return [];
    let avatar = '';
    try { if (typeof item.avatar === 'string' && item.avatar.length <= 4096 && new URL(item.avatar).protocol === 'https:') avatar = item.avatar; } catch { /* No avatar. */ }
    return [{ key: item.key, name: item.name.slice(0, 200), handle: typeof item.handle === 'string' ? item.handle.slice(0, 200) : '', avatar,
      selected: item.selected === true, disabled: item.disabled === true }];
  }) : [] };
}
