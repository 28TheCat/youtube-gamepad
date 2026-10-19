import { h, render } from 'vue';
import PlaybackControls from './PlaybackControls.vue';
import PlaybackFeedback from './PlaybackFeedback.vue';
import PlaybackMetadata from './PlaybackMetadata.vue';
import PlaybackRecommendations from './PlaybackRecommendations.vue';
import PlaybackHints from './PlaybackHints.vue';
import Timeline from '../playback/Timeline.vue';
import type { WatchView, WatchViewDependencies, WatchSnapshot, RecommendationSnapshot } from '../../types/ports';
import type { PlaybackMetadata as Metadata, PlaybackControlState, PlaybackPresenter } from './playback-presentation';
import { sameRecommendations } from './playback-presentation';
import { createPlaybackModel } from '../playback/playback-model';
import { currentLanguage } from '../shared/i18n';

export function createVueWatchView({ activate, seek, closePanel, controllerStyle, styles }: WatchViewDependencies): WatchView {
  const host = document.createElement('div'); host.id = 'ytg-watch'; host.hidden = true; host.lang = 'en';
  const root = host.attachShadow({ mode: 'open' });
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const style = make('style'); style.textContent = styles.watch;
  // Separate Vue roots keep high-frequency progress/focus work out of metadata
  // and list rendering. The shell and control DOM identities remain stable.
  const surface = make('div', 'surface'), bottom = make('section', 'bottom');
  const slot = (parent: HTMLElement, name: string) => {
    const node = make('div'); node.style.display = 'contents'; node.dataset.playbackRegion = name; parent.append(node); return node;
  };
  const headingRoot = slot(surface, 'metadata'); surface.append(bottom);
  const progressRoot = slot(bottom, 'progress'), controlsRoot = slot(bottom, 'controls');
  const recommendationsRoot = slot(bottom, 'recommendations'), hintsRoot = slot(bottom, 'hints');
  const dialog = make('div', 'dialog'); dialog.hidden = true; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Video description');
  const sheet = make('section', 'sheet'), panelTitle = make('h2', '', 'Video description'), description = make('div', 'description'), close = make('button', 'control', 'Back');
  controllerStyle.bind(close, 'Back'); controllerStyle.bind(panelTitle, 'Video description'); controllerStyle.bind(dialog, 'Video description', 'aria-label');
  host.lang = currentLanguage();
  const languageObserver = new MutationObserver(() => { host.lang = currentLanguage(); });
  languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ytg-language'] });
  close.addEventListener('click', closePanel); sheet.append(panelTitle, description, close); dialog.append(sheet);
  const status = make('div', 'status'); status.setAttribute('role', 'status');
  root.append(style, surface, dialog, status); document.body.append(host);
  let destroyed = false;
  const model = createPlaybackModel({ activate, seek: seconds => seek ? seek(seconds) : false });
  let metadata: Metadata = { title: '', channel: '' };
  let playbackControls: PlaybackControlState | undefined;
  let selected = '', adjusting = false, row: WatchSnapshot['row'] = 'controls', commentsOpen = false;
  let recommendations: readonly RecommendationSnapshot[] = [], recommendationsFailed = false;
  let cardCache: HTMLButtonElement[] = [], selectedNode: HTMLElement | undefined;
  const controlNodes = new Map<string, HTMLButtonElement>(), recommendationNodes = new Map<string, HTMLButtonElement>();
  const openVideo = (key: string) => model.request('recommendation:' + key);
  const equal = <T extends object>(left: T, right: T) => {
    const keys = Object.keys(left) as (keyof T)[];
    return keys.length === Object.keys(right).length && keys.every(key => Object.is(left[key], right[key]));
  };
  function paintSelection() {
    const node = controlNodes.get(selected) || recommendationNodes.get(selected);
    if (selectedNode !== node) selectedNode?.classList.remove('selected');
    node?.classList.add('selected'); selectedNode = node;
  }
  function paintProgress() {
    render(h(Timeline, { model, state: model.state.value, selected: selected === 'progress', adjusting, controllerStyle }), progressRoot);
  }
  function paintControls() {
    render(h(PlaybackControls, { page: metadata, playback: playbackControls!, commentsOpen, activate: model.request }), controlsRoot);
    if (!controlNodes.size) for (const node of controlsRoot.querySelectorAll<HTMLButtonElement>('[data-action]')) controlNodes.set(node.dataset.action!, node);
    paintSelection();
  }
  function paintRecommendations() {
    render(h(PlaybackRecommendations, { items: recommendations, failed: recommendationsFailed, openVideo }), recommendationsRoot);
    cardCache = Array.from(recommendationsRoot.querySelectorAll<HTMLButtonElement>('.card'));
    recommendationNodes.clear();
    for (const node of cardCache) recommendationNodes.set(node.dataset.focusId!, node);
    paintSelection();
  }
  let hints: { row: WatchSnapshot['row']; adjusting: boolean; canSeek: boolean } | undefined;
  function paintHints() {
    const next = { row, adjusting, canSeek: model.state.value.canSeek };
    if (hints && equal(hints, next)) return;
    hints = next; render(h(PlaybackHints, { ...next, controllerStyle }), hintsRoot);
  }
  function updatePlaybackControls() {
    const { paused, captionsEnabled, isLive, canSeek, atLiveEdge } = model.state.value;
    const next = { paused, captionsEnabled, isLive, canSeek, atLiveEdge };
    if (playbackControls && equal(playbackControls, next)) return;
    playbackControls = next; paintControls();
  }
  const presentation: PlaybackPresenter = {
    playback(value) { if (!destroyed) { model.update(value); paintProgress(); updatePlaybackControls(); paintHints(); } },
    visible(value) { if (!destroyed) { model.visible(value); } },
    page(value, features) {
      if (destroyed) return;
      const next: Metadata = { title: value.title, channel: value.channel, viewCount: value.viewCount,
        avatar: value.avatar, subscribed: value.subscribed, liked: value.liked, disliked: value.disliked };
      const headingChanged = ['title', 'channel', 'viewCount'].some(key => metadata[key as keyof Metadata] !== next[key as keyof Metadata]);
      const controlsChanged = ['channel', 'avatar', 'subscribed', 'liked', 'disliked'].some(key => metadata[key as keyof Metadata] !== next[key as keyof Metadata]);
      metadata = next;
      if (headingChanged) render(h(PlaybackMetadata, { page: metadata }), headingRoot);
      if (controlsChanged) paintControls();
      const failed = features.recommendations === 'failed';
      if (!sameRecommendations(recommendations, value.recommendations) || failed !== recommendationsFailed) {
        recommendations = value.recommendations; recommendationsFailed = failed; paintRecommendations();
      }
    },
    selection(nextRow, nextSelected, nextAdjusting) {
      if (destroyed) return;
      if ((nextRow !== 'progress' || !nextSelected) && model.preview.value !== null) model.cancelPreview();
      const progressChanged = (selected === 'progress') !== (nextSelected === 'progress') || adjusting !== nextAdjusting;
      row = nextRow; selected = nextSelected; adjusting = nextAdjusting;
      paintSelection(); if (progressChanged) paintProgress(); paintHints();
    },
    feedback(value) { if (!destroyed) render(h(PlaybackFeedback, { value }), status); },
    cards() { return cardCache; },
    reset() {
      if (destroyed) return;
      model.reset(); selected = ''; adjusting = false; row = 'controls'; recommendations = []; recommendationsFailed = false;
      paintProgress(); updatePlaybackControls(); paintRecommendations(); paintHints();
    },
    destroy() {
      if (destroyed) return; destroyed = true; languageObserver.disconnect(); model.destroy();
      for (const node of [headingRoot, progressRoot, controlsRoot, recommendationsRoot, hintsRoot, status]) render(null, node);
      controlNodes.clear(); recommendationNodes.clear(); cardCache = []; selectedNode = undefined;
    }
  };
  render(h(PlaybackMetadata, { page: metadata }), headingRoot);
  paintProgress(); updatePlaybackControls(); paintRecommendations(); paintHints();
  const node = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const found = surface.querySelector<T>(selector);
    if (!found) throw new Error('Missing playback view element: ' + selector);
    return found;
  };
  return {
    host, root, surface, dialog, sheet, panelTitle, description, close, status, make,
    progress: node<HTMLButtonElement>('.progress'),
    controls: [...controlNodes.values()], recommendations: node('.recommendations'),
    updateHint(nextRow, nextAdjusting) {
      if (destroyed) return;
      const progressChanged = adjusting !== nextAdjusting;
      row = nextRow; adjusting = nextAdjusting;
      if (progressChanged) paintProgress();
      const nextCommentsOpen = surface.classList.contains('comments-open');
      if (nextCommentsOpen !== commentsOpen) { commentsOpen = nextCommentsOpen; paintControls(); }
      paintHints();
    },
    presentation
  };
}
