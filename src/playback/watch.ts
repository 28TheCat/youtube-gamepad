import type { Action, InteractionEvent, Mode, ModuleFactory, WatchDependencies, WatchModule, WatchPort } from '../../types/ports';

import { YTGamepadActions } from '../shared/actions.ts';
import { sameRecommendations } from '../ui/playback-presentation';
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
  const playIndex = 4;
  let renderedMode: Mode = 'browse', timer: number|undefined;
  const watchState = () => interaction.state.watch;
  const send = (event: InteractionEvent) => interaction.dispatch(event);
  send({ type: 'WATCH_RESET', playIndex });
  let route = '', lastRecommendations: readonly import('../../types/ports').RecommendationSnapshot[] = [], lastActivity = Date.now();
  const view = dependencies.createSurface({
    activate, state: watchState, controller: () => controller, send, focus,
    activity: () => { lastActivity = Date.now(); },
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
  let playbackEnded = false;
  function clearFeedback() { lifecycle.clearTimeout(timer); view.feedback(null); }
  function seekPreview(value: import('../ui/playback-presentation').SeekPreview | null) {
    if (!value) { clearFeedback(); return; }
    lastActivity = Date.now();
    lifecycle.clearTimeout(timer);
    view.feedback({ label: '', seek: value }, value.delta < 0 ? 'seekBack' : 'seekForward');
  }
  function mediaFeedback(action: Action, seekDelta?: number) {
    if (!enabled() || !controller.readRoute().isWatch || mode() === 'browse' || controller.hasTemporaryLayer?.()) return;
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
    const state = watchState(), data = snapshot();
    const targets = state.panel ? data.panel : state.row === 'recommendations' ? data.recommendations : data.controls;
    const target = !state.panel && state.row === 'progress'
      ? { id: 'progress', region: 'progress', itemKey: 'progress', index: 0, available: data.canSeek }
      : targets[state.panel ? Math.min(state.panelIndex, targets.length - 1) : state.index];
    view.focus(target, state.adjusting, mode());
    if (!state.panel && state.row === 'recommendations' && state.index >= data.recommendations.length - recommendationColumns() * 2) controller.request('moreRecommendations');
  }
  function feedback(text: string|null) {
    view.feedback({ label: text || '' }); lifecycle.clearTimeout(timer);
    timer = lifecycle.timeout(() => view.feedback(null), 2600);
  }
  function closePanel() { view.panel.close(); }
  function activate(action?: string) {
    if (!enabled() || controller.state.navigating) return;
    if (action?.startsWith('recommendation:')) { openVideo(action.slice('recommendation:'.length)); return; }
    if (mode() === 'playback') show();
    const data = snapshot(), target = data.controls.find(target => target.id === action);
    if ((target && !target.available) || (action === 'adjustProgress' && !data.canSeek)) return;
    if (target) view.press(target.id);
    lastActivity = Date.now();
    if (action === 'adjustProgress') {
      send({ type: 'WATCH_FOCUS', region: 'progress' }); handle('confirm');
    } else if (action === 'recommendations') {
      closePanel(); show('recommendations');
    } else if (action === 'description' || action === 'comments') {
      view.panel.open(action);
    } else if (action === 'save') {
      view.panel.open('playlists');
    } else if (action === 'channel') {
      if (!controller.request('channel')) feedback('Channel information is still loading');
    } else if (action === 'settings') {
      if (!controller.request('settings')) feedback('Player settings are currently unavailable');
    } else if (['subscribe', 'like', 'dislike', 'save'].includes(action || '')) {
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
      send({ type: 'WATCH_FOCUS', region: 'controls', index: playIndex });
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
    if (controller.request('recommendation', key || '') === 'missing') { feedback('Recommendations have changed. Please select again.'); readPage(); }
  }
  function hasTemporaryLayer() {
    return !!(watchState().panel || focusManager?.suspended || controller.hasTemporaryLayer?.());
  }
  function show(target: 'controls' | 'recommendations' = 'controls') {
    if (!enabled() || controller.state.navigating) return;
    lastActivity = Date.now();
    controller.request('mode', 'controls');
    send({ type: 'WATCH_SHOW', target, count: snapshot().recommendations.length }); focus();
  }
  function sync() {
    if (mode() !== renderedMode) lastActivity = Date.now();
    renderedMode = mode();
    const active = enabled() && controller.state.surfaceReady !== false && controller.readRoute().isWatch && mode() !== 'browse';
    view.sync(active, mode());
    if (!active) clearFeedback();
    if (active) {
      const nextRoute = controller.readRoute().key;
      if (nextRoute !== route) {
        route = nextRoute; lastRecommendations = []; send({ type: 'WATCH_RESET', playIndex });
        playbackEnded = false;
        clearFeedback();
        view.reset();
      }
      readPage(); updateProgress();
    }
  }
  function handle(action: Action) {
    if (!enabled() || !controller.readRoute().isWatch || mode() === 'browse') return false;
    if (action === 'seekBack' || action === 'seekForward') {
      if (controller.hasTemporaryLayer?.()) return false;
      if (mode() !== 'controls') show();
      if (watchState().panel === 'comments') { closePanel(); show('recommendations'); }
      else view.panel.open('comments');
      return true;
    }
    if (mode() !== 'controls') return false;
    if (controller.navigating) return true;
    lastActivity = Date.now();
    if (action === 'back' && controller.request('backSettings')) return true;
    if (action === 'back' && watchState().panel === 'comments' && view.panel.back()) return true;
    // Geometry remains in the view; the reducer receives only a scroll observation.
    const scrollDelta = watchState().panel === 'comments' && watchState().panelIndex > 0 && ['up', 'down'].includes(action)
      ? view.panel.scrollDelta(watchState().panelIndex, action) : 0;
    // Directional focus uses the current presentation; progress has its own
    // media/seek/poll updates and must not repaint on every held direction.
    if (!['up', 'down', 'left', 'right', 'back'].includes(action)) updateProgress();
    const data = snapshot();
    const result = send({ type: 'WATCH_INPUT', action, canSeek: data.canSeek,
      availableControls: data.controls.filter(target => target.available).map(target => target.index), scrollDelta, commentCount: Math.max(0, data.panel.length - 1),
      cardCount: data.recommendations.length, cardColumns: recommendationColumns(), controlCount: data.controls.length,
      recommendationKey: data.recommendations[watchState().index]?.itemKey, controlAction: data.controls[watchState().index]?.id });
    for (const effect of result.effects) {
      switch (effect.type) {
        case 'closePanel': closePanel(); break;
        case 'panelClick': view.panel.activate(watchState().panelIndex); break;
        case 'panelScroll': view.panel.scroll(effect.value as number); break;
        case 'loadComments': view.panel.load(); break;
        case 'loadRecommendations':
          if (controller.request('moreRecommendations') === false) feedback('No more recommendations');
          break;
        case 'focus': focus(); break;
        case 'mode': controller.request('mode', effect.value as Mode); break;
        case 'recommendation': openVideo(effect.value as string); break;
        case 'activate': activate(effect.value as string); break;
      }
    }
    return result.disposition !== 'pass';
  }

  function recommendationColumns() {
    if (document.documentElement.dataset.ytgPlaybackLayout !== 'fullscreen') return 1;
    return window.innerWidth <= 900 ? 2 : 4;
  }

  const unregisterFocus = focusManager?.register('watch', {
    active: () => enabled() && view.visible && mode() === 'controls' && !controller.hasNativeLayer?.(),
    capture() {
      const region = watchState().panel ? 'panel' : watchState().row, position = watchState().panel ? watchState().panelIndex : watchState().row === 'progress' ? 0 : watchState().index;
      return view.capture(region, position);
    },
    items: region => view.items(region),
    fallback: () => view.items('controls').find(item => item.index === playIndex) || view.items('controls')[0],
    apply(target) {
      if (!target) return;
      send({ type: 'WATCH_FOCUS', region: target.region as import('../../types/ports').WatchSnapshot['row'] | 'panel', index: target.index });
      lastActivity = Date.now(); focus();
    }
  });
  if (unregisterFocus) lifecycle.cleanup(unregisterFocus);
  function handleInput(action: Action) {
    if (!enabled() || !controller.readRoute().isWatch || mode() !== 'controls') return 'pass';
    if (watchState().panel && !['back', 'confirm', 'up', 'down', 'seekBack', 'seekForward'].includes(action)) return 'blocked';
    return handle(action) ? 'handled' : watchState().panel ? 'blocked' : 'pass';
  }
  YTGamepadWatch = { destroy: lifecycle.destroy,
    /** @param {import('../../types/ports.js').WatchPort} port */
    connect(port: import('../../types/ports.js').WatchPort) { controller = port; }, sync, show, handle, handleInput, mediaFeedback, seekPreview,
    scroll(delta) {
      if (!delta || !enabled() || !view.visible || mode() !== 'controls' || controller.navigating || watchState().adjusting) { view.scroll(0); return; }
      lastActivity = Date.now();
      view.scroll(delta);
    },
    refresh() { readPage(); updateProgress(); }, refreshPage: readPage, refreshPlayback: updateProgress, checkIdle,
    get ownsFocus() { return enabled() && view.visible && mode() === 'controls'; },
    get state() { return { mode: mode(), row: watchState().row, index: watchState().index, adjusting: watchState().adjusting, panel: watchState().panel, recommendations: snapshot().recommendations.length }; } };
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
