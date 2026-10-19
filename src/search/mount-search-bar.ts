import { pageQuery } from '../shared/page-dom';
import { searchHref } from '../shared/explore-pages';
import { createPageClient } from '../bridge/page-client';
import { createApp, h, reactive } from 'vue';
import type { BrowseDependencies } from '../../types/ports';
import SearchBar from './SearchBar.vue';
import css from './search-bar.css?inline';

/** Keep YouTube operations outside the reusable input component. */
export function mountSearchBar({ runtime, core }: Pick<BrowseDependencies, 'runtime' | 'core'>, shadow?: ShadowRoot) {
  const lifecycle = runtime.scope('search-bar');
  const host = document.createElement('div');
  host.id = 'ytg-search-host'; host.hidden = true;
  const style = document.createElement('style'); style.textContent = css;
  const mount = document.createElement('div'); host.append(style, mount);
  const state = reactive({ query: '', voiceAvailable: false });
  const page = createPageClient();
  const nativeVoice = () => document.querySelector<HTMLElement>('ytd-masthead #voice-search-button button,ytd-masthead button#voice-search-button');
  function update(query: string) {
    state.query = query;
  }
  const app = createApp({ render: () => h(SearchBar, { modelValue: state.query,
    voiceAvailable: state.voiceAvailable, 'onUpdate:modelValue': update,
    onSearch(query: string) {
      const href = searchHref(query); if (!href) return;
      update(query.trim()); if (!page.openBrowseRoute?.(href)) location.assign(href);
    },
    onVoice() { nativeVoice()?.click(); }
  }) });
  app.mount(mount);
  let center: HTMLElement | null = null;
  function sync(readQuery = false) {
    const enabled = (document.documentElement.classList.contains('ytg-browse-header') || document.documentElement.classList.contains('ytg-custom-browse'));
    const next = pageQuery<HTMLElement>('#ytg-client-search') || document.querySelector<HTMLElement>('ytd-masthead #center');
    const changed = next !== center;
    if (changed) { center?.classList.remove('ytg-search-replaced'); center = next; }
    const usable = enabled && !!center;
    if (usable && host.parentElement !== center) center!.append(host);
    if (usable && (host.hidden || changed || readQuery)) state.query = new URLSearchParams(location.search).get('search_query') || '';
    state.voiceAvailable = !!nativeVoice();
    if (center?.classList.contains('ytg-search-replaced') !== usable) center?.classList.toggle('ytg-search-replaced', usable);
    const visibilityChanged = host.hidden === usable;
    host.hidden = !usable;
    if (visibilityChanged || changed) core.refresh();
  }
  const observer = lifecycle.observer(records => {
    if (records.some(record => !host.contains(record.target))) sync();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  if (shadow) observer.observe(shadow, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  lifecycle.listen(document, 'yt-navigate-finish', () => sync(true));
  lifecycle.listen(document, 'yt-page-data-updated', () => sync(true));
  lifecycle.cleanup(() => { page.destroy?.(); app.unmount(); host.remove(); center?.classList.remove('ytg-search-replaced'); });
  sync();
  return lifecycle.destroy;
}
