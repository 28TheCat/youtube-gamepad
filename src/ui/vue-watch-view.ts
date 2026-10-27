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

export function createVueWatchView({ activate, seek, closePanel, controllerStyle, styles }: WatchViewDependencies): WatchView {
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
  const dialog = make('div', 'dialog'); dialog.hidden = true; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Video description');
  const sheet = make('section', 'sheet'), panelTitle = make('h2', '', 'Video description'), description = make('div', 'description'), close = make('button', 'control', 'Back');
  controllerStyle.bind(close, 'Back'); controllerStyle.bind(panelTitle, 'Video description'); controllerStyle.bind(dialog, 'Video description', 'aria-label');
  const languageObserver = new MutationObserver(records => {
    host.lang = currentLanguage();
    if (records.some(record => record.attributeName === 'data-ytg-playback-layout')) {
      collectionOpen = windowed() && hasCollection(); paintControls(); paintRecommendations(); revealCollectionCurrent();
    }
  });
  languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ytg-language', 'data-ytg-playback-layout'] });
  close.addEventListener('click', closePanel); sheet.append(panelTitle, description, close); dialog.append(sheet);
  const status = make('div', 'status'); status.setAttribute('role', 'status');
  root.append(style, surface, dialog, status); document.body.append(host);
  let destroyed = false;
  const model = createPlaybackModel({ activate, seek: seconds => seek ? seek(seconds) : false });
  let metadata: Metadata = { title: '', channel: '' };
  let playbackControls: PlaybackControlState | undefined;
  let selected = '', adjusting = false, row: WatchSnapshot['row'] = 'controls', commentsOpen = false;
  let recommendations: readonly RecommendationSnapshot[] = [], recommendationsFailed = false;
  let queue: readonly RecommendationSnapshot[] = [], playlistTitle = '', collectionOpen = false;
  const windowed = () => document.documentElement.dataset.ytgPlaybackLayout !== 'fullscreen';
  const hasCollection = () => queue.length > 0;
  let collectionFrame: number | undefined;
  let cardCache: HTMLButtonElement[] = [], selectedNode: HTMLElement | undefined;
  const controlNodes = new Map<string, HTMLButtonElement>(), recommendationNodes = new Map<string, HTMLButtonElement>();
  const openVideo = (key: string) => model.request('recommendation:' + key);
  function activateTab(action: string) {
    if (action === 'collection' || action === 'recommendations') {
      collectionOpen = action === 'collection' && hasCollection() && windowed();
      paintRecommendations(); paintControls(); revealCollectionCurrent();
      activate('recommendations');
    } else model.request(action);
  }
  const equal = <T extends object>(left: T, right: T) => {
    const keys = Object.keys(left) as (keyof T)[];
    return keys.length === Object.keys(right).length && keys.every(key => Object.is(left[key], right[key]));
  };
  function paintSelection() {
    const node = selected === 'player' ? player : selected === 'metadata' ? headingRoot.querySelector<HTMLElement>('[data-focus-id="metadata"]') || undefined : controlNodes.get(selected) || recommendationNodes.get(selected);
    if (selectedNode !== node) selectedNode?.classList.remove('selected');
    node?.classList.add('selected'); selectedNode = node;
  }
  function paintProgress() {
    render(h(Timeline, { model, state: model.state.value, selected: selected === 'progress', adjusting, controllerStyle }), progressRoot);
  }
  function paintControls() {
    render(h(PlaybackControls, { page: metadata, playback: playbackControls!, commentsOpen, hasCollection: hasCollection() && windowed(), collectionOpen,
      activate: activateTab, controllerStyle }), controlsRoot);
    if (!controlNodes.size) for (const node of controlsRoot.querySelectorAll<HTMLButtonElement>('[data-action]')) controlNodes.set(node.dataset.action!, node);
    paintSelection();
  }
  function paintRecommendations() {
    render(h(PlaybackRecommendations, { items: recommendations, queue, playlistTitle, collectionOpen,
      splitQueue: windowed(), failed: recommendationsFailed, openVideo }), recommendationsRoot);
    cardCache = Array.from(recommendationsRoot.querySelectorAll<HTMLButtonElement>('.card')).filter(node => !node.disabled);
    recommendationNodes.clear();
    for (const node of cardCache) recommendationNodes.set(node.dataset.focusId!, node);
    paintSelection();
  }
  function revealCollectionCurrent() {
    if (!collectionOpen || collectionFrame !== undefined) return;
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
      const queueChanged = !sameRecommendations(queue, nextQueue) || playlistTitle !== (value.playlistTitle || '');
      queue = nextQueue; playlistTitle = value.playlistTitle || '';
      if (!hasCollection()) collectionOpen = false;
      else if (!hadCollection && windowed()) collectionOpen = true;
      const next: Metadata = { title: value.title, channel: value.channel, viewCount: value.viewCount,
        channelBadge: value.channelBadge, avatar: value.avatar, notificationPreference: value.notificationPreference, subscribed: value.subscribed, liked: value.liked, disliked: value.disliked };
      const headingChanged = ['title', 'channel', 'channelBadge', 'viewCount'].some(key => metadata[key as keyof Metadata] !== next[key as keyof Metadata]);
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
      queue = []; playlistTitle = ''; collectionOpen = false; paintControls();
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
    host, root, surface, player, get metadata() { return headingRoot.querySelector<HTMLElement>('[data-focus-id="metadata"]') || undefined; }, dialog, sheet, panelTitle, description, close, status, make,
    cycleTab(direction: number) {
      if (!windowed()) return false;
      const tabs = hasCollection() ? ['collection', 'recommendations', 'comments'] : ['recommendations', 'comments'];
      const current = commentsOpen ? 'comments' : collectionOpen ? 'collection' : 'recommendations';
      activateTab(tabs[(tabs.indexOf(current) + direction + tabs.length) % tabs.length]);
      return true;
    },
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
