import type { BrowseItem } from './browse-data';
import { normalizeIntegerSetting } from './number-settings';

export const homeFilterDefaults = {
  homeMinViews: 0, homeMinLikes: 0, homeMinDuration: 0, homeMaxAgeDays: 0,
  homeHideVertical: false, homeExemptSubscribed: true, homeAutoPages: 3
};
export type HomeFilterSettings = typeof homeFilterDefaults;
export const homeFilterNumbers = [
  { key: 'homeMinViews', label: 'Minimum views', min: 0, max: 1000000000, step: 1000, suffix: '' },
  { key: 'homeMinLikes', label: 'Minimum likes', min: 0, max: 100000000, step: 100, suffix: '' },
  { key: 'homeMinDuration', label: 'Minimum video duration', min: 0, max: 86400, step: 30, suffix: ' s' },
  { key: 'homeMaxAgeDays', label: 'Published within days', min: 0, max: 3650, step: 1, suffix: ' d' },
  { key: 'homeAutoPages', label: 'Automatic extra page limit', min: 0, max: 10, step: 1, suffix: '' }
] as const;
export interface HomeFilterData {
  views?: number; likes?: number; duration?: number; publishedAt?: number;
  vertical?: boolean; subscribed?: boolean; channelId?: string;
}
export function normalizeHomeFilter(raw: Partial<Record<keyof HomeFilterSettings, unknown>>): HomeFilterSettings {
  const result = { ...homeFilterDefaults };
  for (const { key, min, max } of homeFilterNumbers) {
    result[key] = normalizeIntegerSetting(raw[key], min, max, homeFilterDefaults[key]);
  }
  for (const key of ['homeHideVertical', 'homeExemptSubscribed'] as const) if (typeof raw[key] === 'boolean') result[key] = raw[key];
  return result;
}
export function homeFilterActive(values: HomeFilterSettings) {
  return values.homeMinViews > 0 || values.homeMinLikes > 0 || values.homeMinDuration > 0 || values.homeMaxAgeDays > 0 || values.homeHideVertical;
}
/** Missing metadata stays unknown, never becomes zero or a guessed subscription. */
export function safeHomeFilterData(raw: unknown): HomeFilterData | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as HomeFilterData, result: HomeFilterData = {};
  for (const key of ['views', 'likes', 'duration', 'publishedAt'] as const)
    if (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key]! >= 0 && value[key]! <= Number.MAX_SAFE_INTEGER) result[key] = value[key];
  for (const key of ['vertical', 'subscribed'] as const) if (typeof value[key] === 'boolean') result[key] = value[key];
  if (typeof value.channelId === 'string' && /^UC[\w-]{1,100}$/.test(value.channelId)) result.channelId = value.channelId;
  return Object.keys(result).length ? result : undefined;
}
export function parseViewCount(text: string): number | undefined {
  const value = text.trim().replace(/^(?:观看次数|觀看次數)[:：]\s*/, '');
  if (/^(?:no views|暂无观看|暫無觀看)$/i.test(value)) return 0;
  const match = value.match(/^(\d[\d, .]*?)\s*([KMB万萬亿億])?(?:\s*(?:views?|次观看|次觀看|次播放|次|人观看|人觀看))?$/i);
  if (!match) return;
  const factor = ({ k: 1e3, m: 1e6, b: 1e9, '万': 1e4, '萬': 1e4, '亿': 1e8, '億': 1e8 } as Record<string, number>)[match[2]?.toLowerCase()] || 1;
  const numeric = match[1].trim().replace(/\s/g, '');
  const number = Number(factor > 1 ? numeric.replace(',', '.') : /^\d{1,3}(?:[,.]\d{3})+$/.test(numeric) ? numeric.replace(/[,.]/g, '') : /^\d+$/.test(numeric) ? numeric : NaN);
  return Number.isFinite(number) && number >= 0 ? number * factor : undefined;
}
export function parseDuration(text: string): number | undefined {
  if (!/^\d+(?::\d{2}){1,2}$/.test(text) || text.split(':').slice(1).some(part => Number(part) >= 60)) return;
  return text.split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0);
}
/** Relative labels are rounded; use their youngest plausible age. */
export function parsePublishedAt(text: string, now = Date.now()): number | undefined {
  if (/^(?:today|今天|今日)$/i.test(text.trim())) return now;
  const value = text.replace(/^(?:Streamed|Premiered)\s+/i, '').trim();
  const match = value.match(/^(\d+)\s*(second|minute|hour|day|week|month|year)s? ago$/i);
  const chinese = value.match(/^(\d+)\s*(秒|分钟|分鐘|小时|小時|天|周|週|个月|個月|年)前$/);
  const units: Record<string, number> = { second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2419200000, year: 31536000000, '秒': 1000, '分钟': 60000, '分鐘': 60000, '小时': 3600000, '小時': 3600000, '天': 86400000, '周': 604800000, '週': 604800000, '个月': 2419200000, '個月': 2419200000, '年': 31536000000 };
  const found = match || chinese;
  if (found) return Math.max(0, now - Number(found[1]) * units[found[2].toLowerCase()]);
  // Unrecognised/localised labels remain unknown.
  return;
}
export function createHomeFilter(values: HomeFilterSettings, subscriptions: ReadonlySet<string> = new Set(), now = Date.now()) {
  return (item: BrowseItem) => {
    if (item.isPlaylist) return true;
    const data = item.filterData || {};
    if (values.homeExemptSubscribed && (data.subscribed === true || !!data.channelId && subscriptions.has(data.channelId))) return true;
    const views = data.views ?? (item.viewCount ? parseViewCount(item.viewCount) : undefined);
    const duration = data.duration ?? (item.duration ? parseDuration(item.duration) : undefined);
    const published = data.publishedAt ?? (item.publishedTime ? parsePublishedAt(item.publishedTime, now) : undefined);
    if (values.homeMinViews > 0 && views !== undefined && views <= values.homeMinViews) return false;
    if (values.homeMinLikes > 0 && data.likes !== undefined && data.likes <= values.homeMinLikes) return false;
    if (values.homeMinDuration > 0 && duration !== undefined && duration <= values.homeMinDuration) return false;
    if (values.homeMaxAgeDays > 0 && published !== undefined && now - published > values.homeMaxAgeDays * 86400000) return false;
    return !values.homeHideVertical || !(data.vertical === true || item.id.startsWith('short:'));
  };
}
