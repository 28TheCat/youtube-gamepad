// Keep this document_start entry independent of Vue and the main application.
const key = Symbol.for('yt-gamepad.early-start');
interface Boot { contentReady(): void; destroy(): void }
type BootWindow = Window & { [key]?: Boot };

export function finishEarlyContent() {
  (window as BootWindow)[key]?.contentReady();
}

export function abortEarlyContent() {
  (window as BootWindow)[key]?.destroy();
}

export function startEarly() {
  const owner = window as BootWindow;
  owner[key]?.destroy();
  let stopped = false;
  let host: HTMLElement | undefined;
  let root: HTMLElement | null = null;
  let revealFrame: number | undefined;
  const loadingStyle = document.createElement('style');
  // Native playback can render before the extension finishes mounting. Keep
  // it visible and interactive instead of turning that wait into a blank page.
  const playbackPage = location.pathname === '/watch' || location.pathname.startsWith('/shorts/');
  loadingStyle.textContent = location.pathname.startsWith('/shorts/')
    ? 'html,html > body { background: #fff !important; color-scheme: light !important; } html[dark],html[dark] > body,html[data-ytg-boot-theme="dark"],html[data-ytg-boot-theme="dark"] > body { background: #0f0f0f !important; color-scheme: dark !important; } html > body { visibility: hidden !important; }'
    : playbackPage ? 'html > body { visibility: hidden !important; } #movie_player, #movie_player * { visibility: visible !important; } #movie_player .ytp-chrome-top, #movie_player .ytp-chrome-bottom { visibility: hidden !important; }' : 'html > body { opacity: 0 !important; pointer-events: none !important; transition: none !important; }';
  const system = matchMedia('(prefers-color-scheme: dark)');
  let savedTheme: string | undefined;
  const attach = () => {
    if (stopped || !document.documentElement) return;
    root = document.documentElement;
    // A scoped hint only: never overwrite YouTube's own dark attribute.
    root.setAttribute('data-ytg-boot-theme', root.hasAttribute('dark') ? 'dark' : savedTheme || (system.matches ? 'dark' : 'light'));
    root.setAttribute('data-ytg-boot', 'starting');
    root.append(loadingStyle);
    if (host) root.append(host);
    observer.disconnect();
  };
  const observer = new MutationObserver(attach);
  const destroy = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
    observer.disconnect();
    window.removeEventListener('pagehide', destroy);
    root?.removeAttribute('data-ytg-boot');
    root?.removeAttribute('data-ytg-boot-theme');
    loadingStyle.remove();
    host?.remove();
    if (owner[key] === boot) delete owner[key];
  };
  // Reported privately by ISOLATED after its handshake and application mount.
  const boot: Boot = { contentReady() {
    // Let queued Vue updates finish before the first revealed paint.
    if (!stopped && revealFrame === undefined) revealFrame = requestAnimationFrame(destroy);
  }, destroy };
  owner[key] = boot;
  const timer = setTimeout(destroy, 8000);
  window.addEventListener('pagehide', destroy);
  observer.observe(document, { childList: true });
  attach();
  void (async () => {
    try {
    const saved = await chrome.storage.local.get(['uiTheme', 'enabled', 'browseMode']);
    if (stopped) return;
    if (saved.enabled === false || saved.browseMode === 'youtube') { destroy(); return; }
    const currentRoot = document.documentElement;
    if (saved.uiTheme === 'dark' || saved.uiTheme === 'light') {
      savedTheme = saved.uiTheme;
      if (currentRoot && !currentRoot.hasAttribute('dark')) currentRoot.setAttribute('data-ytg-boot-theme', savedTheme);
    }
    // Only show preparation to an already connected controller user.
    if (!Array.from(navigator.getGamepads?.() || []).some(pad => pad?.connected && pad.mapping === 'standard')) return;
    host = document.createElement('div');
    host.id = 'ytg-early-status';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{position:fixed;bottom:16px;right:16px;z-index:2147483647;pointer-events:none}span{display:block;padding:8px 12px;border-radius:8px;background:#fff;color:#171717;font:14px var(--ytg-font-family,Roboto,Arial,sans-serif)}:host-context([data-ytg-boot-theme="dark"]) span{background:#202020;color:#fff}';
    const label = document.createElement('span');
    label.setAttribute('role', 'status');
    label.textContent = 'Preparing gamepad controls…';
    shadow.append(style, label);
    currentRoot?.append(host);
    } catch { destroy(); }
  })();
}
