// No Vue, input polling or page takeover in this document_start entry.
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
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  // A scoped hint only: never overwrite YouTube's own dark attribute.
  root.setAttribute('data-ytg-boot-theme', root.hasAttribute('dark') || system.matches ? 'dark' : 'light');
  root.setAttribute('data-ytg-boot', 'starting');
  const destroy = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    window.removeEventListener('pagehide', destroy);
    root.removeAttribute('data-ytg-boot');
    root.removeAttribute('data-ytg-boot-theme');
    host?.remove();
    if (owner[key] === boot) delete owner[key];
  };
  // Reported privately by ISOLATED after its handshake and application mount.
  const boot: Boot = { contentReady: destroy, destroy };
  owner[key] = boot;
  const timer = setTimeout(destroy, 15000);
  window.addEventListener('pagehide', destroy);
  void (async () => {
    try {
    const saved = await chrome.storage.local.get(['uiTheme', 'enabled']);
    if (stopped) return;
    if (saved.enabled === false) { destroy(); return; }
    if (!root.hasAttribute('dark') && (saved.uiTheme === 'dark' || saved.uiTheme === 'light'))
      root.setAttribute('data-ytg-boot-theme', saved.uiTheme);
    // Only show preparation to an already connected controller user.
    if (!Array.from(navigator.getGamepads?.() || []).some(pad => pad?.connected && pad.mapping === 'standard')) return;
    host = document.createElement('div');
    host.id = 'ytg-early-status';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{position:fixed;bottom:16px;right:16px;z-index:2147483647;pointer-events:none}span{display:block;padding:8px 12px;border-radius:8px;background:#fff;color:#171717;font:14px system-ui}:host-context([data-ytg-boot-theme="dark"]) span{background:#202020;color:#fff}';
    const label = document.createElement('span');
    label.setAttribute('role', 'status');
    label.textContent = 'Preparing gamepad controls…';
    shadow.append(style, label);
    root.append(host);
    } catch { destroy(); }
  })();
}
