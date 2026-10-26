import { createDrawer } from '../ui/drawer';
import type { Action, ControllerStyle, Runtime } from '../../types/ports';
import type { PageAccess } from '../bridge/page-protocol';
import { PAGE_COMMENTS, PAGE_WATCH_INFO } from '../bridge/page-protocol';
import { isShortsPlaybackRoute, readShortsQueue, shortsQueueKey } from '../shared/shorts-route';
import { t } from '../shared/i18n';
import { mountWatchPanel } from '../ui/mount-watch-panel';
import { createInterfaceIcon } from '../ui/icon-shapes';
import { createCommentOperations } from '../ui/comment-operations';
import { createPlaylistOperations } from '../ui/playlist-operations';
import pageCSS from './shorts-page.css?inline';
import controlsCSS from './shorts-controls.css?inline';
import { h, render } from 'vue';
import MediaActionButton from '../ui/MediaActionButton.vue';
import mediaActionCSS from '../ui/media-action.css?inline';

type Panel = '' | 'comments' | 'playlists' | 'actions';
const layoutOverrides = { display: 'block', position: 'static' } as const;
type LayoutProperty = keyof typeof layoutOverrides;
type NativeLayout = Partial<Record<LayoutProperty, { value: string; priority: string }>>;

/** Shorts use native media with an independent layout and input owner. */
export let YTGamepadShortsModule = {
  create({ runtime, controllerStyle, pageAccess, enabled, canHandle, dispatch }: {
    runtime: Runtime; controllerStyle: ControllerStyle; pageAccess?: PageAccess;
    enabled: () => boolean; canHandle?: () => boolean; dispatch: (action: Action) => void;
  }) {
    const lifecycle = runtime.scope('shorts');
    let polling: ReturnType<Runtime['scope']> | undefined;
    let unregister: (() => void) | undefined;
    let host: HTMLElement | undefined, backdrop: HTMLElement | undefined, style: HTMLStyleElement | undefined, shadow: ShadowRoot;
    let title: HTMLElement, author: HTMLElement, status: HTMLElement, clock: HTMLElement, count: HTMLElement;
    let progress: HTMLProgressElement, play: HTMLButtonElement, previous: HTMLButtonElement, next: HTMLButtonElement, retry: HTMLButtonElement;
    let rail: HTMLElement, drawer: HTMLElement, drawerTitle: HTMLElement, body: HTMLElement, hint: HTMLElement;
    const actionSlots = new Map<'like' | 'comments' | 'save' | 'mute', HTMLElement>();
    const panelActionSlots = new Map<'like' | 'comments' | 'save' | 'mute', HTMLElement>();
    const actionStates = new WeakMap<HTMLElement, string>();
    const actionCallbacks = { like: () => { void toggleLike(); }, comments: () => openPanel('comments'), save: () => openPanel('playlists'), mute: () => { handle('mute'); } };
    function paintActions(liked = false) {
      for (const [action, slot] of [...actionSlots, ...panelActionSlots]) {
        const active = action === 'like' ? liked : action === 'mute' ? !!media?.muted : action === 'comments' ? panel === 'comments' : undefined;
        const disabled = action === 'like' && working, showLabel = panelActionSlots.get(action) === slot;
        const state = `${active}:${disabled}:${showLabel}`;
        if (actionStates.get(slot) === state) continue;
        actionStates.set(slot, state);
        render(h(MediaActionButton, { action, active, disabled, showLabel, 'data-shorts-action': action, onActivate: actionCallbacks[action] }), slot);
      }
    }
    function clearActions() { for (const slot of actionSlots.values()) render(null, slot); actionSlots.clear(); }
    function clearPanelActions() { for (const slot of panelActionSlots.values()) render(null, slot); panelActionSlots.clear(); }
    let preview: HTMLElement, cover: HTMLImageElement;
    let route = '', inShorts = false, returning = false, started = 0;
    let entryIndex: number | undefined, media: HTMLVideoElement | null = null, originalLoop = false;
    let mediaPlayer: HTMLElement | null = null, mediaAncestors: HTMLElement[] = [];
    const nativeLayouts = new Map<HTMLElement, NativeLayout>();
    let playbackFailure = '', panel: Panel = '', panelKey = '';
    let panelView: ReturnType<typeof mountWatchPanel> | undefined;
    const comments = createCommentOperations({
      records: () => pageAccess?.readComments?.()?.items || [], status: () => pageAccess?.readComments?.(),
      replies: key => { pageAccess?.commentReplies?.(key); }
    });
    const playlist = createPlaylistOperations({
      read: async () => await pageAccess?.watchPlaylists?.(),
      toggle: async key => await pageAccess?.watchPlaylistToggle?.(key),
      active: () => !lifecycle.destroyed && panel === 'playlists', route: () => route, changed: paintPlaylists
    });
    let desiredId = '', navigatingId = '', loading = false, nativeSteps = 0, nativeMoving = false;
    let moveTimer: number | undefined, navigationTimer: number | undefined, wheelTimer: number | undefined, wheelHeld = false;
    let message = '', messageUntil = 0, working = false, resumeOnCancel = false;
    const panelDrawer = createDrawer({
      element: () => drawer, content: () => body,
      activeElement: () => shadow?.activeElement as HTMLElement | null,
      route: () => route, fallback: () => play,
      items: () => drawer ? Array.from(drawer.querySelectorAll<HTMLElement>('button,.comment-text[tabindex]')) : [],
      cleared: clearPanel
    });
    const historyIndex = () => (window as unknown as { navigation?: { currentEntry?: { index: number } } }).navigation?.currentEntry?.index;
    const active = () => enabled() && isShortsPlaybackRoute();
    const id = () => location.pathname.split('/')[2] || '';
    const sourceQueue = () => { const queue = readShortsQueue(); return queue.currentId === id() || loading && queue.currentId === navigatingId && queue.ids.includes(id()) ? queue : undefined; };
    const routeKey = () => location.pathname + location.search;
    const time = (value: number) => Number.isFinite(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '0:00';
    const text = (el: HTMLElement, value: string) => { if (el.textContent !== value) el.textContent = value; };
    const switching = () => loading || nativeMoving || !!desiredId && desiredId !== id();
    function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', value = '') {
      const el = document.createElement(tag); el.className = className; el.textContent = value; return el;
    }
    function button(label: string, callback: () => void, image?: string) {
      const el = node('button'); el.type = 'button'; el.setAttribute('aria-label', t(label));
      if (image) el.append(createInterfaceIcon(image));
      el.append(node('span', '', t(label))); el.onclick = callback; return el;
    }
    function notify(value: string) { message = value; messageUntil = performance.now() + 3500; text(status, t(value)); }
    function overrideLayout(owner: HTMLElement, property: LayoutProperty) {
      const applied = layoutOverrides[property], saved = nativeLayouts.get(owner) || {};
      if (!saved[property] || owner.style.getPropertyValue(property) !== applied || owner.style.getPropertyPriority(property) !== 'important') {
        saved[property] = { value: owner.style.getPropertyValue(property), priority: owner.style.getPropertyPriority(property) };
      }
      nativeLayouts.set(owner, saved);
      owner.style.setProperty(property, applied, 'important');
    }
    function restoreLayout(owner: HTMLElement) {
      const saved = nativeLayouts.get(owner);
      for (const property of Object.keys(layoutOverrides) as LayoutProperty[]) {
        const value = saved?.[property];
        if (value && owner.style.getPropertyValue(property) === layoutOverrides[property] && owner.style.getPropertyPriority(property) === 'important') {
          if (value.value) owner.style.setProperty(property, value.value, value.priority);
          else owner.style.removeProperty(property);
        }
      }
      nativeLayouts.delete(owner);
    }
    function syncMediaSurface() {
      // Keep YouTube's media in place, but let our stage own its geometry.
      // Track the active reel player even when YouTube replaces its wrappers.
      const player = media?.closest<HTMLElement>('.html5-video-player,#shorts-player') || media;
      const ancestors: HTMLElement[] = [];
      for (let owner = player?.parentElement; owner && owner !== document.documentElement; owner = owner.parentElement) ancestors.push(owner);
      if (mediaPlayer !== player) {
        mediaPlayer?.removeAttribute('data-ytg-shorts-media'); mediaPlayer = player;
        mediaPlayer?.setAttribute('data-ytg-shorts-media', '');
      }
      for (const owner of mediaAncestors) if (!ancestors.includes(owner)) { owner.removeAttribute('data-ytg-shorts-ancestor'); restoreLayout(owner); }
      for (const owner of ancestors) {
        if (!owner.hasAttribute('data-ytg-shorts-ancestor')) owner.setAttribute('data-ytg-shorts-ancestor', '');
        const layout = getComputedStyle(owner);
        // A decoded video can keep playing under a native display:none wrapper.
        // Fixed/sticky ancestors also trap it below our backdrop despite z-index:auto.
        if (layout.display === 'none') overrideLayout(owner, 'display');
        if (layout.position === 'fixed' || layout.position === 'sticky') overrideLayout(owner, 'position');
      }
      mediaAncestors = ancestors;
    }
    function releaseMedia() {
      if (media) media.loop = originalLoop;
      media = null;
      syncMediaSurface();
    }
    function cancelMoves() {
      lifecycle.clearTimeout(moveTimer); lifecycle.clearTimeout(navigationTimer);
      moveTimer = navigationTimer = undefined; desiredId = ''; navigatingId = ''; loading = false; nativeSteps = 0; nativeMoving = false;
      resumeOnCancel = false;
      if (preview) preview.hidden = true;
    }
    function closePanel(restore = true) { panelDrawer.close(restore); }
    function clearPanel() {
      clearPanelActions();
      panelView?.dispose(); panelView = undefined; comments.reset(); playlist.reset();
      drawer?.classList.remove('comments');
      panel = ''; panelKey = '';
      host?.removeAttribute('data-panel'); document.documentElement.classList.remove('ytg-shorts-panel-open');
      if (drawer) body.replaceChildren();
      updateHint();
    }
    function railButtons() { return Array.from(rail.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); }
    function inRail() { return !!rail && !!shadow.activeElement && rail.contains(shadow.activeElement); }
    function updateHint() {
      if (!hint) return;
      const value = panel ? 'Up / down Select · A Confirm · B Close' : inRail() ? 'Up / down Select · A Confirm · Left / B Back to video' : retry && !retry.hidden ? 'A Retry · Up / down Switch · B Back' : 'Up / down Switch · Right Actions · A Play / pause · B Back';
      if (hint.getAttribute('data-ytg-hint') !== value) controllerStyle.hint(hint, value);
    }
    function focusRail(index = 0) {
      const buttons = railButtons(); buttons[Math.max(0, Math.min(index, buttons.length - 1))]?.focus({ preventScroll: true }); updateHint();
    }
    function startPlayback() {
      if (!media) return;
      const attempted = media, attemptedRoute = route; playbackFailure = '';
      const failed = () => {
        if (media !== attempted || route !== attemptedRoute) return;
        playbackFailure = 'Playback was blocked. Press Play or retry.';
        text(status, t(playbackFailure)); retry.hidden = false; updateHint();
      };
      try { void media.play().catch(failed); } catch { failed(); }
    }
    function retryPlayback() {
      cancelMoves(); closePanel(false); playbackFailure = ''; messageUntil = 0; started = performance.now(); retry.hidden = true;
      if (media && !media.error && media.readyState >= 2) { startPlayback(); update(); }
      else { loading = true; location.reload(); }
    }
    function mount() {
      if (host) return;
      style = node('style'); style.textContent = pageCSS;
      backdrop = node('div'); backdrop.id = 'ytg-shorts-backdrop';
      host = node('section'); host.id = 'ytg-shorts-controls'; host.setAttribute('aria-label', t('Shorts player'));
      shadow = host.attachShadow({ mode: 'open' });
      const css = node('style'); css.textContent = controlsCSS + mediaActionCSS + controllerStyle.css;
      const back = button('Back to feed', () => handle('back'), 'left'); back.className = 'back';
      const stage = node('div', 'stage');
      preview = node('div', 'preview'); preview.hidden = true; cover = node('img'); cover.alt = ''; preview.append(cover);
      play = button('Play / pause', () => dispatch('playPause'), 'play'); play.className = 'play'; play.dataset.shortsAction = 'playPause';
      play.querySelector('span')!.hidden = true;
      const metadata = node('div', 'metadata'); author = node('p', 'author'); title = node('h1', 'title', 'Shorts'); metadata.append(author, title);
      const timeline = node('div', 'timeline'); progress = node('progress'); progress.max = 1; progress.value = 0; progress.setAttribute('aria-label', t('Video progress'));
      clock = node('span', 'clock'); timeline.append(progress, clock); stage.append(preview, play, metadata, timeline);
      rail = node('nav', 'rail'); rail.setAttribute('aria-label', t('Shorts controls'));
      for (const action of ['like', 'comments', 'save', 'mute'] as const) {
        const slot = node('div'); slot.style.display = 'contents'; actionSlots.set(action, slot); rail.append(slot);
      }
      paintActions();
      const more = button('More', () => openPanel('actions'), 'more'); more.dataset.shortsAction = 'more';
      rail.append(more);
      const navigation = node('div', 'navigation'); count = node('span', 'count');
      previous = button('Previous Shorts', () => handle('up'), 'up'); next = button('Next Shorts', () => handle('down'), 'down');
      previous.dataset.shortsAction = 'up'; next.dataset.shortsAction = 'down';
      previous.querySelector('span')!.hidden = true; next.querySelector('span')!.hidden = true; navigation.append(count, previous, next);
      const feedback = node('div', 'feedback'); status = node('p', 'status'); status.setAttribute('role', 'status');
      retry = button('Retry playback', retryPlayback); retry.className = 'retry'; retry.hidden = true; feedback.append(status, retry);
      const hints = node('div', 'hints'); hint = node('p');
      hints.append(hint, controllerStyle.hint(node('p'), 'LB / RB Seek · LT / RT Volume · Start More'));
      drawer = node('aside', 'drawer'); drawer.hidden = true; drawer.setAttribute('role', 'region');
      const header = node('header'); drawerTitle = node('h2'); drawerTitle.id = 'shorts-panel-title'; drawer.setAttribute('aria-labelledby', drawerTitle.id);
      const close = button('Close', () => panelDrawer.back(), 'close'); close.className = 'close'; close.querySelector('span')!.hidden = true;
      body = node('div', 'drawer-body'); header.append(drawerTitle, close); drawer.append(header, body);
      shadow.append(css, back, stage, rail, navigation, feedback, drawer, hints);
      lifecycle.listen(shadow, 'focusin', updateHint); updateHint();
      document.documentElement.append(style, backdrop, host); unregister = controllerStyle.register(shadow);
    }
    function replaceBody(items: Node[]) {
      const key = (shadow.activeElement as HTMLElement | null)?.dataset.key, scroll = body.scrollTop;
      body.replaceChildren(...items); body.scrollTop = scroll;
      if (key) Array.from(body.querySelectorAll<HTMLElement>('[data-key]')).find(el => el.dataset.key === key)?.focus({ preventScroll: true });
    }
    function readComments() {
      if (panel !== 'comments') return;
      const snapshot = pageAccess?.readComments?.(), current = snapshot?.route === routeKey() ? snapshot : undefined;
      if (comments.state.thread && current && !current.items.some(item => item.key === comments.state.thread)) { comments.reset(); panelDrawer.clearDetails(); }
      const key = JSON.stringify([current || null, comments.state.thread, comments.state.limit]);
      if (key === panelKey) return; panelKey = key;
      const selected = (shadow.activeElement as HTMLElement | null)?.dataset.focusId, scroll = body.scrollTop;
      panelView ||= mountWatchPanel(body, controllerStyle, {
        openThread(key) {
          if (!pageAccess?.readComments?.()?.items.some(item => item.key === key && (item.hasReplies || item.replies.length))) return;
          panelDrawer.enterDetail(() => {
            comments.reset(); panelKey = ''; text(drawerTitle, t('Comments')); readComments();
          });
          if (!comments.open(key)) return; panelKey = '';
          text(drawerTitle, t('Replies')); readComments(); body.scrollTop = 0;
        },
        replies() {
          if (!comments.more()) return;
          panelKey = ''; readComments();
        },
        load() {
          const current = pageAccess?.readComments?.();
          pageAccess?.moreComments?.(!current || !current.items.length); panelKey = ''; readComments();
        },
        translate(key) {
          comments.translate(key, (key, target) => { pageAccess?.commentTranslate?.(key, target); });
          panelKey = ''; readComments();
        }
      });
      panelView.update({ panel: 'comments', text: '', records: current?.items || [], unavailable: !current || current.failed,
        thread: current?.items.find(item => item.key === comments.state.thread), replyLimit: comments.state.limit,
        commentsStatus: { loading: current?.loading ?? true, failed: current?.failed ?? false, hasMore: current?.hasMore ?? true } });
      body.scrollTop = scroll;
      if (selected) Array.from(body.querySelectorAll<HTMLElement>('[data-focus-id]')).find(el => el.dataset.focusId === selected)?.focus({ preventScroll: true });
    }
    function paintPlaylists() {
      if (panel !== 'playlists' || lifecycle.destroyed) return;
      const selected = (shadow.activeElement as HTMLElement | null)?.dataset.focusId, scroll = body.scrollTop;
      panelView ||= mountWatchPanel(body, controllerStyle, {
        openThread() {}, replies() {}, load() {},
        savePlaylist: key => { void playlist.toggle(key); }, retryPlaylists: () => { void playlist.load(); }
      });
      panelView.update({ panel: 'playlists', text: '', records: [], unavailable: false,
        playlists: playlist.state.items, playlistLoading: playlist.state.loading, playlistFailed: playlist.state.failed });
      body.scrollTop = scroll;
      if (selected) Array.from(body.querySelectorAll<HTMLElement>('[data-focus-id]')).find(el => el.dataset.focusId === selected && !el.hasAttribute('disabled'))?.focus({ preventScroll: true });
    }
    function openPanel(value: Exclude<Panel, ''>) {
      if (!active() || switching()) return;
      mount(); panelDrawer.open();
      clearPanelActions();
      panelView?.dispose(); panelView = undefined; comments.reset(); playlist.reset();
      drawer.classList.toggle('comments', value === 'comments');
      panel = value; panelKey = '';
      host!.dataset.panel = value; document.documentElement.classList.add('ytg-shorts-panel-open');
      text(drawerTitle, t(value === 'comments' ? 'Comments' : value === 'playlists' ? 'Save to playlist' : 'Shorts controls'));
      if (value === 'comments') { pageAccess?.moreComments?.(true); readComments(); }
      else if (value === 'playlists') { paintPlaylists(); void playlist.load(); }
      else {
        const slots = (['like', 'comments', 'save', 'mute'] as const).map(action => {
          const slot = node('div'); slot.style.display = 'contents'; panelActionSlots.set(action, slot); return slot;
        });
        replaceBody([...slots, button('Back to feed', () => { closePanel(false); handle('back'); })]);
        paintActions(!!pageAccess?.readWatchInfo?.()?.liked);
      }
      panelDrawer.focus();
    }
    async function toggleLike() {
      if (working || switching()) return;
      const current = route, info = pageAccess?.readWatchInfo?.();
      if (!info?.canLike) { notify('Sign in to like this video.'); return; }
      working = true; paintActions(!!info.liked);
      let ok = false;
      try { ok = await pageAccess?.watchAction?.('like') === true; } catch { /* Leave state intact. */ }
      if (lifecycle.destroyed || route !== current) { working = false; return; }
      working = false;
      if (!ok) notify('Could not update Like. Try again.'); update();
    }
    function currentReel() {
      const onScreen = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      const visible = Array.from(document.querySelectorAll<HTMLElement>('ytd-reel-video-renderer')).filter(el => {
        // A fixed player can leave a content-sized reel with no layout height.
        const frame = el.querySelector<HTMLElement>('[data-ytg-shorts-media]')?.getBoundingClientRect();
        return !el.hidden && el.getAttribute('aria-hidden') !== 'true' &&
          (onScreen(el.getBoundingClientRect()) || !!frame && onScreen(frame));
      });
      return visible.find(el => el.hasAttribute('is-active') || el.hasAttribute('active')) || visible[0];
    }
    function paintTarget() {
      const queue = sourceQueue(), position = queue?.ids.indexOf(desiredId || id()) ?? -1;
      text(count, queue && position >= 0 ? `${position + 1} / ${queue.ids.length}` : 'Shorts');
      previous.disabled = !!queue && position <= 0; next.disabled = !!queue && position >= queue.ids.length - 1;
      preview.hidden = !desiredId;
      if (!preview.hidden) {
        const url = `https://i.ytimg.com/vi/${encodeURIComponent(desiredId)}/hqdefault.jpg`;
        if (cover.src !== url) cover.src = url; text(status, t('Loading video…'));
      }
    }
    function update() {
      if (!active() || document.hidden || !host) return;
      paintTarget(); if (switching()) return;
      const reel = currentReel();
      const video = reel?.querySelector<HTMLVideoElement>('video') || document.querySelector<HTMLVideoElement>('ytd-shorts video');
      if (video !== media) { releaseMedia(); media = video; if (media) originalLoop = media.loop; playbackFailure = ''; }
      syncMediaSurface();
      const advertising = !!mediaPlayer?.classList.contains('ad-showing');
      host.toggleAttribute('data-ad', advertising);
      if (media) media.loop = advertising ? originalLoop : true;
      const info = pageAccess?.readWatchInfo?.(), currentInfo = info?.route === routeKey() ? info : undefined;
      text(title, currentInfo?.details?.title?.slice(0, 240) || 'Shorts');
      text(author, currentInfo?.details?.author?.slice(0, 120) || 'YouTube');
      paintActions(!!currentInfo?.liked);
      if (panel === 'comments') readComments();
      if (media?.error) { text(status, t('Video could not play. Retry playback.')); retry.hidden = false; updateHint(); return; }
      if (!media || !media.readyState && !playbackFailure) {
        const timedOut = performance.now() - started > (media ? 15000 : 10000);
        text(status, t(timedOut ? 'Shorts could not load. Retry playback.' : 'Loading video…')); retry.hidden = !timedOut; updateHint(); return;
      }
      retry.hidden = !playbackFailure; updateHint();
      progress.value = Number.isFinite(media.duration) && media.duration > 0 ? Math.min(1, media.currentTime / media.duration) : 0;
      text(clock, `${time(media.currentTime)} / ${time(media.duration)}`); play.setAttribute('aria-pressed', String(!media.paused));
      const symbol = media.paused ? 'play' : 'pause';
      if (play.dataset.icon !== symbol) { play.querySelector('svg')?.replaceWith(createInterfaceIcon(symbol)); play.dataset.icon = symbol; }
      text(status, t(playbackFailure || (performance.now() < messageUntil ? message : media.readyState < 3 ? 'Buffering…' : '')));
    }
    function sync() {
      if (!active()) {
        polling?.destroy(); polling = undefined;
        if (!inShorts && !host) return;
        cancelMoves(); closePanel(false); releaseMedia(); document.documentElement.classList.remove('ytg-shorts-player');
        inShorts = false; entryIndex = undefined; returning = false; route = ''; wheelHeld = false; lifecycle.clearTimeout(wheelTimer);
        if (host) host.hidden = true; if (backdrop) backdrop.hidden = true; return;
      }
      if (!inShorts) { inShorts = true; entryIndex = historyIndex(); }
      if (!polling) { polling = runtime.scope('shorts-poll'); polling.interval(() => { if (!document.hidden) sync(); }, 250); }
      const playbackRoute = location.pathname;
      if (route !== playbackRoute) { route = playbackRoute; started = performance.now(); messageUntil = 0; closePanel(false); releaseMedia(); }
      mount(); host!.hidden = false;
      document.documentElement.classList.add('ytg-shorts-player');
      backdrop!.hidden = false; update();
    }
    function scheduleMove() { lifecycle.clearTimeout(moveTimer); moveTimer = lifecycle.timeout(commitMove, 100); }
    function commitMove() {
      if (!enabled() || returning || lifecycle.destroyed) { cancelMoves(); return; }
      if (loading || nativeMoving) return;
      if (desiredId) {
        if (desiredId === id()) {
          const resume = resumeOnCancel; cancelMoves();
          if (resume && media?.paused) startPlayback();
          update(); return;
        }
        loading = true; media?.pause();
        const target = desiredId, queue = sourceQueue();
        navigatingId = target;
        if (queue) {
          try { sessionStorage.setItem(shortsQueueKey, JSON.stringify({ ...queue, currentId: target })); } catch { /* Native playback remains available without the queue. */ }
        }
        // Keep the stage mounted while YouTube starts the next native reel.
        navigationTimer = lifecycle.timeout(() => {
          if (queue) {
            try { sessionStorage.setItem(shortsQueueKey, JSON.stringify({ ...queue, currentId: id() })); } catch { /* Keep native playback available. */ }
          }
          cancelMoves(); sync(); notify('No next video is available yet. Try again.');
        }, 8000);
        if (!pageAccess?.openWatchVideo?.(`/shorts/${encodeURIComponent(target)}`)) {
          lifecycle.clearTimeout(navigationTimer);
          location.replace(`/shorts/${encodeURIComponent(target)}`);
        }
      } else {
        if (!nativeSteps) { cancelMoves(); return; }
        const direction = nativeSteps > 0 ? 'down' : 'up'; nativeSteps += direction === 'down' ? -1 : 1;
        const control = document.querySelector<HTMLElement>(`ytd-shorts #navigation-button-${direction} button,ytd-shorts button#navigation-button-${direction},ytd-shorts #navigation-button-${direction}[role="button"]`);
        if (control && !control.hasAttribute('disabled') && control.getAttribute('aria-disabled') !== 'true') {
          nativeMoving = true;
          navigationTimer = lifecycle.timeout(() => { cancelMoves(); notify('No next video is available yet. Try again.'); }, 8000); control.click();
        } else {
          const reels = Array.from(document.querySelectorAll<HTMLElement>('ytd-reel-video-renderer')), current = currentReel();
          const target = reels[reels.indexOf(current!) + (direction === 'down' ? 1 : -1)];
          if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
          else notify('No next video is available yet. Try again.');
          cancelMoves(); update();
        }
      }
    }
    function finished() {
      if (loading && navigatingId !== id()) return;
      loading = false;
      navigatingId = '';
      nativeMoving = false; lifecycle.clearTimeout(navigationTimer); sync();
      if (desiredId && desiredId !== id() || nativeSteps) scheduleMove();
      else { cancelMoves(); update(); }
    }
    function move(direction: 'up' | 'down') {
      closePanel(false);
      if (inRail()) play.focus({ preventScroll: true });
      const queue = sourceQueue();
      if (queue) {
        const position = queue.ids.indexOf(desiredId || id());
        const target = queue.ids[position + (direction === 'down' ? 1 : -1)];
        if (position < 0 || !target) { notify('No more Shorts in this list. Press B to return.'); return; }
        if (!desiredId && !loading) resumeOnCancel = !!media && !media.paused;
        desiredId = target; media?.pause(); paintTarget(); scheduleMove();
      } else { nativeSteps += direction === 'down' ? 1 : -1; commitMove(); }
    }
    function backToFeed() {
      returning = true; cancelMoves(); closePanel(false); media?.pause(); const index = historyIndex();
      if (entryIndex !== undefined && index !== undefined && entryIndex > 0 && index >= entryIndex) history.go(entryIndex - index - 1);
      else if (entryIndex === undefined && history.length > 1) history.back(); else location.assign(readShortsQueue().returnTo);
      lifecycle.timeout(() => { returning = false; }, 1000);
    }
    function handle(action: Action) {
      if (!active() && !loading) return false;
      if (!loading) sync(); if (returning) return true;
      if (panel) {
        if (action === 'back' || action === 'help') { panelDrawer.back(); return true; }
        if (['up', 'down', 'left', 'right'].includes(action)) {
          const buttons = panelDrawer.items(), current = buttons.indexOf(shadow.activeElement as HTMLButtonElement);
          panelDrawer.focus(current + (action === 'up' || action === 'left' ? -1 : 1));
          (shadow.activeElement as HTMLElement | null)?.scrollIntoView({ block: 'nearest', behavior: 'instant' }); return true;
        }
        if (action === 'confirm') { (shadow.activeElement as HTMLElement | null)?.click(); return true; }
        if (action !== 'mute' && action !== 'volumeDown' && action !== 'volumeUp' && action !== 'playPause') return true;
      }
      if (action === 'help') { openPanel('actions'); return true; }
      if (!panel && inRail()) {
        if (action === 'back' || action === 'left') { play.focus({ preventScroll: true }); updateHint(); return true; }
        if (action === 'up' || action === 'down') { focusRail(railButtons().indexOf(shadow.activeElement as HTMLButtonElement) + (action === 'down' ? 1 : -1)); return true; }
        if (action === 'right') return true;
      }
      if (!panel && action === 'right') { focusRail(); return true; }
      if (!panel && action === 'left') { play.focus({ preventScroll: true }); return true; }
      if (action === 'up' || action === 'down') { move(action); return true; }
      if (action === 'back') { backToFeed(); return true; }
      if (!['confirm', 'playPause', 'pause', 'seekBack', 'seekForward', 'volumeDown', 'volumeUp', 'mute'].includes(action)) return false;
      if (switching()) return true;
      if (action === 'confirm' && shadow.activeElement instanceof HTMLButtonElement && shadow.activeElement !== play) { shadow.activeElement.click(); return true; }
      if ((action === 'confirm' || action === 'playPause') && !retry.hidden) { retryPlayback(); return true; }
      if (!media) { notify('Video is still loading.'); return true; }
      if (action === 'confirm' || action === 'playPause') {
        if (media.paused) startPlayback(); else media.pause();
      } else if (action === 'pause') media.pause(); else if (action === 'mute') media.muted = !media.muted;
      else if (action === 'volumeDown' || action === 'volumeUp') { media.volume = Math.max(0, Math.min(1, media.volume + (action === 'volumeDown' ? -.05 : .05))); if (action === 'volumeUp') media.muted = false; }
      else if (Number.isFinite(media.duration)) media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + (action === 'seekBack' ? -5 : 5)));
      update(); return true;
    }
    // Retain pending Shorts directions while the core guards route navigation.
    // Temporary native layers and the global menu always keep input ownership.
    lifecycle.listen(window, 'yt-gamepad-action', event => {
      const action = (event as CustomEvent).detail?.action;
      if (!switching() || !enabled() || !canHandle?.() || !['up', 'down', 'back'].includes(action)) return;
      event.stopImmediatePropagation(); handle(action);
    }, true);
    lifecycle.listen(window, 'wheel', event => {
      const wheel = event as WheelEvent;
      if (!active() || panel || !canHandle?.() || Math.abs(wheel.deltaY) < 20 || Math.abs(wheel.deltaX) > Math.abs(wheel.deltaY)) return;
      wheel.preventDefault(); lifecycle.clearTimeout(wheelTimer);
      wheelTimer = lifecycle.timeout(() => { wheelHeld = false; }, 180);
      if (wheelHeld || switching()) return;
      wheelHeld = true; move(wheel.deltaY > 0 ? 'down' : 'up');
    }, { capture: true, passive: false });
    lifecycle.listen(document, 'yt-navigate-finish', finished);
    lifecycle.listen(document, 'yt-page-data-updated', sync);
    lifecycle.listen(document, PAGE_COMMENTS, readComments);
    lifecycle.listen(document, PAGE_WATCH_INFO, update);
    lifecycle.listen(window, 'popstate', () => { cancelMoves(); sync(); });
    lifecycle.listen(document, 'ytg-language-changed', () => { if (host) { closePanel(false); clearActions(); unregister?.(); unregister = undefined; host.remove(); host = undefined; style?.remove(); backdrop?.remove(); } sync(); });
    lifecycle.cleanup(() => { cancelMoves(); closePanel(false); clearActions(); polling?.destroy(); unregister?.(); releaseMedia(); document.documentElement.classList.remove('ytg-shorts-player'); host?.remove(); backdrop?.remove(); style?.remove(); });
    return { sync, handle };
  }
};
