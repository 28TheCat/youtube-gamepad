// Paste into DevTools Console on a YouTube list page, then click a video.
// Local observation only. Run __ytgPlaybackProbe.stop() to remove listeners.
(() => {
  window.__ytgPlaybackProbe?.stop();
  const cleanup = [];
  let sample, frameHandle, frameVideo;
  const now = () => performance.now();
  function listen(target, event, callback, capture = false) {
    target.addEventListener(event, callback, capture);
    cleanup.push(() => target.removeEventListener(event, callback, capture));
  }
  function mark(name, time = now()) {
    if (!sample || sample[name] !== undefined || time < sample.click) return;
    sample[name] = time;
    console.info('[Playback timing]', name, Math.round(time - sample.click), 'ms');
  }
  function report() {
    if (!sample) return console.info('Click a video first.');
    const pairs = [
      ['Click → navigation', 'click', 'navigation'],
      ['Navigation → media request', 'navigation', 'mediaRequest'],
      ['Media request → first matching frame', 'mediaRequest', 'firstFrame'],
      ['Click → first matching frame', 'click', 'firstFrame']
    ];
    console.table(pairs.map(([stage, start, end]) => ({ stage,
      milliseconds: sample[start] === undefined || sample[end] === undefined
        ? 'Not observed' : Math.round(sample[end] - sample[start]) })));
    console.info('Details', { ...sample });
    return { ...sample };
  }
  function cancelFrame() {
    if (frameHandle !== undefined) frameVideo?.cancelVideoFrameCallback(frameHandle);
    frameHandle = undefined;
  }
  function attachFrame() {
    if (!sample || sample.firstFrame !== undefined || frameHandle !== undefined) return;
    const video = document.querySelector('#movie_player video');
    if (!video?.requestVideoFrameCallback) return;
    frameVideo = video;
    const currentSample = sample;
    frameHandle = video.requestVideoFrameCallback((time, metadata) => {
      frameHandle = undefined;
      if (sample !== currentSample) return;
      const player = document.querySelector('#movie_player');
      const videoId = player?.getVideoData?.()?.video_id;
      const routeId = new URLSearchParams(location.search).get('v');
      // Reject stale frames and advertisements. This is a browser-presented
      // frame, not a guarantee that CSS has made the player visible.
      if (routeId === sample.videoId && videoId === sample.videoId &&
          !player.classList.contains('ad-showing') && metadata.mediaTime >= 0) {
        mark('firstFrame', time);
        report();
      } else attachFrame();
    });
  }
  listen(document, 'click', event => {
    const link = event.composedPath().find(node => node instanceof HTMLAnchorElement && node.href);
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || url.pathname !== '/watch' || !url.searchParams.get('v')) return;
    cancelFrame();
    sample = { videoId: url.searchParams.get('v'), click: now(), timeOrigin: performance.timeOrigin };
    console.info('[Playback timing] Click recorded.');
    attachFrame();
  }, true);
  listen(document, 'yt-navigate-start', () => mark('navigation'));
  listen(document, 'yt-navigate-finish', () => { mark('navigationFinish'); attachFrame(); });
  for (const name of ['loadstart', 'loadedmetadata', 'loadeddata', 'playing', 'waiting', 'error']) {
    listen(document, name, event => {
      if (!(event.target instanceof HTMLVideoElement) || !event.target.closest('#movie_player')) return;
      mark(name);
      attachFrame();
    }, true);
  }
  const resources = new PerformanceObserver(list => {
    if (!sample) return;
    for (const entry of list.getEntries()) {
      const url = new URL(entry.name);
      if (entry.startTime < sample.click || url.pathname !== '/videoplayback' ||
          !/(^|\.)googlevideo\.com$/.test(url.hostname)) continue;
      // Completed entries expose their request start retrospectively.
      // This may be an audio or advertisement request; do not label it as
      // definitely the selected video's first video segment.
      if (sample.mediaRequest === undefined || entry.startTime < sample.mediaRequest) {
        sample.mediaRequest = entry.startTime;
        sample.mediaRequestKind = 'First observed googlevideo media request; may be audio or ad';
        console.info('[Playback timing] Media request start', Math.round(entry.startTime - sample.click), 'ms');
        if (sample.firstFrame !== undefined) report();
      }
    }
  });
  resources.observe({ type: 'resource', buffered: false });
  cleanup.push(() => resources.disconnect());
  // A full navigation destroys this probe; do not misreport that as buffering.
  listen(window, 'pagehide', () => console.warn('[Playback timing] Document exited; this sample is incomplete.'));
  window.__ytgPlaybackProbe = { report, stop() {
    cancelFrame();
    cleanup.splice(0).forEach(remove => remove());
    delete window.__ytgPlaybackProbe;
  } };
  console.info('Playback probe ready. Click a video, then run __ytgPlaybackProbe.report() if needed.');
})();
