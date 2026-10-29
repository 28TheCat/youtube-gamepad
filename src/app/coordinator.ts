import { createWatchTransition } from '../ui/watch-transition';
import type { Action, ActionContext, AdaptationSnapshot, CoordinatorModule, Direction, Effect, InteractionEvent, Mode, OperationResult, PlaybackSnapshot, RecommendationResult, SitePort, WatchAction, WatchModule } from '../../types/ports';

import { YTGamepadRuntime } from '../shared/runtime.ts';
import { YTGamepadFocus } from '../navigation/focus.ts';
import { YTGamepadControllerStyle } from '../input/controller-style.ts';
import { YTGamepadDiagnostics } from '../diagnostics/diagnostics.ts';
import { YTGamepad, YTGamepadCoreModule } from '../navigation/core.ts';
import { YTGamepadNavigation } from '../navigation/navigation.ts';
import { YTGamepadSite, YTGamepadSiteModule } from '../sites/youtube.ts';
import { YTGamepadStyles } from '../ui/styles.ts';
import { YTGamepadSearch } from '../search/search.ts';
import { YTGamepadWatchPanels } from '../ui/watch-panels.ts';
import { createWatchSurface } from '../ui/watch-surface';
import { YTGamepadPinyin } from '../search/pinyin.ts';
import { YTGamepadKeyboard } from '../search/keyboard.ts';
import { YTGamepadMenu, YTGamepadMenuModule } from '../ui/menu.ts';
import { YTGamepadWatch, YTGamepadWatchModule } from '../playback/watch.ts';
import { YTGamepadInput, YTGamepadInputModule } from '../input/gamepad.ts';
import { YTGamepadBrowseModule } from './browse.ts';
import { YTGamepadRouteController } from './route-controller.ts';
import { YTGamepadBindings } from '../input/bindings.ts';
import { YTGamepadSeeking } from '../playback/seek';
import { YTGamepadShortsModule } from '../playback/shorts';
import { isShortsPlaybackRoute } from '../shared/shorts-route';
import { currentLanguage, t } from '../shared/i18n';
import { normalizePlaybackLayout } from '../shared/playback-layout';
import { playbackParameterDefaults, normalizePlaybackParameters, type PlaybackParameters } from '../shared/playback-settings';

