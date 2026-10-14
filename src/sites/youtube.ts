import type { Capability, Dispose, ModuleFactory, NavigationPolicy, RecommendationSnapshot, SearchTarget, SiteDependencies, SitePort, WatchAction, WatchPageSnapshot } from '../../types/ports';

import type { NavigationConfig, InteractiveElement } from '../../types/core';
type Mutable<T> = {-readonly [K in keyof T]: T[K]};

import { YTGamepadActions } from '../shared/actions.ts';
import { YTGamepadSeeking } from '../playback/seek';
export let YTGamepadSite: SitePort | undefined, YTGamepadSiteModule!: ModuleFactory<SiteDependencies,SitePort>;
(() => {
  /** @param {import('../../types/ports.js').SiteDependencies} dependencies */
  function create({ runtime, diagnostics, focusManager, pageAccess = undefined }: import('../../types/ports.js').SiteDependencies) {
  const lifecycle = runtime.scope('site');
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
  let suppressPreviews = false, previewObserver: MutationObserver;
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
    for (const card of document.querySelectorAll<HTMLElement>(cardSelector)) {
      if (!card.matches(':hover')) continue;
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
  if (typeof document !== 'undefined' && document.body && typeof MutationObserver !== 'undefined') {
    previewObserver = lifecycle.observer(records => {
      if (!suppressPreviews) return;
      // Inspect inserted subtrees instead of rescanning every video on the page.
      for (const record of records) for (const added of record.addedNodes) {
        if (isPreviewVideo(added) && !added.paused) added.pause();
        for (const video of (added as HTMLElement).querySelectorAll?.<HTMLVideoElement>('video') || [])
          if (isPreviewVideo(video) && !video.paused) video.pause();
      }
    });
    lifecycle.listen(window, 'yt-gamepad-input-mode', e => {
      suppressPreviews = e.detail.mode === 'gamepad';
      previewObserver.disconnect();
      if (!suppressPreviews) return;
      cancelHover(); stopPreviews();
      previewObserver.observe(document.body, { childList: true, subtree: true });
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
    const video = getVideo();
    if (!video) return false;
    if (action !== 'seekBack' && action !== 'seekForward') seekRun = undefined;
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
      const step = YTGamepadSeeking.step(distance, YTGamepadActions.get(action)!.parameter!.default);
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
      const step = YTGamepadActions.get(action)!.parameter!.default / 100;
      video.volume = Math.min(1, Math.max(0, video.volume + (action === 'volumeUp' ? step : -step)));
    }
    else return false;
    return true;
  }
  function switchBrowseCategory(direction: number) {
    // Include horizontally clipped chips, but exclude hidden SPA pages and dialogs.
    const chips = Array.from(document.querySelectorAll<HTMLElement>('yt-chip-cloud-chip-renderer,[data-ytg-category]')).filter(chip => {
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
  const recommendationSources: Map<string, HTMLAnchorElement> = new Map(), commentSources: Map<string, HTMLElement> = new Map();
  let commentPreload = { route: '', attempts: 0, done: false, nextAttempt: 0 };
  let channelSource: HTMLElement | null = null;
  const nativeLayerSelector = '[role="dialog"],tp-yt-paper-dialog,ytd-popup-container tp-yt-iron-dropdown,ytd-menu-popup-renderer,ytd-modal-with-title-and-button-renderer,ytd-add-to-playlist-renderer,.ytp-settings-menu';
  const actionPatterns: Partial<Record<string,RegExp>> = {
    like: /^(?:like\b|unlike\b|remove like\b|赞|点赞|顶|頂|喜歡|喜欢|取消赞|取消点赞|取消頂|取消喜歡|不再喜欢|与另外.*(?:顶|赞)|與其他.*(?:頂|讚))/i,
    dislike: /^(?:dislike\b|remove dislike\b|不喜欢|不喜歡|踩|点踩|取消踩|取消点踩|取消不喜欢|取消不喜歡)/i,
    save: /^(?:save\b|保存|儲存|储存|收藏)/i
  };
  const actionSelectors: Partial<Record<string,string>> = {
    subscribe: 'ytd-video-owner-renderer ytd-subscribe-button-renderer button,ytd-watch-metadata #subscribe-button button',
    like: 'ytd-watch-metadata like-button-view-model button,ytd-watch-metadata #segmented-like-button button,ytd-video-primary-info-renderer #segmented-like-button button',
    dislike: 'ytd-watch-metadata dislike-button-view-model button,ytd-watch-metadata #segmented-dislike-button button,ytd-video-primary-info-renderer #segmented-dislike-button button'
  };
  function watchActionTarget(action: WatchAction) {
    const selector = actionSelectors[action];
    const selected = selector ? document.querySelector<HTMLElement>(selector) : null;
    if (watchTargetAvailable(selected)) return selected;
    const alternative = selector && Array.from(document.querySelectorAll<HTMLElement>(selector)).find(watchTargetAvailable);
    if (alternative) return alternative;
    if (!actionPatterns[action]) return null;
    return Array.from(document.querySelectorAll<HTMLElement>('ytd-watch-metadata #actions button,ytd-video-primary-info-renderer #menu button')).find(button =>
      watchTargetAvailable(button) && actionPatterns[action]!.test(button.getAttribute('aria-label') || button.textContent?.trim() || '')) || null;
  }
  function watchTargetAvailable(target: InteractiveElement | null | undefined): target is InteractiveElement {
    // Our CSS hides #below during playback. Reject inactive native variants by
    // their attributes, without rejecting the entire hidden metadata section.
    return !!target && target.isConnected !== false && !target.disabled && target.getAttribute('aria-disabled') !== 'true' &&
      !target.closest?.<HTMLElement>('[hidden],[aria-hidden="true"]');
  }
  function clickWatchTarget(target: InteractiveElement | null | undefined) {
    if (!watchTargetAvailable(target)) return false;
    target.click(); return true;
  }
  function performWatchAction(action: WatchAction) {
    if (!readRoute().isWatch || !['subscribe', 'like', 'dislike', 'save'].includes(action)) return false;
    const target = watchActionTarget(action);
    if (target || action !== 'save') return clickWatchTarget(target);
    // Narrow screens move Save into the native overflow menu. Open only the
    // playlist chooser; YouTube owns account prompts and playlist selection.
    const overflow = document.querySelector<HTMLElement>('ytd-watch-metadata #actions ytd-menu-renderer #button button,ytd-video-primary-info-renderer #menu ytd-menu-renderer #button button');
    if (!overflow || typeof MutationObserver === 'undefined') return false;
    const route = readRoute().key;
    return new Promise<boolean>(resolve => {
      let timer: number|undefined, release: Dispose, settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true; observer.disconnect(); lifecycle.clearTimeout(timer); release?.();
        resolve(lifecycle.destroyed ? false : result);
      };
      const findSave = () => {
        if (readRoute().key !== route) { finish(false); return; }
        const menu = Array.from(document.querySelectorAll<HTMLElement>('ytd-menu-popup-renderer')).find(node => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
        });
        const item = menu && Array.from(menu.querySelectorAll<HTMLElement>('ytd-menu-service-item-renderer,[role="menuitem"]')).find(node =>
          actionPatterns.save!.test(node.textContent?.trim() || ''));
        if (item) finish(clickWatchTarget(item));
      };
      const observer = lifecycle.observer(findSave);
      observer.observe(document.body, { childList: true, subtree: true });
      timer = lifecycle.timeout(() => finish(false), 2000);
      release = lifecycle.cleanup(() => finish(false));
      if (!clickWatchTarget(overflow)) { finish(false); return; }
      findSave();
    });
  }
  /** @returns {import('../../types/ports.js').RouteSnapshot} */
  const readRoute = () => ({ key: location.pathname + location.search, isWatch: location.pathname === '/watch' });
  const watchFeatures: Record<string,Capability> = {};
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
      recommendations: () => document.querySelector<HTMLElement>('ytd-watch-next-secondary-results-renderer,ytd-compact-video-renderer'),
      comments: () => document.querySelector<HTMLElement>('ytd-comments'),
      channel: () => document.querySelector<HTMLElement>('ytd-video-owner-renderer #channel-name a,ytd-watch-metadata #owner #channel-name a'),
      settings: () => document.querySelector<HTMLElement>('.ytp-settings-button'),
      captions: () => document.querySelector<HTMLElement>('.ytp-subtitles-button'),
      ...Object.fromEntries(['subscribe', 'like', 'dislike', 'save'].map(action => [action, () => watchActionTarget(action as WatchAction) ||
        (action === 'save' && document.querySelector<HTMLElement>('ytd-watch-metadata #actions ytd-menu-renderer #button button,ytd-video-primary-info-renderer #menu ytd-menu-renderer #button button'))]))
    };
    for (const [name, probe] of Object.entries(probes)) {
      optionalFeature(name, () => { watchFeatures[name] = watchTargetAvailable(probe()) ? 'available' : 'missing'; }, () => {});
    }
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
      // Missing metadata remains optional, matching readWatchPage's contract.
      let videoId;
      try { videoId = pageAccess?.readVideoDetails()?.videoId; } catch (_) {}
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
    for (const name of ['ytg-playback', 'ytg-controls', 'ytg-watch-active', 'ytg-recommendations', 'ytg-recommendations-loading', 'ytg-comments', 'ytg-comments-preload', 'ytg-settings-open']) {
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
    for (let i = 0; i < (video.seekable?.length || 0); i++) {
      const start = video.seekable.start(i), end = video.seekable.end(i);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) ranges.push({ start, end });
    }
    if (!isLive && Number.isFinite(video.duration) && video.duration > 0 && !ranges.length)
      ranges.push({ start: 0, end: video.duration });
    const start = ranges[0]?.start || 0, end = ranges.at(-1)?.end || 0;
    return { isLive, canSeek: ranges.length > 0, start, end, ranges,
      atLiveEdge: isLive && ranges.length > 0 && video.currentTime >= end - 2 };
  }
  /** @returns {import('../../types/ports.js').PlaybackSnapshot} */
  function readPlayback() {
    const video = getVideo(), caption = optionalFeature('captions', () => document.querySelector<HTMLElement>('.ytp-subtitles-button'), () => null);
    return {
      video: video ? { currentTime: video.currentTime, duration: video.duration, paused: video.paused, ended: video.ended, volume: video.volume, muted: video.muted, timeline: readTimeline(video) } : null,
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
  function readThumbnail(node: HTMLElement, key: string) {
    const fallback = `https://i.ytimg.com/vi/${encodeURIComponent(key)}/hqdefault.jpg`;
    const img = node.querySelector<HTMLImageElement>('img');
    // Native recommendations may stay outside the viewport and never lazy-load.
    const candidates = [img?.getAttribute('data-thumb'), img?.getAttribute('data-src'),
      img?.currentSrc, img?.getAttribute('src'),
      ...(img?.getAttribute('srcset') || '').split(',').reverse().map((value) => value.trim().split(/\s+/)[0])];
    for (const candidate of candidates) {
      if (!candidate?.trim()) continue;
      try {
        const url = new URL(candidate, location.origin);
        if (['https:', 'http:'].includes(url.protocol) && url.pathname !== '/') return { thumbnail: url.href, thumbnailFallback: fallback };
      } catch (_) {}
    }
    return { thumbnail: fallback, thumbnailFallback: fallback };
  }
  /** @returns {import('../../types/ports.js').WatchPageSnapshot} */
  function readWatchPage() {
    const route = readRoute(), id = new URLSearchParams(location.search).get('v');
    recommendationSources.clear(); channelSource = null;
    const page: Mutable<WatchPageSnapshot> = { ...route, waiting: false, title: '', channel: '', avatar: '', subscribed: false, liked: false, disliked: false, viewCount: null, description: '', recommendations: [] };
    if (!route.isWatch) return page;
    let details;
    try { details = pageAccess?.readVideoDetails(); } catch (_) {}
    if (details?.videoId && details.videoId !== id) { page.waiting = true; return page; }
    const domTitle = document.querySelector<HTMLElement>('ytd-watch-metadata h1 yt-formatted-string,ytd-watch-metadata h1,ytd-video-primary-info-renderer h1');
    channelSource = document.querySelector<HTMLElement>('ytd-video-owner-renderer #channel-name a,ytd-watch-metadata #owner #channel-name a');
    page.title = details?.title || domTitle?.textContent?.trim() || '';
    page.channel = details?.author || channelSource?.textContent?.trim() || '';
    const avatar = document.querySelector<HTMLImageElement>('ytd-video-owner-renderer #avatar img,ytd-watch-metadata #owner #avatar img');
    try {
      const url = new URL(avatar?.currentSrc || avatar?.getAttribute('src') || '', location.origin);
      if (['https:', 'http:'].includes(url.protocol) && url.pathname !== '/') page.avatar = url.href;
    } catch (_) {}
    const subscription = document.querySelector<HTMLElement>('ytd-video-owner-renderer ytd-subscribe-button-renderer,ytd-watch-metadata #subscribe-button ytd-subscribe-button-renderer');
    const subscribe = optionalFeature('subscribe', () => watchActionTarget('subscribe'), () => null);
    page.subscribed = !!subscription?.hasAttribute?.('subscribed') || subscribe?.getAttribute('aria-pressed') === 'true' || /^(subscribed|unsubscribe|已订阅|已訂閱|取消订阅|取消訂閱)/i.test(subscribe?.textContent?.trim() || '');
    page.liked = optionalFeature('like', () => watchActionTarget('like')?.getAttribute('aria-pressed') === 'true', () => false);
    page.disliked = optionalFeature('dislike', () => watchActionTarget('dislike')?.getAttribute('aria-pressed') === 'true', () => false);
    page.viewCount = details?.viewCount ?? null;
    page.description = details?.shortDescription || document.querySelector<HTMLElement>('ytd-watch-metadata #description,ytd-video-secondary-info-renderer #description')?.textContent?.trim() || '';
    page.recommendations = optionalFeature('recommendations', () => readRecommendations(id), () => { recommendationSources.clear(); return []; });
    return page;
  }
  function readRecommendations(id: string|null) {
    const records: RecommendationSnapshot[] = [];
    for (const node of document.querySelectorAll<HTMLElement>('ytd-compact-video-renderer,ytd-watch-next-secondary-results-renderer yt-lockup-view-model')) {
      if (node.closest?.<HTMLElement>('ytd-ad-slot-renderer,ytd-promoted-sparkles-web-renderer,ytd-display-ad-renderer')) continue;
      const anchor = node.querySelector<HTMLAnchorElement>('a[href*="/watch?"]');
      if (!anchor) continue;
      let url;
      try { url = new URL(anchor.getAttribute('href') || '', location.origin); } catch (_) { continue; }
      const key = url.searchParams.get('v');
      if (url.origin !== location.origin || url.pathname !== '/watch' || !key || key === id || recommendationSources.has(key)) continue;
      const label = node.querySelector<HTMLElement>('#video-title,.ytLockupMetadataViewModelTitle,.yt-lockup-metadata-view-model__title,h3')?.textContent?.trim() || anchor.getAttribute('title');
      if (!label) continue;
      recommendationSources.set(key, anchor);
      const metadataRows = Array.from(node.querySelectorAll?.<HTMLElement>('.yt-content-metadata-view-model__metadata-row,.ytContentMetadataViewModelMetadataRow') || []);
      const channel = node.querySelector<HTMLElement>('#channel-name')?.textContent?.trim() || metadataRows[0]?.textContent?.trim() || '';
      const metadata = node.querySelector<HTMLElement>('#metadata-line')?.textContent?.trim().replace(/\s+/g, ' ') || metadataRows.slice(1).map(row => row.textContent?.trim()).filter(Boolean).join(' · ');
      const duration = node.querySelector<HTMLElement>('ytd-thumbnail-overlay-time-status-renderer,.ytThumbnailOverlayBadgeViewModelBadgeText,yt-thumbnail-overlay-badge-view-model .yt-badge-shape__text')?.textContent?.trim() || '';
      records.push({ key, label, ...readThumbnail(node, key), channel, metadata, duration });
      if (records.length >= 120) break;
    }
    return records;
  }
  let recommendationLoadRoute = '', recommendationLoadAfter = 0, recommendationLoadTimer: number|undefined;
  function loadRecommendations() {
    const route = readRoute();
    if (!route.isWatch || recommendationSources.size >= 120) return false;
    const source = document.querySelector<HTMLElement>('#secondary');
    const continuation = source?.querySelector<HTMLElement>('ytd-watch-next-secondary-results-renderer ytd-continuation-item-renderer');
    if (!source || !continuation) return false;
    if (recommendationLoadRoute !== route.key) {
      recommendationLoadRoute = route.key; recommendationLoadAfter = 0;
    }
    const now = Date.now();
    if (now < recommendationLoadAfter) return true;
    recommendationLoadAfter = now + 1500;
    // Let YouTube's own continuation enter its native scroll viewport behind
    // the full-screen player. Never scroll the page or call private APIs.
    const root = document.documentElement;
    root.classList.add('ytg-recommendations-loading');
    lifecycle.clearTimeout(recommendationLoadTimer);
    recommendationLoadTimer = lifecycle.timeout(() => root.classList.remove('ytg-recommendations-loading'), 4000);
    if (typeof source.scrollTop === 'number' && continuation.getBoundingClientRect) {
      source.scrollTop += continuation.getBoundingClientRect().top - source.getBoundingClientRect().top;
    }
    continuation.querySelector<HTMLElement>('button,yt-button-shape button')?.click();
    return true;
  }
  function openRecommendation(key: string, prepareVideo: (href: string) => boolean) {
    const anchor = recommendationSources.get(key);
    if (!anchor?.isConnected) return 'missing';
    const href = anchor.getAttribute('href');
    let target;
    try { target = new URL(href || '', location.origin); } catch (_) { return 'missing'; }
    if (target.origin !== location.origin || target.pathname !== '/watch' || target.searchParams.get('v') !== key) return 'missing';
    if (!href || prepareVideo(href) === false) return 'blocked';
    anchor.click(); return 'opened';
  }
  function openChannel(beforeNavigate: () => void) {
    if (!channelSource || channelSource.isConnected === false) return false;
    beforeNavigate(); channelSource.click(); return true;
  }
  /** @returns {readonly import('../../types/ports.js').CommentSnapshot[]} */
  function readComments() {
    commentSources.clear();
    return Array.from(document.querySelectorAll<HTMLElement>('ytd-comments ytd-comment-thread-renderer')).map((thread, index) => {
      const key = thread.id || String(index);
      const replies = thread.querySelector<HTMLElement>('ytd-comment-replies-renderer #more-replies button,ytd-comment-replies-renderer #more-replies,[id="replies"] #more-replies');
      if (replies) commentSources.set(key, replies);
      return { key, author: thread.querySelector<HTMLElement>('#author-text')?.textContent?.trim() || '',
        text: thread.querySelector<HTMLElement>('#content-text')?.textContent?.trim() || '',
        hasReplies: Boolean(replies), repliesLabel: replies?.textContent?.trim() || '',
        expanded: Array.from(thread.querySelectorAll<HTMLElement>('ytd-comment-replies-renderer #content-text')).map(el => el.textContent?.trim() || '') };
    }).filter(item => item.text);
  }
  function expandReplies(key: string) {
    const replies = commentSources.get(key);
    if (!replies?.isConnected) return false;
    replies.click(); return true;
  }
  function loadComments(start = false) {
    const source = document.querySelector<HTMLElement>('ytd-comments');
    if (!source) return;
    (start ? source : source.querySelector<HTMLElement>('ytd-continuation-item-renderer') || source).scrollIntoView({ block: start ? 'start' : 'end', behavior: 'instant' });
  }
  function syncCommentPreload(active: boolean) {
    const root = document.documentElement, route = readRoute();
    if (route.key !== commentPreload.route) {
      commentPreload = { route: route.key, attempts: 0, done: false, nextAttempt: 0 };
      commentSources.clear();
    }
    const stop = () => root.classList.toggle('ytg-comments-preload', false);
    if (!active || !route.isWatch || commentPreload.done || root.classList.contains?.('ytg-comments')) { stop(); return; }
    // Wait for SPA navigation to replace the old video's player data.
    const id = new URLSearchParams(location.search).get('v');
    const details = pageAccess?.readVideoDetails();
    if (details?.videoId && details.videoId !== id) { stop(); return; }
    const count = Array.from(document.querySelectorAll<HTMLElement>('ytd-comments ytd-comment-thread-renderer'))
      .filter(thread => thread.querySelector<HTMLElement>('#content-text')?.textContent?.trim()).length;
    // YouTube chooses its batch size. Warm the first batch, never fetch all pages.
    if (count >= 5 || commentPreload.attempts >= 10) { commentPreload.done = true; stop(); return; }
    root.classList.toggle('ytg-comments-preload', true);
    const now = Date.now();
    if (now < commentPreload.nextAttempt) return;
    commentPreload.nextAttempt = now + 1000; commentPreload.attempts++;
    const source = document.querySelector<HTMLElement>('ytd-comments');
    if (!source) return;
    const target = source.querySelector<HTMLElement>('ytd-continuation-item-renderer') || source;
    // Only scroll the masked native container; never move the page or player.
    const below = document.querySelector<HTMLElement>('#below');
    if (below && typeof below.scrollTop === 'number' && target.getBoundingClientRect) {
      below.scrollTop += target.getBoundingClientRect().top - below.getBoundingClientRect().top;
    }
  }
  const getSearchTarget = () => document.querySelector?.<HTMLInputElement>('#ytg-search-host:not([hidden]) input') || document.querySelector?.<HTMLInputElement>('input#search,input[name="search_query"],input.ytSearchboxComponentInput');
  function browseAccountTarget() {
    return document.querySelector?.<HTMLElement>('ytd-masthead #avatar-btn,ytd-masthead a[href*="accounts.google.com"],ytd-masthead a[href^="/signin"]');
  }
  function readBrowseAccount() {
    const target = browseAccountTarget();
    return target ? { label: target.id === 'avatar-btn' ? 'Account' : 'Sign in' } : null;
  }
  function openBrowseAccount() { return clickWatchTarget(browseAccountTarget()); }
  const readTheme = () => document.documentElement.hasAttribute?.('dark') ?? true;
  function moveSearchCursor(target: SearchTarget, cursor: [number,number]) { target?.setSelectionRange?.(...cursor); }
  function readSearch(target: SearchTarget | undefined) { return (target?.isConnected ? target : getSearchTarget())?.value || ''; }
  function syncSearch(target: SearchTarget, value: string, cursor: [number,number]) {
    if (!target?.isConnected) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(target, value); else target.value = value;
    target.setSelectionRange?.(...cursor);
    target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
  function submitSearch(target: SearchTarget, query: string, beforeNavigate: () => void) {
    target = target?.isConnected ? target : getSearchTarget();
    const button = document.querySelector?.<HTMLElement>('button#search-icon-legacy,#search-icon-legacy button,button.ytSearchboxComponentSearchButton,.ytSearchboxComponentSearchButton button');
    if (!target || !button) return false;
    syncSearch(target, query, [query.length, query.length]);
    beforeNavigate(); button.click(); return true;
  }
  function observePage(onChange: () => void) {
    if (typeof MutationObserver === 'undefined' || !document.body) return () => {};
    let timer: number | undefined;
    const observer = lifecycle.observer(records => {
      if (timer || records.every(record => (record.target as HTMLElement).closest?.('#ytg-watch,#yt-gamepad-menu,#yt-gamepad-overlay') || ignorePlayerMutation(record))) return;
      timer = lifecycle.timeout(() => { timer = undefined; onChange(); }, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'subscribed', 'src'] });
    return () => { observer.disconnect(); lifecycle.clearTimeout(timer); };
  }
  function ignorePlayerMutation(record: MutationRecord) {
    const target = record.target.nodeType === 3 ? record.target.parentElement : record.target as HTMLElement;
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
    let sidebarSelected = false;
    const browseChips = () => Array.from(document.querySelectorAll<HTMLElement>('yt-chip-cloud-chip-renderer,[data-ytg-category]')).filter(chip =>
      chip.isConnected && !chip.closest<HTMLElement>('[hidden],[aria-hidden="true"],[inert]') && chip.getBoundingClientRect().width > 0 && getComputedStyle(chip).visibility !== 'hidden');
    const chipKey = (chip: HTMLElement) => chip.getAttribute('aria-label') || chip.textContent.trim();
    const chipSelected = (chip: HTMLElement) => chip.getAttribute('selected') === '' || chip.getAttribute('selected') === 'true' ||
      chip.getAttribute('aria-selected') === 'true' || Boolean(chip.querySelector<HTMLElement>('[aria-selected="true"],[aria-pressed="true"],.ytChipShapeActive'));
    const browseFeed = () => Array.from(document.querySelectorAll<HTMLElement>(document.documentElement.classList.contains('ytg-api-categories') ? '#ytg-browse-grid a[data-browse-id]' : 'ytd-page-manager a#thumbnail[href],ytd-page-manager yt-lockup-view-model a[href^="/watch?"]'))
      .filter(link => !link.closest<HTMLElement>('[hidden],[aria-hidden="true"]')).map(link => link.getAttribute('href')).join('|');
    return {
      captureBrowseState() {
        if (location.pathname === '/watch' || location.pathname.startsWith('/shorts/')) return null;
        const chip = browseChips().find(chipSelected);
        const grid = document.querySelector<HTMLElement>('#ytg-browse-grid [data-ytg-browse-grid]');
        return chip || grid ? { category: chip ? chipKey(chip) : undefined, gridScroll: grid?.scrollTop } : null;
      },
      restoreBrowseState(saved, attempt) {
        if (!saved) return true;
        const restoreScroll = () => {
          const grid = document.querySelector<HTMLElement>('#ytg-browse-grid [data-ytg-browse-grid]');
          if (saved.gridScroll != null && grid) {
            grid.scrollTop = saved.gridScroll;
            return Math.abs(grid.scrollTop - saved.gridScroll) <= 1;
          }
          return true;
        };
        if (!saved.category) return restoreScroll();
        const chip = browseChips().find(item => chipKey(item) === saved.category);
        if (!chip) return false;
        if (chipSelected(chip)) return document.getElementById('ytg-browse-grid')?.dataset.feedLoading !== 'true' && (!attempt.activated || browseFeed() !== attempt.previousFeed) && restoreScroll();
        // The Vue category button owns API loading; native mode retains YouTube handlers.
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
      onSelectionChange(el, scope) {
        if (el?.matches?.('yt-chip-cloud-chip-renderer,[data-ytg-category]')) el.setAttribute('tabindex', '-1');
        const inSidebar = scope === document && Boolean(el?.closest<HTMLElement>('#ytg-browse-sidebar,ytd-guide-renderer,ytd-mini-guide-renderer'));
        const card = el?.closest<HTMLElement>('ytd-rich-item-renderer,ytd-video-renderer,ytd-grid-video-renderer,yt-lockup-view-model');
        if (sidebarSelected && scope === document && card) {
          const drawer = document.querySelector?.<HTMLElement>('tp-yt-app-drawer#guide');
          if (drawer?.hasAttribute('opened') && !drawer.hasAttribute('persistent') && !(drawer as HTMLElement & {persistent?:boolean}).persistent)
            document.querySelector<HTMLElement>('ytd-masthead #guide-button button,ytd-masthead button#guide-button,ytd-masthead #guide-button')?.click();
        }
        sidebarSelected = inSidebar;
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
        sidebar: { axis: 'vertical', exits: { right: ['content', 'player', 'categories', 'header'], up: ['header'] } },
        header: { axis: 'horizontal', exits: { down: ['categories', 'content', 'player', 'sidebar'], left: ['sidebar'], right: ['settings'] } },
        searchEntry: { exits: { down: ['content', 'player'], left: ['categories', 'sidebar'], right: ['header', 'settings'] } },
        categories: { axis: 'horizontal', exits: { up: ['searchEntry', 'header'], down: ['content', 'player'], left: ['sidebar'], right: ['searchEntry', 'settings'] } },
        settings: { exits: { left: ['content', 'categories', 'header'], up: ['header'], down: ['content'] } },
        content: { layout: 'grid', retainRowFocus: true, exits: { left: ['sidebar'], right: ['settings'], up: ['categories', 'header', 'player'] } },
        player: { axis: 'horizontal', exits: { down: ['content'], up: ['header'], left: ['sidebar'], right: ['content'] } },
        controls: { axis: 'horizontal', exits: { up: ['progress'] } },
        progress: { exits: { down: ['controls'] } }
      },
      getSection(el) {
        if (el?.matches?.('[data-ytg-search-entry]')) return 'searchEntry';
        if (el?.id === 'yt-gamepad-settings-launcher') return 'settings';
        if (el?.closest<HTMLElement>('yt-chip-cloud-chip-renderer,[data-ytg-category]')) return 'categories';
        if (el?.closest<HTMLElement>('#ytg-browse-sidebar,ytd-guide-renderer,ytd-mini-guide-renderer,ytd-guide-entry-renderer,ytd-mini-guide-entry-renderer')) return 'sidebar';
        if (el?.closest<HTMLElement>('#ytg-browse-top,ytd-masthead,ytd-feed-filter-chip-bar-renderer,yt-chip-cloud-chip-renderer,[data-ytg-category]')) return 'header';
        if (el?.closest<import('../../types/core').YouTubePlayer>('#movie_player')) return controller.mode === 'controls' ? (el.matches?.(progressSelector) ? 'progress' : 'controls') : 'player';
        return 'content';
      },
      getViewport() {
        let top = 16;
        const bars = Array.from(document.querySelectorAll<HTMLElement>('#ytg-browse-top,ytd-masthead,ytd-feed-filter-chip-bar-renderer,#chips-wrapper'))
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
      getRow(el) { return el?.closest?.<HTMLElement>('ytd-rich-grid-row,ytd-horizontal-list-renderer,yt-horizontal-list-renderer') || null; },
      filterCandidates(list) {
        const seen = new Set();
        return list.filter((el) => {
          // A category wrapper paints focus; its inner button performs the action.
          if (el.matches?.('button') && el.closest<HTMLElement>('[data-ytg-category]')) return false;
          // Native dialogs still own their targets; controls mode confines page focus to the player.
          if (controller.mode === 'controls' && !el.closest<import('../../types/core').YouTubePlayer>('#movie_player') && !el.closest<HTMLElement>(nativeLayerSelector)) return false;
          if (controller.mode !== 'controls' && el.matches?.(progressSelector)) return false;
          // The watch page uses the player and recommendations for gamepad navigation.
          if (location.pathname === '/watch' && el.closest<HTMLElement>('ytd-masthead')) return false;
          const card = el.closest<HTMLElement>('ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer,ytd-grid-video-renderer,yt-lockup-view-model');
          if (!card) return true;
          if (seen.has(card)) return false;
          seen.add(card); return true;
        });
      },
      selectors: '#yt-gamepad-settings-launcher,#ytg-browse-sidebar a[href],#ytg-browse-grid a[data-browse-id],#ytg-browse-grid button,#ytg-browse-top button,yt-chip-cloud-chip-renderer,[data-ytg-category],a#thumbnail[href],a#video-title[href],a#video-title-link[href],yt-lockup-view-model a[href^="/watch?"],yt-lockup-view-model a[href^="/shorts/"],ytd-guide-entry-renderer a[href],ytd-mini-guide-entry-renderer a[href],ytd-masthead button,input#search,input[name="search_query"],input.ytSearchboxComponentInput,.ytp-button,.ytp-progress-bar,[role="dialog"] button,tp-yt-paper-dialog button,ytd-menu-popup-renderer [role="menuitem"]',
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
      getContainer(el) { return el?.closest<HTMLElement>('ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer,ytd-grid-video-renderer,yt-lockup-view-model') || el; },
      getSelectionTarget(el) {
        if (el?.matches?.('yt-chip-cloud-chip-renderer,[data-ytg-category]')) return el.querySelector<HTMLElement>('.ytChipShapeChip') || el.querySelector<HTMLElement>('#chip-shape-container') || el;
        if (el?.matches?.('[data-browse-id]')) return el.querySelector<HTMLElement>('.card-cover,img,.thumbnail-placeholder') || el;
        const card = el?.closest<HTMLElement>('ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer,ytd-grid-video-renderer,yt-lockup-view-model');
        return card?.querySelector<HTMLElement>('a#thumbnail,yt-thumbnail-view-model,ytd-thumbnail,.yt-lockup-view-model__content-image') || el;
      },
      ownsSelectionPaint: (el) => Boolean(el?.closest<HTMLElement>('#ytg-browse-sidebar,#ytg-browse-categories,#ytg-browse-top,yt-chip-cloud-chip-renderer,[data-ytg-category]')),
      getSelectionRadius(el) {
        if (el?.matches?.('yt-chip-cloud-chip-renderer,[data-ytg-category]')) return 'var(--ytg-chip-radius, 8px)';
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
  YTGamepadSite = { destroy: lifecycle.destroy, temporarySpeed, hasNativeLayer, perform, showNativeControls, isProgress: el => el?.matches?.(progressSelector) === true, createNavigationConfig,
    inspectWatchCapabilities, inspectOptionalCapabilities, readWatchFeatures: () => ({ ...watchFeatures }), restoreNativeInterface, syncCommentPreload,
    readRoute, readPlayback, readWatchPage, readComments, openRecommendation, loadRecommendations, openChannel, performWatchAction, expandReplies, loadComments,
    settingsOpen, openSettings, backSettings, seekTo, getSearchTarget, readSearch, syncSearch, submitSearch, moveSearchCursor, readTheme, observePage,
    readBrowseAccount, openBrowseAccount };
  const published = YTGamepadSite;
  // These ports may fail independently when native markup changes. Retry reads
  // on later observations; do not latch optional failures for the whole route.
  for (const [method, feature, fallback] of [
    ['readWatchPage', 'metadata', () => ({ ...readRoute(), title: '', channel: '', description: '', recommendations: [] })],
    ['readComments', 'comments', () => { commentSources.clear(); return []; }],
    ['loadComments', 'comments', () => false], ['expandReplies', 'comments', () => false],
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
  published.syncCommentPreload = active => optionalFeature('comments', () => syncCommentPreload(active), () => {
    document.documentElement.classList.toggle('ytg-comments-preload', false);
  });
  published.destroy = lifecycle.destroy;
  lifecycle.cleanup(() => { if (YTGamepadSite === published) YTGamepadSite = undefined; });
  lifecycle.cleanup(() => {
    suppressPreviews = false; syncCommentPreload(false);
    recommendationSources.clear(); commentSources.clear(); channelSource = null;
    if (typeof document !== 'undefined') restoreNativeInterface();
  });
  return published;
  }
  YTGamepadSiteModule = { create };
})();
