// Application policy: mode transitions, route history and module coordination.
(() => {
  // The composition root is the only place that resolves module globals.
  const runtime = window.YTGamepadRuntime;
  const interaction = window.YTGamepadInteraction;
  const focusManager = window.YTGamepadFocus;
  const controllerStyle = window.YTGamepadControllerStyle;
  const diagnostics = window.YTGamepadDiagnostics;
  const shared = { runtime, interaction, focusManager, controllerStyle };
  const core = window.YTGamepad || window.YTGamepadCoreModule.create({ ...shared, navigation: window.YTGamepadNavigation });
  const siteInstance = window.YTGamepadSite || window.YTGamepadSiteModule.create({ ...shared, diagnostics });
  const styles = window.YTGamepadStyles;
  const searchFactory = window.YTGamepadSearch;
  const viewFactory = window.YTGamepadWatchView;
  const panelsFactory = window.YTGamepadWatchPanels;
  const pinyin = window.YTGamepadPinyin, keyboard = window.YTGamepadKeyboard;
  const menu = window.YTGamepadMenu || window.YTGamepadMenuModule?.create({ ...shared, styles,
    createSearch: port => searchFactory.create(Object.assign(port, { controllerStyle, pinyin, keyboard })) });
  const watchInstance = window.YTGamepadWatch || window.YTGamepadWatchModule?.create({ ...shared,
    createView: port => viewFactory.create({ ...port, styles }),
    createPanels: port => panelsFactory.create(port) });
  const input = window.YTGamepadInput || window.YTGamepadInputModule?.create({ ...shared,
    isSearchOpen: () => !!(menu?.opened && menu.state.view === 'search') });
  window.YTGamepadBrowseModule?.create({ runtime, core, isMenuOpen: () => !!menu?.opened });
  const routeFactory = window.YTGamepadRouteController;
  const lifecycle = runtime.scope('coordinator');
  let site, watch;
  const appState = () => interaction.state.app;
  const send = event => interaction.dispatch(event);
  send({ type: 'APP_INIT', route: location.pathname + location.search });
  let savedPreferences = { enabled: true, theater: true }, suspended = false;
  // Connection is a mandatory gate, independent of the saved enable switch.
  let preferences = { ...savedPreferences, enabled: false };
  const routeNow = () => location.pathname + location.search;
  let adaptationSince = 0, rendering = false, checking = false, notice, loading;
  const adaptation = () => appState().adaptation || { status: 'inactive', reason: '' };
  const surfaceReady = () => adaptation().status === 'ready' && adaptation().route === routeNow();
  const visibleMode = () => location.pathname === '/watch' && surfaceReady() ? appState().mode : 'browse';
  function syncLoading() {
    const app = appState();
    const destinationReady = surfaceReady() && app.navigation?.target === routeNow();
    const active = preferences.enabled && (app.openingVideo && !!app.navigation && !destinationReady ||
      location.pathname === '/watch' && (adaptation().status === 'waiting' || app.returning));
    // Player layout does not depend on metadata, decoded frames or SPA finish.
    document.documentElement.classList.toggle('ytg-player-pending', active && location.pathname === '/watch' &&
      !app.returning && adaptation().status !== 'fallback');
    if (active && !loading && typeof document.createElement === 'function') {
      loading = document.createElement('div'); loading.id = 'ytg-watch-loading';
      loading.setAttribute('lang', 'en');
      loading.setAttribute('role', 'status'); loading.setAttribute('aria-live', 'polite');
      document.documentElement.append(loading);
    }
    if (loading) {
      const message = app.returning ? 'Going back…' : 'Loading video…';
      if (loading.textContent !== message) loading.textContent = message;
      if (loading.hidden !== !active) loading.hidden = !active;
    }
  }
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
      host.setAttribute('lang', 'en');
      const root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = ':host{position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:min(460px,90vw);font:14px/1.5 system-ui;color:#fff;background:#202020;padding:14px 18px;border-radius:12px;box-shadow:0 4px 20px #0006}:host([hidden]){display:none}button{margin-left:12px;padding:6px 12px;font:inherit;cursor:pointer}';
      const message = document.createElement('span'); message.setAttribute('role', 'status');
      const retry = document.createElement('button'); retry.textContent = 'Try again';
      retry.addEventListener('click', retryAdaptation);
      root.append(style, message, retry); document.documentElement.append(host);
      notice = { host, message };
    }
    notice.message.textContent = 'YouTube interface restored: ' + adaptation().reason;
    notice.host.hidden = false;
  }
  function diagnose(operation, error, module = 'coordinator') {
    try {
      diagnostics?.record(module, operation, error, {
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
    if (loading) loading.hidden = true;
    try { menu?.close(); } catch (error) { diagnose('restore.closeMenu', error, 'menu'); }
    try { watch?.sync('browse', preferences); } catch (error) { diagnose('restore.syncWatch', error, 'watch'); }
    try { site.restoreNativeInterface(); } catch (error) { diagnose('restore.nativeInterface', error, 'site'); }
  }
  function failAdaptation(reason = 'Video interface unavailable') {
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
      // Custom controls wait for destination identity and decoded picture.
      // The native player remains visible throughout that wait.
      const opening = preferences.enabled && appState().openingVideo && !!appState().navigation;
      if (opening && (location.pathname !== '/watch' || appState().navigation.target !== routeNow())) return;
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
      const wasReady = surfaceReady(), health = site.inspectWatchCapabilities(opening);
      if (health.ready) {
        if (!wasReady) { setAdaptation('ready'); renderMode(); }
      } else if (health.failed || wasReady || Date.now() - adaptationSince >= 5000) {
        const reason = health.failed ? 'Player interface unavailable' : 'Missing: ' + health.missing.join(', ');
        diagnose('inspectWatchCapabilities', new Error(reason), 'site');
        failAdaptation(reason);
      } else {
        // Leave native playback visible while custom controls are unavailable.
        try { site.restoreNativeInterface(); } catch (error) { diagnose('restore.nativeInterface', error, 'site'); }
      }
    } catch (error) { diagnose('checkAdaptation', error, 'site'); failAdaptation(); }
    finally {
      checking = false;
      syncLoading();
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
  function readSafely(operation, read, empty, essential = true) {
    try { return read(); }
    catch (error) { diagnose(operation, error, 'site'); if (essential) failAdaptation(); return empty(); }
  }
  function hasTemporaryLayer() {
    return !!(core.hasTemporaryLayer || focusManager?.suspended || menu?.opened || watch?.state.panel || site.hasNativeLayer?.());
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
    if (opened) core.refresh?.();
    return opened;
  }
  function backSettings() {
    if (!site.settingsOpen()) return false;
    site.backSettings();
    core.refresh?.();
    return true;
  }
  // Every view command shares the same enablement and navigation policy.
  // Views read this state; their render notifications cannot write it back.
  function performMedia(action) {
    const route = routeNow();
    const failed = error => {
      diagnose('media.' + action, error, 'site');
      if (!lifecycle.destroyed && preferences.enabled && routeNow() === route) {
        failAdaptation(action === 'playPause' ? 'Playback failed. Click Play in the YouTube player to try again.' : 'Playback action failed');
      }
      return false;
    };
    try {
      const result = site.perform(action);
      const completed = ok => {
        if (ok && !lifecycle.destroyed && preferences.enabled && routeNow() === route) watch?.mediaFeedback?.(action);
        return ok;
      };
      return result && typeof result.then === 'function' ? Promise.resolve(result).then(completed).catch(failed) : completed(result);
    } catch (error) { return failed(error); }
  }
  function request(type, value) {
    if (lifecycle.destroyed) return false;
    if (!preferences.enabled || appState().navigation || appState().returning) return false;
    if (type === 'mode' && value !== 'browse' && !surfaceReady()) return false;
    try {
    switch (type) {
      case 'mode': setMode(value); return true;
      case 'media': return performMedia(value);
      case 'watchAction': {
        const result = site.performWatchAction(value);
        core.refresh?.();
        return result;
      }
      case 'seek': return site.seekTo(value);
      case 'settings': return openSettings();
      case 'backSettings': return backSettings();
      case 'channel': return site.openChannel(() => setMode('browse'));
      case 'recommendation': return site.openRecommendation(value, prepareVideo);
      case 'moreRecommendations': return site.loadRecommendations();
      case 'replies': return site.expandReplies(value);
      case 'comments': return site.loadComments(value);
      default: return false;
    }
    } catch (error) { diagnose('request.' + type, error, 'site');
      if (['mode', 'seek'].includes(type) || (type === 'media' && value !== 'captions')) failAdaptation();
      return type === 'recommendation' ? 'missing' : false; }
  }
  function observePlayback(playback) {
    // Media state is a fresh YouTube snapshot, never a second playback model.
    document.documentElement.classList.toggle('ytg-settings-open', preferences.enabled && surfaceReady() && playback.settingsOpen);
  }
  function getPriorityLayer() {
    return menu?.opened ? { handle: action => menu.handle(action) } : null;
  }
  function handleShortcut(action) {
    if (!['search', 'help'].includes(action) || !menu) return 'pass';
    return menu.handle(action);
  }
  const routes = routeFactory.create({ runtime, interaction, routeNow, renderMode, hasTemporaryLayer,
    location, history, window, document, enabled: () => preferences.enabled,
    pause: () => site.perform('pause'), closeMenu: () => menu?.close(),
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
      core.refresh?.();
    } catch (error) { diagnose('renderMode', error, 'watch'); failAdaptation(); }
    finally { rendering = false; }
  }
  function showControls(target = 'controls') {
    if (watch) { watch.show(target); return; }
    if (target === 'recommendations') return;
    setMode('controls');
    core.focus?.(site.showNativeControls());
    core.refresh?.();
  }
  function executeEffects(effects) {
    for (const effect of effects) {
      switch (effect.type) {
        case 'media': request('media', effect.value); break;
        case 'mode': setMode(effect.value); break;
        case 'pageBack': pageBack(); break;
        case 'showControls': showControls(effect.value); break;
        case 'moveFocus': if (watch) watch.handle(effect.value); else core.navigate?.(effect.value); break;
        case 'nativeControlFocus': core.navigate?.('down'); break;
        default: routes.execute(effect); break;
      }
    }
  }
  function applyLayout(values) {
    const wasEnabled = preferences.enabled;
    savedPreferences = { ...savedPreferences, ...values };
    preferences = { ...savedPreferences, enabled: savedPreferences.enabled && input?.connected === true && !suspended };
    core.configure?.(preferences);
    if (!preferences.enabled) {
      menu?.close();

    }
    send({ type: 'ENABLE', enabled: preferences.enabled, route: routeNow() });
    document.documentElement.classList.toggle('ytg-theater', preferences.enabled && preferences.theater && input?.connected === true);
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
    return !menu?.opened && (scope !== document || (visibleMode() !== 'playback' && !(watch && visibleMode() === 'controls')));
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
    core.refresh?.();
  }
  function initialize(ports) {
    site = ports.site; watch = ports.watch;
    watch?.connect({ request, observePlayback, hasTemporaryLayer, requestAutoHide,
      get state() { return { mode: visibleMode(), enabled: preferences.enabled, surfaceReady: surfaceReady(), navigating: !!appState().navigation || appState().returning }; },
      dispatchAction: action => core.act(action),
      readRoute: site.readRoute,
      readWatchFeatures: site.readWatchFeatures,
      readWatchPage: () => readSafely('readWatchPage', site.readWatchPage, () => ({ ...site.readRoute(), title: '', channel: '', description: '', recommendations: [] }), false),
      readPlayback: () => readSafely('readPlayback', site.readPlayback, () => ({ video: null, captionsEnabled: false, settingsOpen: false })),
      readComments: () => readSafely('readComments', site.readComments, () => [], false), hasNativeLayer: site.hasNativeLayer,
      get navigating() { return !!appState().navigation || appState().returning; } });
    menu?.connect?.({
      interactionChanged: () => core.refresh?.(),
      readSearch: site.readSearch, getSearchTarget: site.getSearchTarget, syncSearch: site.syncSearch,
      submitSearch: site.submitSearch, perform: action => request('media', action), moveSearchCursor: site.moveSearchCursor, readTheme: site.readTheme,
      dispatchAction: action => core.act(action)
    });
    core.registerSite(site.createNavigationConfig({
      shouldShowSelection, interceptAction, handleRegion, handleBase,
      onScopeChange: () => observePlayback(site.readPlayback()),
      isNavigating: () => !!appState().navigation || appState().returning,
      getInputLayer: () => watch?.state.panel || null,
      handleLayer: action => watch?.handleInput(action) || 'blocked',
      getPriorityLayer, handleShortcut,
      isFocusOwned: () => !!(menu?.opened || watch?.ownsFocus),
      getFocusOwner: () => watch?.ownsFocus ? 'watch' : 'core',
      onDisable: () => menu?.close(),
      ownsKeyboardEvent: event => ['yt-gamepad-menu', 'ytg-watch'].includes(event.target?.id),
      openSearch: target => menu?.openSearch(target),
      perform: action => request('media', action),
      prepareVideo, onSettingsClosed, pageBack, get navigating() { return !!appState().navigation || appState().returning; }, get mode() { return visibleMode(); }
    }));
    lifecycle.cleanup(site.observePage(() => {
      checkAdaptation();
      if (surfaceReady()) { try { watch?.refresh(); } catch (error) { diagnose('refresh', error, 'watch'); failAdaptation(); } }
    }));
    if (typeof setInterval === 'function') lifecycle.interval(checkAdaptation, 500);
    for (const type of ['loadeddata', 'canplay', 'playing']) {
      lifecycle.listen(document, type, event => {
        if (event.target?.tagName === 'VIDEO') checkAdaptation();
      }, true);
    }
    lifecycle.listen(window, 'yt-gamepad-connection', () => {
      if (input?.connected === true) suspended = false;
      applyLayout({});
    });
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
        bindings: window.YTGamepadBindings.normalize(raw.bindings),
        bindingLayouts: window.YTGamepadBindings.normalizeLayouts(raw.bindingLayouts, raw.bindings),
        repeatInterval: Number.isFinite(raw.repeatInterval) ? Math.min(500, Math.max(80, raw.repeatInterval)) : 140
      };
      input.configure(values);
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
  initialize({ site: siteInstance, watch: watchInstance });
  const published = window.YTGamepadCoordinator;
  published.destroy = lifecycle.destroy;
  lifecycle.cleanup(() => { if (window.YTGamepadCoordinator === published) delete window.YTGamepadCoordinator; });
  lifecycle.cleanup(() => {
    preferences = { ...preferences, enabled: false };
    send({ type: 'ENABLE', enabled: false, route: routeNow() }); routes.destroy(); restoreNative();
    notice?.host.remove?.();
    loading?.remove?.();
    document.documentElement.classList.remove('ytg-playback', 'ytg-controls', 'ytg-theater', 'ytg-settings-open', 'ytg-player-pending');
    delete document.documentElement.dataset.ytgAdaptation;
  });
  lifecycle.listen(window, 'pagehide', event => { if (!event.persisted) runtime.destroy(); });
})();
