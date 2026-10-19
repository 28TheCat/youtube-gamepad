import { messages } from './locales';
export type UILanguage = 'en' | 'zh-CN';
export const languageDefault: UILanguage = 'en';
export function normalizeLanguage(value: unknown): UILanguage { return value === 'zh-CN' ? value : languageDefault; }
export function currentLanguage(): UILanguage {
  const element = typeof document === 'undefined' ? undefined : document.documentElement;
  return normalizeLanguage(element && typeof element.getAttribute === 'function' ? element.getAttribute('data-ytg-language') : undefined);
}
const translations = new Map(messages.flatMap(([en, zh]) => [[en, { en, 'zh-CN': zh }] as const, [zh, { en, 'zh-CN': zh }] as const]));
export function translate(key: string, language: UILanguage, params: Record<string, string | number> = {}): string {
  return (translations.get(key)?.[language] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));
}
export function t(key: string, params?: Record<string, string | number>): string { return translate(key, currentLanguage(), params); }
export function applyLanguage(value: unknown): void {
  const element = typeof document === 'undefined' ? undefined : document.documentElement;
  if (!element || typeof element.setAttribute !== 'function') return;
  const language = normalizeLanguage(value);
  const changed = typeof element.getAttribute !== 'function' || element.getAttribute('data-ytg-language') !== language;
  element.setAttribute('data-ytg-language', language);
  if (changed && typeof Event !== 'undefined') document.dispatchEvent(new Event('ytg-language-changed'));
}
// One listener per owning page lifetime; revision guards a stale initial read.
export function syncLanguage(): () => void {
  let disposed = false, revision = 0;
  const apply = (value: unknown) => {
    if (!disposed) {
      const language = normalizeLanguage(value);
      applyLanguage(language);
      document.documentElement.lang = language;
    }
  };
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes.uiLanguage) { ++revision; apply(changes.uiLanguage.newValue); }
  };
  chrome.storage.onChanged.addListener(changed);
  const version = revision;
  void chrome.storage.local.get('uiLanguage').then(saved => { if (version === revision) apply(saved.uiLanguage); }).catch(() => { if (version === revision) apply(languageDefault); });
  return () => { disposed = true; chrome.storage?.onChanged?.removeListener?.(changed); };
}
