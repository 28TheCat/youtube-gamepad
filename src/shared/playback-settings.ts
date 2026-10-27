import { normalizeIntegerSetting } from './number-settings';

export const playbackParameterDefaults = { seekStep: 10, shortsSeekStep: 5, volumeStep: 5 };
export type PlaybackParameters = typeof playbackParameterDefaults;
export const playbackParameters = [
  { key: 'seekStep', label: 'Video seek step', min: 1, max: 120, step: 1, suffix: ' s' },
  { key: 'shortsSeekStep', label: 'Shorts seek step', min: 1, max: 120, step: 1, suffix: ' s' },
  { key: 'volumeStep', label: 'Volume step', min: 1, max: 25, step: 1, suffix: '%' }
] as const;
export function normalizePlaybackParameters(raw: Partial<Record<keyof PlaybackParameters, unknown>>): PlaybackParameters {
  const values = { ...playbackParameterDefaults };
  for (const { key, min, max } of playbackParameters) {
    values[key] = normalizeIntegerSetting(raw[key], min, max, playbackParameterDefaults[key]);
  }
  return values;
}
