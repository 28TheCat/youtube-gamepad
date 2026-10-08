export const categorySettingsKey = 'browseCategories';
export const categoryCatalogKey = 'browseCategoryCatalog';
export interface CategoryItem { id: string; label: string }
export interface CategoryPreferences { order: string[]; hidden: string[] }

const definitions = [
  ['all', '全部', 'All', '所有'], ['music', '音乐', 'Music', '音樂'],
  ['podcasts', '播客', 'Podcasts', 'Podcast'], ['gaming', '游戏', 'Gaming', '遊戲'],
  ['mixes', '合辑', 'Mixes', '合輯'], ['live', '直播', 'Live'],
  ['animation', '动画', 'Animation', '動畫'],
  ['recent', '最近上传', 'Recently uploaded', '最近上傳'],
  ['watched', '已观看', 'Watched', '已觀看'], ['new', '发现新视频', 'New to you', '發現新影片']
];
export const defaultCategories: CategoryItem[] = definitions.map(([id, label]) => ({ id, label }));
export function categoryIdentity(label: string): string {
  const text = label.trim().replace(/\s+/g, ' ').slice(0, 80);
  return definitions.find(([, ...aliases]) => aliases.some(alias => alias.toLowerCase() === text.toLowerCase()))?.[0]
    || `label:${text.toLowerCase()}`;
}
function validId(id: unknown): id is string {
  return typeof id === 'string' && (defaultCategories.some(item => item.id === id) || /^label:.{1,80}$/.test(id));
}
export function normalizeCategoryPreferences(raw: unknown): CategoryPreferences {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const ids = (list: unknown) => Array.isArray(list) ? [...new Set(list.filter(validId))].slice(0, 100) : [];
  return { order: ids(value.order), hidden: ids(value.hidden).filter(id => id !== 'all') };
}
export function normalizeCategoryCatalog(raw: unknown): CategoryItem[] {
  if (!Array.isArray(raw)) return [];
  const items = new Map<string, CategoryItem>();
  for (const value of raw.slice(0, 100)) {
    if (!value || typeof value.label !== 'string') continue;
    const label = value.label.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (label) { const id = categoryIdentity(label); items.set(id, { id, label }); }
  }
  return [...items.values()];
}
export function orderedCategories(items: CategoryItem[], order: string[]): CategoryItem[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length));
}
