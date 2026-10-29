import { isNativeFlowRoute } from '../shared/explore-pages';
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
  if (isNativeFlowRoute(location.pathname)) return;
  let stopped = false;
  let root: HTMLElement | null = null;
  let revealFrame: number | undefined;
  const system = matchMedia('(prefers-color-scheme: dark)');
  let savedTheme: string | undefined;
  const attach = () => {
    if (stopped || !document.documentElement) return;
    root = document.documentElement;
    // A scoped hint only: never overwrite YouTube's own dark attribute.
    root.setAttribute('data-ytg-boot-theme', root.hasAttribute('dark') ? 'dark' : savedTheme || (system.matches ? 'dark' : 'light'));
    root.setAttribute('data-ytg-boot', 'starting');
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
    } catch { destroy(); }
  })();
}
