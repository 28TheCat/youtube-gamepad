import { ref, onBeforeUnmount } from 'vue';
import { currentLanguage, translate } from './i18n';
export function useI18n() {
  const language = ref(currentLanguage());
  const observer = new MutationObserver(() => { language.value = currentLanguage(); });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ytg-language'] });
  onBeforeUnmount(() => observer.disconnect());
  const t = (key: string, params?: Record<string, string | number>) => translate(key, language.value, params);
  return { t, language };
}
