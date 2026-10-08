import type { PlaybackSnapshot, WatchPageSnapshot, WatchFeatures, WatchSnapshot } from '../../types/ports';

export interface PlaybackPresentation {
  page: WatchPageSnapshot;
  features: WatchFeatures;
  selected: string;
  adjusting: boolean;
  row: WatchSnapshot['row'];
  start: number;
}
export interface PlaybackFeedback {
  label: string;
  icon?: string;
  level?: number;
}
/** Distinguish repeated videos while keeping identity independent of list position. */
export function recommendationFocusId(items: readonly { key: string }[], index: number) {
  const key = items[index]?.key || '';
  return 'recommendation:' + key + ':' + items.slice(0, index).filter(item => item.key === key).length;
}
export interface PlaybackPresenter {
  playback(value: PlaybackSnapshot): void;
  visible(value: boolean): void;
  page(value: WatchPageSnapshot, features: WatchFeatures): void;
  selection(row: WatchSnapshot['row'], selected: string, adjusting: boolean): void;
  recommendationPage(start: number): void;
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
