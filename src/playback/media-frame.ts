/** Capture the decoded picture without changing playback or media ownership. */
export function captureMediaFrame(canvas: HTMLCanvasElement, video: HTMLVideoElement | null | undefined): boolean {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;
  try {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return false;
    context.drawImage(video, 0, 0);
    return true;
  } catch { return false; }
}

/** Track presentation for one media/route pair and invalidate late callbacks. */
export function createMediaFrameReadiness() {
  let media: HTMLVideoElement | undefined, key = '', callback: number | undefined;
  let presented = false, version = 0;
  function reset() {
    ++version;
    if (media && callback !== undefined) media.cancelVideoFrameCallback?.(callback);
    media = undefined; callback = undefined; key = ''; presented = false;
  }
  function ready(video: HTMLVideoElement | null, route: string, onPresented: () => void) {
    if (media !== video || key !== route) { reset(); media = video || undefined; key = route; }
    if (!video || video.readyState < 2) return false;
    // Paused media and older browsers cannot promise another presentation event.
    if (!video.requestVideoFrameCallback || video.paused || !video.videoWidth) return true;
    if (!presented && callback === undefined) {
      const expected = version;
      callback = video.requestVideoFrameCallback(() => {
        if (expected !== version || media !== video) return;
        callback = undefined; presented = true; onPresented();
      });
    }
    return presented;
  }
  return { ready, reset };
}
