import { browseShadow } from '../shared/page-dom';
import type { Runtime } from '../../types/ports';
import { categorySettingsKey, categoryCatalogKey, categoryIdentity, normalizeCategoryPreferences,
  normalizeCategoryCatalog, type CategoryItem } from '../shared/browse-categories';

// Apply preferences only to the category nodes owned by this extension.
export function mountBrowseCategorySettings(runtime: Runtime) {
  const lifecycle = runtime.scope('browse-category-settings');
  let preferences = normalizeCategoryPreferences(undefined), catalog: CategoryItem[] = [];
  let loaded = false, revision = 0, timer: number | undefined, catalogTimer: number | undefined;
  const chips = new Set<HTMLElement>();
  const pendingCatalog = new Map<string, CategoryItem>();
  function restore(chip: HTMLElement) {
    chip.removeAttribute('data-ytg-category-hidden');
    chip.removeAttribute('data-ytg-category-order');
    chip.style.removeProperty('--ytg-category-order');
  }
  function reset() {
    for (const chip of chips) restore(chip);
    chips.clear();
  }
  async function rememberCatalog() {
    if (lifecycle.destroyed || !pendingCatalog.size) return;
    const pending = new Map(pendingCatalog); pendingCatalog.clear();
    try {
      const saved = await chrome.storage.local.get(categoryCatalogKey);
      if (lifecycle.destroyed) return;
      const merged = new Map(normalizeCategoryCatalog(saved[categoryCatalogKey]).map(item => [item.id, item]));
      for (const item of pending.values()) merged.set(item.id, item);
      const next = [...merged.values()].slice(0, 100);
      if (JSON.stringify(next) !== JSON.stringify(normalizeCategoryCatalog(saved[categoryCatalogKey])))
        await chrome.storage.local.set({ [categoryCatalogKey]: next });
      if (!lifecycle.destroyed) catalog = next;
    } catch { /* A catalog write failure never interrupts native browsing. */ }
  }
  function sync() {
    if (!loaded || lifecycle.destroyed) return;
    if (!document.documentElement.classList.contains('ytg-browse')) { reset(); return; }
    const categories = Array.from(browseShadow()?.querySelectorAll<HTMLElement>('[data-ytg-category]') || [])
      .filter(chip => !chip.closest('[hidden],[aria-hidden="true"],[inert]'));
    const present = new Set(categories);
    const rank = new Map(preferences.order.map((id, index) => [id, index]));
    for (const chip of chips) if (!present.has(chip)) { restore(chip); chips.delete(chip); }
    for (const [index, chip] of categories.entries()) {
      const label = (chip.getAttribute('aria-label') || chip.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!label) continue;
      const id = categoryIdentity(label);
      if (!catalog.some(item => item.id === id && item.label === label)) pendingCatalog.set(id, { id, label });
      const active = !!chip.querySelector('[aria-pressed="true"]');
      const hidden = preferences.hidden.includes(id) && !active;
      if (chip.hasAttribute('data-ytg-category-hidden') !== hidden)
        chip.toggleAttribute('data-ytg-category-hidden', hidden);
      const order = String(rank.get(id) ?? preferences.order.length + index);
      if (chip.dataset.ytgCategoryOrder !== order) {
        chip.dataset.ytgCategoryOrder = order;
        chip.style.setProperty('--ytg-category-order', order);
      }
      chips.add(chip);
    }
    if (pendingCatalog.size) { lifecycle.clearTimeout(catalogTimer); catalogTimer = lifecycle.timeout(() => { void rememberCatalog(); }, 500); }
  }
  function schedule() { lifecycle.clearTimeout(timer); timer = lifecycle.timeout(sync, 50); }
  function changed(changes: Record<string, chrome.storage.StorageChange>, area: string) {
    if (area !== 'local' || lifecycle.destroyed) return;
    if (changes[categorySettingsKey]) { ++revision; preferences = normalizeCategoryPreferences(changes[categorySettingsKey].newValue); sync(); }
    if (changes[categoryCatalogKey]) catalog = normalizeCategoryCatalog(changes[categoryCatalogKey].newValue);
  }
  const observer = lifecycle.observer(schedule);
  const observeBrowse = () => {
    observer.disconnect();
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const root = browseShadow();
    if (root) observer.observe(root, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['aria-pressed', 'hidden', 'aria-hidden'] });
    schedule();
  };
  lifecycle.listen(document, 'ytg-browse-mounted', observeBrowse);
  observeBrowse();
  lifecycle.listen(document, 'yt-navigate-finish', observeBrowse);
  lifecycle.listen(window, 'popstate', observeBrowse);
  lifecycle.cleanup(reset);
  try {
    chrome.storage.onChanged.addListener(changed);
    lifecycle.cleanup(() => chrome.storage?.onChanged?.removeListener?.(changed));
    const version = revision;
    void chrome.storage.local.get([categorySettingsKey, categoryCatalogKey]).then(saved => {
      if (lifecycle.destroyed) return;
      if (revision === version) preferences = normalizeCategoryPreferences(saved[categorySettingsKey]);
      catalog = normalizeCategoryCatalog(saved[categoryCatalogKey]); loaded = true; sync();
    }).catch(() => { if (!lifecycle.destroyed) { loaded = true; sync(); } });
  } catch { loaded = true; sync(); }
  return lifecycle.destroy;
}
