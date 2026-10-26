import type { Action, ControllerStyle, Runtime } from '../../types/ports';
import type { PageAccess } from '../bridge/page-protocol';
import { PAGE_COMMENTS, PAGE_WATCH_INFO } from '../bridge/page-protocol';
import { isShortsPlaybackRoute, readShortsQueue, shortsQueueKey, shortsPlayerHref } from '../shared/shorts-route';
import { t } from '../shared/i18n';
import { mingcuteIcons } from '../ui/mingcute-icons';
import pageCSS from './shorts-page.css?inline';
import controlsCSS from './shorts-controls.css?inline';

type Panel = '' | 'comments' | 'playlists' | 'actions';

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
    let progress: HTMLProgressElement, play: HTMLButtonElement, previous: HTMLButtonElement, next: HTMLButtonElement, recovery: HTMLButtonElement;
    let like: HTMLButtonElement, drawer: HTMLElement, drawerTitle: HTMLElement, body: HTMLElement;
    let preview: HTMLElement, cover: HTMLImageElement;
    let route = '', inShorts = false, native = false, returning = false, started = 0;
    let entryIndex: number | undefined, media: HTMLVideoElement | null = null, originalLoop = false;
    let mediaPlayer: HTMLElement | null = null, mediaAncestors: HTMLElement[] = [];
    let playbackFailure = '', panel: Panel = '', panelKey = '', panelVersion = 0;
    let panelReturn: HTMLElement | undefined;
    let desiredId = '', loading = false, nativeSteps = 0, nativeMoving = false;
    let moveTimer: number | undefined, navigationTimer: number | undefined;
    let message = '', messageUntil = 0, working = false, resumeOnCancel = false;
    const historyIndex = () => (window as unknown as { navigation?: { currentEntry?: { index: number } } }).navigation?.currentEntry?.index;
    const active = () => enabled() && isShortsPlaybackRoute();
    const id = () => location.pathname.split('/')[2] || '';
    const sourceQueue = () => { const queue = readShortsQueue(); return queue.currentId === id() ? queue : undefined; };
    const routeKey = () => location.pathname + location.search;
    const time = (value: number) => Number.isFinite(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '0:00';
    const text = (el: HTMLElement, value: string) => { if (el.textContent !== value) el.textContent = value; };
    const switching = () => loading || nativeMoving || !!desiredId && desiredId !== id();
    function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', value = '') {
      const el = document.createElement(tag); el.className = className; el.textContent = value; return el;
    }
    function icon(name: string) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      const alias: Record<string, string> = { 'thumb-up': 'like', chat: 'comments', 'arrow-left': 'right', up: 'right', down: 'right' };
      const rotation: Record<string, string> = { 'arrow-left': 'rotate(180deg)', up: 'rotate(-90deg)', down: 'rotate(90deg)' };
      if (rotation[name]) svg.style.transform = rotation[name];
      for (const shape of mingcuteIcons[(alias[name] || name) + '-line'] || []) {
        const child = document.createElementNS(svg.namespaceURI, shape.tag);
        for (const [key, value] of Object.entries(shape.attrs)) child.setAttribute(key, value);
        svg.append(child);
      }
      if (name === 'more') {
        for (const x of [5, 12, 19]) { const circle = document.createElementNS(svg.namespaceURI, 'circle'); circle.setAttribute('cx', String(x)); circle.setAttribute('cy', '12'); circle.setAttribute('r', '2'); circle.setAttribute('fill', 'currentColor'); svg.append(circle); }
      } else if (name === 'close' || name === 'volume') {
        const path = document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', name === 'close' ? 'M6 6 18 18M18 6 6 18' : 'M4 9H8L13 5V19L8 15H4ZM17 8Q21 12 17 16');
        path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); svg.append(path);
      }
      return svg;
    }
    function button(label: string, callback: () => void, image?: string) {
      const el = node('button'); el.type = 'button'; el.setAttribute('aria-label', t(label));
      if (image) el.append(icon(image));
      el.append(node('span', '', t(label))); el.onclick = callback; return el;
    }
    function notify(value: string) { message = value; messageUntil = performance.now() + 3500; text(status, t(value)); }
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
      for (const owner of mediaAncestors) if (!ancestors.includes(owner)) owner.removeAttribute('data-ytg-shorts-ancestor');
      for (const owner of ancestors) if (!owner.hasAttribute('data-ytg-shorts-ancestor')) owner.setAttribute('data-ytg-shorts-ancestor', '');
      mediaAncestors = ancestors;
    }
    function releaseMedia() {
      if (media) media.loop = originalLoop;
      media = null;
      syncMediaSurface();
    }
    function cancelMoves() {
      lifecycle.clearTimeout(moveTimer); lifecycle.clearTimeout(navigationTimer);
      moveTimer = navigationTimer = undefined; desiredId = ''; loading = false; nativeSteps = 0; nativeMoving = false;
      resumeOnCancel = false;
      if (preview) preview.hidden = true;
    }
    function closePanel(restore = true) {
      panel = ''; panelKey = ''; ++panelVersion;
      host?.removeAttribute('data-panel'); document.documentElement.classList.remove('ytg-shorts-panel-open');
      if (drawer) { drawer.hidden = true; body.replaceChildren(); }
      if (restore && panelReturn?.isConnected) panelReturn.focus({ preventScroll: true });
      panelReturn = undefined;
    }
    function revealNative() {
      cancelMoves(); closePanel(false); native = true; releaseMedia();
      document.documentElement.classList.remove('ytg-shorts-player');
      if (backdrop) backdrop.hidden = true;
      host?.setAttribute('data-native', ''); text(recovery, t('Retry Shorts view')); recovery.setAttribute('aria-label', t('Retry Shorts view'));
      text(status, t('YouTube controls are available. Retry Shorts view when ready.'));
    }
    function mount() {
      if (host) return;
      style = node('style'); style.textContent = pageCSS;
      backdrop = node('div'); backdrop.id = 'ytg-shorts-backdrop';
      host = node('section'); host.id = 'ytg-shorts-controls'; host.setAttribute('aria-label', t('Shorts player'));
      shadow = host.attachShadow({ mode: 'open' });
      const css = node('style'); css.textContent = controlsCSS + controllerStyle.css;
      const back = button('Back to feed', () => handle('back'), 'arrow-left'); back.className = 'back';
      const stage = node('div', 'stage');
      preview = node('div', 'preview'); preview.hidden = true; cover = node('img'); cover.alt = ''; preview.append(cover);
      play = button('Play / pause', () => dispatch('playPause'), 'play'); play.className = 'play'; play.dataset.shortsAction = 'playPause';
      play.querySelector('span')!.hidden = true;
      const metadata = node('div', 'metadata'); author = node('p', 'author'); title = node('h1', 'title', 'Shorts'); metadata.append(author, title);
      const timeline = node('div', 'timeline'); progress = node('progress'); progress.max = 1; progress.value = 0; progress.setAttribute('aria-label', t('Video progress'));
      clock = node('span', 'clock'); timeline.append(progress, clock); stage.append(preview, play, metadata, timeline);
      const rail = node('nav', 'rail'); rail.setAttribute('aria-label', t('Shorts controls'));
      like = button('Like', () => void toggleLike(), 'thumb-up'); like.dataset.shortsAction = 'like';
      const comments = button('Comments', () => openPanel('comments'), 'chat'); comments.dataset.shortsAction = 'comments';
      const save = button('Save', () => openPanel('playlists'), 'save'); save.dataset.shortsAction = 'save';
      const more = button('More', () => openPanel('actions'), 'more'); more.dataset.shortsAction = 'more';
      rail.append(like, comments, save, more);
      const navigation = node('div', 'navigation'); count = node('span', 'count');
      previous = button('Previous Shorts', () => handle('up'), 'up'); next = button('Next Shorts', () => handle('down'), 'down');
      previous.dataset.shortsAction = 'up'; next.dataset.shortsAction = 'down';
      previous.querySelector('span')!.hidden = true; next.querySelector('span')!.hidden = true; navigation.append(count, previous, next);
      const feedback = node('div', 'feedback'); status = node('p', 'status'); status.setAttribute('role', 'status'); feedback.append(status);
      recovery = button('Use YouTube controls', () => {
        if (native) { native = false; started = performance.now(); text(recovery, t('Use YouTube controls')); recovery.setAttribute('aria-label', t('Use YouTube controls')); sync(); }
        else revealNative();
      }); recovery.className = 'native';
      drawer = node('aside', 'drawer'); drawer.hidden = true; drawer.setAttribute('role', 'region');
      const header = node('header'); drawerTitle = node('h2'); drawerTitle.id = 'shorts-panel-title'; drawer.setAttribute('aria-labelledby', drawerTitle.id);
      const close = button('Close', () => closePanel(), 'close'); close.className = 'close'; close.querySelector('span')!.hidden = true;
      body = node('div', 'drawer-body'); header.append(drawerTitle, close); drawer.append(header, body);
      shadow.append(css, back, stage, rail, navigation, feedback, recovery, drawer, node('span', 'brand', 'YouTube Shorts'));
      document.documentElement.append(style, backdrop, host); unregister = controllerStyle.register(shadow);
    }
    function panelButtons() { return Array.from(drawer.querySelectorAll<HTMLElement>('button:not(:disabled),article.comment')).filter(el => !el.hidden); }
    function focusPanel(index = 0) { const buttons = panelButtons(); buttons[Math.max(0, Math.min(index, buttons.length - 1))]?.focus({ preventScroll: true }); }
    function replaceBody(items: Node[]) {
      const key = (shadow.activeElement as HTMLElement | null)?.dataset.key, scroll = body.scrollTop;
      body.replaceChildren(...items); body.scrollTop = scroll;
      if (key) Array.from(body.querySelectorAll<HTMLElement>('[data-key]')).find(el => el.dataset.key === key)?.focus({ preventScroll: true });
    }
    function commentAuthor(name: string, avatar?: string) {
      const header = node('p', 'comment-author'), fallback = () => node('span', 'comment-avatar', Array.from(name.trim())[0] || '·');
      if (avatar) {
        const image = document.createElement('img'); image.className = 'comment-avatar';
        image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => image.replaceWith(fallback()), { once: true });
        image.src = avatar; header.append(image);
      } else header.append(fallback());
      header.append(document.createTextNode(name)); return header;
    }
    function readComments() {
      if (panel !== 'comments') return;
      const snapshot = pageAccess?.readComments?.(), current = snapshot?.route === routeKey() ? snapshot : undefined;
      const key = JSON.stringify(current || null); if (key === panelKey) return; panelKey = key;
      const items: Node[] = [];
      for (const comment of current?.items || []) {
        const article = node('article', 'comment'); article.tabIndex = -1; article.dataset.key = 'comment:' + comment.key;
        article.append(commentAuthor(comment.author, comment.avatar), node('p', 'comment-text', comment.text));
        if (comment.replies.length) {
          const replies = node('div', 'comment-children');
          for (const reply of comment.replies) {
            const child = node('article', 'reply');
            child.append(commentAuthor(reply.author || t('Reply'), reply.avatar), node('p', 'comment-text', reply.text));
            replies.append(child);
          }
          article.append(replies);
        }
        if (comment.hasReplies) {
          const replies = button('Load replies', () => { pageAccess?.commentReplies?.(comment.key); panelKey = ''; readComments(); });
          replies.dataset.key = 'reply:' + comment.key; replies.disabled = !!current?.loading; article.append(replies);
        }
        items.push(article);
      }
      if (!current?.items.length) items.push(node('p', 'drawer-message', t(current?.failed ? 'Comments could not load.' : current?.loading ? 'Loading…' : 'No comments yet.')));
      if (!current || current.hasMore || current.failed) {
        const load = button(current?.failed ? 'Retry' : current?.loading ? 'Loading…' : 'Load more comments', () => {
          pageAccess?.moreComments?.(!current || !current.items.length); panelKey = ''; readComments();
        }); load.className = 'load'; load.dataset.key = 'load'; load.disabled = !!current?.loading; items.push(load);
      }
      replaceBody(items);
    }
    async function readPlaylists() {
      const version = ++panelVersion, currentRoute = route;
      replaceBody([node('p', 'drawer-message', t('Loading…'))]);
      let playlists;
      try { playlists = await pageAccess?.watchPlaylists?.(); } catch { /* Render retry below. */ }
      if (lifecycle.destroyed || version !== panelVersion || panel !== 'playlists' || route !== currentRoute) return;
      if (!playlists) { replaceBody([node('p', 'drawer-message', t('Could not update playlists. Try again.')), button('Retry', () => void readPlaylists())]); return; }
      const items: Node[] = playlists.map(item => {
        const el = button(item.title, () => {
          if (working) return; working = true; el.disabled = true;
          void (async () => {
            let ok = false;
            try { ok = await pageAccess?.watchPlaylistToggle?.(item.key) === true; } catch { /* Keep state on failure. */ }
            if (lifecycle.destroyed || version !== panelVersion || route !== currentRoute) { working = false; return; }
            working = false; el.disabled = false;
            if (ok) { item.selected = !item.selected; el.setAttribute('aria-pressed', String(item.selected)); }
            else notify('Could not update playlists. Try again.');
          })();
        }, 'save'); el.className = 'playlist'; el.setAttribute('aria-pressed', String(item.selected)); el.dataset.key = item.key; return el;
      });
      replaceBody(items.length ? items : [node('p', 'drawer-message', t('No editable playlists. Sign in to save videos.'))]);
    }
    function openPanel(value: Exclude<Panel, ''>) {
      if (!active() || native || switching()) return;
      mount(); if (!panel) panelReturn = shadow.activeElement as HTMLElement || play;
      panel = value; panelKey = ''; ++panelVersion;
      host!.dataset.panel = value; document.documentElement.classList.add('ytg-shorts-panel-open'); drawer.hidden = false;
      text(drawerTitle, t(value === 'comments' ? 'Comments' : value === 'playlists' ? 'Save to playlist' : 'Shorts controls'));
      if (value === 'comments') { pageAccess?.moreComments?.(true); readComments(); }
      else if (value === 'playlists') void readPlaylists();
      else replaceBody([
        button('Like', () => void toggleLike(), 'thumb-up'), button('Comments', () => openPanel('comments'), 'chat'),
        button('Save to playlist', () => openPanel('playlists'), 'save'), button('Mute / unmute', () => handle('mute'), 'volume'),
        button('Use YouTube controls', revealNative), button('Back to feed', () => { closePanel(false); handle('back'); })
      ]);
      focusPanel();
    }
    async function toggleLike() {
      if (working || switching()) return;
      const current = route, info = pageAccess?.readWatchInfo?.();
      if (!info?.canLike) { notify('Sign in or use YouTube controls to like this video.'); return; }
      working = true; like.disabled = true;
      let ok = false;
      try { ok = await pageAccess?.watchAction?.('like') === true; } catch { /* Leave state intact. */ }
      if (lifecycle.destroyed || route !== current) { working = false; return; }
      working = false; like.disabled = false;
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
      if (!active() || document.hidden || !host || native) return;
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
      like.setAttribute('aria-pressed', String(!!currentInfo?.liked)); like.disabled = working;
      if (panel === 'comments') readComments();
      if (!media || !media.readyState && !playbackFailure) {
        if (performance.now() - started > (media ? 15000 : 10000)) revealNative(); else text(status, t('Loading video…')); return;
      }
      if (media.error) { text(status, t('Video could not play. Use YouTube controls to view the error or retry.')); return; }
      progress.value = Number.isFinite(media.duration) && media.duration > 0 ? Math.min(1, media.currentTime / media.duration) : 0;
      text(clock, `${time(media.currentTime)} / ${time(media.duration)}`); play.setAttribute('aria-pressed', String(!media.paused));
      const symbol = media.paused ? 'play' : 'pause';
      if (play.dataset.icon !== symbol) { play.querySelector('svg')?.replaceWith(icon(symbol)); play.dataset.icon = symbol; }
      text(status, t(playbackFailure || (performance.now() < messageUntil ? message : media.readyState < 3 ? 'Buffering…' : '')));
    }
    function sync() {
      if (!active()) {
        polling?.destroy(); polling = undefined;
        if (!inShorts && !host) return;
        cancelMoves(); closePanel(false); releaseMedia(); document.documentElement.classList.remove('ytg-shorts-player');
        inShorts = false; entryIndex = undefined; returning = false; native = false; route = '';
        if (host) host.hidden = true; if (backdrop) backdrop.hidden = true; return;
      }
      if (!inShorts) { inShorts = true; entryIndex = historyIndex(); }
      if (!polling) { polling = runtime.scope('shorts-poll'); polling.interval(() => { if (!document.hidden) sync(); }, 250); }
      const playbackRoute = location.pathname;
      if (route !== playbackRoute) { route = playbackRoute; started = performance.now(); native = false; messageUntil = 0; closePanel(false); releaseMedia(); }
      mount(); host!.hidden = false; host!.toggleAttribute('data-native', native);
      document.documentElement.classList.toggle('ytg-shorts-player', !native);
      backdrop!.hidden = native; update();
    }
    function scheduleMove() { lifecycle.clearTimeout(moveTimer); moveTimer = lifecycle.timeout(commitMove, 100); }
    function commitMove() {
      if (!enabled() || returning || native || lifecycle.destroyed) { cancelMoves(); return; }
      if (loading || nativeMoving) return;
      if (desiredId) {
        if (desiredId === id()) {
          const resume = resumeOnCancel; cancelMoves();
          if (resume && media?.paused) { try { void media.play().catch(() => notify('Playback was blocked. Click Play or use YouTube controls.')); } catch { notify('Playback was blocked. Click Play or use YouTube controls.'); } }
          update(); return;
        }
        loading = true; media?.pause();
        const target = desiredId, queue = sourceQueue();
        if (queue) {
          try { sessionStorage.setItem(shortsQueueKey, JSON.stringify({ ...queue, currentId: target })); } catch { /* Native playback remains available without the queue. */ }
        }
        location.replace(shortsPlayerHref(target));
      } else {
        if (!nativeSteps) { cancelMoves(); return; }
        const direction = nativeSteps > 0 ? 'down' : 'up'; nativeSteps += direction === 'down' ? -1 : 1;
        const control = document.querySelector<HTMLElement>(`ytd-shorts #navigation-button-${direction} button,ytd-shorts button#navigation-button-${direction},ytd-shorts #navigation-button-${direction}[role="button"]`);
        if (control && !control.hasAttribute('disabled') && control.getAttribute('aria-disabled') !== 'true') {
          nativeMoving = true;
          navigationTimer = lifecycle.timeout(() => { cancelMoves(); notify('No next video is available yet. Try YouTube controls.'); }, 8000); control.click();
        } else {
          const reels = Array.from(document.querySelectorAll<HTMLElement>('ytd-reel-video-renderer')), current = currentReel();
          const target = reels[reels.indexOf(current!) + (direction === 'down' ? 1 : -1)];
          if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
          else notify('No next video is available yet. Try YouTube controls.');
          cancelMoves(); update();
        }
      }
    }
    function finished() {
      nativeMoving = false; lifecycle.clearTimeout(navigationTimer); sync();
      if (desiredId && desiredId !== id() || nativeSteps) scheduleMove();
      else { cancelMoves(); update(); }
    }
    function move(direction: 'up' | 'down') {
      closePanel(false);
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
      if ((!active() && !loading) || native && action !== 'back') return false;
      if (!loading) sync(); if (returning) return true;
      if (panel) {
        if (action === 'back' || action === 'help') { closePanel(); return true; }
        if (['up', 'down', 'left', 'right'].includes(action)) {
          const buttons = panelButtons(), current = buttons.indexOf(shadow.activeElement as HTMLButtonElement);
          focusPanel(current + (action === 'up' || action === 'left' ? -1 : 1));
          (shadow.activeElement as HTMLElement | null)?.scrollIntoView({ block: 'nearest', behavior: 'instant' }); return true;
        }
        if (action === 'confirm') { (shadow.activeElement as HTMLElement | null)?.click(); return true; }
        if (action !== 'mute' && action !== 'volumeDown' && action !== 'volumeUp' && action !== 'playPause') return true;
      }
      if (action === 'help') { openPanel('actions'); return true; }
      if (action === 'up' || action === 'down') { move(action); return true; }
      if (action === 'back') { backToFeed(); return true; }
      if (!['confirm', 'playPause', 'pause', 'left', 'right', 'seekBack', 'seekForward', 'volumeDown', 'volumeUp', 'mute'].includes(action)) return false;
      if (switching()) return true;
      if (action === 'confirm' && shadow.activeElement instanceof HTMLButtonElement && shadow.activeElement !== play) { shadow.activeElement.click(); return true; }
      if (!media) { notify('Video is not ready. Use YouTube controls below to recover.'); return true; }
      if (action === 'confirm' || action === 'playPause') {
        if (media.paused) {
          const attempted = media, attemptedRoute = route; playbackFailure = '';
          const failed = () => { if (media === attempted && route === attemptedRoute) { playbackFailure = 'Playback was blocked. Click Play or use YouTube controls.'; text(status, t(playbackFailure)); } };
          try { void media.play().catch(failed); } catch { failed(); }
        } else media.pause();
      } else if (action === 'pause') media.pause(); else if (action === 'mute') media.muted = !media.muted;
      else if (action === 'volumeDown' || action === 'volumeUp') { media.volume = Math.max(0, Math.min(1, media.volume + (action === 'volumeDown' ? -.05 : .05))); if (action === 'volumeUp') media.muted = false; }
      else if (Number.isFinite(media.duration)) media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + (action === 'left' || action === 'seekBack' ? -5 : 5)));
      update(); return true;
    }
    // Retain pending Shorts directions while the core guards route navigation.
    // Temporary native layers and the global menu always keep input ownership.
    lifecycle.listen(window, 'yt-gamepad-action', event => {
      const action = (event as CustomEvent).detail?.action;
      if (!switching() || !enabled() || native || !canHandle?.() || !['up', 'down', 'back'].includes(action)) return;
      event.stopImmediatePropagation(); handle(action);
    }, true);
    lifecycle.listen(document, 'yt-navigate-finish', finished);
    lifecycle.listen(document, 'yt-page-data-updated', sync);
    lifecycle.listen(document, PAGE_COMMENTS, readComments);
    lifecycle.listen(document, PAGE_WATCH_INFO, update);
    lifecycle.listen(window, 'popstate', () => { cancelMoves(); sync(); });
    lifecycle.listen(document, 'ytg-language-changed', () => { if (host) { closePanel(false); unregister?.(); unregister = undefined; host.remove(); host = undefined; style?.remove(); backdrop?.remove(); } sync(); });
    lifecycle.cleanup(() => { cancelMoves(); closePanel(false); polling?.destroy(); unregister?.(); releaseMedia(); document.documentElement.classList.remove('ytg-shorts-player'); host?.remove(); backdrop?.remove(); style?.remove(); });
    return { sync, handle, get native() { return native; } };
  }
};
