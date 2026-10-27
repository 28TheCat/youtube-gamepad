import type { PlaybackSnapshot, WatchPageSnapshot, WatchFeatures, WatchSnapshot, RecommendationSnapshot } from '../../types/ports';
import type { PlaybackViewState } from '../playback/playback-model';

export type PlaybackMetadata = Pick<WatchPageSnapshot, 'title' | 'channel' | 'channelBadge' | 'viewCount' | 'avatar' | 'notificationPreference' | 'subscribed' | 'liked' | 'disliked'>;
export type PlaybackControlState = Pick<PlaybackViewState, 'paused' | 'muted' | 'captionsEnabled' | 'isLive' | 'canSeek' | 'atLiveEdge'> & { seekStep?: number };

const recommendationFields = ['key', 'label', 'channel', 'channelBadge', 'thumbnail', 'thumbnailFallback', 'metadata', 'viewCount', 'duration', 'watchedPercent', 'href', 'queue', 'selected', 'isPlaylist'] as const;
export function sameRecommendations(left: readonly RecommendationSnapshot[], right: readonly RecommendationSnapshot[]) {
  return left === right || left.length === right.length && left.every((item, index) => item === right[index] ||
    recommendationFields.every(field => item[field] === right[index][field]));
}

export interface SeekPreview { target: number; delta: number; start: number; end: number }
export interface PlaybackFeedback {
  label: string;
  icon?: string;
  level?: number;
  seek?: SeekPreview;
}
/** Distinguish repeated videos while keeping identity independent of list position. */
export function recommendationFocusId(items: readonly { key: string }[], index: number) {
  const key = items[index]?.key || '';
  return 'recommendation:' + key + ':' + items.slice(0, index).filter(item => item.key === key).length;
}
export function recommendationFocusIds(items: readonly { key: string }[]) {
  const counts = new Map<string, number>();
  return items.map(item => {
    const occurrence = counts.get(item.key) || 0;
    counts.set(item.key, occurrence + 1);
    return `recommendation:${item.key}:${occurrence}`;
  });
}
export interface PlaybackPresenter {
  playback(value: PlaybackSnapshot): void;
  visible(value: boolean): void;
  page(value: WatchPageSnapshot, features: WatchFeatures): void;
  selection(row: WatchSnapshot['row'], selected: string, adjusting: boolean): void;
  feedback(value: PlaybackFeedback | null): void;
  reset(): void;
  cards(): HTMLButtonElement[];
  destroy(): void;
}
export function formatPlaybackTime(value: number) {
  if (!Number.isFinite(value)) return 'Live';
  const seconds = Math.max(0, Math.floor(value)), hours = Math.floor(seconds / 3600);
  return (hours ? hours + ':' : '') + (hours ? String(Math.floor(seconds / 60) % 60).padStart(2, '0') : Math.floor(seconds / 60)) + ':' + String(seconds % 60).padStart(2, '0');
}
