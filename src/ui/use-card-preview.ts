import { onBeforeUnmount, ref, watch } from 'vue';
import { EmbeddedPreviewPlayer, type PreviewPlayer } from './youtube-preview-api';

// A pending hover and a playing preview share the same owner across the feed.
let stopCurrent: (() => void) | undefined;

export function useCardPreview(item: () => { href: string; isPlaylist?: boolean }) {
  const source = ref(''), ready = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observing: MutationObserver | undefined;
  let playerCleanup: (() => void) | undefined;
  let unavailable = false;
  let hovering = false;
  const mouseMode = () => document.documentElement.dataset.ytgInputMode === 'mouse';

  function stop() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    hovering = false;
    source.value = '';
    ready.value = false;
    playerCleanup?.(); playerCleanup = undefined;
    observing?.disconnect(); observing = undefined;
    window.removeEventListener('yt-gamepad-input-mode', inputMode);
    window.removeEventListener('yt-navigate-start', stop);
    window.removeEventListener('popstate', stop);
    window.removeEventListener('scroll', stop, true);
    document.removeEventListener('visibilitychange', visibility);
    if (stopCurrent === stop) stopCurrent = undefined;
  }
  function inputMode(event: WindowEventMap['yt-gamepad-input-mode']) {
    if (event.detail.mode !== 'mouse') stop();
  }
  function visibility() { if (document.hidden) stop(); }
  function failed() { stop(); unavailable = true; }
  function leave() { stop(); unavailable = false; }
  function loaded(event: Event) {
    playerCleanup?.(); playerCleanup = undefined;
    const frame = event.target as HTMLIFrameElement;
    let cancelled = false, player: PreviewPlayer | undefined;
    const timeout = setTimeout(() => { if (!ready.value) failed(); }, 10000);
    playerCleanup = () => {
      cancelled = true; clearTimeout(timeout);
      try { player?.destroy(); } catch { /* The frame may already have navigated away. */ }
    };
    if (!frame.isConnected || !mouseMode()) { stop(); return; }
    try {
      player = new EmbeddedPreviewPlayer(frame, {
        onReady: ({ target }) => { if (!cancelled) { target.mute(); target.playVideo(); } },
        onStateChange: ({ data }) => { if (!cancelled && data === 1) { clearTimeout(timeout); ready.value = true; } },
        onError: () => { if (!cancelled) failed(); }
      });
    } catch { failed(); }
  }
  function enter(event: PointerEvent) {
    if (hovering || unavailable || event.pointerType !== 'mouse' || !mouseMode() || document.hidden || item().isPlaylist) return;
    const href = new URL(item().href, location.origin);
    const videoId = href.searchParams.get('v');
    if (href.origin !== location.origin || href.pathname !== '/watch' || !videoId || !/^[\w-]{11}$/.test(videoId)) return;
    stopCurrent?.();
    stopCurrent = stop;
    hovering = true;
    window.addEventListener('yt-gamepad-input-mode', inputMode);
    window.addEventListener('yt-navigate-start', stop);
    window.addEventListener('popstate', stop);
    window.addEventListener('scroll', stop, true);
    document.addEventListener('visibilitychange', visibility);
    observing = new MutationObserver(() => { if (!mouseMode()) stop(); });
    observing.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ytg-input-mode'] });
    timer = setTimeout(() => {
      timer = undefined;
      if (!mouseMode() || document.hidden) { stop(); return; }
      const preview = new URL(`https://www.youtube.com/embed/${videoId}`);
      preview.search = new URLSearchParams({ enablejsapi: '1', autoplay: '1', mute: '1', cc_load_policy: '1', playsinline: '1',
        controls: '1', disablekb: '1', rel: '0', origin: location.origin }).toString();
      source.value = preview.href;
    }, 650);
  }
  watch(() => [item().href, item().isPlaylist], leave);
  onBeforeUnmount(stop);
  return { source, ready, enter, stop, leave, loaded, failed };
}