export let YTGamepadCoordinator: CoordinatorModule | undefined;
// Application policy: mode transitions, route history and module coordination.
/** @param {{ interaction: import('../../types/ports.js').InteractionStore, mountQuickMenu?: import('../../types/ports.js').MenuDependencies['mountQuickMenu'] }} dependencies */
export function startCoordinator({ interaction, mountQuickMenu, createWatchView, mountBrowseOverlay, mountBrowseGrid, pageAccess, localChannel, remoteHistory }: { pageAccess?: import("../bridge/page-protocol").PageAccess, localChannel?: import("../../types/ports").ApplicationChannel, remoteHistory?: boolean, interaction: import('../../types/ports.js').InteractionStore, mountQuickMenu?: import('../../types/ports.js').MenuDependencies['mountQuickMenu'], createWatchView: (port: import('../../types/ports').WatchViewDependencies) => import('../../types/ports').WatchView, mountBrowseOverlay?: import('../../types/ports').CoreDependencies['mountOverlay'], mountBrowseGrid?: import('../../types/ports').BrowseDependencies['mountGrid'] }) {
  // The composition root assembles imported factories and their dependencies.
  const runtime = YTGamepadRuntime;
  const focusManager = YTGamepadFocus;
  const controllerStyle = YTGamepadControllerStyle!;
  const diagnostics = YTGamepadDiagnostics;
  const shared = { runtime, interaction, focusManager, controllerStyle };
  const core = YTGamepad || YTGamepadCoreModule.create({ ...shared, navigation: YTGamepadNavigation, mountOverlay: mountBrowseOverlay });
  const siteInstance = YTGamepadSite || YTGamepadSiteModule.create({ ...shared, diagnostics, pageAccess });
  const styles = YTGamepadStyles;
  const searchFactory = YTGamepadSearch;
  const panelsFactory = YTGamepadWatchPanels;
  const pinyin = YTGamepadPinyin, keyboard = YTGamepadKeyboard;
  const menu = YTGamepadMenu || YTGamepadMenuModule?.create({ ...shared, styles, mountQuickMenu, localChannel,
    createSearch: port => searchFactory.create(Object.assign(port, { controllerStyle, pinyin, keyboard })) });
  const watchInstance = YTGamepadWatch || YTGamepadWatchModule?.create({ ...shared,
    createSurface: (callbacks, lifecycle) => createWatchSurface({ ...shared,
      createView: port => createWatchView({ ...port, styles }),
      createPanels: port => panelsFactory.create(port)
    }, callbacks, lifecycle) });
  const input = YTGamepadInput || YTGamepadInputModule?.create({ ...shared, localChannel,
    canHandleInput: () => preferences.enabled && adaptation().status !== 'fallback',
    canRepeatMedia,
    temporarySpeed,
    scroll: scrollStick,
    isSearchOpen: () => !!(menu?.opened && menu.state.view === 'search') });
  YTGamepadBrowseModule?.create({ runtime, core, isMenuOpen: () => !!menu?.opened, mountGrid: mountBrowseGrid,
    prepareVideo: href => appState().navigation?.target === href || prepareVideo(href) });
  const routeFactory = YTGamepadRouteController;
  const lifecycle = runtime.scope('coordinator');
  const transition = createWatchTransition(() => pageAccess?.readPlayerVideoId?.(), () => { failAdaptation('Video frames unavailable'); syncLoading(); }, () => renderMode());
  lifecycle.cleanup(transition.destroy);
  let site: SitePort, watch: WatchModule | undefined;
  let heldSeek: { route: string; action: Action; origin: number; target: number; distance: number } | null = null;
  const appState = () => interaction.state.app;
  const send = (event: InteractionEvent) => interaction.dispatch(event);
  send({ type: 'APP_INIT', route: location.pathname + location.search });
  let savedPreferences = { ...playbackParameterDefaults, enabled: true, theater: true, playbackLayout: 'fullscreen' as 'fullscreen' | 'windowed' }, suspended = false;
  // All devices share the saved enable switch; connection only controls gamepad polling.
  let preferences = { ...savedPreferences, enabled: false };
  let playbackInputMode = input?.mode || 'mouse';
  // Detail-page expansion belongs to this watch route, not saved preferences
  // or the browser's fullscreen session.
  let expandedWatchRoute: string | null = null;
  const watchExpanded = () => expandedWatchRoute !== null && expandedWatchRoute === routeNow();
  const fullscreenLayout = () => watchExpanded() || document.fullscreenElement === document.documentElement || preferences.playbackLayout === 'fullscreen' && playbackInputMode === 'gamepad';
  const routeNow = () => location.pathname + location.search;
  let adaptationSince = 0, rendering = false, checking = false, notice: {host:HTMLElement;message:HTMLElement;retry:HTMLButtonElement} | undefined;
  let healthPolling: import('../../types/ports').Scope | undefined;
  function syncHealthPolling() {
    if (preferences.enabled && (location.pathname === '/watch' || appState().openingVideo && !!appState().navigation) && !document.hidden) {
      if (!healthPolling && typeof setInterval === 'function') {
        healthPolling = runtime.scope('watch-health');
        healthPolling.interval(() => scheduleWatchRefresh(false, true, true), 500);
      }
    } else { healthPolling?.destroy(); healthPolling = undefined; }
  }
  lifecycle.cleanup(() => { healthPolling?.destroy(); healthPolling = undefined; });
  const adaptation = (): AdaptationSnapshot => appState().adaptation || { status: 'inactive', reason: '' };
  const nativePageStyle = () => document.documentElement.getAttribute('data-ytg-browse-mode') === 'youtube';
  const surfaceReady = () => !transition.waiting && !nativePageStyle() && adaptation().status === 'ready' && adaptation().route === routeNow();
  const shellVisible = () => preferences.enabled && !nativePageStyle() && !isShortsPlaybackRoute() &&
    location.pathname === '/watch' && !appState().returning && adaptation().status !== 'fallback';
  const visibleMode = () => !isShortsPlaybackRoute() && location.pathname === '/watch' && surfaceReady() ? appState().mode : 'browse';
  function syncLoading() {
    if (!preferences.enabled || location.pathname !== '/watch' || expandedWatchRoute !== routeNow()) expandedWatchRoute = null;
    if (watchExpanded()) document.documentElement.dataset.ytgWatchExpanded = 'true';
    else delete document.documentElement.dataset.ytgWatchExpanded;
    const app = appState();
    const pageLayout = !nativePageStyle() && !isShortsPlaybackRoute();
    if (preferences.enabled && pageLayout) document.documentElement.dataset.ytgPlaybackLayout = fullscreenLayout() ? 'fullscreen' : 'windowed';
    else delete document.documentElement.dataset.ytgPlaybackLayout;
    document.documentElement.classList.toggle('ytg-watch-layout', preferences.enabled && pageLayout && location.pathname === '/watch');
    const destinationReady = surfaceReady() && app.navigation?.target === routeNow();
    // YouTube can expose the destination player before updating the watch URL.
    // Position that first frame without changing the still-visible browse page.
    document.documentElement.classList.toggle('ytg-player-primed', preferences.enabled && pageLayout &&
      app.openingVideo && !!app.navigation && !destinationReady && !app.returning && adaptation().status !== 'fallback');
    transition.sync(preferences.enabled && pageLayout && location.pathname === '/watch',
      app.openingVideo && app.navigation?.target || routeNow(),
      !!(app.openingVideo && app.navigation) || adaptation().status === 'waiting',
      adaptation().status === 'fallback' || !!app.returning);
  }
  function setAdaptation(status: AdaptationSnapshot['status'], reason = '') {
    send({ type: 'ADAPTATION', route: routeNow(), status, reason });
    document.documentElement.dataset.ytgAdaptation = status;
    if (status === 'fallback') document.documentElement.dataset.ytgNative = 'true';
    else delete document.documentElement.dataset.ytgNative;
  }
  function showFallbackNotice() {
    if (typeof document.createElement !== 'function') return;
    if (!notice) {
      const host = document.createElement('div'); host.id = 'ytg-fallback-notice';
      host.setAttribute('lang', currentLanguage());
      const root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = ':host{position:fixed;inset:56px 0 0;z-index:2147483646;font:18px/1.6 var(--ytg-font-family,Roboto,Arial,sans-serif);color:var(--ytg-text,#171717);background:var(--ytg-client-background,#fff);padding:48px;box-sizing:border-box;overflow:auto}:host([hidden]){display:none}[role=status]{display:block;max-width:800px;margin-bottom:24px}button{display:inline-block;margin:0 16px 16px 0;padding:12px 20px;border:1px solid var(--ytg-border,#ddd);border-radius:12px;background:var(--ytg-client-surface,#f2f2f2);color:inherit;font:inherit;cursor:pointer}button:is(:focus-visible,.ytg-selected){outline:3px solid #f5b942;outline-offset:3px}';
      const message = document.createElement('span'); message.setAttribute('role', 'status');
      const retry = document.createElement('button'); retry.textContent = t('Try again');
      retry.addEventListener('click', retryAdaptation);
      const back = document.createElement('button'); back.textContent = t('Back');
      back.addEventListener('click', () => history.back());
      const original = document.createElement('button'); original.textContent = 'YouTube';
      original.setAttribute('data-ytg-exit-shell', '');
      root.append(style, message, retry, back, original); document.documentElement.append(host);
      notice = { host, message, retry };
    }
    const reason = adaptation().reason;
    const details = reason.startsWith('Missing:')
      ? t('Missing: {capabilities}', { capabilities: reason.slice('Missing:'.length).trim().split(', ').map(value => t(value)).join(', ') })
      : t(reason);
    notice.host.setAttribute('lang', currentLanguage());
    notice.message.textContent = t('Player adaptation failed. Try again or choose the YouTube interface. Reason: {reason}', { reason: details });
    notice.retry.textContent = t('Try again');
    notice.host.hidden = false;
  }
  lifecycle.listen(document, 'ytg-language-changed', () => {
    if (notice && !notice.host.hidden) showFallbackNotice();
  });
  function diagnose(operation: string, error: unknown, module = 'coordinator') {
    try {
      diagnostics?.record(module, operation, error, {
        route: location.pathname === '/watch' ? 'watch' : 'browse', mode: appState().mode,
        adaptation: adaptation().status, enabled: preferences.enabled,
        surfaceReady: surfaceReady(), navigating: !!appState().navigation || !!appState().returning
      });
    } catch (_) {}
  }
  function restoreNative() {
    cancelHeldSeek();
    // Establish the CSS safety gate before attempting any potentially faulty view work.
    document.documentElement.dataset.ytgNative = 'true';
    document.documentElement.dataset.ytgMode = 'browse';
    try { menu?.close(); } catch (error) { diagnose('restore.closeMenu', error, 'menu'); }
    try { watch?.sync('browse', preferences); } catch (error) { diagnose('restore.syncWatch', error, 'watch'); }
    try { site.restoreNativeInterface(); } catch (error) { diagnose('restore.nativeInterface', error, 'site'); }
  }
  function failAdaptation(reason = 'Video interface unavailable') {
    if (!preferences.enabled || nativePageStyle() || isShortsPlaybackRoute() || location.pathname !== '/watch') {
      setAdaptation('inactive'); restoreNative();
      if (notice) notice.host.hidden = true;
      return;
    }
    setAdaptation('fallback', reason);
    try { document.querySelector<HTMLVideoElement>('video')?.pause?.(); } catch (error) { diagnose('fallback.pause', error, 'site'); }
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
      if (!nativePageStyle() && opening && (location.pathname !== '/watch' || appState().navigation?.target !== routeNow())) return;
      if (!preferences.enabled || nativePageStyle() || isShortsPlaybackRoute() || location.pathname !== '/watch') {
        setAdaptation('inactive');
        if (notice) notice.host.hidden = true;
        return;
      }
      if (adaptation().route !== routeNow() || adaptation().status === 'inactive') {
        adaptationSince = Date.now(); setAdaptation('waiting');
        if (notice) notice.host.hidden = true;
      }
      // Recover late capabilities when they become ready. Actual player or
      // render failures still require retry; the MAIN handshake is checked live.
      if (adaptation().status === 'fallback') {
        const missingCapabilities = adaptation().reason.startsWith('Missing:');
        if (!missingCapabilities && (!adaptation().reason.includes('page interface') || !pageAccess?.ping?.())) return;
        if (missingCapabilities && !site.inspectWatchCapabilities(opening).ready) return;
        adaptationSince = Date.now(); setAdaptation('waiting');
        if (notice) notice.host.hidden = true;
      }
      site.inspectOptionalCapabilities?.();
      const wasReady = adaptation().status === 'ready' && adaptation().route === routeNow(), health = site.inspectWatchCapabilities(opening);
      if (health.ready) {
        if (adaptation().status !== 'ready' || adaptation().route !== routeNow()) { setAdaptation('ready'); renderMode(); }
      } else if (wasReady) {
        adaptationSince = Date.now(); setAdaptation('waiting');
        renderMode();
      } else if (Date.now() - adaptationSince >= (health.missing.length > 0 && health.missing.every(item => item === 'current video' || item === 'video frames') ? 20000 : 5000)) {
        const reason = health.failed ? 'Player interface unavailable' : 'Missing: ' + health.missing.join(', ');
        diagnose('inspectWatchCapabilities', new Error(reason), 'site');
        failAdaptation(reason);
      } else {
        // Keep the current shell while YouTube replaces or prepares its media.
      }
    } catch (error) { diagnose('checkAdaptation', error, 'site'); failAdaptation(); }
    finally {
      checking = false;
      syncHealthPolling();
      if (heldSeek && (!canRepeatMedia() || heldSeek.route !== routeNow())) cancelHeldSeek();
      syncLoading();
    }
  }
  function retryAdaptation() {
    if (!preferences.enabled || location.pathname !== '/watch') return;
    adaptationSince = Date.now(); setAdaptation('waiting');
    if (notice) notice.host.hidden = true;
    checkAdaptation(); renderMode();
  }
  let refreshPending = false, refreshPage = false, refreshPlayback = false, refreshIdle = false, refreshRoute = '';
  function scheduleWatchRefresh(page = true, playback = !page, idle = false) {
    if (lifecycle.destroyed || document.hidden || !preferences.enabled ||
      (location.pathname !== '/watch' && !(appState().openingVideo && appState().navigation)) || isShortsPlaybackRoute()) return;
    const route = routeNow();
    if (refreshRoute !== route) { refreshPage = false; refreshPlayback = false; refreshIdle = false; }
    refreshRoute = route; refreshPage ||= page; refreshPlayback ||= playback; refreshIdle ||= idle;
    if (refreshPending) return;
    refreshPending = true;
    lifecycle.frame(() => {
      const updatePage = refreshPage, updatePlayback = refreshPlayback, updateIdle = refreshIdle, expectedRoute = refreshRoute;
      refreshPending = false; refreshPage = false; refreshPlayback = false; refreshIdle = false;
      if (document.hidden || !preferences.enabled || expectedRoute !== routeNow()) return;
      const wasReady = surfaceReady();
      checkAdaptation();
      // Becoming ready already calls renderMode -> watch.sync -> readPage.
      if ((updatePage || updatePlayback) && (shellVisible() && !surfaceReady() || wasReady && surfaceReady())) {
        try {
          if ((updatePage && !watch?.refreshPage) || (updatePlayback && !watch?.refreshPlayback)) watch?.refresh();
          else { if (updatePage) watch?.refreshPage?.(); if (updatePlayback) watch?.refreshPlayback?.(); }
        }
        catch (error) { diagnose('refresh', error, 'watch'); failAdaptation(); }
      }
      if (updateIdle && surfaceReady()) watch?.checkIdle?.();
    });
  }
  function readSafely<T>(operation: string, read: () => T, empty: () => T, essential = true): T {
    try { return read(); }
    catch (error) { diagnose(operation, error, 'site'); if (essential) failAdaptation(); return empty(); }
  }
  function hasTemporaryLayer() {
    return !!(core.hasTemporaryLayer || focusManager?.suspended || menu?.opened || watch?.state.panel || site.hasNativeLayer?.());
  }
  let speedHint: HTMLElement | undefined;
  function temporarySpeed(held: boolean) {
    let rate: number | false = false;
    try {
      const allowed = held && !lifecycle.destroyed && preferences.enabled && surfaceReady() &&
        location.pathname === '/watch' && visibleMode() === 'playback' && !appState().navigation && !appState().returning && !hasTemporaryLayer();
      rate = siteInstance.temporarySpeed?.(allowed) ?? false;
    } catch (error) {
      siteInstance.temporarySpeed?.(false);
      diagnose('temporarySpeed', error);
    }
    if (rate && !speedHint && typeof document.createElement === 'function') {
      speedHint = document.createElement('div'); speedHint.id = 'ytg-temporary-speed';
      speedHint.setAttribute('role', 'status'); speedHint.setAttribute('aria-live', 'polite');
      document.documentElement.append(speedHint);
    }
    if (speedHint) {
      if (speedHint.hidden !== !rate) speedHint.hidden = !rate;
      if (rate) {
        const label = t('Temporary speed · {rate}×', { rate });
        if (speedHint.textContent !== label) speedHint.textContent = label;
      }
    }
    return !!rate;
  }
  lifecycle.cleanup(() => { siteInstance.temporarySpeed?.(false); speedHint?.remove(); });
  function requestAutoHide(idle: number) {
    if (!surfaceReady() || heldSeek || !fullscreenLayout()) return;
    try {
    const video = site.readPlayback().video;
    const result = send({ type: 'AUTO_HIDE', idle, playing: !!video && !video.paused && !video.ended,
      temporaryLayer: hasTemporaryLayer() });
    if (result.effects.length) renderMode();
    } catch (error) { diagnose('requestAutoHide', error, 'site'); }
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
  function hasBlockingMediaLayer() {
    return !!(core.hasTemporaryLayer || menu?.opened || site.hasNativeLayer?.() ||
      focusManager?.suspended && !watch?.state.panel);
  }
  function canRepeatMedia() {
    return !lifecycle.destroyed && preferences.enabled && (isShortsPlaybackRoute() || location.pathname === '/watch' && surfaceReady() && visibleMode() !== 'browse') &&
      !appState().navigation && !appState().returning && !hasBlockingMediaLayer() &&
      !document.hidden && (document.hasFocus?.() ?? true);
  }
  function cancelHeldSeek() {
    if (!heldSeek) return;
    heldSeek = null;
    watch?.seekPreview?.(null);
    input?.cancelSeeking?.();
  }
  function previewHeldSeek(action: Action) {
    const video = site.readPlayback().video;
    if (!canRepeatMedia() || !video || !Number.isFinite(video.currentTime)) { cancelHeldSeek(); return false; }
    if (heldSeek?.route !== routeNow()) cancelHeldSeek();
    const previous = heldSeek;
    const origin = previous?.origin ?? video.currentTime;
    const distance = previous?.action === action ? previous.distance : 0;
    const step = YTGamepadSeeking.step(distance, preferences.seekStep);
    const before = previous?.target ?? origin;
    const target = YTGamepadSeeking.target(video.timeline, before + (action === 'seekBack' ? -step : step));
    if (target === null) { cancelHeldSeek(); return false; }
    heldSeek = { route: routeNow(), action, origin, target, distance: distance + Math.abs(target - before) };
    watch?.seekPreview?.({ target, delta: target - origin, start: video.timeline.start, end: video.timeline.end });
    return true;
  }
  function finishHeldSeek(action: Action, cancelled: boolean) {
    if (!heldSeek || heldSeek.action !== action) return;
    if (cancelled || !canRepeatMedia() || heldSeek.route !== routeNow()) { cancelHeldSeek(); return; }
    const pending = heldSeek;
    heldSeek = null;
    watch?.seekPreview?.(null);
    try {
      const video = site.readPlayback().video;
      const target = video && YTGamepadSeeking.target(video.timeline, pending.target);
      if (target === null || target === undefined) return;
      if (site.seekTo(target)) watch?.mediaFeedback?.(action, target - pending.origin);
    } catch (error) { diagnose('heldSeek.commit', error, 'site'); watch?.feedback?.('Seeking is unavailable'); }
  }
  function performMedia(action: Action) {
    const route = routeNow();
    const seeking = action === 'seekBack' || action === 'seekForward';
    const failed = (error: unknown) => {
      diagnose('media.' + action, error, 'site');
      if (!lifecycle.destroyed && preferences.enabled && routeNow() === route) {
        cancelHeldSeek();
        watch?.feedback?.(action === 'playPause' ? 'Playback was blocked. Press Play or retry.' : 'This action is currently unavailable');
      }
      return false;
    };
    try {
      if (seeking && input?.isHeld?.(action)) return previewHeldSeek(action);
      cancelHeldSeek();
      const before = seeking ? site.readPlayback().video?.currentTime : undefined;
      const result = site.perform(action);
      const completed = (ok: OperationResult) => {
        if (ok && !lifecycle.destroyed && preferences.enabled && routeNow() === route) {
          const after = seeking ? site.readPlayback().video?.currentTime : undefined;
          watch?.mediaFeedback?.(action, before === undefined || after === undefined ? undefined : after - before);
        }
        return ok;
      };
      return result && typeof result === 'object' && typeof result.then === 'function' ? Promise.resolve(result).then(completed).catch(failed) : completed(result as OperationResult);
    } catch (error) { return failed(error); }
  }
  function request(type: 'moreRecommendations', value?: 'queue' | 'recommendations'): OperationResult;
  function request(type: 'recommendationFilter', value: string): OperationResult;
  function request(type: 'mode', value: Mode): OperationResult;
  function request(type: 'media', value: Action): OperationResult | Promise<OperationResult>;
  function request(type: 'watchAction', value: WatchAction): OperationResult | Promise<OperationResult>;
  function request(type: 'playlists'): false | Promise<readonly import('../../types/ports').SavedPlaylistSnapshot[] | undefined>;
  function request(type: 'savePlaylist', value: string): OperationResult | Promise<OperationResult>;
  function request(type: 'seek', value: number): OperationResult;
  function request(type: 'recommendation', value: string): RecommendationResult | false;
  function request(type: 'replies', value: string): OperationResult;
  function request(type: 'translateComment', value: string): OperationResult;
  function request(type: 'comments', value?: boolean): OperationResult;
  function request(type: 'commentPost', value: { text: string; key?: string }): OperationResult | Promise<OperationResult>;
  function request(type: 'commentSort', value: 'TOP_COMMENTS' | 'NEWEST_FIRST'): OperationResult;
  function request(type: 'fullscreen'): OperationResult | Promise<OperationResult>;
  function request(type: 'settings' | 'backSettings' | 'channel'): OperationResult;
  function request(...[type,value]: ['fullscreen'|'settings'|'backSettings'|'channel'|'playlists'] | ['moreRecommendations', ('queue' | 'recommendations')?] | ['mode',Mode] | ['media',Action] | ['watchAction',WatchAction] | ['seek',number] | ['recommendationFilter'|'recommendation'|'replies'|'translateComment'|'savePlaylist',string] | ['comments',boolean?] | ['commentPost', { text: string; key?: string }] | ['commentSort', 'TOP_COMMENTS' | 'NEWEST_FIRST']) {
    if (lifecycle.destroyed) return false;
    if (!preferences.enabled || appState().navigation || appState().returning) return false;
    if (type === 'mode' && value !== 'browse' && !surfaceReady()) return false;
    try {
    switch (type) {
      case 'mode': setMode(value); return true;
      case 'fullscreen':
        if (location.pathname !== '/watch' || !surfaceReady()) return false;
        if (!fullscreenLayout()) {
          expandedWatchRoute = routeNow();
          cancelHeldSeek();
          setMode('playback');
          return true;
        }
        if (watchExpanded()) { collapseWatch(); return true; }
        if (!document.documentElement.requestFullscreen) return false;
        return document.documentElement.requestFullscreen().then(() => true, () => false);
      case 'media': return performMedia(value);
      case 'watchAction': {
        const result = site.performWatchAction(value);
        core.refresh?.();
        return result;
      }
      case 'playlists': return site.listPlaylists();
      case 'savePlaylist': return site.togglePlaylist(value);
      case 'seek': return site.seekTo(value);
      case 'settings': return openSettings();
      case 'backSettings': return backSettings();
      case 'channel': return site.openChannel(() => setMode('browse'));
      case 'recommendation': return site.openRecommendation(value, prepareVideo);
      case 'moreRecommendations': return site.loadRecommendations(value);
      case 'recommendationFilter': return site.selectRecommendationFilter?.(value) || false;
      case 'replies': return site.expandReplies(value);
      case 'translateComment': return site.translateComment(value);
      case 'comments': return site.loadComments(value);
      case 'commentPost': return site.postComment?.(value.text, value.key) || false;
      case 'commentSort': return site.sortComments?.(value) || false;
      default: return false;
    }
    } catch (error) { diagnose('request.' + type, error, 'site');
      if (type === 'mode') failAdaptation();
      else if (type === 'seek') { cancelHeldSeek(); watch?.feedback?.('Seeking is unavailable'); }
      return type === 'recommendation' ? 'missing' as const : false; }
  }
  function observePlayback(playback: PlaybackSnapshot) {
    // Media state is a fresh YouTube snapshot, never a second playback model.
    document.documentElement.classList.toggle('ytg-settings-open', preferences.enabled && surfaceReady() && playback.settingsOpen);
  }
  function getPriorityLayer() {
    return menu?.opened ? { handle: (action: Action) => menu.handle(action) } : null;
  }
  let stickScrollOwner: { scroll?(delta: number): void } | undefined;
  function scrollStick(delta: number) {
    const allowed = delta && preferences.enabled && !suspended && !appState().navigation && !appState().returning && adaptation().status !== 'fallback';
    const owner = !allowed ? undefined : menu?.opened ? menu : core.hasOverlay ? core : watch?.ownsFocus ? watch : core;
    if (stickScrollOwner !== owner) stickScrollOwner?.scroll?.(0);
    stickScrollOwner = owner;
    owner?.scroll?.(delta);
  }
  function handleShortcut(action: Action) {
    if (action === 'help' && shorts?.handle(action)) return 'handled';
    if (!['search', 'help'].includes(action) || !menu) return 'pass';
    return menu.handle(action);
  }
  const routes = routeFactory.create({ runtime, interaction, routeNow, renderMode, hasTemporaryLayer,
    location, history, remoteHistory, window, document, enabled: () => preferences.enabled && !nativePageStyle(),
    pause: () => { void site.perform('pause'); }, closeMenu: () => menu?.close(),
    onStart: cancelHeldSeek
  });
  const prepareVideo = routes.prepareVideo, pageBack = routes.pageBack;
  const shorts = YTGamepadShortsModule?.create({ runtime, controllerStyle, pageAccess, enabled: () => preferences.enabled && !nativePageStyle(),
    playbackSettings: () => preferences,
    canHandle: () => !menu?.opened && !core.hasTemporaryLayer, dispatch: action => core.act(action) });
  function setMode(value: Mode) {
    if (lifecycle.destroyed) return;
    send({ type: 'MODE', value, route: routeNow() }); renderMode();
  }
  function renderMode() {
    if (rendering) return;
    rendering = true;
    try {
      checkAdaptation();
      shorts?.sync();
      const mode = visibleMode();
      document.documentElement.dataset.ytgMode = mode;
      document.documentElement.classList.toggle('ytg-playback', preferences.enabled && mode !== 'browse');
      document.documentElement.classList.toggle('ytg-controls', preferences.enabled && mode === 'controls');
      watch?.sync(mode, preferences);
      core.refresh?.();
    } catch (error) { diagnose('renderMode', error, 'watch'); failAdaptation(); }
    finally { rendering = false; }
  }
  function showControls(target: 'controls' | 'recommendations' = 'controls') {
    if (watch) { watch.show(target); return; }
    if (target === 'recommendations') return;
    setMode('controls');
    core.focus?.(site.showNativeControls());
    core.refresh?.();
  }
  function executeEffects(effects: readonly Effect[]) {
    for (const effect of effects) {
      switch (effect.type) {
        case 'media': request('media', effect.value as Action); break;
        case 'mode': setMode(effect.value as Mode); break;
        case 'pageBack':
          if (document.fullscreenElement) {
            void document.exitFullscreen().catch(error => diagnose('exitFullscreen', error));
          } else pageBack();
          break;
        case 'showControls': showControls(effect.value as 'controls'|'recommendations'); break;
        case 'moveFocus': if (watch) watch.handle(effect.value as Action); else core.navigate?.(effect.value as Direction); break;
        case 'nativeControlFocus': core.navigate?.('down'); break;
        default: routes.execute(effect); break;
      }
    }
  }
  function applyLayout(values: Partial<PlaybackParameters> & { playbackLayout?: 'fullscreen' | 'windowed'; enabled?: boolean; theater?: boolean; deadzone?: number; repeatDelay?: number; bindings?: Record<string,number>; bindingLayouts?: Record<string,Record<string,number>>; repeatInterval?: number; }) {
    const wasEnabled = preferences.enabled;
    const keepSettingsOpen = !wasEnabled && menu?.opened && menu.settingsOpened;
    const parameters = normalizePlaybackParameters({ ...savedPreferences, ...values });
    if (parameters.seekStep !== preferences.seekStep) cancelHeldSeek();
    savedPreferences = { ...savedPreferences, ...values, ...parameters, playbackLayout: normalizePlaybackLayout(values.playbackLayout ?? savedPreferences.playbackLayout) };
    preferences = { ...savedPreferences, enabled: savedPreferences.enabled && !suspended };
    site?.configurePlayback?.(preferences);
    core.configure?.(preferences);
    if (!preferences.enabled && !keepSettingsOpen) {
      menu?.close();
    }
    send({ type: 'ENABLE', enabled: preferences.enabled, route: routeNow() });
    // Mouse settings remain usable without a connected/enabled gamepad.
    if (keepSettingsOpen) send({ type: 'MENU_OPEN' });
    document.documentElement.classList.toggle('ytg-theater', preferences.enabled && preferences.theater);
    setMode(!wasEnabled && preferences.enabled && location.pathname === '/watch' ? 'playback' : appState().mode);
  }
  function collapseWatch() {
    expandedWatchRoute = null;
    cancelHeldSeek();
    setMode('controls');
  }
  function backFromExpandedWatch(action: Action) {
    if (action !== 'back' || !watchExpanded() || watch?.state.adjusting || hasTemporaryLayer()) return false;
    collapseWatch();
    return true;
  }
  function interceptAction(action: Action, { current }: Partial<ActionContext> = {}) {
    if (!preferences.enabled) return false;
    if (appState().navigation || appState().returning) return true;
    if (location.pathname !== '/watch') return false;
    if (!surfaceReady()) return false;
    if (backFromExpandedWatch(action)) return true;
    // In the page layout directions move focus; seeking remains an explicit
    // timeline adjustment or a media shortcut. Fullscreen keeps its own rules.
    if (!fullscreenLayout() && watch && appState().mode === 'playback' && ['up', 'down', 'left', 'right', 'confirm'].includes(action)) {
      showControls();
      return watch.handle(action);
    }
    if (!fullscreenLayout() && watch?.state.row === 'player' && !watch.state.panel && action === 'back' && !hasTemporaryLayer()) {
      pageBack(); return true;
    }
    if (watch?.handle(action)) return true;
    if (appState().mode === 'controls') {
      const result = send({ type: 'NATIVE_CONTROLS_INPUT', action, route: routeNow(), progress: site.isProgress(current ?? null) });
      executeEffects(result.effects); return result.disposition !== 'pass';
    }
    const result = send({ type: 'BASE_INPUT', action, route: routeNow() });
    executeEffects(result.effects);
    return result.disposition !== 'pass';
  }
  function shouldShowSelection({ scope }: ActionContext) {
    if (!preferences.enabled) return false;
    if (scope === document && isShortsPlaybackRoute()) return false;
    if (scope === document && document.documentElement.getAttribute('data-ytg-browse-mode') === 'youtube' &&
      location.pathname !== '/watch' && !isShortsPlaybackRoute()) return false;
    return !menu?.opened && (scope !== document || (visibleMode() !== 'playback' && !(watch && visibleMode() === 'controls')));
  }
  function handleRegion(action: Action, context: Partial<ActionContext> = {}) {
    if (appState().navigation || appState().returning) return 'blocked';
    if (location.pathname !== '/watch' || !surfaceReady() || appState().mode !== 'controls') return 'pass';
    if (backFromExpandedWatch(action)) return 'handled';
    if (watch) return watch.handleInput(action);
    return interceptAction(action, context) ? 'handled' : 'pass';
  }
  function handleBase(action: Action, context: Partial<ActionContext> = {}) {
    if (appState().navigation || appState().returning) return 'blocked';
    if (shorts?.handle(action)) return 'handled';
    if (location.pathname !== '/watch' || !surfaceReady() || appState().mode !== 'playback') return 'pass';
    return interceptAction(action, context) ? 'handled' : 'pass';
  }
  function onSettingsClosed() {
    if (!watch || !preferences.enabled || !surfaceReady() || appState().navigation || appState().returning) return;
    setMode('controls');
    core.refresh?.();
  }
  function initialize(ports: {site:SitePort;watch:WatchModule}) {
    site = ports.site; watch = ports.watch;
    watch?.connect({ request, observePlayback, hasTemporaryLayer, requestAutoHide, requestRefresh: scheduleWatchRefresh,
      get nativePlayer() { return site.nativePlayer; },
      get state() { return { mode: visibleMode(), shellVisible: shellVisible(), enabled: preferences.enabled && !nativePageStyle() && !isShortsPlaybackRoute(), surfaceReady: surfaceReady(), transitioning: preferences.enabled && !nativePageStyle() && !appState().returning &&
        (transition.waiting || adaptation().status === 'waiting' || !!appState().openingVideo), navigating: !!appState().navigation || appState().returning }; },
      dispatchAction: (action: Action) => core.act(action),
      readRoute: site.readRoute,
      readWatchFeatures: site.readWatchFeatures,
      readCommentsStatus: site.readCommentsStatus,
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
      handleLayer: (action: Action) => watch?.handleInput(action) || 'blocked',
      getPriorityLayer, handleShortcut,
      isFocusOwned: () => !!(menu?.opened || watch?.ownsFocus),
      getFocusOwner: () => watch?.ownsFocus ? 'watch' : 'core',
      onDisable: () => { if (!menu?.settingsOpened) menu?.close(); },
      ownsKeyboardEvent: (event: KeyboardEvent) => ['yt-gamepad-menu', 'ytg-watch'].includes((event.target as HTMLElement | null)?.id || ''),
      openSearch: target => menu?.openSearch(target),
      perform: (action: Action) => request('media', action),
      prepareVideo, onSettingsClosed, pageBack, get navigating() { return !!appState().navigation || appState().returning; }, get mode() { return visibleMode(); }
    }));
    lifecycle.cleanup(site.observePage(() => scheduleWatchRefresh()));
    lifecycle.listen(document, 'ended', event => {
      if ((event.target as HTMLElement | null)?.tagName === 'VIDEO' && surfaceReady()) scheduleWatchRefresh(false);
    }, true);
    for (const type of ['loadeddata', 'canplay', 'playing']) {
      lifecycle.listen(document, type, event => {
        if ((event.target as HTMLElement | null)?.tagName === 'VIDEO') scheduleWatchRefresh(false);
      }, true);
    }
    lifecycle.listen(window, 'yt-gamepad-connection', () => {
      if (input?.connected === true) suspended = false;
      applyLayout({});
    });
    lifecycle.listen(window, 'ytg-native-player-fullscreen', () => request('fullscreen'));
    lifecycle.listen(window, 'yt-gamepad-exit', () => { suspended = true; applyLayout({}); });
    lifecycle.listen(window, 'yt-gamepad-resume', () => { suspended = false; applyLayout({}); });
    lifecycle.listen(window, 'yt-gamepad-local-settings', e => applyLayout(e.detail));
    const pageModeObserver = lifecycle.observer(renderMode);
    pageModeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ytg-browse-mode'] });
    routes.start();
    const receiveSettings = (e: MessageEvent) => {
      // Same-window settings messages can be forged by the site. These values
      // affect page UI only; they must never authorize extension operations.
      if (e.source !== window || e.origin !== location.origin || e.data?.source !== 'yt-gamepad-settings') return;
      const raw = e.data.values;
      if (!raw || typeof raw !== 'object') return;
      const values = {
        ...normalizePlaybackParameters(raw),
        enabled: raw.enabled !== false,
        rightHandMode: raw.rightHandMode === true,
        theater: raw.theater !== false,
        playbackLayout: normalizePlaybackLayout(raw.playbackLayout),
        deadzone: Number.isFinite(raw.deadzone) ? Math.min(.75, Math.max(.15, raw.deadzone)) : .35,
        repeatDelay: Number.isFinite(raw.repeatDelay) ? Math.min(1000, Math.max(150, raw.repeatDelay)) : 150,
        bindings: YTGamepadBindings.normalize(raw.bindings),
        bindingLayouts: YTGamepadBindings.normalizeLayouts(raw.bindingLayouts, raw.bindings),
        shortcutLayouts: YTGamepadBindings.normalizeShortcuts(raw.shortcutLayouts),
        repeatInterval: Number.isFinite(raw.repeatInterval) ? Math.min(500, Math.max(80, raw.repeatInterval)) : 80
      };
      input.configure(values);
      applyLayout(values);
    };
    if (localChannel) lifecycle.cleanup(localChannel.subscribe(data => receiveSettings({ source: window, origin: location.origin, data } as unknown as MessageEvent)));
    else lifecycle.listen(window, 'message', receiveSettings);
    applyLayout({});
    if (localChannel) localChannel.publish({ source: 'yt-gamepad-ready' });
    else window.postMessage({ source: 'yt-gamepad-ready' }, location.origin);
  }
  YTGamepadCoordinator = { destroy: lifecycle.destroy, request, setMode, prepareVideo, checkAdaptation, retryAdaptation,
    get adaptation() { return adaptation(); },
    get interactionState() { return interaction.state; },
    get state() { return { mode: visibleMode(), enabled: preferences.enabled, surfaceReady: surfaceReady(), navigating: !!appState().navigation || appState().returning }; },
    get mode() { return visibleMode(); }, get navigating() { return !!appState().navigation || appState().returning; } };
  initialize({ site: siteInstance, watch: watchInstance });
  const published = YTGamepadCoordinator;
  lifecycle.cleanup(() => { if (YTGamepadCoordinator === published) YTGamepadCoordinator = undefined; });
  lifecycle.listen(window, 'yt-gamepad-button-end', event => {
    const { action, cancelled } = (event as CustomEvent<{ action?: string; cancelled?: boolean }>).detail || {};
    if (action === 'seekBack' || action === 'seekForward') finishHeldSeek(action, cancelled !== false);
  });
  lifecycle.listen(window, 'yt-gamepad-action', event => {
    const { action } = (event as CustomEvent<{ action?: string }>).detail || {};
    if (!['seekBack', 'seekForward'].includes(action ?? '')) cancelHeldSeek();
  });
  let pointerLayoutPending = false;
  function finishPointerLayout() {
    if (!pointerLayoutPending) return;
    pointerLayoutPending = false;
    playbackInputMode = 'mouse';
    renderMode();
  }
  // A first mouse press can take over from fullscreen gamepad playback. Keep
  // its target stationary through pointerup/click before changing the layout.
  lifecycle.listen(window, 'pointerup', () => {
    if (pointerLayoutPending) lifecycle.timeout(finishPointerLayout, 0);
  }, true);
  lifecycle.listen(window, 'pointercancel', finishPointerLayout, true);
  lifecycle.listen(window, 'blur', finishPointerLayout);
  lifecycle.listen(window, 'yt-gamepad-input-mode', event => {
    const { mode, source } = (event as CustomEvent<{ mode?: string; source?: string }>).detail || {};
    if (mode !== 'gamepad') cancelHeldSeek();
    if (mode === 'gamepad' || mode === 'mouse' || mode === 'keyboard') {
      if (mode === 'mouse' && source === 'pointer-down' && fullscreenLayout() && location.pathname === '/watch') {
        pointerLayoutPending = true;
        return;
      }
      pointerLayoutPending = false;
      playbackInputMode = mode;
      renderMode();
    }
  });
  lifecycle.listen(document, 'fullscreenchange', () => { renderMode(); scheduleWatchRefresh(false, false); });
  lifecycle.listen(window, 'blur', cancelHeldSeek);
  lifecycle.listen(document, 'visibilitychange', () => {
    if (document.hidden) cancelHeldSeek();
    syncHealthPolling();
    if (!document.hidden) scheduleWatchRefresh(false, false);
  });
  lifecycle.cleanup(cancelHeldSeek);
  lifecycle.cleanup(() => {
    preferences = { ...preferences, enabled: false };
    send({ type: 'ENABLE', enabled: false, route: routeNow() }); routes.destroy(); restoreNative();
    notice?.host.remove?.();
    document.documentElement.classList.remove('ytg-playback', 'ytg-controls', 'ytg-theater', 'ytg-settings-open', 'ytg-player-primed', 'ytg-watch-layout');
    delete document.documentElement.dataset.ytgAdaptation;
    delete document.documentElement.dataset.ytgPlaybackLayout;
    delete document.documentElement.dataset.ytgWatchExpanded;
  });
  lifecycle.listen(window, 'pagehide', event => { if (!event.persisted) runtime.destroy(); });
}
