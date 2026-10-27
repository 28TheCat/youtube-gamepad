import { captureMediaFrame, createMediaFrameReadiness } from '../playback/media-frame';
// Keep the last decoded picture above the reused native player until its
// replacement actually presents a frame. Never hide or pause the media itself.
export function createWatchTransition(readPlayerId: () => string | undefined) {
  let host: HTMLElement | undefined, canvas: HTMLCanvasElement, image: HTMLImageElement;
  let target = '', completed = '', previous = '', started = 0, raf = 0, version = 0, navigating = false;
  const frameReadiness = createMediaFrameReadiness();
  const video = () => document.querySelector<HTMLVideoElement>('#movie_player video');
  function clear() {
    ++version; frameReadiness.reset(); if (raf) cancelAnimationFrame(raf); raf = 0;
    host?.remove(); host = undefined; target = '';
  }
  function reveal() { completed = target; clear(); }
  function playing(event: Event) {
    const media = video();
    if (!host || event.target !== media || !media || media.readyState < 2 || !media.videoWidth ||
        location.pathname !== '/watch' || new URLSearchParams(location.search).get('v') !== target) return;
    let id: string | undefined;
    try { id = readPlayerId(); } catch { /* Playing is still a useful fallback without the bridge. */ }
    if (!id || id === target) reveal();
  }
  document.addEventListener('playing', playing, true);
  function check() {
    if (!host) return;
    const media = video();
    const id = new URLSearchParams(location.search).get('v');
    if (Date.now() - started > 8000 || document.querySelector('#movie_player.ad-showing')) { reveal(); return; }
    if (location.pathname === '/watch' && id === target && media && media.readyState >= 2 && media.videoWidth > 0) {
      let playerId: string | undefined;
      try { playerId = readPlayerId(); } catch { /* Retry when the bridge is ready. */ }
      if (playerId === target || !playerId && !navigating) {
        const expected = version;
        if (frameReadiness.ready(media, target, () => {
          if (expected === version && host && video() === media) reveal();
        })) { reveal(); return; }
      }
    }
    raf = requestAnimationFrame(check);
  }
  function sync(enabled: boolean, href: string, pending: boolean, failed = false) {
    navigating = pending;
    if (!enabled || failed) { completed = ''; clear(); return; }
    const url = new URL(href, location.origin), id = url.pathname === '/watch' ? url.searchParams.get('v') || '' : '';
    if (!id) { previous = ''; completed = ''; clear(); return; }
    if (target === id) return;
    if (completed === id) { if (target) clear(); previous = id; return; }
    // A ready, unchanged page needs no covering layer.
    if (!pending) { clear(); previous = id; completed = id; return; }
    const media = video();
    const outgoing = previous;
    clear(); target = id; previous = id; started = Date.now();
    host = document.createElement('div'); host.id = 'ytg-watch-transition';
    host.setAttribute('aria-hidden', 'true');
    image = document.createElement('img'); image.alt = ''; image.src = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
    canvas = document.createElement('canvas'); canvas.hidden = true;
    if (outgoing && outgoing !== id && media && media.readyState >= 2 && media.videoWidth > 0) {
      if (captureMediaFrame(canvas, media)) { canvas.hidden = false; image.hidden = true; }
    }
    host.append(image, canvas); document.documentElement.append(host);
    check();
  }
  return { sync, destroy() { clear(); document.removeEventListener('playing', playing, true); } };
}
