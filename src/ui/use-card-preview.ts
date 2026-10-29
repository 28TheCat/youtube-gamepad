import { onBeforeUnmount, ref, watch } from 'vue';
import { safePreviewThumbnail } from '../shared/browse-data';

// A pending hover and a playing preview share the same owner across the feed.
let stopCurrent: (() => void) | undefined;

export function useCardPreview(item: () => { href: string; isPlaylist?: boolean; previewThumbnail?: string }) {
  const source = ref(''), ready = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observing: MutationObserver | undefined;
  let scrollRoot: Node | undefined;
  let loadTimeout: ReturnType<typeof setTimeout> | undefined;
  let unavailable = false;
  let hovering = false;
  const mouseMode = () => document.documentElement.dataset.ytgInputMode === 'mouse';

  function stop() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    clearTimeout(loadTimeout); loadTimeout = undefined;
    hovering = false;
    source.value = '';
    ready.value = false;
    observing?.disconnect(); observing = undefined;
    window.removeEventListener('yt-gamepad-input-mode', inputMode);
    window.removeEventListener('yt-navigate-start', stop);
    document.removeEventListener('yt-navigate-start', stop);
    window.removeEventListener('popstate', stop);
    window.removeEventListener('scroll', stop, true);
    scrollRoot?.removeEventListener('scroll', stop, true); scrollRoot = undefined;
    document.removeEventListener('visibilitychange', visibility);
    if (stopCurrent === stop) stopCurrent = undefined;
  }
  function inputMode(event: WindowEventMap['yt-gamepad-input-mode']) {
    if (event.detail.mode !== 'mouse') stop();
  }
  function visibility() { if (document.hidden) stop(); }
  function failed() { stop(); unavailable = true; }
  function leave() { stop(); unavailable = false; }
  async function loaded(event: Event) {
    const image = event.target as HTMLImageElement, expected = source.value;
    try {
      await image.decode();
      if (!image.isConnected || source.value !== expected || !mouseMode()) return;
      clearTimeout(loadTimeout); loadTimeout = undefined;
      ready.value = true;
    } catch { if (image.isConnected && source.value === expected) failed(); }
  }
  function enter(event: PointerEvent) {
    if (hovering || unavailable || event.pointerType !== 'mouse' || !mouseMode() || document.hidden || item().isPlaylist) return;
    const preview = safePreviewThumbnail(item().previewThumbnail);
    if (!preview) return;
    const href = new URL(item().href, location.origin);
    if (href.origin !== location.origin || href.pathname !== '/watch') return;
    stopCurrent?.();
    stopCurrent = stop;
    hovering = true;
    window.addEventListener('yt-gamepad-input-mode', inputMode);
    window.addEventListener('yt-navigate-start', stop);
    document.addEventListener('yt-navigate-start', stop);
    window.addEventListener('popstate', stop);
    window.addEventListener('scroll', stop, true);
    // Scroll events inside the browse shadow root do not reach window.
    scrollRoot = (event.currentTarget as Element | null)?.getRootNode();
    scrollRoot?.addEventListener('scroll', stop, true);
    document.addEventListener('visibilitychange', visibility);
    observing = new MutationObserver(() => { if (!mouseMode()) stop(); });
    observing.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ytg-input-mode'] });
    timer = setTimeout(() => {
      timer = undefined;
      if (!mouseMode() || document.hidden) { stop(); return; }
      source.value = preview;
      loadTimeout = setTimeout(failed, 10000);
    }, 650);
  }
  watch(() => [item().href, item().isPlaylist, item().previewThumbnail], leave);
  onBeforeUnmount(stop);
  return { source, ready, enter, stop, leave, loaded, failed };
}
