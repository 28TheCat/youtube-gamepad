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
import mediaActionCSS from './media-action.css?inline';

export function createVueWatchView({ activate, seek, closePanel, controllerStyle, styles }: WatchViewDependencies, mount?: (node: HTMLElement) => void): WatchView {
  const host = document.createElement('div'); host.id = 'ytg-watch'; host.hidden = true; host.lang = currentLanguage();
  const root = host.attachShadow({ mode: 'open' });
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const style = make('style'); style.textContent = styles.watch + mediaActionCSS;
  // Separate Vue roots keep high-frequency progress/focus work out of metadata
  // and list rendering. The shell and control DOM identities remain stable.
  const surface = make('div', 'surface'), bottom = make('section', 'bottom');
  const slot = (parent: HTMLElement, name: string) => {
    const node = make('div'); node.style.display = 'contents'; node.dataset.playbackRegion = name; parent.append(node); return node;
  };
  const player = make('button', 'player-focus'); player.type = 'button'; player.dataset.focusId = 'player';
  controllerStyle.bind(player, 'Enter fullscreen', 'aria-label'); player.addEventListener('click', () => activate('fullscreen')); surface.append(player);
  const headingRoot = slot(surface, 'metadata'); surface.append(bottom);
  const progressRoot = slot(bottom, 'progress'), controlsRoot = slot(bottom, 'controls');
  const recommendationsRoot = slot(bottom, 'recommendations'), hintsRoot = slot(bottom, 'hints');
  const collectionBackdrop = make('div', 'collection-backdrop'); collectionBackdrop.hidden = true; collectionBackdrop.setAttribute('aria-hidden', 'true');
  collectionBackdrop.addEventListener('click', () => { if (closeFullCollection()) activate('collectionClosed'); }); surface.append(collectionBackdrop);
  const dialog = make('div', 'dialog'); dialog.hidden = true; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Video description');
  const sheet = make('section', 'sheet'), panelTitle = make('h2', '', 'Video description'), description = make('div', 'description'), close = make('button', 'control', 'Back');
  controllerStyle.bind(close, 'Back'); controllerStyle.bind(panelTitle, 'Video description'); controllerStyle.bind(dialog, 'Video description', 'aria-label');
  const languageObserver = new MutationObserver(records => {
    host.lang = currentLanguage();
    if (records.some(record => record.attributeName === 'data-ytg-playback-layout')) {
      if (!windowed()) { collectionOpen = false; surface.classList.remove('fullscreen-collection-open'); }
      else if (hasCollection()) collectionOpen = true;
      paintProgress(); paintControls(); paintRecommendations(); if (sidePositions.has(sideKey())) restoreSideScroll(); else revealCollectionCurrent();
    }
  });
  languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ytg-language', 'data-ytg-playback-layout'] });
  close.addEventListener('click', closePanel); sheet.append(panelTitle, description, close); dialog.append(sheet);
  const status = make('div', 'status'); status.setAttribute('role', 'status');
  root.append(style, surface, dialog, status);
  if (mount) mount(host); else document.body.append(host);
  let destroyed = false;
  const model = createPlaybackModel({ activate, seek: seconds => seek ? seek(seconds) : false });
  let metadata: Metadata = { title: '', channel: '' };
  let playbackControls: PlaybackControlState | undefined;
  let selected = '', adjusting = false, row: WatchSnapshot['row'] = 'controls', commentsOpen = false;
  let recommendations: readonly RecommendationSnapshot[] = [], recommendationsFailed = false;
  let queue: readonly RecommendationSnapshot[] = [], playlistTitle = '', playlistTotal: number | undefined, collectionOpen = false;
  const windowed = () => document.documentElement.dataset.ytgPlaybackLayout === 'windowed';
  const hasCollection = () => queue.length > 0;
  let collectionFrame: number | undefined;
  let cardCache: HTMLButtonElement[] = [], selectedNode: HTMLElement | undefined;
  const controlNodes = new Map<string, HTMLButtonElement>(), recommendationNodes = new Map<string, HTMLButtonElement>();
  const openVideo = (key: string) => { if (!windowed() && collectionOpen) closeFullCollection(); model.request('recommendation:' + key); };
  const sidePositions = new Map<string, { id: string; index: number; top: number }>();
  const sideKey = () => collectionOpen ? 'collection' : 'recommendations';
  function rememberSide() {
    if (!windowed() || row !== 'recommendations') return;
    const index = cardCache.findIndex(node => node.dataset.focusId === selected);
    if (index >= 0) sidePositions.set(sideKey(), { id: selected, index,
      top: recommendationsRoot.querySelector<HTMLElement>('.recommendations')?.scrollTop || 0 });
  }
  function restoreSideScroll() {
    const saved = sidePositions.get(sideKey()), container = recommendationsRoot.querySelector<HTMLElement>('.recommendations');
    if (saved && container) container.scrollTop = saved.top;
  }
  function activateTab(action: string) {
    rememberSide();
    if (action === 'collection' && !windowed()) { toggleFullCollection(); return; }
    if (action === 'collection' || action === 'recommendations') {
      collectionOpen = action === 'collection' && hasCollection() && windowed();
      paintRecommendations(); paintControls(); if (!sidePositions.has(sideKey())) revealCollectionCurrent();
      activate('recommendations');
    } else model.request(action);
  }
  function closeFullCollection() {
    if (windowed() || !collectionOpen) return false;
    collectionOpen = false; collectionBackdrop.hidden = true; surface.classList.remove('fullscreen-collection-open'); paintRecommendations(); paintControls();
    return true;
  }
  function toggleFullCollection() {
    if (windowed() || !hasCollection()) return false;
    if (closeFullCollection()) { activate('collectionClosed'); return true; }
    collectionOpen = true; collectionBackdrop.hidden = false; surface.classList.add('fullscreen-collection-open'); paintRecommendations(); paintControls(); revealCollectionCurrent(); activate('recommendations'); return true;
  }
  const equal = <T extends object>(left: T, right: T) => {
    const keys = Object.keys(left) as (keyof T)[];
    return keys.length === Object.keys(right).length && keys.every(key => Object.is(left[key], right[key]));
  };
  function paintSelection() {
    const node = selected.startsWith('tab:') ? controlsRoot.querySelectorAll<HTMLButtonElement>('.watch-tab')[Number(selected.slice(4))] : selected === 'player' ? player : selected === 'metadata' ? headingRoot.querySelector<HTMLElement>('[data-focus-id="metadata"]') || undefined : controlNodes.get(selected) || recommendationNodes.get(selected);
    if (selectedNode !== node) selectedNode?.classList.remove('selected');
    node?.classList.add('selected'); selectedNode = node;
  }
  function paintProgress() {
    render(windowed() ? null : h(Timeline, { model, state: model.state.value, selected: selected === 'progress', adjusting, controllerStyle }), progressRoot);
  }
  function paintControls() {
    render(h(PlaybackControls, { page: metadata, playback: playbackControls!, commentsOpen, hasCollection: hasCollection(), collectionOpen, windowed: windowed(),
      activate: activateTab, controllerStyle }), controlsRoot);
    controlNodes.clear();
    for (const node of controlsRoot.querySelectorAll<HTMLButtonElement>('[data-action]')) controlNodes.set(node.dataset.action!, node);
    paintSelection();
  }
  function paintRecommendations() {
    collectionBackdrop.hidden = windowed() || !surface.classList.contains('fullscreen-collection-open');
    render(h(PlaybackRecommendations, { items: recommendations, queue, playlistTitle, playlistTotal, collectionOpen: collectionOpen && (windowed() || surface.classList.contains('fullscreen-collection-open')),
      fullscreenCollection: !windowed() && collectionOpen, closeCollection: () => { if (closeFullCollection()) activate('collectionClosed'); },
      splitQueue: windowed(), failed: recommendationsFailed, openVideo }), recommendationsRoot);
    cardCache = Array.from(recommendationsRoot.querySelectorAll<HTMLButtonElement>('.card')).filter(node => !node.disabled);
    recommendationNodes.clear();
    for (const node of cardCache) recommendationNodes.set(node.dataset.focusId!, node);
    paintSelection();
  }
  function revealCollectionCurrent() {
    if (!collectionOpen || sidePositions.has('collection') || collectionFrame !== undefined) return;
    collectionFrame = requestAnimationFrame(() => {
      collectionFrame = undefined;
      if (destroyed || !collectionOpen || host.hidden) return;
      const container = recommendationsRoot.querySelector<HTMLElement>('.collection-panel');
      const current = container?.querySelector<HTMLElement>('.currently-playing');
      if (!container || !current) return;
      const bounds = container.getBoundingClientRect(), item = current.getBoundingClientRect();
      const heading = container.querySelector<HTMLElement>('.collection-heading')?.offsetHeight || 0;
      if (item.top < bounds.top + heading || item.bottom > bounds.bottom)
        container.scrollTop += item.top - bounds.top - heading - 8;
    });
  }
  let hints: { row: WatchSnapshot['row']; adjusting: boolean; canSeek: boolean } | undefined;
  function paintHints() {
    const next = { row, adjusting, canSeek: model.state.value.canSeek };
    if (hints && equal(hints, next)) return;
    hints = next; render(h(PlaybackHints, { ...next, controllerStyle }), hintsRoot);
  }
  function updatePlaybackControls() {
    const { paused, muted, captionsEnabled, isLive, canSeek, atLiveEdge, seekStep } = model.state.value;
    const next = { paused, muted, captionsEnabled, isLive, canSeek, atLiveEdge, seekStep };
    if (playbackControls && equal(playbackControls, next)) return;
    playbackControls = next; paintControls();
  }
  const presentation: PlaybackPresenter = {
    playback(value) { if (!destroyed) { model.update(value); paintProgress(); updatePlaybackControls(); paintHints(); } },
    visible(value) { if (!destroyed) { model.visible(value); if (value) revealCollectionCurrent(); } },
    page(value, features) {
      if (destroyed) return;
      const hadCollection = hasCollection(), nextQueue = value.queue || [];
      const queueChanged = !sameRecommendations(queue, nextQueue) || playlistTitle !== (value.playlistTitle || '') || playlistTotal !== value.playlistTotal;
      queue = nextQueue; playlistTitle = value.playlistTitle || ''; playlistTotal = value.playlistTotal;
      if (!hasCollection()) { collectionOpen = false; collectionBackdrop.hidden = true; surface.classList.remove('fullscreen-collection-open'); }
      else if (!hadCollection && windowed()) collectionOpen = true;
      const next: Metadata = { title: value.title, channel: value.channel, viewCount: value.viewCount, metadataFailed: value.metadataFailed,
        channelBadge: value.channelBadge, avatar: value.avatar, notificationPreference: value.notificationPreference, subscribed: value.subscribed, liked: value.liked, disliked: value.disliked };
      const headingChanged = ['title', 'channel', 'channelBadge', 'viewCount', 'metadataFailed'].some(key => metadata[key as keyof Metadata] !== next[key as keyof Metadata]);
      const controlsChanged = ['channel', 'channelBadge', 'avatar', 'notificationPreference', 'subscribed', 'liked', 'disliked'].some(key => metadata[key as keyof Metadata] !== next[key as keyof Metadata]);
      metadata = next;
      if (headingChanged) render(h(PlaybackMetadata, { page: metadata, activate }), headingRoot);
      if (controlsChanged || queueChanged) paintControls();
      const failed = features.recommendations === 'failed';
      if (!sameRecommendations(recommendations, value.recommendations) || failed !== recommendationsFailed || queueChanged) {
        recommendations = value.recommendations; recommendationsFailed = failed; paintRecommendations();
        if (queueChanged) revealCollectionCurrent();
      }
    },
    selection(nextRow, nextSelected, nextAdjusting) {
      if (destroyed) return;
      if (row === 'recommendations' && (nextRow !== row || !nextSelected)) rememberSide();
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
      queue = []; playlistTitle = ''; playlistTotal = undefined; collectionOpen = false; collectionBackdrop.hidden = true; surface.classList.remove('fullscreen-collection-open'); sidePositions.clear(); paintControls();
      paintProgress(); updatePlaybackControls(); paintRecommendations(); paintHints();
    },
    destroy() {
      if (destroyed) return; destroyed = true; languageObserver.disconnect(); model.destroy();
      if (collectionFrame !== undefined) cancelAnimationFrame(collectionFrame);
      for (const node of [headingRoot, progressRoot, controlsRoot, recommendationsRoot, hintsRoot, status]) render(null, node);
      controlNodes.clear(); recommendationNodes.clear(); cardCache = []; selectedNode = undefined;
    }
  };
  render(h(PlaybackMetadata, { page: metadata, activate }), headingRoot);
  paintProgress(); updatePlaybackControls(); paintRecommendations(); paintHints();
  const node = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const found = surface.querySelector<T>(selector);
    if (!found) throw new Error('Missing playback view element: ' + selector);
    return found;
  };
  return {
    host, root, surface, player, toggleFullCollection, closeFullCollection, get metadata() { return headingRoot.querySelector<HTMLElement>('[data-focus-id="metadata"]') || undefined; }, dialog, sheet, panelTitle, description, close, status, make,
    sideIndex() {
      const saved = sidePositions.get(sideKey());
      if (!saved) {
        const currentIndex = queue.findIndex(item => item.selected);
        const next = queue.slice(currentIndex + 1).find(item => !item.selected) || queue.slice(0, Math.max(0, currentIndex)).at(-1);
        return !windowed() && collectionOpen && next ? Math.max(0, cardCache.findIndex(node => node.dataset.videoId === next.key)) : 0;
      }
      const index = cardCache.findIndex(node => node.dataset.focusId === saved.id);
      return index >= 0 ? index : Math.max(0, Math.min(saved.index, cardCache.length - 1));
    },
    restoreSideScroll,
    get tabs() { return Array.from(controlsRoot.querySelectorAll<HTMLButtonElement>('.watch-tab')); },
    get progress() { return surface.querySelector<HTMLButtonElement>('.progress') || undefined; },
    get controls() { return [...controlNodes.values()]; }, recommendations: node('.recommendations'),
    updateHint(nextRow, nextAdjusting) {
      if (destroyed) return;
      if (row === 'recommendations' && nextRow !== row) rememberSide();
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
