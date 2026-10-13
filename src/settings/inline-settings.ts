import { createApp } from 'vue';
import InlineSettings from './InlineSettings.vue';
import SettingsLauncher from './SettingsLauncher.vue';

export function mountSettingsLauncher(open: () => void) {
  const host = document.createElement('div');
  host.id = 'yt-gamepad-settings-launcher';
  // The page navigator can focus this host across the settings shadow root.
  host.tabIndex = -1;
  host.setAttribute('aria-label', 'YouTube Gamepad settings');
  host.addEventListener('click', event => { if (event.composedPath()[0] === host) open(); });
  const syncVisibility = () => {
    host.hidden = location.pathname !== '/' || Boolean(document.fullscreenElement);
  };
  syncVisibility();
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host{position:fixed!important;right:18px!important;top:50%!important;translate:0 -50%;z-index:2147483646!important;color:var(--ytg-text,#171717);font-family:var(--ytg-font-family,Arial,sans-serif)}
    :host([hidden]){display:none!important}
    :host-context(html.ytg-custom-browse){right:24px!important;top:40px!important}
    button{display:grid;place-items:center;width:48px;height:48px;padding:0;border:1px solid var(--ytg-border,#d1d5db);border-radius:50%;background:var(--ytg-background,#fff);color:inherit;box-shadow:0 3px 12px #0002;cursor:pointer}
    svg{width:24px;height:24px}button:hover{background:var(--ytg-surface,#f3f4f6)}
    button:focus-visible{outline:3px solid var(--ytg-text,#171717);outline-offset:3px}
    @media(max-width:600px){:host{right:10px!important}button{width:42px;height:42px}}
    @media(prefers-reduced-motion:no-preference){button{transition:background 160ms,transform 160ms}button:hover{transform:scale(1.06)}}
  `;
  const container = document.createElement('div');
  root.append(style, container);
  document.body.append(host);
  const app = createApp(SettingsLauncher, { open });
  app.mount(container);
  // YouTube changes routes without reloading the content script.
  const documentEvents = ['fullscreenchange', 'yt-navigate-start', 'yt-navigate-finish',
    'yt-navigate-cancel', 'yt-navigate-error', 'ytg-page-history-v1'];
  const windowEvents = ['popstate', 'pageshow'];
  for (const event of documentEvents) document.addEventListener(event, syncVisibility);
  for (const event of windowEvents) window.addEventListener(event, syncVisibility);
  return () => {
    for (const event of documentEvents) document.removeEventListener(event, syncVisibility);
    for (const event of windowEvents) window.removeEventListener(event, syncVisibility);
    app.unmount(); host.remove();
  };
}

// Runs only in ISOLATED. Keep the bridge's mount/dispose contract while Vue
// owns the panel contents and storage writes originate in UI handlers.
export const YTGamepadInlineSettings = {
  mount(root: ShadowRoot|null|undefined, container: string|Element) {
    const app = createApp(InlineSettings, { root, container });
    app.mount(container);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      app.unmount();
    };
  }
};
