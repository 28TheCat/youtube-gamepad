import { createApp } from 'vue';
import InlineSettings from './InlineSettings.vue';
import SettingsLauncher from './SettingsLauncher.vue';

export function mountSettingsLauncher(open: () => void) {
  const host = document.createElement('div');
  host.id = 'yt-gamepad-settings-launcher';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host{position:fixed!important;right:18px!important;top:50%!important;translate:0 -50%;z-index:2147483646!important;color:var(--ytg-text,#171717);font-family:var(--ytg-font-family,Arial,sans-serif)}
    :host([hidden]){display:none!important}
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
  // Keep the native fullscreen player free of floating page controls.
  const fullscreen = () => { host.hidden = Boolean(document.fullscreenElement); };
  document.addEventListener('fullscreenchange', fullscreen);
  fullscreen();
  return () => {
    document.removeEventListener('fullscreenchange', fullscreen);
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
