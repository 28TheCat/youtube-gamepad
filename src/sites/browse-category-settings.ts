import type { Runtime } from '../../types/ports';
import { categorySettingsKey, categoryCatalogKey, categoryIdentity, normalizeCategoryPreferences,
  normalizeCategoryCatalog, type CategoryItem } from '../shared/browse-categories';

// Keep YouTube's real chip handlers and feed tokens. Only presentation is changed.
export function mountBrowseCategorySettings(runtime: Runtime) {
  const lifecycle = runtime.scope('browse-category-settings');
  let preferences = normalizeCategoryPreferences(undefined), catalog: CategoryItem[] = [];
  let loaded = false, revision = 0, timer: number | undefined, catalogTimer: number | undefined;
  const chips = new Set<HTMLElement>(), parents = new Set<HTMLElement>();
  const pendingCatalog = new Map<string, CategoryItem>();
  function restore(chip: HTMLElement) {
    chip.removeAttribute('data-ytg-category-hidden');
    chip.removeAttribute('data-ytg-category-order');
    chip.style.removeProperty('--ytg-category-order');
  }
  function reset() {
    for (const chip of chips) restore(chip);
    for (const parent of parents) parent.classList.remove('ytg-category-list');
    chips.clear(); parents.clear();
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
    const native = Array.from(document.querySelectorAll<HTMLElement>('yt-chip-cloud-chip-renderer,[data-ytg-category]'))
      .filter(chip => !chip.closest('[hidden],[aria-hidden="true"],[inert]'));
    const present = new Set(native), currentParents = new Set<HTMLElement>();
    const rank = new Map(preferences.order.map((id, index) => [id, index]));
    for (const chip of chips) if (!present.has(chip)) { restore(chip); chips.delete(chip); }
    for (const [index, chip] of native.entries()) {
      const label = (chip.getAttribute('aria-label') || chip.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!label) continue;
      const id = categoryIdentity(label);
      if (!catalog.some(item => item.id === id && item.label === label)) pendingCatalog.set(id, { id, label });
      const active = chip.getAttribute('selected') === '' || chip.getAttribute('selected') === 'true' ||
        chip.getAttribute('aria-selected') === 'true' || !!chip.querySelector('[aria-selected="true"],[aria-pressed="true"],.ytChipShapeActive');
      const hidden = preferences.hidden.includes(id) && !active;
      if (chip.hasAttribute('data-ytg-category-hidden') !== hidden)
        chip.toggleAttribute('data-ytg-category-hidden', hidden);
      const order = String(rank.get(id) ?? preferences.order.length + index);
      if (chip.dataset.ytgCategoryOrder !== order) {
        chip.dataset.ytgCategoryOrder = order;
        chip.style.setProperty('--ytg-category-order', order);
      }
      chips.add(chip);
      if (chip.parentElement && preferences.order.length) {
        currentParents.add(chip.parentElement);
        if (!chip.parentElement.classList.contains('ytg-category-list')) chip.parentElement.classList.add('ytg-category-list');
      }
    }
    for (const parent of parents) if (!currentParents.has(parent)) parent.classList.remove('ytg-category-list');
    parents.clear(); for (const parent of currentParents) parents.add(parent);
    if (pendingCatalog.size) { lifecycle.clearTimeout(catalogTimer); catalogTimer = lifecycle.timeout(() => { void rememberCatalog(); }, 500); }
  }
  function schedule() { lifecycle.clearTimeout(timer); timer = lifecycle.timeout(sync, 50); }
  function changed(changes: Record<string, chrome.storage.StorageChange>, area: string) {
    if (area !== 'local' || lifecycle.destroyed) return;
    if (changes[categorySettingsKey]) { ++revision; preferences = normalizeCategoryPreferences(changes[categorySettingsKey].newValue); sync(); }
    if (changes[categoryCatalogKey]) catalog = normalizeCategoryCatalog(changes[categoryCatalogKey].newValue);
  }
  const observer = lifecycle.observer(records => {
    if (records.some(record => record.target === document.documentElement ||
      (record.target instanceof Element ? record.target : record.target.parentElement)?.closest('yt-chip-cloud-chip-renderer,[data-ytg-category],ytd-feed-filter-chip-bar-renderer,#chips-wrapper') ||
      [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element &&
        (node.matches('yt-chip-cloud-chip-renderer,[data-ytg-category]') || node.querySelector('yt-chip-cloud-chip-renderer,[data-ytg-category]'))))) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'selected', 'aria-selected', 'aria-pressed', 'hidden', 'aria-hidden'] });
  lifecycle.listen(document, 'yt-navigate-finish', schedule);
  lifecycle.listen(document, 'yt-page-data-updated', schedule);
  lifecycle.cleanup(reset);
  try {
    chrome.storage.onChanged.addListener(changed);
    lifecycle.cleanup(() => chrome.storage.onChanged.removeListener(changed));
    const version = revision;
    void chrome.storage.local.get([categorySettingsKey, categoryCatalogKey]).then(saved => {
      if (lifecycle.destroyed) return;
      if (revision === version) preferences = normalizeCategoryPreferences(saved[categorySettingsKey]);
      catalog = normalizeCategoryCatalog(saved[categoryCatalogKey]); loaded = true; sync();
    }).catch(() => { if (!lifecycle.destroyed) { loaded = true; sync(); } });
  } catch { loaded = true; sync(); }
  return lifecycle.destroy;
}
