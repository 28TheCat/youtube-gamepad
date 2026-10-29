import type { NativePlayerControlsPort, Scope } from '../../types/ports';

var nativePrefix = 'native:';
export const nativeControlTargetId = (id: string) => nativePrefix + id;
export const nativeControlId = (id: string) => id.startsWith(nativePrefix) ? id.slice(nativePrefix.length) : undefined;
export const nativeControlIndices = (controls: readonly { id: string; index: number; available: boolean }[]) =>
  controls.filter(control => control.available && nativeControlId(control.id) !== undefined).map(control => control.index);

/** Adapt the existing YouTube controls without replacing their DOM or appearance. */
export function createNativePlayerControls(lifecycle: Scope): NativePlayerControlsPort {
  const selectors = [
    ['progress', '.ytp-progress-bar'],
    ['playPause', '.ytp-play-button'],
    ['mute', '.ytp-mute-button'],
    ['autoplay', '.ytp-autonav-toggle-button'],
    ['captions', '.ytp-subtitles-button'],
    ['settings', '.ytp-settings-button'],
    ['miniplayer', '.ytp-miniplayer-button'],
    ['theater', '.ytp-size-button'],
    ['fullscreen', '.ytp-fullscreen-button']
  ] as const;
  let selected: HTMLElement | undefined;
  const listeners = new Set<(id: string) => void>();
  const enabled = () => document.documentElement.dataset.ytgPlaybackLayout === 'windowed' &&
    document.documentElement.classList.contains('ytg-watch-active') && !document.documentElement.hasAttribute('data-ytg-native');
  function elements() {
    const bar = document.querySelector<HTMLElement>('#movie_player .ytp-chrome-bottom');
    if (!bar) return [];
    return selectors.flatMap(([id, selector]) => {
      const node = bar.querySelector<HTMLElement>(selector);
      if (!node || node.hidden || node.getAttribute('aria-disabled') === 'true' || (node as HTMLButtonElement).disabled) return [];
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' ? [{ id, node }] : [];
    });
  }
  function clear() { selected?.classList.remove('ytg-native-control-selected'); selected = undefined; }
  lifecycle.listen(document, 'focusin', event => {
    if (!enabled()) return;
    const entry = elements().find(item => item.node === event.target || item.node.contains(event.target as Node));
    if (entry) for (const listener of listeners) listener(entry.id);
  });
  lifecycle.listen(document, 'click', event => {
    if (!enabled() || !(event.target as Element | null)?.closest?.('#movie_player .ytp-fullscreen-button')) return;
    // The detail page expands locally and retains its player and return position.
    event.preventDefault(); event.stopImmediatePropagation();
    window.dispatchEvent(new Event('ytg-native-player-fullscreen'));
  }, true);
  lifecycle.cleanup(() => { clear(); listeners.clear(); document.documentElement.classList.remove('ytg-native-player-controls'); });
  return {
    read() {
      const items = enabled() ? elements() : [];
      document.documentElement.classList.toggle('ytg-native-player-controls', items.some(item => item.id === 'playPause'));
      return items.some(item => item.id === 'playPause') ? items.map(({ id }) => ({ id })) : [];
    },
    focus(id) {
      const entry = enabled() && elements().find(item => item.id === id);
      if (!entry) return false;
      clear(); selected = entry.node; selected.classList.add('ytg-native-control-selected'); selected.focus({ preventScroll: true });
      return true;
    },
    activate(id) {
      const entry = enabled() && elements().find(item => item.id === id);
      if (!entry || id === 'progress') return false;
      entry.node.click(); return true;
    },
    clear,
    observeFocus(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}

