// Application policy: mode transitions, route history and module coordination.
(() => {
  const lifecycle = window.YTGamepadRuntime.scope('coordinator');
  let site, watch;
  const interaction = window.YTGamepadInteraction;
  const appState = () => interaction.state.app;
  const send = event => interaction.dispatch(event);
  send({ type: 'APP_INIT', route: location.pathname + location.search });
  let preferences = { enabled: true, theater: true };
  let savedPreferences = { ...preferences }, suspended = false;
  const routeNow = () => location.pathname + location.search;
  let adaptationSince = 0, rendering = false, checking = false, notice;
  const adaptation = () => appState().adaptation || { status: 'inactive', reason: '' };
  const surfaceReady = () => adaptation().status === 'ready';
  const visibleMode = () => location.pathname === '/watch' && surfaceReady() ? appState().mode : 'browse';
  function setAdaptation(status, reason = '') {
    send({ type: 'ADAPTATION', route: routeNow(), status, reason });
    document.documentElement.dataset.ytgAdaptation = status;
    if (status === 'waiting' || status === 'fallback') document.documentElement.dataset.ytgNative = 'true';
    else delete document.documentElement.dataset.ytgNative;
  }
  function showFallbackNotice() {
    if (typeof document.createElement !== 'function') return;
    if (!notice) {
      const host = document.createElement('div'); host.id = 'ytg-fallback-notice';
      const root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = ':host{position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:min(460px,90vw);font:14px/1.5 system-ui;color:#fff;background:#202020;padding:14px 18px;border-radius:12px;box-shadow:0 4px 20px #0006}:host([hidden]){display:none}button{margin-left:12px;padding:6px 12px;font:inherit;cursor:pointer}';
      const message = document.createElement('span'); message.setAttribute('role', 'status');
      const retry = document.createElement('button'); retry.textContent = '重试适配';
      retry.addEventListener('click', retryAdaptation);
      root.append(style, message, retry); document.documentElement.append(host);
      notice = { host, message };
    }
    notice.message.textContent = '已恢复 YouTube 原生界面：' + adaptation().reason;
    notice.host.hidden = false;
  }
  function diagnose(operation, error, module = 'coordinator') {
    try {
      window.YTGamepadDiagnostics?.record(module, operation, error, {
        route: location.pathname === '/watch' ? 'watch' : 'browse', mode: appState().mode,
        adaptation: adaptation().status, enabled: preferences.enabled,
        surfaceReady: surfaceReady(), navigating: !!appState().navigation || !!appState().returning
      });
    } catch (_) {}
  }
  function restoreNative() {
    // Establish the CSS safety gate before attempting any potentially faulty view work.
    document.documentElement.dataset.ytgNative = 'true';
    document.documentElement.dataset.ytgMode = 'browse';
    try { window.YTGamepadMenu?.close(); } catch (error) { diagnose('restore.closeMenu', error, 'menu'); }
    try { watch?.sync('browse', preferences); } catch (error) { diagnose('restore.syncWatch', error, 'watch'); }
    try { site.restoreNativeInterface(); } catch (error) { diagnose('restore.nativeInterface', error, 'site'); }
  }
  function failAdaptation(reason = '视频界面适配失败') {
    if (!preferences.enabled || location.pathname !== '/watch') {
      setAdaptation('inactive'); restoreNative();
      if (notice) notice.host.hidden = true;
      return;
    }
    setAdaptation('fallback', reason);
    restoreNative();
    try { showFallbackNotice(); } catch (error) { diagnose('fallback.notice', error, 'coordinator'); }
  }
  function checkAdaptation() {
    if (checking) return;
    checking = true;
    try {
      if (!preferences.enabled || location.pathname !== '/watch') {
        setAdaptation('inactive');
        if (notice) notice.host.hidden = true;
        return;
      }
      if (adaptation().route !== routeNow() || adaptation().status === 'inactive') {
        adaptationSince = Date.now(); setAdaptation('waiting');
        if (notice) notice.host.hidden = true;
      }
      // A failed route requires an explicit retry, avoiding repeated takeovers.
      if (adaptation().status === 'fallback') return;
      site.inspectOptionalCapabilities?.();
      const wasReady = surfaceReady(), health = site.inspectWatchCapabilities();
      if (health.ready) {
        if (!wasReady) { setAdaptation('ready'); renderMode(); }
      } else if (health.failed || wasReady || Date.now() - adaptationSince >= 5000) {
        const reason = health.failed ? '播放器适配失败' : '未找到' + health.missing.join('、');
        diagnose('inspectWatchCapabilities', new Error(reason), 'site');
        failAdaptation(reason);
      } else {
        // Never hide native controls while waiting for YouTube to finish loading.
        try { site.restoreNativeInterface(); } catch (error) { diagnose('restore.nativeInterface', error, 'site'); }
      }
    } catch (error) { diagnose('checkAdaptation', error, 'site'); failAdaptation(); }
    finally {
      checking = false;
      try {
        site.syncCommentPreload?.(preferences.enabled && surfaceReady() && visibleMode() !== 'browse' &&
          !appState().navigation && !appState().returning && !hasTemporaryLayer());
      } catch (error) {
        diagnose('syncCommentPreload', error, 'site');
        // Optional comment loading must not trigger a player fallback.
        document.documentElement.classList.toggle('ytg-comments-preload', false);
      }
    }
  }
  function retryAdaptation() {
    if (!preferences.enabled || location.pathname !== '/watch') return;
    adaptationSince = Date.now(); setAdaptation('waiting');
    if (notice) notice.host.hidden = true;
    checkAdaptation(); renderMode();
  }
  function readSafely(operation, read, empty) {
    try { return read(); }
    catch (error) { diagnose(operation, error, 'site'); failAdaptation(); return empty(); }
  }
  function hasTemporaryLayer() {
    return !!(window.YTGamepad.hasTemporaryLayer || window.YTGamepadFocus?.suspended || window.YTGamepadMenu?.opened || watch?.state.panel || site.hasNativeLayer?.());
  }
  function requestAutoHide(idle) {
    if (!surfaceReady()) return;
    try {
    const video = site.readPlayback().video;
    const result = send({ type: 'AUTO_HIDE', idle, playing: !!video && !video.paused && !video.ended,
      temporaryLayer: hasTemporaryLayer() });
    if (result.effects.length) renderMode();
    } catch (error) { diagnose('requestAutoHide', error, 'site'); failAdaptation(); }
  }
  function openSettings() {
    const opened = site.openSettings();
    if (opened) window.YTGamepad.refresh?.();
    return opened;
  }
  function backSettings() {
    if (!site.settingsOpen()) return false;
    site.backSettings();
    window.YTGamepad.refresh?.();
    return true;
  }
  // Every view command shares the same enablement and navigation policy.
  // Views read this state; their render notifications cannot write it back.
  function request(type, value) {
    if (lifecycle.destroyed) return false;
    if (!preferences.enabled || appState().navigation || appState().returning) return false;
    if (type === 'mode' && value !== 'browse' && !surfaceReady()) return false;
    try {
    switch (type) {
      case 'mode': setMode(value); return true;
      case 'media': return site.perform(value);
      case 'watchAction': {
        const result = site.performWatchAction(value);
        window.YTGamepad.refresh?.();
        return result;
      }
      case 'seek': return site.seekTo(value);
      case 'settings': return openSettings();
      case 'backSettings': return backSettings();
      case 'channel': return site.openChannel(() => setMode('browse'));
      case 'recommendation': return site.openRecommendation(value, prepareVideo);
      case 'replies': return site.expandReplies(value);
      case 'comments': return site.loadComments(value);
      default: return false;
    }
    } catch (error) { diagnose('request.' + type, error, 'site'); failAdaptation(); return false; }
  }
  function observePlayback(playback) {
    // Media state is a fresh YouTube snapshot, never a second playback model.
    document.documentElement.classList.toggle('ytg-settings-open', preferences.enabled && surfaceReady() && playback.settingsOpen);
  }
  function getPriorityLayer() {
    return window.YTGamepadMenu?.opened ? { handle: action => window.YTGamepadMenu.handle(action) } : null;
  }
  function handleShortcut(action) {
    if (!['search', 'help'].includes(action) || !window.YTGamepadMenu) return 'pass';
    return window.YTGamepadMenu.handle(action);
  }
  const routes = window.YTGamepadRouteController.create({ interaction, routeNow, renderMode, hasTemporaryLayer,
    location, history, window, document, enabled: () => preferences.enabled,
    pause: () => site.perform('pause'), closeMenu: () => window.YTGamepadMenu?.close(),
    onStart: () => site.syncCommentPreload?.(false)
  });
  const prepareVideo = routes.prepareVideo, pageBack = routes.pageBack;
  function setMode(value) {
    if (lifecycle.destroyed) return;
    send({ type: 'MODE', value, route: routeNow() }); renderMode();
  }
  function renderMode() {
    if (rendering) return;
    rendering = true;
    try {
      checkAdaptation();
      const mode = visibleMode();
      document.documentElement.dataset.ytgMode = mode;
      document.documentElement.classList.toggle('ytg-playback', preferences.enabled && mode !== 'browse');
      document.documentElement.classList.toggle('ytg-controls', preferences.enabled && mode === 'controls');
      watch?.sync(mode, preferences);
      if (!preferences.enabled || mode === 'browse') site.syncCommentPreload?.(false);
      window.YTGamepad.refresh?.();
    } catch (error) { diagnose('renderMode', error, 'watch'); failAdaptation(); }
    finally { rendering = false; }
  }
  function showControls(target = 'controls') {
    if (watch) { watch.show(target); return; }
    if (target === 'recommendations') return;
    setMode('controls');
    window.YTGamepad.focus?.(site.showNativeControls());
    window.YTGamepad.refresh?.();
  }
  function executeEffects(effects) {
    for (const effect of effects) {
      switch (effect.type) {
        case 'media': site.perform(effect.value); break;
        case 'mode': setMode(effect.value); break;
        case 'pageBack': pageBack(); break;
        case 'showControls': showControls(effect.value); break;
        case 'moveFocus': if (watch) watch.handle(effect.value); else window.YTGamepad.navigate?.(effect.value); break;
        case 'nativeControlFocus': window.YTGamepad.navigate?.('down'); break;
        default: routes.execute(effect); break;
      }
    }
  }
  function applyLayout(values) {
    const wasEnabled = preferences.enabled;
    savedPreferences = { ...savedPreferences, ...values };
    preferences = { ...savedPreferences, enabled: savedPreferences.enabled && !suspended };
    window.YTGamepad.configure?.(preferences);
    if (!preferences.enabled) {
      window.YTGamepadMenu?.close();

    }
    send({ type: 'ENABLE', enabled: preferences.enabled, route: routeNow() });
    document.documentElement.classList.toggle('ytg-theater', preferences.enabled && preferences.theater && window.YTGamepadInput?.connected === true);
    setMode(!wasEnabled && preferences.enabled && location.pathname === '/watch' ? 'playback' : appState().mode);
  }
  function interceptAction(action, { current } = {}) {
    if (!preferences.enabled) return false;
    if (appState().navigation || appState().returning) return true;
    if (location.pathname !== '/watch') return false;
    if (!surfaceReady()) return false;
    if (watch?.handle(action)) return true;
    if (appState().mode === 'controls') {
      const result = send({ type: 'NATIVE_CONTROLS_INPUT', action, route: routeNow(), progress: site.isProgress(current) });
      executeEffects(result.effects); return result.disposition !== 'pass';
    }
    const result = send({ type: 'BASE_INPUT', action, route: routeNow() });
    executeEffects(result.effects);
    return result.disposition !== 'pass';
  }

  function shouldShowSelection({ scope }) {
    return !window.YTGamepadMenu?.opened && (scope !== document || (visibleMode() !== 'playback' && !(watch && visibleMode() === 'controls')));
  }
  function handleRegion(action, context) {
    if (appState().navigation || appState().returning) return 'blocked';
    if (location.pathname !== '/watch' || !surfaceReady() || appState().mode !== 'controls') return 'pass';
    if (watch) return watch.handleInput(action);
    return interceptAction(action, context) ? 'handled' : 'pass';
  }
  function handleBase(action, context) {
    if (appState().navigation || appState().returning) return 'blocked';
    if (location.pathname !== '/watch' || !surfaceReady() || appState().mode !== 'playback') return 'pass';
    return interceptAction(action, context) ? 'handled' : 'pass';
  }
  function onSettingsClosed() {
    if (!watch || !preferences.enabled || !surfaceReady() || appState().navigation || appState().returning) return;
    setMode('controls');
    window.YTGamepad.refresh?.();
  }
  function initialize(ports) {
    site = ports.site; watch = ports.watch;
    watch?.connect({ request, observePlayback, hasTemporaryLayer, requestAutoHide,
      get state() { return { mode: visibleMode(), enabled: preferences.enabled, surfaceReady: surfaceReady(), navigating: !!appState().navigation || appState().returning }; },
      dispatchAction: action => window.YTGamepad.act(action),
      readRoute: site.readRoute,
      readWatchFeatures: site.readWatchFeatures,
      readWatchPage: () => readSafely('readWatchPage', site.readWatchPage, () => ({ ...site.readRoute(), title: '', channel: '', description: '', recommendations: [] }), false),
      readPlayback: () => readSafely('readPlayback', site.readPlayback, () => ({ video: null, captionsEnabled: false, settingsOpen: false })),
      readComments: () => readSafely('readComments', site.readComments, () => []), hasNativeLayer: site.hasNativeLayer,
      get navigating() { return !!appState().navigation || appState().returning; } });
    window.YTGamepadMenu?.connect?.({
      interactionChanged: () => window.YTGamepad.refresh?.(),
      readSearch: site.readSearch, getSearchTarget: site.getSearchTarget, syncSearch: site.syncSearch,
      submitSearch: site.submitSearch, perform: action => request('media', action), moveSearchCursor: site.moveSearchCursor, readTheme: site.readTheme,
      dispatchAction: action => window.YTGamepad.act(action)
    });
    window.YTGamepad.registerSite(site.createNavigationConfig({
      shouldShowSelection, interceptAction, handleRegion, handleBase,
      onScopeChange: () => observePlayback(site.readPlayback()),
      isNavigating: () => !!appState().navigation || appState().returning,
      getInputLayer: () => watch?.state.panel || null,
      handleLayer: action => watch?.handleInput(action) || 'blocked',
      getPriorityLayer, handleShortcut,
      isFocusOwned: () => !!(window.YTGamepadMenu?.opened || watch?.ownsFocus),
      getFocusOwner: () => watch?.ownsFocus ? 'watch' : 'core',
      onDisable: () => window.YTGamepadMenu?.close(),
      ownsKeyboardEvent: event => ['yt-gamepad-menu', 'ytg-watch'].includes(event.target?.id),
      openSearch: target => window.YTGamepadMenu?.openSearch(target),
      prepareVideo, onSettingsClosed, pageBack, get navigating() { return !!appState().navigation || appState().returning; }, get mode() { return visibleMode(); }
    }));
    lifecycle.cleanup(site.observePage(() => {
      checkAdaptation();
      if (surfaceReady()) { try { watch?.refresh(); } catch (error) { diagnose('refresh', error, 'watch'); failAdaptation(); } }
    }));
    if (typeof setInterval === 'function') lifecycle.interval(checkAdaptation, 500);
    lifecycle.listen(window, 'yt-gamepad-connection', () => applyLayout({}));
    lifecycle.listen(window, 'yt-gamepad-exit', () => { suspended = true; applyLayout({}); });
    lifecycle.listen(window, 'yt-gamepad-resume', () => { suspended = false; applyLayout({}); });
    lifecycle.listen(window, 'yt-gamepad-local-settings', e => applyLayout(e.detail));
    routes.start();
    lifecycle.listen(window, 'message', e => {
      // Same-window settings messages can be forged by the site. These values
      // affect page UI only; they must never authorize extension operations.
      if (e.source !== window || e.origin !== location.origin || e.data?.source !== 'yt-gamepad-settings') return;
      const raw = e.data.values;
      if (!raw || typeof raw !== 'object') return;
      const values = {
        enabled: raw.enabled !== false,
        theater: raw.theater !== false,
        deadzone: Number.isFinite(raw.deadzone) ? Math.min(.75, Math.max(.15, raw.deadzone)) : .35,
        repeatDelay: Number.isFinite(raw.repeatDelay) ? Math.min(1000, Math.max(150, raw.repeatDelay)) : 350,
        repeatInterval: Number.isFinite(raw.repeatInterval) ? Math.min(500, Math.max(80, raw.repeatInterval)) : 140
      };
      window.YTGamepadInput.configure(values);
      applyLayout(values);
    });
    applyLayout({});
    window.postMessage({ source: 'yt-gamepad-ready' }, location.origin);
  }
  window.YTGamepadCoordinator = { request, setMode, prepareVideo, checkAdaptation, retryAdaptation,
    get adaptation() { return adaptation(); },
    get interactionState() { return interaction.state; },
    get state() { return { mode: visibleMode(), enabled: preferences.enabled, surfaceReady: surfaceReady(), navigating: !!appState().navigation || appState().returning }; },
    get mode() { return visibleMode(); }, get navigating() { return !!appState().navigation || appState().returning; } };
  initialize({ site: window.YTGamepadSite, watch: window.YTGamepadWatch });
  const published = window.YTGamepadCoordinator;
  published.destroy = lifecycle.destroy;
  lifecycle.cleanup(() => { if (window.YTGamepadCoordinator === published) delete window.YTGamepadCoordinator; });
  lifecycle.cleanup(() => {
    preferences = { ...preferences, enabled: false };
    send({ type: 'ENABLE', enabled: false, route: routeNow() }); routes.destroy(); restoreNative();
    notice?.host.remove?.();
    document.documentElement.classList.remove('ytg-playback', 'ytg-controls', 'ytg-theater', 'ytg-settings-open');
    delete document.documentElement.dataset.ytgAdaptation;
  });
  lifecycle.listen(window, 'pagehide', event => { if (!event.persisted) window.YTGamepadRuntime.destroy(); });
})();
