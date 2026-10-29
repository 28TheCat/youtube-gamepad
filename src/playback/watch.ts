import { nativeControlId, nativeControlIndices, nativeControlTargetId } from '../sites/native-player-controls';
import { readWatchReturn, saveWatchReturn, type WatchReturnState } from '../app/browse-history';
import type { Action, InteractionEvent, Mode, ModuleFactory, WatchDependencies, WatchModule, WatchPort } from '../../types/ports';

import { YTGamepadActions } from '../shared/actions.ts';
import { sameRecommendations } from '../ui/playback-presentation';
import { defaultPlaybackControlIndex } from '../ui/playback-control-config';
export let YTGamepadWatchModule!: ModuleFactory<WatchDependencies,WatchModule>, YTGamepadWatch: WatchModule | undefined;
// A gamepad-first watch surface. YouTube retains ownership of media and navigation.
(() => {
  YTGamepadWatchModule = {
    /** @param {import('../../types/ports.js').WatchDependencies} dependencies */
    create(dependencies: WatchDependencies) {
  const { runtime, interaction, focusManager } = dependencies;
  const lifecycle = runtime.scope('watch');
  // The coordinator injects data snapshots and commands; this view never reads
  // YouTube's native DOM or retains its media, links and reply controls.
  let controller: WatchPort;
  const enabled = () => !lifecycle.destroyed && controller?.state.enabled === true;
  const mode = () => controller?.state.mode || 'browse';
  let renderedMode: Mode = 'browse', timer: number|undefined;
  const watchState = () => interaction.state.watch;
  const panelFocused = () => !!watchState().panel && !watchState().commentsParked;
  let leftReturn = { region: 'player' as 'player' | 'metadata' | 'controls' | 'progress', id: 'player' };
  function rememberLeft() {
    const state = watchState();
    if (!windowed() || panelFocused() || state.row === 'recommendations' || state.row === 'tabs' || state.row === 'filters') return;
    leftReturn = { region: state.row,
      id: state.row === 'controls' ? snapshot().controls[state.index]?.id || '' : state.row };
  }
  function returnLeft() {
    const index = leftReturn.region === 'controls' ? snapshot().controls.findIndex(item => item.id === leftReturn.id && item.available) : 0;
    send({ type: 'WATCH_FOCUS', region: index < 0 ? 'player' : leftReturn.region, index: Math.max(0, index) });
    focus();
  }
  const send = (event: InteractionEvent) => interaction.dispatch(event);
  let route = '', lastRecommendations: readonly import('../../types/ports').RecommendationSnapshot[] = [], lastActivity = Date.now();
  const view = dependencies.createSurface({
    activate, state: watchState, controller: () => controller, send, focus,
    activity: () => { lastActivity = Date.now(); rememberPage(); },
    input: action => { if (enabled()) controller.dispatchAction(action); },
    seek: async seconds => {
      if (!enabled() || !view.visible || controller.navigating || hasTemporaryLayer()) return false;
      const key = controller.readRoute().key;
      const result = await controller.request('seek', seconds);
      if (!lifecycle.destroyed && controller.readRoute().key === key) updateProgress();
      return result;
    }
  }, lifecycle);
  const snapshot = () => view.snapshot();
  const windowed = () => document.documentElement.dataset.ytgPlaybackLayout === 'windowed';
  const playIndex = () => defaultPlaybackControlIndex(snapshot().controls);
  let previousWindowed = windowed();
  let restoreCommentsOnHalf = false;
  let controlIds = snapshot().controls.map(control => control.id);
  send({ type: 'WATCH_RESET', playIndex: playIndex() });
  let playbackEnded = false;
  let wasActive = false, restoringReturn = false, returnRevision = 0;
  let pendingReturn: WatchReturnState | undefined;
  function rememberPage() {
    if (typeof history === 'undefined' || !view.visible || !route || restoringReturn || pendingReturn || controller?.navigating ||
        location.pathname + location.search !== route) return;
    const state = watchState();
    const target = view.capture(panelFocused() ? 'panel' : state.row, panelFocused() ? state.panelIndex : state.index);
    saveWatchReturn(history, { route, target: { region: target.region, itemKey: typeof target.itemKey === 'string' ? target.itemKey : undefined, index: target.index ?? state.index },
      ...(panelFocused() && state.panel ? { panel: state.panel } : {}),
      tab: view.activeTab(), scrollTop: view.readSideScroll() });
  }
  lifecycle.listen(document, 'yt-navigate-start', rememberPage);
  lifecycle.listen(window, 'pagehide', rememberPage);
  lifecycle.listen(document, 'scroll', rememberPage, true);
  function clearFeedback() { lifecycle.clearTimeout(timer); view.feedback(null); }
  function seekPreview(value: import('../ui/playback-presentation').SeekPreview | null) {
    if (!value) { clearFeedback(); return; }
    lastActivity = Date.now();
    lifecycle.clearTimeout(timer);
    view.feedback({ label: '', seek: value }, value.delta < 0 ? 'seekBack' : 'seekForward');
  }
  function mediaFeedback(action: Action, seekDelta?: number) {
    if (!enabled() || !controller.readRoute().isWatch || mode() === 'browse' || !watchState().panel && controller.hasTemporaryLayer?.()) return;
    const playback = controller.readPlayback().video;
    if (!playback || !['seekBack', 'seekForward', 'volumeDown', 'volumeUp', 'mute', 'playPause'].includes(action)) return;
    lifecycle.clearTimeout(timer);
    if (action === 'playPause') view.feedback({ label: playback.paused ? 'Paused' : 'Playing', icon: playback.paused ? 'pause' : 'play' }, action);
    else {
      const volume = ['volumeDown', 'volumeUp', 'mute'].includes(action);
      const percentage = Math.round(Math.max(0, Math.min(1, playback.volume ?? 0)) * 100);
      view.feedback({ label: volume ? (playback.muted ? 'Muted' : 'Volume ' + percentage + '%') : (action === 'seekBack' ? '−' : '+') + Math.round(Math.abs(seekDelta ?? YTGamepadActions.get(action)!.parameter!.default)) + ' seconds', ...(volume ? { level: playback.muted ? 0 : percentage } : {}) }, action);
    }
    timer = lifecycle.timeout(() => {
      if (!view.closeFeedback()) { clearFeedback(); return; }
      timer = lifecycle.timeout(clearFeedback, 100);
    }, action === 'playPause' ? 300 : 600);
  }
  function focus() {
    const state = watchState(), data = snapshot(), panel = panelFocused();
    const targets = panel ? data.panel : state.row === 'filters' ? data.filters || [] : state.row === 'tabs' ? data.tabs || [] : state.row === 'recommendations' ? data.recommendations : data.controls;
    const target = !panel && state.row === 'metadata' ? data.metadata : !panel && state.row === 'player' ? data.player
      : !panel && state.row === 'progress'
      ? { id: 'progress', region: 'progress', itemKey: 'progress', index: 0, available: data.canSeek }
      : targets[panel ? Math.min(state.panelIndex, targets.length - 1) : state.index];
    view.focus(target, state.adjusting, mode());
    rememberPage();
    if (!state.panel && state.row === 'recommendations' && state.index >= data.recommendations.length - recommendationColumns() * 2) controller.request('moreRecommendations', view.collectionOpen ? 'queue' : 'recommendations');
  }
  function feedback(text: string|null) {
    view.feedback({ label: text || '' }); lifecycle.clearTimeout(timer);
    timer = lifecycle.timeout(() => view.feedback(null), 2600);
  }
  function closePanel() { view.panel.close(); }
  function activate(action?: string) {
    if (!enabled() || controller.state.navigating) return;
    if (action?.startsWith('recommendationFilter:')) {
      controller.request('recommendationFilter', action.slice('recommendationFilter:'.length));
      readPage();
      send({ type: 'WATCH_FOCUS', region: 'filters', index: view.activeFilter() }); focus(); return;
    }
    if (action?.startsWith('recommendation:')) { openVideo(action.slice('recommendation:'.length)); return; }
    if (mode() === 'playback') show();
    const data = snapshot(), target = data.controls.find(target => target.id === action);
    if ((target && !target.available) || (action === 'adjustProgress' && !data.canSeek)) return;
    if (target) view.press(target.id);
    lastActivity = Date.now();
    const nativeAction = action && nativeControlId(action);
    if (nativeAction !== undefined && nativeAction !== '') {
      controller.nativePlayer?.activate(nativeAction);
    } else if (action === 'adjustProgress') {
      send({ type: 'WATCH_FOCUS', region: 'progress' }); handle('confirm');
    } else if (action === 'collection') {
      view.toggleFullCollection?.();
    } else if (action === 'collectionClosed') {
      show('controls');
      const index = snapshot().controls.findIndex(item => item.id === 'collection');
      if (index >= 0) { send({ type: 'WATCH_FOCUS', region: 'controls', index }); focus(); }
    } else if (action === 'recommendations') {
      rememberLeft();
      closePanel(); show('recommendations');
    } else if (action === 'description' || action === 'comments') {
      if (action === 'comments') {
        rememberLeft();
        if (watchState().panel === 'comments') { send({ type: 'WATCH_FOCUS', region: 'panel' }); focus(); return; }
      }
      view.panel.open(action);
    } else if (action === 'subscribe' && controller.readWatchPage().subscribed) {
      view.panel.open('subscription');
    } else if (action === 'save') {
      view.panel.open('playlists');
    } else if (action === 'channel') {
      const channel = snapshot().controls.find(item => item.id === 'channel');
      if (channel) send({ type: 'WATCH_FOCUS', region: 'controls', index: channel.index });
      rememberPage();
      if (!controller.request('channel')) feedback('Channel information is still loading');
    } else if (action === 'fullscreen') {
      Promise.resolve(controller.request('fullscreen')).then(ok => {
        if (!ok && !lifecycle.destroyed) feedback('This action is currently unavailable');
      });
      return;
    } else if (action === 'settings') {
      if (!controller.request('settings')) feedback('Player settings are currently unavailable');
    } else if (['subscribe', 'like', 'dislike'].includes(action || '')) {
      const route = controller.readRoute().key;
      Promise.resolve(controller.request('watchAction', action as import('../../types/ports').WatchAction)).then(ok => {
        if (lifecycle.destroyed || controller.readRoute().key !== route) return;
        if (!ok) feedback('This action is unavailable. Wait for the video information to load.');
        if (controller.requestRefresh) controller.requestRefresh(); else readPage();
      });
      return;
    } else {
      const route = controller.readRoute().key;
      Promise.resolve(controller.request('media', action as Action)).then(ok => {
        if (lifecycle.destroyed || controller.readRoute().key !== route) return;
        if (!ok) feedback(action === 'captions' ? 'No captions available for this video' : 'This action is currently unavailable');
        updateProgress();
      });
      return;
    }
    updateProgress();
  }
  function updateProgress() {
    const playback = controller.readPlayback();
    controller.observePlayback(playback);
    view.playback(playback);
    const ended = playback.video?.ended === true;
    const justEnded = ended && !playbackEnded;
    playbackEnded = ended;
    if (justEnded && enabled() && controller.state.surfaceReady !== false && mode() !== 'browse' &&
        !controller.navigating && !hasTemporaryLayer() &&
        !new URL(controller.readRoute().key, 'https://www.youtube.com').searchParams.has('list')) {
      // Playlist completion belongs to YouTube's queue, including Mix autoplay.
      lastActivity = Date.now();
      send({ type: 'WATCH_SHOW', target: 'recommendations', count: snapshot().recommendations.length });
      controller.request('mode', 'controls');
      focus();
    }
    const data = snapshot(), canSeek = data.canSeek;
    if (!watchState().panel && ((watchState().row === 'progress' && !canSeek) ||
        (watchState().row === 'controls' && (data.controls[watchState().index]?.available === false)))) {
      send({ type: 'WATCH_FOCUS', region: 'controls', index: playIndex() });
      if (view.visible && !hasTemporaryLayer()) focus();
    }
  }
  function readPage() {
    if (!enabled() || !controller || document.hidden) return;
    const page = controller.readWatchPage();
    if (!page.isWatch) return;
    const changed = !sameRecommendations(lastRecommendations, page.recommendations);
    const savedPresentationFocus = changed && watchState().row === 'recommendations' ? focusManager?.capture('watch') : undefined;
    view.page(page, controller.readWatchFeatures?.() || {});
    const next = page.recommendations;
    if (changed) {
      lastRecommendations = next;
      if (watchState().row === 'recommendations') {
        if (!focusManager?.suspended && !hasTemporaryLayer()) focusManager?.restore(savedPresentationFocus || null);
        else if (!snapshot().recommendations.length) { send({ type: 'WATCH_EMPTY' }); }
      }
    }
    view.panel.refresh();
  }
  function openVideo(key?: string) {
    view.closeFullCollection?.();
    const result = controller.request('recommendation', key || '');
    if (result === 'failed') { feedback('Unable to load this video. Please try again.'); return; }
    if (result === 'missing') { feedback('Recommendations have changed. Please select again.'); readPage(); }
  }
  function hasTemporaryLayer() {
    return !!(view.fullCollectionOpen || watchState().panel || focusManager?.suspended || controller.hasTemporaryLayer?.());
  }
  function show(target: 'controls' | 'recommendations' = 'controls') {
    if (!enabled() || controller.state.navigating) return;
    lastActivity = Date.now();
    controller.request('mode', 'controls');
    send({ type: 'WATCH_SHOW', target, count: snapshot().recommendations.length });
    if (target === 'recommendations' && !snapshot().recommendations.length && snapshot().filters?.length) send({ type: 'WATCH_FOCUS', region: 'filters', index: view.activeFilter() });
    if ((windowed() || view.fullCollectionOpen) && target === 'recommendations' && snapshot().recommendations.length) send({ type: 'WATCH_FOCUS', region: 'recommendations', index: view.sideIndex() });
    if (windowed() && target === 'controls' && snapshot().player) send({ type: 'WATCH_FOCUS', region: 'player', index: 0 });
    focus();
    if (windowed() && target === 'recommendations') view.restoreSideScroll();
  }
  function sync() {
    if (mode() !== renderedMode) lastActivity = Date.now();
    renderedMode = mode();
    const loadingShell = controller.state.shellVisible === true && controller.state.surfaceReady === false;
    const active = enabled() && controller.readRoute().isWatch &&
      (loadingShell || controller.state.surfaceReady !== false && mode() !== 'browse');
    // Preserve the last presentation while the native player is being replaced.
    if (!active && enabled() && controller.state.transitioning && view.visible) { view.hold(true); return; }
    view.hold(false);
    const entering = active && (!wasActive || controller.readRoute().key !== route);
    if (entering || !active && wasActive) ++returnRevision;
    wasActive = active;
    if (entering && typeof history !== 'undefined') pendingReturn = readWatchReturn(history, controller.readRoute().key);
    view.sync(active, loadingShell ? 'playback' : mode());
    if (!active) { clearFeedback(); controller?.nativePlayer?.clear(); }
    if (active) {
      const nextRoute = controller.readRoute().key;
      if (nextRoute !== route) {
        route = nextRoute; lastRecommendations = []; send({ type: 'WATCH_RESET', playIndex: playIndex() });
        leftReturn = { region: 'player', id: 'player' };
        restoreCommentsOnHalf = false;
        playbackEnded = false;
        clearFeedback();
        view.reset();
        if (windowed() && snapshot().player) send({ type: 'WATCH_FOCUS', region: 'player', index: 0 });
        controlIds = snapshot().controls.map(control => control.id);
      }
      const nextIds = snapshot().controls.map(control => control.id);
      if (nextIds.join('|') !== controlIds.join('|')) {
        const previousAction = controlIds[watchState().controlIndex];
        const index = nextIds.indexOf(previousAction);
        controlIds = nextIds;
        send({ type: 'WATCH_CONTROL_LAYOUT', playIndex: playIndex(), index: index >= 0 ? index : playIndex() });
      }
      const nextWindowed = windowed();
      if (nextWindowed !== previousWindowed) {
        previousWindowed = nextWindowed;
        if (!nextWindowed && watchState().commentsParked) { restoreCommentsOnHalf = true; closePanel(); }
        if (nextWindowed && restoreCommentsOnHalf) { restoreCommentsOnHalf = false; view.panel.open('comments'); }
        send({ type: 'WATCH_FOCUS', region: nextWindowed && snapshot().player ? 'player' : 'controls', index: nextWindowed ? 0 : playIndex() });
        if (mode() === 'controls' && (!hasTemporaryLayer() || watchState().commentsParked)) focus();
      }
      readPage();
      if (loadingShell) { view.hold(true); return; }
      updateProgress();
      if (pendingReturn) {
        const saved = pendingReturn;
        restoringReturn = true;
        if (view.activeTab() !== saved.tab) view.activateTab(saved.tab);
        if (saved.panel && watchState().panel !== saved.panel) view.panel.open(saved.panel);
        const targets = view.items(saved.target.region);
        const target = targets.find(item => saved.target.itemKey && item.itemKey === saved.target.itemKey) ||
          targets[Math.min(saved.target.index, targets.length - 1)];
        if (target) {
          pendingReturn = undefined;
          controller.request('mode', 'controls');
          send({ type: 'WATCH_FOCUS', region: target.region as import('../../types/ports').WatchSnapshot['row'] | 'panel', index: target.index });
          focus();
          const expected = returnRevision;
          lifecycle.frame(() => { if (!lifecycle.destroyed && expected === returnRevision && controller.readRoute().key === saved.route) { view.setSideScroll(saved.scrollTop); rememberPage(); } });
        }
        restoringReturn = false;
      }
    }
  }
  function handle(action: Action) {
    if (!enabled() || !controller.readRoute().isWatch || mode() === 'browse') return false;
    if (mode() === 'controls' && YTGamepadActions.get(action)?.target === 'media') {
      activate(action);
      return true;
    }
    if (mode() !== 'controls') return false;
    if (controller.navigating) return true;
    lastActivity = Date.now();
    if (view.fullCollectionOpen) {
      if (action === 'back') { view.closeFullCollection(); activate('collectionClosed'); return true; }
      if (action === 'up' || action === 'down') {
        const count = snapshot().recommendations.length;
        if (count) { send({ type: 'WATCH_FOCUS', region: 'recommendations', index: Math.max(0, Math.min(count - 1, watchState().index + (action === 'down' ? 1 : -1))) }); focus(); }
        return true;
      }
      if (action === 'left' || action === 'right') return true;
    }
    const filters = snapshot().filters || [];
    if (!panelFocused() && filters.length) {
      const state = watchState();
      if (action === 'up' && state.row === 'recommendations' && state.index === 0) {
        send({ type: 'WATCH_FOCUS', region: 'filters', index: view.activeFilter() }); focus(); return true;
      }
      if (state.row === 'filters') {
        if (action === 'left' || action === 'right') {
          send({ type: 'WATCH_FOCUS', region: 'filters', index: (state.index + (action === 'right' ? 1 : filters.length - 1)) % filters.length }); focus();
        } else if (action === 'up' && windowed()) {
          send({ type: 'WATCH_FOCUS', region: 'tabs', index: view.activeTab() }); focus();
        } else if (action === 'confirm') view.activateFilter(state.index);
        else if (action === 'down') show('recommendations');
        else if (action === 'back') { if (windowed()) returnLeft(); else show('controls'); }
        return true;
      }
    }
    if (windowed() && snapshot().tabs?.length) {
      const state = watchState();
      if (action === 'up' && (panelFocused() && state.panel === 'comments' && state.panelIndex === 0 ||
          !panelFocused() && state.row === 'recommendations' && state.index === 0)) {
        send({ type: 'WATCH_FOCUS', region: 'tabs', index: view.activeTab() }); focus(); return true;
      }
      if (!panelFocused() && state.row === 'tabs') {
        if (action === 'left' || action === 'back') returnLeft();
        else if (action === 'right') { send({ type: 'WATCH_FOCUS', region: 'tabs', index: (state.index + 1) % snapshot().tabs!.length }); focus(); }
        else if (action === 'confirm' || action === 'down') view.activateTab(state.index);
        return true;
      }
    }
    if (windowed() && panelFocused() && watchState().panel === 'comments' && action === 'left') {
      returnLeft(); return true;
    }
    if (windowed() && !panelFocused() && watchState().row === 'recommendations' && action === 'left') { returnLeft(); return true; }
    if (windowed() && watchState().commentsParked && action === 'right') {
      const state = watchState(), controls = snapshot().controls;
      const playerControl = nativeControlId(controls[state.index]?.id || '') !== undefined;
      const horizontal = playerControl
        ? nativeControlIndices(controls).map(index => controls[index])
        : controls.filter(item => item.available && nativeControlId(item.id) === undefined);
      if (state.row !== 'controls' || horizontal.at(-1)?.index === state.index) {
        rememberLeft(); send({ type: 'WATCH_FOCUS', region: 'panel' }); focus(); return true;
      }
    }
    if (action === 'back' && controller.request('backSettings')) return true;
    if (action === 'back' && watchState().panel === 'comments' && view.panel.back()) return true;
    // Geometry remains in the view; the reducer receives only a scroll observation.
    const scrollDelta = watchState().panel === 'comments' && watchState().panelIndex > 0 && ['up', 'down'].includes(action)
      ? view.panel.scrollDelta(watchState().panelIndex, action) : 0;
    // Directional focus uses the current presentation; progress has its own
    // media/seek/poll updates and must not repaint on every held direction.
    if (!['up', 'down', 'left', 'right', 'back'].includes(action)) updateProgress();
    const data = snapshot(), previousRow = watchState().row;
    if (windowed() && !panelFocused() && previousRow !== 'recommendations') rememberLeft();
    const result = send({ type: 'WATCH_INPUT', action, windowed: windowed(), canSeek: data.canSeek,
      playerControls: nativeControlIndices(data.controls),
      availableControls: data.controls.filter(target => target.available).map(target => target.index), scrollDelta, commentCount: Math.max(0, data.panel.length - 1),
      cardCount: data.recommendations.length, cardColumns: recommendationColumns(), controlCount: data.controls.length,
      recommendationKey: data.recommendations[watchState().index]?.itemKey, controlAction: data.controls[watchState().index]?.id });
    const enteredSide = windowed() && previousRow !== 'recommendations' && watchState().row === 'recommendations';
    if (enteredSide) send({ type: 'WATCH_FOCUS', region: 'recommendations', index: view.sideIndex() });
    for (const effect of result.effects) {
      switch (effect.type) {
        case 'closePanel': closePanel(); break;
        case 'panelClick': view.panel.activate(watchState().panelIndex); break;
        case 'panelScroll': view.panel.scroll(effect.value as number); break;
        case 'loadComments': view.panel.load(); break;
        case 'loadRecommendations':
          if (controller.request('moreRecommendations', view.collectionOpen ? 'queue' : 'recommendations') === false) feedback('No more recommendations');
          break;
        case 'focus': focus(); break;
        case 'mode': controller.request('mode', effect.value as Mode); break;
        case 'recommendation': openVideo(effect.value as string); break;
        case 'activate': activate(effect.value as string); break;
      }
    }
    if (enteredSide) view.restoreSideScroll();
    return result.disposition !== 'pass';
  }

  function recommendationColumns() {
    if (view.fullCollectionOpen) return 1;
    if (document.documentElement.dataset.ytgPlaybackLayout !== 'fullscreen') return 1;
    return window.innerWidth <= 900 ? 2 : 4;
  }

  const unregisterFocus = focusManager?.register('watch', {
    active: () => enabled() && view.visible && mode() === 'controls' && !controller.hasNativeLayer?.(),
    capture() {
      const region = panelFocused() ? 'panel' : watchState().row, position = panelFocused() ? watchState().panelIndex : watchState().row === 'progress' ? 0 : watchState().index;
      return view.capture(region, position);
    },
    items: region => view.items(region),
    fallback: () => (windowed() ? view.items('player')[0] : undefined) || view.items('controls').find(item => item.index === playIndex()) || view.items('controls')[0],
    apply(target) {
      if (!target) return;
      send({ type: 'WATCH_FOCUS', region: target.region as import('../../types/ports').WatchSnapshot['row'] | 'panel', index: target.index });
      lastActivity = Date.now(); focus();
    }
  });
  if (unregisterFocus) lifecycle.cleanup(unregisterFocus);
  function handleInput(action: Action) {
    if (!enabled() || !controller.readRoute().isWatch || mode() !== 'controls') return 'pass';
    if (panelFocused() && YTGamepadActions.get(action)?.target !== 'media' && !['back', 'confirm', 'up', 'down'].includes(action) &&
        !(windowed() && watchState().panel === 'comments' && action === 'left')) return 'blocked';
    return handle(action) ? 'handled' : panelFocused() ? 'blocked' : 'pass';
  }
  YTGamepadWatch = { destroy: lifecycle.destroy,
    /** @param {import('../../types/ports.js').WatchPort} port */
    connect(port: import('../../types/ports.js').WatchPort) {
      controller = port;
      if (port.nativePlayer) lifecycle.cleanup(port.nativePlayer.observeFocus(id => {
        if (!enabled() || !windowed()) return;
        if (id === 'progress') send({ type: 'WATCH_FOCUS', region: 'progress', index: 0 });
        else {
          const target = snapshot().controls.find(item => item.id === nativeControlTargetId(id));
          if (target) send({ type: 'WATCH_FOCUS', region: 'controls', index: target.index });
        }
      }));
    }, sync, show, handle, handleInput, mediaFeedback, seekPreview, feedback,
    scroll(delta) {
      if (!delta || !enabled() || !view.visible || mode() !== 'controls' || controller.navigating || watchState().adjusting) { view.scroll(0); return; }
      lastActivity = Date.now();
      view.scroll(delta);
    },
    refresh() { readPage(); updateProgress(); }, refreshPage: readPage, refreshPlayback: updateProgress, checkIdle,
    get ownsFocus() { return enabled() && view.visible && mode() === 'controls'; },
    get state() { return { mode: mode(), row: watchState().row, index: watchState().index, adjusting: watchState().adjusting, panel: panelFocused() ? watchState().panel : '', recommendations: snapshot().recommendations.length }; } };
  lifecycle.listen(document, 'visibilitychange', () => {
    if (!document.hidden) {
      lastActivity = Date.now();
      if (controller.requestRefresh) { controller.requestRefresh(); controller.requestRefresh(false); }
      else { readPage(); updateProgress(); }
    }
  });
  // The coordinator owns the sole playback/health clock. This hook only
  // evaluates idle state after its scheduled playback refresh.
  function checkIdle() {
    if (!view.visible || document.hidden) return;
    if (hasTemporaryLayer() || controller.navigating) { lastActivity = Date.now(); return; }
    const idle = Date.now() - lastActivity;
    controller.requestAutoHide?.(idle);
  }
  const published = YTGamepadWatch;
  lifecycle.cleanup(() => { if (YTGamepadWatch === published) YTGamepadWatch = undefined; });
  lifecycle.cleanup(view.destroy);
  return published;
  } };
})();
