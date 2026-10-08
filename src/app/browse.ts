import type { BrowseDependencies, ModuleFactory } from '../../types/ports';
export let YTGamepadBrowseModule!: ModuleFactory<BrowseDependencies,{destroy():void}>;
// Preserve native navigation chrome; observe category changes for gamepad focus.
(() => {
  YTGamepadBrowseModule = {
    /** @param {import('../../types/ports.js').BrowseDependencies} dependencies */
    create({ runtime, core, isMenuOpen, mountGrid }: import('../../types/ports.js').BrowseDependencies) {
  const lifecycle = runtime.scope('browse');
  let categoryTimer: number|undefined, categoryObserver: MutationObserver, categoryDeadline: number|undefined;
  const feedSignature = () => Array.from(document.querySelectorAll<HTMLElement>('ytd-page-manager a#thumbnail[href],ytd-page-manager yt-lockup-view-model a[href^="/watch?"]'))
    .map(link => link.getAttribute('href')).join('|');
  function stopCategoryWatch() {
    lifecycle.clearTimeout(categoryTimer); lifecycle.clearTimeout(categoryDeadline); categoryObserver?.disconnect();
  }
  lifecycle.listen(document, 'click', event => {
    if ((event.target as Element | null)?.closest('#ytg-browse-categories')) return;
    if (core?.restoring || !document.documentElement.classList.contains('ytg-browse') || !(event.target as HTMLElement | null)?.closest?.<HTMLElement>('yt-chip-cloud-chip-renderer')) return;
    const route = location.pathname + location.search;
    const previous = feedSignature();
    stopCategoryWatch();
    categoryObserver = lifecycle.observer(() => {
      lifecycle.clearTimeout(categoryTimer);
      categoryTimer = lifecycle.timeout(() => {
        if (route !== location.pathname + location.search || !document.documentElement.classList.contains('ytg-browse')) { stopCategoryWatch(); return; }
        const next = feedSignature();
        if (!next || next === previous) return;
        stopCategoryWatch();
        if (!core?.restoring && !core?.hasTemporaryLayer && !isMenuOpen()) core?.resetContentFocus();
      }, 150);
    });
    const feed = document.querySelector<HTMLElement>('ytd-page-manager');
    if (feed) categoryObserver.observe(feed, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    categoryDeadline = lifecycle.timeout(stopCategoryWatch, 5000);
  }, true);
  function sync() {
    const enabled = document.documentElement.classList.contains('ytg-theater') &&
      !document.documentElement.hasAttribute('data-ytg-native') &&
      location.pathname !== '/watch' && !location.pathname.startsWith('/shorts/');
    if (document.documentElement.classList.contains('ytg-browse') !== enabled)
      document.documentElement.classList.toggle('ytg-browse', enabled);
    if (!enabled) {
      stopCategoryWatch();
    }
  }
  const observer = lifecycle.observer(sync);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-ytg-native'] });
  lifecycle.listen(document, 'yt-navigate-finish', sync);
  lifecycle.listen(document, 'yt-page-data-updated', sync);
  lifecycle.listen(window, 'popstate', sync);
  sync();
  if (mountGrid) lifecycle.cleanup(mountGrid({ runtime, core, isMenuOpen }));
  lifecycle.cleanup(() => {
    stopCategoryWatch();
    document.documentElement.classList.remove('ytg-browse');
  });
  return { destroy: lifecycle.destroy };
  } };
})();
