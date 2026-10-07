// Preserve native navigation chrome; observe category changes for gamepad focus.
(() => {
  window.YTGamepadBrowseModule = {
    /** @param {import('../../types/ports.js').BrowseDependencies} dependencies */
    create({ runtime, core, isMenuOpen }) {
  const lifecycle = runtime.scope('browse');
  let categoryTimer, categoryObserver, categoryDeadline;
  const feedSignature = () => Array.from(document.querySelectorAll('ytd-page-manager a#thumbnail[href],ytd-page-manager yt-lockup-view-model a[href^="/watch?"]'))
    .map(link => link.getAttribute('href')).join('|');
  function stopCategoryWatch() {
    lifecycle.clearTimeout(categoryTimer); lifecycle.clearTimeout(categoryDeadline); categoryObserver?.disconnect();
  }
  lifecycle.listen(document, 'click', event => {
    if (core?.restoring || !document.documentElement.classList.contains('ytg-browse') || !event.target.closest?.('yt-chip-cloud-chip-renderer')) return;
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
    const feed = document.querySelector('ytd-page-manager');
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
  lifecycle.cleanup(() => {
    stopCategoryWatch();
    document.documentElement.classList.remove('ytg-browse');
  });
  return { destroy: lifecycle.destroy };
  } };
})();
