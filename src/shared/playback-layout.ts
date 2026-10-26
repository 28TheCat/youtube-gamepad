export type PlaybackLayout = 'fullscreen' | 'windowed';

export function normalizePlaybackLayout(value: unknown): PlaybackLayout {
  return value === 'windowed' || value === 'normal' || value === 'wide' ? 'windowed' : 'fullscreen';
}
