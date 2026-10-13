import { videoGridDefaults, normalizeVideoGrid } from '../shared/video-grid';
import type { Dispose, Settings } from '../../types/ports';
import type { DisposerHost } from '../../types/core';
import { YTGamepadBindings } from '../input/bindings.ts';
import { YTGamepadInlineSettings } from '../settings/inline-settings.ts';
import { applyLanguage, languageDefault } from '../shared/i18n';
export function startContent(localChannel?: import("../../types/ports").ApplicationChannel, onInvalidated?: Dispose) {
  const publish = (message: import("../../types/ports").ApplicationMessage) => {
    if (localChannel) localChannel.publish(message);
    else window.postMessage(message, location.origin);
  };
  // This ISOLATED bridge must boot without globals from other scripts/worlds.
  const bridgeKey = Symbol.for('yt-gamepad.bridge.dispose');
  (window as unknown as DisposerHost)[bridgeKey]?.();
  const resources: Set<Dispose> = new Set();
  let destroyed = false;
  const lifecycle = {
    get destroyed() { return destroyed; },
    cleanup(dispose: Dispose) {
      if (destroyed) { dispose(); return; }
      resources.add(dispose);
    },
    listen<K extends keyof WindowEventMap>(target: EventTarget, type: K, listener: (event: WindowEventMap[K]) => void) {
      if (!target?.addEventListener) return;
      const guarded: EventListener = event => { if (!destroyed) listener(event as WindowEventMap[K]); };
      target.addEventListener(type, guarded);
      this.cleanup(() => target.removeEventListener?.(type, guarded));
    },
    interval(callback: { (force?: boolean): void; (): void; }, delay?: number|undefined) {
      if (typeof setInterval !== 'function') return;
      const id = setInterval(() => { if (!destroyed) callback(); }, delay);
      this.cleanup(() => { if (typeof clearInterval === 'function') clearInterval(id); });
    },
    observer(callback: MutationCallback) {
      const observer = new MutationObserver((...args) => { if (!destroyed) callback(...args); });
      this.cleanup(() => observer.disconnect());
      return observer;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const dispose of [...resources].reverse()) {
        try { dispose(); } catch (error) {
          if (!isInvalidated(error)) console.warn('YouTube Gamepad bridge cleanup:', error);
        }
      }
      resources.clear();
      if ((window as unknown as DisposerHost)[bridgeKey] === lifecycle.destroy) delete (window as unknown as DisposerHost)[bridgeKey];
    }
  };
  (window as unknown as DisposerHost)[bridgeKey] = lifecycle.destroy;
  function isInvalidated(error: unknown) {
    return /extension context invalidated/i.test(String((error as { message?: string })?.message || error));
  }
  function failedExtensionCall(error: unknown): undefined {
    if (!isInvalidated(error)) throw error;
    if (lifecycle.destroyed) return;
    lifecycle.destroy();
    onInvalidated?.();
  }
  function contextAvailable() {
    if (lifecycle.destroyed) return false;
    try {
      if (chrome.runtime.id) return true;
      failedExtensionCall(new Error('Extension context invalidated.'));
    } catch (error) { failedExtensionCall(error); }
    return false;
  }
  // Chrome APIs can throw before returning a Promise after an extension reload.
  function extensionCall<T>(operation: () => T): Promise<Awaited<T> | undefined> {
    if (lifecycle.destroyed) return Promise.resolve(undefined);
    try { return Promise.resolve(operation()).catch(failedExtensionCall); }
    catch (error) {
      try { failedExtensionCall(error); return Promise.resolve(undefined); }
      catch (other) { return Promise.reject(other); }
    }
  }
  const defaults = { ...videoGridDefaults, uiLanguage: languageDefault, enabled: true, rightHandMode: false, theater: true, deadzone: 0.35, repeatDelay: 350, repeatInterval: 140, bindings: {}, bindingLayouts: null };
  // Production settings stay inside the isolated module graph.
  const send = (raw: Record<string,unknown>) => {
    if (lifecycle.destroyed) return;
    applyLanguage(raw?.uiLanguage);
    const { bindingLayouts: _layouts, uiLanguage: _language, ...initialValues } = defaults;
    const values: Settings = initialValues;
    for (const key of ['enabled', 'theater', 'rightHandMode'] as const) if (typeof raw?.[key] === 'boolean') values[key] = raw[key];
    for (const [key, min, max] of [['deadzone', .15, .75], ['repeatDelay', 150, 1000], ['repeatInterval', 80, 500]] as const) {
      if (typeof raw?.[key] === 'number' && Number.isFinite(raw[key])) values[key] = Math.min(max, Math.max(min, raw[key]));
    }
    values.bindings = YTGamepadBindings.normalize(raw?.bindings);
    if (raw?.bindingLayouts) values.bindingLayouts = YTGamepadBindings.normalizeLayouts(raw.bindingLayouts, raw.bindings);
    publish({ source: 'yt-gamepad-settings', values: { ...values, ...normalizeVideoGrid(raw) } });
  };
  let lastConnection: boolean;
  let seenConnection = false;
  let needsConnectionRetry = false;
  let connectionPending = false;
  let connectionRefresh = false;
  const reportConnection = (force = false) => {
    if (!contextAvailable()) return;
    if (document.hidden) return;
    if (connectionPending) { connectionRefresh ||= force; return; }
    const connected = Array.from(navigator.getGamepads?.() || []).some(p => p?.connected && p.mapping === 'standard');
    if (connected) seenConnection = true;
    // An empty initial snapshot after navigation is not a disconnection.
    if (!seenConnection && !connected) return;
    if (!force && !needsConnectionRetry && connected === lastConnection) return;
    connectionPending = true;
    needsConnectionRetry = true;
    extensionCall(() => chrome.runtime.sendMessage({ type: 'ytg-controller-connection', connected })).then(result => {
      if (lifecycle.destroyed) return;
      if (result?.ok === true && !result.retry) { lastConnection = connected; needsConnectionRetry = false; }
      else if (result?.ok === false) console.warn('YouTube Gamepad fullscreen:', result.error);
    }).catch(error => console.warn('YouTube Gamepad fullscreen:', error.message)).finally(() => {
      connectionPending = false;
      if (connectionRefresh && !lifecycle.destroyed) {
        connectionRefresh = false;
        reportConnection(true);
      }
    });
  };
  lifecycle.interval(reportConnection, 500);
  lifecycle.listen(window, 'gamepadconnected', () => reportConnection());
  lifecycle.listen(window, 'gamepaddisconnected', () => reportConnection());
  lifecycle.listen(document, 'visibilitychange', () => reportConnection(true));
  lifecycle.listen(window, 'focus', () => reportConnection(true));
  reportConnection();
  lifecycle.listen(window, 'yt-gamepad-escape-request', (event) => {
    const key = event.detail;
    // Page-created requests cannot manufacture a trusted keyboard event.
    if (!key?.isTrusted || key.key !== 'Escape' || key.repeat) return;
    event.preventDefault();
    const back = () => {
      if (!lifecycle.destroyed) publish({ source: 'yt-gamepad-escape-back' });
    };
    extensionCall(() => chrome.runtime.sendMessage({ type: 'ytg-exit-fullscreen' })).then(result => {
      if (!result?.exited) back();
    }).catch(error => { console.warn('YouTube Gamepad fullscreen:', error.message); back(); });
  });
  const readSettings = () => extensionCall(() => chrome.storage.local.get(defaults, send))
    .catch(error => console.warn('YouTube Gamepad settings:', error.message));
  void readSettings();
  if (lifecycle.destroyed) return lifecycle.destroy;
  // Only a bounded appearance value is persisted; page messages cannot write it.
  if (document.documentElement?.hasAttribute && chrome.runtime.onMessage?.addListener) {
    const readTheme = () => document.documentElement.hasAttribute('dark') ? 'dark' : 'light';
    let rememberedTheme: string|undefined;
    const rememberTheme = () => {
      if (document.hidden || lifecycle.destroyed) return;
      const theme = readTheme();
      if (theme === rememberedTheme) return;
      rememberedTheme = theme;
      extensionCall(() => chrome.storage.local.set({ uiTheme: theme })).catch(() => { rememberedTheme = undefined; });
    };
    const themeRequest = (message: { type: string; }, sender: chrome.runtime.MessageSender, respond: (arg0: { theme: string; }) => void) => {
      if (message?.type !== 'ytg-read-theme' || lifecycle.destroyed || (sender.id && sender.id !== chrome.runtime.id)) return;
      respond({ theme: readTheme() });
    };
    chrome.runtime.onMessage.addListener(themeRequest);
    lifecycle.cleanup(() => chrome.runtime.onMessage.removeListener?.(themeRequest));
    lifecycle.observer(rememberTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
    lifecycle.listen(document, 'visibilitychange', rememberTheme);
    rememberTheme();
  }
  if (lifecycle.destroyed) return lifecycle.destroy;
  const onStorageChanged = (changes: Record<string,chrome.storage.StorageChange>, area: string) => {
    if (lifecycle.destroyed) return;
    if (area === 'local') {
      if (changes.uiLanguage) applyLanguage(changes.uiLanguage.newValue);
      // UI language does not change input policy. Avoid reapplying disabled
      // controls, which would otherwise close an open search during translation.
      const pageSettingsChanged = Object.keys(changes).some(key => key !== 'uiLanguage' && key in defaults);
      if (pageSettingsChanged) void readSettings();
      if (pageSettingsChanged || changes.autoFullscreen) reportConnection(true);
    }
  };
  chrome.storage.onChanged.addListener(onStorageChanged);
  lifecycle.cleanup(() => chrome.storage.onChanged.removeListener?.(onStorageChanged));
  let lastReady = -Infinity;
  let lastSettingsOpen = -Infinity;
  let disposeSettings: (() => void)|undefined;
  let settingsContainer: Element|undefined;
  lifecycle.cleanup(() => disposeSettings?.());
  let diagnosticWindow = 0, diagnosticCount = 0;
  const onExtensionMessage = (message: { type: string; }, sender: chrome.runtime.MessageSender, reply: (arg0: { ok?: boolean; controllerId?: string; connected?: boolean; }) => void) => {
    if (sender.id === chrome.runtime.id && message?.type === 'ytg-open-inline-settings') {
      publish({ source: 'yt-gamepad-show-settings' });
      reply({ ok: true }); return;
    }
    if (sender.id !== chrome.runtime.id || message?.type !== 'ytg-connection-status') return;
    const pads = Array.from(navigator.getGamepads?.() || []).filter(p => p?.connected && p.mapping === 'standard').filter((p): p is Gamepad => p !== null);
    const pad = pads.find(p => p.buttons?.some(button => button.pressed) || p.axes?.some(axis => Math.abs(axis) > .35)) || pads[0];
    reply({ connected: Boolean(pad), ...(typeof pad?.id === 'string' ? { controllerId: pad.id.slice(0, 256) } : {}) });
  };
  chrome.runtime.onMessage.addListener(onExtensionMessage);
  lifecycle.cleanup(() => chrome.runtime.onMessage.removeListener?.(onExtensionMessage));
  const receive = (e: MessageEvent) => {
    // source/origin filter other windows, not hostile same-page scripts. The
    // Only bounded resends and opening the fixed settings page are accepted.
    if (e.source !== window || e.origin !== location.origin) return;
    if (!contextAvailable()) return;
    // Telemetry only: no storage key, destination, or extension action from MAIN.
    if (e.data?.source === 'yt-gamepad-diagnostic') {
      const now = Date.now();
      if (now - diagnosticWindow >= 60000) { diagnosticWindow = now; diagnosticCount = 0; }
      if (++diagnosticCount > 100) return;
      const entry = e.data.entry;
      if (!entry || typeof entry.reason !== 'string' || entry.reason.length > 512 ||
          typeof entry.operation !== 'string' || entry.operation.length > 80 ||
          typeof entry.stack !== 'string' || entry.stack.length > 1024) return;
      extensionCall(() => chrome.runtime.sendMessage({ type: 'ytg-diagnostic', entry: {
        module: typeof entry.module === 'string' ? entry.module.slice(0, 40) : '',
        operation: entry.operation, name: typeof entry.name === 'string' ? entry.name.slice(0, 80) : '',
        reason: entry.reason, stack: entry.stack,
        state: Object.fromEntries(['route', 'mode', 'adaptation', 'enabled', 'surfaceReady', 'navigating'].map(key =>
          [key, typeof entry.state?.[key] === 'boolean' ? entry.state[key] :
            typeof entry.state?.[key] === 'string' ? entry.state[key].slice(0, 16) : '']))
      } })).catch(() => {});
      return;
    }
    if (e.data?.source === 'yt-gamepad-close-settings') {
      disposeSettings?.(); disposeSettings = undefined; settingsContainer = undefined; return;
    }
    // UI handlers in the isolated world own storage writes. The page can only
    // request this fixed panel, never supply settings values or storage keys.
    if (e.data?.source === 'yt-gamepad-open-settings') {
      const root = document.getElementById?.('yt-gamepad-menu')?.shadowRoot;
      const container = root?.querySelector<HTMLElement>('#inline-settings');
      if (container && YTGamepadInlineSettings) {
        if (container === settingsContainer && disposeSettings) return;
        disposeSettings?.(); settingsContainer = container;
        disposeSettings = YTGamepadInlineSettings.mount(root, container); return;
      }
      if (Date.now() - lastSettingsOpen < 1000) return;
      lastSettingsOpen = Date.now();
      extensionCall(() => chrome.runtime.sendMessage({ type: 'ytg-open-settings' })).catch(error => console.warn('YouTube Gamepad settings:', error.message));
      return;
    }
    if (e.data?.source !== 'yt-gamepad-ready') return;
    if (Date.now() - lastReady < 1000) return;
    lastReady = Date.now();
    void readSettings();
  };
  if (localChannel) lifecycle.cleanup(localChannel.subscribe(data => receive({source: window, origin: location.origin, data} as unknown as MessageEvent)));
  else lifecycle.listen(window, 'message', receive);
  // bfcache pages retain their JS state and resume the same instance on return.
  lifecycle.listen(window, 'pagehide', (event) => { if (!event.persisted) lifecycle.destroy(); });
  return lifecycle.destroy;
}
