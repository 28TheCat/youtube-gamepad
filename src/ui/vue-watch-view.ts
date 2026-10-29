import { h, render } from 'vue';
import PlaybackControls from './PlaybackControls.vue';
import PlaybackFeedback from './PlaybackFeedback.vue';
import PlaybackMetadata from './PlaybackMetadata.vue';
import PlaybackRecommendations from './PlaybackRecommendations.vue';
import PlaybackHints from './PlaybackHints.vue';
import Timeline from '../playback/Timeline.vue';
import type { WatchView, WatchViewDependencies, WatchSnapshot, RecommendationFilter, RecommendationSnapshot } from '../../types/ports';
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
  let observedLayout = document.documentElement.dataset.ytgPlaybackLayout;
  const languageObserver = new MutationObserver(records => {
    host.lang = currentLanguage();
    const nextLayout = document.documentElement.dataset.ytgPlaybackLayout;
    if (records.some(record => record.attributeName === 'data-ytg-playback-layout') && nextLayout !== observedLayout) {
      observedLayout = nextLayout;
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
  let recommendations: readonly RecommendationSnapshot[] = [], recommendationsFailed = false, recommendationsLoading = true;
  let recommendationFilters: readonly RecommendationFilter[] = [];
  let queue: readonly RecommendationSnapshot[] = [], playlistTitle = '', playlistTotal: number | undefined, collectionOpen = false;
  const windowed = () => document.documentElement.dataset.ytgPlaybackLayout === 'windowed';
  const collectionRoute = (route: string) => {
    try { const url = new URL(route, 'https://www.youtube.com'); return url.pathname === '/watch' && !!url.searchParams.get('list'); }
    catch { return false; }
  };
  let expectsCollection = collectionRoute(location.href);
  const hasCollection = () => expectsCollection || queue.length > 0;
  collectionOpen = expectsCollection && windowed();
  let collectionFrame: number | undefined;
  let cardCache: HTMLButtonElement[] = [], selectedNode: HTMLElement | undefined;
  const controlNodes = new Map<string, HTMLButtonElement>(), recommendationNodes = new Map<string, HTMLButtonElement>();
  const openVideo = (key: string) => { if (!windowed() && collectionOpen) closeFullCollection(); model.request('recommendation:' + key); };
  const sidePositions = new Map<string, { id: string; index: number; top: number }>();
  const sideKey = () => collectionOpen ? 'collection' : 'recommendations:' + (recommendationFilters.find(item => item.selected)?.key || '');
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
    const node = selected.startsWith('filter:') ? Array.from(recommendationsRoot.querySelectorAll<HTMLButtonElement>('[data-filter-key]')).find(node => node.dataset.filterKey === selected) : selected.startsWith('tab:') ? controlsRoot.querySelectorAll<HTMLButtonElement>('.watch-tab')[Number(selected.slice(4))] : selected === 'player' ? player : selected === 'metadata' ? headingRoot.querySelector<HTMLElement>('[data-focus-id="metadata"]') || undefined : controlNodes.get(selected) || recommendationNodes.get(selected);
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
    render(h(PlaybackRecommendations, { filters: recommendationFilters, selectFilter: (key: string) => { rememberSide(); model.request('recommendationFilter:' + key); }, items: recommendations, queue, playlistTitle, playlistTotal, collectionLoading: expectsCollection && !queue.length && !recommendationsFailed, collectionOpen: collectionOpen && (windowed() || surface.classList.contains('fullscreen-collection-open')),
      fullscreenCollection: !windowed() && collectionOpen, closeCollection: () => { if (closeFullCollection()) activate('collectionClosed'); },
      splitQueue: windowed(), loading: recommendationsLoading, failed: recommendationsFailed, openVideo }), recommendationsRoot);
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
      const nextExpectsCollection = collectionRoute(value.key);
      const queueChanged = expectsCollection !== nextExpectsCollection || !sameRecommendations(queue, nextQueue) || playlistTitle !== (value.playlistTitle || '') || playlistTotal !== value.playlistTotal;
      expectsCollection = nextExpectsCollection;
      // Keep the last rendered queue independent of later updates to API arrays.
      // Otherwise an in-place arrival looks unchanged and skips the collection tab.
      queue = nextQueue.map(item => ({ ...item })); playlistTitle = value.playlistTitle || ''; playlistTotal = value.playlistTotal;
      if (!hasCollection()) { collectionOpen = false; collectionBackdrop.hidden = true; surface.classList.remove('fullscreen-collection-open'); }
      else if (!hadCollection && windowed()) collectionOpen = true;
      const next: Metadata = { title: value.title, channel: value.channel, viewCount: value.viewCount, metadataFailed: value.metadataFailed,
        channelBadge: value.channelBadge, avatar: value.avatar, notificationPreference: value.notificationPreference, subscribed: value.subscribed, liked: value.liked, disliked: value.disliked };
      const headingChanged = ['title', 'channel', 'channelBadge', 'viewCount', 'metadataFailed'].some(key => metadata[key as keyof Metadata] !== next[key as keyof Metadata]);
      const controlsChanged = ['channel', 'channelBadge', 'avatar', 'notificationPreference', 'subscribed', 'liked', 'disliked'].some(key => metadata[key as keyof Metadata] !== next[key as keyof Metadata]);
      metadata = next;
      if (headingChanged) render(h(PlaybackMetadata, { page: metadata, activate }), headingRoot);
      if (controlsChanged || queueChanged) paintControls();
      const previousFilter = recommendationFilters.find(item => item.selected)?.key;
      const filtersChanged = JSON.stringify(recommendationFilters) !== JSON.stringify(value.recommendationFilters || []);
      recommendationFilters = (value.recommendationFilters || []).map(item => ({ ...item }));
      const failed = features.recommendations === 'failed';
      const loading = value.recommendationsLoading === true;
      if (!sameRecommendations(recommendations, value.recommendations) || failed !== recommendationsFailed || loading !== recommendationsLoading || queueChanged || filtersChanged) {
        recommendations = value.recommendations; recommendationsFailed = failed; recommendationsLoading = loading; paintRecommendations();
        if (previousFilter !== recommendationFilters.find(item => item.selected)?.key && !collectionOpen) {
          const container = recommendationsRoot.querySelector<HTMLElement>('.recommendations');
          if (container) container.scrollTop = sidePositions.get(sideKey())?.top || 0;
        }
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
      model.reset(); selected = ''; adjusting = false; row = 'controls'; recommendationFilters = []; recommendations = []; recommendationsFailed = false; recommendationsLoading = true;
      metadata = { title: '', channel: '' }; render(h(PlaybackMetadata, { page: metadata, activate }), headingRoot);
      queue = []; playlistTitle = ''; playlistTotal = undefined; expectsCollection = collectionRoute(location.href); collectionOpen = expectsCollection && windowed(); collectionBackdrop.hidden = true; surface.classList.remove('fullscreen-collection-open'); sidePositions.clear(); paintControls();
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
    get filters() { return Array.from(recommendationsRoot.querySelectorAll<HTMLButtonElement>('[data-filter-key]')); },
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
