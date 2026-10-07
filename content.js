(() => {
  // This ISOLATED bridge must boot without globals from other scripts/worlds.
  const bridgeKey = Symbol.for('yt-gamepad.bridge.dispose');
  window[bridgeKey]?.();
  const resources = new Set();
  let destroyed = false;
  const lifecycle = {
    get destroyed() { return destroyed; },
    cleanup(dispose) {
      if (destroyed) { dispose(); return; }
      resources.add(dispose);
    },
    listen(target, type, listener) {
      if (!target?.addEventListener) return;
      const guarded = (...args) => { if (!destroyed) listener(...args); };
      target.addEventListener(type, guarded);
      this.cleanup(() => target.removeEventListener?.(type, guarded));
    },
    interval(callback, delay) {
      if (typeof setInterval !== 'function') return;
      const id = setInterval(() => { if (!destroyed) callback(); }, delay);
      this.cleanup(() => { if (typeof clearInterval === 'function') clearInterval(id); });
    },
    observer(callback) {
      const observer = new MutationObserver((...args) => { if (!destroyed) callback(...args); });
      this.cleanup(() => observer.disconnect());
      return observer;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const dispose of [...resources].reverse()) {
        try { dispose(); } catch (error) { console.warn('YouTube Gamepad bridge cleanup:', error); }
      }
      resources.clear();
      if (window[bridgeKey] === lifecycle.destroy) delete window[bridgeKey];
    }
  };
  window[bridgeKey] = lifecycle.destroy;
  const defaults = { enabled: true, theater: true, deadzone: 0.35, repeatDelay: 350, repeatInterval: 140, bindings: {}, bindingLayouts: null };
  // MAIN shares the site's environment. Publish only these non-secret settings;
  // never send an arbitrary extension-storage snapshot across this boundary.
  const send = raw => {
    if (lifecycle.destroyed) return;
    const { bindingLayouts: _layouts, ...values } = defaults;
    for (const key of ['enabled', 'theater']) if (typeof raw?.[key] === 'boolean') values[key] = raw[key];
    for (const [key, min, max] of [['deadzone', .15, .75], ['repeatDelay', 150, 1000], ['repeatInterval', 80, 500]]) {
      if (typeof raw?.[key] === 'number' && Number.isFinite(raw[key])) values[key] = Math.min(max, Math.max(min, raw[key]));
    }
    values.bindings = window.YTGamepadBindings.normalize(raw?.bindings);
    if (raw?.bindingLayouts) values.bindingLayouts = window.YTGamepadBindings.normalizeLayouts(raw.bindingLayouts, raw.bindings);
    window.postMessage({ source: 'yt-gamepad-settings', values }, location.origin);
  };
  let lastConnection;
  let seenConnection = false;
  let needsConnectionRetry = false;
  let connectionPending = false;
  let connectionRefresh = false;
  const reportConnection = (force = false) => {
    if (document.hidden) return;
    if (connectionPending) { connectionRefresh ||= force; return; }
    const connected = Array.from(navigator.getGamepads?.() || []).some(p => p?.connected && p.mapping === 'standard');
    if (connected) seenConnection = true;
    // An empty initial snapshot after navigation is not a disconnection.
    if (!seenConnection && !connected) return;
    if (!force && !needsConnectionRetry && connected === lastConnection) return;
    connectionPending = true;
    needsConnectionRetry = true;
    chrome.runtime.sendMessage({ type: 'ytg-controller-connection', connected }).then(result => {
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
  lifecycle.listen(window, 'yt-gamepad-escape-request', event => {
    const key = event.detail;
    // Page-created requests cannot manufacture a trusted keyboard event.
    if (!key?.isTrusted || key.key !== 'Escape' || key.repeat) return;
    event.preventDefault();
    const back = () => {
      if (!lifecycle.destroyed) window.postMessage({ source: 'yt-gamepad-escape-back' }, location.origin);
    };
    chrome.runtime.sendMessage({ type: 'ytg-exit-fullscreen' }).then(result => {
      if (!result?.exited) back();
    }).catch(error => { console.warn('YouTube Gamepad fullscreen:', error.message); back(); });
  });
  chrome.storage.local.get(defaults, send);
  // Only a bounded appearance value is persisted; page messages cannot write it.
  if (document.documentElement?.hasAttribute && chrome.runtime.onMessage?.addListener) {
    const readTheme = () => document.documentElement.hasAttribute('dark') ? 'dark' : 'light';
    let rememberedTheme;
    const rememberTheme = () => {
      if (document.hidden || lifecycle.destroyed) return;
      const theme = readTheme();
      if (theme === rememberedTheme) return;
      rememberedTheme = theme;
      Promise.resolve(chrome.storage.local.set({ uiTheme: theme })).catch(() => { rememberedTheme = undefined; });
    };
    const themeRequest = (message, sender, respond) => {
      if (message?.type !== 'ytg-read-theme' || lifecycle.destroyed || (sender.id && sender.id !== chrome.runtime.id)) return;
      respond({ theme: readTheme() });
    };
    chrome.runtime.onMessage.addListener(themeRequest);
    lifecycle.cleanup(() => chrome.runtime.onMessage.removeListener?.(themeRequest));
    lifecycle.observer(rememberTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
    lifecycle.listen(document, 'visibilitychange', rememberTheme);
    rememberTheme();
  }
  const onStorageChanged = (changes, area) => {
    if (lifecycle.destroyed) return;
    if (area === 'local') {
      const pageSettingsChanged = Object.keys(changes).some(key => key in defaults);
      if (pageSettingsChanged) chrome.storage.local.get(defaults, send);
      if (pageSettingsChanged || changes.autoFullscreen) reportConnection(true);
    }
  };
  chrome.storage.onChanged.addListener(onStorageChanged);
  lifecycle.cleanup(() => chrome.storage.onChanged.removeListener?.(onStorageChanged));
  let lastReady = -Infinity;
  let lastSettingsOpen = -Infinity;
  let disposeSettings;
  let settingsContainer;
  lifecycle.cleanup(() => disposeSettings?.());
  let diagnosticWindow = 0, diagnosticCount = 0;
  const onExtensionMessage = (message, sender, reply) => {
    if (sender.id === chrome.runtime.id && message?.type === 'ytg-open-inline-settings') {
      window.postMessage({ source: 'yt-gamepad-show-settings' }, location.origin);
      reply({ ok: true }); return;
    }
    if (sender.id !== chrome.runtime.id || message?.type !== 'ytg-connection-status') return;
    const pads = Array.from(navigator.getGamepads?.() || []).filter(p => p?.connected && p.mapping === 'standard');
    const pad = pads.find(p => p.buttons?.some(button => button.pressed) || p.axes?.some(axis => Math.abs(axis) > .35)) || pads[0];
    reply({ connected: Boolean(pad), ...(typeof pad?.id === 'string' ? { controllerId: pad.id.slice(0, 256) } : {}) });
  };
  chrome.runtime.onMessage.addListener(onExtensionMessage);
  lifecycle.cleanup(() => chrome.runtime.onMessage.removeListener?.(onExtensionMessage));
  lifecycle.listen(window, 'message', e => {
    // source/origin filter other windows, not hostile same-page scripts. The
    // Only bounded resends and opening the fixed settings page are accepted.
    if (e.source !== window || e.origin !== location.origin) return;
    // Telemetry only: no storage key, destination, or extension action from MAIN.
    if (e.data?.source === 'yt-gamepad-diagnostic') {
      const now = Date.now();
      if (now - diagnosticWindow >= 60000) { diagnosticWindow = now; diagnosticCount = 0; }
      if (++diagnosticCount > 100) return;
      const entry = e.data.entry;
      if (!entry || typeof entry.reason !== 'string' || entry.reason.length > 512 ||
          typeof entry.operation !== 'string' || entry.operation.length > 80 ||
          typeof entry.stack !== 'string' || entry.stack.length > 1024) return;
      chrome.runtime.sendMessage({ type: 'ytg-diagnostic', entry: {
        module: typeof entry.module === 'string' ? entry.module.slice(0, 40) : '',
        operation: entry.operation, name: typeof entry.name === 'string' ? entry.name.slice(0, 80) : '',
        reason: entry.reason, stack: entry.stack,
        state: Object.fromEntries(['route', 'mode', 'adaptation', 'enabled', 'surfaceReady', 'navigating'].map(key =>
          [key, typeof entry.state?.[key] === 'boolean' ? entry.state[key] :
            typeof entry.state?.[key] === 'string' ? entry.state[key].slice(0, 16) : '']))
      } }).catch(() => {});
      return;
    }
    if (e.data?.source === 'yt-gamepad-close-settings') {
      disposeSettings?.(); disposeSettings = undefined; settingsContainer = undefined; return;
    }
    // UI handlers in the isolated world own storage writes. The page can only
    // request this fixed panel, never supply settings values or storage keys.
    if (e.data?.source === 'yt-gamepad-open-settings') {
      const root = document.getElementById?.('yt-gamepad-menu')?.shadowRoot;
      const container = root?.querySelector('#inline-settings');
      if (container && window.YTGamepadInlineSettings) {
        if (container === settingsContainer && disposeSettings) return;
        disposeSettings?.(); settingsContainer = container;
        disposeSettings = window.YTGamepadInlineSettings.mount(root, container); return;
      }
      if (Date.now() - lastSettingsOpen < 1000) return;
      lastSettingsOpen = Date.now();
      chrome.runtime.sendMessage({ type: 'ytg-open-settings' }).catch(error => console.warn('YouTube Gamepad settings:', error.message));
      return;
    }
    if (e.data?.source !== 'yt-gamepad-ready') return;
    if (Date.now() - lastReady < 1000) return;
    lastReady = Date.now();
    chrome.storage.local.get(defaults, send);
  });
  // bfcache pages retain their JS state and resume the same instance on return.
  lifecycle.listen(window, 'pagehide', event => { if (!event.persisted) lifecycle.destroy(); });
})();
