import { nextTick, reactive } from 'vue';
import type { CoreModule, Runtime } from '../../types/ports';
import { pageActiveElement, pageQueryAll } from '../shared/page-dom';

export type BrowseMode = 'gamepad' | 'youtube';
export interface BrowseModeState { mode: BrowseMode; busy: boolean; error: string }
export function mountBrowseMode(runtime: Runtime, core: CoreModule) {
  const lifecycle = runtime.scope('browse-mode');
  const state = reactive<BrowseModeState>({ mode: 'gamepad', busy: false, error: '' });
  const root = document.documentElement;
  root.setAttribute('data-ytg-browse-mode', 'loading');
  function apply(mode: unknown) {
    state.mode = mode === 'youtube' ? 'youtube' : 'gamepad';
    root.setAttribute('data-ytg-browse-mode', state.mode);
    core.refresh();
  }
  // These handlers run in ISOLATED; page messages never write this preference.
  async function change(mode: BrowseMode) {
    if (lifecycle.destroyed || state.busy || state.mode === mode) return;
    const keepFocus = root.classList.contains('ytg-gamepad-input') &&
      (pageActiveElement()?.hasAttribute('data-ytg-page-mode') || core.current?.hasAttribute('data-ytg-page-mode'));
    const previous = state.mode; state.error = ''; state.busy = true; apply(mode);
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local)
        await chrome.storage.local.set({ browseMode: mode });
      if (mode === 'youtube' && root.dataset.ytgVirtualRoute === 'true') location.reload();
    } catch {
      if (!lifecycle.destroyed) { apply(previous); state.error = 'Could not save page mode. Try again.'; }
    } finally {
      if (!lifecycle.destroyed) {
        state.busy = false;
        if (keepFocus) {
          await nextTick();
          lifecycle.frame(() => {
            const target = pageQueryAll<HTMLElement>('[data-ytg-page-mode]').find(node => node.getBoundingClientRect().width > 0);
            if (target) { core.refresh(); core.focus(target); }
          });
        }
      }
    }
  }
  lifecycle.cleanup(() => root.removeAttribute('data-ytg-browse-mode'));
  let revision = 0;
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes.browseMode || lifecycle.destroyed) return;
    ++revision; if (!state.busy) apply(changes.browseMode.newValue);
  };
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.onChanged.addListener(changed);
    lifecycle.cleanup(() => chrome.storage?.onChanged?.removeListener?.(changed));
    const version = revision;
    void Promise.resolve().then(() => chrome.storage.local.get('browseMode')).then(saved => {
      if (!lifecycle.destroyed && version === revision) apply(saved.browseMode);
    }).catch(() => { if (!lifecycle.destroyed && version === revision) apply('gamepad'); });
  } else apply('gamepad');
  function unavailable() {
    if (lifecycle.destroyed) return;
    // Data errors belong to the current surface, not to the saved page mode.
    state.error = 'Videos could not load. Try again.';
  }
  return { state, change, unavailable, destroy: lifecycle.destroy };
}
