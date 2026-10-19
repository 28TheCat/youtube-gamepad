import { videoGridDefaults, normalizeVideoGrid } from './video-grid';
import { languageDefault, normalizeLanguage } from './i18n';
export const settingDefaults = {
  playbackLayout: 'page' as 'normal' | 'wide' | 'page',
  ...videoGridDefaults, uiLanguage: languageDefault, enabled: true, rightHandMode: false, theater: true, autoFullscreen: true,
  deadzone: 0.35, repeatDelay: 150, repeatInterval: 80
};
export type Settings = typeof settingDefaults;
export type SettingKey = keyof Settings;
const ranges = { deadzone: [0.15, 0.75], repeatDelay: [150, 1000], repeatInterval: [80, 500] } as const;

export function normalizeSettings(raw: Record<string, unknown>): Settings {
  const values = { ...settingDefaults };
  values.playbackLayout = raw.playbackLayout === 'normal' || raw.playbackLayout === 'wide' ? raw.playbackLayout : 'page';
  values.uiLanguage = normalizeLanguage(raw.uiLanguage);
  for (const key of ['enabled', 'theater', 'autoFullscreen', 'rightHandMode'] as const)
    if (typeof raw[key] === 'boolean') values[key] = raw[key];
  if (typeof raw.autoFullscreen !== 'boolean') values.autoFullscreen = values.theater;
  for (const key of ['deadzone', 'repeatDelay', 'repeatInterval'] as const) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value))
      values[key] = Math.min(ranges[key][1], Math.max(ranges[key][0], value));
  }
  return { ...values, ...normalizeVideoGrid(raw) };
}

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(Object.keys(settingDefaults));
  const values = normalizeSettings(raw);
  if (typeof raw.autoFullscreen !== 'boolean')
    await chrome.storage.local.set({ autoFullscreen: values.autoFullscreen });
  return values;
}
