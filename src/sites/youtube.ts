import { pageQuery, pageQueryAll } from '../shared/page-dom';
import { searchHref } from '../shared/explore-pages';
import { PAGE_WATCH_NEXT, PAGE_COMMENTS, PAGE_WATCH_INFO } from '../bridge/page-protocol';
import type { Capability, ModuleFactory, NavigationPolicy, SearchTarget, SiteDependencies, SitePort, WatchAction, WatchPageSnapshot } from '../../types/ports';

import type { NavigationConfig, InteractiveElement } from '../../types/core';
type Mutable<T> = {-readonly [K in keyof T]: T[K]};

import { YTGamepadSeeking } from '../playback/seek';
import { createNativePlayerControls } from './native-player-controls';
import { playbackParameterDefaults, normalizePlaybackParameters } from '../shared/playback-settings';
export let YTGamepadSite: SitePort | undefined, YTGamepadSiteModule!: ModuleFactory<SiteDependencies,SitePort>;
(() => {
  /** @param {import('../../types/ports.js').SiteDependencies} dependencies */
  function create({ runtime, diagnostics, focusManager, pageAccess = undefined }: import('../../types/ports.js').SiteDependencies) {
  const lifecycle = runtime.scope('site');
  const nativePlayer = createNativePlayerControls(lifecycle);
  let playbackParameters = { ...playbackParameterDefaults };
  function configurePlayback(values: Partial<typeof playbackParameters>) {
    const next = normalizePlaybackParameters(values);
    if (next.seekStep !== playbackParameters.seekStep) seekRun = undefined;
    playbackParameters = next;
  }
  const getVideo = () => document.querySelector<HTMLVideoElement>('video.html5-main-video') || document.querySelector<HTMLVideoElement>('video');
  let speedSession: { video: HTMLVideoElement; rate: number; applied: number; route: string; source: string } | undefined;
  let speedInterrupted = false;
  function restoreSpeed() {
    const saved = speedSession;
    speedSession = undefined;
    if (saved) speedInterrupted = true;
    // Respect a new speed chosen through YouTube while our override was active.
    if (saved && saved.video.playbackRate === saved.applied) {
      try { saved.video.playbackRate = saved.rate; } catch (error) { diagnostics?.record('site', 'restoreSpeed', error); }
    }
  }
  function temporarySpeed(held: boolean): number | false {
    if (!held) { restoreSpeed(); speedInterrupted = false; return false; }
    if (speedInterrupted) return false;
    const video = getVideo(), route = location.pathname + location.search;
    if (speedSession) {
      if (video !== speedSession.video || route !== speedSession.route || video?.currentSrc !== speedSession.source ||
          video.isConnected === false || video.paused || video.ended || video.playbackRate !== speedSession.applied) {
        restoreSpeed(); return false;
      }
      return speedSession.applied;
    }
    if (location.pathname !== '/watch' || !video || video.paused || video.ended || video.isConnected === false ||
        !Number.isFinite(video.duration) || video.duration <= 0 || readTimeline(video).isLive ||
        !Number.isFinite(video.playbackRate) || video.playbackRate <= 0 || video.playbackRate >= 2) return false;
    speedSession = { video, rate: video.playbackRate, applied: 2, route, source: video.currentSrc };
    try { video.playbackRate = 2; }
    catch { restoreSpeed(); return false; }
    return 2;
  }
  lifecycle.cleanup(restoreSpeed);
  if (typeof document !== 'undefined') {
  for (const event of ['yt-navigate-start', 'yt-navigate-finish']) lifecycle.listen(document, event, restoreSpeed);
  for (const event of ['pause', 'ended', 'emptied', 'loadstart']) lifecycle.listen(document, event, e => {
    if (e.target === speedSession?.video) restoreSpeed();
  }, true);
  lifecycle.listen(document, 'ratechange', e => {
    if (e.target === speedSession?.video && speedSession.video.playbackRate !== speedSession.applied) restoreSpeed();
  }, true);
  lifecycle.listen(document, 'visibilitychange', () => { if (document.hidden) restoreSpeed(); });
  }
  if (typeof window !== 'undefined') for (const event of ['blur', 'pagehide', 'popstate']) lifecycle.listen(window, event, restoreSpeed);
  const progressSelector = '.ytp-progress-bar';
  // Keep preview handling in the site adapter: never pause the main watch player.
  const cardSelector = 'ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer,ytd-grid-video-renderer,yt-lockup-view-model';
  const previewSelector = 'ytd-video-preview,ytd-moving-thumbnail-renderer,yt-video-preview-view-model,#inline-preview-player';
  let suppressPreviews = false;
  function isPreviewVideo(node: EventTarget | null): node is HTMLVideoElement {
    if (!node || !('matches' in node)) return false;
    const element = node as HTMLElement;
    return element.matches('video') && !element.closest<import('../../types/core').YouTubePlayer>('#movie_player') && Boolean(element.closest<HTMLElement>(previewSelector + ',' + cardSelector));
  }
  function stopPreviews() {
    for (const video of document.querySelectorAll<HTMLVideoElement>('video')) if (isPreviewVideo(video) && !video.paused) video.pause();
  }
  function cancelHover() {
    // Let YouTube's own leave handlers clear their private hover timers.
    const hovered: Set<HTMLElement> = new Set();
    for (const card of document.querySelectorAll<HTMLElement>(cardSelector.split(',').map(selector => `${selector}:hover`).join(','))) {
      hovered.add(card);
      for (const node of card.querySelectorAll<HTMLElement>(':hover')) hovered.add(node);
    }
    for (const node of [...hovered].reverse()) {
      for (const type of ['pointerout', 'pointerleave', 'mouseout', 'mouseleave']) {
        const EventType = type.startsWith('pointer') ? PointerEvent : MouseEvent;
        node.dispatchEvent(new EventType(type, { bubbles: type.endsWith('out'), relatedTarget: document.documentElement, pointerType: 'mouse' }));
      }
    }
  }
  if (typeof document !== 'undefined' && document.body) {
    lifecycle.listen(window, 'yt-gamepad-input-mode', e => {
      suppressPreviews = e.detail.mode === 'gamepad';
      if (!suppressPreviews) return;
      cancelHover(); stopPreviews();
    });
    lifecycle.listen(document, 'play', e => {
      if (suppressPreviews && isPreviewVideo(e.target)) { e.target.pause(); e.stopImmediatePropagation(); }
    }, true);
    for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']) {
      lifecycle.listen(document, type, e => {
        if (suppressPreviews && (e.target as HTMLElement | null)?.closest?.(cardSelector + ',' + previewSelector)) e.stopImmediatePropagation();
      }, true);
    }
  }
  let seekRun: { video: HTMLVideoElement; route: string; action: string; time: number; distance: number } | undefined;
  function perform(action: string) {
    if (action !== 'seekBack' && action !== 'seekForward') seekRun = undefined;
    if (action === 'playPause') {
      const button = document.querySelector<HTMLElement>('.ytp-play-button');
      if (button) { button.click(); return true; }
    }
    const video = getVideo();
    if (!video) return false;
    if (action === 'pause') video.pause();
    else if (action === 'playPause') { if (video.paused) return Promise.resolve(video.play()).then(() => true); else video.pause(); }
    else if (action === 'captions') {
      const button = document.querySelector<HTMLElement>('.ytp-subtitles-button');
      if (!button || button.getAttribute('aria-disabled') === 'true' || getComputedStyle(button).display === 'none') return false;
      button.click();
    }
    else if (action === 'mute') video.muted = !video.muted;
    else if (action === 'seekBack' || action === 'seekForward') {
      const time = Date.now(), route = location.pathname + location.search;
      const distance = seekRun?.video === video && seekRun.route === route && seekRun.action === action && time - seekRun.time < 600
        ? seekRun.distance : 0;
      // Keep the familiar single-tap step; accelerate only a continuous run.
      const step = YTGamepadSeeking.step(distance, playbackParameters.seekStep);
      const before = video.currentTime;
      const ok = seekTo(before + (action === 'seekBack' ? -step : step));
      seekRun = ok ? { video, route, action, time, distance: distance + Math.abs(video.currentTime - before) } : undefined;
      return ok;
    }
    else if (action === 'goLive') {
      const timeline = readTimeline(video);
      return timeline.isLive && timeline.canSeek && seekTo(timeline.end);
    }
    else if (action === 'volumeUp' || action === 'volumeDown') {
      const step = playbackParameters.volumeStep / 100;
      video.volume = Math.min(1, Math.max(0, video.volume + (action === 'volumeUp' ? step : -step)));
    }
    else return false;
    return true;
  }
  function switchBrowseCategory(direction: number) {
    // Include horizontally clipped chips, but exclude hidden SPA pages and dialogs.
    const chips = pageQueryAll<HTMLElement>('[data-ytg-category]').filter(chip => {
      if (!chip.isConnected || chip.closest<HTMLElement>('[hidden],[aria-hidden="true"],[inert]') ||
          chip.getAttribute('aria-disabled') === 'true' || chip.hasAttribute('disabled')) return false;
      const rect = chip.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      for (let node: HTMLElement | null = chip; node && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    }).sort((a, b) => Number(a.getAttribute('data-ytg-category-order') || 0) - Number(b.getAttribute('data-ytg-category-order') || 0));
    const active = chips.findIndex(chip => chip.getAttribute('selected') === '' || chip.getAttribute('selected') === 'true' ||
      chip.getAttribute('aria-selected') === 'true' || chip.querySelector<HTMLElement>('[aria-selected="true"],[aria-pressed="true"],.ytChipShapeActive'));
    if (active < 0) return 'blocked';
    const target = chips[active + direction];
    if (!target) return 'blocked';
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    // New chip renderers attach activation to the inner button, not the host.
    const button = target.querySelector<HTMLElement>('button,[role="button"]') || target;
    if ((button as InteractiveElement).disabled || button.getAttribute('aria-disabled') === 'true') return 'blocked';
    button.click();
    return 'handled';
  }
  function showNativeControls() {
    pageAccess?.showControls();
    return document.querySelector<HTMLElement>('.ytp-play-button');
  }
  // Only this adapter retains references to native YouTube elements. Views get
  // snapshots and opaque keys; all native writes come back through these ports.
  const nextDestinations = new Map<string, string>();
  let channelId = '';
  const nativeLayerSelector = '[role="dialog"],tp-yt-paper-dialog,ytd-popup-container tp-yt-iron-dropdown,ytd-menu-popup-renderer,ytd-modal-with-title-and-button-renderer,ytd-add-to-playlist-renderer,.ytp-settings-menu';
  function watchTargetAvailable(target: InteractiveElement | null | undefined): target is InteractiveElement {
    // Our CSS hides #below during playback. Reject inactive native variants by
    // their attributes, without rejecting the entire hidden metadata section.
    return !!target && target.isConnected !== false && !target.disabled && target.getAttribute('aria-disabled') !== 'true' &&
      !target.closest?.<HTMLElement>('[hidden],[aria-hidden="true"]');
  }
  function performWatchAction(action: WatchAction): boolean | Promise<boolean> {
    if (!readRoute().isWatch || !['subscribe', 'like', 'dislike', 'unsubscribe', 'notificationsAll', 'notificationsPersonalized', 'notificationsNone'].includes(action)) return false;
    return pageAccess?.watchAction?.(action as 'like' | 'dislike' | 'subscribe' | 'unsubscribe' | 'notificationsAll' | 'notificationsPersonalized' | 'notificationsNone') || false;
  }
  /** @returns {import('../../types/ports.js').RouteSnapshot} */
  const readRoute = () => ({ key: location.pathname + location.search, isWatch: location.pathname === '/watch' });
  const watchFeatures: Record<string,Capability> = {};
  let confirmedMetadata: { route: string; page: WatchPageSnapshot; channelId: string } | undefined;
  function diagnoseSite(operation: string, error: unknown) {
    try { diagnostics?.record('site', operation, error, {
      route: location.pathname === '/watch' ? 'watch' : 'browse'
    }); } catch (_) {}
  }
  function optionalFeature<T>(name: string, read: () => T, fallback: () => T): T {
    const fail = (error: unknown): T => { diagnoseSite('optional.' + name, error); watchFeatures[name] = 'failed'; return fallback(); };
    try {
      const result = read();
      return result && typeof (result as {then?:unknown}).then === 'function' ? Promise.resolve(result).catch(fail) as T : result;
    } catch (error) { return fail(error); }
  }
  function inspectOptionalCapabilities() {
    const probes = {
      settings: () => document.querySelector<HTMLElement>('.ytp-settings-button'),
      captions: () => document.querySelector<HTMLElement>('.ytp-subtitles-button'),
    };
    for (const [name, probe] of Object.entries(probes)) {
      optionalFeature(name, () => { watchFeatures[name] = watchTargetAvailable(probe()) ? 'available' : 'missing'; }, () => {});
    }
    optionalFeature('comments', () => { readComments(); }, () => {});
    optionalFeature('recommendations', () => {
      const next = pageAccess?.readWatchNext?.();
      watchFeatures.recommendations = next?.failed ? 'failed' : next ? 'available' : 'missing';
    }, () => {});
    return { ...watchFeatures };
  }
  function inspectWatchCapabilities(requireDestinationReady = false) {
    const missing = [];
    try {
      const player = document.querySelector<import('../../types/core').YouTubePlayer>('#movie_player'), video = getVideo();
      if (!player || player.isConnected === false) missing.push('player');
      if (!video || video.isConnected === false || typeof video.play !== 'function' || typeof video.pause !== 'function' ||
          (player?.contains && !player.contains(video))) missing.push('video playback');
      // YouTube reuses its player across SPA routes; an old response is not ready.
      // API metadata can arrive after decoded media; it must not gate controls.
      let videoId;
      try { videoId = pageAccess?.readPlayerVideoId ? pageAccess.readPlayerVideoId() : pageAccess?.readVideoDetails()?.videoId; } catch (_) {}
      if (pageAccess?.available === false) missing.push('page interface');
      if (videoId) {
        const expectedId = new URLSearchParams(location.search).get('v');
        if (expectedId && videoId !== expectedId) missing.push('current video');
      }
      // Before yt-navigate-finish, require positive evidence that this is the
      // destination, rather than authorizing a reused player with no metadata.
      if (requireDestinationReady) {
        if (!videoId) missing.push('current video');
        if (!video || video.readyState < 2 || !(video.videoWidth > 0)) missing.push('video frames');
      }
      // Only the media/player contract can force a full native fallback.
      return { ready: missing.length === 0, missing };
    } catch (error) { diagnoseSite('inspectWatchCapabilities', error); return { ready: false, failed: true, missing: ['player interface'] }; }
  }
  function restoreNativeInterface() {
    for (const name of ['ytg-playback', 'ytg-controls', 'ytg-watch-active', 'ytg-recommendations', 'ytg-comments', 'ytg-settings-open']) {
      document.documentElement.classList.remove?.(name);
      document.documentElement.classList.toggle(name, false);
    }
    const host = document.querySelector<HTMLElement>('#ytg-watch');
    if (host) host.hidden = true;
  }
  function readTimeline(video: HTMLVideoElement) {
    let live = false;
    try { live = pageAccess?.readVideoDetails()?.isLive === true; } catch (_) {}
    const isLive = live || video.duration === Infinity, ranges = [];
    // VOD may expose only loaded media segments. Those boundaries must not
    // prevent a seek that asks the native player to load another segment.
    if (!isLive && Number.isFinite(video.duration) && video.duration > 0) {
      ranges.push({ start: 0, end: video.duration });
    } else {
      for (let i = 0; i < (video.seekable?.length || 0); i++) {
        const start = video.seekable.start(i), end = video.seekable.end(i);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) ranges.push({ start, end });
      }
    }
    const start = ranges[0]?.start || 0, end = ranges.at(-1)?.end || 0;
    return { isLive, canSeek: ranges.length > 0, start, end, ranges,
      atLiveEdge: isLive && ranges.length > 0 && video.currentTime >= end - 2 };
  }
  /** @returns {import('../../types/ports.js').PlaybackSnapshot} */
  function readPlayback() {
    const video = getVideo(), caption = optionalFeature('captions', () => document.querySelector<HTMLElement>('.ytp-subtitles-button'), () => null);
    const ratio = video && video.videoWidth > 0 && video.videoHeight > 0
      ? String(video.videoWidth / video.videoHeight) : '';
    const rootStyle = document.documentElement.style;
    if (rootStyle.getPropertyValue('--ytg-video-ratio') !== ratio) {
      if (ratio) rootStyle.setProperty('--ytg-video-ratio', ratio);
      else rootStyle.removeProperty('--ytg-video-ratio');
    }
    return {
      video: video ? { currentTime: video.currentTime, duration: video.duration, paused: video.paused, ended: video.ended, volume: video.volume, muted: video.muted, timeline: readTimeline(video) } : null,
      seekStep: playbackParameters.seekStep,
      captionsEnabled: optionalFeature('captions', () => caption?.getAttribute('aria-pressed') === 'true', () => false),
      settingsOpen: optionalFeature('settings', settingsOpen, () => false)
    };
  }
  function settingsOpen() {
    const menu = document.querySelector<HTMLElement>('.ytp-settings-menu');
    return Boolean(menu && menu.getBoundingClientRect().height > 0 && getComputedStyle(menu).display !== 'none');
  }
  function openSettings() {
    const button = document.querySelector<HTMLElement>('.ytp-settings-button');
    if (!button) return false;
    button.click(); return true;
  }
  function backSettings(menu = document.querySelector<HTMLElement>('.ytp-settings-menu')) {
    if (!menu) return false;
    const parent = menu.querySelector<HTMLElement>('.ytp-panel-back,.ytp-panel-back-button,.ytp-panel-header button');
    if (parent && (!parent.getBoundingClientRect || parent.getBoundingClientRect().height > 0)) parent.click();
    else {
      document.querySelector<HTMLElement>('.ytp-settings-button')?.click();
      pageAccess?.hideControls();
    }
    return true;
  }
  function seekTo(value: number) {
    const video = getVideo();
    if (!video || !Number.isFinite(value)) return false;
    const { ranges, canSeek } = readTimeline(video);
    if (!canSeek) return false;
    // Re-read the moving window and snap gaps to the nearest valid boundary.
    let target = value, distance = Infinity;
    for (const range of ranges) {
      const candidate = Math.min(range.end, Math.max(range.start, value));
      if (Math.abs(candidate - value) < distance) { target = candidate; distance = Math.abs(candidate - value); }
    }
    video.currentTime = target; return true;
  }
  /** @returns {import('../../types/ports.js').WatchPageSnapshot} */
  function readWatchPage() {
    const route = readRoute(), id = new URLSearchParams(location.search).get('v');
    nextDestinations.clear(); channelId = '';
    const page: Mutable<WatchPageSnapshot> = { ...route, waiting: false, title: '', channel: '', avatar: '', subscribed: false, liked: false, disliked: false, viewCount: null, description: '', recommendations: [] };
    if (confirmedMetadata?.route !== route.key) confirmedMetadata = undefined;
    if (!route.isWatch) return page;
    // Metadata has one error boundary; recommendations continue independently.
    const metadata = optionalFeature('metadata', () => {
      const details = pageAccess?.readVideoDetails();
      if (details?.videoId && details.videoId !== id) return { stale: true } as const;
      const info = pageAccess?.readWatchInfo?.();
      return { details, info };
    }, () => undefined);
    const stale = metadata && 'stale' in metadata;
    if (stale) confirmedMetadata = undefined;
    const details = metadata && !('stale' in metadata) ? metadata.details : undefined;
    const info = metadata && !('stale' in metadata) ? metadata.info : undefined;
    const metadataFailed = !metadata || info?.failed === true;
    if ((!details || metadataFailed) && confirmedMetadata) {
      Object.assign(page, confirmedMetadata.page);
      channelId = confirmedMetadata.channelId;
    } else {
      channelId = details?.channelId || '';
      page.title = details?.title || '';
      page.channel = details?.author || '';
      page.description = details?.shortDescription || '';
      page.viewCount = details?.viewCount ?? null;
      page.avatar = info?.avatar || '';
      page.channelBadge = info?.channelBadge;
      page.subscribed = info?.subscribed || false;
      page.notificationPreference = info?.notificationPreference;
      page.liked = info?.liked || false;
      page.disliked = info?.disliked || false;
    }
    page.waiting = !!stale || info?.loading === true && !details;
    page.metadataFailed = metadataFailed;
    if (details?.videoId === id && !metadataFailed) confirmedMetadata = { route: route.key, page: { ...page }, channelId };
    watchFeatures.metadata = metadataFailed ? 'failed' : details ? 'available' : 'missing';
    watchFeatures.channel = channelId ? 'available' : 'missing';
    watchFeatures.like = watchFeatures.dislike = !metadataFailed && info?.canLike && !info.working ? 'available' : 'missing';
    watchFeatures.subscribe = !metadataFailed && info?.canSubscribe && !info.working ? 'available' : 'missing';
    watchFeatures.save = !metadataFailed && info?.canSave && !info.working ? 'available' : 'missing';
    if (pageAccess?.readWatchNext) {
      nextDestinations.clear();
      const next = optionalFeature('recommendations', () => pageAccess.readWatchNext!(), () => undefined);
      if (next?.route === route.key) {
        page.recommendationsLoading = next.loading;
        page.recommendationFilters = next.filters;
        page.queue = next.queue;
        page.playlistTitle = next.playlistTitle;
        page.playlistTotal = next.playlistTotal;
        // Queue entries retain playlist positions and are shown before related videos.
        page.recommendations = [...next.queue.filter(item => !item.selected), ...next.recommendations];
        for (const item of page.recommendations) if (item.href) nextDestinations.set(item.key, item.href);
        watchFeatures.recommendations = next.failed ? 'failed' : 'available';
      } else if (watchFeatures.recommendations !== 'failed') watchFeatures.recommendations = 'missing';
    } else watchFeatures.recommendations = 'missing';
    return page;
  }
  function loadRecommendations(kind?: 'queue' | 'recommendations') { return pageAccess?.moreWatchNext?.(kind) || false; }
  function openRecommendation(key: string, prepareVideo: (href: string) => boolean) {
    if (pageAccess?.readWatchNext) {
      const next = pageAccess.readWatchNext();
      if (next?.route !== readRoute().key) return 'missing';
      const href = nextDestinations.get(key);
      if (!href || ![...next.queue, ...next.recommendations].some(item => item.key === key && item.href === href)) return 'missing';
      if (prepareVideo(href) === false) return 'blocked';
      if (pageAccess.openWatchVideo?.(href)) return 'opened';
      // Keep the current document and player when in-page navigation fails.
      document.dispatchEvent(new Event('yt-navigate-cancel'));
      return 'failed';
    }
    return 'missing';
  }
  function openChannel(beforeNavigate: () => void) {
    if (!channelId) return false;
    beforeNavigate();
    const href = `/channel/${encodeURIComponent(channelId)}`;
    if (pageAccess?.openBrowseRoute?.(href)) return true;
    location.assign(href); return true;
  }
  /** @returns {readonly import('../../types/ports.js').CommentSnapshot[]} */
  function readComments() {
    const comments = pageAccess?.readComments?.();
    watchFeatures.comments = comments?.failed ? 'failed' : 'available';
    return comments?.items || [];
  }
  function expandReplies(key: string) {
    return pageAccess?.commentReplies?.(key) || false;
  }
  function translateComment(key: string) {
    const comments = pageAccess?.readComments?.()?.items || [];
    const item = comments.find(item => item.key === key) || comments.flatMap(item => item.replies).find(item => item.key === key);
    return item?.translationTarget ? pageAccess?.commentTranslate?.(key, item.translationTarget) || false : false;
  }
  function loadComments(start = false) {
    return pageAccess?.moreComments?.(start) || false;
  }
  const getSearchTarget = () => pageQuery<HTMLInputElement>('#ytg-search-host:not([hidden]) [data-ytg-search-input]');
  const readTheme = () => document.documentElement.hasAttribute?.('dark') ?? true;
  function moveSearchCursor(target: SearchTarget, cursor: [number,number]) { target?.setSelectionRange?.(...cursor); }
  function readSearch(target: SearchTarget | undefined) { return (target?.isConnected ? target : getSearchTarget())?.value ?? new URLSearchParams(location.search).get('search_query') ?? ''; }
  function syncSearch(target: SearchTarget, value: string, cursor: [number,number]) {
    if (!target?.isConnected) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(target, value); else target.value = value;
    target.setSelectionRange?.(...cursor);
    target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
  function submitSearch(target: SearchTarget, query: string, beforeNavigate: () => void) {
    const href = searchHref(query);
    if (!href) return false;
    if (target?.matches?.('[data-ytg-search-input]')) syncSearch(target, query.trim(), [query.trim().length, query.trim().length]);
    beforeNavigate();
    if (!pageAccess?.openBrowseRoute?.(href)) location.assign(href);
    return true;
  }
  function observePage(onChange: () => void) {
    const releaseInfo = lifecycle.listen(document, PAGE_WATCH_INFO, () => { if (location.pathname === '/watch') onChange(); });
    const releaseNext = lifecycle.listen(document, PAGE_WATCH_NEXT, () => { if (location.pathname === '/watch') onChange(); });
    const releaseComments = lifecycle.listen(document, PAGE_COMMENTS, () => { if (location.pathname === '/watch') onChange(); });
    if (typeof MutationObserver === 'undefined' || !document.body) return () => { releaseInfo(); releaseNext(); releaseComments(); };
    let timer: number | undefined;
    const observer = lifecycle.observer(records => {
      if (timer || records.every(record => (record.target as HTMLElement).closest?.('#ytg-watch,#yt-gamepad-menu,#yt-gamepad-overlay,#secondary,#related,ytd-watch-next-secondary-results-renderer') || ignorePlayerMutation(record))) return;
      timer = lifecycle.timeout(() => { timer = undefined; onChange(); }, 250);
    });
    const bind = () => {
      observer.disconnect(); lifecycle.clearTimeout(timer); timer = undefined;
      if (location.pathname === '/watch') observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'subscribed', 'src'] });
    };
    const releases = [releaseInfo, releaseNext, releaseComments, lifecycle.listen(document, 'yt-navigate-start', () => { observer.disconnect(); lifecycle.clearTimeout(timer); timer = undefined; }),
      lifecycle.listen(document, 'yt-navigate-finish', bind), lifecycle.listen(document, 'yt-navigate-cancel', bind),
      lifecycle.listen(document, 'yt-navigate-error', bind), lifecycle.listen(window, 'popstate', bind)];
    bind();
    return () => { for (const release of releases) release(); observer.disconnect(); lifecycle.clearTimeout(timer); };
  }
  function ignorePlayerMutation(record: MutationRecord) {
    const target = record.target.nodeType === 3 ? record.target.parentElement : record.target as HTMLElement;
    if (typeof document !== 'undefined' && !document.documentElement.hasAttribute?.('data-ytg-native') && !target?.closest?.(nativeLayerSelector)) {
      if (document.documentElement.classList.contains('ytg-custom-browse') &&
          target?.closest?.('ytd-page-manager,ytd-feed-filter-chip-bar-renderer,yt-chip-cloud-chip-renderer')) return true;
      if (pageAccess?.readWatchNext && document.documentElement.classList.contains('ytg-watch-active') &&
          target?.closest?.('#secondary,#related,ytd-watch-next-secondary-results-renderer')) return true;
    }
    if (!target || !target.closest?.<import('../../types/core').YouTubePlayer>('#movie_player')) return false;
    // Native controls/menus still participate in navigation. Only the animated
    // video, progress and subtitle subtrees are irrelevant to page focus/data.
    if (target.closest<HTMLElement>('.html5-video-container,.ytp-caption-window-container')) return true;
    const progress = target.closest<HTMLElement>('.ytp-progress-bar');
    // The progress bar itself is a navigation target: preserve its visibility
    // changes, and filter only animation of its non-interactive descendants.
    return !!progress && target !== progress;
  }
  // Policy supplies mode and callbacks; this adapter only implements native page operations.
  function createNavigationConfig(controller: NavigationPolicy): NavigationConfig {
    const browseChips = () => pageQueryAll<HTMLElement>('[data-ytg-category]').filter(chip =>
      chip.isConnected && !chip.closest<HTMLElement>('[hidden],[aria-hidden="true"],[inert]') && chip.getBoundingClientRect().width > 0 && getComputedStyle(chip).visibility !== 'hidden');
    const chipKey = (chip: HTMLElement) => chip.getAttribute('aria-label') || chip.textContent.trim();
    const chipSelected = (chip: HTMLElement) => chip.getAttribute('selected') === '' || chip.getAttribute('selected') === 'true' ||
      chip.getAttribute('aria-selected') === 'true' || Boolean(chip.querySelector<HTMLElement>('[aria-selected="true"],[aria-pressed="true"],.ytChipShapeActive'));
    const browseFeed = () => pageQueryAll<HTMLElement>('#ytg-browse-grid a[data-browse-id]')
      .filter(link => !link.closest<HTMLElement>('[hidden],[aria-hidden="true"]')).map(link => link.getAttribute('href')).join('|');
    return {
      captureBrowseState() {
        if (location.pathname === '/watch' || location.pathname.startsWith('/shorts/')) return null;
        const chip = browseChips().find(chipSelected);
        const grid = pageQuery<HTMLElement>('#ytg-browse-grid [data-ytg-browse-grid]');
        return chip || grid ? { category: chip ? chipKey(chip) : undefined, gridScroll: grid?.scrollTop } : null;
      },
      restoreBrowseState(saved, attempt) {
        if (!saved) return true;
        const restoreScroll = () => {
          const grid = pageQuery<HTMLElement>('#ytg-browse-grid [data-ytg-browse-grid]');
          if (saved.gridScroll != null && grid) {
            grid.scrollTop = saved.gridScroll;
            return Math.abs(grid.scrollTop - saved.gridScroll) <= 1;
          }
          return true;
        };
        if (!saved.category) return restoreScroll();
        const chip = browseChips().find(item => chipKey(item) === saved.category);
        if (!chip) return false;
        if (chipSelected(chip)) return pageQuery<HTMLElement>('#ytg-browse-grid')?.dataset.feedLoading !== 'true' && (!attempt.activated || browseFeed() !== attempt.previousFeed) && restoreScroll();
        // The Vue category button owns API loading.
        if (!attempt.activated) {
          const button = chip.querySelector<HTMLElement>('button,[role="button"]') || chip;
          if ((button as InteractiveElement).disabled || button.getAttribute('aria-disabled') === 'true') return false;
          attempt.activated = true; attempt.previousFeed = browseFeed();
          button.click();
        }
        return false;
      },
      ignoreMutation: ignorePlayerMutation,
      shouldShowSelection: controller.shouldShowSelection,
      onScopeChange: controller.onScopeChange,
      interceptAction: controller.interceptAction,
      handleRegion: controller.handleRegion,
      handleBase: controller.handleBase,
      isNavigating: controller.isNavigating,
      getInputLayer: controller.getInputLayer,
      handleLayer: controller.handleLayer,
      getPriorityLayer: controller.getPriorityLayer,
      handleShortcut: controller.handleShortcut,
      isFocusOwned: controller.isFocusOwned,
      getFocusOwner: controller.getFocusOwner,
      onDisable: controller.onDisable,
      ownsKeyboardEvent: controller.ownsKeyboardEvent,
      rememberRegionReturn: () => location.pathname !== '/watch' && !location.pathname.startsWith('/shorts/') && !document.documentElement?.hasAttribute?.('data-ytg-native') && document.documentElement?.classList?.contains?.('ytg-theater') === true,
      onSelectionChange(el) {
        if (el?.matches?.('[data-ytg-category]')) el.setAttribute('tabindex', '-1');

      },
      beforeActivate(el) {
        if (controller.navigating) return true;
        if (el.matches?.('[data-ytg-category]')) {
          el.querySelector<HTMLButtonElement>('button')?.click();
          return true;
        }
        if (el.matches?.('input#search,input[name="search_query"],input.ytSearchboxComponentInput')) {
          controller.openSearch(el as HTMLInputElement);
          return true;
        }
        controller.prepareVideo(el.getAttribute('href'));
        return false;
      },
      defaultSection: 'content',
      sections: {
        sidebar: { axis: 'vertical', exits: { right: ['subscriptions', 'content', 'player', 'categories', 'header'], up: ['header'] } },
        subscriptions: { axis: 'vertical', exits: { left: ['sidebar'], right: ['content'], up: ['categories', 'header'] } },
        header: { axis: 'horizontal', exits: { down: ['categories', 'content', 'player', 'sidebar'], left: ['sidebar'] } },
        searchEntry: { exits: { down: ['content', 'player'], left: ['categories', 'sidebar'], right: ['header'] } },
        categories: { axis: 'horizontal', exits: { up: ['searchEntry', 'header'], down: ['content', 'player'], left: ['sidebar'], right: ['searchEntry'] } },
        content: { layout: 'grid', retainRowFocus: true, exits: { left: ['subscriptions', 'sidebar'], up: ['categories', 'header', 'player'] } },
        player: { axis: 'horizontal', exits: { down: ['content'], up: ['header'], left: ['sidebar'], right: ['content'] } },
        controls: { axis: 'horizontal', exits: { up: ['progress'] } },
        progress: { exits: { down: ['controls'] } }
      },
      getSection(el) {
        if (el?.matches?.('[data-ytg-page-mode]')) return 'header';
        if (el?.closest<HTMLElement>('#ytg-search-host')) return 'searchEntry';
        if (el?.closest<HTMLElement>('[data-ytg-category]')) return 'categories';
        if (el?.closest<HTMLElement>('#ytg-browse-sidebar')) return 'sidebar';
        if (el?.closest<HTMLElement>('#ytg-subscription-channels')) return 'subscriptions';
        if (el?.closest<HTMLElement>('#ytg-browse-top,[data-ytg-category]')) return 'header';
        if (el?.closest<import('../../types/core').YouTubePlayer>('#movie_player')) return controller.mode === 'controls' ? (el.matches?.(progressSelector) ? 'progress' : 'controls') : 'player';
        return 'content';
      },
      getViewport() {
        let top = 16;
        const bars = Array.from(pageQueryAll<HTMLElement>('#ytg-browse-top'))
          .filter(el => {
            for (let node: HTMLElement | null = el; node && node !== document.documentElement; node = node.parentElement) {
              if (['fixed', 'sticky'].includes(getComputedStyle(node).position)) return true;
            }
            return false;
          }).map(el => el.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0 && r.bottom > 0)
          .sort((a, b) => a.top - b.top);
        for (const bar of bars) if (bar.top <= top) top = Math.max(top, bar.bottom + 16);
        return { top: Math.min(top, innerHeight - 32), bottom: innerHeight - 16 };
      },
      getKey(el) {
        if (el?.dataset?.subscriptionId) return `subscription:${el.dataset.subscriptionId}`;
        if (el?.dataset?.sidebarId) return `sidebar:${el.dataset.sidebarId}`;
        if (el?.dataset?.browseId) return el.dataset.browseId;
        const label = el?.closest?.<HTMLElement>('.ytp-settings-menu') && el?.querySelector?.<HTMLElement>('.ytp-menuitem-label');
        return label?.textContent?.trim() || el?.getAttribute('href') || el?.id || el?.getAttribute('aria-label') || undefined;
      },
      getOverlayView(scope) {
        if (!('matches' in scope)) return null;
        if (!scope.matches?.('.ytp-settings-menu')) return null;
        const labels = Array.from(scope.querySelectorAll<HTMLElement>('.ytp-menuitem-label')).filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }).map(el => el.textContent.trim());
        // Values (such as the selected quality) can change without changing pages.
        return labels.length ? JSON.stringify(labels) : null;
      },
      filterCandidates(list) {
        return list.filter((el) => {
          // Watch navigation stays with playback and recommendations; the
          // masthead belongs to the browse page and must not capture Up.
          if (location.pathname === '/watch' && el.closest<HTMLElement>('ytd-masthead')) return false;
          // Shelf arrows serve pointer/Tab input; directional input moves cards directly.
          if (el.hasAttribute?.('data-shorts-scroll')) return false;
          // Navigate each category once via its wrapper; the inner button performs the action.
          if (el.matches?.('button') && el.closest<HTMLElement>('[data-ytg-category]')) return false;
          // Native dialogs still own their targets; controls mode confines page focus to the player.
          if (controller.mode === 'controls' && !el.closest<import('../../types/core').YouTubePlayer>('#movie_player') && !el.closest<HTMLElement>(nativeLayerSelector)) return false;
          if (controller.mode !== 'controls' && el.matches?.(progressSelector)) return false;
          return true;
        });
      },
      selectors: '[data-ytg-search-input],[data-ytg-page-mode],#ytg-browse-sidebar a[href],#ytg-subscription-channels a[href],#ytg-browse-grid a[data-browse-id],#ytg-browse-grid button,#ytg-browse-top button,[data-ytg-category],.ytp-button,.ytp-progress-bar',
      overlays: nativeLayerSelector,
      overlayItems: 'a[href],button,input,[role="slider"],[role="button"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],tp-yt-paper-item,.ytp-panel-back',
      isSlider: (el) => el?.matches?.('input[type="range"],[role="slider"]') === true,
      adjustSlider(el, direction) {
        if (!el) return;
        if (el.matches('input[type="range"]')) {
          const input = el as HTMLInputElement;
          const min = input.min === '' ? 0 : Number(input.min), max = input.max === '' ? 100 : Number(input.max);
          const step = input.step === 'any' || !input.step ? 1 : Number(input.step);
          input.value = String(Math.min(max, Math.max(min, Number(input.value) + direction * step)));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          const key = direction < 0 ? 'ArrowLeft' : 'ArrowRight';
          for (const type of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key, code: key,
            keyCode: direction < 0 ? 37 : 39, which: direction < 0 ? 37 : 39, bubbles: true, composed: true }));
        }
      },
      getContainer(el) { return el; },
      getSelectionTarget(el) {
        if (el?.matches?.('[data-browse-id]')) return el.querySelector<HTMLElement>('.card-cover,img,.thumbnail-placeholder') || el;
        return el;
      },
      ownsSelectionPaint: (el) => Boolean(el?.closest<HTMLElement>('#ytg-browse-sidebar,#ytg-subscription-channels,#ytg-browse-categories,#ytg-browse-top,[data-browse-id],[data-ytg-category]')),
      getSelectionRadius(el) {
        if (el?.matches?.('[data-ytg-category]')) return 'var(--ytg-chip-radius, 8px)';
        return el?.closest<HTMLElement>('#ytg-browse-top') ? 'var(--ytg-pill-radius, 28px)' : 'var(--ytg-card-radius, 14px)';
      },
      onAction(action, { scope }) {
        if (action === 'back') {
          if (scope !== document) {
            if ('matches' in scope && scope.matches?.('.ytp-settings-menu')) {
              const parent = scope.querySelector<HTMLElement>('.ytp-panel-back,.ytp-panel-back-button,.ytp-panel-header button');
              backSettings(scope as HTMLElement);
              if (!parent) controller.onSettingsClosed();
              return 'handled';
            }
            const close = scope.querySelector<HTMLElement>('[aria-label="Close"],[aria-label="关闭"],#close-button button');
            if (close) close.click();
            else if ('closest' in scope && typeof scope.closest?.<HTMLElement & {close?:()=>void}>('tp-yt-iron-dropdown')?.close === 'function') scope.closest<HTMLElement & {close?:()=>void}>('tp-yt-iron-dropdown')!.close!();
            else scope.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, composed: true }));
          } else controller.pageBack();
          return 'handled';
        }
        if (scope !== document) return 'blocked';
        if (location.pathname !== '/watch' && !location.pathname.startsWith('/shorts/') &&
            (action === 'seekBack' || action === 'seekForward'))
          return switchBrowseCategory(action === 'seekBack' ? -1 : 1);
        const result = controller.perform(action);
        // Input disposition acknowledges dispatch; media completion is handled by the coordinator.
        return result ? 'handled' : 'pass';
      }
    };
  }
  function hasNativeLayer() {
    return Array.from(document.querySelectorAll<HTMLElement>(nativeLayerSelector)).some(el => {
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
      const inert = el.closest<HTMLElement>('[inert]');
      return el.isConnected && rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && !el.closest<HTMLElement>('[hidden],[aria-hidden="true"]') &&
        (!inert || focusManager?.isSuspendedScope(inert));
    });
  }
  YTGamepadSite = { nativePlayer, configurePlayback, destroy: lifecycle.destroy, temporarySpeed, hasNativeLayer, perform, showNativeControls, isProgress: el => el?.matches?.(progressSelector) === true, createNavigationConfig,
    inspectWatchCapabilities, inspectOptionalCapabilities, readWatchFeatures: () => ({ ...watchFeatures }), restoreNativeInterface,
    readRoute, readPlayback, readWatchPage, readComments,
    readCommentsStatus: () => pageAccess?.readComments?.(),
    postComment: (text, key) => pageAccess?.commentPost?.(text, key) || Promise.resolve(false),
    sortComments: sort => pageAccess?.commentSort?.(sort) === true,
    openRecommendation, loadRecommendations, selectRecommendationFilter: key => pageAccess?.selectRecommendationFilter?.(key, readRoute().key) || false, openChannel, performWatchAction, expandReplies, translateComment, loadComments,
    listPlaylists: () => pageAccess?.watchPlaylists?.() || Promise.resolve(undefined),
    togglePlaylist: (key: string) => pageAccess?.watchPlaylistToggle?.(key) || Promise.resolve(false),
    settingsOpen, openSettings, backSettings, seekTo, getSearchTarget, readSearch, syncSearch, submitSearch, moveSearchCursor, readTheme, observePage };
  const published = YTGamepadSite;
  // These ports may fail independently when native markup changes. Retry reads
  // on later observations; do not latch optional failures for the whole route.
  for (const [method, feature, fallback] of [
    ['readComments', 'comments', () => []],
    ['loadComments', 'comments', () => false], ['expandReplies', 'comments', () => false], ['translateComment', 'comments', () => false],
    ['openRecommendation', 'recommendations', () => 'missing'], ['openChannel', 'channel', () => false],
    ['loadRecommendations', 'recommendations', () => false],
    ['hasNativeLayer', 'nativeLayers', () => false],
    ['openSettings', 'settings', () => false], ['settingsOpen', 'settings', () => false], ['backSettings', 'settings', () => false]
  ] as const) {
    const operation = published[method];
    const invoke = operation as (...args: unknown[]) => unknown;
    Object.assign(published, { [method]: (...args: unknown[]) => optionalFeature(feature, () => invoke(...args), fallback) });
  }
  published.performWatchAction = action => optionalFeature(action, () => performWatchAction(action), () => false);
  published.perform = action => action === 'captions' ? optionalFeature('captions', () => perform(action), () => false) : perform(action);
  lifecycle.cleanup(() => { if (YTGamepadSite === published) YTGamepadSite = undefined; });
  lifecycle.cleanup(() => {
    suppressPreviews = false;
    nextDestinations.clear(); channelId = '';
    if (typeof document !== 'undefined') restoreNativeInterface();
  });
  return published;
  }
  YTGamepadSiteModule = { create };
})();
