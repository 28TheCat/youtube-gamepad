import { isNativeFlowRoute } from '../shared/explore-pages';
import type { BrowseDependencies, ModuleFactory } from '../../types/ports';
export let YTGamepadBrowseModule!: ModuleFactory<BrowseDependencies,{destroy():void}>;
// Synchronize the custom browse surface with mode and route changes.
(() => {
  YTGamepadBrowseModule = {
    /** @param {import('../../types/ports.js').BrowseDependencies} dependencies */
    create({ runtime, core, isMenuOpen, mountGrid, prepareVideo }: import('../../types/ports.js').BrowseDependencies) {
  const lifecycle = runtime.scope('browse');
  function sync() {
    const enabled = document.documentElement.classList.contains('ytg-theater') &&
      !['youtube', 'loading'].includes(document.documentElement.getAttribute('data-ytg-browse-mode') || '') &&
      !document.documentElement.hasAttribute('data-ytg-native') &&
      !isNativeFlowRoute(location.pathname) && location.pathname !== '/watch' && !location.pathname.startsWith('/shorts/');
    if (document.documentElement.classList.contains('ytg-browse') !== enabled)
      document.documentElement.classList.toggle('ytg-browse', enabled);
  }
  const observer = lifecycle.observer(sync);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-ytg-native', 'data-ytg-browse-mode'] });
  lifecycle.listen(document, 'yt-navigate-finish', sync);
  lifecycle.listen(window, 'popstate', sync);
  sync();
  if (mountGrid) lifecycle.cleanup(mountGrid({ runtime, core, isMenuOpen, prepareVideo }));
  lifecycle.cleanup(() => {
    document.documentElement.classList.remove('ytg-browse');
  });
  return { destroy: lifecycle.destroy };
  } };
})();
