import { parseWatchLink } from '../shared/watch-link';
import type { PageAccess } from '../bridge/page-protocol';

type Identity = 'target' | 'previous' | 'other' | 'unavailable';
type Step = { elapsedMs: number; event: string; identity?: Identity };
type Attempt = { steps: Step[]; status: string; elapsedMs?: number; frameObservation: 'pending' | 'supported' | 'unsupported' };

/** Page-local observations. Video IDs are used only for comparisons and never exported. */
export function createPlaybackSwitchTrace(pageAccess?: PageAccess) {
  const attempts: Attempt[] = [];
  let stopActive: ((reason: string) => void) | undefined;

  function start(href: string) {
    const target = parseWatchLink(href)?.videoId;
    if (!target) return false;
    stopActive?.('superseded');
    const previous = new URLSearchParams(location.search).get('v');
    const started = performance.now();
    const attempt: Attempt = { status: 'observing', steps: [], frameObservation: 'pending' };
    attempts.push(attempt);
    if (attempts.length > 8) attempts.shift();
    let timer: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let frameVideo: HTMLVideoElement | undefined;
    let frameRequest: number | undefined;
    let lastRoute: Identity | undefined;
    let lastPlayer: Identity | undefined;
    let active = true;
    const elapsed = () => Math.round(performance.now() - started);
    const record = (event: string, identity?: Identity) => {
      if (attempt.steps.length < 40) attempt.steps.push({ elapsedMs: elapsed(), event, ...(identity ? { identity } : {}) });
    };
    const identity = (value: string | null | undefined): Identity => !value ? 'unavailable'
      : value === target ? 'target' : value === previous ? 'previous' : 'other';
    const stop = (reason: string) => {
      if (!active) return;
      active = false;
      clearInterval(timer);
      clearTimeout(deadline);
      if (frameVideo && frameRequest !== undefined) frameVideo.cancelVideoFrameCallback?.(frameRequest);
      for (const event of events) document.removeEventListener(event, observe, true);
      attempt.status = reason;
      attempt.elapsedMs = elapsed();
      record(reason);
      if (stopActive === stop) stopActive = undefined;
    };
    const observe = () => {
      if (!active) return;
      try {
        const route = identity(location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
        if (route !== lastRoute) { lastRoute = route; record('address', route); }
        let playerId: string | undefined;
        try { playerId = pageAccess?.readPlayerVideoId?.(); } catch { /* unavailable */ }
        const player = identity(playerId);
        if (player !== lastPlayer) { lastPlayer = player; record('player', player); }
        const video = document.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video');
        const frameSupported = video && typeof (video as unknown as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === 'function';
        if (route === 'target' && player === 'target' && video) {
          attempt.frameObservation = frameSupported ? 'supported' : 'unsupported';
        }
        if (frameVideo && (video !== frameVideo || player !== 'target' || route !== 'target')) {
          if (frameRequest !== undefined) frameVideo.cancelVideoFrameCallback?.(frameRequest);
          frameVideo = undefined;
          frameRequest = undefined;
        }
        if (route === 'target' && player === 'target' && video && !frameVideo && frameSupported) {
          frameVideo = video;
          frameRequest = video.requestVideoFrameCallback(() => {
            frameRequest = undefined;
            if (!active) return;
            // A callback can arrive after another route change.
            let current: string | undefined;
            try { current = pageAccess?.readPlayerVideoId?.(); } catch { /* unavailable */ }
            if (location.pathname === '/watch' && new URLSearchParams(location.search).get('v') === target &&
                current === target && document.querySelector('#movie_player video.html5-main-video') === video) {
              record('frame-after-target-player');
              stop('frame-observed');
            } else { frameVideo = undefined; observe(); }
          });
        }
      } catch { /* Diagnostics must not affect playback. */ }
    };
    const events = ['yt-navigate-start', 'yt-navigate-finish', 'yt-navigate-cancel', 'yt-navigate-error', 'loadedmetadata', 'loadeddata', 'playing'];
    record('selected');
    stopActive = stop;
    for (const event of events) document.addEventListener(event, observe, true);
    observe();
    timer = setInterval(observe, 250);
    deadline = setTimeout(() => stop('observation-timeout'), 20000);
    return true;
  }

  return {
    start,
    finish(reason: string) { stopActive?.(reason); },
    clear() { stopActive?.('cleared'); attempts.length = 0; },
    destroy() { stopActive?.('destroyed'); },
    snapshot() {
      return attempts.map(attempt => ({ ...attempt,
        milestones: {
          addressTarget: attempt.steps.some(step => step.event === 'address' && step.identity === 'target'),
          playerTarget: attempt.steps.some(step => step.event === 'player' && step.identity === 'target'),
          frameAfterTargetPlayer: attempt.steps.some(step => step.event === 'frame-after-target-player')
        },
        steps: attempt.steps.map(step => ({ ...step })) }));
    }
  };
}
