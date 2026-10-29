import { captureMediaFrame, createMediaFrameReadiness } from '../playback/media-frame';
// Keep the last decoded picture above the reused native player until its
// replacement actually presents a frame. Never hide or pause the media itself.
export function createWatchTransition(readPlayerId: () => string | undefined, onTimeout?: () => void, onPresented?: () => void) {
  let host: HTMLElement | undefined, canvas: HTMLCanvasElement, image: HTMLImageElement;
  let target = '', completed = '', previous = '', started = 0, raf = 0, version = 0, navigating = false, wasPending = false;
  let lastMedia: HTMLVideoElement | undefined;
  const frameReadiness = createMediaFrameReadiness();
  const video = () => document.querySelector<HTMLVideoElement>('#movie_player video');
  function position(media: HTMLVideoElement | null) {
    const rect = media?.getBoundingClientRect?.();
    if (!host || !rect || rect.width <= 0 || rect.height <= 0) return;
    for (const [name, value] of Object.entries({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }))
      host.style.setProperty(name, `${value}px`, 'important');
  }
  function clear() {
    ++version; frameReadiness.reset(); if (raf) cancelAnimationFrame(raf); raf = 0;
    host?.remove(); host = undefined; target = '';
  }
  function reveal() { lastMedia = video() || lastMedia; completed = target; clear(); onPresented?.(); }
  function matches(media: HTMLVideoElement) {
    if (video() !== media || media.isConnected === false || media.readyState < 2 || !media.videoWidth ||
        location.pathname !== '/watch' || new URLSearchParams(location.search).get('v') !== target) return false;
    let id: string | undefined;
    try { id = readPlayerId(); } catch { /* Wait for navigation completion when the bridge is unavailable. */ }
    return id === target || !id && !navigating;
  }
  function playing() { if (host) { if (raf) cancelAnimationFrame(raf); raf = 0; check(); } }
  document.addEventListener('playing', playing, true);
  function check() {
    if (!host) return;
    const media = video();
    position(media);
    if (media && matches(media)) {
      const expected = version;
      if (frameReadiness.ready(media, target, () => {
        if (expected === version && host && matches(media)) reveal();
      })) { reveal(); return; }
    } else frameReadiness.reset();
    if (Date.now() - started > 8000) {
      // Keep the last frame until the shell replaces it with an actionable error.
      frameReadiness.reset(); raf = 0; onTimeout?.(); return;
    }
    raf = requestAnimationFrame(check);
  }
  function sync(enabled: boolean, href: string, pending: boolean, failed = false) {
    const restarting = pending && !wasPending;
    wasPending = pending; navigating = pending;
    if (!enabled || failed) { completed = ''; lastMedia = undefined; clear(); return; }
    const url = new URL(href, location.origin), id = url.pathname === '/watch' ? url.searchParams.get('v') || '' : '';
    if (!id) { previous = ''; completed = ''; clear(); return; }
    if (target === id) return;
    if (restarting && completed === id) completed = '';
    if (completed === id) { if (target) clear(); previous = id; return; }
    // A ready, unchanged page needs no covering layer.
    if (!pending) { lastMedia = video() || lastMedia; clear(); previous = id; completed = id; return; }
    const media = video() || lastMedia;
    const outgoing = previous;
    if (host) {
      // A rapid second selection keeps the already captured outgoing frame.
      ++version; frameReadiness.reset(); if (raf) cancelAnimationFrame(raf);
      target = id; previous = id; started = Date.now();
      if (canvas.hidden) image.src = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
      check(); return;
    }
    clear(); target = id; previous = id; started = Date.now();
    host = document.createElement('div'); host.id = 'ytg-watch-transition';
    host.setAttribute('aria-hidden', 'true');
    image = document.createElement('img'); image.alt = ''; image.src = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
    canvas = document.createElement('canvas'); canvas.hidden = true;
    if (outgoing && media && media.readyState >= 2 && media.videoWidth > 0) {
      if (captureMediaFrame(canvas, media)) { canvas.hidden = false; image.hidden = true; }
    }
    host.append(image, canvas); document.documentElement.append(host);
    check();
  }
  return { sync, get waiting() { return !!host; }, destroy() { clear(); document.removeEventListener('playing', playing, true); } };
}
