import { createApp, h, nextTick, reactive } from 'vue';
import { YTGamepadControllerStyle } from '../input/controller-style';
import type { BrowseDependencies } from '../../types/ports';
import SearchBar from './SearchBar.vue';
import css from './search-bar.css?inline';

/** Keep YouTube operations outside the reusable input component. */
export function mountSearchBar({ runtime, core }: Pick<BrowseDependencies, 'runtime' | 'core'>) {
  const lifecycle = runtime.scope('search-bar');
  const host = document.createElement('div');
  host.id = 'ytg-search-host'; host.hidden = true;
  const style = document.createElement('style'); style.textContent = css;
  const mount = document.createElement('div'); host.append(style, mount);
  const state = reactive({ query: '', placeholder: 'Search', voiceAvailable: false, voiceLabel: 'Voice search', gamepad: false });
  const controllerStyle = YTGamepadControllerStyle;
  if (controllerStyle) lifecycle.cleanup(controllerStyle.register(document));
  const nativeInput = () => document.querySelector<HTMLInputElement>('ytd-masthead input#search,ytd-masthead input.ytSearchboxComponentInput,ytd-masthead input[name="search_query"]:not([data-ytg-search-input])');
  const nativeSubmit = () => document.querySelector<HTMLElement>('ytd-masthead button#search-icon-legacy,ytd-masthead #search-icon-legacy button,ytd-masthead button.ytSearchboxComponentSearchButton,ytd-masthead .ytSearchboxComponentSearchButton button');
  const nativeVoice = () => document.querySelector<HTMLElement>('ytd-masthead #voice-search-button button,ytd-masthead button#voice-search-button');
  function update(query: string) {
    state.query = query;
    const input = nativeInput();
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
  const app = createApp({ render: () => h(SearchBar, { modelValue: state.query, placeholder: state.placeholder,
    gamepad: state.gamepad, controllerStyle, onOpen() { core.act('search'); },
    voiceAvailable: state.voiceAvailable, voiceLabel: state.voiceLabel, 'onUpdate:modelValue': update,
    onSearch(query: string) { update(query); nativeSubmit()?.click(); },
    onVoice() { nativeVoice()?.click(); }
  }) });
  app.mount(mount);
  let center: HTMLElement | null = null;
  function sync(readQuery = false) {
    const gamepad = document.documentElement.classList.contains('ytg-gamepad-input');
    const modeChanged = state.gamepad !== gamepad;
    const hadFocus = host.contains(document.activeElement) || host.contains(core.current);
    state.gamepad = gamepad;
    const enabled = document.documentElement.classList.contains('ytg-custom-browse');
    const next = document.querySelector<HTMLElement>('#ytg-client-search') || document.querySelector<HTMLElement>('ytd-masthead #center');
    const changed = next !== center;
    if (changed) { center?.classList.remove('ytg-search-replaced'); center = next; }
    const input = nativeInput();
    const usable = enabled && !!center && !!input && !!nativeSubmit();
    if (usable && host.parentElement !== center) center!.append(host);
    if (usable && (host.hidden || changed || readQuery)) state.query = input!.value;
    state.placeholder = input?.placeholder || 'Search';
    state.voiceAvailable = !!nativeVoice();
    state.voiceLabel = nativeVoice()?.getAttribute('aria-label') || 'Voice search';
    if (center?.classList.contains('ytg-search-replaced') !== usable) center?.classList.toggle('ytg-search-replaced', usable);
    const visibilityChanged = host.hidden === usable;
    host.hidden = !usable;
    if (visibilityChanged || changed) core.refresh();
    if (modeChanged) void nextTick().then(() => {
      if (lifecycle.destroyed || host.hidden) return;
      core.refresh();
      if (hadFocus && !core.hasTemporaryLayer) core.focus(host.querySelector<HTMLElement>(gamepad ? '[data-ytg-search-entry]' : 'input'));
    });
  }
  const observer = lifecycle.observer(records => {
    if (records.some(record => !host.contains(record.target))) sync();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'placeholder'] });
  lifecycle.listen(document, 'yt-navigate-finish', () => sync(true));
  lifecycle.listen(document, 'yt-page-data-updated', () => sync(true));
  lifecycle.cleanup(() => { app.unmount(); host.remove(); center?.classList.remove('ytg-search-replaced'); });
  sync();
  return lifecycle.destroy;
}
