import type { Action, FocusTarget, InteractionEvent, Mode, PlaybackSnapshot, RecommendationSnapshot, Scope, SharedDependencies, WatchPanels, WatchPanelsPort, WatchPageSnapshot, WatchPort, WatchSnapshot, WatchView, WatchViewDependencies } from '../../types/ports';
import type { PlaybackFeedback } from './playback-presentation';
import { recommendationFocusIds, sameRecommendations } from './playback-presentation';
import { ui } from './ui-api';
import { playbackControlIds } from './playback-control-config';
import { createStickScroller } from '../navigation/stick-scroll';

export interface WatchTarget {
  id: string;
  region: string;
  itemKey: string;
  index: number;
  available: boolean;
}
export interface WatchSurfaceSnapshot {
  canSeek: boolean;
  player?: WatchTarget;
  metadata?: WatchTarget;
  controls: readonly WatchTarget[];
  recommendations: readonly WatchTarget[];
  panel: readonly WatchTarget[];
}
/** DOM observations and effects stay here; the playback policy receives only data. */
export interface WatchSurfaceDependencies extends SharedDependencies {
  createView(port: Omit<WatchViewDependencies, 'styles'>): WatchView;
  createPanels(port: WatchPanelsPort): WatchPanels;
}
export interface WatchSurfaceCallbacks {
  activate(action: string): void;
  seek(seconds: number): boolean | void | Promise<boolean | void>;
  state(): WatchSnapshot;
  controller(): WatchPort;
  send(event: InteractionEvent): import('../../types/ports').TransitionResult;
  focus(): void;
  activity(): void;
  input(action: Action): void;
}
export type WatchSurface = ReturnType<typeof createWatchSurface>;
export function createWatchSurface(dependencies: WatchSurfaceDependencies, callbacks: WatchSurfaceCallbacks, lifecycle: Scope) {
  const stickScroller = createStickScroller(lifecycle);
  const { controllerStyle, focusManager } = dependencies;
  const view = dependencies.createView({ activate: callbacks.activate, seek: callbacks.seek,
    closePanel: () => { if (!panels.back()) panels.close(); }, controllerStyle });
  const { host, root, surface, progress, controls, dialog, sheet, close, status, presentation } = view;
  let destroyed = false, descriptionText = '', feedbackAction = '', canSeek = false;
  let recommendations: readonly RecommendationSnapshot[] = [];
  let recommendationTargetsCache: readonly WatchTarget[] = [];
  const panels = dependencies.createPanels({ ...view, watchState: callbacks.state,
    send: callbacks.send, focus: callbacks.focus, focusManager, controllerStyle,
    get controller() { return callbacks.controller(); }, get descriptionText() { return descriptionText; }
  });
  const releasePanels = (['description', 'comments', 'playlists', 'subscription'] as const).map(id => ui.registerPanel(id, {
    isOpen: () => !destroyed && callbacks.state().panel === id,
    open: () => {
      if (destroyed || host.hidden || callbacks.controller().navigating || ui.state.openPanels.some(panel =>
        panel === 'account' || panel === 'search' || panel === 'settings')) return false;
      panels.open(id);
    }, close: panels.close
  }));
  const unregisterPanels = () => releasePanels.forEach(release => release());
  lifecycle.cleanup(unregisterPanels);
  lifecycle.cleanup(controllerStyle.register(root));
  const cards = () => presentation.cards();
  const available = (node: HTMLElement) => !node.hidden && !(node as HTMLButtonElement).disabled && node.getAttribute('aria-disabled') !== 'true';
  const controlNodes = () => {
    const fullscreen = document.documentElement.dataset.ytgPlaybackLayout === 'fullscreen';
    const visible = playbackControlIds(fullscreen);
    return controls.filter(node => visible.includes(node.dataset.action || ''));
  };
  const controlTargets = () => controlNodes().map((node, index) => ({ id: node.dataset.action || '', region: 'controls',
        itemKey: node.dataset.action || String(index), index, available: available(node) }));
  const panelNodes = () => callbacks.state().panel && callbacks.state().panel !== 'description' ? [close, ...panels.buttons] : [close];
  const panelTargets = () => panelNodes().map((node, index) => ({ id: node.dataset.focusId || 'panel:close',
    region: 'panel', itemKey: node.dataset.focusId || String(index), index, available: available(node) }));
  const recommendationTargetMap = new Map<string, WatchTarget>();
  const recommendationTargets = () => cards().flatMap(node => {
    const target = node.dataset.focusId ? recommendationTargetMap.get(node.dataset.focusId)
      : recommendationTargetsCache.find(item => item.itemKey === node.dataset.videoId);
    return target ? [target] : [];
  }).map((item, index) => ({ ...item, index }));
  function snapshot(): WatchSurfaceSnapshot {
    return { canSeek, metadata: view.metadata ? { id: 'metadata', region: 'metadata', itemKey: 'metadata', index: 0, available: document.documentElement.dataset.ytgPlaybackLayout !== 'fullscreen' } : undefined, player: view.player ? { id: 'player', region: 'player', itemKey: 'player', index: 0, available: document.documentElement.dataset.ytgPlaybackLayout !== 'fullscreen' } : undefined, controls: controlTargets(), recommendations: recommendationTargets(), panel: panelTargets() };
  }
  function nodes(region: string) { return region === 'metadata' ? view.metadata ? [view.metadata] : [] : region === 'player' ? view.player ? [view.player] : [] : region === 'recommendations' ? cards() : region === 'progress' ? [progress] : region === 'panel' ? panelNodes() : controlNodes(); }
  function animate(node: HTMLElement, frames: Keyframe[], duration: number, id = 'ytg-feedback') {
    if (!node.animate || !window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches) return;
    node.getAnimations().filter(animation => animation.id === id).forEach(animation => animation.cancel());
    const animation = node.animate(frames, { duration, easing: 'cubic-bezier(.2,.8,.2,1)', id });
    const release = lifecycle.cleanup(() => animation.cancel());
    animation.onfinish = animation.oncancel = release;
  }
  lifecycle.listen(root, 'pointerdown', callbacks.activity);
  lifecycle.listen(root, 'focusin', event => {
    callbacks.activity();
    const node = event.target as HTMLElement;
    const observations = snapshot();
    let target: WatchTarget | undefined;
    if (node === view.metadata) target = observations.metadata;
    else if (node === view.player) target = observations.player;
    else if (controls.includes(node as HTMLButtonElement)) target = observations.controls.find(target => target.id === node.dataset.action);
    else if (cards().includes(node as HTMLButtonElement)) target = observations.recommendations[cards().indexOf(node as HTMLButtonElement)];
    else if (panelNodes().includes(node)) target = observations.panel[panelNodes().indexOf(node)];
    else if (node === progress) target = { id: 'progress', region: 'progress', itemKey: 'progress', index: 0, available: true };
    if (target) callbacks.send({ type: 'WATCH_FOCUS', region: target.region as WatchSnapshot['row'] | 'panel', index: target.index });
  });
  lifecycle.listen(root, 'click', event => event.stopPropagation());
  lifecycle.listen(root, 'keydown', event => {
    if ((event.target as HTMLElement).closest?.('textarea,input') && event.key !== 'Escape' && event.key !== 'Tab') return;
    event.stopPropagation();
    const action = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Escape: 'back' } as Record<string, Action>)[event.key];
    if (action) { event.preventDefault(); callbacks.input(action); }
    if (event.key === 'Tab') { event.preventDefault(); callbacks.input(callbacks.state().panel && callbacks.state().panel !== 'description' ? (event.shiftKey ? 'up' : 'down') : (event.shiftKey ? 'left' : 'right')); }
  });
  for (const type of ['keydown', 'keyup'] as const) lifecycle.listen(window, type, event => {
    if (host.hidden || !callbacks.controller()?.state.enabled || !event.composedPath?.().includes(host) || ![' ', 'Spacebar', 'Enter'].includes(event.key)) return;
    if ((event.composedPath?.()[0] as HTMLElement | undefined)?.closest?.('textarea,input')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (type === 'keydown' && !event.repeat) callbacks.input('confirm');
  }, true);
  return {
    snapshot,
    scroll(delta: number) {
      if (!delta || destroyed || host.hidden) { stickScroller.stop(); return; }
      const target = callbacks.state().panel ? sheet : view.recommendations;
      callbacks.activity();
      stickScroller.scroll(delta, host, target);
    },
    get visible() { return !destroyed && !host.hidden; },
    sync(active: boolean, mode: Mode) {
      if (destroyed) return;
      document.documentElement.classList.toggle('ytg-watch-active', active);
      host.hidden = !active;
      host.dataset.passive = String(mode !== 'controls'); presentation.visible(!host.hidden);
      if (host.hidden) { stickScroller.stop(); document.documentElement.classList.remove('ytg-recommendations'); panels.hide(); }
      if (!active) document.documentElement.classList.remove('ytg-settings-open');
    },
    playback(value: PlaybackSnapshot) { if (!destroyed) { canSeek = !!value.video?.timeline.canSeek; presentation.playback(value); view.updateHint(callbacks.state().row, callbacks.state().adjusting, canSeek); } },
    page(value: WatchPageSnapshot, features: import('../../types/ports').WatchFeatures) {
      if (destroyed) return;
      descriptionText = value.description;
      if (!sameRecommendations(recommendations, value.recommendations)) {
        recommendations = value.recommendations;
        const ids = recommendationFocusIds(recommendations);
        recommendationTargetsCache = recommendations.map((item, index) => ({ id: ids[index],
          region: 'recommendations', itemKey: item.key, index, available: true }));
        recommendationTargetMap.clear();
        for (const target of recommendationTargetsCache) recommendationTargetMap.set(target.id, target);
      }
      presentation.page(value, features);
    },
    focus(target: WatchTarget | undefined, adjusting: boolean, mode: Mode) {
      if (destroyed) return;
      const state = callbacks.state();
      view.updateHint(state.row, adjusting, canSeek);
      surface.classList.toggle('browsing', state.row === 'recommendations');
      document.documentElement.classList.toggle('ytg-recommendations', state.row === 'recommendations' && mode === 'controls');
      [close, ...panels.buttons].forEach(node => node.classList.remove('selected'));
      presentation.selection(state.row, state.panel ? '' : target?.id || '', adjusting);
      if (!target) return;
      // Resolve after rendering: Vue may have replaced the focused element.
      const candidates = nodes(target.region);
      const matches = (node: HTMLElement) => target.region === 'recommendations' ? node.dataset.focusId === target.id || (!node.dataset.focusId && node.dataset.videoId === target.itemKey)
        : target.region === 'controls' ? node.dataset.action === target.id
        : target.region === 'player' ? node === view.player
        : target.region === 'metadata' ? node === view.metadata
        : target.region === 'progress' ? node === progress
        : target.id === 'panel:close' ? node === close : node.dataset.focusId === target.id;
      const node = candidates[target.index] && matches(candidates[target.index]) ? candidates[target.index] : candidates.find(matches);
      if (!node || !available(node)) return;
      if (state.panel) node.classList.add('selected');
      node.focus({ preventScroll: true });
      if (target.region === 'controls') {
        const toolbar = node.closest<HTMLElement>('.toolbar');
        if (toolbar && toolbar.scrollWidth > toolbar.clientWidth) {
          const bounds = toolbar.getBoundingClientRect(), item = node.getBoundingClientRect();
          const inset = 10;
          const delta = item.left < bounds.left + inset ? item.left - bounds.left - inset
            : item.right > bounds.right - inset ? item.right - bounds.right + inset : 0;
          if (delta) toolbar.scrollBy({ left: delta, behavior: 'instant' });
        }
      }
      if (target.region === 'recommendations' || (state.panel && state.panel !== 'description')) node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    },
    items(region: string): FocusTarget[] {
      const data = region === 'player' || region === 'metadata' ? [snapshot()[region]].filter((target): target is WatchTarget => !!target) : region === 'recommendations' ? recommendationTargets() : region === 'progress' ? [{ id: 'progress', region, itemKey: 'progress', index: 0, available: canSeek }] : region === 'panel' ? panelTargets() : controlTargets();
      const elements = nodes(region);
      return data.filter(target => target.available && elements[target.index]?.isConnected && available(elements[target.index])).map(({ region, itemKey, index }) => ({ region, itemKey, index }));
    },
    capture(region: string, index: number): FocusTarget {
      return { ...this.items(region).find(item => item.index === index), region, index, scope: callbacks.state().panel ? dialog : undefined };
    },
    press(id: string) { const node = controls.find(node => node.dataset.action === id); if (node) animate(node, [{ scale: '.95', offset: 0 }], 100, 'ytg-press'); },
    feedback(value: PlaybackFeedback | null, action = '') {
      if (destroyed) return;
      if (action === 'playPause' && document.documentElement.dataset.ytgInputMode === 'mouse') {
        value = null; action = '';
      }
      const repeated = feedbackAction === action; feedbackAction = action;
      host.removeAttribute?.('data-feedback'); status.classList.remove('media-feedback'); status.classList.remove('feedback-closing'); status.removeAttribute?.('aria-label');
      presentation.feedback(value);
      if (action) {
        host.setAttribute('data-feedback', action); status.classList.add('media-feedback');
        if (value?.label) status.setAttribute('aria-label', value.label);
        if (!repeated || action === 'playPause') animate(status, [{ opacity: 0, scale: '.96', translate: '0 6px' }, { opacity: 1, scale: '1', translate: '0 0' }], 100);
      }
    },
    closeFeedback() { if (window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches) { status.classList.add('feedback-closing'); return true; } return false; },
    panel: { open: (id: 'description' | 'comments' | 'playlists' | 'subscription') => { ui.openPanel(id); }, close: panels.close, back: panels.back, refresh: panels.refresh, load: panels.load,
      activate(index: number) { panelNodes()[index]?.click(); },
      scroll(delta: number) { sheet.scrollBy({ top: delta, behavior: 'instant' }); },
      scrollDelta(index: number, action: Action) {
        const node = panelNodes()[index]; if (!node) return 0;
        const rect = node.getBoundingClientRect(), viewport = sheet.getBoundingClientRect();
        const delta = action === 'down' ? rect.bottom - viewport.bottom + 12 : rect.top - viewport.top - 12;
        return (action === 'down' && delta > 1 || action === 'up' && delta < -1) ? Math.max(-180, Math.min(180, delta)) : 0;
      }
    },
    cycleTab(direction: number) { return view.cycleTab?.(direction) || false; },
    reset() { panels.hide(); canSeek = false; recommendations = []; recommendationTargetsCache = []; recommendationTargetMap.clear(); presentation.reset(); },
    destroy() {
      if (destroyed) return; destroyed = true;
      stickScroller.stop();
      unregisterPanels();
      panels.destroy(); presentation.destroy(); host.hidden = true; host.remove(); root.replaceChildren(); recommendations = []; recommendationTargetsCache = [];
      recommendationTargetMap.clear();
      document.documentElement.classList.remove('ytg-watch-active', 'ytg-recommendations', 'ytg-comments', 'ytg-settings-open');
    }
  };
}
